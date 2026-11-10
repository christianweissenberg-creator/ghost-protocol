// Routen-Harness im Repo (Gesamtprüfung 06.11.2026, Fixrunde Z). Lauf: npm test.
//
// Vorher lag die Verhaltens-Harness der Routen nur im Scratchpad; die Repo-Tests a-*.test.mjs
// prüften Quelltext-Muster, und 7 von 8 unabhängigen Mutanten (MX1–MX8) blieben grün. Diese
// Datei ruft die ECHTEN Route-Handler im Prozess auf: Supabase (PostgREST), activate, Claude und
// der Steinadel-Export sind Attrappen aus tests/harness/fake.mjs. Kein Netz — jeder andere fetch
// wirft. Die Umgebungswerte unten sind Test-Werte dieses Prozesses (node --test startet je Datei
// einen eigenen Prozess), keine echten Schlüssel.
// Z_ROUTE_<NAME>=<pfad> prüft statt der Repo-Route eine Kopie (Mutationstests im Scratchpad).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// "@/…" → site/src/….ts, "next/server" → node_modules (ESM braucht die Endung), relative
// Importe ohne Endung aus .ts-Dateien → ".ts" (lib/auftrag.ts importiert so). "server-only"
// (Riegel in lib/agent-prompts.ts) → die leere Fassung, die Next.js im Server-Bundle nimmt.
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
  ANTHROPIC_API_KEY: "sk-ant-harness-TESTWERT-0123456789abcdef",
  IMMONEXUS_EXPORT_TOKEN: "export-test-token-0123456789",
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
  CRON_SECRET: "cron-test-secret-0123456789",
  GP_SESSION_SECRET: "session-test-secret-0123456789",
});

const fake = await import("./harness/fake.mjs");
const { welt, legeAn, zeile, zuruecksetzen, agentOk, TEXTE, STANDARD_OBJEKT } = fake;
fake.installiere();

const route = (name, rel) => import(pathToFileURL(process.env[`Z_ROUTE_${name}`] ?? path.join(SITE, "src/app/api", rel)).href);
const [pipeline, activate, delegate, fleet, briefing, statusRoute, messages, attribution, { NextRequest }, auftrag] = await Promise.all([
  route("PIPELINE", "content/pipeline/route.ts"),
  route("ACTIVATE", "agents/activate/route.ts"),
  route("DELEGATE", "donna/delegate/route.ts"),
  route("FLEET", "fleet/activate/route.ts"),
  route("BRIEFING", "cron/briefing/route.ts"),
  route("STATUS", "content/status/route.ts"),
  route("MESSAGES", "messages/route.ts"),
  route("ATTRIBUTION", "attribution/route.ts"),
  import("next/server"),
  import("../src/lib/auftrag.ts"),
]);

const NAME = ["Immo", "Nexus"].join("");
const NAME_RE = /imm[ou][\s._-]*nexus/i;
const TOPIC_LAUF = { topic: "KI-Agenten erklärt", platform: "twitter", format: "thread", category: "ki_automation" };

beforeEach(() => {
  zuruecksetzen();
  welt.pipelineModul = pipeline;
});

async function post(modul, pfad, body, kopf = {}) {
  const req = new NextRequest(`http://harness.local${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "gp-auth=test", ...kopf },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await modul.POST(req);
  return { status: res.status, body: await res.json() };
}
const pipePost = (body, kopf) => post(pipeline, "/api/content/pipeline", body, kopf);

// ── Claude- und Supabase-Seite der echten activate-Route ──

function claudeText(text, stop = "end_turn") {
  return {
    status: 200,
    body: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: text === null ? [] : [{ type: "text", text }],
      stop_reason: stop,
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
}
function stufeAus(anfrage) {
  const t = String(anfrage.messages?.[0]?.content ?? "");
  if (t.startsWith("RESEARCH-AUFTRAG")) return "researcher";
  if (t.startsWith("CONTENT-PRODUKTION")) return "scribe";
  if (t.startsWith("Pruefe den folgenden Content")) return "counsel";
  // Paket B (R2): COUNSEL-Endprüfung der PUBLISHER-Fassung — Antwort wie COUNSEL.
  if (t.startsWith("ENDPRUEFUNG (R2)")) return "counsel";
  if (t.startsWith("PUBLISHING-AUFTRAG")) return "publisher";
  if (t.startsWith("AMPLIFICATION-AUFTRAG")) return "amplifier";
  return "andere";
}
const RLS = (t) => ({ status: 403, body: { code: "42501", details: null, hint: null, message: `new row violates row-level security policy for table "${t}"` } });

/** Echte activate-Route: agents lesbar, Kontext leer; jede Protokoll-Schreibung von activate scheitert (RLS). */
function activateWelt() {
  welt.activateModul = activate;
  welt.stoerung = (a) => {
    if (a.art !== "supabase") return null;
    if (a.tabelle === "agents" && a.methode === "GET") {
      const id = String(a.params.get("id") ?? "").replace(/^eq\./, "");
      return { status: 200, body: [{ id, role: "Test", total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 }] };
    }
    if (a.tabelle === "messages" && a.methode === "GET" && a.params.has("or")) return { status: 200, body: [] };
    if (a.tabelle === "agents" && a.methode === "PATCH") return RLS("agents");
    const quelle = a.body?.metadata?.source;
    if (a.tabelle === "messages" && a.methode === "POST" && (quelle === "activation-api" || quelle === "fehllauf")) return RLS("messages");
    if (a.tabelle === "metrics" && a.methode === "POST") return RLS("metrics");
    return null;
  };
  welt.claude = (anfrage) => {
    const s = stufeAus(anfrage);
    if (s === "counsel") return claudeText("Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG");
    if (s === "publisher") return claudeText("Finaler Content: KI-Agenten erklärt, mit Quellen und Beispielen.");
    return claudeText(`${s}: Ergebnis`);
  };
}

// ═══ Protokollfehler: jeder Eintrag einzeln (vorher als EIN Eintrag auf 160 Zeichen gekürzt) ═══

test("Z-P1 Pipeline Ende-zu-Ende: jeder Protokollfehler von activate einzeln in steps[n] und als eigene Warnung (auch metrics-Insert)", async () => {
  activateWelt();
  const r = await pipePost(TOPIC_LAUF);
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
  assert.equal(r.body.status, "complete");
  // Paket B: sechs bezahlte Aufrufe (mit der COUNSEL-Endprüfung).
  assert.equal(welt.claudeAufrufe, 6);
  for (const a of welt.activateAntworten) {
    assert.ok(Array.isArray(a.body.protokoll_fehler_liste));
    assert.equal(a.body.protokoll_fehler, a.body.protokoll_fehler_liste.join("; "));
    assert.ok(a.body.protokoll_fehler.length > 160, "Ausgangslage: Text länger als die Kürzung");
  }
  for (const [i, s] of r.body.steps.entries()) {
    const praefixe = s.protokoll_fehler.map((e) => e.split(":")[0]);
    for (const p of ["agents-Update", "messages-Insert", "metrics-Insert"]) assert.ok(praefixe.includes(p), `${s.agent}: ${p} fehlt`);
    for (const e of s.protokoll_fehler) assert.ok(Array.from(e).length <= 160);
    const w = r.body.warnungen.filter((x) => x.stufe === s.agent && x.grund.startsWith("Protokoll der Aktivierung unvollständig"));
    assert.equal(w.length, s.protokoll_fehler.length, `Stufe ${i}: eine Warnung je Eintrag`);
    assert.ok(w.some((x) => x.detail.startsWith("metrics-Insert")));
  }
  // gespeichert wie geantwortet
  assert.ok(zeile(r.body.contentId).metadata.steps[0].protokoll_fehler.some((e) => e.startsWith("metrics-Insert")));
});

test("Z-D1 delegate Ende-zu-Ende: protokoll_fehler je Eintrag mit Agentenpräfix (auch metrics-Insert)", async () => {
  activateWelt();
  const auftragId = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
  const plan = { agents: [{ id: "oracle", task: "Lage prüfen", priority: 1 }], reasoning: "Test" };
  const signatur = await auftrag.signierePlan(auftragId, "Testauftrag", plan);
  welt.tabellen.messages = [
    {
      id: "msg-plan-1",
      from_agent: "donna",
      from_role: "COO",
      content: { text: "Test", plan, original_task: "Testauftrag" },
      metadata: { source: "delegate-plan", auftrag_id: auftragId, plan_signatur: signatur },
    },
  ];
  const r = await post(delegate, "/api/donna/delegate", { auftrag_id: auftragId, ausfuehren: true });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
  assert.equal(r.body.mode, "ausgefuehrt");
  const praefixe = r.body.protokoll_fehler.map((e) => e.split(":").slice(0, 2).join(":"));
  for (const p of ["ORACLE: agents-Update", "ORACLE: messages-Insert", "ORACLE: metrics-Insert"]) assert.ok(praefixe.includes(p), `${p} fehlt: ${praefixe}`);
});

// ═══ Fehllauf-Kosten (502 mit usage.cost_usd) ═══

const FEHLLAUF_502 = (agent) => ({
  status: 502,
  body: {
    fehler: "leere Antwort",
    error: "leere Antwort",
    agent_id: agent,
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    abgeschnitten: false,
    usage: { input_tokens: 900, output_tokens: 120, cost_usd: 0.003, latency_ms: 5 },
    protokoll_fehler: "messages-Insert (Fehllauf): permission denied for table messages",
    protokoll_fehler_liste: ["messages-Insert (Fehllauf): permission denied for table messages"],
  },
});

test("Z-P2 Pipeline: Fehllauf (502) übernimmt die gemeldeten Kosten und das Protokoll der Fehlerantwort", async () => {
  welt.agentAntworten.researcher = [FEHLLAUF_502("researcher")];
  const r = await pipePost(TOPIC_LAUF);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "fehler");
  const s = r.body.steps[0];
  assert.equal(s.status, "error");
  assert.equal(s.cost, 0.003);
  assert.equal(s.model, "claude-sonnet-5");
  assert.deepEqual(s.protokoll_fehler, ["messages-Insert (Fehllauf): permission denied for table messages"]);
  assert.equal(r.body.summary.total_cost_usd, 0.003);
  assert.equal(r.body.summary.kosten_unvollstaendig, false);
  assert.ok(r.body.warnungen.some((w) => w.stufe === "researcher" && w.detail.startsWith("messages-Insert (Fehllauf)")));
  assert.equal(welt.aktivierungen.length, 1);
});

test("Z-P3 Pipeline: Fehlerantwort ohne Kostenangabe bleibt 'unvollständig' (nie 0 als Ersatz)", async () => {
  welt.agentAntworten.researcher = [{ status: 502, body: { fehler: "Claude-API-Fehler: HTTP 529" } }];
  const r = await pipePost(TOPIC_LAUF);
  assert.equal(r.body.steps[0].cost, null);
  assert.equal(r.body.summary.kosten_unvollstaendig, true);
});

// ═══ Plattform und Format nur aus der festen Liste ═══
// Paket B (10.11.2026, R39/E11): LinkedIn ist Plattform mit dem Format linkedin_post; abgewiesen wird
// nur ein falsches Format (vorher die ganze Plattform).

for (const [name, body, muster] of [
  ["linkedin mit falschem Format", { ...TOPIC_LAUF, platform: "linkedin", format: "thread" }, /Format "thread" für linkedin nicht unterstützt — erlaubt: linkedin_post/],
  ["unbekannte Plattform", { ...TOPIC_LAUF, platform: "facebook", format: "thread" }, /Plattform "facebook" nicht unterstützt/],
  ["Format passt nicht", { ...TOPIC_LAUF, platform: "youtube", format: "thread" }, /Format "thread" für youtube nicht unterstützt/],
  ["Plattform mit geschütztem Namen", { ...TOPIC_LAUF, platform: `${NAME}-kanal` }, /\[geschützter Name\]/],
]) {
  test(`Z-P4 Pipeline: ${name} → 400 vor jedem Abruf`, async () => {
    const r = await pipePost(body);
    assert.equal(r.status, 400);
    assert.match(r.body.fehler, muster);
    assert.doesNotMatch(r.body.fehler, NAME_RE);
    assert.equal(welt.aktivierungen.length, 0);
    assert.equal(welt.log.length, 0, "kein Supabase-Zugriff");
  });
}

test("Z-P5 Pipeline GET: Plattformliste aus derselben Quelle, mit linkedin (Paket B, R39)", async () => {
  const res = await pipeline.GET();
  const d = await res.json();
  assert.deepEqual(d.platforms, ["youtube", "twitter", "x", "linkedin", "newsletter", "tiktok", "instagram"]);
  assert.deepEqual(d.formats.linkedin, ["linkedin_post"]);
  for (const p of d.platforms) assert.ok(d.formats[p].length > 0);
});

// ═══ CTA-Link mit geschütztem Namen: nicht im SCRIBE-Auftrag, nicht gespeichert ═══

// Paket B (10.11.2026, E12): Der CTA ist ein Kurzlink aus Kampagne, Slug und Nummer; der geschützte
// Name kann nur über Kampagne oder Slug hineinkommen. Die Kampagne folgt hier der Form des
// Steinadel-Exports (lpUrl = https://steinadel.de/l/<kampagne>), sonst gäbe es gar keinen Kurzlink.
test("Z-P6 Pipeline: CTA-Link mit geschütztem Namen wird nicht verwendet und nicht gespeichert", async () => {
  const objekt = structuredClone(STANDARD_OBJEKT);
  const kampagne = `${NAME.toLowerCase()}-herbst`;
  objekt.kampagnen[0] = { kampagne, lpUrl: `https://steinadel.de/l/${kampagne}`, lpVariant: `${kampagne}-a` };
  welt.objekteAntwort = { status: 200, body: { version: "1", quelle: "export", generiert_am: "2026-11-06T09:00:00Z", objekte: [objekt] } };
  const r = await pipePost({ objekt_slug: "villa-x", platform: "x", format: "thread", category: "ki_automation" });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const z = zeile(r.body.contentId);
  assert.equal(z.metadata.cta_link, null);
  assert.equal(z.metadata.utm_content, null);
  assert.equal(z.metadata.kurzlink, undefined, "kein Kurzlink-Beleg mit Namen");
  assert.ok(r.body.warnungen.some((w) => w.stufe === "objekt" && /CTA-Link enthält einen geschützten Namen/.test(w.grund)));
  const scribe = welt.aktivierungen.find((a) => a.agent === "scribe");
  assert.ok(scribe.task.includes("kein Kampagnen-Link hinterlegt"), "allgemeiner CTA statt Link");
  assert.ok(!/EXAKT diesem Link: https?:/.test(scribe.task));
  assert.ok(!scribe.task.includes("CTA-LINK"), "kein Kurzlink-Block");
  assert.doesNotMatch(JSON.stringify(z.metadata.warnungen), NAME_RE);
  // Gegenprobe: ohne Namen steht der Kurzlink im Auftrag und in metadata
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  const sauber = structuredClone(STANDARD_OBJEKT);
  sauber.kampagnen[0] = { kampagne: "herbst", lpUrl: "https://steinadel.de/l/herbst", lpVariant: "herbst-a" };
  welt.objekteAntwort = { status: 200, body: { version: "1", quelle: "export", generiert_am: "2026-11-06T09:00:00Z", objekte: [sauber] } };
  const ok = await pipePost({ objekt_slug: "villa-x", platform: "x", format: "thread", category: "ki_automation" });
  assert.match(zeile(ok.body.contentId).metadata.cta_link, /^https:\/\/steinadel\.de\/k\/herbst\/x-villa-x-\d+$/);
  assert.ok(welt.aktivierungen.find((a) => a.agent === "scribe").task.includes(`EXAKT diesem Link: ${zeile(ok.body.contentId).metadata.cta_link}`));
});

// ═══ Herkunft: Cross-Site-POST und Content-Type (vor jedem Abruf) ═══

const POST_ROUTEN = [
  ["pipeline", pipeline, "/api/content/pipeline", TOPIC_LAUF],
  ["activate", activate, "/api/agents/activate", { agent_id: "oracle" }],
  ["delegate", delegate, "/api/donna/delegate", { task: "Plane etwas" }],
  ["fleet", fleet, "/api/fleet/activate", { agents: ["oracle"] }],
  ["content/status", statusRoute, "/api/content/status", { id: 1, aktion: "freigeben" }],
  ["messages", messages, "/api/messages", { from_agent: "donna", content: "x" }],
];

for (const [name, modul, pfad, body] of POST_ROUTEN) {
  test(`Z-H1 ${name}: Cross-Site-POST → 403, ohne JSON-Content-Type → 415, ohne jeden Abruf`, async () => {
    welt.claude = () => {
      throw new Error("bezahlter Aufruf trotz Sperre");
    };
    const fremd = await post(modul, pfad, body, { "sec-fetch-site": "cross-site" });
    assert.equal(fremd.status, 403);
    assert.match(fremd.body.fehler, /nicht von dieser Seite/);
    const text = await post(modul, pfad, JSON.stringify(body), { "content-type": "text/plain;charset=UTF-8", "sec-fetch-site": "same-origin" });
    assert.equal(text.status, 415);
    assert.equal(welt.log.length, 0, "kein Supabase-Zugriff");
    assert.equal(welt.aktivierungen.length, 0);
    assert.equal(welt.claudeAufrufe, 0);
  });
}

test("Z-H2 Server-zu-Server (ohne Sec-Fetch-Site) und same-origin bleiben zulässig", async () => {
  const r = await pipePost(TOPIC_LAUF, { "sec-fetch-site": "same-origin" });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "complete");
});

// Gegencheck 06.11.2026 (B17): "nicht erreichbar" nur, wenn keine Antwort kam.
test("Z-D9 delegate-Planung: Ursache je Fehler — Konfiguration 500, HTTP-Fehler 'gescheitert', ohne Antwort 'nicht erreichbar'", async () => {
  welt.claude = () => ({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } });
  const http = await post(delegate, "/api/donna/delegate", { task: "Plane etwas" });
  assert.equal(http.status, 502);
  assert.equal(http.body.fehler, "L.I.S.A.-Planung gescheitert: Claude-API-Fehler: HTTP 401");

  welt.claude = () => {
    throw new TypeError("fetch failed");
  };
  const netz = await post(delegate, "/api/donna/delegate", { task: "Plane etwas" });
  assert.equal(netz.status, 502);
  assert.match(netz.body.fehler, /^L\.I\.S\.A\. nicht erreichbar: /);

  const schluessel = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const fehler = console.error;
  console.error = () => {};
  const aufrufeVorher = welt.claudeAufrufe;
  try {
    const konfig = await post(delegate, "/api/donna/delegate", { task: "Plane etwas" });
    assert.equal(konfig.status, 500);
    assert.equal(konfig.body.fehler, "L.I.S.A. nicht konfiguriert: Anthropic-Schlüssel (Server-Umgebung) nicht gesetzt");
    assert.equal(welt.claudeAufrufe, aufrufeVorher, "ohne Schlüssel kein Aufruf");
  } finally {
    process.env.ANTHROPIC_API_KEY = schluessel;
    console.error = fehler;
  }
});

// Gegencheck 06.11.2026 (B16): Meldet keine gelaufene Stufe Kosten, ist die Summe null, nicht 0.
test("Z-K1 Pipeline: ohne jede Kostenangabe ist summary.total_cost_usd null (nicht 0); mit Angaben die Summe", async () => {
  welt.agentAntworten.researcher = [{ status: 500, body: { fehler: "Anthropic-Schlüssel (Server-Umgebung) nicht gesetzt" } }];
  const ohne = await pipePost(TOPIC_LAUF);
  assert.equal(ohne.body.status, "fehler");
  assert.equal(ohne.body.steps[0].cost, null);
  assert.equal(ohne.body.summary.total_cost_usd, null);
  assert.equal(ohne.body.summary.kosten_unvollstaendig, true);
  zuruecksetzen();
  welt.pipelineModul = pipeline;
  const mit = await pipePost(TOPIC_LAUF);
  assert.equal(mit.body.status, "complete");
  assert.equal(typeof mit.body.summary.total_cost_usd, "number");
  assert.ok(mit.body.summary.total_cost_usd > 0);
});

// Prüflauf 06.11.2026 (K6c): auto-produce gibt fehlende Kosten als null weiter — geprüft an der
// Route selbst, nicht nur an der Pipeline. Datum fest auf einen Freitag (an Wochenenden überspringt
// die Route den Tag), Kalender und Pipeline-Antwort als Attrappe.
test("Z-K2 auto-produce: ohne Kostenangabe kosten_usd_geschaetzt null, nie 0", async () => {
  const auto = await route("AUTO", "content/auto-produce/route.ts");
  const eintrag = { platform: "x", format: "thread", topic: "KI-Agenten erklärt" };
  const tage = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map((t) => [t, eintrag]));
  const launch_calendar = Object.fromEntries([1, 2, 3, 4].map((w) => [`week${w}`, { theme: "Test", ...tage }]));
  const pending = ["scribe", "counsel", "publisher", "amplifier"].map((agent) => ({ agent, status: "pending" }));
  welt.pipelineAntwort = {
    GET: { status: 200, body: { launch_calendar } },
    POST: {
      status: 200,
      body: {
        pipeline: "content-first",
        contentId: 5,
        status: "fehler",
        fehler: { stufe: "researcher", grund: "Anthropic-Schlüssel (Server-Umgebung) nicht gesetzt" },
        steps: [{ agent: "researcher", status: "error", cost: null }, ...pending],
        summary: { total_cost_usd: null, kosten_unvollstaendig: true, total_duration_ms: 1, completed: "0/5" },
        speicherfehler: [],
      },
    },
  };
  const EchtesDatum = Date;
  const FREITAG = EchtesDatum.parse("2026-11-06T10:00:00Z");
  globalThis.Date = class extends EchtesDatum {
    constructor(...a) {
      if (a.length === 0) super(FREITAG);
      else super(...a);
    }
    static now() {
      return FREITAG;
    }
  };
  try {
    const res = await auto.GET(new NextRequest("http://harness.local/api/content/auto-produce", { headers: { "x-cron-secret": process.env.CRON_SECRET } }));
    const d = await res.json();
    assert.equal(res.status, 200, JSON.stringify(d).slice(0, 300));
    assert.equal(d.status, "fehler");
    assert.ok("kosten_usd_geschaetzt" in d.pipeline, "Feld vorhanden");
    assert.equal(d.pipeline.kosten_usd_geschaetzt, null);
    assert.equal(d.pipeline.kosten_unvollstaendig, true);
  } finally {
    globalThis.Date = EchtesDatum;
    welt.pipelineAntwort = null;
  }
});

// ═══ fleet/activate und cron/briefing werten den activate-Vertrag aus ═══

test("Z-F1 fleet: abgeschnitten ist kein Erfolg, Fehllauf-Kosten zählen, Summe nur aus gemeldeten Kosten", async () => {
  welt.agentAntworten.oracle = [agentOk("oracle", "teil", { stop_reason: "max_tokens", abgeschnitten: true, usage: { cost_usd: 0.01 } })];
  welt.agentAntworten.researcher = [FEHLLAUF_502("researcher")];
  welt.agentAntworten.scribe = [agentOk("scribe", "fertig", { usage: { input_tokens: 1, output_tokens: 1, cost_usd: null } })];
  welt.agentAntworten.counsel = [agentOk("counsel", "fertig", { abgeschnitten: null, stop_reason: null })];
  const r = await post(fleet, "/api/fleet/activate", { agents: ["oracle", "researcher", "scribe", "counsel"] });
  assert.equal(r.status, 200);
  const nach = Object.fromEntries(r.body.results.map((x) => [x.agent_id, x]));
  assert.equal(nach.oracle.success, false);
  assert.equal(nach.oracle.abgeschnitten, true);
  assert.equal(nach.oracle.stop_reason, "max_tokens");
  assert.equal(nach.researcher.success, false);
  assert.equal(nach.researcher.cost_usd, 0.003);
  assert.deepEqual(nach.researcher.protokoll_fehler, ["messages-Insert (Fehllauf): permission denied for table messages"]);
  assert.equal(nach.scribe.success, true);
  assert.equal(nach.scribe.abgeschnitten, false);
  assert.equal(nach.counsel.success, false, "Vollständigkeit nicht gemeldet");
  assert.equal(nach.counsel.abgeschnitten, null);
  assert.equal(r.body.activated, 1);
  assert.equal(r.body.total_cost_usd_geschaetzt, 0.0137);
  assert.equal(r.body.kosten_unbekannt, 1);
});

test("Z-F2 fleet: ohne jede Kostenangabe ist die Summe null, nicht 0", async () => {
  welt.agentAntworten.oracle = [agentOk("oracle", "fertig", { usage: { cost_usd: null } })];
  const r = await post(fleet, "/api/fleet/activate", { agents: ["oracle"] });
  assert.equal(r.body.total_cost_usd_geschaetzt, null);
  assert.equal(r.body.kosten_unbekannt, 1);
  assert.equal(r.body.activated, 1);
});

test("Z-B1 briefing: abgeschnittenes Briefing heißt so (abgeschnitten, stop_reason, Kosten je Lauf)", async () => {
  welt.agentAntworten.oracle = [agentOk("oracle", "halbes Briefing", { stop_reason: "max_tokens", abgeschnitten: true })];
  welt.agentAntworten.donna = [agentOk("donna", "Tagesplan")];
  const req = new NextRequest("http://harness.local/api/cron/briefing?type=morning", {
    headers: { "x-cron-secret": process.env.CRON_SECRET },
  });
  const res = await briefing.GET(req);
  const d = await res.json();
  assert.equal(res.status, 200);
  assert.equal(d.results.oracle.abgeschnitten, true);
  assert.equal(d.results.oracle.stop_reason, "max_tokens");
  assert.equal(d.results.oracle.text, "halbes Briefing");
  assert.equal(d.results.donna.abgeschnitten, false);
  assert.equal(d.results.donna.kosten_usd_geschaetzt, 0.0007);
  assert.equal(d.vollstaendig, 1);
});

// ═══ /api/attribution: neutrale Meldung ohne Env-Namen ═══

test("Z-A1 attribution: ohne Token 500 mit neutraler Meldung, kein Env-Name, kein Abruf", async () => {
  const token = process.env.IMMONEXUS_EXPORT_TOKEN;
  delete process.env.IMMONEXUS_EXPORT_TOKEN;
  try {
    const res = await attribution.GET();
    const d = await res.json();
    assert.equal(res.status, 500);
    assert.equal(d.fehler, "Export-Token (Server-Umgebung) nicht gesetzt");
    assert.deepEqual(d.kampagnen, []);
    assert.doesNotMatch(JSON.stringify(d), /EXPORT_TOKEN|imm[ou][\s._-]*nexus/i);
    assert.equal(res.headers.get("cache-control"), "no-store");
  } finally {
    process.env.IMMONEXUS_EXPORT_TOKEN = token;
  }
});

// Gegencheck 06.11.2026 (B02/B15/B26): Fehlerantwort und unlesbares JSON des Rückkanals sind
// "quelle_fehler", nur Netzfehler, Zeitlimit und Abbruch beim Lesen "nicht_erreichbar".
test("Z-A2 attribution: Ursache je Fehler (fehler_art), Zeitlimit gesetzt, Token nie in der Antwort", async () => {
  const token = process.env.IMMONEXUS_EXPORT_TOKEN;
  process.env.IMMONEXUS_EXPORT_TOKEN = "attribution-test-token-0123456789";
  const harnessFetch = globalThis.fetch;
  const abrufe = [];
  const mit = async (antwort) => {
    globalThis.fetch = async (url, init = {}) => {
      abrufe.push({ url: String(url), init });
      return antwort();
    };
    const res = await attribution.GET();
    const body = await res.json();
    // Prüflauf 06.11.2026: Das Token (oder ein Stück davon) steht in keinem Körper und keinem Kopf.
    const alles = `${JSON.stringify(body)} ${JSON.stringify([...res.headers])}`;
    assert.ok(!alles.includes("attribution-test-token"), `Token in der Antwort: ${alles.slice(0, 200)}`);
    assert.ok(!alles.includes("0123456789"), "kein Teil des Tokens in der Antwort");
    return { status: res.status, body };
  };
  try {
    for (const status of [401, 403, 404, 500]) {
      const r = await mit(() => new Response("{}", { status }));
      assert.equal(r.status, 502);
      assert.equal(r.body.fehler, `rueckkanal_http_${status}`);
      assert.equal(r.body.fehler_art, "quelle_fehler");
      assert.deepEqual(r.body.kampagnen, []);
    }
    const html = await mit(() => new Response("<html>kein JSON</html>", { status: 200 }));
    assert.equal(html.body.fehler, "rueckkanal_antwort_unlesbar");
    assert.equal(html.body.fehler_art, "quelle_fehler");
    const netz = await mit(() => {
      throw new TypeError("fetch failed");
    });
    assert.equal(netz.body.fehler, "rueckkanal_nicht_erreichbar");
    assert.equal(netz.body.fehler_art, "nicht_erreichbar");
    const abriss = await mit(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new TypeError("terminated");
      },
    }));
    assert.equal(abriss.body.fehler_art, "nicht_erreichbar");
    const ok = await mit(() => new Response(JSON.stringify({ kampagnen: [{ kampagne: "k" }] }), { status: 200 }));
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { kampagnen: [{ kampagne: "k" }] });
    for (const a of abrufe) {
      assert.equal(a.url, "https://steinadel.de/api/kampagnen/attribution");
      assert.ok(a.init.signal instanceof AbortSignal, "Abruf mit Zeitlimit");
    }
    const ohne = await (async () => {
      delete process.env.IMMONEXUS_EXPORT_TOKEN;
      return mit(() => {
        throw new Error("darf nicht abrufen");
      });
    })();
    assert.equal(ohne.status, 500);
    assert.equal(ohne.body.fehler_art, "konfiguration");
  } finally {
    globalThis.fetch = harnessFetch;
    if (token === undefined) delete process.env.IMMONEXUS_EXPORT_TOKEN;
    else process.env.IMMONEXUS_EXPORT_TOKEN = token;
  }
});

// ═══ Wachen der tragenden Pipeline-Zeilen (gegen MX1, MX2, MX5, MX7 der Nachprüfung A) ═══

const laufLesung = (a) => a.art === "supabase" && a.methode === "GET" && a.tabelle === "content" && a.params.has("metadata->>lauf_id");

test("Z-W1 (MX1) eigene Zeile nach dem Insert nicht sichtbar → 500, kein bezahlter Aufruf, Zeile 'fehler'", async () => {
  welt.stoerung = (a) => (laufLesung(a) ? { status: 200, body: [] } : null);
  const r = await pipePost({ ...TOPIC_LAUF, lauf_id: "lauf-w1-00000001" });
  assert.equal(r.status, 500);
  assert.match(r.body.fehler, /Doppellauf-Prüfung fehlgeschlagen: eigene Zeile nicht gefunden/);
  assert.equal(welt.aktivierungen.length, 0);
  assert.equal(zeile(r.body.contentId).status, "fehler");
  // Prüflauf 06.11.2026: Fehlerantwort nach dem Insert trägt Schritte und Zusammenfassung, damit
  // /content die Stufen als "nicht ausgeführt" zeigt statt wie ohne Lauf.
  assert.equal(r.body.status, "fehler");
  assert.deepEqual(r.body.steps.map((x) => [x.agent, x.status]), [
    ["researcher", "pending"],
    ["scribe", "pending"],
    ["counsel", "pending"],
    ["publisher", "pending"],
    ["counsel_endfassung", "pending"],
    ["amplifier", "pending"],
  ]);
  assert.equal(r.body.summary.total_cost_usd, null);
  // Paket B: sechs Stufen
  assert.equal(r.body.summary.completed, "0/6");
});

test("Z-W2 (MX2) Lauf-ID mehrfach vergeben → 409 nennt die älteste Zeile", async () => {
  legeAn({ id: 9, status: "fehler", metadata: { lauf_id: "lauf-w2-00000001" } });
  legeAn({ id: 5, status: "zur_freigabe", metadata: { lauf_id: "lauf-w2-00000001" } });
  const r = await pipePost({ ...TOPIC_LAUF, lauf_id: "lauf-w2-00000001" });
  assert.equal(r.status, 409);
  assert.equal(r.body.content_id, 5);
  assert.equal(r.body.status, "zur_freigabe");
  assert.equal(welt.aktivierungen.length, 0);
});

test("Z-W3 (MX7) Doppellauf nach dem Insert erkannt → 409, eigene Zeile 'fehler' statt 'entwurf'", async () => {
  let ersteLesung = true;
  welt.stoerung = (a) => {
    if (!laufLesung(a) || !ersteLesung) return null;
    ersteLesung = false; // Vorab-Prüfung sieht die fremde Zeile noch nicht
    return { status: 200, body: [] };
  };
  legeAn({ id: 7, status: "entwurf", metadata: { lauf_id: "lauf-w3-00000001" } });
  const r = await pipePost({ ...TOPIC_LAUF, lauf_id: "lauf-w3-00000001" });
  assert.equal(r.status, 409);
  assert.equal(r.body.content_id, 7);
  assert.equal(zeile(r.body.verworfen_content_id).status, "fehler");
  assert.equal(welt.aktivierungen.length, 0);
});

test("Z-W4 (MX5) ABLEHNUNG, erstes Speichern scheitert → Abbruch speichert Review und Urteil mit", async () => {
  welt.agentAntworten.counsel = [agentOk("counsel", "Verstoß gegen Regel 3.\nURTEIL: ABLEHNUNG")];
  welt.stoerung = (a) =>
    a.art === "supabase" && a.methode === "PATCH" && a.tabelle === "content" && a.body?.status === "abgelehnt" ? { status: 200, body: [] } : null;
  const r = await pipePost(TOPIC_LAUF);
  assert.equal(r.body.status, "fehler");
  assert.equal(r.body.counsel.urteil, "ABLEHNUNG");
  const z = zeile(r.body.contentId);
  assert.equal(z.status, "fehler");
  assert.equal(z.review_notes, "Verstoß gegen Regel 3.\nURTEIL: ABLEHNUNG");
  assert.equal(z.reviewed_by, "counsel");
  assert.equal(welt.aktivierungen.length, 3, "kein PUBLISHER");
});

test("Z-W5 (MX3/MX4/MX8) Protokollfehler der Erfolgsantwort: am Schritt UND als Warnung", async () => {
  welt.agentAntworten.counsel = [
    agentOk("counsel", TEXTE.counsel, { protokoll_fehler: "metrics-Insert: x", protokoll_fehler_liste: ["metrics-Insert: x"] }),
  ];
  const r = await pipePost(TOPIC_LAUF);
  assert.equal(r.body.status, "complete");
  assert.deepEqual(r.body.steps[2].protokoll_fehler, ["metrics-Insert: x"]);
  assert.ok(r.body.warnungen.some((w) => w.stufe === "counsel" && w.detail === "metrics-Insert: x"));
  assert.equal(zeile(r.body.contentId).status, "zur_freigabe");
});

// ═══ Nachprüfung im Browser 06.11.2026: Export-Fehler mit Ursache ═══
// /api/objekte unterscheidet seither Fehlerantwort ("quelle_http_<Status>") und unlesbares JSON
// von "nicht erreichbar"; die Pipeline (exportMeldung) übersetzt die Codes, statt sie roh zu zeigen.

const OBJEKT_LAUF = { objekt_slug: "villa-x", platform: "x", format: "thread", category: "ki_automation" };

// Gegencheck 06.11.2026 (B07): Die Route /api/objekte muss vor der Pipeline aufgeben, sonst bekommt
// die Pipeline nur ihr eigenes Zeitlimit statt der Ursache. Gemessen wird die Frist, die jede Seite
// AbortSignal.timeout übergibt — ohne die Konstanten aus den Routen zu lesen.
test("Z-N2 Zeitlimit von /api/objekte liegt unter dem der Pipeline für denselben Abruf", async () => {
  const objekte = await route("OBJEKTE", "objekte/route.ts");
  const original = AbortSignal.timeout;
  const msJeSignal = new WeakMap();
  AbortSignal.timeout = (ms) => {
    const s = original.call(AbortSignal, ms);
    msJeSignal.set(s, ms);
    return s;
  };
  const harnessFetch = globalThis.fetch;
  let pipelineFrist = null;
  let exportFrist = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.endsWith("/api/objekte")) pipelineFrist = msJeSignal.get(init.signal) ?? null;
    if (url === "https://steinadel.de/api/objekte/export") {
      exportFrist = msJeSignal.get(init.signal) ?? null;
      return new Response(JSON.stringify({ objekte: [] }), { status: 200 });
    }
    return harnessFetch(input, init);
  };
  process.env.IMMONEXUS_EXPORT_TOKEN = "export-test-token-0123456789";
  try {
    zuruecksetzen();
    welt.objekteAntwort = { status: 502, body: { fehler: "quelle_nicht_erreichbar", fehler_art: "nicht_erreichbar", objekte: [] } };
    await pipePost(OBJEKT_LAUF);
    await objekte.GET();
  } finally {
    globalThis.fetch = harnessFetch;
    AbortSignal.timeout = original;
    delete process.env.IMMONEXUS_EXPORT_TOKEN;
  }
  assert.equal(typeof pipelineFrist, "number", "Pipeline ruft /api/objekte mit Zeitlimit ab");
  assert.equal(typeof exportFrist, "number", "/api/objekte ruft den Export mit Zeitlimit ab");
  assert.ok(exportFrist < pipelineFrist, `${exportFrist} ms < ${pipelineFrist} ms`);
});

test("Z-N1 Pipeline: Export-Fehler nennen die Ursache, vor jedem Insert und Aufruf", async () => {
  const faelle = [
    [502, { fehler: "quelle_http_401", fehler_art: "quelle_fehler", objekte: [] }, "Steinadel-Export nicht lesbar: Quelle antwortete mit HTTP 401 (HTTP 502)"],
    [502, { fehler: "quelle_antwort_unlesbar", fehler_art: "quelle_fehler", objekte: [] }, "Steinadel-Export nicht lesbar: Antwort der Quelle nicht lesbar (HTTP 502)"],
    [502, { fehler: "quelle_nicht_erreichbar", fehler_art: "nicht_erreichbar", objekte: [] }, "Steinadel-Export nicht lesbar: Quelle nicht erreichbar (HTTP 502)"],
    [
      500,
      { fehler: "Export-Token (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration", objekte: [] },
      "Steinadel-Export nicht lesbar: Export-Token (Server-Umgebung) nicht gesetzt (HTTP 500)",
    ],
  ];
  for (const [status, body, erwartet] of faelle) {
    zuruecksetzen();
    welt.pipelineModul = pipeline;
    welt.objekteAntwort = { status, body };
    const r = await pipePost(OBJEKT_LAUF);
    assert.equal(r.status, 502, erwartet);
    assert.equal(r.body.fehler, erwartet);
    assert.doesNotMatch(r.body.fehler, /quelle_http_|quelle_antwort_unlesbar|EXPORT_TOKEN/);
    assert.equal(welt.aktivierungen.length, 0, "kein Agent-Aufruf");
    assert.equal(welt.content.length, 0, "keine Zeile angelegt");
  }
});
