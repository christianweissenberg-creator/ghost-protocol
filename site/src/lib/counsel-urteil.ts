// Gehärtete Auswertung des COUNSEL-Urteils — fail-closed (Objekt-Studio Stufe 1).
//
// Geschichte: Bis 04.11.2026 genügte in pipeline/route.ts /URTEIL:\s*FREIGABE/ irgendwo im
// Text. Die erste Härtung (05.11.) prüfte eine Verneinungsliste direkt hinter dem Wort
// FREIGABE und ließ natürliche Formulierungen durch, etwa "URTEIL: Freigabe abgelehnt",
// "URTEIL: FREIGABE: NEIN" oder "URTEIL: FREIGABE erst nach Korrektur" (adversariale
// Prüfung 06.11.2026, Befund R1). Seit 06.11.2026 gilt eine Positivliste:
// 1. Sonderbindestriche und Gedankenstriche (U+2010 bis U+2015, U+2212) werden zu "-".
// 2. Enthält eine Zeile "URTEIL" und eine Durchstreichung ("~"), ist das Ergebnis UNKLAR.
// 3. Markdown-Zeichen (* _ # ` >) werden vor der Suche entfernt.
// 4. Gewertet werden nur Zeilen, die mit "URTEIL:" beginnen (Aufzählungszeichen davor erlaubt).
// 5. Eine Zeile ist FREIGABE nur, wenn ihr Wert ohne Satzzeichen am Ende genau FREIGABE,
//    FREIGABE-EMPFEHLUNG oder FREIGABE EMPFEHLUNG lautet. Jeder Zusatz macht sie UNKLAR.
// 6. FREIGABE insgesamt nur, wenn JEDE URTEIL-Zeile FREIGABE ist. Steht neben einer
//    FREIGABE-Zeile irgendeine andere, gilt UNKLAR. Ohne FREIGABE-Zeile entscheidet die
//    letzte Zeile zwischen ABLEHNUNG und UNKLAR.
// 7. UNKLAR lässt nichts durch.
// Der Prompt in pipeline/route.ts verlangt das Literal. Eine Abweichung kostet daher
// höchstens einen abgewiesenen Lauf, nie eine falsche Freigabe.

import type { CounselUrteil } from "./status-types";

export interface CounselAuswertung {
  urteil: CounselUrteil;
  /** Die maßgebliche (letzte) URTEIL-Zeile nach Bereinigung, sonst null. */
  zeile: string | null;
  grund: string;
}

const STRICHE = /[‐-―−]/g;
const MARKDOWN = /[*_#`>]/g;
const AUFZAEHLUNG = /^(?:[-•·]+|\d+[.)])\s*/;
const URTEIL_ZEILE = /^URTEIL\s*:/i;
const FREIGABE_WERT = /^FREIGABE(?:[- ]?EMPFEHLUNG)?$/;
const ABLEHNUNG_WERT = /^(?:ABLEHNUNG|ABGELEHNT)(?!\p{L})/u;
const SATZZEICHEN_ENDE = /[\s.!;:,]+$/;

function klassifiziere(zeile: string): CounselUrteil {
  const wert = zeile
    .replace(URTEIL_ZEILE, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(SATZZEICHEN_ENDE, "")
    .toUpperCase();
  if (!wert) return "UNKLAR";
  if (FREIGABE_WERT.test(wert)) return "FREIGABE";
  if (ABLEHNUNG_WERT.test(wert)) return "ABLEHNUNG";
  return "UNKLAR";
}

export function werteCounselAus(text: string | null | undefined): CounselAuswertung {
  if (!text || !text.trim()) {
    return { urteil: "UNKLAR", zeile: null, grund: "kein Text" };
  }
  const zeilen = text.replace(STRICHE, "-").split(/\r?\n/);

  if (zeilen.some((z) => /URTEIL/i.test(z) && z.includes("~"))) {
    return { urteil: "UNKLAR", zeile: null, grund: "durchgestrichene URTEIL-Zeile" };
  }

  const urteilsZeilen = zeilen
    .map((z) => z.replace(MARKDOWN, "").trim().replace(AUFZAEHLUNG, "").trim())
    .filter((z) => URTEIL_ZEILE.test(z));

  if (urteilsZeilen.length === 0) {
    return { urteil: "UNKLAR", zeile: null, grund: "keine URTEIL-Zeile" };
  }

  const werte = urteilsZeilen.map(klassifiziere);
  const zeile = urteilsZeilen[urteilsZeilen.length - 1];

  if (werte.every((w) => w === "FREIGABE")) {
    return {
      urteil: "FREIGABE",
      zeile,
      grund: werte.length === 1 ? "URTEIL-Zeile" : `${werte.length} übereinstimmende URTEIL-Zeilen`,
    };
  }
  if (werte.includes("FREIGABE")) {
    return { urteil: "UNKLAR", zeile, grund: "widersprüchliche URTEIL-Zeilen" };
  }
  if (werte[werte.length - 1] === "ABLEHNUNG") {
    return { urteil: "ABLEHNUNG", zeile, grund: "letzte URTEIL-Zeile" };
  }
  return { urteil: "UNKLAR", zeile, grund: "URTEIL-Zeile ohne eindeutigen Wert" };
}
