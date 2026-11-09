import { NextResponse } from "next/server";
import { createServiceClient, istKonfigurationsFehler } from "@/lib/supabase";
import { ABFRAGE_TIMEOUT_MS, KEIN_CACHE, bereinigeFehler } from "@/lib/status-server";
import { CONTENT_LISTE_GRENZE, CONTENT_QUELLE } from "@/lib/content-liste";
import type { ContentFehlerAntwort, ContentFehlerArt, ContentListeAntwort } from "@/lib/content-liste";
import {
  CONTENT_ABFRAGE_HEADER,
  CONTENT_PROBE_SPALTEN,
  contentKennung,
  gueltigerContentStand,
  merkeContentListe,
} from "@/lib/content-liste-cache";
import type { ContentAbfrageArt } from "@/lib/content-liste-cache";

// GET /api/content/liste — Liste der Content-Seite, gelesen über den Server (Objekt-Studio Schritt 3,
// 08.11.2026).
//
// Dieselbe Abfrage, die /content bis Schritt 2 im Browser stellte: alle Spalten der neuesten
// CONTENT_LISTE_GRENZE (50) Zeilen, nach created_at absteigend, ohne Filter. Gelesen wird mit der
// Service-Rolle (createServiceClient); den Zugang regelt die Middleware (Sitzungs-Cookie, ohne gültige
// Sitzung 401). Die Seite fragt alle 15 s neu ab (lib/content-liste.ts).
//
// Änderungsprobe (09.11.2026): Jede Anfrage prüft zuerst, ob sich die Liste geändert hat.
// - Hält lib/content-liste-cache.ts einen Zwischenstand, dessen volle Abfrage jünger als 30 min ist
//   (CONTENT_VOLL_SPAETESTENS_MS), fragt die Route nur id und updated_at derselben Zeilen ab (gleiche
//   Sortierung, Grenze und Zeitlimit). Gleiche Kennung: Antwort mit dem Zwischenstand, ohne volle
//   Abfrage (Header x-content-abfrage: unveraendert).
// - Sonst (kein Zwischenstand, abgelaufen, Kennung anders) die volle Abfrage wie oben; ihr Ergebnis
//   ersetzt den Zwischenstand, mit der Kennung der vollen Zeilen (Header x-content-abfrage: voll).
// Scheitert die Probe (Lesefehler, Zeitüberschreitung, Antwort ohne Zeilenliste, Zeile ohne id oder
// updated_at), antwortet die Route mit 502 supabase und ohne den Zwischenstand. Scheitert die volle
// Abfrage, 502 wie bisher; der Zwischenstand bleibt, wie er war. Was die Kennung erkennt und was nicht:
// lib/content-liste-cache.ts.
// Probe und volle Abfrage teilen ein Abbruchsignal mit ABFRAGE_TIMEOUT_MS (8 s): Eine Anfrage wartet
// höchstens so lange auf Supabase und bleibt damit unter dem Zeitlimit der Seite
// (CONTENT_ABRUF_GRENZE_MS, 12 s) — deren Fehlerantwort kommt so weiterhin an.
//
// Antwort 200: zeilen, grenze, abgeschnitten (die Liste hat so viele Zeilen wie die Grenze — ältere
// fehlen), gelesen_am (nach der letzten Supabase-Abfrage dieser Anfrage, Probe oder volle Abfrage; Uhr
// des Servers), quelle.
// Fehler wie die übrigen Routen mit "fehler" (bereinigt) und "fehler_art": 500 konfiguration
// (Service-Schlüssel fehlt oder ist unbrauchbar; Supabase wurde nicht abgefragt), 502 supabase
// (Lesefehler, Zeitüberschreitung nach 8 s oder Antwort ohne Zeilenliste), 500 programmfehler.
// Nie eine leere Liste anstelle eines Fehlers.
//
// Segment-Config wie /api/freigaben und /api/studio/[objekt] (node_modules/next/dist/docs/01-app/
// 02-guides/caching-without-cache-components.md, "Route segment config"): nie statisch, kein Cache.
// Die Datei exportiert nur GET und die Segment-Config; Zwischenspeicher und Kennung liegen in
// lib/content-liste-cache.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fehlerAntwort(status: 500 | 502, fehler: string, art: ContentFehlerArt) {
  const antwort: ContentFehlerAntwort = { fehler, fehler_art: art };
  return NextResponse.json(antwort, { status, headers: KEIN_CACHE });
}

/** Antwort 200; gelesen_am ist der Zeitpunkt jetzt, nach der letzten Supabase-Abfrage dieser Anfrage. */
function listenAntwort(zeilen: Record<string, unknown>[], art: ContentAbfrageArt) {
  const antwort: ContentListeAntwort = {
    zeilen,
    grenze: CONTENT_LISTE_GRENZE,
    abgeschnitten: zeilen.length >= CONTENT_LISTE_GRENZE,
    gelesen_am: new Date().toISOString(),
    quelle: CONTENT_QUELLE,
  };
  return NextResponse.json(antwort, { headers: { ...KEIN_CACHE, [CONTENT_ABFRAGE_HEADER]: art } });
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
    const signal = AbortSignal.timeout(ABFRAGE_TIMEOUT_MS);
    const stand = gueltigerContentStand(Date.now());
    if (stand !== null) {
      const probe = await client
        .from("content")
        .select(CONTENT_PROBE_SPALTEN)
        .order("created_at", { ascending: false })
        .limit(CONTENT_LISTE_GRENZE)
        .abortSignal(signal);
      if (probe.error) return fehlerAntwort(502, bereinigeFehler(probe.error), "supabase");
      if (!Array.isArray(probe.data)) return fehlerAntwort(502, "Änderungsprobe: Antwort ohne Zeilenliste", "supabase");
      const kennung = contentKennung(probe.data);
      if (kennung === null) return fehlerAntwort(502, "Änderungsprobe: Zeile ohne id oder updated_at", "supabase");
      if (kennung === stand.kennung) return listenAntwort(stand.zeilen, "unveraendert");
    }
    const vollAm = Date.now();
    const { data, error } = await client
      .from("content")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(CONTENT_LISTE_GRENZE)
      .abortSignal(signal);
    if (error) return fehlerAntwort(502, bereinigeFehler(error), "supabase");
    if (!Array.isArray(data)) return fehlerAntwort(502, "Antwort ohne Zeilenliste", "supabase");
    merkeContentListe(data, vollAm);
    return listenAntwort(data, "voll");
  } catch (e) {
    return fehlerAntwort(500, `Content-Liste nicht ermittelbar: ${bereinigeFehler(e)}`, "programmfehler");
  }
}
