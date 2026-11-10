import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ABFRAGE_TIMEOUT_MS, KEIN_CACHE, bereinigeFehler, istZeitueberschreitung, pruefeAnfrageHerkunft } from "@/lib/status-server";
import { ankerManifest } from "@/lib/studio/anker";
import { MEDIUM_SPALTEN } from "@/lib/studio/lesen";
import {
  MEDIEN_ROLLEN,
  abweichendeFelder,
  arbeitPfad,
  belegHash,
  einfuegeFelder,
  inhaltsPfad,
  istObjekt,
  kanonisch,
  leseZwischenPfad,
  planeZeilen,
  pruefeBeleg,
  rezeptImAnker,
  sha256Text,
  vorschauHash,
  vorschauUnterschiede,
} from "@/lib/studio/medien";
import type { Beleg, VorschauZeile, ZeilenFelder } from "@/lib/studio/medien";
import { ablage, belegeSperre, medienClient, leseDatei, leseJsonKoerper, loescheZwischen, raeumeAuf, rss, speicherMessung, verschiebe } from "@/lib/studio/medien-ablage";
import type { Ablage } from "@/lib/studio/medien-ablage";
import {
  MedienAbbruch,
  abweisung,
  alsAbweisung,
  dateiMessen,
  exportCoverPruefen,
  geprueftenAnkerLaden,
  studioSlug,
  zulaessigerAnker,
} from "@/lib/studio/medien-ablauf";
import type { GemesseneDatei } from "@/lib/studio/medien-ablauf";
import { gleicheStartbildAb } from "@/lib/studio/startbild";
import type { MedienRolle } from "@/lib/studio/typen";

// POST /api/studio/[objekt]/medien — Prüflauf und Einspielen eines Videos (Objekt-Studio Schritt 7, 10.11.2026).
//
// Eingabe (JSON bis 1 MB): {eingang: {startbild, original, export}, beleg} und genau eines von
// - nur_pruefen: true — Prüflauf: liest die Dateien im Eingang, legt weder Zeilen noch Inhaltsdateien an (gelöscht
//   werden nur Reste und bei einem Fehler die eigenen Uploads, Schritt 2) und antwortet mit den drei Zeilen genau so,
//   wie sie eingefügt würden (vorschau), dem Startbild-Abgleich und vorschau_sha256;
// - bestaetigt: <vorschau_sha256> (dazu vorschau: die bestätigten Zeilen, nur für die Feldliste einer Abweichung) —
//   Einspielen: dieselben Prüfungen am Arbeitsort; weicht die neue Vorschau ab, 409 „Vorschau veraltet“.
// Ablauf:
// 1. Herkunft (403/415, vor dem Lesen), Objekt (400/404), Körper (413/400), Beleg und Modus (400), Anker aus dem
//    Manifest mit Rezept im Anker (400).
// 2. Prozess-Sperre (409 „läuft schon seit …“). Danach räumt die Route Reste älter als 2 h unter eingang/ und arbeit/
//    auf (nie die eigenen Dateien) und löscht bei jedem späteren Fehler ihre eigenen Dateien dort.
// 3. Anker live laden und gegen das Manifest hashen (409/502); urls.cover im Export zeigt weiter auf den Cover-Anker
//    (409/502).
// 4. Je Datei in der Reihenfolge Startbild, Original, Export: beim Einspielen zuerst move eingang/ → arbeit/ (dorthin
//    hat kein Upload-Token Zugriff), dann am neuen Ort gestreamt messen; Signatur (415), Hash gleich dem Beleg (409).
// 5. Startbild-Abgleich mit sharp; ein nicht bestandener Abgleich weist nicht ab.
// 6. Einspielen: Bestehen Zeilen zu diesen Hashes schon, muss jede der geplanten gleichen (Kette eingeschlossen), sonst
//    409 mit Feldliste — nichts verschoben, nichts eingefügt. Dann move arbeit/ → <slug>/<sha256>.<endung> (nie
//    upsert). Liegt dort schon eine Datei, wird sie
//    gestreamt gehasht: gleich → weiter (die Arbeitsdatei wird gelöscht), abweichend → 409.
// 7. Zeilen einfügen Startbild → Original → Export, ohne id und DB-Uhr (die setzt der Trigger), ohne upsert. Bei 23505
//    wird die vorhandene Zeile (per sha256) mit der geplanten verglichen: gleich → weiterverwendet, sonst 409 mit
//    Feldliste. Bestehen alle drei schon gleich: 409 „vorhanden“ mit den ids. Drei Inserts sind drei Transaktionen;
//    ein Teilstand wird beim nächsten Aufruf mit gleichem Beleg fortgesetzt.
// Jede Antwort mit Dateiarbeit nennt speicher (RSS vorher/nachher, maxRSS des Prozesses).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Modus = { art: "pruefen" } | { art: "einspielen"; bestaetigt: string; vorschau: unknown };

interface Anfrage {
  eingang: Record<MedienRolle, string>;
  beleg: Beleg;
  modus: Modus;
}

const HEX64 = /^[0-9a-f]{64}$/;

function leseAnfrage(roh: unknown): Anfrage {
  if (!istObjekt(roh)) throw new MedienAbbruch(400, "eingabe", "Anfrage muss ein JSON-Objekt sein");
  const unbekannt = Object.keys(roh).find((k) => !["eingang", "beleg", "nur_pruefen", "bestaetigt", "vorschau"].includes(k));
  if (unbekannt !== undefined) throw new MedienAbbruch(400, "eingabe", `Anfrage: unbekanntes Feld ${unbekannt}`);
  const e = roh.eingang;
  if (!istObjekt(e) || Object.keys(e).length !== 3) throw new MedienAbbruch(400, "eingabe", "eingang: {startbild, original, export}");
  const eingang = {} as Record<MedienRolle, string>;
  for (const rolle of MEDIEN_ROLLEN) {
    const z = leseZwischenPfad(e[rolle]);
    const passt = z !== null && z.bereich === "eingang" && (rolle === "startbild" ? z.mime !== "video/mp4" : z.mime === "video/mp4");
    if (!passt) throw new MedienAbbruch(400, "eingabe", `eingang.${rolle}: Pfad eingang/<uuid>.${rolle === "startbild" ? "png oder .jpg" : "mp4"} aus der Upload-URL`);
    eingang[rolle] = e[rolle] as string;
  }
  if (new Set(Object.values(eingang)).size !== 3) throw new MedienAbbruch(400, "eingabe", "eingang: drei verschiedene Dateien");
  const beleg = pruefeBeleg(roh.beleg);
  if (!beleg.ok) throw new MedienAbbruch(400, "eingabe", beleg.grund);
  const pruefen = roh.nur_pruefen === true;
  const bestaetigt = roh.bestaetigt;
  if (pruefen === (bestaetigt !== undefined) || (roh.nur_pruefen !== undefined && !pruefen)) {
    throw new MedienAbbruch(400, "eingabe", "genau eines von nur_pruefen: true oder bestaetigt: <vorschau_sha256>");
  }
  if (pruefen) {
    if (roh.vorschau !== undefined) throw new MedienAbbruch(400, "eingabe", "vorschau nur zusammen mit bestaetigt");
    return { eingang, beleg: beleg.wert, modus: { art: "pruefen" } };
  }
  if (typeof bestaetigt !== "string" || !HEX64.test(bestaetigt)) throw new MedienAbbruch(400, "eingabe", "bestaetigt: vorschau_sha256 des Prüflaufs (64 Hex-Zeichen)");
  return { eingang, beleg: beleg.wert, modus: { art: "einspielen", bestaetigt, vorschau: roh.vorschau } };
}

/** Datei auf einen neuen Pfad verschieben; fehlt die Quelle: 404, sonst Storage-Fehler 502. */
async function verschiebeOderAbbruch(a: Ablage, von: string, nach: string, rolle: MedienRolle): Promise<void> {
  const v = await verschiebe(a, von, nach);
  if (v.art === "fehlt") throw new MedienAbbruch(404, "nicht_gefunden", `${rolle}: Datei nicht im Bucket (${von})`);
  if (v.art === "fehler") throw new MedienAbbruch(502, "quelle", `${rolle}: Verschieben fehlgeschlagen: ${bereinigeFehler(v.grund)}`);
}

/**
 * Datei auf ihren Inhalts-Pfad bringen. Liegt dort schon eine Datei, wird sie gestreamt gehasht: gleich → die
 * Arbeitsdatei wird gelöscht, abweichend → 409. Sonst move (überschreibt nie).
 */
async function aufInhaltsPfad(a: Ablage, m: GemesseneDatei, ziel: string, rolle: MedienRolle): Promise<void> {
  const da = await leseDatei(a, ziel, { maxBytes: m.bytes });
  if (da.art === "ok") {
    if (da.sha256 !== m.sha256 || da.bytes !== m.bytes) throw new MedienAbbruch(409, "zustand", `${rolle}: unter ${ziel} liegt eine andere Datei`);
    const weg = await loescheZwischen(a, [m.pfad]);
    if (weg.fehler !== null) throw new MedienAbbruch(502, "quelle", `${rolle}: Arbeitsdatei nicht gelöscht: ${bereinigeFehler(weg.fehler)}`);
    return;
  }
  if (da.art === "zu_gross") throw new MedienAbbruch(409, "zustand", `${rolle}: unter ${ziel} liegt eine andere, größere Datei`);
  if (da.art === "fehler") throw new MedienAbbruch(502, "quelle", `${rolle}: Inhalts-Pfad nicht lesbar: ${bereinigeFehler(da.grund)}`);
  await verschiebeOderAbbruch(a, m.pfad, ziel, rolle);
}

/** Platzhalter-id einer Zeile, die erst eingefügt würde: passt zu keiner vorhandenen id. */
const NEUE_ZEILE = -1;

/**
 * Vor dem ersten Schreiben: Bestehen schon Zeilen mit den SHA-256 dieses Belegs, muss jede der geplanten Zeile gleichen,
 * die Kette eingeschlossen (startbild_id und abgeleitet_von aus den ids der vorhandenen Zeilen; eine neue Zeile passt zu
 * keiner). Sonst 409 mit allen abweichenden Feldern, bevor eine Datei auf ihren Inhalts-Pfad kommt oder eine Zeile
 * eingefügt wird (Review-Befund 4, 10.11.2026). Vorher fiel ein Konflikt erst beim Einfügen der jeweiligen Zeile auf:
 * Ein neu kodiertes Startbild zu einem schon eingespielten Video wurde noch als neue, unveränderliche Zeile eingefügt,
 * dann scheiterte das Original — ein Teilstand, der sich nie fortsetzen ließ.
 */
async function vorhandeneZeilenPruefen(client: ReturnType<typeof createServiceClient>, zeilen: VorschauZeile[]): Promise<void> {
  const r = await client
    .from("studio_medium")
    .select(MEDIUM_SPALTEN)
    .in("sha256", zeilen.map((z) => z.felder.sha256 as string))
    .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
  if (r.error) throw new MedienAbbruch(502, "quelle", `Vorhandene Zeilen nicht lesbar: ${bereinigeFehler(r.error)}`);
  const jeHash = new Map<string, Record<string, unknown>>();
  for (const z of Array.isArray(r.data) ? (r.data as unknown[]) : []) {
    if (istObjekt(z) && typeof z.sha256 === "string") jeHash.set(z.sha256, z);
  }
  const ids = { startbild: NEUE_ZEILE, original: NEUE_ZEILE };
  const felder: string[] = [];
  for (const z of zeilen) {
    const da = jeHash.get(z.felder.sha256 as string);
    if (da === undefined) continue;
    felder.push(...abweichendeFelder(einfuegeFelder(z, ids), da).map((f) => `${z.rolle}.${f}`));
    if (z.rolle !== "export") ids[z.rolle] = typeof da.id === "number" && Number.isSafeInteger(da.id) ? da.id : NEUE_ZEILE;
  }
  if (felder.length > 0) {
    throw new MedienAbbruch(409, "zustand", "Zeilen zu diesen Dateien bestehen schon mit abweichenden Feldern — nichts verschoben, nichts eingefügt", { felder });
  }
}

/**
 * Zeile einfügen (ohne upsert); bei 23505 die vorhandene Zeile vergleichen und nur bei vollständiger Gleichheit
 * weiterverwenden. Nach der Vorprüfung (vorhandeneZeilenPruefen) trifft 23505 nur noch eine Zeile, die in der
 * Zwischenzeit entstand.
 */
async function fuegeEin(client: ReturnType<typeof createServiceClient>, rolle: MedienRolle, felder: ZeilenFelder): Promise<{ id: number; wiederverwendet: boolean }> {
  let res: { data: unknown; error: { code?: string; message: string } | null };
  try {
    res = await client.from("studio_medium").insert(felder).select("id").abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS)).single();
  } catch (e) {
    const unbekannt = istZeitueberschreitung(e) ? " — Ausgang unbekannt; erneutes Einspielen mit gleichem Beleg setzt fort" : "";
    throw new MedienAbbruch(500, "schreibfehler", `Einfügen ${rolle} fehlgeschlagen: ${bereinigeFehler(e)}${unbekannt}`);
  }
  if (!res.error) {
    const id = istObjekt(res.data) ? res.data.id : undefined;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) throw new MedienAbbruch(500, "schreibfehler", `Einfügen ${rolle}: Antwort ohne id`);
    return { id, wiederverwendet: false };
  }
  // postgrest-js wirft beim Abbruch nicht, es liefert ihn als error (Review-Befund 5): Die Zeile kann trotzdem stehen.
  if (istZeitueberschreitung(res.error)) {
    throw new MedienAbbruch(500, "schreibfehler", `Einfügen ${rolle} fehlgeschlagen: ${bereinigeFehler(res.error)} — Ausgang unbekannt; erneutes Einspielen mit gleichem Beleg setzt fort`);
  }
  if (res.error.code !== "23505") throw new MedienAbbruch(500, "schreibfehler", `Einfügen ${rolle} fehlgeschlagen: ${bereinigeFehler(res.error)}`);
  const vorhanden = await client
    .from("studio_medium")
    .select(MEDIUM_SPALTEN)
    .eq("sha256", felder.sha256 as string)
    .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS))
    .maybeSingle();
  if (vorhanden.error || !istObjekt(vorhanden.data)) {
    throw new MedienAbbruch(502, "quelle", `${rolle}: vorhandene Zeile nicht lesbar: ${bereinigeFehler(vorhanden.error ?? "keine Zeile zum Hash")}`);
  }
  const id = vorhanden.data.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id)) throw new MedienAbbruch(502, "quelle", `${rolle}: vorhandene Zeile ohne lesbare id`);
  const felderListe = abweichendeFelder(felder, vorhanden.data);
  if (felderListe.length > 0) {
    throw new MedienAbbruch(409, "zustand", `${rolle}: Zeile ${id} besteht schon mit abweichenden Feldern — nicht weiterverwendet`, {
      felder: felderListe.map((f) => `${rolle}.${f}`),
    });
  }
  return { id, wiederverwendet: true };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ objekt: string }> }) {
  let freigeben: (() => void) | null = null;
  let a: Ablage | null = null;
  /** Eigene Dateien unter eingang/ und arbeit/, die bei einem Fehler gelöscht werden. */
  const eigene = new Set<string>();
  /** Für den Fehlertext: Prüflauf oder Einspielen (Nachbesserung sicherheit-2; vorher immer „Einspielen“). */
  let wobei = "Prüflauf oder Einspielen nicht möglich";
  try {
    const herkunft = pruefeAnfrageHerkunft(request.headers);
    if (herkunft) return abweisung(herkunft.status, herkunft.fehler, "herkunft");
    const slug = studioSlug((await params).objekt);
    const koerper = await leseJsonKoerper(request);
    if (koerper.art === "zu_gross") throw new MedienAbbruch(413, "zu_gross", "Anfrage größer als 1 MB");
    if (koerper.art === "ungueltig") throw new MedienAbbruch(400, "eingabe", "Anfrage ist kein gültiges JSON");
    const { eingang, beleg, modus } = leseAnfrage(koerper.wert);
    wobei = modus.art === "einspielen" ? "Einspielen nicht möglich" : "Prüflauf nicht möglich";
    const manifest = ankerManifest(slug);
    if (manifest === null) throw new MedienAbbruch(400, "eingabe", "Für dieses Objekt gibt es kein Anker-Manifest");
    const anker = zulaessigerAnker(manifest, beleg.anker_id);
    const ausserhalb = rezeptImAnker(beleg.ausschnitt, anker);
    if (ausserhalb !== null) throw new MedienAbbruch(400, "eingabe", ausserhalb);

    const sperre = belegeSperre(modus.art);
    if (sperre.art === "belegt") {
      throw new MedienAbbruch(409, "zustand", `Ein Job läuft schon seit ${sperre.laeuft.seit} (${sperre.laeuft.art}) — bitte danach erneut`, { laeuft: sperre.laeuft });
    }
    freigeben = sperre.freigeben;
    const rssVorher = rss();
    let client: ReturnType<typeof createServiceClient>;
    try {
      client = medienClient();
    } catch (e) {
      throw new MedienAbbruch(502, "quelle", `Supabase nicht nutzbar: ${bereinigeFehler(e)}`);
    }
    a = ablage(client);
    for (const rolle of MEDIEN_ROLLEN) eigene.add(eingang[rolle]);
    const aufgeraeumt = await raeumeAuf(a, [...eigene, ...MEDIEN_ROLLEN.map((r) => arbeitPfad(eingang[r]))]);

    const ankerBytes = await geprueftenAnkerLaden(anker);
    await exportCoverPruefen(slug, manifest, request.headers.get("cookie") ?? "");

    const dateien = {} as Record<MedienRolle, GemesseneDatei>;
    for (const rolle of MEDIEN_ROLLEN) {
      let pfad = eingang[rolle];
      if (modus.art === "einspielen") {
        const ziel = arbeitPfad(pfad);
        eigene.add(ziel);
        await verschiebeOderAbbruch(a, pfad, ziel, rolle);
        eigene.delete(pfad);
        pfad = ziel;
      }
      const endung = leseZwischenPfad(pfad);
      if (endung === null) throw new Error("Zwischenpfad unlesbar");
      const m = await dateiMessen(a, pfad, rolle, endung.mime, rolle === "startbild");
      if (m.sha256 !== belegHash(beleg, rolle)) {
        throw new MedienAbbruch(409, "zustand", `${rolle}: SHA-256 der Datei (${m.sha256.slice(0, 16)}…) weicht vom Beleg ab (${belegHash(beleg, rolle).slice(0, 16)}…)`);
      }
      dateien[rolle] = m;
    }

    const startbild = dateien.startbild;
    if (startbild.inhalt === null) throw new Error("Startbild ohne Inhalt");
    const abgleich = await gleicheStartbildAb({ anker: { id: anker.id, sha256: anker.sha256, bytes: ankerBytes }, startbild: startbild.inhalt, ausschnitt: beleg.ausschnitt });
    const zeilen: VorschauZeile[] = planeZeilen({
      slug,
      beleg,
      anker: { id: anker.id, sha256: anker.sha256 },
      startbild: { sha256: startbild.sha256, bytes: startbild.bytes, mime: startbild.mime, breite: abgleich.startbild.breite, hoehe: abgleich.startbild.hoehe },
      original: dateien.original,
      export: dateien.export,
      abgleich,
    });
    const hash = vorschauHash(zeilen);
    const dateiListe = MEDIEN_ROLLEN.map((rolle) => ({ rolle, sha256: dateien[rolle].sha256, bytes: dateien[rolle].bytes, mime: dateien[rolle].mime }));
    const aufraeumen = { geloescht: aufgeraeumt.geloescht, fehler: aufgeraeumt.fehler === null ? null : bereinigeFehler(aufgeraeumt.fehler) };

    if (modus.art === "pruefen") {
      return NextResponse.json(
        { art: "vorschau", objekt_slug: slug, erzeugt_am: new Date().toISOString(), vorschau: zeilen, vorschau_sha256: hash, abgleich, dateien: dateiListe, speicher: speicherMessung(rssVorher), aufgeraeumt: aufraeumen },
        { headers: KEIN_CACHE },
      );
    }

    if (hash !== modus.bestaetigt) {
      const zurPruefung = modus.vorschau !== undefined && sha256Text(kanonisch(modus.vorschau)) === modus.bestaetigt;
      const felder = zurPruefung ? vorschauUnterschiede(modus.vorschau, zeilen) : ["bestätigte Vorschau nicht mitgeschickt oder passt nicht zu bestaetigt"];
      throw new MedienAbbruch(409, "zustand", "Vorschau veraltet: die Zeilen weichen von der bestätigten Vorschau ab — nichts eingefügt", { felder });
    }

    await vorhandeneZeilenPruefen(client, zeilen);
    for (const rolle of MEDIEN_ROLLEN) {
      const m = dateien[rolle];
      await aufInhaltsPfad(a, m, inhaltsPfad(slug, m.sha256, m.mime), rolle);
      eigene.delete(m.pfad);
    }

    const ids: { startbild?: number; original?: number; export?: number } = {};
    const eingefuegt: Array<{ rolle: MedienRolle; id: number; sha256: string; bytes: number; wiederverwendet: boolean }> = [];
    for (const z of zeilen) {
      const r = await fuegeEin(client, z.rolle, einfuegeFelder(z, ids));
      ids[z.rolle] = r.id;
      eingefuegt.push({ rolle: z.rolle, id: r.id, sha256: z.felder.sha256 as string, bytes: z.felder.bytes as number, wiederverwendet: r.wiederverwendet });
    }
    if (eingefuegt.every((z) => z.wiederverwendet)) {
      throw new MedienAbbruch(409, "zustand", "Medium schon vorhanden: alle drei Zeilen bestehen unverändert", {
        vorhanden: { startbild: ids.startbild as number, original: ids.original as number, export: ids.export as number },
      });
    }
    return NextResponse.json(
      { art: "eingespielt", objekt_slug: slug, erzeugt_am: new Date().toISOString(), zeilen: eingefuegt, abgleich, speicher: speicherMessung(rssVorher), aufgeraeumt: aufraeumen },
      { headers: KEIN_CACHE },
    );
  } catch (e) {
    if (a !== null && eigene.size > 0) {
      try {
        await loescheZwischen(a, [...eigene]);
      } catch {
        // Aufräumen ist Nebensache; der Fehler der Route geht vor.
      }
    }
    return alsAbweisung(e, wobei);
  } finally {
    freigeben?.();
  }
}
