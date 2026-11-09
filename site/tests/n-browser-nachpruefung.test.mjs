// Tests der Nachprüfung im Browser (06.11.2026). Lauf: npm test.
// Gefunden im laufenden Dashboard (lokal, Supabase pausiert, ohne Export-Token), nach der
// Fixrunde mit grünen 460 Tests:
// 1. Command Center: Der Message Bus zeigte bei Lesefehler "Neueste 0" und "Noch keine
//    Nachrichten im Bus" — useMessages meldet den Fehler seit R12, die Seite las ihn nicht.
// 2. Lagebild und Steinadel-Panel: Ein fehlendes Export-Token hieß "EXPORT OFFLINE" bzw.
//    "Quelle nicht erreichbar", obwohl der Export gar nicht abgefragt wurde.
// 3. /api/objekte: Eine Fehlerantwort des Exports hieß ebenfalls "quelle_nicht_erreichbar";
//    jetzt "quelle_http_<Status>" bzw. "quelle_antwort_unlesbar", dazu "fehler_art".
// Die Pipeline-Seite des Vertrags steht in z-routen.test.mjs (Z-N*), das Content-Formular in
// e-content-komponenten.test.mjs. Kein Netz: fetch ist je Test eine Attrappe.
// N_ROUTE_OBJEKTE=<pfad> prüft statt der Repo-Route eine Kopie (Mutationstests im Scratchpad).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { React, baumLaufzeit, finde, jsxRuntime, ladeTsx, renderToStaticMarkup, text } from "./harness/tsx.mjs";

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

const types = await import("../src/lib/types.ts");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const auftragTypes = await import("../src/lib/auftrag-types.ts");
const objekteRoute = await import(
  pathToFileURL(process.env.N_ROUTE_OBJEKTE ?? path.join(SITE, "src/app/api/objekte/route.ts")).href
);
// Objekt-Studio Schritt 2: /expose importiert next/link und die Studio-Allow-List.
const studioObjekte = await import("../src/lib/studio/objekte.ts");

const NAME = ["Immo", "Nexus"].join("");
const ENTHAELT_NAMEN = /imm[ou][\s._-]*nexus/i;
const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const leer = () => null;
const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
// Testwert dieses Prozesses (node --test startet je Datei einen eigenen Prozess), kein echtes Token.
const TOKEN_VARIABLE = "IMMONEXUS_EXPORT_TOKEN";
const TEST_TOKEN = "export-test-token-0123456789";

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env[TOKEN_VARIABLE];
});

// ═══ /api/objekte: Ursache je Fehler ═══

async function holeObjekte(upstream) {
  const aufrufe = [];
  globalThis.fetch = async (url, init = {}) => {
    aufrufe.push({ url: String(url), init });
    return upstream();
  };
  const res = await objekteRoute.GET();
  return { status: res.status, body: await res.json(), aufrufe, cache: res.headers.get("cache-control") };
}

test("N-O1 /api/objekte ohne Token: 500, fehler_art konfiguration, kein Abruf, kein Variablenname", async () => {
  const r = await holeObjekte(() => {
    throw new Error("darf nicht abrufen");
  });
  assert.equal(r.status, 500);
  assert.equal(r.body.fehler_art, "konfiguration");
  assert.equal(r.body.fehler, "Export-Token (Server-Umgebung) nicht gesetzt");
  assert.deepEqual(r.body.objekte, []);
  assert.equal(r.aufrufe.length, 0);
  assert.doesNotMatch(JSON.stringify(r.body), /EXPORT_TOKEN/);
  assert.match(String(r.cache), /no-store/);
});

test("N-O2 /api/objekte: Fehlerantwort des Exports heißt quelle_http_<Status>, nicht 'nicht erreichbar'", async () => {
  process.env[TOKEN_VARIABLE] = TEST_TOKEN;
  for (const status of [401, 403, 404, 500, 503]) {
    const r = await holeObjekte(() => new Response(JSON.stringify({ error: "x" }), { status }));
    assert.equal(r.status, 502, String(status));
    assert.equal(r.body.fehler, `quelle_http_${status}`);
    assert.equal(r.body.fehler_art, "quelle_fehler");
    assert.deepEqual(r.body.objekte, []);
  }
});

test("N-O3 /api/objekte: Netzfehler und Zeitlimit heißen nicht_erreichbar; Zeitlimit wird gesetzt", async () => {
  process.env[TOKEN_VARIABLE] = TEST_TOKEN;
  const netz = await holeObjekte(() => {
    throw new TypeError("fetch failed");
  });
  assert.equal(netz.status, 502);
  assert.equal(netz.body.fehler, "quelle_nicht_erreichbar");
  assert.equal(netz.body.fehler_art, "nicht_erreichbar");
  assert.ok(netz.aufrufe[0].init.signal instanceof AbortSignal, "Abruf mit Zeitlimit");
  assert.equal(netz.aufrufe[0].url, "https://steinadel.de/api/objekte/export");
  assert.equal(new Headers(netz.aufrufe[0].init.headers).get("authorization"), `Bearer ${TEST_TOKEN}`);
  // Abbruch beim Lesen des Körpers (Zeitlimit gilt auch dort) ist kein unlesbares JSON.
  const koerper = await holeObjekte(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new DOMException("Zeitlimit", "TimeoutError");
    },
  }));
  assert.equal(koerper.body.fehler, "quelle_nicht_erreichbar");
  assert.equal(koerper.body.fehler_art, "nicht_erreichbar");
});

test("N-O4 /api/objekte: unlesbares JSON heißt quelle_antwort_unlesbar; gültige Antwort geht 1:1 durch", async () => {
  process.env[TOKEN_VARIABLE] = TEST_TOKEN;
  const kaputt = await holeObjekte(() => new Response("<html>kein JSON</html>", { status: 200 }));
  assert.equal(kaputt.status, 502);
  assert.equal(kaputt.body.fehler, "quelle_antwort_unlesbar");
  assert.equal(kaputt.body.fehler_art, "quelle_fehler");
  const daten = { version: "1", quelle: "export", generiert_am: "2026-11-06T09:00:00Z", objekte: [{ slug: "a", name: "A", preis: "1" }] };
  const ok = await holeObjekte(() => new Response(JSON.stringify(daten), { status: 200 }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, daten);
});

// ═══ Gegencheck 06.11.2026: Abbruch, Zeichen im Token, Zeitlimit ═══

test("N-O5 (Gegencheck) /api/objekte: Verbindungsabbruch beim Lesen heißt nicht_erreichbar, nur kaputtes JSON unlesbar", async () => {
  process.env[TOKEN_VARIABLE] = TEST_TOKEN;
  // undici wirft bei abgerissener Verbindung im Körper TypeError "terminated" (gemessen Node 25.3).
  const abriss = await holeObjekte(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new TypeError("terminated", { cause: new Error("other side closed") });
    },
  }));
  assert.equal(abriss.status, 502);
  assert.equal(abriss.body.fehler, "quelle_nicht_erreichbar");
  assert.equal(abriss.body.fehler_art, "nicht_erreichbar");
  const kaputt = await holeObjekte(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  }));
  assert.equal(kaputt.body.fehler, "quelle_antwort_unlesbar");
  assert.equal(kaputt.body.fehler_art, "quelle_fehler");
});

test("N-O6 (Gegencheck) /api/objekte: Token mit Zeichen über U+00FF → 500 konfiguration, kein Abruf, kein Wert", async () => {
  for (const zeichen of ["\u200b", "\u2013", "\u{1F600}", String.fromCharCode(0x01), String.fromCharCode(0x7f)]) {
    process.env[TOKEN_VARIABLE] = `${TEST_TOKEN.slice(0, 12)}${zeichen}${TEST_TOKEN.slice(12)}`;
    const r = await holeObjekte(() => {
      throw new Error("darf nicht abrufen");
    });
    assert.equal(r.status, 500, JSON.stringify(zeichen));
    assert.equal(r.body.fehler_art, "konfiguration");
    assert.match(r.body.fehler, /^Export-Token \(Server-Umgebung\) abgelehnt: /);
    assert.equal(r.aufrufe.length, 0);
    assert.ok(!JSON.stringify(r.body).includes(TEST_TOKEN.slice(0, 12)), "kein Teil des Werts in der Antwort");
  }
  // Latin-1 (ü, U+00FC) ist ein gültiger Header-Wert und geht durch.
  process.env[TOKEN_VARIABLE] = `${TEST_TOKEN}\u00fc`;
  const ok = await holeObjekte(() => new Response(JSON.stringify({ objekte: [] }), { status: 200 }));
  assert.equal(ok.status, 200);
  assert.equal(ok.aufrufe.length, 1);
});

test("N-O7 (Gegencheck) /api/objekte: wirft der Header-Bau trotzdem, antwortet die Route mit fehler_art", async () => {
  process.env[TOKEN_VARIABLE] = TEST_TOKEN;
  const Original = globalThis.Headers;
  globalThis.Headers = class extends Original {
    set(name, wert) {
      if (String(name).toLowerCase() === "authorization") throw new TypeError("Cannot convert argument to a ByteString");
      return super.set(name, wert);
    }
  };
  try {
    const r = await holeObjekte(() => {
      throw new Error("darf nicht abrufen");
    });
    assert.equal(r.status, 500);
    assert.equal(r.body.fehler_art, "konfiguration");
    assert.equal(r.aufrufe.length, 0);
    assert.ok(!JSON.stringify(r.body).includes(TEST_TOKEN));
  } finally {
    globalThis.Headers = Original;
  }
});

test("N-O8 (Gegencheck) /api/objekte: das Zeitlimit bricht einen hängenden Abruf wirklich ab", async () => {
  process.env[TOKEN_VARIABLE] = TEST_TOKEN;
  const original = AbortSignal.timeout;
  const fristen = [];
  // Die Route bekommt ein echtes Zeitlimit-Signal, nur mit 5 ms statt ihrer Frist.
  AbortSignal.timeout = (ms) => {
    fristen.push(ms);
    return original.call(AbortSignal, 5);
  };
  globalThis.fetch = (url, init = {}) =>
    new Promise((erfuellt, verworfen) => {
      // Notbremse: Bricht das Signal nie ab, antwortet der Export nach 1 s — der Test schlägt dann fehl.
      const notbremse = setTimeout(() => erfuellt(new Response(JSON.stringify({ objekte: [] }), { status: 200 })), 1000);
      const abbrechen = () => {
        clearTimeout(notbremse);
        verworfen(init.signal.reason);
      };
      if (init.signal?.aborted) abbrechen();
      else init.signal?.addEventListener("abort", abbrechen, { once: true });
    });
  try {
    const res = await objekteRoute.GET();
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.fehler, "quelle_nicht_erreichbar");
    assert.equal(body.fehler_art, "nicht_erreichbar");
    assert.equal(fristen.length, 1, "ein Zeitlimit je Abruf");
  } finally {
    AbortSignal.timeout = original;
  }
});

// ═══ Gegencheck 06.11.2026 (B14): /expose nennt die Ursache wie Lagebild und Panel ═══

test("N-X1 (Gegencheck) /expose: Fehler der Objektliste mit Ursache statt pauschal 'QUELLE NICHT LESBAR'", () => {
  const E = ladeTsx(
    "app/expose/page.tsx",
    {
      ...ECHT,
      "next/link": { __esModule: true, default: Link },
      "@/lib/freigabe-regeln": regeln,
      "@/lib/hooks-status": hooksStatus,
      "@/lib/studio/objekte": studioObjekte,
    },
    ["werteExportAus", "ExportFehlerKarte"],
  ).__intern;
  const faelle = [
    ["401 der Middleware", 401, { error: "Unauthorized" }, "NICHT ANGEMELDET — Steinadel Export-API", "Nicht angemeldet (HTTP 401)", "--gp-amber"],
    [
      "Token fehlt",
      500,
      { fehler: "Export-Token (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration", objekte: [] },
      "EXPORT NICHT KONFIGURIERT — Steinadel Export-API",
      "Export-Token (Server-Umgebung) nicht gesetzt",
      "--gp-rose",
    ],
    [
      "Fehlerantwort",
      502,
      { fehler: "quelle_http_403", fehler_art: "quelle_fehler", objekte: [] },
      "EXPORT-FEHLER — Steinadel Export-API",
      "Steinadel-Export antwortete mit HTTP 403",
      "--gp-rose",
    ],
    [
      "offline",
      502,
      { fehler: "quelle_nicht_erreichbar", fehler_art: "nicht_erreichbar", objekte: [] },
      "EXPORT OFFLINE — Steinadel Export-API",
      "Steinadel-Export nicht erreichbar",
      "--gp-rose",
    ],
    ["Proxy ohne JSON", 502, null, "EXPORT NICHT LESBAR — Steinadel Export-API", "HTTP 502", "--gp-rose"],
    ["200 ohne Liste", 200, { version: "1" }, "EXPORT NICHT LESBAR — Steinadel Export-API", "Antwort ohne Objektliste", "--gp-rose"],
  ];
  for (const [fall, status, daten, kopf, fehlertext, farbe] of faelle) {
    const l = E.werteExportAus(status, daten);
    assert.equal(l.art, "fehler", fall);
    const html = ent(renderToStaticMarkup(React.createElement(E.ExportFehlerKarte, { fehler: l.fehler })));
    assert.ok(html.includes(kopf), `${fall}: ${html}`);
    assert.ok(html.includes(`Fehler: ${fehlertext}`), `${fall}: ${html}`);
    assert.ok(html.includes(`var(${farbe})`), `${fall}: Farbe`);
    assert.ok(!html.includes("QUELLE NICHT LESBAR"), fall);
  }
  // Nur nicht_erreichbar sagt "offline".
  const konfig = ent(renderToStaticMarkup(React.createElement(E.ExportFehlerKarte, { fehler: E.werteExportAus(500, faelle[1][2]).fehler })));
  assert.doesNotMatch(konfig, /OFFLINE|nicht erreichbar/i);
  const ok = E.werteExportAus(200, { generiert_am: "2026-11-06T09:00:00Z", objekte: [{ slug: "a" }] });
  assert.deepEqual(ok, { art: "erfolg", objekte: [{ slug: "a" }], generiertAm: "2026-11-06T09:00:00Z" });
});

// ═══ Anzeige-Regeln: Ursache → Wortlaut ═══

const { objekteFehlerArt, objekteFehlerAnzeige, objekteLesungAus, objekteLesungFehlerArt, objektFehlerText } = hooksStatus;

test("N-R1 objekteFehlerArt: 401, fehler_art der Route, Codes, Rest unbekannt", () => {
  assert.equal(objekteFehlerArt(null), null);
  assert.equal(objekteFehlerArt(undefined), null);
  assert.equal(objekteFehlerArt("HTTP 401"), "nicht_angemeldet");
  assert.equal(objekteFehlerArt("HTTP 401", "konfiguration"), "nicht_angemeldet", "401 der Middleware geht vor");
  assert.equal(objekteFehlerArt("Export-Token (Server-Umgebung) nicht gesetzt", "konfiguration"), "konfiguration");
  assert.equal(objekteFehlerArt("quelle_nicht_erreichbar", "nicht_erreichbar"), "nicht_erreichbar");
  assert.equal(objekteFehlerArt("quelle_nicht_erreichbar"), "nicht_erreichbar");
  assert.equal(objekteFehlerArt("quelle_http_401"), "quelle_fehler");
  assert.equal(objekteFehlerArt("quelle_antwort_unlesbar"), "quelle_fehler");
  // Gegencheck 06.11.2026: kein Zweig mehr für die Altform mit Variablennamen (vor R23).
  assert.equal(objekteFehlerArt("IMMONEXUS_EXPORT_TOKEN nicht konfiguriert"), "unbekannt");
  for (const f of ["TypeError: Failed to fetch", "HTTP 500", "", "quelle_http_4011", "Export-Token (Server-Umgebung) nicht gesetzt"]) {
    assert.equal(objekteFehlerArt(f), "unbekannt", f);
  }
  // Unbekannte fehler_art-Werte werden nicht übernommen.
  assert.equal(objekteFehlerArt("x", "offline"), "unbekannt");
});

test("N-R2 objektFehlerText: neue Codes als Klartext", () => {
  assert.equal(objektFehlerText("quelle_http_401"), "Steinadel-Export antwortete mit HTTP 401");
  assert.equal(objektFehlerText("quelle_antwort_unlesbar"), "Antwort des Steinadel-Exports nicht lesbar");
  assert.equal(objektFehlerText("Export-Token (Server-Umgebung) nicht gesetzt"), "Export-Token (Server-Umgebung) nicht gesetzt");
  assert.equal(objektFehlerText("quelle_nicht_erreichbar"), "Steinadel-Export nicht erreichbar");
});

test("N-R3 objekteLesungAus/objekteLesungFehlerArt: Ursache durchgereicht, laden und ohne Fehler null", () => {
  const konfig = objekteLesungAus({
    objekte: [],
    loading: false,
    error: "Export-Token (Server-Umgebung) nicht gesetzt",
    fehlerArt: "konfiguration",
  });
  assert.equal(konfig.fehlerArt, "konfiguration");
  assert.equal(objekteLesungFehlerArt(konfig), "konfiguration");
  assert.equal(objekteLesungFehlerArt({ objekte: [], loading: true, error: "x", fehlerArt: "konfiguration" }), null);
  assert.equal(objekteLesungFehlerArt({ objekte: [], loading: false, error: null }), null);
  // Ältere Lesung ohne fehlerArt: 401-Kennzeichen, sonst unbekannt.
  assert.equal(objekteLesungFehlerArt({ objekte: [], loading: false, error: "x", nichtAngemeldet: true }), "nicht_angemeldet");
  assert.equal(objekteLesungFehlerArt({ objekte: [], loading: false, error: "x" }), "unbekannt");
});

test("N-R4 objekteFehlerAnzeige: nur 'nicht erreichbar' heißt offline; Pillen passen in die viewBox", () => {
  const arten = ["nicht_angemeldet", "konfiguration", "nicht_erreichbar", "quelle_fehler", "unbekannt", null, undefined];
  for (const art of arten) {
    const a = objekteFehlerAnzeige(art);
    assert.ok(a.pille.length <= 33, `${art}: ${a.pille} (${a.pille.length} Zeichen)`);
    if (art !== "nicht_erreichbar") {
      assert.doesNotMatch(`${a.kopf} ${a.pille} ${a.panel}`, /OFFLINE|nicht erreichbar/i, String(art));
    }
  }
  assert.equal(objekteFehlerAnzeige("nicht_erreichbar").kopf, "EXPORT OFFLINE");
  assert.equal(objekteFehlerAnzeige("konfiguration").kopf, "EXPORT NICHT KONFIGURIERT");
  assert.equal(objekteFehlerAnzeige("nicht_angemeldet").farbe, "amber");
  assert.equal(objekteFehlerAnzeige("konfiguration").farbe, "rose");
});

// ═══ Lagebild und Steinadel-Panel ═══

function lagebildHtml(lesung) {
  const L = ladeTsx("components/ui/SituationTable.tsx", {
    ...ECHT,
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }) },
    "@/lib/hooks-status": hooksStatus,
  });
  return ent(renderToStaticMarkup(React.createElement(L.SituationTable, { lesung })));
}

const STATUS_LESUNG = { status: null, fehler: null, loading: false, geladenAm: null, httpStatus: null, neuLaden: async () => {} };

function steinadelHtml(objekte) {
  const P = ladeTsx("components/ui/CommandPanels.tsx", {
    ...ECHT,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }) },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": hooksStatus,
    "@/lib/types": types,
  });
  return ent(renderToStaticMarkup(React.createElement(P.SteinadelPanel, { lesung: STATUS_LESUNG, objekte })));
}

const lesungAus = (error, fehlerArt) => objekteLesungAus({ objekte: [], loading: false, error, fehlerArt });

test("N-L1 Lagebild: fehlendes Token heißt 'nicht konfiguriert', nicht 'offline'", () => {
  const html = lagebildHtml(lesungAus("Export-Token (Server-Umgebung) nicht gesetzt", "konfiguration"));
  assert.ok(html.includes("EXPORT NICHT KONFIGURIERT"), html.slice(0, 400));
  assert.ok(html.includes("STEINADEL · EXPORT · OHNE ZUGANG"));
  assert.doesNotMatch(html, /OFFLINE/);
  assert.ok(html.includes("der Export wurde nicht abgefragt"));
  assert.ok(html.includes("Fehler: Export-Token (Server-Umgebung) nicht gesetzt"));
});

test("N-L2 Lagebild: nur ein Netzfehler heißt offline; Fehlerantwort und Unbekanntes nicht", () => {
  assert.ok(lagebildHtml(lesungAus("quelle_nicht_erreichbar", "nicht_erreichbar")).includes("EXPORT OFFLINE"));
  const quelle = lagebildHtml(lesungAus("quelle_http_401", "quelle_fehler"));
  assert.ok(quelle.includes("EXPORT-FEHLER") && quelle.includes("Steinadel-Export antwortete mit HTTP 401"));
  assert.doesNotMatch(quelle, /OFFLINE/);
  const unbekannt = lagebildHtml(lesungAus("TypeError: Failed to fetch", null));
  assert.ok(unbekannt.includes("EXPORT NICHT LESBAR") && unbekannt.includes("STEINADEL · EXPORT · NICHT LESBAR"));
  assert.doesNotMatch(unbekannt, /OFFLINE/);
  const ohneSitzung = lagebildHtml(lesungAus("HTTP 401", null));
  assert.ok(ohneSitzung.includes("NICHT ANGEMELDET") && ohneSitzung.includes("STEINADEL · EXPORT · UNGEMESSEN"));
});

test("N-L3 Steinadel-Panel: Wortlaut je Ursache wie im Lagebild", () => {
  const konfig = steinadelHtml(lesungAus("Export-Token (Server-Umgebung) nicht gesetzt", "konfiguration"));
  assert.ok(konfig.includes("Zugang nicht konfiguriert"));
  assert.doesNotMatch(konfig, /Quelle nicht erreichbar/);
  assert.ok(steinadelHtml(lesungAus("quelle_nicht_erreichbar", "nicht_erreichbar")).includes("Quelle nicht erreichbar"));
  assert.ok(steinadelHtml(lesungAus("quelle_http_500", "quelle_fehler")).includes("Quelle meldet Fehler"));
  const unbekannt = steinadelHtml(lesungAus("TypeError: Failed to fetch", null));
  assert.ok(unbekannt.includes(">nicht lesbar<"), unbekannt.slice(0, 600));
  assert.ok(steinadelHtml(lesungAus("HTTP 401", null)).includes("nicht angemeldet"));
});

// Gegencheck 06.11.2026 (B08): Die Farbe je Ursache war nur an objekteFehlerAnzeige geprüft,
// nicht in den Komponenten — "immer rose" bestand alle Tests.
test("N-L4 (Gegencheck) Lagebild und Panel: 401 bernstein, sonst rose — in der gerenderten Komponente", () => {
  const farbeVor = (html, text) => {
    const i = html.indexOf(text);
    assert.ok(i >= 0, `${text} fehlt`);
    const davor = html.slice(0, i);
    const amber = davor.lastIndexOf("var(--gp-amber)");
    const rose = davor.lastIndexOf("var(--gp-rose)");
    return amber > rose ? "amber" : "rose";
  };
  assert.equal(farbeVor(lagebildHtml(lesungAus("HTTP 401", null)), "NICHT ANGEMELDET"), "amber");
  assert.equal(farbeVor(lagebildHtml(lesungAus("Export-Token (Server-Umgebung) nicht gesetzt", "konfiguration")), "EXPORT NICHT KONFIGURIERT"), "rose");
  assert.equal(farbeVor(steinadelHtml(lesungAus("HTTP 401", null)), "nicht angemeldet"), "amber");
  assert.equal(farbeVor(steinadelHtml(lesungAus("quelle_http_500", "quelle_fehler")), "Quelle meldet Fehler"), "rose");
});

// Das Layout (kein Überstand bei 375–1280 px) ist im Browser gemessen (06.11.2026); dieser Test
// hält nur die Klassen fest, die den Umbruch tragen, damit sie nicht still verschwinden.
test("N-L5 (Gegencheck) Steinadel-Panel: Zeile bricht um, Wert darf schrumpfen und umbrechen", () => {
  const html = steinadelHtml(lesungAus("Export-Token (Server-Umgebung) nicht gesetzt", "konfiguration"));
  assert.ok(html.includes('class="flex flex-wrap items-center gap-x-4 gap-y-1 pb-3"'));
  assert.match(html, /class="ml-auto text-right min-w-0 max-w-full break-words[^"]*"[^>]*>Zugang nicht konfiguriert</);
});

// ═══ Message Bus: Lesefehler ist keine leere Liste ═══

const feedModul = () =>
  ladeTsx("components/ui/MessageFeed.tsx", { ...ECHT, "@/lib/freigabe-regeln": regeln, "@/lib/types": types });

const nachricht = (id, from_agent = "oracle") => ({
  id,
  from_agent,
  to_agents: ["donna"],
  to_channels: [],
  message_type: "response",
  content: `Antwort ${id}`,
  metadata: {},
  timestamp: "2026-11-06T09:00:00Z",
});

test("N-M1 MessageFeed: mit Fehler 'nicht lesbar' statt 'Noch keine Nachrichten', Fehlertext maskiert", () => {
  const F = feedModul();
  const html = ent(renderToStaticMarkup(React.createElement(F.MessageFeed, { messages: [], fehler: `TypeError: Failed to fetch (${NAME})` })));
  assert.ok(html.includes("Nachrichten nicht lesbar: TypeError: Failed to fetch"));
  assert.ok(html.includes("Ohne Lesezugriff ist keine Aussage über den Bus möglich."));
  assert.ok(!html.includes("Noch keine Nachrichten im Bus"));
  assert.doesNotMatch(html, ENTHAELT_NAMEN);
  // Mit Nachrichten trotz Fehler stehen beide.
  const beide = ent(renderToStaticMarkup(React.createElement(F.MessageFeed, { messages: [nachricht("m1")], fehler: "HTTP 500" })));
  assert.ok(beide.includes("Nachrichten nicht lesbar: HTTP 500") && beide.includes("Antwort m1"));
});

test("N-M3 (Gegencheck) MessageFeed: leere Abfrage sagt, was sie lieferte — Gegenprobe und Realtime-Zustand", () => {
  const F = feedModul();
  const feed = (props) => ent(renderToStaticMarkup(React.createElement(F.MessageFeed, { messages: [], ...props })));
  const ohne = feed({});
  assert.ok(ohne.includes("Die Abfrage im Browser lieferte keine Nachrichten."));
  assert.ok(ohne.includes("ob die Tabelle leer ist, ist nicht belegt"));
  assert.ok(!ohne.includes("Noch keine Nachrichten im Bus"));
  const widerspruch = feed({ serverAnzahl: 5, realtime: "SUBSCRIBED" });
  assert.ok(widerspruch.includes("Die Abfrage im Browser lieferte keine Nachrichten, der Server zählt 5."));
  assert.ok(widerspruch.includes("var(--gp-amber)"));
  assert.ok(!widerspruch.includes("veraltet"));
  const getrennt = feed({ serverAnzahl: 5, realtime: "CLOSED" });
  assert.ok(getrennt.includes("Oder die Liste ist veraltet (Realtime getrennt) — Seite neu laden."));
  const null0 = feed({ serverAnzahl: 0, realtime: "CLOSED" });
  assert.ok(null0.includes("Der Server zählt ebenfalls 0 Nachrichten"));
  assert.ok(!null0.includes("veraltet"), "ohne Widerspruch kein Hinweis auf eine veraltete Liste");
});

const SYS_FEHLER = { status: null, fehler: "Supabase nicht lesbar", loading: false, geladenAm: null, httpStatus: 502, neuLaden: async () => {} };
const ZEIT = "2026-11-06T12:00:00Z";
const mw = (wert, status = "ok") => ({ wert, status, quelle: "Test", gemessen_am: status === "nicht_gemessen" ? null : ZEIT });
/** Systemzustand mit Zählungen; fehlende Felder sind "nicht_gemessen". */
function sysMit(felder) {
  const leer = mw(null, "nicht_gemessen");
  const status = {
    erzeugt_am: ZEIT,
    supabase: leer,
    agenten: leer,
    bus: leer,
    letzte_aktivierung: leer,
    aktive_agenten_24h: leer,
    content_heute: leer,
    freigabe: leer,
    kosten: leer,
    steinadel_export: leer,
    anthropic: leer,
    ...felder,
  };
  return { status, fehler: null, loading: false, geladenAm: ZEIT, httpStatus: 200, neuLaden: async () => {} };
}

function commandCenter(
  lz,
  { messagesError = null, messages = [], agents = [], ausgeblendet = 0, realtime = "SUBSCRIBED", realtimeFehler = null, sys = SYS_FEHLER } = {}
) {
  const gefangen = {};
  const C = ladeTsx("app/page.tsx", {
    ...lz.attrappen,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks": {
      useAgents: () => ({ agents, ausgeblendet, loading: false, error: null, refetch: async () => (gefangen.neuGelesen = (gefangen.neuGelesen ?? 0) + 1) }),
      useMessages: () => ({ messages, loading: false, error: messagesError, realtime, realtimeFehler }),
      useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }),
    },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": {
      ...hooksStatus,
      useSystemStatus: () => sys,
    },
    "@/lib/types": types,
    "@/lib/auftrag-types": auftragTypes,
    "@/components/agents/AgentCard": { AgentCard: leer },
    "@/components/ui/MessageFeed": {
      MessageFeed: (p) => {
        gefangen.feed = p;
        return null;
      },
      istSichtbareNachricht: () => true,
    },
    "@/components/ui/Masthead": {
      Masthead: (p) => {
        gefangen.masthead = p;
        return null;
      },
    },
    "@/components/ui/SituationTable": { SituationTable: leer },
    "@/components/ui/CommandPanels": { FreigabePanel: leer, SteinadelPanel: leer, SystemzustandPanel: leer },
  });
  return { C, gefangen };
}

test("N-M2 Command Center: Lesefehler des Bus geht an den Feed, Kopf 'nicht lesbar' statt 'Neueste 0'", () => {
  const lz = baumLaufzeit();
  const { C, gefangen } = commandCenter(lz, { messagesError: "TypeError: Failed to fetch" });
  const baum = lz.rendere(C.default, {}, []);
  const t = text(baum);
  assert.equal(gefangen.feed?.fehler, "TypeError: Failed to fetch");
  const kopf = finde(baum, (k) => typeof k.props?.title === "string" && k.props.title.startsWith("Supabase-Tabelle messages"));
  assert.equal(kopf.length, 1);
  assert.equal(text(kopf[0]), "nicht lesbar");
  assert.match(kopf[0].props.title, /im Browser nicht lesbar: TypeError: Failed to fetch/);
  assert.ok(!t.includes("Neueste 0"));
  // Ohne Fehler: Kopf wie bisher, kein Fehler an den Feed.
  const lz2 = baumLaufzeit();
  const ohne = commandCenter(lz2, { messages: [nachricht("m1")] });
  const t2 = text(lz2.rendere(ohne.C.default, {}, []));
  assert.equal(ohne.gefangen.feed?.fehler, null);
  assert.ok(t2.includes("Neueste 1"), t2.slice(0, 400));
});

// ═══ Gegencheck 06.11.2026: Command Center — leere Abfragen, Realtime, Latenz ═══

const vital = (gefangen, label) => gefangen.masthead.vitals.find((v) => v.label === label);

test("N-C1 (Gegencheck) Agentflotte: leere Abfrage behauptet keine leere Tabelle, keine T-Zähler aus 0, Chip nicht 0", () => {
  // Fall A: Die Abfrage las nur ausgeblendete Agenten (trader).
  const lzA = baumLaufzeit();
  const a = commandCenter(lzA, {
    ausgeblendet: 1,
    sys: sysMit({ agenten: mw({ anzahl: 1, ausgeblendet: ["trader"] }) }),
  });
  const tA = text(lzA.rendere(a.C.default, {}, []));
  assert.ok(tA.includes("Die Abfrage im Browser lieferte nur ausgeblendete Agenten (1)"), tA.slice(0, 600));
  assert.doesNotMatch(tA, /Register leer|keine Agenten eingetragen/);
  assert.doesNotMatch(tA, /T0: 0/);
  // Fall B: gesperrter Lesezugriff — die Abfrage liefert [], der Server zählt 16.
  const lzB = baumLaufzeit();
  const b = commandCenter(lzB, { sys: sysMit({ agenten: mw({ anzahl: 16, ausgeblendet: [] }) }) });
  const baumB = lzB.rendere(b.C.default, {}, []);
  const tB = text(baumB);
  assert.ok(tB.includes("Die Abfrage im Browser lieferte keine Agenten, der Server zählt 16."), tB.slice(0, 600));
  assert.ok(tB.includes("Widerspruch:"));
  assert.doesNotMatch(tB, /Register leer|keine Agenten eingetragen|T0: 0/);
  assert.equal(vital(b.gefangen, "Agenten").value, "16");
  // Fall C: /api/status nicht lesbar und leere Abfrage — der Chip zeigt keine 0 aus der Ersatzquelle.
  const lzC = baumLaufzeit();
  const c = commandCenter(lzC, {});
  lzC.rendere(c.C.default, {}, []);
  assert.equal(vital(c.gefangen, "Agenten").value, "nicht gemessen");
  // Mit gelesenen Agenten: Tier-Zähler und Ersatzquelle wie bisher.
  const lzD = baumLaufzeit();
  const d = commandCenter(lzD, { agents: [{ id: "oracle", name: "ORACLE", tier: 1 }] });
  const tD = text(lzD.rendere(d.C.default, {}, []));
  assert.ok(tD.includes("T1: 1"), tD.slice(0, 600));
  assert.equal(vital(d.gefangen, "Agenten").value, "1");
});

test("N-C1b (Prüflauf) Agenten-Chip: bei gelesenem Systemzustand nennt der Titel die Messung samt Grund, nicht 'wird geladen'", () => {
  const lz = baumLaufzeit();
  const grund = "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt — nicht abgefragt";
  const cc = commandCenter(lz, {
    sys: sysMit({ agenten: { wert: null, status: "nicht_gemessen", quelle: "Supabase · agents", gemessen_am: null, hinweis: grund } }),
  });
  lz.rendere(cc.C.default, {}, []);
  const chip = vital(cc.gefangen, "Agenten");
  assert.equal(chip.value, "nicht gemessen");
  assert.ok(chip.title.includes(`Hinweis: ${grund}`), chip.title);
  assert.ok(chip.title.includes("Die Abfrage im Browser lieferte keine Agenten"));
  assert.doesNotMatch(chip.title, /wird geladen/);
});

test("N-C2 (Gegencheck) Vital Latenz: gemessener Ausfall 'Fehler', ohne Messung 'nicht gemessen', nie '—'", () => {
  const fall = (sys) => {
    const lz = baumLaufzeit();
    const cc = commandCenter(lz, { sys });
    lz.rendere(cc.C.default, {}, []);
    return vital(cc.gefangen, "Latenz").value;
  };
  assert.equal(fall(sysMit({ supabase: mw(null, "fehler") })), "Fehler");
  assert.equal(fall(sysMit({ supabase: mw(null, "nicht_gemessen") })), "nicht gemessen");
  assert.equal(fall(SYS_FEHLER), "nicht gemessen");
  assert.equal(fall(sysMit({ supabase: mw({ latenz_ms: 12 }) })), "12 ms");
});

test("N-C3 (Gegencheck) Message Bus: Realtime-Zustand im Kopf, Gegenprobe und Zustand gehen an den Feed", () => {
  const lz = baumLaufzeit();
  const cc = commandCenter(lz, {
    messages: [nachricht("m1")],
    realtime: "CHANNEL_ERROR",
    realtimeFehler: "Websocket zu",
    sys: sysMit({ bus: mw({ anzahl: 7 }) }),
  });
  const baum = lz.rendere(cc.C.default, {}, []);
  const stand = finde(baum, (k) => text(k) === "Stand beim Laden" && typeof k.props?.title === "string");
  assert.equal(stand.length, 1);
  assert.match(stand[0].props.title, /^Realtime-Fehler \(Websocket zu\) — die Liste ist der Stand beim Laden/);
  assert.equal(cc.gefangen.feed.serverAnzahl, 7);
  assert.equal(cc.gefangen.feed.realtime, "CHANNEL_ERROR");
  assert.ok(text(baum).includes("Neueste 1 von 7"));
  // Verbunden: kein Hinweis.
  const lz2 = baumLaufzeit();
  const ok = commandCenter(lz2, { messages: [nachricht("m1")], realtime: "SUBSCRIBED", sys: sysMit({ bus: mw({ anzahl: 7 }) }) });
  assert.ok(!text(lz2.rendere(ok.C.default, {}, [])).includes("Stand beim Laden"));
  // Der alte Zusatz unter dem Feed ("Lesen im Browser fehlgeschlagen oder gesperrt") ist entfallen.
  const lz3 = baumLaufzeit();
  const leerListe = commandCenter(lz3, { sys: sysMit({ bus: mw({ anzahl: 5 }) }) });
  assert.ok(!text(lz3.rendere(leerListe.C.default, {}, [])).includes("fehlgeschlagen oder gesperrt"));
});

test("N-C4 (Gegencheck) Command Center: nach dem Ausführen liest die Seite das Agenten-Register neu", async () => {
  const lz = baumLaufzeit();
  const cc = commandCenter(lz, {});
  const plan = {
    mode: "plan",
    auftrag_id: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
    original_task: "Test",
    delegation_plan: { agents: [{ id: "oracle", task: "x", priority: 1 }], reasoning: "r" },
    planung: { modell: "claude-sonnet-5", input_tokens: 1, output_tokens: 1, kosten_usd_geschaetzt: 0.001, stop_reason: "end_turn" },
    erstellt_am: ZEIT,
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ fehler: "x" }), { status: 400 });
  // Die einzige echte Komponente mit Zustand ist die Auftragszeile: task, phase, plan, ergebnis, fehler, fehlversuch, ausgang.
  const baum = lz.rendere(cc.C.default, {}, ["x", "bereit", plan, null, null, null, null]);
  const knopf = finde(baum, (k) => k.type === "button" && text(k) === "Genau diesen Plan ausführen")[0];
  assert.ok(knopf, "Ausführen-Knopf");
  knopf.props.onClick();
  for (let i = 0; i < 20 && !cc.gefangen.neuGelesen; i += 1) await new Promise((fertig) => setImmediate(fertig));
  assert.equal(cc.gefangen.neuGelesen, 1);
});

// ═══ useObjekte: fehler_art der Route kommt als fehlerArt an ═══

/** useObjekte mit kleiner Hook-Laufzeit: Zustand je Aufrufreihenfolge, Effekte laufen einmal. */
async function rufeUseObjekte(antwort) {
  const slots = [];
  const effekte = [];
  let index = 0;
  const react = {
    useState(start) {
      const k = index++;
      if (!(k in slots)) slots[k] = typeof start === "function" ? start() : start;
      return [slots[k], (v) => (slots[k] = typeof v === "function" ? v(slots[k]) : v)];
    },
    useEffect(fn) {
      index++;
      effekte.push(fn);
    },
    useCallback: (fn) => fn,
    useSyncExternalStore: (_abo, lese) => lese(),
  };
  const H = ladeTsx("lib/hooks.ts", { react, "./supabase": { supabase: {} }, "./freigabe-regeln": regeln, "./types": types });
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/objekte");
    return antwort();
  };
  // Außerhalb von React aufgerufen (Attrappen-Laufzeit oben); der neutrale Name hält die
  // Hook-Regel des Linters aus diesem Test heraus.
  const objekteHook = H.useObjekte;
  const rendere = () => {
    index = 0;
    return objekteHook();
  };
  rendere();
  for (const e of effekte.splice(0)) e();
  for (let i = 0; i < 10; i += 1) await new Promise((fertig) => setImmediate(fertig));
  return rendere();
}

test("N-H1 useObjekte: fehler_art der Route als fehlerArt, ohne Fehler null", async () => {
  const konfig = await rufeUseObjekte(
    () => new Response(JSON.stringify({ fehler: "Export-Token (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration", objekte: [] }), { status: 500 })
  );
  assert.equal(konfig.loading, false);
  assert.equal(konfig.error, "Export-Token (Server-Umgebung) nicht gesetzt");
  assert.equal(konfig.fehlerArt, "konfiguration");
  const ohneArt = await rufeUseObjekte(() => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
  assert.equal(ohneArt.error, "HTTP 401");
  assert.equal(ohneArt.fehlerArt, null);
  const ok = await rufeUseObjekte(() => new Response(JSON.stringify({ objekte: [{ slug: "a", name: "A", preis: "1" }] }), { status: 200 }));
  assert.equal(ok.error, null);
  assert.equal(ok.fehlerArt, null);
  assert.equal(ok.objekte.length, 1);
});
