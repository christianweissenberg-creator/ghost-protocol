import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { KEIN_CACHE, bereinigeFehler, pruefeAnfrageHerkunft } from "@/lib/status-server";
import { ankerManifest } from "@/lib/studio/anker";
import { istObjekt, leseZwischenPfad, pruefeAusschnitt, rezeptImAnker } from "@/lib/studio/medien";
import { ablage, belegeSperre, medienClient, leseJsonKoerper, loescheZwischen, raeumeAuf, rss, speicherMessung } from "@/lib/studio/medien-ablage";
import type { Ablage } from "@/lib/studio/medien-ablage";
import { MedienAbbruch, abweisung, alsAbweisung, dateiMessen, geprueftenAnkerLaden, studioSlug, zulaessigerAnker } from "@/lib/studio/medien-ablauf";
import { gleicheStartbildAb } from "@/lib/studio/startbild";

// POST /api/studio/[objekt]/medien/abgleich — Startbild-Abgleich ohne Datenbank-Zeile (Objekt-Studio Schritt 7,
// 10.11.2026).
//
// Misst die Toleranz im Container, ohne eine unveränderliche Startbild-Zeile anzulegen, und prüft ein Rezept vor
// dem Einspielen. Eingabe {eingang: "eingang/<uuid>.png|.jpg" (Upload-Rolle abgleich), anker_id, ausschnitt}.
// Der Anker wird live geladen und gegen das Manifest gehasht (409/502); die Bilddatei wird gemessen (Signatur 415)
// und nach dem Abgleich immer gelöscht. Antwort: abgleich (größte Abweichung, Mittel, Anteil über der Toleranz,
// Toleranz, Versionen von sharp und libvips) und speicher (RSS vor und nach, maxRSS des Prozesses).
// Teilt die Prozess-Sperre mit Prüflauf und Einspielen (409, wenn ein Job läuft).
// Fehler: 403/415 Herkunft, 400 Eingabe oder Rezept außerhalb des Ankers, 404 Datei fehlt, 409 Anker-Hash oder
// Sperre, 413 zu groß, 415 Signatur, 502 Storage oder Anker nicht erreichbar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ objekt: string }> }) {
  let freigeben: (() => void) | null = null;
  let a: Ablage | null = null;
  let datei: string | null = null;
  try {
    const herkunft = pruefeAnfrageHerkunft(request.headers);
    if (herkunft) return abweisung(herkunft.status, herkunft.fehler, "herkunft");
    const slug = studioSlug((await params).objekt);
    const koerper = await leseJsonKoerper(request);
    if (koerper.art === "zu_gross") throw new MedienAbbruch(413, "zu_gross", "Anfrage größer als 1 MB");
    if (koerper.art === "ungueltig") throw new MedienAbbruch(400, "eingabe", "Anfrage ist kein gültiges JSON");
    const roh = koerper.wert;
    if (!istObjekt(roh) || Object.keys(roh).some((k) => !["eingang", "anker_id", "ausschnitt"].includes(k))) {
      throw new MedienAbbruch(400, "eingabe", "Anfrage: {eingang, anker_id, ausschnitt}");
    }
    const pfad = leseZwischenPfad(roh.eingang);
    if (pfad === null || pfad.bereich !== "eingang" || pfad.mime === "video/mp4") throw new MedienAbbruch(400, "eingabe", "eingang: Pfad eingang/<uuid>.png oder .jpg aus der Upload-URL");
    if (typeof roh.anker_id !== "string") throw new MedienAbbruch(400, "eingabe", "anker_id: Kennung aus dem Anker-Manifest");
    const ausschnitt = pruefeAusschnitt(roh.ausschnitt);
    if (!ausschnitt.ok) throw new MedienAbbruch(400, "eingabe", ausschnitt.grund);
    const manifest = ankerManifest(slug);
    if (manifest === null) throw new MedienAbbruch(400, "eingabe", "Für dieses Objekt gibt es kein Anker-Manifest");
    const anker = zulaessigerAnker(manifest, roh.anker_id);
    const ausserhalb = rezeptImAnker(ausschnitt.wert, anker);
    if (ausserhalb !== null) throw new MedienAbbruch(400, "eingabe", ausserhalb);

    const sperre = belegeSperre("abgleich");
    if (sperre.art === "belegt") {
      throw new MedienAbbruch(409, "zustand", `Ein Job läuft schon seit ${sperre.laeuft.seit} (${sperre.laeuft.art}) — bitte danach erneut`, { laeuft: sperre.laeuft });
    }
    freigeben = sperre.freigeben;
    const rssVorher = rss();
    let client: ReturnType<typeof createServiceClient>;
    try {
      client = medienClient();
    } catch (e) {
      throw new MedienAbbruch(502, "quelle", `Supabase nicht nutzbar: ${bereinigeFehler(e)}`);
    }
    a = ablage(client);
    datei = roh.eingang as string;
    const aufgeraeumt = await raeumeAuf(a, [datei]);

    const ankerBytes = await geprueftenAnkerLaden(anker);
    const m = await dateiMessen(a, datei, "abgleich", pfad.mime, true);
    if (m.inhalt === null) throw new Error("Bild ohne Inhalt");
    const abgleich = await gleicheStartbildAb({ anker: { id: anker.id, sha256: anker.sha256, bytes: ankerBytes }, startbild: m.inhalt, ausschnitt: ausschnitt.wert });
    const speicher = speicherMessung(rssVorher);
    const weg = await loescheZwischen(a, [datei]);
    datei = null;
    return NextResponse.json(
      {
        objekt_slug: slug,
        erzeugt_am: new Date().toISOString(),
        abgleich,
        datei: { sha256: m.sha256, bytes: m.bytes, mime: m.mime, geloescht: weg.fehler === null },
        speicher,
        aufgeraeumt: { geloescht: aufgeraeumt.geloescht, fehler: aufgeraeumt.fehler === null ? null : bereinigeFehler(aufgeraeumt.fehler) },
      },
      { headers: KEIN_CACHE },
    );
  } catch (e) {
    if (a !== null && datei !== null) {
      try {
        await loescheZwischen(a, [datei]);
      } catch {
        // Aufräumen ist Nebensache; der Fehler der Route geht vor.
      }
    }
    return alsAbweisung(e, "Abgleich nicht möglich");
  } finally {
    freigeben?.();
  }
}
