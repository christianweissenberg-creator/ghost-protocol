// Anzeige-Tests der Gesamtprüfung 06.11.2026 (Fixrunde Z). Lauf: npm test.
// Die ECHTEN .tsx-Dateien werden übersetzt und mit Attrappen geladen (tests/harness/tsx.mjs);
// lib/types.ts, lib/hooks-status.ts, lib/freigabe-regeln.ts und lib/kosten.ts laufen unverändert.
// - Agent-Detail: Nachrichten ausgeblendeter Agenten weder gezeigt noch gezählt, Leertexte als
//   Abfrageergebnis, Kosten-Untergrenze abgerundet, Kostentitel mit alter Preistabelle.
// - Kostenblock (Command Center): nach Abruffehler nichts aus der alten Messung; "≥" abgerundet.
// - TopBar: Kosten heute als abgerundete Untergrenze.
// - Attribution: Ursache je HTTP-Status, Werte maskiert.
// - L.I.S.A.-Historie: Altformat ohne Plan → "Schritte nicht gespeichert", nie "geschätzt 0,0000 USD".
// - Lagebild und /expose: Exportwerte maskiert, Links mit geschütztem Namen gesperrt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { React, baumLaufzeit, finde, jsxRuntime, ladeTsx, renderToStaticMarkup, text } from "./harness/tsx.mjs";

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
const auftragTypes = await import("../src/lib/auftrag-types.ts");
const modelle = await import("../src/lib/agent-modelle.ts");
// Objekt-Studio Schritt 2: /expose importiert next/link und die Studio-Allow-List.
const studioObjekte = await import("../src/lib/studio/objekte.ts");

const NAME = ["Immo", "Nexus"].join("");
const ENTHAELT_NAMEN = /imm[ou][\s._-]*nexus/i;
const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");

// ═══ Agent-Detail ═══

function detailSeite(detail) {
  return ladeTsx("app/agents/[id]/page.tsx", {
    ...ECHT,
    "next/navigation": { useParams: () => ({ id: "oracle" }) },
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks": {
      DETAIL_NACHRICHTEN_GRENZE: 20,
      anzeigeFehler: (t) => String(t),
      istGueltigeAgentId: (id) => typeof id === "string" && /^[a-z0-9_-]+$/.test(id),
      useAgentDetail: () => ({ loading: false, neuLaden: () => {}, agentFehler: null, messagesFehler: null, ...detail }),
      useJetztIso: () => "2026-11-06T10:00:00Z",
    },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/kosten": kosten,
    "@/lib/agent-modelle": modelle,
    "@/lib/types": types,
  });
}

const AGENT = {
  id: "oracle",
  name: "ORACLE",
  role: "CIO",
  tier: 1,
  llm_model: "claude-sonnet-5",
  status: "online",
  channels: [],
  last_heartbeat: null,
  total_input_tokens: 1200,
  total_output_tokens: 300,
  total_cost_usd: 0.01239,
  config: {},
};
const nachricht = (id, from_agent, to_agents, inhalt, to_channels = []) => ({
  id,
  from_agent,
  to_agents,
  to_channels,
  content: { text: inhalt },
  metadata: {},
  created_at: "2026-11-06T09:00:00Z",
});

const rendereDetail = (detail) => ent(renderToStaticMarkup(React.createElement(detailSeite(detail).default)));

test("Agent-Detail: Nachrichten ausgeblendeter Agenten weder gezeigt noch gezählt, Zahl genannt", () => {
  const html = rendereDetail({
    agent: AGENT,
    messages: [
      nachricht("m1", "oracle", ["donna"], "eigene Antwort"),
      nachricht("m2", "trader", ["oracle"], "vom trader"),
      nachricht("m3", "oracle", ["trader"], "nur an trader"),
    ],
  });
  assert.ok(html.includes("Nachrichten (1 in den neuesten 20)"), html.slice(0, 300));
  assert.ok(html.includes("2 von ausgeblendeten Agenten nicht angezeigt"));
  assert.ok(html.includes("eigene Antwort"));
  assert.ok(!html.includes("vom trader") && !html.includes("nur an trader"));
});

test("Agent-Detail: Leertexte sagen, was die Abfrage lieferte", () => {
  assert.ok(rendereDetail({ agent: AGENT, messages: [] }).includes("Die Abfrage im Browser lieferte keine Nachrichten von oder an diesen Agenten."));
  const nurVersteckt = rendereDetail({ agent: AGENT, messages: [nachricht("m2", "trader", ["oracle"], "x")] });
  assert.ok(nurVersteckt.includes("Keine Nachrichten sichtbarer Agenten in den neuesten 20."));
  const ohne = rendereDetail({ agent: null, messages: [] });
  assert.ok(ohne.includes('Die Abfrage im Browser lieferte keinen Agenten "oracle".'));
  assert.ok(!/Agent "oracle" nicht gefunden/.test(ohne));
});

// Tor-Prüfung 07.11.2026 (F3): Die Kosten kommen aus den Tokens × aktueller Tabelle des
// Dashboard-Modells, nicht mehr aus total_cost_usd (alte Tabelle, je Lauf gerundet).
test("Agent-Detail: Kosten-Untergrenze abgerundet, nie '≥ < $0,0001'; Titel nennt die alte Preistabelle der gespeicherten Summe", () => {
  // Nachprüfung 07.11.2026 (ehrlichkeit-2): "≥" nur, wenn die geladenen Läufe (activation-api, mit
  // metadata.model) die Token-Summen ergeben — hier der eine Lauf von oracle.
  const lauf = (ein, aus) => ({
    ...nachricht("l1", "oracle", ["donna"], "Lauf"),
    metadata: { source: "activation-api", model: "claude-sonnet-5", input_tokens: ein, output_tokens: aus },
  });
  const html = rendereDetail({ agent: AGENT, messages: [lauf(1200, 300)] });
  // 1.200 × 2 + 300 × 10 USD je Mio. Tokens (claude-sonnet-5, Dashboard-Modell von oracle) = 0,0054
  assert.ok(html.includes("≥ $0,0054"), "aus Tokens × aktueller Tabelle, abgerundet");
  assert.ok(html.includes("≥ 1.200"));
  assert.match(html, /vor dem 06\.11\.2026 die alte/);
  const klein = rendereDetail({ agent: { ...AGENT, total_input_tokens: 1, total_output_tokens: 1 }, messages: [lauf(1, 1)] });
  assert.ok(klein.includes("> $0 (gemessen unter $0,0001)"));
  assert.ok(!klein.includes("≥ <"));
  // Ohne geladenen Lauf ist das Modell nicht geprüft: "≈", keine Untergrenze.
  const ohneLauf = rendereDetail({ agent: AGENT, messages: [] });
  assert.ok(ohneLauf.includes("≈ $0,0054") && !ohneLauf.includes("≥ $0,0054"));
  const leer = { ...AGENT, total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
  assert.ok(rendereDetail({ agent: leer, messages: [] }).includes("nicht gemessen"));
});

// ═══ Kostenblock im Steinadel-Panel und TopBar ═══

const JETZT = "2026-11-06T10:00:00Z";
const MW = (wert, status = "ok", hinweis) => ({ wert, status, quelle: "Q", gemessen_am: JETZT, ...(hinweis ? { hinweis } : {}) });
const KOSTEN_OK = {
  heute_usd: 0.35,
  monat_usd: 4.2,
  planung_heute_usd: 0.05,
  planung_monat_usd: 0.6,
  laeufe_monat: 120,
  ohne_kosten_heute: 0,
  ohne_kosten_monat: 0,
  heute_vollstaendig: true,
  monat_vollstaendig: true,
  abgeschnitten: false,
};
const status = (kostenWert, kostenStatus = "ok", hinweis = "Schätzung · Tagessumme vollständig.") => ({
  erzeugt_am: JETZT,
  supabase: MW({ latenz_ms: 42 }),
  kosten: MW(kostenWert, kostenStatus, hinweis),
});
const lesung = (s, fehler = null, httpStatus = 200) => ({ status: s, fehler, loading: false, geladenAm: JETZT, httpStatus, neuLaden: async () => {} });

function panels() {
  return ladeTsx("components/ui/CommandPanels.tsx", {
    ...ECHT,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null }) },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": hooksStatus,
    "@/lib/types": types,
  });
}

function kostenBlock(l) {
  const P = panels();
  const html = ent(
    renderToStaticMarkup(React.createElement(P.SteinadelPanel, { lesung: l, objekte: { objekte: [], loading: false, error: null } }))
  );
  return html.slice(html.lastIndexOf('<div class="mt-4"', html.indexOf("Kosten (geschätzt)")));
}

for (const [name, l] of [
  ["401 nach erfolgreicher Messung", lesung(status(KOSTEN_OK), "Nicht angemeldet (HTTP 401)", 401)],
  ["500 nach erfolgreicher Messung", lesung(status(KOSTEN_OK), "HTTP 500", 500)],
]) {
  test(`Kostenblock: ${name} — kein alter Statuspunkt, Hinweis oder Messzeitpunkt`, () => {
    const block = kostenBlock(l);
    assert.ok(!block.includes("var(--gp-emerald)"), "grüner Punkt aus alter Messung");
    assert.ok(!block.includes("Tagessumme vollständig"), "alter Hinweis");
    assert.ok(!block.includes("gemessen:"), "alter Messzeitpunkt im title");
    assert.match(block, /nicht angemeldet \(HTTP 401\)|nicht lesbar: HTTP 500/);
  });
}

test("Kostenblock: unvollständige Summe abgerundet ('≥ $0,01' für 0,016), vollständige gerundet", () => {
  const unvollstaendig = { ...KOSTEN_OK, heute_usd: 0.016, monat_usd: 0.016, ohne_kosten_heute: 1, ohne_kosten_monat: 1, heute_vollstaendig: false, monat_vollstaendig: false };
  const block = kostenBlock(lesung(status(unvollstaendig, "warnung", "x")));
  assert.ok(block.includes("≥ $0,01"));
  assert.ok(!block.includes("≥ $0,02"));
  assert.ok(kostenBlock(lesung(status(KOSTEN_OK))).includes("$0,35"));
});

test("TopBar: Kosten heute als abgerundete Untergrenze, Kleinstbetrag ohne '≥ <'", () => {
  const T = ladeTsx(
    "components/layout/TopBar.tsx",
    {
      ...ECHT,
      "@/components/layout/aktiv-pfad": { useAktivPfad: () => "/" },
      "@/lib/freigabe-regeln": regeln,
      "@/lib/hooks-status": hooksStatus,
      "@/lib/types": types,
    },
    ["kostenHeute"],
  );
  const heute = (usd) => ({ ...KOSTEN_OK, heute_usd: usd, ohne_kosten_heute: 1, heute_vollstaendig: false });
  assert.equal(T.__intern.kostenHeute(lesung(status(heute(0.016), "warnung"))).text, "≥ $0,01 (geschätzt)");
  assert.equal(T.__intern.kostenHeute(lesung(status(heute(0.004), "warnung"))).text, "> $0 (gemessen unter $0,01) (geschätzt)");
  assert.equal(T.__intern.kostenHeute(lesung(status(KOSTEN_OK))).text, "$0,35 (geschätzt)");
});

// ═══ Attribution ═══

test("Attribution: Ursache je HTTP-Status, Meldung maskiert, Werte maskiert", () => {
  const A = ladeTsx("components/ui/AttributionPanel.tsx", { ...ECHT, "@/lib/freigabe-regeln": regeln }, ["wert"]);
  const f = A.attributionFehler;
  assert.match(f(401, { error: "Unauthorized" }).text, /NICHT ANGEMELDET \(HTTP 401\)/);
  assert.equal(f(401, null).ton, "amber");
  const konfig = f(500, { fehler: "Export-Token (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration", kampagnen: [] });
  assert.equal(konfig.text, "SERVERKONFIGURATION (HTTP 500): Export-Token (Server-Umgebung) nicht gesetzt");
  assert.equal(konfig.ton, "rose");
  assert.doesNotMatch(f(500, { fehler: `${NAME}_EXPORT_TOKEN nicht konfiguriert`, fehler_art: "konfiguration" }).text, ENTHAELT_NAMEN);
  // Gegencheck 06.11.2026: Ursache aus fehler_art der Route, nicht aus dem Status allein.
  const weg = f(502, { fehler: "rueckkanal_nicht_erreichbar", fehler_art: "nicht_erreichbar" });
  assert.match(weg.text, /RÜCKKANAL NICHT ERREICHBAR/);
  assert.equal(weg.ton, "amber");
  const abgelehnt = f(502, { fehler: "rueckkanal_http_403", fehler_art: "quelle_fehler" });
  assert.equal(abgelehnt.text, "RÜCKKANAL MELDET FEHLER — steinadel.de antwortete mit HTTP 403");
  assert.equal(abgelehnt.ton, "rose");
  assert.equal(f(502, { fehler: "rueckkanal_antwort_unlesbar", fehler_art: "quelle_fehler" }).text, "RÜCKKANAL MELDET FEHLER — steinadel.de Antwort nicht lesbar (kein JSON)");
  for (const [status, daten] of [[502, null], [502, { fehler: "rueckkanal_http_403" }], [500, null], [500, { fehler: "x" }], [504, null]]) {
    const ohneArt = f(status, daten);
    assert.doesNotMatch(ohneArt.text, /NICHT ERREICHBAR|SERVERKONFIGURATION/, `${status} ${JSON.stringify(daten)}`);
    assert.match(ohneArt.text, new RegExp(`^FEHLER \\(HTTP ${status}\\)`));
  }
  assert.match(f(null, null).text, /keine Antwort/);
  assert.match(f(200, null).text, /ANTWORT NICHT LESBAR/);
  assert.match(f(200, { fehler: "x" }).text, /FEHLER: x/);
  assert.match(f(200, {}).text, /OHNE KAMPAGNENLISTE/);
  assert.equal(f(200, { kampagnen: [] }), null);
  assert.equal(A.__intern.wert(`${NAME}-herbst`), "[geschützter Name]-herbst");
  assert.equal(A.__intern.wert(null), "");
});

// Gegencheck 06.11.2026 (B18): /metrics reicht den HTTP-Status an die Kostenkachel weiter.
test("/metrics: abgelaufene Sitzung (401) heißt in der Kostenkachel 'nicht angemeldet'", () => {
  const lz = baumLaufzeit();
  const M = ladeTsx("app/metrics/page.tsx", {
    ...lz.attrappen,
    "@/lib/hooks-metrics": { useMetrics: () => ({ metrics: [], loading: false, error: null, aggregated: {}, abgeschnitten: false, grenze: 500 }) },
    "@/lib/hooks": { useAgents: () => ({ agents: [], ausgeblendet: 0, loading: false, error: null }), useJetztIso: () => "2026-11-06T10:00:00Z" },
    "@/lib/hooks-status": {
      ...hooksStatus,
      useSystemStatus: () => ({ status: null, fehler: "Nicht angemeldet (HTTP 401)", loading: false, geladenAm: null, httpStatus: 401, neuLaden: async () => {} }),
    },
    "@/components/ui/KPICard": { KPICard: ({ label, value }) => lz.attrappen["react/jsx-runtime"].jsx("div", { children: `${label}: ${value}` }) },
    "@/components/ui/AttributionPanel": { AttributionPanel: () => null },
    "@/lib/kosten": kosten,
    "@/lib/agent-modelle": modelle,
    "@/lib/types": types,
  });
  const t = text(lz.rendere(M.default, {}, []));
  assert.ok(t.includes("Claude-Kosten Monat (geschätzt): nicht angemeldet"), t.slice(0, 600));
});

// ═══ L.I.S.A.-Historie (Altformat) ═══

test("L.I.S.A.-Historie: Altformat ohne Plan → 'Schritte nicht gespeichert' und 'Kosten nicht gemessen', nie 0", () => {
  const D = ladeTsx(
    "app/donna/page.tsx",
    {
      ...ECHT,
      "next/link": { __esModule: true, default: Link },
      "@/lib/auftrag-types": auftragTypes,
      "@/lib/freigabe-regeln": regeln,
      "@/lib/hooks-status": hooksStatus,
    },
    ["leseHistorie", "historieLaeufe", "historieKosten"],
  );
  const { leseHistorie, historieLaeufe, historieKosten } = D.__intern;
  const [kaputt, alt, neu] = leseHistorie(
    JSON.stringify([
      { original_task: "A", delegation_plan: { agents: "kaputt" }, summary: { total_cost_usd: 0 } },
      { original_task: "B", delegation_plan: { agents: [{}, {}] }, summary: { total_cost_usd: 0 } },
      { original_task: "C", schritte: 3, erfolgreich: 3, vollstaendig: 3, kosten_usd_geschaetzt: 0.01, ohne_kosten: 0, ausgefuehrt_am: JETZT },
    ])
  );
  assert.equal(kaputt.schritte, null);
  assert.equal(historieLaeufe(kaputt).text, "Schritte nicht gespeichert");
  assert.equal(historieKosten(kaputt).text, "Kosten nicht gemessen");
  assert.match(historieKosten(kaputt).titel, /ohne gespeicherte Läufe/, "keine Behauptung über Läufe, die nicht gespeichert sind");
  assert.ok(!/0,0000/.test(historieKosten(kaputt).text));
  assert.equal(historieLaeufe(alt).text, "2 Schritte");
  assert.equal(historieKosten(alt).text, "Kosten nicht gemessen");
  assert.equal(historieLaeufe(neu).text, "3/3 erfolgreich");
  assert.equal(historieKosten(neu).text, "geschätzt 0,0100 USD");
});

// ═══ Lagebild und /expose (R24 einheitlich) ═══

test("Lagebild: Name und Preis aus dem Export maskiert", () => {
  const L = ladeTsx("components/ui/SituationTable.tsx", {
    ...ECHT,
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null }) },
    "@/lib/hooks-status": hooksStatus,
  });
  const html = ent(
    renderToStaticMarkup(
      React.createElement(L.SituationTable, {
        lesung: { objekte: [{ slug: "villa-x", name: `Villa ${NAME}`, preis: "489.000 €" }], loading: false, error: null },
      })
    )
  );
  assert.ok(html.includes("VILLA [GESCHÜTZTER NAME] · 489.000 €"));
  assert.doesNotMatch(html, ENTHAELT_NAMEN);
});

test("/expose: alle Exportwerte maskiert, Links mit geschütztem Namen nicht verlinkt", () => {
  const lz = baumLaufzeit();
  const E = ladeTsx("app/expose/page.tsx", {
    ...lz.attrappen,
    "next/link": { __esModule: true, default: Link },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": hooksStatus,
    "@/lib/studio/objekte": studioObjekte,
  });
  const objekt = {
    slug: `${NAME.toLowerCase()}-villa`,
    name: `Villa ${NAME}`,
    untertitel: `Untertitel ${NAME}`,
    tagline: `Tagline ${NAME}`,
    ort: `Ort ${NAME}`,
    baujahr: 1905,
    preis: `Preis ${NAME}`,
    kurzbeschreibung: `Beschreibung ${NAME}`,
    statusBadge: `Status ${NAME}`,
    afaProzent: 9,
    istDenkmal: true,
    kennzahlen: [{ label: `Label ${NAME}`, wert: `Wert ${NAME}` }],
    urls: { objektSeite: `https://steinadel.de/${NAME}`, expose: "https://steinadel.de/expose/villa", ogBild: "", cover: "" },
    kampagnen: [{ kampagne: `${NAME}-herbst`, lpUrl: `https://steinadel.de/lp/${NAME}`, lpVariant: "a" }],
  };
  // useState-Reihenfolge der Seite: openSlug, zustand, objekte, generiertAm, abgerufenAm
  const baum = lz.rendere(E.default, {}, [null, "erfolg", [objekt], null, null]);
  const t = text(baum);
  assert.doesNotMatch(t, ENTHAELT_NAMEN);
  assert.ok(t.includes("Villa [geschützter Name]") && t.includes("Label [geschützter Name]"));
  const links = finde(baum, (k) => k.type === "a").map((a) => a.props.href);
  assert.deepEqual(links, ["https://steinadel.de/expose/villa"], "nur der Link ohne Namen");
  assert.ok(t.includes("Link gesperrt: geschützter Name"));
});

// ═══ Gescheiterte, aber bezahlte Planung: Command Center und /donna zeigen dasselbe ═══

const PLANUNG = { modell: "claude-sonnet-5", input_tokens: 1200, output_tokens: 12000, kosten_usd_geschaetzt: 0.1224, stop_reason: "max_tokens" };
const FEHLSCHLAG = hooksStatus.lesePlanungsFehlschlag({
  fehler: "Plan abgeschnitten",
  planung: PLANUNG,
  protokoll_fehler: "Fehllauf nicht gespeichert: permission denied",
});
const leer = () => null;
const PLAN = {
  mode: "plan",
  auftrag_id: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
  original_task: "Test",
  delegation_plan: { agents: [{ id: "oracle", task: "x", priority: 1 }], reasoning: "r" },
  planung: PLANUNG,
  erstellt_am: JETZT,
  protokoll_fehler: "Plan nicht gespeichert: kein Server-Secret für die Plan-Signatur",
};

function commandCenter(lz) {
  return ladeTsx(
    "app/page.tsx",
    {
      ...lz.attrappen,
      "next/link": { __esModule: true, default: Link },
      "@/lib/hooks": { useAgents: leer, useMessages: leer, useObjekte: leer },
      "@/lib/freigabe-regeln": regeln,
      "@/lib/hooks-status": hooksStatus,
      "@/lib/types": types,
      "@/lib/auftrag-types": auftragTypes,
      "@/components/agents/AgentCard": { AgentCard: leer },
      "@/components/ui/MessageFeed": { MessageFeed: leer, istSichtbareNachricht: () => true },
      "@/components/ui/Masthead": { Masthead: leer },
      "@/components/ui/SituationTable": { SituationTable: leer },
      "@/components/ui/CommandPanels": { FreigabePanel: leer, SteinadelPanel: leer, SystemzustandPanel: leer },
    },
    ["Auftragszeile"],
  );
}

test("Command Center: gescheiterte Planung zeigt Kosten des Fehlversuchs, protokoll_fehler und den Hinweis zum Systemzustand", () => {
  const lz = baumLaufzeit();
  const C = commandCenter(lz);
  // useState: task, phase, plan, ergebnis, fehler, fehlversuch, ausgang
  const t = text(lz.rendere(C.__intern.Auftragszeile, {}, ["x", "bereit", null, null, "HTTP 502: Plan abgeschnitten", FEHLSCHLAG, null]));
  assert.ok(t.includes("HTTP 502: Plan abgeschnitten"));
  assert.ok(t.includes("Kosten des Fehlversuchs: $0,1224 (geschätzt)"), t);
  assert.ok(t.includes("Modell claude-sonnet-5") && t.includes("stop_reason max_tokens"));
  assert.ok(t.includes("Fehllauf nicht gespeichert: permission denied"));
  assert.ok(t.includes(hooksStatus.FEHLVERSUCH_KOSTEN_FEHLEN));
});

// Gegencheck 06.11.2026 (B24): Nach dem Ausführen liest das Command Center das Register neu.
test("Command Center: nach 'Genau diesen Plan ausführen' wird onAusgefuehrt aufgerufen (Register neu lesen)", async () => {
  const lz = baumLaufzeit();
  const C = commandCenter(lz);
  const planOk = { ...PLAN, protokoll_fehler: null };
  let aufgerufen = 0;
  const vorher = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ fehler: "x" }), { status: 400 });
  try {
    const baum = lz.rendere(C.__intern.Auftragszeile, { onAusgefuehrt: () => (aufgerufen += 1) }, ["x", "bereit", planOk, null, null, null, null]);
    const knopf = finde(baum, (k) => k.type === "button" && text(k) === "Genau diesen Plan ausführen")[0];
    assert.ok(knopf, "Ausführen-Knopf");
    knopf.props.onClick();
    // Der Knopf ruft planAusfuehren ohne Rückgabe auf: auf den Abschluss warten.
    for (let i = 0; i < 20 && aufgerufen === 0; i += 1) await new Promise((fertig) => setImmediate(fertig));
    assert.equal(aufgerufen, 1);
  } finally {
    globalThis.fetch = vorher;
  }
});

test("Command Center: Plan ohne gespeicherte Plan-Zeile — Präfix nur einmal, Planungskosten fehlen im Systemzustand", () => {
  const lz = baumLaufzeit();
  const C = commandCenter(lz);
  const t = text(lz.rendere(C.__intern.Auftragszeile, {}, ["x", "bereit", PLAN, null, null, null, null]));
  assert.ok(t.includes("Plan nicht gespeichert: kein Server-Secret für die Plan-Signatur — Ausführen gesperrt."));
  assert.ok(!t.includes("Plan nicht gespeichert: Plan nicht gespeichert"));
  assert.ok(t.includes(hooksStatus.PLANUNG_KOSTEN_FEHLEN));
});

test("/donna: gescheiterte Planung zeigt protokoll_fehler und Hinweis; Plan ohne Plan-Zeile nennt die fehlenden Kosten", () => {
  const lz = baumLaufzeit();
  const D = ladeTsx("app/donna/page.tsx", {
    ...lz.attrappen,
    "next/link": { __esModule: true, default: Link },
    "@/lib/auftrag-types": auftragTypes,
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": hooksStatus,
  });
  const fehler = { text: "Plan abgeschnitten (HTTP 502)", planung: FEHLSCHLAG.planung, protokoll: FEHLSCHLAG.protokollFehler, kostenHinweis: FEHLSCHLAG.kostenHinweis };
  // useState: task, phase, plan, ausfuehrung, fehler, gesperrt, historie
  const t = text(lz.rendere(D.default, {}, ["", "bereit", null, null, fehler, null, []]));
  assert.ok(t.includes("Kosten des Fehlversuchs"));
  assert.ok(t.includes("Fehllauf nicht gespeichert: permission denied"));
  assert.ok(t.includes(hooksStatus.FEHLVERSUCH_KOSTEN_FEHLEN));
  const mitPlan = text(lz.rendere(D.default, {}, ["", "bereit", PLAN, null, null, null, []]));
  assert.ok(mitPlan.includes(hooksStatus.PLANUNG_KOSTEN_FEHLEN));
});
