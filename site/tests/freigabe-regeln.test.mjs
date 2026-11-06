// Tests für die gemeinsamen Freigabe-Regeln (lib/freigabe-regeln.ts). Lauf: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { werteCounselAus } from "../src/lib/counsel-urteil.ts";
import {
  MIN_FREIGABE_ZEICHEN,
  NAMENS_ERSATZ,
  enthaeltGeschuetztenNamen,
  maskiereGeschuetzteNamen,
  pruefeFreigabe,
} from "../src/lib/freigabe-regeln.ts";

const TEXT = "Denkmal-Altbau in Leipzig, 4 Zimmer, saniert 2024. Jetzt Exposé anfordern.";
const FREI = werteCounselAus("Prüfung ok.\nURTEIL: FREIGABE-EMPFEHLUNG");

test("Freigabe mit gültigem Urteil und Text", () => {
  const r = pruefeFreigabe(FREI, TEXT);
  assert.equal(r.freigebbar, true);
  assert.equal(r.grund, null);
});

for (const [name, notes] of [
  ["Ablehnung", "URTEIL: ABLEHNUNG"],
  ["unklar", "URTEIL: FREIGABE nur nach Korrektur"],
  ["ohne Urteil", "Sieht gut aus."],
  ["ohne review_notes", null],
]) {
  test(`gesperrt: COUNSEL ${name}`, () => {
    const r = pruefeFreigabe(werteCounselAus(notes), TEXT);
    assert.equal(r.freigebbar, false);
    assert.match(r.grund, /COUNSEL-Urteil/);
  });
}

for (const [name, body] of [
  ["leer", ""],
  ["nur Leerraum", "   \n "],
  ["null", null],
  ["zu kurz", "x".repeat(MIN_FREIGABE_ZEICHEN - 1)],
]) {
  test(`gesperrt: Text ${name}`, () => {
    const r = pruefeFreigabe(FREI, body);
    assert.equal(r.freigebbar, false);
    assert.match(r.grund, /Freigabetext/);
  });
}

test("genau Mindestlänge ist freigebbar", () => {
  assert.equal(pruefeFreigabe(FREI, "x".repeat(MIN_FREIGABE_ZEICHEN)).freigebbar, true);
});

for (const schreibweise of ["ImmoNexus", "IMMONEXUS", "Immo Nexus", "Immo-Nexus", "immonexus", "Immunexus"]) {
  test(`gesperrt: geschützter Name als "${schreibweise}"`, () => {
    const r = pruefeFreigabe(FREI, `${TEXT} Daten aus dem ${schreibweise}-Export.`);
    assert.equal(r.freigebbar, false);
    assert.match(r.grund, /geschützten Namen/);
    assert.equal(enthaeltGeschuetztenNamen(schreibweise), true);
  });
}

test("Maskierung ersetzt jede Fundstelle und lässt den Rest stehen", () => {
  const maskiert = maskiereGeschuetzteNamen("Regel 1.2: ImmoNexus-Export; siehe IMMONEXUS.");
  assert.equal(maskiert, `Regel 1.2: ${NAMENS_ERSATZ}-Export; siehe ${NAMENS_ERSATZ}.`);
  assert.equal(enthaeltGeschuetztenNamen(maskiert), false);
});

test("Steinadel und Ghost Protocol sind nicht geschützt", () => {
  assert.equal(enthaeltGeschuetztenNamen("Steinadel Backoffice, Ghost Protocol"), false);
});

test("Die URTEIL-Zeile kommt maskiert zurück", () => {
  const r = pruefeFreigabe(werteCounselAus("URTEIL: ABLEHNUNG wegen ImmoNexus-Bezug"), TEXT);
  assert.equal(r.zeile.includes("ImmoNexus"), false);
});

// ── Gesamtprüfung 06.11.2026: typografische Schreibweisen (gemessen: 7 von 10 gingen durch) ──

const A = ["Imm", "o"].join("");
const B = ["Nex", "us"].join("");
const VARIANTEN = [
  ["Halbgeviertstrich U+2013", `${A}–${B}`],
  ["geschützter Bindestrich U+2011", `${A}‑${B}`],
  ["weiches Trennzeichen U+00AD", `${A}­${B}`],
  ["Nullbreite U+200B", `${A}​${B}`],
  ["Schrägstrich", `${A}/${B}`],
  ["Mittelpunkt U+00B7", `${A}·${B}`],
  ["kyrillisches о U+043E", `Immо${B}`],
  ["NBSP", `${A} ${B}`],
  ["Gedankenstrich mit Leerzeichen", `${A} — ${B}`],
  ["Markdown-Fett", `**${A}**${B}`, `**${NAMENS_ERSATZ}`],
  ["weiches Trennzeichen mitten im Wort", `Im­mo${B}`],
  ["Nullbreite zwischen allen Buchstaben", [...`${A}${B}`].join("​")],
  ["Vollbreite", "ＩｍｍｏＮｅｘｕｓ"],
  ["mathematisch fett", "\u{1D408}\u{1D426}\u{1D426}\u{1D428}\u{1D40D}\u{1D41E}\u{1D431}\u{1D42E}\u{1D42C}"],
  ["Akzent (zerlegt)", `Immö${B}`],
  ["Akzent (zusammengesetzt)", `Immö${B}`],
  ["griechisches ο und kyrillisches е, х", `ImmοNехus`],
  ["kyrillische Großbuchstaben", `IMMОNEXUЅ`],
];

for (const [name, schreibweise, erwartet = NAMENS_ERSATZ] of VARIANTEN) {
  test(`erkannt und gesperrt: ${name}`, () => {
    assert.equal(enthaeltGeschuetztenNamen(`Text ${schreibweise} Text`), true);
    const r = pruefeFreigabe(FREI, `${TEXT} Daten aus dem ${schreibweise}-Export.`);
    assert.equal(r.freigebbar, false);
    assert.match(r.grund, /geschützten Namen/);
  });
  test(`maskiert ohne Rest: ${name}`, () => {
    const maskiert = maskiereGeschuetzteNamen(`Vorher ${schreibweise} nachher.`);
    assert.equal(maskiert, `Vorher ${erwartet} nachher.`);
    assert.equal(enthaeltGeschuetztenNamen(maskiert), false);
  });
}

test("Maskierung lässt Text ohne Namen unverändert (auch mit Umlauten, Emoji und Surrogaten)", () => {
  for (const t of ["", "Größe 112 m² — Exposé anfordern 🏛️", "Immobilien Nexus-Analyse", "\u{1D408}nhalt", "Immo nexus-artig ohne Trenner? nein: Immonex"]) {
    if (enthaeltGeschuetztenNamen(t)) continue;
    assert.equal(maskiereGeschuetzteNamen(t), t);
  }
  assert.equal(enthaeltGeschuetztenNamen("Immobilien Nexus-Analyse"), false);
  assert.equal(enthaeltGeschuetztenNamen("Immonex"), false);
});

test("Maskierung trifft mehrere Fundstellen und behält Zeichen davor und danach", () => {
  const t = `🏛️ ${A}–${B}, dann ${A.toUpperCase()}${B.toUpperCase()}; Ende`;
  assert.equal(maskiereGeschuetzteNamen(t), `🏛️ ${NAMENS_ERSATZ}, dann ${NAMENS_ERSATZ}; Ende`);
});
