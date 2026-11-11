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
const [regeln, counselModul, kiHinweis, pipeline, studioRoute, { NextRequest }] = await Promise.all([
  lib("lib/freigabe-regeln"),
  lib("lib/counsel-urteil"),
  lib("lib/studio/ki-hinweis"),
  route("PIPELINE", "content/pipeline/route.ts"),
  route("STUDIO", "studio/[objekt]/route.ts"),
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

/**
 * PUBLISHER-Antwort in der Gliederung, die der Auftrag verlangt (Finaler Content, Publishing-Zeitpunkt, Cross-Promotion-
 * Posts), ohne Pflichtzeile (Prüfung f-caption-1); content(link) liefert die Zeilen des finalen Contents.
 */
const gegliedert = (content) => (task) =>
  `Finaler Content:\n${content(linkAusAuftrag(task))}\n\nPublishing-Zeitpunkt: Dienstag, 18:00 (Empfehlung)\n\nCross-Promotion-Posts:\n- Tweet: Neues Video zum RitterGut — mehr im Hauptpost.\n- Newsletter-Teaser: Neues Video zum RitterGut — mehr im Hauptpost.\n`;
const THREAD = (link) => `1/2 Denkmal-AfA bis 100 %. Visualisierung: KI-generiert.\n2/2 Mehr: ${link}`;
/** Warnungen ohne Zeitpunkt (am), zum Vergleichen. */
const ohneZeit = (liste) => (liste ?? []).map(({ am, ...w }) => (void am, w));
const LAGE_PRUEFEN = "Pflichtzeile von der Pipeline ergänzt, Lage prüfen";

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

test("M-C4 Caption-Lauf: medium_id in metadata, SCRIBE-Auftrag mit Auftragsart und Pflichtzeile als eigener Zeile; fehlt sie bei PUBLISHER, steht sie vor counsel_endfassung im PUBLISHER-Text — beim X-Thread im ersten Post, an dem das Video hängt (d3-caption-auftrag-1) — body = geprüfter Text, R2 gibt frei", async () => {
  exportMit(RITTERGUT);
  medien();
  const publisher = gegliedert(THREAD);
  agenten({ publisher });
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
  const roh = publisher(auftrag("publisher"));
  assert.equal(pflichtzeilen(roh), 0, "PUBLISHER schrieb die Pflichtzeile nicht");
  // Prüfung f-caption-2: PUBLISHER kennt bei X die Grenze je Post.
  assert.ok(auftrag("publisher").includes("\n1. Qualitätsprüfung: Fakten-Check, Ton, Länge (je Post höchstens 270 Zeichen; die Pflichtzeile zählt im ersten Post mit)\n"));
  // Nachbesserung caption9-4: Auch der PUBLISHER-Auftrag nennt die Pflichtzeile wörtlich; bei X im Post mit dem Video,
  // dort als letzte Zeile, der CTA bleibt im letzten Post (d3-caption-auftrag-1). SCRIBE bekommt dieselbe Zuordnung.
  assert.ok(auftrag("publisher").includes(`- Finaler Content (mit deinen Korrekturen); diese Pflichtzeile wörtlich, als eigene Zeile, ohne Formatierung, im Post mit dem Video (bei einem Thread im ersten Post), dort als letzte Zeile; der CTA bleibt im letzten Post:\n  ${PFLICHTZEILE}\n`), auftrag("publisher").slice(0, 400));
  assert.ok(!auftrag("publisher").includes("als letzte Zeile des finalen Contents"));
  assert.ok(scribe.includes("\n- Die Pflichtzeile aus der AUFTRAGSART als eigene Zeile im Post mit dem Video (bei einem Thread im ersten Post), dort als letzte Zeile; der CTA bleibt im letzten Post.\n"));
  assert.ok(!scribe.includes("als eigene, letzte Zeile (nach den Hashtags)"));
  // Die Pipeline ergänzt die fehlende Zeile im ersten Post (vor „2/2“), nach einer Leerzeile; der Rest bleibt, wie er ist.
  const erwartet = roh.replace("\n2/2 ", `\n\n${PFLICHTZEILE}\n2/2 `);
  assert.notEqual(erwartet, roh);
  assert.equal(r.body.steps[3].output, erwartet, "Pflichtzeile als letzte Zeile des ersten Posts, nach einer Leerzeile");
  // Thread-Vorschau auf /content (splitTweets, gleiche Marke am Zeilenanfang): Die Zeile steht im Block 1/2, nicht im letzten.
  const bloecke = erwartet.split("\n").reduce((b, z) => (/^\*{0,2}\d+\/\d*\*{0,2}/.test(z.trim()) ? [...b, [z]] : (b.at(-1).push(z), b)), [[]]);
  assert.deepEqual(bloecke.map((b) => pflichtzeilen(b.join("\n"))), [0, 1, 0], "Kopf, 1/2 mit Pflichtzeile, 2/2 (mit Zeitpunkt und Cross-Promotion) ohne");
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
  // Prüfung f-caption-1: Jede Ergänzung steht als Warnung im Beleg, mit der Lage.
  const warnung = [{ stufe: "pipeline", grund: LAGE_PRUEFEN, detail: "als letzte Zeile von Post 1 eingesetzt (vor der Marke „2/…“), hinter: „1/2 Denkmal-AfA bis 100 %. Visualisierung: KI-generiert.“" }];
  assert.deepEqual(ohneZeit(r.body.warnungen), warnung);
  assert.deepEqual(ohneZeit(z.metadata.warnungen), warnung);
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

/**
 * ANWEISUNGEN-Block des SCRIBE-Auftrags je Kanal-Wahl, wörtlich (Schlussprüfung d3-caption-auftrag-5); <CTA> steht für den
 * CTA: mit baubarem Kurzlink „CTA mit EXAKT diesem Link: <LINK>“ (<LINK> der Link des Laufs), sonst der CTA ohne Link
 * (Prüfung f-caption-3). Die letzten Zeilen gelten für alle Kanäle, die zur Pflichtzeile je Kanal (d3-caption-auftrag-1).
 */
const ANWEISUNG_ALLE = [
  "- Das Video existiert schon: ein kurzer, fertiger Clip. Du schreibst nur den Text, der mit ihm gepostet wird — kein neues Video, keine Szenenfolge.",
  "- Keine Marken für Schnitt, Szene, Einblendung oder Ton (nichts in eckigen Klammern), keine Vorschläge für Musik, Thumbnail oder Texteinblendungen.",
  "- Zahlen NUR aus den Objektdaten (siehe REGEL); nichts erfinden.",
].join("\n");
const ANWEISUNG_PFLICHT_ENDE = "- Die Pflichtzeile aus der AUFTRAGSART als eigene, letzte Zeile (nach den Hashtags).";
const ANWEISUNG_PFLICHT_X = "- Die Pflichtzeile aus der AUFTRAGSART als eigene Zeile im Post mit dem Video (bei einem Thread im ersten Post), dort als letzte Zeile; der CTA bleibt im letzten Post.";
const ANWEISUNGEN_SOLL = {
  "instagram|reel": `Schreibe die Caption zu einem fertigen Instagram-Reel:
- Der erste Satz trägt allein (vor „… mehr“) und sagt, was das Video zeigt
- Danach 2-4 kurze Sätze; <CTA>
- Länge ohne Hashtags, Pflichtzeilen und CTA-Link: höchstens 600 Zeichen
- Am Ende höchstens 5 passende Hashtags
${ANWEISUNG_ALLE}
${ANWEISUNG_PFLICHT_ENDE}`,
  "tiktok|tiktok_short": `Schreibe die Caption zu einem fertigen TikTok-Video:
- 1-3 kurze Sätze; der erste sagt, was das Video zeigt
- <CTA>
- Länge ohne Hashtags, Pflichtzeilen und CTA-Link: höchstens 300 Zeichen
- Am Ende 3-5 passende Hashtags
${ANWEISUNG_ALLE}
${ANWEISUNG_PFLICHT_ENDE}`,
  "youtube|short": `Schreibe Titel und Beschreibung zu einem fertigen YouTube-Short:
- Titel: höchstens 70 Zeichen, sachlich
- Beschreibung: 2-4 Sätze, was das Video zeigt; <CTA>
- Am Ende der Beschreibung 2-3 passende Hashtags
${ANWEISUNG_ALLE}
${ANWEISUNG_PFLICHT_ENDE}`,
  "x|thread": `Schreibe den Text zu einem fertigen Video auf X im Steinadel-Ton (premium, editorial, ruhig, max 1 Emoji):
- Ein Post oder ein Thread aus 2-3 Posts im Stil "1/3", "2/3", ...; je Post höchstens 270 Zeichen; das Video hängt am ersten Post
- Falls AfA/Steuerzahlen erwähnt werden: Modellrechnung-Disclaimer-Satz PFLICHT
  ("Modellrechnung — individuelle steuerliche Wirkung abhängig von persönlicher
  Situation und Behördenbescheinigung; keine Steuerberatung.")
- Letzter Post: <CTA>
- Höchstens 2 Hashtags
${ANWEISUNG_ALLE}
${ANWEISUNG_PFLICHT_X}`,
  "linkedin|linkedin_post": `Schreibe den Begleittext zu einem fertigen Video auf LinkedIn (Fachton, premium, editorial, ruhig):
- Zeile 1-2: was das Video zeigt, mit einer belegten Zahl oder einer sachlichen These
- 2-3 kurze Absätze mit je 1-3 Sätzen, keine Reel-Ästhetik, höchstens 1 Emoji
- Schluss: <CTA>
- Höchstens 3 fachliche Hashtags am Ende
- Länge ohne Hashtags, Pflichtzeilen und CTA-Link: 500 bis 1.200 Zeichen
${ANWEISUNG_ALLE}
${ANWEISUNG_PFLICHT_ENDE}`,
};

test("M-C11 Caption-Lauf (Nachtrag d2-text-erzeugen-2, Schlussprüfung d3-caption-auftrag-2 und -5): Für jede Kanal-Wahl von „Text erzeugen“ bekommt SCRIBE wörtlich die Anweisungen für eine Caption zu einem fertigen Video (Schnappschuss); RESEARCHER und PUBLISHER behandeln den Lauf als Caption — kein Video-Skript, keine Schnitt- oder Einblendmarken, keine Video-Laufzeiten, kein Thumbnail-, SEO-Title- oder Metadaten-Auftrag; die Pflichtzeile bleibt einmal als eigene Zeile", async () => {
  const wahlen = [["instagram", "reel", "Schreibe die Caption zu einem fertigen Instagram-Reel:"], ["tiktok", "tiktok_short", "Schreibe die Caption zu einem fertigen TikTok-Video:"], ["youtube", "short", "Schreibe Titel und Beschreibung zu einem fertigen YouTube-Short:"], ["x", "thread", "Schreibe den Text zu einem fertigen Video auf X im Steinadel-Ton"], ["linkedin", "linkedin_post", "Schreibe den Begleittext zu einem fertigen Video auf LinkedIn"]];
  assert.deepEqual(wahlen.map(([p, f]) => `${p}|${f}`), Object.keys(ANWEISUNGEN_SOLL));
  // Prüfung f-caption-3: auch für ein Objekt ohne baubaren Kurzlink (keine Kampagne) — dann der CTA ohne Link.
  for (const [platform, format, kopf] of wahlen) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit({ ...RITTERGUT, kampagnen: [] });
    medien();
    agenten();
    const ohne = await pipePost({ ...LAUF, platform, format, medium_id: EXPORT_ID });
    assert.equal(ohne.status, 200, `${platform} ohne Kampagne: ${JSON.stringify(ohne.body).slice(0, 300)}`);
    const s0 = auftrag("scribe");
    assert.equal(linkAusAuftrag(s0), null, `${platform}: kein CTA-Link ohne Kampagne`);
    const v0 = s0.indexOf("ANWEISUNGEN:\n") + "ANWEISUNGEN:\n".length;
    assert.ok(s0.includes(`ANWEISUNGEN:\n${kopf}`), platform);
    assert.equal(s0.slice(v0, s0.indexOf("\n\nSTILREGELN:", v0)), ANWEISUNGEN_SOLL[`${platform}|${format}`].replace("<CTA>", "CTA ohne Link (kein Kampagnen-Link hinterlegt)"), `${platform} ohne Kampagne`);
  }
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
    // Schnappschuss: der ganze ANWEISUNGEN-Block, Zeile für Zeile (CTA-Link für alle fünf, Verbotszeile, Zahlenregel,
    // Pflichtzeile, Hashtags, Längen ohne Pflicht-Elemente).
    const link = linkAusAuftrag(scribe);
    assert.ok(link, `${platform}: CTA-Link im Auftrag`);
    const von = scribe.indexOf("ANWEISUNGEN:\n") + "ANWEISUNGEN:\n".length;
    const block = scribe.slice(von, scribe.indexOf("\n\nSTILREGELN:", von)).replaceAll(link, "<LINK>");
    assert.equal(block, ANWEISUNGEN_SOLL[`${platform}|${format}`].replace("<CTA>", "CTA mit EXAKT diesem Link: <LINK>"), platform);
    // RESEARCHER und PUBLISHER: Caption zu einem fertigen Video statt Format eines neuen Beitrags (d3-caption-auftrag-2).
    assert.ok(auftrag("researcher").includes(" im Format Caption zu einem fertigen Video, Kategorie: "), `${platform}: RESEARCHER`);
    const pub = auftrag("publisher");
    assert.ok(pub.includes(`\nPLATTFORM: ${platform}\nFORMAT: Caption zu einem fertigen Video\n`), `${platform}: PUBLISHER-Format`);
    const laengeX = platform === "x" ? " (je Post höchstens 270 Zeichen; die Pflichtzeile zählt im ersten Post mit)" : "";
    assert.ok(pub.includes(`\n1. Qualitätsprüfung: Fakten-Check, Ton, Länge${laengeX}\n2. Hashtags: nur die in der Caption, keine zusätzlichen; keine Title Tags, keine SEO-Description\n3. Scheduling-Empfehlung: `), `${platform}: PUBLISHER Punkte 1 und 2`);
    assert.ok(pub.includes("\n4. Das Video ist fertig: keine Thumbnail-, Musik-, Schnitt- oder Einblendungsvorschläge\n5. Cross-Promotion: "), `${platform}: PUBLISHER Punkt 4`);
    assert.ok(/\n- Finaler Content \(mit deinen Korrekturen\); [^\n]+:\n {2}[^\n]+\n- Publishing-Zeitpunkt /.test(pub), `${platform}: keine Metadaten-Zeile`);
    for (const a of welt.aktivierungen) {
      for (const marke of ["-Skript", "[B-ROLL]", "[TEXTOVERLAY]", "[TRANSITION]", "Trending", "Thumbnail/Preview", "Sek)", "SEO-Optimierung", "Metadaten (Title", "Thread (5-8 Posts)", "Fachbeitrag, 1.200-2.000 Zeichen"]) {
        assert.ok(!a.task.includes(marke), `${platform}: ${a.agent} ohne „${marke}“`);
      }
    }
  }
  // Gegenprobe ohne medium_id: die Aufträge eines neuen Beitrags wie bisher (der Zeichenvergleich aller Aufträge steht im PR).
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  agenten();
  await pipePost({ ...LAUF, platform: "tiktok", format: "tiktok_short" });
  assert.ok(auftrag("scribe").includes("Schreibe ein TikTok-Skript (TikTok Short (30-60 Sek)):"));
  assert.ok(auftrag("researcher").includes(" im Format TikTok Short (30-60 Sek), Kategorie: "));
  const pub = auftrag("publisher");
  assert.ok(pub.includes("\nPLATTFORM: tiktok\nFORMAT: tiktok_short\n"));
  assert.ok(pub.includes("\n1. Qualitätsprüfung: Fakten-Check, Ton, Länge\n2. SEO-Optimierung: Title Tags, Description, Hashtags\n") && pub.includes("\n4. Thumbnail/Preview: Beschreibung für visuelles Asset\n"));
  assert.ok(pub.includes("\n- Finaler Content (mit deinen Korrekturen)\n- Metadaten (Title, Description, Tags, Hashtags)\n- Publishing-Zeitpunkt "));
});

test("M-C15 Fehlende Pflichtzeile im Abschnitt „Finaler Content“ (Prüfung f-caption-1): außerhalb von X und beim X-Einzelpost an dessen Ende, vor Publishing-Zeitpunkt und Cross-Promotion; Marken wie „Post 1/3:“ und eine Längenliste vor dem Content führen nicht in die Irre; ohne folgenden Abschnitt ans Ende; jede Ergänzung als Warnung mit Lage", async () => {
  const lauf = async (body, publisher, objekt = RITTERGUT) => {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(objekt);
    medien();
    agenten({ publisher });
    const r = await pipePost({ ...LAUF, ...body, medium_id: EXPORT_ID });
    assert.equal(r.body.status, "complete", JSON.stringify(r.body.fehler ?? null));
    const z = zeile(r.body.contentId);
    assert.equal(videoFreigabe(z).freigebbar, true);
    assert.equal(pflichtzeilen(z.body), 1);
    return { r, z, roh: publisher(auftrag("publisher")) };
  };
  const vorZeitpunkt = (roh) => roh.replace("\n\nPublishing-Zeitpunkt:", `\n\n${PFLICHTZEILE}\n\nPublishing-Zeitpunkt:`);
  const warnung = (detail) => [{ stufe: "pipeline", grund: LAGE_PRUEFEN, detail }];
  const ABSCHNITT = "am Ende des Abschnitts „Finaler Content“ eingesetzt";

  // Instagram (Vorauswahl): am Ende des finalen Contents, vor Publishing-Zeitpunkt und Cross-Promotion.
  const ig = await lauf({ platform: "instagram", format: "reel" }, gegliedert((link) => `Das Video zeigt den Hof bei Nacht. ${link}\n#Denkmal #RitterGut`));
  const pub = auftrag("publisher");
  assert.ok(pub.includes(`- Finaler Content (mit deinen Korrekturen); als letzte Zeile des finalen Contents diese Pflichtzeile wörtlich, als eigene Zeile, ohne Formatierung:\n  ${PFLICHTZEILE}\n`), pub.slice(0, 400));
  assert.ok(!pub.includes("im Post mit dem Video") && !pub.includes("je Post höchstens 270 Zeichen"));
  assert.ok(auftrag("scribe").includes(`\n${ANWEISUNG_PFLICHT_ENDE}\n`));
  assert.equal(ig.z.body, vorZeitpunkt(ig.roh));
  assert.deepEqual(ohneZeit(ig.z.metadata.warnungen), warnung(`${ABSCHNITT}, hinter: „#Denkmal #RitterGut“`));
  assert.deepEqual(ig.z.metadata.pflichtzeile, { wortlaut: PFLICHTZEILE, von_pipeline_ergaenzt: true, ersetzt: null });

  // Instagram mit Postmarken und einer Cross-Promotion-Zeile direkt danach: vor die Cross-Promotion, nicht in Post 1.
  const igMarken = await lauf({ platform: "instagram", format: "reel" }, PUBLISHER_ROH);
  assert.equal(igMarken.z.body, igMarken.roh.replace("\nCross-Promotion-Tweet:", `\n\n${PFLICHTZEILE}\nCross-Promotion-Tweet:`));

  // X-Einzelpost in der Gliederung: Der Post mit dem Video ist der finale Content.
  const einzel = await lauf({}, gegliedert((link) => `Das Video zeigt den Hof bei Nacht. ${link}\n#Denkmal`));
  assert.equal(einzel.z.body, vorZeitpunkt(einzel.roh));
  assert.deepEqual(ohneZeit(einzel.z.metadata.warnungen), warnung(`${ABSCHNITT}, hinter: „#Denkmal“`));

  // X mit „Post 1/3:“, davor eine Längenliste in der Qualitätsprüfung: Die Zeile kommt in Post 1 des finalen Contents.
  const mitListe = (task) =>
    `Qualitätsprüfung:\n1/3: 84 Zeichen\n2/3: 90 Zeichen\n\n${gegliedert((link) => `Post 1/3: Das Video zeigt den Hof bei Nacht.\nPost 2/3: Denkmal-AfA bis 100 %.\nPost 3/3: Mehr: ${link}`)(task)}`;
  const liste = await lauf({}, mitListe);
  assert.equal(liste.z.body, liste.roh.replace("\nPost 2/3:", `\n\n${PFLICHTZEILE}\nPost 2/3:`));
  assert.deepEqual(ohneZeit(liste.z.metadata.warnungen), warnung("als letzte Zeile von Post 1 eingesetzt (vor der Marke „2/…“), hinter: „Post 1/3: Das Video zeigt den Hof bei Nacht.“"));
  // Die Längenmessung nimmt Post 1 des finalen Contents, nicht den Eintrag der Längenliste (f2-pflichtzeile-3).
  assert.equal(regeln.xPostEinsLaenge(liste.z.body), "Post 1/3: Das Video zeigt den Hof bei Nacht.".length + 2 + PFLICHTZEILE.length);

  // Ohne folgenden Abschnitt: ans Ende des Texts, wie bisher.
  const ohneFolge = (task) => `Finaler Content: Das Video zeigt den Hof bei Nacht. ${linkAusAuftrag(task)}\n#Denkmal`;
  const ende = await lauf({}, ohneFolge);
  assert.equal(ende.z.body, `${ende.roh}\n\n${PFLICHTZEILE}`);
  assert.deepEqual(ohneZeit(ende.z.metadata.warnungen), warnung("ans Ende des Texts gehängt (kein Abschnitt „Finaler Content“ mit folgendem Abschnitt und kein Thread davor erkannt), hinter: „#Denkmal“"));

  // Eine nahe Variante wird ersetzt — auch das ist eine Ergänzung mit Warnung; steht die Zeile schon da, keine Warnung.
  const nah = await lauf({}, gegliedert((link) => `1/2 Das Video zeigt den Hof.\n${PFLICHTZEILE}.\n2/2 Mehr: ${link}`));
  assert.deepEqual(ohneZeit(nah.z.metadata.warnungen), warnung("eine nahe Variante durch den Wortlaut ersetzt"));
  const da = await lauf({}, gegliedert((link) => `1/2 Das Video zeigt den Hof.\n${PFLICHTZEILE}\n2/2 Mehr: ${link}`));
  assert.deepEqual(ohneZeit(da.z.metadata.warnungen), [], "Pflichtzeile schon da: keine Warnung");
  assert.equal(da.z.body, da.roh);
});

test("M-C22 X: Post 1 gemessen (Prüfung f-caption-2) — Der PUBLISHER-Auftrag nennt die Grenze je Post; über 280 Zeichen eine Warnung im Beleg, bis 280 keine, kein Abbruch; auch wenn die Pflichtzeile schon dasteht", async () => {
  for (const [zeichen, warnt] of [[196, false], [197, true]]) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    // Erste Zeile von Post 1 mit genau `zeichen` Zeichen; nach der Ergänzung kommen Leerzeile und Pflichtzeile hinzu (+84).
    const publisher = gegliedert((link) => `1/2 ${"x".repeat(zeichen - 4)}\n2/2 Mehr: ${link}`);
    agenten({ publisher });
    const r = await pipePost({ ...LAUF, medium_id: EXPORT_ID });
    assert.equal(r.body.status, "complete", `${zeichen}: ${JSON.stringify(r.body.fehler ?? null)}`);
    assert.equal(welt.aktivierungen.length, 6, `${zeichen}: kein Abbruch`);
    const z = zeile(r.body.contentId);
    assert.equal(regeln.xPostEinsLaenge(z.body), zeichen + 84);
    const laenge = ohneZeit(z.metadata.warnungen).filter((w) => w.grund.startsWith("X: Post 1"));
    assert.deepEqual(laenge, warnt ? [{ stufe: "pipeline", grund: "X: Post 1 länger als 280 Zeichen", detail: `${zeichen + 84} Zeichen, gezählt wie die Thread-Vorschau (URLs voll)` }] : [], String(zeichen));
    assert.equal(z.status, "zur_freigabe");
  }
  // Pflichtzeile schon im ersten Post, Post 1 trotzdem zu lang: dieselbe Warnung (ohne „Lage prüfen“).
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  medien();
  agenten({ publisher: gegliedert((link) => `1/2 ${"x".repeat(200)}\n${PFLICHTZEILE}\n2/2 Mehr: ${link}`) });
  const lang = await pipePost({ ...LAUF, medium_id: EXPORT_ID });
  assert.deepEqual(ohneZeit(lang.body.warnungen).map((w) => w.grund), ["X: Post 1 länger als 280 Zeichen"]);
  // Außerhalb von X: keine Messung, keine Grenze im PUBLISHER-Auftrag.
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  medien();
  agenten({ publisher: gegliedert((link) => `${"x".repeat(400)} ${link}`) });
  const ig = await pipePost({ ...LAUF, platform: "instagram", format: "reel", medium_id: EXPORT_ID });
  assert.deepEqual(ohneZeit(ig.body.warnungen).map((w) => w.grund), [LAGE_PRUEFEN]);
  assert.ok(!auftrag("publisher").includes("je Post höchstens 270 Zeichen"));
});

test("M-C16 medium_id nur für die Kanal-Wahl von „Text erzeugen“ (Schlussprüfung d3-caption-auftrag-4): jede andere Plattform/Format-Kombination → 400 vor jeder Lesung, ohne Insert und ohne bezahlten Aufruf; angenommen werden genau die Kombinationen aus CAPTION_WAHL", async () => {
  const { hookLaufzeit, ladeTextErzeugen, ladeStudioBausteine } = await import("./harness/studio.mjs");
  const lz = hookLaufzeit();
  const B = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counselModul, "@/lib/freigabe-regeln": regeln });
  const T = ladeTextErzeugen(lz.attrappen, { hilfen: B.hilfen });
  const wahl = T.CAPTION_WAHL.map((w) => `${w.plattform}|${w.format}`);
  assert.equal(wahl.length, 5);
  // Alle Plattformen und Formate der Pipeline (FORMATE_JE_PLATTFORM), hier wörtlich.
  const FORMATE = { youtube: ["longform", "short", "deep_dive"], twitter: ["thread"], x: ["thread"], linkedin: ["linkedin_post"], newsletter: ["newsletter_issue"], tiktok: ["tiktok_short"], instagram: ["carousel", "reel", "story"] };
  const angenommen = [];
  let abgewiesen = 0;
  for (const [platform, formate] of Object.entries(FORMATE)) {
    for (const format of formate) {
      zuruecksetzen();
      welt.pipelineModul = pipeline;
      exportMit(RITTERGUT);
      medien();
      agenten();
      const r = await pipePost({ ...LAUF, platform, format, medium_id: EXPORT_ID, lauf_id: "lauf-kanal-0001" });
      const fall = `${platform}/${format}`;
      if (r.status === 200) {
        angenommen.push(`${platform}|${format}`);
        assert.equal(r.body.status, "complete", fall);
        assert.equal(welt.aktivierungen.length, 6, fall);
        continue;
      }
      abgewiesen += 1;
      assert.equal(r.status, 400, `${fall}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.fehler, `medium_id nur für instagram/reel, tiktok/tiktok_short, youtube/short, x/thread, linkedin/linkedin_post (Kanäle von „Text erzeugen“), nicht für ${fall} — Lauf nicht gestartet`);
      assert.equal(welt.aktivierungen.length, 0, `${fall}: kein bezahlter Aufruf`);
      assert.equal(welt.content.length, 0, `${fall}: keine content-Zeile`);
      assert.equal(welt.log.filter((l) => l.tabelle === "content").length, 0, `${fall}: weder Lauf-ID-Prüfung noch Insert`);
      assert.equal(mediumLesungen().length, 0, `${fall}: keine Abfrage auf studio_medium`);
      assert.equal(welt.objektAbrufe, 0, `${fall}: kein Export-Abruf`);
      // Ohne medium_id läuft dieselbe Kombination wie bisher.
      zuruecksetzen();
      welt.pipelineModul = pipeline;
      exportMit(RITTERGUT);
      agenten();
      const ohne = await pipePost({ ...LAUF, platform, format });
      assert.deepEqual([ohne.status, ohne.body.status], [200, "complete"], `${fall} ohne medium_id`);
    }
  }
  assert.equal(abgewiesen, 6);
  assert.deepEqual([...angenommen].sort(), [...wahl].sort(), "angenommen werden genau die Kanäle von „Text erzeugen“");
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
  assert.deepEqual(a(409, { fehler: "Lauf-ID schon vergeben", content_id: 12 }), { art: "existiert", contentId: 12, status: null, text: "Lauf existiert bereits (#12) — kein zweiter Lauf gestartet · Lauf-ID schon vergeben" });
  assert.equal(a(409, { fehler: "x", content_id: 12, status: "counsel_geprueft" }).status, "counsel_geprueft");
  // Delta-Prüfung f2-endzustand-1: Die ID bleibt bei unbekanntem Ausgang und bei 409 mit Zeile, die nicht in einem Endzustand ist.
  const offen = (status, daten) => T.laufNochOffen(a(status, daten));
  assert.equal(offen(null, null), true, "Netz");
  for (const st of ["entwurf", "counsel_geprueft", "archiviert"]) assert.equal(offen(409, { fehler: "x", content_id: 12, status: st }), true, st);
  assert.equal(offen(409, { fehler: "x", content_id: 12 }), true, "409 ohne Status");
  for (const st of ["zur_freigabe", "abgelehnt", "fehler", "freigegeben", "gepostet"]) assert.equal(offen(409, { fehler: "x", content_id: 12, status: st }), false, st);
  assert.equal(offen(409, { fehler: "x" }), false, "409 ohne Zeile");
  for (const [st, d] of [[200, { status: "complete", steps: [], contentId: 12 }], [400, { fehler: "x" }], [500, { fehler: "x", content_id: 14, status: "fehler" }]]) assert.equal(offen(st, d), false, String(st));
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

// ═══ Schlussprüfung d3-kosten-knopf: Tab-Speicher im Betrieb, erster Versuch, Abgleich mit den geladenen Captions ═══

/** Studio wie GET /api/studio/[objekt] es liefert (aus der Attrappe): Medien, Credits und Assets der Seite. */
async function holeStudio() {
  const res = await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) });
  assert.equal(res.status, 200);
  return res.json();
}

/**
 * Medien-Panel als Wurzel, eingebunden wie in StudioAnsicht (ohne speicher-Prop: „Text erzeugen“ nimmt sessionStorage),
 * mit den Daten von GET /api/studio. „Text erzeugen“ zum Export läuft gegen die echte Pipeline-Route (Agenten-Attrappe,
 * nichts Bezahltes). neuGelesen() liest das Studio neu und gibt dem Panel die neuen Daten (Neu laden im selben Tab).
 */
async function medienPanelLaufzeit(s = { gesendet: [], verloren: false }) {
  const { hookLaufzeit, ladeStudioBausteine } = await import("./harness/studio.mjs");
  const lz = hookLaufzeit();
  const B = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counselModul, "@/lib/freigabe-regeln": regeln });
  const holen = async (url, init) => {
    assert.equal(url, "/api/content/pipeline");
    s.gesendet.push(JSON.parse(init.body));
    const req = new NextRequest(`http://harness.local${url}`, { method: "POST", headers: { ...init.headers, cookie: "gp-auth=test" }, body: init.body });
    const res = await pipeline.POST(req);
    // Server fertig, Antwort noch unterwegs (Tor im Client), wenn der Test es so stellt.
    if (s.nachServer) await s.nachServer();
    if (s.verloren) throw new TypeError("Verbindung nach dem Senden abgebrochen");
    return res;
  };
  const wurzel = (studio) => lz.setzeWurzel(B.medien.MedienPanel, { slug: SLUG, medien: studio.medien, credits: studio.kosten_credits, assets: studio.assets.wert, neuLaden: () => {}, holen });
  const studio = await holeStudio();
  assert.equal(studio.medien.wert.ketten.length, 1, "eine Kette (Export 3)");
  wurzel(studio);
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
  const lauf = async () => {
    element("data-text-erzeugen-knopf").props.onClick();
    element("data-text-erzeugen-start").props.onClick();
    await lz.ruhe(40);
  };
  return { lz, s, element, text, lauf, ausgang: () => element("data-text-erzeugen-ausgang"), neuGelesen: async () => wurzel(await holeStudio()) };
}

/** globalThis.sessionStorage für einen Test stellen (Node 25 hat eines, Node 22 nicht) und danach zurücksetzen. */
function stelleSessionStorage(t) {
  const alt = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const speicher = speicherAttrappe();
  Object.defineProperty(globalThis, "sessionStorage", { value: speicher, configurable: true, writable: true, enumerable: true });
  t.after(() => {
    if (alt) Object.defineProperty(globalThis, "sessionStorage", alt);
    else delete globalThis.sessionStorage;
  });
  return speicher;
}

test("M-C17 „Text erzeugen“ im Betrieb (Schlussprüfung d3-kosten-knopf-1, Delta-Prüfung f2-endzustand-1): Medien-Panel ohne speicher-Prop mit gestelltem sessionStorage — Antwort verloren → Eintrag „unbekannt“; Neuladen, die Caption steht noch im Entwurf → Hinweis und „Erneut senden …“ mit derselben ID → 409, die ID bleibt; nach dem Ende des Laufs gibt das nächste „Erneut senden …“ (409, zur_freigabe) sie frei; kein zweiter bezahlter Lauf", async (t) => {
  const speicher = stelleSessionStorage(t);
  const schluessel = `gp-text-erzeugen:${SLUG}:${EXPORT_ID}`;
  exportMit(RITTERGUT);
  medien();
  agenten();
  const eins = await medienPanelLaufzeit();
  assert.equal(eins.text(eins.element("data-text-erzeugen-knopf")), "Text erzeugen …");
  eins.s.verloren = true;
  await eins.lauf();
  eins.s.verloren = false;
  assert.equal(eins.ausgang().props["data-text-erzeugen-ausgang"], "unbekannt");
  const id = eins.s.gesendet[0].lauf_id;
  assert.deepEqual({ ...JSON.parse(speicher.m.get(schluessel)), seit: "…" }, { laufId: id, art: "unbekannt", seit: "…" }, "der Eintrag steht im sessionStorage des Browsers");
  assert.equal(welt.aktivierungen.length, 6);
  // Der Lauf läuft aus Sicht des Studios noch: Seine Zeile steht im Entwurf.
  const zeileDesLaufs = welt.content.find((z) => z.metadata?.lauf_id === id);
  zeileDesLaufs.status = "entwurf";
  // Neuladen: neue Laufzeit, neue Studio-Lesung, derselbe sessionStorage.
  const zwei = await medienPanelLaufzeit();
  assert.equal(zwei.element("data-text-erzeugen-gemerkt").props["data-text-erzeugen-gemerkt"], "unbekannt");
  assert.match(zwei.text(zwei.element("data-text-erzeugen-gemerkt")), new RegExp(`Lauf-ID ${id.slice(0, 8)}…\\) — er kann noch laufen\\.`));
  assert.equal(zwei.element("data-text-erzeugen-bekannt"), null, "eine Zeile im Entwurf ist kein bekannter Ausgang");
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …");
  zwei.element("data-text-erzeugen-knopf").props.onClick();
  assert.match(zwei.text(zwei.element("data-text-erzeugen-bestaetigung")), /\(dieselbe wie beim Versuch mit unbekanntem Ausgang\)/);
  zwei.element("data-text-erzeugen-start").props.onClick();
  await zwei.lz.ruhe(40);
  assert.equal(zwei.s.gesendet[0].lauf_id, id, "dieselbe Lauf-ID nach dem Neuladen");
  assert.equal(zwei.ausgang().props["data-text-erzeugen-ausgang"], "existiert");
  assert.match(zwei.text(zwei.ausgang()), new RegExp(`^Lauf existiert bereits \\(#${zeileDesLaufs.id}\\)`));
  assert.equal(welt.aktivierungen.length, 6, "kein zweiter bezahlter Lauf");
  // Die Zeile steht im Entwurf: Die ID bleibt (f2-endzustand-1), die Karte nennt die Zeile als nicht fertig.
  assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, id, "nach 409 mit Zeile im Entwurf bleibt der Eintrag");
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-laufend")), `Caption #${zeileDesLaufs.id} (Status entwurf) gehört zu diesem Lauf und ist noch nicht fertig.`);
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …");
  // Der Lauf ist fertig: Das nächste „Erneut senden …“ bekommt 409 mit zur_freigabe und gibt die ID frei.
  zeileDesLaufs.status = "zur_freigabe";
  zwei.element("data-text-erzeugen-knopf").props.onClick();
  zwei.element("data-text-erzeugen-start").props.onClick();
  await zwei.lz.ruhe(40);
  assert.equal(zwei.s.gesendet[1].lauf_id, id);
  assert.equal(zwei.ausgang().props["data-text-erzeugen-ausgang"], "existiert");
  assert.equal(welt.aktivierungen.length, 6, "kein zweiter bezahlter Lauf");
  assert.equal(speicher.m.has(schluessel), false, "nach 409 mit Endzustand ist der Eintrag weg");
  assert.equal(zwei.element("data-text-erzeugen-laufend"), null);
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Text erzeugen …");
});

test("M-C18 „Text erzeugen“, erster Versuch scheitert bekannt (Schlussprüfung d3-kosten-knopf-2): 400 (Video eines anderen Objekts) → „abgewiesen“, 502 ohne Zeile (Medien nicht lesbar) → „nicht gestartet“ — kein „Ausgang unbekannt“, kein Eintrag im Speicher, der nächste Versuch mit neuer Lauf-ID", async () => {
  for (const [fall, medium, stoerung, art, meldung] of [
    ["400", { id: FREMDER_EXPORT_ID, sha256: "5".repeat(64) }, null, "abgewiesen", /^Lauf abgewiesen \(HTTP 400\): Medium 5 gehört nicht zum Objekt dieses Laufs — Lauf nicht gestartet$/],
    ["502", undefined, (a) => (a.art === "supabase" && a.tabelle === "studio_medium" ? { status: 500, body: { message: "Lesen fehlgeschlagen (Test)" } } : null), "nicht_gestartet", /^Lauf nicht gestartet \(HTTP 502\): Medium 3 nicht lesbar: .* — Lauf nicht gestartet$/],
  ]) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    agenten();
    const speicher = speicherAttrappe();
    const r = await textErzeugenLaufzeit({ speicher, ...(medium ? { medium } : {}) });
    welt.stoerung = stoerung;
    try {
      await r.lauf();
    } finally {
      welt.stoerung = null;
    }
    assert.equal(r.s.gesendet.length, 1, fall);
    assert.equal(r.ausgang().props["data-text-erzeugen-ausgang"], art, fall);
    assert.match(r.text(r.ausgang()), meldung, fall);
    assert.ok(!r.text(r.ausgang()).includes("Ausgang unbekannt"), `${fall}: kein unbekannter Ausgang`);
    assert.equal(r.text(r.element("data-text-erzeugen-knopf")), "Text erzeugen …", `${fall}: die Lauf-ID ist verbraucht`);
    assert.equal(speicher.m.size, 0, `${fall}: kein Eintrag im Speicher`);
    assert.deepEqual([welt.aktivierungen.length, welt.content.length], [0, 0], `${fall}: kein Lauf, keine Zeile`);
    r.element("data-text-erzeugen-knopf").props.onClick();
    assert.match(r.text(r.element("data-text-erzeugen-bestaetigung")), / · Lauf-ID [0-9a-f]{8}… \(neu\)Ja, bezahlten Lauf starten/, `${fall}: neue Lauf-ID`);
  }
});

test("M-C19 „Text erzeugen“, Abgleich mit den geladenen Captions (Schlussprüfung d3-kosten-knopf-3, Delta-Prüfung f2-endzustand-3): Steht die gemerkte Lauf-ID an einer Caption des Videos in einem Endzustand (LAUF_VORBEI: zur_freigabe, abgelehnt, fehler, freigegeben, gepostet), verschwindet der Eintrag; die Karte nennt „Caption #N (Status …) zu diesem Lauf“, und „Text erzeugen …“ startet ohne vergebliches 409 mit neuer ID — nach Neuladen und beim Neu-Lesen im selben Tab", async (t) => {
  const speicher = stelleSessionStorage(t);
  const schluessel = `gp-text-erzeugen:${SLUG}:${EXPORT_ID}`;
  exportMit(RITTERGUT);
  medien();
  agenten();
  // Antwort verloren, der Lauf läuft durch; der Inhaber lehnt die Caption im Stapel ab.
  const eins = await medienPanelLaufzeit();
  eins.s.verloren = true;
  await eins.lauf();
  eins.s.verloren = false;
  const id = eins.s.gesendet[0].lauf_id;
  assert.equal(JSON.parse(speicher.m.get(schluessel)).art, "unbekannt");
  const zeileDesLaufs = welt.content.find((z) => z.metadata?.lauf_id === id);
  zeileDesLaufs.status = "abgelehnt";
  // Neuladen: Die Karte gleicht ab und nennt die Caption statt „kann noch laufen“.
  const zwei = await medienPanelLaufzeit();
  assert.equal(zwei.element("data-text-erzeugen-gemerkt"), null, "kein „kann noch laufen“");
  const bekannt = zwei.element("data-text-erzeugen-bekannt");
  assert.equal(bekannt.props["data-text-erzeugen-bekannt"], zeileDesLaufs.id);
  assert.equal(zwei.text(bekannt), `Caption #${zeileDesLaufs.id} (Status abgelehnt) zu diesem Lauf (Lauf-ID ${id.slice(0, 8)}…) — der Ausgang ist bekannt. „Text erzeugen …“ startet einen neuen Lauf mit neuer Lauf-ID.`);
  assert.equal(speicher.m.has(schluessel), false, "Eintrag entfernt");
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Text erzeugen …");
  zwei.element("data-text-erzeugen-knopf").props.onClick();
  assert.match(zwei.text(zwei.element("data-text-erzeugen-bestaetigung")), / · Lauf-ID [0-9a-f]{8}… \(neu\)Ja, bezahlten Lauf starten/);
  zwei.element("data-text-erzeugen-start").props.onClick();
  await zwei.lz.ruhe(40);
  assert.notEqual(zwei.s.gesendet[0].lauf_id, id, "neue Lauf-ID");
  assert.equal(zwei.ausgang().props["data-text-erzeugen-ausgang"], "ergebnis", "ein neuer Lauf, kein 409");
  assert.equal(welt.aktivierungen.length, 12);
  assert.equal(zwei.element("data-text-erzeugen-bekannt"), null, "der Hinweis gehört zum alten Lauf");

  // Im selben Tab: Ausgang unbekannt, dann liest das Studio neu und die Caption ist fertig → derselbe Abgleich.
  const drei = await medienPanelLaufzeit();
  drei.s.verloren = true;
  await drei.lauf();
  drei.s.verloren = false;
  const id3 = drei.s.gesendet[0].lauf_id;
  assert.equal(drei.ausgang().props["data-text-erzeugen-ausgang"], "unbekannt");
  assert.equal(drei.text(drei.element("data-text-erzeugen-knopf")), "Erneut senden …");
  const zeile3 = welt.content.find((z) => z.metadata?.lauf_id === id3);
  assert.equal(zeile3.status, "zur_freigabe");
  await drei.neuGelesen();
  assert.equal(drei.ausgang(), null, "„Ausgang unbekannt“ ist ersetzt");
  assert.equal(drei.text(drei.element("data-text-erzeugen-bekannt")).startsWith(`Caption #${zeile3.id} (Status zur_freigabe) zu diesem Lauf (Lauf-ID ${id3.slice(0, 8)}…)`), true);
  assert.equal(speicher.m.has(schluessel), false);
  assert.equal(drei.text(drei.element("data-text-erzeugen-knopf")), "Text erzeugen …");
  // captionsZumVideo: nur Zeilen dieses Videos mit Lauf-ID nach Vertrag.
  const { ladeTextErzeugen, ladeStudioBausteine, hookLaufzeit } = await import("./harness/studio.mjs");
  const lz = hookLaufzeit();
  const T = ladeTextErzeugen(lz.attrappen, { hilfen: ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counselModul, "@/lib/freigabe-regeln": regeln }).hilfen });
  const asset = (id, status, metadata) => ({ beleg: { id, status, body: null, review_notes: null, metadata } });
  assert.deepEqual(
    T.captionsZumVideo([asset(1, "zur_freigabe", { medium_id: 3, lauf_id: "lauf-0000001" }), asset(2, "abgelehnt", { medium_id: 5, lauf_id: "lauf-0000002" }), asset(3, "fehler", { medium_id: "3", lauf_id: "lauf-0000003" }), asset(4, "fehler", { medium_id: 3, lauf_id: "kurz" }), asset(5, "fehler", { medium_id: 3 }), asset(6, "fehler", null)], 3),
    [{ contentId: 1, status: "zur_freigabe", laufId: "lauf-0000001" }],
  );
  assert.deepEqual(T.captionsZumVideo(null, 3), []);
});

/** Wartet höchstens ms auf ein Versprechen (ein Tor, das nie erreicht wird, hält die Suite sonst an). */
function binnen(versprechen, ms, was) {
  let griff;
  const frist = new Promise((_, nein) => {
    griff = setTimeout(() => nein(new Error(`${was}: nicht binnen ${ms} ms`)), ms);
  });
  return Promise.race([versprechen, frist]).finally(() => clearTimeout(griff));
}

test("M-C20 „Text erzeugen“, Neuladen während PUBLISHER oder AMPLIFIER (Prüfung f-knopf-pruefung-1): Die Caption steht dann auf counsel_geprueft — kein bekannter Ausgang. Die Lauf-ID bleibt, die Karte nennt die Caption als nicht fertig, „Erneut senden …“ bekommt 409; es bleibt bei einem bezahlten Lauf und einer Caption", async (t) => {
  const speicher = stelleSessionStorage(t);
  const schluessel = `gp-text-erzeugen:${SLUG}:${EXPORT_ID}`;
  for (const halt of ["publisher", "amplifier"]) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    agenten();
    speicher.m.clear();
    let auf;
    let angekommen;
    const tor = new Promise((r) => (auf = r));
    const da = new Promise((r) => (angekommen = r));
    welt.vorAntwort = async (a) => {
      if (a.art === "activate" && a.body?.agent_id === halt) {
        angekommen();
        await tor;
      }
    };
    const eins = await medienPanelLaufzeit();
    try {
      eins.element("data-text-erzeugen-knopf").props.onClick();
      eins.element("data-text-erzeugen-start").props.onClick();
      await binnen(da, 5_000, `Tor vor ${halt}`);
      const id = eins.s.gesendet[0].lauf_id;
      const zeileDesLaufs = welt.content.find((z) => z.metadata?.lauf_id === id);
      assert.equal(zeileDesLaufs.status, "counsel_geprueft", `${halt}: Status während der Stufe`);
      assert.equal(JSON.parse(speicher.m.get(schluessel)).art, "laeuft");
      // Neuladen während der Stufe: neue Karte, neue Studio-Lesung, derselbe sessionStorage.
      const zwei = await medienPanelLaufzeit();
      assert.equal(zwei.element("data-text-erzeugen-bekannt"), null, `${halt}: kein bekannter Ausgang`);
      assert.equal(zwei.element("data-text-erzeugen-laufend").props["data-text-erzeugen-laufend"], zeileDesLaufs.id);
      assert.equal(zwei.text(zwei.element("data-text-erzeugen-laufend")), `Caption #${zeileDesLaufs.id} (Status counsel_geprueft) gehört zu diesem Lauf und ist noch nicht fertig.`);
      assert.equal(zwei.element("data-text-erzeugen-gemerkt").props["data-text-erzeugen-gemerkt"], "laeuft");
      assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, id, `${halt}: der Eintrag bleibt`);
      assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …");
      zwei.element("data-text-erzeugen-knopf").props.onClick();
      assert.match(zwei.text(zwei.element("data-text-erzeugen-bestaetigung")), /\(dieselbe wie beim Versuch mit unbekanntem Ausgang\)/);
      zwei.element("data-text-erzeugen-start").props.onClick();
      await zwei.lz.ruhe(40);
      assert.equal(zwei.s.gesendet[0].lauf_id, id, `${halt}: dieselbe Lauf-ID`);
      assert.equal(zwei.ausgang().props["data-text-erzeugen-ausgang"], "existiert");
      assert.match(zwei.text(zwei.ausgang()), /Status counsel_geprueft/);
    } finally {
      welt.vorAntwort = null;
      auf();
      await eins.lz.ruhe(40);
    }
    assert.equal(welt.aktivierungen.length, 6, `${halt}: ein bezahlter Lauf`);
    assert.equal(welt.content.filter((z) => z.metadata?.medium_id === EXPORT_ID).length, 1, `${halt}: eine Caption zum Video`);
  }
  // Positivliste: nur Endzustände sind ein bekannter Ausgang.
  const { ladeTextErzeugen, ladeStudioBausteine, hookLaufzeit } = await import("./harness/studio.mjs");
  const lz = hookLaufzeit();
  const T = ladeTextErzeugen(lz.attrappen, { hilfen: ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counselModul, "@/lib/freigabe-regeln": regeln }).hilfen });
  assert.deepEqual([...T.LAUF_VORBEI].sort(), ["abgelehnt", "fehler", "freigegeben", "gepostet", "zur_freigabe"]);
});

test("M-C21 „Text erzeugen“, Neu-Lesen im selben Tab während des Laufs (Prüfung f-knopf-pruefung-1): Solange die Karte auf die Antwort wartet, gleicht sie nicht ab, auch wenn die Caption schon fertig ist; nach verlorener Antwort nennt sie die Caption der letzten Lesung (counsel_geprueft) als nicht fertig; das nächste Neu-Lesen im Endzustand ergibt den bekannten Ausgang", async (t) => {
  const speicher = stelleSessionStorage(t);
  const schluessel = `gp-text-erzeugen:${SLUG}:${EXPORT_ID}`;
  exportMit(RITTERGUT);
  medien();
  agenten();
  // (a) Der Server ist fertig (zur_freigabe), die Antwort aber noch unterwegs: Neu-Lesen ändert die laufende Karte nicht.
  let auf;
  let serverFertig;
  const tor = new Promise((r) => (auf = r));
  const fertigDa = new Promise((r) => (serverFertig = r));
  const s = { gesendet: [], verloren: false, nachServer: async () => { serverFertig(); await tor; } };
  const k = await medienPanelLaufzeit(s);
  try {
    k.element("data-text-erzeugen-knopf").props.onClick();
    k.element("data-text-erzeugen-start").props.onClick();
    await binnen(fertigDa, 5_000, "Server fertig");
    const z = welt.content.find((x) => x.metadata?.lauf_id === s.gesendet[0].lauf_id);
    assert.equal(z.status, "zur_freigabe");
    await k.neuGelesen();
    assert.ok(k.element("data-text-erzeugen-laeuft"), "„Pipeline läuft …“ bleibt");
    assert.equal(k.element("data-text-erzeugen-bekannt"), null);
    assert.equal(k.element("data-text-erzeugen-laufend"), null);
    assert.equal(JSON.parse(speicher.m.get(schluessel)).art, "laeuft", "der Eintrag bleibt, bis die Antwort da ist");
  } finally {
    s.nachServer = null;
    auf();
    await k.lz.ruhe(40);
  }
  assert.equal(k.ausgang().props["data-text-erzeugen-ausgang"], "ergebnis");
  assert.equal(speicher.m.has(schluessel), false);
  assert.equal(welt.aktivierungen.length, 6);

  // (b) Tor vor PUBLISHER; Neu-Lesen während des Laufs (counsel_geprueft), dann bricht die Verbindung ab, der Server läuft weiter.
  let auf2;
  let angekommen;
  const tor2 = new Promise((r) => (auf2 = r));
  const da = new Promise((r) => (angekommen = r));
  welt.vorAntwort = async (a) => {
    if (a.art === "activate" && a.body?.agent_id === "publisher") {
      angekommen();
      await tor2;
    }
  };
  const s2 = { gesendet: [], verloren: false };
  const k2 = await medienPanelLaufzeit(s2);
  try {
    k2.element("data-text-erzeugen-knopf").props.onClick();
    k2.element("data-text-erzeugen-start").props.onClick();
    await binnen(da, 5_000, "Tor vor publisher");
    await k2.neuGelesen();
    assert.ok(k2.element("data-text-erzeugen-laeuft"));
    s2.verloren = true;
  } finally {
    welt.vorAntwort = null;
    auf2();
    await k2.lz.ruhe(40);
  }
  const id2 = s2.gesendet[0].lauf_id;
  const z2 = welt.content.find((x) => x.metadata?.lauf_id === id2);
  assert.equal(z2.status, "zur_freigabe", "der Server lief weiter");
  assert.equal(k2.ausgang().props["data-text-erzeugen-ausgang"], "unbekannt");
  assert.equal(k2.text(k2.element("data-text-erzeugen-laufend")), `Caption #${z2.id} (Status counsel_geprueft) gehört zu diesem Lauf und ist noch nicht fertig.`, "Stand der letzten Lesung");
  assert.equal(k2.element("data-text-erzeugen-bekannt"), null);
  assert.equal(JSON.parse(speicher.m.get(schluessel)).art, "unbekannt");
  assert.equal(k2.text(k2.element("data-text-erzeugen-knopf")), "Erneut senden …");
  // Nächstes Neu-Lesen: Die Caption steht im Endzustand → bekannter Ausgang, neue ID beim nächsten Lauf.
  await k2.neuGelesen();
  assert.equal(k2.ausgang(), null);
  assert.equal(k2.element("data-text-erzeugen-laufend"), null);
  assert.ok(k2.text(k2.element("data-text-erzeugen-bekannt")).startsWith(`Caption #${z2.id} (Status zur_freigabe) zu diesem Lauf`));
  assert.equal(speicher.m.has(schluessel), false);
  assert.equal(k2.text(k2.element("data-text-erzeugen-knopf")), "Text erzeugen …");
  assert.equal(welt.aktivierungen.length, 12, "zwei Läufe, je 6 Stufen — keiner doppelt");
});

/** Lauf mit verlorener Antwort über das Medien-Panel; liefert Karte, Lauf-ID und Zeile (der Server lief durch). */
async function verlorenerLauf() {
  const k = await medienPanelLaufzeit();
  k.s.verloren = true;
  await k.lauf();
  k.s.verloren = false;
  assert.equal(k.ausgang().props["data-text-erzeugen-ausgang"], "unbekannt");
  const id = k.s.gesendet[0].lauf_id;
  return { k, id, zeile: welt.content.find((z) => z.metadata?.lauf_id === id) };
}

test("M-C23 „Text erzeugen“ nach 409 mit laufender Zeile (Delta-Prüfung f2-endzustand-1, PROBE-K3): Neuladen während PUBLISHER, „Erneut senden …“ → 409 mit counsel_geprueft → die Lauf-ID bleibt, auch nach Neu-Lesen; „Lauf-ID verwerfen …“ gibt sie erst nach Bestätigung frei; Abbrechen lässt sie stehen; ohne Verwerfen bleibt es bei einem bezahlten Lauf", async (t) => {
  const speicher = stelleSessionStorage(t);
  const schluessel = `gp-text-erzeugen:${SLUG}:${EXPORT_ID}`;
  exportMit(RITTERGUT);
  medien();
  agenten();
  let auf;
  let angekommen;
  const tor = new Promise((r) => (auf = r));
  const da = new Promise((r) => (angekommen = r));
  welt.vorAntwort = async (a) => {
    if (a.art === "activate" && a.body?.agent_id === "publisher") {
      angekommen();
      await tor;
    }
  };
  const eins = await medienPanelLaufzeit();
  try {
    eins.element("data-text-erzeugen-knopf").props.onClick();
    eins.element("data-text-erzeugen-start").props.onClick();
    await binnen(da, 5_000, "Tor vor publisher");
    const id = eins.s.gesendet[0].lauf_id;
    const zeileDesLaufs = welt.content.find((z) => z.metadata?.lauf_id === id);
    // 1. Neuladen während PUBLISHER: nicht fertig, „Erneut senden …“.
    const zwei = await medienPanelLaufzeit();
    assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …");
    // 2. Erneut senden → 409 mit counsel_geprueft.
    zwei.element("data-text-erzeugen-knopf").props.onClick();
    zwei.element("data-text-erzeugen-start").props.onClick();
    await zwei.lz.ruhe(40);
    assert.equal(zwei.ausgang().props["data-text-erzeugen-ausgang"], "existiert");
    assert.match(zwei.text(zwei.ausgang()), /Status counsel_geprueft/);
    // 3. Die ID bleibt: Eintrag, Hinweis „noch nicht fertig“, „Erneut senden …“ — auch nach fertig() und Neu-Lesen.
    for (const schritt of ["nach dem 409", "nach dem Neu-Lesen"]) {
      if (schritt === "nach dem Neu-Lesen") await zwei.neuGelesen();
      assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, id, `${schritt}: Eintrag bleibt`);
      assert.equal(zwei.text(zwei.element("data-text-erzeugen-laufend")), `Caption #${zeileDesLaufs.id} (Status counsel_geprueft) gehört zu diesem Lauf und ist noch nicht fertig.`, schritt);
      assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …", schritt);
      assert.equal(zwei.text(zwei.element("data-text-erzeugen-verwerfen")), "Lauf-ID verwerfen …", schritt);
    }
    // 4. Verwerfen erst nach Bestätigung; Abbrechen lässt alles stehen.
    zwei.element("data-text-erzeugen-verwerfen").props.onClick();
    const frage = zwei.text(zwei.element("data-text-erzeugen-verwerfen-bestaetigung"));
    assert.ok(frage.startsWith(`Lauf-ID ${id.slice(0, 8)}… verwerfen? Caption #${zeileDesLaufs.id} steht noch auf „counsel_geprueft“. Läuft`), frage);
    assert.ok(frage.includes("startet „Text erzeugen …“ danach einen zweiten bezahlten Lauf"), frage);
    assert.equal(zwei.element("data-text-erzeugen-knopf"), null, "während der Frage kein Start");
    zwei.element("data-text-erzeugen-verwerfen-zurueck").props.onClick();
    assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, id, "Abbrechen: Eintrag bleibt");
    assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …");
    zwei.element("data-text-erzeugen-verwerfen").props.onClick();
    zwei.element("data-text-erzeugen-verwerfen-ja").props.onClick();
    assert.equal(speicher.m.has(schluessel), false, "verworfen: Eintrag weg");
    assert.equal(zwei.element("data-text-erzeugen-laufend"), null);
    assert.equal(zwei.element("data-text-erzeugen-verwerfen"), null);
    assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Text erzeugen …");
    zwei.element("data-text-erzeugen-knopf").props.onClick();
    assert.match(zwei.text(zwei.element("data-text-erzeugen-bestaetigung")), / · Lauf-ID [0-9a-f]{8}… \(neu\)Ja, bezahlten Lauf starten/);
    assert.equal(zwei.s.gesendet.length, 1, "die Bestätigung sendet nichts");
  } finally {
    welt.vorAntwort = null;
    auf();
    await eins.lz.ruhe(40);
  }
  assert.equal(welt.aktivierungen.length, 6, "ein bezahlter Lauf");
  assert.equal(welt.content.filter((z) => z.metadata?.medium_id === EXPORT_ID).length, 1);
});

test("M-C24 „Text erzeugen“, Positivliste im Verhalten (Delta-Prüfung f2-endzustand-2): Ein unbekannter Status lässt den Eintrag stehen (nicht fertig, „Erneut senden …“ → 409, ID bleibt); fehler (echter Abbruch in AMPLIFIER), freigegeben und gepostet geben ihn frei — ein Klick, neue Lauf-ID, ein POST, kein 409", async (t) => {
  const speicher = stelleSessionStorage(t);
  const schluessel = `gp-text-erzeugen:${SLUG}:${EXPORT_ID}`;
  // (a) Unbekannter Status, direkt gesetzt.
  exportMit(RITTERGUT);
  medien();
  agenten();
  const a = await verlorenerLauf();
  a.zeile.status = "archiviert";
  const a2 = await medienPanelLaufzeit();
  assert.equal(a2.element("data-text-erzeugen-bekannt"), null);
  assert.equal(a2.text(a2.element("data-text-erzeugen-laufend")), `Caption #${a.zeile.id} (Status archiviert) gehört zu diesem Lauf und ist noch nicht fertig.`);
  assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, a.id);
  assert.equal(a2.text(a2.element("data-text-erzeugen-knopf")), "Erneut senden …");
  a2.element("data-text-erzeugen-knopf").props.onClick();
  a2.element("data-text-erzeugen-start").props.onClick();
  await a2.lz.ruhe(40);
  assert.equal(a2.s.gesendet[0].lauf_id, a.id);
  assert.equal(a2.ausgang().props["data-text-erzeugen-ausgang"], "existiert");
  assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, a.id, "409 mit unbekanntem Status: ID bleibt");
  assert.equal(welt.aktivierungen.length, 6);

  // (b) Endzustände: fehler (AMPLIFIER scheitert, der Lauf bricht ab), freigegeben, gepostet.
  for (const fall of ["fehler", "freigegeben", "gepostet"]) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    exportMit(RITTERGUT);
    medien();
    agenten();
    speicher.m.clear();
    if (fall === "fehler") welt.agentAntworten.amplifier = [{ status: 502, body: { fehler: "Claude-API-Fehler: HTTP 529" } }];
    const b = await verlorenerLauf();
    if (fall === "fehler") assert.equal(b.zeile.status, "fehler", "echter Abbruch");
    else b.zeile.status = fall;
    assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, b.id);
    const vorher = welt.aktivierungen.length;
    const b2 = await medienPanelLaufzeit();
    assert.equal(b2.element("data-text-erzeugen-laufend"), null, fall);
    assert.ok(b2.text(b2.element("data-text-erzeugen-bekannt")).startsWith(`Caption #${b.zeile.id} (Status ${fall}) zu diesem Lauf`), fall);
    assert.equal(speicher.m.has(schluessel), false, `${fall}: Eintrag weg`);
    assert.equal(b2.text(b2.element("data-text-erzeugen-knopf")), "Text erzeugen …", fall);
    // Ein Klick: Bestätigung mit neuer ID, ein POST, Ergebnis statt 409.
    b2.element("data-text-erzeugen-knopf").props.onClick();
    assert.match(b2.text(b2.element("data-text-erzeugen-bestaetigung")), / · Lauf-ID [0-9a-f]{8}… \(neu\)Ja, bezahlten Lauf starten/, fall);
    b2.element("data-text-erzeugen-start").props.onClick();
    await b2.lz.ruhe(40);
    assert.equal(b2.s.gesendet.length, 1, `${fall}: ein POST`);
    assert.notEqual(b2.s.gesendet[0].lauf_id, b.id, `${fall}: neue Lauf-ID`);
    assert.equal(b2.ausgang().props["data-text-erzeugen-ausgang"], "ergebnis", `${fall}: kein 409`);
    assert.equal(welt.aktivierungen.length, vorher + 6, `${fall}: genau ein neuer Lauf`);
  }
});

test("M-C25 „Text erzeugen“ nach 409, ohne geladene Caption (Delta-Prüfung f2-endzustand-1): Ist die Asset-Lesung des Studios gestört, nennt die Karte die Zeile laut 409 als nicht fertig, behält die Lauf-ID und bietet „Lauf-ID verwerfen …“", async (t) => {
  const speicher = stelleSessionStorage(t);
  const schluessel = `gp-text-erzeugen:${SLUG}:${EXPORT_ID}`;
  exportMit(RITTERGUT);
  medien();
  agenten();
  const { id, zeile: zeileDesLaufs } = await verlorenerLauf();
  zeileDesLaufs.status = "counsel_geprueft";
  // Neuladen mit gestörter Asset-Lesung (nur die Abfrage nach dem Objekt, nicht die Lauf-ID-Prüfung der Pipeline).
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "content" && a.methode === "GET" && a.params.has("metadata->>objekt_slug") ? { status: 500, body: { message: "Lesen fehlgeschlagen (Test)" } } : null);
  let zwei;
  try {
    zwei = await medienPanelLaufzeit();
  } finally {
    welt.stoerung = null;
  }
  assert.equal(zwei.element("data-text-erzeugen-laufend"), null, "ohne Assets keine Zeile aus der Lesung");
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …");
  zwei.element("data-text-erzeugen-knopf").props.onClick();
  zwei.element("data-text-erzeugen-start").props.onClick();
  await zwei.lz.ruhe(40);
  assert.equal(zwei.ausgang().props["data-text-erzeugen-ausgang"], "existiert");
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-laufend")), `Caption #${zeileDesLaufs.id} (Status counsel_geprueft) gehört zu diesem Lauf und ist noch nicht fertig.`, "Zeile laut 409");
  assert.equal(JSON.parse(speicher.m.get(schluessel)).laufId, id);
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-knopf")), "Erneut senden …");
  assert.equal(zwei.text(zwei.element("data-text-erzeugen-verwerfen")), "Lauf-ID verwerfen …");
  assert.equal(welt.aktivierungen.length, 6);
});
