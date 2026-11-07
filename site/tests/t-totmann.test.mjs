// Totmann für Crons und Agenten (Objekt-Studio Stufe 2, Rest aus Stufe 1). Lauf: npm test.
// Spezifikation: docs/intern/objekt-studio-stufe-2.md §2.2–2.5 (lokal, nicht versioniert). Die
// reinen Fälle der Tabelle in §2.5 stehen in tests/b-status-server.test.mjs; hier:
// - Routentests mit Attrappe: die ECHTEN Handler von /api/cron/briefing, /api/content/auto-produce
//   und /api/status im Prozess, Supabase (PostgREST), activate und die Pipeline aus
//   tests/harness/fake.mjs. Kein Netz — jeder andere fetch wirft. Die Umgebungswerte sind
//   Test-Werte dieses Prozesses, keine echten Schlüssel.
// - die Zeile „Crons" im Systemzustand (CommandPanels.tsx übersetzt, mit Attrappen geladen),
// - die SQL-Datei scripts/lauf_nachweis.sql (keine CHECK-Bedingung gegen now()).
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

test("T-R13 Zeile mit beendet_am nach der DB-Uhr wird angenommen (Nachbildung der CHECKs aus scripts/lauf_nachweis.sql)", async () => {
  // Nachbildung, keine echte Datenbank: genau die CHECKs der SQL-Datei, die DB-Uhr 5 min hinter
  // der App-Uhr. Die SQL-Datei selbst prüft T-S1 (kein CHECK gegen now()).
  const verletzt = (z) =>
    [
      !/^[a-z0-9-]{1,40}$/.test(z.job) && "job",
      !["ok", "teilweise", "fehler", "uebersprungen"].includes(z.ergebnis) && "ergebnis",
      z.http_status !== null && !(z.http_status >= 100 && z.http_status <= 599) && "http_status",
      !Array.isArray(z.teilergebnisse) && "teilergebnisse",
      z.hinweis !== null && Array.from(z.hinweis).length > 300 && "hinweis",
      !(Date.parse(z.beendet_am) >= Date.parse(z.begonnen_am)) && "beendet_am >= begonnen_am",
    ].filter(Boolean);
  let dbUhr = null;
  welt.stoerung = (a) => {
    if (a.art !== "supabase" || a.tabelle !== "lauf_nachweis" || a.methode !== "POST") return null;
    dbUhr = Date.parse(a.body.beendet_am) - 5 * 60_000;
    const f = verletzt(a.body);
    return f.length > 0 ? { status: 400, body: { code: "23514", message: `CHECK verletzt: ${f.join(", ")}` } } : null;
  };
  const r = await mitDatum("2026-11-09T07:03:00Z", async () => antwort(await briefing.GET(briefingReq())));
  assert.equal(r.body.nachweis_fehler, undefined, "angenommen");
  const z = welt.tabellen.lauf_nachweis[0];
  assert.ok(Date.parse(z.beendet_am) > dbUhr, "beendet_am liegt nach der DB-Uhr");
});

// ═══ GET /api/status: Lesen und Bewerten ═══

const Q_CRONS = "Plan site/src/lib/totmann.ts · Supabase · lauf_nachweis (begonnen_am, ergebnis)";

async function statusAbruf() {
  const res = await statusApi.GET();
  assert.equal(res.status, 200);
  return res.json();
}

test("T-L1 /api/status: je Plan-Job die jüngste Zeile (order begonnen_am.desc, limit 1); Probe-Zeilen werden nicht gelesen", async () => {
  welt.tabellen.lauf_nachweis = [
    { id: 1, job: "briefing-morgen", begonnen_am: "2026-11-06T07:03:00.000Z", beendet_am: "2026-11-06T07:04:00.000Z", ergebnis: "ok", http_status: 200, teilergebnisse: [], hinweis: null },
    { id: 2, job: "briefing-morgen", begonnen_am: "2026-11-09T07:03:00.000Z", beendet_am: "2026-11-09T07:04:00.000Z", ergebnis: "teilweise", http_status: 200, teilergebnisse: [], hinweis: null },
    { id: 3, job: "content-auto-produce-probe", begonnen_am: "2026-11-09T09:00:00.000Z", beendet_am: "2026-11-09T09:00:01.000Z", ergebnis: "ok", http_status: 200, teilergebnisse: [], hinweis: null },
  ];
  const s = await statusAbruf();
  const gelesen = lesungen().map((e) => new URLSearchParams(e.query));
  assert.equal(gelesen.length, 3, "eine Abfrage je Plan-Job");
  assert.deepEqual(gelesen.map((p) => p.get("job")).sort(), ["eq.briefing-abend", "eq.briefing-morgen", "eq.content-auto-produce"]);
  for (const p of gelesen) {
    assert.equal(p.get("order"), "begonnen_am.desc");
    assert.equal(p.get("limit"), "1");
    assert.equal(p.get("select"), "job,begonnen_am,beendet_am,ergebnis,http_status,teilergebnisse,hinweis");
  }
  assert.equal(s.crons.quelle, Q_CRONS);
  assert.equal(s.crons.wert.jobs[0].letzter_lauf.begonnen_am, "2026-11-09T07:03:00.000Z", "die jüngste Zeile");
  // Der Plan ist aus: Ein Nachweis nach aus_seit ist der Stolperdraht; die Probe löst ihn nicht aus.
  assert.deepEqual(s.crons.wert.jobs.map((j) => j.lage), ["laeuft_obwohl_aus", "aus", "aus"]);
  assert.equal(s.crons.status, "fehler");
  assert.equal(s.crons.wert.nachweis_seit, "2026-11-07");
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

const aktiv = (job) => ({ ...job, aktiv: true, aus_seit: null, grund: null });
const [MORGEN, ABEND, AUTO] = totmann.TOTMANN_PLAN;
const zeile = (job, begonnen, ergebnis = "ok", extra = {}) => ({
  job,
  begonnen_am: begonnen,
  beendet_am: begonnen,
  ergebnis,
  http_status: 200,
  teilergebnisse: [],
  hinweis: null,
  ...extra,
});

test("T-A1 Anzeige (Erzeuger → Leser): 'Crons · aus seit 30.07.2026' bernstein, Quelle und ehrlicher Tooltip je Job", async () => {
  const s = await statusAbruf();
  const z = cronsZeile({ erzeugt_am: s.erzeugt_am, crons: s.crons });
  assert.equal(z.text, "aus seit 30.07.2026");
  assert.equal(z.farbe, "var(--gp-amber)");
  assert.ok(z.title.startsWith(`Quelle: ${Q_CRONS}\n`), z.title);
  for (const [job, nr] of [
    ["Briefing morgens (briefing-morgen)", 21],
    ["Briefing abends (briefing-abend)", 24],
    ["Content Auto-Produce (content-auto-produce)", 27],
  ]) {
    assert.ok(z.title.includes(`${job}: aus seit 30.07.2026 — Crons abgeschaltet (Betreiber-Entscheid)`), z.title);
    assert.ok(z.title.includes(`Fundstelle: GG/decisions_log.md Abschnitt 30.07.2026; scripts/setup-vps-crons.sh:${nr}`), z.title);
  }
  assert.ok(z.title.includes("Letzter Lauf: Nachweis-Tabelle lauf_nachweis (Schreiber seit 07.11.2026): kein Lauf · VPS-Crontab selbst nicht gemessen"));
  assert.doesNotMatch(z.html, /kein Lauf seit/, "nie 'kein Lauf seit 30.07.' (§2.4)");
});

test("T-A2 Anzeige: Texte je Lage — ok, teilweise, fehlgeschlagen, überfällig, Stolperdraht, Lesefehler", () => {
  const anzeige = (m, bezug = ZEIT) => types.cronsAnzeige(types.cronsFeld(m), bezug).text;
  const plan = totmann.TOTMANN_PLAN.map(aktiv);
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
  assert.equal(anzeige(cronsMesswert(totmann.TOTMANN_PLAN, [abend], ZEIT)), "Briefing abends: läuft, obwohl als aus geführt");
  assert.equal(anzeige(cronsMesswert(totmann.TOTMANN_PLAN, [], ZEIT, "relation does not exist")), "aus seit 30.07.2026 · Nachweis nicht lesbar");
  assert.equal(anzeige(cronsMesswert([aktiv(MORGEN), ABEND, AUTO], [], ZEIT, "relation does not exist")), "Briefing morgens: Nachweis nicht lesbar");
  // Mehrere schlechteste Jobs mit verschiedenen Texten: der erste und die Zahl der weiteren.
  assert.equal(
    anzeige(cronsMesswert(plan, [{ ...morgen, ergebnis: "fehler" }, autoLauf], ZEIT)),
    "Briefing morgens: fehlgeschlagen · +1 weitere",
  );
});

test("T-A3 Anzeige: Tooltip nennt je Job letzten Lauf mit Ergebnis und Teilergebnisse je Agent; Farbe des schlechtesten Jobs", () => {
  const plan = totmann.TOTMANN_PLAN.map(aktiv);
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
  assert.ok(z.title.includes("Briefing morgens (briefing-morgen): aktiv"), z.title);
  assert.ok(z.title.includes("Sollzeitpunkt: Mo 09.11. 08:03 (Europe/Berlin)"), z.title);
  assert.match(z.title, /Letzter Lauf: [^\n]* · teilweise · HTTP 200 · 1 von 2 Agenten vollständig/);
  assert.ok(z.title.includes("Agenten: oracle ok · donna fehler (HTTP 502: leere Antwort)"), z.title);
  assert.ok(z.title.includes("Hinweis: Sollzeitpunkte in Europe/Berlin gelesen; die Zeitzone des VPS ist nicht gemessen."), z.title);
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

test("T-S1 scripts/lauf_nachweis.sql: Entwurf-Kopf, keine CHECK-Bedingung gegen now() (App- gegen DB-Uhr)", () => {
  const sql = readFileSync(path.join(SITE, "..", "scripts", "lauf_nachweis.sql"), "utf8");
  assert.match(sql, /ENTWURF, NICHT AUSGEFÜHRT\. Ausführung nur nach Inhaberentscheid/);
  const code = sql.replace(/--[^\n]*/g, "");
  const checks = checkAusdruecke(code);
  assert.equal(checks.length, 6, checks.join(" | "));
  const UHR = /\b(now|current_timestamp|clock_timestamp|statement_timestamp|transaction_timestamp|localtimestamp|current_date|current_time)\b/i;
  for (const c of checks) assert.doesNotMatch(c, UHR, `CHECK gegen die DB-Uhr: ${c}`);
  assert.ok(checks.some((c) => c.replace(/\s+/g, " ").trim() === "beendet_am >= begonnen_am"), "beendet_am >= begonnen_am, dieselbe Uhr");
  // now() steht genau einmal: als DEFAULT von eingetragen_am (DB-Uhr nur zur Nachvollziehbarkeit).
  assert.equal((code.match(/now\s*\(\s*\)/gi) ?? []).length, 1);
  assert.match(code, /eingetragen_am\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT now\(\)/);
  // Nur die Service-Rolle: keine Policy, kein Realtime, Rechte nur lesen und anhängen.
  assert.doesNotMatch(code, /CREATE POLICY/i);
  assert.doesNotMatch(code, /ALTER PUBLICATION/i);
  assert.match(code, /ENABLE ROW LEVEL SECURITY/);
  assert.match(code, /GRANT SELECT, INSERT ON TABLE public\.lauf_nachweis TO service_role;/);
  assert.match(code, /REVOKE ALL ON TABLE public\.lauf_nachweis FROM PUBLIC, anon, authenticated;/);
  // Dieselben Ergebnis-Werte wie der Code.
  assert.ok(checks.some((c) => c.includes("ergebnis IN ('ok','teilweise','fehler','uebersprungen')")));
  assert.deepEqual([...statusServer.LAUF_ERGEBNISSE], ["ok", "teilweise", "fehler", "uebersprungen"]);
});
