// Fake-Welt der Routen-Harness (tests/z-routen.test.mjs). Herkunft: Scratchpad-Harness der
// Gruppe A (fix-A/fake.mjs, Fixrunde 06.11.2026), ins Repo übernommen in der Gesamtprüfung
// 06.11.2026, damit "npm test" die tragenden Zeilen der Routen absichert (vorher lag die
// Verhaltens-Harness nur im Scratchpad). Kein Netz: jeder fetch wird hier beantwortet oder wirft.
// Nachgebaut sind nur die Teile, die die Routen benutzen:
// - PostgREST (Supabase REST): GET/POST/PATCH auf jeder Tabelle mit eq/is/in/lt/gt/or,
//   JSON-Pfade (metadata->>x), order, limit, select, Accept vnd.pgrst.object (single), Prefer
//   return=representation; POST mit vorhandener id → 409 (23505). content hat die
//   Postgres-Standardwerte und updated_at mit Mikrosekunden; optional der BEFORE-UPDATE-Trigger
//   aus scripts/setup_supabase_v2.sql:339-342.
// - /api/agents/activate (bezahlter Aufruf, gezählt), /api/objekte (Export-Proxy),
//   /api/content/pipeline (für auto-produce: echtes Modul im Prozess oder Skript).

export const SUPABASE_HOST = "supabase.test";
export const SITE_HOST = "harness.local";

export const welt = neueWelt();

function neueWelt() {
  return {
    content: [],
    /** Weitere Tabellen (messages, agents, metrics …): Name → Zeilen. */
    tabellen: {},
    naechsteId: 100,
    mikro: 0, // Zähler für eindeutige Zeitstempel
    trigger: true,
    log: [],
    aktivierungen: [],
    objektAbrufe: 0,
    agentAntworten: {}, // agent → Array (FIFO) von { status, body } oder Funktion(task) → { status, body }
    objekteAntwort: null, // { status, body } für /api/objekte; null = Standard-Export
    pipelineModul: null, // { GET, POST } für auto-produce
    pipelineAntwort: null, // { GET?: {status, body}, POST?: {status, body} } überschreibt das Modul
    stoerung: null, // (anfrage) => null | { status, body }
    vorAntwort: null, // async (anfrage) => void (z. B. Gleichzeitigkeit)
    activateModul: null, // { POST } der echten activate-Route: dann Ende-zu-Ende statt Attrappe
    activateAntworten: [], // Antworten der echten activate-Route { status, body }
    claude: null, // (anfrage) => { status, body } für api.anthropic.com; null = jeder Aufruf wirft
    claudeAufrufe: 0,
  };
}

export function zuruecksetzen() {
  Object.assign(welt, neueWelt());
}

// ── Zeit ─────────────────────────────────────────────────────────────────────
// Postgres-artige timestamptz-Texte mit Mikrosekunden; Vergleich über Mikrosekunden,
// nicht über Date.parse (das schneidet auf Millisekunden).
export function zeitstempel() {
  welt.mikro += 1;
  const ms = Date.now();
  const iso = new Date(ms).toISOString(); // ...T10:00:00.000Z
  const mikro = String(welt.mikro % 1000).padStart(3, "0");
  return iso.replace(/\.(\d{3})Z$/, (_, m) => `.${m}${mikro}+00:00`);
}

export function mikrosekunden(text) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(String(text));
  if (!m) throw new Error("Zeitwert unlesbar: " + text);
  const basis = Date.parse(m[1] + (m[3] === "Z" ? "Z" : m[3]));
  const bruch = (m[2] ?? "").padEnd(6, "0");
  return basis * 1000 + Number(bruch);
}

function normalisiereZeit(text) {
  const us = mikrosekunden(text);
  const ms = Math.floor(us / 1000);
  const rest = us % 1000;
  const iso = new Date(ms).toISOString().replace("Z", "");
  return `${iso}${String(rest).padStart(3, "0")}+00:00`;
}

// lauf_nachweis (Totmann): GET /api/status ordnet nach eingetragen_am, bei Gleichstand nach id
// (Prüfbefund D1, zweite Prüfung). Als Zeitspalten verglichen über Mikrosekunden wie in Postgres —
// als Text sortiert lägen "…:06.000Z" (Testzeile) und "…:06.000001+00:00" (Attrappe) verkehrt.
const ZEITSPALTEN = new Set(["created_at", "updated_at", "published_at", "begonnen_am", "beendet_am", "eingetragen_am"]);

// ── PostgREST-Filter ─────────────────────────────────────────────────────────
function jsonPfad(zeile, ausdruck) {
  const m = ausdruck.match(/^([a-z_]+)((?:->>?[a-z_0-9]+)*)$/);
  if (!m) throw new Error("Pfad? " + ausdruck);
  let wert = zeile[m[1]];
  const teile = [...m[2].matchAll(/(->>?)([a-z_0-9]+)/g)];
  let alsText = false;
  for (const [, op, key] of teile) {
    if (wert === null || wert === undefined || typeof wert !== "object") {
      wert = null;
      break;
    }
    wert = Array.isArray(wert) && /^\d+$/.test(key) ? wert[Number(key)] : wert[key];
    alsText = op === "->>";
  }
  if (wert === undefined) wert = null;
  if (alsText && wert !== null) wert = typeof wert === "object" ? JSON.stringify(wert) : String(wert);
  return { wert, name: teile.length ? teile[teile.length - 1][2] : m[1] };
}

function vergleich(spalte, a, op, b) {
  if (op === "is") return b === "null" ? a === null || a === undefined : a === (b === "true");
  if (a === null || a === undefined) return false;
  if (ZEITSPALTEN.has(spalte)) {
    a = mikrosekunden(a);
    b = mikrosekunden(b);
  } else if (typeof a === "number") {
    b = Number(b);
  }
  switch (op) {
    case "eq":
      return typeof a === "number" ? a === b : String(a) === String(b);
    case "neq":
      return String(a) !== String(b);
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    default:
      throw new Error("op? " + op);
  }
}

function entquote(v) {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

function teileTopLevel(s) {
  const out = [];
  let tiefe = 0;
  let inQ = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') inQ = !inQ;
    if (!inQ && ch === "(") tiefe++;
    if (!inQ && ch === ")") tiefe--;
    if (!inQ && tiefe === 0 && ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function bedingung(ausdruck) {
  const logik = ausdruck.match(/^(and|or)\((.*)\)$/);
  if (logik) {
    const kinder = teileTopLevel(logik[2]).map(bedingung);
    return logik[1] === "and" ? (z) => kinder.every((k) => k(z)) : (z) => kinder.some((k) => k(z));
  }
  const m = ausdruck.match(/^([a-z_>\-0-9]+)\.(eq|neq|lt|lte|gt|gte|is|in)\.(.*)$/);
  if (!m) throw new Error("Filter? " + ausdruck);
  return einfach(m[1], m[2] + "." + m[3]);
}

function einfach(spalte, ausdruck) {
  const m = ausdruck.match(/^(eq|neq|lt|lte|gt|gte|is|in)\.(.*)$/s);
  if (!m) throw new Error("Filterwert? " + spalte + "=" + ausdruck);
  const [, op, roh] = m;
  if (op === "in") {
    const werte = teileTopLevel(roh.replace(/^\(|\)$/g, "")).map(entquote);
    return (z) => werte.includes(String(jsonPfad(z, spalte).wert));
  }
  const wert = entquote(roh);
  return (z) => vergleich(spalte.replace(/->.*/, ""), jsonPfad(z, spalte).wert, op, wert);
}

const STEUER = new Set(["select", "order", "limit", "offset", "columns"]);

function filtere(zeilen, params) {
  let out = zeilen;
  for (const [k, v] of params) {
    if (STEUER.has(k)) continue;
    if (k === "or") out = out.filter(bedingung("or" + v));
    else if (k === "and") out = out.filter(bedingung("and" + v));
    else out = out.filter(einfach(k, v));
  }
  return out;
}

function projiziere(zeile, select) {
  if (!select || select === "*") return structuredClone(zeile);
  const o = {};
  for (const f of select.split(",").filter(Boolean)) {
    const p = jsonPfad(zeile, f);
    o[p.name] = structuredClone(p.wert);
  }
  return o;
}

function sortiere(zeilen, order) {
  if (!order) return zeilen;
  const kriterien = order.split(",").map((o) => {
    const [s, r] = o.split(".");
    return { s, ab: r === "desc" };
  });
  return [...zeilen].sort((a, b) => {
    for (const { s, ab } of kriterien) {
      let x = a[s];
      let y = b[s];
      if (ZEITSPALTEN.has(s)) {
        x = x == null ? null : mikrosekunden(x);
        y = y == null ? null : mikrosekunden(y);
      }
      if (x === y) continue;
      if (x === null) return ab ? -1 : 1;
      if (y === null) return ab ? 1 : -1;
      return (x < y ? -1 : 1) * (ab ? -1 : 1);
    }
    return 0;
  });
}

function json(status, body, extraHeaders = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function antwortZeilen(zeilen, select, kopf, gesamt = zeilen.length) {
  const daten = zeilen.map((z) => projiziere(z, select));
  if ((kopf.get("accept") ?? "").includes("vnd.pgrst.object")) {
    if (daten.length !== 1) {
      return json(406, {
        code: "PGRST116",
        details: `The result contains ${daten.length} rows`,
        hint: null,
        message: "JSON object requested, multiple (or no) rows returned",
      });
    }
    return json(200, daten[0]);
  }
  const zaehlen = /count=exact/.test(kopf.get("prefer") ?? "");
  const bereich = daten.length ? `0-${daten.length - 1}` : "*";
  return json(200, daten, { "content-range": `${bereich}/${zaehlen ? gesamt : "*"}` });
}

const CONTENT_DEFAULTS = {
  status: "draft",
  body: null,
  platform: null,
  language: "de",
  created_by: null,
  reviewed_by: null,
  review_notes: null,
  published_url: null,
  published_at: null,
  views: 0,
  engagement: 0,
  conversions: 0,
  revenue_usd: 0,
  performance: {},
  metadata: {},
};

/** Zeile direkt anlegen (Testvorbereitung), mit Postgres-Defaults. */
export function legeAn(felder) {
  const id = felder.id ?? welt.naechsteId++;
  if (id >= welt.naechsteId) welt.naechsteId = id + 1;
  const jetzt = zeitstempel();
  const zeile = { ...structuredClone(CONTENT_DEFAULTS), created_at: jetzt, updated_at: jetzt, ...structuredClone(felder), id };
  for (const s of ZEITSPALTEN) if (typeof zeile[s] === "string") zeile[s] = normalisiereZeit(zeile[s]);
  welt.content.push(zeile);
  return zeile;
}

export function zeile(id) {
  return welt.content.find((z) => z.id === id) ?? null;
}

async function supabaseAntwort(url, methode, kopf, body) {
  const tabelle = url.pathname.replace("/rest/v1/", "");
  const anfrage = { art: "supabase", methode, tabelle, url, params: url.searchParams, body };
  welt.log.push({ methode, tabelle, query: decodeURIComponent(url.searchParams.toString()), body });
  if (welt.vorAntwort) await welt.vorAntwort(anfrage);
  if (welt.stoerung) {
    const s = welt.stoerung(anfrage);
    if (s) return json(s.status, s.body);
  }
  const istContent = tabelle === "content";
  const zeilen = istContent ? welt.content : (welt.tabellen[tabelle] ??= []);
  const select = url.searchParams.get("select");
  const order = url.searchParams.get("order");
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : Infinity;

  if (methode === "GET") {
    const alle = filtere(zeilen, url.searchParams);
    const treffer = sortiere(alle, order).slice(0, limit);
    return antwortZeilen(treffer, select, kopf, alle.length);
  }
  if (methode === "POST") {
    const liste = Array.isArray(body) ? body : [body];
    if (!istContent && liste.some((f) => f?.id !== undefined && zeilen.some((z) => z.id === f.id))) {
      return json(409, { code: "23505", details: null, hint: null, message: "duplicate key value violates unique constraint" });
    }
    const neu = liste.map((f) => {
      const jetzt = zeitstempel();
      // lauf_nachweis.eingetragen_am: DEFAULT now(), die DB-Uhr (scripts/lauf_nachweis.sql).
      const standard = tabelle === "lauf_nachweis" ? { eingetragen_am: jetzt } : {};
      const z = istContent
        ? { ...structuredClone(CONTENT_DEFAULTS), created_at: jetzt, updated_at: jetzt, ...structuredClone(f), id: welt.naechsteId++ }
        : { created_at: jetzt, timestamp: jetzt, ...standard, ...structuredClone(f), ...(f?.id === undefined ? { id: welt.naechsteId++ } : {}) };
      zeilen.push(z);
      return z;
    });
    const darstellen = (kopf.get("prefer") ?? "").includes("return=representation");
    return darstellen ? antwortZeilen(neu, select, kopf) : new Response(null, { status: 201 });
  }
  if (methode === "PATCH") {
    const treffer = filtere(zeilen, url.searchParams);
    for (const z of treffer) {
      Object.assign(z, structuredClone(body));
      if (!istContent) continue;
      if (welt.trigger) z.updated_at = zeitstempel();
      else if (typeof z.updated_at === "string") z.updated_at = normalisiereZeit(z.updated_at);
    }
    const darstellen = (kopf.get("prefer") ?? "").includes("return=representation");
    return darstellen ? antwortZeilen(treffer, select, kopf) : new Response(null, { status: 204 });
  }
  throw new Error("Methode? " + methode);
}

// ── Standard-Antworten der Agenten ───────────────────────────────────────────
export const TEXTE = {
  researcher: "Recherche: Fakt 1, Fakt 2.",
  scribe: "SCRIBE-Entwurf: Denkmal-Altbau, Modellrechnung, Visualisierung: KI-generiert.",
  counsel: "Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG",
  publisher: "Finaler Content: Denkmal-Altbau in Leipzig, Exposé anfordern. #Steinadel",
  amplifier: "Distributionsplan: 7 Tage.",
};

export function agentOk(agent, response = TEXTE[agent], extra = {}) {
  return {
    status: 200,
    body: {
      agent_id: agent,
      model: "claude-sonnet-5",
      response,
      usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.0007, latency_ms: 3 },
      stop_reason: "end_turn",
      abgeschnitten: false,
      ...extra,
    },
  };
}

function aktivierung(body) {
  const agent = body?.agent_id;
  welt.aktivierungen.push({ agent, task: body?.task });
  const quelle = welt.agentAntworten[agent];
  if (typeof quelle === "function") return quelle(body.task);
  if (Array.isArray(quelle) && quelle.length > 0) return quelle.shift();
  return agentOk(agent);
}

export const STANDARD_OBJEKT = {
  slug: "villa-x",
  name: "Villa X",
  untertitel: "Gründerzeit",
  tagline: "Ruhig wohnen",
  ort: "Leipzig",
  baujahr: 1905,
  preis: "489.000 €",
  kurzbeschreibung: "Saniertes Denkmal.",
  statusBadge: "Verfügbar",
  afaProzent: 9,
  istDenkmal: true,
  kennzahlen: [{ label: "Wohnfläche", wert: "112 m²" }],
  urls: { objektSeite: "https://steinadel.example/villa-x" },
  kampagnen: [{ kampagne: "herbst", lpUrl: "https://steinadel.example/lp/villa-x", lpVariant: "a" }],
};

function objekteAntwort() {
  welt.objektAbrufe++;
  if (welt.objekteAntwort) return welt.objekteAntwort;
  return { status: 200, body: { version: "1", quelle: "export", generiert_am: "2026-11-06T09:00:00Z", objekte: [structuredClone(STANDARD_OBJEKT)] } };
}

// ── fetch ────────────────────────────────────────────────────────────────────
export function installiere() {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const methode = String(init.method ?? (typeof input === "object" ? input.method : undefined) ?? "GET").toUpperCase();
    const kopf = new Headers(init.headers ?? {});
    const roh = typeof init.body === "string" ? init.body : undefined;
    const body = roh === undefined || roh === "" ? undefined : JSON.parse(roh);

    if (url.hostname === SUPABASE_HOST) return supabaseAntwort(url, methode, kopf, body);
    if (url.hostname === "api.anthropic.com") {
      // Bezahlter Aufruf in echt — hier nur die Attrappe; ohne sie wirft der Aufruf.
      welt.claudeAufrufe += 1;
      if (typeof welt.claude !== "function") throw new Error("Claude-Attrappe nicht gesetzt (kein Netz in der Harness)");
      const a = welt.claude(body);
      return json(a.status, a.body);
    }
    if (url.hostname === SITE_HOST) {
      if (url.pathname === "/api/agents/activate" && methode === "POST") {
        if (welt.vorAntwort) await welt.vorAntwort({ art: "activate", body });
        if (welt.activateModul) {
          welt.aktivierungen.push({ agent: body?.agent_id, task: body?.task });
          const { NextRequest } = await import("next/server");
          const res = await welt.activateModul.POST(new NextRequest(url.href, { method: "POST", headers: kopf, body: roh }));
          const text = await res.text();
          welt.activateAntworten.push({ status: res.status, body: JSON.parse(text) });
          return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
        }
        const a = aktivierung(body);
        return json(a.status, a.body);
      }
      if (url.pathname === "/api/objekte" && methode === "GET") {
        const a = objekteAntwort();
        if (a.wirf) throw a.wirf;
        return json(a.status, a.body);
      }
      if (url.pathname === "/api/content/pipeline") {
        const skript = welt.pipelineAntwort?.[methode];
        if (skript) return json(skript.status, skript.body);
        if (!welt.pipelineModul) throw new Error("Pipeline-Modul fehlt in der Harness");
        if (methode === "GET") return welt.pipelineModul.GET();
        const { NextRequest } = await import("next/server");
        return welt.pipelineModul.POST(new NextRequest(url.href, { method: "POST", headers: kopf, body: roh }));
      }
    }
    throw new Error("Unerwarteter Netzaufruf in der Harness: " + url.href);
  };
}
