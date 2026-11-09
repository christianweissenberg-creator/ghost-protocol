// Objekt-Studio Schritt 2 (08.11.2026): Allow-List, GET /api/studio/[objekt], Studio-Seite, Sidebar
// und /expose. Lauf: npm test.
//
// Die Route läuft im Prozess gegen die Attrappen aus tests/harness/fake.mjs: Supabase (PostgREST) und
// /api/objekte (Steinadel-Export) — kein Netz, kein Live-Export, keine bezahlten Aufrufe. Die Ansicht
// (components/studio/StudioAnsicht.tsx) rendert mit echtem React die Antwort der echten Route; die
// Seite (app/studio/[objekt]/page.tsx) läuft mit einer Hook-Laufzeit gegen einen fetch-Attrappen.
// Die Umgebungswerte unten sind Test-Werte dieses Prozesses, keine echten Schlüssel.
// Module werden je Test geladen (ladeModul): Fehlt eines, scheitert der einzelne Test, nicht die Datei
// (Rückprobe gegen den Stand vor Schritt 2). S_ROUTE_STUDIO=<pfad> prüft statt der Repo-Route eine
// Kopie; Ansicht und Seite lassen sich über Z_TSX_* tauschen (tests/harness/tsx.mjs).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wie tests/z-routen.test.mjs: "@/…" → src/….ts, "next/server" → node_modules, relative Importe ohne
// Endung aus .ts → ".ts", "server-only" → die leere Fassung, die Next.js im Server-Bundle nimmt.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/server.js")).href, context);
    if (specifier === "server-only") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/dist/compiled/server-only/empty.js")).href, context);
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
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
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
});

const fake = await import("./harness/fake.mjs");
const { welt, legeAn, zuruecksetzen } = fake;
fake.installiere();
const { React, jsxRuntime, renderToStaticMarkup, ladeTsx, baumLaufzeit, finde, text, ts } = await import("./harness/tsx.mjs");
const { ladeStudioBausteine, hookLaufzeit } = await import("./harness/studio.mjs");
const { NextRequest } = await import("next/server");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const counsel = await import("../src/lib/counsel-urteil.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const types = await import("../src/lib/types.ts");

const NAME = ["Immo", "Nexus"].join("");
const ENTHAELT_NAMEN = /imm[ou][\s._-]*nexus/i;
const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const SLUG = "rittergut-seifersdorf";
/** Interne Ablagen und Kürzel, zusammengesetzt, damit sie selbst nicht im öffentlichen Repo stehen. */
const INTERNE_VERWEISE = new RegExp(["docs/" + "intern", "GG" + "/", "SG" + "/", "SR" + "/", "N" + "E:"].map((s) => s.replace("/", "\\/")).join("|"));

const modulCache = new Map();
/** Modul je Test laden (gecacht); fehlt es, scheitert nur der Test, der es braucht. */
async function ladeModul(rel, umgebung) {
  const datei = (umgebung && process.env[umgebung]) || path.join(SITE, rel);
  if (!modulCache.has(datei)) modulCache.set(datei, await import(pathToFileURL(datei).href));
  return modulCache.get(datei);
}
const route = () => ladeModul("src/app/api/studio/[objekt]/route.ts", "S_ROUTE_STUDIO");
const freigabenRoute = () => ladeModul("src/app/api/freigaben/route.ts");
const objekteModul = () => ladeModul("src/lib/studio/objekte.ts");
const regelnStudio = () => ladeModul("src/lib/studio/regeln.ts");

beforeEach(async () => {
  zuruecksetzen();
  process.env.SUPABASE_SERVICE_KEY = "service-test-key-1234567890abcdef";
  // Freigabe-Stapel sparsam (09.11.2026): GET /api/freigaben hält einen Zwischenstand je Prozess
  // (lib/freigaben-cache.ts; Verhalten in tests/r-freigaben-probe.test.mjs). Jeder Test beginnt ohne —
  // sonst hinge, was die Route liest, vom Test davor ab. Fehlt das Modul (Stand davor), gibt es nichts
  // zurückzusetzen.
  const speicher = await ladeModul("src/lib/freigaben-cache.ts").catch(() => null);
  speicher?.setzeFreigabenZurueck();
});

// ─── Testdaten ───────────────────────────────────────────────────────────────

const GENERIERT = "2026-11-08T07:30:00Z";
/** Exportobjekt (Testwerte). Freitexte tragen Marker: Der Studio-Kopf darf sie nicht zeigen. */
const RITTERGUT = {
  slug: SLUG,
  name: "RitterGut Seifersdorf",
  untertitel: "MARKER-FREITEXT-UNTERTITEL",
  tagline: "MARKER-FREITEXT-TAGLINE",
  ort: "Testort",
  baujahr: 1335,
  preis: "ab 123.456 € (Testwert)",
  kurzbeschreibung: "MARKER-FREITEXT-KURZ",
  statusBadge: "Vermarktung",
  afaProzent: 100,
  istDenkmal: true,
  kennzahlen: [{ label: "MARKER-FREITEXT-KENNZAHL", wert: "1" }],
  urls: { objektSeite: "https://steinadel.example/rittergut", expose: "", ogBild: "", cover: "" },
  kampagnen: [{ kampagne: "MARKER-FREITEXT-KAMPAGNE", lpUrl: "https://steinadel.example/l/k", lpVariant: "a" }],
};
const VILLA = { ...RITTERGUT, slug: "villa-x", name: "Villa X", baujahr: 1905 };

function exportAntwort(objekte = [RITTERGUT, VILLA], kopf = {}) {
  return { status: 200, body: { version: "1", quelle: `${NAME} Backoffice`, generiert_am: GENERIERT, objekte, ...kopf } };
}

const TEXT = "Denkmal-Altbau, Ersterwähnung laut Export. Jetzt Exposé anfordern.";
const FREIGABE = "Prüfung ok.\nURTEIL: FREIGABE-EMPFEHLUNG";

/** content-Zeile mit Postgres-Defaults (fake.legeAn). */
function lauf(id, { slug = SLUG, status = "abgelehnt", steps, body = null, review_notes = "URTEIL: ABLEHNUNG", title = `Lauf ${id}`, am = "2026-07-27T20:47:25Z", platform = "x", content_type = "thread", extra = {} } = {}) {
  const metadata = { ...(slug === null ? {} : { objekt_slug: slug }), ...(steps === undefined ? {} : { steps }), ...extra };
  return legeAn({ id, title, content_type, platform, status, body, review_notes, created_at: am, updated_at: am, metadata });
}

const gelaufen = (agent, cost, extra = {}) => ({ agent, cost, duration_ms: 1, output: `${agent}-Ausgabe`, ...extra });
const nichtGelaufen = (agent) => ({ agent });
/** Format vor Stufe 1 (ohne status): drei gelaufene Stufen, zwei nicht gelaufene. */
const ALT = [gelaufen("researcher", 0.05), gelaufen("scribe", 0.01), gelaufen("counsel", 0.02), nichtGelaufen("publisher"), nichtGelaufen("amplifier")];
const NEU_VOLL = ["researcher", "scribe", "counsel", "publisher", "amplifier"].map((agent, i) => ({
  agent,
  status: "done",
  output: agent === "scribe" || agent === "publisher" ? TEXT : `${agent}-Ausgabe`,
  cost: [0.001, 0.002, 0.003, 0.004, 0.005][i],
}));
const NEU_LUECKE = [
  { agent: "researcher", status: "done", output: "r", cost: 0.02 },
  { agent: "scribe", status: "error", fehler: "HTTP 502", cost: null },
  { agent: "counsel", status: "pending" },
  { agent: "publisher", status: "pending" },
  { agent: "amplifier", status: "pending" },
];

/** Vier Läufe des RitterGuts (Kosten 0,08 + 0,015 + 0,02; einer ohne Angabe) und zwei andere Zeilen. */
function standardWelt() {
  lauf(1, { steps: ALT });
  lauf(2, { status: "zur_freigabe", steps: NEU_VOLL, body: TEXT, review_notes: FREIGABE, am: "2026-11-07T10:00:00Z" });
  lauf(3, { status: "entwurf", am: "2026-11-07T11:00:00Z" });
  lauf(4, { status: "fehler", steps: NEU_LUECKE, am: "2026-11-07T12:00:00Z" });
  lauf(5, { slug: "villa-x", steps: ALT });
  lauf(6, { slug: null, steps: ALT });
  welt.objekteAntwort = exportAntwort();
}

/**
 * Stand der Datenbank am 08.11.2026, nachgestellt: zehn content-Zeilen, alle mit objekt_slug
 * rittergut-seifersdorf, Stufen im Format vor Stufe 1. Kosten je gelaufener Stufe wie gemessen
 * (Supabase, nur lesend per SELECT am 08.11.2026): Summe 1,0977068 USD über 36 Stufen, keine
 * Stufe ohne Kostenangabe.
 */
const GEMESSEN = [
  [1, "abgelehnt", "x", "thread", "2026-07-27T20:47:25.406613Z", [0.058785, 0.0083688, 0.0130144]],
  [2, "freigegeben", "x", "thread", "2026-07-27T20:59:30.612923Z", [0.05763, 0.006816, 0.007492, 0.087732, 0.0111968]],
  [3, "abgelehnt", "instagram", "carousel", "2026-07-28T06:43:28.403776Z", [0.051135, 0.0106992, 0.009736]],
  [4, "abgelehnt", "newsletter", "newsletter_issue", "2026-07-28T06:44:35.170845Z", [0.072648, 0.0094288, 0.008490400000000002, 0.052668, 0.0107864]],
  [5, "abgelehnt", "instagram", "carousel", "2026-07-29T21:52:22.774806Z", [0.053985, 0.0108928, 0.0105032]],
  [6, "abgelehnt", "newsletter", "newsletter_issue", "2026-07-29T21:57:16.494535Z", [0.065793, 0.0089728, 0.009303200000000001]],
  [7, "abgelehnt", "instagram", "carousel", "2026-07-29T22:06:02.730081Z", [0.072756, 0.01228, 0.010000799999999999]],
  [8, "zur_freigabe", "newsletter", "newsletter_issue", "2026-07-29T22:07:24.502206Z", [0.073959, 0.010652799999999999, 0.009896799999999999, 0.067674, 0.011042399999999999]],
  [9, "abgelehnt", "instagram", "carousel", "2026-07-29T22:13:36.969325Z", [0.085491, 0.0106336, 0.009775200000000001]],
  [10, "abgelehnt", "instagram", "carousel", "2026-07-29T22:18:36.740272Z", [0.06429, 0.0118128, 0.0113656]],
];

function gemessenerStand() {
  const agenten = ["researcher", "scribe", "counsel", "publisher", "amplifier"];
  for (const [id, status, platform, content_type, am, kosten] of GEMESSEN) {
    const steps = agenten.map((agent, i) => (i < kosten.length ? gelaufen(agent, kosten[i]) : nichtGelaufen(agent)));
    lauf(id, { status, platform, content_type, am, steps, body: status === "abgelehnt" ? null : TEXT });
  }
  welt.objekteAntwort = exportAntwort([RITTERGUT]);
}

async function hole(slug = SLUG, { cookie = "gp-auth=test", params } = {}) {
  const { GET } = await route();
  const req = new NextRequest(`http://harness.local/api/studio/${encodeURIComponent(slug)}`, { headers: { cookie } });
  const res = await GET(req, { params: params ?? Promise.resolve({ objekt: slug }) });
  return { status: res.status, kopf: res.headers, body: await res.json() };
}

/** Antwort ohne die Daten der Beleg-Kette (die tragen Rohtext wie /content). */
function ohneBeleg(body) {
  const kopie = structuredClone(body);
  for (const a of kopie.assets?.wert ?? []) delete a.beleg;
  return kopie;
}

// ═══ A: Allow-List ═══

test("S-A1 Allow-List: genau rittergut-seifersdorf; Form 400 vor Liste 404", async () => {
  const o = await objekteModul();
  assert.deepEqual([...o.STUDIO_OBJEKTE], [SLUG]);
  assert.deepEqual(o.pruefeStudioSlug(SLUG), { art: "ok", slug: SLUG });
  for (const s of ["villa-x", "rittergut", "rittergut-seifersdorf-2", "a"]) assert.deepEqual(o.pruefeStudioSlug(s), { art: "nicht_im_studio" }, s);
  for (const s of ["", "RitterGut-Seifersdorf", "rittergut seifersdorf", "../objekte", "rittergut--seifersdorf", "-rittergut", "rittergut_seifersdorf", "a".repeat(81), null, 5, ["rittergut-seifersdorf"]]) {
    assert.deepEqual(o.pruefeStudioSlug(s), { art: "form" }, String(s));
  }
  assert.equal(o.studioPfad(SLUG), "/studio/rittergut-seifersdorf");
  assert.equal(o.STUDIO_EINSTIEG, "/studio/rittergut-seifersdorf");
});

// ═══ B: GET /api/studio/[objekt] ═══

test("S-B1 400 bei falscher Form, 404 'Objekt nicht im Studio' — ohne Abfrage bei Supabase oder Export", async () => {
  standardWelt();
  for (const s of ["Rittergut", "../objekte", "ritter gut", "x".repeat(81)]) {
    const r = await hole(s);
    assert.equal(r.status, 400, s);
    assert.equal(r.body.fehler_art, "eingabe");
    assert.match(r.body.fehler, /Ungültige Objekt-Kennung/);
  }
  const r = await hole("villa-x");
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { fehler: "Objekt nicht im Studio", fehler_art: "nicht_im_studio" });
  assert.equal(r.kopf.get("cache-control"), "no-store");
  assert.equal(welt.log.length, 0, "keine Supabase-Abfrage");
  assert.equal(welt.objektAbrufe, 0, "kein Export-Abruf");
});

test("S-B2 Abnahme Kopf: 'Ersterwähnung 1335' (Objekt-Ausnahme, Exportfeld baujahr), Export-Zeitpunkt als Quelle, Preis wörtlich, AfA, Kopf-Quelle maskiert", async () => {
  standardWelt();
  const r = await hole();
  assert.equal(r.status, 200);
  assert.equal(r.kopf.get("cache-control"), "no-store");
  const o = r.body.objekt;
  assert.equal(o.status, "ok", o.hinweis);
  assert.equal(o.quelle, "Steinadel-Export · generiert_am 2026-11-08T07:30:00.000Z");
  assert.ok(Date.parse(o.gemessen_am) > 0);
  assert.equal(o.wert.name, "RitterGut Seifersdorf");
  assert.equal(o.wert.ort, "Testort");
  assert.equal(o.wert.datierung.bezeichnung, "Ersterwähnung");
  assert.equal(o.wert.datierung.jahr, 1335);
  assert.match(o.wert.datierung.ausnahme, /Ersterwähnung, nicht das Baujahr/);
  assert.equal(o.wert.status, "Vermarktung");
  assert.equal(o.wert.preis, "ab 123.456 € (Testwert)");
  assert.deepEqual(o.wert.afa, { prozent: 100, denkmal: true });
  assert.equal(o.wert.export.generiert_am, "2026-11-08T07:30:00.000Z");
  assert.equal(o.wert.export.quelle, `${regeln.NAMENS_ERSATZ} Backoffice`);
  assert.deepEqual(o.wert.fehlende_felder, []);
  assert.equal(welt.objektAbrufe, 1, "genau ein Export-Abruf über /api/objekte");
  // Kein Freitext des Exports im Kopf (dort könnte ein Name stehen, den das Studio nicht nennt).
  assert.doesNotMatch(JSON.stringify(o), /MARKER-FREITEXT/);
});

test("S-B2b Export-Abruf über /api/objekte: Sitzung weitergereicht, ohne Cache, Zeitlimit über dem von /api/objekte (15 s)", async () => {
  standardWelt();
  const original = AbortSignal.timeout;
  const msJeSignal = new WeakMap();
  AbortSignal.timeout = (ms) => {
    const s = original.call(AbortSignal, ms);
    msJeSignal.set(s, ms);
    return s;
  };
  const harnessFetch = globalThis.fetch;
  const abrufe = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.endsWith("/api/objekte")) abrufe.push({ url, cookie: new Headers(init.headers).get("cookie"), cache: init.cache, ms: msJeSignal.get(init.signal) ?? null });
    return harnessFetch(input, init);
  };
  try {
    const r = await hole(SLUG, { cookie: "gp-auth=sitzung-123" });
    assert.equal(r.body.objekt.status, "ok");
  } finally {
    globalThis.fetch = harnessFetch;
    AbortSignal.timeout = original;
  }
  assert.deepEqual(abrufe, [{ url: "http://harness.local/api/objekte", cookie: "gp-auth=sitzung-123", cache: "no-store", ms: 20_000 }]);
});

test("S-B3 Kopf: Ausnahme greift nur beim Exportwert 1335; fehlende Felder heißen 'nicht im Export', kein Ersatzwert", async () => {
  const ohne = { ...RITTERGUT };
  delete ohne.baujahr;
  delete ohne.statusBadge;
  for (const [objekt, erwartet] of [
    [{ ...RITTERGUT, baujahr: 1750 }, { bezeichnung: "Baujahr", jahr: 1750, status: "warnung" }],
    [{ ...RITTERGUT, baujahr: "1335" }, { bezeichnung: "Ersterwähnung", jahr: 1335, status: "ok" }],
  ]) {
    zuruecksetzen();
    welt.objekteAntwort = exportAntwort([objekt]);
    const o = (await hole()).body.objekt;
    assert.equal(o.wert.datierung.bezeichnung, erwartet.bezeichnung);
    assert.equal(o.wert.datierung.jahr, erwartet.jahr);
    assert.equal(o.status, erwartet.status);
    if (erwartet.status === "warnung") assert.match(o.hinweis, /gilt nur für den Exportwert 1335; der Export nennt 1750/);
  }
  zuruecksetzen();
  welt.objekteAntwort = exportAntwort([ohne], { generiert_am: "kein Datum" });
  const o = (await hole()).body.objekt;
  assert.equal(o.status, "warnung");
  assert.equal(o.wert.datierung, null);
  assert.equal(o.wert.status, null);
  assert.equal(o.wert.export.generiert_am, null);
  assert.equal(o.quelle, "Steinadel-Export · ohne generiert_am");
  assert.deepEqual(o.wert.fehlende_felder, ["statusBadge", "baujahr", "generiert_am (unlesbar)"]);
});

test("S-B4 Abnahme Assets: Anzahl aus der DB-Abfrage (Zählung), nur Zeilen mit metadata.objekt_slug des Objekts", async () => {
  for (const n of [0, 1, 4, 7]) {
    zuruecksetzen();
    welt.objekteAntwort = exportAntwort();
    for (let i = 1; i <= n; i++) lauf(i, { steps: ALT });
    lauf(50, { slug: "villa-x", steps: ALT });
    lauf(51, { slug: null, steps: ALT });
    const a = (await hole()).body.assets;
    assert.equal(a.status, "ok", a.hinweis);
    assert.equal(a.gesamt, n, `Zählung bei ${n}`);
    assert.deepEqual(a.wert.map((x) => x.id), Array.from({ length: n }, (_, i) => i + 1));
    assert.equal(a.quelle, "Supabase · content (metadata.objekt_slug = rittergut-seifersdorf)");
    const abfrage = welt.log.find((l) => l.tabelle === "content");
    assert.match(abfrage.query, /metadata->>objekt_slug=eq\.rittergut-seifersdorf/);
  }
});

test("S-B5 Asset-Felder: Art, Kanal, Format, Status, COUNSEL-Urteil und Sperrgrund wie /api/freigaben, Beleg-Daten", async () => {
  standardWelt();
  // Geprüft und regelkonform, aber nicht im Status zur_freigabe: gesperrt wegen des Status.
  lauf(7, { status: "counsel_geprueft", steps: NEU_VOLL, body: TEXT, review_notes: FREIGABE, am: "2026-11-07T09:00:00Z" });
  const a = (await hole()).body.assets.wert;
  const sieben = a.find((x) => x.id === 7);
  assert.equal(sieben.counsel.urteil, "FREIGABE");
  assert.equal(sieben.freigabe_sperre, 'Status "counsel_geprueft" — freigebbar ist nur "zur_freigabe"');
  const zwei = a.find((x) => x.id === 2);
  assert.equal(zwei.art, "text");
  assert.equal(zwei.kanal, "x");
  assert.equal(zwei.format, "thread");
  assert.equal(zwei.status, "zur_freigabe");
  assert.deepEqual(zwei.counsel, { urteil: "FREIGABE", zeile: "URTEIL: FREIGABE-EMPFEHLUNG", grund: "URTEIL-Zeile", abgeleitet: true });
  assert.equal(zwei.freigabe_sperre, null);
  assert.equal(zwei.beleg.id, 2);
  assert.equal(zwei.beleg.body, TEXT);
  assert.equal(zwei.beleg.review_notes, FREIGABE);
  assert.equal(zwei.beleg.metadata.objekt_slug, SLUG);
  const eins = a.find((x) => x.id === 1);
  assert.equal(eins.counsel.urteil, "ABLEHNUNG");
  assert.match(eins.freigabe_sperre, /^COUNSEL-Urteil ABLEHNUNG/);
  const drei = a.find((x) => x.id === 3);
  assert.equal(drei.counsel.urteil, "ABLEHNUNG");
  // Gleichlauf mit dem Freigabe-Stapel: dieselbe Zeile, dasselbe Urteil, derselbe Sperrgrund.
  const { GET } = await freigabenRoute();
  const stapel = await (await GET()).json();
  const eintrag = stapel.wartend.find((e) => e.id === "2");
  assert.ok(eintrag, "Zeile 2 wartet im Stapel");
  assert.equal(eintrag.counsel.urteil, zwei.counsel.urteil);
  assert.equal(eintrag.counsel.zeile, zwei.counsel.zeile);
  assert.equal(eintrag.freigabe_sperre, zwei.freigabe_sperre);
  const haengend = stapel.haengend.find((e) => e.id === "7");
  assert.ok(haengend, "Zeile 7 hängt im Stapel");
  assert.equal(haengend.counsel.urteil, sieben.counsel.urteil);
  assert.equal(haengend.freigabe_sperre, sieben.freigabe_sperre);
});

test("S-B6 Abnahme Kosten: USD-Schätzung aus metadata.steps[].cost mit 'n Läufe ohne Kostenangabe'", async () => {
  standardWelt();
  const { body } = await hole();
  const k = body.kosten_usd;
  assert.equal(k.status, "warnung");
  assert.deepEqual(k.wert, {
    summe: 0.115,
    laeufe: 4,
    laeufe_mit_angabe: 3,
    laeufe_ohne_angabe: 1,
    laeufe_unvollstaendig: 1,
    laeufe_alte_preistabelle: 1,
  });
  assert.match(k.hinweis, /1 Lauf ohne Kostenangabe nicht summiert/);
  assert.match(k.hinweis, /1 Lauf mit Stufen ohne Kostenangabe \(Untergrenze\)/);
  assert.match(k.hinweis, /1 von 3 summierten Läufen vor dem 06\.11\.2026: mit der alten Preistabelle geschätzt/);
  assert.match(k.quelle, /metadata\.steps\[\]\.cost/);
  // Je Asset: altes Format zählt nur gelaufene Stufen, "pending" zählt nicht, ohne steps kein Wert.
  const je = Object.fromEntries(body.assets.wert.map((a) => [a.id, a.kosten_usd]));
  assert.deepEqual(je[1].wert, { summe_usd: 0.08, stufen_gelaufen: 3, stufen_mit_angabe: 3, stufen_ohne_angabe: 0 });
  assert.equal(je[1].status, "ok");
  assert.deepEqual(je[2].wert, { summe_usd: 0.015, stufen_gelaufen: 5, stufen_mit_angabe: 5, stufen_ohne_angabe: 0 });
  assert.equal(je[3].wert, null);
  assert.equal(je[3].status, "nicht_gemessen");
  assert.equal(je[3].gemessen_am, null);
  assert.deepEqual(je[4].wert, { summe_usd: 0.02, stufen_gelaufen: 2, stufen_mit_angabe: 1, stufen_ohne_angabe: 1 });
  assert.equal(je[4].status, "warnung");
});

test("S-B7 Kosten: Stand der Datenbank vom 08.11.2026 nachgestellt — 10 Assets, 1,0977068 USD, 0 Läufe ohne Kostenangabe", async () => {
  gemessenerStand();
  const { body } = await hole();
  assert.equal(body.assets.gesamt, 10);
  assert.equal(body.assets.wert.length, 10);
  assert.equal(body.kosten_usd.status, "ok", body.kosten_usd.hinweis);
  assert.deepEqual(body.kosten_usd.wert, {
    summe: 1.0977068,
    laeufe: 10,
    laeufe_mit_angabe: 10,
    laeufe_ohne_angabe: 0,
    laeufe_unvollstaendig: 0,
    laeufe_alte_preistabelle: 10,
  });
  assert.equal(body.assets.wert.reduce((n, a) => n + a.kosten_usd.wert.stufen_gelaufen, 0), 36);
});

test("S-B8 Teil 'noch nicht gebaut': Credits (Schritt 7) und Messplan (Schritt 11) ohne Zahl, nie 0", async () => {
  standardWelt();
  const { body } = await hole();
  assert.deepEqual(body.kosten_credits, {
    wert: null,
    status: "noch_nicht_gebaut",
    quelle: "Higgsfield-Credits je Medium",
    gemessen_am: null,
    hinweis: "noch nicht gebaut (Schritt 7)",
    schritt: 7,
  });
  assert.deepEqual(body.messung, {
    wert: null,
    status: "noch_nicht_gebaut",
    quelle: "Messplan des Studios",
    gemessen_am: null,
    hinweis: "noch nicht gebaut (Schritt 11)",
    schritt: 11,
  });
  // Ohne Läufe: keine Summe (null), kein 0-Platzhalter.
  zuruecksetzen();
  welt.objekteAntwort = exportAntwort();
  const leer = (await hole()).body;
  assert.equal(leer.assets.gesamt, 0);
  assert.deepEqual(leer.assets.wert, []);
  assert.equal(leer.kosten_usd.wert.summe, null);
  assert.match(leer.kosten_usd.hinweis, /keine Läufe zu diesem Objekt/);
});

test("S-B9 Teilfehler Supabase: nur assets und kosten_usd 'fehler' (wert null, keine halbe Liste), objekt bleibt, HTTP 200", async () => {
  standardWelt();
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "content" ? { status: 500, body: { message: "connection refused" } } : null);
  const r = await hole();
  assert.equal(r.status, 200);
  assert.equal(r.body.objekt.status, "ok");
  const a = r.body.assets;
  assert.equal(a.status, "fehler");
  assert.equal(a.wert, null);
  assert.equal(a.gesamt, null);
  assert.equal(a.fehler_art, "supabase");
  assert.match(a.hinweis, /connection refused/);
  assert.ok(Date.parse(a.gemessen_am) > 0, "Zeitpunkt des Versuchs");
  assert.equal(r.body.kosten_usd.status, "fehler");
  assert.equal(r.body.kosten_usd.wert, null);
  assert.equal(r.body.kosten_usd.fehler_art, "supabase");
  // Ohne Service-Schlüssel: Konfiguration, Supabase nicht abgefragt.
  zuruecksetzen();
  welt.objekteAntwort = exportAntwort();
  delete process.env.SUPABASE_SERVICE_KEY;
  const ohne = await hole();
  assert.equal(ohne.body.assets.fehler_art, "konfiguration");
  assert.match(ohne.body.assets.hinweis, /Service-Schlüssel \(Server-Umgebung\) nicht gesetzt/);
  assert.equal(welt.log.length, 0);
});

test("S-B10 Unlesbare Zeile: der ganze Teil assets ist 'fehler', nie eine halbe Liste", async () => {
  standardWelt();
  welt.content.find((z) => z.id === 3).created_at = null;
  const { body } = await hole();
  assert.equal(body.assets.status, "fehler");
  assert.equal(body.assets.wert, null);
  assert.match(body.assets.hinweis, /Eintrag 3 ohne lesbares created_at/);
  assert.equal(body.kosten_usd.status, "fehler");
});

test("S-B11 Abgeschnitten: mehr Zeilen als geladen → 'warnung' mit Zählung, Kosten als Untergrenze", async () => {
  welt.objekteAntwort = exportAntwort();
  for (let i = 1; i <= 501; i++) lauf(i, { steps: ALT });
  const { body } = await hole();
  assert.equal(body.assets.status, "warnung");
  assert.equal(body.assets.gesamt, 501);
  assert.equal(body.assets.wert.length, 500);
  assert.match(body.assets.hinweis, /nur 500 von 501 Zeilen geladen/);
  assert.equal(body.kosten_usd.status, "warnung");
  assert.match(body.kosten_usd.hinweis, /Untergrenze: nur 500 von 501 Läufen geladen/);
});

test("S-B12 Teilfehler Export: nur objekt 'fehler' mit Ursache wie /api/objekte; Assets bleiben lesbar", async () => {
  const faelle = [
    [{ status: 502, body: { fehler: "quelle_nicht_erreichbar", fehler_art: "nicht_erreichbar", objekte: [] } }, "nicht_erreichbar", "quelle_nicht_erreichbar"],
    [{ status: 502, body: { fehler: "quelle_http_503", fehler_art: "quelle_fehler", objekte: [] } }, "quelle_fehler", "quelle_http_503"],
    [{ status: 500, body: { fehler: "Export-Token (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration", objekte: [] } }, "konfiguration", "Export-Token (Server-Umgebung) nicht gesetzt"],
    [{ status: 401, body: { error: "Unauthorized" } }, "nicht_angemeldet", "HTTP 401"],
    [{ status: 502, body: { fehler: "quelle_antwort_unlesbar" } }, "quelle_fehler", "quelle_antwort_unlesbar"],
    [exportAntwort([VILLA]), "nicht_im_export", "Objekt „rittergut-seifersdorf“ nicht im Steinadel-Export"],
    [{ status: 200, body: { version: "1" } }, "quelle_fehler", "Antwort ohne Objektliste"],
    [{ wirf: new TypeError("fetch failed") }, "nicht_erreichbar", "fetch failed"],
  ];
  for (const [antwort, art, hinweis] of faelle) {
    zuruecksetzen();
    lauf(1, { steps: ALT });
    welt.objekteAntwort = antwort;
    const r = await hole();
    assert.equal(r.status, 200);
    const o = r.body.objekt;
    assert.equal(o.status, "fehler", art);
    assert.equal(o.wert, null);
    assert.equal(o.fehler_art, art);
    assert.equal(o.hinweis, hinweis);
    assert.equal(r.body.assets.status, "ok");
    assert.equal(r.body.assets.gesamt, 1);
  }
  // Dieselbe Zuordnung wie die Anzeige von Lagebild und /expose (objekteFehlerArt).
  for (const code of ["quelle_nicht_erreichbar", "quelle_http_500", "quelle_antwort_unlesbar", "etwas anderes"]) {
    zuruecksetzen();
    welt.objekteAntwort = { status: 502, body: { fehler: code } };
    const o = (await hole()).body.objekt;
    assert.equal(o.fehler_art, hooksStatus.objekteFehlerArt(code), code);
  }
});

test("S-B13 Programmfehler: 500 mit fehler_art 'programmfehler' und bereinigtem Grund", async () => {
  standardWelt();
  const r = await hole(SLUG, { params: Promise.reject(new Error("params kaputt bei https://intern.example/x")) });
  assert.equal(r.status, 500);
  assert.equal(r.body.fehler_art, "programmfehler");
  assert.equal(r.body.fehler, "Studio nicht ermittelbar: params kaputt bei [URL]");
  assert.equal(r.kopf.get("cache-control"), "no-store");
});

test("S-B14 Maskierung: kein geschützter Name in den Anzeigefeldern der Antwort (Kopf, Titel, Urteil, Sperrgrund, Hinweise)", async () => {
  welt.objekteAntwort = exportAntwort([{ ...RITTERGUT, name: `RitterGut ${NAME}`, ort: `Ort ${NAME}`, preis: `Preis ${NAME}` }], { version: `v-${NAME}` });
  lauf(1, {
    title: `Titel ${NAME}`,
    status: `status-${NAME}`,
    steps: ALT,
    body: `${TEXT} ${NAME}`,
    review_notes: `Regel (${NAME}) beachtet.\nURTEIL: FREIGABE`,
    platform: `${NAME}-kanal`,
    content_type: `${NAME}-format`,
  });
  const { body } = await hole();
  const sichtbar = JSON.stringify(ohneBeleg(body));
  assert.doesNotMatch(sichtbar, ENTHAELT_NAMEN);
  assert.ok(sichtbar.includes(regeln.NAMENS_ERSATZ));
  const a = body.assets.wert[0];
  assert.equal(a.titel, `Titel ${regeln.NAMENS_ERSATZ}`);
  assert.equal(a.kanal, `${regeln.NAMENS_ERSATZ}-kanal`);
  assert.match(a.freigabe_sperre, /Freigabetext enthält einen geschützten Namen/);
  // Die Beleg-Daten bleiben roh (wie /content): Die Prüfregel braucht den echten Freigabetext.
  assert.match(a.beleg.body, ENTHAELT_NAMEN);
});

test("S-B15 Route: nur GET, dynamic 'force-dynamic', runtime 'nodejs'; lesen.ts nur serverseitig ('server-only')", async () => {
  const r = await route();
  assert.equal(r.dynamic, "force-dynamic");
  assert.equal(r.runtime, "nodejs");
  assert.deepEqual(Object.keys(r).filter((k) => /^[A-Z]+$/.test(k)), ["GET"]);
  const lesen = readFileSync(path.join(SITE, "src/lib/studio/lesen.ts"), "utf8");
  const sf = ts.createSourceFile("lesen.ts", lesen, ts.ScriptTarget.Latest, true);
  assert.ok(sf.statements.some((s) => ts.isImportDeclaration(s) && !s.importClause && s.moduleSpecifier.text === "server-only"));
});

// ═══ C: Studio-Ansicht und -Seite ═══

async function ansicht() {
  const studio = ladeStudioBausteine({ ...ECHT, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln });
  return ladeTsx("components/studio/StudioAnsicht.tsx", {
    ...ECHT,
    ...studio.module,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks-status": hooksStatus,
    "@/lib/types": types,
    "@/lib/studio/objekte": await objekteModul(),
    "@/lib/studio/regeln": await regelnStudio(),
  });
}

async function studioHtml(antwort, slug = SLUG) {
  const V = await ansicht();
  return renderToStaticMarkup(
    React.createElement(V.StudioAnsicht, { slug, lesung: { art: "daten", antwort }, kopiere: () => {}, kopierStatus: () => "Kopieren" }),
  );
}

const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
/** Sichtbarer Text (ohne Tags und title-Attribute). */
const sichtbar = (html) => ent(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

test("S-C1 Abnahme Seite: Kopf mit 'Ersterwähnung 1335' und Export-Zeitpunkt, Preis wörtlich, Denkmal-AfA", async () => {
  standardWelt();
  const { body } = await hole();
  const html = await studioHtml(body);
  const t = sichtbar(html);
  assert.ok(t.includes("Testort · Ersterwähnung 1335 · Status Vermarktung"), t.slice(0, 900));
  assert.ok(!t.includes("Baujahr 1335"));
  // Nachbesserung 08.11.2026 (Prüfbefund K1): fester Sollwert in Europe/Berlin mit Zonenangabe statt
  // types.datumZeit(GENERIERT) — das war dieselbe Funktion wie in der Ansicht und hing an der Zone des Prozesses.
  assert.ok(t.includes("Quelle: Steinadel-Export · erzeugt 08.11.2026 08:30:00 (Europe/Berlin) · abgerufen"), t.slice(0, 1400));
  assert.ok(t.includes("ab 123.456 € (Testwert)"));
  assert.ok(t.includes("Denkmal-AfA bis 100 %"));
  assert.ok(t.includes("Laut Steinadel-Objektdaten ist 1335 das Jahr der Ersterwähnung, nicht das Baujahr."));
  assert.ok(t.includes(`Export-Kopf „${regeln.NAMENS_ERSATZ} Backoffice“`));
  assert.doesNotMatch(html, /MARKER-FREITEXT/, "keine Freitexte des Exports im Kopf");
});

test("S-C2 Abnahme Seite: Asset-Anzahl aus der Antwort (DB-Zählung), je Asset Karte mit Beleg-Kette", async () => {
  gemessenerStand();
  const { body } = await hole();
  const html = await studioHtml(body);
  const kachel = /data-teil="assets"[^>]*>.*?<\/div><\/div>/s.exec(html)?.[0] ?? "";
  assert.ok(sichtbar(kachel).includes("Assets (Text) 10 Zählung der Abfrage"), sichtbar(kachel));
  assert.equal((html.match(/data-asset="\d+"/g) ?? []).length, 10);
  assert.equal((html.match(/<summary[^>]*>Beleg-Kette anzeigen<\/summary>/g) ?? []).length, 10);
  assert.equal((html.match(/<h4[^>]*>Beleg-Kette<\/h4>/g) ?? []).length, 10, "dieselbe Beleg-Kette wie /content");
  const t = sichtbar(html);
  assert.ok(t.includes("#8 Zur Freigabe Text · newsletter · newsletter_issue"), t.slice(0, 3000));
  assert.ok(t.includes("COUNSEL-Urteil (abgeleitet) ABLEHNUNG"));
  // Abgeschnitten: Die Kachel nennt die Zählung der Abfrage (501), nicht die geladenen Zeilen (500).
  zuruecksetzen();
  welt.objekteAntwort = exportAntwort();
  for (let i = 1; i <= 501; i++) lauf(i, { steps: ALT });
  const lang = await studioHtml((await hole()).body);
  const kachelLang = /data-teil="assets"[^>]*>.*?<\/div><\/div>/s.exec(lang)?.[0] ?? "";
  assert.ok(sichtbar(kachelLang).includes("Assets (Text) 501 Zählung der Abfrage · Supabase · content · 500 geladen"), sichtbar(kachelLang));
  assert.ok(sichtbar(lang).includes("nur 500 von 501 Zeilen geladen"));
});

test("S-C3 Abnahme Seite: Kosten als USD-Schätzung mit 'n Läufe ohne Kostenangabe'", async () => {
  gemessenerStand();
  const t1 = sichtbar(await studioHtml((await hole()).body));
  assert.ok(t1.includes("Claude-Kosten (USD, geschätzt) $1,0977 0 Läufe ohne Kostenangabe · 10 Läufe gesamt"), t1.slice(0, 2500));
  zuruecksetzen();
  standardWelt();
  const t2 = sichtbar(await studioHtml((await hole()).body));
  assert.ok(t2.includes("Claude-Kosten (USD, geschätzt) ≥ $0,1150 1 Lauf ohne Kostenangabe · 4 Läufe gesamt"), t2.slice(0, 2500));
  assert.ok(t2.includes("$0,0150 geschätzt · 5 von 5 gelaufenen Stufen mit Angabe"));
  assert.ok(t2.includes("keine Stufen gespeichert (metadata.steps fehlt)"));
});

test("S-C4 Seite: Anker, Video/Medien, Credits und Messplan 'noch nicht gebaut (Schritt N)' — ohne Zahl, kein 0-Platzhalter", async () => {
  standardWelt();
  const html = await studioHtml((await hole()).body);
  const t = sichtbar(html);
  for (const [titel, schritt] of [["Anker-Material", 6], ["Video / Medien", 7], ["Higgsfield-Credits", 7], ["Messplan", 11]]) {
    assert.ok(t.includes(`${titel} noch nicht gebaut (Schritt ${schritt})`), `${titel}: ${t.slice(0, 2500)}`);
  }
  for (const teil of ["kosten_credits", "messung"]) {
    const kachel = new RegExp(`data-teil="${teil}"[^>]*>.*?</div></div>`, "s").exec(html)?.[0] ?? "";
    assert.ok(kachel, teil);
    assert.doesNotMatch(sichtbar(kachel).replace(/Schritt \d+/g, ""), /\d/, `${teil}: keine Zahl außer dem Bauschritt`);
  }
  // Leeres Objekt: "keine Läufe" statt "$0".
  zuruecksetzen();
  welt.objekteAntwort = exportAntwort();
  const leer = sichtbar(await studioHtml((await hole()).body));
  assert.ok(leer.includes("Claude-Kosten (USD, geschätzt) keine Läufe 0 Läufe ohne Kostenangabe · 0 Läufe gesamt"), leer.slice(0, 2000));
  assert.ok(leer.includes("Die Abfrage lieferte keine content-Zeile mit metadata.objekt_slug = rittergut-seifersdorf"));
  assert.doesNotMatch(leer, /\$0/);
});

test("S-C5 Seite bei Teilfehlern: 'nicht lesbar' mit Grund, keine leere Liste, keine 0", async () => {
  standardWelt();
  welt.stoerung = (a) => (a.art === "supabase" ? { status: 500, body: { message: "connection refused" } } : null);
  welt.objekteAntwort = { status: 502, body: { fehler: "quelle_nicht_erreichbar", fehler_art: "nicht_erreichbar", objekte: [] } };
  const html = await studioHtml((await hole()).body);
  const t = sichtbar(html);
  assert.ok(t.includes("EXPORT OFFLINE — Steinadel-Export · Objektkopf nicht lesbar"), t.slice(0, 1500));
  assert.ok(t.includes("Fehler: Steinadel-Export nicht erreichbar"));
  assert.ok(t.includes("Assets (Text) nicht lesbar"));
  assert.ok(t.includes("Claude-Kosten (USD, geschätzt) nicht lesbar"));
  assert.ok(t.includes("Assets nicht lesbar: connection refused"));
  assert.ok(!t.includes("keine content-Zeile"), "keine Leermeldung bei Lesefehler");
  assert.equal((html.match(/data-asset=/g) ?? []).length, 0);
  // Keine 0 in Kopf, Kennzahlen und Asset-Bereich (die Regel-Liste nennt "Pflicht-Element 0" als Fundstelle).
  const ohneRegeln = sichtbar(html.slice(0, html.lastIndexOf("<section", html.indexOf("data-regeln"))));
  assert.doesNotMatch(ohneRegeln.replace(/Schritt \d+|HTTP \d+|\d{1,2}\.\d{1,2}\.\d{4}, \d{2}:\d{2}:\d{2}/g, ""), /\b0\b|\$0/, "keine 0");
});

test("S-C6 Seite: Maskierung — kein geschützter Name im Markup, auch nicht aus Beleg-Daten", async () => {
  welt.objekteAntwort = exportAntwort([{ ...RITTERGUT, name: `RitterGut ${NAME}` }]);
  lauf(1, {
    title: `Titel ${NAME}`,
    steps: [gelaufen("researcher", 0.01, { output: `Quelle ${NAME}` }), gelaufen("scribe", 0.01), gelaufen("counsel", 0.01)],
    body: `${TEXT} ${NAME}`,
    review_notes: `Regel (${NAME}) beachtet.\nURTEIL: ABLEHNUNG`,
    extra: { cta_link: `https://steinadel.de/${NAME}/l/k`, utm_content: `x-${NAME}-1` },
  });
  const html = await studioHtml((await hole()).body);
  assert.doesNotMatch(ent(html), ENTHAELT_NAMEN);
  assert.ok(ent(html).includes(`RitterGut ${regeln.NAMENS_ERSATZ}`));
  assert.ok(html.includes('data-cta-sperre="name"'), "CTA mit Namen gesperrt wie auf /content");
});

test("S-C7 Seite: keine Knöpfe, die etwas auslösen; Regeln mit Fundstellen, darunter der Bauträger — ohne Namen", async () => {
  gemessenerStand();
  const html = await studioHtml((await hole()).body);
  const t = sichtbar(html);
  // Einzige Knöpfe: "Kopieren" des CTA-Links in den Beleg-Ketten (wie /content), keiner sonst.
  const knoepfe = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
  assert.ok(knoepfe.every((k) => k === "Kopieren"), knoepfe.join(" | "));
  for (const verboten of ["Neues Asset", "Alle prüfen", "Text erzeugen", ">Freigeben</button>", "Video einspielen"]) {
    const i = html.indexOf(verboten);
    assert.ok(i < 0, `${verboten}: ${html.slice(Math.max(0, i - 300), i + 40)}`);
  }
  const { STUDIO_REGELN } = await regelnStudio();
  assert.ok(STUDIO_REGELN.length >= 8);
  for (const r of STUDIO_REGELN) {
    assert.ok(t.includes(r.regel) && t.includes(`Fundstelle: ${r.fundstelle} · Prüfung: ${r.pruefung}`), r.regel);
    assert.doesNotMatch(r.fundstelle, INTERNE_VERWEISE, r.fundstelle);
  }
  assert.ok(t.includes("Bauträger öffentlich nicht namentlich nennen."));
  // "Bauträger" steht nur in dieser Regel; der Satz endet nach "nennen", es folgt kein Name.
  assert.equal((t.match(/Bauträger/g) ?? []).length, 1);
  assert.doesNotMatch(html, /MARKER-FREITEXT/);
});

test("S-C8 Seite responsiv (Klassen, kein Browser): Raster einspaltig unter sm, min-w-0, keine feste Breite über 343 px", async () => {
  standardWelt();
  const html = await studioHtml((await hole()).body);
  assert.match(html, /^<div class="boot p-4 sm:p-6 lg:p-10 max-w-\[1280px\] min-w-0">/);
  const raster = [...html.matchAll(/class="(grid [^"]*)"/g)].map((m) => m[1]);
  assert.ok(raster.length >= 4, raster.join(" | "));
  for (const r of raster) {
    // Die Beleg-Kette (aus /content) setzt auf schmalen Bildschirmen keine Spalten (grid gap-1 sm:grid-cols-…).
    assert.ok(/(^|\s)grid-cols-1(\s|$)/.test(r) || !/(^|\s)grid-cols-\d/.test(r), r);
  }
  for (const m of html.matchAll(/(?:^|[\s"])(?:min-)?w-\[(\d+)px\]/g)) assert.ok(Number(m[1]) <= 343, m[0]);
});

test("S-C9 Seite: Lesen über useParams und GET /api/studio/<slug> ohne Cache; 404 und Netzfehler sichtbar", async () => {
  const V = await ansicht();
  const erfasst = [];
  /** Frische Hook-Laufzeit und Seite je Fall (der Zustand gehört zur Laufzeit). */
  function neueSeite() {
    const lz = hookLaufzeit();
    const seite = ladeTsx("app/studio/[objekt]/page.tsx", {
      ...lz.attrappen,
      "next/navigation": { useParams: () => ({ objekt: SLUG }) },
      "@/components/studio/StudioAnsicht": {
        StudioAnsicht: (props) => {
          erfasst.push(props);
          return null;
        },
        leseStudioAntwort: V.leseStudioAntwort,
      },
      "@/components/studio/beleg-hilfen": { maskiert: regeln.maskiereGeschuetzteNamen },
    });
    lz.setzeWurzel(seite.default);
    return lz;
  }
  const abrufe = [];
  const vorher = globalThis.fetch;
  try {
    standardWelt();
    const echt = (await hole()).body;
    for (const [antwort, erwartet] of [
      [() => ({ status: 200, json: async () => echt }), (l) => l.art === "daten" && l.antwort.objekt_slug === SLUG],
      [() => ({ status: 404, json: async () => ({ fehler: "Objekt nicht im Studio", fehler_art: "nicht_im_studio" }) }), (l) => l.art === "abgewiesen" && l.text === "Objekt nicht im Studio (HTTP 404)"],
      [() => ({ status: 401, json: async () => ({ error: "Unauthorized" }) }), (l) => l.art === "abgewiesen" && l.text.startsWith("Nicht angemeldet (HTTP 401)")],
      [() => { throw new TypeError(`Failed to fetch ${NAME}`); }, (l) => l.art === "abgewiesen" && l.httpStatus === null && l.text === `Netzfehler: Failed to fetch ${regeln.NAMENS_ERSATZ}`],
    ]) {
      globalThis.fetch = async (url, init) => {
        abrufe.push([url, init?.cache]);
        return antwort();
      };
      erfasst.length = 0;
      const lz = neueSeite();
      lz.rendere();
      await lz.ruhe();
      assert.equal(erfasst[0].lesung.art, "laedt", "erst 'lädt'");
      const letzte = erfasst[erfasst.length - 1];
      assert.equal(letzte.slug, SLUG);
      assert.ok(erwartet(letzte.lesung), JSON.stringify(letzte.lesung).slice(0, 300));
      assert.equal(typeof letzte.kopiere, "function");
      assert.equal(letzte.kopierStatus("x"), "Kopieren");
    }
  } finally {
    globalThis.fetch = vorher;
  }
  assert.ok(abrufe.length >= 4);
  assert.ok(abrufe.every(([url, cache]) => url === "/api/studio/rittergut-seifersdorf" && cache === "no-store"), JSON.stringify(abrufe));
  // Die Ansicht zeigt die Abweisung mit dem Text der Route.
  const html = renderToStaticMarkup(
    React.createElement(V.StudioAnsicht, { slug: "villa-x", lesung: V.leseStudioAntwort(404, { fehler: "Objekt nicht im Studio" }), kopiere: () => {}, kopierStatus: () => "Kopieren" }),
  );
  assert.ok(sichtbar(html).includes("Studio nicht lesbar Objekt nicht im Studio (HTTP 404)"));
  assert.ok(sichtbar(html).includes("Regeln, die mitlaufen"));
});

// ═══ D: Sidebar und /expose ═══

test("S-D1 Sidebar: 'Objekt-Studio' in der Gruppe Produktion auf /studio/rittergut-seifersdorf, aktiv auf dieser Seite", async () => {
  const S = ladeTsx("components/layout/Sidebar.tsx", {
    ...ECHT,
    "next/link": { __esModule: true, default: Link },
    "next/navigation": { usePathname: () => "/studio/rittergut-seifersdorf" },
    "@/lib/studio/objekte": await objekteModul(),
  });
  const html = renderToStaticMarkup(React.createElement(S.Sidebar, {}));
  const gruppen = html.split('<p class="mono-label px-3 mb-2">').slice(1);
  const produktion = gruppen.find((g) => g.startsWith("Produktion<"));
  assert.ok(produktion, "Gruppe Produktion");
  const links = [...produktion.matchAll(/<a href="([^"]+)"[^>]*>.*?<\/a>/g)].map((m) => [m[1], sichtbar(m[0]).trim()]);
  assert.deepEqual(links.map(([href]) => href), ["/expose", "/studio/rittergut-seifersdorf", "/content", "/academy"]);
  assert.equal(links[1][1], "◫ Objekt-Studio");
  assert.match(produktion, /<a href="\/studio\/rittergut-seifersdorf"[^>]*style="color:var\(--gp-gold-hi\)/, "aktiv");
});

test("S-D2 /expose: 'Im Studio öffnen' nur beim RitterGut, Ziel /studio/rittergut-seifersdorf; 'Kampagnen-Ablauf ansehen' bleibt", async () => {
  const lz = baumLaufzeit();
  const E = ladeTsx("app/expose/page.tsx", {
    ...lz.attrappen,
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => lz.attrappen["react/jsx-runtime"].jsx("a", { href, ...rest, children }) },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": hooksStatus,
    "@/lib/studio/objekte": await objekteModul(),
  });
  // useState-Reihenfolge der Seite: openSlug, zustand, objekte, generiertAm, abgerufenAm
  const baum = lz.rendere(E.default, {}, [null, "erfolg", [RITTERGUT, VILLA], GENERIERT, null]);
  const studioLinks = finde(baum, (k) => k.type === "a" && k.props["data-studio-link"] !== undefined);
  assert.equal(studioLinks.length, 1);
  assert.equal(studioLinks[0].props.href, "/studio/rittergut-seifersdorf");
  assert.equal(text(studioLinks[0]), "Im Studio öffnen →");
  const ablauf = finde(baum, (k) => k.type === "button" && text(k) === "Kampagnen-Ablauf ansehen →");
  assert.equal(ablauf.length, 2, "Knopf bleibt bei beiden Objekten");
});

// ═══ E: Regel 5 — Client-Code erreicht keine Server-Module ═══

/** Laufzeit-Importe einer Quelldatei (ohne import type, ohne reine Typ-Bindungen). */
function laufzeitImporte(datei) {
  const sf = ts.createSourceFile(datei, readFileSync(datei, "utf8"), ts.ScriptTarget.Latest, true);
  const ziele = [];
  for (const s of sf.statements) {
    if ((ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
      const klausel = ts.isImportDeclaration(s) ? s.importClause : null;
      if (klausel?.isTypeOnly || (ts.isExportDeclaration(s) && s.isTypeOnly)) continue;
      const benannt = klausel?.namedBindings;
      if (klausel && !klausel.name && benannt && ts.isNamedImports(benannt) && benannt.elements.every((e) => e.isTypeOnly)) continue;
      ziele.push(s.moduleSpecifier.text);
    }
  }
  return ziele;
}

function aufloesen(von, spez) {
  const basis = spez.startsWith("@/") ? path.join(SITE, "src", spez.slice(2)) : spez.startsWith(".") ? path.resolve(path.dirname(von), spez) : null;
  if (basis === null) return null;
  for (const k of [basis, `${basis}.ts`, `${basis}.tsx`]) {
    try {
      readFileSync(k);
      return k;
    } catch {
      // nächster Kandidat
    }
  }
  throw new Error(`nicht auflösbar: ${spez} (aus ${path.relative(SITE, von)})`);
}

test("S-E1 Regel 5: Studio-Seite, /expose und Sidebar erreichen weder Server-Module noch Prompts; nur die Route liest lesen.ts", () => {
  const verboten = ["src/lib/status-server.ts", "src/lib/studio/lesen.ts", "src/lib/agent-prompts.ts", "src/lib/steinadel-regelpaket.ts", "src/lib/supabase.ts"].map((d) => path.join(SITE, d));
  for (const start of ["src/app/studio/[objekt]/page.tsx", "src/app/expose/page.tsx", "src/components/layout/Sidebar.tsx", "src/components/studio/StudioAnsicht.tsx"]) {
    const gesehen = new Set();
    const offen = [path.join(SITE, start)];
    while (offen.length) {
      const datei = offen.pop();
      if (gesehen.has(datei)) continue;
      gesehen.add(datei);
      for (const spez of laufzeitImporte(datei)) {
        const ziel = aufloesen(datei, spez);
        if (ziel) offen.push(ziel);
      }
    }
    for (const v of verboten) assert.ok(!gesehen.has(v), `${start} erreicht ${path.relative(SITE, v)}`);
    assert.ok(gesehen.size > 1, start);
  }
  const routeImporte = laufzeitImporte(path.join(SITE, "src/app/api/studio/[objekt]/route.ts"));
  assert.ok(routeImporte.includes("@/lib/studio/lesen") && routeImporte.includes("@/lib/supabase"));
});

// ═══ N: Nachbesserung nach der Prüfung (08.11.2026) ═══
// Je Test der Prüfbefund in Klammern. Rückprobe: Die Tests zu SPEZ-1/2/3/4/5/6, K2 und SI-2 sind gegen
// den Stand vor der Nachbesserung (bc04472) rot; die zu K4 und SI-1 sichern unverändertes Verhalten ab
// und töten die Mutanten, die vorher die ganze Suite überlebten (MP1, MP2, MP3, MP6, MP7, MS1).

/** Karte eines Assets im Markup der Ansicht. */
function karteVon(html, id) {
  return new RegExp(`<article[^>]*data-asset="${id}".*?</article>`, "s").exec(html)?.[0] ?? "";
}

/** Kachel ab ihrem öffnenden Tag (ohne dessen title im sichtbaren Text). */
function kachelVon(html, teil) {
  return new RegExp(`<div[^>]*data-teil="${teil}"[^>]*>.*?</div></div>`, "s").exec(html)?.[0] ?? "";
}

/** Urteil-Anzeige als { stil, bezug, text }: in der Karte (data-karten-urteil) bzw. in der Beleg-Kette (data-urteil-anzeige). */
function urteilSpan(k, attribut) {
  const m = new RegExp(`<span[^>]*style="([^"]*)"[^>]*${attribut}="([^"]+)"[^>]*>([^<]*)</span>`).exec(k);
  return m ? { stil: m[1], bezug: m[2], text: ent(m[3]) } : null;
}

test("S-N1 (SPEZ-1) Karte: COUNSEL-Urteil nach R2 wie die Beleg-Kette — grünes FREIGABE nur bei genau geprüftem Freigabetext", async () => {
  welt.objekteAntwort = exportAntwort();
  const mitScribe = (output) => [gelaufen("researcher", 0.01), gelaufen("scribe", 0.01, { output }), gelaufen("counsel", 0.01), gelaufen("publisher", 0.01), gelaufen("amplifier", 0.01)];
  const ANDERS = `${TEXT} Nach der COUNSEL-Prüfung ergänzt.`;
  // Wie Zeile 2 am 08.11.2026 (SELECT): freigegeben, URTEIL FREIGABE, Freigabetext ungleich der SCRIBE-Fassung.
  lauf(1, { status: "freigegeben", steps: mitScribe(TEXT), body: ANDERS, review_notes: "## URTEIL: FREIGABE-EMPFEHLUNG" });
  lauf(2, { status: "zur_freigabe", steps: mitScribe(TEXT), body: TEXT, review_notes: FREIGABE });
  lauf(3, { status: "zur_freigabe", steps: mitScribe(TEXT), body: ANDERS, review_notes: FREIGABE });
  lauf(4, { status: "zur_freigabe", steps: [gelaufen("researcher", 0.01), { agent: "scribe", cost: 0.01, duration_ms: 1 }], body: TEXT, review_notes: FREIGABE });
  lauf(5, { status: "abgelehnt", steps: mitScribe(TEXT), body: TEXT, review_notes: "URTEIL: ABLEHNUNG" });
  const html = await studioHtml((await hole()).body);
  const erwartet = {
    1: ["abweichend", "COUNSEL prüfte die Vorfassung · Freigabetext ungeprüft", "var(--gp-amber)"],
    2: ["identisch", "FREIGABE", "var(--gp-emerald)"],
    3: ["abweichend", "COUNSEL prüfte die Vorfassung · Freigabetext ungeprüft", "var(--gp-amber)"],
    4: ["nicht_pruefbar", "FREIGABE der geprüften Fassung · Bezug zum Freigabetext nicht prüfbar", "var(--gp-amber)"],
    5: ["identisch", "ABLEHNUNG", "var(--gp-rose)"],
  };
  for (const [id, [bezug, text, farbe]] of Object.entries(erwartet)) {
    const k = karteVon(html, id);
    assert.ok(sichtbar(k).includes(`COUNSEL-Urteil (abgeleitet) ${text} · `), `${id}: ${sichtbar(k).slice(0, 400)}`);
    const karte = urteilSpan(k, "data-karten-urteil");
    assert.deepEqual(karte, { stil: `color:${farbe}`, bezug, text }, `Karte ${id}`);
    assert.deepEqual(urteilSpan(k, "data-urteil-anzeige"), karte, `Karte ${id}: dieselbe Anzeige wie ihre Beleg-Kette`);
  }
  // Feld "Freigabe": freigebbar, aber COUNSEL prüfte nicht genau diesen Text — Hinweis wie am Freigeben-Knopf auf /content.
  assert.ok(sichtbar(karteVon(html, 3)).includes("Freigabe freigebbar laut Server-Regel Freigabetext ungeprüft — COUNSEL prüfte die Vorfassung"));
  assert.ok(sichtbar(karteVon(html, 4)).includes("Freigabe freigebbar laut Server-Regel Bezug zur geprüften Fassung nicht prüfbar"));
  for (const id of [1, 2, 5]) assert.doesNotMatch(karteVon(html, id), /data-bezug-hinweis/, `Karte ${id}: gesperrt oder genau geprüft`);
});

test("S-N2 (SPEZ-2) Kosten: Vorbehalte der Schätzung stehen sichtbar unter den Kennzahlen, nicht nur im title", async () => {
  gemessenerStand();
  const { body } = await hole();
  assert.equal(body.kosten_usd.status, "ok");
  const html = await studioHtml(body);
  const t = sichtbar(html);
  assert.ok(t.includes(`Claude-Kosten: ${body.kosten_usd.hinweis}`), t.slice(0, 3000));
  assert.ok(t.includes("Schätzung, keine Abrechnung; maßgeblich ist die Anthropic-Rechnung"));
  assert.ok(t.includes("10 von 10 summierten Läufen vor dem 06.11.2026: mit der alten Preistabelle geschätzt und nicht umgerechnet"));
  // Bei Lesefehler kein zweiter Hinweis: Dann nennt die Kachel selbst den Grund.
  zuruecksetzen();
  standardWelt();
  welt.stoerung = (a) => (a.art === "supabase" ? { status: 500, body: { message: "connection refused" } } : null);
  const fehlerHtml = await studioHtml((await hole()).body);
  assert.doesNotMatch(fehlerHtml, /data-kosten-hinweis/);
  assert.ok(sichtbar(kachelVon(fehlerHtml, "kosten_usd")).includes("Läufe nicht lesbar: connection refused"));
});

test("S-N3 (SPEZ-3, K3) Abgeschnitten: Kosten-Kachel nennt die geladenen Läufe und die Zählung — nie die geladenen als 'gesamt'", async () => {
  welt.objekteAntwort = exportAntwort();
  for (let i = 1; i <= 501; i++) lauf(i, { steps: ALT });
  const html = await studioHtml((await hole()).body);
  const kosten = sichtbar(kachelVon(html, "kosten_usd"));
  assert.ok(kosten.includes("Claude-Kosten (USD, geschätzt) ≥ $40,0000 0 von 500 geladenen Läufen ohne Kostenangabe · 501 Läufe laut Zählung"), kosten);
  assert.ok(!kosten.includes("gesamt"), kosten);
  // Dieselbe Gesamtzahl wie die Assets-Kachel daneben.
  assert.ok(sichtbar(kachelVon(html, "assets")).includes("Assets (Text) 501 Zählung der Abfrage · Supabase · content · 500 geladen"));
});

test("S-N4 (K2) Ohne Zählung: Assets- und Kosten-Kachel nennen geladene Zeilen, nicht 'Zählung der Abfrage'", async () => {
  welt.objekteAntwort = exportAntwort();
  for (let i = 1; i <= 3; i++) lauf(i, { steps: ALT });
  // Supabase ohne content-range-Zählung: erste Seite mit den Zeilen, die nächste leer.
  welt.stoerung = (a) =>
    a.tabelle === "content" ? { status: 200, body: Number(a.params.get("offset") ?? 0) === 0 ? structuredClone(welt.content) : [] } : null;
  const { body } = await hole();
  assert.equal(body.assets.gesamt, null);
  assert.equal(body.assets.status, "warnung");
  const html = await studioHtml(body);
  const assets = sichtbar(kachelVon(html, "assets"));
  assert.ok(assets.includes("Assets (Text) 3 geladene Zeilen, ohne Zählung · Supabase · content"), assets);
  assert.ok(!assets.includes("Zählung der Abfrage"), assets);
  const kosten = sichtbar(kachelVon(html, "kosten_usd"));
  assert.ok(kosten.includes("0 von 3 geladenen Läufen ohne Kostenangabe · ohne Zählung"), kosten);
  assert.ok(sichtbar(html).includes("Supabase lieferte keine Zählung; gezählt sind die geladenen Zeilen"));
});

test("S-N6 (K4) Preiswechsel um Mitternacht Europe/Berlin: 05.11. 22:59:59Z alte, 23:00:00Z neue Preistabelle", async () => {
  welt.objekteAntwort = exportAntwort();
  lauf(1, { steps: ALT, am: "2026-11-05T22:59:59.999Z" });
  lauf(2, { steps: ALT, am: "2026-11-05T23:00:00Z" });
  const k = (await hole()).body.kosten_usd;
  assert.equal(k.wert.laeufe_alte_preistabelle, 1);
  assert.match(k.hinweis, /1 von 2 summierten Läufen vor dem 06\.11\.2026/);
});

test("S-N7 (K4) Altformat ohne status: Stufe mit output oder duration_ms, aber ohne cost, gilt als gelaufen ohne Kostenangabe", async () => {
  welt.objekteAntwort = exportAntwort();
  lauf(1, { steps: [gelaufen("researcher", 0.05), { agent: "scribe", output: "Text", duration_ms: 5 }, { agent: "counsel", duration_ms: 3 }, nichtGelaufen("publisher"), nichtGelaufen("amplifier")] });
  const { body } = await hole();
  const a = body.assets.wert[0].kosten_usd;
  assert.deepEqual(a.wert, { summe_usd: 0.05, stufen_gelaufen: 3, stufen_mit_angabe: 1, stufen_ohne_angabe: 2 });
  assert.equal(a.status, "warnung");
  assert.equal(a.hinweis, "Untergrenze: 2 Stufen von 3 gelaufenen ohne Kostenangabe");
  assert.equal(body.kosten_usd.wert.laeufe_unvollstaendig, 1);
  assert.equal(body.kosten_usd.status, "warnung");
});

/** Seite mit Hook-Laufzeit; useParams liest den Slug aus zustand.slug (der Test kann ihn wechseln). */
async function seitenLauf(slug = SLUG) {
  const V = await ansicht();
  const zustand = { slug };
  const erfasst = [];
  const lz = hookLaufzeit();
  const seite = ladeTsx("app/studio/[objekt]/page.tsx", {
    ...lz.attrappen,
    "next/navigation": { useParams: () => ({ objekt: zustand.slug }) },
    "@/components/studio/StudioAnsicht": {
      StudioAnsicht: (props) => {
        erfasst.push(props);
        return null;
      },
      leseStudioAntwort: V.leseStudioAntwort,
    },
    "@/components/studio/beleg-hilfen": { maskiert: regeln.maskiereGeschuetzteNamen },
  });
  lz.setzeWurzel(seite.default);
  return { lz, zustand, letzte: () => erfasst[erfasst.length - 1] };
}

/** fetch-Attrappe: Jeder Abruf wartet, bis der Test ihn beantwortet (auch nach einem Abbruch). */
function wartendesFetch() {
  const abrufe = [];
  const fetch = (url, init) =>
    new Promise((ok) => abrufe.push({ url, init, antworte: (status, daten) => ok({ status, json: async () => daten }) }));
  return { abrufe, fetch };
}

const NICHT_IM_STUDIO = { fehler: "Objekt nicht im Studio", fehler_art: "nicht_im_studio" };
const LESUNG_404 = { art: "abgewiesen", httpStatus: 404, text: "Objekt nicht im Studio (HTTP 404)" };

test("S-N8 (K4) Seite: Nach einem Slug-Wechsel steht 'lädt', bis die Antwort zum neuen Slug da ist", async () => {
  standardWelt();
  const echt = (await hole()).body;
  const f = wartendesFetch();
  const vorher = globalThis.fetch;
  globalThis.fetch = f.fetch;
  try {
    const s = await seitenLauf();
    s.lz.rendere();
    f.abrufe[0].antworte(200, echt);
    await s.lz.ruhe();
    assert.equal(s.letzte().lesung.art, "daten");
    s.zustand.slug = "villa-x";
    s.lz.rendere();
    assert.equal(s.letzte().slug, "villa-x");
    assert.equal(s.letzte().lesung.art, "laedt", "keine Daten des alten Objekts unter dem neuen Slug");
    assert.deepEqual(f.abrufe.map((a) => a.url), ["/api/studio/rittergut-seifersdorf", "/api/studio/villa-x"]);
    f.abrufe[1].antworte(404, NICHT_IM_STUDIO);
    await s.lz.ruhe();
    assert.deepEqual(s.letzte().lesung, LESUNG_404);
  } finally {
    globalThis.fetch = vorher;
  }
});

test("S-N9 (K4) Seite: Eine späte Antwort der abgebrochenen Lesung überschreibt die Lesung des neuen Slugs nicht", async () => {
  standardWelt();
  const echt = (await hole()).body;
  const f = wartendesFetch();
  const vorher = globalThis.fetch;
  globalThis.fetch = f.fetch;
  try {
    const s = await seitenLauf();
    s.lz.rendere();
    s.zustand.slug = "villa-x";
    s.lz.rendere();
    assert.equal(f.abrufe[0].init.signal.aborted, true, "der Wechsel bricht die alte Lesung ab");
    assert.equal(f.abrufe[1].init.signal.aborted, false);
    f.abrufe[1].antworte(404, NICHT_IM_STUDIO);
    await s.lz.ruhe();
    assert.deepEqual(s.letzte().lesung, LESUNG_404);
    // Die Antwort zum alten Slug kommt trotz Abbruch noch an — sie darf nichts mehr setzen.
    f.abrufe[0].antworte(200, echt);
    await s.lz.ruhe();
    assert.equal(s.letzte().slug, "villa-x");
    assert.deepEqual(s.letzte().lesung, LESUNG_404);
  } finally {
    globalThis.fetch = vorher;
  }
});

test("S-N10 (SI-1) Seite: Die Kennung aus useParams wird kodiert — kein Pfadwechsel auf andere API-Routen", async () => {
  const f = wartendesFetch();
  const vorher = globalThis.fetch;
  globalThis.fetch = f.fetch;
  try {
    for (const [roh, url] of [
      ["../freigaben", "/api/studio/..%2Ffreigaben"],
      ["a/b?x=1#y", "/api/studio/a%2Fb%3Fx%3D1%23y"],
      ["%2e%2e", "/api/studio/%252e%252e"],
    ]) {
      const s = await seitenLauf(roh);
      s.lz.rendere();
      assert.equal(f.abrufe[f.abrufe.length - 1].url, url, roh);
    }
  } finally {
    globalThis.fetch = vorher;
  }
});

/** Alle Dateien unter einem Ordner von site/. */
function dateienUnter(rel) {
  const voll = path.join(SITE, rel);
  return readdirSync(voll).flatMap((n) => {
    const p = path.join(voll, n);
    return statSync(p).isDirectory() ? dateienUnter(path.relative(SITE, p)) : [p];
  });
}

/** Verweise auf die nicht versionierte Planung, zusammengesetzt wie INTERNE_VERWEISE. */
const PLANUNGS_VERWEISE = new RegExp(["Spezi" + "fikation", "Studio-" + "Plan"].join("|"));

test("S-N11 (SI-2) Studio-Dateien ohne Verweise auf interne Planungsunterlagen", () => {
  const dateien = ["src/components/studio", "src/lib/studio", "src/app/studio", "src/app/api/studio"].flatMap(dateienUnter);
  assert.ok(dateien.length >= 10, dateien.join(", "));
  for (const d of dateien) {
    const text = readFileSync(d, "utf8");
    assert.doesNotMatch(text, INTERNE_VERWEISE, path.relative(SITE, d));
    assert.doesNotMatch(text, PLANUNGS_VERWEISE, path.relative(SITE, d));
  }
});

test("S-N12 (SPEZ-4) Regel KI-Hinweis: Fundstelle nennt 0f553a9 (Kennzeichnung) und 77229ef (ausgeschriebener, sichtbarer Text)", async () => {
  const { STUDIO_REGELN } = await regelnStudio();
  const ki = STUDIO_REGELN.filter((r) => r.regel.startsWith("KI-Hinweis als sichtbarer Text"));
  assert.equal(ki.length, 1);
  assert.match(ki[0].fundstelle, /\b0f553a9\b/);
  assert.match(ki[0].fundstelle, /\b77229ef\b/);
  // Die zitierte Datei trägt den Wortlaut, den 77229ef brachte (Pflicht-Element 2).
  const pipeline = readFileSync(path.join(SITE, "src/app/api/content/pipeline/route.ts"), "utf8");
  assert.match(pipeline, /2\. KI-KENNZEICHNUNG:[\s\S]{0,600}genügt NICHT/);
});

test("S-N13 (SPEZ-5) Higgsfield im Studio: nur der Hinweis auf den aktiven Erzeugungsweg (Connector-Sitzung), kein Knopf", async () => {
  standardWelt();
  const html = await studioHtml((await hole()).body);
  const t = sichtbar(html);
  assert.ok(
    t.includes("Higgsfield im Studio: aktiver Erzeugungsweg ist die Connector-Sitzung (Higgsfield-Connector in einer Claude-Sitzung). Das Studio ruft Higgsfield nicht auf."),
    t.slice(0, 3000),
  );
  const knoepfe = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
  assert.ok(knoepfe.every((k) => k === "Kopieren"), knoepfe.join(" | "));
});

test("S-N14 (SPEZ-6) Regeln: Anker-, Startbild- und Rechte-Regel stehen da — als 'noch nicht gebaut (Schritt N)', nicht als laufende Prüfung", async () => {
  const { STUDIO_REGELN } = await regelnStudio();
  standardWelt();
  const t = sichtbar(await studioHtml((await hole()).body));
  for (const [muster, schritt] of [[/^Anker-Bilder/, 6], [/Startbild/, 7], [/Nutzungsrechte/, 8]]) {
    const treffer = STUDIO_REGELN.filter((r) => muster.test(r.regel));
    assert.equal(treffer.length, 1, String(muster));
    const r = treffer[0];
    assert.equal(r.pruefung, `noch nicht gebaut (Schritt ${schritt})`, r.regel);
    assert.doesNotMatch(r.fundstelle, INTERNE_VERWEISE);
    assert.ok(t.includes(`${r.regel} Fundstelle: ${r.fundstelle} · Prüfung: noch nicht gebaut (Schritt ${schritt})`), r.regel);
  }
  // "darunter": Der Bauträger bleibt die letzte Regel.
  assert.equal(STUDIO_REGELN[STUDIO_REGELN.length - 1].regel, "Bauträger öffentlich nicht namentlich nennen.");
});

// ═══ M: Mutationsprüfung (08.11.2026) ═══
// Je Test in Klammern die Mutanten, die vorher die ganze Suite überlebten (Mutationslauf gegen 650a9b0 in
// einer eigenen Kopie). Jeder Test ist mit seinem Mutanten rot und ohne ihn grün; Produktcode unverändert.

/** Zeitpunkt in Europe/Berlin mit Zonenangabe, unabhängig von lib/types.ts gerechnet (wie in S-Z1). */
const BERLIN_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function berlinZeit(iso) {
  const t = Object.fromEntries(BERLIN_FORMAT.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${t.day}.${t.month}.${t.year} ${t.hour}:${t.minute}:${t.second} (Europe/Berlin)`;
}

/** Ansicht mit einer Lesung ohne Route (laden, Abweisung). */
async function lesungHtml(lesung, slug = SLUG) {
  const V = await ansicht();
  return renderToStaticMarkup(React.createElement(V.StudioAnsicht, { slug, lesung, kopiere: () => {}, kopierStatus: () => "Kopieren" }));
}

const NICHT_LESBAR_2XX = { art: "abgewiesen", httpStatus: 200, text: "Antwort ohne lesbare Studio-Teile" };

test("S-M1 (B18) Teilfehler Export: Der Fehlertext von /api/objekte geht nur bereinigt hinaus — ohne URL, ohne Schlüssel", async () => {
  lauf(1, { steps: ALT });
  // Der Testwert aus beforeEach (kein echter Schlüssel) steht im Fehlertext, dazu eine URL mit Token.
  const schluessel = process.env.SUPABASE_SERVICE_KEY;
  welt.objekteAntwort = {
    status: 502,
    body: { fehler: `upstream https://export.example/v1/objekte?token=abc antwortet nicht (${schluessel})`, fehler_art: "quelle_fehler" },
  };
  const { body } = await hole();
  const o = body.objekt;
  assert.equal(o.status, "fehler");
  assert.equal(o.fehler_art, "quelle_fehler");
  assert.equal(o.hinweis, "upstream [URL] antwortet nicht ([entfernt])");
  assert.equal(body.assets.status, "ok");
  // Die Ansicht zeigt den bereinigten Grund; roh steht er weder im Text noch im title.
  const html = await studioHtml(body);
  assert.ok(sichtbar(html).includes("Fehler: upstream [URL] antwortet nicht ([entfernt])"), sichtbar(html).slice(0, 1200));
  for (const roh of ["export.example", "token=abc", schluessel]) assert.ok(!ent(html).includes(roh), roh);
});

test("S-M2 (B19, B20) Kosten je Stufe: cost 0 ist eine gespeicherte Angabe, eine negative Zahl keine — Regel wie leseKosten der Pipeline", async () => {
  welt.objekteAntwort = exportAntwort();
  const rest = [nichtGelaufen("publisher"), nichtGelaufen("amplifier")];
  lauf(1, { steps: [gelaufen("researcher", 0), gelaufen("scribe", 0), gelaufen("counsel", 0), ...rest] });
  lauf(2, { steps: [gelaufen("researcher", 0.05), gelaufen("scribe", -0.5), gelaufen("counsel", 0.02), ...rest] });
  const { body } = await hole();
  const je = Object.fromEntries(body.assets.wert.map((a) => [a.id, a.kosten_usd]));
  // Drei gelaufene Stufen mit cost 0: eine gemessene 0 (ok), nicht "keine Kostenangabe".
  assert.equal(je[1].status, "ok", je[1].hinweis);
  assert.deepEqual(je[1].wert, { summe_usd: 0, stufen_gelaufen: 3, stufen_mit_angabe: 3, stufen_ohne_angabe: 0 });
  // cost −0,5 ist keine Angabe: nicht summiert, die Summe ist eine Untergrenze.
  assert.equal(je[2].status, "warnung");
  assert.deepEqual(je[2].wert, { summe_usd: 0.07, stufen_gelaufen: 3, stufen_mit_angabe: 2, stufen_ohne_angabe: 1 });
  assert.equal(je[2].hinweis, "Untergrenze: 1 Stufe von 3 gelaufenen ohne Kostenangabe");
  assert.equal(body.kosten_usd.status, "warnung");
  assert.deepEqual(body.kosten_usd.wert, {
    summe: 0.07,
    laeufe: 2,
    laeufe_mit_angabe: 2,
    laeufe_ohne_angabe: 0,
    laeufe_unvollstaendig: 1,
    laeufe_alte_preistabelle: 2,
  });
});

test("S-M3 (B24) Teilfehler Export: 2xx ohne lesbares JSON (etwa HTML eines Proxys) heißt 'Antwort von /api/objekte nicht lesbar'", async () => {
  lauf(1, { steps: ALT });
  const harnessFetch = globalThis.fetch;
  let status = 200;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.endsWith("/api/objekte")) {
      return new Response("<!doctype html><title>Proxy</title><p>Wartung</p>", { status, headers: { "content-type": "text/html" } });
    }
    return harnessFetch(input, init);
  };
  try {
    // Daneben derselbe HTML-Körper mit 502: Dann zählt nur der Status (wie exportFehlerAusAntwort ohne Fehlerfeld).
    for (const [s, art, hinweis] of [
      [200, "quelle_fehler", "Antwort von /api/objekte nicht lesbar"],
      [502, "unbekannt", "HTTP 502"],
    ]) {
      status = s;
      const r = await hole();
      assert.equal(r.status, 200);
      const o = r.body.objekt;
      assert.equal(o.status, "fehler", String(s));
      assert.equal(o.wert, null);
      assert.equal(o.fehler_art, art, String(s));
      assert.equal(o.hinweis, hinweis, String(s));
      assert.equal(r.body.assets.status, "ok", String(s));
    }
  } finally {
    globalThis.fetch = harnessFetch;
  }
});

test("S-M4 (B35, B36) Kosten tragen den Zeitpunkt der Lesung: kosten_usd und jede Asset-Angabe mit gemessen_am, sichtbar im title", async () => {
  standardWelt();
  const { body } = await hole();
  const gelesen = body.assets.gemessen_am;
  assert.ok(Number.isFinite(Date.parse(gelesen)), String(gelesen));
  assert.equal(body.kosten_usd.status, "warnung");
  assert.equal(body.kosten_usd.gemessen_am, gelesen);
  const je = Object.fromEntries(body.assets.wert.map((a) => [a.id, a.kosten_usd]));
  for (const [id, status] of [[1, "ok"], [2, "ok"], [4, "warnung"]]) {
    assert.equal(je[id].status, status, `Asset ${id}`);
    assert.equal(je[id].gemessen_am, gelesen, `Asset ${id}`);
  }
  // Objekt-Summe mit Status ok: Stand der Datenbank vom 08.11.2026 (S-B7).
  zuruecksetzen();
  gemessenerStand();
  const ok = (await hole()).body;
  assert.equal(ok.kosten_usd.status, "ok");
  assert.equal(ok.kosten_usd.gemessen_am, ok.assets.gemessen_am);
  // Ansicht: Kosten-Kachel und Kosten jeder Karte nennen im title den Zeitpunkt, nie "gemessen: nicht gemessen".
  const html = await studioHtml(ok);
  const zeit = `gemessen: ${berlinZeit(ok.assets.gemessen_am)}`;
  const kachelTitel = ent(/<div[^>]*data-teil="kosten_usd"[^>]*title="([^"]*)"/.exec(html)?.[1] ?? "");
  assert.ok(kachelTitel.includes(zeit), kachelTitel);
  const kartenTitel = [...html.matchAll(/<div class="min-w-0" title="([^"]*)"><dt class="mono-label">Kosten \(Claude, USD\)<\/dt>/g)].map((m) => ent(m[1]));
  assert.equal(kartenTitel.length, 10);
  for (const t of kartenTitel) assert.ok(t.includes(zeit), t);
});

test("S-M5 (C08) Seite: 2xx ohne die fünf Studio-Teile ist 'Studio nicht lesbar' — kein Absturz der Ansicht", async () => {
  standardWelt();
  const echt = (await hole()).body;
  const V = await ansicht();
  assert.equal(V.leseStudioAntwort(200, echt).art, "daten", "Gegenprobe: die Antwort der Route ist lesbar");
  const ohneMessung = structuredClone(echt);
  delete ohneMessung.messung;
  const statusOhneText = { ...structuredClone(echt), kosten_usd: { ...echt.kosten_usd, status: 1 } };
  for (const daten of [{ hallo: "welt" }, ohneMessung, statusOhneText, [], null]) {
    const lesung = V.leseStudioAntwort(200, daten);
    assert.deepEqual(lesung, NICHT_LESBAR_2XX, JSON.stringify(daten).slice(0, 80));
    const t = sichtbar(await lesungHtml(lesung));
    assert.ok(t.includes("Studio nicht lesbar Antwort ohne lesbare Studio-Teile"), t.slice(0, 800));
  }
  // Über die Seite: Die Ansicht bekommt die Abweisung, nicht die fremde Antwort als Daten.
  const vorher = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, json: async () => ({ hallo: "welt" }) });
  try {
    const s = await seitenLauf();
    s.lz.rendere();
    await s.lz.ruhe();
    assert.deepEqual(s.letzte().lesung, NICHT_LESBAR_2XX);
  } finally {
    globalThis.fetch = vorher;
  }
});

test("S-M6 (C17) Kopf: 'Denkmal-AfA bis …' nur, wenn der Export istDenkmal true meldet", async () => {
  for (const [istDenkmal, erwartet, status] of [
    [false, "AfA 5 % (laut Export kein Denkmal)", "ok"],
    [undefined, "AfA 5 % (Denkmal-Angabe nicht im Export)", "warnung"],
    [true, "Denkmal-AfA bis 5 %", "ok"],
  ]) {
    zuruecksetzen();
    const objekt = { ...RITTERGUT, afaProzent: 5, istDenkmal };
    if (istDenkmal === undefined) delete objekt.istDenkmal;
    welt.objekteAntwort = exportAntwort([objekt]);
    const { body } = await hole();
    assert.equal(body.objekt.status, status, String(istDenkmal));
    assert.deepEqual(body.objekt.wert.afa, { prozent: 5, denkmal: istDenkmal ?? null });
    const html = await studioHtml(body);
    const afa = /<dd[^>]*data-afa[^>]*>(.*?)<\/dd>/s.exec(html)?.[1] ?? "";
    assert.equal(sichtbar(afa).trim(), erwartet, String(istDenkmal));
  }
});

test("S-M7 (C18) Kopf: Fehlt das Objekt im Export, nennt die Seite genau diese Ursache — nicht 'Export nicht lesbar'", async () => {
  lauf(1, { steps: ALT });
  welt.objekteAntwort = exportAntwort([VILLA]);
  const { body } = await hole();
  assert.equal(body.objekt.fehler_art, "nicht_im_export");
  const html = await studioHtml(body);
  const kopf = /<section[^>]*data-teil="objekt"[^>]*>.*?<\/section>/s.exec(html)?.[0] ?? "";
  const t = sichtbar(kopf);
  assert.ok(t.includes("OBJEKT NICHT IM EXPORT — Steinadel-Export · Objektkopf nicht lesbar"), t);
  assert.ok(
    t.includes("Der Steinadel-Export wurde gelesen, enthält dieses Objekt aber nicht. Fehler: Objekt „rittergut-seifersdorf“ nicht im Steinadel-Export"),
    t,
  );
  assert.ok(!t.includes("EXPORT NICHT LESBAR"), t);
  assert.match(kopf, /<p class="mono-label" style="color:var\(--gp-rose\)">/);
});

test("S-M8 (C24) Pfad: Eine Kennung aus der URL mit dem geschützten Namen steht maskiert da — beim Laden und bei 404", async () => {
  const kennung = `${NAME.toLowerCase()}-villa`;
  const V = await ansicht();
  for (const lesung of [{ art: "laedt" }, V.leseStudioAntwort(404, NICHT_IM_STUDIO)]) {
    const html = await lesungHtml(lesung, kennung);
    assert.doesNotMatch(ent(html), ENTHAELT_NAMEN, lesung.art);
    const pfad = /<nav[^>]*aria-label="Pfad"[^>]*>.*?<\/nav>/s.exec(html)?.[0] ?? "";
    assert.ok(sichtbar(pfad).includes(`Objekt-Studio · ${regeln.NAMENS_ERSATZ}-villa`), sichtbar(pfad));
  }
});

test("S-M9 (F10) Abweisung: Ein Fehlertext der Route mit dem geschützten Namen erscheint maskiert — in der Lesung und im Markup", async () => {
  const V = await ansicht();
  for (const [status, daten, erwartet] of [
    [500, { fehler: `Studio nicht ermittelbar: ${NAME} antwortet nicht`, fehler_art: "programmfehler" }, `Studio nicht ermittelbar: ${regeln.NAMENS_ERSATZ} antwortet nicht (HTTP 500)`],
    [502, { error: `Bad Gateway (${NAME})` }, `Bad Gateway (${regeln.NAMENS_ERSATZ}) (HTTP 502)`],
  ]) {
    const lesung = V.leseStudioAntwort(status, daten);
    assert.deepEqual(lesung, { art: "abgewiesen", httpStatus: status, text: erwartet });
    const html = await lesungHtml(lesung);
    assert.doesNotMatch(ent(html), ENTHAELT_NAMEN, String(status));
    assert.ok(sichtbar(html).includes(`Studio nicht lesbar ${erwartet}`), sichtbar(html).slice(0, 800));
  }
  // Die Ansicht maskiert auch selbst ("der Server maskiert schon, die Ansicht noch einmal").
  const roh = await lesungHtml({ art: "abgewiesen", httpStatus: 500, text: `Fehler bei ${NAME}` });
  assert.doesNotMatch(ent(roh), ENTHAELT_NAMEN);
  assert.ok(sichtbar(roh).includes(`Studio nicht lesbar Fehler bei ${regeln.NAMENS_ERSATZ}`), sichtbar(roh).slice(0, 800));
});
