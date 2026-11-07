// Totmann, Prüfbefund anzeige-4 der zweiten Prüfung des Branches. Lauf: npm test.
// Die Zeitpunkte im Tooltip der Zeile „Crons" stehen in Europe/Berlin, gleich in welcher Zeitzone der
// Browser steht. Eigene Datei, weil node --test je Datei einen eigenen Prozess startet: lib/types.ts
// lädt hier zum ersten Mal, und zwar unter TZ=UTC. Ein Formatierer ohne feste Zeitzone, der beim
// ersten Aufruf zwischengespeichert wird, rechnete dann in UTC. In tests/t-totmann.test.mjs (T-A13,
// TZ erst zur Laufzeit umgestellt) ist er schon unter der Zeitzone der Maschine angelegt — dort fiele
// genau das nicht auf (gemessen mit einem Mutanten ohne timeZone: T-A13 blieb grün).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "UTC";
const totmann = await import("../src/lib/totmann.ts");
const statusServer = await import("../src/lib/status-server.ts");
const types = await import("../src/lib/types.ts");

const JETZT = "2026-11-09T19:10:00.000Z";
const zeile = (job, begonnen) => ({
  job,
  begonnen_am: begonnen,
  beendet_am: begonnen,
  eingetragen_am: new Date(Date.parse(begonnen) + 1_000).toISOString(),
  ergebnis: "ok",
  http_status: 200,
  teilergebnisse: [],
  hinweis: null,
});

test("T-A13b Anzeige (Prüfbefund anzeige-4): Prozess von Anfang an in UTC — Zeile und Tooltip nennen dieselbe Uhrzeit (Europe/Berlin)", () => {
  assert.equal(new Date("2026-11-09T07:03:05.000Z").getHours(), 7, "Voraussetzung: der Prozess rechnet in UTC");
  const b = statusServer.bewerteTotmann(totmann.TOTMANN_PLAN, [zeile("briefing-morgen", "2026-11-09T07:03:05.000Z")], new Date(JETZT), null, null);
  const m = { wert: b.wert, status: b.status, quelle: "Test", gemessen_am: JETZT, hinweis: b.hinweis };
  const a = types.cronsAnzeige(types.cronsFeld(m), JETZT);
  assert.equal(a.text, "Briefing morgens: lief zuletzt am 09.11.2026 08:03, obwohl als aus geführt");
  assert.ok(a.zusatz.includes("\n  Letzter Lauf: 09.11.2026 08:03:05 (Europe/Berlin) · ok · HTTP 200 · eingetragen 09.11.2026 08:03:06 (Europe/Berlin, DB-Uhr)"), a.zusatz);
  assert.doesNotMatch(a.zusatz, /07:03/, "keine Uhrzeit in der Zone des Prozesses");
  // aktiv_seit: 16.11.2026 00:00 Berlin, in UTC wäre es der 15.11. 23:00.
  const seit = "2026-11-16T00:00:00+01:00";
  const plan = totmann.TOTMANN_PLAN.map((j, i) => (i === 0 ? { ...j, aktiv: true, aktiv_seit: seit, zeitzone_beleg: "Testannahme", aus_seit: null, grund: null } : j));
  const jetzt = "2026-11-16T06:00:00.000Z";
  const b2 = statusServer.bewerteTotmann(plan, [], new Date(jetzt), null, null);
  const a2 = types.cronsAnzeige(types.cronsFeld({ wert: b2.wert, status: b2.status, quelle: "Test", gemessen_am: jetzt }), jetzt);
  assert.ok(a2.zusatz.includes("Briefing morgens (briefing-morgen): laut Plan aktiv seit 16.11.2026 00:00:00 (Europe/Berlin)"), a2.zusatz);
  assert.doesNotMatch(a2.zusatz, /15\.11\.2026/, "nicht der Vortag in UTC");
});
