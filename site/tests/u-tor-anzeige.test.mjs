// Tests der Tor-Prüfung vom 07.11.2026 (Anzeige ehrlich: keine unmarkierten Fakten-Literale,
// gemessene Werte nicht irreführend). Lauf: npm test. Je Befund ein Test, im Namen genannt:
// - TOR-T1 /academy: Einwohnerzahlen ohne Quelle gestrichen, Kopf zählt Agenten mit Modul.
// - TOR-T2 Systemzustand, Zeile „Crons": "laut Plan" und Umfang VPS-Crontab sichtbar, GitHub-
//   Zeitpläne im title als nicht gemessen; Lage und Farbe unverändert.
// - TOR-F1 Message Bus im Command Center: Datum, wenn nicht vom Tag der Messung (Europe/Berlin).
// - TOR-F2 Modell je Agent aus der Dashboard-Konfiguration (lib/agent-modelle.ts), Register-
//   Abweichung sichtbar; SENTINEL "kein Dashboard-Prompt"; /metrics zählt danach.
// - TOR-F3/F4 /agents/[id]: Kosten aus Tokens × aktueller Tabelle, nicht aus total_cost_usd.
// - TOR-F5/F6 /messages: Zähler summieren sich zur Liste; cost_usd einheitlich, Preistabelle sichtbar.
// - TOR-F7 /agents/[id]: "Modell letzter Lauf" zählt Planungen (delegate-plan) mit.
// F8 (Kachel "Freigegeben") steht in tests/e-content-komponenten.test.mjs (Hook-Laufzeit der Seite).
// Die ECHTEN .tsx-Dateien werden übersetzt und mit Attrappen geladen (tests/harness/tsx.mjs).
// Testdaten mit "gemessen" stammen aus SELECTs auf agents und messages vom 07.11.2026.
// Kein Netz: Es gibt keinen Abruf; fetch wird nicht gebraucht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { React, baumLaufzeit, finde, jsxRuntime, ladeTsx, renderToStaticMarkup, text } from "./harness/tsx.mjs";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const types = await import("../src/lib/types.ts");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const kosten = await import("../src/lib/kosten.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const statusServer = await import("../src/lib/status-server.ts");
const totmann = await import("../src/lib/totmann.ts");
const auftragTypes = await import("../src/lib/auftrag-types.ts");
// Fehlt das Modul (Rückprobe gegen den Stand vor der Tor-Prüfung), scheitern die Tests an der
// Anzeige, nicht schon beim Laden.
const modelle = await import("../src/lib/agent-modelle.ts").catch(() => ({ AGENT_MODELLE: {}, dashboardModellFuer: () => null }));

const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
const leer = () => null;

/** Messzeitpunkt der Live-Abzüge: Sa 07.11.2026 12:28:23 Europe/Berlin. */
const MESSUNG = "2026-11-07T11:28:23.000Z";

// ═══ TOR-T1 /academy ═══

function academy(lz) {
  return ladeTsx("app/academy/page.tsx", { ...lz.attrappen }, ["TRAINING_DATA"]);
}

test("TOR-T1 /academy: keine Einwohner- bzw. Marktgrößen-Zahlen ohne Quelle in den Kernkompetenzen (LOCALIZER gerendert)", () => {
  const lz = baumLaufzeit();
  const A = academy(lz);
  // useState: selectedAgent, activeTab
  const t = text(lz.rendere(A.default, {}, ["localizer", "overview"]));
  assert.ok(t.includes("DACH-Marktintelligenz"), "LOCALIZER-Tab gerendert");
  assert.doesNotMatch(t, /\b\d+(?:[.,]\d+)?\s?(?:M|Mio\.?|Mrd\.?|Millionen)\b/, t.slice(0, 400));
  // Alle Module: keine Mengenangabe in Millionen ohne Quelle
  const millionen = /\b\d+(?:[.,]\d+)?\s?(?:M|Mio\.?|Mrd\.?|Millionen)\b/;
  const treffer = A.__intern.TRAINING_DATA.flatMap((m) => m.kernkompetenzen.filter((k) => millionen.test(k)).map((k) => `${m.agentId}: ${k}`));
  assert.deepEqual(treffer, []);
});

test("TOR-T1 /academy: Kopf zählt den Lehrplan (Agenten mit Modul), nicht die Flotte — Etikett ohne 'Agents'", () => {
  const lz = baumLaufzeit();
  const A = academy(lz);
  const baum = lz.rendere(A.default, {}, [null, "overview"]);
  const kopf = finde(baum, (k) => k.type === "p" && String(k.props.className ?? "") === "gp-kicker")[0];
  assert.ok(kopf, "Kopfzeile");
  const agenten = new Set(A.__intern.TRAINING_DATA.map((m) => m.agentId)).size;
  assert.match(text(kopf), new RegExp(`^Internes Weiterbildungsmodul — Lehrplan für ${agenten} Agenten, \\d+ Pflichtlektueren, \\d+ Pruefungsfragen$`));
  assert.match(String(kopf.props.title ?? ""), /nicht aus dem Agenten-Register/);
});

// ═══ TOR-T2 Systemzustand, Zeile „Crons" ═══

const P = ladeTsx("components/ui/CommandPanels.tsx", {
  ...ECHT,
  "next/link": { __esModule: true, default: Link },
  "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }) },
  "@/lib/freigabe-regeln": regeln,
  "@/lib/hooks-status": hooksStatus,
  "@/lib/types": types,
});

function cronsZeile(status) {
  const lesung = { status, fehler: null, loading: false, geladenAm: status.erzeugt_am, httpStatus: 200, neuLaden: async () => {} };
  const roh = renderToStaticMarkup(React.createElement(P.SystemzustandPanel, { lesung }));
  const teil = roh.split('<div class="flex items-center gap-2.5"').find((t) => t.includes(">Crons</span>"));
  assert.ok(teil, "Zeile Crons fehlt");
  const title = ent(/^ title="([^"]*)"/.exec(teil)?.[1] ?? "");
  const wert = /<span class="ml-auto[^"]*" style="color:([^"]*)">([^<]*)<\/span>/.exec(teil);
  return { title, farbe: wert?.[1], text: ent(wert?.[2] ?? "") };
}

function cronsMesswert(plan, jetzt) {
  const b = statusServer.bewerteTotmann(plan, [], new Date(jetzt), null, null);
  return { wert: b.wert, status: b.status, quelle: "Plan site/src/lib/totmann.ts · Supabase · lauf_nachweis", gemessen_am: jetzt, ...(b.hinweis ? { hinweis: b.hinweis } : {}) };
}

test("TOR-T2 Crons: Zeilentext nennt Planwert und Umfang ('laut Plan aus seit 30.07.2026 · VPS-Crontab'), Farbe bernstein wie bisher", () => {
  const m = cronsMesswert(totmann.TOTMANN_PLAN, MESSUNG);
  assert.equal(m.status, "warnung", "Totmann-Semantik unverändert: alle aus → bernstein");
  assert.deepEqual(m.wert.jobs.map((j) => j.lage), ["aus", "aus", "aus"]);
  const z = cronsZeile({ erzeugt_am: MESSUNG, crons: m });
  assert.equal(z.text, "laut Plan aus seit 30.07.2026 · VPS-Crontab");
  assert.equal(z.farbe, "var(--gp-amber)");
});

test("TOR-T2 Crons: title sagt, dass die Zeitpläne der GitHub-Workflows nicht gemessen sind; jeder Job 'laut Plan aus'", () => {
  const z = cronsZeile({ erzeugt_am: MESSUNG, crons: cronsMesswert(totmann.TOTMANN_PLAN, MESSUNG) });
  assert.ok(z.title.includes("Zeitpläne der GitHub-Workflows (.github/workflows) sind nicht gemessen"), z.title);
  assert.ok(z.title.includes("nur für den VPS-Crontab"), z.title);
  assert.equal((z.title.match(/: laut Plan aus seit 30\.07\.2026 — Crons abgeschaltet/g) ?? []).length, 3, z.title);
  // Auch ein einzelner abgeschalteter Job neben aktiven trägt Planwert und Umfang sichtbar.
  const [MORGEN, ABEND, AUTO] = totmann.TOTMANN_PLAN;
  const aktiv = (j) => ({ ...j, aktiv: true, aktiv_seit: "2026-11-07T00:00:00+01:00", zeitzone_beleg: "Testannahme", aus_seit: null, grund: null });
  const einer = cronsZeile({ erzeugt_am: MESSUNG, crons: cronsMesswert([MORGEN, aktiv(ABEND), aktiv(AUTO)], MESSUNG) });
  assert.equal(einer.text, "Briefing morgens: laut Plan aus seit 30.07.2026 · VPS-Crontab");
  assert.ok(einer.title.endsWith(types.CRONS_UMFANG), einer.title.slice(-200));
});

// ═══ TOR-F1 Message Bus im Command Center ═══

const F = ladeTsx("components/ui/MessageFeed.tsx", { ...ECHT, "@/lib/freigabe-regeln": regeln, "@/lib/types": types });

const nachricht = (id, zeit, teil = {}) => ({
  id,
  from_agent: "counsel",
  to_agents: ["donna"],
  to_channels: [],
  message_type: "response",
  priority: "normal",
  content: { text: `Antwort ${id}` },
  metadata: { source: "activation-api" },
  created_at: zeit,
  timestamp: zeit,
  ...teil,
});

/** Zeitangaben des Feeds: [{ text, title }] in Listenfolge. */
function feedZeiten(messages, bezugIso) {
  const html = ent(renderToStaticMarkup(React.createElement(F.MessageFeed, { messages, bezugIso })));
  return [...html.matchAll(/<span class="text-\[10px\] text-text-muted ml-auto font-mono[^"]*"(?: title="([^"]*)")?>([^<]*)<\/span>/g)].map((m) => ({
    title: m[1] ?? "",
    text: m[2],
  }));
}

test("TOR-F1 Bus: Nachricht vom 30.07. zeigt das Datum ('30.07., 00:19:54'), eine vom Tag der Messung nur die Uhrzeit", () => {
  // gemessen: neueste Bus-Zeile 07.11.2026 11:24:39 UTC, Juli-Läufe bis 29.07.2026 22:19:54 UTC
  const zeiten = feedZeiten([nachricht("neu", "2026-11-07T11:24:39.821Z"), nachricht("alt", "2026-07-29T22:19:54.000Z")], MESSUNG);
  assert.deepEqual(
    zeiten.map((z) => z.text),
    ["12:24:39", "30.07., 00:19:54"],
  );
  assert.match(zeiten[1].title, /^30\.07\.2026 00:19:54 \(Europe\/Berlin\) · Feld messages\.timestamp$/);
  assert.match(zeiten[0].title, /^07\.11\.2026 12:24:39 \(Europe\/Berlin\) · Feld messages\.timestamp · ohne Datum: Tag der Messung des Systemzustands$/);
});

test("TOR-F1 Bus: 'heute' ist der Kalendertag in Europe/Berlin; anderes Jahr mit Jahr; ohne Messzeit immer mit Datum", () => {
  // 07.11. 23:00 Berlin gegen Messung 08.11. 00:30 Berlin: anderer Tag, obwohl in UTC derselbe.
  const nachMitternacht = feedZeiten([nachricht("a", "2026-11-07T22:00:00.000Z")], "2026-11-07T23:30:00.000Z");
  assert.equal(nachMitternacht[0].text, "07.11., 23:00:00");
  assert.equal(feedZeiten([nachricht("b", "2025-12-31T22:30:00.000Z")], MESSUNG)[0].text, "31.12.2025, 23:30:00");
  const ohneBezug = feedZeiten([nachricht("c", "2026-11-07T11:24:39.000Z")], null);
  assert.equal(ohneBezug[0].text, "07.11.2026, 12:24:39");
  assert.match(ohneBezug[0].title, /Datum immer gezeigt/);
  // Ohne timestamp zählt created_at, wie bisher; unlesbar bleibt "Zeit unbekannt".
  assert.equal(feedZeiten([nachricht("d", "2026-07-28T06:46:42.000Z", { timestamp: null })], MESSUNG)[0].text, "28.07., 08:46:42");
  assert.equal(feedZeiten([nachricht("e", "kaputt")], MESSUNG)[0].text, "Zeit unbekannt");
});

test("TOR-F1 Command Center: reicht den Messzeitpunkt des Systemzustands (erzeugt_am) als Bezug an den Feed", () => {
  const lz = baumLaufzeit();
  const gefangen = [];
  const C = ladeTsx("app/page.tsx", {
    ...lz.attrappen,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks": {
      useAgents: () => ({ agents: [], ausgeblendet: 0, loading: false, error: null, refetch: async () => {} }),
      useMessages: () => ({ messages: [nachricht("n", "2026-07-29T22:19:54.000Z")], loading: false, error: null, realtime: "SUBSCRIBED", realtimeFehler: null }),
      useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }),
    },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": {
      ...hooksStatus,
      useSystemStatus: () => ({ status: { erzeugt_am: MESSUNG }, fehler: null, loading: false, geladenAm: MESSUNG, httpStatus: 200, neuLaden: async () => {} }),
    },
    "@/lib/types": types,
    "@/lib/auftrag-types": auftragTypes,
    "@/components/agents/AgentCard": { AgentCard: leer },
    "@/components/ui/MessageFeed": {
      MessageFeed: (p) => {
        gefangen.push(p);
        return null;
      },
      istSichtbareNachricht: () => true,
    },
    "@/components/ui/Masthead": { Masthead: leer },
    "@/components/ui/SituationTable": { SituationTable: leer },
    "@/components/ui/CommandPanels": { FreigabePanel: leer, SteinadelPanel: leer, SystemzustandPanel: leer },
  });
  lz.rendere(C.default, {}, []);
  assert.equal(gefangen.length, 1, "Feed gerendert");
  assert.equal(gefangen[0].bezugIso, MESSUNG);
});

// ═══ TOR-F2 Modell je Agent ═══

// Register agents.llm_model, gemessen per SELECT am 07.11.2026 (ohne trader, ausgeblendet).
const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5-20251001";
const REGISTER = [
  ["strategist", "STRATEGIST", 0, SONNET],
  ["donna", "L.I.S.A.", 0, SONNET],
  ["oracle", "ORACLE", 1, SONNET],
  ["operator", "OPERATOR", 1, SONNET],
  ["architect", "ARCHITECT", 1, SONNET],
  ["treasurer", "TREASURER", 1, HAIKU],
  ["publisher", "PUBLISHER", 1, SONNET],
  ["counsel", "COUNSEL", 1, HAIKU],
  ["amplifier", "AMPLIFIER", 2, SONNET],
  ["merchant", "MERCHANT", 2, SONNET],
  ["researcher", "RESEARCHER", 2, SONNET],
  ["scribe", "SCRIBE", 3, SONNET],
  ["guardian", "GUARDIAN", 3, HAIKU],
  ["concierge", "CONCIERGE", 3, HAIKU],
  ["localizer", "LOCALIZER", 3, HAIKU],
  ["sentinel", "SENTINEL", 3, HAIKU],
];
const agent = ([id, name, tier, llm_model], teil = {}) => ({
  id,
  name,
  role: `Rolle ${name}`,
  tier,
  llm_model,
  status: "online",
  channels: [],
  last_heartbeat: null,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cost_usd: 0,
  config: {},
  ...teil,
});
const AGENTEN = REGISTER.map((z) => agent(z));
const nach = (id) => AGENTEN.find((a) => a.id === id);

function karte(a) {
  const K = ladeTsx("components/agents/AgentCard.tsx", {
    ...ECHT,
    "next/link": { __esModule: true, default: Link },
    "@/lib/types": types,
    "@/lib/hooks": { useJetztIso: () => MESSUNG },
    "@/lib/agent-modelle": modelle,
  });
  return ent(renderToStaticMarkup(React.createElement(K.AgentCard, { agent: a })));
}

test("TOR-F2 Agentenkarte: Modell des Dashboard-Aufrufs vorn, abweichendes Register sichtbar markiert (AMPLIFIER, MERCHANT, SCRIBE)", () => {
  for (const id of ["amplifier", "merchant", "scribe"]) {
    const html = karte(nach(id));
    assert.ok(html.includes(`>Dashboard: ${HAIKU}<`), `${id}: ${html.slice(-700)}`);
    assert.ok(html.includes(`>Register: ${SONNET} — weicht ab<`), id);
    assert.match(html, /style="color:var\(--gp-amber\)" data-modell="register"/);
  }
  // Register = Dashboard: keine zweite Zeile, kein "weicht ab".
  const counsel = karte(nach("counsel"));
  assert.ok(counsel.includes(`>Dashboard: ${HAIKU}<`));
  assert.ok(!counsel.includes("data-modell=\"register\"") && !counsel.includes("weicht ab"));
});

test("TOR-F2 Agentenkarte: SENTINEL ohne Prompt heißt 'kein Dashboard-Prompt', das Register steht als solches daneben", () => {
  const html = karte(nach("sentinel"));
  assert.ok(html.includes(">kein Dashboard-Prompt<"), html.slice(-700));
  assert.ok(html.includes(`>Register: ${HAIKU}<`));
  assert.match(html, /nicht aktivierbar/);
});

test("TOR-F2 Konfiguration: lib/agent-modelle.ts ist die Quelle von lib/agent-prompts.ts (gleiche Schlüssel, gleiche Modelle)", async () => {
  const { AGENT_PROMPTS } = await import("../src/lib/agent-prompts.ts");
  assert.deepEqual(Object.keys(modelle.AGENT_MODELLE).sort(), Object.keys(AGENT_PROMPTS).sort());
  for (const [id, p] of Object.entries(AGENT_PROMPTS)) assert.equal(p.model, modelle.AGENT_MODELLE[id], id);
  // gezählt: 7 Sonnet, 8 Haiku; sentinel hat keinen Prompt
  const werte = Object.values(modelle.AGENT_MODELLE);
  assert.deepEqual([werte.filter((m) => m === SONNET).length, werte.filter((m) => m === HAIKU).length], [7, 8]);
  assert.equal(modelle.dashboardModellFuer("sentinel"), null);
  assert.equal(modelle.dashboardModellFuer("constructor"), null);
});

test("TOR-F2 Regel 5: lib/agent-modelle.ts importiert nichts; keine Client-Datei erreicht lib/agent-prompts.ts", () => {
  const modellQuelle = readFileSync(path.join(SITE, "src/lib/agent-modelle.ts"), "utf8");
  assert.doesNotMatch(modellQuelle, /^\s*(import|export)\s.*\sfrom\s/m, "agent-modelle.ts ohne Import");
  assert.doesNotMatch(modellQuelle, /systemPrompt|COMPANY_CONTEXT/);
  // Importgraph ab jeder "use client"-Datei (ohne reine Typ-Importe)
  const SRC = path.join(SITE, "src");
  const alle = [];
  const lauf = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) lauf(p);
      else if (/\.(ts|tsx)$/.test(n)) alle.push(p);
    }
  };
  lauf(SRC);
  const aufloesen = (von, spez) => {
    const basis = spez.startsWith("@/") ? path.join(SRC, spez.slice(2)) : spez.startsWith(".") ? path.resolve(path.dirname(von), spez) : null;
    if (basis === null) return null;
    for (const k of [basis, `${basis}.ts`, `${basis}.tsx`, path.join(basis, "index.ts"), path.join(basis, "index.tsx")]) {
      if (existsSync(k) && statSync(k).isFile()) return k;
    }
    return null;
  };
  const importe = (datei) =>
    [...readFileSync(datei, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']/gm)]
      .map((m) => aufloesen(datei, m[1]))
      .filter(Boolean);
  const client = alle.filter((d) => /^\s*["']use client["']/.test(readFileSync(d, "utf8")));
  assert.ok(client.length > 10, `Client-Dateien gefunden: ${client.length}`);
  const prompts = path.join(SRC, "lib/agent-prompts.ts");
  for (const start of client) {
    const gesehen = new Set([start]);
    const offen = [start];
    while (offen.length) {
      const d = offen.pop();
      for (const ziel of importe(d)) {
        assert.notEqual(ziel, prompts, `${path.relative(SITE, start)} erreicht lib/agent-prompts.ts über ${path.relative(SITE, d)}`);
        if (!gesehen.has(ziel)) {
          gesehen.add(ziel);
          offen.push(ziel);
        }
      }
    }
  }
});

function metricsSeite(agents) {
  const lz = baumLaufzeit();
  const M = ladeTsx("app/metrics/page.tsx", {
    ...lz.attrappen,
    "@/lib/hooks-metrics": { useMetrics: () => ({ metrics: [], loading: false, error: null, aggregated: {}, abgeschnitten: false, grenze: 200 }) },
    "@/lib/hooks": { useAgents: () => ({ agents, ausgeblendet: 1, loading: false, error: null }), useJetztIso: () => MESSUNG },
    "@/lib/hooks-status": {
      ...hooksStatus,
      useSystemStatus: () => ({ status: null, fehler: null, loading: false, geladenAm: null, httpStatus: null, neuLaden: async () => {} }),
    },
    "@/components/ui/KPICard": {
      KPICard: ({ label, value, subtitle }) => lz.attrappen["react/jsx-runtime"].jsx("div", { "data-kpi": label, children: `${label}: ${value} · ${subtitle ?? ""}` }),
    },
    "@/components/ui/AttributionPanel": { AttributionPanel: () => null },
    "@/lib/kosten": kosten,
    "@/lib/agent-modelle": modelle,
    "@/lib/types": types,
  });
  return lz.rendere(M.default, {}, []);
}

test("TOR-F2 /metrics: Klassen nach Dashboard-Modell (Sonnet 7 · Haiku 8 · ohne Prompt 1), Register-Abweichung genannt", () => {
  const baum = metricsSeite(AGENTEN);
  const kpi = text(finde(baum, (k) => k.props?.["data-kpi"] === "Agenten (Register, gelesen)")[0]);
  assert.equal(kpi, "Agenten (Register, gelesen): 16 · Dashboard-Modell: Sonnet 7 · Haiku 8 · ohne Prompt 1 · Register weicht bei 3 ab");
  const t = text(baum);
  assert.ok(t.includes("Modelle laut Dashboard-Konfiguration"));
  assert.ok(!t.includes("Modelle laut Register"));
  assert.ok(t.includes(`Register (agents.llm_model) weicht bei 3 Agenten ab: AMPLIFIER (Register ${SONNET}, Dashboard ${HAIKU}), MERCHANT (Register ${SONNET}, Dashboard ${HAIKU}), SCRIBE (Register ${SONNET}, Dashboard ${HAIKU})`), t);
  assert.ok(t.includes(`kein Dashboard-Prompt: 1 Agent`) && t.includes(`SENTINEL (Register: ${HAIKU})`));
});

test("TOR-F2 /metrics: Tabelle zeigt je Agent Dashboard-Modell und dessen Preisbasis, das Register daneben", () => {
  const baum = metricsSeite(AGENTEN);
  const zeilen = finde(baum, (k) => k.type === "tr").map((tr) => finde(tr, (k) => k.type === "td").map(text));
  const zeile = (name) => zeilen.find((z) => z[0] === name);
  assert.deepEqual(zeile("AMPLIFIER").slice(2, 5), [`Haiku${HAIKU}`, "Input $1,00 · Output $5,00 je Mio. Tokens", `${SONNET} — weicht ab`]);
  assert.deepEqual(zeile("PUBLISHER").slice(2, 5), [`Sonnet${SONNET}`, "Input $2,00 · Output $10,00 je Mio. Tokens", SONNET]);
  assert.deepEqual(zeile("SENTINEL").slice(2, 5), ["ohne Promptkein Dashboard-Prompt", "kein Dashboard-Aufruf", HAIKU]);
});

// ═══ TOR-F3/F4/F7 Agent-Detail ═══

function detail(id, detailDaten) {
  return ent(
    renderToStaticMarkup(
      React.createElement(
        ladeTsx("app/agents/[id]/page.tsx", {
          ...ECHT,
          "next/navigation": { useParams: () => ({ id }) },
          "next/link": { __esModule: true, default: Link },
          "@/lib/hooks": {
            DETAIL_NACHRICHTEN_GRENZE: 20,
            anzeigeFehler: (t) => String(t),
            istGueltigeAgentId: (x) => typeof x === "string" && /^[a-z0-9_-]+$/.test(x),
            useAgentDetail: () => ({ loading: false, neuLaden: () => {}, agentFehler: null, messagesFehler: null, messages: [], ...detailDaten }),
            useJetztIso: () => MESSUNG,
          },
          "@/lib/freigabe-regeln": regeln,
          "@/lib/kosten": kosten,
          "@/lib/agent-modelle": modelle,
          "@/lib/types": types,
        }).default,
      ),
    ),
  );
}

/** Wert der Zeile "Kosten (geschätzt)" und das Etikett darunter. */
function kostenZeile(html) {
  const m = /<span class="text-xs text-text-secondary">Kosten \(geschätzt\)<\/span><span[^>]*>([^<]*)<\/span>/.exec(html);
  const e = /<p class="[^"]*" data-kosten-etikett="[^"]*">([^<]*)<\/p>/.exec(html);
  return { wert: m?.[1] ?? null, etikett: e?.[1] ?? null };
}

// Token- und Kostensummen in agents, gemessen per SELECT am 07.11.2026.
const VERBRAUCH = {
  publisher: { total_input_tokens: 26247, total_output_tokens: 24356, total_cost_usd: 0.4441 },
  researcher: { total_input_tokens: 36321, total_output_tokens: 37741, total_cost_usd: 0.6751 },
  counsel: { total_input_tokens: 82462, total_output_tokens: 13444, total_cost_usd: 0.1218 },
  scribe: { total_input_tokens: 47571, total_output_tokens: 17172, total_cost_usd: 0.1068 },
};

test("TOR-F3 /agents/[id]: Kosten aus Tokens × aktueller Tabelle — publisher ≥ $0,2960, researcher ≥ $0,4500 (nicht ≥ $0,4441 / ≥ $0,6751)", () => {
  // 26.247 × 2 + 24.356 × 10 = 296.054 → 0,296054 USD; 36.321 × 2 + 37.741 × 10 = 450.052 → 0,450052 USD
  const pub = kostenZeile(detail("publisher", { agent: agent(REGISTER[6], VERBRAUCH.publisher) }));
  assert.deepEqual(pub, { wert: "≥ $0,2960", etikett: `Tokens × aktuelle Preistabelle (${SONNET})` });
  const res = kostenZeile(detail("researcher", { agent: agent(REGISTER[10], VERBRAUCH.researcher) }));
  assert.deepEqual(res, { wert: "≥ $0,4500", etikett: `Tokens × aktuelle Preistabelle (${SONNET})` });
});

test("TOR-F3 /agents/[id]: Haiku-Agenten nach Dashboard-Modell (counsel ≥ $0,1496, scribe ≥ $0,1334 — scribe trotz Register Sonnet)", () => {
  // 82.462 × 1 + 13.444 × 5 = 149.682; 47.571 × 1 + 17.172 × 5 = 133.431 (je 1e-6 USD)
  assert.deepEqual(kostenZeile(detail("counsel", { agent: agent(REGISTER[7], VERBRAUCH.counsel) })), {
    wert: "≥ $0,1496",
    etikett: `Tokens × aktuelle Preistabelle (${HAIKU})`,
  });
  assert.deepEqual(kostenZeile(detail("scribe", { agent: agent(REGISTER[11], VERBRAUCH.scribe) })), {
    wert: "≥ $0,1334",
    etikett: `Tokens × aktuelle Preistabelle (${HAIKU})`,
  });
});

test("TOR-F4 /agents/[id]: gespeicherte, je Lauf gerundete Summe ist keine Untergrenze — Rückfall nur mit '≈' und Etikett", () => {
  // Ohne Tokens (oder ohne Dashboard-Modell) bleibt nur total_cost_usd: numeric(10,4), je Lauf gerundet.
  const ohneTokens = kostenZeile(detail("counsel", { agent: agent(REGISTER[7], { total_cost_usd: 0.1218 }) }));
  assert.deepEqual(ohneTokens, { wert: "≈ $0,1218", etikett: "gespeicherte Summe, Preistabelle je Lauf" });
  const sentinel = kostenZeile(detail("sentinel", { agent: agent(REGISTER[15], { total_input_tokens: 1000, total_output_tokens: 100, total_cost_usd: 0.0012 }) }));
  assert.equal(sentinel.wert, "≈ $0,0012");
  // Das Etikett passt zur Zahl: nie "≥" aus der gespeicherten Summe.
  const html = detail("counsel", { agent: agent(REGISTER[7], VERBRAUCH.counsel) });
  assert.ok(!html.includes("≥ $0,1218"));
  assert.match(html, /Gespeicherte Summe agents\.total_cost_usd: \$0,1218 — je Lauf mit der damals gültigen Preistabelle geschätzt/);
});

test("TOR-F7 /agents/donna: 'Modell letzter Lauf' zählt den Planungslauf (delegate-plan) mit Art und Quelle", () => {
  // gemessen: donna, message_type plan, source delegate-plan, claude-sonnet-5, 07.11.2026 11:23:51 UTC
  const plan = {
    id: "msg-plan",
    from_agent: "donna",
    to_agents: [],
    to_channels: [],
    message_type: "plan",
    content: { text: "Plan" },
    metadata: { source: "delegate-plan", model: SONNET, input_tokens: 1232, output_tokens: 645, cost_usd: 0.008914, preis_stand: "2026-11-06" },
    created_at: "2026-11-07T11:23:51.296Z",
  };
  const lauf = { ...plan, id: "msg-run", message_type: "plan_run", metadata: { source: "delegate-run" }, created_at: "2026-11-07T11:24:29.166Z" };
  const html = detail("donna", { agent: agent(REGISTER[1]), messages: [lauf, plan] });
  assert.ok(html.includes(`<p class="text-sm font-medium break-words">${SONNET} · Planung</p>`), html.slice(0, 2000));
  assert.match(html, /source delegate-plan/);
  assert.ok(!html.includes("nicht in den neuesten 20 Nachrichten"));
  // Ohne Lauf: ehrlich "kein Lauf …"; Fehllauf mit Art.
  assert.ok(detail("donna", { agent: agent(REGISTER[1]), messages: [lauf] }).includes("kein Lauf in den neuesten 20 Nachrichten"));
  const fehl = { ...plan, id: "f", metadata: { source: "fehllauf", art: "planung", model: SONNET } };
  assert.ok(detail("donna", { agent: agent(REGISTER[1]), messages: [fehl] }).includes(`${SONNET} · Fehllauf der Planung`));
});

test("TOR-F2 /agents/[id]: Modell (Dashboard) neben dem Register, Abweichung markiert", () => {
  const html = detail("amplifier", { agent: agent(REGISTER[8]) });
  assert.ok(html.includes(`>Modell (Dashboard)</p><p class="text-sm font-medium break-words">${HAIKU}</p>`), html.slice(0, 2500));
  assert.ok(html.includes(`>Modell (Register)</p><p class="text-sm font-medium break-words" style="color:var(--gp-amber)">${SONNET} — weicht ab</p>`));
  const sentinel = detail("sentinel", { agent: agent(REGISTER[15]) });
  assert.ok(sentinel.includes(">kein Dashboard-Prompt</p>"));
});

// ═══ TOR-F5/F6 /messages ═══

function messagesSeite(messages) {
  const lz = baumLaufzeit();
  const M = ladeTsx("app/messages/page.tsx", {
    ...lz.attrappen,
    "@/lib/hooks": {
      useMessages: () => ({ messages, loading: false, error: null, realtime: "SUBSCRIBED", realtimeFehler: null }),
      useAgents: () => ({ agents: [], ausgeblendet: 0, loading: false, error: null }),
    },
    "@/lib/hooks-status": {
      useSystemStatus: () => ({ status: { erzeugt_am: MESSUNG, bus: { wert: { anzahl: messages.length }, status: "ok", quelle: "q", gemessen_am: MESSUNG } }, fehler: null, loading: false, geladenAm: MESSUNG, httpStatus: 200, neuLaden: async () => {} }),
    },
    "@/components/ui/CommandPanel": { CommandPanel: () => null },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/kosten": kosten,
    "@/lib/types": types,
  });
  return lz.rendere(M.default, {}, []);
}

/** Zähler-Knöpfe: Bezeichnung → Zahl. */
function zaehler(baum) {
  return Object.fromEntries(
    finde(baum, (k) => k.type === "button" && /card-ghost px-4/.test(String(k.props.className ?? ""))).map((k) => {
      const spans = finde(k, (s) => s.type === "span");
      return [text(spans[0]), Number(text(spans[1]))];
    }),
  );
}

// gemessen: 48 Nachrichten = 46 response (activation-api) + 1 plan (delegate-plan) + 1 plan_run (delegate-run)
const BUS = [
  ...Array.from({ length: 46 }, (_, i) => nachricht(`r${i}`, "2026-07-29T22:19:54.000Z", { metadata: { source: "activation-api", model: HAIKU, cost_usd: 0.0015 } })),
  nachricht("plan", "2026-11-07T11:23:51.296Z", { from_agent: "donna", to_agents: [], message_type: "plan", metadata: { source: "delegate-plan", model: SONNET, cost_usd: 0.008914, preis_stand: "2026-11-06" } }),
  nachricht("run", "2026-11-07T11:24:29.166Z", { from_agent: "donna", to_agents: [], message_type: "plan_run", metadata: { source: "delegate-run" } }),
];

test("TOR-F5 /messages: Zähler decken jede Nachricht genau einmal ab — 46 + 1 + 1 = 48", () => {
  const baum = messagesSeite(BUS);
  const z = zaehler(baum);
  assert.deepEqual(z, { Aufgabe: 0, Antwort: 46, Broadcast: 0, Alarm: 0, Plan: 1, Planlauf: 1 });
  assert.equal(Object.values(z).reduce((a, b) => a + b, 0), 48);
  const t = text(baum);
  assert.ok(t.includes("48 Nachrichten in den neuesten 100, im Browser gelesen"));
  assert.ok(t.includes("jede Nachricht in genau einem Zähler, Summe 48"), t.slice(0, 800));
});

test("TOR-F5 /messages: Fehllauf und unbekannter Typ haben eigene Zähler, die Summe bleibt die Liste", () => {
  const baum = messagesSeite([
    nachricht("a", MESSUNG),
    nachricht("f", MESSUNG, { metadata: { source: "fehllauf", art: "aktivierung", cost_usd: 0.01, preis_stand: "2026-11-06" } }),
    nachricht("p", MESSUNG, { message_type: "plan", metadata: { source: "fehllauf", art: "planung", cost_usd: 0.02, preis_stand: "2026-11-06" } }),
    nachricht("x", MESSUNG, { message_type: "heartbeat" }),
  ]);
  const z = zaehler(baum);
  assert.equal(z.Antwort, 1);
  assert.equal(z.Plan, 0, "ein Fehllauf der Planung ist kein Plan");
  assert.equal(z.Fehllauf, 2);
  assert.equal(z["Andere Typen"], 1);
  assert.equal(Object.values(z).reduce((a, b) => a + b, 0), 4);
  const andere = finde(baum, (k) => k.type === "button" && text(k).startsWith("Andere Typen"))[0];
  assert.match(String(andere.props.title), /Typen: heartbeat/);
});

/** Metadaten-Chips (break-all) einer Seite. */
const chips = (baum) => finde(baum, (k) => k.type === "span" && /break-all/.test(String(k.props.className ?? ""))).map(text);

test("TOR-F6 /messages: cost_usd einheitlich ($0,0015 statt 0.0015056000000000002), alte Preistabelle sichtbar", () => {
  const baum = messagesSeite([
    // gemessen: guardian 29.07.2026, ohne preis_stand, cost_usd 0.0015056000000000002
    nachricht("alt", "2026-07-29T19:24:29.335Z", { from_agent: "guardian", metadata: { source: "activation-api", model: HAIKU, cost_usd: 0.0015056000000000002 } }),
    nachricht("neu", MESSUNG, { metadata: { source: "activation-api", model: HAIKU, cost_usd: 0.009797, preis_stand: "2026-11-06" } }),
    nachricht("py", MESSUNG, { metadata: { source: "base_agent", cost_usd: 0.01 } }),
  ]);
  const c = chips(baum);
  assert.ok(c.includes("cost_usd (geschätzt, alte Preistabelle vor 06.11.2026): $0,0015"), c.join(" | "));
  assert.ok(c.includes("cost_usd (geschätzt): $0,0098"), c.join(" | "));
  assert.ok(c.includes("cost_usd (geschätzt, Preistabelle unbekannt): $0,0100"), c.join(" | "));
  assert.ok(!c.some((x) => x.includes("0000000")), "kein Gleitkomma-Rest");
});

test("TOR-F6/F7 Quellen der Lauf-Kosten: LAUF_QUELLEN (Anzeige) = KOSTEN_QUELLEN (Server)", () => {
  assert.deepEqual(Object.keys(types.LAUF_QUELLEN).sort(), [...statusServer.KOSTEN_QUELLEN].sort());
  assert.equal(types.preisTabelleHinweis({ source: "activation-api", preis_stand: "2026-10-01" }, "2026-11-06"), "Preistabelle 01.10.2026, nicht die aktuelle");
  assert.equal(types.preisTabelleHinweis('{"source":"fehllauf"}', "2026-11-06"), "alte Preistabelle vor 06.11.2026");
});

test("TOR-F2 modellKern = basisModell (lib/kosten.ts) für die Abweichungs-Prüfung", () => {
  for (const m of [HAIKU, SONNET, " Claude-Haiku-4-5 ", "claude-opus-5-20260101", "", "x-12345678"]) {
    assert.equal(types.modellKern(m), kosten.basisModell(m), JSON.stringify(m));
  }
});
