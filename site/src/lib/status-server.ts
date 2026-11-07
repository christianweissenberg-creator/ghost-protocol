// Server-Helfer für GET /api/status und GET /api/freigaben — Objekt-Studio Stufe 1 (05.11.2026).
// Seit 06.11.2026 auch für POST /api/agents/activate und POST /api/donna/delegate:
// Schlüssel lesen, Fehler bereinigen, Abschneide-Status, Fehlläufe, Summen und Kosten.
//
// Nur aus Route Handlern importieren, nie aus Client-Code: der Fehler-Bereiniger liest
// Secret-Werte aus process.env, um sie aus Meldungen zu entfernen. Die Datei hat bewusst
// keine Laufzeit-Imports — den Supabase-Client holen die Routen selbst über
// createServiceClient() (lib/supabase.ts). Deshalb laufen die Tests direkt gegen diese
// Datei (tests/b-*.test.mjs).
//
// Warum gemeinsam: beide Routen zählen "wartend" und "hängend". Liegt die Regel an einer
// Stelle, können Statuskachel und Freigabe-Stapel nicht auseinanderlaufen.
//
// Seit Stufe 2 (07.11.2026) auch der Totmann für Crons und Agenten: Sollzeitpunkt, Bewertung je
// Job und Zeile, Ergebnis-Ableitung der Schreiber (Abschnitt "Totmann" am Dateiende). Plan und
// NACHWEIS_SEIT (lib/totmann.ts) reichen die Routen herein — auch hier kein Laufzeit-Import.

import type { AusfuehrungAntwort } from "./auftrag-types";
import type {
  CronJobStand,
  CronLage,
  CronsWert,
  KostenWert,
  LaufErgebnis,
  LaufNachweisLesung,
  LaufTeilergebnis,
  MessStatus,
  Messwert,
} from "./status-types";
import type { TotmannJob } from "./totmann";

/** Antwort-Header aller Zustands-Antworten: nie zwischenspeichern (Browser, Proxy, CDN). */
export const KEIN_CACHE: Record<string, string> = { "Cache-Control": "no-store" };

/** Zeitlimit je Messung. Ohne Limit hielte eine hängende Verbindung den ganzen Abruf fest. */
export const ABFRAGE_TIMEOUT_MS = 8_000;

export const STUNDE_MS = 3_600_000;
/** Ab dieser Ruhezeit gilt ein Entwurf als hängend (Vorgabe Stufe 1: 2 h). */
export const HAENGEND_AB_MS = 2 * STUNDE_MS;

export const STATUS_WARTEND = "zur_freigabe";
/** Zwischenstände der Pipeline (api/content/pipeline/route.ts), die nicht liegen bleiben dürfen. */
export const STATUS_HAENGEND: readonly string[] = ["entwurf", "counsel_geprueft"];
export const STATUS_FEHLER = "fehler";

/** metadata.source der Dashboard-Aktivierungen, gesetzt in api/agents/activate/route.ts. */
export const QUELLE_AKTIVIERUNG = "activation-api";
/** metadata.source der L.I.S.A.-Planungen, gesetzt in api/donna/delegate/route.ts. */
export const QUELLE_PLANUNG = "delegate-plan";
/**
 * metadata.source bezahlter Aufrufe ohne verwertbare Antwort (Befund R8, 06.11.2026);
 * metadata.art "aktivierung" (activate) oder "planung" (delegate).
 */
export const QUELLE_FEHLLAUF = "fehllauf";
/** Quellen, deren metadata.cost_usd GET /api/status als Kosten summiert. */
export const KOSTEN_QUELLEN: readonly string[] = [QUELLE_AKTIVIERUNG, QUELLE_PLANUNG, QUELLE_FEHLLAUF];

/**
 * PostgREST-or-Filter für "hängend": letzte Änderung = updated_at, ersatzweise created_at,
 * und die liegt vor der Grenze. Werte in doppelten Anführungszeichen, weil ISO-Zeiten
 * Punkt und Doppelpunkt enthalten (in PostgREST-Logikbäumen reservierte Zeichen).
 */
export function haengendOderFilter(grenzeIso: string): string {
  const g = `"${grenzeIso}"`;
  return `updated_at.lt.${g},and(updated_at.is.null,created_at.lt.${g})`;
}

// ── Zeit in Europe/Berlin ─────────────────────────────────────────────────────
// Mitternacht und Monatsbeginn werden über Intl bestimmt, nicht über festes UTC+1:
// sonst läge "heute" im Sommer eine Stunde daneben. Der Formatter entsteht erst beim
// ersten Aufruf; fehlen der Laufzeit die Zeitzonendaten, scheitert nur die Messung, die
// ihn braucht, nicht das Laden des Moduls.

let berlinFormat: Intl.DateTimeFormat | null = null;

interface Wandzeit {
  jahr: number;
  monat: number;
  tag: number;
  stunde: number;
  minute: number;
  sekunde: number;
}

function berlinWandzeit(d: Date): Wandzeit {
  if (!berlinFormat) {
    berlinFormat = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Berlin",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  }
  const teile = berlinFormat.formatToParts(d);
  const lies = (typ: Intl.DateTimeFormatPartTypes): number => {
    const teil = teile.find((t) => t.type === typ);
    const zahl = teil ? Number(teil.value) : Number.NaN;
    if (!Number.isFinite(zahl)) throw new Error("Zeitzone Europe/Berlin nicht auswertbar");
    return zahl;
  };
  return {
    jahr: lies("year"),
    monat: lies("month"),
    tag: lies("day"),
    stunde: lies("hour"),
    minute: lies("minute"),
    sekunde: lies("second"),
  };
}

/** Versatz Berlin gegenüber UTC in ms zum Zeitpunkt d (3 600 000 im Winter, 7 200 000 im Sommer). */
function berlinVersatzMs(d: Date): number {
  const w = berlinWandzeit(d);
  const wandAlsUtc = Date.UTC(w.jahr, w.monat - 1, w.tag, w.stunde, w.minute, w.sekunde);
  const ms = d.getTime();
  return wandAlsUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/** Zeitpunkt, an dem in Berlin der angegebene Kalendertag um 00:00 beginnt. */
function berlinTagesbeginn(jahr: number, monat: number, tag: number): Date {
  const wandAlsUtc = Date.UTC(jahr, monat - 1, tag, 0, 0, 0);
  // Zwei Schritte: der Versatz wird am Zielzeitpunkt gelesen, nicht an der Schätzung.
  // Berlin stellt um 01:00 UTC um, nie um lokale Mitternacht — 00:00 ist immer eindeutig.
  let zeit = wandAlsUtc - berlinVersatzMs(new Date(wandAlsUtc));
  zeit = wandAlsUtc - berlinVersatzMs(new Date(zeit));
  return new Date(zeit);
}

/**
 * Zeitpunkt der Berliner Ortszeit jahr-monat-tag stunde:minute (Totmann, Stufe 2). Zwei Schritte
 * wie berlinTagesbeginn: Der Versatz wird am Zielzeitpunkt gelesen, deshalb stimmt auch ein
 * Wochentag direkt nach der Umstellung (Mo 30.03.2026 08:03 = 06:03 UTC, Mo 26.10.2026 08:03 =
 * 07:03 UTC). Eine Ortszeit in der Sprunglücke (02:00–03:00 am letzten Märzsonntag) kommt im
 * Plan nicht vor; sie landete eine Stunde später.
 */
function berlinZeitpunkt(jahr: number, monat: number, tag: number, stunde: number, minute: number): Date {
  const wandAlsUtc = Date.UTC(jahr, monat - 1, tag, stunde, minute, 0);
  let zeit = wandAlsUtc - berlinVersatzMs(new Date(wandAlsUtc));
  zeit = wandAlsUtc - berlinVersatzMs(new Date(zeit));
  return new Date(zeit);
}

/** Letzte Mitternacht in Berlin vor (oder genau an) jetzt. */
export function mitternachtBerlin(jetzt: Date): Date {
  const w = berlinWandzeit(jetzt);
  return berlinTagesbeginn(w.jahr, w.monat, w.tag);
}

/** Beginn des laufenden Kalendermonats in Berlin. */
export function monatsbeginnBerlin(jetzt: Date): Date {
  const w = berlinWandzeit(jetzt);
  return berlinTagesbeginn(w.jahr, w.monat, 1);
}

const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-06" → "06.11.2026"; unlesbar → unverändert. */
function datumAnzeige(datum: string): string {
  const m = DATUM.exec(datum);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : datum;
}

/** Berliner Ortszeit für Hinweise, z. B. "01.11.2026 00:00" — ein UTC-Wert wie 31.10. 23:00 läse sich als Vortag. */
export function berlinAnzeige(d: Date): string {
  const w = berlinWandzeit(d);
  const zwei = (n: number) => String(n).padStart(2, "0");
  return `${zwei(w.tag)}.${zwei(w.monat)}.${w.jahr} ${zwei(w.stunde)}:${zwei(w.minute)}`;
}

// ── Schlüssel aus der Server-Umgebung ─────────────────────────────────────────
// Befund R17 (06.11.2026): Ein Schlüssel mit CR, LF oder NUL im Wert wird schon beim Lesen
// abgelehnt. Sonst wirft fetch beim Setzen des Headers einen Fehler, der den vollen Wert
// enthält ('Headers.append: "<Wert>" is an invalid header value'), und der landet in
// Antworten, Logs oder gespeicherten Zeilen. Die Meldungen sind fest; sie nennen weder den
// Wert noch den Variablennamen (Befund R23). Den Namen schreibt nur das Server-Log, einmal
// je Prozess und Grund, damit der 60-s-Takt des Dashboards das Log nicht flutet.
//
// Nachprüfung 06.11.2026: Leerraum am Rand (Tab, LF, CR, Leerzeichen) eines Header-Werts
// entfernt fetch selbst und wirft dabei nicht (gemessen Node 25.3:
// new Headers({ k: "x\r\n" }).get("k") === "x"). Ein Schlüssel mit LF oder CRLF am Ende lief
// deshalb vor der Fixrunde. Der Rand wird hier genauso entfernt und der bereinigte Wert
// verwendet; abgelehnt wird, was danach noch CR, LF oder NUL enthält — genau die Werte, bei
// denen fetch mit dem Wert in der Meldung wirft. Entfernt wird vor dem Zusammensetzen: in
// "Bearer <Wert>" stünde ein führender Rand sonst mitten im Header, ein führendes LF ließe
// fetch werfen (gemessen Node 25.3).

const STEUERZEICHEN = /[\r\n\0]/;
// Gegencheck 06.11.2026: Ein Header-Wert besteht aus Bytes. Ein Zeichen über U+00FF (etwa ein
// unsichtbares U+200B aus Kopieren und Einfügen oder ein Gedankenstrich U+2013) lässt
// Headers.set werfen ("Cannot convert argument to a ByteString", gemessen Node 25.3); vorher
// warf GET /api/objekte dann ungefangen (HTTP 500 ohne fehler_art). Solche Werte sind
// unbrauchbar und werden wie Steuerzeichen vor dem Abruf abgelehnt.
// Prüflauf 06.11.2026: Auch Steuerzeichen wie U+0001, U+001B oder U+007F passierten Headers.set;
// undici verwarf den Header erst beim Senden (InvalidArgumentError), die Route meldete dann
// "nicht erreichbar". Jetzt gilt die Header-Regel von undici: erlaubt sind nur TAB, 0x20–0x7E
// und 0x80–0xFF (gemessen Node 25.3). Ohne u-Flag prüft der Ausdruck UTF-16-Einheiten; Zeichen
// jenseits U+FFFF bestehen aus Surrogaten (D800–DFFF) und treffen damit ebenfalls.
const KEIN_HEADER_ZEICHEN = /[^\t\x20-\x7e\x80-\xff]/;
/** HTTP-Leerraum am Rand, wie ihn fetch aus Header-Werten entfernt. Kein NUL: daran wirft fetch. */
const RAND_LEERRAUM = /^[\t\n\r ]+|[\t\n\r ]+$/g;

/** Wert ohne Tab, LF, CR und Leerzeichen am Rand — derselbe Wert, den fetch als Header sendet. */
export function ohneRandLeerraum(wert: string): string {
  return wert.replace(RAND_LEERRAUM, "");
}

export type SchluesselGrund = "fehlt" | "unbrauchbar" | "steuerzeichen" | "zeichen";

export type SchluesselLage =
  | { ok: true; wert: string }
  | { ok: false; grund: SchluesselGrund; meldung: string };

export interface SchluesselRegel {
  /** Name der Umgebungsvariable; erscheint nur im Server-Log. */
  variable: string;
  /** Sichtbare Bezeichnung, z. B. "Anthropic-Schlüssel". */
  bezeichnung: string;
  mindestlaenge?: number;
  platzhalter?: readonly string[];
}

/** Dieselbe Regel für activate, delegate und die Statuskachel. */
export const ANTHROPIC_SCHLUESSEL: SchluesselRegel = {
  variable: "ANTHROPIC_API_KEY",
  bezeichnung: "Anthropic-Schlüssel",
  mindestlaenge: 10,
  platzhalter: ["sk-ant-your-key-here"],
};

/** Token für den Steinadel-Export (GET /api/objekte und die Statuskachel). */
export const EXPORT_TOKEN: SchluesselRegel = {
  variable: "IMMONEXUS_EXPORT_TOKEN",
  bezeichnung: "Export-Token",
};

const gemeldeteSchluesselProbleme = new Set<string>();

function schluesselMeldung(bezeichnung: string, grund: SchluesselGrund): string {
  if (grund === "fehlt") return `${bezeichnung} (Server-Umgebung) nicht gesetzt`;
  if (grund === "unbrauchbar") return `${bezeichnung} (Server-Umgebung) unbrauchbar: Platzhalter oder zu kurz`;
  if (grund === "zeichen") {
    return `${bezeichnung} (Server-Umgebung) abgelehnt: enthält ein Zeichen, das in keinem HTTP-Header stehen kann (etwa ein Steuerzeichen oder unsichtbares Leerzeichen)`;
  }
  return `${bezeichnung} (Server-Umgebung) abgelehnt: enthält Zeilenumbruch oder Nullzeichen`;
}

/** Server-Log einmal je Prozess und Kennung; nennt nur den Variablennamen, nie den Wert. */
function logEinmal(kennung: string, schreibe: () => void): void {
  if (gemeldeteSchluesselProbleme.has(kennung)) return;
  gemeldeteSchluesselProbleme.add(kennung);
  schreibe();
}

/**
 * Liest einen Schlüssel ohne Leerraum am Rand; der Wert steht nur im Ergebnis mit ok: true,
 * nie in einer Meldung. Nur Leerraum gilt als nicht gesetzt.
 */
export function leseSchluessel(regel: SchluesselRegel): SchluesselLage {
  const roh = process.env[regel.variable];
  const wert = typeof roh === "string" ? ohneRandLeerraum(roh) : "";
  let grund: SchluesselGrund | null = null;
  if (wert === "") grund = "fehlt";
  else if (STEUERZEICHEN.test(wert)) grund = "steuerzeichen";
  else if (KEIN_HEADER_ZEICHEN.test(wert)) grund = "zeichen";
  else if (wert.length < (regel.mindestlaenge ?? 1) || (regel.platzhalter ?? []).includes(wert)) grund = "unbrauchbar";
  if (grund === null) {
    if (wert !== roh) {
      logEinmal(`${regel.variable}:rand`, () =>
        console.warn(`[schluessel] ${regel.variable}: Leerraum am Rand entfernt (wie fetch) — bitte in der Umgebung bereinigen`),
      );
    }
    return { ok: true, wert };
  }
  const g: SchluesselGrund = grund;
  logEinmal(`${regel.variable}:${g}`, () => {
    const text =
      g === "fehlt"
        ? typeof roh === "string" && roh !== ""
          ? "nur Leerraum — wie nicht gesetzt behandelt"
          : "nicht gesetzt"
        : g === "unbrauchbar"
          ? "Platzhalter oder zu kurz"
          : g === "zeichen"
            ? "enthält ein Zeichen, das kein Header-Wert sein kann (Steuerzeichen oder über U+00FF) — abgelehnt"
            : "enthält CR, LF oder NUL im Wert — abgelehnt";
    console.error(`[schluessel] ${regel.variable}: ${text}`);
  });
  return { ok: false, grund: g, meldung: schluesselMeldung(regel.bezeichnung, g) };
}

// ── Fehler bereinigen ─────────────────────────────────────────────────────────
// Meldungen von Supabase und fetch landen sichtbar im Dashboard. Sie dürfen weder
// Schlüssel noch URLs mit Projektkennung enthalten und bleiben kurz.

const SECRET_VARIABLEN = [
  "SUPABASE_SERVICE_KEY",
  "IMMONEXUS_EXPORT_TOKEN",
  "ANTHROPIC_API_KEY",
  "GP_SESSION_SECRET",
  "CRON_SECRET",
  "GP_ACCESS_PASSWORD",
];

/**
 * Befund R17 (06.11.2026): Jedes Teilstück ab dieser Länge, das wörtlich in einem bekannten
 * Schlüssel vorkommt, wird ersetzt — auch wenn der Schlüssel in der Meldung zerteilt,
 * gekürzt oder mit maskierten Zeilenumbrüchen steht.
 */
export const MIN_SCHLUESSEL_STUECK = 12;

/** Markiert jede Textstelle, die in einem MIN_SCHLUESSEL_STUECK langen Stück eines Schlüssels liegt. */
function entferneSchluesselStuecke(text: string, werte: readonly string[]): string {
  if (text.length < MIN_SCHLUESSEL_STUECK) return text;
  const markiert = new Uint8Array(text.length);
  let treffer = false;
  for (const wert of werte) {
    if (wert.length < MIN_SCHLUESSEL_STUECK) continue;
    const stuecke = new Set<string>();
    for (let i = 0; i + MIN_SCHLUESSEL_STUECK <= wert.length; i++) {
      stuecke.add(wert.slice(i, i + MIN_SCHLUESSEL_STUECK));
    }
    for (let i = 0; i + MIN_SCHLUESSEL_STUECK <= text.length; i++) {
      if (stuecke.has(text.slice(i, i + MIN_SCHLUESSEL_STUECK))) {
        markiert.fill(1, i, i + MIN_SCHLUESSEL_STUECK);
        treffer = true;
      }
    }
  }
  if (!treffer) return text;
  let aus = "";
  let i = 0;
  while (i < text.length) {
    if (markiert[i]) {
      aus += "[entfernt]";
      while (i < text.length && markiert[i]) i++;
    } else {
      aus += text[i];
      i++;
    }
  }
  return aus;
}

function meldungAus(e: unknown): string {
  if (e instanceof Error) return e.name === "TimeoutError" ? `TimeoutError: ${e.message}` : e.message;
  if (typeof e === "string") return e;
  if (istObjekt(e) && typeof e.message === "string") return e.message;
  return "";
}

export function bereinigeFehler(e: unknown): string {
  let text = meldungAus(e);
  if (/TimeoutError|AbortError|aborted|timed out/i.test(text)) {
    return `Zeitüberschreitung (${ABFRAGE_TIMEOUT_MS / 1000} s)`;
  }
  // Alte englische Meldung von createServiceClient(); seit 06.11.2026 wirft sie selbst neutral.
  if (text === "SUPABASE_SERVICE_KEY not set") return "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt";
  // Ausgegeben werden höchstens 160 Zeichen; mehr als 4000 zu durchsuchen kostet nur Zeit.
  // Ein am Schnitt halbiertes Schlüsselstück ab 12 Zeichen entfernt die Stück-Suche trotzdem.
  if (text.length > 4000) text = text.slice(0, 4000);
  // Jeder Wert roh und ohne Leerraum am Rand (so verwenden ihn leseSchluessel und
  // createServiceClient); der rohe zuerst, weil er der längere ist.
  const werte: string[] = [];
  for (const name of SECRET_VARIABLEN) {
    const roh = process.env[name];
    if (typeof roh !== "string") continue;
    for (const wert of [roh, ohneRandLeerraum(roh)]) {
      if (wert.length >= 8 && !werte.includes(wert)) werte.push(wert);
    }
  }
  for (const wert of werte) text = text.split(wert).join("[entfernt]");
  text = entferneSchluesselStuecke(text, werte);
  text = text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[entfernt]")
    .replace(/sk-ant-[\w-]+/g, "[entfernt]")
    .replace(/Bearer\s+\S+/gi, "Bearer [entfernt]")
    .replace(/https?:\/\/\S+/g, "[URL]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "unbekannter Fehler";
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

// ── Messwerte bauen ───────────────────────────────────────────────────────────

export function messwert<T>(
  wert: T | null,
  status: MessStatus,
  quelle: string,
  hinweis?: string,
  gemessenAm: string | null = new Date().toISOString(),
): Messwert<T> {
  const m: Messwert<T> = { wert, status, quelle, gemessen_am: gemessenAm };
  if (hinweis) m.hinweis = hinweis;
  return m;
}

/** Gescheiterte Messung: kein Wert, Zeitpunkt des Versuchs, bereinigter Grund. */
export function fehlgeschlagen<T>(quelle: string, e: unknown): Messwert<T> {
  return messwert<T>(null, "fehler", quelle, bereinigeFehler(e));
}

/** Nicht messbar: wert null, gemessen_am null, Grund im Hinweis — nie 0 als Platzhalter. */
export function nichtGemessen(quelle: string, hinweis: string): Messwert<null> {
  return { wert: null, status: "nicht_gemessen", quelle, gemessen_am: null, hinweis };
}

/** Hinweise aneinanderhängen, leere weglassen. */
export function verbinde(...teile: Array<string | undefined | null | false>): string | undefined {
  const t = teile.filter((x): x is string => typeof x === "string" && x.length > 0);
  return t.length > 0 ? t.join(" · ") : undefined;
}

// ── Zeilen prüfen ─────────────────────────────────────────────────────────────
// Der Supabase-Client ist ungetypt; Zeilen werden zur Laufzeit geprüft statt per Cast
// geglaubt. Unerwartete Form ist ein Fehler, kein stiller Ersatzwert.

export function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function textOderNull(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

/** Zeitstempel als ISO-String; null, wenn fehlend oder nicht lesbar. */
export function isoOderNull(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const ms = Date.parse(x);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Endliche Zahl (auch als Zahl-String gespeichert); sonst null. */
export function zahlOderNull(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Supabase-Antwort mit error in eine Ausnahme wandeln (die Messung fängt sie). */
export function pruefeAntwort(res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(res.error.message || "Supabase-Fehler ohne Meldung");
}

/** Exakte Zählung aus einer count-Abfrage; fehlt sie, ist das ein Fehler, keine 0. */
export function zaehlung(res: { error: { message: string } | null; count: number | null }): number {
  pruefeAntwort(res);
  if (typeof res.count !== "number") throw new Error("Zählung ohne Ergebnis");
  return res.count;
}

// ── Seitenweise laden ─────────────────────────────────────────────────────────
// Supabase kappt jede Antwort serverseitig (Projekt-Einstellung "Max rows", Standard
// 1000). Ein einzelnes limit(5000) käme still mit 1000 Zeilen zurück, und
// "abgeschnitten" stünde fälschlich auf false. Deshalb: Seiten per range(), exakte
// Gesamtzahl aus der ersten Seite, Dubletten über id verworfen (neue Zeilen während des
// Ladens verschieben die Seitengrenzen).

export interface Seitenergebnis {
  zeilen: Record<string, unknown>[];
  /** Exakte Zahl aller passenden Zeilen; null, wenn Supabase keine Zählung lieferte. */
  gesamt: number | null;
  /** true, wenn nicht alle passenden Zeilen geladen wurden. */
  abgeschnitten: boolean;
}

type Seitenabfrage = (
  von: number,
  bis: number,
  mitZaehlung: boolean,
) => PromiseLike<{ data: unknown; error: { message: string } | null; count: number | null }>;

export async function ladeSeitenweise(
  seite: Seitenabfrage,
  hoechstens: number,
  seitengroesse = 1000,
): Promise<Seitenergebnis> {
  const zeilen: Record<string, unknown>[] = [];
  const gesehen = new Set<string>();
  let gesamt: number | null = null;
  let von = 0;
  let ersteSeite = true;

  while (zeilen.length < hoechstens) {
    const bis = von + Math.min(seitengroesse, hoechstens - zeilen.length) - 1;
    const res = await seite(von, bis, ersteSeite);
    pruefeAntwort(res);
    if (ersteSeite && typeof res.count === "number") gesamt = res.count;
    ersteSeite = false;

    const daten: unknown[] = Array.isArray(res.data) ? res.data : [];
    if (daten.length === 0) break;
    for (const z of daten) {
      if (!istObjekt(z)) throw new Error("unerwartete Zeilenform");
      const schluessel = String(z.id);
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      zeilen.push(z);
      if (zeilen.length >= hoechstens) break;
    }
    von += daten.length;
    // Abbruch nach eindeutigen Zeilen, nicht nach Offset: schiebt eine neue Zeile die
    // Seitengrenze, holt die nächste Seite die letzte alte Zeile noch ab.
    if (gesamt !== null && zeilen.length >= gesamt) break;
  }

  const abgeschnitten = gesamt !== null ? zeilen.length < gesamt : zeilen.length >= hoechstens;
  return { zeilen, gesamt, abgeschnitten };
}

// ── Herkunft einer POST-Anfrage (Gesamtprüfung 06.11.2026) ────────────────────
// Im Dev-Modus lässt die Middleware jede Anfrage durch (src/middleware.ts, NODE_ENV ≠
// production), und Next blockt Cross-Site-Anfragen dort nur für /_next und /__nextjs. Eine
// fremde Webseite im selben Browser konnte deshalb per einfachem POST (no-cors, ohne
// Preflight) bezahlte Läufe starten. Die POST-Routen prüfen deshalb selbst, vor jedem
// bezahlten Aufruf und vor jedem Schreiben:
// 1. Sec-Fetch-Site: Ist der Header gesetzt, gilt nur "same-origin". Browser setzen ihn bei
//    jedem fetch; Server-zu-Server-Aufrufe (Node-fetch, curl) setzen ihn nicht (gemessen
//    Node 25.3: sec-fetch-mode, aber kein sec-fetch-site).
// 2. Content-Type application/json: Ein Browser schickt ihn nur nach einem CORS-Preflight
//    mit, den diese Routen nicht beantworten — eine fremde Seite kann ihn nicht setzen.
// Die Middleware selbst bleibt unverändert (gesperrt, Inhaber-Entscheidung R7).

export interface HerkunftsSperre {
  status: 403 | 415;
  fehler: string;
}

interface Kopfzeilen {
  get(name: string): string | null;
}

const JSON_TYP = /^application\/json\s*(?:;|$)/i;

/** null = Anfrage zulässig; sonst Status und Meldung für die Antwort (fail-closed). */
export function pruefeAnfrageHerkunft(kopf: Kopfzeilen): HerkunftsSperre | null {
  const seite = kopf.get("sec-fetch-site");
  if (seite !== null && seite.trim().toLowerCase() !== "same-origin") {
    return { status: 403, fehler: `Anfrage abgelehnt: nicht von dieser Seite (Sec-Fetch-Site ${seite.trim() || "leer"})` };
  }
  const typ = kopf.get("content-type");
  if (typ === null || !JSON_TYP.test(typ.trim())) {
    return { status: 415, fehler: "Anfrage abgelehnt: Content-Type application/json erforderlich" };
  }
  return null;
}

// ── Protokollfehler der activate-Antwort (Gesamtprüfung 06.11.2026) ───────────
// activate liefert seine Protokollfehler als Liste (protokoll_fehler_liste, je Eintrag
// bereinigt) und zusätzlich als Text (protokoll_fehler, mit PROTOKOLL_TRENNER verbunden).
// Vorher lasen Pipeline und delegate nur den Text und kürzten ihn als EINEN Eintrag auf 160
// Zeichen: spätere Vermerke wie "metrics-Insert" fielen weg. Leser nehmen deshalb die Liste;
// fehlt sie, wird der Text am Trenner geteilt (Restrisiko: ein Fehlertext, der selbst "; "
// enthält, wird zerteilt — es geht nichts verloren, nur die Grenze liegt falsch).

export const PROTOKOLL_TRENNER = "; ";

export interface ProtokollLesung {
  eintraege: string[];
  /** true, wenn ein Feld eine unerwartete Form hatte (Vertragsbruch; fail-closed melden). */
  unlesbar: boolean;
}

function textEintraege(werte: readonly unknown[]): ProtokollLesung {
  const eintraege: string[] = [];
  let unlesbar = false;
  for (const w of werte) {
    if (typeof w !== "string") unlesbar = true;
    else if (w.trim() !== "") eintraege.push(w.trim());
  }
  return { eintraege, unlesbar };
}

/**
 * Protokollfehler aus der activate-Antwort, roh (Aufrufer bereinigen je Eintrag). liste =
 * protokoll_fehler_liste, text = protokoll_fehler (Text; Liste aus der Zeit vor der Fixrunde).
 */
export function leseProtokollEintraege(liste: unknown, text: unknown): ProtokollLesung {
  if (Array.isArray(liste)) {
    const gelesen = textEintraege(liste);
    // Liste leer, aber Text gesetzt: Widerspruch — dann zählt der Text (nichts geht verloren).
    if (gelesen.eintraege.length > 0 || gelesen.unlesbar || typeof text !== "string" || text.trim() === "") return gelesen;
  } else if (liste !== undefined && liste !== null) {
    const ausText = leseProtokollEintraege(undefined, text);
    return { eintraege: ausText.eintraege, unlesbar: true };
  }
  if (text === undefined || text === null) return { eintraege: [], unlesbar: false };
  if (typeof text === "string") return textEintraege(text.split(PROTOKOLL_TRENNER));
  if (Array.isArray(text)) return textEintraege(text);
  return { eintraege: [], unlesbar: true };
}

// ── Abschneide-Status einer Claude-Antwort ────────────────────────────────────

/** stop_reason, mit denen eine Antwort der Messages API (ohne Werkzeuge) vollständig ist. */
const VOLLSTAENDIGE_STOP_REASONS: readonly string[] = ["end_turn", "stop_sequence"];

/**
 * Befund R16 (06.11.2026): false nur bei stop_reason "end_turn" oder "stop_sequence"; true
 * bei jedem anderen gemeldeten Grund (max_tokens, refusal, pause_turn, …); null, wenn keiner
 * gemeldet ist. Leser behandeln null wie unvollständig (fail-closed).
 */
export function abschneideStatus(stopReason: unknown): boolean | null {
  if (typeof stopReason !== "string" || stopReason.trim() === "") return null;
  return !VOLLSTAENDIGE_STOP_REASONS.includes(stopReason);
}

// ── Fehlläufe (Befund R8, 06.11.2026) ─────────────────────────────────────────
// Ein bezahlter Aufruf ohne verwertbare Antwort (leer, unlesbar, abgeschnittener oder
// ungültiger Plan) wird als eigene messages-Zeile gespeichert. Sonst fehlen ausgerechnet die
// teuersten Läufe in den Kosten.

export type FehllaufArt = "aktivierung" | "planung";

export interface Fehllauf {
  art: FehllaufArt;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Schätzung über schaetzeKostenUsd (lib/kosten.ts); null, wenn usage fehlt. */
  cost_usd: number | null;
  /** Kennung der Preistabelle für cost_usd: PREIS_STAND_AB aus lib/kosten.ts (siehe werteKostenAus). */
  preis_stand: string;
  stop_reason: string | null;
  /** Kurzer Grund, z. B. "leere Antwort"; wird bereinigt gespeichert. */
  grund: string;
}

/** metadata einer Fehllauf-Zeile; zusatz (auftrag_id, latency_ms) kann die Vertragsfelder nicht überschreiben. */
export function fehllaufMetadaten(f: Fehllauf, zusatz: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...zusatz,
    source: QUELLE_FEHLLAUF,
    art: f.art,
    model: f.model,
    input_tokens: f.input_tokens,
    output_tokens: f.output_tokens,
    cost_usd: f.cost_usd,
    preis_stand: f.preis_stand,
    stop_reason: f.stop_reason,
    grund: bereinigeFehler(f.grund),
  };
}

// ── Summen der Agenten-Zeile (Befund R22 d, 06.11.2026) ───────────────────────
// activate liest die Summen vor dem Claude-Aufruf und schreibt danach. Damit kein paralleler
// Lauf verloren geht, schreibt die Route nur bedingt: das Update trifft die Zeile nur, wenn
// die Summen noch die gelesenen Werte haben (null per IS NULL). Trifft es nichts, liest die
// Route neu und versucht es erneut. Ohne Datenbank-Änderung (keine RPC).

export const SUMMEN_SPALTEN = ["total_input_tokens", "total_output_tokens", "total_cost_usd"] as const;
export type SummenSpalte = (typeof SUMMEN_SPALTEN)[number];

export interface SummenBedingung {
  spalte: SummenSpalte;
  /** Gelesener Wert für eq; null heißt: mit .is(spalte, null) vergleichen. */
  alt: number | string | null;
}

export type SummenPlan =
  | { ok: true; neu: Record<SummenSpalte, number>; bedingungen: SummenBedingung[] }
  | { ok: false; grund: string };

/** Neue Summen aus der gelesenen Zeile und dem Zuwachs eines Laufs; fail-closed bei unlesbaren Werten. */
export function planeSummen(alt: Record<string, unknown>, zuwachs: Record<SummenSpalte, number>): SummenPlan {
  const neu = {} as Record<SummenSpalte, number>;
  const bedingungen: SummenBedingung[] = [];
  for (const spalte of SUMMEN_SPALTEN) {
    const plus = zuwachs[spalte];
    if (typeof plus !== "number" || !Number.isFinite(plus) || plus < 0) {
      return { ok: false, grund: `Zuwachs für ${spalte} ungültig` };
    }
    if (!(spalte in alt)) return { ok: false, grund: `Spalte ${spalte} fehlt in der gelesenen Zeile` };
    const roh = alt[spalte];
    if (roh === null || roh === undefined) {
      // Spalte ohne Wert: Basis 0, verglichen wird mit IS NULL.
      neu[spalte] = plus;
      bedingungen.push({ spalte, alt: null });
      continue;
    }
    const basis = typeof roh === "number" || typeof roh === "string" ? zahlOderNull(roh) : null;
    if (basis === null || basis < 0) return { ok: false, grund: `${spalte} nicht lesbar` };
    neu[spalte] = basis + plus;
    bedingungen.push({ spalte, alt: typeof roh === "number" ? roh : String(roh) });
  }
  return { ok: true, neu, bedingungen };
}

// ── Zusammenfassung der Auftragszeile (Befunde R32, R33) ──────────────────────

export interface LaufKern {
  fehler: string | null;
  abgeschnitten: boolean | null;
  cost: number | null;
}

/**
 * Erfolgreich ist ein Lauf nur mit fehler === null UND abgeschnitten === false. Die Summe
 * nimmt nur Läufe mit Kostenangabe; hat keiner eine, ist sie null statt 0.
 */
export function fasseLaeufeZusammen(laeufe: readonly LaufKern[]): AusfuehrungAntwort["summary"] {
  let erfolgreich = 0;
  let summe = 0;
  let mitKosten = 0;
  let ohneKosten = 0;
  for (const l of laeufe) {
    if (l.fehler === null && l.abgeschnitten === false) erfolgreich++;
    if (typeof l.cost === "number" && Number.isFinite(l.cost)) {
      summe += l.cost;
      mitKosten++;
    } else {
      ohneKosten++;
    }
  }
  return {
    agents_activated: erfolgreich,
    total_cost_usd_geschaetzt: mitKosten > 0 ? Math.round(summe * 100000) / 100000 : null,
    laeufe_ohne_kosten: ohneKosten,
  };
}

// ── Kosten für GET /api/status (Befunde R8, R20) ──────────────────────────────

export interface KostenZeile {
  /** Zeitstempel der messages-Zeile. */
  zeit: unknown;
  /** metadata.cost_usd */
  kosten: unknown;
  /** metadata.source */
  quelle: unknown;
  /** metadata.art (nur bei Fehlläufen) */
  art: unknown;
  /** metadata.preis_stand: Kennung der Preistabelle; fehlt bei Zeilen von vor ihrem Deploy. */
  preisStand: unknown;
}

export interface KostenAuswertung {
  wert: KostenWert;
  /** "warnung" nur, wenn der Monat unvollständig oder die Abfrage abgeschnitten ist. */
  status: "ok" | "warnung";
  /** Einzelhinweise in Lesereihenfolge; den allgemeinen Kostenhinweis stellt die Route davor. */
  hinweise: string[];
}

function anzahlLaeufe(n: number): string {
  return n === 1 ? "1 Lauf" : `${n} Läufe`;
}

/**
 * Summiert die geladenen Kostenzeilen des Monats. zeilen sind neueste zuerst geladen: Ist die
 * Abfrage abgeschnitten, fehlen die ältesten Zeilen, der heutige Tag nur, wenn die geladenen
 * Zeilen nicht bis Mitternacht zurückreichen.
 *
 * preisStandAb ist PREIS_STAND_AB (lib/kosten.ts). activate und delegate schreiben diese
 * Kennung in metadata.preis_stand (Nachprüfung 06.11.2026). Alte Preise werden nach Kennung
 * gezählt, nicht nach Datum: Bis zum tatsächlichen Deploy rechnet der laufende Stand mit der
 * alten Formel, auch nach PREIS_STAND_AB und über den Monatswechsel hinaus. Eine summierte
 * Zeile ohne Kennung stammt von vor dem Deploy (alte Formel, jedes Sonnet-Modell 3/15, sonst
 * 0,8/4 USD je Mio. Tokens); eine mit anderer Kennung von einer anderen Tabelle.
 */
export function werteKostenAus(
  zeilen: readonly KostenZeile[],
  lauf: { gesamt: number | null; abgeschnitten: boolean },
  jetzt: Date,
  preisStandAb: string,
): KostenAuswertung {
  const monatsbeginn = monatsbeginnBerlin(jetzt);
  const mitternacht = mitternachtBerlin(jetzt);
  const heuteAb = mitternacht.getTime();

  let monat = 0;
  let heute = 0;
  let planungMonat = 0;
  let planungHeute = 0;
  let ohneMonat = 0;
  let ohneHeute = 0;
  let summiert = 0;
  let ohneKennung = 0;
  let andereKennung = 0;
  let aeltesteMs = Number.POSITIVE_INFINITY;
  for (const z of zeilen) {
    const ms = Date.parse(String(z.zeit));
    if (!Number.isFinite(ms)) throw new Error("Kostenzeile ohne lesbare Zeit");
    aeltesteMs = Math.min(aeltesteMs, ms);
    const istHeute = ms >= heuteAb;
    const zahl = zahlOderNull(z.kosten);
    const kosten = zahl !== null && zahl >= 0 ? zahl : null;
    if (kosten === null) {
      ohneMonat++;
      if (istHeute) ohneHeute++;
      continue;
    }
    const planung = z.quelle === QUELLE_PLANUNG || (z.quelle === QUELLE_FEHLLAUF && z.art === "planung");
    summiert++;
    monat += kosten;
    if (planung) planungMonat += kosten;
    if (istHeute) {
      heute += kosten;
      if (planung) planungHeute += kosten;
    }
    const kennung = typeof z.preisStand === "string" && z.preisStand.trim() !== "" ? z.preisStand.trim() : null;
    if (kennung === null) ohneKennung++;
    else if (kennung !== preisStandAb) andereKennung++;
  }

  const heuteAbgeschnitten = lauf.abgeschnitten && aeltesteMs >= heuteAb;
  const heuteVollstaendig = !heuteAbgeschnitten && ohneHeute === 0;
  const monatVollstaendig = !lauf.abgeschnitten && ohneMonat === 0;
  const runde = (x: number) => Math.round(x * 1e6) / 1e6;

  const hinweise: string[] = [
    `Monat ab ${berlinAnzeige(monatsbeginn)}, heute ab ${berlinAnzeige(mitternacht)} (Europe/Berlin).`,
  ];
  if (!monatVollstaendig) {
    const fehlt: string[] = [];
    if (ohneMonat > 0) fehlt.push(`${anzahlLaeufe(ohneMonat)} ohne Kostenangabe nicht summiert (davon heute ${ohneHeute})`);
    if (lauf.abgeschnitten) {
      fehlt.push(
        `Abfrage abgeschnitten: nur die jüngsten ${zeilen.length} von ${lauf.gesamt ?? "unbekannt vielen"} Läufen geladen, die älteren fehlen`,
      );
    }
    hinweise.push(`Monatssumme unvollständig: ${fehlt.join("; ")}.`);
    if (heuteVollstaendig) {
      hinweise.push("Tagessumme vollständig.");
    } else {
      const fehltHeute: string[] = [];
      if (ohneHeute > 0) fehltHeute.push(`${anzahlLaeufe(ohneHeute)} von heute ohne Kostenangabe`);
      if (heuteAbgeschnitten) fehltHeute.push("die geladenen Läufe reichen nicht bis Mitternacht zurück");
      hinweise.push(`Tagessumme unvollständig: ${fehltHeute.join("; ")}.`);
    }
  }
  const tabelle = datumAnzeige(preisStandAb);
  if (ohneKennung > 0) {
    hinweise.push(
      `${ohneKennung} von ${summiert} summierten Läufen ohne Preis-Kennung: vor dem Deploy der Preistabelle vom ${tabelle} geschrieben, mit der alten Tabelle geschätzt (Sonnet zu hoch, Haiku zu niedrig) und nicht umgerechnet.`,
    );
  }
  if (andereKennung > 0) {
    hinweise.push(
      `${andereKennung} von ${summiert} summierten Läufen mit einer anderen Preistabelle geschätzt (Kennung nicht ${tabelle}) und nicht umgerechnet.`,
    );
  }
  if (lauf.gesamt === null) hinweise.push("Supabase lieferte keine Gesamtzahl; laeufe_monat = geladene Zeilen.");

  return {
    wert: {
      heute_usd: runde(heute),
      monat_usd: runde(monat),
      planung_heute_usd: runde(planungHeute),
      planung_monat_usd: runde(planungMonat),
      laeufe_monat: lauf.gesamt ?? zeilen.length,
      ohne_kosten_heute: ohneHeute,
      ohne_kosten_monat: ohneMonat,
      heute_vollstaendig: heuteVollstaendig,
      monat_vollstaendig: monatVollstaendig,
      abgeschnitten: lauf.abgeschnitten,
    },
    status: monatVollstaendig ? "ok" : "warnung",
    hinweise,
  };
}

// ── Totmann für Crons und Agenten (Objekt-Studio Stufe 2, Rest aus Stufe 1) ───────────────────
// Spezifikation: docs/intern/objekt-studio-stufe-2.md §2.2–2.5. Der Plan steht in lib/totmann.ts,
// die Tabelle in scripts/lauf_nachweis.sql (Entwurf, nicht ausgeführt). Die Schreiber
// (api/cron/briefing, api/content/auto-produce) hängen nach bestandener Secret-Prüfung genau eine
// Zeile an; GET /api/status liest je Job die jüngste und bewertet sie hier. Agenten bekommen
// keinen eigenen Alterswächter: Ihr Ergebnis steht je Lauf in teilergebnisse (§2.2 Punkt 5).

/** Werte des CHECK auf lauf_nachweis.ergebnis (scripts/lauf_nachweis.sql). */
export const LAUF_ERGEBNISSE: readonly LaufErgebnis[] = ["ok", "teilweise", "fehler", "uebersprungen"];

/** Höchstlänge von lauf_nachweis.hinweis (CHECK char_length(hinweis) <= 300). */
export const NACHWEIS_HINWEIS_MAX = 300;

/** Ein Lauf zählt für den Sollzeitpunkt S, wenn er frühestens 10 min vor S begann (§2.3). */
export const VORLAUF_MS = 10 * 60_000;

/** Kennung eines Jobs wie der CHECK auf lauf_nachweis.job. */
const JOB_MUSTER = /^[a-z0-9-]{1,40}$/;
const UHRZEIT_MUSTER = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** So weit sucht letzterSollzeitpunkt zurück; bei Mo–Fr liegen höchstens 3 Tage zwischen zwei Sollzeitpunkten. */
const SOLL_SUCHE_TAGE = 14;
const WOCHENTAG_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/**
 * Rangfolge für "die Farbe des schlechtesten Jobs" (§2.3): fehler vor warnung vor nicht_gemessen
 * vor ok. Setzung: Ein bekannter Mangel (bernstein) wiegt schwerer als ein noch ausstehendes
 * Urteil, ein ausstehendes Urteil schwerer als "ok". Dieselbe Folge nutzt cronsAnzeige (lib/types.ts).
 */
export const STATUS_RANG: Readonly<Record<MessStatus, number>> = { ok: 0, nicht_gemessen: 1, warnung: 2, fehler: 3 };

const LAGE_STATUS: Readonly<Record<Exclude<CronLage, "nicht_lesbar">, MessStatus>> = {
  ok: "ok",
  teilweise: "warnung",
  fehlgeschlagen: "fehler",
  ueberfaellig: "fehler",
  erster_sollzeitpunkt_steht_aus: "nicht_gemessen",
  aus: "warnung",
  laeuft_obwohl_aus: "fehler",
};

function zweistellig(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2026-07-30" streng als Kalendertag lesen; sonst Fehler (die Messung wird "fehler", nicht geraten). */
function kalendertag(datum: string, was: string): { jahr: number; monat: number; tag: number } {
  const m = DATUM.exec(datum);
  if (m) {
    const [jahr, monat, tag] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const probe = new Date(Date.UTC(jahr, monat - 1, tag));
    if (probe.getUTCFullYear() === jahr && probe.getUTCMonth() === monat - 1 && probe.getUTCDate() === tag) {
      return { jahr, monat, tag };
    }
  }
  throw new Error(`${was} unlesbar (erwartet JJJJ-MM-TT)`);
}

/** 00:00 Europe/Berlin des Kalendertags datum, um versatzTage verschoben. */
function berlinTagAus(datum: string, was: string, versatzTage = 0): Date {
  const d = kalendertag(datum, was);
  const k = new Date(Date.UTC(d.jahr, d.monat - 1, d.tag + versatzTage));
  return berlinTagesbeginn(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate());
}

/** "Mo 09.11. 08:03" in Europe/Berlin — der Browser kann in einer anderen Zeitzone stehen. */
function berlinSollAnzeige(d: Date): string {
  const w = berlinWandzeit(d);
  const wochentag = new Date(Date.UTC(w.jahr, w.monat - 1, w.tag)).getUTCDay();
  return `${WOCHENTAG_KURZ[wochentag]} ${zweistellig(w.tag)}.${zweistellig(w.monat)}. ${zweistellig(w.stunde)}:${zweistellig(w.minute)}`;
}

/** Prüft einen Plan-Eintrag; ein kaputter Plan ist ein Fehler der Messung, kein stiller Ersatzwert. */
function pruefePlanJob(job: TotmannJob): { stunde: number; minute: number } {
  if (!JOB_MUSTER.test(job.job)) throw new Error("Plan: Job-Kennung ungültig (erlaubt a–z, 0–9, -; höchstens 40 Zeichen)");
  if (job.zeitzone !== "Europe/Berlin") throw new Error(`Plan ${job.job}: Zeitzone nicht unterstützt`);
  const m = UHRZEIT_MUSTER.exec(job.uhrzeit);
  if (!m) throw new Error(`Plan ${job.job}: Uhrzeit unlesbar (erwartet HH:MM)`);
  if (!Number.isFinite(job.karenz_h) || job.karenz_h < 0) throw new Error(`Plan ${job.job}: Karenz ungültig`);
  if (job.wochentage.some((t) => !Number.isInteger(t) || t < 0 || t > 6)) throw new Error(`Plan ${job.job}: Wochentag ungültig`);
  if (!job.aktiv) kalendertag(job.aus_seit ?? "", `Plan ${job.job}: aus_seit`);
  return { stunde: Number(m[1]), minute: Number(m[2]) };
}

function wochentageText(tage: readonly number[]): string {
  // Montag zuerst, wie im Plan.
  const sortiert = [...new Set(tage)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (sortiert.join(",") === "1,2,3,4,5") return "Mo–Fr";
  if (sortiert.length === 7) return "täglich";
  if (sortiert.length === 0) return "an keinem Wochentag";
  return sortiert.map((t) => WOCHENTAG_KURZ[t]).join(", ");
}

/** Plan in Worten, z. B. "Mo–Fr 08:03 (Europe/Berlin), Karenz 2 h". */
function planText(job: TotmannJob): string {
  return `${wochentageText(job.wochentage)} ${job.uhrzeit} (${job.zeitzone}), Karenz ${String(job.karenz_h).replace(".", ",")} h`;
}

/**
 * Sollzeitpunkt S (§2.3): der jüngste geplante Zeitpunkt, für den S + Karenz ≤ jetzt gilt — aus
 * Wochentagen und Uhrzeit des Plans in Europe/Berlin, Sommerzeit über Intl (ohne Fremdbibliothek).
 * Das Wochenende hat keinen Sollzeitpunkt, weil die Wochentage Sa und So nicht enthalten.
 * null, wenn in den letzten 14 Tagen keiner liegt (z. B. ohne Wochentage).
 */
export function letzterSollzeitpunkt(job: TotmannJob, jetzt: Date): Date | null {
  const { stunde, minute } = pruefePlanJob(job);
  const grenze = jetzt.getTime() - job.karenz_h * STUNDE_MS;
  if (!Number.isFinite(grenze)) throw new Error("Zeitpunkt unlesbar");
  // Ein Sollzeitpunkt an einem späteren Berliner Kalendertag als die Grenze liegt immer nach ihr;
  // gesucht wird deshalb ab dem Kalendertag der Grenze rückwärts.
  const w = berlinWandzeit(new Date(grenze));
  for (let i = 0; i <= SOLL_SUCHE_TAGE; i++) {
    const k = new Date(Date.UTC(w.jahr, w.monat - 1, w.tag - i));
    if (!job.wochentage.includes(k.getUTCDay())) continue;
    const s = berlinZeitpunkt(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate(), stunde, minute);
    if (s.getTime() <= grenze) return s;
  }
  return null;
}

function jobStand(
  job: TotmannJob,
  lage: CronLage,
  status: MessStatus,
  soll: Date | null,
  letzterLauf: LaufNachweisLesung | null,
): CronJobStand {
  return {
    job: job.job,
    bezeichnung: job.bezeichnung,
    plan: planText(job),
    fundstelle: job.fundstelle,
    aktiv: job.aktiv,
    aus_seit: job.aus_seit,
    grund: job.grund,
    lage,
    status,
    sollzeitpunkt: soll ? soll.toISOString() : null,
    sollzeitpunkt_berlin: soll ? berlinSollAnzeige(soll) : null,
    letzter_lauf: letzterLauf,
  };
}

/**
 * Bewertet einen Job nach der Tabelle in §2.3. letzterLauf = jüngste Zeile des Jobs (begonnen_am);
 * eine Zeile eines anderen Jobs (etwa der Probe) zählt nicht. nachweisSeit = NACHWEIS_SEIT.
 * - aus: Begann der Lauf nach dem Tag aus_seit (ab 00:00 Europe/Berlin des Folgetags), heißt es
 *   "läuft, obwohl als aus geführt" (rot, Stolperdraht); sonst "aus" (bernstein).
 * - aktiv: S = letzterSollzeitpunkt. Liegt S vor nachweisSeit oder gibt es keinen, steht der erste
 *   Sollzeitpunkt aus (nicht gemessen). Ein Lauf mit begonnen_am ≥ S − 10 min entscheidet: ok und
 *   uebersprungen grün, teilweise bernstein, fehler rot. Ohne solchen Lauf: überfällig (rot).
 */
export function bewerteJob(
  job: TotmannJob,
  letzterLauf: LaufNachweisLesung | null,
  jetzt: Date,
  nachweisSeit: string,
): CronJobStand {
  pruefePlanJob(job);
  const lauf = letzterLauf !== null && letzterLauf.job === job.job ? letzterLauf : null;
  const begonnenMs = lauf ? Date.parse(lauf.begonnen_am) : Number.NaN;
  if (lauf && !Number.isFinite(begonnenMs)) throw new Error(`Lauf ${job.job}: begonnen_am unlesbar`);

  if (!job.aktiv) {
    const ab = berlinTagAus(job.aus_seit ?? "", `Plan ${job.job}: aus_seit`, 1);
    const trotzdem = lauf !== null && begonnenMs >= ab.getTime();
    return trotzdem
      ? jobStand(job, "laeuft_obwohl_aus", LAGE_STATUS.laeuft_obwohl_aus, null, lauf)
      : jobStand(job, "aus", LAGE_STATUS.aus, null, lauf);
  }

  const soll = letzterSollzeitpunkt(job, jetzt);
  const seit = berlinTagAus(nachweisSeit, "NACHWEIS_SEIT");
  if (soll === null || soll.getTime() < seit.getTime()) {
    return jobStand(job, "erster_sollzeitpunkt_steht_aus", LAGE_STATUS.erster_sollzeitpunkt_steht_aus, soll, lauf);
  }
  if (lauf === null || begonnenMs < soll.getTime() - VORLAUF_MS) {
    return jobStand(job, "ueberfaellig", LAGE_STATUS.ueberfaellig, soll, lauf);
  }
  const lage: CronLage =
    lauf.ergebnis === "ok" || lauf.ergebnis === "uebersprungen"
      ? "ok"
      : lauf.ergebnis === "teilweise"
        ? "teilweise"
        : "fehlgeschlagen";
  return jobStand(job, lage, LAGE_STATUS[lage], soll, lauf);
}

/**
 * Eine Zeile aus lauf_nachweis zur Laufzeit prüfen (der Supabase-Client ist ungetypt). null =
 * unlesbar; die Bewertung meldet das als "nicht lesbar", statt einen Ersatzwert zu glauben.
 */
export function leseLaufNachweis(zeile: unknown): LaufNachweisLesung | null {
  if (!istObjekt(zeile)) return null;
  const job = textOderNull(zeile.job);
  const begonnen = isoOderNull(zeile.begonnen_am);
  const ergebnis = zeile.ergebnis;
  if (job === null || begonnen === null || !LAUF_ERGEBNISSE.some((e) => e === ergebnis)) return null;
  let beendet: string | null = null;
  if (zeile.beendet_am !== null && zeile.beendet_am !== undefined) {
    beendet = isoOderNull(zeile.beendet_am);
    if (beendet === null) return null;
  }
  let http: number | null = null;
  if (zeile.http_status !== null && zeile.http_status !== undefined) {
    http = zahlOderNull(zeile.http_status);
    if (http === null || !Number.isInteger(http) || http < 100 || http > 599) return null;
  }
  const roh = zeile.teilergebnisse ?? [];
  if (!Array.isArray(roh)) return null;
  const teilergebnisse: LaufTeilergebnis[] = [];
  for (const t of roh) {
    if (!istObjekt(t) || typeof t.agent !== "string") return null;
    const teil = LAUF_ERGEBNISSE.find((e) => e === t.ergebnis);
    if (teil === undefined) return null;
    if (t.fehler !== null && t.fehler !== undefined && typeof t.fehler !== "string") return null;
    teilergebnisse.push({ agent: t.agent, ergebnis: teil, fehler: typeof t.fehler === "string" ? t.fehler : null });
  }
  if (zeile.hinweis !== null && zeile.hinweis !== undefined && typeof zeile.hinweis !== "string") return null;
  return {
    job,
    begonnen_am: begonnen,
    beendet_am: beendet,
    ergebnis: ergebnis as LaufErgebnis,
    http_status: http,
    teilergebnisse,
    hinweis: textOderNull(zeile.hinweis),
  };
}

function nichtLesbar(job: TotmannJob, jetzt: Date): CronJobStand {
  pruefePlanJob(job);
  // Ohne lesbaren Nachweis: aus bleibt bernstein mit Hinweis, aktiv wird rot (§2.3).
  return jobStand(job, "nicht_lesbar", job.aktiv ? "fehler" : "warnung", job.aktiv ? letzterSollzeitpunkt(job, jetzt) : null, null);
}

export interface TotmannBewertung {
  wert: CronsWert;
  /** Farbe des schlechtesten Jobs (STATUS_RANG). */
  status: MessStatus;
  hinweis: string | undefined;
}

/**
 * Bewertet den ganzen Plan. laeufe = gelesene Zeilen aus lauf_nachweis (GET /api/status holt je
 * Job die jüngste); je Plan-Job zählt die jüngste lesbare Zeile mit genau dieser Kennung — Probe-
 * Zeilen (content-auto-produce-probe) und fremde Jobs zählen nicht. lesefehler = bereinigter Grund,
 * warum lauf_nachweis nicht lesbar war (auch eine fehlende Tabelle); dann sind alle Jobs "nicht
 * lesbar": aus → bernstein, aktiv → rot. nachweisSeit = NACHWEIS_SEIT aus lib/totmann.ts (dieser
 * Datei fehlt der Laufzeit-Import mit Absicht).
 */
export function bewerteTotmann(
  plan: readonly TotmannJob[],
  laeufe: readonly unknown[],
  jetzt: Date,
  lesefehler: string | null,
  nachweisSeit: string,
): TotmannBewertung {
  if (plan.length === 0) throw new Error("Totmann-Plan ohne Jobs");
  berlinTagAus(nachweisSeit, "NACHWEIS_SEIT");
  const imPlan = new Set(plan.map((j) => j.job));
  if (imPlan.size !== plan.length) throw new Error("Totmann-Plan: Job-Kennung doppelt");

  const juengste = new Map<string, LaufNachweisLesung>();
  const unlesbar = new Set<string>();
  if (lesefehler === null) {
    for (const roh of laeufe) {
      const lauf = leseLaufNachweis(roh);
      if (lauf === null) {
        // Eine unlesbare Zeile macht genau ihren Job unlesbar; ohne lesbare Kennung alle Plan-Jobs.
        const kennung = istObjekt(roh) ? textOderNull(roh.job) : null;
        if (kennung === null) for (const j of imPlan) unlesbar.add(j);
        else if (imPlan.has(kennung)) unlesbar.add(kennung);
        continue;
      }
      if (!imPlan.has(lauf.job)) continue;
      const bisher = juengste.get(lauf.job);
      if (!bisher || Date.parse(lauf.begonnen_am) > Date.parse(bisher.begonnen_am)) juengste.set(lauf.job, lauf);
    }
  }

  const jobs = plan.map((job) =>
    lesefehler !== null || unlesbar.has(job.job)
      ? nichtLesbar(job, jetzt)
      : bewerteJob(job, juengste.get(job.job) ?? null, jetzt, nachweisSeit),
  );
  const status = jobs.reduce<MessStatus>((schlecht, j) => (STATUS_RANG[j.status] > STATUS_RANG[schlecht] ? j.status : schlecht), "ok");
  return {
    wert: { jobs, nachweis_seit: nachweisSeit, lesefehler },
    status,
    hinweis: verbinde(
      lesefehler !== null && `Nachweis nicht lesbar: ${lesefehler}`,
      unlesbar.size > 0 && `Zeile in lauf_nachweis unlesbar (${[...unlesbar].join(", ")})`,
      plan.some((j) => j.aktiv) && "Sollzeitpunkte in Europe/Berlin gelesen; die Zeitzone des VPS ist nicht gemessen.",
    ),
  };
}

// ── Totmann: Schreiber (Ergebnis-Ableitung, §2.2 Punkt 2) ──

/** Inhalt einer lauf_nachweis-Zeile ohne Job und Zeiten. */
export interface NachweisInhalt {
  ergebnis: LaufErgebnis;
  http_status: number | null;
  teilergebnisse: LaufTeilergebnis[];
  hinweis: string | null;
}

/** Zeile für den Insert; eingetragen_am setzt die DB (DEFAULT now()), id die Sequenz. */
export interface LaufNachweisZeile extends NachweisInhalt {
  job: string;
  /** App-Uhr. */
  begonnen_am: string;
  /** App-Uhr, dieselbe wie begonnen_am. */
  beendet_am: string;
}

/** Kern eines Briefing-Ergebnisses (BriefingErgebnis in api/cron/briefing/route.ts). */
export interface BriefingKern {
  fehler: string | null;
  abgeschnitten: boolean | null;
  stop_reason: string | null;
}

/** Höchstens NACHWEIS_HINWEIS_MAX Zeichen (Codepunkte wie char_length in Postgres). */
function kuerzeHinweis(text: string | null): string | null {
  if (text === null || text.trim() === "") return null;
  const zeichen = Array.from(text);
  return zeichen.length > NACHWEIS_HINWEIS_MAX ? `${zeichen.slice(0, NACHWEIS_HINWEIS_MAX - 1).join("")}…` : text;
}

/**
 * Teilergebnis je Agent eines Briefings: vollständig (fehler null und abgeschnitten false, wie
 * "vollstaendig" in der Briefing-Antwort) → ok; mit Fehler → fehler; sonst (abgeschnitten oder
 * Abschneide-Status nicht gemeldet) → teilweise. Fehlertexte bereinigt.
 */
export function briefingTeilergebnisse(ergebnisse: Readonly<Record<string, BriefingKern>>): LaufTeilergebnis[] {
  return Object.entries(ergebnisse).map(([agent, r]): LaufTeilergebnis => {
    if (r.fehler === null && r.abgeschnitten === false) return { agent, ergebnis: "ok", fehler: null };
    if (r.fehler !== null) return { agent, ergebnis: "fehler", fehler: bereinigeFehler(r.fehler) };
    const grund =
      r.abgeschnitten === true
        ? `Antwort abgeschnitten${r.stop_reason ? ` (stop_reason ${r.stop_reason})` : ""}`
        : "Abschneide-Status nicht gemeldet (activate-Vertrag)";
    return { agent, ergebnis: "teilweise", fehler: bereinigeFehler(grund) };
  });
}

/**
 * Ergebnis eines Briefing-Laufs: alle Agenten vollständig → ok; einige → teilweise; keiner →
 * fehler. Eine 5xx-Antwort ist immer fehler.
 */
export function briefingNachweis(httpStatus: number, ergebnisse: Readonly<Record<string, BriefingKern>>): NachweisInhalt {
  const teilergebnisse = briefingTeilergebnisse(ergebnisse);
  const n = teilergebnisse.length;
  const vollstaendig = teilergebnisse.filter((t) => t.ergebnis === "ok").length;
  const ergebnis: LaufErgebnis =
    httpStatus >= 500 || vollstaendig === 0 ? "fehler" : vollstaendig === n ? "ok" : "teilweise";
  return {
    ergebnis,
    http_status: httpStatus,
    teilergebnisse,
    hinweis: n === 0 ? "kein Agent gelaufen" : `${vollstaendig} von ${n} Agenten vollständig`,
  };
}

/**
 * Teilergebnisse je Pipeline-Stufe (steps der Antwort von /api/content/pipeline): done und
 * vollständig → ok; done, aber abgeschnitten oder ohne Abschneide-Status → teilweise; error →
 * fehler; pending (nicht mehr ausgeführt) → uebersprungen; alles andere → fehler (fail-closed).
 */
export function pipelineTeilergebnisse(schritte: unknown): LaufTeilergebnis[] {
  if (!Array.isArray(schritte)) return [];
  return schritte.map((s): LaufTeilergebnis => {
    if (!istObjekt(s) || typeof s.agent !== "string" || s.agent.trim() === "") {
      return { agent: "unbekannt", ergebnis: "fehler", fehler: "Stufe unlesbar" };
    }
    const agent = s.agent.slice(0, 40);
    if (s.status === "done") {
      if (s.abgeschnitten === false) return { agent, ergebnis: "ok", fehler: null };
      return {
        agent,
        ergebnis: "teilweise",
        fehler: s.abgeschnitten === true ? "Antwort abgeschnitten" : "Abschneide-Status nicht gemeldet (activate-Vertrag)",
      };
    }
    if (s.status === "error") {
      return { agent, ergebnis: "fehler", fehler: bereinigeFehler(typeof s.fehler === "string" ? s.fehler : "unbekannter Fehler") };
    }
    if (s.status === "pending") return { agent, ergebnis: "uebersprungen", fehler: null };
    return { agent, ergebnis: "fehler", fehler: bereinigeFehler(`Stufen-Status ${typeof s.status === "string" ? s.status : "unbekannt"}`) };
  });
}

/** Fehlertext aus der auto-produce-Antwort: Text (Route) oder Vermerk {stufe, grund} (Pipeline). */
function autoProduceFehlerText(fehler: unknown): string | null {
  if (typeof fehler === "string" && fehler.trim() !== "") return fehler;
  if (istObjekt(fehler) && typeof fehler.grund === "string") {
    return `${typeof fehler.stufe === "string" ? `${fehler.stufe}: ` : ""}${fehler.grund}`;
  }
  return null;
}

/**
 * Ergebnis eines auto-produce-Laufs (§2.2 Punkt 2): produced → ok; skipped → uebersprungen;
 * partial oder abgelehnt → teilweise; status "fehler" → fehler, AUCH bei HTTP 200 (Speicherfehler
 * oder Pipeline-fehler, api/content/auto-produce/route.ts); jede 5xx → fehler. dry_run (nur die
 * Probe) → ok. Ein unbekannter oder fehlender status ist fehler (fail-closed).
 * schritte = steps der Pipeline-Antwort, sofern die Pipeline lief.
 */
export function autoProduceNachweis(httpStatus: number, antwort: unknown, schritte: unknown): NachweisInhalt {
  const d = istObjekt(antwort) ? antwort : {};
  const status = typeof d.status === "string" ? d.status : null;
  const ergebnis: LaufErgebnis =
    httpStatus >= 500 || status === "fehler"
      ? "fehler"
      : status === "produced" || status === "dry_run"
        ? "ok"
        : status === "skipped"
          ? "uebersprungen"
          : status === "partial" || status === "abgelehnt"
            ? "teilweise"
            : "fehler";

  const teile: string[] = [status === null ? "Antwort ohne status" : `status ${status}`];
  if (ergebnis === "fehler") {
    const text = autoProduceFehlerText(d.fehler);
    if (text !== null) teile.push(bereinigeFehler(text));
    const speicherfehler = Array.isArray(d.speicherfehler)
      ? d.speicherfehler.filter((f): f is string => typeof f === "string" && f.trim() !== "")
      : [];
    if (speicherfehler.length > 0) teile.push(`Speicherfehler: ${bereinigeFehler(speicherfehler.join("; "))}`);
  } else if (status === "skipped" && typeof d.grund === "string") {
    teile.push(bereinigeFehler(d.grund));
  } else if (status === "dry_run") {
    teile.push("Probe (?dry=true), nichts produziert");
  } else if (status === "abgelehnt") {
    teile.push("COUNSEL hat abgelehnt");
  } else if (status === "partial" && istObjekt(d.pipeline) && typeof d.pipeline.completed === "string") {
    teile.push(`Pipeline-Stufen ${d.pipeline.completed}`);
  }
  return { ergebnis, http_status: httpStatus, teilergebnisse: pipelineTeilergebnisse(schritte), hinweis: teile.join(" · ") };
}

/** Der Lauf warf, bevor eine Antwort stand: fehler, ohne HTTP-Status (den setzt dann Next). */
export function ausnahmeNachweis(e: unknown, teilergebnisse: LaufTeilergebnis[] = []): NachweisInhalt {
  return { ergebnis: "fehler", http_status: null, teilergebnisse, hinweis: `Ausnahme: ${bereinigeFehler(e)}` };
}

/**
 * App-Uhr eines Laufs (§2.2: begonnen_am und beendet_am beide aus der App-Uhr, die DB setzt nur
 * eingetragen_am). beendet_am = begonnen_am + monotone Dauer (performance.now()): So hält der
 * CHECK beendet_am >= begonnen_am auch, wenn die Systemuhr während des Laufs zurückspringt.
 */
export function starteLaufUhr(): { begonnen: Date; beendet: () => Date } {
  const begonnen = new Date();
  const start = performance.now();
  return { begonnen, beendet: () => new Date(begonnen.getTime() + Math.max(0, Math.floor(performance.now() - start))) };
}

/** Zeile für lauf_nachweis; prüft, was die CHECKs in scripts/lauf_nachweis.sql verlangen. */
export function laufNachweisZeile(job: string, begonnenAm: Date, beendetAm: Date, inhalt: NachweisInhalt): LaufNachweisZeile {
  if (!JOB_MUSTER.test(job)) throw new Error("Job-Kennung ungültig");
  const von = begonnenAm.getTime();
  const bis = beendetAm.getTime();
  if (!Number.isFinite(von) || !Number.isFinite(bis)) throw new Error("Laufzeit unlesbar");
  if (bis < von) throw new Error("beendet_am liegt vor begonnen_am");
  if (!LAUF_ERGEBNISSE.includes(inhalt.ergebnis)) throw new Error("Ergebnis ungültig");
  const http = inhalt.http_status;
  return {
    job,
    begonnen_am: begonnenAm.toISOString(),
    beendet_am: beendetAm.toISOString(),
    ergebnis: inhalt.ergebnis,
    http_status: http !== null && Number.isInteger(http) && http >= 100 && http <= 599 ? http : null,
    teilergebnisse: inhalt.teilergebnisse,
    hinweis: kuerzeHinweis(inhalt.hinweis),
  };
}
