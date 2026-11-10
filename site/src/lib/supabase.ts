import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Befund R17 (06.11.2026): Ein Service-Key mit CR, LF oder NUL im Wert wird schon hier
// abgelehnt. Sonst wirft fetch beim Setzen der Header einen Fehler, der den vollen Schlüssel
// enthält, und der landet in Antworten, Logs oder gespeicherten Zeilen. Die Meldungen sind
// fest und nennen weder Wert noch Variablennamen; den Namen schreibt nur das Server-Log,
// einmal je Prozess. Keine Imports aus lib/status-server.ts: diese Datei lädt auch der
// Browser. Der Anon-Key wird nicht geprüft: er ist öffentlich (NEXT_PUBLIC_) und ein Wurf
// hier würde jede Seite mitreißen.
// Nachprüfung 06.11.2026: Leerraum am Rand (Tab, LF, CR, Leerzeichen) entfernt fetch beim
// Setzen der Header selbst, ohne zu werfen; ein Key mit LF oder CRLF am Ende lief deshalb vor
// der Fixrunde. Der Rand wird hier genauso entfernt (dieselbe Regel wie ohneRandLeerraum in
// lib/status-server.ts), abgelehnt wird nur, was danach noch CR, LF oder NUL enthält. Vor
// createClient, weil supabase-js "Bearer <Key>" zusammensetzt: dort stünde ein führender Rand
// mitten im Header.
const STEUERZEICHEN = /[\r\n\0]/;
// Gegencheck/Prüflauf 06.11.2026: dieselbe Header-Regel wie leseSchluessel in
// lib/status-server.ts (undici): erlaubt nur TAB, 0x20–0x7E und 0x80–0xFF; ohne u-Flag treffen
// auch Surrogate (D800–DFFF).
const KEIN_HEADER_ZEICHEN = /[^\t\x20-\x7e\x80-\xff]/;
const RAND_LEERRAUM = /^[\t\n\r ]+|[\t\n\r ]+$/g;
const gemeldet = new Set<string>();

// Gegencheck 06.11.2026: Ein fehlender oder unbrauchbarer Schlüssel ist ein Konfigurationsfehler
// — Supabase wurde dann gar nicht abgefragt. /api/status meldet ihn als "nicht gemessen" statt
// als Fehler der Datenbank (vorher: rote Pille "OFFLINE" ohne einen einzigen Abruf).
function konfigurationsFehler(meldung: string): Error {
  return Object.assign(new Error(meldung), { konfiguration: true });
}

/** Fehler von createServiceClient wegen der Konfiguration (Schlüssel fehlt oder ist unbrauchbar)? */
export function istKonfigurationsFehler(e: unknown): boolean {
  return e instanceof Error && (e as Error & { konfiguration?: unknown }).konfiguration === true;
}

function meldeEinmal(text: string, warnung = false): void {
  if (gemeldet.has(text)) return;
  gemeldet.add(text);
  const zeile = `[supabase] SUPABASE_SERVICE_KEY: ${text}`;
  if (warnung) console.warn(zeile);
  else console.error(zeile);
}

// Server-side client with service role key (for API routes only)
// optionen.fetch (Objekt-Studio Schritt 7, 10.11.2026): eigenes fetch für alle Anfragen dieses Clients, etwa mit einer
// Frist für Storage-Aufrufe, die storage-js ohne Signal schickt (lib/studio/medien-ablage.ts, fetchMitFrist). Ohne
// Angabe wie bisher.
export function createServiceClient(optionen: { fetch?: typeof fetch } = {}) {
  const roh = process.env.SUPABASE_SERVICE_KEY;
  const serviceKey = typeof roh === "string" ? roh.replace(RAND_LEERRAUM, "") : "";
  if (!serviceKey) {
    meldeEinmal(typeof roh === "string" && roh !== "" ? "nur Leerraum — wie nicht gesetzt behandelt" : "nicht gesetzt");
    throw konfigurationsFehler("Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt");
  }
  if (STEUERZEICHEN.test(serviceKey)) {
    meldeEinmal("enthält CR, LF oder NUL im Wert — abgelehnt");
    throw konfigurationsFehler("Supabase-Service-Schlüssel (Server-Umgebung) abgelehnt: enthält Zeilenumbruch oder Nullzeichen");
  }
  if (KEIN_HEADER_ZEICHEN.test(serviceKey)) {
    meldeEinmal("enthält ein Zeichen, das kein Header-Wert sein kann (Steuerzeichen oder über U+00FF) — abgelehnt");
    throw konfigurationsFehler(
      "Supabase-Service-Schlüssel (Server-Umgebung) abgelehnt: enthält ein Zeichen, das in keinem HTTP-Header stehen kann (etwa ein Steuerzeichen oder unsichtbares Leerzeichen)"
    );
  }
  if (serviceKey !== roh) {
    meldeEinmal("Leerraum am Rand entfernt (wie fetch) — bitte in der Umgebung bereinigen", true);
  }
  return optionen.fetch ? createClient(supabaseUrl, serviceKey, { global: { fetch: optionen.fetch } }) : createClient(supabaseUrl, serviceKey);
}
