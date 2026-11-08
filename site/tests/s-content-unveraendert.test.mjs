// /content vor und nach der Auslagerung (Objekt-Studio Schritt 2, 08.11.2026, Teil E): byte-gleiches
// Markup. Lauf: npm test.
//
// Vorher: tests/fixtures/content-seite-e9c17c5.tsx.txt — unveränderte Kopie von
// site/src/app/content/page.tsx im Stand e9c17c5 (dem Stand vor der Auslagerung). Der Test prüft
// zuerst die Git-Blob-ID der Kopie, damit "vorher" nachweislich dieser Stand ist.
// Nachher: die Seite im Repo mit components/studio/ (beleg-hilfen.ts, BelegKette.tsx,
// FreigabeKnopf.tsx). Beide Fassungen laufen im selben Prozess mit denselben Attrappen (React,
// Supabase-, fetch- und Hook-Attrappen; lib/counsel-urteil.ts und lib/freigabe-regeln.ts echt) und
// rendern dieselben Zustände. Verglichen wird das Markup als Zeichenkette (assert.equal):
// - Teil A: ganze Seite mit echtem React (renderToStaticMarkup) für jeden Starttab, mit und ohne
//   Freigabe-Stapel;
// - Teil B: Freigeben-Knopf und Beleg-Kette je Eintrag, je mit echtem React;
// - Teil C: Content-Tab mit geladenen Einträgen, Einträge der Reihe nach aufgeklappt, und ein
//   Pipeline-Ergebnis (Hook-Laufzeit mit Effekten, Baum mit echtem React zu Markup).
// Gilt für Schritt 2. Ändert ein späterer Schritt /content absichtlich, wird dieser Vergleich
// bewusst angepasst oder entfernt. S_CONTENT_SEITE=<pfad> prüft statt der Repo-Seite eine Kopie;
// die Bausteine lassen sich über Z_TSX_COMPONENTS_STUDIO_* tauschen (Mutationstests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { React, jsxRuntime, renderToStaticMarkup, ts } from "./harness/tsx.mjs";
import { alsMarkup, hookLaufzeit, ladeStudioBausteine } from "./harness/studio.mjs";

// lib/hooks-status.ts importiert "./freigabe-regeln" ohne Endung.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VORHER_DATEI = path.join(SITE, "tests/fixtures/content-seite-e9c17c5.tsx.txt");
const NACHHER_DATEI = process.env.S_CONTENT_SEITE ?? path.join(SITE, "src/app/content/page.tsx");
/** git rev-parse e9c17c5:site/src/app/content/page.tsx */
const BLOB_E9C17C5 = "8bb9491cf978dc48342de74a95a8f847f55e09bd";

const counselModul = await import(pathToFileURL(path.join(SITE, "src/lib/counsel-urteil.ts")).href);
const regelnModul = await import(pathToFileURL(path.join(SITE, "src/lib/freigabe-regeln.ts")).href);
const { objekteFehlerArt, objektFehlerText } = await import(pathToFileURL(path.join(SITE, "src/lib/hooks-status.ts")).href);

const NAME = ["Immo", "Nexus"].join("");
const VORHER_QUELLE = readFileSync(VORHER_DATEI);
const NACHHER_QUELLE = readFileSync(NACHHER_DATEI, "utf8");

function uebersetze(quelle) {
  return ts.transpileModule(quelle, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: "page.tsx",
  }).outputText;
}
const VORHER = uebersetze(VORHER_QUELLE.toString("utf8"));
const NACHHER = uebersetze(NACHHER_QUELLE);

/** Seite laden; intern = Namen im Modul (nur vorher liegen Knopf, Kette und Lage in der Seite). */
function ladeSeite(code, attrappen, intern) {
  const modul = { exports: {} };
  const anfordern = (name) => {
    if (!(name in attrappen)) throw new Error(`unerwarteter Laufzeit-Import in page.tsx: ${name}`);
    return attrappen[name];
  };
  new Function("require", "module", "exports", `${code}\nmodule.exports.__intern = { ${intern.join(", ")} };`)(anfordern, modul, modul.exports);
  return { ContentPage: modul.exports.default, ...modul.exports.__intern };
}

/** Beide Fassungen mit denselben Attrappen: vorher mit eigenen Bausteinen, nachher mit components/studio/. */
function beideSeiten(attrappen) {
  const vorher = ladeSeite(VORHER, attrappen, ["ContentSeite", "FreigebenKnopf", "BelegKette", "freigabeLage"]);
  const studio = ladeStudioBausteine(attrappen);
  const nachher = {
    ...ladeSeite(NACHHER, { ...attrappen, ...studio.module }, ["ContentSeite"]),
    FreigebenKnopf: studio.knopf.FreigebenKnopf,
    BelegKette: studio.kette.BelegKette,
    freigabeLage: studio.hilfen.freigabeLage,
  };
  return { vorher, nachher };
}

// ─── Testdaten: jede Verzweigung der Beleg-Kette und des Freigeben-Knopfs ───
const TEXT = "Denkmal-Altbau in Leipzig, 4 Zimmer, saniert 2024. Jetzt Exposé anfordern.";
const FREIGABE_NOTES = "Prüfung ok.\nURTEIL: FREIGABE-EMPFEHLUNG";
const VERMERK = { aktion: "freigeben", am: "2026-11-06T08:00:00Z", durch: "betreiber-session", text_sha256: "0".repeat(64), text_zeichen: 75 };
const SNAPSHOT = {
  abgerufen_am: "2026-11-06T09:00:00Z",
  export: { version: "1", quelle: `${NAME} Backoffice`, generiert_am: "2026-11-06T08:30:00Z" },
  objekt: {
    name: "Villa X",
    untertitel: "",
    tagline: null,
    ort: "Leipzig",
    baujahr: 1905,
    preis: "489.000 €",
    kurzbeschreibung: `Saniert, Quelle ${NAME}`,
    statusBadge: "Verfügbar",
    afaProzent: 9,
    istDenkmal: true,
    kennzahlen: [{ label: "Wohnfläche", wert: "112 m²" }, { label: "Zimmer" }],
    kampagnen: [{ kampagne: "herbst", lpUrl: "https://steinadel.de/l/herbst", lpVariant: "a" }],
  },
};

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
        { agent: "researcher", status: "done", output: `Recherche mit ${NAME}-Bezug` },
        { agent: "scribe", status: "done", ...(scribe === null ? {} : { output: scribe }) },
        { agent: "counsel", status: "done", output: review_notes },
        { agent: "publisher", status: "done", output: body },
        { agent: "amplifier", status: "done", output: "Plan" },
      ],
      counsel: { urteil: "FREIGABE", geprueft: "SCRIBE-Text (steps[1])", am: "2026-11-05T10:05:00Z" },
      ...extra,
    },
    created_at: `2026-11-05T10:${String(id).padStart(2, "0")}:00Z`,
    updated_at: `2026-11-05T10:${String(id).padStart(2, "0")}:00Z`,
  };
}

const ZEILEN = [
  zeile(1, { review_notes: "URTEIL: **ABLEHNUNG**" }),
  zeile(2, { extra: { objekt_slug: "villa-x", objekt_snapshot: SNAPSHOT, regelpaket: { version: "v1.1", stand: "29.07.2026" }, researcher_quellen: "Modellangabe, ungeprüft", cta_link: "https://steinadel.de/l/herbst?utm_content=x-villa-x-2", utm_content: "x-villa-x-2" } }),
  zeile(3, { scribe: "Vorfassung von SCRIBE ohne Hashtags." }),
  zeile(4, { body: `${TEXT} Quelle: ${NAME}-Export.`, scribe: `${TEXT} Quelle: ${NAME}-Export.` }),
  zeile(5, { review_notes: `Regel 1.2 (${NAME}-Export) beachtet.\nURTEIL: FREIGABE-EMPFEHLUNG` }),
  zeile(6, {
    status: "gepostet",
    performance: { impressions: 120, likes: 4, erfasst_am: "2026-11-06T09:00:00Z", durch: "betreiber-session" },
    extra: { freigabe: VERMERK, gepostet: { aktion: "gepostet", am: "2026-11-06T09:30:00Z", durch: "betreiber-session", published_url: `https://x.example/${NAME}/6` } },
  }),
  zeile(7, { status: "freigegeben", extra: { freigabe: VERMERK } }),
  zeile(8, { body: "   " }),
  zeile(9, {
    status: "abgelehnt",
    extra: { abgelehnt_durch: "betreiber", freigabe: { aktion: "ablehnen", am: "2026-11-06T08:00:00Z", durch: "betreiber-session", grund: `Bezug zu ${NAME} entfernen` } },
  }),
  zeile(10, { status: "entwurf", review_notes: "Prüfung läuft", scribe: null, extra: { fehler: { stufe: "counsel", grund: "Antwort abgeschnitten" }, freigabe_hinweis: { identisch: false } } }),
  zeile(11, { extra: { objekt_slug: "villa-x", cta_link: `https://steinadel.de/${NAME}/l/herbst`, objekt_snapshot: { abgerufen_am: "unlesbar", export: null, objekt: null } } }),
  zeile(12, { status: "fehler", body: null, extra: { fehler: { stufe: "publisher", grund: "leere Antwort", detail: "HTTP 502" } } }),
];

const FREIGABEN = {
  erzeugt_am: "2026-11-06T09:00:00Z",
  wartend: [],
  wartend_gesamt: 12,
  haengend: [],
  haengend_gesamt: 0,
  quelle: "x",
  fehler: null,
};

// ═══ Herkunft der Vorher-Fassung ═══

test("S-C0 Vorher-Fassung ist site/src/app/content/page.tsx aus e9c17c5 (Git-Blob-ID der Kopie)", () => {
  const kopf = Buffer.from(`blob ${VORHER_QUELLE.length}\0`);
  const id = createHash("sha1").update(Buffer.concat([kopf, VORHER_QUELLE])).digest("hex");
  assert.equal(id, BLOB_E9C17C5);
  // Die Nachher-Fassung importiert die Bausteine wirklich (sonst verglichen wir zweimal dasselbe).
  for (const pfad of ["@/components/studio/BelegKette", "@/components/studio/FreigabeKnopf", "@/components/studio/beleg-hilfen"]) {
    assert.ok(NACHHER_QUELLE.includes(`from "${pfad}"`), pfad);
  }
  assert.ok(!/function BelegKette\(|function FreigebenKnopf\(/.test(NACHHER_QUELLE), "Bausteine nicht mehr in der Seite");
});

// ═══ Teil A: ganze Seite, echtes React ═══

function echteAttrappen({ suche = "", freigaben = null } = {}) {
  return {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "next/navigation": { useSearchParams: () => new URLSearchParams(suche) },
    "@/lib/supabase": { supabase: {} },
    "@/components/ui/KPICard": {
      KPICard: ({ label, value, subtitle }) => React.createElement("div", { "data-kpi": label }, `${label}: ${String(value)} · ${subtitle ?? ""}`),
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

test("S-C1 /content byte-gleich: ganze Seite je Starttab, mit und ohne Freigabe-Stapel (echtes React)", () => {
  let verglichen = 0;
  const laengen = [];
  for (const suche of ["", "tab=pipeline", "tab=calendar", "tab=content", "tab=unsinn"]) {
    for (const freigaben of [null, FREIGABEN]) {
      const { vorher, nachher } = beideSeiten(echteAttrappen({ suche, freigaben }));
      const alt = renderToStaticMarkup(React.createElement(vorher.ContentPage));
      const neu = renderToStaticMarkup(React.createElement(nachher.ContentPage));
      assert.ok(alt.includes("Content <em>Pipeline</em>"), `Seite ?${suche} gerendert`);
      assert.equal(neu, alt, `Seite ?${suche} weicht ab`);
      verglichen += alt.length;
      laengen.push(alt.length);
    }
  }
  assert.ok(verglichen > 20_000, `verglichen: ${verglichen} Zeichen (${laengen.join(", ")})`);
});

test("S-C2 /content byte-gleich: Freigeben-Knopf und Beleg-Kette je Eintrag (echtes React)", () => {
  const { vorher, nachher } = beideSeiten(echteAttrappen());
  const kopiere = () => {};
  const kopierStatus = (key) => `Kopieren ${key}`;
  let ketten = 0;
  for (const z of ZEILEN) {
    for (const pending of [false, true]) {
      const alt = renderToStaticMarkup(React.createElement(vorher.FreigebenKnopf, { lage: vorher.freigabeLage(z), pending, onFreigeben: () => {} }));
      const neu = renderToStaticMarkup(React.createElement(nachher.FreigebenKnopf, { lage: nachher.freigabeLage(z), pending, onFreigeben: () => {} }));
      assert.ok(alt.includes(">Freigeben</button>"));
      assert.equal(neu, alt, `Freigeben-Knopf #${z.id} (pending ${pending})`);
    }
    const alt = renderToStaticMarkup(React.createElement(vorher.BelegKette, { item: z, kopiere, kopierStatus }));
    const neu = renderToStaticMarkup(React.createElement(nachher.BelegKette, { item: z, kopiere, kopierStatus }));
    assert.ok(alt.includes("Beleg-Kette") && alt.includes("COUNSEL-Urteil"));
    assert.equal(neu, alt, `Beleg-Kette #${z.id}`);
    ketten += alt.length;
  }
  // Jede Verzweigung kommt vor: Snapshot mit Objektfeldern, CTA mit Namen gesperrt, Betreiber, gepostet.
  const alle = ZEILEN.map((z) => renderToStaticMarkup(React.createElement(nachher.BelegKette, { item: z, kopiere, kopierStatus }))).join("\n");
  for (const stueck of ["Kennzahlen", 'data-cta-sperre="name"', "gepostet ·", "abgelehnt ·", "COUNSEL-Antwort unvollständig", "Snapshot ohne Objektfelder", "Prüfregel"]) {
    assert.ok(alle.includes(stueck), stueck);
  }
  assert.ok(ketten > 20_000, `Beleg-Ketten: ${ketten} Zeichen`);
});

// ═══ Teil C: Zustände nach Effekten und Klicks (Hook-Laufzeit, Markup mit echtem React) ═══

function antwort(status, koerper) {
  return { status, ok: status >= 200 && status < 300, json: async () => koerper };
}

const ERGEBNIS = {
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

/** Eine Fassung mit Hook-Laufzeit: Supabase liefert ZEILEN, fetch beantwortet Kalender, Objekte und einen Lauf. */
function simulation(fassung, suche) {
  const lz = hookLaufzeit();
  const kette = { select: () => kette, order: () => kette, eq: () => kette, limit: async () => ({ data: ZEILEN, error: null }), maybeSingle: async () => ({ data: null, error: null }) };
  const kanal = { on: () => kanal, subscribe: () => kanal };
  const attrappen = {
    ...lz.attrappen,
    "next/navigation": { useSearchParams: () => new URLSearchParams(suche) },
    "@/lib/supabase": { supabase: { from: () => kette, channel: () => kanal, removeChannel: () => {} } },
    "@/components/ui/KPICard": {
      KPICard: ({ label, value, subtitle }) => lz.jsx("div", { "data-kpi": label, children: `${label}: ${String(value)} · ${subtitle ?? ""}` }),
    },
    "@/lib/hooks-status": {
      objektFehlerText,
      objekteFehlerArt,
      useFreigaben: () => ({ freigaben: FREIGABEN, fehler: null, loading: false, geladenAm: null, neuLaden: async () => {} }),
    },
    "@/lib/counsel-urteil": counselModul,
    "@/lib/freigabe-regeln": regelnModul,
  };
  const seiten = beideSeiten(attrappen);
  lz.setzeWurzel(seiten[fassung].ContentPage);
  return lz;
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

/** Kopf der Karte zu Eintrag id (klickbar, klappt auf). */
function kartenKopf(baum, id) {
  const karte = finde(
    baum,
    (k) => k.type === "div" && String(k.props.className ?? "").startsWith("card-ghost p-4") && finde(k, (h) => h.type === "h3" && text(h) === `Eintrag ${id}`).length === 1
  )[0];
  assert.ok(karte, `Karte für Eintrag ${id} fehlt`);
  return finde(karte, (k) => k.type === "div" && typeof k.props.onClick === "function" && String(k.props.className ?? "").includes("cursor-pointer"))[0];
}

async function mitFetch(lauf) {
  const vorher = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (url === "/api/content/pipeline" && !init.method) return antwort(200, { launch_calendar: null });
    if (url === "/api/content/pipeline" && init.method === "POST") return antwort(200, ERGEBNIS);
    if (url === "/api/objekte") return antwort(200, { objekte: [] });
    throw new Error(`Test: unerwarteter Abruf ${url}`);
  };
  try {
    return await lauf();
  } finally {
    globalThis.fetch = vorher;
  }
}

test("S-C3 /content byte-gleich: Content-Tab mit geladenen Einträgen, jeder Eintrag aufgeklappt", async () => {
  await mitFetch(async () => {
    const alt = simulation("vorher", "tab=content");
    const neu = simulation("nachher", "tab=content");
    alt.rendere();
    neu.rendere();
    let baumAlt = await alt.ruhe();
    let baumNeu = await neu.ruhe();
    assert.equal(alsMarkup(baumNeu), alsMarkup(baumAlt), "geladen, zugeklappt");
    let verglichen = 0;
    for (const z of ZEILEN) {
      kartenKopf(baumAlt, z.id).props.onClick();
      kartenKopf(baumNeu, z.id).props.onClick();
      baumAlt = await alt.ruhe(2);
      baumNeu = await neu.ruhe(2);
      const markupAlt = alsMarkup(baumAlt);
      assert.ok(markupAlt.includes("Beleg-Kette"), `Eintrag ${z.id} aufgeklappt`);
      assert.equal(alsMarkup(baumNeu), markupAlt, `Eintrag ${z.id} aufgeklappt`);
      verglichen += markupAlt.length;
    }
    assert.ok(verglichen > 100_000, `verglichen: ${verglichen} Zeichen`);
  });
});

test("S-C4 /content byte-gleich: Pipeline-Ergebnis mit Urteilsanzeige und Fassungsbezug", async () => {
  await mitFetch(async () => {
    const laeufe = {};
    for (const fassung of ["vorher", "nachher"]) {
      const lz = simulation(fassung, "");
      lz.rendere();
      let baum = await lz.ruhe();
      const feld = finde(baum, (k) => k.type === "input" && String(k.props.placeholder ?? "").startsWith("z.B."))[0];
      feld.props.onChange({ target: { value: "KI-Agenten im Mittelstand" } });
      baum = await lz.ruhe(2);
      const knopf = finde(baum, (k) => k.type === "button" && text(k).includes("Content produzieren"))[0];
      knopf.props.onClick({ stopPropagation() {} });
      laeufe[fassung] = alsMarkup(await lz.ruhe());
    }
    assert.ok(laeufe.vorher.includes("Pipeline-Ergebnis"), "Ergebnis gerendert");
    assert.ok(laeufe.vorher.includes("COUNSEL prüfte die Vorfassung"), "Urteilsanzeige mit Fassungsbezug");
    assert.equal(laeufe.nachher, laeufe.vorher);
  });
});
