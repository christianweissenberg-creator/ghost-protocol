import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { werteCounselAus } from "@/lib/counsel-urteil";
import {
  MEDIUM_ID_UNLESBAR,
  MEDIUM_KEIN_EXPORT,
  geprueftenTextAusSchritten,
  maskiereGeschuetzteNamen,
  mediumIdAus,
  pruefeFreigabe,
  pruefeVideoFreigabe,
} from "@/lib/freigabe-regeln";
import type { MedienSperre } from "@/lib/freigabe-regeln";
import { pruefeMedienFreigabe } from "@/lib/medien-freigabe";
import type { FreigabeEintrag, FreigabeMedium, FreigabenAntwort } from "@/lib/status-types";
import { medienVorgaben } from "@/lib/studio/lesen";
import { KI_PFLICHTZEILE_CAPTION } from "@/lib/studio/ki-hinweis";
import { leseKetten, leseProtokolle } from "@/lib/studio/medien-urteil";
import type { ProtokollLesung } from "@/lib/studio/medien-urteil";
import type { StudioMedium } from "@/lib/studio/typen";
import {
  ABFRAGE_TIMEOUT_MS,
  HAENGEND_AB_MS,
  KEIN_CACHE,
  STATUS_HAENGEND,
  STATUS_WARTEND,
  STUNDE_MS,
  bereinigeFehler,
  haengendOderFilter,
  isoOderNull,
  istObjekt,
  pruefeAntwort,
  textOderNull,
  zaehlung,
} from "@/lib/status-server";
import {
  FREIGABEN_ABFRAGE_HEADER,
  FREIGABEN_FEHLERSTAND_MS,
  FREIGABEN_PROBE_SPALTEN,
  FREIGABEN_VOLL_SPAETESTENS_MS,
  freigabenKennung,
  freigabenMedienIds,
  gueltigerFreigabenStand,
  istZaehlung,
  merkeFreigaben,
} from "@/lib/freigaben-cache";
import type { FreigabenAbfrageArt, FreigabenMedien } from "@/lib/freigaben-cache";

// GET /api/freigaben — Freigabe-Stapel (Objekt-Studio Stufe 1, 05.11.2026).
//
// Liefert nur abgeleitete Felder. body und review_notes verlassen den Server nicht:
// gezeigt werden Länge, Leer-Prüfung, das abgeleitete COUNSEL-Urteil und ob der
// Freigabetext vom geprüften Text abweicht.
//
// Fixrunde 06.11.2026: Je Eintrag steht der Sperrgrund aus pruefeFreigabe()
// (lib/freigabe-regeln.ts) in freigabe_sperre — dieselbe Regel, mit der
// /api/content/status das Freigeben serverseitig sperrt (R4). title und die URTEIL-Zeile
// gehen nur mit maskiertem geschütztem Namen hinaus (R24). geprueft_ungleich_freigabe
// bleibt: body ist weiter die PUBLISHER-Fassung (R2, Entscheidung des Inhabers steht aus).
//
// Paket B, Schritt 5 (10.11.2026, R2/E13 entschieden): Der geprüfte Text kommt aus
// geprueftenTextAusSchritten (lib/freigabe-regeln.ts) — bei Läufen mit COUNSEL-Endprüfung die
// PUBLISHER-Fassung, deren Urteil in review_notes steht, sonst wie bisher der SCRIBE-Text. Neue Zeilen
// tragen damit kein geprueft_ungleich_freigabe mehr. Derselbe Text geht an pruefeFreigabe: Ein
// Freigabetext, den COUNSEL nicht wörtlich geprüft hat, ist gesperrt (Sperrgrund "… (R2)").
//
// Alles oder nichts: scheitert eine der beiden Abfragen, sind beide Listen leer und
// "fehler" ist gesetzt. Eine halbe Liste sähe sonst aus wie "nichts hängt".
//
// Änderungsprobe (Freigabe-Stapel sparsam, 09.11.2026): Jede Anfrage prüft zuerst, ob sich der
// Stapel geändert hat.
// - Hält lib/freigaben-cache.ts einen Zwischenstand, dessen volle Abfrage jünger als 30 min ist
//   (FREIGABEN_VOLL_SPAETESTENS_MS), stellt die Route beide Abfragen mit denselben Filtern (die Grenze
//   für "hängend" je Anfrage neu berechnet), derselben Sortierung, denselben Grenzen und count "exact",
//   aber nur mit id und updated_at. Gleiche Kennung (je Liste Zählung und ids in Reihenfolge samt
//   updated_at): Antwort aus den rohen Zeilen des Zwischenstands, ohne volle Abfrage; die abgeleiteten
//   Felder (alter_stunden, COUNSEL-Urteil, Sperrgrund, Textlänge, Abweichung vom geprüften Text) neu
//   berechnet mit der Uhr dieser Anfrage, erzeugt_am wie bisher (Header x-freigaben-abfrage:
//   unveraendert).
// - Sonst (kein Zwischenstand, abgelaufen, Kennung anders) die volle Abfrage wie bisher; ihr Ergebnis
//   ersetzt den Zwischenstand, mit der Kennung aus den vollen Zeilen und Zählungen (Header
//   x-freigaben-abfrage: voll).
// Ein Eintrag, der die 2-h-Grenze überschreitet, ändert die Probe (neue Grenze je Anfrage) und führt zur
// vollen Abfrage. Was die Kennung nicht erkennt — etwa Schreiben bei abgeschalteten Triggern oder
// Änderungen am Aufbau der Tabelle (lib/content-liste-cache.ts) —, fängt die Höchstdauer von 30 min ab.
// Fehler wie bisher alles oder nichts: Scheitert eine Probe-Abfrage (Lesefehler, Zeitüberschreitung,
// Antwort ohne Zeilenliste, fehlende oder unlesbare Zählung, Zeile ohne id oder updated_at), antwortet
// die Route mit 502 und leeren Listen, nie aus dem Zwischenstand. Scheitert die volle Abfrage, 502 wie
// bisher; der Zwischenstand bleibt, wie er war.
// Zeitlimit: Probe-Paar und volles Paar bekommen je ein eigenes Abbruchsignal mit ABFRAGE_TIMEOUT_MS
// (8 s), die volle Abfrage also genau wie vor der Änderungsprobe. Mit Videos (Schritt 9) gilt für jede weitere
// Abfrage ebenfalls ein eigenes Limit von 8 s, wie bei Studio-Karte und Freigeben (Nachtrag d1-regression-1; das
// gemeinsame Limit aus caption9-6 sperrte im Stapel schon ab etwa 1,6 s je Abfrage, während Karte und Freigeben
// nicht sperrten): die Medienkennung (in der Probe und in der vollen Abfrage), dann die Ketten aller Videos in
// Sammelabfragen (lib/studio/medien-urteil.ts, leseKetten: Medien, Originale, Startbilder — höchstens drei
// Rundreisen, gleich wie viele Videos) und parallel dazu die Prüfprotokolle je Video. Braucht eine Anfrage alles und
// schöpft jede Abfrage ihr Limit aus, wartet sie bis zu 56 s auf Supabase (Probe-Paar, Kennung, volles Paar, Kennung,
// drei Rundreisen), ohne Videos bis zu 16 s — beides unter dem Takt der Abfragen von 60 s. Die Protokolle laufen parallel
// zu den Rundreisen (MP-29 prüft das); ein Abbruch im Browser beendet die Lesung am Server nicht.
//
// Objekt-Studio Schritt 9 (10.11.2026): Eine Zeile mit metadata.medium_id ist die Caption zu einem Video. Ihr
// Sperrgrund kommt aus pruefeVideoFreigabe (lib/freigabe-regeln.ts) — Caption-Regel, Pflichtzeile und Medien-Regel,
// dieselbe Funktion wie beim Freigeben —, und der Eintrag trägt medium (Art, Fassung, Hash, Prüfurteil mit Gründen).
// Die Route liest dazu je Video Kette und Prüfprotokolle (lib/studio/medien-urteil.ts), hasht die Datei aber nicht
// nach; das tut erst „freigeben“. Ein neues Prüfprotokoll erkennt die Änderungsprobe (Medienteil der Kennung,
// lib/freigaben-cache.ts).
// Nachbesserung caption9-1: Die volle Abfrage bildet die Medienkennung VOR den Medien-Lesungen, der Reihe nach — die
// Kennung ist so nie jünger als die gelesenen Daten (kommt dazwischen ein Protokoll, ändert die nächste Probe die
// Kennung, und die Route liest neu). Scheitert die Lesung eines Videos, nennt die Antwort den Grund, und der Stand
// gilt nur FREIGABEN_FEHLERSTAND_MS (90 s) statt 30 min (Nachtrag d1-regression-2, 90 s seit d2-stapel-3): Im 60-s-Takt
// liest spätestens der zweite Abruf nach dem Fehler voll, sichtbar bleibt er also bis rund 2 min; ein dauerhafter Fehler
// kostet höchstens eine volle Abfrage je 90 s. Beides gilt für nacheinander laufende Anfragen; überlappende (zwei Tabs)
// lesen beide voll, gebündelt wird nicht (kein Single-Flight, Nachtrag d2-stapel-2). Vorher las jede Anfrage voll.
//
// Segment-Config wie /api/status (geprüft in node_modules/next/dist/docs/01-app/):
// nie statisch, jeder Abruf liest neu. Die Datei exportiert nur GET und die Segment-Config;
// Zwischenstand und Kennung liegen in lib/freigaben-cache.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WARTEND_HOECHSTENS = 100;
const HAENGEND_HOECHSTENS = 50;

const QUELLE =
  "Supabase · content (zur_freigabe; entwurf/counsel_geprueft ohne Änderung seit mehr als 2 h; COUNSEL-Urteil aus review_notes abgeleitet; Sperrgrund nach derselben Regel wie beim Freigeben)";

// Nur die benötigten JSON-Pfade statt der ganzen metadata (dort liegen zusätzlich
// amplifier_empfehlung u. a.). metadata->steps als Ganzes statt eines Array-Index-Pfads:
// der einfache Schlüsselpfad ist in PostgREST sicher unterstützt. Spaltenschlüssel in der
// Antwort: objekt_slug, steps.
const SPALTEN =
  "id, title, platform, status, created_at, updated_at, body, review_notes, metadata->>objekt_slug, metadata->steps, metadata->medium_id";

/** Gelesenes Video einer Caption: Kette und Prüfprotokolle (jüngstes zuerst), oder warum nicht. */
type MedienLesung =
  | { art: "ok"; export: StudioMedium; original: StudioMedium | null; startbild: StudioMedium | null; protokolle: ProtokollLesung }
  | { art: "fehlt" }
  | { art: "fehler"; grund: string };

/**
 * Kette und Protokolle aller Videos der Listen (höchstens FREIGABEN_MEDIEN_HOECHSTENS), je id: die Ketten in
 * Sammelabfragen (leseKetten), die Protokolle je Video parallel dazu (leseProtokolle wie beim Freigeben), jede Abfrage
 * mit eigenem Zeitlimit. Kette und Protokoll-Lesung bleiben getrennt (Nachtrag d2-stapel-4): medienUrteil prüft wie
 * das Freigeben erst gefunden, Objekt und Fassung, dann einen Lesefehler der Protokolle.
 */
async function leseMedien(client: ReturnType<typeof createServiceClient>, ids: number[]): Promise<Map<number, MedienLesung>> {
  const [ketten, protokolle] = await Promise.all([leseKetten(client, ids), Promise.all(ids.map((id) => leseProtokolle(client, id)))]);
  return new Map(
    ids.map((id, i): [number, MedienLesung] => {
      const k = ketten.get(id) ?? { art: "fehler", grund: "Kette nicht gelesen" };
      return [id, k.art === "ok" ? { ...k, protokolle: protokolle[i] } : k];
    }),
  );
}

/**
 * Medienteil der Kennung: die ids und für ihre Prüfprotokolle die exakte Zählung und die höchste id ("" ohne Videos).
 * Protokolle werden nur angehängt, Medien-Zeilen nie geändert: Ein neues Protokoll ändert Zählung und höchste id.
 * Eigenes Zeitlimit von 8 s (Nachtrag d1-regression-1); ohne Videos keine Abfrage und kein Signal.
 */
async function medienKennung(client: ReturnType<typeof createServiceClient>, ids: number[]): Promise<string> {
  if (ids.length === 0) return "";
  const r = await client
    .from("studio_pruefung")
    .select("id", { count: "exact" })
    .in("medium_id", ids)
    .order("id", { ascending: false })
    .limit(1)
    .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
  if (r.error) throw new LeseFehler(`Prüfprotokolle: ${bereinigeFehler(r.error)}`);
  if (!istZaehlung(r.count)) throw new LeseFehler("Prüfprotokolle: Zählung unlesbar");
  const erste: unknown = Array.isArray(r.data) ? r.data[0] : undefined;
  const hoechste = istObjekt(erste) && typeof erste.id === "number" ? erste.id : null;
  return JSON.stringify([ids, r.count, hoechste]);
}

/**
 * Video eines Eintrags und das Urteil der Medien-Regel (ohne Nachhashen); sperre null = nicht ermittelt. id null = gesetzt,
 * aber unlesbar. Gründe und Reihenfolge wie beim Freigeben (mediumZurFreigabe): nicht gefunden, fremdes Objekt, kein Export.
 */
function medienUrteil(id: number | null, slug: string | null, medien: ReadonlyMap<number, MedienLesung>): { medium: FreigabeMedium; sperre: MedienSperre | null } {
  const leer = { id, art: null, fassung: null, sha256: null, pruefung_id: null };
  const gesperrt = (grund: string) => ({ medium: { ...leer, freigebbar: false, gruende: [grund] }, sperre: { freigebbar: false, gruende: [grund] } });
  if (id === null) return gesperrt(MEDIUM_ID_UNLESBAR);
  const l = medien.get(id);
  if (l === undefined) return { medium: { ...leer, freigebbar: false, gruende: ["Urteil der Medien-Regel nicht ermittelt"] }, sperre: null };
  if (l.art === "fehlt") return gesperrt(`Medium ${id} nicht gefunden`);
  if (l.art === "fehler") return gesperrt(`Medium ${id} nicht lesbar: ${l.grund}`);
  const basis = { id, art: l.export.art, fassung: l.export.fassung, sha256: l.export.sha256 };
  if (slug === null || l.export.objekt_slug !== slug) {
    const grund = `Medium ${id} gehört nicht zum Objekt dieser Zeile`;
    return { medium: { ...basis, pruefung_id: null, freigebbar: false, gruende: [grund] }, sperre: { freigebbar: false, gruende: [grund] } };
  }
  if (l.export.fassung !== "export") {
    return { medium: { ...basis, pruefung_id: null, freigebbar: false, gruende: [MEDIUM_KEIN_EXPORT] }, sperre: { freigebbar: false, gruende: [MEDIUM_KEIN_EXPORT] } };
  }
  // Erst nach Objekt und Fassung, wie beim Freigeben (Nachtrag d2-stapel-4): ein Lesefehler der Protokolle.
  if (l.protokolle.art === "fehler") {
    const grund = `Medium ${id} nicht lesbar: ${l.protokolle.grund}`;
    return { medium: { ...basis, pruefung_id: null, freigebbar: false, gruende: [grund] }, sperre: { freigebbar: false, gruende: [grund] } };
  }
  const r = pruefeMedienFreigabe({ export: l.export, original: l.original, startbild: l.startbild }, l.protokolle.pruefungen, medienVorgaben(l.export.objekt_slug));
  return { medium: { ...basis, pruefung_id: r.pruefung_id, freigebbar: r.freigebbar, gruende: r.gruende }, sperre: { freigebbar: r.freigebbar, gruende: r.gruende } };
}

const KEINE_MEDIEN: ReadonlyMap<number, MedienLesung> = new Map();

/** Fehler aus Supabase oder unlesbare Zeilen: 502. Alles andere (Programmfehler): 500. */
class LeseFehler extends Error {}

function zuEintrag(z: unknown, jetztMs: number, medien: ReadonlyMap<number, MedienLesung>): FreigabeEintrag {
  if (!istObjekt(z)) throw new LeseFehler("unerwartete Zeilenform");
  const id = z.id;
  if (typeof id !== "number" && typeof id !== "string") throw new LeseFehler("Eintrag ohne id");

  // created_at ist DEFAULT NOW(); fehlt es, wird nicht geraten — der Stapel gilt als nicht lesbar.
  const erstellt = isoOderNull(z.created_at);
  if (!erstellt) throw new LeseFehler(`Eintrag ${id} ohne lesbares created_at`);
  const geaendert = isoOderNull(z.updated_at);
  const basisMs = Date.parse(geaendert ?? erstellt);
  const alterStunden = Math.round(((jetztMs - basisMs) / STUNDE_MS) * 10) / 10;

  // Zeichen = Unicode-Codepunkte des getrimmten body, damit gilt: text_leer ⇔ text_zeichen === 0.
  const text = (textOderNull(z.body) ?? "").trim();

  // Text, dem das COUNSEL-Urteil (review_notes) gilt (Paket B, R2): mit Endprüfung die
  // PUBLISHER-Fassung, sonst metadata.steps[1] (SCRIBE). Fehlt er, gilt der Freigabetext als
  // ungeprüft (fail-closed).
  const reviewNotes = textOderNull(z.review_notes);
  const geprueft = geprueftenTextAusSchritten(z.steps, reviewNotes);

  // Urteil und Sperre mit derselben Regel wie der Server beim Freigeben (content/status).
  // pruefung.zeile ist bereits maskiert.
  const status = String(z.status);
  const counsel = werteCounselAus(reviewNotes);
  const objektSlug = textOderNull(z.objekt_slug);
  // Schritt 9: Caption zu einem Video — eine Prüfung für Caption und Medium (wie beim Freigeben, ohne Nachhashen).
  const m = mediumIdAus(z.medium_id);
  const video = m.video ? medienUrteil(m.id, objektSlug, medien) : null;
  const pruefung =
    video === null
      ? pruefeFreigabe(counsel, textOderNull(z.body), geprueft)
      : pruefeVideoFreigabe(counsel, textOderNull(z.body), geprueft, video.sperre, KI_PFLICHTZEILE_CAPTION);
  // Fail-closed: null heißt "serverseitig freigebbar" — das gilt nur im Status zur_freigabe.
  const sperre =
    pruefung.grund ?? (status === STATUS_WARTEND ? null : `Status "${status}" — freigebbar ist nur "${STATUS_WARTEND}"`);
  const titel = textOderNull(z.title);

  return {
    id: String(id),
    title: titel === null ? null : maskiereGeschuetzteNamen(titel),
    platform: textOderNull(z.platform),
    status,
    created_at: erstellt,
    updated_at: geaendert,
    alter_stunden: alterStunden,
    objekt_slug: objektSlug,
    counsel: { urteil: pruefung.urteil, zeile: pruefung.zeile, abgeleitet: true },
    medium: video === null ? null : video.medium,
    freigabe_sperre: sperre,
    text_leer: text.length === 0,
    text_zeichen: Array.from(text).length,
    geprueft_ungleich_freigabe: geprueft === null || geprueft.trim() !== text,
  };
}

function zuListe(daten: unknown, jetztMs: number, medien: ReadonlyMap<number, MedienLesung>): FreigabeEintrag[] {
  if (!Array.isArray(daten)) throw new LeseFehler("Antwort ohne Zeilenliste");
  return daten.map((z) => zuEintrag(z, jetztMs, medien));
}

function fehlerAntwort(fehler: string): FreigabenAntwort {
  return {
    erzeugt_am: new Date().toISOString(),
    wartend: [],
    wartend_gesamt: 0,
    haengend: [],
    haengend_gesamt: 0,
    quelle: QUELLE,
    fehler,
  };
}

/** Antwort aus rohen Zeilen und Zählungen beider Listen (volle Abfrage oder Zwischenstand); abgeleitete Felder mit jetztMs. */
function stapelAntwort(
  wartend: unknown,
  wartendGesamt: number,
  haengend: unknown,
  haengendGesamt: number,
  jetztMs: number,
  medien: ReadonlyMap<number, MedienLesung> = KEINE_MEDIEN,
): FreigabenAntwort {
  return {
    erzeugt_am: new Date().toISOString(),
    wartend: zuListe(wartend, jetztMs, medien),
    wartend_gesamt: wartendGesamt,
    haengend: zuListe(haengend, jetztMs, medien),
    haengend_gesamt: haengendGesamt,
    quelle: QUELLE,
    fehler: null,
  };
}

/** Antwort 200 mit Diagnose-Header: nur Probe (unveraendert) oder volle Abfrage (voll). */
function stapel200(antwort: FreigabenAntwort, art: FreigabenAbfrageArt) {
  return NextResponse.json(antwort, { headers: { ...KEIN_CACHE, [FREIGABEN_ABFRAGE_HEADER]: art } });
}

/** Zählungen eines Abfrage-Paars; Lesefehler oder fehlende Zählung → LeseFehler (502). */
function zaehlungenAus(
  a: { error: { message: string } | null; count: number | null },
  b: { error: { message: string } | null; count: number | null },
): [number, number] {
  try {
    pruefeAntwort(a);
    pruefeAntwort(b);
    return [zaehlung(a), zaehlung(b)];
  } catch (e) {
    throw new LeseFehler(bereinigeFehler(e));
  }
}

export async function GET() {
  const jetzt = new Date();
  try {
    let client: ReturnType<typeof createServiceClient>;
    try {
      client = createServiceClient();
    } catch (e) {
      throw new LeseFehler(bereinigeFehler(e));
    }

    const grenze = new Date(jetzt.getTime() - HAENGEND_AB_MS).toISOString();

    // Änderungsprobe. Der Zwischenstand wird einmal gelesen, vor der Probe: Eine gleichzeitige Anfrage
    // kann ihn während der Probe ersetzen, auch durch einen älteren. Geantwortet wird mit genau dem Stand,
    // gegen den die Probe verglichen hat.
    const stand = gueltigerFreigabenStand(jetzt.getTime());
    if (stand !== null) {
      const probeSignal = AbortSignal.timeout(ABFRAGE_TIMEOUT_MS);
      const [probeWartend, probeHaengend] = await Promise.all([
        client
          .from("content")
          .select(FREIGABEN_PROBE_SPALTEN, { count: "exact" })
          .eq("status", STATUS_WARTEND)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(WARTEND_HOECHSTENS)
          .abortSignal(probeSignal),
        client
          .from("content")
          .select(FREIGABEN_PROBE_SPALTEN, { count: "exact" })
          .in("status", [...STATUS_HAENGEND])
          .or(haengendOderFilter(grenze))
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(HAENGEND_HOECHSTENS)
          .abortSignal(probeSignal),
      ]);
      const [probeWartendGesamt, probeHaengendGesamt] = zaehlungenAus(probeWartend, probeHaengend);
      if (!Array.isArray(probeWartend.data) || !Array.isArray(probeHaengend.data)) {
        throw new LeseFehler("Änderungsprobe: Antwort ohne Zeilenliste");
      }
      if (!istZaehlung(probeWartendGesamt) || !istZaehlung(probeHaengendGesamt)) {
        throw new LeseFehler("Änderungsprobe: Zählung unlesbar");
      }
      // Die Medienkennung mit eigenem Zeitlimit, nach dem Probe-Paar (Nachtrag d1-regression-1).
      const probeMedien = await medienKennung(client, freigabenMedienIds(probeWartend.data, probeHaengend.data));
      const kennung = freigabenKennung(
        { zeilen: probeWartend.data, gesamt: probeWartendGesamt },
        { zeilen: probeHaengend.data, gesamt: probeHaengendGesamt },
        probeMedien,
      );
      if (kennung === null) throw new LeseFehler("Änderungsprobe: Zeile ohne id oder updated_at");
      if (kennung === stand.kennung) {
        const gemerkt = stapelAntwort(
          stand.wartend.zeilen,
          stand.wartend.gesamt,
          stand.haengend.zeilen,
          stand.haengend.gesamt,
          jetzt.getTime(),
          (stand.medien.daten as ReadonlyMap<number, MedienLesung> | null) ?? KEINE_MEDIEN,
        );
        return stapel200(gemerkt, "unveraendert");
      }
    }

    // Volle Abfrage wie vor der Änderungsprobe, mit eigenem Zeitlimit.
    const vollAm = Date.now();
    const signal = AbortSignal.timeout(ABFRAGE_TIMEOUT_MS);

    // Dieselben Filter wie die Freigabe-Kachel in /api/status (lib/status-server.ts).
    const [wartend, haengend] = await Promise.all([
      client
        .from("content")
        .select(SPALTEN, { count: "exact" })
        .eq("status", STATUS_WARTEND)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(WARTEND_HOECHSTENS)
        .abortSignal(signal),
      client
        .from("content")
        .select(SPALTEN, { count: "exact" })
        .in("status", [...STATUS_HAENGEND])
        .or(haengendOderFilter(grenze))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(HAENGEND_HOECHSTENS)
        .abortSignal(signal),
    ]);

    const [wartendGesamt, haengendGesamt] = zaehlungenAus(wartend, haengend);
    // Schritt 9: Videos der Captions lesen (Kette und Protokolle) und den Medienteil der Kennung bilden.
    const ids = freigabenMedienIds(Array.isArray(wartend.data) ? wartend.data : [], Array.isArray(haengend.data) ? haengend.data : []);
    // Ohne Videos keine weitere Abfrage (wie vor Schritt 9). Mit Videos (Nachbesserung caption9-1): erst die Kennung,
    // dann die Daten, der Reihe nach; jede Abfrage mit eigenem Zeitlimit (Nachtrag d1-regression-1).
    let medien: ReadonlyMap<number, MedienLesung> = KEINE_MEDIEN;
    let kennungMedien = "";
    if (ids.length > 0) {
      kennungMedien = await medienKennung(client, ids);
      medien = await leseMedien(client, ids);
    }
    const antwort = stapelAntwort(wartend.data, wartendGesamt, haengend.data, haengendGesamt, jetzt.getTime(), medien);
    // Beide Listen sind gelesen (stapelAntwort wirft sonst): Zwischenstand ersetzen, Kennung aus genau
    // diesen Zeilen und Zählungen und dem Medienteil. Mit dem Lesefehler eines Videos gilt der Stand nur 90 s
    // (Nachtrag d1-regression-2 und d2-stapel-3; caption9-1 merkte ihn gar nicht, dann las jede Anfrage voll).
    if (Array.isArray(wartend.data) && Array.isArray(haengend.data)) {
      const mitLesefehler = [...medien.values()].some((l) => l.art === "fehler" || (l.art === "ok" && l.protokolle.art === "fehler"));
      const medienStand: FreigabenMedien = { kennung: kennungMedien, daten: medien };
      merkeFreigaben(
        { zeilen: wartend.data, gesamt: wartendGesamt },
        { zeilen: haengend.data, gesamt: haengendGesamt },
        vollAm,
        medienStand,
        mitLesefehler ? FREIGABEN_FEHLERSTAND_MS : FREIGABEN_VOLL_SPAETESTENS_MS,
      );
    }
    return stapel200(antwort, "voll");
  } catch (e) {
    const lesefehler = e instanceof LeseFehler;
    const grund = lesefehler ? e.message : bereinigeFehler(e);
    return NextResponse.json(
      fehlerAntwort(lesefehler ? `Supabase nicht lesbar: ${grund}` : `Freigaben nicht ermittelbar: ${grund}`),
      { status: lesefehler ? 502 : 500, headers: KEIN_CACHE }
    );
  }
}
