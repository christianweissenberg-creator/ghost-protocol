// Komponenten-Tests der Content-Seite (src/app/content/page.tsx), Fixrunde 06.11.2026.
// Ergänzt tests/e-content-seite.test.mjs (reine Funktionen) um die Verdrahtung in JSX: Sperre am
// Freigeben-Knopf (R4), Bezug des COUNSEL-Urteils (R2), Maskierung (R24), Lauf-ID und Meldungen
// beim Klick auf "Content produzieren" (R10), Pipeline-Fluss (R34), Texte (R35), Starttab und
// Suspense-Grenze (R38), Hinweis "insgesamt warten" (R31), Metriken (R19). Lauf: npm test.
//
// Teil A rendert mit echtem React 19 (react-dom/server, renderToStaticMarkup; keine Effekte).
// Teil B führt Klickabläufe mit einer kleinen Hook-Laufzeit aus (useState, useRef, useCallback und
// useEffect mit Abhängigkeiten wie React), weil node_modules keinen DOM-Renderer enthält.
// Kein Netz: fetch und Supabase sind Attrappen; jeder unerwartete Aufruf lässt den Test scheitern.
// Die Seite wird wie in e-content-seite.test.mjs mit dem TypeScript-Compiler aus node_modules
// übersetzt; die Laufzeit-Importe ersetzt der Test, lib/counsel-urteil.ts und
// lib/freigabe-regeln.ts laufen unverändert mit.
// E_CONTENT_SEITE=<pfad> prüft statt der Repo-Datei eine Kopie (Mutationstests im Scratchpad).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Nachprüfung 06.11.2026: Die Seite nutzt objektFehlerText aus lib/hooks-status.ts; der Test
// nimmt die echte Funktion. hooks-status.ts importiert "./freigabe-regeln" ohne Endung.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEITE = process.env.E_CONTENT_SEITE ?? path.join(SITE, "src/app/content/page.tsx");
const req = createRequire(path.join(SITE, "package.json"));
const ts = req("typescript");
const React = req("react");
const jsxRuntime = req("react/jsx-runtime");
const { renderToStaticMarkup } = req("react-dom/server");
const counselModul = await import(pathToFileURL(path.join(SITE, "src/lib/counsel-urteil.ts")).href);
const regelnModul = await import(pathToFileURL(path.join(SITE, "src/lib/freigabe-regeln.ts")).href);
const { objekteFehlerArt, objektFehlerText } = await import(pathToFileURL(path.join(SITE, "src/lib/hooks-status.ts")).href);
const { NAMENS_ERSATZ } = regelnModul;

const NAME = ["Immo", "Nexus"].join("");
const ENTHAELT_NAMEN = /imm[ou][\s._-]*nexus/i;
const LAUF_ID = /^[A-Za-z0-9:_-]{8,80}$/;
const AUSGANG_UNBEKANNT = "Ausgang unbekannt — der Lauf kann noch laufen, Content-Tab prüfen";

const INTERN = ["ContentSeite", "FreigebenKnopf", "BelegKette", "PipelineFluss", "LaufMeldungAnzeige", "freigabeLage", "freigabeLageGemerkt"];
const UEBERSETZT = ts.transpileModule(readFileSync(SEITE, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: "page.tsx",
}).outputText;

/** Lädt die übersetzte Seite mit den gegebenen Attrappen; jeder andere Import ist ein Fehler. */
function ladeSeite(attrappen) {
  const modul = { exports: {} };
  const anfordern = (name) => {
    if (!(name in attrappen)) throw new Error(`unerwarteter Laufzeit-Import in page.tsx: ${name}`);
    return attrappen[name];
  };
  new Function("require", "module", "exports", `${UEBERSETZT}\nmodule.exports.__intern = { ${INTERN.join(", ")} };`)(
    anfordern,
    modul,
    modul.exports
  );
  return { ContentPage: modul.exports.default, ...modul.exports.__intern };
}

// fetch gehört dem Test: Jeder Test setzt seine Attrappe, danach gilt wieder das Original.
const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ─── Testdaten ───
const TEXT = "Denkmal-Altbau in Leipzig, 4 Zimmer, saniert 2024. Jetzt Exposé anfordern.";
const FREIGABE_NOTES = "Prüfung ok.\nURTEIL: FREIGABE-EMPFEHLUNG";

function zeile(id, { status = "zur_freigabe", body = TEXT, review_notes = FREIGABE_NOTES, scribe = TEXT, performance = null, extra = {} } = {}) {
  return {
    id,
    title: `Eintrag ${id}`,
    content_type: "thread",
    status,
    body,
    platform: "x",
    created_by: "scribe",
    reviewed_by: "counsel",
    review_notes,
    published_url: null,
    published_at: null,
    views: 0,
    engagement: 0,
    performance,
    metadata: {
      steps: [
        { agent: "researcher", status: "done", output: "Recherche" },
        { agent: "scribe", status: "done", ...(scribe === null ? {} : { output: scribe }) },
        { agent: "counsel", status: "done", output: review_notes },
        { agent: "publisher", status: "done", output: body },
        { agent: "amplifier", status: "done", output: "Plan" },
      ],
      counsel: { urteil: "FREIGABE", geprueft: "SCRIBE-Text (steps[1])" },
      ...extra,
    },
    created_at: "2026-11-05T10:00:00Z",
    updated_at: "2026-11-05T10:00:00Z",
  };
}

const GRUND_MIT_NAMEN = `Bezug zu ${NAME} entfernen`;
const ZEILEN = [
  zeile(1, { review_notes: "URTEIL: **ABLEHNUNG**" }),
  zeile(2),
  zeile(3, { scribe: "Vorfassung von SCRIBE ohne Hashtags." }),
  zeile(4, { body: `${TEXT} Quelle: ${NAME}-Export.`, scribe: `${TEXT} Quelle: ${NAME}-Export.` }),
  zeile(5, { review_notes: `Regel 1.2 (${NAME}-Export) beachtet.\nURTEIL: FREIGABE-EMPFEHLUNG` }),
  zeile(6, { status: "gepostet", performance: { impressions: 0, likes: 0, erfasst_am: "2026-10-01T10:00:00Z" } }),
  zeile(7, { status: "gepostet", performance: { impressions: 120, erfasst_am: "2026-11-06T09:00:00Z", durch: "betreiber-session" } }),
  zeile(8, { body: "   " }),
  zeile(9, {
    status: "abgelehnt",
    extra: {
      abgelehnt_durch: "betreiber",
      freigabe: { aktion: "ablehnen", am: "2026-11-06T08:00:00Z", durch: "betreiber-session", grund: GRUND_MIT_NAMEN },
    },
  }),
];

// ═══ Teil A: echtes React (renderToStaticMarkup) ═══

function attrappenEcht({ suche = "", freigaben = null, useSearchParams } = {}) {
  return {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/navigation": { useSearchParams: useSearchParams ?? (() => new URLSearchParams(suche)) },
    "@/lib/supabase": { supabase: {} },
    "@/components/ui/KPICard": {
      KPICard: ({ label, value, subtitle }) =>
        React.createElement("div", { "data-kpi": label }, `${label}: ${String(value)} · ${subtitle ?? ""}`),
    },
    "@/lib/hooks-status": {
      objektFehlerText,
      objekteFehlerArt,
      useFreigaben: () => ({ freigaben, fehler: null, loading: false, geladenAm: null, neuLaden: async () => {} }),
    },
    "@/lib/counsel-urteil": counselModul,
    "@/lib/freigabe-regeln": regelnModul,
  };
}

const A = ladeSeite(attrappenEcht());
const seiteHtml = (opts) => renderToStaticMarkup(React.createElement(ladeSeite(attrappenEcht(opts)).ContentPage));
const knopfHtml = (z, pending = false) =>
  renderToStaticMarkup(React.createElement(A.FreigebenKnopf, { lage: A.freigabeLage(z), pending, onFreigeben: () => {} }));
const freigebenGesperrt = (html) => /<button[^>]*disabled=""[^>]*>Freigeben<\/button>/.test(html);
const freigebenDa = (html) => /<button[^>]*>Freigeben<\/button>/.test(html);
const ketteHtml = (z) =>
  renderToStaticMarkup(React.createElement(A.BelegKette, { item: z, kopiere: () => {}, kopierStatus: () => "Kopieren" }));
/** Das span mit dem COUNSEL-Urteil der Beleg-Kette: { tag, text }. */
function urteilSpan(html) {
  const m = /(<span[^>]*data-urteil-anzeige="[^"]*"[^>]*>)([^<]*)</.exec(html);
  assert.ok(m, "Urteil-Anzeige fehlt in der Beleg-Kette");
  return { tag: m[1], text: m[2] };
}

test("R38: Starttab aus ?tab=, ohne oder mit unbekanntem Wert der Pipeline-Tab", () => {
  const ohne = seiteHtml({});
  assert.ok(ohne.includes("Agent-Pipeline Flow"));
  const content = seiteHtml({ suche: "tab=content" });
  assert.ok(content.includes('data-kpi="Zur Freigabe"'));
  assert.ok(!content.includes("Agent-Pipeline Flow"));
  assert.ok(seiteHtml({ suche: "tab=calendar" }).includes("Kalender lädt"));
  assert.ok(seiteHtml({ suche: "tab=unsinn" }).includes("Agent-Pipeline Flow"));
});

test("R38: useSearchParams steht in einer Suspense-Grenze (Vorrendern bricht nicht ab)", () => {
  // Next 16 wirft beim statischen Vorrendern in useSearchParams einen BailoutToCSRError
  // (next/dist/server/app-render/dynamic-rendering.js, useDynamicSearchParams). Ohne
  // Suspense-Grenze bricht der Build ab; mit ihr rendert der Platzhalter.
  const abbruch = () => {
    const e = new Error("Bail out to client-side rendering: useSearchParams()");
    e.digest = "BAILOUT_TO_CLIENT_SIDE_RENDERING";
    throw e;
  };
  const html = seiteHtml({ useSearchParams: abbruch });
  assert.ok(html.includes("Content-Ansicht lädt"), html.slice(0, 200));
  assert.ok(!html.includes("Agent-Pipeline Flow"));
  // Aufbau des Default-Exports: Suspense mit ContentSeite als Kind
  const element = A.ContentPage({});
  assert.equal(element.type, React.Suspense);
  assert.equal(element.props.children.type, A.ContentSeite);
});

test("R34/R35: Ruhezustand ohne WAIT, Kachel Gepostet heißt \"als gepostet markiert\"", () => {
  assert.ok(!seiteHtml({}).includes("WAIT"));
  const content = seiteHtml({ suche: "tab=content" });
  assert.ok(content.includes("als gepostet markiert"));
  assert.ok(!/Live ·/.test(content));
});

test("R4: Freigeben-Knopf gesperrt, solange pruefeFreigabe sperrt — mit sichtbarem Grund", () => {
  const ablehnung = knopfHtml(ZEILEN[0]);
  assert.ok(freigebenGesperrt(ablehnung));
  // sichtbarer Text neben dem Knopf, nicht nur das title-Attribut
  assert.match(ablehnung, /<span[^>]*>Freigeben gesperrt: COUNSEL-Urteil ABLEHNUNG/);
  const frei = knopfHtml(ZEILEN[1]);
  assert.ok(freigebenDa(frei) && !freigebenGesperrt(frei));
  assert.ok(!frei.includes("gesperrt"));
  assert.ok(freigebenGesperrt(knopfHtml(ZEILEN[1], true)), "während einer Aktion gesperrt");
  const name = knopfHtml(ZEILEN[3]);
  assert.ok(freigebenGesperrt(name) && name.includes("geschützten Namen"));
  const leer = knopfHtml(ZEILEN[7]);
  assert.ok(freigebenGesperrt(leer) && leer.includes("Freigabetext leer"));
  assert.ok(freigebenGesperrt(knopfHtml(zeile(10, { review_notes: null }))), "ohne review_notes");
  assert.ok(freigebenGesperrt(knopfHtml(zeile(11, { review_notes: "URTEIL: FREIGABE nicht möglich" }))), "Altzeile mit Verneinung");
});

test("R2: Freigeben bei abweichender Fassung frei, aber mit Hinweis am Knopf", () => {
  const html = knopfHtml(ZEILEN[2]);
  assert.ok(freigebenDa(html) && !freigebenGesperrt(html));
  assert.ok(html.includes("Freigabetext ungeprüft — COUNSEL prüfte die Vorfassung"));
});

test("R2: Beleg-Kette zeigt grünes FREIGABE nur bei gleicher Fassung", () => {
  const gleich = urteilSpan(ketteHtml(ZEILEN[1]));
  assert.equal(gleich.text, "FREIGABE");
  assert.ok(gleich.tag.includes("var(--gp-emerald)"));
  for (const z of [ZEILEN[2], zeile(12, { scribe: null, extra: { freigabe_hinweis: { identisch: false } } })]) {
    const s = urteilSpan(ketteHtml(z));
    assert.equal(s.text, "COUNSEL prüfte die Vorfassung · Freigabetext ungeprüft");
    assert.ok(s.tag.includes("var(--gp-amber)") && !s.tag.includes("var(--gp-emerald)"));
  }
  const unpruefbar = urteilSpan(ketteHtml(zeile(13, { scribe: null })));
  assert.notEqual(unpruefbar.text, "FREIGABE");
  assert.ok(!unpruefbar.tag.includes("var(--gp-emerald)"));
});

test("R4: Prüfregel steht in der Beleg-Kette", () => {
  assert.ok(ketteHtml(ZEILEN[0]).includes("nicht erfüllt: COUNSEL-Urteil ABLEHNUNG"));
  assert.ok(ketteHtml(ZEILEN[1]).includes("erfüllt"));
});

test("R24: Beleg-Kette zeigt COUNSEL-, RESEARCHER- und Betreibertexte nur maskiert", () => {
  const counsel = ketteHtml(ZEILEN[4]);
  assert.doesNotMatch(counsel, ENTHAELT_NAMEN);
  const urteil = ketteHtml(zeile(14, { review_notes: `Befund.\nURTEIL: ABLEHNUNG wegen ${NAME}-Bezug` }));
  assert.doesNotMatch(urteil, ENTHAELT_NAMEN);
  assert.ok(urteil.includes(`URTEIL: ABLEHNUNG wegen ${NAMENS_ERSATZ}-Bezug`));
  const basis = zeile(15);
  const researcher = ketteHtml({
    ...basis,
    metadata: { ...basis.metadata, steps: [{ agent: "researcher", status: "done", output: `Quelle ${NAME}` }, ...basis.metadata.steps.slice(1)] },
  });
  assert.doesNotMatch(researcher, ENTHAELT_NAMEN);
  // Ablehngrund des Betreibers (metadata.freigabe.grund) — wie in ablehnungText maskiert
  const betreiber = ketteHtml(ZEILEN[8]);
  assert.doesNotMatch(betreiber, ENTHAELT_NAMEN);
  assert.ok(betreiber.includes(`Grund: Bezug zu ${NAMENS_ERSATZ} entfernen`));
  // Übrige Betreiber- und Servertexte der Beleg-Kette
  const voll = zeile(16, {
    status: "gepostet",
    extra: {
      freigabe: { aktion: `pruefen-${NAME}`, am: `kaputt ${NAME}`, durch: `${NAME}-session` },
      gepostet: { aktion: "gepostet", am: "2026-11-06T09:00:00Z", published_url: `https://x.com/${NAME}/status/1` },
      regelpaket: { version: `v1-${NAME}`, stand: `${NAME}` },
      cta_link: `https://steinadel.de/lp?utm_content=${NAME}`,
      utm_content: `x-${NAME}-1`,
    },
  });
  assert.doesNotMatch(ketteHtml(voll), ENTHAELT_NAMEN);
});

test("R34: Pipeline-Fluss nach Abbruch, während des Laufs und bei unbekanntem Ausgang", () => {
  const fluss = (lage, ergebnis = null) => renderToStaticMarkup(React.createElement(A.PipelineFluss, { lage, ergebnis }));
  const fehlerLauf = {
    status: "fehler",
    fehler: { stufe: "scribe", grund: "Antwort abgeschnitten" },
    steps: [
      { agent: "researcher", status: "done", cost: 0.01 },
      { agent: "scribe", status: "error", fehler: "Antwort abgeschnitten" },
      { agent: "counsel", status: "pending" },
      { agent: "publisher", status: "pending" },
      { agent: "amplifier", status: "pending" },
    ],
  };
  const nachFehler = fluss("ergebnis", fehlerLauf);
  assert.equal((nachFehler.match(/>nicht ausgeführt</g) ?? []).length, 3);
  assert.ok(!nachFehler.includes("WAIT"));
  assert.ok(nachFehler.includes("Abbruch in Stufe SCRIBE: Antwort abgeschnitten — COUNSEL, PUBLISHER, AMPLIFIER wurden nicht ausgeführt."));
  const laeuft = fluss("laeuft");
  assert.equal((laeuft.match(/>läuft</g) ?? []).length, 5);
  assert.ok(!laeuft.includes("WAIT"));
  assert.ok(fluss("unbekannt").includes("Ausgang unbekannt"));
});

test("R10: Meldungen ohne Ergebnis — Hinweis auf dieselbe Lauf-ID, Knopf zum Eintrag", () => {
  const meldung = (m, offen = null) =>
    renderToStaticMarkup(React.createElement(A.LaufMeldungAnzeige, { meldung: m, offeneLaufId: offen, oeffne: () => {} }));
  const unbekannt = meldung(
    { art: "unbekannt", text: `${AUSGANG_UNBEKANNT} · Netzwerkfehler: x`, contentId: null },
    "abcdef12-3333-4444-8555-666666666666"
  );
  assert.ok(unbekannt.includes("Der nächste Klick sendet dieselbe Lauf-ID (abcdef12…)"));
  assert.ok(!unbekannt.includes("abgewiesen"));
  assert.ok(meldung({ art: "existiert", text: "Lauf existiert bereits (#5, Entwurf)", contentId: 5 }).includes("Eintrag #5 im Content-Tab öffnen"));
  const abgewiesen = meldung({ art: "abgewiesen", text: "Lauf abgewiesen (HTTP 400): x" }, "abcdef12-3333-4444-8555-666666666666");
  assert.ok(!abgewiesen.includes("dieselbe Lauf-ID"));
});

// Browser-Prüfung 06.11.2026: Bei 375 px scrollte /content waagrecht, weil die Stufenleiste nicht
// schrumpfen konnte. Jetzt scrollt nur die Leiste in ihrer Karte (gemessen: 280 px sichtbar,
// 480 px Inhalt); dieser Test hält die Klassen fest.
test("Browser-Prüfung: Stufenleiste scrollt in ihrer Karte, nicht die Seite", () => {
  const html = renderToStaticMarkup(React.createElement(A.PipelineFluss, { lage: "kein_lauf", ergebnis: null }));
  assert.match(html, /<div class="overflow-x-auto" data-fluss-leiste="true"><div class="grid min-w-\[480px\] /);
  assert.equal((html.match(/data-stufe=/g) ?? []).length, 5);
});

// ═══ Teil B: Klickabläufe mit Hook-Laufzeit ═══

/** Kleine Hook-Laufzeit: Zustand je Aufrufreihenfolge, Callbacks und Effekte mit Abhängigkeiten. */
function hookLaufzeit() {
  const z = { hooks: [], index: 0, effekte: [], geaendert: false };
  const Fragment = Symbol("Fragment");
  const jsx = (type, props, key) => ({ $el: true, type, props: props ?? {}, key });
  const gleich = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
  const react = {
    Suspense: ({ children }) => children,
    useState(start) {
      const i = z.index++;
      if (!(i in z.hooks)) {
        const slot = { wert: typeof start === "function" ? start() : start };
        slot.setze = (v) => {
          const neu = typeof v === "function" ? v(slot.wert) : v;
          if (!Object.is(neu, slot.wert)) {
            slot.wert = neu;
            z.geaendert = true;
          }
        };
        z.hooks[i] = slot;
      }
      return [z.hooks[i].wert, z.hooks[i].setze];
    },
    useRef(start) {
      const i = z.index++;
      if (!(i in z.hooks)) z.hooks[i] = { current: start };
      return z.hooks[i];
    },
    useCallback(fn, deps) {
      const i = z.index++;
      const alt = z.hooks[i];
      if (alt && gleich(alt.deps, deps)) return alt.fn;
      z.hooks[i] = { fn, deps };
      return fn;
    },
    useEffect(fn, deps) {
      const i = z.index++;
      const alt = z.hooks[i];
      if (alt && gleich(alt.deps, deps)) return;
      const slot = { deps, aufraeumen: alt?.aufraeumen };
      z.hooks[i] = slot;
      z.effekte.push(() => {
        if (typeof slot.aufraeumen === "function") slot.aufraeumen();
        const r = fn();
        slot.aufraeumen = typeof r === "function" ? r : undefined;
      });
    },
  };
  function aufloesen(k) {
    if (k === null || k === undefined || typeof k === "boolean") return null;
    if (Array.isArray(k)) return k.map(aufloesen);
    if (typeof k !== "object" || !k.$el) return k;
    if (k.type === Fragment) return aufloesen(k.props.children);
    if (typeof k.type === "function") return aufloesen(k.type(k.props));
    return { type: k.type, props: k.props, kinder: aufloesen(k.props.children) };
  }
  let wurzel = null;
  let baum = null;
  function rendere() {
    for (let runde = 0; runde < 50; runde += 1) {
      z.index = 0;
      z.geaendert = false;
      z.effekte = [];
      baum = aufloesen(jsx(wurzel, {}));
      const effekte = z.effekte;
      z.effekte = [];
      for (const e of effekte) e();
      if (!z.geaendert) return baum;
    }
    throw new Error("Render-Schleife ohne Ende");
  }
  async function ruhe(runden = 20) {
    for (let i = 0; i < runden; i += 1) {
      await new Promise((fertig) => setImmediate(fertig));
      if (z.geaendert) rendere();
    }
    return baum;
  }
  return {
    attrappen: { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment } },
    jsx,
    setzeWurzel: (w) => {
      wurzel = w;
    },
    rendere,
    ruhe,
  };
}

function text(k) {
  if (k === null || k === undefined) return "";
  if (Array.isArray(k)) return k.map(text).join("");
  if (typeof k === "object") return text(k.kinder);
  return String(k);
}

function finde(k, pred, aus = []) {
  if (Array.isArray(k)) {
    for (const c of k) finde(c, pred, aus);
    return aus;
  }
  if (k && typeof k === "object") {
    if (pred(k)) aus.push(k);
    finde(k.kinder, pred, aus);
  }
  return aus;
}

const knoepfe = (baum, inhalt) => finde(baum, (k) => k.type === "button" && text(k).includes(inhalt));
const freigebenKnopf = (baum) => finde(baum, (k) => k.type === "button" && text(k) === "Freigeben")[0];
const stufenText = (baum) => text(finde(baum, (k) => k.props?.["data-stufe"] !== undefined));
const zaehle = (s, muster) => (s.match(muster) ?? []).length;

function antwort(status, koerper) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (koerper instanceof Error) throw koerper;
      return koerper;
    },
  };
}
const json = (status, koerper) => () => antwort(status, koerper);

/**
 * Seite mit Attrappen: fetch beantwortet die Pipeline- und Status-Aufrufe aus den vorbereiteten
 * Listen; Supabase liefert die Zeilen; jeder andere Aufruf wirft.
 */
function baueSimulation({
  suche = "",
  freigaben = null,
  freigabenFehler = null,
  zeilen = ZEILEN,
  objekte = [],
  objekteAntwort = null,
  pipelineAntworten = [],
  statusAntworten = [],
  nachladen = { data: null, error: null },
} = {}) {
  const lz = hookLaufzeit();
  const pipelineAufrufe = [];
  const statusAufrufe = [];
  const offenePipeline = [...pipelineAntworten];
  const offeneStatus = [...statusAntworten];
  globalThis.fetch = async (url, init = {}) => {
    if (url === "/api/content/pipeline" && init.method === "POST") {
      const koerper = JSON.parse(init.body);
      pipelineAufrufe.push(koerper);
      const naechste = offenePipeline.shift();
      if (!naechste) throw new Error("Test: keine Pipeline-Antwort vorbereitet");
      return naechste(koerper);
    }
    if (url === "/api/content/pipeline" && !init.method) return antwort(200, { launch_calendar: null });
    if (url === "/api/objekte") {
      if (objekteAntwort?.wirf) throw objekteAntwort.wirf;
      return objekteAntwort ? antwort(objekteAntwort.status, objekteAntwort.body) : antwort(200, { objekte });
    }
    if (url === "/api/content/status" && init.method === "POST") {
      statusAufrufe.push(JSON.parse(init.body));
      const naechste = offeneStatus.shift();
      if (!naechste) throw new Error("Test: keine Status-Antwort vorbereitet");
      return naechste();
    }
    throw new Error(`Test: unerwarteter Abruf ${url}`);
  };
  const kette = {
    select: () => kette,
    order: () => kette,
    eq: () => kette,
    limit: async () => ({ data: zeilen, error: null }),
    maybeSingle: async () => nachladen,
  };
  // Realtime-Handler werden mitgeschnitten (sim.realtime), damit Tests Einfügungen nachstellen können.
  const realtimeHandler = [];
  const kanal = {
    on: (_ereignis, _filter, rueckruf) => {
      if (typeof rueckruf === "function") realtimeHandler.push(rueckruf);
      return kanal;
    },
    subscribe: () => kanal,
  };
  const supabase = { from: () => kette, channel: () => kanal, removeChannel: () => {} };
  const seite = ladeSeite({
    ...lz.attrappen,
    "next/navigation": { useSearchParams: () => new URLSearchParams(suche) },
    "@/lib/supabase": { supabase },
    "@/components/ui/KPICard": {
      KPICard: ({ label, value, subtitle }) => lz.jsx("div", { "data-kpi": label, children: `${label}: ${String(value)} · ${subtitle ?? ""}` }),
    },
    "@/lib/hooks-status": {
      objektFehlerText,
      objekteFehlerArt,
      useFreigaben: () => ({ freigaben, fehler: freigabenFehler, loading: false, geladenAm: null, neuLaden: async () => {} }),
    },
    "@/lib/counsel-urteil": counselModul,
    "@/lib/freigabe-regeln": regelnModul,
  });
  lz.setzeWurzel(seite.ContentPage);
  return {
    pipelineAufrufe,
    statusAufrufe,
    async start() {
      lz.rendere();
      return lz.ruhe();
    },
    rendere: () => lz.rendere(),
    ruhe: (runden) => lz.ruhe(runden),
    /** Realtime-Ereignis an alle mitgeschnittenen Handler, dann warten. */
    async realtime(payload) {
      for (const rueckruf of realtimeHandler) rueckruf(payload);
      return lz.ruhe();
    },
    /** Klick und warten, bis alle Antworten verarbeitet sind. */
    async klicke(knopf) {
      assert.ok(knopf, "Knopf nicht gefunden");
      assert.notEqual(knopf.props.disabled, true, `Knopf gesperrt: ${text(knopf)}`);
      knopf.props.onClick({ stopPropagation() {} });
      return lz.ruhe();
    },
    async tippe(feld, wert) {
      assert.ok(feld, "Feld nicht gefunden");
      feld.props.onChange({ target: { value: wert } });
      return lz.ruhe(2);
    },
  };
}

const themaFeld = (baum) => finde(baum, (k) => k.type === "input" && String(k.props.placeholder ?? "").startsWith("z.B."))[0];

async function oeffneEintrag(sim, baum, id) {
  const karte = finde(
    baum,
    (k) => k.type === "div" && String(k.props.className ?? "").startsWith("card-ghost p-4") && finde(k, (h) => h.type === "h3" && text(h) === `Eintrag ${id}`).length === 1
  )[0];
  assert.ok(karte, `Karte für Eintrag ${id} fehlt`);
  const kopf = finde(karte, (k) => k.type === "div" && typeof k.props.onClick === "function" && String(k.props.className ?? "").includes("cursor-pointer"))[0];
  kopf.props.onClick();
  return sim.ruhe(2);
}

const ERGEBNIS_ABWEICHEND = {
  pipeline: "content-first",
  contentId: 50,
  status: "complete",
  counsel: { urteil: "FREIGABE", grund: "URTEIL-Zeile", zeile: "URTEIL: FREIGABE-EMPFEHLUNG" },
  freigabe_hinweis: { identisch: false },
  steps: [
    { agent: "researcher", status: "done", output: "r", cost: 0.01 },
    { agent: "scribe", status: "done", output: TEXT, cost: 0.01 },
    { agent: "counsel", status: "done", output: `Regel 1.2 (${NAME}-Export)\nURTEIL: FREIGABE-EMPFEHLUNG`, cost: 0.01 },
    { agent: "publisher", status: "done", output: `${TEXT} #Hashtag`, cost: 0.01 },
    { agent: "amplifier", status: "done", output: "a", cost: null },
  ],
  summary: { total_cost_usd: 0.04, kosten_unvollstaendig: true, total_duration_ms: 1000, completed: "5/5" },
};

test("R10: unbekannter Ausgang behält die Lauf-ID, 409 und 4xx verwerfen sie, Doppelklick sendet einmal", async () => {
  let gibFrei;
  const verzoegert = new Promise((fertig) => {
    gibFrei = fertig;
  });
  const sim = baueSimulation({
    pipelineAntworten: [
      () => {
        throw new TypeError("Failed to fetch");
      },
      json(409, { fehler: "Lauf existiert bereits", content_id: 5, status: "entwurf" }),
      async () => {
        await verzoegert;
        return antwort(200, ERGEBNIS_ABWEICHEND);
      },
      json(400, { fehler: "platform, format und (topic oder objekt_slug) sind erforderlich" }),
      json(200, { ...ERGEBNIS_ABWEICHEND, contentId: 51 }),
    ],
  });
  let baum = await sim.start();
  baum = await sim.tippe(themaFeld(baum), "KI-Agenten im Mittelstand");

  // Klick 1: Netzwerkfehler → unbekannt, Lauf-ID bleibt
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  const t1 = text(baum);
  assert.ok(t1.includes(`${AUSGANG_UNBEKANNT} · Netzwerkfehler: Failed to fetch`), t1);
  assert.ok(!t1.includes("abgewiesen"));
  assert.ok(t1.includes("Der nächste Klick sendet dieselbe Lauf-ID"));
  assert.match(sim.pipelineAufrufe[0].lauf_id, LAUF_ID);
  assert.equal(zaehle(stufenText(baum), /unbekannt/g), 5);

  // Klick 2: dieselbe Lauf-ID; 409 → "Lauf existiert bereits (#5, Entwurf)"
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  assert.equal(sim.pipelineAufrufe[1].lauf_id, sim.pipelineAufrufe[0].lauf_id);
  assert.ok(text(baum).includes("Lauf existiert bereits (#5, Entwurf)"));
  assert.equal(knoepfe(baum, "Eintrag #5 im Content-Tab öffnen").length, 1);

  // Klick 3 als Doppelklick auf denselben Knopf: ein POST, neue Lauf-ID nach 409
  const knopf3 = knoepfe(baum, "Content produzieren")[0];
  knopf3.props.onClick();
  knopf3.props.onClick();
  baum = await sim.ruhe(3);
  assert.equal(sim.pipelineAufrufe.length, 3, "Doppelklick startet keinen zweiten POST");
  assert.notEqual(sim.pipelineAufrufe[2].lauf_id, sim.pipelineAufrufe[1].lauf_id);
  assert.equal(zaehle(stufenText(baum), /läuft/g), 5);
  assert.equal(knoepfe(baum, "Pipeline läuft")[0]?.props.disabled, true);
  gibFrei();
  baum = await sim.ruhe();
  const t3 = text(baum);
  assert.ok(t3.includes("Pipeline-Ergebnis"));
  assert.ok(t3.includes("COUNSEL prüfte die Vorfassung · Freigabetext ungeprüft"), "R2: Ergebnis-Karte nicht grün");
  assert.ok(t3.includes("mindestens $0.0400 · 1 Stufe ohne Angabe"));
  assert.doesNotMatch(t3, ENTHAELT_NAMEN, "R24: COUNSEL-Ausgabe maskiert");

  // Klick 4: 400 → abgewiesen; neue Lauf-ID nach Ergebnis
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  assert.ok(text(baum).includes("Lauf abgewiesen (HTTP 400)"));
  assert.notEqual(sim.pipelineAufrufe[3].lauf_id, sim.pipelineAufrufe[2].lauf_id);

  // Klick 5: nach 4xx wieder neue Lauf-ID
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  assert.notEqual(sim.pipelineAufrufe[4].lauf_id, sim.pipelineAufrufe[3].lauf_id);
  assert.ok(text(baum).includes("Pipeline-Ergebnis"));
  assert.equal(sim.pipelineAufrufe.length, 5);
});

// Gegencheck 06.11.2026: Antworten in der Form des Erzeugers (fehlerAntwort der Pipeline). Eine
// 5xx mit Fehlertext der Route ist ein bekannter Ausgang; nur die 502 ohne JSON ist unbekannt.
test("R10: 5xx der Route ist abgebrochen bzw. nicht gestartet (neue Lauf-ID); 502 ohne JSON ist unbekannt", async () => {
  const sim = baueSimulation({
    pipelineAntworten: [
      json(500, { fehler: "TypeError: Ausnahme", contentId: 77, status: "fehler", speicherfehler: [] }),
      json(502, { fehler: "Steinadel-Export nicht lesbar: Export-Token (Server-Umgebung) nicht gesetzt (HTTP 500)" }),
      json(502, new SyntaxError("Unexpected token <")),
      json(502, new SyntaxError("Unexpected token <")),
    ],
  });
  let baum = await sim.start();
  baum = await sim.tippe(themaFeld(baum), "X");

  // Klick 1: Ausnahme nach dem Insert → abgebrochen, Eintrag öffnen, kein "kann noch laufen"
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  const t1 = text(baum);
  assert.ok(t1.includes("Lauf abgebrochen (HTTP 500, Eintrag #77): TypeError: Ausnahme"), t1);
  assert.equal(knoepfe(baum, "Eintrag #77 im Content-Tab öffnen").length, 1);
  assert.ok(!t1.includes(AUSGANG_UNBEKANNT));
  assert.ok(!t1.includes("dieselbe Lauf-ID"));
  assert.equal(zaehle(stufenText(baum), /unbekannt/g), 0);

  // Klick 2: neue Lauf-ID; Export-Fehler vor dem Insert → nicht gestartet, ohne Ursachen-Präfix
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  assert.notEqual(sim.pipelineAufrufe[1].lauf_id, sim.pipelineAufrufe[0].lauf_id);
  const t2 = text(baum);
  assert.ok(
    t2.includes("Lauf nicht gestartet (HTTP 502): Steinadel-Export nicht lesbar: Export-Token (Server-Umgebung) nicht gesetzt (HTTP 500)"),
    t2
  );
  assert.ok(!t2.includes("Quelle nicht erreichbar"));
  assert.ok(!t2.includes(AUSGANG_UNBEKANNT));
  assert.equal(knoepfe(baum, "Content-Tab öffnen").length, 0);

  // Klick 3: neue Lauf-ID; 502 ohne JSON (Reverse-Proxy) → unbekannt, Lauf-ID bleibt
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  assert.notEqual(sim.pipelineAufrufe[2].lauf_id, sim.pipelineAufrufe[1].lauf_id);
  assert.ok(text(baum).includes("HTTP 502 ohne lesbare Antwort"));
  assert.ok(text(baum).includes("Der nächste Klick sendet dieselbe Lauf-ID"));
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  assert.equal(sim.pipelineAufrufe[3].lauf_id, sim.pipelineAufrufe[2].lauf_id);
});

test("R10/R38: \"Eintrag öffnen\" wechselt in den Content-Tab und klappt den Eintrag auf", async () => {
  const sim = baueSimulation({ pipelineAntworten: [json(409, { fehler: "Lauf existiert bereits", content_id: 2, status: "zur_freigabe" })] });
  let baum = await sim.start();
  baum = await sim.tippe(themaFeld(baum), "X");
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  assert.ok(text(baum).includes("Lauf existiert bereits (#2, Zur Freigabe)"));
  baum = await sim.klicke(knoepfe(baum, "Eintrag #2 im Content-Tab öffnen")[0]);
  assert.ok(text(baum).includes("Zur Freigabe:"), "Content-Tab sichtbar");
  assert.ok(freigebenKnopf(baum), "Eintrag 2 aufgeklappt (Freigeben-Knopf sichtbar)");
});

test("R24: Namensschutz-Abbruch — PUBLISHER-Ausgabe maskiert und nicht \"Freigabetext\" genannt", async () => {
  // pipeline/route.ts: HTTP 200, status "fehler", PUBLISHER "error", output als Beleg, kein body
  const NAMENSSCHUTZ = "Namensschutz: Freigabetext enthält einen geschützten Namen";
  const abbruch = {
    pipeline: "content-first",
    contentId: 60,
    status: "fehler",
    fehler: { stufe: "publisher", grund: NAMENSSCHUTZ, am: "2026-11-06T10:00:00Z" },
    counsel: { urteil: "FREIGABE", grund: "URTEIL-Zeile", zeile: "URTEIL: FREIGABE-EMPFEHLUNG" },
    warnungen: [],
    steps: [
      { agent: "researcher", status: "done", output: "r", cost: 0.01 },
      { agent: "scribe", status: "done", output: TEXT, cost: 0.01 },
      { agent: "counsel", status: "done", output: FREIGABE_NOTES, cost: 0.01 },
      { agent: "publisher", status: "error", fehler: NAMENSSCHUTZ, output: `${TEXT} Daten aus dem ${NAME}-Export.`, cost: 0.01 },
      { agent: "amplifier", status: "pending" },
    ],
    summary: { total_cost_usd: 0.04, kosten_unvollstaendig: false, total_duration_ms: 1000, completed: "3/5" },
    speicherfehler: [],
  };
  const sim = baueSimulation({ pipelineAntworten: [json(200, abbruch)] });
  let baum = await sim.start();
  baum = await sim.tippe(themaFeld(baum), "Thema A");
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  const t = text(baum);
  assert.ok(t.includes("Pipeline-Ergebnis"));
  assert.doesNotMatch(t, ENTHAELT_NAMEN);
  assert.ok(t.includes(`Daten aus dem ${NAMENS_ERSATZ}-Export.`), "Ausgabe maskiert sichtbar");
  assert.ok(t.includes("PUBLISHER-Ausgabe enthielt einen geschützten Namen — Lauf abgebrochen, nicht zur Freigabe gestellt."));
  assert.ok(!t.includes("Der Freigabetext enthält einen geschützten Namen"));
  assert.ok(t.includes("Abbruch in Stufe PUBLISHER: Namensschutz"));
  assert.equal(zaehle(stufenText(baum), /nicht ausgeführt/g), 1);
});

test("R24: Im Lauf zur Freigabe bleibt der Freigabetext roh, mit Warnung bei geschütztem Namen", async () => {
  // Der Server lässt das nicht zu (Namensschutz); die Anzeige warnt trotzdem, statt zu maskieren.
  const ergebnis = {
    ...ERGEBNIS_ABWEICHEND,
    steps: ERGEBNIS_ABWEICHEND.steps.map((s) => (s.agent === "publisher" ? { ...s, output: `${TEXT} ${NAME}` } : s)),
  };
  const sim = baueSimulation({ pipelineAntworten: [json(200, ergebnis)] });
  let baum = await sim.start();
  baum = await sim.tippe(themaFeld(baum), "Thema B");
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  const t = text(baum);
  assert.ok(t.includes("Der Freigabetext enthält einen geschützten Namen — Freigabe gesperrt."));
  assert.match(t, ENTHAELT_NAMEN, "Freigabetext roh");
  const counselAusgabe = finde(baum, (k) => k.type === "pre" && text(k).includes("Regel 1.2"))[0];
  assert.doesNotMatch(text(counselAusgabe), ENTHAELT_NAMEN, "COUNSEL-Ausgabe maskiert");
});

test("R24: Stufennamen, Zusammenfassung, Objektnamen und Listenfelder erscheinen maskiert", async () => {
  const ergebnis = {
    ...ERGEBNIS_ABWEICHEND,
    summary: { ...ERGEBNIS_ABWEICHEND.summary, completed: `5/5 ${NAME}` },
    steps: [...ERGEBNIS_ABWEICHEND.steps, { agent: `${NAME}-stufe`, status: "done", output: "x", cost: null }],
  };
  const sim = baueSimulation({
    objekte: [{ slug: "villa-x", name: `Villa ${NAME}` }],
    pipelineAntworten: [json(200, ergebnis)],
  });
  let baum = await sim.start();
  const option = finde(baum, (k) => k.type === "option" && k.props.value === "villa-x")[0];
  assert.ok(option, "Objekt-Auswahl fehlt");
  assert.equal(text(option), `Villa ${NAMENS_ERSATZ}`);
  baum = await sim.tippe(themaFeld(baum), "Thema C");
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  const t = text(baum);
  assert.ok(t.includes("Pipeline-Ergebnis"));
  assert.ok(t.includes(`5/5 ${NAMENS_ERSATZ}`));
  assert.ok(t.includes(`${NAMENS_ERSATZ}-stufe`));
  assert.doesNotMatch(t, ENTHAELT_NAMEN);

  const liste = baueSimulation({ suche: "tab=content", zeilen: [{ ...zeile(20), content_type: `${NAME}-format`, platform: `${NAME}-kanal` }] });
  const tListe = text(await liste.start());
  assert.ok(tListe.includes(`${NAMENS_ERSATZ}-format`) && tListe.includes(`${NAMENS_ERSATZ}-kanal`));
  assert.doesNotMatch(tListe, ENTHAELT_NAMEN);
});

test("Content-Tab: Sperre (R4), Hinweis (R2), Name (R24) und Metriken (R19) je Eintrag", async () => {
  const sim = baueSimulation({
    suche: "tab=content",
    freigaben: { erzeugt_am: "2026-11-06T09:00:00Z", wartend: [], wartend_gesamt: 12, haengend: [], haengend_gesamt: 0, quelle: "x", fehler: null },
  });
  let baum = await sim.start();
  const t0 = text(baum);
  // Gegencheck 06.11.2026: Die Liste hier hat weniger als 50 Zeilen — die Grenze ist nicht die
  // Ursache der Abweichung, der Hinweis nennt sie deshalb nicht.
  assert.ok(t0.includes("Liste und Server-Zählung weichen ab:"), "R31: Hinweis mit frischer Zahl");
  assert.ok(t0.includes("laut Server 12"), "R31: Zahl des Servers");
  assert.ok(!t0.includes("Die Liste zeigt nur die letzten 50 Einträge"), "R31: keine erfundene Ursache");
  assert.ok(t0.includes("als gepostet markiert"));
  assert.ok(t0.includes("Geschützter Name im Text"), "R24: Badge bei Name im Freigabetext");

  baum = await oeffneEintrag(sim, baum, 1);
  assert.equal(freigebenKnopf(baum).props.disabled, true);
  assert.ok(text(baum).includes("Freigeben gesperrt: COUNSEL-Urteil ABLEHNUNG"));
  baum = await oeffneEintrag(sim, baum, 2);
  assert.equal(freigebenKnopf(baum).props.disabled, false);
  baum = await oeffneEintrag(sim, baum, 3);
  assert.equal(freigebenKnopf(baum).props.disabled, false);
  assert.ok(text(baum).includes("Freigabetext ungeprüft — COUNSEL prüfte die Vorfassung"));
  baum = await oeffneEintrag(sim, baum, 4);
  assert.equal(freigebenKnopf(baum).props.disabled, true);
  assert.ok(text(baum).includes("Der Freigabetext enthält einen geschützten Namen — Freigabe gesperrt."));
  assert.match(text(baum), ENTHAELT_NAMEN, "body bleibt roh (Vorschau)");
  baum = await oeffneEintrag(sim, baum, 5);
  baum = await sim.klicke(knoepfe(baum, "COUNSEL-Review")[0]);
  assert.doesNotMatch(text(baum), ENTHAELT_NAMEN, "COUNSEL-Review und Beleg-Kette maskiert");
  assert.ok(text(baum).includes("Geschützter Name im COUNSEL-Text ersetzt."));
  assert.ok(text(baum).includes(`Regel 1.2 (${NAMENS_ERSATZ}-Export) beachtet.`));
  baum = await oeffneEintrag(sim, baum, 6);
  assert.ok(text(baum).includes("Letzte Erfassung: Erfassung vor Stufe 1, 0 kann Platzhalter sein"));
  baum = await oeffneEintrag(sim, baum, 7);
  assert.ok(text(baum).includes("Letzte Erfassung: 120 Impressions · Likes nicht erfasst"));
  assert.ok(!text(baum).includes("Letzte Erfassung: Erfassung vor Stufe 1"));
  baum = await oeffneEintrag(sim, baum, 8);
  assert.equal(freigebenKnopf(baum).props.disabled, true);
  assert.ok(text(baum).includes("Freigabetext leer"));
});

test("R24: Ablehngrund des Betreibers steht auf der Karte nur maskiert", async () => {
  const sim = baueSimulation({ suche: "tab=content" });
  let baum = await sim.start();
  baum = await oeffneEintrag(sim, baum, 9);
  const t = text(baum);
  assert.doesNotMatch(t, ENTHAELT_NAMEN);
  assert.ok(t.includes(`Abgelehnt durch den Betreiber — Grund: Bezug zu ${NAMENS_ERSATZ} entfernen`), "ablehnungText");
  assert.ok(t.includes(`· Grund: Bezug zu ${NAMENS_ERSATZ} entfernen`), "Beleg-Kette, Zeile Betreiber");
});

test("R4: Eine 409 des Servers beim Freigeben zeigt dessen fehler-Text", async () => {
  const sim = baueSimulation({ suche: "tab=content", statusAntworten: [json(409, { fehler: "COUNSEL-Urteil UNKLAR (keine URTEIL-Zeile)" })] });
  let baum = await sim.start();
  baum = await oeffneEintrag(sim, baum, 2);
  baum = await sim.klicke(freigebenKnopf(baum));
  assert.equal(sim.statusAufrufe.length, 1);
  assert.equal(sim.statusAufrufe[0].aktion, "freigeben");
  assert.equal(sim.statusAufrufe[0].id, 2);
  assert.ok(text(baum).includes("Konflikt (HTTP 409): COUNSEL-Urteil UNKLAR (keine URTEIL-Zeile)"));
  // Gegencheck 06.11.2026: Das Neulesen lieferte keine Zeile — die Anzeige ist veraltet.
  assert.ok(text(baum).includes("Neu laden lieferte keine Zeile — Anzeige veraltet"));
  assert.ok(!text(baum).includes("Eintrag neu geladen"));
});

test("Gegencheck: Nach 409 heißt es nur dann \"Eintrag neu geladen\", wenn eine Zeile kam und ersetzt wurde", async () => {
  const neu = { ...ZEILEN.find((z) => z.id === 2), status: "freigegeben" };
  const sim = baueSimulation({
    suche: "tab=content",
    statusAntworten: [json(409, { fehler: "Eintrag hat sich zwischenzeitlich geändert (Status oder Inhalt) — neu laden" })],
    nachladen: { data: neu, error: null },
  });
  let baum = await sim.start();
  const freigegebenVorher = Number(/Freigegeben: (\d+)/.exec(text(baum))?.[1]);
  baum = await oeffneEintrag(sim, baum, 2);
  baum = await sim.klicke(freigebenKnopf(baum));
  const t = text(baum);
  assert.ok(t.includes("· Eintrag neu geladen"), t.slice(0, 400));
  assert.ok(!t.includes("Anzeige veraltet"));
  // Prüflauf 06.11.2026: Die Zeile ist wirklich ersetzt (Status "freigegeben" zählt jetzt mit).
  assert.equal(Number(/Freigegeben: (\d+)/.exec(t)?.[1]), freigegebenVorher + 1);
  const fehler = baueSimulation({
    suche: "tab=content",
    statusAntworten: [json(409, { fehler: "x" })],
    nachladen: { data: null, error: { message: "permission denied" } },
  });
  let b2 = await fehler.start();
  b2 = await oeffneEintrag(fehler, b2, 2);
  b2 = await fehler.klicke(freigebenKnopf(b2));
  assert.ok(text(b2).includes("Neu laden fehlgeschlagen: permission denied — Anzeige veraltet"));
});

test("R31: Nach Lesefehler kein \"insgesamt warten\" aus alten Daten, Kachel \"nicht lesbar\"", async () => {
  const sim = baueSimulation({
    suche: "tab=content",
    freigaben: { erzeugt_am: "2026-11-06T09:00:00Z", wartend: [], wartend_gesamt: 12, haengend: [], haengend_gesamt: 0, quelle: "x", fehler: null },
    freigabenFehler: "HTTP 401",
  });
  const t = text(await sim.start());
  assert.ok(!t.includes("insgesamt warten"));
  assert.ok(t.includes("Zur Freigabe: nicht lesbar"));
});

test("R35: leere Liste ohne Ursachenbehauptung", async () => {
  const sim = baueSimulation({ suche: "tab=content", zeilen: [] });
  const t = text(await sim.start());
  assert.ok(t.includes("Die Abfrage lieferte keine Content-Einträge."));
  assert.ok(!t.includes("wartet auf Aktivierung"));
});

test("R38: Ein Klick auf einen Tab gilt trotz ?tab=content", async () => {
  const sim = baueSimulation({ suche: "tab=content" });
  let baum = await sim.start();
  assert.ok(!text(baum).includes("Agent-Pipeline Flow"));
  baum = await sim.klicke(finde(baum, (k) => k.type === "button" && text(k) === "Pipeline")[0]);
  assert.ok(text(baum).includes("Agent-Pipeline Flow"));
});

// ═══ Gesamtprüfung 06.11.2026 (Fixrunde Z): Kopieren, CTA-Link, LinkedIn, R24-Restlücken ═══

/** Zwischenablage-Attrappe für kopiere(); liefert die kopierten Texte. */
async function mitZwischenablage(lauf) {
  const kopiert = [];
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t) => void kopiert.push(t) },
  });
  try {
    await lauf(kopiert);
  } finally {
    delete globalThis.navigator.clipboard;
  }
}

/** Kopieren-Knöpfe der X-Thread-Vorschau (nicht der CTA-Knopf der Beleg-Kette). */
function vorschauKnoepfe(baum) {
  const block = finde(baum, (k) => k.type === "div" && finde(k, (h) => h.type === "h4" && text(h) === "X-Thread-Vorschau").length === 1 && !String(k.props.className ?? "").startsWith("card-ghost p-4"));
  const innen = block[block.length - 1];
  assert.ok(innen, "X-Thread-Vorschau fehlt");
  return finde(innen, (k) => k.type === "button");
}

const ctaKnopf = (baum) => {
  const code = finde(baum, (k) => k.type === "code")[0];
  assert.ok(code, "CTA-Link fehlt");
  const zeileMitCode = finde(baum, (k) => k.type === "div" && String(k.props.className ?? "").includes("flex items-start gap-2") && finde(k, (c) => c === code).length === 1)[0];
  return finde(zeileMitCode, (k) => k.type === "button")[0];
};

test("Gesamtprüfung: Kopieren nur bei freigegeben/gepostet ohne Sperrgrund; zur_freigabe, abgelehnt und Name gesperrt", async () => {
  await mitZwischenablage(async (kopiert) => {
    const zeilen = [
      zeile(2),
      zeile(4, { body: `${TEXT} Quelle: ${NAME}-Export.`, scribe: `${TEXT} Quelle: ${NAME}-Export.` }),
      ZEILEN[8],
      zeile(40, { status: "freigegeben" }),
      zeile(41, { status: "freigegeben", body: `${TEXT} ${NAME}`, scribe: `${TEXT} ${NAME}` }),
      zeile(42, { status: "gepostet", review_notes: "URTEIL: ABLEHNUNG" }),
    ];
    const sim = baueSimulation({ suche: "tab=content", zeilen });
    let baum = await sim.start();
    for (const [id, grund] of [
      [2, "Kopieren erst nach Freigabe"],
      [4, "Kopieren erst nach Freigabe"],
      [9, "Kopieren erst nach Freigabe"],
      [41, "Kopieren gesperrt: Der Text enthält einen geschützten Namen"],
      [42, "Kopieren gesperrt: COUNSEL-Urteil ABLEHNUNG"],
    ]) {
      baum = await oeffneEintrag(sim, baum, id);
      const knoepfe = vorschauKnoepfe(baum);
      assert.ok(knoepfe.length > 0);
      for (const k of knoepfe) {
        assert.equal(k.props.disabled, true, `Eintrag ${id}: Knopf frei`);
        k.props.onClick(); // erzwungener Klick: kopiere darf nicht laufen
      }
      assert.ok(text(baum).includes(grund), `Eintrag ${id}: Hinweis „${grund}“ fehlt`);
    }
    await sim.ruhe(3);
    assert.deepEqual(kopiert, [], "nichts in der Zwischenablage");

    baum = await oeffneEintrag(sim, baum, 40);
    const frei = vorschauKnoepfe(baum);
    assert.equal(frei[0].props.disabled, false);
    assert.ok(!text(baum).includes("Kopieren erst nach Freigabe"));
    baum = await sim.klicke(frei[0]);
    assert.deepEqual(kopiert, [TEXT]);
  });
});

test("Gesamtprüfung: CTA-Link mit geschütztem Namen — Anzeige maskiert, Warnung sichtbar, Kopieren gesperrt", async () => {
  await mitZwischenablage(async (kopiert) => {
    const mitName = zeile(43, { status: "freigegeben", extra: { cta_link: `https://steinadel.de/lp/${NAME.toLowerCase()}-villa?utm_source=x` } });
    const ohneName = zeile(44, { status: "freigegeben", extra: { cta_link: "https://steinadel.de/lp/villa?utm_source=x" } });
    const sim = baueSimulation({ suche: "tab=content", zeilen: [mitName, ohneName] });
    let baum = await sim.start();
    baum = await oeffneEintrag(sim, baum, 43);
    const t = text(baum);
    assert.ok(t.includes("CTA-Link enthält einen geschützten Namen — nicht verwenden. Kopieren gesperrt."));
    assert.ok(t.includes(`https://steinadel.de/lp/${NAMENS_ERSATZ}-villa?utm_source=x`), "Anzeige maskiert");
    const knopf = ctaKnopf(baum);
    assert.equal(knopf.props.disabled, true);
    knopf.props.onClick();
    await sim.ruhe(3);
    assert.deepEqual(kopiert, []);

    baum = await oeffneEintrag(sim, baum, 44);
    assert.ok(!text(baum).includes("CTA-Link enthält einen geschützten Namen"));
    baum = await sim.klicke(ctaKnopf(baum));
    assert.deepEqual(kopiert, ["https://steinadel.de/lp/villa?utm_source=x"]);
  });
  // Server-Render der Beleg-Kette: Warnung und gesperrter Knopf auch ohne Klick
  const html = ketteHtml(zeile(45, { extra: { cta_link: `https://x.example/${NAME}` } }));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Kopieren<\/button>/);
  assert.doesNotMatch(html, ENTHAELT_NAMEN);
});

test("Gesamtprüfung: LinkedIn ohne Pipeline-Format — Hinweis, Knopf gesperrt, kein POST (R39 bleibt offen)", async () => {
  const sim = baueSimulation();
  let baum = await sim.start();
  baum = await sim.tippe(themaFeld(baum), "Fachbeitrag");
  const li = finde(baum, (k) => k.type === "button" && text(k).trim() === "in LI")[0];
  assert.ok(li, "LinkedIn-Knopf fehlt");
  baum = await sim.klicke(li);
  assert.ok(text(baum).includes("LinkedIn ist in der Pipeline nicht hinterlegt"));
  const produzieren = knoepfe(baum, "Content produzieren")[0];
  assert.equal(produzieren.props.disabled, true);
  produzieren.props.onClick(); // erzwungen
  baum = await sim.ruhe(3);
  assert.equal(sim.pipelineAufrufe.length, 0);
  assert.ok(text(baum).includes("LinkedIn ist in der Pipeline nicht hinterlegt"));
  assert.ok(!text(baum).includes("undefined"));
  // zurück auf X: Lauf wieder möglich
  baum = await sim.klicke(finde(baum, (k) => k.type === "button" && text(k).trim() === "𝕏 X")[0]);
  assert.equal(knoepfe(baum, "Content produzieren")[0].props.disabled, false);
});

test("Gesamtprüfung R24: SCRIBE-Vorfassung, Titel, Fehler-Vermerk und Objekt-Snapshot nur maskiert (X09, X10, X23–X25)", async () => {
  const snapshot = {
    abgerufen_am: "2026-11-06T09:00:00Z",
    export: { version: "1", quelle: `${NAME}-Export`, generiert_am: "2026-11-06T08:00:00Z" },
    objekt: { name: `Villa ${NAME}`, kampagnen: [{ kampagne: `${NAME}-herbst`, lpUrl: "https://x.example/lp", lpVariant: "a" }] },
  };
  const zeilen = [
    zeile(50, { scribe: `Vorfassung mit ${NAME}-Bezug.`, extra: { objekt_snapshot: snapshot, objekt_slug: "villa-x" } }),
    zeile(51, { status: "fehler", body: null, extra: { fehler: { stufe: "scribe", grund: `Abbruch wegen ${NAME}`, am: "2026-11-06T09:00:00Z" } } }),
    { ...zeile(52), title: `Titel ${NAME}` },
  ];
  const sim = baueSimulation({ suche: "tab=content", zeilen });
  let baum = await sim.start();
  assert.ok(text(baum).includes(`Titel ${NAMENS_ERSATZ}`), "Titel in der Liste maskiert");
  assert.doesNotMatch(text(baum), ENTHAELT_NAMEN, "Titel in der Liste");
  baum = await oeffneEintrag(sim, baum, 50);
  const t50 = text(baum);
  assert.ok(t50.includes(`Vorfassung mit ${NAMENS_ERSATZ}-Bezug.`), "SCRIBE-Vorfassung maskiert sichtbar");
  assert.ok(t50.includes(`Villa ${NAMENS_ERSATZ}`) && t50.includes(`${NAMENS_ERSATZ}-Export`) && t50.includes(`${NAMENS_ERSATZ}-herbst`));
  assert.doesNotMatch(t50, ENTHAELT_NAMEN);
  baum = await oeffneEintrag(sim, baum, 51);
  assert.ok(text(baum).includes(`Fehler: SCRIBE: Abbruch wegen ${NAMENS_ERSATZ}`));
  assert.doesNotMatch(text(baum), ENTHAELT_NAMEN);
});

test("Gesamtprüfung R24/R2: Ergebnis mit Namen in fehler.grund, steps[].fehler und counsel.zeile maskiert; Hinweis PUBLISHER ≠ SCRIBE (X11–X13)", async () => {
  const abbruch = {
    pipeline: "content-first",
    contentId: 70,
    status: "fehler",
    fehler: { grund: `Grund mit ${NAME}` },
    counsel: { urteil: "FREIGABE", grund: "URTEIL-Zeile", zeile: `URTEIL: FREIGABE-EMPFEHLUNG ${NAME}` },
    warnungen: [],
    steps: [
      { agent: "researcher", status: "done", output: "r", cost: 0.01 },
      { agent: "scribe", status: "error", fehler: `Stufenfehler ${NAME}`, cost: null },
      { agent: "counsel", status: "pending" },
      { agent: "publisher", status: "pending" },
      { agent: "amplifier", status: "pending" },
    ],
    summary: { total_cost_usd: 0.01, kosten_unvollstaendig: true, total_duration_ms: 10, completed: "1/5" },
    speicherfehler: [],
  };
  const sim = baueSimulation({ pipelineAntworten: [json(200, abbruch), json(200, ERGEBNIS_ABWEICHEND)] });
  let baum = await sim.start();
  baum = await sim.tippe(themaFeld(baum), "Thema Z");
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  const t = text(baum);
  assert.ok(t.includes(`Abbruch in Stufe SCRIBE: Grund mit ${NAMENS_ERSATZ}`), "Fluss-Hinweis maskiert");
  assert.ok(t.includes(`Stufenfehler ${NAMENS_ERSATZ}`));
  assert.ok(t.includes(`URTEIL: FREIGABE-EMPFEHLUNG ${NAMENS_ERSATZ}`));
  assert.doesNotMatch(t, ENTHAELT_NAMEN);
  // Ohne Grund im Vermerk: Fluss-Hinweis aus steps[].fehler, ebenfalls maskiert
  const fluss = renderToStaticMarkup(
    React.createElement(A.PipelineFluss, { lage: "ergebnis", ergebnis: { ...abbruch, fehler: undefined } })
  );
  assert.ok(fluss.includes(`Abbruch in Stufe SCRIBE: Stufenfehler ${NAMENS_ERSATZ}`));
  assert.doesNotMatch(fluss, ENTHAELT_NAMEN);
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]);
  assert.ok(text(baum).includes("Der Text zur Freigabe (PUBLISHER) ist nicht der von COUNSEL geprüfte Text (SCRIBE)."));
});

test("Gesamtprüfung R4 (X07): Freigeben ist gesperrt, solange eine Status-Aktion offen ist", async () => {
  let gibFrei;
  const offen = new Promise((fertig) => {
    gibFrei = fertig;
  });
  const sim = baueSimulation({
    suche: "tab=content",
    statusAntworten: [
      async () => {
        await offen;
        return antwort(409, { fehler: "Status geändert" });
      },
    ],
  });
  let baum = await sim.start();
  baum = await oeffneEintrag(sim, baum, 2);
  freigebenKnopf(baum).props.onClick();
  baum = await sim.ruhe(3);
  assert.equal(sim.statusAufrufe.length, 1);
  assert.equal(freigebenKnopf(baum).props.disabled, true, "während der offenen Aktion gesperrt");
  gibFrei();
  baum = await sim.ruhe();
  assert.ok(text(baum).includes("Konflikt (HTTP 409): Status geändert"));
});

// ═══ Nachprüfung im Browser 06.11.2026 ═══
// Im laufenden Dashboard (ohne Export-Token) zeigte die Auswahl still nur "ohne Objekt".

test("Nachprüfung: fehlende Objektliste nennt den Grund unter der Auswahl", async () => {
  const faelle = [
    [
      "Token fehlt",
      { status: 500, body: { fehler: "Export-Token (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration", objekte: [] } },
      "Objektliste nicht lesbar: Export-Token (Server-Umgebung) nicht gesetzt — ein Lauf ist nur ohne Objekt möglich.",
    ],
    [
      "ohne Sitzung",
      { status: 401, body: { error: "Unauthorized" } },
      "Objektliste nicht lesbar: Nicht angemeldet (HTTP 401) — ohne gültige Sitzung startet auch kein Lauf; bitte neu anmelden.",
    ],
    [
      "Fehlerantwort des Exports",
      { status: 502, body: { fehler: "quelle_http_403", fehler_art: "quelle_fehler", objekte: [] } },
      "Objektliste nicht lesbar: Steinadel-Export antwortete mit HTTP 403 — ein Lauf ist nur ohne Objekt möglich.",
    ],
    [
      "Export nicht erreichbar",
      { status: 502, body: { fehler: "quelle_nicht_erreichbar", fehler_art: "nicht_erreichbar", objekte: [] } },
      "Objektliste nicht lesbar: Steinadel-Export nicht erreichbar — ein Lauf ist nur ohne Objekt möglich.",
    ],
    ["200 ohne Liste", { status: 200, body: { version: "1" } }, "Objektliste nicht lesbar: Antwort ohne Objektliste"],
    ["Netzfehler", { wirf: new TypeError("Failed to fetch") }, "Objektliste nicht lesbar: Failed to fetch"],
    ["500 ohne fehler_art", { status: 500, body: null }, "Objektliste nicht lesbar: HTTP 500"],
  ];
  for (const [fall, objekteAntwort, erwartet] of faelle) {
    const sim = baueSimulation({ objekteAntwort });
    const t = text(await sim.start());
    assert.ok(t.includes(erwartet), `${fall}: ${t.slice(0, 300)}`);
    assert.doesNotMatch(t, /EXPORT_TOKEN/, fall);
    // Gegencheck 06.11.2026: "nur ohne Objekt möglich" nur, wenn der Export das Problem ist.
    const zusatzErlaubt = ["Token fehlt", "Fehlerantwort des Exports", "Export nicht erreichbar"].includes(fall);
    assert.equal(t.includes("ein Lauf ist nur ohne Objekt möglich"), zusatzErlaubt, `${fall}: Zusatz`);
  }
  const ok = baueSimulation({ objekte: [{ slug: "villa-a", name: "Villa A" }] });
  const t = text(await ok.start());
  assert.ok(!t.includes("Objektliste nicht lesbar"));
  assert.ok(t.includes("Villa A"));
});

// ═══ Prüflauf 06.11.2026: R10 bei Wiederholung, 50er-Grenze nur aus der Abfrage ═══

test("Prüflauf: Wiederholung mit offener Lauf-ID — eine 5xx der Route verwirft die Lauf-ID nicht", async () => {
  const sim = baueSimulation({
    pipelineAntworten: [
      json(504, new SyntaxError("Unexpected token <")),
      json(500, { fehler: "Lauf-ID nicht prüfbar: Lesen fehlgeschlagen — Lauf nicht gestartet" }),
      json(409, { fehler: "Lauf-ID schon vergeben (#7, Status entwurf) — kein neuer Lauf gestartet", content_id: 7, status: "entwurf" }),
      json(200, { ...ERGEBNIS_ABWEICHEND, contentId: 52 }),
    ],
  });
  let baum = await sim.start();
  baum = await sim.tippe(themaFeld(baum), "X");
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]); // 504 ohne JSON → unbekannt
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]); // Wiederholung: 500 der Route
  assert.equal(sim.pipelineAufrufe[1].lauf_id, sim.pipelineAufrufe[0].lauf_id, "Wiederholung mit derselben Lauf-ID");
  const t2 = text(baum);
  assert.ok(t2.includes(`${AUSGANG_UNBEKANNT} (früherer Versuch mit dieser Lauf-ID) · Dieser Versuch: Lauf nicht gestartet (HTTP 500)`), t2.slice(0, 600));
  assert.ok(t2.includes("Der nächste Klick sendet dieselbe Lauf-ID"));
  assert.equal(zaehle(stufenText(baum), /unbekannt/g), 5);
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]); // dieselbe ID → 409
  assert.equal(sim.pipelineAufrufe[2].lauf_id, sim.pipelineAufrufe[0].lauf_id, "dritter Klick sendet weiter dieselbe Lauf-ID");
  assert.ok(text(baum).includes("Lauf existiert bereits (#7, Entwurf)"));
  baum = await sim.klicke(knoepfe(baum, "Content produzieren")[0]); // nach 409: neue ID
  assert.notEqual(sim.pipelineAufrufe[3].lauf_id, sim.pipelineAufrufe[0].lauf_id);
});

test("Prüflauf: 50er-Grenze als Ursache nur, wenn die Abfrage 50 Zeilen lieferte — nicht durch Realtime-Einfügungen", async () => {
  const freigaben = { erzeugt_am: "2026-11-06T09:00:00Z", wartend: [], wartend_gesamt: 7, haengend: [], haengend_gesamt: 0, quelle: "x", fehler: null };
  const zeilenMit = (n) => Array.from({ length: n }, (_, i) => zeile(100 + i, { status: i === 0 ? "zur_freigabe" : "gepostet" }));
  const voll = baueSimulation({ suche: "tab=content", freigaben, zeilen: zeilenMit(50) });
  const tVoll = text(await voll.start());
  assert.ok(tVoll.includes("Die Liste zeigt nur die letzten 50 Einträge; insgesamt warten 7 auf Freigabe"), tVoll.slice(0, 500));
  const kurz = baueSimulation({ suche: "tab=content", freigaben, zeilen: zeilenMit(49) });
  await kurz.start();
  const nachRealtime = text(await kurz.realtime({ eventType: "INSERT", new: zeile(999, { status: "gepostet" }) }));
  assert.ok(nachRealtime.includes("Liste und Server-Zählung weichen ab"), nachRealtime.slice(0, 500));
  assert.ok(!nachRealtime.includes("Die Liste zeigt nur die letzten 50 Einträge"));
});

test("Nachprüfung: freigabeLage je Eintrag gemerkt — gleicher Eintrag gleiche Lage, ersetzter Eintrag neu", () => {
  const eintrag = { body: TEXT, review_notes: "Prüfung ok.\nURTEIL: FREIGABE", metadata: {} };
  const lage = A.freigabeLageGemerkt(eintrag);
  assert.equal(A.freigabeLageGemerkt(eintrag), lage, "zweiter Aufruf aus dem Merker");
  assert.deepEqual(lage, A.freigabeLage(eintrag), "dieselbe Regel wie ungemerkt");
  assert.equal(lage.pruefung.freigebbar, true);
  // Ersetzt (neues Objekt, wie setContent es tut): neu gerechnet.
  const ersetzt = { ...eintrag, body: `${TEXT} ${NAME}` };
  const neu = A.freigabeLageGemerkt(ersetzt);
  assert.notEqual(neu, lage);
  assert.equal(neu.nameImText, true);
  assert.equal(neu.pruefung.freigebbar, false);
});

// ═══ Tor-Prüfung 07.11.2026 (F8): "Bereit zum Posten" nur mit Betreiber-Vermerk ═══
// Gemessen per SQL am 07.11.2026: content #2 hat Status freigegeben ohne metadata.freigabe
// (freigegeben am 27.07.2026, vor Stufe 1). Die Kachel sagte trotzdem "Bereit zum Posten".

const VERMERK = {
  aktion: "freigeben",
  am: "2026-11-06T08:00:00Z",
  durch: "betreiber-session",
  counsel_urteil: "FREIGABE",
  counsel_zeile: "URTEIL: FREIGABE-EMPFEHLUNG",
  text_sha256: "0".repeat(64),
  text_zeichen: 75,
};

test("TOR-F8 Kachel Freigegeben: ohne Betreiber-Vermerk nicht 'bereit zum Posten', sondern sichtbar als Altbestand", async () => {
  const sim = baueSimulation({
    suche: "tab=content",
    zeilen: [zeile(2, { status: "freigegeben" }), zeile(21, { status: "freigegeben", extra: { freigabe: VERMERK } })],
  });
  const baum = await sim.start();
  const kachel = text(finde(baum, (k) => k.props?.["data-kpi"] === "Freigegeben")[0]);
  assert.equal(
    kachel,
    "Freigegeben: 2 · 1 bereit zum Posten (mit Betreiber-Vermerk) · 1 freigegeben ohne Betreiber-Vermerk (Altbestand) · in den letzten 50",
  );
  // Am Eintrag selbst: nur #2 trägt den Hinweis, sichtbar in der Kopfzeile (nicht erst aufgeklappt).
  const hinweise = finde(baum, (k) => k.type === "span" && text(k) === "ohne Betreiber-Vermerk (Altbestand)");
  assert.equal(hinweise.length, 1);
  const karte2 = finde(
    baum,
    (k) => k.type === "div" && String(k.props.className ?? "").startsWith("card-ghost p-4") && finde(k, (h) => h.type === "h3" && text(h) === "Eintrag 2").length === 1,
  )[0];
  assert.equal(finde(karte2, (k) => k.type === "span" && text(k) === "ohne Betreiber-Vermerk (Altbestand)").length, 1);
});

test("TOR-F8 Kachel Freigegeben: nur Einträge mit Vermerk → kein Altbestand-Teil; ohne gelesene Liste keine Aussage", async () => {
  const mit = baueSimulation({ suche: "tab=content", zeilen: [zeile(21, { status: "freigegeben", extra: { freigabe: VERMERK } })] });
  const kachel = text(finde(await mit.start(), (k) => k.props?.["data-kpi"] === "Freigegeben")[0]);
  assert.equal(kachel, "Freigegeben: 1 · 1 bereit zum Posten (mit Betreiber-Vermerk) · in den letzten 50");
  // Ein abgelehnter Vermerk (aktion ablehnen) ist kein Freigabe-Vermerk.
  const falsch = baueSimulation({ suche: "tab=content", zeilen: [zeile(22, { status: "freigegeben", extra: { freigabe: { aktion: "ablehnen" } } })] });
  const k2 = text(finde(await falsch.start(), (k) => k.props?.["data-kpi"] === "Freigegeben")[0]);
  assert.equal(k2, "Freigegeben: 1 · 0 bereit zum Posten (mit Betreiber-Vermerk) · 1 freigegeben ohne Betreiber-Vermerk (Altbestand) · in den letzten 50");
  // Solange die Liste lädt, keine Aussage über "bereit" (vorher stand der Untertitel immer da).
  const laedt = baueSimulation({ suche: "tab=content", zeilen: [zeile(2, { status: "freigegeben" })] });
  const k3 = text(finde(laedt.rendere(), (k) => k.props?.["data-kpi"] === "Freigegeben")[0]);
  assert.equal(k3, "Freigegeben: lädt · Status freigegeben · in den letzten 50");
  // Freigabe-Regel unverändert: Kopieren hängt weiter an pruefeFreigabe, nicht am Vermerk.
  const lage = A.freigabeLage(zeile(2, { status: "freigegeben" }));
  assert.equal(lage.pruefung.freigebbar, true);
});
