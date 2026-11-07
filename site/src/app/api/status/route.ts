import { NextResponse } from "next/server";
import { createServiceClient, istKonfigurationsFehler } from "@/lib/supabase";
import { PREIS_STAND_AB } from "@/lib/kosten";
import { AUSGEBLENDETE_AGENTEN } from "@/lib/types";
import type { CronsWert, Messwert, SystemStatus } from "@/lib/status-types";
import { NACHWEIS_SEIT, NACHWEIS_TABELLE, TOTMANN_PLAN } from "@/lib/totmann";
import {
  ABFRAGE_TIMEOUT_MS,
  ANTHROPIC_SCHLUESSEL,
  EXPORT_TOKEN,
  HAENGEND_AB_MS,
  KEIN_CACHE,
  KOSTEN_QUELLEN,
  QUELLE_AKTIVIERUNG,
  STATUS_FEHLER,
  STATUS_HAENGEND,
  STATUS_WARTEND,
  STUNDE_MS,
  ZEILEN_JE_AKTIVEM_JOB,
  bereinigeFehler,
  berlinAnzeige,
  bewerteTotmann,
  fehlgeschlagen,
  haengendOderFilter,
  isoOderNull,
  istObjekt,
  ladeSeitenweise,
  leseSchluessel,
  messwert,
  mitternachtBerlin,
  monatsbeginnBerlin,
  nichtGemessen,
  pruefeAntwort,
  textOderNull,
  verbinde,
  werteKostenAus,
  zaehlung,
} from "@/lib/status-server";

// GET /api/status — ehrlicher Systemzustand (Objekt-Studio Stufe 1, 05.11.2026).
//
// Jede Teilmessung läuft für sich (eigenes try/catch, alle parallel). Fällt eine aus,
// trägt nur sie status "fehler"; die Antwort bleibt 200. 500 nur, wenn die Route selbst
// keine Antwort bauen kann. Liegt hinter der Login-Middleware; ausgegeben werden nie
// Schlüssel, nur ob sie gesetzt sind.
//
// Segment-Config, geprüft in node_modules/next/dist/docs/01-app/ (Next 16.2.1, ohne
// Cache Components): GET-Handler sind seit v15 nicht mehr statisch
// (03-api-reference/03-file-conventions/route.md). "force-dynamic" hält das ausdrücklich
// fest (02-guides/caching-without-cache-components.md) und setzt auch die fetch-Aufrufe
// des Supabase-Clients auf no-store. runtime "nodejs", weil der Export-Zwischenspeicher
// im Prozess-Speicher liegt.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ServiceClient = ReturnType<typeof createServiceClient>;

// Zeitspalte der messages ist "timestamp": NOT NULL und indiziert (idx_messages_timestamp,
// scripts/setup_supabase*.sql). created_at gibt es dort auch, aber nullable und ohne Index
// — bei absteigender Sortierung kämen NULL-Zeilen zuerst. Für die hier gezählten Zeilen
// (activation-api, delegate-plan, fehllauf) sind beide gleich: activate/route.ts und
// donna/delegate/route.ts setzen keine, beide sind DEFAULT NOW() derselben Anweisung.
const MSG_ZEIT = "timestamp";

/** Höchstzahl geladener Zeilen je Auswertung (Kosten, aktive Agenten). */
const AKTIVIERUNGEN_HOECHSTENS = 5000;

const Q = {
  supabase: "Supabase · Probe-Abfrage auf agents (count, head)",
  agenten: "Supabase · agents",
  bus: "Supabase · messages (count exact)",
  letzte: "Supabase · messages (source activation-api)",
  aktive: "Supabase · messages (source activation-api, letzte 24 h)",
  contentHeute: "Supabase · content (created_at ab 00:00 Europe/Berlin)",
  freigabe: "Supabase · content (status)",
  kosten: "Supabase · messages (source activation-api, delegate-plan, fehllauf; metadata.cost_usd, metadata.preis_stand)",
  steinadel: "steinadel.de · /api/objekte/export (Server-Abruf)",
  anthropic: "Server-Umgebung · Anthropic-Schlüssel",
  // Stufe 2 (07.11.2026, Totmann): vorher fest "kein Lauf-Protokoll" (nicht gemessen).
  crons: "Plan site/src/lib/totmann.ts · Supabase · lauf_nachweis (begonnen_am, ergebnis)",
  riegel: "Agenten-Container · GP_EXTERNAL_POSTING",
  telegram: "kein Zustell-Protokoll",
} as const;

// Befund R8 (06.11.2026): Planungen und Fehlläufe zählen mit; vorher nur Aktivierungen.
const KOSTEN_HINWEIS =
  "Schätzung aus Tokens × fester Preistabelle; gezählt: Agenten-Aktivierungen, L.I.S.A.-Planungen und bezahlte Fehlläufe über das Dashboard; Python-Läufe nicht enthalten.";

/**
 * Führt eine Messung aus; jede Ausnahme wird zu status "fehler" nur dieser Messung.
 * Gegencheck 06.11.2026: Ein Konfigurationsfehler (Service-Schlüssel fehlt oder ist unbrauchbar)
 * heißt "nicht_gemessen" — die Datenbank wurde dann nicht abgefragt; vorher zeigte die TopBar
 * dafür rot "OFFLINE" mit "gemessen: <Zeit>".
 */
async function messe<T>(quelle: string, messung: () => Promise<Messwert<T>>): Promise<Messwert<T>> {
  try {
    return await messung();
  } catch (e) {
    if (istKonfigurationsFehler(e)) {
      return { wert: null, status: "nicht_gemessen", quelle, gemessen_am: null, hinweis: `${bereinigeFehler(e)} — nicht abgefragt` };
    }
    return fehlgeschlagen<T>(quelle, e);
  }
}

/** Ein Client je Abruf. Fehlt der Service-Key, scheitert jede Supabase-Messung einzeln daran. */
function clientFabrik(): () => ServiceClient {
  let client: ServiceClient | null = null;
  return () => {
    if (!client) client = createServiceClient();
    return client;
  };
}

function zeitlimit(): AbortSignal {
  return AbortSignal.timeout(ABFRAGE_TIMEOUT_MS);
}

// ── Supabase-Messungen ────────────────────────────────────────────────────────

async function messeSupabase(sb: () => ServiceClient) {
  const client = sb();
  const start = performance.now();
  const res = await client
    .from("agents")
    .select("id", { count: "exact", head: true })
    .abortSignal(zeitlimit());
  const latenz = Math.round(performance.now() - start);
  pruefeAntwort(res);
  return messwert(
    { latenz_ms: latenz },
    "ok",
    Q.supabase,
    "Gemessen parallel zu den übrigen Abfragen dieses Abrufs."
  );
}

async function messeAgenten(sb: () => ServiceClient) {
  const client = sb();
  const signal = zeitlimit();
  const [alle, versteckt] = await Promise.all([
    client.from("agents").select("id", { count: "exact", head: true }).abortSignal(signal),
    client.from("agents").select("id").in("id", [...AUSGEBLENDETE_AGENTEN]).abortSignal(signal),
  ]);
  const anzahl = zaehlung(alle);
  pruefeAntwort(versteckt);
  // Stufe 1 (05.11.2026): ausgeblendete Agenten (lib/types.ts, z. B. trader) zeigt das
  // Dashboard nicht mehr, die Zeile kann aber noch existieren. Gezählt wird, was in der
  // Tabelle steht.
  const ausgeblendet = (Array.isArray(versteckt.data) ? versteckt.data : [])
    .map((z: unknown) => (istObjekt(z) ? textOderNull(z.id) : null))
    .filter((id): id is string => id !== null)
    .sort();
  return messwert(
    { anzahl, ausgeblendet },
    "ok",
    Q.agenten,
    ausgeblendet.length > 0 ? "Gezählt sind alle Zeilen, auch ausgeblendete." : undefined
  );
}

async function messeBus(sb: () => ServiceClient) {
  const res = await sb()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .abortSignal(zeitlimit());
  return messwert({ anzahl: zaehlung(res) }, "ok", Q.bus);
}

async function messeLetzteAktivierung(sb: () => ServiceClient) {
  const res = await sb()
    .from("messages")
    .select(`from_agent, ${MSG_ZEIT}`)
    .eq("metadata->>source", QUELLE_AKTIVIERUNG)
    .order(MSG_ZEIT, { ascending: false })
    .limit(1)
    .abortSignal(zeitlimit());
  pruefeAntwort(res);
  const zeile: unknown = Array.isArray(res.data) ? res.data[0] : undefined;
  if (zeile === undefined) {
    return messwert<{ am: string; agent: string }>(null, "warnung", Q.letzte, "keine Aktivierung gefunden");
  }
  if (!istObjekt(zeile)) throw new Error("unerwartete Zeilenform");
  const am = isoOderNull(zeile[MSG_ZEIT]);
  const agent = textOderNull(zeile.from_agent);
  if (!am || !agent) throw new Error("Aktivierung ohne Zeit oder Agent");
  return messwert({ am, agent }, "ok", Q.letzte);
}

async function messeAktiveAgenten(sb: () => ServiceClient, jetzt: Date) {
  const client = sb();
  const signal = zeitlimit();
  const seit = new Date(jetzt.getTime() - 24 * STUNDE_MS).toISOString();
  const bis = jetzt.toISOString();
  const erg = await ladeSeitenweise(
    (von, bisZeile, mitZaehlung) =>
      client
        .from("messages")
        .select("id, from_agent", mitZaehlung ? { count: "exact" } : undefined)
        .eq("metadata->>source", QUELLE_AKTIVIERUNG)
        .gte(MSG_ZEIT, seit)
        .lte(MSG_ZEIT, bis)
        .order(MSG_ZEIT, { ascending: false })
        .order("id", { ascending: true })
        .range(von, bisZeile)
        .abortSignal(signal),
    AKTIVIERUNGEN_HOECHSTENS
  );
  const agenten = new Set<string>();
  for (const z of erg.zeilen) {
    const agent = textOderNull(z.from_agent);
    if (!agent) throw new Error("Aktivierung ohne from_agent");
    agenten.add(agent);
  }
  const liste = [...agenten].sort();
  return messwert(
    { anzahl: liste.length, agenten: liste },
    erg.abgeschnitten ? "warnung" : "ok",
    Q.aktive,
    erg.abgeschnitten
      ? `Nur die jüngsten ${erg.zeilen.length} von ${erg.gesamt ?? "unbekannt vielen"} Aktivierungen ausgewertet; Liste kann unvollständig sein.`
      : undefined
  );
}

async function messeContentHeute(sb: () => ServiceClient, jetzt: Date) {
  const ab = mitternachtBerlin(jetzt);
  const res = await sb()
    .from("content")
    .select("id", { count: "exact", head: true })
    .gte("created_at", ab.toISOString())
    .abortSignal(zeitlimit());
  return messwert({ anzahl: zaehlung(res) }, "ok", Q.contentHeute, `ab ${berlinAnzeige(ab)} (Europe/Berlin)`);
}

async function messeFreigabe(sb: () => ServiceClient, jetzt: Date) {
  const client = sb();
  const signal = zeitlimit();
  const grenze = new Date(jetzt.getTime() - HAENGEND_AB_MS).toISOString();
  const seit7 = new Date(jetzt.getTime() - 7 * 24 * STUNDE_MS).toISOString();
  // Dieselben Filter wie GET /api/freigaben (Konstanten aus lib/status-server.ts).
  const [wartend, haengend, fehler] = await Promise.all([
    client
      .from("content")
      .select("id", { count: "exact", head: true })
      .eq("status", STATUS_WARTEND)
      .abortSignal(signal),
    client
      .from("content")
      .select("id", { count: "exact", head: true })
      .in("status", [...STATUS_HAENGEND])
      .or(haengendOderFilter(grenze))
      .abortSignal(signal),
    client
      .from("content")
      .select("id", { count: "exact", head: true })
      .eq("status", STATUS_FEHLER)
      .gte("created_at", seit7)
      .abortSignal(signal),
  ]);
  const wert = { wartend: zaehlung(wartend), haengend: zaehlung(haengend), fehler_7_tage: zaehlung(fehler) };
  // Stufe 1 (05.11.2026): "warnung", sobald etwas liegen bleibt oder scheiterte — die
  // Messung selbst ist dann trotzdem vollständig.
  const auffaellig = wert.haengend > 0 || wert.fehler_7_tage > 0;
  return messwert(
    wert,
    auffaellig ? "warnung" : "ok",
    Q.freigabe,
    "hängend = entwurf/counsel_geprueft ohne Änderung seit mehr als 2 h (updated_at, sonst created_at)"
  );
}

// Befunde R8 + R20 (06.11.2026): summiert Aktivierungen, L.I.S.A.-Planungen und Fehlläufe,
// weist Planungen getrennt aus und sagt für Tag und Monat getrennt, ob die Summe vollständig
// ist. "warnung" nur, wenn der Monat unvollständig oder die Abfrage abgeschnitten ist;
// Auswertung und Hinweistexte: werteKostenAus() in lib/status-server.ts. Welche Zeilen mit
// der alten Preistabelle geschätzt sind, zeigt metadata.preis_stand (Nachprüfung 06.11.2026),
// nicht das Datum: bis zum Deploy rechnet der laufende Stand noch alt.
async function messeKosten(sb: () => ServiceClient, jetzt: Date) {
  const client = sb();
  const signal = zeitlimit();
  const monatsbeginn = monatsbeginnBerlin(jetzt);
  const bis = jetzt.toISOString();
  // Neueste zuerst: wird abgeschnitten, fehlen die ältesten Läufe des Monats, nicht die von heute.
  const erg = await ladeSeitenweise(
    (von, bisZeile, mitZaehlung) =>
      client
        .from("messages")
        .select(
          `id, ${MSG_ZEIT}, metadata->cost_usd, metadata->>source, metadata->>art, metadata->>preis_stand`,
          mitZaehlung ? { count: "exact" } : undefined
        )
        .in("metadata->>source", [...KOSTEN_QUELLEN])
        .gte(MSG_ZEIT, monatsbeginn.toISOString())
        .lte(MSG_ZEIT, bis)
        .order(MSG_ZEIT, { ascending: false })
        .order("id", { ascending: true })
        .range(von, bisZeile)
        .abortSignal(signal),
    AKTIVIERUNGEN_HOECHSTENS
  );

  // PostgREST benennt metadata->cost_usd als "cost_usd", metadata->>source als "source".
  const auswertung = werteKostenAus(
    erg.zeilen.map((z) => ({ zeit: z[MSG_ZEIT], kosten: z.cost_usd, quelle: z.source, art: z.art, preisStand: z.preis_stand })),
    { gesamt: erg.gesamt, abgeschnitten: erg.abgeschnitten },
    jetzt,
    PREIS_STAND_AB
  );
  return messwert(auswertung.wert, auswertung.status, Q.kosten, verbinde(KOSTEN_HINWEIS, ...auswertung.hinweise));
}

// ── Totmann: Crons und Agenten (Objekt-Studio Stufe 2, §2.2–2.4) ──────────────

// eingetragen_am (DB-Uhr) für den Uhrenabgleich der Zeile (Prüfbefunde Z2, SR-5); id für die
// Reihenfolge bei gleicher DB-Uhr, wie hier geordnet (Prüfbefund r3-logik-1, bewerteJob).
const NACHWEIS_SPALTEN = "id, job, begonnen_am, beendet_am, eingetragen_am, ergebnis, http_status, teilergebnisse, hinweis";

// Je Plan-Job die zuletzt eingetragene Zeile (order eingetragen_am desc, id desc, limit 1; Index
// idx_lauf_nachweis_job_eingetragen in scripts/lauf_nachweis.sql) und — nur für aktive Jobs — die
// zuletzt eingetragene mit einem Ergebnis außer uebersprungen.
// - Prüfbefunde r3-logik-1, P3A-1 (dritte Prüfung): Für aktive Jobs liest die erste Abfrage die
//   zuletzt eingetragenen ZEILEN_JE_AKTIVEM_JOB statt nur einer. Mit nur der jüngsten verdrängte ein
//   übersprungener Lauf an einem Tag ohne Sollzeitpunkt (Samstag, "Wochenende") den übersprungenen
//   Freitagslauf, der S deckt: rot "überfällig seit Fr", obwohl der Freitag lief.
// - Prüfbefund D1 (zweite Prüfung): geordnet nach der DB-Uhr (eingetragen_am), bei Gleichstand nach
//   id, nicht mehr nach begonnen_am (App-Uhr). Eine Zeile aus einer vorgelaufenen App-Uhr blieb sonst
//   bis zu ihrem Datum "die jüngste", und neuere plausible Läufe wurden nie gelesen: bei einem aktiven
//   Job rot "unplausibel" bis zu diesem Datum, bei einem abgeschalteten ein Stolperdraht, der sich nur
//   mit einer Quittung in die Zukunft beenden ließ und danach blind war. Abweichung von §2.2 Punkt 4
//   (order begonnen_am) und vom Index in §5.5 (b).
// - Prüfbefund Z5: Mit nur der jüngsten machte ein späterer übersprungener Lauf ein früheres
//   Ergebnis zum selben Sollzeitpunkt unsichtbar — daher die zweite Abfrage.
// - Prüfbefund betrieb-1: Die zweite Abfrage braucht nur ein aktiver Job (Urteil über das Ergebnis);
//   bei einem abgeschalteten entscheidet allein, ob nach aus_seit etwas lief (Stolperdraht), und das
//   zeigt die zuletzt eingetragene Zeile — lief danach etwas, ist sie von danach (bis auf Läufe, die
//   sich am Stichtag überlappen). Gewollt in Kauf genommen: Eine ältere unlesbare Zeile eines
//   abgeschalteten Jobs wird nicht mehr gelesen, die Lage heißt dann "aus" statt "nicht lesbar"
//   (beides bernstein); ein Laufergebnis, das sie verfälschen könnte, hat ein abgeschalteter Job
//   nicht. Beim heutigen Plan (alle aus) sind es 3 statt 6 Abfragen je Abruf.
// Alle Abfragen mit demselben Zeitlimit wie die übrigen Messungen. Probe-Zeilen
// (content-auto-produce-probe) stehen in keinem Plan und werden gar nicht gelesen. Ein Lesefehler —
// auch eine fehlende Tabelle, solange das SQL nicht ausgeführt ist, oder ein fehlender
// Service-Schlüssel — geht als lesefehler an bewerteTotmann: Sind alle Jobs aus, bleibt die Zeile
// bernstein mit Hinweis; ist einer aktiv, wird sie rot.
async function messeCrons(sb: () => ServiceClient, jetzt: Date): Promise<Messwert<CronsWert>> {
  const zeilen: unknown[] = [];
  let lesefehler: string | null = null;
  let abgefragt = true;
  try {
    const client = sb();
    const signal = zeitlimit();
    const zuletztEingetragen = (job: string, ohneUebersprungen: boolean, anzahl: number) => {
      const abfrage = client.from(NACHWEIS_TABELLE).select(NACHWEIS_SPALTEN).eq("job", job);
      return (ohneUebersprungen ? abfrage.neq("ergebnis", "uebersprungen") : abfrage)
        .order("eingetragen_am", { ascending: false })
        .order("id", { ascending: false })
        .limit(anzahl)
        .abortSignal(signal);
    };
    const antworten = await Promise.all(
      TOTMANN_PLAN.flatMap((j) =>
        j.aktiv
          ? [zuletztEingetragen(j.job, false, ZEILEN_JE_AKTIVEM_JOB), zuletztEingetragen(j.job, true, 1)]
          : [zuletztEingetragen(j.job, false, 1)]
      )
    );
    for (const res of antworten) {
      pruefeAntwort(res);
      if (!Array.isArray(res.data)) throw new Error("Antwort ohne Zeilenliste");
      zeilen.push(...res.data);
    }
  } catch (e) {
    abgefragt = !istKonfigurationsFehler(e);
    lesefehler = abgefragt ? bereinigeFehler(e) : `${bereinigeFehler(e)} — nicht abgefragt`;
  }
  const b = bewerteTotmann(TOTMANN_PLAN, zeilen, jetzt, lesefehler, NACHWEIS_SEIT);
  // Prüfbefunde SR-6, B9: Ohne Service-Schlüssel wurde die Datenbank nicht abgefragt — dann kein
  // Messzeitpunkt (wie messe() für die übrigen Felder). Die Farbe bleibt nach §2.3 bernstein bzw. rot.
  return messwert(b.wert, b.status, Q.crons, b.hinweis, abgefragt ? new Date().toISOString() : null);
}

// ── Steinadel-Export (5 min zwischengespeichert) ──────────────────────────────

const STEINADEL_EXPORT_URL = "https://steinadel.de/api/objekte/export";
const EXPORT_ZWISCHENSPEICHER_MS = 5 * 60_000;

type ExportWert = { objekte: number; latenz_ms: number };

// Stufe 1 (05.11.2026): Prozess-Speicher statt Abruf bei jedem Statusaufruf, damit der
// 60-s-Takt des Dashboards den Export nicht belastet. Gespeichert wird jedes Ergebnis,
// auch ein Fehler; gemessen_am bleibt der Zeitpunkt der echten Messung. "laufend"
// bündelt gleichzeitige Abrufe zu einer Messung.
let exportZwischenspeicher: { messung: Messwert<ExportWert>; gueltigBis: number } | null = null;
let exportLaufend: Promise<Messwert<ExportWert>> | null = null;

async function frischeExportMessung(token: string): Promise<Messwert<ExportWert>> {
  const start = performance.now();
  try {
    const res = await fetch(STEINADEL_EXPORT_URL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(ABFRAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return messwert<ExportWert>(null, "fehler", Q.steinadel, `HTTP ${res.status}`);
    }
    const daten: unknown = await res.json();
    const latenz = Math.round(performance.now() - start);
    if (!istObjekt(daten) || !Array.isArray(daten.objekte)) {
      return messwert<ExportWert>(null, "fehler", Q.steinadel, "Antwort ohne objekte-Liste");
    }
    const objekte = daten.objekte.length;
    return messwert(
      { objekte, latenz_ms: latenz },
      objekte > 0 ? "ok" : "warnung",
      Q.steinadel,
      objekte > 0 ? undefined : "Export liefert keine Objekte."
    );
  } catch (e) {
    return messwert<ExportWert>(null, "fehler", Q.steinadel, bereinigeFehler(e));
  }
}

async function messeSteinadelExport(): Promise<Messwert<ExportWert>> {
  // Befund R23 (06.11.2026): neutrale Meldung, der Variablenname steht nur im Server-Log.
  // Befund R17: ein Token mit CR, LF oder NUL wird abgelehnt, bevor es in einen Header geht.
  const lage = leseSchluessel(EXPORT_TOKEN);
  if (!lage.ok) {
    // Gegencheck 06.11.2026: wie beim Supabase-Schlüssel (messe) — ohne brauchbares Token wurde
    // der Export nicht abgefragt: "nicht_gemessen" mit Grund, nicht "fehler".
    return { wert: null, status: "nicht_gemessen", quelle: Q.steinadel, gemessen_am: null, hinweis: `${lage.meldung} — nicht abgefragt` };
  }
  const token = lage.wert;
  const zwischen = exportZwischenspeicher;
  if (zwischen && zwischen.gueltigBis > Date.now()) {
    return {
      ...zwischen.messung,
      hinweis: verbinde(zwischen.messung.hinweis, "aus dem Zwischenspeicher, Messung höchstens 5 min alt"),
    };
  }
  if (!exportLaufend) {
    exportLaufend = frischeExportMessung(token)
      .then((messung) => {
        exportZwischenspeicher = { messung, gueltigBis: Date.now() + EXPORT_ZWISCHENSPEICHER_MS };
        return messung;
      })
      .finally(() => {
        exportLaufend = null;
      });
  }
  return exportLaufend;
}

// ── Konfiguration und nicht Messbares ─────────────────────────────────────────

function messeAnthropic(): Messwert<{ konfiguriert: boolean }> {
  // Dieselbe Prüfung wie activate und delegate (leseSchluessel in lib/status-server.ts):
  // gesetzt, kein Platzhalter, mindestens 10 Zeichen, kein CR/LF/NUL. Der Wert selbst
  // verlässt diese Funktion nie.
  const lage = leseSchluessel(ANTHROPIC_SCHLUESSEL);
  return messwert(
    { konfiguriert: lage.ok },
    lage.ok ? "ok" : "fehler",
    Q.anthropic,
    lage.ok
      ? "Geprüft wird nur, ob der Schlüssel gesetzt und formal brauchbar ist, nicht ob er gültig ist."
      : `${lage.meldung}; Aktivierungen und Planungen werden abgelehnt.`
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const jetzt = new Date();
    const sb = clientFabrik();

    const [supabase, agenten, bus, letzte, aktive, contentHeute, freigabe, kosten, steinadel, crons] = await Promise.all([
      messe(Q.supabase, () => messeSupabase(sb)),
      messe(Q.agenten, () => messeAgenten(sb)),
      messe(Q.bus, () => messeBus(sb)),
      messe(Q.letzte, () => messeLetzteAktivierung(sb)),
      messe(Q.aktive, () => messeAktiveAgenten(sb, jetzt)),
      messe(Q.contentHeute, () => messeContentHeute(sb, jetzt)),
      messe(Q.freigabe, () => messeFreigabe(sb, jetzt)),
      messe(Q.kosten, () => messeKosten(sb, jetzt)),
      messe(Q.steinadel, () => messeSteinadelExport()),
      // Lesefehler fängt messeCrons selbst (Totmann-Regel); messe fängt nur einen kaputten Plan.
      messe(Q.crons, () => messeCrons(sb, jetzt)),
    ]);

    const antwort: SystemStatus = {
      erzeugt_am: new Date().toISOString(),
      supabase,
      agenten,
      bus,
      letzte_aktivierung: letzte,
      aktive_agenten_24h: aktive,
      content_heute: contentHeute,
      freigabe,
      kosten,
      steinadel_export: steinadel,
      anthropic: messeAnthropic(),
      crons,
      // Stufe 1 (05.11.2026): "veröffentlicht" statt "sendet" — das Dashboard schickt
      // Prompts an api.anthropic.com, postet aber nirgends (grep über src/ am 06.11.2026:
      // kein Aufruf an Social-, Telegram- oder Newsletter-Schnittstellen).
      posting_riegel: nichtGemessen(
        Q.riegel,
        "Der Riegel GP_EXTERNAL_POSTING gilt im Agenten-Container und ist von hier nicht lesbar. Das Dashboard selbst enthält keinen Code, der Inhalte nach außen veröffentlicht."
      ),
      telegram: nichtGemessen(Q.telegram, "Zustellungen werden nirgends protokolliert."),
    };
    return NextResponse.json(antwort, { headers: KEIN_CACHE });
  } catch (e) {
    return NextResponse.json(
      { fehler: `Status nicht ermittelbar: ${bereinigeFehler(e)}` },
      { status: 500, headers: KEIN_CACHE }
    );
  }
}
