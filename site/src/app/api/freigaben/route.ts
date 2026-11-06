import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { werteCounselAus } from "@/lib/counsel-urteil";
import { maskiereGeschuetzteNamen, pruefeFreigabe } from "@/lib/freigabe-regeln";
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
// Alles oder nichts: scheitert eine der beiden Abfragen, sind beide Listen leer und
// "fehler" ist gesetzt. Eine halbe Liste sähe sonst aus wie "nichts hängt".
//
// Segment-Config wie /api/status (geprüft in node_modules/next/dist/docs/01-app/):
// nie statisch, jeder Abruf liest neu.
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

  // metadata.steps[1] ist SCRIBE (Reihenfolge in api/content/pipeline/route.ts); dessen
  // output hat COUNSEL geprüft. Fehlt er, gilt der Freigabetext als ungeprüft (fail-closed).
  const steps: unknown = z.steps;
  const schritt: unknown = Array.isArray(steps) ? steps[1] : undefined;
  const geprueft = istObjekt(schritt) ? textOderNull(schritt.output) : null;

  // Urteil und Sperre mit derselben Regel wie der Server beim Freigeben (content/status).
  // pruefung.zeile ist bereits maskiert.
  const status = String(z.status);
  const pruefung = pruefeFreigabe(werteCounselAus(textOderNull(z.review_notes)), textOderNull(z.body));
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

export async function GET() {
  const jetzt = new Date();
  try {
    let client: ReturnType<typeof createServiceClient>;
    try {
      client = createServiceClient();
    } catch (e) {
      throw new LeseFehler(bereinigeFehler(e));
    }

    const signal = AbortSignal.timeout(ABFRAGE_TIMEOUT_MS);
    const grenze = new Date(jetzt.getTime() - HAENGEND_AB_MS).toISOString();

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

    let wartendGesamt: number;
    let haengendGesamt: number;
    try {
      pruefeAntwort(wartend);
      pruefeAntwort(haengend);
      wartendGesamt = zaehlung(wartend);
      haengendGesamt = zaehlung(haengend);
    } catch (e) {
      throw new LeseFehler(bereinigeFehler(e));
    }

    const antwort: FreigabenAntwort = {
      erzeugt_am: new Date().toISOString(),
      wartend: zuListe(wartend.data, jetzt.getTime()),
      wartend_gesamt: wartendGesamt,
      haengend: zuListe(haengend.data, jetzt.getTime()),
      haengend_gesamt: haengendGesamt,
      quelle: QUELLE,
      fehler: null,
    };
    return NextResponse.json(antwort, { headers: KEIN_CACHE });
  } catch (e) {
    const lesefehler = e instanceof LeseFehler;
    const grund = lesefehler ? e.message : bereinigeFehler(e);
    return NextResponse.json(
      fehlerAntwort(lesefehler ? `Supabase nicht lesbar: ${grund}` : `Freigaben nicht ermittelbar: ${grund}`),
      { status: lesefehler ? 502 : 500, headers: KEIN_CACHE }
    );
  }
}
