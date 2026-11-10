import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { werteCounselAus } from "@/lib/counsel-urteil";
import { geprueftenTextAusSchritten, maskiereGeschuetzteNamen, pruefeFreigabe } from "@/lib/freigabe-regeln";
import type { FreigabeEintrag, FreigabenAntwort } from "@/lib/status-types";
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
  FREIGABEN_PROBE_SPALTEN,
  freigabenKennung,
  gueltigerFreigabenStand,
  istZaehlung,
  merkeFreigaben,
} from "@/lib/freigaben-cache";
import type { FreigabenAbfrageArt } from "@/lib/freigaben-cache";

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
// (8 s), die volle Abfrage also genau wie vor der Änderungsprobe. Braucht eine Anfrage beide Paare,
// wartet sie bis zu 16 s auf Supabase.
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
  "id, title, platform, status, created_at, updated_at, body, review_notes, metadata->>objekt_slug, metadata->steps";

/** Fehler aus Supabase oder unlesbare Zeilen: 502. Alles andere (Programmfehler): 500. */
class LeseFehler extends Error {}

function zuEintrag(z: unknown, jetztMs: number): FreigabeEintrag {
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
  const pruefung = pruefeFreigabe(werteCounselAus(reviewNotes), textOderNull(z.body), geprueft);
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
    objekt_slug: textOderNull(z.objekt_slug),
    counsel: { urteil: pruefung.urteil, zeile: pruefung.zeile, abgeleitet: true },
    freigabe_sperre: sperre,
    text_leer: text.length === 0,
    text_zeichen: Array.from(text).length,
    geprueft_ungleich_freigabe: geprueft === null || geprueft.trim() !== text,
  };
}

function zuListe(daten: unknown, jetztMs: number): FreigabeEintrag[] {
  if (!Array.isArray(daten)) throw new LeseFehler("Antwort ohne Zeilenliste");
  return daten.map((z) => zuEintrag(z, jetztMs));
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
): FreigabenAntwort {
  return {
    erzeugt_am: new Date().toISOString(),
    wartend: zuListe(wartend, jetztMs),
    wartend_gesamt: wartendGesamt,
    haengend: zuListe(haengend, jetztMs),
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
      const kennung = freigabenKennung(
        { zeilen: probeWartend.data, gesamt: probeWartendGesamt },
        { zeilen: probeHaengend.data, gesamt: probeHaengendGesamt },
      );
      if (kennung === null) throw new LeseFehler("Änderungsprobe: Zeile ohne id oder updated_at");
      if (kennung === stand.kennung) {
        const gemerkt = stapelAntwort(
          stand.wartend.zeilen,
          stand.wartend.gesamt,
          stand.haengend.zeilen,
          stand.haengend.gesamt,
          jetzt.getTime(),
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
    const antwort = stapelAntwort(wartend.data, wartendGesamt, haengend.data, haengendGesamt, jetzt.getTime());
    // Beide Listen sind gelesen (stapelAntwort wirft sonst): Zwischenstand ersetzen, Kennung aus genau
    // diesen Zeilen und Zählungen.
    if (Array.isArray(wartend.data) && Array.isArray(haengend.data)) {
      merkeFreigaben({ zeilen: wartend.data, gesamt: wartendGesamt }, { zeilen: haengend.data, gesamt: haengendGesamt }, vollAm);
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
