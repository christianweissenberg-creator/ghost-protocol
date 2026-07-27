import { NextResponse } from "next/server";

// Proxy für den Steinadel-Export: reicht das Upstream-JSON 1:1 durch.
// Auth übernimmt die bestehende Middleware (Session-Cookie) — hier keine
// zusätzliche Prüfung. Kein Caching, da die Objektliste sich laufend ändert.
export const runtime = "nodejs";

const UPSTREAM_URL = "https://steinadel.de/api/objekte/export";

export async function GET() {
  const token = process.env.IMMONEXUS_EXPORT_TOKEN;

  if (!token) {
    return NextResponse.json(
      { fehler: "IMMONEXUS_EXPORT_TOKEN nicht konfiguriert", objekte: [] },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const requestHeaders = new Headers();
    requestHeaders.set("Authorization", "Bearer " + token);

    const upstream = await fetch(UPSTREAM_URL, {
      cache: "no-store",
      headers: requestHeaders,
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { fehler: "quelle_nicht_erreichbar", objekte: [] },
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
      { fehler: "quelle_nicht_erreichbar", objekte: [] },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
