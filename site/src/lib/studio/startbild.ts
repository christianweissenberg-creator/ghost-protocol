// Objekt-Studio Schritt 7 (10.11.2026): Startbild-Abgleich mit sharp.
//
// Der Server schneidet die live geladene, hash-geprüfte Anker-Datei nach dem Rezept des Belegs aus und
// vergleicht den Ausschnitt Pixel für Pixel, je Kanal, mit dem hochgeladenen Startbild. Bestanden ist der
// Abgleich, wenn keine Abweichung über der Toleranz liegt (größte Abweichung ≤ STARTBILD_TOLERANZ).
// - Toleranz 2 Tonwerte (Setzung, vor dem ersten neuen Lauf festzuschreiben): Verschiedene
//   JPEG-Decoder liefern nicht garantiert dieselben Pixel. Ein mit sharp aus dem Anker erzeugter PNG-Ausschnitt
//   ergibt lokal 0 (sharp 0.35.5, libvips 8.18.7, darwin-arm64, synthetische Bilder); im Container misst es
//   POST …/medien/abgleich, die Antwort nennt die Versionen von sharp und libvips und ob sharp nativ läuft
//   (versionen.nativ; sonst WebAssembly). Liegt der Messwert dort
//   über 2, wird die Toleranz nicht erhöht (vorab festgelegt), sondern der Zuschnitt auf den Server verlegt.
// - Ein nicht bestandener Abgleich weist das Einspielen nicht ab: Er wird mit Messwert gespeichert, und die
//   Medien-Regel sperrt (Bedingung 8).
// - Verglichen werden die gespeicherten Pixel in sRGB ohne Alphakanal; eine EXIF-Drehung wird nicht angewandt.
//   Trägt eine der beiden Dateien eine Drehung (Orientierung ≠ 1), ist das Ergebnis nicht eindeutig: nicht
//   bestanden mit Grund. Passen die Maße nicht zum Rezept, wird nicht verglichen: nicht bestanden mit Grund.
// - Speicher: sharp wird erst beim ersten Abgleich geladen (Lazy Import), ohne Operations-Cache und mit einem
//   Thread (cache(false), concurrency(1)); Eingaben über MAX_PIXEL Bildpunkten lehnt sharp ab.

import "server-only";
import { createRequire } from "node:module";
import type { SharpConstructor } from "sharp";
import type { AbgleichErgebnis, Ausschnitt } from "./typen";

/** Größte zulässige Abweichung je Kanal, damit der Abgleich als bestanden gilt. */
export const STARTBILD_TOLERANZ = 2;
/** Obergrenze der Bildpunkte je Eingabe (größter Anker im Manifest: 3000 × 2018 ≈ 6,1 Mio.). */
export const MAX_PIXEL = 40_000_000;

type SharpFabrik = SharpConstructor;

/**
 * Versionen für Antwort und Abnahme. nativ = false heißt: sharp läuft nicht mit seinem nativen Binary — sharp 0.35
 * weicht ohne Warnung auf WebAssembly (@img/sharp-wasm32) aus, wenn das native Binary fehlt oder nicht lädt
 * (Nachbesserung infra-1). Erkannt wird das an zwei Stellen (sharpNativ).
 */
export type SharpVersionen = { sharp: string; vips: string; nativ: boolean };

export interface SharpModul {
  sharp: SharpFabrik;
  versionen: SharpVersionen;
}

/**
 * true, wenn sharp sein natives Binary geladen hat. Zwei Prüfungen (Nachtrag d1-e22-rauchtest-3):
 * - „emscripten“ in sharp.versions heißt WebAssembly. Der Eintrag stammt aber nur aus @img/sharp-wasm32/versions.json;
 *   fehlt diese Datei (etwa im Trace), trägt versions ihn nicht, obwohl WebAssembly läuft.
 * - Deshalb zählt auch das tatsächlich geladene Modul: geladen sind die Pfade im CommonJS-Cache (require.cache). sharp
 *   lädt sein Binary dorthin, auch über import (dist/sharp.mjs nutzt createRequire). Ein Pfad unter @img/sharp-…wasm32
 *   heißt WebAssembly; nativ ist sharp nur, wenn ein natives Binary (@img/sharp-<plattform>/….node) geladen ist.
 * Gemessen in Kopien des Standalone-Ordners (darwin-arm64): ohne natives Paket und ohne versions.json fehlt
 * „emscripten“, im Cache steht @img/sharp-wasm32/lib/sharp-wasm32-0.35.5.node.js — über require und über import.
 */
export function sharpNativ(versions: object, geladen: readonly string[]): boolean {
  const pfade = geladen.map((p) => p.replaceAll("\\", "/"));
  const wasm = "emscripten" in versions || pfade.some((p) => p.includes("/@img/sharp-") && p.includes("wasm32"));
  const nativ = pfade.some((p) => p.includes("/@img/sharp-") && !p.includes("wasm32") && p.endsWith(".node"));
  return nativ && !wasm;
}

/** Pfade der geladenen CommonJS-Module (require.cache ist für jede require-Funktion des Prozesses derselbe). */
function geladeneModule(): string[] {
  return Object.keys(createRequire(`${process.cwd()}/package.json`).cache);
}

let modul: Promise<SharpModul> | null = null;

/** sharp bei Bedarf laden, einmal je Prozess. Scheitert das Laden, wird es beim nächsten Aufruf neu versucht. */
export function ladeSharp(): Promise<SharpModul> {
  if (modul === null) {
    modul = import("sharp")
      .then((m) => {
        const sharp: SharpFabrik = m.default;
        sharp.cache(false);
        sharp.concurrency(1);
        return { sharp, versionen: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, nativ: sharpNativ(sharp.versions, geladeneModule()) } };
      })
      .catch((e: unknown) => {
        modul = null;
        throw e;
      });
  }
  return modul;
}

interface Pixel {
  daten: Buffer;
  breite: number;
  hoehe: number;
  kanaele: number;
}

async function pixel(s: SharpFabrik, eingabe: Buffer, rezept?: Ausschnitt): Promise<Pixel> {
  let p = s(eingabe, { limitInputPixels: MAX_PIXEL });
  if (rezept) p = p.extract({ left: rezept.x, top: rezept.y, width: rezept.breite, height: rezept.hoehe });
  const { data, info } = await p.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { daten: data, breite: info.width, hoehe: info.height, kanaele: info.channels };
}

export interface BildMasse {
  breite: number;
  hoehe: number;
  /** EXIF-Orientierung; null ohne Angabe. */
  orientierung: number | null;
}

/**
 * Bild über MAX_PIXEL Bildpunkten (sharp meldet „exceeds pixel limit“): eine Abweisung der Eingabe (413), kein
 * Programmfehler (Nachbesserung sicherheit-2; vorher 500 „programmfehler“).
 */
export class BildZuGross extends Error {
  constructor(grund: string) {
    super(grund);
    this.name = "BildZuGross";
  }
}

/**
 * Hochgeladenes Bild nicht lesbar — etwa abgeschnitten nach einem abgebrochenen Download (gültiger Kopf, Daten fehlen):
 * eine Abweisung der Eingabe (422), kein Programmfehler (Nachtrag d2-oberflaeche-4; vorher 500 „programmfehler“). Nur für
 * das hochgeladene Bild; die Anker-Datei ist gegen das Manifest gehasht, ein Fehler dort bleibt ein Programmfehler.
 */
export class BildUnlesbar extends Error {
  constructor(grund: string) {
    super(grund);
    this.name = "BildUnlesbar";
  }
}

/** Fehler beim Lesen des hochgeladenen Bilds: Pixelgrenze bleibt BildZuGross, alles andere wird BildUnlesbar. */
function alsBildFehler(e: unknown): Error {
  if (e instanceof BildZuGross) return e;
  const grund = e instanceof Error && e.message ? e.message.split("\n")[0] : "unbekannt";
  return new BildUnlesbar(`Bild nicht lesbar (beschädigt oder abgeschnitten): ${grund}`);
}

/** Maße und Orientierung aus dem Dateikopf, ohne die Bilddaten zu dekodieren. */
export async function bildMasse(s: SharpFabrik, eingabe: Buffer): Promise<BildMasse> {
  let m: Awaited<ReturnType<ReturnType<SharpFabrik>["metadata"]>>;
  try {
    m = await s(eingabe, { limitInputPixels: MAX_PIXEL }).metadata();
  } catch (e) {
    if (e instanceof Error && /pixel limit/i.test(e.message)) {
      throw new BildZuGross(`Bild über ${MAX_PIXEL.toLocaleString("de-DE")} Bildpunkten — Grenze des Abgleichs`);
    }
    throw e;
  }
  if (typeof m.width !== "number" || typeof m.height !== "number") throw new Error("Bildmaße nicht lesbar");
  return { breite: m.width, hoehe: m.height, orientierung: typeof m.orientation === "number" ? m.orientation : null };
}

export interface AbgleichEingabe {
  /** Live geladene Anker-Datei, deren SHA-256 gleich dem Manifest ist. */
  anker: { id: string; sha256: string; bytes: Buffer };
  startbild: Buffer;
  ausschnitt: Ausschnitt;
}

function ohneVergleich(e: AbgleichEingabe, versionen: SharpModul["versionen"], startbild: BildMasse, anker: BildMasse, grund: string): AbgleichErgebnis {
  return {
    urteil: "nicht_bestanden",
    abweichung_max: null,
    mittel: null,
    anteil_ueber_toleranz: null,
    toleranz: STARTBILD_TOLERANZ,
    grund,
    startbild: { breite: startbild.breite, hoehe: startbild.hoehe },
    ausschnitt: { ...e.ausschnitt },
    anker: { id: e.anker.id, sha256: e.anker.sha256, breite: anker.breite, hoehe: anker.hoehe },
    versionen,
  };
}

/** Rundung auf 4 Nachkommastellen für Mittel und Anteil (reine Anzeige; abweichung_max ist ganzzahlig). */
function runde4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

/**
 * Startbild gegen den Ausschnitt des Ankers. Das Rezept muss vorher geprüft sein (rezeptImAnker); liegt es
 * dennoch außerhalb der dekodierten Anker-Datei, wirft sharp (Programmfehler, 500).
 */
export async function gleicheStartbildAb(e: AbgleichEingabe, mod?: SharpModul): Promise<AbgleichErgebnis> {
  const { sharp, versionen } = mod ?? (await ladeSharp());
  const ankerMasse = await bildMasse(sharp, e.anker.bytes);
  const startMasse = await bildMasse(sharp, e.startbild).catch((f: unknown) => {
    throw alsBildFehler(f);
  });
  const a = e.ausschnitt;
  if (startMasse.breite !== a.breite || startMasse.hoehe !== a.hoehe) {
    return ohneVergleich(e, versionen, startMasse, ankerMasse, `Maße passen nicht: Startbild ${startMasse.breite}×${startMasse.hoehe}, Ausschnitt ${a.breite}×${a.hoehe}`);
  }
  for (const [name, m] of [["Anker", ankerMasse], ["Startbild", startMasse]] as const) {
    if (m.orientierung !== null && m.orientierung !== 1) {
      return ohneVergleich(e, versionen, startMasse, ankerMasse, `${name} trägt eine EXIF-Drehung (Orientierung ${m.orientierung}); Pixelvergleich nicht eindeutig`);
    }
  }
  const soll = await pixel(sharp, e.anker.bytes, a);
  const ist = await pixel(sharp, e.startbild).catch((f: unknown) => {
    throw alsBildFehler(f);
  });
  if (soll.breite !== ist.breite || soll.hoehe !== ist.hoehe || soll.kanaele !== ist.kanaele || soll.daten.length !== ist.daten.length) {
    return ohneVergleich(e, versionen, startMasse, ankerMasse, "dekodierte Bilder unterschiedlich groß");
  }
  let max = 0;
  let summe = 0;
  let ueber = 0;
  for (let i = 0; i < soll.daten.length; i += 1) {
    const d = Math.abs(soll.daten[i] - ist.daten[i]);
    if (d > max) max = d;
    summe += d;
    if (d > STARTBILD_TOLERANZ) ueber += 1;
  }
  const n = soll.daten.length;
  return {
    urteil: max <= STARTBILD_TOLERANZ ? "bestanden" : "nicht_bestanden",
    abweichung_max: max,
    mittel: runde4(summe / n),
    anteil_ueber_toleranz: runde4(ueber / n),
    toleranz: STARTBILD_TOLERANZ,
    grund: null,
    startbild: { breite: startMasse.breite, hoehe: startMasse.hoehe },
    ausschnitt: { ...a },
    anker: { id: e.anker.id, sha256: e.anker.sha256, breite: ankerMasse.breite, hoehe: ankerMasse.hoehe },
    versionen,
  };
}
