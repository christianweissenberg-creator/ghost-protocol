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
//   der Abruf dort ab; sie kann dann nicht die Manifest-Datei sein ("geaendert").
// - Nichts wird abgelegt: Der Hash entsteht beim Lesen, die Bytes werden verworfen.
// - Kein Takt: Geprüft wird nur auf Anfrage (Aufbau des Anker-Panels, „Alle prüfen“).
// - Die Adresse aus urls.cover wird nur verglichen, nie abgerufen.
// Jedes Ergebnis trägt seinen Zeitpunkt. Ein Fehler bei einer Datei betrifft nur ihren Status.

import "server-only";
import { createHash } from "node:crypto";
import { maskiereGeschuetzteNamen } from "../freigabe-regeln";
import { bereinigeFehler, istObjekt, istZeitueberschreitung } from "../status-server";
import { dateiName, istManifestUrl, vergleicheCover } from "./anker";
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

function ergebnis(
  e: AnkerEintrag,
  status: AnkerHashStatus,
  felder: Partial<Pick<AnkerHashErgebnis, "sha256_live" | "bytes_live" | "http_status" | "hinweis" | "gemessen_am">>,
): AnkerHashErgebnis {
  return {
    id: e.id,
    status,
    sha256_soll: e.sha256,
    sha256_live: felder.sha256_live ?? null,
    bytes_soll: e.bytes,
    bytes_live: felder.bytes_live ?? null,
    http_status: felder.http_status ?? null,
    gemessen_am: felder.gemessen_am ?? new Date().toISOString(),
    hinweis: felder.hinweis ?? null,
  };
}

/**
 * Eine Manifest-Datei live laden und ihren SHA-256 mit dem Manifest vergleichen. Netzfehler, Zeitlimit,
 * HTTP-Fehler, Weiterleitung und Abbruch beim Lesen werden zum Status der Datei, nie zur Ausnahme.
 */
export async function pruefeAnkerDatei(e: AnkerEintrag): Promise<AnkerHashErgebnis> {
  const versuchAm = new Date().toISOString();
  if (!istManifestUrl(e.url)) {
    return ergebnis(e, "nicht_erreichbar", {
      gemessen_am: versuchAm,
      hinweis: "Adresse liegt nicht unter https://steinadel.de/objekte/ — nicht abgerufen",
    });
  }
  let res: Response;
  try {
    res = await fetch(e.url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(ANKER_TIMEOUT_MS) });
  } catch (err) {
    return ergebnis(e, "nicht_erreichbar", { gemessen_am: versuchAm, hinweis: abrufGrund(err) });
  }
  if (res.status !== 200) {
    // Verbindung freigeben, ohne den Inhalt zu lesen.
    void res.body?.cancel().catch(() => undefined);
    // In Node liefert redirect "manual" die 3xx-Antwort selbst (gemessen 10.11.2026, Node 25); eine
    // Laufzeit nach Browser-Art gäbe "opaqueredirect" mit Status 0.
    const weiter = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
    const code = res.status === 0 ? null : res.status;
    return ergebnis(e, "nicht_erreichbar", {
      http_status: code,
      hinweis: weiter ? `Weiterleitung${code === null ? "" : ` (HTTP ${code})`} — nicht gefolgt` : `HTTP ${res.status}`,
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
    void leser?.cancel().catch(() => undefined);
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

/** f für jedes Element, höchstens n zugleich; Ergebnisse in der Reihenfolge der Liste. */
export async function mitHoechstens<T, R>(n: number, liste: readonly T[], f: (t: T) => Promise<R>): Promise<R[]> {
  const aus: R[] = new Array<R>(liste.length);
  let naechster = 0;
  const arbeiter = async () => {
    while (naechster < liste.length) {
      const i = naechster++;
      aus[i] = await f(liste[i]);
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

function anzeigeAdresse(adresse: string): string {
  const text = maskiereGeschuetzteNamen(adresse);
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
  const v = vergleicheCover(urls === null ? undefined : urls.cover, anker.url);
  const ziel = dateiName(anker.url);
  if (v.art === "fehlt") {
    return { ...basis, status: "geaendert", ist: null, hinweis: `Der Export nennt kein Cover (${urls === null ? "urls fehlt" : "urls.cover leer"})` };
  }
  if (v.art === "kein_text") return { ...basis, status: "geaendert", ist: null, hinweis: "urls.cover ist kein Text" };
  if (v.art === "unlesbar") return { ...basis, status: "geaendert", ist: null, hinweis: "urls.cover ist keine lesbare Web-Adresse" };
  const zusatz = v.zusatz ? "Adresse mit Zugangsdaten, Abfrage oder Fragment; verglichen wurden Ursprung und Pfad" : null;
  if (v.gleich) return { ...basis, status: "unveraendert", ist: anzeigeAdresse(v.adresse), hinweis: zusatz };
  return {
    ...basis,
    status: "geaendert",
    ist: anzeigeAdresse(v.adresse),
    hinweis: zusatz === null ? `urls.cover zeigt nicht mehr auf ${ziel}` : `urls.cover zeigt nicht mehr auf ${ziel} (${zusatz})`,
  };
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
