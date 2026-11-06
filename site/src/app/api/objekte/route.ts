import { NextResponse } from "next/server";
import { EXPORT_TOKEN, KEIN_CACHE, leseSchluessel } from "@/lib/status-server";

// Proxy für den Steinadel-Export: reicht das Upstream-JSON 1:1 durch.
// Auth übernimmt die bestehende Middleware (Session-Cookie) — hier keine
// zusätzliche Prüfung. Kein Caching, da die Objektliste sich laufend ändert.
//
// Nachprüfung im Browser 06.11.2026: Jeder Fehler trägt "fehler_art", damit die Anzeige die
// Ursache nennt statt "offline": "konfiguration" (Token fehlt oder ist unbrauchbar, der Export
// wurde nicht abgefragt), "nicht_erreichbar" (Netzfehler, Zeitlimit oder Abbruch beim Lesen
// der Antwort), "quelle_fehler"
// (Export antwortete mit Fehlerstatus oder unlesbarem JSON). Vorher hieß eine Fehlerantwort des
// Exports ebenfalls "quelle_nicht_erreichbar". Die Codes in "fehler" liest auch die Pipeline
// (exportMeldung in api/content/pipeline/route.ts).
export const runtime = "nodejs";

const UPSTREAM_URL = "https://steinadel.de/api/objekte/export";
// Unter dem Zeitlimit der Pipeline (OBJEKT_TIMEOUT_MS, 20 s), damit sie eine Antwort bekommt.
const EXPORT_TIMEOUT_MS = 15_000;

function fehlerAntwort(fehler: string, fehlerArt: "konfiguration" | "nicht_erreichbar" | "quelle_fehler", status: number) {
  return NextResponse.json({ fehler, fehler_art: fehlerArt, objekte: [] }, { status, headers: KEIN_CACHE });
}

export async function GET() {
  // Befund R23 (06.11.2026): neutrale, handlungsfähige Meldung; den Variablennamen schreibt
  // nur das Server-Log (leseSchluessel). Befund R17: ein Token mit CR, LF oder NUL wird
  // abgelehnt, bevor es in den Authorization-Header geht.
  const token = leseSchluessel(EXPORT_TOKEN);
  if (!token.ok) return fehlerAntwort(token.meldung, "konfiguration", 500);

  // Gegencheck 06.11.2026: Der Header-Bau steht im try. Ein Wert, den Headers ablehnt, ergab
  // vorher einen ungefangenen Fehler (HTTP 500 ohne fehler_art). leseSchluessel lehnt solche
  // Werte schon ab; das hier ist die zweite Sicherung, ohne den Wert in der Meldung.
  const requestHeaders = new Headers();
  try {
    requestHeaders.set("Authorization", "Bearer " + token.wert);
  } catch {
    return fehlerAntwort("Export-Token (Server-Umgebung) abgelehnt: kein gültiger Header-Wert", "konfiguration", 500);
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      cache: "no-store",
      headers: requestHeaders,
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
  } catch {
    return fehlerAntwort("quelle_nicht_erreichbar", "nicht_erreichbar", 502);
  }

  if (!upstream.ok) return fehlerAntwort(`quelle_http_${upstream.status}`, "quelle_fehler", 502);

  let daten: unknown;
  try {
    daten = await upstream.json();
  } catch (e) {
    // Unlesbar ist nur kaputtes JSON (SyntaxError). Alles andere ist ein Abbruch beim Lesen:
    // Zeitlimit (TimeoutError, AbortError) oder abgerissene Verbindung (undici: TypeError
    // "terminated", gemessen Node 25.3) — die Quelle hat dann nicht vollständig geantwortet.
    const kaputtesJson = e instanceof SyntaxError || (e instanceof Error && e.name === "SyntaxError");
    return kaputtesJson
      ? fehlerAntwort("quelle_antwort_unlesbar", "quelle_fehler", 502)
      : fehlerAntwort("quelle_nicht_erreichbar", "nicht_erreichbar", 502);
  }
  return NextResponse.json(daten, {
    status: 200,
    headers: KEIN_CACHE,
  });
}
