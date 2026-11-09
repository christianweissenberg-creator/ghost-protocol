// Zwischenstand der Content-Liste für GET /api/content/liste — Änderungsprobe (Objekt-Studio Schritt 3,
// 09.11.2026).
//
// /content fragt die Liste alle 15 s neu ab (CONTENT_TAKT_MS in lib/content-liste.ts). Die volle Abfrage
// liest alle Spalten der neuesten CONTENT_LISTE_GRENZE Zeilen, auch wenn sich nichts geändert hat. Die
// Route hält deshalb das Ergebnis ihrer letzten vollen Abfrage hier fest und fragt vorher nur id und
// updated_at derselben Zeilen ab (Änderungsprobe). Ist deren Kennung gleich der des Zwischenstands,
// antwortet sie mit dem Zwischenstand, ohne volle Abfrage.
//
// Ein Zwischenspeicher für alle: Die Liste ist für alle angemeldeten Sitzungen gleich (keine
// nutzerabhängigen Filter), daher ein gemeinsamer Zwischenspeicher je Server-Prozess. Er lebt nur im
// Speicher und hält höchstens eine Liste; nach einem Neustart liest die Route zuerst voll.
//
// Kennung: die ids in der Reihenfolge der Abfrage, je Zeile mit updated_at. Sie erkennt INSERT, DELETE,
// eine geänderte Reihenfolge und jedes UPDATE — updated_at setzt ein Trigger der Tabelle bei jedem
// UPDATE neu (content_updated_at, BEFORE UPDATE, NEW.updated_at = NOW(); scripts/setup_supabase_v2.sql).
// Was sie nicht erkennt — Schreiben bei abgeschalteten Triggern, denselben Zeitstempel zweier
// Transaktionen auf derselben Zeile (NOW() ist der Beginn der Transaktion), eine Zeile, die mit
// gleicher id und ausdrücklich gesetztem gleichem updated_at neu eingefügt wird —, fängt die Höchstdauer
// ab: Ist die letzte volle Abfrage CONTENT_VOLL_SPAETESTENS_MS (30 min) alt, liest die Route wieder voll,
// auch ohne erkannte Änderung. Bei Gleichstand in created_at legt Postgres die Reihenfolge der
// gleichrangigen Zeilen nicht fest; weicht sie zwischen zwei Abfragen ab, liest die Route voll — mehr
// Abfragen, nie eine veraltete Liste.
//
// Die Kennung des Zwischenstands stammt aus den vollen Zeilen, nicht aus der Probe: Ändert sich etwas
// zwischen Probe und voller Abfrage, passt sie trotzdem zu den gespeicherten Zeilen. Gleichzeitige
// Anfragen lesen jede für sich; es gilt das Ergebnis der zuletzt beendeten vollen Abfrage. Weil jede
// Anfrage vor der Antwort mit der Probe gegen den aktuellen Stand vergleicht, kostet ein älterer
// Zwischenstand höchstens eine weitere volle Abfrage.
//
// Nur die Route importiert diese Datei ("server-only"); kein Browser-Code erreicht sie (Wächter R5 in
// tests/r-content-waechter.test.mjs). Verhalten: tests/r-content-probe.test.mjs.

import "server-only";

/** Höchstalter des Zwischenstands: Ist seine volle Abfrage so alt, liest die Route wieder voll — auch ohne erkannte Änderung. */
export const CONTENT_VOLL_SPAETESTENS_MS = 30 * 60_000;

/** Spalten der Änderungsprobe; Sortierung, Grenze und Zeitlimit wie bei der vollen Abfrage. */
export const CONTENT_PROBE_SPALTEN = "id,updated_at";

/** Diagnose-Header der Listen-Antwort (nur bei 200): "unveraendert" (nur Probe, Antwort aus dem Zwischenstand) oder "voll". */
export const CONTENT_ABFRAGE_HEADER = "x-content-abfrage";

export type ContentAbfrageArt = "unveraendert" | "voll";

export interface ContentListeStand {
  /** Kennung der gespeicherten Zeilen (contentKennung). */
  readonly kennung: string;
  /** Zeilen der vollen Abfrage, wie Supabase sie lieferte. */
  readonly zeilen: Record<string, unknown>[];
  /** Uhr des Servers (ms) unmittelbar vor der vollen Abfrage — so ist das Alter eher zu hoch als zu niedrig geschätzt. */
  readonly vollAm: number;
}

let stand: ContentListeStand | null = null;

function istZeile(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

/**
 * Kennung einer Zeilenfolge: die ids in ihrer Reihenfolge, je Zeile mit updated_at. null, wenn eine Zeile
 * kein Objekt ist, keine id (endliche Zahl oder nicht leerer Text) oder kein Feld updated_at (Text oder
 * null) trägt — dann lässt sich nicht sagen, ob sich die Liste geändert hat.
 */
export function contentKennung(zeilen: readonly unknown[]): string | null {
  const teile: [number | string, string | null][] = [];
  for (const zeile of zeilen) {
    if (!istZeile(zeile)) return null;
    // Fehlt updated_at, ist der Wert undefined und damit weder Text noch null.
    const { id, updated_at: geaendert } = zeile;
    const idLesbar = (typeof id === "number" && Number.isFinite(id)) || (typeof id === "string" && id !== "");
    if (!idLesbar || (geaendert !== null && typeof geaendert !== "string")) return null;
    teile.push([id, geaendert]);
  }
  return JSON.stringify(teile);
}

/**
 * Der Zwischenstand, wenn seine volle Abfrage jünger als CONTENT_VOLL_SPAETESTENS_MS ist; sonst null.
 * Liegt jetzt vor vollAm (Uhr zurückgestellt), gilt er ebenfalls als abgelaufen.
 */
export function gueltigerContentStand(jetzt: number): ContentListeStand | null {
  if (stand === null) return null;
  const alter = jetzt - stand.vollAm;
  return alter >= 0 && alter < CONTENT_VOLL_SPAETESTENS_MS ? stand : null;
}

/**
 * Nach einer erfolgreichen vollen Abfrage: Zwischenstand ersetzen, die Kennung aus genau diesen Zeilen.
 * Lässt sich aus ihnen keine Kennung bilden, hält der Speicher danach keinen Stand — die nächste Anfrage
 * liest wieder voll, wie vor der Änderungsprobe.
 */
export function merkeContentListe(zeilen: Record<string, unknown>[], vollAm: number): void {
  const kennung = contentKennung(zeilen);
  stand = kennung === null ? null : { kennung, zeilen, vollAm };
}

/** Zwischenstand verwerfen (Tests: jeder Test beginnt ohne). */
export function setzeContentListeZurueck(): void {
  stand = null;
}
