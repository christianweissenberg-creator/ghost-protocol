import { NextResponse } from "next/server";
import { createServiceClient, istKonfigurationsFehler } from "@/lib/supabase";
import { ABFRAGE_TIMEOUT_MS, KEIN_CACHE, bereinigeFehler } from "@/lib/status-server";
import { CONTENT_LISTE_GRENZE, CONTENT_QUELLE } from "@/lib/content-liste";
import type { ContentFehlerAntwort, ContentFehlerArt, ContentListeAntwort } from "@/lib/content-liste";

// GET /api/content/liste — Liste der Content-Seite, gelesen über den Server (Objekt-Studio Schritt 3,
// 08.11.2026).
//
// Dieselbe Abfrage, die /content bis Schritt 2 im Browser stellte: alle Spalten der neuesten
// CONTENT_LISTE_GRENZE (50) Zeilen, nach created_at absteigend, ohne Filter. Gelesen wird mit der
// Service-Rolle (createServiceClient); den Zugang regelt die Middleware (Sitzungs-Cookie, ohne gültige
// Sitzung 401). Die Seite fragt alle 15 s neu ab (lib/content-liste.ts).
//
// Antwort 200: zeilen, grenze, abgeschnitten (die Abfrage lieferte so viele Zeilen wie die Grenze —
// ältere fehlen), gelesen_am (nach der Abfrage, Uhr des Servers), quelle.
// Fehler wie die übrigen Routen mit "fehler" (bereinigt) und "fehler_art": 500 konfiguration
// (Service-Schlüssel fehlt oder ist unbrauchbar; Supabase wurde nicht abgefragt), 502 supabase
// (Lesefehler, Zeitüberschreitung nach 8 s oder Antwort ohne Zeilenliste), 500 programmfehler.
// Nie eine leere Liste anstelle eines Fehlers.
//
// Segment-Config wie /api/freigaben und /api/studio/[objekt] (node_modules/next/dist/docs/01-app/
// 02-guides/caching-without-cache-components.md, "Route segment config"): nie statisch, kein Cache.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fehlerAntwort(status: 500 | 502, fehler: string, art: ContentFehlerArt) {
  const antwort: ContentFehlerAntwort = { fehler, fehler_art: art };
  return NextResponse.json(antwort, { status, headers: KEIN_CACHE });
}

export async function GET() {
  try {
    let client: ReturnType<typeof createServiceClient>;
    try {
      client = createServiceClient();
    } catch (e) {
      return istKonfigurationsFehler(e)
        ? fehlerAntwort(500, bereinigeFehler(e), "konfiguration")
        : fehlerAntwort(502, bereinigeFehler(e), "supabase");
    }
    const { data, error } = await client
      .from("content")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(CONTENT_LISTE_GRENZE)
      .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
    if (error) return fehlerAntwort(502, bereinigeFehler(error), "supabase");
    if (!Array.isArray(data)) return fehlerAntwort(502, "Antwort ohne Zeilenliste", "supabase");
    const antwort: ContentListeAntwort = {
      zeilen: data,
      grenze: CONTENT_LISTE_GRENZE,
      abgeschnitten: data.length >= CONTENT_LISTE_GRENZE,
      gelesen_am: new Date().toISOString(),
      quelle: CONTENT_QUELLE,
    };
    return NextResponse.json(antwort, { headers: KEIN_CACHE });
  } catch (e) {
    return fehlerAntwort(500, `Content-Liste nicht ermittelbar: ${bereinigeFehler(e)}`, "programmfehler");
  }
}
