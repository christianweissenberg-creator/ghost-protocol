// Objekt-Studio Schritt 6 (10.11.2026): Hash-Prüfung der Anker gegen die live ausgelieferten Dateien und
// Abgleich von urls.cover im Steinadel-Export — für GET /api/studio/[objekt]/anker.
//
// Sicher gebaut:
// - Abgerufen werden nur die Adressen des Manifests (lib/studio/anker.ts), jede erst nach istManifestUrl.
//   Die Route nimmt keine Adresse entgegen. Weiterleitungen werden nicht verfolgt (redirect "manual"): Eine
//   3xx-Antwort heißt "nicht erreichbar", ihr Ziel wird nie abgerufen.
// - Zeitlimit je Datei ANKER_TIMEOUT_MS für Verbindung, Kopf und Inhalt; höchstens ANKER_GLEICHZEITIG
//   Abrufe zugleich.
// - Größenlimit: Gelesen wird höchstens die Byte-Zahl der Manifest-Datei. Ist die Live-Datei länger, bricht
//   der Abruf dort ab; sie kann dann nicht die Manifest-Datei sein ("geaendert"). Angefordert wird die Datei
//   ohne Kodierung (Accept-Encoding: identity); eine komprimierte Antwort wird nicht gelesen — sonst zählte das
//   Limit nur entpackte Bytes, und ein Strom, der zu nichts entpackt, liefe bis zum Zeitlimit (Prüfung 10.11.2026).
// - Nichts wird abgelegt: Der Hash entsteht beim Lesen, die Bytes werden verworfen.
// - Kein Takt: Geprüft wird nur auf Anfrage, und auch dann höchstens einmal je 15 min beim Seitenaufbau
//   bzw. einmal je 60 s mit „Alle prüfen“ (Zwischenspeicher in lib/studio/anker-speicher.ts).
// - Die Adresse aus urls.cover wird nur verglichen, nie abgerufen.
// Jedes Ergebnis trägt seinen Zeitpunkt. Ein Fehler bei einer Datei betrifft nur ihren Status.

import "server-only";
import { createHash } from "node:crypto";
import { domainToUnicode } from "node:url";
import { maskiereGeschuetzteNamen } from "../freigabe-regeln";
import { bereinigeFehler, istObjekt, istZeitueberschreitung } from "../status-server";
import { abweichendeTeile, istManifestUrl, vergleicheCover } from "./anker";
import type { AnkerEintrag, AnkerManifest, AnkerHashStatus } from "./anker";
import { leseExport } from "./export-abruf";
import type { StudioObjekt } from "./objekte";
import type { AnkerAntwort, AnkerHashErgebnis, CoverErgebnis, StudioMesswert } from "./typen";

/** Zeitlimit je Datei (Verbindung, Kopf und Inhalt). */
export const ANKER_TIMEOUT_MS = 10_000;
/** Höchstens so viele Abrufe auf steinadel.de zugleich. */
export const ANKER_GLEICHZEITIG = 4;
/** Längste Anzeige von urls.cover. */
export const COVER_ANZEIGE_MAX = 160;
/** Längeres urls.cover wird weder verglichen noch angezeigt: Die Maskierung braucht Zeit und Speicher je Zeichen. */
export const COVER_ROH_MAX = 2_000;
export const QUELLE_COVER = "urls.cover im Steinadel-Export über /api/objekte";

function zahl(n: number): string {
  return n.toLocaleString("de-DE");
}

/** Grund eines gescheiterten Abrufs: Zeitlimit mit Dauer, sonst bereinigt, mit dem Fehlercode der Ursache. */
function abrufGrund(e: unknown): string {
  if (istZeitueberschreitung(e)) return `Zeitüberschreitung (${ANKER_TIMEOUT_MS / 1000} s)`;
  const text = bereinigeFehler(e);
  const ursache = e instanceof Error ? e.cause : undefined;
  const code = istObjekt(ursache) && typeof ursache.code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(ursache.code) ? ursache.code : null;
  return code !== null && !text.includes(code) ? `${text} (${code})` : text;
}

/** MIME-Typ einer Antwort für einen Hinweis; null, wenn keiner oder nicht lesbar. */
function mimeTyp(kopf: string | null): string | null {
  const m = kopf === null ? null : /^\s*([\w.+-]{1,60}\/[\w.+-]{1,60})/.exec(kopf);
  return m ? m[1].toLowerCase() : null;
}

/** Ergebnis einer Datei; gemessen_am ist der Zeitpunkt, zu dem es feststeht. */
function ergebnis(
  e: AnkerEintrag,
  status: AnkerHashStatus,
  felder: Partial<Pick<AnkerHashErgebnis, "sha256_live" | "bytes_live" | "http_status" | "hinweis">>,
): AnkerHashErgebnis {
  return {
    id: e.id,
    status,
    sha256_soll: e.sha256,
    sha256_live: felder.sha256_live ?? null,
    bytes_soll: e.bytes,
    bytes_live: felder.bytes_live ?? null,
    http_status: felder.http_status ?? null,
    gemessen_am: new Date().toISOString(),
    hinweis: felder.hinweis ?? null,
  };
}

/**
 * Eine Manifest-Datei live laden und ihren SHA-256 mit dem Manifest vergleichen. Netzfehler, Zeitlimit,
 * HTTP-Fehler, Weiterleitung und Abbruch beim Lesen werden zum Status der Datei, nie zur Ausnahme.
 */
export async function pruefeAnkerDatei(e: AnkerEintrag): Promise<AnkerHashErgebnis> {
  // gemessen_am ist immer der Zeitpunkt des Ergebnisses (Prüfung 10.11.2026: vorher bei Netzfehlern der Versuchsbeginn).
  if (!istManifestUrl(e.url)) {
    return ergebnis(e, "nicht_erreichbar", { hinweis: "Adresse liegt nicht unter https://steinadel.de/objekte/ — nicht abgerufen" });
  }
  let res: Response;
  try {
    res = await fetch(e.url, {
      cache: "no-store",
      redirect: "manual",
      headers: { "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(ANKER_TIMEOUT_MS),
    });
  } catch (err) {
    return ergebnis(e, "nicht_erreichbar", { hinweis: abrufGrund(err) });
  }
  if (res.status !== 200) {
    // Verbindung freigeben, ohne den Inhalt zu lesen.
    void res.body?.cancel().catch(() => undefined);
    // redirect "manual": Node liefert die 3xx-Antwort selbst (gemessen 10.11.2026 mit Node 25; der Container
    // läuft auf Node 22, dort nicht gemessen); eine Laufzeit nach Browser-Art gäbe "opaqueredirect" mit
    // Status 0. Beides heißt hier "nicht erreichbar", das Ziel wird nie abgerufen.
    const weiter = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
    const code = res.status === 0 ? null : res.status;
    return ergebnis(e, "nicht_erreichbar", {
      http_status: code,
      hinweis: weiter ? `Weiterleitung${code === null ? "" : ` (HTTP ${code})`} — nicht gefolgt` : `HTTP ${res.status}`,
    });
  }
  const kodierung = (res.headers.get("content-encoding") ?? "").trim().toLowerCase();
  if (kodierung !== "" && kodierung !== "identity") {
    void res.body?.cancel().catch(() => undefined);
    const name = /^[\w.+-]{1,30}$/.test(kodierung) ? kodierung : "unbekannt";
    return ergebnis(e, "nicht_erreichbar", {
      http_status: 200,
      hinweis: `Antwort mit Kodierung „${name}“, angefordert war die Datei ohne Kodierung — nicht gelesen`,
    });
  }
  const typ = mimeTyp(res.headers.get("content-type"));
  const hash = createHash("sha256");
  let gelesen = 0;
  const leser = res.body?.getReader();
  try {
    while (leser) {
      const { done, value } = await leser.read();
      if (done) break;
      gelesen += value.byteLength;
      if (gelesen > e.bytes) {
        void leser.cancel().catch(() => undefined);
        return ergebnis(e, "geaendert", {
          http_status: 200,
          hinweis: `Live-Datei länger als die Manifest-Datei (${zahl(e.bytes)} B); Abruf dort abgebrochen`,
        });
      }
      hash.update(value);
    }
  } catch (err) {
    // Nur read() wirft hier; der Strom ist dann schon im Fehlerzustand, ein Abbruch erübrigt sich.
    return ergebnis(e, "nicht_erreichbar", { http_status: 200, hinweis: `Abbruch beim Lesen: ${abrufGrund(err)}` });
  }
  const live = hash.digest("hex");
  if (live === e.sha256 && gelesen === e.bytes) {
    return ergebnis(e, "unveraendert", { sha256_live: live, bytes_live: gelesen, http_status: 200 });
  }
  const groesse = gelesen === e.bytes ? "gleiche Größe, anderer Inhalt" : `${zahl(gelesen)} B statt ${zahl(e.bytes)} B`;
  return ergebnis(e, "geaendert", {
    sha256_live: live,
    bytes_live: gelesen,
    http_status: 200,
    hinweis: typ !== null && typ !== "image/jpeg" ? `${groesse}; Antwort vom Typ ${typ}` : groesse,
  });
}

/**
 * f für jedes Element, höchstens n zugleich; Ergebnisse in der Reihenfolge der Liste. Wirft f, beginnt kein
 * Arbeiter ein weiteres Element (laufende enden noch), und das Ganze scheitert mit diesem Fehler — sonst
 * luden die übrigen Arbeiter nach einem Programmfehler weiter Dateien, ohne dass jemand das Ergebnis liest.
 */
export async function mitHoechstens<T, R>(n: number, liste: readonly T[], f: (t: T) => Promise<R>): Promise<R[]> {
  const aus: R[] = new Array<R>(liste.length);
  let naechster = 0;
  let gescheitert = false;
  const arbeiter = async () => {
    while (!gescheitert && naechster < liste.length) {
      const i = naechster++;
      try {
        aus[i] = await f(liste[i]);
      } catch (e) {
        gescheitert = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, liste.length)) }, arbeiter));
  return aus;
}

/** Alle Dateien eines Manifests prüfen, höchstens ANKER_GLEICHZEITIG zugleich. */
export function pruefeAnkerDateien(eintraege: readonly AnkerEintrag[]): Promise<AnkerHashErgebnis[]> {
  return mitHoechstens(ANKER_GLEICHZEITIG, eintraege, pruefeAnkerDatei);
}

function coverAnker(manifest: AnkerManifest): AnkerEintrag {
  const anker = manifest.eintraege.find((e) => e.id === manifest.cover_anker);
  // Ein Manifest ohne seinen Cover-Anker ist ein Programmfehler (Route: 500), kein Prüfergebnis.
  if (!anker) throw new Error(`Cover-Anker „${manifest.cover_anker}“ fehlt im Manifest`);
  return anker;
}

/** Gültige Prozent-Folgen auflösen; eine ungültige Folge bleibt stehen. */
function entkodiere(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (folge) => {
    try {
      return decodeURIComponent(folge);
    } catch {
      return folge;
    }
  });
}

/**
 * urls.cover für die Anzeige: Host aus Punycode und Pfad aus der Prozentkodierung zurückgewandelt, damit die
 * Maskierung den geschützten Namen auch in diesen Formen findet (Prüfung 10.11.2026), dann Steuerzeichen
 * entfernt, maskiert und gekürzt. null, wenn nicht anzeigbar: Bliebe eine Prozent-Folge stehen, könnte sich
 * darin der Name verbergen.
 */
function anzeigeAdresse(adresse: string): string | null {
  let u: URL;
  try {
    u = new URL(adresse);
  } catch {
    return null;
  }
  const pfad = entkodiere(u.pathname);
  if (/%[0-9A-Fa-f]{2}/.test(pfad)) return null;
  const host = domainToUnicode(u.hostname) || u.hostname;
  const roh = `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}${pfad}`.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  const text = maskiereGeschuetzteNamen(roh);
  return text.length > COVER_ANZEIGE_MAX ? `${text.slice(0, COVER_ANZEIGE_MAX - 1)}…` : text;
}

/** Abgleich von urls.cover aus einer gelesenen Export-Antwort (Status 2xx von /api/objekte). */
export function coverAusExport(daten: unknown, slug: string, manifest: AnkerManifest, abgerufenAm: string): CoverErgebnis {
  const anker = coverAnker(manifest);
  const basis = { anker_id: anker.id, soll: anker.url, quelle: QUELLE_COVER, gemessen_am: abgerufenAm };
  if (!istObjekt(daten) || !Array.isArray(daten.objekte)) {
    return { ...basis, status: "nicht_lesbar", ist: null, hinweis: "Antwort ohne Objektliste", fehler_art: "quelle_fehler" };
  }
  const roh = (daten.objekte as unknown[]).find((o): o is Record<string, unknown> => istObjekt(o) && o.slug === slug);
  if (!roh) {
    return {
      ...basis,
      status: "nicht_lesbar",
      ist: null,
      hinweis: maskiereGeschuetzteNamen(`Objekt „${slug}“ nicht im Steinadel-Export`),
      fehler_art: "nicht_im_export",
    };
  }
  const urls = istObjekt(roh.urls) ? roh.urls : null;
  const coverRoh = urls === null ? undefined : urls.cover;
  // Erst die Länge, dann Vergleich und Maskierung (Prüfung 10.11.2026: 10 MB kosteten sonst über 1 s und 1 GB).
  if (typeof coverRoh === "string" && coverRoh.length > COVER_ROH_MAX) {
    return { ...basis, status: "geaendert", ist: null, hinweis: `urls.cover ist länger als ${zahl(COVER_ROH_MAX)} Zeichen — weder verglichen noch angezeigt` };
  }
  const v = vergleicheCover(coverRoh, anker.url);
  if (v.art === "fehlt") {
    return { ...basis, status: "geaendert", ist: null, hinweis: `Der Export nennt kein Cover (${urls === null ? "urls fehlt" : "urls.cover leer"})` };
  }
  if (v.art === "kein_text") return { ...basis, status: "geaendert", ist: null, hinweis: "urls.cover ist kein Text" };
  if (v.art === "unlesbar") return { ...basis, status: "geaendert", ist: null, hinweis: "urls.cover ist keine lesbare Web-Adresse" };
  const ist = anzeigeAdresse(v.adresse);
  const anzeige = ist === null ? "; Adresse mit ungültiger Kodierung, nicht angezeigt" : "";
  // Unverändert nur bei gleichem Ursprung und Pfad, ohne Zugangsdaten und ohne Abfrage (Prüfung 10.11.2026:
  // dass steinadel.de eine Abfrage ignoriert, ist nicht belegt — der Hash gilt nur der Manifest-Adresse).
  // Der Grund nennt den abweichenden Teil und das Soll als volle Adresse (Gegenprüfung PR #8: nur der
  // Dateiname ließ eine Abweichung in Host oder Protokoll wie einen Fehlalarm aussehen).
  if (!v.pfad_gleich) {
    // Ursprung oder Pfad weichen ab, also nennt abweichendeTeile mindestens einen Teil.
    const teile = abweichendeTeile(v.adresse, anker.url).join(", ");
    return { ...basis, status: "geaendert", ist, hinweis: `urls.cover weicht vom Soll ab (${teile}); Soll: ${anker.url}${anzeige}` };
  }
  if (v.zugang) {
    return { ...basis, status: "geaendert", ist, hinweis: "urls.cover enthält Zugangsdaten (Name oder Passwort in der Adresse); angezeigt ohne sie" };
  }
  if (v.abfrage) {
    return {
      ...basis,
      status: "geaendert",
      ist,
      hinweis: "urls.cover trägt eine Abfrage (?…); ob steinadel.de damit dieselbe Datei ausliefert, belegt die Hash-Prüfung nicht",
    };
  }
  return { ...basis, status: "unveraendert", ist, hinweis: v.fragment ? "Adresse mit Fragment (#…); es geht nicht an den Server" : null };
}

/** Export nicht lesbar: der Cover-Abgleich mit Ursache und bereinigtem Grund des Export-Abrufs. */
export function coverFehler(teil: StudioMesswert<never>, manifest: AnkerManifest): CoverErgebnis {
  const anker = coverAnker(manifest);
  return {
    anker_id: anker.id,
    soll: anker.url,
    quelle: QUELLE_COVER,
    gemessen_am: teil.gemessen_am ?? new Date().toISOString(),
    status: "nicht_lesbar",
    ist: null,
    hinweis: teil.hinweis ?? "Export nicht lesbar",
    fehler_art: teil.fehler_art ?? "unbekannt",
  };
}

/** Beides zugleich: Hash-Prüfung aller Manifest-Dateien und Cover-Abgleich im Export (mit der Sitzung der Anfrage). */
export async function pruefeAnker(slug: StudioObjekt, manifest: AnkerManifest, cookie: string): Promise<AnkerAntwort> {
  const [anker, exportCover] = await Promise.all([
    pruefeAnkerDateien(manifest.eintraege),
    leseExport(cookie).then((l) => (l.art === "daten" ? coverAusExport(l.daten, slug, manifest, l.abgerufenAm) : coverFehler(l.teil, manifest))),
  ]);
  return {
    objekt_slug: slug,
    erzeugt_am: new Date().toISOString(),
    manifest_gemessen_am: manifest.gemessen_am,
    anker,
    export_cover: exportCover,
  };
}
