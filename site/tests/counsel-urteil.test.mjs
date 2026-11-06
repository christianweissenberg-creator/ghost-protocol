// Tests für die gehärtete COUNSEL-Auswertung (Positivliste seit 06.11.2026, Befund R1).
// Lauf: npm test (node --test; Node ≥ 23.6 lädt die .ts-Datei per Type-Stripping direkt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { werteCounselAus } from "../src/lib/counsel-urteil.ts";

const faelle = [
  // Ohne Urteil
  ["leerer Text", null, "UNKLAR"],
  ["nur Leerraum", "   \n  ", "UNKLAR"],
  ["kein Urteil", "Alles sieht gut aus.", "UNKLAR"],
  ["leeres Urteil", "URTEIL:", "UNKLAR"],
  ["unbekannter Wert", "URTEIL: VIELLEICHT", "UNKLAR"],
  ["Gesamturteil zählt nicht", "Gesamt-URTEIL: FREIGABE", "UNKLAR"],
  // Eindeutige Freigabe
  ["klare Freigabe", "Prüfung ok.\nURTEIL: FREIGABE-EMPFEHLUNG", "FREIGABE"],
  ["nur FREIGABE", "URTEIL: FREIGABE", "FREIGABE"],
  ["Freigabe mit Punkt", "URTEIL: FREIGABE-EMPFEHLUNG.", "FREIGABE"],
  ["Freigabe mit Leerzeichen statt Bindestrich", "URTEIL: FREIGABE EMPFEHLUNG", "FREIGABE"],
  ["Freigabe mit Gedankenstrich als Bindestrich", "URTEIL: FREIGABE–EMPFEHLUNG", "FREIGABE"],
  ["Freigabe fett", "**URTEIL:** **FREIGABE-EMPFEHLUNG**", "FREIGABE"],
  ["Freigabe als Überschrift", "## URTEIL: FREIGABE-EMPFEHLUNG", "FREIGABE"],
  ["Freigabe mit Aufzählungszeichen", "- URTEIL: FREIGABE-EMPFEHLUNG", "FREIGABE"],
  ["Freigabe nummeriert", "3. URTEIL: FREIGABE-EMPFEHLUNG", "FREIGABE"],
  ["Kleinschreibung", "urteil: freigabe-empfehlung", "FREIGABE"],
  ["zweimal dieselbe Freigabe", "URTEIL: FREIGABE-EMPFEHLUNG\nBegründung …\nURTEIL: FREIGABE-EMPFEHLUNG", "FREIGABE"],
  // Eindeutige Ablehnung
  ["klare Ablehnung", "Verstoß gegen Regel 7.\nURTEIL: ABLEHNUNG", "ABLEHNUNG"],
  ["Ablehnung fett (Lauf #4 vom 28.07.)", "Befunde …\nURTEIL: **ABLEHNUNG**", "ABLEHNUNG"],
  ["Ablehnung mit Begründung", "URTEIL: ABLEHNUNG – Regel 7 verletzt", "ABLEHNUNG"],
  ["Fließtext vor dem Urteil zählt nicht", "Eine URTEIL: FREIGABE ist nicht möglich.\nURTEIL: ABLEHNUNG", "ABLEHNUNG"],
  ["Nachtrag nach Ablehnung zählt nicht", "URTEIL: ABLEHNUNG\n\nNachtrag: bei Korrektur wäre URTEIL: FREIGABE möglich", "ABLEHNUNG"],
  // Jeder Zusatz hinter FREIGABE ist UNKLAR (Befund R1)
  ["Freigabe mit Auflagen-Text", "URTEIL: FREIGABE-EMPFEHLUNG — keine weiteren Auflagen", "UNKLAR"],
  ["Optionen zitiert", "URTEIL: FREIGABE-EMPFEHLUNG oder URTEIL: ABLEHNUNG", "UNKLAR"],
  ["Freigabe verneint", "URTEIL: FREIGABE nicht möglich", "UNKLAR"],
  ["Freigabe verneint mit ist", "URTEIL: Freigabe ist nicht möglich", "UNKLAR"],
  ["Freigabe: NEIN", "URTEIL: FREIGABE: NEIN", "UNKLAR"],
  ["Freigabe-Empfehlung: NEIN", "URTEIL: FREIGABE-EMPFEHLUNG: NEIN", "UNKLAR"],
  ["Freigabe abgelehnt", "URTEIL: Freigabe abgelehnt", "UNKLAR"],
  ["Empfehlung kann nicht erteilt werden", "URTEIL: FREIGABE-EMPFEHLUNG kann nicht erteilt werden", "UNKLAR"],
  ["Freigabe kann nicht erteilt werden", "URTEIL: Freigabe kann nicht erteilt werden", "UNKLAR"],
  ["Freigabe wird nicht empfohlen", "URTEIL: Freigabe wird nicht empfohlen", "UNKLAR"],
  ["Freigabe ausgeschlossen", "URTEIL: Freigabe ausgeschlossen", "UNKLAR"],
  ["Freigabe erst nach Korrektur", "URTEIL: FREIGABE erst nach Korrektur der Punkte 1-3", "UNKLAR"],
  ["Freigabe nur nach Korrektur", "URTEIL: FREIGABE nur nach Korrektur", "UNKLAR"],
  ["Freigabe in Klammern verneint", "URTEIL: FREIGABE (nicht empfohlen)", "UNKLAR"],
  ["Freigabe Gedankenstrich nicht möglich", "URTEIL: FREIGABE – nicht möglich", "UNKLAR"],
  ["Halbgeviertstrich + NICHT MÖGLICH", "URTEIL: FREIGABE–EMPFEHLUNG NICHT MÖGLICH", "UNKLAR"],
  ["geschützter Bindestrich + NICHT MÖGLICH", "URTEIL: FREIGABE‑EMPFEHLUNG NICHT MÖGLICH", "UNKLAR"],
  ["Freigabe mit Häkchen", "URTEIL: FREIGABE-EMPFEHLUNG ✅", "UNKLAR"],
  // Durchgestrichen oder widersprüchlich
  ["durchgestrichene Freigabe", "~~URTEIL: FREIGABE-EMPFEHLUNG~~", "UNKLAR"],
  ["durchgestrichene Ablehnung, dann Freigabe", "~~URTEIL: ABLEHNUNG~~\nURTEIL: FREIGABE-EMPFEHLUNG", "UNKLAR"],
  ["widersprüchliche Zeilen", "URTEIL: FREIGABE-EMPFEHLUNG\nNach erneuter Prüfung:\nURTEIL: ABLEHNUNG", "UNKLAR"],
  ["Ablehnung, dann Freigabe", "URTEIL: ABLEHNUNG\nURTEIL: FREIGABE-EMPFEHLUNG", "UNKLAR"],
  ["spätere Freigabe überstimmt Verneinung nicht", "URTEIL: FREIGABE nicht möglich\nURTEIL: FREIGABE-EMPFEHLUNG", "UNKLAR"],
];

for (const [name, text, erwartet] of faelle) {
  test(`COUNSEL-Auswertung: ${name}`, () => {
    assert.equal(werteCounselAus(text).urteil, erwartet);
  });
}

test("Nur FREIGABE lässt durch — UNKLAR und ABLEHNUNG sind nie FREIGABE", () => {
  for (const [, text, erwartet] of faelle) {
    const urteil = werteCounselAus(text).urteil;
    if (erwartet !== "FREIGABE") assert.notEqual(urteil, "FREIGABE");
  }
});

test("Kein Zusatz hinter FREIGABE-EMPFEHLUNG ergibt FREIGABE", () => {
  const zusaetze = [
    " nein", ": nein", " NICHT", " (unter Vorbehalt)", " bedingt", " mit Auflagen", " erst nach Korrektur",
    " – abgelehnt", " kann nicht erteilt werden", " ausgeschlossen", " ❌", " ✗", " / ABLEHNUNG", "?",
  ];
  for (const zusatz of zusaetze) {
    const r = werteCounselAus(`URTEIL: FREIGABE-EMPFEHLUNG${zusatz}`);
    assert.notEqual(r.urteil, "FREIGABE", `Zusatz "${zusatz}" ergab FREIGABE`);
  }
});

test("Die maßgebliche Zeile wird mitgeliefert", () => {
  const r = werteCounselAus("Text\nURTEIL: **FREIGABE-EMPFEHLUNG**");
  assert.equal(r.zeile, "URTEIL: FREIGABE-EMPFEHLUNG");
});
