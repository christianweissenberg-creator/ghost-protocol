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
  assert.deepEqual(z.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: true });
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
    assert.deepEqual(z.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: false });
    assert.equal(videoFreigabe(z).freigebbar, true);
  }
  // Abweichender Wortlaut zählt nicht: Die wörtliche Zeile wird ergänzt, die abweichende bleibt stehen (der Text ist PUBLISHERs)
  for (const abweichend of [
    "Bild-/Videomaterial: KI-generierte Visualisierung – kein Foto der Bestandsimmobilie",
    "Bild-/Videomaterial: KI-generierte Visualisierung, kein Foto der Bestandsimmobilie.",
    "Bild- und Videomaterial: KI-generierte Visualisierung, kein Foto der Bestandsimmobilie",
    `*${PFLICHTZEILE}*`,
    `Hinweis: ${PFLICHTZEILE}`,
    PFLICHTZEILE.toUpperCase(),
  ]) {
    const pub = (task) => `Finaler Content: ${linkAusAuftrag(task)}\n${abweichend}`;
    const { r, z } = await lauf(pub);
    const erwartet = `${pub(auftrag("publisher"))}\n\n${PFLICHTZEILE}`;
    assert.equal(z.body, erwartet, abweichend);
    assert.equal(r.body.steps[3].output, erwartet, abweichend);
    assert.equal(pflichtzeilen(z.body), 1, abweichend);
    assert.ok(auftrag("counsel", 1).includes(`\n${PFLICHTZEILE}\n\nOBJEKTDATEN`), `${abweichend}: Endprüfung mit der wörtlichen Zeile`);
    assert.deepEqual(z.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: true }, abweichend);
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
  assert.deepEqual(zr.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: true });
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
