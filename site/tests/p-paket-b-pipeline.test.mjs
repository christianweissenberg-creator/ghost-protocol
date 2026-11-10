// Objekt-Studio Stufe 2, Paket B — Schritte 4 und 5 (10.11.2026). Lauf: npm test.
//
// Prüft die Pipeline-Korrekturen (Schritt 4) und R2 (Schritt 5) ohne Netz und ohne bezahlte Aufrufe:
// - lib/steinadel-kurzlink.ts: Abbildung wie die Steinadel-Weiterleitung (SR/apps/web/src/lib/
//   kampagnen/kurzlink.ts:10-18, 39-48; Testfälle wie SR/apps/web/src/lib/kampagnen/kurzlink.test.ts),
//   Bau des CTA-Kurzlinks, Prüfung im Text.
// - lib/freigabe-regeln.ts: geprüfter Text (geprueftenTextAusSchritten) und R2 in pruefeFreigabe.
// - api/content/pipeline (echter Handler, Attrappen aus tests/harness/fake.mjs): "Ersterwähnung" im
//   Prompt und im Beleg, Kurzlink als CTA mit aufgelöster Ziel-URL für COUNSEL, LinkedIn, zweiter
//   COUNSEL-Lauf auf der Endfassung mit Kosten, Abbrüche vor jedem unnötigen bezahlten Aufruf.
// - api/freigaben und api/content/status: neue Zeilen ohne geprueft_ungleich_freigabe, R2-Sperre.
// - Beleg-Kette (components/studio) und Fassungsbezug auf /content für Läufe mit Endprüfung.
// Die Umgebungswerte unten sind Testwerte dieses Prozesses, keine echten Schlüssel.
// Z_ROUTE_<NAME>=<pfad> und Z_TSX_<NAME>=<pfad> prüfen Kopien statt der Repo-Dateien (Mutationstests).
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
});

const fake = await import("./harness/fake.mjs");
const { welt, legeAn, zeile, zuruecksetzen, agentOk, STANDARD_OBJEKT } = fake;
fake.installiere();
const { React, jsxRuntime, renderToStaticMarkup, ladeTsx } = await import("./harness/tsx.mjs");
const { ladeStudioBausteine } = await import("./harness/studio.mjs");

const lib = (name) => import(pathToFileURL(process.env[`Z_LIB_${name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`] ?? path.join(SITE, "src", `${name}.ts`)).href);
const route = (name, rel) => import(pathToFileURL(process.env[`Z_ROUTE_${name}`] ?? path.join(SITE, "src/app/api", rel)).href);
const [kurz, regeln, counselModul, pipeline, freigabenRoute, statusRoute, { NextRequest }] = await Promise.all([
  lib("lib/steinadel-kurzlink"),
  lib("lib/freigabe-regeln"),
  lib("lib/counsel-urteil"),
  route("PIPELINE", "content/pipeline/route.ts"),
  route("FREIGABEN", "freigaben/route.ts"),
  route("STATUS", "content/status/route.ts"),
  import("next/server"),
]);

const NAME = ["Immo", "Nexus"].join("");
const NAME_RE = /imm[ou][\s._-]*nexus/i;
const KOSTEN = 0.0007; // usage.cost_usd der Attrappe agentOk
const KOSTEN_END = 0.0123; // eigene Kosten der Endprüfung, damit sie im Beleg unterscheidbar sind
const FREIGABE = "Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG";
const ABLEHNUNG = "Befund: Disclaimer fehlt in der Endfassung.\nURTEIL: ABLEHNUNG";
const R2_ANDERS = "Freigabetext nicht wörtlich geprüft: COUNSEL prüfte eine andere Fassung (R2)";
const R2_UNBEKANNT = "Freigabetext nicht wörtlich geprüft: geprüfter Text nicht gespeichert oder nicht dem COUNSEL-Urteil zuzuordnen (R2)";

// Export-Objekt in der Form des Steinadel-Exports (SR/apps/web/src/lib/objekte/export.ts:107-111):
// lpUrl = <Basis>/l/<kampagne>. Werte außer Slug, Jahr und Kampagnen sind Testwerte.
const RITTERGUT = {
  slug: "rittergut-seifersdorf",
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
  kampagnen: [
    { kampagne: "afa-rechner-p1", lpUrl: "https://steinadel.de/l/afa-rechner-p1", lpVariant: "afa-rechner-p1-a" },
    { kampagne: "denkmal-invest-p3", lpUrl: "https://steinadel.de/l/denkmal-invest-p3", lpVariant: "denkmal-invest-p3-a" },
  ],
};

function exportMit(objekt) {
  welt.objekteAntwort = { status: 200, body: { version: "1", quelle: "export", generiert_am: "2026-11-10T08:00:00Z", objekte: [objekt] } };
}

/** CTA-Link aus dem Auftrag (Abschnitt CTA-LINK); null, wenn keiner darin steht. */
function linkAusAuftrag(task) {
  return /CTA-LINK \(Pflicht, Zeichen für Zeichen übernehmen\): (\S+)/.exec(task)?.[1] ?? null;
}

/**
 * Agenten mit Texten, die den CTA-Link aus dem Auftrag wörtlich übernehmen (Pflichtzeilen dabei).
 * counsel: Antwort der Vorprüfung; endpruefung: Antwort der Endprüfung (beide rufen COUNSEL auf).
 */
function agentenMitLink({ scribe, publisher, counsel = FREIGABE, endpruefung = FREIGABE, endKosten = KOSTEN_END } = {}) {
  welt.agentAntworten.scribe = (task) =>
    agentOk("scribe", scribe ? scribe(task) : `Thread 1/2 Denkmal-AfA bis 100 %. Modellrechnung. Visualisierung: KI-generiert. Impressum: steinadel.de/impressum\n2/2 Mehr: ${linkAusAuftrag(task)}`);
  welt.agentAntworten.publisher = (task) =>
    agentOk("publisher", publisher ? publisher(task) : `Finaler Content:\n1/2 Denkmal-AfA bis 100 %.\n2/2 Mehr: ${linkAusAuftrag(task)}\nCross-Promotion: ${linkAusAuftrag(task)}`);
  welt.agentAntworten.counsel = (task) =>
    task.startsWith("ENDPRUEFUNG (R2)")
      ? agentOk("counsel", endpruefung, { usage: { input_tokens: 900, output_tokens: 200, cost_usd: endKosten, latency_ms: 3 } })
      : agentOk("counsel", counsel);
}

const auftrag = (agent, nr = 0) => welt.aktivierungen.filter((a) => a.agent === agent)[nr]?.task ?? "";

beforeEach(() => {
  zuruecksetzen();
  welt.pipelineModul = pipeline;
});

async function post(modul, pfad, body) {
  const req = new NextRequest(`http://harness.local${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "gp-auth=test" },
    body: JSON.stringify(body),
  });
  const res = await modul.POST(req);
  return { status: res.status, body: await res.json() };
}
const pipePost = (body) => post(pipeline, "/api/content/pipeline", body);
const RITTERGUT_X = { objekt_slug: "rittergut-seifersdorf", platform: "x", format: "thread", category: "ki_automation" };

// ═══ lib/steinadel-kurzlink.ts — Abbildung wie Steinadel ═══

test("P-K1 Auflösung wie die Steinadel-Weiterleitung: Präfix → utm_source/utm_medium, Ziel /l/<kampagne>, Parameterfolge", () => {
  // Fälle wie SR/apps/web/src/lib/kampagnen/kurzlink.test.ts:5-27
  assert.deepEqual(kurz.zielWieSteinadel("denkmal-invest-p3", "x-rittergut-1"), {
    url: "https://steinadel.de/l/denkmal-invest-p3?utm_source=x&utm_medium=social&utm_campaign=denkmal-invest-p3&utm_content=x-rittergut-1",
    lp_pfad: "/l/denkmal-invest-p3",
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: "denkmal-invest-p3",
    utm_content: "x-rittergut-1",
  });
  const quelle = (c) => kurz.zielWieSteinadel("k", c);
  assert.equal(quelle("li-post-1").utm_source, "linkedin");
  assert.equal(quelle("ig-reel-2").utm_source, "instagram");
  assert.equal(quelle("fb-1").utm_source, "facebook");
  assert.equal(quelle("tt-1").utm_source, "tiktok");
  assert.equal(quelle("yt-1").utm_source, "youtube");
  assert.deepEqual([quelle("nl-ausgabe-3").utm_source, quelle("nl-ausgabe-3").utm_medium], ["newsletter", "newsletter"]);
  assert.deepEqual([quelle("unbekannt-4").utm_source, quelle("unbekannt-4").utm_medium], ["social", "social"]);
  for (const c of ["x-1", "li-1", "ig-1", "tt-1", "yt-1", "fb-1"]) assert.equal(quelle(c).utm_medium, "social", c);
  // Ungültig wie bei Steinadel (kurzlink.test.ts:36-42) und 80-Zeichen-Grenze (validation.ts:34)
  for (const [k, c] of [["../admin", "x-1"], ["kampagne", "a/b"], ["", "x-1"], ["kampagne", ""], ["kampagne", "ä-umlaut"], ["k", "x".repeat(81)], ["K", "x-1"]]) {
    assert.equal(kurz.zielWieSteinadel(k, c), null, `${k} / ${c}`);
  }
  assert.ok(kurz.zielWieSteinadel("k", `x-${"a".repeat(78)}`), "genau 80 Zeichen gültig");
  assert.ok(kurz.istUtmWert("a_b-1") && !kurz.istUtmWert("a b") && !kurz.istUtmWert(""));
});

test("P-K2 Präfix je Plattform (E12: twitter → x) und für jede Plattform der Pipeline", async () => {
  assert.deepEqual(
    { ...kurz.KURZLINK_PRAEFIX },
    { x: "x", twitter: "x", linkedin: "li", instagram: "ig", tiktok: "tt", youtube: "yt", newsletter: "nl" },
  );
  const { platforms } = await (await pipeline.GET()).json();
  for (const p of platforms) assert.ok(Object.prototype.hasOwnProperty.call(kurz.KURZLINK_PRAEFIX, p), p);
});

test("P-K3 baueKurzlink: RitterGut-Form, Gegenprobe mit der lpUrl des Exports, fail-closed bei jeder Abweichung", () => {
  const ok = kurz.baueKurzlink({ plattform: "twitter", kampagne: "afa-rechner-p1", lpUrl: "https://steinadel.de/l/afa-rechner-p1", slug: "rittergut-seifersdorf", id: 123 });
  assert.equal(ok.ok, true);
  assert.equal(ok.pruefung.link, "https://steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-123");
  assert.equal(ok.pruefung.content, "x-rittergut-seifersdorf-123");
  assert.equal(ok.pruefung.ziel.url, "https://steinadel.de/l/afa-rechner-p1?utm_source=x&utm_medium=social&utm_campaign=afa-rechner-p1&utm_content=x-rittergut-seifersdorf-123");
  const li = kurz.baueKurzlink({ plattform: "linkedin", kampagne: " AfA-Rechner-P1 ", lpUrl: "https://steinadel.de/l/afa-rechner-p1", slug: "Rittergut-Seifersdorf", id: 7 });
  assert.equal(li.pruefung.link, "https://steinadel.de/k/afa-rechner-p1/li-rittergut-seifersdorf-7", "klein geschrieben wie bei Steinadel");
  assert.equal(li.pruefung.ziel.utm_source, "linkedin");
  const nl = kurz.baueKurzlink({ plattform: "newsletter", kampagne: "afa-rechner-p1", lpUrl: "https://steinadel.de/l/afa-rechner-p1", slug: "rittergut-seifersdorf", id: 7 });
  assert.equal(nl.pruefung.ziel.utm_medium, "newsletter");
  const basis = { plattform: "x", kampagne: "afa-rechner-p1", lpUrl: "https://steinadel.de/l/afa-rechner-p1", slug: "rittergut-seifersdorf", id: 9 };
  for (const [name, aenderung, grund] of [
    ["andere Basis", { lpUrl: "https://www.steinadel.de/l/afa-rechner-p1" }, /Landingpage laut Export ist nicht das Kurzlink-Ziel/],
    ["anderer Pfad", { lpUrl: "https://steinadel.de/l/afa-rechner-p2" }, /nicht das Kurzlink-Ziel/],
    ["lpUrl mit Query", { lpUrl: "https://steinadel.de/l/afa-rechner-p1?v=a" }, /nicht das Kurzlink-Ziel/],
    ["lpUrl mit Anker", { lpUrl: "https://steinadel.de/l/afa-rechner-p1#cta" }, /nicht das Kurzlink-Ziel/],
    ["lpUrl keine URL", { lpUrl: "steinadel.de/l/afa-rechner-p1" }, /keine URL/],
    ["unbekannte Plattform", { plattform: "facebook" }, /ohne Kurzlink-Präfix/],
    ["geerbte Eigenschaft", { plattform: "toString" }, /ohne Kurzlink-Präfix/],
    ["Slug mit Umlaut", { slug: "rittergut-käthe" }, /Content nicht/],
    ["Slug mit Schrägstrich", { slug: "a/b" }, /Pfad nicht/],
    ["zu lang", { slug: "s".repeat(80) }, /Content nicht/],
    ["Kampagne leer", { kampagne: "  " }, /Pfad nicht|Kampagne nicht/],
    ["Nummer 0", { id: 0 }, /Eintragsnummer/],
    ["Nummer gebrochen", { id: 1.5 }, /Eintragsnummer/],
  ]) {
    const r = kurz.baueKurzlink({ ...basis, ...aenderung });
    assert.equal(r.ok, false, name);
    assert.match(r.grund, grund, name);
  }
});

test("P-K4 pruefeKurzlink: nur https://steinadel.de/k/<kampagne>/<content>, klein, Präfix mit Regelpaket-Quelle", () => {
  const gut = kurz.pruefeKurzlink("https://steinadel.de/k/afa-rechner-p1/ig-rittergut-seifersdorf-5");
  assert.equal(gut.ok, true);
  assert.equal(gut.praefix, "ig");
  assert.equal(gut.ziel.utm_source, "instagram");
  for (const [link, grund] of [
    ["http://steinadel.de/k/a/x-1", /nicht https:\/\/steinadel\.de/],
    ["https://www.steinadel.de/k/a/x-1", /nicht https:\/\/steinadel\.de/],
    ["https://steinadel.de:8443/k/a/x-1", /nicht https:\/\/steinadel\.de/],
    ["https://u:p@steinadel.de/k/a/x-1", /nicht https:\/\/steinadel\.de/],
    ["https://steinadel.de/k/a/x-1?utm_source=x", /Query oder Anker/],
    ["https://steinadel.de/k/a/x-1#x", /Query oder Anker/],
    ["https://steinadel.de/k/a/x-1/", /Pfad nicht/],
    ["https://steinadel.de/l/a", /Pfad nicht/],
    ["https://steinadel.de/k/A/x-1", /Kampagne nicht/],
    ["https://steinadel.de/k/a/X-1", /Content nicht/],
    ["https://steinadel.de/k/a/social-1", /ohne Quelle/],
    ["kein link", /keine gültige URL/],
  ]) {
    const r = kurz.pruefeKurzlink(link);
    assert.equal(r.ok, false, link);
    assert.match(r.grund, grund, link);
  }
});

test("P-K5 pruefeKurzlinksImText: CTA unverändert da, Varianten desselben Laufs zulässig, jede andere /k/- und jede /l/-Adresse ist ein Befund", () => {
  const link = "https://steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12";
  const erwartet = { link, kampagne: "afa-rechner-p1", slug: "rittergut-seifersdorf", id: 12 };
  const pruef = (t) => kurz.pruefeKurzlinksImText(t, erwartet);
  for (const t of [
    `Mehr: ${link}`,
    `Mehr: ${link}.`,
    `**${link}**`,
    `[Exposé](${link})`,
    `(${link}), danach`,
    `Mehr: steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12 …`,
    `Mehr: https://Steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12!`,
    `${link}\nImpressum: steinadel.de/impressum, Kontakt info@steinadel.de, Start https://steinadel.de`,
  ]) {
    const p = pruef(t);
    assert.equal(p.ok, true, `${t} → ${p.befunde.join("; ")}`);
    assert.equal(p.cta_treffer, 1, t);
    assert.deepEqual(p.kurzlinks.map((k) => [k.link, k.cta]), [[link, true]], t);
  }
  const zwei = pruef(`${link}\nTeaser: https://steinadel.de/k/afa-rechner-p1/nl-rittergut-seifersdorf-12 und nochmal ${link}`);
  assert.equal(zwei.ok, true);
  assert.equal(zwei.cta_treffer, 2);
  assert.deepEqual(zwei.kurzlinks.map((k) => [k.link, k.cta, k.ziel.utm_source, k.ziel.utm_medium]), [
    [link, true, "x", "social"],
    ["https://steinadel.de/k/afa-rechner-p1/nl-rittergut-seifersdorf-12", false, "newsletter", "newsletter"],
  ]);
  for (const [t, befund] of [
    ["kein Link", /^CTA-Link fehlt im Text: https:\/\/steinadel\.de\/k\/afa-rechner-p1\/x-rittergut-seifersdorf-12$/],
    [`${link} und https://steinadel.de/l/afa-rechner-p1?utm_source=x`, /^Direktlink auf eine Kampagnenseite statt Kurzlink: https:\/\/steinadel\.de\/l\/afa-rechner-p1\?utm_source=x$/],
    [`${link} https://steinadel.de/L/afa-rechner-p1`, /^Direktlink/],
    [`${link} https://steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-13`, /^Kurzlink gehört nicht zu diesem Lauf/],
    [`${link} https://steinadel.de/k/denkmal-invest-p3/x-rittergut-seifersdorf-12`, /^Kurzlink gehört nicht zu diesem Lauf/],
    [`${link} https://steinadel.de/k/afa-rechner-p1/x-andere-villa-12`, /^Kurzlink gehört nicht zu diesem Lauf/],
    [`${link} http://steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12`, /^Kurzlink ohne https/],
    [`${link} https://www.steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12`, /^ungültiger Kurzlink \(nicht https/],
    [`${link} ${link}/`, /^ungültiger Kurzlink \(Pfad nicht/],
    [`${link} https://steinadel.de/K/afa-rechner-p1/x-rittergut-seifersdorf-12`, /^ungültiger Kurzlink \(Pfad nicht/],
    [`${link} https://steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12?utm_source=x`, /^ungültiger Kurzlink \(Kurzlink mit Query/],
  ]) {
    const p = pruef(t);
    assert.equal(p.ok, false, t);
    assert.ok(p.befunde.some((b) => befund.test(b)), `${t} → ${p.befunde.join("; ")}`);
  }
  // Fremde Domain, die nur auf steinadel.de endet, und eingebettete Adressen zählen nicht als CTA.
  for (const t of [
    "https://evilsteinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12",
    "https://evil.example/steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12",
    "https://evil.example/?r=steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-12",
    "https://steinadel.dev/k/afa-rechner-p1/x-rittergut-seifersdorf-12",
  ]) {
    const p = pruef(t);
    assert.equal(p.cta_treffer, 0, t);
    assert.equal(p.ok, false, t);
  }
  const langerBefund = pruef(`${link} https://steinadel.de/k/afa-rechner-p1/x-${"a".repeat(200)}`);
  assert.ok(langerBefund.befunde.every((b) => b.length < 200), "Befunde gekürzt");
});

// ═══ lib/freigabe-regeln.ts — R2 ═══

const SCHRITTE_ALT = (scribe, publisher) => [
  { agent: "researcher", status: "done", output: "r" },
  { agent: "scribe", status: "done", output: scribe },
  { agent: "counsel", status: "done", output: FREIGABE },
  { agent: "publisher", status: "done", output: publisher },
  { agent: "amplifier", status: "done", output: "a" },
];
const SCHRITTE_NEU = (publisher, end = FREIGABE, endStatus = "done") => [
  { agent: "researcher", status: "done", output: "r" },
  { agent: "scribe", status: "done", output: "SCRIBE-Vorfassung" },
  { agent: "counsel", status: "done", output: FREIGABE },
  { agent: "publisher", status: "done", output: publisher },
  { agent: "counsel_endfassung", status: endStatus, output: end },
  { agent: "amplifier", status: "done", output: "a" },
];

test("P-R1 geprueftenTextAusSchritten: mit Endprüfung die PUBLISHER-Fassung (nur bei passendem review_notes), sonst der SCRIBE-Text", () => {
  const g = regeln.geprueftenTextAusSchritten;
  assert.equal(regeln.STUFE_ENDPRUEFUNG, "counsel_endfassung");
  assert.equal(g(SCHRITTE_NEU("Endfassung"), FREIGABE), "Endfassung");
  assert.equal(g(SCHRITTE_NEU("Endfassung"), "anderes Review\nURTEIL: FREIGABE"), null, "Review gehört nicht zur Endprüfung");
  assert.equal(g(SCHRITTE_NEU("Endfassung"), null), null);
  assert.equal(g(SCHRITTE_NEU("Endfassung"), undefined), null);
  assert.equal(g(SCHRITTE_NEU("Endfassung", FREIGABE, "error"), FREIGABE), null, "Endprüfung nicht fertig");
  assert.equal(g(SCHRITTE_NEU("Endfassung", FREIGABE, "running"), FREIGABE), null);
  assert.equal(g(SCHRITTE_NEU("Endfassung").filter((s) => s.agent !== "publisher"), FREIGABE), null, "ohne PUBLISHER");
  assert.equal(g(SCHRITTE_NEU("Endfassung").map((s) => (s.agent === "publisher" ? { ...s, output: 7 } : s)), FREIGABE), null);
  const ohneAusgabe = SCHRITTE_NEU("Endfassung").map((s) => (s.agent === "counsel_endfassung" ? { agent: s.agent, status: "done" } : s));
  assert.equal(g(ohneAusgabe, FREIGABE), null, "Endprüfung ohne Ausgabe");
  assert.equal(g([...SCHRITTE_ALT("SCRIBE", "PUB").slice(0, 4), "kaputt", { agent: "counsel_endfassung", status: "done", output: FREIGABE }], FREIGABE), "PUB", "unlesbare Stufen werden übersprungen");
  // Läufe vor Paket B
  assert.equal(g(SCHRITTE_ALT("SCRIBE", "PUB"), FREIGABE), "SCRIBE");
  assert.equal(g(SCHRITTE_ALT("SCRIBE", "PUB"), "egal"), "SCRIBE", "Altlauf ohne Bindung an review_notes (wie bisher)");
  assert.equal(g(SCHRITTE_ALT("", "PUB"), FREIGABE), "");
  assert.equal(g([{ agent: "researcher" }, { agent: "publisher", output: "x" }], FREIGABE), null, "steps[1] nicht SCRIBE");
  assert.equal(g([{ agent: "researcher" }, { agent: "SCRIBE", output: "x" }], FREIGABE), "x");
  assert.equal(g([{ agent: "researcher" }, { output: "x" }], FREIGABE), "x", "ohne Stufennamen wie bisher");
  assert.equal(g([{ agent: "researcher" }, "kaputt"], FREIGABE), null);
  assert.equal(g(undefined, FREIGABE), null);
  assert.equal(g({ 1: { output: "x" } }, FREIGABE), null);
});

test("P-R2 pruefeFreigabe mit geprüftem Text: gleich (getrimmt) frei, anders oder unbekannt gesperrt; ältere Gründe zuerst; ohne Argument wie bisher", () => {
  const frei = counselModul.werteCounselAus(FREIGABE);
  const p = regeln.pruefeFreigabe;
  const text = "Denkmal-Altbau, Modellrechnung, Visualisierung: KI-generiert.";
  assert.equal(p(frei, `  ${text}\n`, text).freigebbar, true);
  assert.equal(p(frei, text, `\n${text}  `).freigebbar, true);
  assert.deepEqual([p(frei, text, `${text} ergänzt`).freigebbar, p(frei, text, `${text} ergänzt`).grund], [false, R2_ANDERS]);
  assert.deepEqual([p(frei, text, null).freigebbar, p(frei, text, null).grund], [false, R2_UNBEKANNT]);
  assert.equal(p(frei, text).freigebbar, true, "ohne drittes Argument keine R2-Prüfung");
  assert.equal(p(frei, text, undefined).freigebbar, true);
  // Reihenfolge: Urteil, leer, zu kurz, Name vor R2
  assert.match(p(counselModul.werteCounselAus("URTEIL: ABLEHNUNG"), text, null).grund, /^COUNSEL-Urteil ABLEHNUNG/);
  assert.equal(p(frei, "  ", null).grund, "Freigabetext leer");
  assert.match(p(frei, "kurz", null).grund, /zu kurz/);
  assert.equal(p(frei, `${text} ${NAME}`, null).grund, "Freigabetext enthält einen geschützten Namen");
});

// ═══ api/content/pipeline — RitterGut-Lauf mit Kurzlink und Endprüfung ═══

test("P-P1 RitterGut (x): Ersterwähnung, Kurzlink-CTA, aufgelöste Ziel-URL für beide COUNSEL-Läufe, sechs Aufrufe, Kosten der Endprüfung im Beleg", async () => {
  exportMit(RITTERGUT);
  agentenMitLink();
  const r = await pipePost({ ...RITTERGUT_X, lauf_id: "lauf-p1-00000001" });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 500));
  assert.equal(r.body.status, "complete");
  const id = r.body.contentId;
  const link = `https://steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-${id}`;
  const ziel = `https://steinadel.de/l/afa-rechner-p1?utm_source=x&utm_medium=social&utm_campaign=afa-rechner-p1&utm_content=x-rittergut-seifersdorf-${id}`;

  // Sechs bezahlte Aufrufe, COUNSEL zweimal, AMPLIFIER zuletzt
  assert.deepEqual(welt.aktivierungen.map((a) => a.agent), ["researcher", "scribe", "counsel", "publisher", "counsel", "amplifier"]);
  assert.deepEqual(r.body.steps.map((s) => [s.agent, s.status]), [
    ["researcher", "done"], ["scribe", "done"], ["counsel", "done"], ["publisher", "done"], ["counsel_endfassung", "done"], ["amplifier", "done"],
  ]);

  // Schritt 4: Ersterwähnung statt Baujahr in jedem Auftrag mit Objektblock
  for (const [agent, nr] of [["researcher", 0], ["scribe", 0], ["counsel", 0], ["publisher", 0], ["counsel", 1]]) {
    const t = auftrag(agent, nr);
    assert.ok(t.includes("Ersterwähnung: 1335 (Exportfeld baujahr; das ist nicht das Baujahr — schreibe nie „Baujahr 1335“)"), `${agent} ${nr}`);
    assert.ok(!/^Baujahr: /m.test(t), `${agent} ${nr}: keine Baujahr-Zeile`);
  }
  // CTA: Kurzlink im SCRIBE- und PUBLISHER-Auftrag, kein Direktlink
  for (const agent of ["scribe", "publisher"]) {
    assert.equal(linkAusAuftrag(auftrag(agent)), link, agent);
    assert.ok(!auftrag(agent).includes("utm_source="), `${agent}: keine UTMs im Auftrag`);
  }
  assert.ok(auftrag("scribe").includes(`Letzter Tweet: CTA mit EXAKT diesem Link: ${link}`));
  assert.ok(auftrag("scribe").includes("Der CTA verweist auf den Kurzlink (Abschnitt CTA-LINK bzw. KURZLINK)"));
  assert.ok(auftrag("counsel", 1).includes("Der CTA verweist auf den Kurzlink (Abschnitt CTA-LINK bzw. KURZLINK)"));
  assert.ok(auftrag("publisher").includes("ENDFASSUNG (R2): Deine gesamte Antwort geht wörtlich an COUNSEL"));
  // Ersatzweg E12: COUNSEL bekommt die aufgelöste Ziel-URL mit UTMs, beide Male
  for (const nr of [0, 1]) {
    const t = auftrag("counsel", nr);
    assert.ok(t.includes(`- ${link} (CTA-Link, steht unverändert im Content)`), `COUNSEL ${nr}`);
    assert.ok(t.includes(`  leitet weiter auf ${ziel}`), `COUNSEL ${nr}`);
    assert.ok(t.includes("utm_source x, utm_medium social, utm_campaign afa-rechner-p1 (= Slug der Kampagnenseite)"), `COUNSEL ${nr}`);
  }
  // Endprüfung: genau die PUBLISHER-Fassung, wörtlich
  const pub = r.body.steps[3].output;
  assert.ok(auftrag("counsel", 1).startsWith("ENDPRUEFUNG (R2): Pruefe die folgende ENDFASSUNG WOERTLICH"));
  assert.ok(auftrag("counsel", 1).includes(`ENDFASSUNG (PUBLISHER):\n${pub}\n\nOBJEKTDATEN`));
  assert.ok(auftrag("counsel", 0).includes(`CONTENT:\n${r.body.steps[1].output}`));

  // Zeile: Freigabetext = PUBLISHER, review_notes = Endprüfung, Belege
  const z = zeile(id);
  assert.equal(z.status, "zur_freigabe");
  assert.equal(z.body, pub);
  assert.equal(z.review_notes, FREIGABE);
  assert.equal(z.metadata.steps[4].output, z.review_notes);
  assert.equal(z.metadata.cta_link, link);
  assert.equal(z.metadata.utm_content, `x-rittergut-seifersdorf-${id}`);
  assert.equal(z.metadata.kampagne, "afa-rechner-p1");
  assert.equal(z.metadata.kurzlink.link, link);
  assert.equal(z.metadata.kurzlink.ziel_url, ziel);
  assert.deepEqual([z.metadata.kurzlink.utm_source, z.metadata.kurzlink.utm_medium, z.metadata.kurzlink.utm_campaign], ["x", "social", "afa-rechner-p1"]);
  assert.equal(z.metadata.kurzlink.pruefung_scribe.ok, true);
  assert.equal(z.metadata.kurzlink.pruefung_endfassung.ok, true);
  assert.equal(z.metadata.kurzlink.pruefung_endfassung.cta_treffer, 2);
  assert.match(z.metadata.counsel.geprueft, /^PUBLISHER-Text \(steps\[3\]\), wörtlich/);
  assert.equal(z.metadata.counsel.urteil, "FREIGABE");
  assert.equal(z.metadata.counsel_vorpruefung.urteil, "FREIGABE");
  assert.match(z.metadata.counsel_vorpruefung.geprueft, /^SCRIBE-Text/);
  assert.deepEqual(z.metadata.freigabe_hinweis, {
    geprueft: "PUBLISHER-Text (steps[3]), wörtlich geprüft in der COUNSEL-Endprüfung (steps[4])",
    zur_freigabe: "PUBLISHER-Text (body)",
    identisch: true,
  });
  // Beleg Ersterwähnung: Snapshot mit Bezeichnung, Exportfeld unverändert
  assert.equal(z.metadata.objekt_snapshot.objekt.baujahr, 1335);
  assert.deepEqual(
    { ...z.metadata.objekt_snapshot.datierung, quelle: undefined, fundstelle: undefined },
    { feld: "baujahr", bezeichnung: "Ersterwähnung", wert: 1335, ausnahme_greift: true, ausnahme_jahr: 1335, quelle: undefined, fundstelle: undefined },
  );
  assert.match(z.metadata.objekt_snapshot.datierung.fundstelle, /^SR\/docs\/import\/extraktion-rohdaten\.json:552 .*dossier-content\.ts:51/);
  assert.match(z.metadata.objekt_snapshot.datierung.quelle, /Ersterwähnung, nicht das Baujahr/);
  // Kosten: die Endprüfung mit eigenem Wert, in Schritt und Summe
  assert.equal(r.body.steps[4].cost, KOSTEN_END);
  assert.equal(z.metadata.steps[4].cost, KOSTEN_END);
  assert.equal(r.body.summary.total_cost_usd, Math.round((5 * KOSTEN + KOSTEN_END) * 100000) / 100000);
  assert.equal(r.body.summary.kosten_unvollstaendig, false);
  assert.equal(r.body.summary.completed, "6/6");
  // Antwort: maßgebliches Urteil und Vorprüfung
  assert.equal(r.body.counsel.urteil, "FREIGABE");
  assert.match(r.body.counsel.geprueft, /^PUBLISHER-Text/);
  assert.match(r.body.counsel_vorpruefung.geprueft, /^SCRIBE-Text/);
  assert.equal(r.body.freigabe_hinweis.identisch, true);
  assert.deepEqual(r.body.warnungen, []);
});

test("P-P2 Plattform twitter → Präfix x; LinkedIn (R39): Format linkedin_post, Präfix li, Pflichtzeilen und LinkedIn-Anweisung", async () => {
  exportMit(RITTERGUT);
  agentenMitLink();
  const tw = await pipePost({ ...RITTERGUT_X, platform: "twitter" });
  assert.equal(tw.body.status, "complete", JSON.stringify(tw.body).slice(0, 300));
  assert.equal(zeile(tw.body.contentId).metadata.cta_link, `https://steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-${tw.body.contentId}`);

  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  agentenMitLink();
  const li = await pipePost({ objekt_slug: "rittergut-seifersdorf", platform: "linkedin", format: "linkedin_post", category: "ki_automation" });
  assert.equal(li.status, 200, JSON.stringify(li.body).slice(0, 300));
  assert.equal(li.body.status, "complete");
  const z = zeile(li.body.contentId);
  assert.equal(z.platform, "linkedin");
  assert.equal(z.content_type, "linkedin_post");
  const link = `https://steinadel.de/k/afa-rechner-p1/li-rittergut-seifersdorf-${li.body.contentId}`;
  assert.equal(z.metadata.cta_link, link);
  assert.equal(z.metadata.kurzlink.utm_source, "linkedin");
  assert.match(z.metadata.kurzlink.ziel_url, /\?utm_source=linkedin&utm_medium=social&utm_campaign=afa-rechner-p1&utm_content=li-rittergut-seifersdorf-\d+$/);
  const scribe = auftrag("scribe");
  assert.ok(scribe.startsWith('CONTENT-PRODUKTION: Schreibe Content zum Thema "RitterGut Seifersdorf".\n\nPLATTFORM: LinkedIn-Post (Fachton, keine Reel-Ästhetik)'));
  assert.ok(scribe.includes("Schreibe einen LinkedIn-Post (Fachbeitrag, 1.200-2.000 Zeichen) im Steinadel-Ton (Qualitätskanal: Fachton, premium, editorial, ruhig):"));
  assert.ok(scribe.includes(`- Schluss: CTA mit EXAKT diesem Link: ${link}`));
  assert.ok(scribe.includes("Zahlen NUR aus den Objektdaten (siehe REGEL)"));
  // Pflichtzeilen wie für alle Plattformen (Commit 0f553a9): Disclaimer, KI-Hinweis, Impressum
  for (const pflicht of [
    "1. MODELLRECHNUNG-DISCLAIMER",
    "Modellrechnung — individuelle\n   steuerliche Wirkung abhängig von persönlicher Situation und\n   Behördenbescheinigung; keine Steuerberatung.",
    "2. KI-KENNZEICHNUNG",
    "Visualisierung:\n   KI-generiert",
    "2b. ANBIETERKENNZEICHNUNG",
    "Impressum: steinadel.de/impressum",
  ]) {
    assert.ok(scribe.includes(pflicht), pflicht);
  }
  // LinkedIn ohne Objekt: sachlicher Fachton, kein Steinadel-Bezug, kein Link
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  const frei = await pipePost({ topic: "KI im Mittelstand", platform: "linkedin", format: "linkedin_post", category: "ki_automation" });
  assert.equal(frei.body.status, "complete");
  const t = auftrag("scribe");
  assert.ok(t.includes("Schreibe einen LinkedIn-Post (Fachbeitrag, 1.200-2.000 Zeichen) (Fachton, sachlich):"));
  assert.ok(t.includes("Marktdaten nur mit Quelle (z. B. Destatis), sonst weglassen"));
  assert.ok(t.includes("- Schluss: CTA\n"));
  assert.ok(!t.includes("Steinadel"), "kein Steinadel-Bezug ohne Objekt");
});

test("P-P3 SCRIBE-Text ohne CTA-Link → Abbruch vor COUNSEL (kein weiterer bezahlter Aufruf), Befund im Beleg", async () => {
  exportMit(RITTERGUT);
  agentenMitLink({ scribe: () => "Thread ohne Link, Impressum: steinadel.de/impressum" });
  const r = await pipePost(RITTERGUT_X);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "fehler");
  assert.deepEqual(welt.aktivierungen.map((a) => a.agent), ["researcher", "scribe"]);
  assert.equal(r.body.fehler.stufe, "scribe");
  assert.equal(r.body.fehler.grund, "Kurzlink-Prüfung nicht bestanden (E12)");
  assert.match(r.body.fehler.detail, /^CTA-Link fehlt im Text/);
  assert.deepEqual(r.body.steps.map((s) => s.status), ["done", "error", "pending", "pending", "pending", "pending"]);
  assert.equal(r.body.steps[1].fehler, "Kurzlink-Prüfung nicht bestanden (E12)");
  const z = zeile(r.body.contentId);
  assert.equal(z.status, "fehler");
  assert.equal(z.metadata.kurzlink.pruefung_scribe.ok, false);
  assert.match(z.metadata.kurzlink.pruefung_scribe.befunde[0], /^CTA-Link fehlt im Text: https:\/\/steinadel\.de\/k\/afa-rechner-p1\/x-rittergut-seifersdorf-\d+$/);
  assert.equal(z.metadata.kurzlink.pruefung_endfassung, undefined);
  assert.equal(r.body.summary.completed, "1/6");
});

test("P-P4 Endfassung mit Direktlink auf /l/ → Abbruch vor der Endprüfung, PUBLISHER als Stufe", async () => {
  exportMit(RITTERGUT);
  agentenMitLink({
    publisher: (task) => `Final: ${linkAusAuftrag(task)}\nNewsletter-Teaser: https://steinadel.de/l/afa-rechner-p1?utm_source=newsletter`,
  });
  const r = await pipePost(RITTERGUT_X);
  assert.equal(r.body.status, "fehler");
  assert.deepEqual(welt.aktivierungen.map((a) => a.agent), ["researcher", "scribe", "counsel", "publisher"]);
  assert.equal(r.body.fehler.stufe, "publisher");
  assert.equal(r.body.fehler.grund, "Kurzlink-Prüfung nicht bestanden (E12)");
  assert.equal(r.body.steps[3].status, "error");
  assert.equal(r.body.steps[4].status, "pending");
  const z = zeile(r.body.contentId);
  assert.equal(z.status, "fehler");
  assert.equal(z.body, null, "kein Freigabetext");
  assert.equal(z.review_notes, FREIGABE, "Review der Vorprüfung bleibt");
  assert.equal(z.metadata.kurzlink.pruefung_scribe.ok, true);
  assert.equal(z.metadata.kurzlink.pruefung_endfassung.ok, false);
  assert.match(z.metadata.kurzlink.pruefung_endfassung.befunde[0], /^Direktlink auf eine Kampagnenseite statt Kurzlink/);
});

test("P-P4b Befunde zitieren den Text nur maskiert (SCRIBE-Text mit fremdem Kurzlink, der den geschützten Namen trägt)", async () => {
  exportMit(RITTERGUT);
  agentenMitLink({ scribe: (task) => `${linkAusAuftrag(task)} und https://steinadel.de/k/${NAME.toLowerCase()}/x-1` });
  const r = await pipePost(RITTERGUT_X);
  assert.equal(r.body.status, "fehler");
  assert.deepEqual(welt.aktivierungen.map((a) => a.agent), ["researcher", "scribe"]);
  const z = zeile(r.body.contentId);
  assert.match(z.metadata.kurzlink.pruefung_scribe.befunde[0], /^Kurzlink gehört nicht zu diesem Lauf: https:\/\/steinadel\.de\/k\/\[geschützter Name\]\/x-1$/);
  assert.doesNotMatch(JSON.stringify(z.metadata.kurzlink), NAME_RE, "Befunde maskiert");
  assert.doesNotMatch(JSON.stringify(r.body.fehler), NAME_RE);
});

test("P-P5 Endprüfung lehnt ab → Status abgelehnt, kein AMPLIFIER, review_notes und Urteil der Endprüfung, Vorprüfung im Beleg", async () => {
  exportMit(RITTERGUT);
  agentenMitLink({ endpruefung: ABLEHNUNG });
  const r = await pipePost(RITTERGUT_X);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "abgelehnt");
  assert.deepEqual(welt.aktivierungen.map((a) => a.agent), ["researcher", "scribe", "counsel", "publisher", "counsel"]);
  assert.equal(r.body.counsel.urteil, "ABLEHNUNG");
  assert.equal(r.body.counsel_vorpruefung.urteil, "FREIGABE");
  assert.equal(r.body.steps[5].status, "pending");
  assert.equal(r.body.steps[4].cost, KOSTEN_END);
  const z = zeile(r.body.contentId);
  assert.equal(z.status, "abgelehnt");
  assert.equal(z.review_notes, ABLEHNUNG);
  assert.equal(z.body, null);
  assert.equal(z.metadata.counsel.urteil, "ABLEHNUNG");
  assert.match(z.metadata.counsel.geprueft, /^PUBLISHER-Text/);
  assert.equal(z.metadata.counsel_vorpruefung.urteil, "FREIGABE");
  assert.equal(z.metadata.steps[4].output, ABLEHNUNG);
  // UNKLAR stoppt genauso (fail-closed)
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  agentenMitLink({ endpruefung: "Befunde.\nURTEIL: FREIGABE erst nach Korrektur" });
  const unklar = await pipePost(RITTERGUT_X);
  assert.equal(unklar.body.status, "abgelehnt");
  assert.equal(unklar.body.counsel.urteil, "UNKLAR");
  assert.equal(welt.aktivierungen.filter((a) => a.agent === "amplifier").length, 0);
});

test("P-P6 Endprüfung scheitert technisch → Status fehler, Kosten des Fehllaufs, review_notes bleibt die Vorprüfung, kein AMPLIFIER", async () => {
  exportMit(RITTERGUT);
  agentenMitLink();
  const vorher = welt.agentAntworten.counsel;
  welt.agentAntworten.counsel = (task) =>
    task.startsWith("ENDPRUEFUNG (R2)")
      ? { status: 502, body: { fehler: "leere Antwort", agent_id: "counsel", model: "claude-sonnet-5", stop_reason: "end_turn", usage: { cost_usd: 0.0042 } } }
      : vorher(task);
  const r = await pipePost(RITTERGUT_X);
  assert.equal(r.body.status, "fehler");
  assert.equal(r.body.fehler.stufe, "counsel_endfassung");
  assert.match(r.body.fehler.grund, /^HTTP 502: leere Antwort/);
  assert.equal(r.body.steps[4].status, "error");
  assert.equal(r.body.steps[4].cost, 0.0042);
  assert.equal(welt.aktivierungen.filter((a) => a.agent === "amplifier").length, 0);
  const z = zeile(r.body.contentId);
  assert.equal(z.status, "fehler");
  assert.equal(z.review_notes, FREIGABE, "Vorprüfung bleibt maßgeblich");
  assert.match(z.metadata.counsel.geprueft, /^SCRIBE-Text/);
  assert.equal(z.metadata.counsel_vorpruefung, undefined);
  // Abgeschnittene Endprüfung: ebenfalls Fehler, Teilantwort nur als Beleg in steps[4]
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit(RITTERGUT);
  agentenMitLink();
  const vorher2 = welt.agentAntworten.counsel;
  welt.agentAntworten.counsel = (task) =>
    task.startsWith("ENDPRUEFUNG (R2)") ? agentOk("counsel", "Befunde: …", { stop_reason: "max_tokens", abgeschnitten: true }) : vorher2(task);
  const ab = await pipePost(RITTERGUT_X);
  assert.equal(ab.body.status, "fehler");
  assert.equal(ab.body.fehler.grund, "Antwort abgeschnitten");
  assert.equal(zeile(ab.body.contentId).review_notes, FREIGABE);
  assert.equal(zeile(ab.body.contentId).metadata.steps[4].output, "Befunde: …");
});

test("P-P7 Speichern der Endprüfung scheitert → Abbruch ohne AMPLIFIER, Review und Urteil der Endprüfung im Abbruch gespeichert", async () => {
  exportMit(RITTERGUT);
  agentenMitLink();
  let gestoert = false;
  welt.stoerung = (a) => {
    if (!gestoert && a.art === "supabase" && a.methode === "PATCH" && a.body?.review_notes === FREIGABE && a.body?.metadata?.counsel_vorpruefung) {
      gestoert = true;
      return { status: 500, body: { code: "XX000", message: "Schreibfehler (Test)" } };
    }
    return null;
  };
  const r = await pipePost(RITTERGUT_X);
  assert.equal(gestoert, true);
  assert.equal(r.body.status, "fehler");
  assert.equal(r.body.fehler.grund, "COUNSEL-Endprüfung nicht gespeichert — AMPLIFIER nicht gestartet");
  assert.equal(welt.aktivierungen.filter((a) => a.agent === "amplifier").length, 0);
  const z = zeile(r.body.contentId);
  assert.equal(z.status, "fehler");
  assert.equal(z.review_notes, FREIGABE);
  assert.match(z.metadata.counsel.geprueft, /^PUBLISHER-Text/);
});

test("P-P8 Datierung: Ausnahme greift nur beim Exportwert 1335 (auch als Text); sonst Baujahr mit Warnung; andere Objekte unverändert", async () => {
  exportMit({ ...RITTERGUT, baujahr: "1335" });
  agentenMitLink();
  const text = await pipePost(RITTERGUT_X);
  assert.ok(auftrag("scribe").includes("Ersterwähnung: 1335 (Exportfeld baujahr"));
  assert.equal(zeile(text.body.contentId).metadata.objekt_snapshot.datierung.ausnahme_greift, true);

  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit({ ...RITTERGUT, baujahr: 1750 });
  agentenMitLink();
  const anders = await pipePost(RITTERGUT_X);
  assert.equal(anders.body.status, "complete");
  assert.ok(auftrag("scribe").includes("\nBaujahr: 1750\n"));
  assert.ok(!auftrag("scribe").includes("Ersterwähnung"));
  const d = zeile(anders.body.contentId).metadata.objekt_snapshot.datierung;
  assert.deepEqual([d.bezeichnung, d.wert, d.ausnahme_greift, d.ausnahme_jahr], ["Baujahr", 1750, false, 1335]);
  assert.ok(anders.body.warnungen.some((w) => w.stufe === "objekt" && w.grund.startsWith("Objekt-Ausnahme „Ersterwähnung“ gilt nur für den Exportwert 1335; der Export nennt 1750")));

  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit({ ...RITTERGUT, baujahr: null });
  agentenMitLink();
  const fehlt = await pipePost(RITTERGUT_X);
  assert.ok(auftrag("scribe").includes("\nBaujahr: nicht im Export\n"));
  assert.equal(zeile(fehlt.body.contentId).metadata.objekt_snapshot.datierung.ausnahme_greift, false);
  assert.ok(fehlt.body.warnungen.some((w) => w.grund.includes("der Export nennt kein Jahr, im Prompt als Baujahr")));

  zuruecksetzen();
  welt.pipelineModul = pipeline;
  const villa = structuredClone(STANDARD_OBJEKT);
  villa.kampagnen[0] = { kampagne: "herbst", lpUrl: "https://steinadel.de/l/herbst", lpVariant: "herbst-a" };
  exportMit(villa);
  agentenMitLink();
  const v = await pipePost({ ...RITTERGUT_X, objekt_slug: "villa-x" });
  assert.equal(v.body.status, "complete", JSON.stringify(v.body).slice(0, 300));
  assert.ok(auftrag("scribe").includes("\nBaujahr: 1905\n"));
  assert.equal(zeile(v.body.contentId).metadata.objekt_snapshot.datierung, undefined);
  assert.equal(zeile(v.body.contentId).metadata.cta_link, `https://steinadel.de/k/herbst/x-villa-x-${v.body.contentId}`);
});

test("P-P9 Kurzlink nicht baubar (lpUrl ≠ Ziel) oder Objekt ohne Kampagne → kein CTA-Link, kein Kurzlink-Block, keine Textprüfung, Lauf läuft", async () => {
  exportMit({ ...RITTERGUT, kampagnen: [{ kampagne: "afa-rechner-p1", lpUrl: "https://staging.example/l/afa-rechner-p1", lpVariant: null }] });
  const r = await pipePost(RITTERGUT_X);
  assert.equal(r.body.status, "complete", JSON.stringify(r.body).slice(0, 300));
  const z = zeile(r.body.contentId);
  assert.equal(z.metadata.cta_link, null);
  assert.equal(z.metadata.utm_content, null);
  assert.equal(z.metadata.kampagne, "afa-rechner-p1");
  assert.equal(z.metadata.kurzlink, undefined);
  assert.ok(r.body.warnungen.some((w) => w.stufe === "objekt" && w.grund === "Kurzlink nicht baubar — kein CTA-Link"));
  const scribe = auftrag("scribe");
  assert.ok(!scribe.includes("CTA-LINK"));
  assert.ok(scribe.includes("kein Kampagnen-Link hinterlegt — allgemeiner CTA"));
  assert.ok(scribe.includes("Es gibt keinen CTA-Link: allgemeiner CTA ohne Link"));
  assert.ok(!auftrag("counsel").includes("KURZLINK —"));
  assert.ok(!auftrag("counsel", 1).includes("KURZLINK —"));

  zuruecksetzen();
  welt.pipelineModul = pipeline;
  exportMit({ ...RITTERGUT, kampagnen: [] });
  const ohne = await pipePost(RITTERGUT_X);
  assert.equal(ohne.body.status, "complete");
  assert.equal(zeile(ohne.body.contentId).metadata.kampagne, null);
  assert.equal(zeile(ohne.body.contentId).metadata.cta_link, null);
  assert.deepEqual(ohne.body.warnungen, []);
});

test("P-P10 Lauf ohne Objekt: sechs Stufen, Endprüfung auf der PUBLISHER-Fassung, review_notes der Endprüfung", async () => {
  const r = await pipePost({ topic: "KI-Agenten erklärt", platform: "x", format: "thread", category: "ki_automation" });
  assert.equal(r.body.status, "complete");
  assert.equal(welt.aktivierungen.length, 6);
  assert.ok(auftrag("counsel", 1).includes("OBJEKTDATEN: keine (Freitext-Content ohne Steinadel-Objektbezug)"));
  assert.ok(!auftrag("counsel", 1).includes("KURZLINK —"));
  const z = zeile(r.body.contentId);
  assert.equal(z.body, z.metadata.steps[3].output);
  assert.equal(z.review_notes, z.metadata.steps[4].output);
  assert.equal(z.metadata.kurzlink, undefined);
  assert.equal(z.metadata.freigabe_hinweis.identisch, true);
  assert.equal(r.body.summary.total_cost_usd, Math.round(6 * KOSTEN * 100000) / 100000);
});

// ═══ api/freigaben und api/content/status — R2 ═══

async function freigabenAbruf() {
  const res = await freigabenRoute.GET();
  return res.json();
}

test("P-F1 neue Zeile: kein geprueft_ungleich_freigabe, keine Sperre; Altzeile mit anderer Fassung: R2-Sperre; Altzeile mit gleicher Fassung: frei", async () => {
  exportMit(RITTERGUT);
  agentenMitLink();
  const r = await pipePost(RITTERGUT_X);
  const neu = String(r.body.contentId);
  legeAn({ id: 1, title: "Alt anders", platform: "x", status: "zur_freigabe", body: "PUBLISHER-Fassung mit Ergänzung, lang genug.", review_notes: FREIGABE, metadata: { steps: SCHRITTE_ALT("SCRIBE-Fassung, lang genug für die Regel.", "PUBLISHER-Fassung mit Ergänzung, lang genug.") } });
  legeAn({ id: 2, title: "Alt gleich", platform: "x", status: "zur_freigabe", body: "Gleiche Fassung, lang genug für die Regel.", review_notes: FREIGABE, metadata: { steps: SCHRITTE_ALT("Gleiche Fassung, lang genug für die Regel.", "Gleiche Fassung, lang genug für die Regel.") } });
  legeAn({ id: 3, title: "Neu, Review vertauscht", platform: "x", status: "zur_freigabe", body: "Endfassung, lang genug für die Regel.", review_notes: "Vorprüfung.\nURTEIL: FREIGABE", metadata: { steps: SCHRITTE_NEU("Endfassung, lang genug für die Regel.") } });
  const d = await freigabenAbruf();
  assert.equal(d.fehler, null);
  const nach = (id) => d.wartend.find((e) => e.id === id);
  assert.equal(nach(neu).geprueft_ungleich_freigabe, false, "Abnahme Schritt 5");
  assert.equal(nach(neu).freigabe_sperre, null);
  assert.equal(nach(neu).counsel.urteil, "FREIGABE");
  assert.equal(nach("1").geprueft_ungleich_freigabe, true);
  assert.equal(nach("1").freigabe_sperre, R2_ANDERS);
  assert.equal(nach("2").geprueft_ungleich_freigabe, false);
  assert.equal(nach("2").freigabe_sperre, null);
  assert.equal(nach("3").geprueft_ungleich_freigabe, true, "Review gehört nicht zur Endprüfung");
  assert.equal(nach("3").freigabe_sperre, R2_UNBEKANNT);
});

test("P-F2 Freigeben (content/status): neue Zeile 200 mit Beleg; abweichende Altzeile 409 (R2) ohne Schreiben; Altzeile mit gleicher Fassung 200", async () => {
  exportMit(RITTERGUT);
  agentenMitLink();
  const r = await pipePost(RITTERGUT_X);
  const id = r.body.contentId;
  const ok = await post(statusRoute, "/api/content/status", { id, aktion: "freigeben" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(zeile(id).status, "freigegeben");
  assert.equal(zeile(id).metadata.freigabe.counsel_urteil, "FREIGABE");
  assert.equal(zeile(id).metadata.freigabe.text_zeichen, Array.from(zeile(id).body.trim()).length);

  const alt = legeAn({ id: 1, status: "zur_freigabe", body: "PUBLISHER-Fassung mit Ergänzung, lang genug.", review_notes: FREIGABE, metadata: { steps: SCHRITTE_ALT("SCRIBE-Fassung, lang genug für die Regel.", "PUBLISHER-Fassung mit Ergänzung, lang genug.") } });
  const vorher = structuredClone(alt);
  const gesperrt = await post(statusRoute, "/api/content/status", { id: 1, aktion: "freigeben" });
  assert.equal(gesperrt.status, 409);
  assert.equal(gesperrt.body.fehler, R2_ANDERS);
  assert.deepEqual(zeile(1), vorher, "nichts geschrieben");

  legeAn({ id: 2, status: "zur_freigabe", body: "Gleiche Fassung, lang genug für die Regel.", review_notes: FREIGABE, metadata: { steps: SCHRITTE_ALT("Gleiche Fassung, lang genug für die Regel.", "Gleiche Fassung, lang genug für die Regel.") } });
  assert.equal((await post(statusRoute, "/api/content/status", { id: 2, aktion: "freigeben" })).status, 200);

  legeAn({ id: 4, status: "zur_freigabe", body: "Ohne Schritte, lang genug für die Regel.", review_notes: FREIGABE, metadata: {} });
  const ohne = await post(statusRoute, "/api/content/status", { id: 4, aktion: "freigeben" });
  assert.equal(ohne.status, 409);
  assert.equal(ohne.body.fehler, R2_UNBEKANNT);
});

// ═══ Beleg-Kette und /content — Anzeige für Läufe mit Endprüfung ═══

const STUDIO = ladeStudioBausteine({
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@/lib/counsel-urteil": counselModul,
  "@/lib/freigabe-regeln": regeln,
});
const ketteHtml = (item) => renderToStaticMarkup(React.createElement(STUDIO.kette.BelegKette, { item, kopiere: () => {}, kopierStatus: () => "Kopieren" }));

test("P-B1 Beleg-Kette eines neuen RitterGut-Laufs: Ersterwähnung, beide COUNSEL-Prüfungen mit Kosten, Kurzlink-Ziel, grünes FREIGABE", async () => {
  exportMit(RITTERGUT);
  agentenMitLink();
  const r = await pipePost(RITTERGUT_X);
  const z = zeile(r.body.contentId);
  const html = ketteHtml(z);
  // Abnahme Schritt 4: "Der Beleg zeigt Ersterwähnung"
  assert.match(html, /<th scope="row"[^>]*>Ersterwähnung<\/th><td[^>]*><div>1335<\/div><div class="text-\[10px\] text-text-muted" data-datierung="true">Exportfeld baujahr · Objekt-Ausnahme: Laut Steinadel-Objektdaten ist 1335 das Jahr der Ersterwähnung/);
  assert.ok(!/>Baujahr<\/th>/.test(html));
  // Abnahme Schritt 5: Kosten des zweiten Aufrufs im Beleg
  assert.ok(html.includes('<p data-counsel-pruefung="vor"><span class="text-text-muted">Vorprüfung · SCRIBE-Text: </span>Urteil FREIGABE · <span class="font-[family-name:var(--font-jbmono)]">$0.0007 gesch.</span></p>'), html);
  assert.ok(html.includes('<p data-counsel-pruefung="end"><span class="text-text-muted">Endprüfung · Freigabetext, wörtlich: </span>Urteil FREIGABE · <span class="font-[family-name:var(--font-jbmono)]">$0.0123 gesch.</span></p>'));
  // CTA: Kurzlink, aufgelöstes Ziel und Textprüfung
  assert.ok(html.includes(`>https://steinadel.de/k/afa-rechner-p1/x-rittergut-seifersdorf-${z.id}</code>`));
  assert.ok(html.includes(`leitet weiter auf (im Code aufgelöst): </span><span class="font-mono break-all">https://steinadel.de/l/afa-rechner-p1?utm_source=x&amp;utm_medium=social&amp;utm_campaign=afa-rechner-p1&amp;utm_content=x-rittergut-seifersdorf-${z.id}</span>`));
  assert.ok(html.includes("<p data-kurzlink-pruefung=\"true\">Kurzlink im Text geprüft: SCRIBE-Text bestanden · Endfassung bestanden</p>"));
  // R2: grünes FREIGABE (COUNSEL hat genau den Freigabetext geprüft), Prüfregel erfüllt
  assert.match(html, /data-urteil-anzeige="identisch">FREIGABE</);
  assert.ok(html.includes("COUNSEL hat genau den Freigabetext geprüft."));
  assert.ok(html.includes("geprüft: PUBLISHER-Text (steps[3]), wörtlich = Freigabetext (body)"));
  const lage = STUDIO.hilfen.freigabeLage(z);
  assert.equal(lage.pruefung.freigebbar, true);
  assert.equal(lage.bezug, "identisch");
  assert.equal(lage.geprueftText, z.body);
});

test("P-B2 Beleg-Kette: Datierung ohne greifende Ausnahme, Endprüfung abgebrochen oder nicht gelaufen, nicht bestandene Textprüfung", () => {
  const basis = { id: 70, status: "fehler", body: null, review_notes: FREIGABE };
  const html = ketteHtml({
    ...basis,
    metadata: {
      objekt_snapshot: { abgerufen_am: "2026-11-10T08:00:00Z", export: null, objekt: { baujahr: 1750 }, datierung: { feld: "baujahr", bezeichnung: "Baujahr", ausnahme_greift: false } },
      steps: [
        { agent: "researcher", status: "done", output: "r", cost: 0.01 },
        { agent: "scribe", status: "done", output: "s", cost: 0.01 },
        { agent: "counsel", status: "done", output: "URTEIL: FREIGABE", cost: null },
        { agent: "publisher", status: "error", fehler: `Kurzlink-Prüfung ${NAME}`, cost: 0.01 },
        { agent: "counsel_endfassung", status: "pending" },
        { agent: "amplifier", status: "pending" },
      ],
      kurzlink: { link: "https://steinadel.de/k/a/x-b-70", ziel_url: "https://steinadel.de/l/a?utm_source=x", pruefung_scribe: { ok: true }, pruefung_endfassung: { ok: false, befunde: [`Direktlink ${NAME}`] } },
    },
  });
  assert.match(html, />Baujahr<\/th><td[^>]*><div>1750<\/div><div[^>]*data-datierung="true">Exportfeld baujahr · Objekt-Ausnahme greift nicht/);
  assert.ok(html.includes("Vorprüfung · SCRIBE-Text: </span>Urteil FREIGABE · <span class=\"font-[family-name:var(--font-jbmono)]\">Kosten nicht gemeldet</span>"));
  assert.ok(html.includes("Endprüfung · Freigabetext, wörtlich: </span>nicht ausgeführt · <span class=\"font-[family-name:var(--font-jbmono)]\">keine Kosten</span>"));
  assert.ok(html.includes("Kurzlink im Text geprüft: SCRIBE-Text bestanden · Endfassung nicht bestanden (Direktlink [geschützter Name])"));
  assert.doesNotMatch(html, NAME_RE);
  // Endprüfung mit Fehler: Grund maskiert, Kosten des Fehllaufs
  const fehler = ketteHtml({
    ...basis,
    metadata: { steps: [{ agent: "counsel", status: "done", output: "URTEIL: ABLEHNUNG", cost: 0.002 }, { agent: "counsel_endfassung", status: "error", fehler: `HTTP 502 ${NAME}`, cost: 0.0042 }] },
  });
  assert.ok(fehler.includes("Vorprüfung · SCRIBE-Text: </span>Urteil ABLEHNUNG · <span class=\"font-[family-name:var(--font-jbmono)]\">$0.0020 gesch.</span>"));
  assert.ok(fehler.includes("Endprüfung · Freigabetext, wörtlich: </span>Fehler: HTTP 502 [geschützter Name] · <span class=\"font-[family-name:var(--font-jbmono)]\">$0.0042 gesch.</span>"));
  const laeuft = ketteHtml({ ...basis, metadata: { steps: [{ agent: "counsel_endfassung", status: `running ${NAME}`, cost: -1 }] } });
  assert.ok(laeuft.includes("Vorprüfung · SCRIBE-Text: </span>nicht ausgeführt"));
  assert.ok(laeuft.includes("Endprüfung · Freigabetext, wörtlich: </span>nicht abgeschlossen (running [geschützter Name]) · <span class=\"font-[family-name:var(--font-jbmono)]\">Kosten nicht gemeldet</span>"));
  // Läufe vor Paket B: keine neuen Zeilen in der Kette
  const alt = ketteHtml({ ...basis, metadata: { steps: SCHRITTE_ALT("a", "b"), objekt_snapshot: { objekt: { baujahr: 1335 } }, kurzlink: null } });
  assert.ok(!alt.includes("COUNSEL-Prüfungen") && !alt.includes("data-kurzlink") && !alt.includes("data-datierung"));
  assert.match(alt, />Baujahr<\/th>/);
  const leerBezeichnung = ketteHtml({ ...basis, metadata: { objekt_snapshot: { objekt: { baujahr: 1 }, datierung: { bezeichnung: "  ", ausnahme_greift: true } } } });
  assert.match(leerBezeichnung, />Baujahr<\/th><td[^>]*><div>1<\/div><div[^>]*data-datierung="true">Exportfeld baujahr · Objekt-Ausnahme<\/div>/);
});

test("P-C1 /content: frisches Ergebnis mit Endprüfung → grünes FREIGABE; Stufenname COUNSEL 2; Ergebnis ohne Endprüfung wie bisher", async () => {
  const hooksStatus = await import(pathToFileURL(path.join(SITE, "src/lib/hooks-status.ts")).href);
  const contentListe = await import(pathToFileURL(path.join(SITE, "src/lib/content-liste.ts")).href);
  const seite = ladeTsx(
    "app/content/page.tsx",
    {
      react: React,
      "react/jsx-runtime": jsxRuntime,
      "next/navigation": { useSearchParams: () => new URLSearchParams("") },
      "@/lib/content-liste": contentListe,
      "@/components/ui/KPICard": { KPICard: () => null },
      "@/lib/hooks-status": { ...hooksStatus, useFreigaben: () => ({ freigaben: null, fehler: null, loading: false, geladenAm: null, neuLaden: async () => {} }) },
      "@/lib/counsel-urteil": counselModul,
      "@/lib/freigabe-regeln": regeln,
      ...STUDIO.module,
    },
    ["ergebnisBezug", "stufenName", "flussHinweis"],
  ).__intern;
  const pub = "Finaler Content mit Kurzlink und Pflichtzeilen.";
  const neu = { status: "complete", freigabe_hinweis: { identisch: true }, steps: SCHRITTE_NEU(pub) };
  assert.equal(seite.ergebnisBezug(neu), "identisch");
  assert.equal(seite.ergebnisBezug({ ...neu, steps: SCHRITTE_NEU(pub, ABLEHNUNG) }), "identisch", "Bindung an die Ausgabe der Endprüfung");
  assert.equal(seite.ergebnisBezug({ ...neu, steps: SCHRITTE_NEU(pub, FREIGABE, "error") }), "nicht_pruefbar");
  assert.equal(seite.ergebnisBezug({ status: "complete", freigabe_hinweis: { identisch: false }, steps: SCHRITTE_ALT("SCRIBE", "PUB") }), "abweichend");
  assert.equal(seite.ergebnisBezug({ status: "complete", steps: SCHRITTE_ALT("Gleich", "Gleich") }), "identisch");
  assert.equal(seite.ergebnisBezug({ status: "abgelehnt", steps: SCHRITTE_NEU(pub) }), "kein_text");
  assert.equal(seite.stufenName("counsel_endfassung"), "COUNSEL 2");
  assert.equal(seite.stufenName("publisher"), "PUBLISHER");
  const hinweis = seite.flussHinweis({ status: "fehler", fehler: { stufe: "counsel_endfassung", grund: "HTTP 502" }, steps: SCHRITTE_NEU(pub, "", "error").map((s) => (s.agent === "amplifier" ? { agent: "amplifier", status: "pending" } : s)) });
  assert.equal(hinweis, "Abbruch in Stufe COUNSEL 2: HTTP 502 — AMPLIFIER wurde nicht ausgeführt.");
});
