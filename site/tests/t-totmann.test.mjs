// Totmann für Crons und Agenten (Objekt-Studio Stufe 2, Rest aus Stufe 1). Lauf: npm test.
// Spezifikation: docs/intern/objekt-studio-stufe-2.md §2.2–2.5 (lokal, nicht versioniert). Die
// reinen Fälle der Tabelle in §2.5 stehen in tests/b-status-server.test.mjs; hier:
// - Routentests mit Attrappe: die ECHTEN Handler von /api/cron/briefing, /api/content/auto-produce
//   und /api/status im Prozess, Supabase (PostgREST), activate und die Pipeline aus
//   tests/harness/fake.mjs. Kein Netz — jeder andere fetch wirft. Die Umgebungswerte sind
//   Test-Werte dieses Prozesses, keine echten Schlüssel.
// - die Zeile „Crons" im Systemzustand (CommandPanels.tsx übersetzt, mit Attrappen geladen),
// - die SQL-Datei scripts/lauf_nachweis.sql (keine CHECK-Bedingung gegen now() oder eingetragen_am).
// Nachbesserung 07.11.2026 (Prüfbefunde Z1–Z8, B1–B11, SR-1–SR-8): je Befund ein Fall, im Namen
// genannt. Das Laden der Cron-Routen ohne NEXT_PUBLIC_SUPABASE_URL (SR-7) prüft
// tests/t-totmann-laden.test.mjs in einem eigenen Prozess.
// Z_ROUTE_<NAME>=<pfad> prüft statt der Repo-Route eine Kopie (Mutationstests im Scratchpad),
// Z_TSX_COMPONENTS_UI_COMMANDPANELS ebenso für die Anzeige (tests/harness/tsx.mjs).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { React, jsxRuntime, ladeTsx, renderToStaticMarkup } from "./harness/tsx.mjs";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// "@/…" → site/src/….ts, "next/server" → node_modules (ESM braucht die Endung), relative
// Importe ohne Endung aus .ts-Dateien → ".ts" (wie tests/z-routen.test.mjs).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/server.js")).href, context);
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
  ANTHROPIC_API_KEY: "sk-ant-harness-TESTWERT-0123456789abcdef",
  IMMONEXUS_EXPORT_TOKEN: "export-test-token-0123456789",
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
  CRON_SECRET: "cron-test-secret-0123456789",
  GP_SESSION_SECRET: "session-test-secret-0123456789",
});
delete process.env.CONTENT_LAUNCH_DATE;

const fake = await import("./harness/fake.mjs");
const { welt, zuruecksetzen } = fake;
fake.installiere();

const route = (name, rel) => import(pathToFileURL(process.env[`Z_ROUTE_${name}`] ?? path.join(SITE, "src/app/api", rel)).href);
const [briefing, auto, statusApi, { NextRequest }] = await Promise.all([
  route("BRIEFING", "cron/briefing/route.ts"),
  route("AUTO", "content/auto-produce/route.ts"),
  route("API_STATUS", "status/route.ts"),
  import("next/server"),
]);
const totmann = await import("../src/lib/totmann.ts");
const statusServer = await import("../src/lib/status-server.ts");
const types = await import("../src/lib/types.ts");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");

beforeEach(() => {
  zuruecksetzen();
});

// ── Hilfen ──

const inserts = () => welt.log.filter((e) => e.tabelle === "lauf_nachweis" && e.methode === "POST");
const lesungen = () => welt.log.filter((e) => e.tabelle === "lauf_nachweis" && e.methode === "GET");

/** Systemuhr der Routen festhalten (wie Z-K2 in tests/z-routen.test.mjs); new Date(x) bleibt echt. */
async function mitDatum(isoZeit, fn) {
  const Echt = Date;
  const t = Echt.parse(isoZeit);
  globalThis.Date = class extends Echt {
    constructor(...a) {
      if (a.length === 0) super(t);
      else super(...a);
    }
    static now() {
      return t;
    }
  };
  try {
    return await fn();
  } finally {
    globalThis.Date = Echt;
  }
}

/** console.error abfangen (Vermerk im Server-Log), ohne die Testausgabe zu füllen. */
async function mitFehlerLog(fn) {
  const alt = console.error;
  const log = [];
  console.error = (...a) => log.push(a.join(" "));
  try {
    return { wert: await fn(), log };
  } finally {
    console.error = alt;
  }
}

async function antwort(res) {
  return { status: res.status, body: await res.json() };
}

const briefingReq = (query = "?type=morning", kopf = { "x-cron-secret": process.env.CRON_SECRET }) =>
  new NextRequest(`http://harness.local/api/cron/briefing${query}`, { headers: kopf });
const autoReq = (query = "", kopf = { "x-cron-secret": process.env.CRON_SECRET }) =>
  new NextRequest(`http://harness.local/api/content/auto-produce${query}`, { headers: kopf });

const MONTAG = "2026-11-09T08:07:00Z"; // Mo 09.11.2026 09:07 Berlin
const SAMSTAG = "2026-11-14T11:00:00Z";

const STUFEN = ["researcher", "scribe", "counsel", "publisher", "amplifier"];
/** Kalender und Pipeline-Antwort als Attrappe (wie Z-K2); pipeline = Körper der POST-Antwort. */
function pipelineWelt(pipeline, postStatus = 200) {
  const eintrag = { platform: "x", format: "thread", topic: "KI-Agenten erklärt" };
  const tage = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map((t) => [t, eintrag]));
  const launch_calendar = Object.fromEntries([1, 2, 3, 4].map((w) => [`week${w}`, { theme: "Test", ...tage }]));
  welt.pipelineAntwort = { GET: { status: 200, body: { launch_calendar } }, POST: { status: postStatus, body: pipeline } };
}
const FERTIG = {
  pipeline: "content-first",
  contentId: 5,
  status: "complete",
  steps: STUFEN.map((agent) => ({ agent, status: "done", abgeschnitten: false, ...(agent === "publisher" ? { output: "Finaler Text" } : {}) })),
  summary: { total_cost_usd: 0.01, kosten_unvollstaendig: false, total_duration_ms: 5, completed: "5/5" },
  freigabe_hinweis: { identisch: false },
  speicherfehler: [],
};

const SCHLUESSEL_DER_ZEILE = ["beendet_am", "begonnen_am", "ergebnis", "hinweis", "http_status", "job", "teilergebnisse"];

// ═══ /api/cron/briefing ═══

test("T-R1 briefing: ?secret= → 400, falsches/fehlendes Secret → 401, unbekannter type → 400 — keine Zeile, kein Abruf", async () => {
  for (const [req, status] of [
    [briefingReq("?type=morning&secret=x"), 400],
    [briefingReq("?type=morning", { "x-cron-secret": "falsch" }), 401],
    [briefingReq("?type=morning", {}), 401],
    [briefingReq("?type=nacht"), 400],
  ]) {
    const res = await briefing.GET(req);
    assert.equal(res.status, status);
  }
  assert.equal(inserts().length, 0, "400 und 401 schreiben nichts");
  assert.equal(welt.log.length, 0, "kein Supabase-Zugriff");
  assert.equal(welt.aktivierungen.length, 0, "kein bezahlter Aufruf");
});

test("T-R2 briefing morning: genau ein Insert nach der Authentifizierung — Job briefing-morgen, ok, App-Uhr", async () => {
  const r = await mitDatum("2026-11-09T07:03:00Z", async () => antwort(await briefing.GET(briefingReq())));
  assert.equal(r.status, 200);
  assert.equal(r.body.nachweis_fehler, undefined);
  assert.equal(welt.aktivierungen.length, 2);
  assert.equal(inserts().length, 1);
  assert.equal(welt.log.length, 1, "der Insert ist der einzige Supabase-Zugriff");
  const z = inserts()[0].body;
  assert.deepEqual(Object.keys(z).sort(), SCHLUESSEL_DER_ZEILE, "eingetragen_am und id setzt die DB");
  assert.equal(z.job, "briefing-morgen");
  assert.equal(z.ergebnis, "ok");
  assert.equal(z.http_status, 200);
  assert.deepEqual(z.teilergebnisse, [
    { agent: "oracle", ergebnis: "ok", fehler: null },
    { agent: "donna", ergebnis: "ok", fehler: null },
  ]);
  assert.equal(z.hinweis, "2 von 2 Agenten vollständig");
  assert.equal(z.begonnen_am, "2026-11-09T07:03:00.000Z", "begonnen_am aus der App-Uhr");
  assert.ok(Date.parse(z.beendet_am) >= Date.parse(z.begonnen_am), "beendet_am aus derselben Uhr, nie davor");
  assert.equal(welt.tabellen.lauf_nachweis.length, 1);
});

test("T-R3 briefing: ein Agent scheitert → teilweise, beide → fehler, evening → Job briefing-abend", async () => {
  welt.agentAntworten.donna = [{ status: 502, body: { fehler: "leere Antwort" } }];
  const teil = await antwort(await briefing.GET(briefingReq()));
  assert.equal(teil.status, 200);
  const z1 = inserts()[0].body;
  assert.equal(z1.ergebnis, "teilweise");
  assert.deepEqual(z1.teilergebnisse[1], { agent: "donna", ergebnis: "fehler", fehler: "HTTP 502: leere Antwort" });

  zuruecksetzen();
  welt.agentAntworten.oracle = [{ status: 500, body: { fehler: "Anthropic-Schlüssel (Server-Umgebung) nicht gesetzt" } }];
  welt.agentAntworten.donna = [{ status: 502, body: { fehler: "leere Antwort" } }];
  await briefing.GET(briefingReq());
  assert.equal(inserts().length, 1);
  assert.equal(inserts()[0].body.ergebnis, "fehler");
  assert.equal(inserts()[0].body.http_status, 200, "die Route antwortet 200, das Ergebnis heißt trotzdem fehler");

  zuruecksetzen();
  await briefing.GET(briefingReq("?type=evening"));
  assert.equal(inserts().length, 1);
  assert.equal(inserts()[0].body.job, "briefing-abend");
  assert.deepEqual(inserts()[0].body.teilergebnisse.map((t) => t.agent), ["strategist"]);
});

test("T-R4 briefing: wirft der Lauf, steht trotzdem genau eine Zeile 'fehler' (finally); die Ausnahme geht weiter", async () => {
  const harnessFetch = globalThis.fetch;
  // activate antwortet ohne json(): res.json is not a function — ein Wurf mitten im Lauf.
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.endsWith("/api/agents/activate")) return { ok: true, status: 200 };
    return harnessFetch(input, init);
  };
  try {
    await assert.rejects(briefing.GET(briefingReq()), TypeError);
  } finally {
    globalThis.fetch = harnessFetch;
  }
  assert.equal(inserts().length, 1);
  const z = inserts()[0].body;
  assert.equal(z.job, "briefing-morgen");
  assert.equal(z.ergebnis, "fehler");
  assert.equal(z.http_status, null);
  assert.match(z.hinweis, /^Ausnahme: /);
});

// ═══ /api/content/auto-produce ═══

test("T-R5 auto-produce: ?secret= → 400, falsches/fehlendes Secret → 401 — keine Zeile, kein Abruf", async () => {
  for (const [req, status] of [
    [autoReq("?secret=x"), 400],
    [autoReq("?dry=true&secret=x"), 400],
    [autoReq("", { "x-cron-secret": "falsch" }), 401],
    [autoReq("?dry=true", {}), 401],
  ]) {
    const res = await auto.GET(req);
    assert.equal(res.status, status);
  }
  assert.equal(inserts().length, 0);
  assert.equal(welt.log.length, 0);
});

test("T-R6 auto-produce produced: genau ein Insert — Job content-auto-produce, ok, Teilergebnisse je Stufe", async () => {
  pipelineWelt(FERTIG);
  const r = await mitDatum(MONTAG, async () => antwort(await auto.GET(autoReq())));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "produced");
  assert.equal(inserts().length, 1);
  assert.equal(welt.log.length, 1);
  const z = inserts()[0].body;
  assert.deepEqual(Object.keys(z).sort(), SCHLUESSEL_DER_ZEILE);
  assert.equal(z.job, "content-auto-produce");
  assert.equal(z.ergebnis, "ok");
  assert.equal(z.http_status, 200);
  assert.deepEqual(z.teilergebnisse, STUFEN.map((agent) => ({ agent, ergebnis: "ok", fehler: null })));
  assert.equal(z.begonnen_am, "2026-11-09T08:07:00.000Z");
});

test("T-R7 auto-produce: HTTP 200 mit status 'fehler' ergibt die Zeile 'fehler' (Speicherfehler und Pipeline-fehler)", async () => {
  pipelineWelt({ ...FERTIG, speicherfehler: ["content-Update (zur_freigabe): permission denied"] });
  const speicher = await mitDatum(MONTAG, async () => antwort(await auto.GET(autoReq())));
  assert.equal(speicher.status, 200);
  assert.equal(speicher.body.status, "fehler");
  const z1 = inserts()[0].body;
  assert.equal(z1.ergebnis, "fehler");
  assert.equal(z1.http_status, 200);
  assert.match(z1.hinweis, /^status fehler · Speicherfehler: content-Update/);

  zuruecksetzen();
  const pending = STUFEN.slice(1).map((agent) => ({ agent, status: "pending" }));
  pipelineWelt({
    ...FERTIG,
    status: "fehler",
    fehler: { stufe: "researcher", grund: "Claude-API-Fehler: HTTP 529" },
    steps: [{ agent: "researcher", status: "error", fehler: "Claude-API-Fehler: HTTP 529" }, ...pending],
  });
  const pipe = await mitDatum(MONTAG, async () => antwort(await auto.GET(autoReq())));
  assert.equal(pipe.status, 200);
  assert.equal(pipe.body.status, "fehler");
  const z2 = inserts()[0].body;
  assert.equal(z2.ergebnis, "fehler");
  assert.equal(z2.hinweis, "status fehler · researcher: Claude-API-Fehler: HTTP 529");
  assert.deepEqual(z2.teilergebnisse.map((t) => [t.agent, t.ergebnis]), [
    ["researcher", "fehler"],
    ["scribe", "uebersprungen"],
    ["counsel", "uebersprungen"],
    ["publisher", "uebersprungen"],
    ["amplifier", "uebersprungen"],
  ]);
});

test("T-R8 auto-produce: 5xx ergibt 'fehler' (CONTENT_LAUNCH_DATE ungültig, Pipeline 500)", async () => {
  process.env.CONTENT_LAUNCH_DATE = "07.04.2026";
  try {
    const r = await mitDatum(MONTAG, async () => antwort(await auto.GET(autoReq())));
    assert.equal(r.status, 500);
  } finally {
    delete process.env.CONTENT_LAUNCH_DATE;
  }
  assert.equal(inserts().length, 1);
  assert.equal(inserts()[0].body.ergebnis, "fehler");
  assert.equal(inserts()[0].body.http_status, 500);
  assert.match(inserts()[0].body.hinweis, /CONTENT_LAUNCH_DATE ungültig/);

  zuruecksetzen();
  pipelineWelt({ status: "fehler", fehler: "Supabase-Insert fehlgeschlagen", steps: STUFEN.map((agent) => ({ agent, status: "pending" })) }, 500);
  const r2 = await mitDatum(MONTAG, async () => antwort(await auto.GET(autoReq())));
  assert.equal(r2.status, 500);
  assert.equal(inserts()[0].body.ergebnis, "fehler");
  assert.equal(inserts()[0].body.http_status, 500);
  assert.equal(inserts()[0].body.teilergebnisse.length, 5, "Schritte aus der Fehlerantwort der Pipeline");
});

test("T-R9 auto-produce: ?dry=true schreibt den Probe-Job; Wochenende → 'uebersprungen'", async () => {
  pipelineWelt(FERTIG);
  const probe = await mitDatum(MONTAG, async () => antwort(await auto.GET(autoReq("?dry=true"))));
  assert.equal(probe.body.status, "dry_run");
  assert.equal(inserts().length, 1);
  assert.equal(inserts()[0].body.job, "content-auto-produce-probe");
  assert.equal(inserts()[0].body.ergebnis, "ok");

  zuruecksetzen();
  const wochenende = await mitDatum(SAMSTAG, async () => antwort(await auto.GET(autoReq())));
  assert.equal(wochenende.body.status, "skipped");
  assert.equal(inserts().length, 1);
  assert.equal(inserts()[0].body.job, "content-auto-produce");
  assert.equal(inserts()[0].body.ergebnis, "uebersprungen");
  assert.equal(inserts()[0].body.hinweis, "status skipped · Wochenende — kein Content geplant");
});

test("T-R10 auto-produce: wirft der Lauf, steht trotzdem genau eine Zeile 'fehler'; die Ausnahme geht weiter", async () => {
  const harnessFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.endsWith("/api/content/pipeline")) return { ok: true, status: 200 };
    return harnessFetch(input, init);
  };
  try {
    await mitDatum(MONTAG, () => assert.rejects(auto.GET(autoReq()), TypeError));
  } finally {
    globalThis.fetch = harnessFetch;
  }
  assert.equal(inserts().length, 1);
  assert.equal(inserts()[0].body.ergebnis, "fehler");
  assert.equal(inserts()[0].body.http_status, null);
  assert.match(inserts()[0].body.hinweis, /^Ausnahme: /);
});

// ═══ Scheitert der Insert, bleibt die Antwort — nur der Vermerk kommt dazu ═══

const STOERUNGEN = [
  ["RLS verweigert", { status: 403, body: { code: "42501", details: null, hint: null, message: "permission denied for table lauf_nachweis" } }, /permission denied/],
  [
    "Tabelle fehlt (SQL nicht ausgeführt)",
    { status: 404, body: { code: "PGRST205", details: null, hint: null, message: "Could not find the table 'public.lauf_nachweis' in the schema cache" } },
    /Could not find the table/,
  ],
];

for (const [name, routeName, lauf] of [
  ["briefing", "briefing", () => briefing.GET(briefingReq())],
  [
    "auto-produce",
    "auto-produce",
    () => {
      pipelineWelt(FERTIG);
      return auto.GET(autoReq());
    },
  ],
]) {
  for (const [fall, stoerung, muster] of STOERUNGEN) {
    test(`T-R11 ${name}: Insert scheitert (${fall}) → Antwort unverändert bis auf nachweis_fehler, console.error`, async () => {
      const gut = await mitDatum(MONTAG, async () => antwort(await lauf()));
      assert.equal(inserts().length, 1);
      zuruecksetzen();
      welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "lauf_nachweis" && a.methode === "POST" ? stoerung : null);
      const { wert: schlecht, log } = await mitFehlerLog(() => mitDatum(MONTAG, async () => antwort(await lauf())));
      assert.equal(inserts().length, 1, "genau ein Versuch");
      assert.equal(schlecht.status, gut.status);
      assert.match(schlecht.body.nachweis_fehler, /^Lauf-Nachweis nicht geschrieben: /);
      assert.match(schlecht.body.nachweis_fehler, muster);
      const { nachweis_fehler, ...rest } = schlecht.body;
      assert.deepEqual(rest, gut.body, `${routeName}: nur der Vermerk unterscheidet die Antworten`);
      assert.ok(log.some((z) => z.startsWith("[totmann]") && z.includes(nachweis_fehler)), log.join("\n"));
    });
  }
}

test("T-R12 ohne Service-Schlüssel: Vermerk statt Insert, die Antwort bleibt 200", async () => {
  const schluessel = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  try {
    const { wert: r, log } = await mitFehlerLog(async () => antwort(await briefing.GET(briefingReq())));
    assert.equal(r.status, 200);
    assert.equal(r.body.nachweis_fehler, "Lauf-Nachweis nicht geschrieben: Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt");
    assert.equal(inserts().length, 0, "ohne Schlüssel kein Abruf");
    assert.ok(log.some((z) => z.startsWith("[totmann] briefing-morgen:")));
    assert.doesNotMatch(JSON.stringify(r.body), /SUPABASE_SERVICE_KEY/);
  } finally {
    process.env.SUPABASE_SERVICE_KEY = schluessel;
  }
});

// Prüfbefunde SR-8, B2: Vorher wurde die DB-Uhr aus der Zeile selbst berechnet (beendet_am − 5 min)
// — "beendet_am liegt nach der DB-Uhr" galt per Konstruktion —, und die nachgebildeten CHECKs waren
// eine Handkopie, die die SQL-Datei nicht las. Jetzt: Die Nachbildung muss genau die CHECKs der Datei
// enthalten, ausgewertet wird mit eingetragen_am = einer festen DB-Uhr 5 min neben der App-Uhr, in
// beide Richtungen (§2.5 sagt "beendet_am vor der DB-Uhr", §2.2 begründet den umgekehrten Fall).
/** CHECK-Ausdrücke aus scripts/lauf_nachweis.sql (Leerraum vereinheitlicht) und ihre Nachbildung. */
const CHECK_NACHBILDUNG = new Map([
  ["job ~ '^[a-z0-9-]{1,40}$'", (z) => /^[a-z0-9-]{1,40}$/.test(z.job)],
  ["ergebnis IN ('ok','teilweise','fehler','uebersprungen')", (z) => ["ok", "teilweise", "fehler", "uebersprungen"].includes(z.ergebnis)],
  // SQL: NULL im CHECK ist nicht falsch.
  ["http_status BETWEEN 100 AND 599", (z) => z.http_status === null || (z.http_status >= 100 && z.http_status <= 599)],
  ["jsonb_typeof(teilergebnisse) = 'array'", (z) => Array.isArray(z.teilergebnisse)],
  ["char_length(hinweis) <= 300", (z) => z.hinweis === null || Array.from(z.hinweis).length <= 300],
  ["beendet_am >= begonnen_am", (z) => Date.parse(z.beendet_am) >= Date.parse(z.begonnen_am)],
]);
const vereinheitlicht = (c) => c.replace(/\s+/g, " ").trim();
const SQL_DATEI = path.join(SITE, "..", "scripts", "lauf_nachweis.sql");

/** Attrappe wie Postgres: Ein Insert in lauf_nachweis, der eine nachgebildete CHECK verletzt, scheitert (23514). */
const checkStoerung = (dbUhr) => (a) => {
  if (a.art !== "supabase" || a.tabelle !== "lauf_nachweis" || a.methode !== "POST") return null;
  const z = { ...a.body, eingetragen_am: dbUhr };
  const verletzt = [...CHECK_NACHBILDUNG].filter(([, gilt]) => !gilt(z)).map(([c]) => c);
  return verletzt.length > 0 ? { status: 400, body: { code: "23514", message: `CHECK verletzt: ${verletzt.join(", ")}` } } : null;
};

test("T-R13 Zeile wird angenommen, wenn die DB-Uhr 5 min vor- oder nachgeht (CHECKs aus scripts/lauf_nachweis.sql, nachgebildet)", async () => {
  const sql = ohneKommentare(readFileSync(SQL_DATEI, "utf8"));
  assert.deepEqual(checkAusdruecke(sql).map(vereinheitlicht).sort(), [...CHECK_NACHBILDUNG.keys()].sort(), "Nachbildung = CHECKs der SQL-Datei");
  const APP = "2026-11-09T07:03:00.000Z";
  for (const versatz of [-5 * 60_000, 5 * 60_000]) {
    zuruecksetzen();
    const dbUhr = new Date(Date.parse(APP) + versatz).toISOString();
    welt.stoerung = checkStoerung(dbUhr);
    const r = await mitDatum(APP, async () => antwort(await briefing.GET(briefingReq())));
    assert.equal(r.body.nachweis_fehler, undefined, `angenommen bei DB-Uhr ${dbUhr}`);
    const z = welt.tabellen.lauf_nachweis[0];
    assert.equal(z.begonnen_am, APP, "begonnen_am aus der App-Uhr");
    const beendet = Date.parse(z.beendet_am);
    assert.ok(versatz < 0 ? beendet > Date.parse(dbUhr) : beendet < Date.parse(dbUhr), `${z.beendet_am} gegen DB-Uhr ${dbUhr}`);
  }
});

test("T-R14 Zeitlimit (Prüfbefund SR-3): Insert der Schreiber und alle Lesungen von lauf_nachweis mit AbortSignal.timeout(ABFRAGE_TIMEOUT_MS)", async () => {
  // Gemessen wird die Frist, die jede Seite AbortSignal.timeout übergibt (wie Z-N2 in z-routen).
  const original = AbortSignal.timeout;
  const msJeSignal = new WeakMap();
  AbortSignal.timeout = (ms) => {
    const s = original.call(AbortSignal, ms);
    msJeSignal.set(s, ms);
    return s;
  };
  const harnessFetch = globalThis.fetch;
  const fristen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/rest/v1/lauf_nachweis") {
      fristen.push({ methode: String(init.method ?? "GET").toUpperCase(), ms: init.signal ? (msJeSignal.get(init.signal) ?? "ohne Frist") : null });
    }
    return harnessFetch(input, init);
  };
  try {
    await mitDatum(MONTAG, async () => briefing.GET(briefingReq()));
    pipelineWelt(FERTIG);
    await mitDatum(MONTAG, async () => auto.GET(autoReq()));
    await statusAbruf();
    // Ein aktiver Job: dazu die zweite Abfrage (ohne übersprungene), mit derselben Frist.
    await mitAktivenJobs(["content-auto-produce"], "2026-11-07T00:00:00+01:00", () => mitDatum("2026-11-09T11:00:00Z", statusAbruf));
  } finally {
    globalThis.fetch = harnessFetch;
    AbortSignal.timeout = original;
  }
  // Prüfbefund betrieb-1: Beim heutigen Plan (alle Jobs aus) eine Lesung je Job, nicht zwei; mit einem
  // aktiven Job eine mehr.
  assert.deepEqual(fristen.map((f) => f.methode), ["POST", "POST", "GET", "GET", "GET", "GET", "GET", "GET", "GET"]);
  for (const f of fristen) assert.equal(f.ms, statusServer.ABFRAGE_TIMEOUT_MS, JSON.stringify(f));
});

test("T-R15 Zeitüberschreitung beim Insert (Prüfbefund SR-4): Vermerk 'Ausgang unbekannt' statt 'nicht geschrieben'", async () => {
  const harnessFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/rest/v1/lauf_nachweis" && String(init.method).toUpperCase() === "POST") {
      // Der Abbruch kommt nach dem Absenden: Der Server kann die Zeile angenommen haben.
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    return harnessFetch(input, init);
  };
  try {
    const { wert: r, log } = await mitFehlerLog(() => mitDatum(MONTAG, async () => antwort(await briefing.GET(briefingReq()))));
    assert.equal(r.status, 200);
    assert.equal(r.body.nachweis_fehler, "Lauf-Nachweis: Ausgang unbekannt — Zeitüberschreitung (8 s); die Zeile kann trotzdem stehen");
    assert.ok(log.some((z) => z.startsWith("[totmann] briefing-morgen:") && z.includes("Ausgang unbekannt")), log.join("\n"));
  } finally {
    globalThis.fetch = harnessFetch;
  }
});

test("T-R16 auto-produce (Prüfbefund SR-2): Pipeline ohne bekannten Status → Zeile 'fehler'; echtes partial → 'teilweise'", async () => {
  for (const [pipeline, hinweis] of [
    [{}, "status partial · Pipeline-Status fehlt"],
    [{ status: "running" }, "status partial · Pipeline-Status unbekannt (running)"],
  ]) {
    zuruecksetzen();
    pipelineWelt(pipeline);
    const r = await mitDatum(MONTAG, async () => antwort(await auto.GET(autoReq())));
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "partial", "die Antwort der Route bleibt, wie sie ist");
    assert.equal(inserts().length, 1);
    assert.equal(inserts()[0].body.ergebnis, "fehler", JSON.stringify(pipeline));
    assert.equal(inserts()[0].body.hinweis, hinweis);
  }
  zuruecksetzen();
  pipelineWelt({ ...FERTIG, status: "partial", summary: { ...FERTIG.summary, completed: "4/5" } });
  await mitDatum(MONTAG, async () => auto.GET(autoReq()));
  assert.equal(inserts()[0].body.ergebnis, "teilweise");
  assert.equal(inserts()[0].body.hinweis, "status partial · Pipeline-Stufen 4/5");
});

// ═══ GET /api/status: Lesen und Bewerten ═══

const Q_CRONS = "Plan site/src/lib/totmann.ts · Supabase · lauf_nachweis (je Job zuletzt eingetragen; begonnen_am, eingetragen_am, ergebnis)";

async function statusAbruf() {
  const res = await statusApi.GET();
  assert.equal(res.status, 200);
  return res.json();
}

/** Zeile, wie sie in lauf_nachweis steht (eingetragen_am = DB-Uhr, 1 s nach beendet_am). */
const dbZeile = (id, job, begonnen, ergebnis = "ok", extra = {}) => ({
  id,
  job,
  begonnen_am: begonnen,
  beendet_am: new Date(Date.parse(begonnen) + 60_000).toISOString(),
  eingetragen_am: new Date(Date.parse(begonnen) + 61_000).toISOString(),
  ergebnis,
  http_status: 200,
  teilergebnisse: [],
  hinweis: null,
  ...extra,
});

test("T-L1 /api/status (Prüfbefunde D1, betrieb-1): je Plan-Job die zuletzt eingetragene Zeile, für aktive Jobs auch die mit Ergebnis außer uebersprungen; Probe-Zeilen werden nicht gelesen", async () => {
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "briefing-morgen", "2026-11-06T07:03:00.000Z"),
    dbZeile(2, "briefing-morgen", "2026-11-09T07:03:00.000Z", "teilweise"),
    dbZeile(3, "content-auto-produce-probe", "2026-11-09T09:00:00.000Z"),
  ];
  const s = await statusAbruf();
  const gelesen = lesungen().map((e) => new URLSearchParams(e.query));
  // Prüfbefund betrieb-1: Beim heutigen Plan (alle aus) eine Abfrage je Job — die zweite trägt bei
  // einem abgeschalteten Job nichts zum Urteil bei (vorher 6 Abfragen je Abruf).
  assert.deepEqual(gelesen.map((p) => p.get("job")), ["eq.briefing-morgen", "eq.briefing-abend", "eq.content-auto-produce"], "eine Abfrage je Plan-Job");
  for (const p of gelesen) {
    assert.equal(p.get("ergebnis"), null, "ohne Ergebnis-Filter");
    // Prüfbefund D1: nach der DB-Uhr, Gleichstand nach id — nicht nach begonnen_am (App-Uhr).
    assert.equal(p.get("order"), "eingetragen_am.desc,id.desc");
    assert.equal(p.get("limit"), "1");
    // Prüfbefunde Z2, SR-5: eingetragen_am (DB-Uhr) wird mitgelesen; Prüfbefund r3-logik-1: die id für
    // die Reihenfolge bei gleicher DB-Uhr (bewerteJob ordnet wie die Route).
    assert.equal(p.get("select"), "id,job,begonnen_am,beendet_am,eingetragen_am,ergebnis,http_status,teilergebnisse,hinweis");
  }
  // Ein aktiver Job: zwei Abfragen (Prüfbefund Z5), sonst verdeckt ein übersprungener Lauf ein früheres Ergebnis.
  zuruecksetzen();
  await mitAktivenJobs(["content-auto-produce"], "2026-11-07T00:00:00+01:00", () => mitDatum("2026-11-09T11:00:00Z", statusAbruf));
  const aktivGelesen = lesungen().map((e) => new URLSearchParams(e.query));
  assert.equal(aktivGelesen.length, 4);
  const auto = aktivGelesen.filter((p) => p.get("job") === "eq.content-auto-produce");
  // Prüfbefunde r3-logik-1, P3A-1: ohne Ergebnis-Filter die zuletzt eingetragenen ZEILEN_JE_AKTIVEM_JOB,
  // mit Filter (ohne übersprungene) die zuletzt eingetragene.
  assert.equal(statusServer.ZEILEN_JE_AKTIVEM_JOB, 10);
  assert.deepEqual(
    auto.map((p) => [p.get("ergebnis"), p.get("limit")]).sort(),
    [
      [null, "10"],
      ["neq.uebersprungen", "1"],
    ].sort(),
  );
  for (const p of aktivGelesen) assert.equal(p.get("order"), "eingetragen_am.desc,id.desc");
  // Die übrigen Prüfungen gelten dem ersten Abruf (Plan wie heute).
  assert.equal(s.crons.quelle, Q_CRONS);
  assert.equal(s.crons.wert.jobs[0].letzter_lauf.begonnen_am, "2026-11-09T07:03:00.000Z", "die jüngste Zeile");
  // Der Plan ist aus: Ein Nachweis nach aus_seit ist der Stolperdraht; die Probe löst ihn nicht aus.
  assert.deepEqual(s.crons.wert.jobs.map((j) => j.lage), ["laeuft_obwohl_aus", "aus", "aus"]);
  assert.equal(s.crons.status, "fehler");
  assert.equal(s.crons.wert.nachweis_seit, null, "NACHWEIS_SEIT ist nicht festgehalten (Prüfbefund B1)");
  assert.equal(typeof s.crons.gemessen_am, "string");
});

test("T-L2 /api/status: leere Tabelle → bernstein 'aus'; fehlende Tabelle → bernstein mit Lesefehler", async () => {
  const leer = await statusAbruf();
  assert.equal(leer.crons.status, "warnung");
  assert.deepEqual(leer.crons.wert.jobs.map((j) => j.lage), ["aus", "aus", "aus"]);
  assert.equal(leer.crons.wert.lesefehler, null);

  zuruecksetzen();
  welt.stoerung = (a) =>
    a.art === "supabase" && a.tabelle === "lauf_nachweis"
      ? { status: 404, body: { code: "PGRST205", details: null, hint: null, message: "Could not find the table 'public.lauf_nachweis' in the schema cache" } }
      : null;
  const fehlt = await statusAbruf();
  assert.equal(fehlt.crons.status, "warnung", "alle Jobs aus: bernstein, nicht rot");
  assert.deepEqual(fehlt.crons.wert.jobs.map((j) => j.lage), ["nicht_lesbar", "nicht_lesbar", "nicht_lesbar"]);
  assert.match(fehlt.crons.wert.lesefehler, /Could not find the table 'public\.lauf_nachweis'/);
  assert.match(fehlt.crons.hinweis, /^Nachweis nicht lesbar: Could not find the table/);
});

test("T-L3 /api/status ohne Service-Schlüssel: crons bernstein mit Grund, keine Abfrage von lauf_nachweis", async () => {
  const schluessel = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  try {
    const { wert: s } = await mitFehlerLog(statusAbruf);
    assert.equal(s.crons.status, "warnung");
    assert.equal(s.crons.wert.lesefehler, "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt — nicht abgefragt");
    assert.equal(lesungen().length, 0);
    // Prüfbefunde SR-6, B9: nicht abgefragt heißt kein Messzeitpunkt (wie messe() für die übrigen Felder).
    assert.equal(s.crons.gemessen_am, null);
    assert.equal(s.supabase.gemessen_am, null);
  } finally {
    process.env.SUPABASE_SERVICE_KEY = schluessel;
  }
});

test("T-L4 Erzeuger → Leser: eine vom Schreiber angehängte Zeile liest /api/status zurück", async () => {
  await mitDatum("2026-11-09T07:03:00Z", async () => briefing.GET(briefingReq()));
  const s = await statusAbruf();
  const morgen = s.crons.wert.jobs.find((j) => j.job === "briefing-morgen");
  assert.equal(morgen.letzter_lauf.ergebnis, "ok");
  assert.equal(morgen.letzter_lauf.begonnen_am, "2026-11-09T07:03:00.000Z");
  assert.deepEqual(morgen.letzter_lauf.teilergebnisse.map((t) => t.agent), ["oracle", "donna"]);
  assert.equal(morgen.lage, "laeuft_obwohl_aus", "der Plan führt den Job als aus");
});

// ═══ Anzeige: Zeile „Crons" im Systemzustand ═══

const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
const ZEIT = "2026-11-09T19:10:00.000Z";
const lesung = (status) => ({ status, fehler: null, loading: false, geladenAm: ZEIT, httpStatus: 200, neuLaden: async () => {} });

const P = ladeTsx("components/ui/CommandPanels.tsx", {
  ...ECHT,
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
  "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }) },
  "@/lib/freigabe-regeln": regeln,
  "@/lib/hooks-status": hooksStatus,
  "@/lib/types": types,
});

/** Die Zeile „Crons" aus dem gerenderten Systemzustand: Text, title und Textfarbe. */
function cronsZeile(status) {
  const roh = renderToStaticMarkup(React.createElement(P.SystemzustandPanel, { lesung: lesung(status) }));
  const teil = roh.split('<div class="flex items-center gap-2.5"').find((t) => t.includes(">Crons</span>"));
  assert.ok(teil, "Zeile Crons fehlt");
  const title = ent(/^ title="([^"]*)"/.exec(teil)?.[1] ?? "");
  const wert = /<span class="ml-auto[^"]*" style="color:([^"]*)">([^<]*)<\/span>/.exec(teil);
  return { title, farbe: wert?.[1], text: ent(wert?.[2] ?? ""), html: ent(roh) };
}

/** Messwert wie aus /api/status, gebaut mit der echten Bewertung. */
function cronsMesswert(plan, laeufe, jetzt, lesefehler = null, nachweisSeit = totmann.NACHWEIS_SEIT) {
  const b = statusServer.bewerteTotmann(plan, laeufe, new Date(jetzt), lesefehler, nachweisSeit);
  return { wert: b.wert, status: b.status, quelle: Q_CRONS, gemessen_am: jetzt, ...(b.hinweis ? { hinweis: b.hinweis } : {}) };
}

/** Messbeginn der Anzeige-Fälle (aktiv_seit): Sa 07.11.2026 00:00 Berlin. */
const AKTIV_AB = "2026-11-07T00:00:00+01:00";
const aktiv = (job, seit = AKTIV_AB) => ({ ...job, aktiv: true, aktiv_seit: seit, zeitzone_beleg: "Testannahme", aus_seit: null, grund: null });
const [MORGEN, ABEND, AUTO] = totmann.TOTMANN_PLAN;
const AKTIV_PLAN = totmann.TOTMANN_PLAN.map((j) => aktiv(j));
const zeile = (job, begonnen, ergebnis = "ok", extra = {}) => ({
  job,
  begonnen_am: begonnen,
  beendet_am: begonnen,
  eingetragen_am: new Date(Date.parse(begonnen) + 1_000).toISOString(),
  ergebnis,
  http_status: 200,
  teilergebnisse: [],
  hinweis: null,
  ...extra,
});

test("T-A1 Anzeige (Erzeuger → Leser): 'Crons · laut Plan aus seit 30.07.2026 · VPS-Crontab' bernstein, Quelle und ehrlicher Tooltip je Job", async () => {
  const s = await statusAbruf();
  const z = cronsZeile({ erzeugt_am: s.erzeugt_am, crons: s.crons });
  assert.equal(z.text, "laut Plan aus seit 30.07.2026 · VPS-Crontab"); // Tor-Prüfung 07.11.2026 (T2): Planwert und Umfang sichtbar
  assert.equal(z.farbe, "var(--gp-amber)");
  assert.ok(z.title.startsWith(`Quelle: ${Q_CRONS}\n`), z.title);
  for (const [job, nr] of [
    ["Briefing morgens (briefing-morgen)", 21],
    ["Briefing abends (briefing-abend)", 24],
    ["Content Auto-Produce (content-auto-produce)", 27],
  ]) {
    assert.ok(z.title.includes(`${job}: laut Plan aus seit 30.07.2026 — Crons abgeschaltet (Betreiber-Entscheid)`), z.title);
    assert.ok(z.title.includes(`Fundstelle: GG/decisions_log.md Abschnitt 30.07.2026; scripts/setup-vps-crons.sh:${nr}`), z.title);
  }
  // Prüfbefund B1: kein Beobachtungsfenster, solange NACHWEIS_SEIT nicht festgehalten ist.
  assert.ok(
    z.title.includes("Letzter Lauf: keine Zeile in lauf_nachweis · seit wann die Tabelle besteht, ist nicht festgehalten · VPS-Crontab selbst nicht gemessen"),
    z.title,
  );
  assert.doesNotMatch(z.title, /Schreiber seit|Nachweis-Tabelle seit|07\.11\.2026/);
  assert.doesNotMatch(z.html, /kein Lauf seit/, "nie 'kein Lauf seit 30.07.' (§2.4)");
  // Prüfbefund B7: Der Grund steht auch im Hinweis (den liest ein Client von vor dem Totmann).
  assert.ok(z.title.includes("Hinweis: alle 3 Jobs laut Plan aus seit 30.07.2026"), z.title);
  // Prüfbefund B10: Zeitzone und Karenz als Setzung.
  assert.ok(z.title.includes("Plan: Mo–Fr 08:03 Europe/Berlin (angenommen, VPS-Zeitzone nicht gemessen), Karenz 2 h (Setzung)"), z.title);
  // Sobald NACHWEIS_SEIT festgehalten ist, der Text aus §2.4.
  const mit = cronsZeile({ erzeugt_am: ZEIT, crons: cronsMesswert(totmann.TOTMANN_PLAN, [], ZEIT, null, "2026-11-20") });
  assert.ok(mit.title.includes("Letzter Lauf: Nachweis-Tabelle seit 20.11.2026: kein Lauf · VPS-Crontab selbst nicht gemessen"), mit.title);
});

test("T-A2 Anzeige: Texte je Lage — ok, teilweise, fehlgeschlagen, überfällig, Stolperdraht, Lesefehler", () => {
  const anzeige = (m, bezug = ZEIT) => types.cronsAnzeige(types.cronsFeld(m), bezug).text;
  const plan = AKTIV_PLAN;
  const morgen = zeile("briefing-morgen", "2026-11-09T07:03:05.000Z");
  const autoLauf = zeile("content-auto-produce", "2026-11-09T08:07:05.000Z");
  const abend = zeile("briefing-abend", "2026-11-09T17:03:05.000Z");
  assert.equal(anzeige(cronsMesswert(plan, [morgen, autoLauf, abend], ZEIT)), "3 Jobs ok · letzter Lauf vor 2 h");
  const teil = {
    ...morgen,
    ergebnis: "teilweise",
    teilergebnisse: [
      { agent: "oracle", ergebnis: "ok", fehler: null },
      { agent: "donna", ergebnis: "fehler", fehler: "HTTP 502: leere Antwort" },
    ],
  };
  assert.equal(anzeige(cronsMesswert(plan, [teil, autoLauf, abend], ZEIT)), "Briefing morgens: 1 von 2 Agenten gescheitert");
  assert.equal(anzeige(cronsMesswert(plan, [{ ...morgen, ergebnis: "fehler" }, autoLauf, abend], ZEIT)), "Briefing morgens: fehlgeschlagen");
  const mo1004 = "2026-11-09T09:04:00.000Z";
  assert.equal(anzeige(cronsMesswert(plan, [], mo1004), mo1004), "Briefing morgens: überfällig seit Mo 09.11. 08:03 · letzter Lauf nie");
  const freitag = zeile("briefing-morgen", "2026-11-06T07:03:10.000Z");
  assert.equal(anzeige(cronsMesswert(plan, [freitag], mo1004), mo1004), "Briefing morgens: überfällig seit Mo 09.11. 08:03 · letzter Lauf vor 3 Tagen");
  assert.equal(anzeige(cronsMesswert(totmann.TOTMANN_PLAN, [abend], ZEIT)), "Briefing abends: lief zuletzt am 09.11.2026 18:03, obwohl als aus geführt");
  assert.equal(anzeige(cronsMesswert(totmann.TOTMANN_PLAN, [], ZEIT, "relation does not exist")), "laut Plan aus seit 30.07.2026 · VPS-Crontab · Nachweis nicht lesbar");
  assert.equal(anzeige(cronsMesswert([aktiv(MORGEN), ABEND, AUTO], [], ZEIT, "relation does not exist")), "Briefing morgens: Nachweis nicht lesbar");
  // Mehrere schlechteste Jobs mit verschiedenen Texten: der erste und die Zahl der weiteren.
  assert.equal(
    anzeige(cronsMesswert(plan, [{ ...morgen, ergebnis: "fehler" }, autoLauf], ZEIT)),
    "Briefing morgens: fehlgeschlagen · +1 weitere",
  );
});

test("T-A3 Anzeige: Tooltip nennt je Job letzten Lauf mit Ergebnis und Teilergebnisse je Agent; Farbe des schlechtesten Jobs", () => {
  const plan = AKTIV_PLAN;
  const teil = zeile("briefing-morgen", "2026-11-09T07:03:05.000Z", "teilweise", {
    teilergebnisse: [
      { agent: "oracle", ergebnis: "ok", fehler: null },
      { agent: "donna", ergebnis: "fehler", fehler: "HTTP 502: leere Antwort" },
    ],
    hinweis: "1 von 2 Agenten vollständig",
  });
  const m = cronsMesswert(plan, [teil, zeile("content-auto-produce", "2026-11-09T08:07:05.000Z"), zeile("briefing-abend", "2026-11-09T17:03:05.000Z")], ZEIT);
  assert.equal(m.status, "warnung");
  const z = cronsZeile({ erzeugt_am: ZEIT, crons: m });
  assert.equal(z.text, "Briefing morgens: 1 von 2 Agenten gescheitert");
  assert.equal(z.farbe, "var(--gp-amber)");
  // Prüfbefund anzeige-2: aktiv_seit ist eine Setzung des Plans; anzeige-4: Zeitpunkte in Europe/Berlin.
  assert.ok(z.title.includes("Briefing morgens (briefing-morgen): laut Plan aktiv seit 07.11.2026 00:00:00 (Europe/Berlin)"), z.title);
  assert.ok(z.title.includes("Sollzeitpunkt: Mo 09.11. 08:03 (Europe/Berlin)"), z.title);
  assert.match(z.title, /Letzter Lauf: [^\n]* · teilweise · HTTP 200 · 1 von 2 Agenten vollständig/);
  assert.ok(z.title.includes("Agenten: oracle ok · donna fehler (HTTP 502: leere Antwort)"), z.title);
  assert.ok(z.title.includes("Plan: Mo–Fr 08:03 Europe/Berlin (gemessen: Testannahme), Karenz 2 h (Setzung)"), z.title);
  assert.match(z.title, /Letzter Lauf: [^\n]* · eingetragen \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2} \(Europe\/Berlin, DB-Uhr\)/);
  const rot = cronsZeile({ erzeugt_am: ZEIT, crons: cronsMesswert(totmann.TOTMANN_PLAN, [zeile("briefing-abend", "2026-11-09T17:03:05.000Z")], ZEIT) });
  assert.equal(rot.farbe, "var(--gp-rose)");
  const gruen = cronsZeile({
    erzeugt_am: ZEIT,
    crons: cronsMesswert(plan, [zeile("briefing-morgen", "2026-11-09T07:03:05.000Z"), zeile("content-auto-produce", "2026-11-09T08:07:05.000Z"), zeile("briefing-abend", "2026-11-09T17:03:05.000Z")], ZEIT),
  });
  assert.equal(gruen.text, "3 Jobs ok · letzter Lauf vor 2 h");
  assert.equal(gruen.farbe, "var(--gp-gold-hi)", "ein ok-Wert in Gold wie die übrigen Werte");
});

test("T-A4 Anzeige: alte Antwort (vor dem Totmann), fehlendes Feld und unlesbare Job-Liste stürzen nicht ab", () => {
  const alt = cronsZeile({
    erzeugt_am: ZEIT,
    crons: { wert: null, status: "nicht_gemessen", quelle: "kein Lauf-Protokoll", gemessen_am: null, hinweis: "Kein Cron schreibt einen Lauf-Nachweis, den das Dashboard lesen kann." },
  });
  assert.equal(alt.text, "nicht gemessen");
  assert.ok(alt.title.includes("Quelle: kein Lauf-Protokoll"));
  const fehlt = cronsZeile({ erzeugt_am: ZEIT });
  assert.equal(fehlt.text, "nicht gemessen");
  assert.ok(fehlt.title.includes("Feld „crons“ fehlt in der Antwort."), fehlt.title);
  const kaputt = cronsZeile({ erzeugt_am: ZEIT, crons: { wert: { jobs: "x" }, status: "warnung", quelle: Q_CRONS, gemessen_am: ZEIT } });
  assert.equal(kaputt.text, "Warnung");
  assert.ok(kaputt.title.includes("Job-Liste der Antwort unlesbar"), kaputt.title);
  const leer = types.cronsFeld({ wert: { jobs: [{ job: "x" }] }, status: "ok", quelle: Q_CRONS, gemessen_am: ZEIT });
  assert.equal(leer.wert, null);
});

// ═══ Mit aktivem Plan: Route und Anzeige der nachgebesserten Lagen ═══

/**
 * Plan-Jobs vorübergehend aktiv schalten. Die Route liest dieselbe Modul-Instanz von lib/totmann.ts
 * (gleiche Datei-URL); danach steht jeder Eintrag wieder genau wie vorher.
 */
async function mitAktivenJobs(jobs, seit, fn) {
  const plan = totmann.TOTMANN_PLAN;
  const vorher = plan.map((j) => ({ ...j }));
  try {
    for (const j of plan) {
      if (jobs.includes(j.job)) Object.assign(j, { aktiv: true, aktiv_seit: seit, zeitzone_beleg: "Testannahme", aus_seit: null, grund: null });
    }
    return await fn();
  } finally {
    plan.forEach((j, i) => Object.assign(j, vorher[i]));
    assert.deepEqual(plan, vorher, "Plan zurückgesetzt");
  }
}

test("T-L5 /api/status (Prüfbefund Z5): Freitag fehler, Samstag manuell 'skipped' → rot, bewertet wird der Freitag", async () => {
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "content-auto-produce", "2026-11-20T08:07:00.000Z", "fehler"),
    dbZeile(2, "content-auto-produce", "2026-11-21T10:30:00.000Z", "uebersprungen", { hinweis: "status skipped · Wochenende — kein Content geplant" }),
  ];
  const s = await mitAktivenJobs(["content-auto-produce"], AKTIV_AB, () => mitDatum("2026-11-21T11:00:00Z", statusAbruf));
  const j = s.crons.wert.jobs[2];
  assert.equal(j.lage, "fehlgeschlagen");
  assert.equal(j.letzter_lauf.begonnen_am, "2026-11-21T10:30:00.000Z");
  assert.equal(j.bewerteter_lauf.begonnen_am, "2026-11-20T08:07:00.000Z");
  assert.equal(s.crons.status, "fehler");
  const z = cronsZeile({ erzeugt_am: s.erzeugt_am, crons: s.crons });
  assert.equal(z.text, "Content Auto-Produce: fehlgeschlagen");
  assert.match(z.title, /Bewertet \(ein übersprungener Lauf überdeckt kein früheres Ergebnis\): [^\n]* · fehler · HTTP 200/);
});

test("T-L6 /api/status (Prüfbefunde Z2, SR-5): Zeile aus der Zukunft oder mit verschobener App-Uhr → rot 'unplausibel'", async () => {
  welt.tabellen.lauf_nachweis = [dbZeile(1, "briefing-morgen", "2027-03-01T07:03:00.000Z")];
  const s = await mitAktivenJobs(["briefing-morgen"], AKTIV_AB, () => mitDatum("2026-11-20T09:04:00Z", statusAbruf));
  assert.equal(s.crons.wert.jobs[0].lage, "zeit_unplausibel");
  assert.equal(s.crons.status, "fehler");
  const z = cronsZeile({ erzeugt_am: s.erzeugt_am, crons: s.crons });
  assert.equal(z.text, "Briefing morgens: Zeitpunkt des Laufs unplausibel: begonnen_am 01.03.2027 08:03 liegt mehr als 10 min nach der Messzeit");
  zuruecksetzen();
  // Lauf Fr 20.11. 08:03 Berlin, aber die DB trug ihn 14 min früher ein (App-Uhr vorgelaufen).
  welt.tabellen.lauf_nachweis = [dbZeile(1, "briefing-morgen", "2026-11-20T07:03:05.000Z", "ok", { eingetragen_am: "2026-11-20T06:50:00.000Z" })];
  const v = await mitAktivenJobs(["briefing-morgen"], AKTIV_AB, () => mitDatum("2026-11-20T09:04:00Z", statusAbruf));
  assert.equal(v.crons.wert.jobs[0].lage, "zeit_unplausibel");
  assert.equal(v.crons.wert.jobs[0].hinweis, "App-Uhr (beendet_am) und DB-Uhr (eingetragen_am) weichen um mehr als 10 min ab");
});

test("T-L7 /api/status (Prüfbefund D1): gelesen wird die zuletzt eingetragene Zeile — ein späterer plausibler Lauf löst das Rot einer Zukunftszeile", async () => {
  // Do 19.11. schrieb ein Lauf mit vorgehender App-Uhr: begonnen_am 01.03.2027, eingetragen (DB-Uhr) 19.11.2026.
  const zukunft = dbZeile(1, "briefing-morgen", "2027-03-01T07:03:00.000Z", "ok", { eingetragen_am: "2026-11-19T07:04:01.000Z" });
  welt.tabellen.lauf_nachweis = [zukunft];
  const vorher = await mitAktivenJobs(["briefing-morgen"], AKTIV_AB, () => mitDatum("2026-11-19T09:04:00Z", statusAbruf));
  assert.equal(vorher.crons.wert.jobs[0].lage, "zeit_unplausibel", "solange sie die zuletzt eingetragene ist: rot");
  // Fr 20.11. 08:03 ein plausibler ok-Lauf: Er wird gelesen und bewertet. Vorher (order begonnen_am)
  // blieb die Zukunftszeile "die jüngste" — rot bis März 2027.
  zuruecksetzen();
  welt.tabellen.lauf_nachweis = [zukunft, dbZeile(2, "briefing-morgen", "2026-11-20T07:03:05.000Z")];
  const s = await mitAktivenJobs(["briefing-morgen"], AKTIV_AB, () => mitDatum("2026-11-20T09:04:00Z", statusAbruf));
  const j = s.crons.wert.jobs[0];
  assert.deepEqual([j.lage, j.status], ["ok", "ok"]);
  assert.equal(j.letzter_lauf.begonnen_am, "2026-11-20T07:03:05.000Z");
  assert.equal(j.bewerteter_lauf.begonnen_am, "2026-11-20T07:03:05.000Z");
  // Gleichstand der DB-Uhr: Die höhere id ist die zuletzt eingetragene Zeile. Seit Prüfbefund r3-logik-1
  // liest die Route für aktive Jobs beide Zeilen; bewerteJob ordnet wie sie (eingetragen_am, dann id).
  zuruecksetzen();
  const gleich = "2026-11-20T07:04:06.000Z";
  welt.tabellen.lauf_nachweis = [
    dbZeile(7, "briefing-morgen", "2026-11-20T07:03:06.000Z", "ok", { eingetragen_am: gleich }),
    dbZeile(8, "briefing-morgen", "2026-11-20T07:03:05.000Z", "fehler", { eingetragen_am: gleich }),
  ];
  const t = await mitAktivenJobs(["briefing-morgen"], AKTIV_AB, () => mitDatum("2026-11-20T09:04:00Z", statusAbruf));
  assert.equal(t.crons.wert.jobs[0].lage, "fehlgeschlagen", "id 8 (fehler) vor id 7 (ok)");
  // Abgeschalteter Job: Der echte Lauf vom 01.12. wird gelesen, nicht die Zukunftszeile vom 24.11.
  zuruecksetzen();
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "briefing-abend", "2027-11-24T17:03:00.000Z", "ok", { eingetragen_am: "2026-11-24T17:04:01.000Z" }),
    dbZeile(2, "briefing-abend", "2026-12-01T17:03:00.000Z"),
  ];
  const aus = await mitDatum("2026-12-01T20:00:00Z", statusAbruf);
  const abend = aus.crons.wert.jobs[1];
  assert.deepEqual([abend.lage, abend.stolperdraht_am_berlin, abend.stolperdraht_spalte], ["laeuft_obwohl_aus", "01.12.2026 18:03", "begonnen_am"]);
  assert.equal(abend.letzter_lauf.begonnen_am, "2026-12-01T17:03:00.000Z");
});

// ═══ Dritte Prüfung des Branches (r3-logik-1 bis r3-logik-4, P3A-1): über die Route ═══

const KEIN_EINTRAG = { hinweis: "status skipped · kein Kalendereintrag" };
const WOCHENENDE = { hinweis: "status skipped · Wochenende — kein Content geplant" };
const AUTO_AB_MO = "2026-11-09T00:00:00+01:00";

test("T-L8 /api/status (Prüfbefunde r3-logik-1, P3A-1): ein Samstagslauf verdrängt den deckenden Freitagslauf nicht; 'überfällig seit' nach dem letzten deckenden Lauf", async () => {
  // auto-produce aktiv seit Mo 09.11.; Do 12.11. ok; Fr 13.11. 09:07 der Cron, freitags kein
  // Kalendereintrag → übersprungen (Plan-Wochentag, deckt S); Sa 14.11. 11:30 ein manueller Aufruf ohne
  // ?dry → übersprungen ("Wochenende", deckt nichts). Vorher las die Route nur die Samstags- und die
  // Donnerstagszeile: rot "überfällig seit Fr 13.11. 09:07", obwohl der Freitag lief.
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "content-auto-produce", "2026-11-12T08:07:05.000Z"),
    dbZeile(2, "content-auto-produce", "2026-11-13T08:07:05.000Z", "uebersprungen", KEIN_EINTRAG),
    dbZeile(3, "content-auto-produce", "2026-11-14T10:30:00.000Z", "uebersprungen", WOCHENENDE),
  ];
  for (const jetzt of ["2026-11-14T11:00:00Z", "2026-11-16T08:00:00Z"]) {
    const s = await mitAktivenJobs(["content-auto-produce"], AUTO_AB_MO, () => mitDatum(jetzt, statusAbruf));
    const j = s.crons.wert.jobs[2];
    assert.deepEqual([j.lage, j.status, j.sollzeitpunkt_berlin], ["ok", "ok", "Fr 13.11. 09:07"], jetzt);
    assert.equal(j.letzter_lauf.begonnen_am, "2026-11-14T10:30:00.000Z", "letzter Lauf: der Samstag");
    assert.equal(j.bewerteter_lauf.begonnen_am, "2026-11-13T08:07:05.000Z", "bewertet: der Freitag");
  }
  // Fällt auch der Montag aus: überfällig seit Mo 16.11. 09:07 (vorher: seit Fr 13.11.).
  const mo = await mitAktivenJobs(["content-auto-produce"], AUTO_AB_MO, () => mitDatum("2026-11-16T10:30:00Z", statusAbruf));
  assert.deepEqual([mo.crons.wert.jobs[2].lage, mo.crons.wert.jobs[2].ueberfaellig_seit_berlin], ["ueberfaellig", "Mo 16.11. 09:07"]);
  // Mo 02.11. ok, Di–Fr übersprungen (kein Kalendereintrag), Sa 07.11. manuell übersprungen, Mo 09.11.
  // verpasst: überfällig seit Mo 09.11. 09:07 (vorher: seit Di 03.11., nach dem letzten Lauf mit Ergebnis).
  zuruecksetzen();
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "content-auto-produce", "2026-11-02T08:07:05.000Z"),
    ...["03", "04", "05", "06"].map((tag, i) => dbZeile(2 + i, "content-auto-produce", `2026-11-${tag}T08:07:05.000Z`, "uebersprungen", KEIN_EINTRAG)),
    dbZeile(6, "content-auto-produce", "2026-11-07T10:30:00.000Z", "uebersprungen", WOCHENENDE),
  ];
  const s = await mitAktivenJobs(["content-auto-produce"], "2026-11-02T00:00:00+01:00", () => mitDatum("2026-11-09T11:00:00Z", statusAbruf));
  assert.deepEqual([s.crons.wert.jobs[2].lage, s.crons.wert.jobs[2].ueberfaellig_seit_berlin], ["ueberfaellig", "Mo 09.11. 09:07"]);
  assert.match(cronsZeile({ erzeugt_am: s.erzeugt_am, crons: s.crons }).text, /^Content Auto-Produce: überfällig seit Mo 09\.11\. 09:07 · letzter Lauf /);
});

test("T-L9 /api/status (Prüfbefunde r3-logik-2, r3-logik-3, r3-logik-4): nachgehende App-Uhr bleibt rot, eine alte Zukunftszeile hält nicht mehr rot, eine jüngere unlesbare Zeile trägt", async () => {
  // r3-logik-2: Fr 13.11. 09:07 der Cron, fehler, App-Uhr 12 min nach (begonnen 08:55:05, eingetragen 09:08:06
  // Berlin); Fr 10:00 ein Nachlauf mit richtiger Uhr, übersprungen (deckt S). Vorher grün.
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "content-auto-produce", "2026-11-13T07:55:05.000Z", "fehler", { http_status: 500, eingetragen_am: "2026-11-13T08:08:06.000Z" }),
    dbZeile(2, "content-auto-produce", "2026-11-13T09:00:00.000Z", "uebersprungen", KEIN_EINTRAG),
  ];
  const nach = await mitAktivenJobs(["content-auto-produce"], AUTO_AB_MO, () => mitDatum("2026-11-13T11:00:00Z", statusAbruf));
  assert.deepEqual([nach.crons.wert.jobs[2].lage, nach.crons.status], ["zeit_unplausibel", "fehler"]);
  // r3-logik-3: Do 19.11. eine Zukunftszeile (begonnen 01.03.2027), danach plausible übersprungene Läufe.
  // Vorher rot "unplausibel" bis zum nächsten Lauf mit Ergebnis.
  zuruecksetzen();
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "content-auto-produce", "2027-03-01T08:07:00.000Z", "ok", { eingetragen_am: "2026-11-19T08:08:01.000Z" }),
    ...["20", "23", "24"].map((tag, i) => dbZeile(2 + i, "content-auto-produce", `2026-11-${tag}T08:07:05.000Z`, "uebersprungen", KEIN_EINTRAG)),
  ];
  const zukunft = await mitAktivenJobs(["content-auto-produce"], AUTO_AB_MO, () => mitDatum("2026-11-24T11:00:00Z", statusAbruf));
  const j = zukunft.crons.wert.jobs[2];
  assert.deepEqual([j.lage, j.letzter_lauf.begonnen_am, j.bewerteter_lauf.begonnen_am], ["ok", "2026-11-24T08:07:05.000Z", "2026-11-24T08:07:05.000Z"]);
  // r3-logik-4: Mo 16.11. 09:07 ok, Mo 10:00 eine jüngere Zeile "uebersprungen" mit unlesbarem http_status:
  // Sie kann die zuletzt eingetragene sein → "nicht lesbar" (rot).
  zuruecksetzen();
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "content-auto-produce", "2026-11-16T08:07:05.000Z"),
    dbZeile(2, "content-auto-produce", "2026-11-16T09:00:00.000Z", "uebersprungen", { http_status: 0 }),
  ];
  const kaputt = await mitAktivenJobs(["content-auto-produce"], AUTO_AB_MO, () => mitDatum("2026-11-16T11:00:00Z", statusAbruf));
  assert.deepEqual([kaputt.crons.wert.jobs[2].lage, kaputt.crons.status], ["nicht_lesbar", "fehler"]);
});

test("T-L10 Attrappe wie Postgres (Prüfbefund r3-logik-4): eingetragen_am wird nach der Zeit geordnet, nicht nach dem Text", async () => {
  // Als Text stünde "…T07:59:01+01:00" (06:59:01 UTC) vor "…T07:04:01.000Z"; Postgres ordnet timestamptz
  // nach der Zeit. Ohne die Zeitspalten in ZEITSPALTEN (tests/harness/fake.mjs) läse die Route die ältere Zeile.
  welt.tabellen.lauf_nachweis = [
    dbZeile(1, "briefing-morgen", "2026-11-20T06:58:00.000Z", "ok", { eingetragen_am: "2026-11-20T07:59:01+01:00" }),
    dbZeile(2, "briefing-morgen", "2026-11-20T07:03:00.000Z", "fehler"),
  ];
  const s = await mitDatum("2026-11-20T09:00:00Z", statusAbruf);
  assert.equal(s.crons.wert.jobs[0].letzter_lauf.begonnen_am, "2026-11-20T07:03:00.000Z");
});

test("T-A5 Anzeige (Prüfbefunde Z7, B3): bei gleicher Farbe nennt die Zeile den Mangel eines aktiven Jobs vor 'aus' und 'nicht lesbar'", () => {
  const anzeige = (m) => types.cronsAnzeige(types.cronsFeld(m), m.gemessen_am).text;
  const jetzt = "2026-11-09T10:10:00.000Z"; // Mo 11:10 Berlin
  const teil = zeile("content-auto-produce", "2026-11-09T08:07:05.000Z", "teilweise", {
    teilergebnisse: [
      { agent: "researcher", ergebnis: "ok", fehler: null },
      { agent: "scribe", ergebnis: "fehler", fehler: "HTTP 529" },
      { agent: "counsel", ergebnis: "fehler", fehler: "HTTP 529" },
      { agent: "publisher", ergebnis: "uebersprungen", fehler: null },
      { agent: "amplifier", ergebnis: "uebersprungen", fehler: null },
    ],
  });
  const m = cronsMesswert([MORGEN, ABEND, aktiv(AUTO)], [teil], jetzt);
  assert.equal(m.status, "warnung");
  assert.equal(anzeige(m), "Content Auto-Produce: 2 von 3 Agenten gescheitert · +2 weitere");
  // Rot: der fehlgeschlagene Lauf vor "nicht lesbar" (unlesbare Zeile eines aktiven Jobs).
  const kaputt = { ...zeile("briefing-morgen", "2026-11-09T07:03:05.000Z"), http_status: 0 };
  const rot = cronsMesswert([aktiv(MORGEN), ABEND, aktiv(AUTO)], [kaputt, { ...teil, ergebnis: "fehler" }], jetzt);
  assert.equal(rot.status, "fehler");
  assert.equal(anzeige(rot), "Content Auto-Produce: fehlgeschlagen · +1 weitere");
});

test("T-A6 Anzeige (Prüfbefund B5): Rangfolge von Client und Server gleich; warnung neben nicht_gemessen nennt den bernsteinfarbenen Job", () => {
  assert.deepEqual(types.CRON_STATUS_RANG, statusServer.STATUS_RANG);
  const jetzt = "2026-11-09T19:00:00.000Z"; // Mo 20:00 Berlin
  // Morgen aus (warnung); Abend aktiv seit Mo 09.11., sein S (Fr 18:03) liegt davor (nicht_gemessen); Auto ok.
  const m = cronsMesswert([MORGEN, aktiv(ABEND, "2026-11-09T00:00:00+01:00"), aktiv(AUTO)], [zeile("content-auto-produce", "2026-11-09T08:07:05.000Z")], jetzt);
  assert.deepEqual(m.wert.jobs.map((j) => j.status), ["warnung", "nicht_gemessen", "ok"]);
  assert.equal(m.status, "warnung");
  const z = cronsZeile({ erzeugt_am: jetzt, crons: m });
  assert.equal(z.text, "Briefing morgens: laut Plan aus seit 30.07.2026 · VPS-Crontab");
  assert.equal(z.farbe, "var(--gp-amber)");
});

test("T-A7 Anzeige (Prüfbefund B6): Zähltexte für unvollständige und gemischt gescheiterte Agenten", () => {
  const anzeige = (m) => types.cronsAnzeige(types.cronsFeld(m), ZEIT).text;
  const ok = [zeile("content-auto-produce", "2026-11-09T08:07:05.000Z"), zeile("briefing-abend", "2026-11-09T17:03:05.000Z")];
  const unvollst = zeile("briefing-morgen", "2026-11-09T07:03:05.000Z", "teilweise", {
    teilergebnisse: [
      { agent: "oracle", ergebnis: "ok", fehler: null },
      { agent: "donna", ergebnis: "teilweise", fehler: "Antwort abgeschnitten (stop_reason max_tokens)" },
    ],
  });
  assert.equal(anzeige(cronsMesswert(AKTIV_PLAN, [unvollst, ...ok], ZEIT)), "Briefing morgens: 1 von 2 Agenten unvollständig");
  const gemischt = zeile("content-auto-produce", "2026-11-09T08:07:05.000Z", "teilweise", {
    teilergebnisse: [
      { agent: "researcher", ergebnis: "ok", fehler: null },
      { agent: "scribe", ergebnis: "fehler", fehler: "HTTP 529" },
      { agent: "counsel", ergebnis: "teilweise", fehler: "Antwort abgeschnitten" },
      { agent: "publisher", ergebnis: "uebersprungen", fehler: null },
    ],
  });
  assert.equal(
    anzeige(cronsMesswert(AKTIV_PLAN, [zeile("briefing-morgen", "2026-11-09T07:03:05.000Z"), gemischt, ok[1]], ZEIT)),
    "Content Auto-Produce: 1 von 3 Agenten gescheitert · 1 unvollständig",
  );
  const ohneTeile = { ...unvollst, teilergebnisse: [], hinweis: "1 von 2 Agenten vollständig" };
  assert.equal(anzeige(cronsMesswert(AKTIV_PLAN, [ohneTeile, ...ok], ZEIT)), "Briefing morgens: teilweise · 1 von 2 Agenten vollständig");
});

test("T-A8 Anzeige (Prüfbefund B8): Teilergebnis null oder in fremder Form → 'Job-Liste unlesbar' statt Absturz", () => {
  const gut = cronsMesswert(AKTIV_PLAN, [zeile("briefing-morgen", "2026-11-09T07:03:05.000Z", "teilweise", { teilergebnisse: [{ agent: "oracle", ergebnis: "ok", fehler: null }] })], ZEIT);
  assert.notEqual(types.cronsFeld(gut).wert, null, "Gegenprobe: die echte Antwort ist lesbar");
  for (const [name, teile] of [
    ["null-Element", [null]],
    ["Ergebnis keine Zeichenkette", [{ agent: "oracle", ergebnis: 5 }]],
    ["fehler als Objekt", [{ agent: "oracle", ergebnis: "fehler", fehler: { text: "x" } }]],
  ]) {
    const kaputt = structuredClone(gut);
    kaputt.wert.jobs[0].letzter_lauf.teilergebnisse = teile;
    const f = types.cronsFeld(kaputt);
    assert.equal(f.wert, null, name);
    assert.match(f.hinweis, /Job-Liste der Antwort unlesbar/, name);
    const z = cronsZeile({ erzeugt_am: ZEIT, crons: kaputt });
    assert.equal(z.text, "Fehler", `${name}: Status in Worten, kein Absturz`);
  }
  const fremd = structuredClone(gut);
  fremd.wert.jobs[0].hinweis = { text: "x" };
  assert.equal(types.cronsFeld(fremd).wert, null, "Textfeld als Objekt");
  // Prüfbefund P3A-3 (dritte Prüfung): dieselbe Prüfung für die neueren Textfelder (CRON_TEXTFELDER in
  // lib/types.ts) — vorher ungetestet. Fehlte urteil_ab_berlin oder erster_sollzeitpunkt_berlin in der
  // Liste, warf das Rendern bei einer Zahl oder einem Objekt (TypeError in ohneGleichenTag).
  const basis = structuredClone(gut);
  Object.assign(basis.wert.jobs[0], { erster_sollzeitpunkt_berlin: "Mo 16.11. 08:03", urteil_ab_berlin: "Mo 16.11. 10:03" });
  assert.notEqual(types.cronsFeld(basis).wert, null, "Gegenprobe: mit beiden Feldern lesbar");
  for (const feld of ["sollzeitpunkt", "erster_sollzeitpunkt_berlin", "urteil_ab_berlin", "stolperdraht_spalte", "stolperdraht_quittiert_bis_berlin"]) {
    for (const wert of [5, { text: "x" }]) {
      const name = `${feld} = ${JSON.stringify(wert)}`;
      const kaputt = structuredClone(basis);
      kaputt.wert.jobs[0][feld] = wert;
      const f = types.cronsFeld(kaputt);
      assert.equal(f.wert, null, name);
      assert.match(f.hinweis, /Job-Liste der Antwort unlesbar/, name);
      assert.equal(cronsZeile({ erzeugt_am: ZEIT, crons: kaputt }).text, "Fehler", `${name}: Status in Worten, kein Absturz`);
    }
  }
});

test("T-A9 Anzeige: Texte der nachgebesserten Lagen (Z3, Z2, Z4, Z6) und ältere Antworten ohne die neuen Felder", () => {
  const anzeige = (m) => types.cronsAnzeige(types.cronsFeld(m), m.gemessen_am).text;
  const mo23 = "2026-11-23T09:04:00.000Z";
  const ueber = cronsMesswert([aktiv(MORGEN), ABEND, AUTO], [zeile("briefing-morgen", "2026-11-16T07:03:05.000Z")], mo23);
  assert.equal(anzeige(ueber), "Briefing morgens: überfällig seit Di 17.11. 08:03 · letzter Lauf vor 7 Tagen");
  assert.ok(cronsZeile({ erzeugt_am: mo23, crons: ueber }).title.includes("Überfällig seit: Di 17.11. 08:03 (Europe/Berlin, erster verpasster Sollzeitpunkt)"));
  const zukunft = cronsMesswert([aktiv(MORGEN), ABEND, AUTO], [zeile("briefing-morgen", "2027-03-01T07:03:00.000Z")], "2026-11-20T09:04:00.000Z");
  assert.equal(anzeige(zukunft), "Briefing morgens: Zeitpunkt des Laufs unplausibel: begonnen_am 01.03.2027 08:03 liegt mehr als 10 min nach der Messzeit");
  const teils = cronsMesswert(totmann.TOTMANN_PLAN, [{ ...zeile("briefing-abend", "2026-11-20T17:03:00.000Z"), http_status: 0 }], "2026-11-20T20:00:00.000Z");
  assert.equal(anzeige(teils), "Briefing abends: lief zuletzt am 20.11.2026 18:03, obwohl als aus geführt · eine Zeile in lauf_nachweis ist teilweise unlesbar");
  // Ältere Antwort ohne die neuen Felder: dieselben Texte wie vorher, kein Absturz.
  const alt = structuredClone(ueber);
  for (const j of alt.wert.jobs) for (const k of ["aktiv_seit", "ueberfaellig_seit", "ueberfaellig_seit_berlin", "stolperdraht_am", "stolperdraht_am_berlin", "bewerteter_lauf", "hinweis"]) delete j[k];
  assert.equal(anzeige(alt), "Briefing morgens: überfällig seit Mo 23.11. 08:03 · letzter Lauf vor 7 Tagen");
  const altStolper = structuredClone(cronsMesswert(totmann.TOTMANN_PLAN, [zeile("briefing-abend", "2026-11-20T17:03:00.000Z")], "2026-11-20T20:00:00.000Z"));
  delete altStolper.wert.jobs[1].stolperdraht_am_berlin;
  assert.equal(anzeige(altStolper), "Briefing abends: läuft, obwohl als aus geführt");
});

// ═══ Anzeige: zweite Prüfung des Branches (anzeige-1 bis anzeige-5) ═══

/** Der Tooltip-Block eines Jobs: seine Kopfzeile und die eingerückten Zeilen darunter. */
function jobBlock(title, kopf) {
  const zeilen = title.split("\n");
  const ab = zeilen.findIndex((l) => l.startsWith(kopf));
  assert.ok(ab >= 0, `Block ${kopf} fehlt:\n${title}`);
  const ende = zeilen.findIndex((l, i) => i > ab && !l.startsWith("  "));
  return zeilen.slice(ab, ende === -1 ? undefined : ende).join("\n");
}

test("T-A10 Anzeige (Prüfbefund anzeige-1): Stolperdraht im Tooltip — aus einer teilweise unlesbaren Zeile nicht 'keine Zeile in lauf_nachweis'", () => {
  const jetzt = "2026-11-20T20:00:00.000Z";
  // Der Fall "teils" aus T-A9: einzige Zeile briefing-abend Fr 20.11. 18:03, http_status 0.
  const teils = cronsMesswert(totmann.TOTMANN_PLAN, [{ ...zeile("briefing-abend", "2026-11-20T17:03:00.000Z"), http_status: 0 }], jetzt);
  const z = cronsZeile({ erzeugt_am: jetzt, crons: teils });
  assert.equal(z.text, "Briefing abends: lief zuletzt am 20.11.2026 18:03, obwohl als aus geführt · eine Zeile in lauf_nachweis ist teilweise unlesbar");
  const abend = jobBlock(z.title, "Briefing abends (briefing-abend):");
  // Die übrigen Jobs haben wirklich keine Zeile; der des Stolperdrahts hat eine.
  assert.doesNotMatch(abend, /keine Zeile in lauf_nachweis/, "die rote Zeile nennt einen Lauf");
  assert.ok(abend.includes("\n  Stolperdraht: Lauf begonnen 20.11.2026 18:03 (Europe/Berlin)\n"), abend);
  assert.ok(abend.includes("\n  Letzter Lauf: Zeile teilweise unlesbar (begonnen 20.11.2026 18:03, Europe/Berlin)"), abend);
  // Ältere lesbare Zeile und jüngere unlesbare: Der Tooltip nennt beide Zeitpunkte.
  const zwei = cronsMesswert(
    totmann.TOTMANN_PLAN,
    [zeile("briefing-abend", "2026-11-19T17:03:00.000Z"), { ...zeile("briefing-abend", "2026-11-20T17:03:00.000Z", "uebersprungen"), teilergebnisse: [{ ergebnis: "ok" }] }],
    jetzt,
  );
  const z2 = cronsZeile({ erzeugt_am: jetzt, crons: zwei });
  assert.ok(z2.title.includes("Stolperdraht: Lauf begonnen 20.11.2026 18:03 (Europe/Berlin)"), z2.title);
  assert.ok(z2.title.includes("Letzter Lauf: 19.11.2026 18:03:00 (Europe/Berlin) · ok"), z2.title);
  // Lesbare Zeile: Die Stolperdraht-Zeile steht ebenso da.
  const lesbar = cronsZeile({ erzeugt_am: jetzt, crons: cronsMesswert(totmann.TOTMANN_PLAN, [zeile("briefing-abend", "2026-11-20T17:03:00.000Z")], jetzt) });
  assert.ok(lesbar.title.includes("Stolperdraht: Lauf begonnen 20.11.2026 18:03 (Europe/Berlin)"), lesbar.title);
  // Prüfbefund logik-2: Stolperdraht aus einer Zeile mit unplausibler Zeit — nach der DB-Uhr, gekennzeichnet.
  const di = "2026-11-24T20:00:00.000Z";
  const zukunft = cronsMesswert(totmann.TOTMANN_PLAN, [{ ...zeile("briefing-abend", "2027-11-24T17:03:00.000Z"), eingetragen_am: "2026-11-24T17:04:01.000Z" }], di);
  const z3 = cronsZeile({ erzeugt_am: di, crons: zukunft });
  assert.equal(
    z3.text,
    "Briefing abends: lief zuletzt am 24.11.2026 18:04, obwohl als aus geführt · Zeitstempel des Laufs unplausibel, eingetragen am 24.11.2026 18:04 (DB-Uhr; begonnen_am 24.11.2027 18:03 liegt mehr als 10 min nach der Messzeit)",
  );
  assert.ok(z3.title.includes("Stolperdraht: Lauf eingetragen 24.11.2026 18:04 (Europe/Berlin, DB-Uhr — Zeitstempel des Laufs unplausibel)"), z3.title);
  // Prüfbefund P3A-3: teils unlesbar UND Zeit unplausibel (kein lesbarer letzter Lauf) — die Zeile nennt
  // "eingetragen" (DB-Uhr); "begonnen 24.11.2026" stimmte nicht, begonnen_am liegt im Jahr 2027.
  const teilsZukunft = cronsMesswert(
    totmann.TOTMANN_PLAN,
    [{ ...zeile("briefing-abend", "2027-11-24T17:03:00.000Z"), eingetragen_am: "2026-11-24T17:04:01.000Z", http_status: 0 }],
    di,
  );
  assert.deepEqual([teilsZukunft.wert.jobs[1].letzter_lauf, teilsZukunft.wert.jobs[1].stolperdraht_spalte], [null, "eingetragen_am"]);
  const abend4 = jobBlock(cronsZeile({ erzeugt_am: di, crons: teilsZukunft }).title, "Briefing abends (briefing-abend):");
  assert.ok(abend4.includes("\n  Letzter Lauf: Zeile teilweise unlesbar (eingetragen 24.11.2026 18:04, Europe/Berlin)"), abend4);
});

test("T-A11 Anzeige (Prüfbefund anzeige-2): erster Sollzeitpunkt steht aus — Lage je Job, erster zählender Sollzeitpunkt mit Urteil, 'laut Plan aktiv seit'", () => {
  const seit = "2026-11-16T00:00:00+01:00";
  const jetzt = "2026-11-16T06:00:00.000Z"; // Mo 07:00 Berlin, Tabelle leer
  // d1: nur Briefing morgens aktiv — die Zeile nennt die bernsteinfarbenen Jobs, der Tooltip die Lage.
  const d1 = cronsZeile({ erzeugt_am: jetzt, crons: cronsMesswert([aktiv(MORGEN, seit), ABEND, AUTO], [], jetzt) });
  assert.equal(d1.text, "2 von 3 Jobs: laut Plan aus seit 30.07.2026 · VPS-Crontab");
  assert.equal(d1.farbe, "var(--gp-amber)");
  assert.ok(d1.title.includes("Briefing morgens (briefing-morgen): laut Plan aktiv seit 16.11.2026 00:00:00 (Europe/Berlin)\n  Lage: erster Sollzeitpunkt steht aus\n"), d1.title);
  assert.ok(d1.title.includes("\n  Erster zählender Sollzeitpunkt: Mo 16.11. 08:03 (Europe/Berlin), Urteil ab 10:03\n"), d1.title);
  assert.ok(d1.title.includes("Letzter Lauf: keiner in lauf_nachweis (laut Plan aktiv seit 16.11.2026 00:00:00, Europe/Berlin)"), d1.title);
  assert.ok(d1.title.includes("Briefing abends (briefing-abend): laut Plan aus seit 30.07.2026 — Crons abgeschaltet (Betreiber-Entscheid)\n  Lage: laut Plan aus seit 30.07.2026 · VPS-Crontab\n"), d1.title);
  // Ein S vor aktiv_seit heißt nicht mehr "Sollzeitpunkt".
  assert.doesNotMatch(d1.title, /Sollzeitpunkt: Fr 13\.11\./);
  // d2: alle drei aktiv — die Zeile grau, im Tooltip je Job erster zählender Sollzeitpunkt und Urteil.
  const d2 = cronsZeile({ erzeugt_am: jetzt, crons: cronsMesswert(totmann.TOTMANN_PLAN.map((j) => aktiv(j, seit)), [], jetzt) });
  assert.equal(d2.text, "erster Sollzeitpunkt steht aus");
  assert.equal(d2.farbe, "var(--gp-ink-3)");
  for (const [uhr, urteil] of [
    ["08:03", "10:03"],
    ["18:03", "20:03"],
    ["09:07", "11:07"],
  ]) {
    assert.ok(d2.title.includes(`Erster zählender Sollzeitpunkt: Mo 16.11. ${uhr} (Europe/Berlin), Urteil ab ${urteil}`), d2.title);
  }
  assert.equal((d2.title.match(/\n {2}Lage: erster Sollzeitpunkt steht aus\n/g) ?? []).length, 3);
  assert.doesNotMatch(d2.title, /Sollzeitpunkt: Fr 13\.11\./);
  // Urteil am Folgetag: mit Datum.
  const spaet = cronsZeile({
    erzeugt_am: jetzt,
    crons: cronsMesswert([{ ...aktiv(MORGEN, seit), uhrzeit: "23:30" }, ABEND, AUTO], [], jetzt),
  });
  assert.ok(spaet.title.includes("Erster zählender Sollzeitpunkt: Mo 16.11. 23:30 (Europe/Berlin), Urteil ab Di 17.11. 01:30"), spaet.title);
});

test("T-A12 Anzeige (Prüfbefund anzeige-3): Die Quittung des Stolperdrahts steht in der Antwort, im Tooltip und im Hinweis", () => {
  const plan = totmann.TOTMANN_PLAN.map((j) => (j.job === "briefing-abend" ? { ...j, stolperdraht_quittiert_bis: "2026-11-21T00:00:00+01:00" } : j));
  const jetzt = "2026-11-25T10:00:00.000Z";
  const m = cronsMesswert(plan, [zeile("briefing-abend", "2026-11-20T17:03:00.000Z")], jetzt);
  const abend = m.wert.jobs[1];
  assert.equal(abend.lage, "aus", "der Lauf vom 20.11. ist quittiert");
  assert.equal(abend.stolperdraht_quittiert_bis, "2026-11-20T23:00:00.000Z");
  assert.equal(abend.stolperdraht_quittiert_bis_berlin, "21.11.2026 00:00");
  assert.equal(m.wert.jobs[0].stolperdraht_quittiert_bis_berlin, null);
  const z = cronsZeile({ erzeugt_am: jetzt, crons: m });
  assert.equal(z.text, "laut Plan aus seit 30.07.2026 · VPS-Crontab"); // Tor-Prüfung 07.11.2026 (T2): Planwert und Umfang sichtbar
  assert.ok(z.title.includes("\n  Stolperdraht quittiert bis 21.11.2026 00:00 (Europe/Berlin, Plan lib/totmann.ts) — Läufe davor lösen nicht aus\n"), z.title);
  // Auch im Hinweis der Messung — den liest ein Bundle von vor dieser Änderung (Prüfbefund B7).
  assert.equal(m.hinweis, "alle 3 Jobs laut Plan aus seit 30.07.2026 · Stolperdraht Briefing abends laut Plan quittiert bis 21.11.2026 00:00 (Europe/Berlin)");
  assert.ok(z.title.includes(`Hinweis: ${m.hinweis}`), z.title);
  // Ohne Quittung kein solcher Satz.
  const ohne = cronsZeile({ erzeugt_am: jetzt, crons: cronsMesswert(totmann.TOTMANN_PLAN, [], jetzt) });
  assert.doesNotMatch(ohne.title, /quittiert/);
});

test("T-A13 Anzeige (Prüfbefund anzeige-4): Zeitpunkte im Tooltip in Europe/Berlin — unter TZ=UTC nennen Zeile und Tooltip dieselbe Uhrzeit", () => {
  // TZ wird hier erst zur Laufzeit umgestellt; einen beim ersten Aufruf zwischengespeicherten
  // Formatierer ohne feste Zone deckt erst T-A13b in tests/t-totmann-zeitzone.test.mjs auf (eigener Prozess).
  const vorher = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    assert.equal(new Date("2026-11-09T07:03:05.000Z").getHours(), 7, "Voraussetzung: der Prozess rechnet jetzt in UTC");
    const m = cronsMesswert(totmann.TOTMANN_PLAN, [zeile("briefing-morgen", "2026-11-09T07:03:05.000Z")], ZEIT);
    const z = cronsZeile({ erzeugt_am: ZEIT, crons: m });
    assert.equal(z.text, "Briefing morgens: lief zuletzt am 09.11.2026 08:03, obwohl als aus geführt");
    assert.ok(
      z.title.includes("\n  Letzter Lauf: 09.11.2026 08:03:05 (Europe/Berlin) · ok · HTTP 200 · eingetragen 09.11.2026 08:03:06 (Europe/Berlin, DB-Uhr)"),
      z.title,
    );
    assert.ok(z.title.includes("\n  Stolperdraht: Lauf begonnen 09.11.2026 08:03 (Europe/Berlin)"), z.title);
    const totmannTeil = z.title.split("\n").filter((l) => !l.startsWith("gemessen:")).join("\n");
    assert.doesNotMatch(totmannTeil, /07:03/, "keine Uhrzeit in der Zone des Prozesses");
    const seit = "2026-11-16T00:00:00+01:00";
    const akt = cronsZeile({ erzeugt_am: "2026-11-16T06:00:00.000Z", crons: cronsMesswert([aktiv(MORGEN, seit), ABEND, AUTO], [], "2026-11-16T06:00:00.000Z") });
    assert.ok(akt.title.includes("laut Plan aktiv seit 16.11.2026 00:00:00 (Europe/Berlin)"), akt.title);
    assert.doesNotMatch(akt.title, /15\.11\.2026/, "nicht der Vortag in UTC");
  } finally {
    if (vorher === undefined) delete process.env.TZ;
    else process.env.TZ = vorher;
  }
});

test("T-A14 Anzeige (Prüfbefund anzeige-5): 'toString' und 'constructor' fallen auf die Rückfallregeln, nicht auf Object.prototype", () => {
  const echt = cronsMesswert(totmann.TOTMANN_PLAN, [zeile("briefing-morgen", "2026-11-09T07:03:05.000Z")], ZEIT);
  const anzeige = (m) => types.cronsAnzeige(types.cronsFeld(m), ZEIT);
  for (const name of ["toString", "constructor"]) {
    // Unbekannter Status: Rang "fehler" (Rückfall) — vorher "0 von 3 Jobs: undefined".
    const einer = structuredClone(echt);
    einer.wert.jobs[0].status = name;
    assert.equal(anzeige(einer).text, "Briefing morgens: lief zuletzt am 09.11.2026 08:03, obwohl als aus geführt", name);
    const alle = structuredClone(echt);
    for (const j of alle.wert.jobs) j.status = name;
    assert.equal(anzeige(alle).text, "Briefing morgens: lief zuletzt am 09.11.2026 08:03, obwohl als aus geführt · +2 weitere", name);
    // Unbekanntes Ergebnis: erscheint, wie es ist — vorher der Quelltext einer Funktion.
    const erg = structuredClone(echt);
    erg.wert.jobs[0].letzter_lauf.ergebnis = name;
    const titel = anzeige(erg).zusatz;
    assert.ok(titel.includes(`(Europe/Berlin) · ${name} · HTTP 200`), titel);
    assert.doesNotMatch(titel, /native code/, name);
    // Unbekannte Lage: Vorrang 0 wie eine Lage mit Laufergebnis, Text "Lage unbekannt".
    const lage = structuredClone(cronsMesswert(totmann.TOTMANN_PLAN, [], ZEIT));
    lage.wert.jobs[1].lage = name;
    assert.equal(anzeige(lage).text, "Briefing abends: Lage unbekannt · +2 weitere", name);
    // Farbe eines unbekannten Status (statusFarbe, vorbestehend): grau statt Funktion.
    assert.equal(types.statusFarbe(name), "var(--gp-ink-3)", name);
    const farbe = cronsZeile({ erzeugt_am: ZEIT, crons: { ...echt, status: name } });
    assert.equal(farbe.farbe, "var(--gp-ink-3)", name);
    assert.doesNotMatch(farbe.html, /native code/, name);
  }
});

// ═══ Mutationstest der dritten Nachbesserung (cf604a4), Runde 2: überlebender Mutant der Anzeige ═══
// X22 und X27 (Bewertung) prüfen die Tests "Mutant X22" und "Mutant X27" in tests/b-status-server.test.mjs.

test("T-A15 Anzeige (Mutant X14): steht der Hinweis eines Jobs schon in der Lage, nennt der Tooltip ihn kein zweites Mal", () => {
  // cronJobTitel (lib/types.ts) hängt "  Hinweis: …" nur an, wenn die Lage-Zeile den Hinweis nicht schon
  // enthält: Beim Stolperdraht und bei unplausibler Zeit steht er dort. Ohne diese Bedingung stand
  // dieselbe Aussage zweimal im Block des Jobs, und kein Test bemerkte es.
  const fr = "2026-11-20T20:00:00.000Z"; // Fr 21:00 Berlin
  const di = "2026-11-24T20:00:00.000Z"; // Di 21:00 Berlin
  const frMorgen = "2026-11-20T09:04:00.000Z"; // Fr 10:04 Berlin
  for (const [name, m, kopf, hinweis] of [
    [
      "Stolperdraht aus einer teils unlesbaren Zeile",
      cronsMesswert(totmann.TOTMANN_PLAN, [{ ...zeile("briefing-abend", "2026-11-20T17:03:00.000Z"), http_status: 0 }], fr),
      "Briefing abends (briefing-abend):",
      "eine Zeile in lauf_nachweis ist teilweise unlesbar",
    ],
    [
      "Stolperdraht nach eingetragen_am (Zeit der Zeile unplausibel)",
      cronsMesswert(totmann.TOTMANN_PLAN, [{ ...zeile("briefing-abend", "2027-11-24T17:03:00.000Z"), eingetragen_am: "2026-11-24T17:04:01.000Z" }], di),
      "Briefing abends (briefing-abend):",
      "Zeitstempel des Laufs unplausibel, eingetragen am 24.11.2026 18:04 (DB-Uhr; begonnen_am 24.11.2027 18:03 liegt mehr als 10 min nach der Messzeit)",
    ],
    [
      "aktiver Job, Zeitpunkt des Laufs unplausibel",
      cronsMesswert([aktiv(MORGEN), ABEND, AUTO], [zeile("briefing-morgen", "2027-03-01T07:03:00.000Z")], frMorgen),
      "Briefing morgens (briefing-morgen):",
      "begonnen_am 01.03.2027 08:03 liegt mehr als 10 min nach der Messzeit",
    ],
  ]) {
    assert.ok(m.wert.jobs.some((j) => j.hinweis === hinweis), `${name}: Voraussetzung, der Server meldet den Hinweis am Job`);
    const block = jobBlock(cronsZeile({ erzeugt_am: m.gemessen_am, crons: m }).title, kopf);
    const zeilen = block.split("\n");
    assert.ok(zeilen.find((l) => l.startsWith("  Lage: "))?.includes(hinweis), `${name}: der Hinweis steht in der Lage\n${block}`);
    assert.equal(block.split(hinweis).length - 1, 1, `${name}: genau einmal im Block\n${block}`);
    assert.deepEqual(zeilen.filter((l) => l.startsWith("  Hinweis: ")), [], `${name}: keine eigene Hinweis-Zeile\n${block}`);
  }
  // Gegenprobe: Einen Hinweis, den die Lage nicht nennt (etwa aus einer neueren Antwort), nennt der Tooltip
  // genau einmal, als eigene Zeile.
  const fremd = structuredClone(cronsMesswert(totmann.TOTMANN_PLAN, [], fr));
  fremd.wert.jobs[0].hinweis = "Hinweis, den die Lage nicht nennt";
  const block = jobBlock(cronsZeile({ erzeugt_am: fr, crons: fremd }).title, "Briefing morgens (briefing-morgen):");
  assert.deepEqual(
    block.split("\n").filter((l) => l.includes("Hinweis, den die Lage nicht nennt")),
    ["  Hinweis: Hinweis, den die Lage nicht nennt"],
    block,
  );
});

// ═══ scripts/lauf_nachweis.sql ═══

/** Inhalt jeder CHECK (...)-Klausel, Klammern ausgezählt. */
function checkAusdruecke(sql) {
  const aus = [];
  const re = /\bCHECK\s*\(/gi;
  while (re.exec(sql) !== null) {
    let tiefe = 1;
    let j = re.lastIndex;
    for (; j < sql.length && tiefe > 0; j++) {
      if (sql[j] === "(") tiefe++;
      else if (sql[j] === ")") tiefe--;
    }
    aus.push(sql.slice(re.lastIndex, j - 1));
    re.lastIndex = j;
  }
  return aus;
}

/**
 * SQL ohne Kommentare: "--" bis zum Zeilenende und "/* … *\/" (in Postgres verschachtelbar); Text in
 * '…' bleibt unberührt. Prüfbefund oeffentlich-1: Vorher entfernte T-S1 nur "--"-Kommentare — eine
 * Anweisung in einem Blockkommentar galt als vorhanden, obwohl Postgres sie nie ausführt.
 */
function ohneKommentare(sql) {
  let aus = "";
  let tiefe = 0;
  let imText = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const n = sql[i + 1];
    if (tiefe > 0) {
      if (c === "/" && n === "*") {
        tiefe++;
        i++;
      } else if (c === "*" && n === "/") {
        tiefe--;
        i++;
        if (tiefe === 0) aus += " ";
      }
      continue;
    }
    if (imText) {
      aus += c;
      if (c === "'") imText = false;
      continue;
    }
    if (c === "'") {
      imText = true;
      aus += c;
    } else if (c === "-" && n === "-") {
      while (i + 1 < sql.length && sql[i + 1] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      tiefe = 1;
      i++;
    } else {
      aus += c;
    }
  }
  return aus;
}

/** Anweisungen der SQL-Datei: ohne Kommentare, am ";" außerhalb von Text getrennt, Leerraum vereinheitlicht. */
function anweisungen(sql) {
  const liste = [];
  let jetzt = "";
  let imText = false;
  for (const c of ohneKommentare(sql)) {
    if (c === "'") imText = !imText;
    if (c === ";" && !imText) {
      liste.push(jetzt);
      jetzt = "";
    } else {
      jetzt += c;
    }
  }
  liste.push(jetzt);
  return liste.map(vereinheitlicht).filter(Boolean);
}

/**
 * Die Tabelle, Leerraum vereinheitlicht (Prüfbefund P3A-2, dritte Prüfung): Vorher prüfte T-S1 von der
 * ersten Anweisung nur den Anfang. Der Zerleger kennt nur '…' — hinter einem E'\''-String oder einem
 * Bezeichner mit Hochkomma ("…'…") las er eine angehängte Anweisung samt ";" als Text der Tabelle, die
 * Postgres aber einzeln ausführt (gemessen mit Mutanten der Datei: der Test blieb grün). Exakt
 * verglichen fällt jede solche Anweisung auf: Die erwarteten Texte enthalten weder E'…' noch "…" noch
 * $-Quotes, außerhalb von '…' also nichts, was Postgres anders liest als der Zerleger.
 */
const TABELLE =
  "CREATE TABLE IF NOT EXISTS public.lauf_nachweis ( id BIGSERIAL PRIMARY KEY, job TEXT NOT NULL CHECK (job ~ '^[a-z0-9-]{1,40}$'), " +
  "begonnen_am TIMESTAMPTZ NOT NULL, beendet_am TIMESTAMPTZ NOT NULL, eingetragen_am TIMESTAMPTZ NOT NULL DEFAULT now(), " +
  "ergebnis TEXT NOT NULL CHECK (ergebnis IN ('ok','teilweise','fehler','uebersprungen')), http_status SMALLINT CHECK (http_status BETWEEN 100 AND 599), " +
  "teilergebnisse JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(teilergebnisse) = 'array'), hinweis TEXT CHECK (char_length(hinweis) <= 300), " +
  "CHECK (beendet_am >= begonnen_am) )";

/**
 * Alle Anweisungen nach CREATE TABLE, in dieser Reihenfolge (Prüfbefunde oeffentlich-1, oeffentlich-3,
 * D1): Index nach der DB-Uhr; RLS ohne Policy; anon, authenticated und PUBLIC ohne Rechte; service_role
 * erst ohne alle Rechte, dann genau lesen und anhängen (Sequenz: USAGE für nextval).
 */
const ANWEISUNGEN_NACH_TABELLE = [
  "CREATE INDEX IF NOT EXISTS idx_lauf_nachweis_job_eingetragen ON public.lauf_nachweis (job, eingetragen_am DESC)",
  "ALTER TABLE public.lauf_nachweis ENABLE ROW LEVEL SECURITY",
  "REVOKE ALL ON TABLE public.lauf_nachweis FROM PUBLIC, anon, authenticated",
  "REVOKE ALL ON SEQUENCE public.lauf_nachweis_id_seq FROM PUBLIC, anon, authenticated",
  "REVOKE ALL ON TABLE public.lauf_nachweis FROM service_role",
  "REVOKE ALL ON SEQUENCE public.lauf_nachweis_id_seq FROM service_role",
  "GRANT SELECT, INSERT ON TABLE public.lauf_nachweis TO service_role",
  "GRANT USAGE ON SEQUENCE public.lauf_nachweis_id_seq TO service_role",
];

test("T-S1 scripts/lauf_nachweis.sql (Prüfbefunde B2, oeffentlich-1, oeffentlich-3): Kopf mit Ausführungsvermerk, keine CHECK-Bedingung gegen die DB-Uhr, Rechteblock als exakte, geordnete Liste", () => {
  const sql = readFileSync(SQL_DATEI, "utf8");
  // Am 07.11.2026 ausgeführt: Der Kopf nennt die Migration, damit niemand eine geänderte Fassung
  // erneut ausführt, statt eine neue Migration anzulegen.
  assert.match(sql, /AUSGEFÜHRT am 07\.11\.2026 nach Inhaberentscheid \(Supabase-Migration create_lauf_nachweis_totmann,\n-- Version 20261107094750,/);
  assert.doesNotMatch(sql, /ENTWURF, NICHT AUSGEFÜHRT/);
  const code = ohneKommentare(sql);
  const checks = checkAusdruecke(code);
  assert.equal(checks.length, 6, checks.join(" | "));
  const UHR = /\b(now|current_timestamp|clock_timestamp|statement_timestamp|transaction_timestamp|localtimestamp|current_date|current_time)\b/i;
  for (const c of checks) assert.doesNotMatch(c, UHR, `CHECK gegen die DB-Uhr: ${c}`);
  // Prüfbefund B2: Die DB-Uhr steht auch in der Spalte eingetragen_am — kein CHECK darf sie nennen.
  for (const c of checks) assert.doesNotMatch(c, /\beingetragen_am\b/, `CHECK mit der DB-Uhr-Spalte: ${c}`);
  assert.ok(checks.some((c) => vereinheitlicht(c) === "beendet_am >= begonnen_am"), "beendet_am >= begonnen_am, dieselbe Uhr");
  // now() steht genau einmal: als DEFAULT von eingetragen_am (DB-Uhr).
  assert.equal((code.match(/now\s*\(\s*\)/gi) ?? []).length, 1);
  assert.match(code, /eingetragen_am\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT now\(\)/);
  // Prüfbefund oeffentlich-1: alle Anweisungen, ohne "--"- und Blockkommentare. Zuerst die Tabelle,
  // danach genau diese Liste — eine fehlende, zusätzliche, auskommentierte oder verschobene
  // Anweisung macht den Test rot (vorher prüfte er nur fünf Teilstrings). Prüfbefund P3A-2: auch die
  // Tabelle selbst exakt, die ganze Datei ist eine exakte, geordnete Liste.
  const liste = anweisungen(sql);
  assert.match(liste[0] ?? "", /^CREATE TABLE IF NOT EXISTS public\.lauf_nachweis \(/, "zuerst die Tabelle");
  assert.deepEqual(liste, [TABELLE, ...ANWEISUNGEN_NACH_TABELLE]);
  // Zusätzlich ausgeschlossen, unabhängig von der Liste: Rechte an anon, authenticated oder PUBLIC,
  // abgeschaltete RLS, eine Policy, Realtime. Prüfbefund P3A-2: der GRANT-Ausschluss auch mitten in
  // einer Anweisung (vorher am Anfang verankert).
  for (const a of liste) {
    assert.doesNotMatch(a, /\bGRANT\b.*\bTO\b.*\b(anon|authenticated|public)\b/i, a);
    assert.doesNotMatch(a, /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i, a);
    assert.doesNotMatch(a, /\bCREATE\s+POLICY\b/i, a);
    assert.doesNotMatch(a, /\bALTER\s+PUBLICATION\b/i, a);
  }
  // Dieselben Ergebnis-Werte wie der Code.
  assert.ok(checks.some((c) => c.includes("ergebnis IN ('ok','teilweise','fehler','uebersprungen')")));
  assert.deepEqual([...statusServer.LAUF_ERGEBNISSE], ["ok", "teilweise", "fehler", "uebersprungen"]);
});

test("T-S2 (Prüfbefund oeffentlich-2): NACHWEIS_HINWEIS_MAX = Grenze aus CHECK (char_length(hinweis) <= N); der lange Fehlerpfad besteht die CHECK-Nachbildung", async () => {
  const grenzen = checkAusdruecke(ohneKommentare(readFileSync(SQL_DATEI, "utf8")))
    .map((c) => /^char_length\(hinweis\) <= (\d+)$/.exec(vereinheitlicht(c))?.[1])
    .filter((n) => n !== undefined)
    .map(Number);
  assert.deepEqual(grenzen, [statusServer.NACHWEIS_HINWEIS_MAX], "dieselbe Grenze in SQL und Code");
  // Der lange Fehlerpfad: status fehler mit langem fehler und Speicherfehler — roh über der Grenze
  // (je Teil höchstens 160 Zeichen nach bereinigeFehler, zusammen mehr als 300).
  const roh = statusServer.autoProduceNachweis(200, { status: "fehler", fehler: "y".repeat(500), speicherfehler: ["z".repeat(500)] }, null);
  assert.ok(Array.from(roh.hinweis).length > 300, `roh ${Array.from(roh.hinweis).length} Zeichen`);
  const beginn = new Date(MONTAG);
  const z = statusServer.laufNachweisZeile("content-auto-produce", beginn, new Date(beginn.getTime() + 90_000), roh);
  const verletzt = [...CHECK_NACHBILDUNG].filter(([, gilt]) => !gilt({ ...z, eingetragen_am: MONTAG })).map(([c]) => c);
  assert.deepEqual(verletzt, [], "die Zeile hält alle CHECKs");
  assert.equal(Array.from(z.hinweis).length, 300);
  // Ende zu Ende: Die Route schreibt diese Zeile durch die CHECK-Nachbildung (wie T-R13).
  welt.stoerung = checkStoerung(new Date(Date.parse(MONTAG) + 60_000).toISOString());
  pipelineWelt({ ...FERTIG, status: "fehler", fehler: { stufe: "researcher", grund: "y".repeat(500) }, speicherfehler: ["z".repeat(500)] });
  const r = await mitDatum(MONTAG, async () => antwort(await auto.GET(autoReq())));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "fehler");
  assert.equal(r.body.nachweis_fehler, undefined, "die Zeile wurde angenommen");
  assert.equal(inserts().length, 1);
  assert.equal(Array.from(welt.tabellen.lauf_nachweis[0].hinweis).length, 300);
  assert.match(welt.tabellen.lauf_nachweis[0].hinweis, /^status fehler · researcher: y+…/);
});
