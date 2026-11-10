import { NextRequest, NextResponse } from "next/server";
import { KEIN_CACHE, bereinigeFehler, pruefeAnfrageHerkunft } from "@/lib/status-server";
import { ANKER_MANIFESTE } from "@/lib/studio/anker";
import { pruefeAnker } from "@/lib/studio/anker-pruefung";
import { ankerErgebnis } from "@/lib/studio/anker-speicher";
import { pruefeStudioSlug } from "@/lib/studio/objekte";
import type { StudioAbweisungsArt, StudioFehlerAntwort } from "@/lib/studio/typen";

// /api/studio/[objekt]/anker — Hash-Prüfung der Anker (Objekt-Studio Schritt 6, 10.11.2026).
//
// Für ein Objekt der Allow-List (lib/studio/objekte.ts): je Datei des Anker-Manifests (lib/studio/anker.ts)
// der SHA-256 der live ausgelieferten Datei gegen das Manifest — "unveraendert", "geaendert" oder
// "nicht_erreichbar", jeweils mit Zeitpunkt —, dazu der Abgleich von urls.cover im Steinadel-Export
// (Abruf über /api/objekte mit der Sitzung der Anfrage, wie GET /api/studio/[objekt]). Details und
// Grenzen (nur Manifest-Adressen, keine Weiterleitung, Zeit- und Größenlimit, nichts abgelegt) in
// lib/studio/anker-pruefung.ts. Keine bezahlten Aufrufe, keine Datenbank.
// - GET (Seitenaufbau): das letzte Ergebnis aus dem Zwischenspeicher, solange es jünger als 15 min ist,
//   sonst einmal geprüft (lib/studio/anker-speicher.ts). Die Antwort nennt im Feld stand Alter und Grenzen.
// - POST („Alle prüfen“): eine frische Prüfung, frühestens 60 s nach der letzten; davor das letzte Ergebnis
//   mit stand.gedrosselt. Herkunft wie bei den übrigen POST-Routen (pruefeAnfrageHerkunft): nur von dieser
//   Seite und mit Content-Type application/json — eine fremde Seite kann so keine frische Prüfung auslösen,
//   auch nicht über die Studio-Seite; deren Aufbau kostet höchstens eine Prüfung je 15 min.
// Die Route nimmt nur die Objekt-Kennung entgegen, keine Adresse; Abfrageparameter und Körper werden nicht
// gelesen.
// Fehler: 403/415 bei fremder Herkunft (GET: Sec-Fetch-Site cross-site oder same-site), 400 bei falscher
// Form der Kennung, 404 außerhalb der Allow-List — alle ohne jeden Abruf; 500 bei Programmfehler. Ein Fehler
// bei einer Datei oder beim Export steht als deren Status in der Antwort (200).
//
// Segment-Config wie GET /api/studio/[objekt]: nie statisch, kein Cache; Route-Params als Promise.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET: "same-origin" (das Panel), "none" (Adresse eingetippt); ohne den Kopf (Server, Werkzeuge) ebenfalls. */
const ERLAUBTE_HERKUNFT: readonly string[] = ["same-origin", "none"];

function abweisung(status: 400 | 403 | 404 | 415 | 500, fehler: string, art: StudioAbweisungsArt) {
  const antwort: StudioFehlerAntwort = { fehler: bereinigeFehler(fehler), fehler_art: art };
  return NextResponse.json(antwort, { status, headers: KEIN_CACHE });
}

async function antworte(request: NextRequest, params: Promise<{ objekt: string }>, art: "anzeigen" | "frisch") {
  const { objekt } = await params;
  const pruefung = pruefeStudioSlug(objekt);
  if (pruefung.art === "form") {
    return abweisung(400, "Ungültige Objekt-Kennung: erlaubt sind Kleinbuchstaben, Ziffern und einzelne Bindestriche", "eingabe");
  }
  if (pruefung.art === "nicht_im_studio") return abweisung(404, "Objekt nicht im Studio", "nicht_im_studio");
  const slug = pruefung.slug;
  const cookie = request.headers.get("cookie") ?? "";
  const antwort = await ankerErgebnis(slug, art, () => pruefeAnker(slug, ANKER_MANIFESTE[slug], cookie));
  return NextResponse.json(antwort, { headers: KEIN_CACHE });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ objekt: string }> }) {
  try {
    const herkunft = request.headers.get("sec-fetch-site");
    if (herkunft !== null && !ERLAUBTE_HERKUNFT.includes(herkunft.trim().toLowerCase())) {
      return abweisung(403, "Anfrage nicht von dieser Seite (Sec-Fetch-Site)", "herkunft");
    }
    return await antworte(request, params, "anzeigen");
  } catch (e) {
    return abweisung(500, `Anker-Prüfung nicht ermittelbar: ${bereinigeFehler(e)}`, "programmfehler");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ objekt: string }> }) {
  try {
    const sperre = pruefeAnfrageHerkunft(request.headers);
    if (sperre) return abweisung(sperre.status, sperre.fehler, "herkunft");
    return await antworte(request, params, "frisch");
  } catch (e) {
    return abweisung(500, `Anker-Prüfung nicht ermittelbar: ${bereinigeFehler(e)}`, "programmfehler");
  }
}
