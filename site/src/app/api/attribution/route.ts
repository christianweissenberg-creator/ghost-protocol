import { NextResponse } from "next/server";
import { EXPORT_TOKEN, KEIN_CACHE, leseSchluessel } from "@/lib/status-server";

// Proxy für den Steinadel-Attributions-Rückkanal: reicht die AGGREGATE
// (Leads/Termine/Klicks/CPL je Kampagne — keinerlei PII) 1:1 durch.
// Token nur serverseitig (gleiches Secret wie der Objekt-Export); Auth der
// Route übernimmt die bestehende Middleware. Kein Caching.
// Gesamtprüfung 06.11.2026: Wie /api/objekte liest die Route das Token über leseSchluessel
// (lib/status-server.ts). Die Meldung an den Browser ist neutral ("Export-Token
// (Server-Umgebung) nicht gesetzt"); vorher nannte sie den Env-Namen mit dem geschützten Namen.
// Ein Token mit CR, LF oder NUL wird abgelehnt, bevor es in den Authorization-Header geht (R17).
export const runtime = "nodejs";
//
// Gegencheck 06.11.2026: Wie /api/objekte trägt jeder Fehler "fehler_art". Vorher hieß auch eine
// Fehlerantwort (z. B. 401/403 bei abgelehntem Token) oder unlesbares JSON des Rückkanals
// "rueckkanal_nicht_erreichbar", obwohl steinadel.de geantwortet hatte; ein Zeitlimit fehlte.
// - "konfiguration" (500): Token fehlt oder ist unbrauchbar, der Rückkanal wurde nicht abgefragt.
// - "nicht_erreichbar" (502, "rueckkanal_nicht_erreichbar"): Netzfehler, Zeitlimit oder Abbruch
//   beim Lesen der Antwort.
// - "quelle_fehler" (502): "rueckkanal_http_<Status>" (Fehlerstatus) oder
//   "rueckkanal_antwort_unlesbar" (kein JSON).
// Die Codes liest attributionFehler (components/ui/AttributionPanel.tsx).

const UPSTREAM_URL = "https://steinadel.de/api/kampagnen/attribution";
const ATTRIBUTION_TIMEOUT_MS = 15_000;

function fehlerAntwort(fehler: string, fehlerArt: "konfiguration" | "nicht_erreichbar" | "quelle_fehler", status: number) {
  return NextResponse.json({ fehler, fehler_art: fehlerArt, kampagnen: [] }, { status, headers: KEIN_CACHE });
}

export async function GET() {
  const token = leseSchluessel(EXPORT_TOKEN);
  if (!token.ok) return fehlerAntwort(token.meldung, "konfiguration", 500);

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
      signal: AbortSignal.timeout(ATTRIBUTION_TIMEOUT_MS),
    });
  } catch {
    return fehlerAntwort("rueckkanal_nicht_erreichbar", "nicht_erreichbar", 502);
  }

  if (!upstream.ok) return fehlerAntwort(`rueckkanal_http_${upstream.status}`, "quelle_fehler", 502);

  let daten: unknown;
  try {
    daten = await upstream.json();
  } catch (e) {
    // Unlesbar ist nur kaputtes JSON; ein Abbruch beim Lesen heißt nicht erreichbar.
    const kaputtesJson = e instanceof SyntaxError || (e instanceof Error && e.name === "SyntaxError");
    return kaputtesJson
      ? fehlerAntwort("rueckkanal_antwort_unlesbar", "quelle_fehler", 502)
      : fehlerAntwort("rueckkanal_nicht_erreichbar", "nicht_erreichbar", 502);
  }
  return NextResponse.json(daten, {
    status: 200,
    headers: KEIN_CACHE,
  });
}
