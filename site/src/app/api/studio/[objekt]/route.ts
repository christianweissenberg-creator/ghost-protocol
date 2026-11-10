import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, istKonfigurationsFehler } from "@/lib/supabase";
import { ABFRAGE_TIMEOUT_MS, KEIN_CACHE, bereinigeFehler, ladeSeitenweise } from "@/lib/status-server";
import type { Seitenergebnis } from "@/lib/status-server";
import { leseExport } from "@/lib/studio/export-abruf";
import { QUELLE_MESSPLAN, leseMessplan } from "@/lib/studio/messplan";
import type { MessplanStand } from "@/lib/studio/messplan";
import { pruefeStudioSlug } from "@/lib/studio/objekte";
import type { StudioObjekt } from "@/lib/studio/objekte";
import {
  ASSET_SPALTEN,
  MEDIUM_SPALTEN,
  PRUEFUNG_SPALTEN,
  assetsAusLesung,
  assetsFehler,
  creditsAusMedien,
  kopfAusExport,
  kostenAusAssets,
  mitMedienUrteil,
  medienAusZeilen,
  medienFehler,
  teilFehler,
} from "@/lib/studio/lesen";
import type {
  ObjektKopf,
  StudioAbweisungsArt,
  StudioAntwort,
  StudioAssetsTeil,
  StudioFehlerAntwort,
  StudioFehlerArt,
  StudioMedienTeil,
  StudioMesswert,
} from "@/lib/studio/typen";

// GET /api/studio/[objekt] — Objekt-Studio, nur lesend (Schritt 2, 08.11.2026; Medien, Credits und Messplan seit
// Schritt 7, 10.11.2026).
//
// Liefert für ein Objekt der Allow-List (lib/studio/objekte.ts) sechs Teile mit je eigenem Status:
// - objekt: Kopf aus dem Steinadel-Export. Abgerufen über /api/objekte mit der Sitzung der Anfrage
//   (wie die Pipeline, fetchObjekt in api/content/pipeline/route.ts) — der Zugang zum Export bleibt
//   in /api/objekte. Der Abruf steht seit Schritt 6 (10.11.2026) in lib/studio/export-abruf.ts,
//   unverändert; den Export liest auch die Anker-Prüfung (GET /api/studio/[objekt]/anker).
// - assets: content-Zeilen mit metadata.objekt_slug = Slug, mit Zählung der Abfrage; je Asset das
//   abgeleitete COUNSEL-Urteil, der Sperrgrund (pruefeFreigabe, wie /api/freigaben), die Kosten und
//   die Daten der Beleg-Kette.
// - kosten_usd: Schätzung aus metadata.steps[].cost, mit der Zahl der Läufe ohne Kostenangabe.
// - medien: Zeilen aus studio_medium, je Video die Kette Export → Original → Startbild; seit Schritt 8 mit den
//   Prüfprotokollen (studio_pruefung) und dem Urteil der Medien-Regel (lib/medien-freigabe.ts) mit allen Gründen.
// - kosten_credits: Higgsfield-Credits der Originale mit Deckel (E18) und Rest — getrennt von USD.
// - messung: Messplan aus studio_messplan; fehlt die Tabelle, „nicht angelegt“, ohne Zeile „noch kein Eintrag“.
// Fehler: 400 bei falscher Form der Kennung, 404 außerhalb der Allow-List (beide ohne jede
// Abfrage), 500 bei Programmfehler. Ein Lesefehler bei Supabase oder Export macht nur den
// betroffenen Teil zu "fehler" (502-Art, fehler_art, bereinigter Grund); die Antwort bleibt 200.
// Diese Route liest nur: Sie löscht und verschiebt keine Datei (Aufräumen nur in den POST-Routen der Medien).
//
// Segment-Config wie /api/freigaben (node_modules/next/dist/docs/01-app/02-guides/
// caching-without-cache-components.md, "Route segment config"): nie statisch, kein Cache. Die
// Route-Params kommen in Next 16 als Promise (wie api/agents/[name]/route.ts).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Höchstzahl geladener Assets; mehr Zeilen machen den Teil zur "warnung" (Untergrenze), nie still kürzer. */
const ASSETS_HOECHSTENS = 500;
/** Höchstzahl geladener Medien-Zeilen (je Video drei); mehr macht den Teil zur "warnung". */
const MEDIEN_HOECHSTENS = 1000;
/**
 * Höchstzahl gelesener Prüfprotokolle je Seitenaufbau, jüngstes zuerst. Greift das Limit (oder kappt die Datenbank die
 * Liste), fehlen nur ältere Protokolle; ein Video ohne gelesenes Protokoll bleibt gesperrt, und der Teil warnt
 * (Review-Befund 2b, 10.11.2026; vorher ohne Reihenfolge und Limit — dann konnte das jüngste fehlen).
 */
const PROTOKOLLE_HOECHSTENS = 500;

type ServiceClient = ReturnType<typeof createServiceClient>;
type ClientLage = { art: "ok"; client: ServiceClient } | { art: "fehler"; fehlerArt: StudioFehlerArt; grund: string };

function abweisung(status: 400 | 404 | 500, fehler: string, art: StudioAbweisungsArt) {
  const antwort: StudioFehlerAntwort = { fehler: bereinigeFehler(fehler), fehler_art: art };
  return NextResponse.json(antwort, { status, headers: KEIN_CACHE });
}

async function ladeObjektKopf(slug: StudioObjekt, cookie: string): Promise<StudioMesswert<ObjektKopf>> {
  const lesung = await leseExport(cookie);
  return lesung.art === "daten" ? kopfAusExport(lesung.daten, slug, lesung.abgerufenAm) : lesung.teil;
}

function clientLage(): ClientLage {
  try {
    return { art: "ok", client: createServiceClient() };
  } catch (e) {
    return { art: "fehler", fehlerArt: istKonfigurationsFehler(e) ? "konfiguration" : "supabase", grund: bereinigeFehler(e) };
  }
}

async function ladeAssets(slug: StudioObjekt, lage: ClientLage): Promise<StudioAssetsTeil> {
  const versuchAm = new Date().toISOString();
  if (lage.art === "fehler") return assetsFehler(slug, versuchAm, lage.fehlerArt, lage.grund);
  const client = lage.client;
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

async function ladeMedien(slug: StudioObjekt, lage: ClientLage): Promise<StudioMedienTeil> {
  const versuchAm = new Date().toISOString();
  if (lage.art === "fehler") return medienFehler(versuchAm, lage.fehlerArt, lage.grund);
  try {
    const res = await lage.client
      .from("studio_medium")
      .select(MEDIUM_SPALTEN)
      .eq("objekt_slug", slug)
      .order("id", { ascending: true })
      .limit(MEDIEN_HOECHSTENS + 1)
      .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
    if (res.error) return medienFehler(new Date().toISOString(), "supabase", bereinigeFehler(res.error));
    const zeilen: unknown[] = Array.isArray(res.data) ? res.data : [];
    const abgeschnitten = zeilen.length > MEDIEN_HOECHSTENS;
    const geladen = abgeschnitten ? zeilen.slice(0, MEDIEN_HOECHSTENS) : zeilen;
    // Seit Schritt 8: Prüfprotokolle der Exporte. Ein Lesefehler sperrt jedes Video (die Regel ist fail-closed).
    const exporte = geladen
      .map((z) => (typeof z === "object" && z !== null && (z as Record<string, unknown>).fassung === "export" ? (z as Record<string, unknown>).id : null))
      .filter((id): id is number => typeof id === "number");
    let pruefungen: unknown[] | null = [];
    let pruefungenGrund: string | null = null;
    let protokolleAbgeschnitten = false;
    if (exporte.length > 0) {
      const p = await lage.client
        .from("studio_pruefung")
        .select(PRUEFUNG_SPALTEN)
        .in("medium_id", exporte)
        .order("geprueft_am", { ascending: false })
        .order("id", { ascending: false })
        .limit(PROTOKOLLE_HOECHSTENS)
        .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
      if (p.error) {
        pruefungen = null;
        pruefungenGrund = bereinigeFehler(p.error);
      } else {
        pruefungen = Array.isArray(p.data) ? p.data : [];
        protokolleAbgeschnitten = pruefungen.length >= PROTOKOLLE_HOECHSTENS;
      }
    }
    return medienAusZeilen(geladen, new Date().toISOString(), abgeschnitten, pruefungen, slug, pruefungenGrund, protokolleAbgeschnitten);
  } catch (e) {
    return medienFehler(versuchAm, "supabase", bereinigeFehler(e));
  }
}

async function ladeMessung(slug: StudioObjekt, lage: ClientLage): Promise<StudioMesswert<MessplanStand>> {
  if (lage.art === "fehler") return teilFehler<MessplanStand>(QUELLE_MESSPLAN, new Date().toISOString(), lage.fehlerArt, lage.grund);
  return leseMessplan(lage.client, slug);
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

    const lage = clientLage();
    const [objektTeil, assets, medien, messung] = await Promise.all([
      ladeObjektKopf(slug, request.headers.get("cookie") ?? ""),
      ladeAssets(slug, lage),
      ladeMedien(slug, lage),
      ladeMessung(slug, lage),
    ]);
    const antwort: StudioAntwort = {
      objekt_slug: slug,
      erzeugt_am: new Date().toISOString(),
      objekt: objektTeil,
      assets: mitMedienUrteil(assets, medien),
      kosten_usd: kostenAusAssets(assets),
      kosten_credits: creditsAusMedien(medien),
      messung,
      medien,
    };
    return NextResponse.json(antwort, { headers: KEIN_CACHE });
  } catch (e) {
    return abweisung(500, `Studio nicht ermittelbar: ${bereinigeFehler(e)}`, "programmfehler");
  }
}
