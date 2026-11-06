// Tests der Gesamtprüfung 06.11.2026 für reine Funktionen (Fixrunde Z). Lauf: npm test.
// - lib/status-server.ts: pruefeAnfrageHerkunft (Cross-Site-POST, Content-Type) und
//   leseProtokollEintraege (protokoll_fehler_liste vor dem "; "-Text).
// - lib/types.ts: formatiereUsdUntergrenze (abgerundete Untergrenze), kostenMonatAnzeige und
//   werteAktivierungAus für Fehlerantworten (Kosten eines bezahlten Fehllaufs, Protokoll).
// - lib/hooks-status.ts: lesePlanungsFehlschlag, lesePlanungsKosten, mitPraefix.
// Kein Netz, keine Env-Werte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// hooks-status.ts importiert "./freigabe-regeln" ohne Endung; Node braucht sie (wie c-hooks-status).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { PROTOKOLL_TRENNER, leseProtokollEintraege, pruefeAnfrageHerkunft, bereinigeFehler } = await import(
  "../src/lib/status-server.ts"
);
const { formatiereUsdUntergrenze, kostenMonatAnzeige, werteAktivierungAus } = await import("../src/lib/types.ts");
const { FEHLVERSUCH_KOSTEN_FEHLEN, lesePlanungsFehlschlag, lesePlanungsKosten, mitPraefix } = await import(
  "../src/lib/hooks-status.ts"
);

const NAME = ["Immo", "Nexus"].join("");
const kopf = (werte) => ({ get: (n) => (Object.prototype.hasOwnProperty.call(werte, n) ? werte[n] : null) });

// ── pruefeAnfrageHerkunft ──

test("Herkunft: Browser same-origin mit JSON ist zulässig, ebenso Server-zu-Server ohne Sec-Fetch-Site", () => {
  assert.equal(pruefeAnfrageHerkunft(kopf({ "sec-fetch-site": "same-origin", "content-type": "application/json" })), null);
  assert.equal(pruefeAnfrageHerkunft(kopf({ "content-type": "application/json; charset=utf-8" })), null);
  assert.equal(pruefeAnfrageHerkunft(kopf({ "content-type": "Application/JSON" })), null);
});

for (const seite of ["cross-site", "same-site", "none", "", "CROSS-SITE"]) {
  test(`Herkunft: Sec-Fetch-Site "${seite}" → 403`, () => {
    const s = pruefeAnfrageHerkunft(kopf({ "sec-fetch-site": seite, "content-type": "application/json" }));
    assert.equal(s?.status, 403);
    assert.match(s.fehler, /nicht von dieser Seite/);
  });
}

for (const [name, typ] of [
  ["fehlt", undefined],
  ["text/plain (einfache Anfrage ohne Preflight)", "text/plain"],
  ["Formular", "application/x-www-form-urlencoded"],
  ["json mit Präfix", "xapplication/json"],
  ["json-artig", "application/jsonp"],
]) {
  test(`Herkunft: Content-Type ${name} → 415`, () => {
    const s = pruefeAnfrageHerkunft(kopf(typ === undefined ? {} : { "content-type": typ }));
    assert.equal(s?.status, 415);
    assert.match(s.fehler, /application\/json/);
  });
}

// ── leseProtokollEintraege ──

const DREI = [
  `agents-Update: new row for relation "agents" violates check constraint "agents_total_cost_usd_check"`,
  "messages-Insert: permission denied for table messages",
  "metrics-Insert: permission denied for table metrics (Kostenzeile)",
];

test("Protokoll: Liste hat Vorrang, jeder Eintrag bleibt einzeln (auch über 160 Zeichen zusammen)", () => {
  const text = DREI.join(PROTOKOLL_TRENNER);
  assert.ok(text.length > 160);
  const r = leseProtokollEintraege(DREI, text);
  assert.deepEqual(r, { eintraege: DREI, unlesbar: false });
  // Bereinigt je Eintrag: jedes Präfix bleibt erhalten (vorher fiel "metrics-Insert" weg).
  const bereinigt = r.eintraege.map((e) => bereinigeFehler(e));
  assert.ok(bereinigt.some((e) => e.startsWith("metrics-Insert")));
  assert.ok(bereinigeFehler(text).length <= 160 && !bereinigeFehler(text).includes("metrics-Insert"), "Gegenprobe: als ein Text gekürzt");
});

test("Protokoll: ohne Liste wird der Text am Trenner geteilt; alte Liste in protokoll_fehler geht auch", () => {
  assert.deepEqual(leseProtokollEintraege(undefined, DREI.join(PROTOKOLL_TRENNER)).eintraege, DREI);
  assert.deepEqual(leseProtokollEintraege(null, ["a", " ", "b"]).eintraege, ["a", "b"]);
  assert.deepEqual(leseProtokollEintraege(undefined, null), { eintraege: [], unlesbar: false });
  assert.deepEqual(leseProtokollEintraege([], null), { eintraege: [], unlesbar: false });
});

test("Protokoll: leere Liste, aber Text gesetzt → der Text zählt (nichts geht verloren)", () => {
  assert.deepEqual(leseProtokollEintraege([], "x; y").eintraege, ["x", "y"]);
});

test("Protokoll: unerwartete Formen sind ein Vertragsbruch (unlesbar), lesbare Teile bleiben", () => {
  assert.equal(leseProtokollEintraege(["a", 3], null).unlesbar, true);
  assert.deepEqual(leseProtokollEintraege(["a", 3], null).eintraege, ["a"]);
  const r = leseProtokollEintraege("kein Array", "x; y");
  assert.equal(r.unlesbar, true);
  assert.deepEqual(r.eintraege, ["x", "y"]);
  assert.equal(leseProtokollEintraege(undefined, { a: 1 }).unlesbar, true);
});

// ── formatiereUsdUntergrenze ──

for (const [betrag, stellen, erwartet] of [
  [0.016, 2, "≥ $0,01"],
  [1.235, 2, "≥ $1,23"],
  [0.29, 2, "≥ $0,29"],
  [1.23, 2, "≥ $1,23"],
  [0, 2, "≥ $0,00"],
  [0.004, 2, "> $0 (gemessen unter $0,01)"],
  [0.00003, 4, "> $0 (gemessen unter $0,0001)"],
  [0.00019, 4, "≥ $0,0001"],
  [0.0021, 4, "≥ $0,0021"],
]) {
  test(`Untergrenze: ${betrag} (${stellen} Stellen) → "${erwartet}"`, () => {
    assert.equal(formatiereUsdUntergrenze(betrag, stellen), erwartet);
  });
}

test("Untergrenze: nie über dem Betrag, nie '≥ <'", () => {
  for (let i = 0; i < 2000; i++) {
    const betrag = Math.round(Math.random() * 5_000_000) / 1_000_000; // Vielfache von 1e-6 wie die Kostenwerte
    for (const stellen of [2, 4]) {
      const text = formatiereUsdUntergrenze(betrag, stellen);
      assert.ok(!text.includes("≥ <"), text);
      const m = /^≥ \$(\d+),(\d+)$/.exec(text.replace(/\./g, ""));
      if (m) assert.ok(Number(`${m[1]}.${m[2]}`) <= betrag + 1e-12, `${text} > ${betrag}`);
    }
  }
});

const kostenStatus = (wert) => ({
  erzeugt_am: "2026-11-06T10:00:00Z",
  kosten: { wert, status: "warnung", quelle: "Q", gemessen_am: "2026-11-06T10:00:00Z" },
});

test("Monatskachel: unvollständige Summe abgerundet, Kleinstbetrag ohne '≥ <'", () => {
  const basis = { heute_usd: 0, laeufe_monat: 3, ohne_kosten_monat: 1, monat_vollstaendig: false, abgeschnitten: false };
  assert.equal(kostenMonatAnzeige(kostenStatus({ ...basis, monat_usd: 0.016 }), null, false).wert, "≥ $0,01");
  assert.equal(kostenMonatAnzeige(kostenStatus({ ...basis, monat_usd: 0.00003 }), null, false).wert, "> $0 (gemessen unter $0,0001)");
  assert.equal(kostenMonatAnzeige(kostenStatus({ ...basis, monat_usd: 0.0021 }), null, false).wert, "≥ $0,0021");
  // vollständig: gerundet wie bisher, ohne "≥"
  assert.equal(kostenMonatAnzeige(kostenStatus({ ...basis, monat_usd: 0.016, monat_vollstaendig: true, ohne_kosten_monat: 0 }), null, false).wert, "$0,02");
});

// ── werteAktivierungAus: Fehlerantworten (Fehllauf, HTTP 502) ──

const FEHLLAUF = {
  fehler: "leere Antwort",
  error: "leere Antwort",
  agent_id: "oracle",
  model: "claude-sonnet-5",
  stop_reason: "end_turn",
  abgeschnitten: false,
  usage: { input_tokens: 900, output_tokens: 120, cost_usd: 0.003, latency_ms: 800 },
  protokoll_fehler: "messages-Insert (Fehllauf): permission denied for table messages",
  protokoll_fehler_liste: ["messages-Insert (Fehllauf): permission denied for table messages"],
};

test("Aktivierung 502 (Fehllauf): Kosten als bezahlt, Protokoll und fehlende Bus-Zeile sichtbar", () => {
  const r = werteAktivierungAus(false, 502, FEHLLAUF);
  assert.equal(r.art, "fehler");
  assert.equal(r.text, "Fehler: leere Antwort");
  assert.ok(r.hinweise.includes("Kosten (geschätzt): $0,0030 — bezahlt, ohne verwertbare Antwort"), r.hinweise.join(" | "));
  assert.ok(r.hinweise.includes("Protokoll: messages-Insert (Fehllauf): permission denied for table messages"));
  assert.ok(r.hinweise.some((h) => /Kosten dieses Laufs fehlen im Systemzustand/.test(h)));
});

test("Aktivierung 502 ohne Kostenangabe: 'nicht gemessen — Aufruf bezahlt'; ohne usage keine Kostenzeile", () => {
  const ohneKosten = werteAktivierungAus(false, 502, { ...FEHLLAUF, usage: { cost_usd: null }, protokoll_fehler: null, protokoll_fehler_liste: [] });
  assert.deepEqual(ohneKosten.hinweise, ["Kosten: nicht gemessen — Aufruf bezahlt, ohne verwertbare Antwort"]);
  assert.deepEqual(werteAktivierungAus(false, 404, { fehler: "Agent nicht gefunden: x" }).hinweise, []);
});

test("Aktivierung 200: Protokoll-Liste je Eintrag, auch wenn der Text länger als 160 Zeichen ist", () => {
  const r = werteAktivierungAus(true, 200, {
    response: "ok",
    stop_reason: "end_turn",
    abgeschnitten: false,
    usage: { cost_usd: 0.01 },
    protokoll_fehler: DREI.join(PROTOKOLL_TRENNER),
    protokoll_fehler_liste: DREI,
  });
  assert.equal(r.art, "warnung");
  for (const e of DREI) assert.ok(r.hinweise.includes(`Protokoll: ${e}`), e);
  // ohne Liste: Text am Trenner geteilt
  const t = werteAktivierungAus(true, 200, { response: "ok", stop_reason: "end_turn", abgeschnitten: false, protokoll_fehler: DREI.join("; ") });
  for (const e of DREI) assert.ok(t.hinweise.includes(`Protokoll: ${e}`), e);
});

// ── Planung: gescheiterte, aber bezahlte Planung (delegate 502) ──

const PLANUNG = { modell: "claude-sonnet-5", input_tokens: 1200, output_tokens: 12000, kosten_usd_geschaetzt: 0.1224, stop_reason: "max_tokens" };

test("Planung 502: Kosten des Fehlversuchs und protokoll_fehler mit Hinweis auf den Systemzustand", () => {
  const f = lesePlanungsFehlschlag({ fehler: "Plan abgeschnitten", planung: PLANUNG, protokoll_fehler: "Fehllauf nicht gespeichert: permission denied" });
  assert.equal(f.meldung, "Plan abgeschnitten");
  assert.deepEqual(f.planung, PLANUNG);
  assert.equal(f.protokollFehler, "Fehllauf nicht gespeichert: permission denied");
  assert.equal(f.kostenHinweis, FEHLVERSUCH_KOSTEN_FEHLEN);
});

test("Planung 502 ohne protokoll_fehler: kein Hinweis; Middleware-401 ohne planung", () => {
  const f = lesePlanungsFehlschlag({ fehler: "Plan ungültig: x", planung: PLANUNG });
  assert.equal(f.protokollFehler, null);
  assert.equal(f.kostenHinweis, null);
  const u = lesePlanungsFehlschlag({ error: "Unauthorized" });
  assert.deepEqual(u, { meldung: "Unauthorized", planung: null, protokollFehler: null, kostenHinweis: null });
  assert.equal(lesePlanungsFehlschlag(null).planung, null);
});

test("Planung: Texte maskiert, unlesbarer protokoll_fehler wird gemeldet (fail-closed)", () => {
  const f = lesePlanungsFehlschlag({ fehler: `Bezug ${NAME}`, planung: PLANUNG, protokoll_fehler: `x ${NAME}` });
  assert.doesNotMatch(`${f.meldung} ${f.protokollFehler}`, /imm[ou][\s._-]*nexus/i);
  const u = lesePlanungsFehlschlag({ fehler: "x", planung: PLANUNG, protokoll_fehler: { a: 1 } });
  assert.equal(u.protokollFehler, "Protokollfehler gemeldet, Text nicht lesbar");
  assert.equal(u.kostenHinweis, FEHLVERSUCH_KOSTEN_FEHLEN);
});

test("Planungskosten: ohne Modell null, schräge Zahlen werden null statt 0", () => {
  assert.equal(lesePlanungsKosten({ planung: { kosten_usd_geschaetzt: 1 } }), null);
  assert.deepEqual(lesePlanungsKosten({ planung: { modell: "m", input_tokens: "7", output_tokens: NaN, kosten_usd_geschaetzt: null } }), {
    modell: "m",
    input_tokens: null,
    output_tokens: null,
    kosten_usd_geschaetzt: null,
    stop_reason: null,
  });
});

test("mitPraefix: kein doppeltes 'Plan nicht gespeichert:'", () => {
  assert.equal(mitPraefix("Plan nicht gespeichert: ", "Plan nicht gespeichert: kein Secret"), "Plan nicht gespeichert: kein Secret");
  assert.equal(mitPraefix("Plan nicht gespeichert: ", "kein Secret"), "Plan nicht gespeichert: kein Secret");
});
