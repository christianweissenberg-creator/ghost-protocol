import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, istKonfigurationsFehler } from "@/lib/supabase";
import {
  ABFRAGE_TIMEOUT_MS,
  KEIN_CACHE,
  bereinigeFehler,
  istZeitueberschreitung,
  ladeSeitenweise,
} from "@/lib/status-server";
import type { Seitenergebnis } from "@/lib/status-server";
import { pruefeStudioSlug } from "@/lib/studio/objekte";
import type { StudioObjekt } from "@/lib/studio/objekte";
import {
  ASSET_SPALTEN,
  QUELLE_EXPORT,
  assetsAusLesung,
  assetsFehler,
  creditsTeil,
  exportFehlerAusAntwort,
  kopfAusExport,
  kostenAusAssets,
  messungTeil,
  teilFehler,
} from "@/lib/studio/lesen";
import type {
  ObjektKopf,
  StudioAbweisungsArt,
  StudioAntwort,
  StudioAssetsTeil,
  StudioFehlerAntwort,
  StudioMesswert,
} from "@/lib/studio/typen";

// GET /api/studio/[objekt] — Objekt-Studio, nur lesend (Schritt 2, 08.11.2026).
//
// Liefert für ein Objekt der Allow-List (lib/studio/objekte.ts) fünf Teile mit je eigenem Status:
// - objekt: Kopf aus dem Steinadel-Export. Abgerufen über /api/objekte mit der Sitzung der Anfrage
//   (wie die Pipeline, fetchObjekt in api/content/pipeline/route.ts) — der Zugang zum Export bleibt
//   in /api/objekte.
// - assets: content-Zeilen mit metadata.objekt_slug = Slug, mit Zählung der Abfrage; je Asset das
//   abgeleitete COUNSEL-Urteil, der Sperrgrund (pruefeFreigabe, wie /api/freigaben), die Kosten und
//   die Daten der Beleg-Kette.
// - kosten_usd: Schätzung aus metadata.steps[].cost, mit der Zahl der Läufe ohne Kostenangabe.
// - kosten_credits, messung: noch nicht gebaut — ohne Zahl, mit Bauschritt.
// Fehler: 400 bei falscher Form der Kennung, 404 außerhalb der Allow-List (beide ohne jede
// Abfrage), 500 bei Programmfehler. Ein Lesefehler bei Supabase oder Export macht nur den
// betroffenen Teil zu "fehler" (502-Art, fehler_art, bereinigter Grund); die Antwort bleibt 200.
//
// Segment-Config wie /api/freigaben (node_modules/next/dist/docs/01-app/02-guides/
// caching-without-cache-components.md, "Route segment config"): nie statisch, kein Cache. Die
// Route-Params kommen in Next 16 als Promise (wie api/agents/[name]/route.ts).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
// Über dem Zeitlimit von /api/objekte (15 s), damit dessen eigene Fehlerantwort ankommt — gleicher
// Wert wie OBJEKT_TIMEOUT_MS der Pipeline.
const EXPORT_TIMEOUT_MS = 20_000;
/** Höchstzahl geladener Assets; mehr Zeilen machen den Teil zur "warnung" (Untergrenze), nie still kürzer. */
const ASSETS_HOECHSTENS = 500;

function abweisung(status: 400 | 404 | 500, fehler: string, art: StudioAbweisungsArt) {
  const antwort: StudioFehlerAntwort = { fehler: bereinigeFehler(fehler), fehler_art: art };
  return NextResponse.json(antwort, { status, headers: KEIN_CACHE });
}

async function ladeObjektKopf(slug: StudioObjekt, cookie: string): Promise<StudioMesswert<ObjektKopf>> {
  const versuchAm = new Date().toISOString();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/objekte`, {
      headers: { Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
  } catch (e) {
    const grund = istZeitueberschreitung(e) ? `Zeitüberschreitung (${EXPORT_TIMEOUT_MS / 1000} s)` : bereinigeFehler(e);
    return teilFehler(QUELLE_EXPORT, versuchAm, "nicht_erreichbar", grund);
  }
  const abgerufenAm = new Date().toISOString();
  let daten: unknown = null;
  try {
    daten = await res.json();
  } catch (e) {
    // Unlesbares JSON (SyntaxError) zählt wie eine Antwort ohne Inhalt; jeder andere Fehler beim
    // Lesen ist ein Abbruch (Zeitlimit, abgerissene Verbindung) — wie in api/objekte/route.ts.
    const kaputtesJson = e instanceof SyntaxError || (e instanceof Error && e.name === "SyntaxError");
    if (!kaputtesJson) {
      const grund = istZeitueberschreitung(e) ? `Zeitüberschreitung (${EXPORT_TIMEOUT_MS / 1000} s)` : bereinigeFehler(e);
      return teilFehler(QUELLE_EXPORT, abgerufenAm, "nicht_erreichbar", grund);
    }
    if (res.ok) return teilFehler(QUELLE_EXPORT, abgerufenAm, "quelle_fehler", "Antwort von /api/objekte nicht lesbar");
  }
  if (!res.ok) return exportFehlerAusAntwort(res.status, daten, abgerufenAm);
  return kopfAusExport(daten, slug, abgerufenAm);
}

async function ladeAssets(slug: StudioObjekt): Promise<StudioAssetsTeil> {
  const versuchAm = new Date().toISOString();
  let client: ReturnType<typeof createServiceClient>;
  try {
    client = createServiceClient();
  } catch (e) {
    return assetsFehler(slug, versuchAm, istKonfigurationsFehler(e) ? "konfiguration" : "supabase", bereinigeFehler(e));
  }
  const signal = AbortSignal.timeout(ABFRAGE_TIMEOUT_MS);
  let lesung: Seitenergebnis;
  try {
    lesung = await ladeSeitenweise(
      (von, bis, mitZaehlung) =>
        client
          .from("content")
          .select(ASSET_SPALTEN, mitZaehlung ? { count: "exact" } : undefined)
          .eq("metadata->>objekt_slug", slug)
          .order("id", { ascending: true })
          .range(von, bis)
          .abortSignal(signal),
      ASSETS_HOECHSTENS
    );
  } catch (e) {
    return assetsFehler(slug, versuchAm, "supabase", bereinigeFehler(e));
  }
  return assetsAusLesung(lesung, slug, new Date().toISOString());
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ objekt: string }> }) {
  try {
    const { objekt } = await params;
    const pruefung = pruefeStudioSlug(objekt);
    if (pruefung.art === "form") {
      return abweisung(400, "Ungültige Objekt-Kennung: erlaubt sind Kleinbuchstaben, Ziffern und einzelne Bindestriche", "eingabe");
    }
    if (pruefung.art === "nicht_im_studio") return abweisung(404, "Objekt nicht im Studio", "nicht_im_studio");
    const slug = pruefung.slug;

    const [objektTeil, assets] = await Promise.all([ladeObjektKopf(slug, request.headers.get("cookie") ?? ""), ladeAssets(slug)]);
    const antwort: StudioAntwort = {
      objekt_slug: slug,
      erzeugt_am: new Date().toISOString(),
      objekt: objektTeil,
      assets,
      kosten_usd: kostenAusAssets(assets),
      kosten_credits: creditsTeil(),
      messung: messungTeil(),
    };
    return NextResponse.json(antwort, { headers: KEIN_CACHE });
  } catch (e) {
    return abweisung(500, `Studio nicht ermittelbar: ${bereinigeFehler(e)}`, "programmfehler");
  }
}
