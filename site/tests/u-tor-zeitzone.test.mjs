// Tor-Prüfung 07.11.2026, Nachprüfung K1. Lauf: npm test.
// Die Zeit im Message Bus des Command Centers (F1) steht in Europe/Berlin, gleich in welcher
// Zeitzone Browser oder Testprozess laufen. Eigene Datei, weil node --test je Datei einen eigenen
// Prozess startet: lib/types.ts lädt hier zum ersten Mal, und zwar unter TZ=UTC (Muster wie
// tests/t-totmann-zeitzone.test.mjs). In tests/u-tor-anzeige.test.mjs läuft der Prozess in der Zone
// der Maschine (hier Europe/Berlin); dort blieb ein Mutant grün, der berlinTeile auf die Ortszeit
// (getDate/getHours) zurückstellte — gemessen mit der ganzen Suite, erst unter TZ=UTC rot.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "UTC";
const types = await import("../src/lib/types.ts");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const { React, jsxRuntime, ladeTsx, renderToStaticMarkup } = await import("./harness/tsx.mjs");

/** Messzeitpunkt der Live-Abzüge: Sa 07.11.2026 12:28:23 Europe/Berlin. */
const MESSUNG = "2026-11-07T11:28:23.000Z";

test("TOR-F1z Bus unter TZ=UTC: Tag und Uhrzeit in Europe/Berlin, nicht in der Zone des Prozesses", () => {
  assert.equal(new Date("2026-11-07T11:24:39.000Z").getHours(), 11, "Voraussetzung: der Prozess rechnet in UTC");
  const zeit = (iso, bezug = MESSUNG) => types.busZeitAnzeige({ timestamp: iso, created_at: iso }, bezug);
  // gemessen: neueste Bus-Zeile 07.11.2026 11:24:39 UTC — am Tag der Messung nur die Uhrzeit (MEZ)
  assert.equal(zeit("2026-11-07T11:24:39.821Z").text, "12:24:39");
  // Juli-Lauf 29.07.2026 22:19:54 UTC = 30.07. 00:19:54 MESZ (in UTC wäre es der 29.07., 22:19:54)
  assert.equal(zeit("2026-07-29T22:19:54.000Z").text, "30.07., 00:19:54");
  assert.match(zeit("2026-07-29T22:19:54.000Z").titel, /^30\.07\.2026 00:19:54 \(Europe\/Berlin\) · Feld messages\.timestamp$/);
  // 07.11. 23:00 Berlin gegen Messung 08.11. 00:30 Berlin: anderer Tag, obwohl in UTC derselbe.
  assert.equal(zeit("2026-11-07T22:00:00.000Z", "2026-11-07T23:30:00.000Z").text, "07.11., 23:00:00");
  // Derselbe Berliner Tag bei anderem UTC-Tag: 06.11. 23:30 UTC = 07.11. 00:30 Berlin — "heute".
  assert.equal(zeit("2026-11-06T23:30:00.000Z").text, "00:30:00");
});

test("TOR-F1z Feed unter TZ=UTC: gerenderte Zeiten wie in Europe/Berlin", () => {
  const F = ladeTsx("components/ui/MessageFeed.tsx", { react: React, "react/jsx-runtime": jsxRuntime, "@/lib/freigabe-regeln": regeln, "@/lib/types": types });
  const nachricht = (id, zeit) => ({
    id,
    from_agent: "counsel",
    to_agents: ["donna"],
    to_channels: [],
    message_type: "response",
    priority: "normal",
    content: { text: `Antwort ${id}` },
    metadata: { source: "activation-api" },
    created_at: zeit,
    timestamp: zeit,
  });
  const html = renderToStaticMarkup(
    React.createElement(F.MessageFeed, { messages: [nachricht("neu", "2026-11-07T11:24:39.821Z"), nachricht("alt", "2026-07-29T22:19:54.000Z")], bezugIso: MESSUNG }),
  );
  const zeiten = [...html.matchAll(/<span class="text-\[10px\] text-text-muted ml-auto font-mono[^"]*"(?: title="[^"]*")?>([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(zeiten, ["12:24:39", "30.07., 00:19:54"]);
});
