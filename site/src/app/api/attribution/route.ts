import { NextResponse } from "next/server";

// Proxy für den Steinadel-Attributions-Rückkanal: reicht die AGGREGATE
// (Leads/Termine/Klicks/CPL je Kampagne — keinerlei PII) 1:1 durch.
// Token nur serverseitig (gleiches Secret wie der Objekt-Export); Auth der
// Route übernimmt die bestehende Middleware. Kein Caching.
export const runtime = "nodejs";

const UPSTREAM_URL = "https://steinadel.de/api/kampagnen/attribution";

export async function GET() {
  const token = process.env.IMMONEXUS_EXPORT_TOKEN;

  if (!token) {
    return NextResponse.json(
      { fehler: "IMMONEXUS_EXPORT_TOKEN nicht konfiguriert", kampagnen: [] },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      cache: "no-store",
      headers: { Authorization: "Bearer " + token },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { fehler: "rueckkanal_nicht_erreichbar", kampagnen: [] },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }
    const daten = await upstream.json();
    return NextResponse.json(daten, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { fehler: "rueckkanal_nicht_erreichbar", kampagnen: [] },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
