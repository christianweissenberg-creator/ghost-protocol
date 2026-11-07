// Tests des Gegenchecks (06.11.2026) nach der Browser-Nachprüfung. Lauf: npm test.
// Ein unabhängiger Prüflauf fand weitere Stellen, an denen die Anzeige eine Ursache behauptet,
// die nicht gemessen ist. Hier die Teile ohne eigenes Zuhause in den übrigen Testdateien:
// - /api/status: fehlender Service-Schlüssel bzw. fehlendes Export-Token heißt "nicht_gemessen"
//   (nicht abgefragt) statt "fehler"; vorher zeigte die TopBar dafür rot "OFFLINE".
// - TopBar: "OFFLINE" nur ohne jede Antwort; hat der Server geantwortet, "NICHT LESBAR".
// - Systemzustand: hängende und gescheiterte Pipeline-Läufe (SystemStatus.freigabe) sichtbar.
// - /metrics: Kostenkachel bei 401 "nicht angemeldet".
// Kein Netz: fetch ist eine Attrappe, die jeden Abruf zählt und ablehnt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { React, jsxRuntime, ladeTsx, renderToStaticMarkup } from "./harness/tsx.mjs";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

// Testwerte dieses Prozesses; Service-Schlüssel und Export-Token fehlen absichtlich.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key-0000000000",
});
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.IMMONEXUS_EXPORT_TOKEN;

const types = await import("../src/lib/types.ts");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const kosten = await import("../src/lib/kosten.ts");
const statusRoute = await import(pathToFileURL(process.env.G_ROUTE_STATUS ?? path.join(SITE, "src/app/api/status/route.ts")).href);

const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
const ZEIT = "2026-11-06T12:00:00Z";
const mw = (wert, status = "ok", hinweis) => ({ wert, status, quelle: "Test", gemessen_am: status === "nicht_gemessen" ? null : ZEIT, ...(hinweis ? { hinweis } : {}) });

// ═══ /api/status ohne Schlüssel ═══

test("G-S1 /api/status ohne Service-Schlüssel und Export-Token: 'nicht_gemessen' mit Grund, kein einziger Abruf", async () => {
  const abrufe = [];
  const vorher = globalThis.fetch;
  globalThis.fetch = async (url) => {
    abrufe.push(String(url));
    throw new Error("Test: kein Abruf erwartet");
  };
  const fehler = console.error;
  console.error = () => {};
  try {
    const res = await statusRoute.GET();
    assert.equal(res.status, 200);
    const s = await res.json();
    for (const feld of ["supabase", "agenten", "bus", "letzte_aktivierung", "aktive_agenten_24h", "content_heute", "freigabe", "kosten"]) {
      assert.equal(s[feld].status, "nicht_gemessen", feld);
      assert.equal(s[feld].wert, null, feld);
      assert.equal(s[feld].gemessen_am, null, `${feld}: nicht gemessen heißt ohne Messzeit`);
      assert.equal(s[feld].hinweis, "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt — nicht abgefragt", feld);
    }
    assert.equal(s.steinadel_export.status, "nicht_gemessen");
    assert.equal(s.steinadel_export.gemessen_am, null, "nicht gemessen heißt ohne Messzeit");
    assert.equal(s.steinadel_export.wert, null);
    assert.equal(s.steinadel_export.hinweis, "Export-Token (Server-Umgebung) nicht gesetzt — nicht abgefragt");
    assert.deepEqual(abrufe, [], "weder Supabase noch Export abgefragt");
    assert.doesNotMatch(JSON.stringify(s), /SUPABASE_SERVICE_KEY|EXPORT_TOKEN/);
  } finally {
    globalThis.fetch = vorher;
    console.error = fehler;
  }
});

// ═══ TopBar: LIVE-Pille ═══

function topBar() {
  return ladeTsx(
    "components/layout/TopBar.tsx",
    {
      ...ECHT,
      "next/navigation": { usePathname: () => "/" },
      "@/lib/freigabe-regeln": regeln,
      "@/lib/hooks-status": hooksStatus,
      "@/lib/types": types,
    },
    ["livePille"]
  ).__intern;
}

const lesung = (teil) => ({ status: null, fehler: null, loading: false, geladenAm: null, httpStatus: null, neuLaden: async () => {}, ...teil });

test("G-T1 TopBar: 'OFFLINE' nur ohne Antwort; Server antwortete → 'NICHT LESBAR' (bernstein); 401 bleibt", () => {
  const { livePille } = topBar();
  const jetzt = Date.parse(ZEIT);
  const ohneAntwort = livePille(lesung({ fehler: "Server nicht erreichbar (Failed to fetch)", httpStatus: null }), jetzt);
  assert.equal(ohneAntwort.text, "OFFLINE");
  assert.equal(ohneAntwort.farbe, "var(--gp-rose)");
  for (const httpStatus of [500, 200, 404]) {
    const p = livePille(lesung({ fehler: `HTTP ${httpStatus}: Antwort ist kein lesbares JSON-Objekt`, httpStatus }), jetzt);
    assert.equal(p.text, "NICHT LESBAR", String(httpStatus));
    assert.equal(p.farbe, "var(--gp-amber)", String(httpStatus));
    assert.match(p.title, new RegExp(`Der Server antwortete \\(HTTP ${httpStatus}\\)`));
  }
  // Prüflauf 06.11.2026: 502/503/504 stammen vom Proxy davor — der Dashboard-Server antwortete nicht.
  for (const httpStatus of [502, 503, 504]) {
    const p = livePille(lesung({ fehler: `HTTP ${httpStatus}`, httpStatus }), jetzt);
    assert.equal(p.text, "OFFLINE", String(httpStatus));
    assert.equal(p.farbe, "var(--gp-rose)", String(httpStatus));
    assert.match(p.title, new RegExp(`Proxy meldet HTTP ${httpStatus}`));
    assert.doesNotMatch(p.title, /Der Server antwortete/);
  }
  assert.equal(livePille(lesung({ fehler: "Nicht angemeldet (HTTP 401)", httpStatus: 401 }), jetzt).text, "NICHT ANGEMELDET");
});

test("G-T2 TopBar: fehlender Service-Schlüssel (nicht gemessen) ist 'UNGEMESSEN', nicht rot 'OFFLINE'", () => {
  const { livePille } = topBar();
  const status = {
    erzeugt_am: ZEIT,
    supabase: mw(null, "nicht_gemessen", "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt — nicht abgefragt"),
  };
  const p = livePille(lesung({ status, geladenAm: ZEIT, httpStatus: 200 }), Date.parse(ZEIT));
  assert.equal(p.text, "UNGEMESSEN");
  assert.equal(p.farbe, "var(--gp-amber)");
  assert.match(p.title, /Service-Schlüssel \(Server-Umgebung\) nicht gesetzt/);
  // Ein gemessener Ausfall bleibt rot.
  const ausfall = livePille(lesung({ status: { erzeugt_am: ZEIT, supabase: mw(null, "fehler", "fetch failed") }, geladenAm: ZEIT, httpStatus: 200 }), Date.parse(ZEIT));
  assert.equal(ausfall.text, "OFFLINE");
});

// ═══ Systemzustand: hängende und gescheiterte Läufe ═══

function systemzustandHtml(status) {
  const P = ladeTsx("components/ui/CommandPanels.tsx", {
    ...ECHT,
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
    "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }) },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": hooksStatus,
    "@/lib/types": types,
  });
  return ent(
    renderToStaticMarkup(
      React.createElement(P.SystemzustandPanel, { lesung: lesung({ status, geladenAm: ZEIT, httpStatus: 200 }) })
    )
  );
}

test("G-P1 Systemzustand: Zeile 'Pipeline' zeigt hängende und gescheiterte Läufe aus /api/status", () => {
  const html = systemzustandHtml({
    erzeugt_am: ZEIT,
    freigabe: mw({ wartend: 3, haengend: 2, fehler_7_tage: 1 }, "warnung"),
  });
  assert.ok(html.includes("Pipeline"), html.slice(0, 600));
  assert.ok(html.includes("2 hängend · 1 Fehler (7 T)"));
  assert.ok(html.includes("Wartend auf Freigabe: 3"), "wartend steht im Titel");
  // Prüflauf 06.11.2026: dieselbe Definition wie der Erzeuger (updated_at, nicht created_at).
  assert.ok(html.includes("hängend = Entwurf oder COUNSEL-geprüft, seit mehr als 2 h ohne Änderung"));
  const ohne = systemzustandHtml({ erzeugt_am: ZEIT, freigabe: mw(null, "nicht_gemessen", "nicht abgefragt") });
  assert.ok(ohne.includes("Pipeline"));
  assert.ok(!ohne.includes("hängend ·"), "ohne Messung keine Zahl");
});

// ═══ /metrics: Kostenkachel bei 401 ═══

test("G-M1 kostenMonatAnzeige: 401 heißt 'nicht angemeldet', andere Fehler 'nicht lesbar'", () => {
  const k401 = types.kostenMonatAnzeige(null, "Nicht angemeldet (HTTP 401)", false, 401);
  assert.equal(k401.wert, "nicht angemeldet");
  assert.match(k401.titel, /HTTP 401/);
  assert.equal(types.kostenMonatAnzeige(null, "HTTP 500", false, 500).wert, "nicht lesbar");
  assert.equal(types.kostenMonatAnzeige(null, "HTTP 500", false).wert, "nicht lesbar");
});

// ═══ /login: nur 401 heißt "Falsches Passwort" (B12/B25) ═══

const loginRoute = await import(pathToFileURL(path.join(SITE, "src/app/api/auth/login/route.ts")).href);
const { NextRequest } = await import("next/server");

test("G-L1 /login: Text je Status; die 500 der echten Route (ohne Konfiguration) heißt nicht 'Falsches Passwort'", async () => {
  const { loginFehlerText } = ladeTsx("app/login/page.tsx", ECHT, ["loginFehlerText"]).__intern;
  assert.equal(loginFehlerText(401, { error: "Falsches Passwort" }), "Falsches Passwort");
  assert.equal(loginFehlerText(429, null), "Zu viele Fehlversuche. Bitte einige Minuten warten.");
  assert.equal(loginFehlerText(400, { error: "Ungültige Anfrage" }), "Anmeldung nicht möglich (HTTP 400): Ungültige Anfrage");
  assert.equal(loginFehlerText(502, null), "Anmeldung nicht möglich (HTTP 502) — das Passwort wurde nicht geprüft.");
  // Erzeuger → Leser: die echte Route ohne GP_ACCESS_PASSWORD (in diesem Prozess nicht gesetzt).
  delete process.env.GP_ACCESS_PASSWORD;
  const res = await loginRoute.POST(
    new NextRequest("http://harness.local/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "egal" }),
    })
  );
  assert.equal(res.status, 500);
  const text = loginFehlerText(res.status, await res.json());
  assert.match(text, /^Anmeldung nicht möglich \(HTTP 500\): Auth nicht konfiguriert/);
  assert.doesNotMatch(text, /Falsches Passwort/);
});

// ═══ /messages: Fehlläufe, Metadaten als JSON-Text, Lesefehler des Registers (B13/B19/B32) ═══

function messagesSeite(lz, { messages = [], agents = [], agentsError = null } = {}) {
  const gefangen = {};
  const M = ladeTsx("app/messages/page.tsx", {
    ...lz.attrappen,
    "@/lib/hooks": {
      useMessages: () => ({ messages, loading: false, error: null, realtime: "SUBSCRIBED", realtimeFehler: null }),
      useAgents: () => ({ agents, ausgeblendet: 0, loading: false, error: agentsError }),
    },
    "@/lib/hooks-status": { useSystemStatus: () => lesung({}) },
    "@/components/ui/CommandPanel": {
      CommandPanel: (p) => {
        gefangen.panel = p;
        return null;
      },
    },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/kosten": kosten,
    "@/lib/types": types,
  });
  return { M, gefangen };
}

const nachricht = (id, teil = {}) => ({
  id,
  from_agent: "oracle",
  to_agents: ["donna"],
  to_channels: [],
  message_type: "response",
  priority: "normal",
  content: { text: `Antwort ${id}` },
  metadata: {},
  created_at: ZEIT,
  timestamp: ZEIT,
  ...teil,
});

test("G-N1 /messages: Fehllauf zählt nicht als Antwort und trägt das Etikett 'Fehllauf'", async () => {
  const { baumLaufzeit, text, finde } = await import("./harness/tsx.mjs");
  const lz = baumLaufzeit();
  const { M } = messagesSeite(lz, {
    messages: [nachricht("a"), nachricht("f", { metadata: { source: "fehllauf", art: "aktivierung", cost_usd: 0.01 } })],
  });
  const baum = lz.rendere(M.default, {}, []);
  const knopf = finde(baum, (k) => k.type === "button" && text(k).startsWith("Antwort"))[0];
  assert.equal(text(knopf), "Antwort1", "nur die echte Antwort zählt");
  const t = text(baum);
  assert.ok(t.includes("1 Fehllauf (bezahlt, ohne verwertbare Antwort) nicht als Antwort gezählt"), t.slice(0, 600));
  // Etiketten der Liste (font-mono); seit der Tor-Prüfung (F5) heißt auch ein Zähler "Fehllauf".
  const etiketten = finde(
    baum,
    (k) => k.type === "span" && /font-mono/.test(String(k.props.className ?? "")) && (text(k) === "Fehllauf" || text(k) === "response"),
  );
  assert.deepEqual(etiketten.map(text).sort(), ["Fehllauf", "response"]);
});

test("G-N2 /messages: metadata und content als JSON-Text (Python) erscheinen als Felder, nicht als Zeichen-Chips", async () => {
  const { baumLaufzeit, text, finde } = await import("./harness/tsx.mjs");
  const lz = baumLaufzeit();
  const { M } = messagesSeite(lz, {
    messages: [nachricht("p", { content: '{"text":"Hallo"}', metadata: '{"source":"base_agent","run":7}' })],
  });
  const baum = lz.rendere(M.default, {}, []);
  const chips = finde(baum, (k) => k.type === "span" && /break-all/.test(String(k.props.className ?? ""))).map(text);
  assert.deepEqual(chips, ["source: base_agent", "run: 7"]);
  assert.ok(text(baum).includes("Hallo"));
  assert.ok(!text(baum).includes('{"text":"Hallo"}'));
  // Text, der kein JSON-Objekt ist, bleibt ein einziger Eintrag.
  assert.deepEqual(types.metadatenEintraege("frei"), [["metadata", "frei"]]);
  assert.deepEqual(types.metadatenEintraege("[1,2]"), [["metadata", "[1,2]"]]);
  assert.deepEqual(types.metadatenEintraege(null), []);
  assert.equal(types.istFehllaufNachricht({ metadata: '{"source":"fehllauf"}' }), true);
});

test("G-N3 /messages: Lesefehler des Registers sichtbar und im CommandPanel statt 'Keine Agenten geladen'", async () => {
  const { baumLaufzeit, text } = await import("./harness/tsx.mjs");
  const lz = baumLaufzeit();
  const { M, gefangen } = messagesSeite(lz, { agentsError: "TypeError: Failed to fetch" });
  const t = text(lz.rendere(M.default, {}, []));
  assert.ok(t.includes("Agenten nicht lesbar"));
  assert.equal(gefangen.panel.agentsFehler, "TypeError: Failed to fetch");
  const P = ladeTsx("components/ui/CommandPanel.tsx", {
    ...ECHT,
    "@/lib/hooks": { anzeigeFehler: (e) => regeln.maskiereGeschuetzteNamen(String(e)) },
  });
  const html = ent(renderToStaticMarkup(React.createElement(P.CommandPanel, { agents: [], agentsFehler: "TypeError: Failed to fetch" })));
  assert.ok(html.includes("Agenten-Register nicht lesbar: TypeError: Failed to fetch — Senden gesperrt"));
  assert.ok(!html.includes("Keine Agenten geladen"));
  const leerHtml = ent(renderToStaticMarkup(React.createElement(P.CommandPanel, { agents: [] })));
  assert.ok(leerHtml.includes("Keine Agenten geladen — Senden gesperrt"));
});

// ═══ /donna: Browser-Speicher je Schlüssel, nicht lesbare Historie bleibt stehen (B33) ═══

/** Hook-Laufzeit mit Zustand je Aufrufreihenfolge; Effekte laufen einmal auf Abruf. */
function effektLaufzeit() {
  const z = { slots: [], index: 0, effekte: [] };
  const Fragment = Symbol("Fragment");
  const jsx = (type, props, key) => ({ $el: true, type, props: props ?? {}, key });
  const react = {
    Fragment,
    Suspense: ({ children }) => children,
    useState(start) {
      const i = z.index++;
      if (!(i in z.slots)) z.slots[i] = typeof start === "function" ? start() : start;
      return [z.slots[i], (v) => (z.slots[i] = typeof v === "function" ? v(z.slots[i]) : v)];
    },
    useEffect(fn) {
      const i = z.index++;
      if (!(i in z.slots)) {
        z.slots[i] = true;
        z.effekte.push(fn);
      }
    },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (start) => ({ current: start }),
  };
  function aufloesen(k) {
    if (k === null || k === undefined || typeof k === "boolean") return null;
    if (Array.isArray(k)) return k.map(aufloesen);
    if (typeof k !== "object" || !k.$el) return k;
    if (k.type === Fragment) return aufloesen(k.props.children);
    if (typeof k.type === "function") return aufloesen(k.type(k.props));
    return { type: k.type, props: k.props, kinder: aufloesen(k.props.children) };
  }
  return {
    attrappen: { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment } },
    rendere(K) {
      z.index = 0;
      return aufloesen(jsx(K, {}));
    },
    effekte() {
      for (const e of z.effekte.splice(0)) e();
    },
  };
}

function speicherAttrappe(start) {
  const daten = new Map(Object.entries(start));
  return {
    daten,
    getItem: (k) => (daten.has(k) ? daten.get(k) : null),
    setItem: (k, v) => daten.set(k, String(v)),
    removeItem: (k) => daten.delete(k),
  };
}

const auftragTypes = await import("../src/lib/auftrag-types.ts");

function donnaSeite(lz) {
  return ladeTsx("app/donna/page.tsx", {
    ...lz.attrappen,
    "next/link": { __esModule: true, default: ({ href, children }) => React.createElement("a", { href }, children) },
    "@/lib/auftrag-types": auftragTypes,
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": hooksStatus,
  });
}

const HISTORIE = [{ auftrag_id: "h-1", original_task: "Alter Auftrag", schritte: 1, erfolgreich: 1, vollstaendig: 1, kosten_usd_geschaetzt: 0.01, ohne_kosten: 0, ausgefuehrt_am: ZEIT }];
const PLAN_OK = {
  mode: "plan",
  auftrag_id: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
  original_task: "Neuer Auftrag",
  delegation_plan: { agents: [{ id: "oracle", task: "x", priority: 1 }], reasoning: "r" },
  planung: { modell: "claude-sonnet-5", input_tokens: 10, output_tokens: 10, kosten_usd_geschaetzt: 0.001, stop_reason: "end_turn" },
  erstellt_am: ZEIT,
};

test("G-D1 /donna: kaputter gespeicherter Auftrag verdeckt die Historie nicht mehr", async () => {
  const { text } = await import("./harness/tsx.mjs");
  const vorher = globalThis.localStorage;
  globalThis.localStorage = speicherAttrappe({ "gp-lisa-auftrag": "{kaputt", "gp-donna-history": JSON.stringify(HISTORIE) });
  try {
    const lz = effektLaufzeit();
    const D = donnaSeite(lz);
    lz.rendere(D.default);
    lz.effekte();
    const t = text(lz.rendere(D.default));
    assert.ok(t.includes("Letzte Ausführungen"), t.slice(0, 800));
    assert.ok(t.includes("Alter Auftrag"));
    assert.ok(t.includes("Gespeicherter Auftrag in diesem Browser nicht lesbar"));
  } finally {
    globalThis.localStorage = vorher;
  }
});

test("G-D2 /donna: nicht lesbare Historie wird sichtbar und beim Ausführen nicht überschrieben; verwerfen löscht sie", async () => {
  const { text, finde } = await import("./harness/tsx.mjs");
  const vorherSpeicher = globalThis.localStorage;
  const vorherFetch = globalThis.fetch;
  const speicher = speicherAttrappe({ "gp-lisa-auftrag": JSON.stringify({ plan: PLAN_OK, ausfuehrung: null }), "gp-donna-history": "[{kaputt" });
  globalThis.localStorage = speicher;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/donna/delegate");
    assert.deepEqual(JSON.parse(init.body), { auftrag_id: PLAN_OK.auftrag_id, ausfuehren: true });
    return new Response(
      JSON.stringify({
        mode: "ausgefuehrt",
        auftrag_id: PLAN_OK.auftrag_id,
        original_task: "Neuer Auftrag",
        // results ist eine Liste (istAusfuehrung) — sonst nähme die Seite die Antwort nicht an und
        // der Schreibpfad liefe gar nicht (so überlebte die Mutante F7 im ersten Lauf).
        results: [],
        summary: { total_cost_usd_geschaetzt: null },
        hinweis: "h",
      }),
      { status: 200 }
    );
  };
  try {
    const lz = effektLaufzeit();
    const D = donnaSeite(lz);
    lz.rendere(D.default);
    lz.effekte();
    let baum = lz.rendere(D.default);
    assert.ok(text(baum).includes("gespeicherte Historie in diesem Browser nicht lesbar"), text(baum).slice(0, 800));
    const ausfuehren = finde(baum, (k) => k.type === "button" && text(k) === "Genau diesen Plan ausführen")[0];
    assert.ok(ausfuehren, "Ausführen-Knopf");
    await ausfuehren.props.onClick();
    baum = lz.rendere(D.default);
    // Die Ausführung wurde angenommen: Der aktuelle Auftrag ist mit Ergebnis gespeichert …
    assert.match(String(speicher.daten.get("gp-lisa-auftrag")), /"mode":"ausgefuehrt"/, "Ausführung angenommen");
    // … die nicht lesbare Historie aber nicht überschrieben.
    assert.equal(speicher.daten.get("gp-donna-history"), "[{kaputt", "gespeicherte Historie nicht überschrieben");
    assert.ok(text(baum).includes("Letzte Ausführungen"), "neuer Eintrag in dieser Sitzung sichtbar");
    const verwerfen = finde(baum, (k) => k.type === "button" && text(k) === "Gespeicherte Historie verwerfen")[0];
    verwerfen.props.onClick();
    assert.equal(speicher.daten.has("gp-donna-history"), false);
  } finally {
    globalThis.localStorage = vorherSpeicher;
    globalThis.fetch = vorherFetch;
  }
});

// ═══ Agenten-Register: Neulesen im Takt (B24) ═══

test("G-A1 useAgents und useAgentDetail lesen alle 60 s neu; Aufräumen stoppt den Takt", async () => {
  const lesungen = [];
  const kette = (tabelle) => {
    const k = {
      select: () => k,
      order: () => k,
      eq: () => k,
      or: () => k,
      limit: () => k,
      maybeSingle: () => k,
      then: (ok, fehl) => {
        lesungen.push(tabelle);
        const data = tabelle === "agents" ? [{ id: "oracle", name: "ORACLE", tier: 1 }] : [];
        return Promise.resolve({ data, error: null }).then(ok, fehl);
      },
    };
    return k;
  };
  const kanal = { on: () => kanal, subscribe: () => kanal };
  const supabase = { from: kette, channel: () => kanal, removeChannel: () => {} };

  const slots = [];
  const effekte = [];
  let index = 0;
  const react = {
    useState(start) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof start === "function" ? start() : start;
      return [slots[i], (v) => (slots[i] = typeof v === "function" ? v(slots[i]) : v)];
    },
    useEffect(fn) {
      index++;
      effekte.push(fn);
    },
    useCallback: (fn) => fn,
    useSyncExternalStore: (_abo, lese) => lese(),
  };
  const H = ladeTsx("lib/hooks.ts", { react, "./supabase": { supabase }, "./freigabe-regeln": regeln, "./types": types });

  const takte = [];
  const gestoppt = [];
  const vorherSet = globalThis.setInterval;
  const vorherClear = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => {
    takte.push({ fn, ms });
    return takte.length;
  };
  globalThis.clearInterval = (id) => gestoppt.push(id);
  try {
    // Außerhalb von React aufgerufen (Attrappen-Laufzeit); neutrale Namen halten die Hook-Regel
    // des Linters aus dem Test heraus.
    const agentenHook = H.useAgents;
    agentenHook();
    const aufraeumen = effekte.splice(0).map((e) => e()).filter((r) => typeof r === "function");
    await new Promise((fertig) => setImmediate(fertig));
    const takt = takte.find((t) => t.ms === 60_000);
    assert.ok(takt, `Takt 60 s gesetzt (gesetzt: ${takte.map((t) => t.ms).join(", ")})`);
    const vorher = lesungen.filter((t) => t === "agents").length;
    takt.fn();
    await new Promise((fertig) => setImmediate(fertig));
    assert.equal(lesungen.filter((t) => t === "agents").length, vorher + 1, "Takt liest das Register erneut");
    for (const f of aufraeumen) f();
    assert.ok(gestoppt.includes(takte.indexOf(takt) + 1), "Aufräumen stoppt den Takt");

    // useAgentDetail: Takt erhöht den Ladezähler (neu lesen).
    slots.length = 0;
    index = 0;
    takte.length = 0;
    const detailHook = H.useAgentDetail;
    detailHook("oracle");
    for (const e of effekte.splice(0)) e();
    assert.ok(takte.some((t) => t.ms === 60_000), "Detailseite liest im selben Takt neu");
  } finally {
    globalThis.setInterval = vorherSet;
    globalThis.clearInterval = vorherClear;
  }
});

test("G-S2 createServiceClient: Zeichen über U+00FF und fehlender Schlüssel sind Konfigurationsfehler (kein Wert in der Meldung)", async () => {
  const sb = await import("../src/lib/supabase.ts");
  const fehler = console.error;
  console.error = () => {};
  try {
    const ZEICHEN =
      "Supabase-Service-Schlüssel (Server-Umgebung) abgelehnt: enthält ein Zeichen, das in keinem HTTP-Header stehen kann (etwa ein Steuerzeichen oder unsichtbares Leerzeichen)";
    const erwartet = new Map([
      [undefined, "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt"],
      ["   ", "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt"],
      [`service-test-key-0123\u200b456789abcdef`, ZEICHEN],
      [`service-test-key-0123${String.fromCharCode(0x01)}456789abcdef`, ZEICHEN],
      [`service-test-key-0123${String.fromCharCode(0x7f)}456789abcdef`, ZEICHEN],
    ]);
    for (const wert of erwartet.keys()) {
      if (wert === undefined) delete process.env.SUPABASE_SERVICE_KEY;
      else process.env.SUPABASE_SERVICE_KEY = wert;
      let geworfen = null;
      try {
        sb.createServiceClient();
      } catch (e) {
        geworfen = e;
      }
      assert.ok(geworfen, JSON.stringify(wert));
      assert.equal(sb.istKonfigurationsFehler(geworfen), true, JSON.stringify(wert));
      assert.equal(geworfen.message, erwartet.get(wert), JSON.stringify(wert));
      assert.ok(!geworfen.message.includes("service-test-key"), "kein Teil des Werts");
    }
    assert.equal(sb.istKonfigurationsFehler(new Error("fetch failed")), false);
  } finally {
    delete process.env.SUPABASE_SERVICE_KEY;
    console.error = fehler;
  }
});

// ═══ Layout: kein waagrechtes Scrollen bei 375 px (Browser-Prüfung 06.11.2026) ═══
// Gemessen im laufenden Dashboard: /content scrollte bei 375 px waagrecht (Scrollbreite 514 statt
// 369), weil die Stufenleiste des Pipeline-Flusses nicht schrumpfen konnte und der Inhaltsbereich
// der Shell (Flex-Element ohne min-w-0) mitwuchs. Nach dem Fix: 8 Seiten × 375/768/1024/1280 px
// ohne Überstand. Diese Tests halten nur die tragenden Klassen fest.

test("G-Y1 Shell: Inhaltsbereich darf schrumpfen (min-w-0)", async () => {
  const { baumLaufzeit, finde } = await import("./harness/tsx.mjs");
  const lz = baumLaufzeit();
  const S = ladeTsx("components/layout/Shell.tsx", {
    ...lz.attrappen,
    "next/navigation": { usePathname: () => "/" },
    "@/components/layout/Sidebar": { Sidebar: () => null },
    "@/components/layout/TopBar": { TopBar: () => null },
    "@/lib/hooks-status": { SystemStatusProvider: ({ children }) => children },
  });
  const baum = lz.rendere(S.Shell, { children: "Inhalt" }, []);
  const bereich = finde(baum, (k) => k.type === "div" && /lg:ml-\[252px\]/.test(String(k.props.className ?? "")))[0];
  assert.ok(bereich, "Inhaltsbereich gefunden");
  assert.match(bereich.props.className, /(^|\s)flex-1(\s|$)/);
  assert.match(bereich.props.className, /(^|\s)min-w-0(\s|$)/);
});

// ═══ Prüflauf 06.11.2026: /donna — gesperrter Speicher, Hinweise zurücknehmen, wieder speichern ═══

test("G-D3 /donna: gesperrter Browser-Speicher heißt 'gesperrt', nicht 'gespeichert, aber nicht lesbar' — kein Verwerfen-Knopf", async () => {
  const { text, finde } = await import("./harness/tsx.mjs");
  const vorher = globalThis.localStorage;
  const gesperrt = () => {
    throw new DOMException("Access is denied for this document.", "SecurityError");
  };
  globalThis.localStorage = { getItem: gesperrt, setItem: gesperrt, removeItem: gesperrt };
  try {
    const lz = effektLaufzeit();
    const D = donnaSeite(lz);
    lz.rendere(D.default);
    lz.effekte();
    const baum = lz.rendere(D.default);
    const t = text(baum);
    assert.ok(t.includes("Browser-Speicher gesperrt (Access is denied for this document.) — Auftrag und Historie werden in diesem Browser nicht gespeichert."), t.slice(0, 600));
    assert.ok(!t.includes("nicht lesbar"), "keine Behauptung über gespeicherte Einträge");
    assert.equal(finde(baum, (k) => k.type === "button" && text(k) === "Gespeicherte Historie verwerfen").length, 0);
  } finally {
    globalThis.localStorage = vorher;
  }
});

test("G-D4 /donna: neuer Plan nimmt den Auftrags-Hinweis zurück; nach 'verwerfen' wird die Historie wieder gespeichert", async () => {
  const { text, finde } = await import("./harness/tsx.mjs");
  const vorherSpeicher = globalThis.localStorage;
  const vorherFetch = globalThis.fetch;
  const speicher = speicherAttrappe({ "gp-lisa-auftrag": "{kaputt", "gp-donna-history": "[{kaputt" });
  globalThis.localStorage = speicher;
  globalThis.fetch = async (_url, init) => {
    const anfrage = JSON.parse(init.body);
    if (anfrage.task) return new Response(JSON.stringify(PLAN_OK), { status: 200 });
    return new Response(
      JSON.stringify({ mode: "ausgefuehrt", auftrag_id: PLAN_OK.auftrag_id, original_task: "Neuer Auftrag", results: [], summary: { total_cost_usd_geschaetzt: null }, hinweis: "h" }),
      { status: 200 }
    );
  };
  const knopf = (baum, beschriftung) => finde(baum, (k) => k.type === "button" && text(k) === beschriftung)[0];
  try {
    const lz = effektLaufzeit();
    const D = donnaSeite(lz);
    lz.rendere(D.default);
    lz.effekte();
    let baum = lz.rendere(D.default);
    assert.ok(text(baum).includes("Gespeicherter Auftrag in diesem Browser nicht lesbar"));
    assert.ok(text(baum).includes("gespeicherte Historie in diesem Browser nicht lesbar"));

    knopf(baum, "Gespeicherte Historie verwerfen").props.onClick();
    baum = lz.rendere(D.default);
    assert.ok(!text(baum).includes("gespeicherte Historie in diesem Browser nicht lesbar"), "Hinweis nach erfolgreichem Löschen weg");

    finde(baum, (k) => k.type === "textarea")[0].props.onChange({ target: { value: "Neuer Auftrag" } });
    baum = lz.rendere(D.default);
    await knopf(baum, "Plan erstellen").props.onClick();
    baum = lz.rendere(D.default);
    assert.ok(!text(baum).includes("Gespeicherter Auftrag in diesem Browser nicht lesbar"), "neuer Auftrag ersetzt den unlesbaren");

    await knopf(baum, "Genau diesen Plan ausführen").props.onClick();
    const gespeichert = JSON.parse(speicher.daten.get("gp-donna-history"));
    assert.equal(gespeichert.length, 1, "Historie nach dem Verwerfen wieder gespeichert");
    assert.equal(gespeichert[0].auftrag_id, PLAN_OK.auftrag_id);
  } finally {
    globalThis.localStorage = vorherSpeicher;
    globalThis.fetch = vorherFetch;
  }
});

// ═══ Prüflauf 06.11.2026: Korrekturen dort prüfen, wo sie ankommen (nicht nur am Helfer) ═══

test("G-X1 /expose: laden() übernimmt die Ursache in die Anzeige (401, fehlendes Token, Netzfehler)", async () => {
  const { text } = await import("./harness/tsx.mjs");
  const faelle = [
    [() => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }), "NICHT ANGEMELDET — Steinadel Export-API", "Fehler: Nicht angemeldet (HTTP 401)"],
    [
      () => new Response(JSON.stringify({ fehler: "Export-Token (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration", objekte: [] }), { status: 500 }),
      "EXPORT NICHT KONFIGURIERT — Steinadel Export-API",
      "Fehler: Export-Token (Server-Umgebung) nicht gesetzt",
    ],
    [
      () => {
        throw new TypeError("Failed to fetch");
      },
      "EXPORT NICHT LESBAR — Steinadel Export-API",
      "Fehler: Failed to fetch",
    ],
  ];
  const vorher = globalThis.fetch;
  try {
    for (const [antwort, kopf, fehlertext] of faelle) {
      globalThis.fetch = async () => antwort();
      const lz = effektLaufzeit();
      const E = ladeTsx("app/expose/page.tsx", { ...lz.attrappen, "@/lib/freigabe-regeln": regeln, "@/lib/hooks-status": hooksStatus });
      lz.rendere(E.default);
      lz.effekte();
      for (let i = 0; i < 10; i += 1) await new Promise((fertig) => setImmediate(fertig));
      const t = text(lz.rendere(E.default));
      assert.ok(t.includes(kopf), t.slice(0, 600));
      assert.ok(t.includes(fehlertext), t.slice(0, 600));
    }
  } finally {
    globalThis.fetch = vorher;
  }
});

test("G-L2 /login: die Seite reicht den echten Status weiter — 500 heißt nicht 'Falsches Passwort'", async () => {
  const { text, finde } = await import("./harness/tsx.mjs");
  const vorher = globalThis.fetch;
  try {
    for (const [status, body, erwartet, verboten] of [
      [500, { error: "Auth nicht konfiguriert (GP_ACCESS_PASSWORD / Session-Secret fehlt)" }, "Anmeldung nicht möglich (HTTP 500): Auth nicht konfiguriert", "Falsches Passwort"],
      [401, { error: "Falsches Passwort" }, "Falsches Passwort", "Anmeldung nicht möglich"],
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
      const lz = effektLaufzeit();
      const L = ladeTsx("app/login/page.tsx", lz.attrappen);
      let baum = lz.rendere(L.default);
      const formular = finde(baum, (k) => k.type === "form")[0];
      assert.ok(formular, "Formular gefunden");
      await formular.props.onSubmit({ preventDefault() {} });
      baum = lz.rendere(L.default);
      const t = text(baum);
      assert.ok(t.includes(erwartet), `${status}: ${t.slice(0, 400)}`);
      assert.ok(!t.includes(verboten), String(status));
    }
  } finally {
    globalThis.fetch = vorher;
  }
});

test("G-A2 useAgentDetail: der 60-s-Takt löst ein Neulesen aus, Aufräumen stoppt ihn", async () => {
  const lesungen = [];
  const kette = (tabelle) => {
    const k = {
      select: () => k,
      order: () => k,
      eq: () => k,
      or: () => k,
      limit: () => k,
      maybeSingle: () => k,
      then: (ok, fehl) => {
        lesungen.push(tabelle);
        const data = tabelle === "agents" ? { id: "oracle", name: "ORACLE", tier: 1 } : [];
        return Promise.resolve({ data, error: null }).then(ok, fehl);
      },
    };
    return k;
  };
  const kanal = { on: () => kanal, subscribe: () => kanal };
  const supabase = { from: kette, channel: () => kanal, removeChannel: () => {} };
  const z = { slots: [], index: 0, offen: [] };
  const gleich = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
  const react = {
    useState(start) {
      const i = z.index++;
      if (!(i in z.slots)) z.slots[i] = { wert: typeof start === "function" ? start() : start };
      const slot = z.slots[i];
      return [slot.wert, (v) => (slot.wert = typeof v === "function" ? v(slot.wert) : v)];
    },
    useEffect(fn, deps) {
      const i = z.index++;
      const alt = z.slots[i];
      if (alt && gleich(alt.deps, deps)) return;
      const slot = { deps, fn, aufraeumen: alt?.aufraeumen };
      z.slots[i] = slot;
      z.offen.push(slot);
    },
    useCallback: (fn) => fn,
    useSyncExternalStore: (_abo, lese) => lese(),
  };
  const H = ladeTsx("lib/hooks.ts", { react, "./supabase": { supabase }, "./freigabe-regeln": regeln, "./types": types });
  const takte = [];
  const gestoppt = [];
  const vorherSet = globalThis.setInterval;
  const vorherClear = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => {
    takte.push({ fn, ms, id: takte.length + 1 });
    return takte.length;
  };
  globalThis.clearInterval = (id) => gestoppt.push(id);
  // Außerhalb von React aufgerufen (Attrappen-Laufzeit); neutraler Name für die Hook-Regel des Linters.
  const detailHook = H.useAgentDetail;
  const rendere = () => {
    z.index = 0;
    detailHook("oracle");
    for (const slot of z.offen.splice(0)) {
      if (typeof slot.aufraeumen === "function") slot.aufraeumen();
      const r = slot.fn();
      slot.aufraeumen = typeof r === "function" ? r : undefined;
    }
  };
  const ruhe = async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((fertig) => setImmediate(fertig));
  };
  try {
    rendere();
    await ruhe();
    const takt = takte.find((t) => t.ms === 60_000);
    assert.ok(takt, "Takt 60 s gesetzt");
    const agentsVorher = lesungen.filter((t) => t === "agents").length;
    assert.ok(agentsVorher >= 1, "erste Lesung");
    takt.fn();
    rendere();
    await ruhe();
    assert.equal(lesungen.filter((t) => t === "agents").length, agentsVorher + 1, "Takt liest Agent und Nachrichten neu");
    // Aufräumen aller Effekte (Seite verlassen): der Takt wird gestoppt.
    for (const slot of z.slots) if (slot && typeof slot.aufraeumen === "function") slot.aufraeumen();
    assert.ok(gestoppt.includes(takt.id), "Aufräumen stoppt den Takt");
  } finally {
    globalThis.setInterval = vorherSet;
    globalThis.clearInterval = vorherClear;
  }
});

test("G-D5 /donna: schlägt das Löschen fehl, bleibt der Hinweis auf die unlesbare Historie stehen", async () => {
  const { text, finde } = await import("./harness/tsx.mjs");
  const vorher = globalThis.localStorage;
  const speicher = speicherAttrappe({ "gp-donna-history": "[{kaputt" });
  speicher.removeItem = () => {
    throw new DOMException("Löschen nicht möglich", "SecurityError");
  };
  globalThis.localStorage = speicher;
  try {
    const lz = effektLaufzeit();
    const D = donnaSeite(lz);
    lz.rendere(D.default);
    lz.effekte();
    let baum = lz.rendere(D.default);
    finde(baum, (k) => k.type === "button" && text(k) === "Gespeicherte Historie verwerfen")[0].props.onClick();
    baum = lz.rendere(D.default);
    assert.ok(text(baum).includes("gespeicherte Historie in diesem Browser nicht lesbar"), "Hinweis bleibt");
    assert.equal(speicher.daten.get("gp-donna-history"), "[{kaputt");
  } finally {
    globalThis.localStorage = vorher;
  }
});

test("G-D6 /donna: scheitert die Planung, ist der unlesbare Auftrag trotzdem entfernt — kein Hinweis mehr darauf", async () => {
  const { text, finde } = await import("./harness/tsx.mjs");
  const vorherSpeicher = globalThis.localStorage;
  const vorherFetch = globalThis.fetch;
  const speicher = speicherAttrappe({ "gp-lisa-auftrag": "{kaputt" });
  globalThis.localStorage = speicher;
  globalThis.fetch = async () => new Response(JSON.stringify({ fehler: "L.I.S.A.-Planung gescheitert: Claude-API-Fehler: HTTP 529" }), { status: 502 });
  try {
    const lz = effektLaufzeit();
    const D = donnaSeite(lz);
    lz.rendere(D.default);
    lz.effekte();
    let baum = lz.rendere(D.default);
    assert.ok(text(baum).includes("Gespeicherter Auftrag in diesem Browser nicht lesbar"));
    finde(baum, (k) => k.type === "textarea")[0].props.onChange({ target: { value: "Neuer Auftrag" } });
    baum = lz.rendere(D.default);
    await finde(baum, (k) => k.type === "button" && text(k) === "Plan erstellen")[0].props.onClick();
    baum = lz.rendere(D.default);
    assert.equal(speicher.daten.has("gp-lisa-auftrag"), false, "unlesbarer Auftrag entfernt");
    assert.ok(!text(baum).includes("Gespeicherter Auftrag in diesem Browser nicht lesbar"), "Hinweis passt nicht mehr und ist weg");
    assert.ok(text(baum).includes("L.I.S.A.-Planung gescheitert"), "Fehler der Planung sichtbar");
  } finally {
    globalThis.localStorage = vorherSpeicher;
    globalThis.fetch = vorherFetch;
  }
});
