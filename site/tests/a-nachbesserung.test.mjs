// Freigabe-Kette, Nachbesserung nach der Prüfung (06.11.2026, Gruppe A). Lauf: npm test.
//
// Diese Datei hält Quelltext-Wachen fest, damit die Korrekturen nicht still zurückfallen. Das
// Verhalten (Protokollfehler je Eintrag, höchstens ein Lauf je Lauf-ID, Ablehnungszweig bei
// Speicherfehler, Fehllauf-Kosten) prüft seit der Gesamtprüfung 06.11.2026 die Routen-Harness im
// Repo: tests/z-routen.test.mjs (echte Route-Handler, Attrappen in tests/harness/fake.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = (pfad) => readFileSync(new URL(`../src/app/api/${pfad}`, import.meta.url), "utf8");
const PIPELINE = quelle("content/pipeline/route.ts");
const AUTO = quelle("content/auto-produce/route.ts");

/** Quelltext ab `anfang` bis zur ersten Zeile, die nur "}" bzw. "};" enthält. */
function abschnitt(text, anfang) {
  const start = text.indexOf(anfang);
  assert.ok(start >= 0, `nicht gefunden: ${anfang}`);
  const ende = text.slice(start).search(/\n\};?\n/);
  assert.ok(ende > 0, `Ende nicht gefunden: ${anfang}`);
  return text.slice(start, start + ende);
}

test("activate-Vertrag: Protokollfehler je Eintrag (Liste, sonst Text am Trenner), bereinigt, auch auf dem Fehlerweg", () => {
  const leser = abschnitt(PIPELINE, "function leseProtokollFehler(");
  // Gesamtprüfung 06.11.2026: Liste protokoll_fehler_liste vor dem Text; je Eintrag bereinigt.
  assert.match(leser, /leseProtokollEintraege\(liste, text\)/);
  assert.match(leser, /\.map\(\(e\) => fehlerText\(e\)\)/);
  // Andere Formen sind ein Vertragsbruch und werden vermerkt.
  assert.match(leser, /PROTOKOLL_UNLESBAR/);
  assert.match(PIPELINE, /leseProtokollFehler\(obj\.protokoll_fehler_liste, obj\.protokoll_fehler\)/);
  assert.match(PIPELINE, /if \(err instanceof AktivierungsFehler\) \{[\s\S]{0,400}vermerkeProtokoll\(step, err\.protokollFehler, warnungen\)/);
  // Die alten Leseformen (nur Liste; ganzer Text als EIN Eintrag gekürzt) kommen nicht zurück.
  assert.doesNotMatch(PIPELINE, /Array\.isArray\(obj\.protokoll_fehler\)/);
  assert.doesNotMatch(leser, /Array\.isArray\(wert\) \? wert : \[wert\]/);
});

test("R10: nach dem Insert läuft nur, wer die eigene Zeile als einzige sieht (zwei Zeilen gelesen)", () => {
  assert.match(PIPELINE, /const nachher = await zeilenZuLauf\(supabase, laufId, 2\);/);
  assert.match(PIPELINE, /nachher\.zeilen\.find\(\(z\) => z\.id !== contentId\)/);
  // Vorab-Prüfung: die kleinste vorhandene Zeile genügt.
  assert.match(PIPELINE, /const vorher = await zeilenZuLauf\(supabase, laufId, 1\);/);
});

test("R6: gescheitertes COUNSEL-Speichern wird vor dem Ablehnungszweig geprüft", () => {
  const pruefung = PIPELINE.indexOf("if (!counselGespeichert) {");
  const ablehnung = PIPELINE.indexOf("if (rejected) {");
  assert.ok(pruefung > 0, "Prüfung auf counselGespeichert fehlt");
  assert.ok(ablehnung > pruefung, "Ablehnungszweig antwortet vor der Speicher-Prüfung");
});

test("R24: Objekt-Läufe — Kategorie und Stilregel ohne Projektnamen; eigener Content unverändert", () => {
  const objektLabel = abschnitt(PIPELINE, "const KATEGORIE_LABEL_OBJEKT");
  // Nur die Werte prüfen (der Schlüssel ghost_protocol bleibt, er ist der API-Wert).
  for (const [, wert] of objektLabel.matchAll(/:\s*"([^"]*)"/g)) {
    assert.doesNotMatch(wert, /ghost[\s._-]*protocol|whitepulse/i, wert);
  }
  assert.match(PIPELINE, /\(objekt \? KATEGORIE_LABEL_OBJEKT : KATEGORIE_LABEL\)\[categoryKey\]/);
  assert.match(
    PIPELINE,
    /\$\{objekt \? "Interne System-, Projekt- und Agentennamen NICHT erwähnen" : "Ghost Protocol NICHT erwähnen"\}/
  );
  // Kein Prompt liest die Kategorie mehr direkt aus KATEGORIE_LABEL[categoryKey].
  assert.doesNotMatch(PIPELINE, /\$\{KATEGORIE_LABEL\[categoryKey\]\}/);
});

test("auto-produce: ohne PUBLISHER-Text kein Hinweis auf eine Fassung", () => {
  assert.match(AUTO, /vorschau === null\s*\?\s*"keine PUBLISHER-Fassung im Ergebnis"/);
});
