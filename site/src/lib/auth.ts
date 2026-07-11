// Session-Auth für das Command Center — HMAC-signierte, fälschungssichere Tokens.
//
// Ersetzt das frühere statische Cookie `gp-auth=authenticated`, das jeder im
// Browser hätte setzen können (öffentlich bekannter Wert → Passwort-Gate umgehbar).
// Läuft in BEIDEN Runtimes: Edge (middleware.ts) und Node (Login-/Cron-Routen),
// da ausschließlich die Web-Crypto-API (`crypto.subtle`) genutzt wird.
//
// Token-Format:  "<issuedAtMs>.<hmacHex(issuedAtMs)>"
// Verifikation prüft Signatur (constant-time) UND serverseitiges Ablaufdatum.

export const SESSION_COOKIE = "gp-auth";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 Tage (Sekunden)

// Signing-Key: bevorzugt dediziertes GP_SESSION_SECRET, sonst Ableitung aus dem
// ohnehin gesetzten SUPABASE_SERVICE_KEY (hohe Entropie, geheim). KEIN schwacher
// Default — ist keins von beiden gesetzt, gibt es null → Aufrufer failen closed.
export function getSessionSecret(): string | null {
  return process.env.GP_SESSION_SECRET || process.env.SUPABASE_SERVICE_KEY || null;
}

const encoder = new TextEncoder();

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// Konstant-Zeit-Vergleich — verhindert Timing-Leaks beim Signatur-/Passwortabgleich.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(secret: string, issuedAt: number = Date.now()): Promise<string> {
  const payload = String(issuedAt);
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  // Ablauf serverseitig prüfen (nicht nur Cookie-maxAge — ein Client könnte ein
  // altes Cookie beliebig lange behalten). Zukunfts-Timestamps ebenfalls ablehnen.
  const age = Date.now() - issuedAt;
  if (age < 0 || age > SESSION_MAX_AGE * 1000) return false;
  const expected = await hmacHex(payload, secret);
  return timingSafeEqual(sig, expected);
}

// Passwortabgleich in konstanter Zeit und ohne Längen-Leak: beide Seiten werden
// erst über HMAC gehasht, dann verglichen.
export async function safePasswordEqual(input: string, expected: string, secret: string): Promise<boolean> {
  const a = await hmacHex(input, secret);
  const b = await hmacHex(expected, secret);
  return timingSafeEqual(a, b);
}
