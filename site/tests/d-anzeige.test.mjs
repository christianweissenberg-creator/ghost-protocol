// Tests für die reinen Anzeige-Helfer der Gruppe D (lib/types.ts) — Stufe 1, 06.11.2026.
// Befunde R3 (letzte Aktivierung statt Registerstatus), R9 (Tier-Rückfall), R11/R15 (Preise
// aus der Tabelle, Modellklassen), R12 (Realtime-Zustand), R13 (Persona), R14 (Metriken),
// R22 (Aktivierungsantwort). Lauf: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_REGISTRY,
  TIER_META,
  TIER_UNBEKANNT,
  aggregiereMetriken,
  aktivierungsAnzeige,
  formatiereMetrikWert,
  formatierePreis,
  formatiereUsd4,
  kostenMonatAnzeige,
  leseRealtimeZustand,
  metaWertText,
  metrikEinheit,
  modellKlasse,
  realtimeAnzeige,
  registerEintragFuer,
  tierMetaFuer,
  werteAktivierungAus,
} from "../src/lib/types.ts";
import { preisJeMillion } from "../src/lib/kosten.ts";

// ── R9: Tier-Rückfall ──

test("tierMetaFuer: bekannte Tiers 0–3 liefern TIER_META", () => {
  for (const t of [0, 1, 2, 3]) assert.equal(tierMetaFuer(t), TIER_META[t]);
});

for (const t of [4, -1, 1.5, Number.NaN, null, undefined, "1", "constructor", {}]) {
  test(`tierMetaFuer: ${String(t)} → Rückfall statt undefined`, () => {
    const m = tierMetaFuer(t);
    assert.equal(m, TIER_UNBEKANNT);
    assert.equal(typeof m.label, "string");
    assert.equal(typeof m.color, "string");
  });
}

// ── R13: Persona ──

test("ORACLE: keine Persona mehr, Anzeige fällt auf die Rolle zurück", () => {
  const e = registerEintragFuer({ name: "ORACLE", role: "Chief Intelligence Officer" });
  assert.equal(e.persona, "Chief Intelligence Officer");
  assert.equal(e.icon, "OR");
  for (const eintrag of Object.values(AGENT_REGISTRY)) {
    assert.doesNotMatch(eintrag.persona, /Simons/);
  }
});

test("registerEintragFuer: unbekannter Name (alte trader-Zeile) bekommt Kürzel und Rolle", () => {
  const e = registerEintragFuer({ name: "TRADER", role: "Market Analyst" });
  assert.deepEqual(e, { icon: "TR", persona: "Market Analyst", tierColor: "#666" });
});

test("registerEintragFuer: 'constructor' trifft nicht Object.prototype", () => {
  const e = registerEintragFuer({ name: "constructor", role: "x" });
  assert.equal(e.persona, "x");
  assert.equal(e.icon, "co");
});

test("registerEintragFuer: vorhandene Persona bleibt", () => {
  assert.equal(registerEintragFuer({ name: "OPERATOR", role: "COO" }).persona, "Tim Cook");
});

// ── R3: letzte Aktivierung statt Registerstatus ──

const T0 = "2026-11-06T09:00:00.000Z";
const T0_PLUS_3H = "2026-11-06T12:00:00.000Z";

test("aktivierungsAnzeige: null → 'nie aktiviert', Registerstatus nur im title", () => {
  const a = aktivierungsAnzeige(null, T0, "online");
  assert.equal(a.text, "nie aktiviert");
  assert.equal(a.aktiviert, false);
  assert.match(a.titel, /Registerstatus, nicht gemessen: online/);
  assert.doesNotMatch(a.text, /online/i);
});

test("aktivierungsAnzeige: leerer Text → 'nie aktiviert'", () => {
  assert.equal(aktivierungsAnzeige("", T0).text, "nie aktiviert");
  assert.equal(aktivierungsAnzeige(undefined, T0).text, "nie aktiviert");
});

test("aktivierungsAnzeige: 'zuletzt aktiviert vor 3 h' gegen den Bezug", () => {
  const a = aktivierungsAnzeige(T0, T0_PLUS_3H, "working");
  assert.equal(a.text, "zuletzt aktiviert vor 3 h");
  assert.equal(a.aktiviert, true);
  assert.match(a.titel, /Letzte Aktivierung: /);
  assert.match(a.titel, /agents\.last_heartbeat/);
  assert.match(a.titel, /Registerstatus, nicht gemessen: working/);
  assert.doesNotMatch(a.text, /working|online/i);
});

test("aktivierungsAnzeige: ohne Bezug der absolute Zeitpunkt, kein 'vor'", () => {
  const a = aktivierungsAnzeige(T0, null);
  assert.match(a.text, /^zuletzt aktiviert /);
  assert.doesNotMatch(a.text, /vor /);
});

test("aktivierungsAnzeige: unlesbarer Zeitpunkt wird gesagt", () => {
  const a = aktivierungsAnzeige("kaputt", T0);
  assert.equal(a.text, "Aktivierungszeit unlesbar");
  assert.equal(a.aktiviert, false);
});

test("aktivierungsAnzeige: Uhrversatz (Heartbeat in der Zukunft) → 'vor < 1 min'", () => {
  assert.equal(aktivierungsAnzeige(T0_PLUS_3H, T0).text, "zuletzt aktiviert vor < 1 min");
});

// ── R11/R15: Modellklassen und Preise ──

for (const [modell, klasse] of [
  ["claude-sonnet-5", "Sonnet"],
  ["CLAUDE-SONNET-5", "Sonnet"],
  ["claude-haiku-4-5-20251001", "Haiku"],
  ["Claude-Haiku-4-5", "Haiku"],
  ["claude-opus-4", "andere"],
  ["gpt-4o", "andere"],
  ["", "andere"],
  [null, "andere"],
  [undefined, "andere"],
]) {
  test(`modellKlasse(${String(modell)}) = ${klasse} — keine 'sonst Haiku'-Regel`, () => {
    assert.equal(modellKlasse(modell), klasse);
  });
}

test("formatierePreis: Input und Output getrennt aus der Tabelle", () => {
  assert.equal(formatierePreis(preisJeMillion("claude-sonnet-5")), "Input $2,00 · Output $10,00 je Mio. Tokens");
  assert.equal(
    formatierePreis(preisJeMillion("claude-haiku-4-5-20251001")),
    "Input $1,00 · Output $5,00 je Mio. Tokens",
  );
});

test("formatierePreis: unbekanntes Modell → 'kein Tabellenpreis', kein Ersatzpreis", () => {
  assert.equal(formatierePreis(preisJeMillion("claude-opus-4")), "kein Tabellenpreis");
  assert.equal(formatierePreis(null), "kein Tabellenpreis");
});

// ── R14: Metriken ──

const M = (metric_type, value, created_at) => ({ metric_type, value, created_at });

test("aggregiereMetriken: latest ist der jüngste Wert, nicht das Maximum", () => {
  const a = aggregiereMetriken([
    M("llm_call", 0.01, "2026-11-06T12:00:00Z"),
    M("llm_call", 0.05, "2026-11-06T11:00:00Z"),
    M("llm_call", 0.02, "2026-11-06T10:00:00Z"),
  ]);
  assert.equal(a.llm_call.latest, 0.01);
  assert.equal(a.llm_call.latestAm, "2026-11-06T12:00:00Z");
  assert.equal(a.llm_call.count, 3);
  assert.ok(Math.abs(a.llm_call.sum - 0.08) < 1e-12);
});

test("aggregiereMetriken: nachweislich jüngere Zeile ersetzt auch bei falscher Reihenfolge", () => {
  const a = aggregiereMetriken([M("x", 7, "2026-11-06T10:00:00Z"), M("x", 3, "2026-11-06T12:00:00Z")]);
  assert.equal(a.x.latest, 3);
});

test("aggregiereMetriken: unlesbare Werte zählen nicht als 0", () => {
  const a = aggregiereMetriken([
    M("x", null, "2026-11-06T12:00:00Z"),
    M("x", "abc", "2026-11-06T11:00:00Z"),
    M("x", "0.5", "2026-11-06T10:00:00Z"),
  ]);
  assert.equal(a.x.unlesbar, 2);
  assert.equal(a.x.count, 1);
  assert.equal(a.x.latest, 0.5);
  assert.equal(a.x.sum, 0.5);
});

test("aggregiereMetriken: nur unlesbare Werte → latest null", () => {
  const a = aggregiereMetriken([M("x", Number.NaN, "2026-11-06T12:00:00Z")]);
  assert.equal(a.x.latest, null);
  assert.equal(a.x.unlesbar, 1);
});

test("aggregiereMetriken: '__proto__' als Typ verändert keinen Prototyp", () => {
  const a = aggregiereMetriken([M("__proto__", 1, "2026-11-06T12:00:00Z")]);
  assert.ok(Object.prototype.hasOwnProperty.call(a, "__proto__"));
  assert.equal({}.sum, undefined);
  assert.equal(Object.keys(a).length, 1);
});

test("aggregiereMetriken: leere Liste → keine Typen", () => {
  assert.deepEqual(aggregiereMetriken([]), {});
});

test("formatiereUsd4: genau 4 Nachkommastellen, Kleinstbetrag nie als 0", () => {
  assert.equal(formatiereUsd4(0.021), "$0,0210");
  assert.equal(formatiereUsd4(1.23456), "$1,2346");
  assert.equal(formatiereUsd4(0.00004), "< $0,0001");
  assert.equal(formatiereUsd4(0), "$0,0000");
});

test("formatiereMetrikWert: llm_call in USD mit 4 Stellen, andere ohne Runden auf 0", () => {
  assert.equal(formatiereMetrikWert("llm_call", 0.0004), "$0,0004");
  assert.equal(formatiereMetrikWert("tokens_used", 0.0004), "0,0004");
  assert.equal(metrikEinheit("llm_call"), "USD (geschätzt)");
  assert.equal(metrikEinheit("tokens_used"), null);
});

// ── R12: Realtime-Zustand nur aus dem Callback ──

test("Realtime: Zustand nur aus bekannten Callback-Werten, sonst 'unbekannt'", () => {
  assert.equal(leseRealtimeZustand("SUBSCRIBED"), "SUBSCRIBED");
  assert.equal(leseRealtimeZustand("CHANNEL_ERROR"), "CHANNEL_ERROR");
  assert.equal(leseRealtimeZustand("TIMED_OUT"), "TIMED_OUT");
  assert.equal(leseRealtimeZustand("CLOSED"), "CLOSED");
  assert.equal(leseRealtimeZustand(undefined), "unbekannt");
  assert.equal(leseRealtimeZustand("joined"), "unbekannt");
  assert.equal(realtimeAnzeige("unbekannt").text, "Realtime: unbekannt");
  assert.equal(realtimeAnzeige("SUBSCRIBED").text, "Realtime verbunden");
});

test("Realtime: jede Statusklasse existiert in globals.css", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  for (const z of ["unbekannt", "SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    const { klasse, text } = realtimeAnzeige(z);
    assert.match(css, new RegExp(`\\.${klasse}\\s*\\{`), `${klasse} fehlt in globals.css`);
    assert.doesNotMatch(text, /Connected/);
  }
  assert.equal(realtimeAnzeige("CHANNEL_ERROR").klasse, "status-error");
  assert.equal(realtimeAnzeige("unbekannt").klasse, "status-offline");
});

// ── R11: Monatskosten aus /api/status ──

const kostenStatus = (wert, status = "ok") => ({
  erzeugt_am: "2026-11-06T12:00:00Z",
  kosten: { wert, status, quelle: "Supabase · messages", gemessen_am: "2026-11-06T12:00:00Z" },
});

const KOSTEN = {
  heute_usd: 0.2,
  monat_usd: 1.23,
  planung_heute_usd: 0,
  planung_monat_usd: 0,
  laeufe_monat: 9,
  ohne_kosten_heute: 0,
  ohne_kosten_monat: 0,
  heute_vollstaendig: true,
  monat_vollstaendig: true,
  abgeschnitten: false,
};

test("kostenMonatAnzeige: vollständig → Betrag ohne ≥, als geschätzt beschriftet", () => {
  const k = kostenMonatAnzeige(kostenStatus(KOSTEN), null, false);
  assert.equal(k.wert, "$1,23");
  assert.match(k.unterzeile, /geschätzt/);
});

test("kostenMonatAnzeige: monat_vollstaendig false → '≥'", () => {
  const k = kostenMonatAnzeige(
    kostenStatus({ ...KOSTEN, monat_vollstaendig: false, ohne_kosten_monat: 2 }, "warnung"),
    null,
    false,
  );
  assert.equal(k.wert, "≥ $1,23");
  assert.match(k.titel, /2 Läufe ohne Kostenangabe/);
  assert.match(k.unterzeile, /Untergrenze/);
});

test("kostenMonatAnzeige: alte Antwort ohne monat_vollstaendig → '≥' (fail-closed)", () => {
  const k = kostenMonatAnzeige(
    kostenStatus({ heute_usd: 0.2, monat_usd: 1.23, laeufe_monat: 9, abgeschnitten: false }),
    null,
    false,
  );
  assert.equal(k.wert, "≥ $1,23");
  assert.match(k.titel, /Vollständigkeit nicht gemeldet/);
});

test("kostenMonatAnzeige: Abruffehler → 'nicht lesbar', nie 0", () => {
  const k = kostenMonatAnzeige(kostenStatus(KOSTEN), "HTTP 500", false);
  assert.equal(k.wert, "nicht lesbar");
});

test("kostenMonatAnzeige: nicht gemessen / Feld fehlt / lädt", () => {
  assert.equal(kostenMonatAnzeige(kostenStatus(null, "nicht_gemessen"), null, false).wert, "nicht gemessen");
  assert.equal(kostenMonatAnzeige(kostenStatus(null, "fehler"), null, false).wert, "Fehler");
  assert.equal(kostenMonatAnzeige({ erzeugt_am: "x" }, null, false).wert, "nicht gemessen");
  assert.equal(kostenMonatAnzeige(null, null, true).wert, "…");
  assert.equal(kostenMonatAnzeige(null, null, false).wert, "nicht gemessen");
});

// ── R22: Aktivierungsantwort ──

const OK = {
  agent_id: "oracle",
  model: "claude-sonnet-5",
  response: "Hallo, ich bin ORACLE.",
  usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.0123, latency_ms: 900 },
  stop_reason: "end_turn",
  abgeschnitten: false,
  protokoll_fehler: null,
};

test("Aktivierung: neues Fehlerformat {fehler} wird gelesen, nie 'undefined'", () => {
  const r = werteAktivierungAus(false, 502, { fehler: "leere Antwort", agent_id: "oracle" });
  assert.equal(r.art, "fehler");
  assert.equal(r.text, "Fehler: leere Antwort");
});

test("Aktivierung: altes Fehlerformat {error} und Antwort ohne JSON", () => {
  assert.equal(werteAktivierungAus(false, 500, { error: "kaputt" }).text, "Fehler: kaputt");
  assert.equal(werteAktivierungAus(false, 504, null).text, "Fehler: HTTP 504");
  assert.equal(werteAktivierungAus(false, 404, { fehler: "  " }).text, "Fehler: HTTP 404");
});

test("Aktivierung: vollständig und sauber protokolliert → ok mit geschätzten Kosten", () => {
  const r = werteAktivierungAus(true, 200, OK);
  assert.equal(r.art, "ok");
  assert.match(r.text, /^Agent aktiviert: Hallo/);
  assert.ok(r.hinweise.includes("Kosten (geschätzt): $0,0123"));
});

test("Aktivierung: leere protokoll_fehler-Liste (ältere Fassung) ist kein Fehler", () => {
  assert.equal(werteAktivierungAus(true, 200, { ...OK, protokoll_fehler: [] }).art, "ok");
});

for (const [name, aenderung] of [
  ["protokoll_fehler als Text", { protokoll_fehler: "messages-Insert: permission denied" }],
  ["protokoll_fehler als Liste", { protokoll_fehler: ["metrics-Insert: x"] }],
  ["protokoll_fehler unlesbar", { protokoll_fehler: { a: 1 } }],
  ["abgeschnitten true", { abgeschnitten: true, stop_reason: "max_tokens" }],
  ["abgeschnitten null", { abgeschnitten: null, stop_reason: null }],
  ["abgeschnitten fehlt", { abgeschnitten: undefined }],
  ["abgeschnitten false, aber stop_reason refusal (alte Semantik)", { stop_reason: "refusal" }],
  ["abgeschnitten false, aber kein stop_reason", { stop_reason: null }],
  ["leerer Antworttext", { response: "   " }],
]) {
  test(`Aktivierung nicht grün: ${name}`, () => {
    const r = werteAktivierungAus(true, 200, { ...OK, ...aenderung });
    assert.equal(r.art, "warnung");
    assert.ok(r.hinweise.length >= 2);
  });
}

test("Aktivierung: Kosten ohne Angabe heißen 'nicht gemessen'", () => {
  const r = werteAktivierungAus(true, 200, { ...OK, usage: { cost_usd: null } });
  assert.ok(r.hinweise.includes("Kosten: nicht gemessen"));
});

// ── Metadaten-Chips ──

test("metaWertText: Kosten als geschätzt, leere Werte als 'nicht gemessen', Objekte als JSON", () => {
  assert.equal(metaWertText("cost_usd", 0.01), "cost_usd (geschätzt): 0.01");
  assert.equal(metaWertText("cost_usd", null), "cost_usd (geschätzt): nicht gemessen");
  assert.equal(metaWertText("x", { a: 1 }), 'x: {"a":1}');
  assert.equal(metaWertText("source", "fehllauf"), "source: fehllauf");
});
