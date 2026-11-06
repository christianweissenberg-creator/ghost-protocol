// Gemeinsame Freigabe-Regeln — Objekt-Studio Stufe 1 (06.11.2026).
//
// Reine Funktionen ohne Server-Abhängigkeit und ohne Laufzeit-Importe: Sie laufen in den
// API-Routen (Pipeline, Übergang "freigeben", Freigabe-Stapel) und im Browser (Sperre des
// Freigeben-Knopfs). Maßgeblich ist die Prüfung auf dem Server; die Sperre im Browser ist
// nur Bedienhilfe. Das COUNSEL-Urteil kommt als Ergebnis von werteCounselAus() herein.

import type { CounselAuswertung } from "./counsel-urteil";
import type { CounselUrteil } from "./status-types";

/** Mindestlänge des Freigabetexts nach Trimmen. */
export const MIN_FREIGABE_ZEICHEN = 20;

// Geschützter Name (Inhaber-Regel vom 05.11.2026): Er darf in keinem sichtbaren Text stehen.
// Technische Bezeichner im Code (Pfade, Env-Namen) sind davon nicht betroffen.
//
// Gesamtprüfung 06.11.2026 (gemessen, 7 von 10 Schreibweisen gingen durch): Das frühere Muster
// /imm[ou][\s._-]*nexus/i übersah Halbgeviertstrich (U+2013), geschützten Bindestrich (U+2011),
// weiches Trennzeichen (U+00AD), Nullbreite (U+200B), "/", Mittelpunkt (U+00B7) und das
// kyrillische о. Seither wird auf einer gefalteten Fassung des Texts geprüft, Zeichen für
// Zeichen: Kompatibilitätszerlegung (NFKD; Vollbreite, mathematische Buchstaben, NBSP),
// Kleinschreibung, ohne Akzente (\p{M}) und ohne unsichtbare Formatzeichen (\p{Cf}); gängige
// kyrillische und griechische Doppelgänger werden auf die lateinischen Buchstaben abgebildet.
// Zwischen den beiden Namensteilen sind Leerraum, Satz- und Sonderzeichen in beliebiger Zahl
// erlaubt. Die Maskierung ersetzt die zugehörige Stelle im Originaltext. Im Zweifel wird eher zu
// viel als zu wenig erkannt (fail-closed); Ziffern als Buchstabenersatz ("0" für "o") deckt die
// Regel nicht ab.
export const NAMENS_ERSATZ = "[geschützter Name]";

/** Kyrillische und griechische Doppelgänger (Kleinbuchstaben) der Buchstaben des Namens. */
const DOPPELGAENGER: Readonly<Record<string, string>> = {
  "і": "i", // і kyrillisch
  "ı": "i", // ı punktlos
  "ι": "i", // ι griechisch
  "м": "m", // м kyrillisch
  "о": "o", // о kyrillisch
  "ο": "o", // ο griechisch
  "υ": "u", // υ griechisch
  "е": "e", // е kyrillisch
  "х": "x", // х kyrillisch
  "χ": "x", // χ griechisch
  "ѕ": "s", // ѕ kyrillisch
};

const AKZENT_ODER_UNSICHTBAR = /[\p{M}\p{Cf}]/gu;
/** Muster auf dem gefalteten Text (klein, ohne Akzente und Formatzeichen). */
const NAME_GEFALTET = /imm[ou][\s\p{P}\p{S}]*nexus/u;
const NAME_GEFALTET_ALLE = /imm[ou][\s\p{P}\p{S}]*nexus/gu;

interface Faltung {
  text: string;
  /** Je Zeichen (UTF-16-Einheit) des gefalteten Texts: Beginn und Ende des Originalzeichens. */
  von: number[];
  bis: number[];
}

/** Ein Originalzeichen (Codepoint) gefaltet; ASCII nur klein geschrieben. */
function falteZeichen(zeichen: string): string {
  if (zeichen.length === 1 && zeichen.charCodeAt(0) < 0x80) return zeichen.toLowerCase();
  const zerlegt = zeichen.normalize("NFKD").toLowerCase().replace(AKZENT_ODER_UNSICHTBAR, "");
  let aus = "";
  for (const c of zerlegt) aus += DOPPELGAENGER[c] ?? c;
  return aus;
}

function falte(text: string): Faltung {
  let aus = "";
  const von: number[] = [];
  const bis: number[] = [];
  let i = 0;
  for (const zeichen of text) {
    const ende = i + zeichen.length;
    const f = falteZeichen(zeichen);
    for (let k = 0; k < f.length; k++) {
      von.push(i);
      bis.push(ende);
    }
    aus += f;
    i = ende;
  }
  return { text: aus, von, bis };
}

export function enthaeltGeschuetztenNamen(text: string | null | undefined): boolean {
  return typeof text === "string" && NAME_GEFALTET.test(falte(text).text);
}

/** Ersetzt den geschützten Namen für die Anzeige. Für Freigabetexte NICHT verwenden: die werden gesperrt. */
export function maskiereGeschuetzteNamen(text: string): string {
  const f = falte(text);
  let aus = "";
  let pos = 0;
  for (const treffer of f.text.matchAll(NAME_GEFALTET_ALLE)) {
    const start = treffer.index ?? 0;
    const von = f.von[start];
    const bis = f.bis[start + treffer[0].length - 1];
    if (von < pos) continue;
    aus += text.slice(pos, von) + NAMENS_ERSATZ;
    pos = bis;
  }
  return pos === 0 ? text : aus + text.slice(pos);
}

export interface FreigabePruefung {
  /** true = darf auf "freigegeben" gesetzt werden. */
  freigebbar: boolean;
  /** Sperrgrund für Menschen; null, wenn freigebbar. */
  grund: string | null;
  urteil: CounselUrteil;
  /** Maßgebliche URTEIL-Zeile mit maskiertem Namen; null, wenn keine. */
  zeile: string | null;
}

/**
 * Darf dieser Text freigegeben werden? Nur bei COUNSEL-Urteil FREIGABE, einem Text ab
 * MIN_FREIGABE_ZEICHEN Zeichen und ohne geschützten Namen. Alles andere sperrt.
 */
export function pruefeFreigabe(counsel: CounselAuswertung, body: string | null | undefined): FreigabePruefung {
  const zeile = counsel.zeile === null ? null : maskiereGeschuetzteNamen(counsel.zeile);
  const basis = { urteil: counsel.urteil, zeile };
  if (counsel.urteil !== "FREIGABE") {
    return { freigebbar: false, grund: `COUNSEL-Urteil ${counsel.urteil} (${counsel.grund})`, ...basis };
  }
  const text = typeof body === "string" ? body.trim() : "";
  if (text.length === 0) {
    return { freigebbar: false, grund: "Freigabetext leer", ...basis };
  }
  if (text.length < MIN_FREIGABE_ZEICHEN) {
    return {
      freigebbar: false,
      grund: `Freigabetext zu kurz (${text.length} Zeichen, Mindestlänge ${MIN_FREIGABE_ZEICHEN})`,
      ...basis,
    };
  }
  if (enthaeltGeschuetztenNamen(text)) {
    return { freigebbar: false, grund: "Freigabetext enthält einen geschützten Namen", ...basis };
  }
  return { freigebbar: true, grund: null, ...basis };
}
