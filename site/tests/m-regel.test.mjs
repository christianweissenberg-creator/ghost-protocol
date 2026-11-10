// Objekt-Studio Schritt 8 (10.11.2026): Medien-Freigaberegel pruefeMedienFreigabe (lib/medien-freigabe.ts) und die
// Konstanten des KI-Hinweises (lib/studio/ki-hinweis.ts). Lauf: npm test.
//
// Reine Funktion, kein Netz, keine Datenbank: Grundfall, je Bedingung 1–9 ein Gegenfall mit genau diesem Grund, alle
// Gründe zugleich, das jüngste Protokoll in beide Richtungen, unlesbare Werte und die Reinheit (keine Laufzeit-Importe).
// Alle Werte sind Testwerte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(SITE, "package.json"))("typescript");
const { pruefeMedienFreigabe } = await import("../src/lib/medien-freigabe.ts");
const { KI_HINWEIS_BILD, KI_PFLICHTZEILE_CAPTION } = await import("../src/lib/studio/ki-hinweis.ts");

const ANKER_SHA = "a".repeat(64);
const EXPORT_SHA = "c".repeat(64);
const VORGABEN = {
  anker: [
    { id: "test-anker", sha256: ANKER_SHA, als_anker: true },
    { id: "kein-anker", sha256: "b".repeat(64), als_anker: false },
  ],
  ki_hinweis_bild: KI_HINWEIS_BILD,
};

function kette({ export: ex = {}, original = {}, startbild = {} } = {}) {
  return {
    export: { id: 3, fassung: "export", abgeleitet_von: 2, job_id: "job-1", sha256: EXPORT_SHA, ki_hinweis_text: KI_HINWEIS_BILD, schnitt_von_s: 0.25, schnitt_bis_s: 2.75, anker_id: "test-anker", anker_sha256: ANKER_SHA, ...ex },
    original:
      original === null
        ? null
        : { id: 2, fassung: "original", startbild_id: 1, job_id: "job-1", dauer_s: 4.5, anker_id: "test-anker", prompt_klauseln: [{ id: "licht", text: "Licht ruhig." }, { id: "rahmen", text: "Rahmen bleibt." }], ...original },
    startbild: startbild === null ? null : { id: 1, fassung: "startbild", anker_id: "test-anker", startbild_abgleich: "bestanden", startbild_abweichung_max: 0, ...startbild },
  };
}

function protokoll(extra = {}) {
  return {
    id: 10,
    medium_id: 3,
    medium_sha256: EXPORT_SHA,
    geprueft_am: "2026-11-11T10:00:00.000000+00:00",
    klauseln: [
      { id: "licht", bestanden: true },
      { id: "rahmen", bestanden: true },
    ],
    anker_abgleich: "bestanden",
    ki_hinweis_eingebrannt: true,
    durchsicht_volle_bildrate: true,
    rechte_status: "geklaert",
    rechte_nachweis: "Verweis (Testwert)",
    ...extra,
  };
}

const regel = (k = kette(), p = [protokoll()], v = VORGABEN) => pruefeMedienFreigabe(k, p, v);

test("MR-1 Grundfall: jede Bedingung erfüllt → freigebbar, ohne Grund, mit maßgeblichem Protokoll, id und Hash des Exports", () => {
  assert.deepEqual(regel(), { freigebbar: true, gruende: [], grund: null, pruefung_id: 10, medium_id: 3, medium_sha256: EXPORT_SHA });
  // NUMERIC kann als Text kommen; Werte am Rand des Fensters (von 0, bis = Dauer) sind zulässig.
  const rand = regel(kette({ export: { schnitt_von_s: "0", schnitt_bis_s: "4.5" }, original: { dauer_s: "4.500" } }));
  assert.equal(rand.freigebbar, true, rand.gruende.join(" | "));
});

const FAELLE = [
  ["1 job_id", kette({ original: { job_id: "job-2" } }), [protokoll()], "Original und Export tragen nicht dieselbe job_id"],
  ["1 kein Export", kette({ export: { fassung: "original" } }), [protokoll()], "Medium ist kein Export"],
  ["1 ohne Verweis", kette({ export: { abgeleitet_von: null } }), [protokoll()], "Export ohne Verweis auf sein Original"],
  ["2 kein Protokoll", kette(), [], "Prüfprotokoll fehlt"],
  ["2 anderer Hash", kette(), [protokoll({ medium_sha256: "d".repeat(64) })], "Jüngstes Prüfprotokoll gilt einer anderen Datei (SHA-256 weicht ab)"],
  ["3 Klausel nicht bestanden", kette(), [protokoll({ klauseln: [{ id: "licht", bestanden: true }, { id: "rahmen", bestanden: false }] })], "Klausel „rahmen“ nicht bestanden"],
  ["3 Klausel fehlt", kette(), [protokoll({ klauseln: [{ id: "licht", bestanden: true }] })], "Klausel „rahmen“ fehlt im Prüfprotokoll"],
  ["3 Klausel doppelt", kette(), [protokoll({ klauseln: [{ id: "licht", bestanden: true }, { id: "rahmen", bestanden: true }, { id: "rahmen", bestanden: true }] })], "Klausel „rahmen“ steht mehrfach im Prüfprotokoll"],
  ["4 Anker-Abgleich", kette(), [protokoll({ anker_abgleich: "nicht_bestanden" })], "Anker-Abgleich nicht bestanden (geprüft: Architektur, Personen, Wasser — Einzelurteile in der Notiz)"],
  ["5 nicht eingebrannt", kette(), [protokoll({ ki_hinweis_eingebrannt: false })], "KI-Hinweis nicht vom ersten bis zum letzten Bild eingebrannt (laut Prüfprotokoll)"],
  ["5 Wortlaut", kette({ export: { ki_hinweis_text: "Alter Hinweistext (Testwert)" } }), [protokoll()], "KI-Hinweis im Bild hat nicht den festgelegten Wortlaut"],
  ["6 Durchsicht", kette(), [protokoll({ durchsicht_volle_bildrate: false })], "Durchsicht in voller Bildrate nicht erklärt"],
  ["7 bis nach dem Ende", kette({ export: { schnitt_bis_s: 4.51 } }), [protokoll()], "Schnittfenster fehlt oder liegt nicht im Original (0 ≤ von < bis ≤ Dauer)"],
  ["7 von = bis", kette({ export: { schnitt_von_s: 2.75 } }), [protokoll()], "Schnittfenster fehlt oder liegt nicht im Original (0 ≤ von < bis ≤ Dauer)"],
  ["7 ohne Fenster", kette({ export: { schnitt_von_s: null, schnitt_bis_s: null } }), [protokoll()], "Schnittfenster fehlt oder liegt nicht im Original (0 ≤ von < bis ≤ Dauer)"],
  ["8 Anker nicht im Manifest", kette({ export: { anker_id: "fremd" }, original: { anker_id: "fremd" }, startbild: { anker_id: "fremd" } }), [protokoll()], "Anker „fremd“ steht nicht als zulässiger Anker im Manifest"],
  ["8 kein zulässiger Anker", kette({ export: { anker_id: "kein-anker", anker_sha256: "b".repeat(64) }, original: { anker_id: "kein-anker" }, startbild: { anker_id: "kein-anker" } }), [protokoll()], "Anker „kein-anker“ steht nicht als zulässiger Anker im Manifest"],
  ["8 Anker-Hash", kette({ export: { anker_sha256: "e".repeat(64) } }), [protokoll()], "Anker-Hash des Exports weicht vom Manifest ab"],
  ["8 Startbild-Abgleich", kette({ startbild: { startbild_abgleich: "nicht_bestanden", startbild_abweichung_max: 7 } }), [protokoll()], "Startbild-Abgleich nicht bestanden (größte Abweichung 7)"],
  ["8 Startbild fehlt", kette({ startbild: null }), [protokoll()], "Startbild des Originals fehlt"],
  ["8 verschiedene Anker", kette({ startbild: { anker_id: "kein-anker" } }), [protokoll()], "Export, Original und Startbild nennen verschiedene Anker"],
  // Teilprüfungen einzeln (Nachbesserung regel8-3, Mutanten R1–R5, B1, X32): je genau ein Grund.
  ["1 Original ist kein Original", kette({ original: { fassung: "export" } }), [protokoll()], "Original des Exports fehlt"],
  ["1 Original mit anderer id", kette({ original: { id: 9 } }), [protokoll()], "Original des Exports fehlt"],
  ["1 job_id auf beiden Seiten leer", kette({ export: { job_id: null }, original: { job_id: null } }), [protokoll()], "Original und Export tragen nicht dieselbe job_id"],
  ["7 von unter 0", kette({ export: { schnitt_von_s: -0.5 } }), [protokoll()], "Schnittfenster fehlt oder liegt nicht im Original (0 ≤ von < bis ≤ Dauer)"],
  ["8 anderer Anker am Original", kette({ original: { anker_id: "kein-anker" } }), [protokoll()], "Export, Original und Startbild nennen verschiedene Anker"],
  ["8 Startbild mit anderer Fassung", kette({ startbild: { fassung: "original" } }), [protokoll()], "Startbild des Originals fehlt"],
  ["8 Startbild mit anderer id", kette({ startbild: { id: 9 } }), [protokoll()], "Startbild des Originals fehlt"],
  ["8 Original ohne Startbild-Verweis", kette({ original: { startbild_id: null } }), [protokoll()], "Startbild des Originals fehlt"],
  ["9 Rechte offen", kette(), [protokoll({ rechte_status: "offen", rechte_nachweis: null })], "Rechte laut Prüfprotokoll nicht geklärt"],
  ["9 ohne Verweis", kette(), [protokoll({ rechte_nachweis: "   " })], "Rechte als geklärt vermerkt, aber ohne Nachweis-Verweis"],
];

for (const [name, k, p, grund] of FAELLE) {
  test(`MR-2 Bedingung ${name} → gesperrt mit genau diesem Grund`, () => {
    const r = regel(k, p);
    assert.equal(r.freigebbar, false);
    assert.deepEqual(r.gruende, [grund]);
    assert.equal(r.grund, grund);
  });
}

test("MR-3 Alle Gründe zugleich, in der Reihenfolge der Bedingungen — Klausel, Anker, Wortlaut und Startbild; Rechte im Testaufbau geklärt, also kein Rechte-Grund", () => {
  const r = regel(kette({ export: { ki_hinweis_text: "Alter Hinweistext (Testwert)" }, startbild: { startbild_abgleich: "nicht_bestanden", startbild_abweichung_max: 7 } }), [
    protokoll({ klauseln: [{ id: "licht", bestanden: true }, { id: "rahmen", bestanden: false }], anker_abgleich: "nicht_bestanden" }),
  ]);
  assert.deepEqual(r.gruende, [
    "Klausel „rahmen“ nicht bestanden",
    "Anker-Abgleich nicht bestanden (geprüft: Architektur, Personen, Wasser — Einzelurteile in der Notiz)",
    "KI-Hinweis im Bild hat nicht den festgelegten Wortlaut",
    "Startbild-Abgleich nicht bestanden (größte Abweichung 7)",
  ]);
  assert.equal(r.grund, "Klausel „rahmen“ nicht bestanden");
  assert.equal(r.pruefung_id, 10);
  // Alles auf einmal falsch: jede Bedingung meldet sich.
  const alle = regel(
    kette({ export: { ki_hinweis_text: "x", schnitt_bis_s: 9, anker_sha256: "e".repeat(64) }, original: { job_id: "job-2" }, startbild: { startbild_abgleich: "nicht_bestanden", startbild_abweichung_max: null } }),
    [protokoll({ klauseln: [{ id: "licht", bestanden: false }], anker_abgleich: "nicht_bestanden", ki_hinweis_eingebrannt: false, durchsicht_volle_bildrate: false, rechte_status: "offen" })],
  );
  assert.deepEqual(alle.gruende, [
    "Original und Export tragen nicht dieselbe job_id",
    "Klausel „licht“ nicht bestanden",
    "Klausel „rahmen“ fehlt im Prüfprotokoll",
    "Anker-Abgleich nicht bestanden (geprüft: Architektur, Personen, Wasser — Einzelurteile in der Notiz)",
    "KI-Hinweis nicht vom ersten bis zum letzten Bild eingebrannt (laut Prüfprotokoll)",
    "KI-Hinweis im Bild hat nicht den festgelegten Wortlaut",
    "Durchsicht in voller Bildrate nicht erklärt",
    "Schnittfenster fehlt oder liegt nicht im Original (0 ≤ von < bis ≤ Dauer)",
    "Anker-Hash des Exports weicht vom Manifest ab",
    "Startbild-Abgleich nicht bestanden",
    "Rechte laut Prüfprotokoll nicht geklärt",
  ]);
});

test("MR-4 Das jüngste Protokoll zählt — in beide Richtungen; bei gleicher Zeit die höhere id; Protokolle anderer Medien zählen nicht", () => {
  const alt = (extra) => protokoll({ id: 10, geprueft_am: "2026-11-11T10:00:00.000000+00:00", ...extra });
  const neu = (extra) => protokoll({ id: 11, geprueft_am: "2026-11-11T11:00:00.000000+00:00", ...extra });
  const schlecht = { anker_abgleich: "nicht_bestanden" };
  const r1 = regel(kette(), [alt({}), neu(schlecht)]);
  assert.deepEqual([r1.freigebbar, r1.gruende, r1.pruefung_id], [false, ["Anker-Abgleich nicht bestanden (geprüft: Architektur, Personen, Wasser — Einzelurteile in der Notiz)"], 11]);
  const r2 = regel(kette(), [neu({}), alt(schlecht)]);
  assert.deepEqual([r2.freigebbar, r2.gruende, r2.pruefung_id], [true, [], 11]);
  // Mikrosekunden der DB-Uhr: 10:00:00.000002 ist jünger als 10:00:00.000001 — Date.parse sieht beide gleich, dann die id.
  const gleich = regel(kette(), [protokoll({ id: 12, geprueft_am: "2026-11-11T12:00:00.000000+00:00", ...schlecht }), protokoll({ id: 13, geprueft_am: "2026-11-11T12:00:00.000000+00:00" })]);
  assert.equal(gleich.pruefung_id, 13);
  assert.equal(gleich.freigebbar, true);
  const fremd = regel(kette(), [protokoll(), protokoll({ id: 99, medium_id: 4, geprueft_am: "2026-11-12T00:00:00Z", ...schlecht })]);
  assert.deepEqual([fremd.freigebbar, fremd.pruefung_id], [true, 10]);
});

test("MR-5 Unlesbare Werte sperren (fail-closed)", () => {
  const faelle = [
    [regel(kette(), "keine Liste"), "Prüfprotokolle nicht lesbar"],
    [regel(kette(), null), "Prüfprotokolle nicht lesbar"],
    [regel(kette(), [protokoll({ geprueft_am: "gestern" })]), "Prüfprotokolle nicht lesbar"],
    [regel(kette(), [protokoll(), "kaputt"]), "Prüfprotokolle nicht lesbar"],
    [regel(kette(), [protokoll({ id: "x" })]), "Prüfprotokolle nicht lesbar"],
    [regel(kette(), [protokoll({ klauseln: "alle" })]), "Klauseln im Prüfprotokoll nicht lesbar"],
    [regel(kette({ original: { prompt_klauseln: [] } }), [protokoll()]), "Prompt-Klauseln des Originals fehlen oder sind nicht lesbar"],
    [regel(kette({ export: { sha256: "KEIN-HASH" } }), [protokoll()]), "Export nicht lesbar (id oder SHA-256 fehlt)"],
    [regel(null, [protokoll()]), "Export nicht lesbar (id oder SHA-256 fehlt)"],
    [regel(kette(), [protokoll({ ki_hinweis_eingebrannt: "ja" })]), "KI-Hinweis nicht vom ersten bis zum letzten Bild eingebrannt (laut Prüfprotokoll)"],
    [regel(kette(), [protokoll()], { ...VORGABEN, anker: null }), "Anker „test-anker“ steht nicht als zulässiger Anker im Manifest"],
    [regel(kette({ export: { schnitt_bis_s: "drei" } }), [protokoll()]), "Schnittfenster fehlt oder liegt nicht im Original (0 ≤ von < bis ≤ Dauer)"],
  ];
  for (const [r, grund] of faelle) {
    assert.equal(r.freigebbar, false, grund);
    assert.ok(r.gruende.includes(grund), `${grund}: ${r.gruende.join(" | ")}`);
  }
});

test("MR-6 Reinheit: lib/medien-freigabe.ts hat nur Typ-Importe, lib/studio/ki-hinweis.ts gar keine (laufen in Server und Browser)", () => {
  for (const [datei, erlaubt] of [["src/lib/medien-freigabe.ts", true], ["src/lib/studio/ki-hinweis.ts", false]]) {
    const sf = ts.createSourceFile(datei, readFileSync(path.join(SITE, datei), "utf8"), ts.ScriptTarget.Latest, true);
    const importe = sf.statements.filter((s) => ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s) || (ts.isExportDeclaration(s) && s.moduleSpecifier));
    if (!erlaubt) assert.equal(importe.length, 0, datei);
    for (const s of importe) assert.ok(ts.isImportDeclaration(s) && s.importClause?.isTypeOnly, `${datei}: ${s.getText(sf)}`);
    let dynamisch = 0;
    (function besuche(k) {
      if (ts.isCallExpression(k) && (k.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(k.expression) && k.expression.text === "require"))) dynamisch += 1;
      ts.forEachChild(k, besuche);
    })(sf);
    assert.equal(dynamisch, 0, datei);
  }
});

test("MR-7 Wortlaute: KI_HINWEIS_BILD und KI_PFLICHTZEILE_CAPTION wörtlich (Setzung bis E31 bzw. wie das Social-Kit)", () => {
  assert.equal(KI_HINWEIS_BILD, "KI-generierte Visualisierung des geplanten Zustands – unverbindlich, keine reale Aufnahme");
  assert.equal(KI_PFLICHTZEILE_CAPTION, "Bild-/Videomaterial: KI-generierte Visualisierung, kein Foto der Bestandsimmobilie");
  // Bedingung 5 vergleicht exakt: Leerraum oder ein anderer Gedankenstrich reichen nicht.
  for (const fast of [`${KI_HINWEIS_BILD} `, KI_HINWEIS_BILD.replace("–", "-"), KI_HINWEIS_BILD.toLowerCase()]) {
    assert.ok(regel(kette({ export: { ki_hinweis_text: fast } })).gruende.includes("KI-Hinweis im Bild hat nicht den festgelegten Wortlaut"), fast);
  }
});
