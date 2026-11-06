// Tests für die Nachbesserung der Gruppe D (lib/types.ts) — 06.11.2026, nach der Prüfrunde.
// Prüferpunkte: Leertexte auf /messages, /metrics und der Agentflotte sagen, was die Abfrage im
// Browser lieferte, nicht, was in der Tabelle steht (Gegenprobe über /api/status); /messages
// blendet Nachrichten ausgeblendeter Agenten aus wie das Command Center; ein metric_type
// "__proto__" trifft keine Tabelle über den Prototyp; Realtime-INSERTs erzeugen keine Dubletten.
// Lauf: node --test tests/d-nachbesserung.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentenLeerHinweis,
  agentenZaehlung,
  busZaehlung,
  eigenerEintrag,
  istSichtbareNachricht,
  leereAbfrageHinweis,
  nachrichtKanaele,
  nachrichtVorne,
  nachrichtenLeerHinweis,
  sichtbareEmpfaenger,
} from "../src/lib/types.ts";

const T = "2026-11-06T12:00:00.000Z";

// ── eigenerEintrag: nur eigene Schlüssel ──

const ICONS = { api_cost: "💰", llm_call: "◆" };

test("eigenerEintrag: eigener Schlüssel liefert den Wert", () => {
  assert.equal(eigenerEintrag(ICONS, "api_cost"), "💰");
  assert.equal(eigenerEintrag(ICONS, "llm_call"), "◆");
});

for (const schluessel of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf", "unbekannt", ""]) {
  test(`eigenerEintrag: '${schluessel}' trifft nichts über den Prototyp`, () => {
    assert.equal(eigenerEintrag(ICONS, schluessel), undefined);
  });
}

test("eigenerEintrag: Nicht-Text als Schlüssel → undefined", () => {
  for (const s of [null, undefined, 1, {}, ["api_cost"]]) assert.equal(eigenerEintrag(ICONS, s), undefined);
});

// ── Sichtbare Nachrichten (Regel wie MessageFeed) ──

const n = (from_agent, to_agents = ["donna"], to_channels = []) => ({ from_agent, to_agents, to_channels });

test("istSichtbareNachricht: Absender ausgeblendet (auch großgeschrieben) → unsichtbar", () => {
  assert.equal(istSichtbareNachricht(n("trader")), false);
  assert.equal(istSichtbareNachricht(n("TRADER")), false);
});

test("istSichtbareNachricht: nur an ausgeblendete Agenten ohne Kanal → unsichtbar", () => {
  assert.equal(istSichtbareNachricht(n("oracle", ["trader"])), false);
  assert.equal(istSichtbareNachricht(n("oracle", ["trader", "TRADER"])), false);
});

test("istSichtbareNachricht: sichtbarer Empfänger oder Kanal → sichtbar", () => {
  assert.equal(istSichtbareNachricht(n("oracle", ["trader", "donna"])), true);
  assert.equal(istSichtbareNachricht(n("oracle", ["trader"], ["#ops"])), true);
  assert.equal(istSichtbareNachricht(n("oracle", [])), true);
});

test("istSichtbareNachricht: schräge Felder werfen nicht", () => {
  assert.equal(istSichtbareNachricht(n(null, null, null)), true);
  assert.equal(istSichtbareNachricht(n(undefined, "trader", "#ops")), true);
  assert.equal(istSichtbareNachricht(n(7, undefined, undefined)), true);
});

test("sichtbareEmpfaenger und nachrichtKanaele: ohne ausgeblendete, kein Array → leer", () => {
  assert.deepEqual(sichtbareEmpfaenger({ to_agents: ["trader", "donna", "TRADER"] }), ["donna"]);
  assert.deepEqual(sichtbareEmpfaenger({ to_agents: "trader" }), []);
  assert.deepEqual(sichtbareEmpfaenger({ to_agents: null }), []);
  assert.deepEqual(nachrichtKanaele({ to_channels: ["#ops"] }), ["#ops"]);
  assert.deepEqual(nachrichtKanaele({ to_channels: "#ops" }), []);
});

// ── nachrichtVorne: keine Dublette bei spätem Realtime-INSERT ──

test("nachrichtVorne: schon gelesene id → Liste unverändert (selbe Referenz, kein Neurendern)", () => {
  const liste = [{ id: "a" }, { id: "b" }];
  assert.equal(nachrichtVorne(liste, { id: "a" }, 20), liste);
  assert.equal(nachrichtVorne(liste, { id: "b" }, 20), liste);
});

test("nachrichtVorne: neue id oben, Grenze gilt", () => {
  assert.deepEqual(nachrichtVorne([{ id: "a" }, { id: "b" }], { id: "c" }, 20).map((m) => m.id), ["c", "a", "b"]);
  assert.deepEqual(nachrichtVorne([{ id: "a" }, { id: "b" }], { id: "c" }, 2).map((m) => m.id), ["c", "a"]);
});

test("nachrichtVorne: fehlende id wird nicht als Dublette verworfen", () => {
  assert.equal(nachrichtVorne([{ id: undefined }], { id: undefined }, 20).length, 2);
  assert.equal(nachrichtVorne([{ id: "" }], { id: "" }, 20).length, 2);
});

// ── Gegenprobe über /api/status ──

const status = (felder) => ({ erzeugt_am: T, ...felder });
const mw = (wert, st = "ok", quelle = "Supabase · messages (count exact)") => ({ wert, status: st, quelle, gemessen_am: T });

test("busZaehlung: gemessene Gesamtzahl mit Quelle im title", () => {
  const z = busZaehlung(status({ bus: mw({ anzahl: 42 }) }), null);
  assert.equal(z.anzahl, 42);
  assert.match(z.titel, /Quelle: Supabase · messages \(count exact\)/);
  assert.match(z.titel, /Service-Key/);
});

test("busZaehlung: Abruffehler → alte Daten zählen nicht", () => {
  const z = busZaehlung(status({ bus: mw({ anzahl: 42 }) }), "HTTP 500");
  assert.equal(z.anzahl, null);
  assert.match(z.titel, /Systemzustand nicht lesbar: HTTP 500/);
});

test("busZaehlung: kein Status, Messfehler, fehlendes Feld, unlesbare Zahl → null", () => {
  assert.equal(busZaehlung(null, null).anzahl, null);
  assert.equal(busZaehlung(status({ bus: mw(null, "fehler") }), null).anzahl, null);
  assert.equal(busZaehlung(status({}), null).anzahl, null);
  assert.match(busZaehlung(status({}), null).titel, /fehlt in der Antwort/);
  for (const anzahl of [-1, Number.NaN, Number.POSITIVE_INFINITY, "42", null]) {
    assert.equal(busZaehlung(status({ bus: mw({ anzahl }) }), null).anzahl, null, String(anzahl));
  }
  assert.equal(busZaehlung(status({ bus: mw({ anzahl: 5 }, "nicht_gemessen") }), null).anzahl, null);
});

test("busZaehlung: 0 ist eine Messung, Warnung mit Wert zählt", () => {
  assert.equal(busZaehlung(status({ bus: mw({ anzahl: 0 }) }), null).anzahl, 0);
  assert.equal(busZaehlung(status({ bus: mw({ anzahl: 3 }, "warnung") }), null).anzahl, 3);
});

test("agentenZaehlung: Zeilen in agents, ausgeblendete mitgezählt", () => {
  const z = agentenZaehlung(status({ agenten: mw({ anzahl: 16, ausgeblendet: ["trader"] }, "ok", "Supabase · agents") }), null);
  assert.equal(z.anzahl, 16);
  assert.match(z.titel, /ausgeblendete mitgezählt/);
  assert.equal(agentenZaehlung(status({ agenten: mw({ anzahl: 16, ausgeblendet: [] }) }), "x").anzahl, null);
  assert.equal(agentenZaehlung(status({}), null).anzahl, null);
  assert.equal(agentenZaehlung(null, null).anzahl, null);
});

// ── Leertexte: Aussage über die Abfrage, nicht über die Tabelle ──

const OHNE_TABELLENBEHAUPTUNG = /in der Tabelle|Tabelle ist leer|keine Agenten eingetragen|Register leer/;

test("leereAbfrageHinweis: Server zählt mehr als 0 → Widerspruch, als Vermutung markiert", () => {
  const l = leereAbfrageHinweis("Nachrichten", 42);
  assert.equal(l.widerspruch, true);
  assert.match(l.text, /Die Abfrage im Browser lieferte keine Nachrichten, der Server zählt 42\./);
  assert.match(l.zusatz, /vermutlich gesperrt oder fehlgeschlagen/);
  assert.doesNotMatch(`${l.text} ${l.zusatz}`, OHNE_TABELLENBEHAUPTUNG);
});

test("leereAbfrageHinweis: Server zählt 0 → neutral mit Gegenprobe", () => {
  const l = leereAbfrageHinweis("Agenten", 0);
  assert.equal(l.widerspruch, false);
  assert.equal(l.text, "Die Abfrage im Browser lieferte keine Agenten.");
  assert.match(l.zusatz, /Der Server zählt ebenfalls 0 Agenten/);
});

test("leereAbfrageHinweis: keine Gegenprobe → 'nicht belegt'", () => {
  const l = leereAbfrageHinweis("Nachrichten", null);
  assert.equal(l.widerspruch, false);
  assert.match(l.zusatz, /nicht belegt/);
  assert.doesNotMatch(`${l.text} ${l.zusatz}`, OHNE_TABELLENBEHAUPTUNG);
});

test("leereAbfrageHinweis: große Zahl im deutschen Format", () => {
  assert.match(leereAbfrageHinweis("Nachrichten", 4211).text, /zählt 4\.211\./);
});

test("agentenLeerHinweis: nur ausgeblendete gelesen → Hinweis mit Anzahl, sonst Gegenprobe", () => {
  const nurAusgeblendet = agentenLeerHinweis(2, 16);
  assert.match(nurAusgeblendet.text, /nur ausgeblendete Agenten \(2\)/);
  assert.equal(nurAusgeblendet.widerspruch, false);
  assert.deepEqual(agentenLeerHinweis(0, 16), leereAbfrageHinweis("Agenten", 16));
  assert.deepEqual(agentenLeerHinweis(0, null), leereAbfrageHinweis("Agenten", null));
});

test("nachrichtenLeerHinweis: nichts gelesen → Gegenprobe; alles ausgeblendet; Filter", () => {
  assert.deepEqual(
    nachrichtenLeerHinweis({ gelesen: 0, ausgeblendet: 0, grenze: 100, serverAnzahl: 42 }),
    leereAbfrageHinweis("Nachrichten", 42),
  );
  const alleAus = nachrichtenLeerHinweis({ gelesen: 3, ausgeblendet: 3, grenze: 100, serverAnzahl: 42 });
  assert.match(alleAus.text, /Keine Nachrichten sichtbarer Agenten in den neuesten 100 — 3 von ausgeblendeten Agenten nicht angezeigt\./);
  assert.equal(alleAus.widerspruch, false);
  const filter = nachrichtenLeerHinweis({ gelesen: 5, ausgeblendet: 1, grenze: 100, serverAnzahl: null });
  assert.equal(filter.text, "Keine Nachrichten für diesen Filter in den neuesten 100.");
});
