import { NextRequest, NextResponse } from "next/server";
import { KEIN_CACHE, bereinigeFehler } from "@/lib/status-server";
import { ANKER_MANIFESTE } from "@/lib/studio/anker";
import { pruefeAnker } from "@/lib/studio/anker-pruefung";
import { pruefeStudioSlug } from "@/lib/studio/objekte";
import type { StudioObjekt } from "@/lib/studio/objekte";
import type { AnkerAntwort, StudioAbweisungsArt, StudioFehlerAntwort } from "@/lib/studio/typen";

// GET /api/studio/[objekt]/anker — Hash-Prüfung der Anker (Objekt-Studio Schritt 6, 10.11.2026).
//
// Für ein Objekt der Allow-List (lib/studio/objekte.ts): je Datei des Anker-Manifests (lib/studio/anker.ts)
// der SHA-256 der live ausgelieferten Datei gegen das Manifest — "unveraendert", "geaendert" oder
// "nicht_erreichbar", jeweils mit Zeitpunkt —, dazu der Abgleich von urls.cover im Steinadel-Export
// (Abruf über /api/objekte mit der Sitzung der Anfrage, wie GET /api/studio/[objekt]). Details und
// Grenzen (nur Manifest-Adressen, keine Weiterleitung, Zeit- und Größenlimit, nichts abgelegt) in
// lib/studio/anker-pruefung.ts. Keine bezahlten Aufrufe, keine Datenbank.
// Die Route nimmt nur die Objekt-Kennung entgegen, keine Adresse; Abfrageparameter werden nicht gelesen.
// Fehler: 403, wenn die Anfrage laut Browser von einer anderen Seite kommt; 400 bei falscher Form der Kennung,
// 404 außerhalb der Allow-List (alle drei ohne jeden Abruf); 500 bei Programmfehler. Ein Fehler bei einer
// Datei oder beim Export steht als deren Status in der Antwort (200).
// Herkunft (Prüfung 10.11.2026): Der GET löst Abrufe auf steinadel.de aus, und das Sitzungs-Cookie ist
// SameSite=Lax — eine fremde Seite könnte ihn per Navigation wiederholt auslösen. Abgewiesen wird deshalb
// Sec-Fetch-Site "cross-site" und "same-site"; "same-origin" (das Panel), "none" (Adresse eingetippt) und
// Anfragen ohne den Kopf (Server, Werkzeuge) bleiben möglich.
// Läuft für ein Objekt schon eine Prüfung, wartet eine weitere Anfrage auf deren Ergebnis, statt die
// Dateien ein zweites Mal zu laden (zwei Tabs, Doppelklick, Doppel-Effekt im Entwicklungsmodus). Danach
// startet jede Anfrage eine neue Prüfung; zwischengespeichert wird nichts.
//
// Segment-Config wie GET /api/studio/[objekt]: nie statisch, kein Cache; Route-Params als Promise.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const laufend = new Map<StudioObjekt, Promise<AnkerAntwort>>();

function abweisung(status: 400 | 403 | 404 | 500, fehler: string, art: StudioAbweisungsArt) {
  const antwort: StudioFehlerAntwort = { fehler: bereinigeFehler(fehler), fehler_art: art };
  return NextResponse.json(antwort, { status, headers: KEIN_CACHE });
}

const ERLAUBTE_HERKUNFT: readonly string[] = ["same-origin", "none"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ objekt: string }> }) {
  try {
    const herkunft = request.headers.get("sec-fetch-site");
    if (herkunft !== null && !ERLAUBTE_HERKUNFT.includes(herkunft.trim().toLowerCase())) {
      return abweisung(403, "Anfrage nicht von dieser Seite (Sec-Fetch-Site)", "herkunft");
    }
    const { objekt } = await params;
    const pruefung = pruefeStudioSlug(objekt);
    if (pruefung.art === "form") {
      return abweisung(400, "Ungültige Objekt-Kennung: erlaubt sind Kleinbuchstaben, Ziffern und einzelne Bindestriche", "eingabe");
    }
    if (pruefung.art === "nicht_im_studio") return abweisung(404, "Objekt nicht im Studio", "nicht_im_studio");
    const slug = pruefung.slug;

    let lauf = laufend.get(slug);
    if (lauf === undefined) {
      lauf = pruefeAnker(slug, ANKER_MANIFESTE[slug], request.headers.get("cookie") ?? "").finally(() => laufend.delete(slug));
      laufend.set(slug, lauf);
    }
    return NextResponse.json(await lauf, { headers: KEIN_CACHE });
  } catch (e) {
    return abweisung(500, `Anker-Prüfung nicht ermittelbar: ${bereinigeFehler(e)}`, "programmfehler");
  }
}
