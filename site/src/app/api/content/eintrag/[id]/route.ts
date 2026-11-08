import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, istKonfigurationsFehler } from "@/lib/supabase";
import { ABFRAGE_TIMEOUT_MS, KEIN_CACHE, bereinigeFehler } from "@/lib/status-server";
import { CONTENT_QUELLE, leseContentId } from "@/lib/content-liste";
import type { ContentEintragAntwort, ContentFehlerAntwort, ContentFehlerArt } from "@/lib/content-liste";

// GET /api/content/eintrag/[id] — eine Zeile der Content-Seite, gelesen über den Server (Objekt-Studio
// Schritt 3, 08.11.2026).
//
// Dieselbe Abfrage, die /content bis Schritt 2 im Browser stellte, um eine Zeile neu zu laden (nach
// einer 409 von /api/content/status oder wenn deren Antwort keine Zeile mitbringt): alle Spalten,
// Filter id = <id>, höchstens eine Zeile. Gelesen wird mit der Service-Rolle (createServiceClient);
// den Zugang regelt die Middleware (Sitzungs-Cookie, ohne gültige Sitzung 401).
//
// Antwort 200: eintrag, gelesen_am (Uhr des Servers), quelle. Fehler mit "fehler" (bereinigt) und
// "fehler_art": 400 eingabe (id keine positive ganze Zahl; ohne Abfrage), 404 nicht_gefunden (keine
// Zeile mit dieser id), 500 konfiguration, 502 supabase (Lesefehler, Zeitüberschreitung nach 8 s),
// 500 programmfehler.
//
// Segment-Config wie /api/content/liste: nie statisch, kein Cache. Die Route-Params kommen in Next 16
// als Promise (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md,
// "Dynamic Route Segments"; wie api/agents/[name]/route.ts).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fehlerAntwort(status: 400 | 404 | 500 | 502, fehler: string, art: ContentFehlerArt) {
  const antwort: ContentFehlerAntwort = { fehler, fehler_art: art };
  return NextResponse.json(antwort, { status, headers: KEIN_CACHE });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: roh } = await params;
    const id = leseContentId(roh);
    if (id === null) return fehlerAntwort(400, "Ungültige id: erwartet ist eine positive ganze Zahl", "eingabe");

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
      .eq("id", id)
      .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS))
      .maybeSingle();
    if (error) return fehlerAntwort(502, bereinigeFehler(error), "supabase");
    if (data === null) return fehlerAntwort(404, `Eintrag ${id} nicht gefunden`, "nicht_gefunden");
    if (typeof data !== "object" || Array.isArray(data)) return fehlerAntwort(502, "Antwort ohne lesbare Zeile", "supabase");
    const antwort: ContentEintragAntwort = {
      eintrag: data as Record<string, unknown>,
      gelesen_am: new Date().toISOString(),
      quelle: CONTENT_QUELLE,
    };
    return NextResponse.json(antwort, { headers: KEIN_CACHE });
  } catch (e) {
    return fehlerAntwort(500, `Eintrag nicht ermittelbar: ${bereinigeFehler(e)}`, "programmfehler");
  }
}
