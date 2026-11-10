// Objekt-Studio Schritt 7 (10.11.2026): Zugriff auf den privaten Bucket „studio“ — nur auf dem Server.
//
// - Lesen nur gestreamt (download(...).asStream()): SHA-256 und Größe entstehen beim Lesen; behalten wird der
//   Inhalt nur, wenn ihn der Startbild-Abgleich braucht. Größer als DATEI_MAX_BYTES wird nicht gelesen.
// - Geschrieben wird nur per move auf neue Pfade (eingang/ → arbeit/ → Inhalts-Pfad), nie mit upsert; ein
//   Upload-Token kann den Arbeits- und den Inhalts-Pfad nicht erreichen.
// - Gelöscht wird nur unter eingang/ und arbeit/ (istAufraeumbar), nie ein Inhalts-Pfad. Jede POST-Route der
//   Medien-Familie räumt dort Reste älter als AUFRAEUMEN_AB_MS auf (Laufzeit der Upload-Token: 2 h laut
//   Supabase-Doku), ausgenommen die Dateien der laufenden Anfrage; GET-Routen löschen nie.
// - Prozess-Sperre: höchstens ein sharp- bzw. Hash-Job (Prüflauf, Einspielen, Abgleich) je Prozess; ein zweiter
//   bekommt 409 „läuft schon seit …“. Die Sperre lebt im Prozess (ein Container).
// - speicherMessung: RSS des Prozesses vor und nach dem Job und die Spitze seit dem Prozessstart (maxRSS).

import "server-only";
import { createHash } from "node:crypto";
import { createServiceClient } from "../supabase";
import { BUCKET, DATEI_MAX_BYTES, JSON_MAX_BYTES, istAufraeumbar, istObjekt } from "./medien";
import type { SpeicherMessung } from "./typen";

/** Zeitlimit für das Lesen einer Datei aus dem Storage (bis 50 MB). */
export const DATEI_TIMEOUT_MS = 120_000;
/** Zeitlimit für kurze Storage-Aufrufe (move, remove, list, Signatur) — über fetchMitFrist. */
export const STORAGE_TIMEOUT_MS = 15_000;
/** Reste unter eingang/ und arbeit/ werden gelöscht, wenn sie älter sind als die Laufzeit eines Upload-Tokens. */
export const AUFRAEUMEN_AB_MS = 2 * 60 * 60_000;
/** Gültigkeit der signierten Lese-URL (GET …/medien/[id]/datei). */
export const LESE_URL_S = 600;

/**
 * fetch für den Service-Client der Medien-Routen: Jede Anfrage ohne eigenes Signal bekommt eine Frist von ms.
 * storage-js 2.100.1 schickt move, remove, list und die Signaturen ohne Signal; ohne Frist hielte ein Storage, der
 * die Verbindung annimmt und nicht antwortet, die Prozess-Sperre, bis undici abbricht (Review-Befund 1, 10.11.2026).
 * Anfragen mit eigenem Signal behalten es (Download mit DATEI_TIMEOUT_MS, Abfragen mit abortSignal). Abgebrochen wird
 * die Anfrage selbst; ob der Storage sie schon ausgeführt hat, bleibt offen — ein move kann trotzdem stattgefunden
 * haben (Reste unter eingang/ und arbeit/ räumt das Aufräumen, eine Datei auf dem Inhalts-Pfad prüft der nächste
 * Versuch per Hash). globalThis.fetch wird erst beim Aufruf gelesen.
 */
export function fetchMitFrist(ms: number = STORAGE_TIMEOUT_MS): typeof fetch {
  return (input, init) => globalThis.fetch(input, init?.signal ? init : { ...init, signal: AbortSignal.timeout(ms) });
}

/** Service-Client der Medien-Routen: wie createServiceClient, jede Anfrage ohne eigenes Signal mit Frist. */
export function medienClient(): ReturnType<typeof createServiceClient> {
  return createServiceClient({ fetch: fetchMitFrist() });
}

export type Ablage = ReturnType<ReturnType<typeof createServiceClient>["storage"]["from"]>;

export function ablage(client: ReturnType<typeof createServiceClient>): Ablage {
  return client.storage.from(BUCKET);
}

// ── Fehler des Storage ─────────────────────────────────────────────────────────────────────────────

/**
 * Fehlt das Objekt? Storage antwortet dafür mit HTTP 404 oder mit HTTP 400 und statusCode "404" bzw. not_found.
 * Ein fehlender Bucket zählt nicht dazu: Das ist ein Konfigurationsfehler (502), kein fehlendes Objekt.
 */
export function istNichtGefunden(fehler: unknown): boolean {
  if (typeof fehler !== "object" || fehler === null) return false;
  const f = fehler as { status?: unknown; statusCode?: unknown; message?: unknown };
  const meldung = typeof f.message === "string" ? f.message : "";
  if (/bucket/i.test(meldung)) return false;
  if (f.status === 404 || f.statusCode === "404" || f.statusCode === 404) return true;
  return /\bnot[ _]?found\b/i.test(meldung);
}

// ── Gestreamt lesen ────────────────────────────────────────────────────────────────────────────────

export type Lesung =
  | { art: "ok"; sha256: string; bytes: number; kopf: Uint8Array; inhalt: Buffer | null }
  | { art: "fehlt" }
  | { art: "zu_gross"; gelesen: number }
  | { art: "fehler"; grund: unknown };

/**
 * Datei aus dem Bucket gestreamt lesen: SHA-256, Größe und die ersten 16 Bytes (Signatur); inhalt nur mit
 * behalten. Mehr als maxBytes wird nicht gelesen (zu_gross).
 */
export async function leseDatei(a: Ablage, pfad: string, { behalten = false, maxBytes = DATEI_MAX_BYTES } = {}): Promise<Lesung> {
  const signal = AbortSignal.timeout(DATEI_TIMEOUT_MS);
  let strom: ReadableStream<Uint8Array> | null;
  try {
    const { data, error } = await a.download(pfad, undefined, { signal }).asStream();
    if (error) return istNichtGefunden(error) ? { art: "fehlt" } : { art: "fehler", grund: error };
    strom = data as ReadableStream<Uint8Array> | null;
  } catch (e) {
    return istNichtGefunden(e) ? { art: "fehlt" } : { art: "fehler", grund: e };
  }
  if (strom === null) return { art: "fehler", grund: new Error("Storage lieferte keinen Inhalt") };
  const hash = createHash("sha256");
  const stuecke: Buffer[] = [];
  const kopf = new Uint8Array(16);
  let gelesen = 0;
  const leser = strom.getReader();
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      if (gelesen < kopf.length) kopf.set(value.subarray(0, kopf.length - gelesen), gelesen);
      gelesen += value.byteLength;
      if (gelesen > maxBytes) {
        void leser.cancel().catch(() => undefined);
        return { art: "zu_gross", gelesen };
      }
      hash.update(value);
      if (behalten) stuecke.push(Buffer.from(value));
    }
  } catch (e) {
    return { art: "fehler", grund: e };
  }
  return {
    art: "ok",
    sha256: hash.digest("hex"),
    bytes: gelesen,
    kopf: kopf.subarray(0, Math.min(gelesen, kopf.length)),
    inhalt: behalten ? Buffer.concat(stuecke, gelesen) : null,
  };
}

// ── Verschieben, signieren, löschen ────────────────────────────────────────────────────────────────

export type Verschiebung = { art: "ok" } | { art: "fehlt" } | { art: "fehler"; grund: unknown };

/** move auf einen neuen Pfad (Storage überschreibt dabei nicht). */
export async function verschiebe(a: Ablage, von: string, nach: string): Promise<Verschiebung> {
  try {
    const { error } = await a.move(von, nach);
    if (!error) return { art: "ok" };
    return istNichtGefunden(error) ? { art: "fehlt" } : { art: "fehler", grund: error };
  } catch (e) {
    return { art: "fehler", grund: e };
  }
}

/** Löscht nur Pfade unter eingang/ und arbeit/; jeder andere Pfad ist ein Programmfehler und wird nicht gesendet. */
export async function loescheZwischen(a: Ablage, pfade: readonly string[]): Promise<{ geloescht: number; fehler: unknown | null }> {
  const liste = [...new Set(pfade)];
  if (liste.length === 0) return { geloescht: 0, fehler: null };
  const fremd = liste.find((p) => !istAufraeumbar(p));
  if (fremd !== undefined) throw new Error("Löschen außerhalb von eingang/ und arbeit/ verweigert");
  try {
    const { data, error } = await a.remove(liste);
    if (error) return { geloescht: 0, fehler: error };
    return { geloescht: Array.isArray(data) ? data.length : 0, fehler: null };
  } catch (e) {
    return { geloescht: 0, fehler: e };
  }
}

/** Alter eines Listeneintrags in ms: jüngster lesbarer Zeitstempel; null, wenn keiner lesbar ist (dann nie löschen). */
function alterMs(eintrag: Record<string, unknown>, jetzt: number): number | null {
  const zeiten = ["created_at", "updated_at", "last_accessed_at"]
    .map((k) => (typeof eintrag[k] === "string" ? Date.parse(eintrag[k] as string) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  return zeiten.length === 0 ? null : jetzt - Math.max(...zeiten);
}

export interface Aufraeumung {
  geloescht: number;
  /** Bereinigter Grund, wenn Auflisten oder Löschen scheiterte; das Aufräumen ist Nebensache und hält nichts auf. */
  fehler: unknown | null;
}

/** Reste unter eingang/ und arbeit/ löschen, die älter als AUFRAEUMEN_AB_MS sind; ausser bleibt in jedem Fall liegen. */
export async function raeumeAuf(a: Ablage, ausser: readonly string[] = [], jetzt = Date.now()): Promise<Aufraeumung> {
  const alt: string[] = [];
  try {
    for (const bereich of ["eingang", "arbeit"] as const) {
      const { data, error } = await a.list(bereich, { limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } });
      if (error) return { geloescht: 0, fehler: error };
      for (const e of Array.isArray(data) ? (data as unknown[]) : []) {
        if (!istObjekt(e) || typeof e.name !== "string") continue;
        const pfad = `${bereich}/${e.name}`;
        const alter = alterMs(e, jetzt);
        if (!istAufraeumbar(pfad) || ausser.includes(pfad) || alter === null || alter <= AUFRAEUMEN_AB_MS) continue;
        alt.push(pfad);
      }
    }
  } catch (e) {
    return { geloescht: 0, fehler: e };
  }
  return loescheZwischen(a, alt);
}

// ── Prozess-Sperre ─────────────────────────────────────────────────────────────────────────────────

export type JobArt = "pruefen" | "einspielen" | "abgleich";

let laufend: { art: JobArt; seit: string } | null = null;

export type Sperre = { art: "frei"; freigeben: () => void } | { art: "belegt"; laeuft: { art: JobArt; seit: string } };

/** Sperre für einen sharp- bzw. Hash-Job belegen; ist sie belegt, kommt der laufende Job zurück. */
export function belegeSperre(art: JobArt): Sperre {
  if (laufend !== null) return { art: "belegt", laeuft: { ...laufend } };
  const eigener = { art, seit: new Date().toISOString() };
  laufend = eigener;
  let frei = false;
  return {
    art: "frei",
    freigeben: () => {
      if (frei) return;
      frei = true;
      if (laufend === eigener) laufend = null;
    },
  };
}

/** Ist gerade ein Job gesperrt? (Upload-URLs räumen dann nicht auf.) */
export function sperreBelegt(): boolean {
  return laufend !== null;
}

/** Für Tests: Sperre lösen. */
export function setzeSperreZurueck(): void {
  laufend = null;
}

// ── Speicher ───────────────────────────────────────────────────────────────────────────────────────

export function rss(): number {
  return process.memoryUsage().rss;
}

export function speicherMessung(rssVorher: number): SpeicherMessung {
  return { rss_vorher_b: rssVorher, rss_nachher_b: rss(), max_rss_kib: process.resourceUsage().maxRSS };
}

// ── JSON-Körper mit Größenlimit ────────────────────────────────────────────────────────────────────

export type KoerperLesung = { art: "ok"; wert: unknown } | { art: "zu_gross" } | { art: "ungueltig" };

/** JSON-Körper bis JSON_MAX_BYTES; Content-Length darüber oder mehr gelesene Bytes → zu_gross, ohne weiterzulesen. */
export async function leseJsonKoerper(request: Request, max = JSON_MAX_BYTES): Promise<KoerperLesung> {
  const angekuendigt = request.headers.get("content-length");
  if (angekuendigt !== null && /^\d+$/.test(angekuendigt.trim()) && Number(angekuendigt) > max) return { art: "zu_gross" };
  if (request.body === null) return { art: "ungueltig" };
  const leser = request.body.getReader();
  const stuecke: Uint8Array[] = [];
  let gelesen = 0;
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      gelesen += value.byteLength;
      if (gelesen > max) {
        void leser.cancel().catch(() => undefined);
        return { art: "zu_gross" };
      }
      stuecke.push(value);
    }
  } catch {
    return { art: "ungueltig" };
  }
  try {
    return { art: "ok", wert: JSON.parse(Buffer.concat(stuecke, gelesen).toString("utf8")) };
  } catch {
    return { art: "ungueltig" };
  }
}
