// Zwischenstand des Freigabe-Stapels für GET /api/freigaben — Änderungsprobe (Freigabe-Stapel sparsam,
// 09.11.2026).
//
// Das Dashboard (Panel "Wartet auf dich") und /content fragen den Stapel alle 60 s ab (useFreigaben in
// lib/hooks-status.ts). Die volle Abfrage liest je Eintrag body, review_notes und metadata->steps, auch
// wenn sich nichts geändert hat. Die Route hält deshalb das Ergebnis ihrer letzten vollen Abfrage hier
// fest und fragt vorher nur id und updated_at derselben Zeilen ab (Änderungsprobe): beide Listen mit
// denselben Filtern, derselben Sortierung, denselben Grenzen und count "exact" wie die volle Abfrage.
// Ist die Kennung der Probe gleich der des Zwischenstands, antwortet die Route aus dem Zwischenstand,
// ohne volle Abfrage.
//
// Ein Zwischenstand für alle: Der Stapel ist für alle angemeldeten Sitzungen gleich (keine
// nutzerabhängigen Filter), daher ein gemeinsamer Zwischenstand je Server-Prozess. Er lebt nur im
// Speicher und hält höchstens einen Stapel; nach einem Neustart liest die Route zuerst voll.
//
// Gespeichert sind die rohen Zeilen beider Abfragen (wie Supabase sie lieferte), beide Zählungen, die
// Kennung und die Uhr des Servers unmittelbar vor der vollen Abfrage. Die abgeleiteten Felder
// (alter_stunden, COUNSEL-Urteil, Sperrgrund, Textlänge …) berechnet die Route bei jeder Antwort aus den
// rohen Zeilen neu, alter_stunden mit der Uhr der Anfrage.
//
// Kennung: je Liste die exakte Zählung und die ids in der Reihenfolge der Abfrage, je Zeile mit
// updated_at (contentKennung aus lib/content-liste-cache.ts). Sie erkennt INSERT, DELETE, einen
// Statuswechsel, eine geänderte Reihenfolge, jedes UPDATE — updated_at setzt der Trigger
// content_updated_at bei jedem UPDATE neu — und eine geänderte Zählung jenseits der Grenzen (mehr als
// 100 wartende oder 50 hängende Einträge). Ein Eintrag, der die 2-h-Grenze überschreitet, ändert die
// Probe, denn die Route berechnet die Grenze bei jeder Anfrage neu: Er steht dann in der hängenden Liste
// der Probe, nicht in der des Zwischenstands. Stehen schon 50 ältere hängende Einträge vor ihm, steht er
// nicht in der Liste und erhöht nur ihre Zählung. Beides ändert die Kennung, und die Route liest voll
// (tests/r-freigaben-probe.test.mjs, FS-P4 und FS-P4b). Was die Kennung nicht erkennt,
// steht in lib/content-liste-cache.ts (unter anderem Schreiben bei abgeschalteten Triggern und
// Änderungen am Aufbau der Tabelle); das fängt die Höchstdauer ab: Ist die letzte volle Abfrage
// FREIGABEN_VOLL_SPAETESTENS_MS (30 min) alt, liest die Route wieder voll, auch ohne erkannte Änderung.
//
// Die Kennung des Zwischenstands stammt aus den vollen Zeilen und Zählungen, nicht aus der Probe: Ändert
// sich etwas zwischen Probe und voller Abfrage, passt sie trotzdem zu den gespeicherten Zeilen. Eine
// Antwort ohne volle Abfrage trägt die Zeilen genau des Zwischenstands, gegen den ihre Probe verglichen
// hat (die Route liest ihn einmal, vor der Probe), nicht die des Stands, der inzwischen im Speicher liegt.
//
// Nur die Route importiert diese Datei ("server-only"); kein Browser-Code erreicht sie (Wächter R5-W7 in
// tests/r-content-waechter.test.mjs). Verhalten: tests/r-freigaben-probe.test.mjs.

import "server-only";
import { contentKennung } from "./content-liste-cache";

/** Höchstalter des Zwischenstands: Ist seine volle Abfrage so alt, liest die Route wieder voll — auch ohne erkannte Änderung. */
export const FREIGABEN_VOLL_SPAETESTENS_MS = 30 * 60_000;

/** Spalten der Änderungsprobe; Filter, Sortierung, Grenzen und count "exact" wie bei der vollen Abfrage. */
export const FREIGABEN_PROBE_SPALTEN = "id,updated_at";

/** Diagnose-Header der Antwort (nur bei 200): "unveraendert" (nur Probe, Antwort aus dem Zwischenstand) oder "voll". */
export const FREIGABEN_ABFRAGE_HEADER = "x-freigaben-abfrage";

export type FreigabenAbfrageArt = "unveraendert" | "voll";

/** Eine Liste des Stapels: Zeilen, wie Supabase sie lieferte, und die exakte Zählung aller passenden Zeilen. */
export interface FreigabenListe {
  readonly zeilen: readonly unknown[];
  readonly gesamt: number;
}

export interface FreigabenStand {
  /** Kennung beider Listen (freigabenKennung). */
  readonly kennung: string;
  readonly wartend: FreigabenListe;
  readonly haengend: FreigabenListe;
  /** Uhr des Servers (ms) unmittelbar vor der vollen Abfrage — so ist das Alter eher zu hoch als zu niedrig geschätzt. */
  readonly vollAm: number;
}

let stand: FreigabenStand | null = null;

/** Eine Zählung, mit der sich vergleichen lässt: ganze Zahl ab 0. */
export function istZaehlung(wert: unknown): wert is number {
  return typeof wert === "number" && Number.isSafeInteger(wert) && wert >= 0;
}

/**
 * Kennung beider Listen: je Liste die Zählung und die ids in ihrer Reihenfolge, je Zeile mit updated_at.
 * null, wenn eine Zählung keine ganze Zahl ab 0 ist oder eine Zeile kein Objekt ist, keine id (endliche
 * Zahl oder nicht leerer Text) oder kein Feld updated_at (Text oder null) trägt — dann lässt sich nicht
 * sagen, ob sich der Stapel geändert hat.
 */
export function freigabenKennung(wartend: FreigabenListe, haengend: FreigabenListe): string | null {
  if (!istZaehlung(wartend.gesamt) || !istZaehlung(haengend.gesamt)) return null;
  const w = contentKennung(wartend.zeilen);
  const h = contentKennung(haengend.zeilen);
  if (w === null || h === null) return null;
  return JSON.stringify([wartend.gesamt, w, haengend.gesamt, h]);
}

/**
 * Der Zwischenstand, wenn seine volle Abfrage jünger als FREIGABEN_VOLL_SPAETESTENS_MS ist; sonst null.
 * Liegt jetzt vor vollAm (Uhr zurückgestellt), gilt er ebenfalls als abgelaufen.
 */
export function gueltigerFreigabenStand(jetzt: number): FreigabenStand | null {
  if (stand === null) return null;
  const alter = jetzt - stand.vollAm;
  return alter >= 0 && alter < FREIGABEN_VOLL_SPAETESTENS_MS ? stand : null;
}

/**
 * Nach einer erfolgreichen vollen Abfrage: Zwischenstand ersetzen, die Kennung aus genau diesen Zeilen und
 * Zählungen. Lässt sich aus ihnen keine Kennung bilden, hält der Speicher danach keinen Stand — die
 * nächste Anfrage liest wieder voll, wie vor der Änderungsprobe.
 */
export function merkeFreigaben(wartend: FreigabenListe, haengend: FreigabenListe, vollAm: number): void {
  const kennung = freigabenKennung(wartend, haengend);
  stand = kennung === null ? null : { kennung, wartend, haengend, vollAm };
}

/** Zwischenstand verwerfen (Tests: jeder Test beginnt ohne). */
export function setzeFreigabenZurueck(): void {
  stand = null;
}
