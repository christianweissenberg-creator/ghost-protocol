// Tests für die Server-Helfer der Gruppe B (lib/status-server.ts): Schlüssel lesen,
// Fehler bereinigen, Abschneide-Status, Fehllauf-Metadaten, bedingte Summen, Zusammenfassung
// der Auftragszeile und Kostenauswertung für GET /api/status. Lauf: npm test.
// Seit Stufe 2 (07.11.2026) auch der Totmann: alle Fälle der Tabelle in §2.5 der Spezifikation
// (docs/intern/objekt-studio-stufe-2.md) als reine Tests ohne Netz; Routen, Anzeige und SQL-Datei
// in tests/t-totmann.test.mjs.
// Alle Schlüssel hier sind erfundene Testwerte.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANTHROPIC_SCHLUESSEL,
  EXPORT_TOKEN,
  KOSTEN_QUELLEN,
  LAUF_ERGEBNISSE,
  MIN_SCHLUESSEL_STUECK,
  NACHWEIS_HINWEIS_MAX,
  QUELLE_FEHLLAUF,
  STATUS_RANG,
  SUMMEN_SPALTEN,
  VORLAUF_MS,
  abschneideStatus,
  ausnahmeNachweis,
  autoProduceNachweis,
  bereinigeFehler,
  bewerteJob,
  bewerteTotmann,
  briefingNachweis,
  fasseLaeufeZusammen,
  fehllaufMetadaten,
  laufNachweisZeile,
  leseLaufNachweis,
  leseSchluessel,
  letzterSollzeitpunkt,
  ohneRandLeerraum,
  pipelineTeilergebnisse,
  planeSummen,
  starteLaufUhr,
  werteKostenAus,
} from "../src/lib/status-server.ts";
import {
  JOB_AUTO_PRODUCE,
  JOB_AUTO_PRODUCE_PROBE,
  JOB_BRIEFING_ABEND,
  JOB_BRIEFING_MORGEN,
  NACHWEIS_SEIT,
  NACHWEIS_TABELLE,
  TOTMANN_PLAN,
} from "../src/lib/totmann.ts";

const SCHLUESSEL = "sk-ant-api03-TESTabcdefghijklmnopqrstuvwxyz0123456789";
const SERVICE = "eyJtestHeaderAAAAAAAA.eyJwYXlsb2FkBBBBBBBBBBBB.c2lnbmF0dXJlCCCCCCCCCC";
const EXPORT = "export-token-Zq81vYt5Lm03Pw77";

function mitUmgebung(werte, fn) {
  const vorher = {};
  for (const [k, v] of Object.entries(werte)) {
    vorher[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(vorher)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Vorgabe R17: jedes Teilstück ab 12 Zeichen. Bewusst fest, nicht aus dem Modul gelesen.
const STUECK = 12;

function ohneStueck(text, geheim) {
  for (let i = 0; i + STUECK <= geheim.length; i++) {
    if (text.includes(geheim.slice(i, i + STUECK))) return false;
  }
  return true;
}

test("MIN_SCHLUESSEL_STUECK ist 12", () => {
  assert.equal(MIN_SCHLUESSEL_STUECK, STUECK);
});

// ── bereinigeFehler (R17) ────────────────────────────────────────────────────

test("bereinigeFehler: Signatur (e) => string bleibt", () => {
  assert.equal(typeof bereinigeFehler, "function");
  assert.equal(bereinigeFehler.length, 1);
  assert.equal(typeof bereinigeFehler(undefined), "string");
});

test("bereinigeFehler: ganzer Schlüssel wird ersetzt", () => {
  mitUmgebung({ ANTHROPIC_API_KEY: SCHLUESSEL }, () => {
    const t = bereinigeFehler(new Error(`Headers.append: "${SCHLUESSEL}" is an invalid header value.`));
    assert.ok(!t.includes("TESTabcdefgh"), t);
    assert.match(t, /\[entfernt\]/);
  });
});

for (const [name, zerlegt] of [
  ["LF mitten im Wert", (s) => `${s.slice(0, 20)}\n${s.slice(20)}`],
  ["CRLF mitten im Wert", (s) => `${s.slice(0, 25)}\r\n${s.slice(25)}`],
  ["maskiertes \\n (JSON)", (s) => JSON.stringify(`${s.slice(0, 18)}\n${s.slice(18)}`)],
  ["nur ein Teilstück", (s) => `prefix ${s.slice(14, 40)} suffix`],
  ["zwei Stücke mit Text dazwischen", (s) => `${s.slice(0, 16)} … ${s.slice(30, 50)}`],
]) {
  test(`bereinigeFehler: zerteilter Schlüssel — ${name}`, () => {
    mitUmgebung({ ANTHROPIC_API_KEY: SCHLUESSEL, SUPABASE_SERVICE_KEY: SERVICE, IMMONEXUS_EXPORT_TOKEN: EXPORT }, () => {
      for (const geheim of [SCHLUESSEL, SERVICE, EXPORT]) {
        const t = bereinigeFehler(new Error(`Fehler: ${zerlegt(geheim)} Ende`));
        assert.ok(ohneStueck(t, geheim), `${name}: ${t}`);
      }
    });
  });
}

test("bereinigeFehler: Stücke unter 12 Zeichen und fremder Text bleiben", () => {
  mitUmgebung({ ANTHROPIC_API_KEY: SCHLUESSEL }, () => {
    const t = bereinigeFehler(new Error("Verbindung zu Postgres abgebrochen: relation messages"));
    assert.equal(t, "Verbindung zu Postgres abgebrochen: relation messages");
    const kurz = bereinigeFehler(new Error(`kurz ${SCHLUESSEL.slice(20, 31)} bleibt`));
    assert.match(kurz, new RegExp(SCHLUESSEL.slice(20, 31)));
  });
});

test("bereinigeFehler: Supabase-Fehlerobjekt, URL, Bearer, Kürzung", () => {
  mitUmgebung({ SUPABASE_SERVICE_KEY: SERVICE }, () => {
    const t = bereinigeFehler({ message: `fetch https://abc.supabase.co/rest/v1/x Bearer ${SERVICE.slice(0, 30)}` });
    assert.ok(!t.includes("supabase.co"), t);
    assert.ok(ohneStueck(t, SERVICE), t);
    assert.ok(bereinigeFehler("x".repeat(500)).length <= 160);
  });
});

test("bereinigeFehler: alte englische Service-Key-Meldung wird neutral", () => {
  assert.equal(bereinigeFehler(new Error("SUPABASE_SERVICE_KEY not set")), "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt");
});

test("bereinigeFehler: kurzer Wert mit LF am Ende wird auch ohne das LF ersetzt (Rand wie leseSchluessel)", () => {
  // 10 Zeichen: zu kurz für die Stück-Suche, nur der exakte Wert hilft. Roh steht er mit LF
  // in der Umgebung, in Meldungen ohne (so verwendet ihn leseSchluessel).
  mitUmgebung({ CRON_SECRET: "kurz-Q7x9Z\n" }, () => {
    const t = bereinigeFehler(new Error("Header mit kurz-Q7x9Z abgelehnt"));
    assert.ok(!t.includes("kurz-Q7x9Z"), t);
    assert.match(t, /\[entfernt\]/);
  });
});

// ── ohneRandLeerraum (Nachprüfung R17) ───────────────────────────────────────

test("ohneRandLeerraum: entfernt genau, was fetch aus Header-Werten entfernt", () => {
  for (const wert of [
    `${SCHLUESSEL}\n`,
    `${SCHLUESSEL}\r\n`,
    `\r\n${SCHLUESSEL}`,
    ` \t${SCHLUESSEL}\t `,
    SCHLUESSEL,
    `a b`,
    `\v${SCHLUESSEL}`,
    `${SCHLUESSEL}\v`,
    `${SCHLUESSEL} `,
  ]) {
    // Vergleich gegen die echte Header-Normalisierung von Node (kein Netz).
    assert.equal(ohneRandLeerraum(wert), new Headers({ k: wert }).get("k"), JSON.stringify(wert));
  }
  assert.equal(ohneRandLeerraum("\r\n \t"), "");
});

test("ohneRandLeerraum: CR/LF im Inneren und NUL bleiben stehen (daran wirft fetch)", () => {
  for (const wert of [`${SCHLUESSEL.slice(0, 20)}\n${SCHLUESSEL.slice(20)}`, `${SCHLUESSEL}\0`, `a\rb`]) {
    assert.equal(ohneRandLeerraum(wert), wert);
    assert.throws(() => new Headers({ k: wert }));
  }
});

// ── leseSchluessel (R17, R23) ────────────────────────────────────────────────

test("leseSchluessel: gültiger Wert", () => {
  mitUmgebung({ ANTHROPIC_API_KEY: SCHLUESSEL }, () => {
    const l = leseSchluessel(ANTHROPIC_SCHLUESSEL);
    assert.equal(l.ok, true);
    assert.equal(l.wert, SCHLUESSEL);
  });
});

// Nachprüfung 06.11.2026: Leerraum am Rand entfernt fetch selbst, ohne zu werfen; der Wert lief
// vor der Fixrunde. Er wird wie bei fetch entfernt und der bereinigte Wert verwendet.
for (const [name, wert] of [
  ["LF am Ende", `${SCHLUESSEL}\n`],
  ["CRLF am Ende", `${SCHLUESSEL}\r\n`],
  ["LF am Anfang", `\n${SCHLUESSEL}`],
  ["Leerzeichen und Tab am Rand", ` \t${SCHLUESSEL}\t `],
]) {
  test(`leseSchluessel: ${name} → ok mit Wert ohne Rand, Log ohne Wert`, () => {
    mitUmgebung({ ANTHROPIC_API_KEY: wert }, () => {
      const alt = { error: console.error, warn: console.warn };
      const log = [];
      console.error = (...a) => log.push(a.join(" "));
      console.warn = (...a) => log.push(a.join(" "));
      try {
        const l = leseSchluessel(ANTHROPIC_SCHLUESSEL);
        assert.equal(l.ok, true);
        assert.equal(l.wert, SCHLUESSEL);
        // Genau der Wert, den fetch als Header senden würde.
        assert.equal(l.wert, new Headers({ "x-api-key": wert }).get("x-api-key"));
        for (const zeile of log) {
          assert.match(zeile, /ANTHROPIC_API_KEY/);
          assert.ok(ohneStueck(zeile, SCHLUESSEL), zeile);
        }
      } finally {
        console.error = alt.error;
        console.warn = alt.warn;
      }
    });
  });
}

test("leseSchluessel: Rand entfernt → Hinweis im Server-Log einmal je Prozess, nur Variablenname", () => {
  mitUmgebung({ GP_TEST_RAND: "rand-wert-0123456789\r\n" }, () => {
    const regel = { variable: "GP_TEST_RAND", bezeichnung: "Test-Schlüssel" };
    const alt = console.warn;
    const log = [];
    console.warn = (...a) => log.push(a.join(" "));
    try {
      for (let i = 0; i < 3; i++) assert.equal(leseSchluessel(regel).wert, "rand-wert-0123456789");
    } finally {
      console.warn = alt;
    }
    assert.equal(log.length, 1);
    assert.match(log[0], /GP_TEST_RAND: Leerraum am Rand entfernt/);
    assert.ok(!log[0].includes("rand-wert"), log[0]);
  });
});

test("leseSchluessel (Gegencheck): Latin-1 bis U+00FF ist ein gültiger Header-Wert", () => {
  mitUmgebung({ ANTHROPIC_API_KEY: `${SCHLUESSEL}\u00fc\u00ff` }, () => {
    const l = leseSchluessel(ANTHROPIC_SCHLUESSEL);
    assert.equal(l.ok, true);
    assert.doesNotThrow(() => new Headers().set("x-api-key", l.wert));
  });
});

for (const [name, wert, grund] of [
  ["fehlt", undefined, "fehlt"],
  ["leer", "", "fehlt"],
  ["nur Leerraum", "\r\n \t", "fehlt"],
  ["Platzhalter", "sk-ant-your-key-here", "unbrauchbar"],
  ["Platzhalter mit CRLF am Ende", "sk-ant-your-key-here\r\n", "unbrauchbar"],
  ["zu kurz", "sk-ant-1", "unbrauchbar"],
  ["zu kurz ohne den Rand", "sk-ant-1\n\n\n", "unbrauchbar"],
  ["LF", `${SCHLUESSEL.slice(0, 20)}\n${SCHLUESSEL.slice(20)}`, "steuerzeichen"],
  ["CR", `${SCHLUESSEL.slice(0, 20)}\r${SCHLUESSEL.slice(20)}`, "steuerzeichen"],
  ["CRLF mitten und am Ende", `${SCHLUESSEL.slice(0, 20)}\r\n${SCHLUESSEL.slice(20)}\r\n`, "steuerzeichen"],
  // Gegencheck 06.11.2026: Zeichen über U+00FF lassen Headers.set werfen.
  ["unsichtbares Leerzeichen U+200B", `${SCHLUESSEL.slice(0, 20)}\u200b${SCHLUESSEL.slice(20)}`, "zeichen"],
  ["Gedankenstrich U+2013", `${SCHLUESSEL.slice(0, 20)}\u2013${SCHLUESSEL.slice(20)}`, "zeichen"],
  ["Emoji (Surrogatpaar)", `${SCHLUESSEL.slice(0, 20)}\u{1F511}${SCHLUESSEL.slice(20)}`, "zeichen"],
  // Prüflauf 06.11.2026: Steuerzeichen passierten Headers.set, undici verwarf sie erst beim Senden.
  ["Steuerzeichen U+0001", `${SCHLUESSEL.slice(0, 20)}${String.fromCharCode(0x01)}${SCHLUESSEL.slice(20)}`, "zeichen"],
  ["Escape U+001B", `${SCHLUESSEL.slice(0, 20)}${String.fromCharCode(0x1b)}${SCHLUESSEL.slice(20)}`, "zeichen"],
  ["DEL U+007F", `${SCHLUESSEL.slice(0, 20)}${String.fromCharCode(0x7f)}${SCHLUESSEL.slice(20)}`, "zeichen"],
]) {
  test(`leseSchluessel: ${name} → ${grund}, feste Meldung ohne Wert und Variablennamen`, () => {
    mitUmgebung({ ANTHROPIC_API_KEY: wert }, () => {
      const fehler = console.error;
      const log = [];
      console.error = (...a) => log.push(a.join(" "));
      try {
        const l = leseSchluessel(ANTHROPIC_SCHLUESSEL);
        assert.equal(l.ok, false);
        assert.equal(l.grund, grund);
        assert.match(l.meldung, /^Anthropic-Schlüssel \(Server-Umgebung\) /);
        // Prüflauf 06.11.2026: die volle Meldung je Grund, nicht nur der Anfang.
        const MELDUNG = {
          steuerzeichen: "Anthropic-Schlüssel (Server-Umgebung) abgelehnt: enthält Zeilenumbruch oder Nullzeichen",
          zeichen:
            "Anthropic-Schlüssel (Server-Umgebung) abgelehnt: enthält ein Zeichen, das in keinem HTTP-Header stehen kann (etwa ein Steuerzeichen oder unsichtbares Leerzeichen)",
        };
        if (grund in MELDUNG) assert.equal(l.meldung, MELDUNG[grund]);
        assert.ok(!l.meldung.includes("ANTHROPIC_API_KEY"));
        assert.ok(!("wert" in l));
        if (typeof wert === "string" && wert.length > 12) assert.ok(ohneStueck(l.meldung, wert));
        // Den Variablennamen schreibt höchstens das Server-Log, nie den Wert.
        for (const zeile of log) {
          assert.match(zeile, /ANTHROPIC_API_KEY/);
          if (typeof wert === "string" && wert.length > 12) assert.ok(ohneStueck(zeile, wert), zeile);
        }
      } finally {
        console.error = fehler;
      }
    });
  });
}

test("leseSchluessel: Server-Log nur einmal je Grund", () => {
  mitUmgebung({ CRON_SECRET: undefined }, () => {
    const regel = { variable: "CRON_SECRET", bezeichnung: "Cron-Secret" };
    const fehler = console.error;
    const log = [];
    console.error = (...a) => log.push(a.join(" "));
    try {
      leseSchluessel(regel);
      leseSchluessel(regel);
      leseSchluessel(regel);
    } finally {
      console.error = fehler;
    }
    assert.equal(log.length, 1);
  });
});

test("leseSchluessel: Export-Token-Meldung ist neutral (R23)", () => {
  mitUmgebung({ IMMONEXUS_EXPORT_TOKEN: undefined }, () => {
    const l = leseSchluessel(EXPORT_TOKEN);
    assert.equal(l.ok, false);
    assert.equal(l.meldung, "Export-Token (Server-Umgebung) nicht gesetzt");
    assert.doesNotMatch(l.meldung, /imm[ou][\s._-]*nexus/i);
  });
});

// ── abschneideStatus (R16) ───────────────────────────────────────────────────

for (const [stop, erwartet] of [
  ["end_turn", false],
  ["stop_sequence", false],
  ["max_tokens", true],
  ["refusal", true],
  ["pause_turn", true],
  ["model_context_window_exceeded", true],
  ["tool_use", true],
  [null, null],
  [undefined, null],
  ["", null],
  ["  ", null],
  [42, null],
]) {
  test(`abschneideStatus(${JSON.stringify(stop)}) → ${erwartet}`, () => {
    assert.equal(abschneideStatus(stop), erwartet);
  });
}

// ── fehllaufMetadaten (R8) ───────────────────────────────────────────────────

test("fehllaufMetadaten: Vertragsfelder und Preis-Kennung, Zusatz kann sie nicht überschreiben", () => {
  const m = fehllaufMetadaten(
    { art: "aktivierung", model: "claude-sonnet-5", input_tokens: 10, output_tokens: 20, cost_usd: 0.0002, preis_stand: "2026-11-06", stop_reason: "max_tokens", grund: "leere Antwort" },
    { source: "activation-api", art: "planung", preis_stand: "1999-01-01", auftrag_id: "a", latency_ms: 5 },
  );
  assert.equal(m.source, QUELLE_FEHLLAUF);
  assert.equal(m.source, "fehllauf");
  assert.equal(m.art, "aktivierung");
  assert.equal(m.cost_usd, 0.0002);
  assert.equal(m.preis_stand, "2026-11-06");
  assert.equal(m.input_tokens, 10);
  assert.equal(m.output_tokens, 20);
  assert.equal(m.model, "claude-sonnet-5");
  assert.equal(m.stop_reason, "max_tokens");
  assert.equal(m.auftrag_id, "a");
  assert.equal(m.grund, "leere Antwort");
});

test("fehllaufMetadaten: cost_usd null bleibt null, Grund wird bereinigt", () => {
  mitUmgebung({ ANTHROPIC_API_KEY: SCHLUESSEL }, () => {
    const m = fehllaufMetadaten({ art: "planung", model: "m", input_tokens: null, output_tokens: null, cost_usd: null, preis_stand: "2026-11-06", stop_reason: null, grund: `x ${SCHLUESSEL}` });
    assert.equal(m.cost_usd, null);
    assert.ok(ohneStueck(m.grund, SCHLUESSEL));
  });
});

test("KOSTEN_QUELLEN: Aktivierung, Planung, Fehllauf", () => {
  assert.deepEqual([...KOSTEN_QUELLEN], ["activation-api", "delegate-plan", "fehllauf"]);
});

// ── planeSummen (R22 d) ──────────────────────────────────────────────────────

const ZUWACHS = { total_input_tokens: 100, total_output_tokens: 50, total_cost_usd: 0.0015 };

test("planeSummen: Zahlen → neue Summen und eq-Bedingungen auf die gelesenen Werte", () => {
  const p = planeSummen({ total_input_tokens: 1000, total_output_tokens: 500, total_cost_usd: 0.1234 }, ZUWACHS);
  assert.equal(p.ok, true);
  assert.deepEqual(p.neu, { total_input_tokens: 1100, total_output_tokens: 550, total_cost_usd: 0.1249 });
  assert.deepEqual(p.bedingungen, [
    { spalte: "total_input_tokens", alt: 1000 },
    { spalte: "total_output_tokens", alt: 500 },
    { spalte: "total_cost_usd", alt: 0.1234 },
  ]);
  assert.deepEqual(p.bedingungen.map((b) => b.spalte), [...SUMMEN_SPALTEN]);
});

test("planeSummen: null → Basis 0 und IS NULL", () => {
  const p = planeSummen({ total_input_tokens: null, total_output_tokens: 0, total_cost_usd: null }, ZUWACHS);
  assert.equal(p.ok, true);
  assert.equal(p.neu.total_input_tokens, 100);
  assert.equal(p.neu.total_cost_usd, 0.0015);
  assert.equal(p.bedingungen[0].alt, null);
  assert.equal(p.bedingungen[1].alt, 0);
  assert.equal(p.bedingungen[2].alt, null);
});

test("planeSummen: Zahl als Text (NUMERIC) wird gelesen, verglichen wird mit dem Text", () => {
  const p = planeSummen({ total_input_tokens: 1, total_output_tokens: 2, total_cost_usd: "0.5000" }, ZUWACHS);
  assert.equal(p.ok, true);
  assert.equal(p.neu.total_cost_usd, 0.5015);
  assert.equal(p.bedingungen[2].alt, "0.5000");
});

for (const [name, zeile, zuwachs, muster] of [
  ["Spalte fehlt", { total_input_tokens: 1, total_output_tokens: 2 }, ZUWACHS, /fehlt/],
  ["unlesbar", { total_input_tokens: "abc", total_output_tokens: 2, total_cost_usd: 0 }, ZUWACHS, /nicht lesbar/],
  ["negativ", { total_input_tokens: -5, total_output_tokens: 2, total_cost_usd: 0 }, ZUWACHS, /nicht lesbar/],
  ["Objekt", { total_input_tokens: {}, total_output_tokens: 2, total_cost_usd: 0 }, ZUWACHS, /nicht lesbar/],
  ["Zuwachs NaN", { total_input_tokens: 1, total_output_tokens: 2, total_cost_usd: 0 }, { ...ZUWACHS, total_cost_usd: Number.NaN }, /Zuwachs/],
  ["Zuwachs negativ", { total_input_tokens: 1, total_output_tokens: 2, total_cost_usd: 0 }, { ...ZUWACHS, total_input_tokens: -1 }, /Zuwachs/],
]) {
  test(`planeSummen: ${name} → fail-closed`, () => {
    const p = planeSummen(zeile, zuwachs);
    assert.equal(p.ok, false);
    assert.match(p.grund, muster);
  });
}

// ── fasseLaeufeZusammen (R32, R33) ───────────────────────────────────────────

test("fasseLaeufeZusammen: alle Kosten unbekannt → null statt 0 (R32)", () => {
  const s = fasseLaeufeZusammen([
    { fehler: "HTTP 502: leere Antwort", abgeschnitten: null, cost: null },
    { fehler: "HTTP 502: leere Antwort", abgeschnitten: null, cost: null },
  ]);
  assert.deepEqual(s, { agents_activated: 0, total_cost_usd_geschaetzt: null, laeufe_ohne_kosten: 2 });
});

test("fasseLaeufeZusammen: nur fehler null UND abgeschnitten false zählt (R33)", () => {
  const s = fasseLaeufeZusammen([
    { fehler: null, abgeschnitten: false, cost: 0.001 },
    { fehler: null, abgeschnitten: true, cost: 0.002 },
    { fehler: null, abgeschnitten: null, cost: null },
    { fehler: "x", abgeschnitten: null, cost: 0.004 },
  ]);
  assert.equal(s.agents_activated, 1);
  assert.equal(s.total_cost_usd_geschaetzt, 0.007);
  assert.equal(s.laeufe_ohne_kosten, 1);
});

test("fasseLaeufeZusammen: leer → 0 Läufe, Summe null", () => {
  assert.deepEqual(fasseLaeufeZusammen([]), { agents_activated: 0, total_cost_usd_geschaetzt: null, laeufe_ohne_kosten: 0 });
});

// ── werteKostenAus (R8, R20) ─────────────────────────────────────────────────

const JETZT = new Date("2026-11-06T12:00:00.000Z"); // 13:00 Berlin; Mitternacht = 05.11. 23:00 UTC
const PREIS_AB = "2026-11-06";
// Standard: Zeile mit der Kennung der aktuellen Preistabelle; null = ohne Kennung (alter Stand).
const z = (zeit, kosten, quelle = "activation-api", art = null, preisStand = PREIS_AB) => ({ zeit, kosten, quelle, art, preisStand });

test("werteKostenAus: Quellen summiert, Planung getrennt, Monat unvollständig nur durch alte Zeile ohne Kosten", () => {
  const a = werteKostenAus(
    [
      // Nach PREIS_STAND_AB, aber ohne Kennung: lief vor dem Deploy noch mit der alten Formel.
      z("2026-11-06T10:00:00Z", 0.01, "activation-api", null, null),
      z("2026-11-06T09:00:00Z", 0.05, "delegate-plan"),
      z("2026-11-06T08:00:00Z", 0.02, "fehllauf", "planung"),
      // Vor PREIS_STAND_AB, aber mit Kennung: zählt nach Kennung, nicht nach Datum.
      z("2026-11-05T12:00:00Z", 0.03, "fehllauf", "aktivierung"),
      z("2026-11-02T12:00:00Z", 0.1, "activation-api", null, null),
      z("2026-11-03T12:00:00Z", null, "activation-api", null, null),
    ],
    { gesamt: 6, abgeschnitten: false },
    JETZT,
    PREIS_AB,
  );
  assert.deepEqual(a.wert, {
    heute_usd: 0.08,
    monat_usd: 0.21,
    planung_heute_usd: 0.07,
    planung_monat_usd: 0.07,
    laeufe_monat: 6,
    ohne_kosten_heute: 0,
    ohne_kosten_monat: 1,
    heute_vollstaendig: true,
    monat_vollstaendig: false,
    abgeschnitten: false,
  });
  assert.equal(a.status, "warnung");
  const h = a.hinweise.join(" · ");
  assert.match(h, /Monatssumme unvollständig: 1 Lauf ohne Kostenangabe nicht summiert \(davon heute 0\)/);
  assert.match(h, /Tagessumme vollständig/);
  assert.match(
    h,
    /2 von 5 summierten Läufen ohne Preis-Kennung: vor dem Deploy der Preistabelle vom 06\.11\.2026 geschrieben, mit der alten Tabelle geschätzt \(Sonnet zu hoch, Haiku zu niedrig\) und nicht umgerechnet\./,
  );
  assert.doesNotMatch(h, /anderen Preistabelle/);
});

test("werteKostenAus: alles vollständig und mit Kennung → ok, weder Unvollständig- noch Preistabellen-Hinweis", () => {
  const a = werteKostenAus([z("2026-11-06T10:00:00Z", 0.5)], { gesamt: 1, abgeschnitten: false }, JETZT, PREIS_AB);
  assert.equal(a.status, "ok");
  assert.equal(a.wert.heute_vollstaendig, true);
  assert.equal(a.wert.monat_vollstaendig, true);
  assert.doesNotMatch(a.hinweise.join(" "), /unvollständig/);
  assert.doesNotMatch(a.hinweise.join(" "), /Preis-Kennung|Preistabelle/);
});

test("werteKostenAus: Lauf nach PREIS_STAND_AB ohne Kennung (Deploy steht aus) → alte Tabelle, Status bleibt ok", () => {
  const a = werteKostenAus(
    [z("2026-11-06T10:00:00Z", 0.3, "activation-api", null, null), z("2026-11-06T09:00:00Z", 0.2)],
    { gesamt: 2, abgeschnitten: false },
    JETZT,
    PREIS_AB,
  );
  assert.equal(a.status, "ok", "alte Preise sind ein Hinweis, keine Unvollständigkeit");
  assert.equal(a.wert.heute_usd, 0.5);
  assert.match(a.hinweise.join(" "), /1 von 2 summierten Läufen ohne Preis-Kennung/);
});

test("werteKostenAus: Folgemonat, Zeilen ohne Kennung (Deploy erst im Dezember) → Hinweis bleibt", () => {
  const dez = new Date("2026-12-03T10:00:00Z");
  const a = werteKostenAus(
    // Zweite Zeile ohne das Feld (undefined), direkt gebaut: im Helfer z() griffe sonst der Standardwert.
    [z("2026-12-02T10:00:00Z", 0.1, "activation-api", null, null), { zeit: "2026-12-01T10:00:00Z", kosten: 0.1, quelle: "activation-api", art: null, preisStand: undefined }],
    { gesamt: 2, abgeschnitten: false },
    dez,
    PREIS_AB,
  );
  assert.match(a.hinweise.join(" "), /2 von 2 summierten Läufen ohne Preis-Kennung/);
});

test("werteKostenAus: Folgemonat, alle Zeilen mit Kennung → kein Preistabellen-Hinweis", () => {
  const a = werteKostenAus([z("2026-12-02T10:00:00Z", 0.1)], { gesamt: 1, abgeschnitten: false }, new Date("2026-12-03T10:00:00Z"), PREIS_AB);
  assert.doesNotMatch(a.hinweise.join(" "), /Preis-Kennung|Preistabelle/);
});

test("werteKostenAus: andere Kennung → eigener Hinweis; leere oder fremdartige Kennung gilt als ohne Kennung", () => {
  const a = werteKostenAus(
    [
      z("2026-11-06T10:00:00Z", 0.1, "activation-api", null, "2027-01-01"),
      z("2026-11-06T09:00:00Z", 0.1, "activation-api", null, ""),
      z("2026-11-06T08:00:00Z", 0.1, "activation-api", null, 20261106),
      z("2026-11-06T07:00:00Z", 0.1),
    ],
    { gesamt: 4, abgeschnitten: false },
    JETZT,
    PREIS_AB,
  );
  const h = a.hinweise.join(" ");
  assert.match(h, /1 von 4 summierten Läufen mit einer anderen Preistabelle geschätzt \(Kennung nicht 06\.11\.2026\) und nicht umgerechnet\./);
  assert.match(h, /2 von 4 summierten Läufen ohne Preis-Kennung/);
});

test("werteKostenAus: Zeile ohne Kosten und ohne Kennung zählt nur als ohne Kostenangabe", () => {
  const a = werteKostenAus(
    [z("2026-11-06T10:00:00Z", null, "fehllauf", "aktivierung", null), z("2026-11-06T09:00:00Z", 0.2)],
    { gesamt: 2, abgeschnitten: false },
    JETZT,
    PREIS_AB,
  );
  assert.equal(a.wert.ohne_kosten_heute, 1);
  assert.doesNotMatch(a.hinweise.join(" "), /Preis-Kennung/);
});

test("werteKostenAus: heute ohne Kosten → Tag und Monat unvollständig (R20)", () => {
  const a = werteKostenAus([z("2026-11-06T10:00:00Z", null, "fehllauf", "aktivierung"), z("2026-11-06T09:00:00Z", 0.2)], { gesamt: 2, abgeschnitten: false }, JETZT, PREIS_AB);
  assert.equal(a.wert.ohne_kosten_heute, 1);
  assert.equal(a.wert.ohne_kosten_monat, 1);
  assert.equal(a.wert.heute_vollstaendig, false);
  assert.equal(a.wert.monat_vollstaendig, false);
  assert.equal(a.wert.heute_usd, 0.2);
  assert.match(a.hinweise.join(" "), /Tagessumme unvollständig: 1 Lauf von heute ohne Kostenangabe/);
});

test("werteKostenAus: abgeschnitten, aber geladene Zeilen reichen vor Mitternacht → Tag vollständig", () => {
  const a = werteKostenAus([z("2026-11-06T10:00:00Z", 0.1), z("2026-11-05T10:00:00Z", 0.1)], { gesamt: 9000, abgeschnitten: true }, JETZT, PREIS_AB);
  assert.equal(a.status, "warnung");
  assert.equal(a.wert.abgeschnitten, true);
  assert.equal(a.wert.heute_vollstaendig, true);
  assert.equal(a.wert.monat_vollstaendig, false);
  assert.equal(a.wert.laeufe_monat, 9000);
  assert.match(a.hinweise.join(" "), /nur die jüngsten 2 von 9000 Läufen geladen/);
});

test("werteKostenAus: abgeschnitten innerhalb von heute → Tag unvollständig", () => {
  const a = werteKostenAus([z("2026-11-06T10:00:00Z", 0.1), z("2026-11-06T00:30:00Z", 0.1)], { gesamt: 9000, abgeschnitten: true }, JETZT, PREIS_AB);
  assert.equal(a.wert.heute_vollstaendig, false);
  assert.match(a.hinweise.join(" "), /reichen nicht bis Mitternacht zurück/);
});

test("werteKostenAus: Mitternacht in Berlin, nicht UTC", () => {
  // 05.11. 23:30 UTC = 06.11. 00:30 Berlin → heute; 05.11. 22:30 UTC = 23:30 Berlin → gestern.
  const a = werteKostenAus([z("2026-11-05T23:30:00Z", 1), z("2026-11-05T22:30:00Z", 2)], { gesamt: 2, abgeschnitten: false }, JETZT, PREIS_AB);
  assert.equal(a.wert.heute_usd, 1);
  assert.equal(a.wert.monat_usd, 3);
});

test("werteKostenAus: negative oder unlesbare Kosten zählen als ohne Kosten; Zahl als Text wird summiert", () => {
  const a = werteKostenAus([z("2026-11-06T10:00:00Z", -1), z("2026-11-06T09:00:00Z", "0.25"), z("2026-11-06T08:00:00Z", "abc")], { gesamt: 3, abgeschnitten: false }, JETZT, PREIS_AB);
  assert.equal(a.wert.heute_usd, 0.25);
  assert.equal(a.wert.ohne_kosten_heute, 2);
});

test("werteKostenAus: unlesbare Zeit wirft (Messung wird fehler, nicht 0)", () => {
  assert.throws(() => werteKostenAus([z("kaputt", 1)], { gesamt: 1, abgeschnitten: false }, JETZT, PREIS_AB));
});

test("werteKostenAus: ohne Gesamtzahl → Hinweis, laeufe_monat = geladene Zeilen", () => {
  const a = werteKostenAus([z("2026-11-06T10:00:00Z", 0.1)], { gesamt: null, abgeschnitten: false }, JETZT, PREIS_AB);
  assert.equal(a.wert.laeufe_monat, 1);
  assert.match(a.hinweise.join(" "), /keine Gesamtzahl/);
});

// ═══ Totmann für Crons und Agenten (Objekt-Studio Stufe 2, §2.3 und §2.5) ═══
// Im November gilt MEZ (UTC+1): Mo 09.11.2026 08:03 Berlin = 07:03 UTC, 09:07 = 08:07 UTC,
// 18:03 = 17:03 UTC. NACHWEIS_SEIT 2026-11-07 beginnt am 06.11. um 23:00 UTC.

const MORGEN = TOTMANN_PLAN.find((j) => j.job === JOB_BRIEFING_MORGEN);
const ABEND = TOTMANN_PLAN.find((j) => j.job === JOB_BRIEFING_ABEND);
const AUTO = TOTMANN_PLAN.find((j) => j.job === JOB_AUTO_PRODUCE);
/** Plan-Job als aktiv (so, wie er nach §2.6 einmal laufen soll); die Konstante bleibt aus. */
const aktiv = (job) => ({ ...job, aktiv: true, aus_seit: null, grund: null });
const AKTIV_PLAN = TOTMANN_PLAN.map(aktiv);
/** Zeile wie aus lauf_nachweis gelesen; beendet_am eine Minute nach begonnen_am. */
const lauf = (job, begonnen, ergebnis = "ok", extra = {}) => ({
  job,
  begonnen_am: new Date(begonnen).toISOString(),
  beendet_am: new Date(Date.parse(begonnen) + 60_000).toISOString(),
  ergebnis,
  http_status: 200,
  teilergebnisse: [],
  hinweis: null,
  ...extra,
});
const MO_1004 = new Date("2026-11-09T09:04:00Z"); // Mo 09.11.2026 10:04 Berlin
const S_MO = "2026-11-09T07:03:00.000Z"; // Mo 09.11.2026 08:03 Berlin
/** nachweisSeit für Fälle, deren Sollzeitpunkt vor NACHWEIS_SEIT liegt (Sommerzeit-Tage). */
const FRUEHER = "2026-01-01";
const iso = (d) => (d === null ? null : d.toISOString());

test("Totmann: Plan wie setup-vps-crons.sh:21/:24/:27 — Mo–Fr, Europe/Berlin, Karenz 2 h, alle aus seit 30.07.2026", () => {
  assert.deepEqual(
    TOTMANN_PLAN.map((j) => [j.job, j.uhrzeit, [...j.wochentage], j.zeitzone, j.karenz_h, j.aktiv, j.aus_seit]),
    [
      ["briefing-morgen", "08:03", [1, 2, 3, 4, 5], "Europe/Berlin", 2, false, "2026-07-30"],
      ["briefing-abend", "18:03", [1, 2, 3, 4, 5], "Europe/Berlin", 2, false, "2026-07-30"],
      ["content-auto-produce", "09:07", [1, 2, 3, 4, 5], "Europe/Berlin", 2, false, "2026-07-30"],
    ],
  );
  assert.deepEqual(TOTMANN_PLAN.map((j) => /setup-vps-crons\.sh:(\d+)$/.exec(j.fundstelle)?.[1]), ["21", "24", "27"]);
  for (const j of TOTMANN_PLAN) {
    assert.match(j.fundstelle, /^GG\/decisions_log\.md Abschnitt 30\.07\.2026; /);
    assert.equal(j.grund, "Crons abgeschaltet (Betreiber-Entscheid)");
  }
  assert.equal(NACHWEIS_SEIT, "2026-11-07");
  assert.equal(NACHWEIS_TABELLE, "lauf_nachweis");
  assert.equal(JOB_AUTO_PRODUCE_PROBE, "content-auto-produce-probe");
  assert.ok(!TOTMANN_PLAN.some((j) => j.job === JOB_AUTO_PRODUCE_PROBE), "die Probe steht in keinem Plan");
});

test("Totmann §2.5: alle Jobs aus → bernstein, je Job 'aus' ohne Sollzeitpunkt", () => {
  const b = bewerteTotmann(TOTMANN_PLAN, [], MO_1004, null, NACHWEIS_SEIT);
  assert.equal(b.status, "warnung");
  assert.deepEqual(
    b.wert.jobs.map((j) => [j.job, j.lage, j.status, j.sollzeitpunkt, j.letzter_lauf]),
    [
      ["briefing-morgen", "aus", "warnung", null, null],
      ["briefing-abend", "aus", "warnung", null, null],
      ["content-auto-produce", "aus", "warnung", null, null],
    ],
  );
  assert.equal(b.wert.lesefehler, null);
  assert.equal(b.wert.nachweis_seit, "2026-11-07");
  assert.equal(b.hinweis, undefined, "kein Zeitzonen-Hinweis, solange kein Job aktiv ist");
  assert.equal(b.wert.jobs[0].plan, "Mo–Fr 08:03 (Europe/Berlin), Karenz 2 h");
  assert.equal(b.wert.jobs[0].fundstelle, MORGEN.fundstelle);
});

test("Totmann §2.5: aus, mit späterem Nachweis → rot 'läuft, obwohl als aus geführt' (Stolperdraht)", () => {
  const b = bewerteTotmann(TOTMANN_PLAN, [lauf(JOB_BRIEFING_ABEND, "2026-11-09T17:03:00Z")], new Date("2026-11-09T20:00:00Z"), null, NACHWEIS_SEIT);
  assert.equal(b.status, "fehler");
  assert.deepEqual(b.wert.jobs.map((j) => j.lage), ["aus", "laeuft_obwohl_aus", "aus"]);
  assert.equal(b.wert.jobs[1].status, "fehler");
  assert.equal(b.wert.jobs[1].letzter_lauf.begonnen_am, "2026-11-09T17:03:00.000Z");
  // Auch ein Lauf mit Ergebnis "fehler" ist ein Lauf: Der Stolperdraht fragt nicht nach dem Ergebnis.
  const fehler = bewerteTotmann(TOTMANN_PLAN, [lauf(JOB_AUTO_PRODUCE, "2026-11-09T08:07:00Z", "fehler")], MO_1004, null, NACHWEIS_SEIT);
  assert.equal(fehler.wert.jobs[2].lage, "laeuft_obwohl_aus");
});

test("Totmann (Setzung): 'nach aus_seit' heißt ab dem Folgetag 00:00 Europe/Berlin", () => {
  // 30.07.2026 ist MESZ (UTC+2): 31.07. 00:00 Berlin = 30.07. 22:00 UTC.
  const amTag = bewerteJob(MORGEN, lauf(JOB_BRIEFING_MORGEN, "2026-07-30T21:59:59.999Z"), MO_1004, NACHWEIS_SEIT);
  assert.equal(amTag.lage, "aus", "30.07. 23:59:59 Berlin gehört noch zum Tag aus_seit");
  const danach = bewerteJob(MORGEN, lauf(JOB_BRIEFING_MORGEN, "2026-07-30T22:00:00Z"), MO_1004, NACHWEIS_SEIT);
  assert.equal(danach.lage, "laeuft_obwohl_aus", "31.07. 00:00 Berlin");
  assert.equal(danach.status, "fehler");
});

test("Totmann §2.5: Mo 10:04 ohne Lauf → rot 'überfällig' seit Mo 08:03", () => {
  const j = bewerteJob(aktiv(MORGEN), null, MO_1004, NACHWEIS_SEIT);
  assert.equal(j.lage, "ueberfaellig");
  assert.equal(j.status, "fehler");
  assert.equal(j.sollzeitpunkt, S_MO);
  assert.equal(j.sollzeitpunkt_berlin, "Mo 09.11. 08:03");
  assert.equal(j.letzter_lauf, null);
  // Ein Lauf vom Freitag zählt nicht für den Montag; er bleibt als letzter Lauf sichtbar.
  const alt = bewerteJob(aktiv(MORGEN), lauf(JOB_BRIEFING_MORGEN, "2026-11-06T07:03:10Z"), MO_1004, NACHWEIS_SEIT);
  assert.equal(alt.lage, "ueberfaellig");
  assert.equal(alt.letzter_lauf.begonnen_am, "2026-11-06T07:03:10.000Z");
});

test("Totmann §2.5: Mo 08:03 mit 'ok' → grün (auch noch vor Ablauf der Karenz)", () => {
  const ok = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z");
  const j = bewerteJob(aktiv(MORGEN), ok, MO_1004, NACHWEIS_SEIT);
  assert.equal(j.lage, "ok");
  assert.equal(j.status, "ok");
  assert.equal(j.sollzeitpunkt, S_MO);
  // Mo 08:30 Berlin: S ist noch Freitag 08:03 (Montag + 2 h liegt nach jetzt); der Montagslauf erfüllt ihn.
  const frueh = bewerteJob(aktiv(MORGEN), ok, new Date("2026-11-09T07:30:00Z"), FRUEHER);
  assert.equal(frueh.sollzeitpunkt, "2026-11-06T07:03:00.000Z");
  assert.equal(frueh.lage, "ok");
});

test("Totmann §2.5: Samstag, Freitag war 'ok' → grün, kein Wochenend-Fehlalarm", () => {
  const fr = lauf(JOB_BRIEFING_MORGEN, "2026-11-13T07:03:10Z");
  // Sa 12:00, So 23:00, Mo 08:00 Berlin (der Montags-Sollzeitpunkt ist erst ab 10:03 fällig).
  for (const jetzt of ["2026-11-14T11:00:00Z", "2026-11-15T22:00:00Z", "2026-11-16T07:00:00Z"]) {
    const j = bewerteJob(aktiv(MORGEN), fr, new Date(jetzt), NACHWEIS_SEIT);
    assert.equal(j.sollzeitpunkt, "2026-11-13T07:03:00.000Z", jetzt);
    assert.equal(j.lage, "ok", jetzt);
  }
  const ohne = bewerteJob(aktiv(MORGEN), null, new Date("2026-11-14T11:00:00Z"), NACHWEIS_SEIT);
  assert.equal(ohne.sollzeitpunkt_berlin, "Fr 13.11. 08:03", "überfällig seit Freitag, nicht seit Samstag");
});

for (const [ergebnis, lage, status] of [
  ["fehler", "fehlgeschlagen", "fehler"],
  ["teilweise", "teilweise", "warnung"],
  ["uebersprungen", "ok", "ok"],
  ["ok", "ok", "ok"],
]) {
  test(`Totmann §2.5: Lauf ab S − 10 min mit Ergebnis '${ergebnis}' → ${lage} (${status})`, () => {
    const j = bewerteJob(aktiv(MORGEN), lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", ergebnis), MO_1004, NACHWEIS_SEIT);
    assert.equal(j.lage, lage);
    assert.equal(j.status, status);
  });
}

test("Totmann §2.5: auto-produce mit HTTP 200 und status 'fehler' → Zeile 'fehler' → rot", () => {
  const inhalt = autoProduceNachweis(200, { status: "fehler", speicherfehler: ["content-Update (zur_freigabe): permission denied"] }, null);
  assert.equal(inhalt.ergebnis, "fehler");
  assert.equal(inhalt.http_status, 200);
  assert.match(inhalt.hinweis, /^status fehler · Speicherfehler: content-Update/);
  const beginn = new Date("2026-11-09T08:07:00Z");
  const zeile = laufNachweisZeile(JOB_AUTO_PRODUCE, beginn, new Date(beginn.getTime() + 90_000), inhalt);
  const j = bewerteJob(aktiv(AUTO), leseLaufNachweis(zeile), new Date("2026-11-09T10:08:00Z"), NACHWEIS_SEIT);
  assert.equal(j.sollzeitpunkt, "2026-11-09T08:07:00.000Z");
  assert.equal(j.lage, "fehlgeschlagen");
  assert.equal(j.status, "fehler");
});

test("Totmann §2.5: Sommerzeitwechsel 29.03.2026 und 25.10.2026 — Sollzeitpunkt richtig berechnet", () => {
  const morgen = aktiv(MORGEN);
  const abend = aktiv(ABEND);
  const s = (job, jetzt) => iso(letzterSollzeitpunkt(job, new Date(jetzt)));
  // So 29.03.2026: ab 01:00 UTC MESZ (UTC+2). Mo 30.03. 08:03 MESZ = 06:03 UTC.
  assert.equal(s(morgen, "2026-03-30T08:04:00Z"), "2026-03-30T06:03:00.000Z", "Mo 10:04 MESZ");
  assert.equal(s(morgen, "2026-03-30T08:02:00Z"), "2026-03-27T07:03:00.000Z", "Mo 10:02 MESZ → Fr 08:03 MEZ");
  assert.equal(s(morgen, "2026-03-29T10:00:00Z"), "2026-03-27T07:03:00.000Z", "Umstellungssonntag ohne Sollzeitpunkt");
  assert.equal(s(abend, "2026-03-30T18:04:00Z"), "2026-03-30T16:03:00.000Z", "Mo 18:03 MESZ");
  assert.equal(s(abend, "2026-03-30T18:02:00Z"), "2026-03-27T17:03:00.000Z", "→ Fr 18:03 MEZ");
  // So 25.10.2026: ab 01:00 UTC MEZ (UTC+1). Mo 26.10. 08:03 MEZ = 07:03 UTC.
  assert.equal(s(morgen, "2026-10-26T09:04:00Z"), "2026-10-26T07:03:00.000Z", "Mo 10:04 MEZ");
  assert.equal(s(morgen, "2026-10-26T09:02:00Z"), "2026-10-23T06:03:00.000Z", "Mo 10:02 MEZ → Fr 08:03 MESZ");
  assert.equal(s(morgen, "2026-10-25T12:00:00Z"), "2026-10-23T06:03:00.000Z", "Umstellungssonntag ohne Sollzeitpunkt");
  assert.equal(s(abend, "2026-10-26T19:04:00Z"), "2026-10-26T17:03:00.000Z", "Mo 18:03 MEZ");
  // Anzeige in Berliner Ortszeit, Urteil mit dem richtigen S.
  const j = bewerteJob(morgen, null, new Date("2026-03-30T08:04:00Z"), FRUEHER);
  assert.equal(j.sollzeitpunkt_berlin, "Mo 30.03. 08:03");
  assert.equal(j.lage, "ueberfaellig");
  assert.equal(bewerteJob(morgen, null, new Date("2026-10-26T09:04:00Z"), FRUEHER).sollzeitpunkt_berlin, "Mo 26.10. 08:03");
});

test("Totmann §2.5: Lesefehler bei 'alle aus' → bernstein, bei 'einer aktiv' → rot", () => {
  const grund = "Could not find the table 'public.lauf_nachweis' in the schema cache";
  const aus = bewerteTotmann(TOTMANN_PLAN, [], MO_1004, grund, NACHWEIS_SEIT);
  assert.equal(aus.status, "warnung");
  assert.deepEqual(
    aus.wert.jobs.map((j) => [j.lage, j.status]),
    [
      ["nicht_lesbar", "warnung"],
      ["nicht_lesbar", "warnung"],
      ["nicht_lesbar", "warnung"],
    ],
  );
  assert.equal(aus.wert.lesefehler, grund);
  assert.equal(aus.hinweis, `Nachweis nicht lesbar: ${grund}`);
  const einer = [aktiv(MORGEN), ABEND, AUTO];
  const rot = bewerteTotmann(einer, [lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z")], MO_1004, grund, NACHWEIS_SEIT);
  assert.equal(rot.status, "fehler");
  assert.deepEqual(rot.wert.jobs.map((j) => j.status), ["fehler", "warnung", "warnung"]);
  assert.equal(rot.wert.jobs[0].letzter_lauf, null, "bei Lesefehler zählt keine Zeile");
  assert.equal(rot.wert.jobs[0].sollzeitpunkt, S_MO);
  assert.match(rot.hinweis, /^Nachweis nicht lesbar: .* · Sollzeitpunkte in Europe\/Berlin gelesen; die Zeitzone des VPS ist nicht gemessen\.$/);
});

test("Totmann §2.5: Probe-Zeilen (content-auto-produce-probe) zählen nicht — weder als Lauf noch als Stolperdraht", () => {
  const probe = lauf(JOB_AUTO_PRODUCE_PROBE, "2026-11-09T08:07:30Z");
  const jetzt = new Date("2026-11-09T10:08:00Z"); // S auto-produce = Mo 09:07 Berlin = 08:07 UTC
  const plan = [MORGEN, ABEND, aktiv(AUTO)];
  const b = bewerteTotmann(plan, [probe], jetzt, null, NACHWEIS_SEIT);
  assert.equal(b.wert.jobs[2].lage, "ueberfaellig");
  assert.equal(b.wert.jobs[2].letzter_lauf, null);
  assert.equal(b.status, "fehler");
  assert.equal(bewerteJob(aktiv(AUTO), leseLaufNachweis(probe), jetzt, NACHWEIS_SEIT).lage, "ueberfaellig", "auch direkt übergeben nicht");
  const aus = bewerteTotmann(TOTMANN_PLAN, [probe], jetzt, null, NACHWEIS_SEIT);
  assert.equal(aus.status, "warnung", "eine Probe nach aus_seit löst den Stolperdraht nicht aus");
  assert.deepEqual(aus.wert.jobs.map((j) => j.lage), ["aus", "aus", "aus"]);
  // Gegenprobe: dieselbe Zeile als echter Job ist grün.
  assert.equal(bewerteTotmann(plan, [{ ...probe, job: JOB_AUTO_PRODUCE }], jetzt, null, NACHWEIS_SEIT).wert.jobs[2].lage, "ok");
});

test("Totmann §2.3: Grenzen — S + Karenz ≤ jetzt und begonnen_am ≥ S − 10 min gelten genau", () => {
  const job = aktiv(MORGEN);
  assert.equal(iso(letzterSollzeitpunkt(job, new Date("2026-11-09T09:03:00.000Z"))), S_MO, "genau S + 2 h");
  assert.equal(iso(letzterSollzeitpunkt(job, new Date("2026-11-09T09:02:59.999Z"))), "2026-11-06T07:03:00.000Z", "1 ms vorher: Freitag");
  assert.equal(VORLAUF_MS, 600_000);
  const vorlauf = new Date(Date.parse(S_MO) - VORLAUF_MS).toISOString();
  assert.equal(bewerteJob(job, lauf(JOB_BRIEFING_MORGEN, vorlauf), MO_1004, NACHWEIS_SEIT).lage, "ok", "genau S − 10 min zählt");
  const zuFrueh = new Date(Date.parse(S_MO) - VORLAUF_MS - 1).toISOString();
  assert.equal(bewerteJob(job, lauf(JOB_BRIEFING_MORGEN, zuFrueh), MO_1004, NACHWEIS_SEIT).lage, "ueberfaellig", "1 ms früher nicht");
});

test("Totmann §2.3: aktiv, S liegt vor NACHWEIS_SEIT → nicht gemessen ('erster Sollzeitpunkt steht aus')", () => {
  // Sa 07.11.2026 12:00 Berlin: jüngster S = Fr 06.11. 08:03, vor NACHWEIS_SEIT (07.11. 00:00 Berlin).
  const j = bewerteJob(aktiv(MORGEN), null, new Date("2026-11-07T11:00:00Z"), NACHWEIS_SEIT);
  assert.equal(j.lage, "erster_sollzeitpunkt_steht_aus");
  assert.equal(j.status, "nicht_gemessen");
  assert.equal(j.sollzeitpunkt, "2026-11-06T07:03:00.000Z");
  // Ab Mo 09.11. 10:03 Berlin liegt S nach NACHWEIS_SEIT: dann wird geurteilt.
  assert.equal(bewerteJob(aktiv(MORGEN), null, MO_1004, NACHWEIS_SEIT).lage, "ueberfaellig");
  // Ohne Wochentage gibt es keinen Sollzeitpunkt.
  const nie = bewerteJob({ ...aktiv(MORGEN), wochentage: [] }, null, MO_1004, NACHWEIS_SEIT);
  assert.equal(nie.sollzeitpunkt, null);
  assert.equal(nie.status, "nicht_gemessen");
});

test("Totmann §2.3: die Zeile trägt die Farbe des schlechtesten Jobs (fehler > warnung > nicht_gemessen > ok)", () => {
  assert.deepEqual(STATUS_RANG, { ok: 0, nicht_gemessen: 1, warnung: 2, fehler: 3 });
  // Mo 20:00 Berlin, Nachweis ab 09.11.: Der Abend-Sollzeitpunkt (Fr 06.11. 18:03) liegt davor.
  const jetzt = new Date("2026-11-09T19:00:00Z");
  const morgenOk = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z");
  const autoOk = lauf(JOB_AUTO_PRODUCE, "2026-11-09T08:07:05Z");
  const grau = bewerteTotmann(AKTIV_PLAN, [morgenOk, autoOk], jetzt, null, "2026-11-09");
  assert.deepEqual(grau.wert.jobs.map((j) => j.status), ["ok", "nicht_gemessen", "ok"]);
  assert.equal(grau.status, "nicht_gemessen");
  const gelb = bewerteTotmann(AKTIV_PLAN, [{ ...morgenOk, ergebnis: "teilweise" }, autoOk], jetzt, null, "2026-11-09");
  assert.equal(gelb.status, "warnung");
  const rot = bewerteTotmann(AKTIV_PLAN, [{ ...morgenOk, ergebnis: "teilweise" }, { ...autoOk, ergebnis: "fehler" }], jetzt, null, "2026-11-09");
  assert.equal(rot.status, "fehler");
  // Mo 20:10 Berlin: alle drei Sollzeitpunkte des Tages fällig und erfüllt.
  const gruen = bewerteTotmann(AKTIV_PLAN, [morgenOk, autoOk, lauf(JOB_BRIEFING_ABEND, "2026-11-09T17:03:05Z")], new Date("2026-11-09T19:10:00Z"), null, NACHWEIS_SEIT);
  assert.deepEqual(gruen.wert.jobs.map((j) => j.lage), ["ok", "ok", "ok"]);
  assert.equal(gruen.status, "ok");
});

test("Totmann: je Job zählt die jüngste Zeile (begonnen_am), unabhängig von der Reihenfolge", () => {
  const alt = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", "ok");
  const neu = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T08:30:00Z", "fehler");
  for (const laeufe of [
    [alt, neu],
    [neu, alt],
  ]) {
    const b = bewerteTotmann(AKTIV_PLAN, laeufe, MO_1004, null, NACHWEIS_SEIT);
    assert.equal(b.wert.jobs[0].lage, "fehlgeschlagen");
    assert.equal(b.wert.jobs[0].letzter_lauf.begonnen_am, "2026-11-09T08:30:00.000Z");
  }
});

test("Totmann: leseLaufNachweis prüft jede Zeile; eine unlesbare Zeile macht ihren Job 'nicht lesbar'", () => {
  const gut = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", "teilweise", {
    teilergebnisse: [
      { agent: "oracle", ergebnis: "ok", fehler: null },
      { agent: "donna", ergebnis: "fehler", fehler: "HTTP 502" },
    ],
    hinweis: "1 von 2 Agenten vollständig",
  });
  // Postgres liefert timestamptz mit Mikrosekunden; id und eingetragen_am liest der Totmann nicht.
  assert.deepEqual(leseLaufNachweis({ ...gut, id: 7, eingetragen_am: "2026-11-09T07:04:06.123456+00:00", begonnen_am: "2026-11-09T07:03:05.123456+00:00" }), {
    job: "briefing-morgen",
    begonnen_am: "2026-11-09T07:03:05.123Z",
    beendet_am: gut.beendet_am,
    ergebnis: "teilweise",
    http_status: 200,
    teilergebnisse: gut.teilergebnisse,
    hinweis: "1 von 2 Agenten vollständig",
  });
  for (const [name, kaputt] of [
    ["Ergebnis unbekannt", { ...gut, ergebnis: "gut" }],
    ["begonnen_am unlesbar", { ...gut, begonnen_am: "gestern" }],
    ["ohne job", { ...gut, job: null }],
    ["http_status außerhalb 100–599", { ...gut, http_status: 700 }],
    ["teilergebnisse kein Array", { ...gut, teilergebnisse: {} }],
    ["Teilergebnis mit fremdem Ergebnis", { ...gut, teilergebnisse: [{ agent: "oracle", ergebnis: "super", fehler: null }] }],
    ["hinweis keine Zeichenkette", { ...gut, hinweis: 5 }],
    ["kein Objekt", "zeile"],
  ]) {
    assert.equal(leseLaufNachweis(kaputt), null, name);
  }
  const b = bewerteTotmann(TOTMANN_PLAN, [{ ...gut, begonnen_am: "gestern" }], MO_1004, null, NACHWEIS_SEIT);
  assert.deepEqual(b.wert.jobs.map((j) => j.lage), ["nicht_lesbar", "aus", "aus"]);
  assert.equal(b.status, "warnung");
  assert.match(b.hinweis, /Zeile in lauf_nachweis unlesbar \(briefing-morgen\)/);
});

test("Totmann: kaputter Plan ist ein Fehler der Messung, kein stiller Ersatzwert", () => {
  assert.throws(() => letzterSollzeitpunkt({ ...aktiv(MORGEN), uhrzeit: "8:03" }, MO_1004), /Uhrzeit unlesbar/);
  assert.throws(() => letzterSollzeitpunkt({ ...aktiv(MORGEN), zeitzone: "UTC" }, MO_1004), /Zeitzone nicht unterstützt/);
  assert.throws(() => letzterSollzeitpunkt({ ...aktiv(MORGEN), job: "Briefing Morgen" }, MO_1004), /Job-Kennung ungültig/);
  assert.throws(() => bewerteJob({ ...MORGEN, aus_seit: "30.07.2026" }, null, MO_1004, NACHWEIS_SEIT), /aus_seit unlesbar/);
  assert.throws(() => bewerteTotmann(TOTMANN_PLAN, [], MO_1004, null, "07.11.2026"), /NACHWEIS_SEIT unlesbar/);
  assert.throws(() => bewerteTotmann([MORGEN, MORGEN], [], MO_1004, null, NACHWEIS_SEIT), /doppelt/);
  assert.throws(() => bewerteTotmann([], [], MO_1004, null, NACHWEIS_SEIT), /ohne Jobs/);
});

// ── Totmann: Ableitung der Schreiber (§2.2 Punkt 2) ──

const VOLL = { fehler: null, abgeschnitten: false, stop_reason: "end_turn" };

test("Totmann §2.2: Briefing — alle Agenten vollständig → ok, einige → teilweise, keiner → fehler, 5xx → fehler", () => {
  assert.deepEqual(briefingNachweis(200, { oracle: VOLL, donna: VOLL }), {
    ergebnis: "ok",
    http_status: 200,
    teilergebnisse: [
      { agent: "oracle", ergebnis: "ok", fehler: null },
      { agent: "donna", ergebnis: "ok", fehler: null },
    ],
    hinweis: "2 von 2 Agenten vollständig",
  });
  const einer = briefingNachweis(200, { oracle: VOLL, donna: { fehler: "HTTP 502: leere Antwort", abgeschnitten: null, stop_reason: null } });
  assert.equal(einer.ergebnis, "teilweise");
  assert.deepEqual(einer.teilergebnisse[1], { agent: "donna", ergebnis: "fehler", fehler: "HTTP 502: leere Antwort" });
  assert.equal(einer.hinweis, "1 von 2 Agenten vollständig");
  const abgeschnitten = briefingNachweis(200, { oracle: { fehler: null, abgeschnitten: true, stop_reason: "max_tokens" }, donna: VOLL });
  assert.equal(abgeschnitten.ergebnis, "teilweise");
  assert.deepEqual(abgeschnitten.teilergebnisse[0], { agent: "oracle", ergebnis: "teilweise", fehler: "Antwort abgeschnitten (stop_reason max_tokens)" });
  const keiner = briefingNachweis(200, { strategist: { fehler: null, abgeschnitten: null, stop_reason: null } });
  assert.equal(keiner.ergebnis, "fehler");
  assert.equal(keiner.teilergebnisse[0].fehler, "Abschneide-Status nicht gemeldet (activate-Vertrag)");
  assert.equal(briefingNachweis(500, { oracle: VOLL }).ergebnis, "fehler");
  assert.equal(briefingNachweis(200, {}).ergebnis, "fehler");
});

test("Totmann §2.2: Fehlertexte in teilergebnisse und hinweis laufen durch bereinigeFehler", () => {
  mitUmgebung({ ANTHROPIC_API_KEY: SCHLUESSEL }, () => {
    const n = briefingNachweis(200, { oracle: { fehler: `Aufruf fehlgeschlagen: ${SCHLUESSEL} https://abc.supabase.co/rest`, abgeschnitten: null, stop_reason: null } });
    assert.ok(ohneStueck(n.teilergebnisse[0].fehler, SCHLUESSEL), n.teilergebnisse[0].fehler);
    assert.doesNotMatch(n.teilergebnisse[0].fehler, /supabase\.co/);
    const p = pipelineTeilergebnisse([{ agent: "scribe", status: "error", fehler: `x ${SCHLUESSEL}` }]);
    assert.ok(ohneStueck(p[0].fehler, SCHLUESSEL), p[0].fehler);
    const f = autoProduceNachweis(200, { status: "fehler", fehler: `Pipeline: ${SCHLUESSEL}` }, null);
    assert.ok(ohneStueck(f.hinweis, SCHLUESSEL), f.hinweis);
    const a = ausnahmeNachweis(new Error(`kaputt ${SCHLUESSEL}`));
    assert.ok(ohneStueck(a.hinweis, SCHLUESSEL), a.hinweis);
    assert.deepEqual([a.ergebnis, a.http_status], ["fehler", null]);
  });
});

for (const [http, antwort, erwartet] of [
  [200, { status: "produced" }, "ok"],
  [200, { status: "skipped", grund: "Wochenende — kein Content geplant" }, "uebersprungen"],
  [200, { status: "partial", pipeline: { completed: "4/5" } }, "teilweise"],
  [200, { status: "abgelehnt" }, "teilweise"],
  [200, { status: "fehler" }, "fehler"],
  [500, { status: "fehler", fehler: "CONTENT_LAUNCH_DATE ungültig" }, "fehler"],
  [500, { status: "produced" }, "fehler"],
  [503, null, "fehler"],
  [200, { status: "dry_run" }, "ok"],
  [200, {}, "fehler"],
  [200, { status: "unbekannt" }, "fehler"],
]) {
  test(`Totmann §2.2: auto-produce HTTP ${http} ${JSON.stringify(antwort)} → ${erwartet}`, () => {
    const n = autoProduceNachweis(http, antwort, null);
    assert.equal(n.ergebnis, erwartet);
    assert.equal(n.http_status, http);
    assert.deepEqual(n.teilergebnisse, []);
  });
}

test("Totmann §2.2: auto-produce — Hinweise und Teilergebnisse je Pipeline-Stufe", () => {
  assert.equal(autoProduceNachweis(200, { status: "skipped", grund: "kein Kalendereintrag" }, null).hinweis, "status skipped · kein Kalendereintrag");
  assert.equal(autoProduceNachweis(200, { status: "abgelehnt" }, null).hinweis, "status abgelehnt · COUNSEL hat abgelehnt");
  assert.equal(autoProduceNachweis(200, { status: "partial", pipeline: { completed: "4/5" } }, null).hinweis, "status partial · Pipeline-Stufen 4/5");
  assert.equal(autoProduceNachweis(200, { status: "dry_run" }, null).hinweis, "status dry_run · Probe (?dry=true), nichts produziert");
  assert.equal(
    autoProduceNachweis(200, { status: "fehler", fehler: { stufe: "researcher", grund: "Claude-API-Fehler: HTTP 529" } }, null).hinweis,
    "status fehler · researcher: Claude-API-Fehler: HTTP 529",
  );
  assert.equal(autoProduceNachweis(200, {}, null).hinweis, "Antwort ohne status");
  assert.deepEqual(
    pipelineTeilergebnisse([
      { agent: "researcher", status: "done", abgeschnitten: false },
      { agent: "scribe", status: "done", abgeschnitten: true },
      { agent: "counsel", status: "done", abgeschnitten: null },
      { agent: "publisher", status: "error", fehler: "Text zur Freigabe leer" },
      { agent: "amplifier", status: "pending" },
      { agent: "x", status: "running" },
      "kaputt",
    ]),
    [
      { agent: "researcher", ergebnis: "ok", fehler: null },
      { agent: "scribe", ergebnis: "teilweise", fehler: "Antwort abgeschnitten" },
      { agent: "counsel", ergebnis: "teilweise", fehler: "Abschneide-Status nicht gemeldet (activate-Vertrag)" },
      { agent: "publisher", ergebnis: "fehler", fehler: "Text zur Freigabe leer" },
      { agent: "amplifier", ergebnis: "uebersprungen", fehler: null },
      { agent: "x", ergebnis: "fehler", fehler: "Stufen-Status running" },
      { agent: "unbekannt", ergebnis: "fehler", fehler: "Stufe unlesbar" },
    ],
  );
  assert.deepEqual(pipelineTeilergebnisse(undefined), []);
});

test("Totmann: laufNachweisZeile hält die CHECKs von scripts/lauf_nachweis.sql ein", () => {
  const von = new Date("2026-11-09T07:03:00.000Z");
  const bis = new Date("2026-11-09T07:04:30.250Z");
  const inhalt = { ergebnis: "ok", http_status: 200, teilergebnisse: [], hinweis: "x".repeat(400) };
  const z = laufNachweisZeile(JOB_BRIEFING_MORGEN, von, bis, inhalt);
  // Keine id, kein eingetragen_am: die setzt die DB (Sequenz, DEFAULT now()).
  assert.deepEqual(Object.keys(z).sort(), ["beendet_am", "begonnen_am", "ergebnis", "hinweis", "http_status", "job", "teilergebnisse"]);
  assert.equal(z.begonnen_am, "2026-11-09T07:03:00.000Z");
  assert.equal(z.beendet_am, "2026-11-09T07:04:30.250Z");
  assert.equal(Array.from(z.hinweis).length, NACHWEIS_HINWEIS_MAX);
  // char_length zählt Codepunkte, nicht UTF-16-Einheiten.
  const emoji = laufNachweisZeile(JOB_BRIEFING_MORGEN, von, bis, { ...inhalt, hinweis: "\u{1F511}".repeat(301) });
  assert.equal(Array.from(emoji.hinweis).length, NACHWEIS_HINWEIS_MAX);
  const ohne = laufNachweisZeile(JOB_BRIEFING_MORGEN, von, von, { ...inhalt, http_status: 99, hinweis: "  " });
  assert.equal(ohne.http_status, null);
  assert.equal(ohne.hinweis, null);
  assert.throws(() => laufNachweisZeile("Briefing Morgen", von, bis, inhalt), /Job-Kennung ungültig/);
  assert.throws(() => laufNachweisZeile(JOB_BRIEFING_MORGEN, bis, von, inhalt), /beendet_am liegt vor begonnen_am/);
  assert.throws(() => laufNachweisZeile(JOB_BRIEFING_MORGEN, von, bis, { ...inhalt, ergebnis: "gut" }), /Ergebnis ungültig/);
  assert.deepEqual([...LAUF_ERGEBNISSE], ["ok", "teilweise", "fehler", "uebersprungen"]);
});

test("Totmann §2.2: App-Uhr — beendet_am ≥ begonnen_am, auch wenn die Systemuhr während des Laufs zurückspringt", () => {
  const Echt = Date;
  const uhr = starteLaufUhr();
  const zurueck = Echt.now() - 3_600_000;
  globalThis.Date = class extends Echt {
    constructor(...a) {
      if (a.length === 0) super(zurueck);
      else super(...a);
    }
    static now() {
      return zurueck;
    }
  };
  let ende;
  try {
    ende = uhr.beendet();
  } finally {
    globalThis.Date = Echt;
  }
  assert.ok(ende.getTime() >= uhr.begonnen.getTime(), `${ende.toISOString()} < ${uhr.begonnen.toISOString()}`);
  assert.doesNotThrow(() => laufNachweisZeile(JOB_BRIEFING_MORGEN, uhr.begonnen, ende, ausnahmeNachweis(new Error("x"))));
});
