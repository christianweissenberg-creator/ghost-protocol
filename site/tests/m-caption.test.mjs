// Objekt-Studio Stufe 2, Paket C — Schritt 9, Pipeline-Hälfte (10.11.2026): Caption zu einem Video. Lauf: npm test.
//
// Prüft POST /api/content/pipeline mit dem optionalen Feld medium_id (Bauplan §4.3, Spezifikation §6.3), ohne Netz und ohne
// bezahlte Aufrufe (echter Handler, Attrappen aus tests/harness/fake.mjs; studio_medium aus tests/harness/studio-ablage.mjs):
// - Abweisungen vor jedem bezahlten Aufruf und vor dem Insert: Medium eines anderen Objekts, Startbild oder Original statt
//   Export, unbekannte id (404), kein Zahlwert, kein Objekt (400), Lesefehler und Zeitüberschreitung (502).
// - Caption-Lauf: metadata.medium_id, SCRIBE-Auftrag mit Auftragsart und Pflichtzeile als eigener Zeile; fehlt die Pflichtzeile
//   in der PUBLISHER-Fassung, steht sie vor der Stufe counsel_endfassung im PUBLISHER-Text — COUNSEL prüft genau diesen Text,
//   body ist dieser Text, und R2 (geprueftenTextAusSchritten) gibt ihn frei.
// - Keine Verdopplung, wenn PUBLISHER die Zeile schon schreibt; ein abweichender Wortlaut zählt nicht.
// - Ohne medium_id bleibt alles wie bisher: keine Abfrage auf studio_medium, keine Pflichtzeile, metadata ohne medium_id.
// Die Umgebungswerte unten sind Testwerte dieses Prozesses, keine echten Schlüssel; Medien-Zeilen und Hashes sind Testwerte.
// Z_ROUTE_PIPELINE=<pfad> und Z_LIB_<NAME>=<pfad> prüfen Kopien statt der Repo-Dateien (Mutationstests).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/server.js")).href, context);
    if (specifier === "server-only") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/dist/compiled/server-only/empty.js")).href, context);
    if (specifier.startsWith("@/")) {
      const kopie = process.env[`Z_LIB_${specifier.slice(2).replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`];
      return nextResolve(kopie ? pathToFileURL(kopie).href : pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
    }
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key-0000000000",
  SUPABASE_SERVICE_KEY: "service-test-key-1234567890abcdef",
  ANTHROPIC_API_KEY: "sk-ant-harness-TESTWERT-0123456789abcdef",
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
  CRON_SECRET: "cron-test-secret-0123456789",
  GP_SESSION_SECRET: "session-test-secret-0123456789",
});

const fake = await import("./harness/fake.mjs");
const { welt, zeile, zuruecksetzen, agentOk } = fake;
fake.installiere();

const lib = (name) => import(pathToFileURL(process.env[`Z_LIB_${name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`] ?? path.join(SITE, "src", `${name}.ts`)).href);
const route = (name, rel) => import(pathToFileURL(process.env[`Z_ROUTE_${name}`] ?? path.join(SITE, "src/app/api", rel)).href);
const [regeln, counselModul, kiHinweis, pipeline, { NextRequest }] = await Promise.all([
  lib("lib/freigabe-regeln"),
  lib("lib/counsel-urteil"),
  lib("lib/studio/ki-hinweis"),
  route("PIPELINE", "content/pipeline/route.ts"),
  import("next/server"),
]);

/** Wortlaut wie das Social-Kit von Steinadel (Spezifikation Z. 1262); hier wörtlich, damit eine Änderung der Konstante auffällt. */
const PFLICHTZEILE = "Bild-/Videomaterial: KI-generierte Visualisierung, kein Foto der Bestandsimmobilie";
const FREIGABE = "Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG";
const FREIGABE_END = "Endfassung wörtlich geprüft, Pflichtzeilen vorhanden.\nURTEIL: FREIGABE-EMPFEHLUNG";
const R2_ANDERS = "Freigabetext nicht wörtlich geprüft: COUNSEL prüfte eine andere Fassung (R2)";
const MEDIEN_FREI = { freigebbar: true, gruende: [] };

// Export-Objekt wie in tests/p-paket-b-pipeline.test.mjs (Form des Steinadel-Exports); Werte außer Slug, Jahr und Kampagnen sind Testwerte.
const SLUG = "rittergut-seifersdorf";
const RITTERGUT = {
  slug: SLUG,
  name: "RitterGut Seifersdorf",
  untertitel: "Testuntertitel",
  tagline: null,
  ort: "Testort",
  baujahr: 1335,
  preis: "Preis laut Test",
  kurzbeschreibung: "Testbeschreibung.",
  statusBadge: "Vermarktung",
  afaProzent: 100,
  istDenkmal: true,
  kennzahlen: [{ label: "Testkennzahl", wert: "1" }],
  urls: { objektSeite: "https://steinadel.de/objekte/rittergut-seifersdorf" },
  kampagnen: [{ kampagne: "afa-rechner-p1", lpUrl: "https://steinadel.de/l/afa-rechner-p1", lpVariant: "afa-rechner-p1-a" }],
};

function exportMit(objekt) {
  welt.objekteAntwort = { status: 200, body: { version: "1", quelle: "export", generiert_am: "2026-11-10T08:00:00Z", objekte: [objekt] } };
}

/**
 * Medien-Zeilen direkt in der Attrappe (wie nach einem Einspielen): RitterGut mit Startbild 1, Original 2 und Export 3,
 * dazu Original 4 und Export 5 eines anderen Objekts. Die Pipeline liest nur id, Objekt und Fassung.
 */
const EXPORT_ID = 3;
const FREMDER_EXPORT_ID = 5;
function medien() {
  const basis = {
    anker_id: "hof-nacht", anker_sha256: "a".repeat(64), breite: null, hoehe: null, fps: null, dauer_s: null, aigc_kennzeichen: null,
    schnitt_von_s: null, schnitt_bis_s: null, ausschnitt: null, startbild_abgleich: null, startbild_abweichung_max: null, erzeuger: null,
    modell: null, job_id: null, parameter: {}, prompt: null, prompt_klauseln: [], ki_hinweis_text: null, kosten_vorschau_credits: null,
    kosten_credits: null, kosten_usd: null, kosten_quelle: null, startbild_id: null, abgeleitet_von: null,
    eingespielt_am: "2026-11-10T14:30:00.000000+00:00",
  };
  const pfad = (slug, n, endung) => `${slug}/${String(n).repeat(64)}${endung}`;
  welt.tabellen.studio_medium = [
    { ...basis, id: 1, objekt_slug: SLUG, art: "bild", fassung: "startbild", sha256: "1".repeat(64), speicher_pfad: pfad(SLUG, 1, ".png"), bytes: 10, mime: "image/png", ausschnitt: { x: 0, y: 0, breite: 10, hoehe: 10, skalierung: 1 }, startbild_abgleich: "bestanden", startbild_abweichung_max: 0 },
    { ...basis, id: 2, objekt_slug: SLUG, art: "video", fassung: "original", sha256: "2".repeat(64), speicher_pfad: pfad(SLUG, 2, ".mp4"), bytes: 20, mime: "video/mp4", startbild_id: 1, erzeuger: "higgsfield-connector", modell: "testmodell" },
    { ...basis, id: EXPORT_ID, objekt_slug: SLUG, art: "video", fassung: "export", sha256: "3".repeat(64), speicher_pfad: pfad(SLUG, 3, ".mp4"), bytes: 30, mime: "video/mp4", abgeleitet_von: 2, ki_hinweis_text: kiHinweis.KI_HINWEIS_BILD },
    { ...basis, id: 4, objekt_slug: "villa-x", art: "video", fassung: "original", sha256: "4".repeat(64), speicher_pfad: pfad("villa-x", 4, ".mp4"), bytes: 40, mime: "video/mp4", erzeuger: "higgsfield-connector", modell: "testmodell" },
    { ...basis, id: FREMDER_EXPORT_ID, objekt_slug: "villa-x", art: "video", fassung: "export", sha256: "5".repeat(64), speicher_pfad: pfad("villa-x", 5, ".mp4"), bytes: 50, mime: "video/mp4", abgeleitet_von: 4, ki_hinweis_text: kiHinweis.KI_HINWEIS_BILD },
  ];
}

/** CTA-Link aus dem Auftrag (Abschnitt CTA-LINK); null, wenn keiner darin steht. */
function linkAusAuftrag(task) {
  return /CTA-LINK \(Pflicht, Zeichen für Zeichen übernehmen\): (\S+)/.exec(task)?.[1] ?? null;
}

/** PUBLISHER-Antwort ohne Pflichtzeile (der Fall, in dem die Pipeline sie ergänzt). */
const PUBLISHER_ROH = (task) => `Finaler Content:\n1/2 Denkmal-AfA bis 100 %. Visualisierung: KI-generiert.\n2/2 Mehr: ${linkAusAuftrag(task)}\nCross-Promotion-Tweet: Neues Video zum RitterGut — mehr im Hauptpost.\n`;

/** Agenten-Attrappen wie in p-paket-b-pipeline: Texte übernehmen den CTA-Link; Vor- und Endprüfung antworten verschieden. */
function agenten({ scribe, publisher = PUBLISHER_ROH, endpruefung = FREIGABE_END } = {}) {
  welt.agentAntworten.scribe = (task) =>
    agentOk("scribe", scribe ? scribe(task) : `Caption 1/2 Denkmal-AfA bis 100 %. Modellrechnung. Impressum: steinadel.de/impressum\n${PFLICHTZEILE}\n2/2 Mehr: ${linkAusAuftrag(task)}`);
  welt.agentAntworten.publisher = (task) => agentOk("publisher", publisher(task));
  welt.agentAntworten.counsel = (task) => agentOk("counsel", task.startsWith("ENDPRUEFUNG (R2)") ? endpruefung : FREIGABE);
}

const auftrag = (agent, nr = 0) => welt.aktivierungen.filter((a) => a.agent === agent)[nr]?.task ?? "";
/** Zahl der Zeilen, die genau die Pflichtzeile sind (Leerraum am Rand zählt nicht, wie enthaeltPflichtzeile). */
const pflichtzeilen = (text) => String(text).split(/\r?\n/).filter((z) => z.trim() === PFLICHTZEILE).length;
const mediumLesungen = () => welt.log.filter((l) => l.tabelle === "studio_medium");

beforeEach(() => {
  zuruecksetzen();
  welt.pipelineModul = pipeline;
});

async function pipePost(body) {
  const req = new NextRequest("http://harness.local/api/content/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "gp-auth=test" },
    body: JSON.stringify(body),
  });
  const res = await pipeline.POST(req);
  return { status: res.status, body: await res.json() };
}

const LAUF = { objekt_slug: SLUG, platform: "x", format: "thread", category: "ki_automation" };

/** R2 und Pflichtzeile wie beim Freigeben (pruefeVideoFreigabe), mit freier Medien-Regel — so bleibt nur der Text zu prüfen. */
function videoFreigabe(z) {
  const geprueft = regeln.geprueftenTextAusSchritten(z.metadata.steps, z.review_notes);
  return regeln.pruefeVideoFreigabe(counselModul.werteCounselAus(z.review_notes), z.body, geprueft, MEDIEN_FREI, kiHinweis.KI_PFLICHTZEILE_CAPTION);
}

// ═══ Abweisungen vor jedem bezahlten Aufruf ═══

test("M-C1 medium_id abgewiesen vor jedem bezahlten Aufruf und vor dem Insert: fremdes Objekt, Startbild oder Original statt Export (400), unbekannte id (404)", async () => {
  assert.equal(kiHinweis.KI_PFLICHTZEILE_CAPTION, PFLICHTZEILE, "Wortlaut wie das Social-Kit");
  for (const [fall, mediumId, status, meldung] of [
    ["fremdes Objekt", FREMDER_EXPORT_ID, 400, /^Medium 5 gehört nicht zum Objekt dieses Laufs/],
    ["Startbild statt Export", 1, 400, /^Medium 1 ist keine Export-Fassung \(Fassung "startbild"\)/],
    ["Original statt Export", 2, 400, /^Medium 2 ist keine Export-Fassung \(Fassung "original"\)/],
    ["unbekannte id", 999, 404, /^Medium 999 nicht gefunden/],
  ]) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    agenten();
    const signale = [];
    welt.vorAntwort = async (a) => {
      if (a.art === "supabase" && a.tabelle === "studio_medium") signale.push(a.signal);
    };
    const r = await pipePost({ ...LAUF, medium_id: mediumId });
    assert.equal(r.status, status, `${fall}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.fehler, meldung, fall);
    assert.equal(welt.aktivierungen.length, 0, `${fall}: kein bezahlter Aufruf`);
    assert.equal(welt.content.length, 0, `${fall}: keine content-Zeile`);
    // Genau eine Lesung: diese id, mit Abbruchsignal (Zeitlimit wie die Medien-Routen)
    assert.equal(mediumLesungen().length, 1, fall);
    assert.equal(mediumLesungen()[0].methode, "GET", fall);
    assert.match(mediumLesungen()[0].query, new RegExp(`(^|&)id=eq\\.${mediumId}(&|$)`), fall);
    assert.equal(signale.length, 1, fall);
    assert.ok(signale[0] instanceof AbortSignal, `${fall}: Abfrage mit Abbruchsignal`);
  }
});

test("M-C2 medium_id kein Zahlwert oder ohne Objekt → 400 ohne Abfrage auf studio_medium, ohne Insert und ohne bezahlten Aufruf", async () => {
  for (const [fall, body, meldung] of [
    ["Text statt Zahl", { ...LAUF, medium_id: "3" }, /^medium_id ungültig \(positive ganze Zahl\)$/],
    ["null", { ...LAUF, medium_id: null }, /^medium_id ungültig/],
    ["0", { ...LAUF, medium_id: 0 }, /^medium_id ungültig/],
    ["negativ", { ...LAUF, medium_id: -3 }, /^medium_id ungültig/],
    ["gebrochen", { ...LAUF, medium_id: 1.5 }, /^medium_id ungültig/],
    ["zu groß", { ...LAUF, medium_id: 2 ** 53 }, /^medium_id ungültig/],
    ["Boolean", { ...LAUF, medium_id: true }, /^medium_id ungültig/],
    ["Liste", { ...LAUF, medium_id: [3] }, /^medium_id ungültig/],
    ["Objekt", { ...LAUF, medium_id: { id: 3 } }, /^medium_id ungültig/],
    ["ohne Objekt", { topic: "Ein Video", platform: "x", format: "thread", category: "ki_automation", medium_id: EXPORT_ID }, /^medium_id nur mit objekt_slug/],
    ["Objekt leer", { topic: "Ein Video", objekt_slug: "", platform: "x", format: "thread", medium_id: EXPORT_ID }, /^medium_id nur mit objekt_slug/],
  ]) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    agenten();
    const r = await pipePost(body);
    assert.equal(r.status, 400, `${fall}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.fehler, meldung, fall);
    assert.equal(welt.aktivierungen.length, 0, `${fall}: kein bezahlter Aufruf`);
    assert.equal(welt.content.length, 0, `${fall}: keine content-Zeile`);
    assert.equal(mediumLesungen().length, 0, `${fall}: keine Abfrage`);
    assert.equal(welt.objektAbrufe, 0, `${fall}: kein Export-Abruf`);
  }
});

test("M-C3 studio_medium nicht lesbar → 502 ohne Insert und ohne bezahlten Aufruf: Fehlerantwort, Zeitüberschreitung (Zeitlimit 8 s), unerwartete Zeilenform", async () => {
  for (const [fall, vorbereiten, meldung] of [
    [
      "Fehlerantwort",
      () => {
        welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_medium" ? { status: 500, body: { code: "XX000", message: "Verbindung abgebrochen" } } : null);
      },
      /^Medium 3 nicht lesbar: Verbindung abgebrochen — Lauf nicht gestartet$/,
    ],
    [
      "Zeitüberschreitung",
      () => {
        welt.vorAntwort = async (a) => {
          if (a.art === "supabase" && a.tabelle === "studio_medium") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        };
      },
      /^Medium 3 nicht lesbar: Zeitüberschreitung oder Abbruch \(Zeitlimit 8 s\) — Lauf nicht gestartet$/,
    ],
    [
      "Zeilenform",
      () => {
        welt.tabellen.studio_medium.find((m) => m.id === EXPORT_ID).objekt_slug = null;
      },
      /^Medium 3 nicht lesbar: unerwartete Zeilenform — Lauf nicht gestartet$/,
    ],
  ]) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    agenten();
    vorbereiten();
    const r = await pipePost({ ...LAUF, medium_id: EXPORT_ID });
    assert.equal(r.status, 502, `${fall}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.fehler, meldung, fall);
    assert.equal(welt.aktivierungen.length, 0, fall);
    assert.equal(welt.content.length, 0, fall);
  }
});

// ═══ Caption-Lauf ═══

test("M-C4 Caption-Lauf: medium_id in metadata, SCRIBE-Auftrag mit Auftragsart und Pflichtzeile als eigener Zeile; fehlt sie bei PUBLISHER, steht sie vor counsel_endfassung im PUBLISHER-Text — body = geprüfter Text, R2 gibt frei", async () => {
  exportMit(RITTERGUT);
  medien();
  agenten();
  const r = await pipePost({ ...LAUF, medium_id: EXPORT_ID, lauf_id: "lauf-caption-0001" });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 500));
  assert.equal(r.body.status, "complete", JSON.stringify(r.body.fehler ?? null));
  assert.deepEqual(welt.aktivierungen.map((a) => a.agent), ["researcher", "scribe", "counsel", "publisher", "counsel", "amplifier"]);
  assert.equal(mediumLesungen().length, 1, "eine Lesung von studio_medium, vor dem Lauf");

  // SCRIBE-Auftrag: Auftragsart und Pflichtzeile allein in ihrer Zeile
  const scribe = auftrag("scribe");
  assert.ok(scribe.includes("Caption zu einem Video, Pflichtzeile KI-Hinweis"), scribe.slice(0, 400));
  assert.ok(scribe.startsWith(`CONTENT-PRODUKTION: Schreibe Content zum Thema "RitterGut Seifersdorf".\n\nPLATTFORM: X/Twitter-Thread\nKATEGORIE: KI & Automation\n\nAUFTRAGSART: Caption zu einem Video, Pflichtzeile KI-Hinweis\n`));
  assert.equal(pflichtzeilen(scribe), 1, "Pflichtzeile als eigene Zeile im SCRIBE-Auftrag");
  assert.ok(scribe.includes(`\n${PFLICHTZEILE}\n\nRECHERCHE-ERGEBNISSE (von RESEARCHER):\n`));
  // Die anderen Aufträge nennen die Auftragsart nicht
  for (const agent of ["researcher", "publisher", "amplifier"]) assert.ok(!auftrag(agent).includes("AUFTRAGSART"), agent);

  // PUBLISHER-Text mit ergänzter Pflichtzeile: steps[3], Endprüfung, body
  const z = zeile(r.body.contentId);
  const roh = PUBLISHER_ROH(auftrag("publisher"));
  assert.equal(pflichtzeilen(roh), 0, "PUBLISHER schrieb die Pflichtzeile nicht");
  // Nachbesserung caption9-4: Auch der PUBLISHER-Auftrag nennt die Pflichtzeile wörtlich, als letzte Zeile des finalen Contents.
  assert.ok(auftrag("publisher").includes(`- Finaler Content (mit deinen Korrekturen); als letzte Zeile des finalen Contents diese Pflichtzeile wörtlich, als eigene Zeile, ohne Formatierung:\n  ${PFLICHTZEILE}\n`), auftrag("publisher").slice(0, 400));
  const erwartet = `${roh.trimEnd()}\n\n${PFLICHTZEILE}`;
  assert.equal(r.body.steps[3].output, erwartet, "Pflichtzeile als letzte Zeile nach einer Leerzeile");
  assert.equal(z.metadata.steps[3].output, erwartet);
  assert.equal(z.body, erwartet, "body = PUBLISHER-Text mit Pflichtzeile");
  assert.equal(pflichtzeilen(z.body), 1, "genau eine Pflichtzeile");
  // Vor counsel_endfassung: COUNSEL prüft genau diesen Text
  const end = auftrag("counsel", 1);
  assert.ok(end.startsWith("ENDPRUEFUNG (R2)"));
  assert.ok(end.includes(`ENDFASSUNG (PUBLISHER):\n${z.body}\n\nOBJEKTDATEN`), "die Endprüfung bekommt den Text mit Pflichtzeile");
  assert.equal(pflichtzeilen(end), 1);
  assert.ok(auftrag("amplifier").includes(`PUBLISHER-OUTPUT:\n${z.body}\n`));
  // R2: der geprüfte Text ist body; Pflichtzeile und Caption-Regel geben frei
  assert.equal(z.review_notes, FREIGABE_END);
  assert.equal(regeln.geprueftenTextAusSchritten(z.metadata.steps, z.review_notes), z.body);
  const pruefung = videoFreigabe(z);
  assert.equal(pruefung.freigebbar, true, JSON.stringify(pruefung.gruende));
  assert.deepEqual(pruefung.gruende, []);
  // Gegenprobe: Stünde die Zeile nur in body, nicht im geprüften PUBLISHER-Text, sperrte R2
  const nurBody = regeln.pruefeVideoFreigabe(counselModul.werteCounselAus(z.review_notes), z.body, roh, MEDIEN_FREI, PFLICHTZEILE);
  assert.deepEqual([nurBody.freigebbar, nurBody.grund], [false, R2_ANDERS]);
  assert.deepEqual(z.metadata.freigabe_hinweis, {
    geprueft: "PUBLISHER-Text (steps[3]), wörtlich geprüft in der COUNSEL-Endprüfung (steps[4])",
    zur_freigabe: "PUBLISHER-Text (body)",
    identisch: true,
  });

  // Belege: medium_id als Zahl, Wortlaut und Ergänzung der Pflichtzeile
  assert.equal(z.status, "zur_freigabe");
  assert.equal(z.metadata.medium_id, EXPORT_ID);
  assert.equal(typeof z.metadata.medium_id, "number");
  assert.deepEqual(z.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: true, ersetzt: null });
  assert.equal(z.metadata.lauf_id, "lauf-caption-0001");
  assert.deepEqual(r.body.warnungen, []);
});

test("M-C5 Pflichtzeile schon da → keine Verdopplung; abweichender Wortlaut, Zeile im Satz oder mit Formatierung zählt nicht → die wörtliche Zeile wird ergänzt", async () => {
  const lauf = async (publisher) => {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    agenten({ publisher });
    const r = await pipePost({ ...LAUF, medium_id: EXPORT_ID });
    assert.equal(r.body.status, "complete", JSON.stringify(r.body.fehler ?? null));
    assert.equal(welt.aktivierungen.length, 6);
    return { r, z: zeile(r.body.contentId) };
  };
  // PUBLISHER schreibt die Zeile selbst (auch mit Leerraum am Rand, auch nicht als letzte Zeile): Text bleibt, wie er ist
  for (const pub of [
    (task) => `Finaler Content: ${linkAusAuftrag(task)}\n\n${PFLICHTZEILE}`,
    (task) => `Finaler Content: ${linkAusAuftrag(task)}\n  ${PFLICHTZEILE}  \nCross-Promotion-Tweet: mehr im Hauptpost.`,
    (task) => `Finaler Content: ${linkAusAuftrag(task)}\r\n${PFLICHTZEILE}\r\n`,
  ]) {
    const { r, z } = await lauf(pub);
    const roh = pub(auftrag("publisher"));
    assert.equal(z.body, roh, "unverändert");
    assert.equal(r.body.steps[3].output, roh);
    assert.equal(pflichtzeilen(z.body), 1, "keine Verdopplung");
    assert.ok(auftrag("counsel", 1).includes(`ENDFASSUNG (PUBLISHER):\n${roh}\n\nOBJEKTDATEN`));
    assert.deepEqual(z.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: false, ersetzt: null });
    assert.equal(videoFreigabe(z).freigebbar, true);
  }
  // Nahe Varianten (Nachbesserung caption9-4): Schlusspunkt, Fettdruck, Großschrift, geschützter Bindestrich, geschütztes
  // oder doppeltes Leerzeichen, Emoji davor → durch die wörtliche Zeile ERSETZT, nicht verdoppelt; die ersetzte Zeile
  // steht in metadata.pflichtzeile.ersetzt. Vorhanden heißt weiter nur wörtlich (die Freigabe-Regel bleibt streng).
  for (const nah of [
    `${PFLICHTZEILE}.`,
    `**${PFLICHTZEILE}**`,
    PFLICHTZEILE.toUpperCase(),
    PFLICHTZEILE.replace("KI-generierte", "KI\u2011generierte"),
    PFLICHTZEILE.replace("kein Foto", "kein\u00a0Foto"),
    PFLICHTZEILE.replace("kein Foto", "kein  Foto"),
    `🎬 ${PFLICHTZEILE}`,
  ]) {
    const pub = (task) => `Finaler Content: ${linkAusAuftrag(task)}\n${nah}\nCross-Promotion-Tweet: mehr im Hauptpost.`;
    const { r, z } = await lauf(pub);
    const erwartet = pub(auftrag("publisher")).replace(nah, PFLICHTZEILE);
    assert.equal(z.body, erwartet, nah);
    assert.equal(r.body.steps[3].output, erwartet, nah);
    assert.equal(pflichtzeilen(z.body), 1, nah);
    assert.ok(!z.body.includes(`${nah}\n`) || nah === PFLICHTZEILE, `${nah}: Variante ersetzt`);
    assert.deepEqual(z.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: true, ersetzt: nah }, nah);
    assert.equal(videoFreigabe(z).freigebbar, true, nah);
  }
  assert.equal(regeln.enthaeltPflichtzeile(`${PFLICHTZEILE}.`, PFLICHTZEILE), false, "die Freigabe-Regel bleibt wörtlich");
  // Anderer Wortlaut zählt nicht: Die wörtliche Zeile wird ergänzt, die abweichende bleibt stehen (der Text ist PUBLISHERs)
  for (const abweichend of [
    "Bild-/Videomaterial: KI-generierte Visualisierung – kein Foto der Bestandsimmobilie",
    "Bild- und Videomaterial: KI-generierte Visualisierung, kein Foto der Bestandsimmobilie",
    `Hinweis: ${PFLICHTZEILE}`,
  ]) {
    const pub = (task) => `Finaler Content: ${linkAusAuftrag(task)}\n${abweichend}`;
    const { r, z } = await lauf(pub);
    const erwartet = `${pub(auftrag("publisher"))}\n\n${PFLICHTZEILE}`;
    assert.equal(z.body, erwartet, abweichend);
    assert.equal(r.body.steps[3].output, erwartet, abweichend);
    assert.equal(pflichtzeilen(z.body), 1, abweichend);
    assert.ok(auftrag("counsel", 1).includes(`\n${PFLICHTZEILE}\n\nOBJEKTDATEN`), `${abweichend}: Endprüfung mit der wörtlichen Zeile`);
    assert.deepEqual(z.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: true, ersetzt: null }, abweichend);
    assert.equal(videoFreigabe(z).freigebbar, true, abweichend);
  }
});

test("M-C6 Reihenfolge: Mindestlänge auf PUBLISHERs eigenem Text (die Pflichtzeile zählt nicht mit); Namensschutz und Textregeln laufen auf dem Text mit Pflichtzeile", async () => {
  exportMit(RITTERGUT);
  medien();
  agenten({ publisher: () => "OK, erledigt." });
  const kurz = await pipePost({ ...LAUF, medium_id: EXPORT_ID });
  assert.equal(kurz.body.status, "fehler");
  assert.deepEqual(welt.aktivierungen.map((a) => a.agent), ["researcher", "scribe", "counsel", "publisher"], "keine Endprüfung");
  assert.deepEqual([kurz.body.fehler.stufe, kurz.body.fehler.grund, kurz.body.fehler.detail], ["publisher", "Text zur Freigabe leer", "13 Zeichen nach Trimmen (Mindestlänge 20)"]);
  const zk = zeile(kurz.body.contentId);
  assert.equal(zk.metadata.steps[3].output, "OK, erledigt.", "keine Pflichtzeile an einem zu kurzen Text");
  assert.equal(zk.body, null);
  assert.equal(zk.metadata.pflichtzeile, undefined);
  assert.equal(zk.metadata.medium_id, EXPORT_ID, "medium_id ab dem ersten Schreiben");

  // Textregel auf der Endfassung (Direktlink): Abbruch vor der Endprüfung; der Beleg zeigt den geprüften Text mit Pflichtzeile
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  medien();
  const pub = (task) => `Final: ${linkAusAuftrag(task)}\nTeaser: https://steinadel.de/l/afa-rechner-p1`;
  agenten({ publisher: pub });
  const regel = await pipePost({ ...LAUF, medium_id: EXPORT_ID });
  assert.equal(regel.body.status, "fehler");
  assert.equal(welt.aktivierungen.length, 4);
  assert.deepEqual([regel.body.fehler.stufe, regel.body.fehler.grund], ["publisher", "Kurzlink-Prüfung nicht bestanden (E12)"]);
  const zr = zeile(regel.body.contentId);
  assert.equal(zr.metadata.steps[3].output, `${pub(auftrag("publisher"))}\n\n${PFLICHTZEILE}`);
  assert.deepEqual(zr.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: true, ersetzt: null });
  assert.equal(zr.body, null, "kein Freigabetext");

  // Namensschutz: ebenso nach der Ergänzung (der Name nur zusammengesetzt, wie in p-paket-b-pipeline)
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  medien();
  const NAME = ["Immo", "Nexus"].join("");
  const mitName = (task) => `Final: ${linkAusAuftrag(task)}\nPartner: ${NAME}`;
  agenten({ publisher: mitName });
  const name = await pipePost({ ...LAUF, medium_id: EXPORT_ID });
  assert.equal(name.body.status, "fehler");
  assert.equal(welt.aktivierungen.length, 4);
  assert.deepEqual([name.body.fehler.stufe, name.body.fehler.grund], ["publisher", "Namensschutz: Freigabetext enthält einen geschützten Namen"]);
  const zn = zeile(name.body.contentId);
  // assert.ok statt assert.equal: Die Meldung gibt den Text mit dem Namen nicht aus
  assert.ok(zn.metadata.steps[3].output === `${mitName(auftrag("publisher"))}\n\n${PFLICHTZEILE}`, "Beleg: PUBLISHER-Text mit ergänzter Pflichtzeile");
  assert.equal(zn.body, null);
});

// ═══ Ohne medium_id: wie bisher ═══

test("M-C7 Ohne medium_id: keine Abfrage auf studio_medium, keine Pflichtzeile, SCRIBE-Auftrag ohne Auftragsart, metadata ohne medium_id und pflichtzeile — mit und ohne Objekt", async () => {
  for (const [fall, vorbereiten, body] of [
    ["mit Objekt", () => exportMit(RITTERGUT), LAUF],
    ["ohne Objekt", () => {}, { topic: "KI-Agenten erklärt", platform: "x", format: "thread", category: "ki_automation" }],
  ]) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    vorbereiten();
    medien();
    // SCRIBE schreibt hier keine Pflichtzeile (ohne medium_id verlangt der Auftrag keine)
    agenten({ scribe: (task) => `Thread 1/2 Denkmal-AfA bis 100 %. Modellrechnung. Visualisierung: KI-generiert.\n2/2 Mehr: ${linkAusAuftrag(task) ?? "im Profil"}` });
    const r = await pipePost(body);
    assert.equal(r.body.status, "complete", `${fall}: ${JSON.stringify(r.body.fehler ?? null)}`);
    assert.equal(welt.aktivierungen.length, 6, fall);
    assert.equal(mediumLesungen().length, 0, `${fall}: kein Zugriff auf studio_medium`);
    const z = zeile(r.body.contentId);
    const roh = PUBLISHER_ROH(auftrag("publisher"));
    assert.equal(z.body, roh, `${fall}: body = PUBLISHER-Antwort, unverändert`);
    assert.equal(pflichtzeilen(z.body), 0, fall);
    assert.ok(!Object.prototype.hasOwnProperty.call(z.metadata, "medium_id"), `${fall}: metadata ohne medium_id`);
    assert.ok(!Object.prototype.hasOwnProperty.call(z.metadata, "pflichtzeile"), `${fall}: metadata ohne pflichtzeile`);
    const scribe = auftrag("scribe");
    assert.ok(!scribe.includes("AUFTRAGSART") && !scribe.includes("Caption zu einem Video") && !scribe.includes(PFLICHTZEILE), fall);
    assert.ok(/\nKATEGORIE: [^\n]+\n\nRECHERCHE-ERGEBNISSE \(von RESEARCHER\):\n/.test(scribe), `${fall}: Kategorie direkt vor der Recherche, wie bisher`);
    for (let i = 0; i < welt.aktivierungen.length; i++) assert.equal(pflichtzeilen(welt.aktivierungen[i].task), 0, `${fall}: Auftrag ${i} ohne Pflichtzeile`);
  }
});

test("M-C11 Caption-Lauf (Nachtrag d2-text-erzeugen-2): Für jede Kanal-Wahl von „Text erzeugen“ bekommt SCRIBE die Anweisungen für eine Caption zu einem fertigen Video — kein Video-Skript, keine Schnitt- oder Einblendmarken (kein „-Skript“, „[B-ROLL]“, „[TEXTOVERLAY]“) in irgendeinem Auftrag; die Pflichtzeile bleibt einmal als eigene Zeile", async () => {
  const wahlen = [["instagram", "reel", "Schreibe die Caption zu einem fertigen Instagram-Reel:"], ["tiktok", "tiktok_short", "Schreibe die Caption zu einem fertigen TikTok-Video:"], ["youtube", "short", "Schreibe Titel und Beschreibung zu einem fertigen YouTube-Short:"], ["x", "thread", "Schreibe den Text zu einem fertigen Video auf X im Steinadel-Ton"], ["linkedin", "linkedin_post", "Schreibe den Begleittext zu einem fertigen Video auf LinkedIn"]];
  for (const [platform, format, kopf] of wahlen) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    agenten();
    const r = await pipePost({ ...LAUF, platform, format, medium_id: EXPORT_ID });
    assert.equal(r.status, 200, `${platform}: ${JSON.stringify(r.body).slice(0, 300)}`);
    const scribe = auftrag("scribe");
    assert.ok(scribe.includes(`ANWEISUNGEN:\n${kopf}`), `${platform}: ${scribe.slice(scribe.indexOf("ANWEISUNGEN"), scribe.indexOf("ANWEISUNGEN") + 200)}`);
    assert.ok(scribe.includes("- Das Video existiert schon: ein kurzer, fertiger Clip."), platform);
    assert.equal(pflichtzeilen(scribe), 1, `${platform}: Pflichtzeile einmal als eigene Zeile`);
    if (platform === "x" || platform === "linkedin") assert.ok(scribe.includes(`CTA mit EXAKT diesem Link: ${linkAusAuftrag(scribe)}`), `${platform}: CTA-Link wie in den Plattform-Anweisungen`);
    for (const a of welt.aktivierungen) {
      for (const marke of ["-Skript", "[B-ROLL]", "[TEXTOVERLAY]", "[TRANSITION]", "Trending"]) assert.ok(!a.task.includes(marke), `${platform}: ${a.agent} ohne „${marke}“`);
    }
  }
  // Gegenprobe ohne medium_id: die Anweisungen eines neuen Beitrags wie bisher (der Zeichenvergleich aller Aufträge steht im PR).
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  agenten();
  await pipePost({ ...LAUF, platform: "tiktok", format: "tiktok_short" });
  assert.ok(auftrag("scribe").includes("Schreibe ein TikTok-Skript (TikTok Short (30-60 Sek)):"));
});

// ═══ „Text erzeugen“ im Studio (Nachbesserung Paket C, Auftrag C) ═══

test("M-C8 „Text erzeugen“: erst die Bestätigung mit „bezahlter Lauf (Claude)“ — nichts gesendet; „Ja, bezahlten Lauf starten“ sendet genau einen Lauf mit Objekt, medium_id und Lauf-ID an die echte Pipeline (Agenten-Attrappe, nichts Bezahltes); ein zweiter Klick sendet nicht doppelt; nach verlorener Antwort dieselbe Lauf-ID → 409 statt zweitem Lauf", async () => {
  exportMit(RITTERGUT);
  medien();
  agenten();
  const { hookLaufzeit, ladeTextErzeugen, ladeStudioBausteine } = await import("./harness/studio.mjs");
  const lz = hookLaufzeit();
  const B = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counselModul, "@/lib/freigabe-regeln": regeln });
  const T = ladeTextErzeugen(lz.attrappen, { hilfen: B.hilfen });
  const gesendet = [];
  let antwortVerloren = false;
  const holen = async (url, init) => {
    assert.equal(url, "/api/content/pipeline");
    gesendet.push(JSON.parse(init.body));
    const req = new NextRequest(`http://harness.local${url}`, { method: "POST", headers: { ...init.headers, cookie: "gp-auth=test" }, body: init.body });
    const res = await pipeline.POST(req);
    if (antwortVerloren) throw new TypeError("Verbindung nach dem Senden abgebrochen");
    return res;
  };
  let fertig = 0;
  lz.setzeWurzel(T.TextErzeugen, { slug: SLUG, medium: { id: EXPORT_ID, sha256: "3".repeat(64) }, holen, fertig: () => (fertig += 1) });
  const alle = (k, pred, aus = []) => {
    if (Array.isArray(k)) for (const c of k) alle(c, pred, aus);
    else if (k && typeof k === "object") {
      if (pred(k)) aus.push(k);
      alle(k.kinder, pred, aus);
    }
    return aus;
  };
  const text = (k) => (Array.isArray(k) ? k.map(text).join("") : k && typeof k === "object" ? text(k.kinder) : k === null || k === undefined || typeof k === "boolean" ? "" : String(k));
  const baum = () => lz.rendere();
  const element = (attr) => alle(baum(), (n) => n.props?.[attr] !== undefined)[0] ?? null;
  // 1. Ausgangslage: nur „Text erzeugen …“, nichts gesendet.
  assert.equal(text(element("data-text-erzeugen-knopf")), "Text erzeugen …");
  assert.equal(element("data-text-erzeugen-bestaetigung"), null);
  // 2. Erst zeigen: Hinweis „bezahlter Lauf (Claude)“ und genau das, was gesendet würde — gesendet wird nichts.
  element("data-text-erzeugen-knopf").props.onClick();
  const bestaetigung = text(element("data-text-erzeugen-bestaetigung"));
  assert.match(bestaetigung, /^Bezahlter Lauf \(Claude\): bis zu 6 Stufen/);
  assert.match(bestaetigung, new RegExp(`Objekt ${SLUG} · Video #${EXPORT_ID} \\(Export, SHA-256 33333333…\\) · Instagram · Reel \\(instagram/reel\\) · Kategorie KI & Automation · Lauf-ID [0-9a-f]{8}… \\(neu\\)`));
  assert.equal(element("data-caption-kanal").props.disabled, true, "während der Bestätigung gesperrt");
  assert.deepEqual([gesendet.length, welt.aktivierungen.length], [0, 0]);
  element("data-text-erzeugen-zurueck").props.onClick();
  assert.equal(element("data-text-erzeugen-bestaetigung"), null);
  assert.equal(gesendet.length, 0);
  // 3. Bestätigen: ein Lauf, auch bei zwei Klicks vor dem Neuzeichnen.
  element("data-caption-kanal").props.onChange({ currentTarget: { value: "x|thread" } });
  element("data-text-erzeugen-knopf").props.onClick();
  const ja = element("data-text-erzeugen-start");
  ja.props.onClick();
  ja.props.onClick();
  await lz.ruhe(40);
  assert.equal(gesendet.length, 1, "ein Lauf");
  const lauf1 = gesendet[0];
  assert.deepEqual({ ...lauf1, lauf_id: "…" }, { platform: "x", format: "thread", category: "ki_automation", objekt_slug: SLUG, medium_id: EXPORT_ID, lauf_id: "…" });
  assert.match(lauf1.lauf_id, /^[0-9a-f-]{36}$/);
  assert.equal(welt.aktivierungen.length, 6, "sechs Stufen gegen die Attrappe");
  assert.equal(element("data-text-erzeugen-ausgang").props["data-text-erzeugen-ausgang"], "ergebnis");
  assert.match(text(element("data-text-erzeugen-ausgang")), /^Lauf beendet: Caption #\d+ — zur Freigabe im Stapel · (geschätzt \$\d+\.\d{4}|Kosten nicht gemeldet)/);
  assert.equal(fertig, 1, "das Studio lädt neu");
  const caption = welt.content.find((z) => z.metadata?.lauf_id === lauf1.lauf_id) ?? welt.content.at(-1);
  assert.equal(caption.metadata.medium_id, EXPORT_ID);
  assert.equal(caption.status, "zur_freigabe");
  // 4. Antwort verloren (der Lauf lief): Ausgang unbekannt, die Lauf-ID bleibt; „Erneut senden“ schickt dieselbe → 409.
  antwortVerloren = true;
  element("data-text-erzeugen-knopf").props.onClick();
  element("data-text-erzeugen-start").props.onClick();
  await lz.ruhe(40);
  antwortVerloren = false;
  assert.equal(gesendet.length, 2);
  assert.notEqual(gesendet[1].lauf_id, lauf1.lauf_id, "nach bekanntem Ausgang eine neue Lauf-ID");
  assert.equal(element("data-text-erzeugen-ausgang").props["data-text-erzeugen-ausgang"], "unbekannt");
  assert.equal(text(element("data-text-erzeugen-knopf")), "Erneut senden …");
  element("data-text-erzeugen-knopf").props.onClick();
  assert.match(text(element("data-text-erzeugen-bestaetigung")), /\(dieselbe wie beim Versuch mit unbekanntem Ausgang\)/);
  const aktivierungenVorher = welt.aktivierungen.length;
  element("data-text-erzeugen-start").props.onClick();
  await lz.ruhe(40);
  assert.equal(gesendet.length, 3);
  assert.equal(gesendet[2].lauf_id, gesendet[1].lauf_id, "dieselbe Lauf-ID");
  assert.equal(element("data-text-erzeugen-ausgang").props["data-text-erzeugen-ausgang"], "existiert");
  assert.match(text(element("data-text-erzeugen-ausgang")), /^Lauf existiert bereits \(#\d+\) — kein zweiter Lauf gestartet/);
  assert.equal(welt.aktivierungen.length, aktivierungenVorher, "kein zweiter (bezahlter) Lauf");
  assert.equal(text(element("data-text-erzeugen-knopf")), "Text erzeugen …", "danach wieder eine neue Lauf-ID");
});

/**
 * „Text erzeugen“ gegen die echte Pipeline-Route (Agenten-Attrappe, nichts Bezahltes): Laufzeit, gesendete Körper und
 * Schalter für eine verlorene Antwort und ein Tor, das die Antwort anhält (im finally öffnen).
 */
async function textErzeugenLaufzeit({ medium = { id: EXPORT_ID, sha256: "3".repeat(64) }, sperre, speicher = null } = {}) {
  const { hookLaufzeit, ladeTextErzeugen, ladeStudioBausteine } = await import("./harness/studio.mjs");
  const lz = hookLaufzeit();
  const B = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counselModul, "@/lib/freigabe-regeln": regeln });
  const T = ladeTextErzeugen(lz.attrappen, { hilfen: B.hilfen });
  const s = { gesendet: [], verloren: false, tor: null, fertig: 0 };
  const holen = async (url, init) => {
    assert.equal(url, "/api/content/pipeline");
    s.gesendet.push(JSON.parse(init.body));
    if (s.tor) await s.tor.warte;
    const req = new NextRequest(`http://harness.local${url}`, { method: "POST", headers: { ...init.headers, cookie: "gp-auth=test" }, body: init.body });
    const res = await pipeline.POST(req);
    if (s.verloren) throw new TypeError("Verbindung nach dem Senden abgebrochen");
    return res;
  };
  lz.setzeWurzel(T.TextErzeugen, { slug: SLUG, medium, holen, fertig: () => (s.fertig += 1), speicher, ...(sperre === undefined ? {} : { sperre }) });
  const alle = (k, pred, aus = []) => {
    if (Array.isArray(k)) for (const c of k) alle(c, pred, aus);
    else if (k && typeof k === "object") {
      if (pred(k)) aus.push(k);
      alle(k.kinder, pred, aus);
    }
    return aus;
  };
  const text = (k) => (Array.isArray(k) ? k.map(text).join("") : k && typeof k === "object" ? text(k.kinder) : k === null || k === undefined || typeof k === "boolean" ? "" : String(k));
  const element = (attr) => alle(lz.rendere(), (n) => n.props?.[attr] !== undefined)[0] ?? null;
  const ausgang = () => element("data-text-erzeugen-ausgang");
  /** Bestätigung öffnen und bestätigen; wartet, bis die Antwort eingeordnet ist. */
  const lauf = async () => {
    element("data-text-erzeugen-knopf").props.onClick();
    element("data-text-erzeugen-start").props.onClick();
    await lz.ruhe(40);
  };
  return { lz, T, s, element, text, ausgang, lauf };
}

test("M-C10 „Text erzeugen“, Wiederholung (Nachtrag d2-text-erzeugen-1): Antwort verloren, dann scheitert die Wiederholung mit 500 der Route — die Lauf-ID bleibt, der nächste Versuch sendet dieselbe und bekommt 409; es bleibt bei einem bezahlten Lauf (6 Aktivierungen)", async () => {
  exportMit(RITTERGUT);
  medien();
  agenten();
  const r = await textErzeugenLaufzeit();
  // 1. Lauf läuft durch, die Antwort geht verloren: Ausgang unbekannt.
  r.s.verloren = true;
  await r.lauf();
  r.s.verloren = false;
  assert.equal(r.ausgang().props["data-text-erzeugen-ausgang"], "unbekannt");
  assert.equal(welt.aktivierungen.length, 6);
  const id = r.s.gesendet[0].lauf_id;
  // 2. Wiederholung mit derselben ID; die Lauf-ID-Prüfung der Route scheitert vorübergehend → 500 „nicht gestartet“.
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "content" && a.methode === "GET" && a.params.has("metadata->>lauf_id") ? { status: 500, body: { message: "Lesen fehlgeschlagen (vorübergehend)" } } : null);
  try {
    assert.equal(r.text(r.element("data-text-erzeugen-knopf")), "Erneut senden …");
    await r.lauf();
  } finally {
    welt.stoerung = null;
  }
  assert.equal(r.s.gesendet[1].lauf_id, id, "Wiederholung mit derselben Lauf-ID");
  assert.equal(r.ausgang().props["data-text-erzeugen-ausgang"], "unbekannt", "der frühere Versuch bleibt unbekannt");
  assert.match(r.text(r.ausgang()), /^Ausgang unbekannt \(früherer Versuch mit dieser Lauf-ID\) — .* · Dieser Versuch: Lauf nicht gestartet \(HTTP 500\): Lauf-ID nicht prüfbar/);
  assert.equal(r.text(r.element("data-text-erzeugen-knopf")), "Erneut senden …", "die Lauf-ID bleibt");
  // 3. Der nächste Versuch sendet dieselbe ID → 409, kein zweiter Lauf.
  r.element("data-text-erzeugen-knopf").props.onClick();
  assert.match(r.text(r.element("data-text-erzeugen-bestaetigung")), /\(dieselbe wie beim Versuch mit unbekanntem Ausgang\)/);
  r.element("data-text-erzeugen-start").props.onClick();
  await r.lz.ruhe(40);
  assert.equal(r.s.gesendet[2].lauf_id, id);
  assert.equal(r.ausgang().props["data-text-erzeugen-ausgang"], "existiert");
  assert.equal(welt.aktivierungen.length, 6, "es bleibt bei einem bezahlten Lauf");
  assert.equal(welt.content.filter((z) => z.metadata?.medium_id === EXPORT_ID).length, 1, "eine Caption zum Video");
  // Ohne Wiederholung verwirft ein bekannter Ausgang die ID weiter (Regel nur für die offene ID).
  assert.deepEqual(r.T.ausgangBeiWiederholung({ art: "nicht_gestartet", text: "x" }, false), { art: "nicht_gestartet", text: "x" });
  for (const art of ["ergebnis", "existiert", "unbekannt"]) assert.equal(r.T.ausgangBeiWiederholung({ art, contentId: 1, status: "complete", text: "x" }, true).art, art);
  for (const art of ["nicht_gestartet", "abgewiesen", "abgebrochen"]) assert.equal(r.T.ausgangBeiWiederholung({ art, contentId: 1, text: "x" }, true).art, "unbekannt", art);
});

/** Speicher-Attrappe wie sessionStorage (getItem, setItem, removeItem). */
function speicherAttrappe() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("M-C12 „Text erzeugen“ bei gesperrtem Video (Nachtrag d2-text-erzeugen-3): Der Knopf bleibt, die Bestätigung nennt die Gründe der Medien-Regel — „Video gesperrt: … — Caption nicht freigebbar, solange das gilt“; bei freigebbarem Video keine solche Zeile", async () => {
  const gesperrt = await textErzeugenLaufzeit({ sperre: { freigebbar: false, gruende: ["Rechte laut Prüfprotokoll nicht geklärt", "Startbild-Abgleich nicht bestanden (größte Abweichung 7)"] } });
  assert.equal(gesperrt.text(gesperrt.element("data-text-erzeugen-knopf")), "Text erzeugen …", "der Knopf bleibt");
  gesperrt.element("data-text-erzeugen-knopf").props.onClick();
  assert.equal(gesperrt.text(gesperrt.element("data-text-erzeugen-sperre")), "Video gesperrt: Rechte laut Prüfprotokoll nicht geklärt · Startbild-Abgleich nicht bestanden (größte Abweichung 7) — Caption nicht freigebbar, solange das gilt.");
  assert.deepEqual([gesperrt.s.gesendet.length, welt.aktivierungen.length], [0, 0], "die Bestätigung sendet nichts");
  const frei = await textErzeugenLaufzeit({ sperre: { freigebbar: true, gruende: [] } });
  frei.element("data-text-erzeugen-knopf").props.onClick();
  assert.equal(frei.element("data-text-erzeugen-sperre"), null);
  assert.ok(frei.element("data-text-erzeugen-bestaetigung"));
});

test("M-C13 „Text erzeugen“, offene Lauf-ID im Tab-Speicher (Nachtrag d2-text-erzeugen-4): während des Laufs und nach unbekanntem Ausgang steht die ID je Video im Speicher; nach Neuladen nennt die Karte den Lauf ohne bekannten Ausgang und „Erneut senden …“ schickt dieselbe ID → 409; nach bekanntem Ausgang ist der Eintrag weg", async () => {
  exportMit(RITTERGUT);
  medien();
  agenten();
  const speicher = speicherAttrappe();
  const schluessel = `gp-text-erzeugen:${SLUG}:${EXPORT_ID}`;
  const eins = await textErzeugenLaufzeit({ speicher });
  assert.equal(eins.T.speicherSchluessel(SLUG, EXPORT_ID), schluessel);
  // Während des Laufs: „laeuft“ im Speicher (das Tor hält die Antwort an).
  let auf;
  eins.s.tor = { warte: new Promise((r) => (auf = r)) };
  try {
    eins.element("data-text-erzeugen-knopf").props.onClick();
    eins.element("data-text-erzeugen-start").props.onClick();
    await eins.lz.ruhe(5);
    assert.equal(JSON.parse(speicher.m.get(schluessel)).art, "laeuft");
    assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, eins.s.gesendet[0].lauf_id);
    eins.s.verloren = true;
  } finally {
    eins.s.tor = null;
    auf();
  }
  await eins.lz.ruhe(40);
  eins.s.verloren = false;
  const id = eins.s.gesendet[0].lauf_id;
  assert.deepEqual({ ...JSON.parse(speicher.m.get(schluessel)), seit: "…" }, { laufId: id, art: "unbekannt", seit: "…" });
  // Neuladen: eine neue Karte mit demselben Speicher.
  const zwei = await textErzeugenLaufzeit({ speicher });
  zwei.lz.rendere();
  const gemerkt = zwei.text(zwei.element("data-text-erzeugen-gemerkt"));
  assert.match(gemerkt, new RegExp(`^Caption-Lauf zu diesem Video ohne bekannten Ausgang \\(in diesem Tab gestartet am \\d{2}\\.\\d{2}\\.\\d{4} \\d{2}:\\d{2}:\\d{2} \\(Europe/Berlin\\), Lauf-ID ${id.slice(0, 8)}…\\) — er kann noch laufen\\.`));
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …");
  zwei.element("data-text-erzeugen-knopf").props.onClick();
  assert.match(zwei.text(zwei.element("data-text-erzeugen-bestaetigung")), /\(dieselbe wie beim Versuch mit unbekanntem Ausgang\)/);
  zwei.element("data-text-erzeugen-start").props.onClick();
  await zwei.lz.ruhe(40);
  assert.equal(zwei.s.gesendet[0].lauf_id, id, "dieselbe Lauf-ID nach dem Neuladen");
  assert.equal(zwei.ausgang().props["data-text-erzeugen-ausgang"], "existiert");
  assert.equal(welt.aktivierungen.length, 6, "kein zweiter bezahlter Lauf");
  assert.equal(speicher.m.has(schluessel), false, "nach bekanntem Ausgang ist der Eintrag weg");
  // Unlesbarer oder fremder Eintrag: kein offener Lauf.
  for (const roh of ["{kaputt", JSON.stringify({ laufId: "kurz", art: "unbekannt" }), JSON.stringify({ laufId: id, art: "fertig" })]) {
    speicher.m.set(schluessel, roh);
    assert.equal(eins.T.leseOffenenLauf(speicher, schluessel), null, roh);
  }
  // Ohne Speicher (Server, gesperrte Website-Daten) bleibt es bei der Karte.
  assert.equal(eins.T.leseOffenenLauf(null, schluessel), null);
});

test("M-C14 „Text erzeugen“ während des Laufs (Nachtrag d2-text-erzeugen-5): kein Knopf, beide Felder gesperrt, „Pipeline läuft …“ sichtbar, nichts zweites gesendet — bis die Antwort da ist", async () => {
  exportMit(RITTERGUT);
  medien();
  agenten();
  const r = await textErzeugenLaufzeit();
  let auf;
  r.s.tor = { warte: new Promise((ja) => (auf = ja)) };
  try {
    r.element("data-text-erzeugen-knopf").props.onClick();
    r.element("data-text-erzeugen-start").props.onClick();
    await r.lz.ruhe(5);
    assert.equal(r.s.gesendet.length, 1);
    assert.equal(r.element("data-text-erzeugen-knopf"), null, "kein Knopf während des Laufs");
    assert.equal(r.element("data-text-erzeugen-start"), null, "keine Bestätigung während des Laufs");
    assert.equal(r.element("data-caption-kanal").props.disabled, true);
    assert.equal(r.element("data-caption-kategorie").props.disabled, true);
    assert.match(r.text(r.element("data-text-erzeugen-laeuft")), /^Pipeline läuft … \(bis zu 6 Stufen; kann einige Minuten dauern\) · Lauf-ID [0-9a-f]{8}…$/);
    await r.lz.ruhe(5);
    assert.equal(r.s.gesendet.length, 1, "nichts zweites gesendet");
  } finally {
    r.s.tor = null;
    auf();
  }
  await r.lz.ruhe(40);
  assert.equal(r.ausgang().props["data-text-erzeugen-ausgang"], "ergebnis");
  assert.equal(r.element("data-caption-kanal").props.disabled, false, "nach dem Lauf wieder frei");
  assert.equal(r.text(r.element("data-text-erzeugen-knopf")), "Text erzeugen …");
});

test("M-C9 laufAusgang: Antworten der Pipeline eingeordnet wie auf /content (Ergebnis, 409, 4xx, 5xx mit und ohne Zeile, unlesbar, Netz)", async () => {
  const { hookLaufzeit, ladeTextErzeugen, ladeStudioBausteine } = await import("./harness/studio.mjs");
  const lz = hookLaufzeit();
  const B = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counselModul, "@/lib/freigabe-regeln": regeln });
  const T = ladeTextErzeugen(lz.attrappen, { hilfen: B.hilfen });
  const a = T.laufAusgang;
  assert.equal(a(200, { status: "complete", steps: [], contentId: 12, summary: { total_cost_usd: 0.1656 } }).text, "Lauf beendet: Caption #12 — zur Freigabe im Stapel · geschätzt $0.1656");
  assert.equal(a(200, { status: "abgelehnt", steps: [], contentId: 13 }).text, "Lauf beendet: Caption #13 — COUNSEL lehnt ab — nicht im Stapel · Kosten nicht gemeldet");
  assert.deepEqual(a(409, { fehler: "Lauf-ID schon vergeben", content_id: 12 }), { art: "existiert", contentId: 12, text: "Lauf existiert bereits (#12) — kein zweiter Lauf gestartet · Lauf-ID schon vergeben" });
  assert.equal(a(400, { fehler: "medium_id ungültig" }).art, "abgewiesen");
  assert.equal(a(500, { fehler: "Agent nicht erreichbar", content_id: 14, status: "fehler" }).art, "abgebrochen");
  assert.equal(a(500, { fehler: "Lauf-ID nicht prüfbar" }).art, "nicht_gestartet");
  assert.equal(a(502, null).art, "unbekannt");
  assert.equal(a(200, { ok: true }).art, "unbekannt");
  assert.equal(a(null, { fehler: "Netzfehler: fetch failed" }).art, "unbekannt");
  // Nachtrag d2-text-erzeugen-7: wie /content — 5xx mit lesbaren Schritten als Ergebnis mit Kosten, Fehlertext auch aus error,
  // Untergrenze abgerundet.
  const stufen = [{ agent: "researcher", status: "done", cost: 0.01 }, { agent: "scribe", status: "done", cost: 0.02 }];
  const mitFehler = a(500, { status: "complete", steps: stufen, contentId: 100, fehler: "Status zur_freigabe nicht gespeichert", summary: { total_cost_usd: 0.03 } });
  assert.deepEqual(mitFehler, { art: "ergebnis", status: "fehler", contentId: 100, text: "Lauf mit Fehler beendet (HTTP 500, Caption #100): Status zur_freigabe nicht gespeichert · geschätzt $0.0300" });
  assert.equal(a(401, { error: "Nicht angemeldet" }).text, "Lauf abgewiesen (HTTP 401): Nicht angemeldet");
  assert.equal(a(200, { status: "complete", steps: stufen, contentId: 12, summary: { total_cost_usd: 0.16569, kosten_unvollstaendig: true } }).text, "Lauf beendet: Caption #12 — zur Freigabe im Stapel · geschätzt mindestens $0.1656 · unvollständig");
  assert.equal(a(200, { status: "complete", steps: [...stufen, { agent: "counsel", status: "done" }], contentId: 12, summary: { total_cost_usd: 0.03 } }).text, "Lauf beendet: Caption #12 — zur Freigabe im Stapel · geschätzt mindestens $0.0300 · 1 Stufe ohne Angabe");
  assert.equal(T.mindestensText(0.00005), "mehr als $0 (gemeldet unter $0.0001)");
  assert.equal(T.mindestensText(0.16569), "mindestens $0.1656");
  assert.equal(T.neueLaufId({ randomUUID: () => "kurz" }), null, "Lauf-ID nach Vertrag, sonst kein Lauf");
  assert.match(T.neueLaufId(), /^[0-9a-f-]{36}$/);
  assert.deepEqual(T.laufKoerper(SLUG, 3, "tiktok|tiktok_short", "business_automation", "id-0000001"), { platform: "tiktok", format: "tiktok_short", category: "business_automation", objekt_slug: SLUG, medium_id: 3, lauf_id: "id-0000001" });
});
