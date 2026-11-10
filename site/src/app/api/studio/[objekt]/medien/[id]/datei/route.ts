import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ABFRAGE_TIMEOUT_MS, KEIN_CACHE, bereinigeFehler } from "@/lib/status-server";
import { istObjekt } from "@/lib/studio/medien";
import { LESE_URL_S, ablage, leseDatei, medienClient } from "@/lib/studio/medien-ablage";
import { MedienAbbruch, abweisung, alsAbweisung, studioSlug } from "@/lib/studio/medien-ablauf";

// GET /api/studio/[objekt]/medien/[id]/datei — Datei eines Mediums über eine kurzlebige signierte URL
// (Objekt-Studio Schritt 7, 10.11.2026).
//
// Vor jeder Auslieferung wird die Datei gestreamt nachgehasht, in jeder Größe: Die Datenbank sperrt Ändern und
// Löschen der Zeilen, nicht der Dateien im Bucket. Weicht SHA-256 oder Größe von der Zeile ab (oder fehlt die
// Datei), gibt es keine URL (409). Sonst 302 auf eine signierte URL, LESE_URL_S (10 min) gültig; der Browser nutzt
// sie für das ganze Abspielen (Bereichsabrufe gehen an die URL, nicht an diese Route).
// Herkunft wie die Anker-Route: Sec-Fetch-Site same-origin oder none (oder ohne den Kopf); fremde Seiten 403.
// Fehler: 400 Kennung, 403 Herkunft, 404 Objekt oder Medium unbekannt, 409 Datei weicht ab oder fehlt, 502 Storage
// oder Supabase.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ERLAUBTE_HERKUNFT: readonly string[] = ["same-origin", "none"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ objekt: string; id: string }> }) {
  try {
    const herkunft = request.headers.get("sec-fetch-site");
    if (herkunft !== null && !ERLAUBTE_HERKUNFT.includes(herkunft.trim().toLowerCase())) {
      return abweisung(403, "Anfrage nicht von dieser Seite (Sec-Fetch-Site)", "herkunft");
    }
    const { objekt, id: idRoh } = await params;
    const slug = studioSlug(objekt);
    if (!/^[1-9]\d{0,14}$/.test(idRoh)) throw new MedienAbbruch(400, "eingabe", "Medium-Kennung: positive ganze Zahl");
    const id = Number(idRoh);

    let client: ReturnType<typeof createServiceClient>;
    try {
      client = medienClient();
    } catch (e) {
      throw new MedienAbbruch(502, "quelle", `Supabase nicht nutzbar: ${bereinigeFehler(e)}`);
    }
    const zeile = await client
      .from("studio_medium")
      .select("id, objekt_slug, speicher_pfad, sha256, bytes")
      .eq("id", id)
      .eq("objekt_slug", slug)
      .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS))
      .maybeSingle();
    if (zeile.error) throw new MedienAbbruch(502, "quelle", `Medium nicht lesbar: ${bereinigeFehler(zeile.error)}`);
    if (!istObjekt(zeile.data)) throw new MedienAbbruch(404, "nicht_gefunden", `Medium ${id} gehört nicht zu diesem Objekt oder besteht nicht`);
    const { speicher_pfad: pfad, sha256, bytes } = zeile.data;
    if (typeof pfad !== "string" || typeof sha256 !== "string" || typeof bytes !== "number") throw new MedienAbbruch(502, "quelle", `Medium ${id}: Zeile unlesbar`);

    const a = ablage(client);
    const l = await leseDatei(a, pfad, { maxBytes: bytes });
    if (l.art === "fehlt") throw new MedienAbbruch(409, "zustand", `Medium ${id}: Datei fehlt im Bucket — keine URL`);
    if (l.art === "zu_gross") throw new MedienAbbruch(409, "zustand", `Medium ${id}: Datei größer als laut Zeile — keine URL`);
    if (l.art === "fehler") throw new MedienAbbruch(502, "quelle", `Medium ${id}: Datei nicht lesbar: ${bereinigeFehler(l.grund)}`);
    if (l.sha256 !== sha256 || l.bytes !== bytes) throw new MedienAbbruch(409, "zustand", `Medium ${id}: Datei weicht von der Zeile ab (SHA-256 oder Größe) — keine URL`);

    const signiert = await a.createSignedUrl(pfad, LESE_URL_S);
    if (signiert.error || !signiert.data) throw new MedienAbbruch(502, "quelle", `Medium ${id}: signierte URL nicht ausgestellt: ${bereinigeFehler(signiert.error ?? "ohne Antwort")}`);
    return NextResponse.redirect(signiert.data.signedUrl, { status: 302, headers: KEIN_CACHE });
  } catch (e) {
    return alsAbweisung(e, "Datei nicht auslieferbar");
  }
}
