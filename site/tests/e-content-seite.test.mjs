// Tests für die reinen Funktionen der Content-Seite (src/app/content/page.tsx), Fixrunde
// 06.11.2026, Befunde R2, R4, R10, R19, R24, R31, R34, R35, R38. Lauf: npm test.
//
// page.tsx ist eine Client-Seite mit JSX und @/-Importen; Node lädt sie nicht per
// Type-Stripping. Der Test übersetzt deshalb die ECHTE Datei mit dem TypeScript-Compiler aus
// node_modules nach CommonJS, ersetzt die Laufzeit-Importe (React, Next, Supabase, KPICard,
// Hooks) durch Attrappen und reicht die festen Verträge lib/counsel-urteil.ts und
// lib/freigabe-regeln.ts unverändert durch. Die Seite exportiert nur ihre Default-Komponente
// (Next erlaubt in page.tsx keine weiteren Exporte); die internen Funktionen holt der Test über
// einen angehängten Ausdruck im übersetzten Modul. Gerendert wird hier nichts.
// E_CONTENT_SEITE=<pfad> prüft statt der Repo-Datei eine Kopie (Mutationstests im Scratchpad).
// Objekt-Studio Schritt 2 (08.11.2026): Freigabe-Lage, Urteilsanzeige und Zeit-/Maskierungshilfen
// liegen in components/studio/beleg-hilfen.ts; die Seite importiert sie. Der Test lädt die echte
// Datei mit (tests/harness/studio.mjs) und prüft dieselben Funktionen wie vorher (AUSGELAGERT).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ladeStudioBausteine } from "./harness/studio.mjs";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEITE = process.env.E_CONTENT_SEITE ?? path.join(SITE, "src/app/content/page.tsx");
const ts = createRequire(path.join(SITE, "package.json"))("typescript");

const counselModul = await import(pathToFileURL(path.join(SITE, "src/lib/counsel-urteil.ts")).href);
const regelnModul = await import(pathToFileURL(path.join(SITE, "src/lib/freigabe-regeln.ts")).href);
const { NAMENS_ERSATZ, MIN_FREIGABE_ZEICHEN } = regelnModul;

/** Seit Schritt 2 in components/studio/beleg-hilfen.ts statt in page.tsx. */
const AUSGELAGERT = ["fassungsBezug", "freigabeLage", "urteilAnzeige", "bezugHinweis", "maskiertWert", "zeitText"];

const INTERN = [
  "AUSGANG_UNBEKANNT",
  "tabAusUrl",
  "sichtbarerTab",
  "neueLaufId",
  "werteLaufAntwortAus",
  "netzwerkAusgang",
  "laufIdNachAusgang",
  "ausgangBeiWiederholung",
  "sendeLauf",
  "stufenEtikett",
  "flussHinweis",
  "laufKostenText",
  "ergebnisBezug",
  "wartendHinweis",
  "objekteHinweisZusatz",
  "metrikenText",
  "fehlerMeldung",
  "stufenAusgabe",
  "laufZurFreigabe",
  "vermerkText",
];

function ladeSeite(datei) {
  const { outputText } = ts.transpileModule(readFileSync(datei, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: "page.tsx",
  });
  const attrappen = {
    react: {},
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: "Fragment" },
    "next/navigation": { useSearchParams: () => new URLSearchParams("") },
    "@/lib/supabase": { supabase: {} },
    "@/components/ui/KPICard": { KPICard: () => null },
    "@/lib/hooks-status": { objektFehlerText: (f) => String(f), objekteFehlerArt: () => "unbekannt", useFreigaben: () => ({}) },
    "@/lib/counsel-urteil": counselModul,
    "@/lib/freigabe-regeln": regelnModul,
  };
  const studio = ladeStudioBausteine(attrappen);
  Object.assign(attrappen, studio.module);
  const modul = { exports: {} };
  const anfordern = (name) => {
    if (!(name in attrappen)) throw new Error(`unerwarteter Laufzeit-Import in page.tsx: ${name}`);
    return attrappen[name];
  };
  new Function("require", "module", "exports", `${outputText}\nmodule.exports.__intern = { ${INTERN.join(", ")} };`)(
    anfordern,
    modul,
    modul.exports
  );
  const intern = modul.exports.__intern;
  for (const name of AUSGELAGERT) intern[name] = studio.hilfen[name];
  return intern;
}

const S = ladeSeite(SEITE);
const NAME = ["Immo", "Nexus"].join("");
const ENTHAELT_NAMEN = /imm[ou][\s._-]*nexus/i;
const LAUF_ID = /^[A-Za-z0-9:_-]{8,80}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const FREIGABE_NOTES = "Prüfung ok.\nURTEIL: FREIGABE-EMPFEHLUNG";
const TEXT = "Denkmal-Altbau in Leipzig, 4 Zimmer, saniert 2024. Jetzt Exposé anfordern.";

function eintrag({ body = TEXT, review_notes = FREIGABE_NOTES, scribe = TEXT, hinweis } = {}) {
  const steps = [
    { agent: "researcher", status: "done", output: "Recherche" },
    { agent: "scribe", status: "done", ...(scribe === null ? {} : { output: scribe }) },
    { agent: "counsel", status: "done", output: review_notes },
    { agent: "publisher", status: "done", output: body },
    { agent: "amplifier", status: "done", output: "Plan" },
  ];
  return {
    body,
    review_notes,
    metadata: { steps, ...(hinweis === undefined ? {} : { freigabe_hinweis: hinweis }) },
  };
}

// ═══ R38: Starttab aus der URL ═══

test("R38: ?tab= wählt den Starttab, Unbekanntes fällt auf pipeline", () => {
  assert.equal(S.tabAusUrl("content"), "content");
  assert.equal(S.tabAusUrl("pipeline"), "pipeline");
  assert.equal(S.tabAusUrl("calendar"), "calendar");
  for (const wert of [null, "", "Content", "freigabe", "__proto__", "toString"]) {
    assert.equal(S.tabAusUrl(wert), null, String(wert));
  }
  assert.equal(S.sichtbarerTab(null, "content"), "content");
  assert.equal(S.sichtbarerTab(null, null), "pipeline");
  assert.equal(S.sichtbarerTab(null, "unsinn"), "pipeline");
});

test("R38: Ein Klick gilt, bis sich ?tab= ändert", () => {
  const klick = { tab: "pipeline", urlTab: "content" };
  assert.equal(S.sichtbarerTab(klick, "content"), "pipeline");
  assert.equal(S.sichtbarerTab(klick, "calendar"), "calendar");
  assert.equal(S.sichtbarerTab(klick, null), "pipeline");
  assert.equal(S.sichtbarerTab({ tab: "calendar", urlTab: null }, null), "calendar");
});

// ═══ R10: Lauf-ID und Ausgang ═══

test("R10: neueLaufId liefert eine v4-UUID im Vertragsformat, je Aufruf neu", () => {
  const a = S.neueLaufId();
  const b = S.neueLaufId();
  assert.match(a, LAUF_ID);
  assert.match(a, UUID_V4);
  assert.notEqual(a, b);
});

test("R10: ohne randomUUID (kein sicherer Kontext) eine v4-UUID aus getRandomValues", () => {
  const nurZufall = { getRandomValues: (feld) => globalThis.crypto.getRandomValues(feld) };
  const id = S.neueLaufId(nurZufall);
  assert.match(id, UUID_V4);
  assert.match(id, LAUF_ID);
});

test("R10: ohne Zufallsquelle oder mit ungültiger ID keine Lauf-ID (dann kein Lauf)", () => {
  // undefined setzt den Standardwert (globalThis.crypto) ein; "keine Quelle" ist hier null bzw. {}.
  assert.equal(S.neueLaufId(null), null);
  assert.equal(S.neueLaufId({}), null);
  assert.equal(S.neueLaufId({ randomUUID: () => "kurz" }), null);
  assert.equal(S.neueLaufId({ randomUUID: () => "mit leerzeichen 123" }), null);
});

const ERGEBNIS = {
  pipeline: "content-first",
  contentId: 41,
  status: "complete",
  steps: ["researcher", "scribe", "counsel", "publisher", "amplifier"].map((agent) => ({ agent, status: "done" })),
};

test("R10: 200 mit lesbaren Schritten ist das Ergebnis", () => {
  const a = S.werteLaufAntwortAus(200, ERGEBNIS);
  assert.equal(a.art, "ergebnis");
  assert.equal(a.ergebnis.contentId, 41);
  assert.equal(S.werteLaufAntwortAus(200, { ...ERGEBNIS, status: "fehler" }).art, "ergebnis");
  assert.equal(S.werteLaufAntwortAus(200, { ...ERGEBNIS, status: "abgelehnt" }).art, "ergebnis");
});

for (const [name, daten] of [
  ["kein JSON", null],
  ["JSON ohne steps", { fehler: "x" }],
  ["steps kein Array", { status: "complete", steps: "x" }],
  ["Schritt ohne agent", { status: "complete", steps: [{ status: "done" }] }],
  ["ohne status", { steps: [] }],
  ["Liste statt Objekt", [1, 2]],
]) {
  test(`R10: 200, ${name} → Ausgang unbekannt, nie "abgewiesen"`, () => {
    const a = S.werteLaufAntwortAus(200, daten);
    assert.equal(a.art, "unbekannt");
    assert.ok(a.text.startsWith(S.AUSGANG_UNBEKANNT), a.text);
    assert.doesNotMatch(a.text, /abgewiesen/i);
  });
}

test("R10: Meldungstext bei unbekanntem Ausgang ist wörtlich der vereinbarte", () => {
  assert.equal(S.AUSGANG_UNBEKANNT, "Ausgang unbekannt — der Lauf kann noch laufen, Content-Tab prüfen");
});

test("R10: 409 heißt \"Lauf existiert bereits (#id, Status)\"", () => {
  const a = S.werteLaufAntwortAus(409, { fehler: "Lauf existiert bereits", content_id: 123, status: "entwurf" });
  assert.equal(a.art, "existiert");
  assert.equal(a.text, "Lauf existiert bereits (#123, Entwurf)");
  assert.equal(a.contentId, 123);
  const b = S.werteLaufAntwortAus(409, { fehler: "x", content_id: "77", status: "zur_freigabe" });
  assert.equal(b.text, "Lauf existiert bereits (#77, Zur Freigabe)");
  const c = S.werteLaufAntwortAus(409, { fehler: "x" });
  assert.equal(c.art, "existiert");
  assert.equal(c.contentId, null);
  assert.match(c.text, /^Lauf existiert bereits \(#Nummer nicht gemeldet, Status nicht gemeldet\)$/);
  const d = S.werteLaufAntwortAus(409, { content_id: 5, status: "irgendwas" });
  assert.equal(d.text, "Lauf existiert bereits (#5, irgendwas)");
});

for (const [status, daten, erwartet] of [
  [400, { fehler: "platform, format und (topic oder objekt_slug) sind erforderlich" }, /HTTP 400.*erforderlich/],
  [400, { fehler: "lauf_id ungültig" }, /HTTP 400.*lauf_id ungültig/],
  [401, { error: "Unauthorized" }, /HTTP 401.*Unauthorized/],
  [404, { fehler: 'Objekt "x" nicht in der Steinadel-Export-API gefunden' }, /HTTP 404.*nicht .*gefunden/],
  [422, {}, /HTTP 422.*ohne Fehlertext/],
]) {
  test(`R10: echte 4xx (${status} mit JSON) heißt "abgewiesen"`, () => {
    const a = S.werteLaufAntwortAus(status, daten);
    assert.equal(a.art, "abgewiesen");
    assert.match(a.text, /^Lauf abgewiesen/);
    assert.match(a.text, erwartet);
  });
}

test("R10: 4xx ohne lesbares JSON (z. B. HTML vom Proxy) ist unbekannt", () => {
  for (const status of [400, 404, 409, 413, 429]) {
    const a = S.werteLaufAntwortAus(status, null);
    assert.equal(a.art, "unbekannt", String(status));
    assert.ok(a.text.startsWith(S.AUSGANG_UNBEKANNT));
  }
});

test("R10: 5xx mit contentId, aber ohne Fehlertext der Route nennt die Nummer und bleibt unbekannt", () => {
  const a = S.werteLaufAntwortAus(500, { error: "Timeout im Agenten-Aufruf", contentId: 77, speicherfehler: [] });
  assert.equal(a.art, "unbekannt");
  assert.equal(a.contentId, 77);
  assert.ok(a.text.startsWith(S.AUSGANG_UNBEKANNT));
  assert.match(a.text, /Eintrag #77/);
  assert.match(a.text, /HTTP 500/);
  assert.match(a.text, /Timeout im Agenten-Aufruf/);
  const b = S.werteLaufAntwortAus(500, { error: "x", content_id: 78 });
  assert.equal(b.contentId, 78);
  assert.doesNotMatch(S.werteLaufAntwortAus(500, { error: "x" }).text, /Eintrag #/);
});

// Gegencheck 06.11.2026: Eine 5xx mit Fehlertext der Route (Feld fehler) ist die Antwort des
// synchronen Handlers — der Lauf ist zu Ende. Unbekannt bleibt nur, was nicht von der Route
// stammen muss (kein JSON, JSON ohne fehler, etwa vom Reverse-Proxy).
test("R10: 5xx ohne Fehlertext der Route ist unbekannt, keine heißt abgewiesen", () => {
  for (let status = 500; status < 600; status += 1) {
    for (const daten of [null, {}, { error: "x" }, { fehler: "   " }, { fehler: 3, contentId: 3 }]) {
      const a = S.werteLaufAntwortAus(status, daten);
      assert.equal(a.art, "unbekannt", `${status} ${JSON.stringify(daten)}`);
      assert.ok(a.text.startsWith(S.AUSGANG_UNBEKANNT));
      assert.doesNotMatch(a.text, /abgewiesen/i);
    }
  }
  assert.match(S.werteLaufAntwortAus(502, null).text, /HTTP 502 ohne lesbare Antwort/);
});

test("R10: 5xx der Route ohne Eintrag heißt 'nicht gestartet', mit Eintrag 'abgebrochen' — nie 'kann noch laufen'", () => {
  for (let status = 500; status < 600; status += 1) {
    const n = S.werteLaufAntwortAus(status, { fehler: "Steinadel-Export nicht lesbar: Quelle antwortete mit HTTP 401 (HTTP 502)" });
    assert.equal(n.art, "nicht_gestartet", String(status));
    assert.equal(n.text, `Lauf nicht gestartet (HTTP ${status}): Steinadel-Export nicht lesbar: Quelle antwortete mit HTTP 401 (HTTP 502)`);
    const b = S.werteLaufAntwortAus(status, { fehler: "Timeout im Agenten-Aufruf", contentId: 77, status: "fehler", speicherfehler: [] });
    assert.equal(b.art, "abgebrochen", String(status));
    assert.equal(b.contentId, 77);
    assert.equal(b.text, `Lauf abgebrochen (HTTP ${status}, Eintrag #77): Timeout im Agenten-Aufruf`);
    for (const a of [n, b]) {
      assert.doesNotMatch(a.text, /kann noch laufen|nicht erreichbar|abgewiesen/i);
    }
  }
});

test("Prüflauf: Wiederholung — Antworten ohne Ergebnis lassen den früheren Versuch unbekannt", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  for (const [status, daten] of [
    [500, { fehler: "Lauf-ID nicht prüfbar: x — Lauf nicht gestartet" }],
    [502, { fehler: "Steinadel-Export nicht lesbar: x" }],
    [500, { fehler: "Doppellauf-Prüfung fehlgeschlagen: x", contentId: 9, status: "fehler" }],
    [404, { fehler: 'Objekt "x" nicht in der Steinadel-Export-API gefunden' }],
  ]) {
    const einzeln = S.werteLaufAntwortAus(status, daten);
    const wiederholt = S.ausgangBeiWiederholung(einzeln, true);
    assert.equal(wiederholt.art, "unbekannt", `${status} ${einzeln.art}`);
    assert.ok(wiederholt.text.startsWith(`${S.AUSGANG_UNBEKANNT} (früherer Versuch mit dieser Lauf-ID) · Dieser Versuch: `));
    assert.ok(wiederholt.text.endsWith(einzeln.text));
    assert.equal(S.laufIdNachAusgang(wiederholt, id), id, "Lauf-ID bleibt");
    assert.deepEqual(S.ausgangBeiWiederholung(einzeln, false), einzeln, "ohne Wiederholung unverändert");
  }
  for (const bekannt of [S.werteLaufAntwortAus(409, { content_id: 3, status: "entwurf" }), S.werteLaufAntwortAus(200, ERGEBNIS)]) {
    assert.deepEqual(S.ausgangBeiWiederholung(bekannt, true), bekannt, bekannt.art);
  }
});

test("Prüflauf: 5xx mit status 'fehler' ohne lesbare Nummer heißt 'abgebrochen', nicht 'nicht gestartet'", () => {
  const a = S.werteLaufAntwortAus(500, { fehler: "TypeError: x", status: "fehler", contentId: "kaputt" });
  assert.equal(a.art, "abgebrochen");
  assert.equal(a.contentId, null);
  assert.equal(a.text, "Lauf abgebrochen (HTTP 500, Eintragsnummer nicht lesbar): TypeError: x");
});

test("Prüflauf: Doppellauf-500 der Route (mit Schritten) ist ein Ergebnis — alle Stufen 'nicht ausgeführt', Kosten 'nicht gemeldet'", () => {
  const steps = ["researcher", "scribe", "counsel", "publisher", "amplifier"].map((agent) => ({ agent, status: "pending" }));
  const a = S.werteLaufAntwortAus(500, {
    pipeline: "content-first",
    contentId: 12,
    status: "fehler",
    steps,
    summary: { total_cost_usd: null, kosten_unvollstaendig: false, total_duration_ms: 0, completed: "0/5" },
    speicherfehler: [],
    fehler: "Doppellauf-Prüfung fehlgeschlagen: eigene Zeile nicht gefunden — Lauf nicht gestartet",
  });
  assert.equal(a.art, "ergebnis");
  assert.equal(S.laufKostenText(a.ergebnis), "nicht gemeldet");
  assert.equal(
    S.flussHinweis(a.ergebnis),
    "Abbruch: Doppellauf-Prüfung fehlgeschlagen: eigene Zeile nicht gefunden — Lauf nicht gestartet — RESEARCHER, SCRIBE, COUNSEL, PUBLISHER, AMPLIFIER wurden nicht ausgeführt."
  );
  assert.equal(S.stufenEtikett("ergebnis", "pending").text, "nicht ausgeführt");
});

test("R10: 500 der Route mit Schritten ist ein Ergebnis mit Status fehler (Kosten bleiben sichtbar)", () => {
  const steps = [
    { agent: "researcher", status: "done", output: "r", cost: 0.01 },
    { agent: "scribe", status: "done", output: "s", cost: 0.02 },
    { agent: "counsel", status: "done", output: "URTEIL: FREIGABE", cost: 0.01 },
    { agent: "publisher", status: "done", output: "p", cost: 0.01 },
    { agent: "amplifier", status: "done", output: "a", cost: 0.01 },
  ];
  const vermerk = { stufe: "pipeline", grund: "Status zur_freigabe nicht gespeichert", detail: "update fehlgeschlagen" };
  const a = S.werteLaufAntwortAus(500, {
    fehler: "Status zur_freigabe nicht gespeichert (Content #9) — Eintrag prüfen",
    fehler_vermerk: vermerk,
    contentId: 9,
    status: "fehler",
    steps,
    summary: { total_cost_usd: 0.06, kosten_unvollstaendig: false },
  });
  assert.equal(a.art, "ergebnis");
  assert.deepEqual(a.ergebnis.fehler, vermerk);
  assert.equal(S.laufKostenText(a.ergebnis), "$0.0600");
  assert.equal(S.flussHinweis(a.ergebnis), "Abbruch in Stufe PIPELINE: Status zur_freigabe nicht gespeichert (update fehlgeschlagen).");
  // Ohne Vermerk zählt der Text der Route als Grund (nicht "ohne Grund").
  const ohneVermerk = S.werteLaufAntwortAus(500, { fehler: "Status nicht gespeichert", contentId: 9, status: "fehler", steps });
  assert.equal(S.flussHinweis(ohneVermerk.ergebnis), "Abbruch: Status nicht gespeichert.");
});

test("R10: ungültige Nummern werden nicht genannt", () => {
  for (const id of [0, -3, 1.5, "0", "12a", "", null, true]) {
    const a = S.werteLaufAntwortAus(500, { error: "x", contentId: id });
    assert.equal(a.contentId, null, String(id));
    const b = S.werteLaufAntwortAus(500, { fehler: "x", contentId: id });
    assert.equal(b.art, "nicht_gestartet", String(id));
    assert.doesNotMatch(b.text, /Eintrag #/);
  }
});

test("R10: Netzwerkfehler ist unbekannt", () => {
  const a = S.netzwerkAusgang(new TypeError("Failed to fetch"));
  assert.equal(a.art, "unbekannt");
  assert.equal(a.text, `${S.AUSGANG_UNBEKANNT} · Netzwerkfehler: Failed to fetch`);
  assert.equal(S.netzwerkAusgang("kaputt").art, "unbekannt");
});

test("R10: Lauf-ID bleibt nur nach unbekanntem Ausgang", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  assert.equal(S.laufIdNachAusgang(S.netzwerkAusgang(new Error("x")), id), id);
  assert.equal(S.laufIdNachAusgang(S.werteLaufAntwortAus(502, null), id), id);
  assert.equal(S.laufIdNachAusgang(S.werteLaufAntwortAus(200, ERGEBNIS), id), null);
  assert.equal(S.laufIdNachAusgang(S.werteLaufAntwortAus(409, { content_id: 1, status: "entwurf" }), id), null);
  assert.equal(S.laufIdNachAusgang(S.werteLaufAntwortAus(400, { fehler: "x" }), id), null);
  assert.equal(S.laufIdNachAusgang(S.werteLaufAntwortAus(502, { fehler: "Steinadel-Export nicht lesbar: x" }), id), null);
  assert.equal(S.laufIdNachAusgang(S.werteLaufAntwortAus(500, { fehler: "x", contentId: 4, status: "fehler" }), id), null);
  assert.equal(S.laufIdNachAusgang(S.werteLaufAntwortAus(500, { error: "x", contentId: 4 }), id), id);
  assert.equal(S.laufIdNachAusgang({ art: "nicht_gesendet", text: "x" }, id), null);
});

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

const EINGABEN = { topic: "", platform: "x", format: "thread", category: "ki_automation", objektSlug: "villa-x" };

test("R10: sendeLauf schickt die lauf_id mit und ordnet die Antwort ein", async () => {
  const gesendet = [];
  const holen = async (url, init) => {
    gesendet.push({ url, init });
    return antwort(200, ERGEBNIS);
  };
  const a = await S.sendeLauf(holen, EINGABEN, "abcdef12-0000-4000-8000-000000000000");
  assert.equal(a.art, "ergebnis");
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0].url, "/api/content/pipeline");
  assert.equal(gesendet[0].init.method, "POST");
  const body = JSON.parse(gesendet[0].init.body);
  assert.equal(body.lauf_id, "abcdef12-0000-4000-8000-000000000000");
  assert.equal(body.objekt_slug, "villa-x");
  assert.equal("topic" in body, false);
  assert.equal(body.platform, "x");
});

test("R10: sendeLauf wirft nie — Abbruch, kaputter Körper und 5xx sind unbekannt", async () => {
  const wirft = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal((await S.sendeLauf(wirft, EINGABEN, "abcdefgh")).art, "unbekannt");
  const kaputt = async () => antwort(200, new SyntaxError("Unexpected token <"));
  assert.equal((await S.sendeLauf(kaputt, EINGABEN, "abcdefgh")).art, "unbekannt");
  const proxy = async () => antwort(504, new SyntaxError("Unexpected token <"));
  assert.equal((await S.sendeLauf(proxy, EINGABEN, "abcdefgh")).art, "unbekannt");
  const abgewiesen = async () => antwort(400, { fehler: "lauf_id ungültig" });
  assert.equal((await S.sendeLauf(abgewiesen, EINGABEN, "abcdefgh")).art, "abgewiesen");
  const export502 = async () => antwort(502, { fehler: "Export-Objekt unvollständig: preis" });
  const n = await S.sendeLauf(export502, EINGABEN, "abcdefgh");
  assert.equal(n.art, "nicht_gestartet");
  assert.equal(n.text, "Lauf nicht gestartet (HTTP 502): Export-Objekt unvollständig: preis");
});

// ═══ R4 / R2 / R24: Freigabe-Lage ═══

test("R4: Freigeben nur bei FREIGABE, Mindestlänge und ohne geschützten Namen", () => {
  assert.equal(S.freigabeLage(eintrag()).pruefung.freigebbar, true);
  for (const [name, e, grund] of [
    ["Ablehnung", eintrag({ review_notes: "URTEIL: ABLEHNUNG" }), /COUNSEL-Urteil ABLEHNUNG/],
    ["Altzeile mit Verneinung", eintrag({ review_notes: "URTEIL: FREIGABE nicht möglich" }), /COUNSEL-Urteil UNKLAR/],
    ["fett ABLEHNUNG", eintrag({ review_notes: "URTEIL: **ABLEHNUNG**" }), /COUNSEL-Urteil ABLEHNUNG/],
    ["ohne review_notes", eintrag({ review_notes: null }), /COUNSEL-Urteil UNKLAR/],
    ["Text leer", eintrag({ body: "   " }), /Freigabetext leer/],
    ["Text null", eintrag({ body: null }), /Freigabetext leer/],
    ["Text zu kurz", eintrag({ body: "x".repeat(MIN_FREIGABE_ZEICHEN - 1) }), /zu kurz/],
    ["Name im Text", eintrag({ body: `${TEXT} Daten aus dem ${NAME}-Export.` }), /geschützten Namen/],
  ]) {
    const lage = S.freigabeLage(e);
    assert.equal(lage.pruefung.freigebbar, false, name);
    assert.match(lage.pruefung.grund, grund, name);
  }
});

test("R2: Bezug zum Freigabetext — gleich nur durch direkten Vergleich", () => {
  assert.equal(S.freigabeLage(eintrag()).bezug, "identisch");
  assert.equal(S.freigabeLage(eintrag({ scribe: `  ${TEXT}\n` })).bezug, "identisch");
  assert.equal(S.freigabeLage(eintrag({ scribe: "Vorfassung von SCRIBE, deutlich anders." })).bezug, "abweichend");
  assert.equal(S.freigabeLage(eintrag({ scribe: null })).bezug, "nicht_pruefbar");
  assert.equal(S.freigabeLage(eintrag({ scribe: null, hinweis: { identisch: false } })).bezug, "abweichend");
  assert.equal(S.freigabeLage(eintrag({ scribe: null, hinweis: { identisch: true } })).bezug, "nicht_pruefbar");
  assert.equal(S.freigabeLage(eintrag({ body: "" })).bezug, "kein_text");
  // Direkter Vergleich schlägt den Vermerk
  assert.equal(S.freigabeLage(eintrag({ hinweis: { identisch: false } })).bezug, "identisch");
  // Fremde Stufe an Position 1 zählt nicht als geprüfter Text
  const fremd = eintrag();
  fremd.metadata.steps[1] = { agent: "publisher", output: TEXT };
  assert.equal(S.freigabeLage(fremd).bezug, "nicht_pruefbar");
  // metadata kaputt oder fehlend
  assert.equal(S.freigabeLage({ body: TEXT, review_notes: FREIGABE_NOTES, metadata: null }).bezug, "nicht_pruefbar");
  assert.equal(S.freigabeLage({ body: TEXT, review_notes: FREIGABE_NOTES, metadata: "x" }).bezug, "nicht_pruefbar");
});

test("R2: grünes FREIGABE nur, wenn COUNSEL genau den Freigabetext geprüft hat", () => {
  const gruen = S.urteilAnzeige("FREIGABE", "identisch");
  assert.equal(gruen.text, "FREIGABE");
  assert.equal(gruen.farbe, "var(--gp-emerald)");
  const vorfassung = S.urteilAnzeige("FREIGABE", "abweichend");
  assert.equal(vorfassung.text, "COUNSEL prüfte die Vorfassung · Freigabetext ungeprüft");
  assert.equal(vorfassung.farbe, "var(--gp-amber)");
  for (const bezug of ["abweichend", "nicht_pruefbar", "kein_text"]) {
    const a = S.urteilAnzeige("FREIGABE", bezug);
    assert.notEqual(a.farbe, "var(--gp-emerald)", bezug);
    assert.notEqual(a.text, "FREIGABE", bezug);
  }
  assert.equal(S.urteilAnzeige("ABLEHNUNG", "identisch").farbe, "var(--gp-rose)");
  assert.equal(S.urteilAnzeige("UNKLAR", "identisch").farbe, "var(--gp-amber)");
  assert.equal(S.bezugHinweis("abweichend"), "Freigabetext ungeprüft — COUNSEL prüfte die Vorfassung");
  assert.equal(S.bezugHinweis("identisch"), null);
});

test("R2: Bezug im frischen Pipeline-Ergebnis über SCRIBE- gegen PUBLISHER-Text", () => {
  const steps = (scribe, publisher) => [
    { agent: "researcher", status: "done", output: "r" },
    { agent: "scribe", status: "done", output: scribe },
    { agent: "counsel", status: "done", output: FREIGABE_NOTES },
    { agent: "publisher", status: "done", output: publisher },
    { agent: "amplifier", status: "done", output: "a" },
  ];
  assert.equal(S.ergebnisBezug({ status: "complete", steps: steps(TEXT, TEXT) }), "identisch");
  assert.equal(S.ergebnisBezug({ status: "complete", steps: steps(TEXT, `${TEXT} #Hashtag`) }), "abweichend");
  assert.equal(S.ergebnisBezug({ status: "fehler", steps: steps(TEXT, TEXT) }), "kein_text");
});

test("R24: Name im Freigabetext wird erkannt, COUNSEL-Text und Servertexte maskiert", () => {
  assert.equal(S.freigabeLage(eintrag({ body: `${TEXT} ${NAME}` })).nameImText, true);
  assert.equal(S.freigabeLage(eintrag()).nameImText, false);
  const meldung = S.fehlerMeldung(500, { fehler: `Lesen fehlgeschlagen: ${NAME.toUpperCase()}_EXPORT_TOKEN` });
  assert.doesNotMatch(meldung, ENTHAELT_NAMEN);
  assert.ok(meldung.includes(NAMENS_ERSATZ));
  // 502 hat keine eigene Ursachen-Bezeichnung mehr (Gegencheck 06.11.2026).
  assert.equal(S.fehlerMeldung(502, null), "Fehler (HTTP 502): ohne Fehlertext");
  for (const [status, daten] of [
    [502, { fehler: `Steinadel-Export nicht lesbar: ${NAME} weg` }],
    [500, { fehler: `${NAME} weg`, contentId: 5, status: "fehler" }],
    [502, { error: `${NAME} weg` }],
    [400, { fehler: `${NAME} weg` }],
  ]) {
    const a = S.werteLaufAntwortAus(status, daten);
    assert.doesNotMatch(a.text, ENTHAELT_NAMEN, `${status} ${a.art}`);
    assert.ok(a.text.includes(NAMENS_ERSATZ), `${status} ${a.art}`);
  }
  assert.doesNotMatch(S.vermerkText({ stufe: "counsel", grund: `Regel 1.2 (${NAME}-Export)` }), ENTHAELT_NAMEN);
  assert.doesNotMatch(S.vermerkText(`alt: ${NAME}`), ENTHAELT_NAMEN);
});

test("R24: Im Pipeline-Ergebnis bleibt nur der Freigabetext (PUBLISHER eines Laufs zur Freigabe) roh", () => {
  const counsel = S.stufenAusgabe({ agent: "counsel", status: "done", output: `Regel 1.2: ${NAME}-Export\nURTEIL: FREIGABE` }, "complete");
  assert.doesNotMatch(counsel.text, ENTHAELT_NAMEN);
  assert.equal(counsel.warnung, null);
  for (const laufStatus of ["complete", "partial"]) {
    const publisher = S.stufenAusgabe({ agent: "publisher", status: "done", output: `${TEXT} ${NAME}` }, laufStatus);
    assert.match(publisher.text, ENTHAELT_NAMEN, laufStatus);
    assert.equal(publisher.warnung, "Der Freigabetext enthält einen geschützten Namen — Freigabe gesperrt.", laufStatus);
  }
  const ohneName = S.stufenAusgabe({ agent: "publisher", status: "done", output: TEXT }, "complete");
  assert.equal(ohneName.text, TEXT);
  assert.equal(ohneName.warnung, null);
  const scribe = S.stufenAusgabe({ agent: "scribe", status: "done", output: `x ${NAME}` }, "complete");
  assert.doesNotMatch(scribe.text, ENTHAELT_NAMEN);
  assert.equal(scribe.warnung, null);
  assert.equal(S.stufenAusgabe({ agent: "scribe", status: "pending" }, "complete"), null);
  // Kürzen nach dem Maskieren: kein halber Name am Schnitt
  const lang = S.stufenAusgabe({ agent: "counsel", status: "done", output: `${"a".repeat(1996)}${NAME}` }, "complete");
  assert.doesNotMatch(lang.text, /imm[ou]/i);
});

test("R24: PUBLISHER-Ausgabe eines abgebrochenen Laufs (Namensschutz) ist kein Freigabetext und wird maskiert", () => {
  // pipeline/route.ts: Namensschutz-Abbruch → HTTP 200, status "fehler", PUBLISHER-Schritt "error",
  // output bleibt als Beleg erhalten, body wird nicht geschrieben.
  const abbruch = S.stufenAusgabe(
    { agent: "publisher", status: "error", fehler: "Namensschutz", output: `${TEXT} Daten aus dem ${NAME}-Export.` },
    "fehler"
  );
  assert.doesNotMatch(abbruch.text, ENTHAELT_NAMEN);
  assert.ok(abbruch.text.includes(NAMENS_ERSATZ));
  assert.equal(abbruch.warnung, "PUBLISHER-Ausgabe enthielt einen geschützten Namen — Lauf abgebrochen, nicht zur Freigabe gestellt.");
  assert.doesNotMatch(abbruch.warnung, /Freigabetext enthält/);
  // Auch eine fertige PUBLISHER-Stufe ist ohne Lauf zur Freigabe kein Freigabetext (z. B. AMPLIFIER gescheitert)
  const amplifierFehler = S.stufenAusgabe({ agent: "publisher", status: "done", output: `${TEXT} ${NAME}` }, "fehler");
  assert.doesNotMatch(amplifierFehler.text, ENTHAELT_NAMEN);
  // Widersprüchliche Antwort (complete, Stufe nicht fertig) und fremde Status: maskiert, keine Behauptung über einen Abbruch
  for (const [stufe, laufStatus] of [["error", "complete"], ["done", "abgelehnt"], ["done", undefined], ["done", "unsinn"]]) {
    const a = S.stufenAusgabe({ agent: "publisher", status: stufe, output: `${TEXT} ${NAME}` }, laufStatus);
    assert.doesNotMatch(a.text, ENTHAELT_NAMEN, `${stufe}/${laufStatus}`);
    assert.equal(a.warnung, "PUBLISHER-Ausgabe enthält einen geschützten Namen — nicht als Freigabetext bestätigt.", `${stufe}/${laufStatus}`);
  }
  // Ohne Namen im abgebrochenen Lauf: keine Warnung, Text unverändert
  const ohne = S.stufenAusgabe({ agent: "publisher", status: "error", output: TEXT }, "fehler");
  assert.equal(ohne.text, TEXT);
  assert.equal(ohne.warnung, null);
  assert.equal(S.laufZurFreigabe("complete"), true);
  assert.equal(S.laufZurFreigabe("partial"), true);
  for (const s of ["fehler", "abgelehnt", "zur_freigabe", "", null, undefined]) assert.equal(S.laufZurFreigabe(s), false, String(s));
});

test("R24: Werte aus DB und Server werden für die Anzeige maskiert, leer bleibt leer", () => {
  assert.equal(S.maskiertWert(null), "");
  assert.equal(S.maskiertWert(undefined), "");
  assert.equal(S.maskiertWert(`Bezug zu ${NAME} entfernen`), `Bezug zu ${NAMENS_ERSATZ} entfernen`);
  assert.equal(S.maskiertWert(42), "42");
  assert.equal(S.maskiertWert("betreiber-session"), "betreiber-session");
  // Unlesbarer Zeitstempel erscheint als Text — dann maskiert
  assert.equal(S.zeitText(`kein Datum ${NAME}`), `kein Datum ${NAMENS_ERSATZ}`);
  assert.equal(S.zeitText(null), "nicht gespeichert");
});

// ═══ R19: Metriken ═══

test("R19: performance ohne durch ist als Erfassung vor Stufe 1 gekennzeichnet", () => {
  const alt = S.metrikenText({ impressions: 0, likes: 0, erfasst_am: "2026-10-01T10:00:00Z" });
  assert.match(alt, /^Erfassung vor Stufe 1, 0 kann Platzhalter sein/);
  assert.match(alt, /0 Impressions/);
  const neu = S.metrikenText({ impressions: 100, erfasst_am: "2026-11-06T10:00:00Z", durch: "betreiber-session" });
  assert.doesNotMatch(neu, /vor Stufe 1/);
  assert.match(neu, /100 Impressions · Likes nicht erfasst/);
  assert.equal(S.metrikenText(null), "noch nicht erfasst");
  assert.equal(S.metrikenText({}), "noch nicht erfasst");
  assert.match(S.metrikenText({ impressions: 0 }), /^Erfassung vor Stufe 1.*Zeitpunkt nicht gespeichert/);
  assert.match(S.metrikenText({ likes: 3, erfasst_am: "2026-11-06T10:00:00Z", durch: "" }), /vor Stufe 1/);
});

// ═══ R31: Hinweis "insgesamt warten N" ═══

test("R31: Hinweis nur mit frischer Zahl, nie bei Lesefehler", () => {
  const basis = { wartendGesamt: 7, lesefehler: null, listeFehler: null, listeLaedt: false, inListe: 2, stand: null, listeVoll: true };
  assert.match(S.wartendHinweis(basis), /insgesamt warten 7 auf Freigabe/);
  assert.equal(S.wartendHinweis({ ...basis, lesefehler: "HTTP 401" }), null);
  assert.equal(S.wartendHinweis({ ...basis, wartendGesamt: null }), null);
  assert.equal(S.wartendHinweis({ ...basis, listeFehler: "x" }), null);
  assert.equal(S.wartendHinweis({ ...basis, listeLaedt: true }), null);
  assert.equal(S.wartendHinweis({ ...basis, inListe: 7 }), null);
  assert.match(S.wartendHinweis({ ...basis, stand: "2026-11-06T10:00:00Z" }), /Stand /);
  // Gegencheck 06.11.2026: Erreicht die Liste die 50er-Grenze nicht, ist sie nicht die Ursache.
  const kurz = S.wartendHinweis({ ...basis, listeVoll: false });
  assert.doesNotMatch(kurz, /letzten 50/);
  assert.equal(kurz, "Liste und Server-Zählung weichen ab: in der Liste 2 wartend, laut Server 7 — Seite neu laden.");
  assert.equal(S.wartendHinweis({ ...basis, listeVoll: false, inListe: 7 }), null);
});

test("Gegencheck: Zusatz zum Objektlisten-Fehler nur, wo er stimmt", () => {
  for (const art of ["konfiguration", "nicht_erreichbar", "quelle_fehler"]) {
    assert.equal(S.objekteHinweisZusatz(art), " — ein Lauf ist nur ohne Objekt möglich.", art);
  }
  assert.match(S.objekteHinweisZusatz("nicht_angemeldet"), /ohne gültige Sitzung startet auch kein Lauf/);
  assert.doesNotMatch(S.objekteHinweisZusatz("nicht_angemeldet"), /nur ohne Objekt/);
  assert.equal(S.objekteHinweisZusatz("unbekannt"), "");
});

// ═══ R34: Pipeline-Fluss ═══

test("R34: Nach Laufende heißen nicht gelaufene Stufen \"nicht ausgeführt\", während des Laufs \"läuft\"", () => {
  assert.equal(S.stufenEtikett("ergebnis", "pending").text, "nicht ausgeführt");
  assert.equal(S.stufenEtikett("ergebnis", undefined).text, "nicht ausgeführt");
  assert.equal(S.stufenEtikett("ergebnis", "done").text, "fertig");
  assert.equal(S.stufenEtikett("ergebnis", "error").text, "Fehler");
  for (const status of [undefined, "pending", "done", "error"]) {
    assert.equal(S.stufenEtikett("laeuft", status).text, "läuft");
  }
  assert.equal(S.stufenEtikett("unbekannt", undefined).text, "unbekannt");
  for (const lage of ["kein_lauf", "laeuft", "ergebnis", "unbekannt"]) {
    for (const status of [undefined, "pending", "running", "done", "error"]) {
      assert.notEqual(S.stufenEtikett(lage, status).text, "WAIT", `${lage}/${status}`);
    }
  }
});

function lauf(status, stati, extra = {}) {
  const namen = ["researcher", "scribe", "counsel", "publisher", "amplifier"];
  return { status, steps: namen.map((agent, i) => ({ agent, status: stati[i] })), ...extra };
}

test("R34: Hinweiszeile bei status fehler nennt die gescheiterte Stufe und die nicht ausgeführten", () => {
  const scribe = S.flussHinweis(
    lauf("fehler", ["done", "error", "pending", "pending", "pending"], {
      fehler: { stufe: "scribe", grund: "Antwort abgeschnitten" },
    })
  );
  assert.equal(scribe, "Abbruch in Stufe SCRIBE: Antwort abgeschnitten — COUNSEL, PUBLISHER, AMPLIFIER wurden nicht ausgeführt.");
  const ohneVermerk = S.flussHinweis(lauf("fehler", ["error", "pending", "pending", "pending", "pending"]));
  assert.match(ohneVermerk, /^Abbruch in Stufe RESEARCHER: ohne Grund — SCRIBE, COUNSEL, PUBLISHER, AMPLIFIER wurden nicht ausgeführt\.$/);
  const letzte = S.flussHinweis(
    lauf("fehler", ["done", "done", "done", "done", "error"], { fehler: { stufe: "amplifier", grund: "x" } })
  );
  assert.equal(letzte, "Abbruch in Stufe AMPLIFIER: x.");
  const abgelehnt = S.flussHinweis(
    lauf("abgelehnt", ["done", "done", "done", "pending", "pending"], { counsel: { urteil: "ABLEHNUNG" } })
  );
  assert.equal(abgelehnt, "COUNSEL-Urteil ABLEHNUNG — PUBLISHER, AMPLIFIER wurden nicht ausgeführt.");
  assert.equal(S.flussHinweis(lauf("complete", ["done", "done", "done", "done", "done"])), null);
});

test("R24: Stufennamen aus der Server-Antwort stehen in der Hinweiszeile maskiert", () => {
  const r = {
    status: "fehler",
    fehler: { stufe: `${NAME}-stufe`, grund: "x" },
    steps: [
      { agent: "researcher", status: "done" },
      { agent: `${NAME}-zwei`, status: "pending" },
    ],
  };
  const hinweis = S.flussHinweis(r);
  assert.doesNotMatch(hinweis, ENTHAELT_NAMEN);
  assert.equal(hinweis, `Abbruch in Stufe ${NAMENS_ERSATZ}-STUFE: x — ${NAMENS_ERSATZ}-ZWEI wurde nicht ausgeführt.`);
  const ohneVermerk = S.flussHinweis({ status: "fehler", steps: [{ agent: `${NAME}`, status: "error" }] });
  assert.doesNotMatch(ohneVermerk, ENTHAELT_NAMEN);
});

// ═══ Kosten: nie 0 als Platzhalter ═══

test("Kosten: ohne jede Angabe \"nicht gemeldet\", mit Lücken \"mindestens\"", () => {
  const r = (kosten, summary) => ({
    status: "fehler",
    steps: kosten.map((cost, i) => ({ agent: `s${i}`, status: cost === "p" ? "pending" : "done", cost: cost === "p" ? undefined : cost })),
    summary,
  });
  assert.equal(S.laufKostenText(r([null, null, "p"], { total_cost_usd: 0, kosten_unvollstaendig: true })), "nicht gemeldet");
  assert.equal(S.laufKostenText(r([0.01, null, "p"], { total_cost_usd: 0.01, kosten_unvollstaendig: true })), "mindestens $0.0100 · 1 Stufe ohne Angabe");
  assert.equal(S.laufKostenText(r([0.01, 0.02], { total_cost_usd: 0.03, kosten_unvollstaendig: false })), "$0.0300");
  assert.equal(S.laufKostenText(r([0.01, 0.02], undefined)), "$0.0300");
});

// ═══ Gesamtprüfung 06.11.2026: Untergrenze "mindestens" abgerundet, nie über der Summe ═══

test("Kosten: 'mindestens' rundet ab; unter $0.0001 'mehr als $0'", () => {
  const r = (total) => ({
    status: "fehler",
    steps: [
      { agent: "s0", status: "done", cost: total },
      { agent: "s1", status: "error", cost: null },
    ],
    summary: { total_cost_usd: total, kosten_unvollstaendig: true },
  });
  assert.equal(S.laufKostenText(r(0.00016)), "mindestens $0.0001 · 1 Stufe ohne Angabe");
  assert.equal(S.laufKostenText(r(0.01239)), "mindestens $0.0123 · 1 Stufe ohne Angabe");
  assert.equal(S.laufKostenText(r(0.00003)), "mehr als $0 (gemeldet unter $0.0001) · 1 Stufe ohne Angabe");
});
