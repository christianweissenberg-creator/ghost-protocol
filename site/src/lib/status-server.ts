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

import type { AusfuehrungAntwort } from "./auftrag-types";
import type { KostenWert, MessStatus, Messwert } from "./status-types";

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
