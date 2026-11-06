// Freigabe-Kette, Serverseite (Fixrunde 06.11.2026, Gruppe A). Lauf: npm test.
//
// Die Routen selbst importieren next/server und @/lib/... und lassen sich hier nicht laden;
// ihr Verhalten prüft die Routen-Harness außerhalb des Repos. Diese Datei hält zweierlei fest:
// 1. die Bibliotheksregeln in genau der Kombination, in der die Routen sie anwenden
//    (Freigeben = pruefeFreigabe(werteCounselAus(review_notes), body), Befund R4;
//    review_notes an PUBLISHER nur maskiert, R24; Fehlertexte bereinigt, R17);
// 2. Quelltext-Wachen für Verträge, die sonst still brechen würden (Lauf-ID-Format für
//    crypto.randomUUID(), eine einzige Mindestlänge, keine Projektnamen in den Prompts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { werteCounselAus } from "../src/lib/counsel-urteil.ts";
import { MIN_FREIGABE_ZEICHEN, NAMENS_ERSATZ, maskiereGeschuetzteNamen, pruefeFreigabe } from "../src/lib/freigabe-regeln.ts";
import { bereinigeFehler } from "../src/lib/status-server.ts";

const quelle = (pfad) => readFileSync(new URL(`../src/app/api/${pfad}`, import.meta.url), "utf8");
const PIPELINE = quelle("content/pipeline/route.ts");
const STATUS = quelle("content/status/route.ts");
const FREIGABEN = quelle("freigaben/route.ts");
const AUTO = quelle("content/auto-produce/route.ts");

// Geschützter Name nur zusammengesetzt, damit er hier nicht als Literal steht.
const NAME = ["Immo", "Nexus"].join("");
const NAME_RE = /imm[ou][\s._-]*nexus/i;
const TEXT = "Denkmal-Altbau in Leipzig, 4 Zimmer, saniert 2024. Jetzt Exposé anfordern.";
const freigeben = (reviewNotes, body) => pruefeFreigabe(werteCounselAus(reviewNotes), body);

// ── 1. Regeln in der Kombination der Routen ─────────────────────────────────

test("R4: Freigeben mit eindeutigem Urteil und Text ist erlaubt", () => {
  const r = freigeben("Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG", TEXT);
  assert.equal(r.freigebbar, true);
  assert.equal(r.grund, null);
  assert.equal(r.urteil, "FREIGABE");
  assert.equal(r.zeile, "URTEIL: FREIGABE-EMPFEHLUNG");
});

for (const [fall, notes, muster] of [
  // Altzeilen aus der Zeit der alten Regex (Befund R4, Fall 1) — ohne Override gesperrt.
  ["Altzeile 'FREIGABE nicht möglich'", "Prüfung\nURTEIL: FREIGABE nicht möglich", /^COUNSEL-Urteil UNKLAR/],
  ["Altzeile 'FREIGABE erst nach Korrektur'", "URTEIL: FREIGABE erst nach Korrektur", /^COUNSEL-Urteil UNKLAR/],
  ["Altzeile mit fetter ABLEHNUNG", "Befunde …\nURTEIL: **ABLEHNUNG**", /^COUNSEL-Urteil ABLEHNUNG/],
  // Zeile ohne review_notes (Befund R4, Fall 3)
  ["ohne review_notes", null, /^COUNSEL-Urteil UNKLAR \(kein Text\)$/],
]) {
  test(`R4: Freigeben gesperrt — ${fall}`, () => {
    const r = freigeben(notes, TEXT);
    assert.equal(r.freigebbar, false);
    assert.match(r.grund, muster);
  });
}

test("R4: leerer body sperrt auch bei Urteil FREIGABE (Befund R4, Fall 2)", () => {
  for (const body of [null, "", "  \n\t "]) {
    const r = freigeben("URTEIL: FREIGABE", body);
    assert.equal(r.freigebbar, false);
    assert.equal(r.grund, "Freigabetext leer");
  }
  assert.equal(freigeben("URTEIL: FREIGABE", "x".repeat(MIN_FREIGABE_ZEICHEN - 1)).freigebbar, false);
  assert.equal(freigeben("URTEIL: FREIGABE", "x".repeat(MIN_FREIGABE_ZEICHEN)).freigebbar, true);
});

test("R4/R24: Sperrgrund und URTEIL-Zeile nennen den geschützten Namen nie", () => {
  const r = freigeben(`Hinweis\nURTEIL: ABLEHNUNG wegen ${NAME}-Bezug`, TEXT);
  assert.equal(r.freigebbar, false);
  assert.doesNotMatch(r.grund, NAME_RE);
  assert.doesNotMatch(r.zeile, NAME_RE);
  assert.ok(r.zeile.includes(NAMENS_ERSATZ));
  const imText = freigeben("URTEIL: FREIGABE", `${TEXT} Daten aus dem ${NAME}-Export.`);
  assert.equal(imText.freigebbar, false);
  assert.doesNotMatch(imText.grund, NAME_RE);
});

test("R24: review_notes für PUBLISHER — nur der Name wird ersetzt, das Urteil bleibt lesbar", () => {
  const review = `Regel 1.2 (${NAME}-Export) beachtet.\nURTEIL: FREIGABE-EMPFEHLUNG`;
  const maskiert = maskiereGeschuetzteNamen(review);
  assert.equal(maskiert, `Regel 1.2 (${NAMENS_ERSATZ}-Export) beachtet.\nURTEIL: FREIGABE-EMPFEHLUNG`);
  assert.equal(werteCounselAus(maskiert).urteil, "FREIGABE");
});

test("R17: Fehlertext mit Schlüssel (fetch 'Headers.append') verlässt den Server ohne Schlüssel", () => {
  // Nur ein Testwert in diesem Testprozess, kein echter Schlüssel.
  const schluessel = "sk-ant-test-0123456789abcdefGHIJ";
  process.env.ANTHROPIC_API_KEY = schluessel;
  const ganz = bereinigeFehler(new TypeError(`Headers.append: "${schluessel}" is an invalid header value.`));
  assert.ok(!ganz.includes(schluessel), ganz);
  const zerteilt = bereinigeFehler(`Headers.append: "${schluessel.slice(0, 16)}\r${schluessel.slice(16)}" is invalid`);
  assert.ok(!zerteilt.includes(schluessel.slice(0, 16)) && !zerteilt.includes(schluessel.slice(16)), zerteilt);
});

// ── 2. Quelltext-Wachen ──────────────────────────────────────────────────────

function laufIdMuster() {
  const m = /const LAUF_ID_MUSTER = \/(.+)\/;/.exec(PIPELINE);
  assert.ok(m, "LAUF_ID_MUSTER nicht gefunden");
  return new RegExp(m[1]);
}

test("R10: Lauf-ID-Vertrag — crypto.randomUUID() passt, Ungültiges nicht", () => {
  const muster = laufIdMuster();
  for (let i = 0; i < 20; i++) assert.ok(muster.test(randomUUID()));
  assert.ok(muster.test("lauf:2026-11-06_ab"));
  for (const falsch of ["kurz", "1234567", "x".repeat(81), "mit leerzeichen 1", "ä-umlaut-1234", "abc/def/ghi"]) {
    assert.equal(muster.test(falsch), false, falsch);
  }
  assert.ok(muster.test("x".repeat(8)) && muster.test("x".repeat(80)));
});

test("Mindestlänge: eine Quelle (lib/freigabe-regeln.ts), keine eigene Konstante in den Routen", () => {
  assert.match(PIPELINE, /import \{[^}]*\bMIN_FREIGABE_ZEICHEN\b[^}]*\} from "@\/lib\/freigabe-regeln";/);
  for (const [name, text] of [["pipeline", PIPELINE], ["status", STATUS], ["freigaben", FREIGABEN]]) {
    assert.doesNotMatch(text, /const MIN_FREIGABE_ZEICHEN\s*=/, name);
  }
});

test("R24: Pipeline-Quelltext ohne WHITEPULSE und ohne geschützten Namen", () => {
  assert.doesNotMatch(PIPELINE, /whitepulse/i);
  assert.doesNotMatch(PIPELINE, NAME_RE);
  assert.match(PIPELINE, /Interna anderer Projekte und Marken gehören NIE in Steinadel-Content/);
});

test("R2: auto-produce nennt die Ausgabe PUBLISHER-Fassung, nicht 'Finaler Content'", () => {
  assert.match(AUTO, /PUBLISHER-Fassung, von COUNSEL nicht geprüft/);
  assert.doesNotMatch(AUTO, /Finalen Content/);
});
