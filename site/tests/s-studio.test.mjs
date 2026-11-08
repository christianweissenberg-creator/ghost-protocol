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
import { readFileSync } from "node:fs";
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

beforeEach(() => {
  zuruecksetzen();
  process.env.SUPABASE_SERVICE_KEY = "service-test-key-1234567890abcdef";
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
  assert.ok(t.includes(`Quelle: Steinadel-Export · erzeugt ${types.datumZeit(GENERIERT)} · abgerufen`), t.slice(0, 1400));
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
