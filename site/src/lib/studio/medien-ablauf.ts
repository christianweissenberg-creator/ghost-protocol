// Objekt-Studio Schritt 7 (10.11.2026): gemeinsame Schritte der Medien-Routen (upload-url, medien, abgleich,
// datei) — nur auf dem Server.
//
// Jeder Schritt bricht mit MedienAbbruch ab (HTTP-Status, Fehlerart, Grund); die Route macht daraus die Antwort
// (Fehlerarten wie in Stufe 1: 400 Eingabe, 403/415 Herkunft, 404 unbekannt, 409 Zustand oder Regel,
// 413 zu groß, 415 Dateisignatur, 500 Programm- oder Schreibfehler, 502 Storage, Supabase oder Anker nicht
// lesbar). Jeder Grund geht bereinigt hinaus (bereinigeFehler).
// - Anker: nur ein Eintrag des Manifests mit als_anker; die Datei wird für jede Anfrage live geladen und gegen das
//   Manifest gehasht (ladeAnkerDatei, Regeln der Anker-Prüfung aus Schritt 6), nie aus dem Zwischenspeicher.
//   Anderer Hash → 409, nicht erreichbar → 502.
// - Export-Cover: urls.cover im Steinadel-Export muss weiter auf den Cover-Anker zeigen, sonst 409
//   (die Steinadel-Visuals-Engine kann das Cover ersetzen); Export nicht lesbar → 502.
// - Datei messen: gestreamt aus dem Storage (SHA-256, Größe), Signatur aus den ersten Bytes passend zur Rolle und
//   zur Endung des Pfads, sonst 415.

import "server-only";
import { NextResponse } from "next/server";
import { KEIN_CACHE, bereinigeFehler } from "../status-server";
import { ladeAnkerDatei, coverAusExport, coverFehler } from "./anker-pruefung";
import type { AnkerEintrag, AnkerManifest } from "./anker";
import { leseExport } from "./export-abruf";
import { DATEI_MAX_BYTES, MIME_JE_ROLLE, mimeAusSignatur } from "./medien";
import { leseDatei } from "./medien-ablage";
import type { Ablage } from "./medien-ablage";
import { pruefeStudioSlug } from "./objekte";
import type { StudioObjekt } from "./objekte";
import type { MediumMime, StudioAbweisungsArt, StudioFehlerAntwort, UploadRolle } from "./typen";

export type AbbruchStatus = 400 | 403 | 404 | 409 | 413 | 415 | 500 | 502;

/** Abbruch einer Medien-Route mit HTTP-Status, Fehlerart und Grund (plus Feldliste, vorhandene ids oder laufendem Job). */
export class MedienAbbruch extends Error {
  readonly status: AbbruchStatus;
  readonly art: StudioAbweisungsArt;
  readonly extra: Pick<StudioFehlerAntwort, "felder" | "vorhanden" | "laeuft">;
  constructor(status: AbbruchStatus, art: StudioAbweisungsArt, grund: string, extra: Pick<StudioFehlerAntwort, "felder" | "vorhanden" | "laeuft"> = {}) {
    super(grund);
    this.status = status;
    this.art = art;
    this.extra = extra;
  }
}

export function abweisung(status: AbbruchStatus, fehler: string, art: StudioAbweisungsArt, extra: Pick<StudioFehlerAntwort, "felder" | "vorhanden" | "laeuft"> = {}) {
  const antwort: StudioFehlerAntwort = { fehler: bereinigeFehler(fehler), fehler_art: art, ...extra };
  return NextResponse.json(antwort, { status, headers: KEIN_CACHE });
}

/** Antwort für einen Fehler der Route: MedienAbbruch mit seinem Status, alles andere als Programmfehler (500). */
export function alsAbweisung(e: unknown, wobei: string) {
  if (e instanceof MedienAbbruch) return abweisung(e.status, e.message, e.art, e.extra);
  return abweisung(500, `${wobei}: ${bereinigeFehler(e)}`, "programmfehler");
}

/** Objekt-Kennung der Route: 400 bei falscher Form, 404 außerhalb der Allow-List. */
export function studioSlug(roh: unknown): StudioObjekt {
  const p = pruefeStudioSlug(roh);
  if (p.art === "form") throw new MedienAbbruch(400, "eingabe", "Ungültige Objekt-Kennung: erlaubt sind Kleinbuchstaben, Ziffern und einzelne Bindestriche");
  if (p.art === "nicht_im_studio") throw new MedienAbbruch(404, "nicht_im_studio", "Objekt nicht im Studio");
  return p.slug;
}

/** Eintrag des Manifests, der als Anker zulässig ist; sonst 400. */
export function zulaessigerAnker(manifest: AnkerManifest | null, ankerId: string): AnkerEintrag {
  const e = manifest?.eintraege.find((x) => x.id === ankerId);
  if (e === undefined) throw new MedienAbbruch(400, "eingabe", `Anker „${ankerId}“ steht nicht im Anker-Manifest`);
  if (!e.als_anker) throw new MedienAbbruch(400, "eingabe", `„${ankerId}“ ist kein zulässiger Anker (als_anker = false)`);
  return e;
}

/** Anker-Datei live laden; nur bei gleichem Hash und gleicher Größe wie im Manifest kommen ihre Bytes zurück. */
export async function geprueftenAnkerLaden(e: AnkerEintrag): Promise<Buffer> {
  const { ergebnis, bytes } = await ladeAnkerDatei(e);
  if (ergebnis.status === "unveraendert" && bytes !== null) return bytes;
  if (ergebnis.status === "geaendert") {
    throw new MedienAbbruch(409, "zustand", `Anker ${e.id}: Live-Datei weicht vom Manifest ab (${ergebnis.hinweis ?? "anderer SHA-256"})`);
  }
  throw new MedienAbbruch(502, "quelle", `Anker ${e.id} nicht erreichbar: ${ergebnis.hinweis ?? "ohne Grund"}`);
}

/** urls.cover im Steinadel-Export muss weiter auf den Cover-Anker zeigen (Abruf mit der Sitzung der Anfrage). */
export async function exportCoverPruefen(slug: StudioObjekt, manifest: AnkerManifest, cookie: string): Promise<void> {
  const l = await leseExport(cookie);
  const c = l.art === "daten" ? coverAusExport(l.daten, slug, manifest, l.abgerufenAm) : coverFehler(l.teil, manifest);
  if (c.status === "unveraendert") return;
  if (c.status === "geaendert") throw new MedienAbbruch(409, "zustand", `Export-Cover zeigt nicht mehr auf den Anker ${c.anker_id}: ${c.hinweis ?? "abweichend"}`);
  throw new MedienAbbruch(502, "quelle", `Export-Cover nicht prüfbar: ${c.hinweis ?? "Export nicht lesbar"}`);
}

export interface GemesseneDatei {
  pfad: string;
  sha256: string;
  bytes: number;
  mime: MediumMime;
  inhalt: Buffer | null;
}

/**
 * Datei aus dem Bucket messen (gestreamt): 404 wenn sie fehlt, 413 über dem Limit, 502 bei Storage-Fehlern,
 * 415 wenn die Signatur nicht zur Rolle oder zur Endung des Pfads passt.
 */
export async function dateiMessen(a: Ablage, pfad: string, rolle: UploadRolle, endungMime: MediumMime, behalten: boolean): Promise<GemesseneDatei> {
  const l = await leseDatei(a, pfad, { behalten });
  if (l.art === "fehlt") throw new MedienAbbruch(404, "nicht_gefunden", `${rolle}: Datei nicht im Bucket (${pfad})`);
  if (l.art === "zu_gross") throw new MedienAbbruch(413, "zu_gross", `${rolle}: Datei größer als ${DATEI_MAX_BYTES.toLocaleString("de-DE")} B`);
  if (l.art === "fehler") throw new MedienAbbruch(502, "quelle", `${rolle}: Storage nicht lesbar: ${bereinigeFehler(l.grund)}`);
  const mime = mimeAusSignatur(l.kopf);
  if (mime === null || !MIME_JE_ROLLE[rolle].includes(mime) || mime !== endungMime) {
    throw new MedienAbbruch(415, "dateityp", `${rolle}: Dateisignatur passt nicht (erkannt: ${mime ?? "keine bekannte"}, erwartet: ${endungMime})`);
  }
  return { pfad, sha256: l.sha256, bytes: l.bytes, mime, inhalt: l.inhalt };
}
