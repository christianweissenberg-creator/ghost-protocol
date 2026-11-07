// Tests für die Server-Helfer der Gruppe B (lib/status-server.ts): Schlüssel lesen,
// Fehler bereinigen, Abschneide-Status, Fehllauf-Metadaten, bedingte Summen, Zusammenfassung
// der Auftragszeile und Kostenauswertung für GET /api/status. Lauf: npm test.
// Seit Stufe 2 (07.11.2026) auch der Totmann: alle Fälle der Tabelle in §2.5 der Spezifikation
// (docs/intern/objekt-studio-stufe-2.md) als reine Tests ohne Netz; Routen, Anzeige und SQL-Datei
// in tests/t-totmann.test.mjs.
// Alle Schlüssel hier sind erfundene Testwerte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  UHR_TOLERANZ_MS,
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

/** Wurzel des Repos (site/..), für scripts/setup-vps-crons.sh. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
// 18:03 = 17:03 UTC. AKTIV_AB (Sa 07.11.2026 00:00 Berlin) ist der 06.11. 23:00 UTC.
// Nachbesserung 07.11.2026 (Prüfbefunde Z1–Z8, B1–B11, SR-1–SR-8): Fälle je Befund unten.

const MORGEN = TOTMANN_PLAN.find((j) => j.job === JOB_BRIEFING_MORGEN);
const ABEND = TOTMANN_PLAN.find((j) => j.job === JOB_BRIEFING_ABEND);
const AUTO = TOTMANN_PLAN.find((j) => j.job === JOB_AUTO_PRODUCE);
/** Messbeginn der Tests (aktiv_seit), Sa 07.11.2026 00:00 Berlin. */
const AKTIV_AB = "2026-11-07T00:00:00+01:00";
/** Messbeginn für Fälle, deren Sollzeitpunkt früher liegt (Sommerzeit-Tage). */
const FRUEH_AB = "2026-01-01T00:00:00+01:00";
/** Plan-Job als aktiv (so, wie er nach §2.6 einmal laufen soll); die Konstante bleibt aus. */
const aktiv = (job, seit = AKTIV_AB) => ({ ...job, aktiv: true, aktiv_seit: seit, zeitzone_beleg: "Testannahme", aus_seit: null, grund: null });
const AKTIV_PLAN = TOTMANN_PLAN.map((j) => aktiv(j));
/** Zeile wie aus lauf_nachweis gelesen; beendet_am 1 min nach begonnen_am, eingetragen_am (DB-Uhr) 1 s danach. */
const lauf = (job, begonnen, ergebnis = "ok", extra = {}) => ({
  job,
  begonnen_am: new Date(begonnen).toISOString(),
  beendet_am: new Date(Date.parse(begonnen) + 60_000).toISOString(),
  eingetragen_am: new Date(Date.parse(begonnen) + 61_000).toISOString(),
  ergebnis,
  http_status: 200,
  teilergebnisse: [],
  hinweis: null,
  ...extra,
});
const MO_1004 = new Date("2026-11-09T09:04:00Z"); // Mo 09.11.2026 10:04 Berlin
const S_MO = "2026-11-09T07:03:00.000Z"; // Mo 09.11.2026 08:03 Berlin
const iso = (d) => (d === null ? null : d.toISOString());
const ALLE_AUS = "alle 3 Jobs laut Plan aus seit 30.07.2026";

/** Wochentage eines crontab-Felds ("1-5", "1,3"), wie Date.getDay(). */
function cronTage(feld) {
  return feld.split(",").flatMap((teil) => {
    const [von, bis] = teil.split("-").map(Number);
    return bis === undefined ? [von] : Array.from({ length: bis - von + 1 }, (_, i) => von + i);
  });
}

test("Totmann: Plan wie scripts/setup-vps-crons.sh:21/:24/:27 (aus der Datei gelesen) — Mo–Fr, Karenz 2 h, alle aus seit 30.07.2026", () => {
  // Prüfbefund B11: vorher nur gegen eine Literal-Kopie verglichen. Gelesen werden nur Minute,
  // Stunde und Wochentag am Zeilenanfang; der Rest der Zeile (dort steht ein Secret-Parameter)
  // wird weder verglichen noch in einer Meldung ausgegeben. Z_SETUP_VPS_CRONS prüft eine Kopie.
  const datei = process.env.Z_SETUP_VPS_CRONS ?? path.join(REPO, "scripts", "setup-vps-crons.sh");
  const zeilen = readFileSync(datei, "utf8").split("\n");
  for (const j of TOTMANN_PLAN) {
    const nr = Number(/setup-vps-crons\.sh:(\d+)$/.exec(j.fundstelle)?.[1]);
    const m = /^(\d{1,2}) (\d{1,2}) \* \* ([0-9,-]+) /.exec(zeilen[nr - 1] ?? "");
    assert.ok(m !== null, `${j.job}: setup-vps-crons.sh:${nr} beginnt nicht mit "Minute Stunde * * Wochentage"`);
    assert.equal(`${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`, j.uhrzeit, `${j.job}: Uhrzeit laut setup-vps-crons.sh:${nr}`);
    assert.deepEqual(cronTage(m[3]), [...j.wochentage], `${j.job}: Wochentage laut setup-vps-crons.sh:${nr}`);
  }
  assert.deepEqual(TOTMANN_PLAN.map((j) => /setup-vps-crons\.sh:(\d+)$/.exec(j.fundstelle)?.[1]), ["21", "24", "27"]);
  assert.deepEqual(
    TOTMANN_PLAN.map((j) => [j.job, j.zeitzone, j.zeitzone_beleg, j.karenz_h, j.aktiv, j.aktiv_seit, j.aus_seit, j.stolperdraht_quittiert_bis]),
    [
      ["briefing-morgen", "Europe/Berlin", null, 2, false, null, "2026-07-30", null],
      ["briefing-abend", "Europe/Berlin", null, 2, false, null, "2026-07-30", null],
      ["content-auto-produce", "Europe/Berlin", null, 2, false, null, "2026-07-30", null],
    ],
  );
  for (const j of TOTMANN_PLAN) {
    assert.match(j.fundstelle, /^GG\/decisions_log\.md Abschnitt 30\.07\.2026; /);
    assert.equal(j.grund, "Crons abgeschaltet (Betreiber-Entscheid)");
  }
  // Prüfbefund B1: kein Beobachtungsfenster, solange Deploy und SQL nicht festgehalten sind.
  assert.equal(NACHWEIS_SEIT, null);
  assert.equal(NACHWEIS_TABELLE, "lauf_nachweis");
  assert.equal(JOB_AUTO_PRODUCE_PROBE, "content-auto-produce-probe");
  assert.ok(!TOTMANN_PLAN.some((j) => j.job === JOB_AUTO_PRODUCE_PROBE), "die Probe steht in keinem Plan");
});

test("Totmann §2.5: alle Jobs aus → bernstein, je Job 'aus' ohne Sollzeitpunkt; Hinweis und Plan-Zeile nennen Setzungen", () => {
  const b = bewerteTotmann(TOTMANN_PLAN, [], MO_1004, null, NACHWEIS_SEIT);
  assert.equal(b.status, "warnung");
  assert.deepEqual(
    b.wert.jobs.map((j) => [j.job, j.lage, j.status, j.sollzeitpunkt, j.letzter_lauf, j.stolperdraht_am, j.ueberfaellig_seit]),
    [
      ["briefing-morgen", "aus", "warnung", null, null, null, null],
      ["briefing-abend", "aus", "warnung", null, null, null, null],
      ["content-auto-produce", "aus", "warnung", null, null, null, null],
    ],
  );
  assert.equal(b.wert.lesefehler, null);
  assert.equal(b.wert.nachweis_seit, null);
  // Prüfbefund B7: Der Grund steht auch in hinweis — den liest ein Client von vor dem Totmann.
  assert.equal(b.hinweis, ALLE_AUS);
  // Prüfbefund B10: Zeitzone und Karenz heißen Setzung, auch solange kein Job aktiv ist.
  assert.equal(b.wert.jobs[0].plan, "Mo–Fr 08:03 Europe/Berlin (angenommen, VPS-Zeitzone nicht gemessen), Karenz 2 h (Setzung)");
  assert.equal(b.wert.jobs[0].fundstelle, MORGEN.fundstelle);
  const gemessen = bewerteJob({ ...aktiv(MORGEN), zeitzone: "UTC", zeitzone_beleg: "timedatectl, 12.01.2027" }, [], MO_1004);
  assert.equal(gemessen.plan, "Mo–Fr 08:03 UTC (gemessen: timedatectl, 12.01.2027), Karenz 2 h (Setzung)");
  const einer = bewerteTotmann([aktiv(MORGEN), ABEND, AUTO], [], MO_1004, null, NACHWEIS_SEIT);
  assert.equal(einer.hinweis, "Briefing abends, Content Auto-Produce laut Plan aus seit 30.07.2026");
  assert.equal(bewerteTotmann(AKTIV_PLAN, [], MO_1004, null, NACHWEIS_SEIT).hinweis, undefined);
});

test("Totmann §2.5: aus, mit späterem Nachweis → rot, Stolperdraht mit Zeitpunkt des Laufs", () => {
  const b = bewerteTotmann(TOTMANN_PLAN, [lauf(JOB_BRIEFING_ABEND, "2026-11-09T17:03:00Z")], new Date("2026-11-09T20:00:00Z"), null, NACHWEIS_SEIT);
  assert.equal(b.status, "fehler");
  assert.deepEqual(b.wert.jobs.map((j) => j.lage), ["aus", "laeuft_obwohl_aus", "aus"]);
  assert.equal(b.wert.jobs[1].status, "fehler");
  assert.equal(b.wert.jobs[1].letzter_lauf.begonnen_am, "2026-11-09T17:03:00.000Z");
  assert.equal(b.wert.jobs[1].stolperdraht_am, "2026-11-09T17:03:00.000Z");
  assert.equal(b.wert.jobs[1].stolperdraht_am_berlin, "09.11.2026 18:03");
  assert.equal(b.wert.jobs[1].hinweis, null);
  // Auch ein Lauf mit Ergebnis "fehler" ist ein Lauf: Der Stolperdraht fragt nicht nach dem Ergebnis.
  const fehler = bewerteTotmann(TOTMANN_PLAN, [lauf(JOB_AUTO_PRODUCE, "2026-11-09T08:07:00Z", "fehler")], MO_1004, null, NACHWEIS_SEIT);
  assert.equal(fehler.wert.jobs[2].lage, "laeuft_obwohl_aus");
});

test("Totmann (Setzung): 'nach aus_seit' heißt ab dem Folgetag 00:00 Europe/Berlin", () => {
  // 30.07.2026 ist MESZ (UTC+2): 31.07. 00:00 Berlin = 30.07. 22:00 UTC.
  const amTag = bewerteJob(MORGEN, [lauf(JOB_BRIEFING_MORGEN, "2026-07-30T21:59:59.999Z")], MO_1004);
  assert.equal(amTag.lage, "aus", "30.07. 23:59:59 Berlin gehört noch zum Tag aus_seit");
  const danach = bewerteJob(MORGEN, [lauf(JOB_BRIEFING_MORGEN, "2026-07-30T22:00:00Z")], MO_1004);
  assert.equal(danach.lage, "laeuft_obwohl_aus", "31.07. 00:00 Berlin");
  assert.equal(danach.status, "fehler");
});

test("Totmann §2.5: Mo 10:04 ohne Lauf → rot 'überfällig' seit Mo 08:03", () => {
  const j = bewerteJob(aktiv(MORGEN), [], MO_1004);
  assert.equal(j.lage, "ueberfaellig");
  assert.equal(j.status, "fehler");
  assert.equal(j.sollzeitpunkt, S_MO);
  assert.equal(j.sollzeitpunkt_berlin, "Mo 09.11. 08:03");
  assert.equal(j.ueberfaellig_seit, S_MO);
  assert.equal(j.ueberfaellig_seit_berlin, "Mo 09.11. 08:03");
  assert.equal(j.letzter_lauf, null);
  // Ein Lauf vom Freitag zählt nicht für den Montag; er bleibt als letzter Lauf sichtbar.
  const alt = bewerteJob(aktiv(MORGEN, FRUEH_AB), [lauf(JOB_BRIEFING_MORGEN, "2026-11-06T07:03:10Z")], MO_1004);
  assert.equal(alt.lage, "ueberfaellig");
  assert.equal(alt.letzter_lauf.begonnen_am, "2026-11-06T07:03:10.000Z");
  assert.equal(alt.ueberfaellig_seit_berlin, "Mo 09.11. 08:03", "nach dem Freitag ist Montag der erste verpasste");
});

test("Totmann §2.5: Mo 08:03 mit 'ok' → grün (auch noch vor Ablauf der Karenz)", () => {
  const ok = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z");
  const j = bewerteJob(aktiv(MORGEN), [ok], MO_1004);
  assert.equal(j.lage, "ok");
  assert.equal(j.status, "ok");
  assert.equal(j.sollzeitpunkt, S_MO);
  assert.equal(j.bewerteter_lauf.begonnen_am, ok.begonnen_am);
  // Mo 08:30 Berlin: S ist noch Freitag 08:03 (Montag + 2 h liegt nach jetzt); der Montagslauf erfüllt ihn.
  const frueh = bewerteJob(aktiv(MORGEN, FRUEH_AB), [ok], new Date("2026-11-09T07:30:00Z"));
  assert.equal(frueh.sollzeitpunkt, "2026-11-06T07:03:00.000Z");
  assert.equal(frueh.lage, "ok");
});

test("Totmann §2.5: Samstag, Freitag war 'ok' → grün, kein Wochenend-Fehlalarm", () => {
  const fr = lauf(JOB_BRIEFING_MORGEN, "2026-11-13T07:03:10Z");
  // Sa 12:00, So 23:00, Mo 08:00 Berlin (der Montags-Sollzeitpunkt ist erst ab 10:03 fällig).
  for (const jetzt of ["2026-11-14T11:00:00Z", "2026-11-15T22:00:00Z", "2026-11-16T07:00:00Z"]) {
    const j = bewerteJob(aktiv(MORGEN), [fr], new Date(jetzt));
    assert.equal(j.sollzeitpunkt, "2026-11-13T07:03:00.000Z", jetzt);
    assert.equal(j.lage, "ok", jetzt);
  }
  const ohne = bewerteJob(aktiv(MORGEN), [], new Date("2026-11-14T11:00:00Z"));
  assert.equal(ohne.sollzeitpunkt_berlin, "Fr 13.11. 08:03", "S ist Freitag, nicht Samstag");
});

for (const [ergebnis, lage, status] of [
  ["fehler", "fehlgeschlagen", "fehler"],
  ["teilweise", "teilweise", "warnung"],
  ["uebersprungen", "ok", "ok"],
  ["ok", "ok", "ok"],
]) {
  test(`Totmann §2.5: Lauf ab S − 10 min mit Ergebnis '${ergebnis}' → ${lage} (${status})`, () => {
    const j = bewerteJob(aktiv(MORGEN), [lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", ergebnis)], MO_1004);
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
  // eingetragen_am setzt die DB (DEFAULT now()); hier eine Sekunde nach beendet_am.
  const gelesen = leseLaufNachweis({ ...zeile, eingetragen_am: new Date(beginn.getTime() + 91_000).toISOString() });
  const j = bewerteJob(aktiv(AUTO), [gelesen], new Date("2026-11-09T10:08:00Z"));
  assert.equal(j.sollzeitpunkt, "2026-11-09T08:07:00.000Z");
  assert.equal(j.lage, "fehlgeschlagen");
  assert.equal(j.status, "fehler");
});

test("Totmann §2.5: Sommerzeitwechsel 29.03.2026 und 25.10.2026 — Sollzeitpunkt richtig berechnet", () => {
  const morgen = aktiv(MORGEN, FRUEH_AB);
  const abend = aktiv(ABEND, FRUEH_AB);
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
  const j = bewerteJob(morgen, [], new Date("2026-03-30T08:04:00Z"));
  assert.equal(j.sollzeitpunkt_berlin, "Mo 30.03. 08:03");
  assert.equal(j.lage, "ueberfaellig");
  assert.equal(bewerteJob(morgen, [], new Date("2026-10-26T09:04:00Z")).sollzeitpunkt_berlin, "Mo 26.10. 08:03");
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
  assert.equal(aus.hinweis, `Nachweis nicht lesbar: ${grund} · ${ALLE_AUS}`);
  const einer = [aktiv(MORGEN), ABEND, AUTO];
  const rot = bewerteTotmann(einer, [lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z")], MO_1004, grund, NACHWEIS_SEIT);
  assert.equal(rot.status, "fehler");
  assert.deepEqual(rot.wert.jobs.map((j) => j.status), ["fehler", "warnung", "warnung"]);
  assert.equal(rot.wert.jobs[0].letzter_lauf, null, "bei Lesefehler zählt keine Zeile");
  assert.equal(rot.wert.jobs[0].sollzeitpunkt, S_MO);
  assert.equal(rot.hinweis, `Nachweis nicht lesbar: ${grund} · Briefing abends, Content Auto-Produce laut Plan aus seit 30.07.2026`);
});

test("Totmann §2.5: Probe-Zeilen (content-auto-produce-probe) zählen nicht — weder als Lauf noch als Stolperdraht", () => {
  const probe = lauf(JOB_AUTO_PRODUCE_PROBE, "2026-11-09T08:07:30Z");
  const jetzt = new Date("2026-11-09T10:08:00Z"); // S auto-produce = Mo 09:07 Berlin = 08:07 UTC
  const plan = [MORGEN, ABEND, aktiv(AUTO)];
  const b = bewerteTotmann(plan, [probe], jetzt, null, NACHWEIS_SEIT);
  assert.equal(b.wert.jobs[2].lage, "ueberfaellig");
  assert.equal(b.wert.jobs[2].letzter_lauf, null);
  assert.equal(b.status, "fehler");
  assert.equal(bewerteJob(aktiv(AUTO), [leseLaufNachweis(probe)], jetzt).lage, "ueberfaellig", "auch direkt übergeben nicht");
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
  assert.equal(bewerteJob(job, [lauf(JOB_BRIEFING_MORGEN, vorlauf)], MO_1004).lage, "ok", "genau S − 10 min zählt");
  const zuFrueh = new Date(Date.parse(S_MO) - VORLAUF_MS - 1).toISOString();
  assert.equal(bewerteJob(job, [lauf(JOB_BRIEFING_MORGEN, zuFrueh)], MO_1004).lage, "ueberfaellig", "1 ms früher nicht");
});

test("Totmann §2.3: aktiv, S liegt vor aktiv_seit → nicht gemessen ('erster Sollzeitpunkt steht aus')", () => {
  // Sa 07.11.2026 12:00 Berlin: jüngster S = Fr 06.11. 08:03, vor aktiv_seit (07.11. 00:00 Berlin).
  const j = bewerteJob(aktiv(MORGEN), [], new Date("2026-11-07T11:00:00Z"));
  assert.equal(j.lage, "erster_sollzeitpunkt_steht_aus");
  assert.equal(j.status, "nicht_gemessen");
  assert.equal(j.sollzeitpunkt, "2026-11-06T07:03:00.000Z");
  assert.equal(j.aktiv_seit, AKTIV_AB);
  // Ab Mo 09.11. 10:03 Berlin liegt S nach aktiv_seit: dann wird geurteilt.
  assert.equal(bewerteJob(aktiv(MORGEN), [], MO_1004).lage, "ueberfaellig");
  // Ohne Wochentage gäbe es nie einen Sollzeitpunkt: für einen aktiven Job ein Planfehler (Prüfbefund
  // logik-3, Test unten); ein abgeschalteter hat ohnehin keinen.
  assert.equal(letzterSollzeitpunkt({ ...MORGEN, wochentage: [] }, MO_1004), null);
});

test("Totmann (Prüfbefund Z1): Messbeginn je Job — eine Aktivierung mitten am Tag ist erst 'nicht gemessen', nicht sofort rot", () => {
  // Aktivierungs-PR deployt Di 12.01.2027 15:00 Berlin (14:00 UTC), der Crontab läuft ab dann. Vorher
  // galt ein Tag für alle Jobs (NACHWEIS_SEIT 2026-11-07): Alle drei wären sofort rot "überfällig".
  const seit = "2027-01-12T15:00:00+01:00";
  const plan = TOTMANN_PLAN.map((j) => aktiv(j, seit));
  const sofort = bewerteTotmann(plan, [], new Date("2027-01-12T14:00:00Z"), null, NACHWEIS_SEIT);
  assert.deepEqual(sofort.wert.jobs.map((j) => j.lage), Array(3).fill("erster_sollzeitpunkt_steht_aus"));
  assert.equal(sofort.status, "nicht_gemessen");
  // Sa 16.01.2027 12:00, am selben Tag aktiviert: die Freitags-Sollzeitpunkte liegen davor.
  const sa = bewerteTotmann(TOTMANN_PLAN.map((j) => aktiv(j, "2027-01-16T11:00:00+01:00")), [], new Date("2027-01-16T11:00:00Z"), null, NACHWEIS_SEIT);
  assert.equal(sa.status, "nicht_gemessen");
  // Mi 13.01. 10:04 ohne Zeile: Morgen (Mi 08:03) und Abend (Di 18:03) lagen nach der Aktivierung →
  // rot; auto-produce (S = Di 09:07) lag davor → weiter nicht gemessen.
  const mi = bewerteTotmann(plan, [], new Date("2027-01-13T09:04:00Z"), null, NACHWEIS_SEIT);
  assert.deepEqual(mi.wert.jobs.map((j) => j.lage), ["ueberfaellig", "ueberfaellig", "erster_sollzeitpunkt_steht_aus"]);
  assert.deepEqual(mi.wert.jobs.map((j) => j.ueberfaellig_seit_berlin), ["Mi 13.01. 08:03", "Di 12.01. 18:03", null]);
  // Grenze: S genau am Messbeginn wird geurteilt, 1 ms später aktiviert nicht.
  const genau = bewerteJob(aktiv(MORGEN, "2027-01-13T08:03:00+01:00"), [], new Date("2027-01-13T09:04:00Z"));
  assert.equal(genau.lage, "ueberfaellig");
  const danach = bewerteJob(aktiv(MORGEN, "2027-01-13T08:03:00.001+01:00"), [], new Date("2027-01-13T09:04:00Z"));
  assert.equal(danach.lage, "erster_sollzeitpunkt_steht_aus");
});

test("Totmann §2.3: die Zeile trägt die Farbe des schlechtesten Jobs (fehler > warnung > nicht_gemessen > ok)", () => {
  assert.deepEqual(STATUS_RANG, { ok: 0, nicht_gemessen: 1, warnung: 2, fehler: 3 });
  // Mo 20:00 Berlin, Abend aktiv seit 09.11.: Dessen Sollzeitpunkt (Fr 06.11. 18:03) liegt davor.
  const jetzt = new Date("2026-11-09T19:00:00Z");
  const plan = [aktiv(MORGEN), aktiv(ABEND, "2026-11-09T00:00:00+01:00"), aktiv(AUTO)];
  const morgenOk = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z");
  const autoOk = lauf(JOB_AUTO_PRODUCE, "2026-11-09T08:07:05Z");
  const grau = bewerteTotmann(plan, [morgenOk, autoOk], jetzt, null, NACHWEIS_SEIT);
  assert.deepEqual(grau.wert.jobs.map((j) => j.status), ["ok", "nicht_gemessen", "ok"]);
  assert.equal(grau.status, "nicht_gemessen");
  const gelb = bewerteTotmann(plan, [{ ...morgenOk, ergebnis: "teilweise" }, autoOk], jetzt, null, NACHWEIS_SEIT);
  assert.equal(gelb.status, "warnung");
  const rot = bewerteTotmann(plan, [{ ...morgenOk, ergebnis: "teilweise" }, { ...autoOk, ergebnis: "fehler" }], jetzt, null, NACHWEIS_SEIT);
  assert.equal(rot.status, "fehler");
  // Mo 20:10 Berlin: alle drei Sollzeitpunkte des Tages fällig und erfüllt.
  const gruen = bewerteTotmann(AKTIV_PLAN, [morgenOk, autoOk, lauf(JOB_BRIEFING_ABEND, "2026-11-09T17:03:05Z")], new Date("2026-11-09T19:10:00Z"), null, NACHWEIS_SEIT);
  assert.deepEqual(gruen.wert.jobs.map((j) => j.lage), ["ok", "ok", "ok"]);
  assert.equal(gruen.status, "ok");
});

test("Totmann: je Job zählt die jüngste Zeile (zuletzt eingetragen, Prüfbefund r3-logik-1), unabhängig von der Reihenfolge", () => {
  const alt = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", "ok");
  const neu = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T08:30:00Z", "fehler");
  for (const laeufe of [
    [alt, neu],
    [neu, alt],
  ]) {
    const b = bewerteTotmann(AKTIV_PLAN, laeufe, MO_1004, null, NACHWEIS_SEIT);
    assert.equal(b.wert.jobs[0].lage, "fehlgeschlagen");
    assert.equal(b.wert.jobs[0].letzter_lauf.begonnen_am, "2026-11-09T08:30:00.000Z");
    assert.equal(b.wert.jobs[0].bewerteter_lauf.begonnen_am, "2026-11-09T08:30:00.000Z");
  }
});

test("Totmann (Prüfbefund Z5): ein späterer übersprungener Lauf überdeckt kein früheres Ergebnis zum selben Sollzeitpunkt", () => {
  // Fr 20.11. 09:07 fehler, manueller Nachlauf Sa 21.11. 11:30 Berlin: "skipped, Wochenende"
  // (api/content/auto-produce/route.ts). Sa 12:00 Berlin; S = Fr 20.11. 09:07.
  const frFehler = lauf(JOB_AUTO_PRODUCE, "2026-11-20T08:07:00Z", "fehler");
  const saSkip = lauf(JOB_AUTO_PRODUCE, "2026-11-21T10:30:00Z", "uebersprungen", { hinweis: "status skipped · Wochenende — kein Content geplant" });
  const jetzt = new Date("2026-11-21T11:00:00Z");
  for (const laeufe of [
    [frFehler, saSkip],
    [saSkip, frFehler],
  ]) {
    const j = bewerteJob(aktiv(AUTO), laeufe, jetzt);
    assert.equal(j.sollzeitpunkt, "2026-11-20T08:07:00.000Z");
    assert.equal(j.lage, "fehlgeschlagen");
    assert.equal(j.status, "fehler");
    assert.equal(j.letzter_lauf.begonnen_am, saSkip.begonnen_am, "letzter Lauf bleibt der jüngste");
    assert.equal(j.bewerteter_lauf.begonnen_am, frFehler.begonnen_am, "bewertet wird der Freitagslauf");
  }
  const alle = bewerteTotmann(AKTIV_PLAN, [lauf(JOB_BRIEFING_MORGEN, "2026-11-20T07:03:05Z"), lauf(JOB_BRIEFING_ABEND, "2026-11-20T17:03:05Z"), frFehler, saSkip], jetzt, null, NACHWEIS_SEIT);
  assert.equal(alle.status, "fehler");
  assert.deepEqual(alle.wert.jobs.map((j) => j.lage), ["ok", "ok", "fehlgeschlagen"]);
  // teilweise bleibt bernstein trotz späterem Skip.
  assert.equal(bewerteJob(aktiv(AUTO), [{ ...frFehler, ergebnis: "teilweise" }, saSkip], jetzt).lage, "teilweise");
  // Ein späterer ok-Nachlauf am Freitag heilt den Fehler; ein Skip danach ändert daran nichts.
  const geheilt = bewerteJob(aktiv(AUTO), [frFehler, lauf(JOB_AUTO_PRODUCE, "2026-11-20T13:00:00Z", "ok"), saSkip], jetzt);
  assert.equal(geheilt.lage, "ok");
  assert.equal(geheilt.bewerteter_lauf.begonnen_am, "2026-11-20T13:00:00.000Z");
  // Nur übersprungene Läufe ab S − 10 min: grün ("übersprungen"); ein Fehler vor dem Fenster zählt nicht.
  const nurSkip = bewerteJob(aktiv(AUTO), [lauf(JOB_AUTO_PRODUCE, "2026-11-19T08:07:00Z", "fehler"), lauf(JOB_AUTO_PRODUCE, "2026-11-20T08:07:00Z", "uebersprungen")], jetzt);
  assert.equal(nurSkip.lage, "ok");
  assert.equal(nurSkip.bewerteter_lauf.ergebnis, "uebersprungen");
});

test("Totmann (Prüfbefunde Z2, SR-5): begonnen_am in der Zukunft oder App- gegen DB-Uhr verschoben → rot 'Zeitpunkt unplausibel'", () => {
  // Vorher: eine einzige Zeile vom 01.03.2027 hielt einen aktiven Job bis 02.03.2027 grün.
  const zukunft = lauf(JOB_BRIEFING_MORGEN, "2027-03-01T07:03:00Z");
  for (const jetzt of ["2026-11-20T09:04:00Z", "2026-12-24T12:00:00Z", "2027-02-26T12:00:00Z"]) {
    const b = bewerteTotmann([aktiv(MORGEN), ABEND, AUTO], [zukunft], new Date(jetzt), null, NACHWEIS_SEIT);
    assert.equal(b.wert.jobs[0].lage, "zeit_unplausibel", jetzt);
    assert.equal(b.wert.jobs[0].status, "fehler", jetzt);
    assert.equal(b.status, "fehler", jetzt);
    assert.equal(b.wert.jobs[0].hinweis, "begonnen_am 01.03.2027 08:03 liegt mehr als 10 min nach der Messzeit", jetzt);
  }
  // Grenze UHR_TOLERANZ_MS: genau 10 min nach der Messzeit ist plausibel, 1 ms mehr nicht.
  assert.equal(UHR_TOLERANZ_MS, 600_000);
  const grenze = new Date(MO_1004.getTime() + UHR_TOLERANZ_MS).toISOString();
  assert.equal(bewerteJob(aktiv(MORGEN), [lauf(JOB_BRIEFING_MORGEN, grenze)], MO_1004).lage, "ok");
  const drueber = new Date(MO_1004.getTime() + UHR_TOLERANZ_MS + 1).toISOString();
  assert.equal(bewerteJob(aktiv(MORGEN), [lauf(JOB_BRIEFING_MORGEN, drueber)], MO_1004).lage, "zeit_unplausibel");
  // App-Uhr der DB-Uhr 14 min voraus (eingetragen_am vor beendet_am): unplausibel, auch wenn
  // begonnen_am selbst vor der Messzeit liegt — der Lauf hätte sonst für Mo 08:03 gezählt.
  const voraus = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", "ok", { eingetragen_am: "2026-11-09T06:50:00Z" });
  const v = bewerteJob(aktiv(MORGEN), [voraus], MO_1004);
  assert.equal(v.lage, "zeit_unplausibel");
  assert.equal(v.hinweis, "App-Uhr (beendet_am) und DB-Uhr (eingetragen_am) weichen um mehr als 10 min ab");
  // Ebenso 11 min nach (App-Uhr nachgehend); 9 min Abweichung sind geduldet.
  assert.equal(bewerteJob(aktiv(MORGEN), [lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", "ok", { eingetragen_am: "2026-11-09T07:15:05Z" })], MO_1004).lage, "zeit_unplausibel");
  assert.equal(bewerteJob(aktiv(MORGEN), [lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", "ok", { eingetragen_am: "2026-11-09T06:55:05Z" })], MO_1004).lage, "ok");
  // Auch die ältere Zeile, die bewertet würde, muss plausibel sein (die Route liest zwei je Job).
  const beide = bewerteJob(aktiv(MORGEN), [lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", "fehler", { eingetragen_am: "2026-11-09T06:00:00Z" }), lauf(JOB_BRIEFING_MORGEN, "2026-11-09T08:00:00Z", "uebersprungen")], MO_1004);
  assert.equal(beide.lage, "zeit_unplausibel");
  // Abgeschaltet: Die Zukunftszeile ist trotzdem ein Lauf nach aus_seit → Stolperdraht (rot).
  assert.equal(bewerteTotmann(TOTMANN_PLAN, [zukunft], new Date("2026-11-20T09:04:00Z"), null, NACHWEIS_SEIT).wert.jobs[0].lage, "laeuft_obwohl_aus");
});

test("Totmann (Prüfbefund Z3): 'überfällig seit' nennt den ersten verpassten Sollzeitpunkt, nicht den jüngsten", () => {
  const job = aktiv(MORGEN);
  // Letzter Lauf Mo 16.11. 08:03 ok, jetzt Mo 23.11. 10:04: verpasst seit Di 17.11. 08:03.
  const j = bewerteJob(job, [lauf(JOB_BRIEFING_MORGEN, "2026-11-16T07:03:05Z")], new Date("2026-11-23T09:04:00Z"));
  assert.equal(j.lage, "ueberfaellig");
  assert.equal(j.sollzeitpunkt_berlin, "Mo 23.11. 08:03", "S bleibt der jüngste fällige");
  assert.equal(j.ueberfaellig_seit, "2026-11-17T07:03:00.000Z");
  assert.equal(j.ueberfaellig_seit_berlin, "Di 17.11. 08:03");
  // Nie gelaufen, aktiv seit Sa 07.11.: verpasst seit Mo 09.11. 08:03 (nicht seit Fr 27.11.).
  assert.equal(bewerteJob(job, [], new Date("2026-11-27T09:04:00Z")).ueberfaellig_seit_berlin, "Mo 09.11. 08:03");
  // Letzter Lauf am Freitag: verpasst seit Montag, das Wochenende hat keinen Sollzeitpunkt.
  assert.equal(bewerteJob(job, [lauf(JOB_BRIEFING_MORGEN, "2026-11-13T07:03:10Z")], new Date("2026-11-16T09:04:00Z")).ueberfaellig_seit_berlin, "Mo 16.11. 08:03");
  // Über den Wechsel auf MEZ: letzter Lauf Fr 23.10. 08:03 MESZ, jetzt Di 27.10. 10:04 MEZ → seit Mo 26.10. 08:03 MEZ.
  const dst = bewerteJob(aktiv(MORGEN, FRUEH_AB), [lauf(JOB_BRIEFING_MORGEN, "2026-10-23T06:03:05Z")], new Date("2026-10-27T09:04:00Z"));
  assert.equal(dst.ueberfaellig_seit, "2026-10-26T07:03:00.000Z");
  // Ein Lauf an S − 10 min deckt S; der nächste verpasste ist der Folgetag.
  const knapp = bewerteJob(job, [lauf(JOB_BRIEFING_MORGEN, "2026-11-16T06:53:00Z")], new Date("2026-11-18T09:04:00Z"));
  assert.equal(knapp.ueberfaellig_seit_berlin, "Di 17.11. 08:03");
});

test("Totmann (Prüfbefunde Z4, SR-1, B4): teils unlesbare Zeile eines abgeschalteten Jobs löst den Stolperdraht trotzdem aus", () => {
  const nachAus = lauf(JOB_BRIEFING_ABEND, "2026-11-20T17:03:00Z");
  const jetzt = new Date("2026-11-20T20:00:00Z");
  for (const [name, kaputt] of [
    ["Teilergebnis mit fehler als Zahl", { ...nachAus, teilergebnisse: [{ agent: "strategist", ergebnis: "ok", fehler: 5 }] }],
    ["Teilergebnis mit neuem Wert", { ...nachAus, teilergebnisse: [{ agent: "strategist", ergebnis: "abgebrochen", fehler: null }] }],
    ["Teilergebnis ohne agent", { ...nachAus, teilergebnisse: [{ ergebnis: "ok" }] }],
    ["http_status 0", { ...nachAus, http_status: 0 }],
    ["eingetragen_am fehlt", { ...nachAus, eingetragen_am: null }],
  ]) {
    assert.equal(leseLaufNachweis(kaputt), null, name);
    const b = bewerteTotmann(TOTMANN_PLAN, [kaputt], jetzt, null, NACHWEIS_SEIT);
    assert.equal(b.status, "fehler", name);
    assert.deepEqual(b.wert.jobs.map((j) => j.lage), ["aus", "laeuft_obwohl_aus", "aus"], name);
    assert.equal(b.wert.jobs[1].stolperdraht_am_berlin, "20.11.2026 18:03", name);
    assert.equal(b.wert.jobs[1].hinweis, "eine Zeile in lauf_nachweis ist teilweise unlesbar", name);
    assert.match(b.hinweis, /Zeile in lauf_nachweis unlesbar \(briefing-abend\)/, name);
  }
  const ohneZeit = { ...nachAus, begonnen_am: "gestern", teilergebnisse: {} };
  const b = bewerteTotmann(TOTMANN_PLAN, [ohneZeit], jetzt, null, NACHWEIS_SEIT);
  assert.deepEqual(b.wert.jobs.map((j) => j.lage), ["aus", "nicht_lesbar", "aus"], "ohne lesbares begonnen_am: nicht lesbar");
  assert.equal(b.status, "warnung");
  const amTag = { ...lauf(JOB_BRIEFING_ABEND, "2026-07-30T16:03:00Z"), http_status: 0 };
  assert.equal(bewerteTotmann(TOTMANN_PLAN, [amTag], jetzt, null, NACHWEIS_SEIT).wert.jobs[1].lage, "nicht_lesbar", "am Tag aus_seit kein Stolperdraht");
  // Aktiver Job: eine unlesbare Zeile bleibt rot "nicht lesbar".
  const aktivRot = bewerteTotmann([MORGEN, aktiv(ABEND), AUTO], [{ ...nachAus, http_status: 0 }], jetzt, null, NACHWEIS_SEIT);
  assert.equal(aktivRot.wert.jobs[1].lage, "nicht_lesbar");
  assert.equal(aktivRot.wert.jobs[1].status, "fehler");
});

test("Totmann (Prüfbefund Z6): Stolperdraht mit Zeitpunkt; im Plan quittierbar (stolperdraht_quittiert_bis)", () => {
  const nachAus = lauf(JOB_BRIEFING_ABEND, "2026-11-20T17:03:00Z");
  const spaet = new Date("2027-03-15T10:00:00Z");
  const b = bewerteTotmann(TOTMANN_PLAN, [nachAus], spaet, null, NACHWEIS_SEIT);
  assert.equal(b.wert.jobs[1].lage, "laeuft_obwohl_aus");
  assert.equal(b.wert.jobs[1].stolperdraht_am_berlin, "20.11.2026 18:03", "Datum des Laufs, nicht 'läuft' im Präsens");
  const quittiert = (bis) => TOTMANN_PLAN.map((j) => (j.job === JOB_BRIEFING_ABEND ? { ...j, stolperdraht_quittiert_bis: bis } : j));
  const q = bewerteTotmann(quittiert("2026-11-21T00:00:00+01:00"), [nachAus], spaet, null, NACHWEIS_SEIT);
  assert.deepEqual(q.wert.jobs.map((j) => j.lage), ["aus", "aus", "aus"]);
  assert.equal(q.status, "warnung");
  // Grenze: begonnen genau am Quittungszeitpunkt ist quittiert, 1 ms später nicht.
  assert.equal(bewerteTotmann(quittiert("2026-11-20T18:03:00+01:00"), [nachAus], spaet, null, NACHWEIS_SEIT).wert.jobs[1].lage, "aus");
  assert.equal(bewerteTotmann(quittiert("2026-11-20T18:02:59.999+01:00"), [nachAus], spaet, null, NACHWEIS_SEIT).wert.jobs[1].lage, "laeuft_obwohl_aus");
  // Ein Lauf nach der Quittung löst ihn wieder aus.
  const neu = lauf(JOB_BRIEFING_ABEND, "2026-11-23T17:03:00Z");
  const wieder = bewerteTotmann(quittiert("2026-11-21T00:00:00+01:00"), [neu], spaet, null, NACHWEIS_SEIT);
  assert.equal(wieder.wert.jobs[1].lage, "laeuft_obwohl_aus");
  assert.equal(wieder.wert.jobs[1].stolperdraht_am_berlin, "23.11.2026 18:03");
});

test("Totmann (Prüfbefund Z8): Plan in UTC — Sollzeitpunkte ohne Sommerzeit", () => {
  const utc = { ...aktiv(MORGEN, "2027-01-01T00:00:00Z"), zeitzone: "UTC" };
  const s = (jetzt) => iso(letzterSollzeitpunkt(utc, new Date(jetzt)));
  // Sommer: Mo 14.06.2027 08:03 UTC (10:03 Berlin), Grenze S + 2 h.
  assert.equal(s("2027-06-14T10:03:00Z"), "2027-06-14T08:03:00.000Z");
  assert.equal(s("2027-06-14T10:02:59.999Z"), "2027-06-11T08:03:00.000Z");
  // Winter: Mo 11.01.2027 08:03 UTC (09:03 Berlin).
  assert.equal(s("2027-01-11T10:03:00Z"), "2027-01-11T08:03:00.000Z");
  // Der Lauf um 08:03:30 UTC ist pünktlich; mit dem Europe/Berlin-Plan läge er an der Karenzgrenze.
  const j = bewerteJob(utc, [lauf(JOB_BRIEFING_MORGEN, "2027-06-14T08:03:30Z")], new Date("2027-06-14T10:05:00Z"));
  assert.equal(j.lage, "ok");
  assert.equal(j.sollzeitpunkt_berlin, "Mo 14.06. 10:03", "angezeigt in Berliner Ortszeit");
  // Wochentage nach dem UTC-Kalender: Mo 00:00 UTC → der jüngste S ist Fr 23:30 UTC (Sa und So ohne).
  const spaet = { ...utc, uhrzeit: "23:30", karenz_h: 0 };
  assert.equal(iso(letzterSollzeitpunkt(spaet, new Date("2027-01-11T00:00:00Z"))), "2027-01-08T23:30:00.000Z", "Fr 23:30 UTC");
});

test("Totmann: leseLaufNachweis prüft jede Zeile; eine unlesbare Zeile macht ihren Job 'nicht lesbar'", () => {
  const gut = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z", "teilweise", {
    teilergebnisse: [
      { agent: "oracle", ergebnis: "ok", fehler: null },
      { agent: "donna", ergebnis: "fehler", fehler: "HTTP 502" },
    ],
    hinweis: "1 von 2 Agenten vollständig",
  });
  // Postgres liefert timestamptz mit Mikrosekunden. Die id liest der Totmann seit Prüfbefund r3-logik-1
  // mit: Bei gleicher DB-Uhr ordnet sie die Zeilen wie die Route (order eingetragen_am desc, id desc).
  assert.deepEqual(leseLaufNachweis({ ...gut, id: 7, eingetragen_am: "2026-11-09T07:04:06.123456+00:00", begonnen_am: "2026-11-09T07:03:05.123456+00:00" }), {
    id: 7,
    job: "briefing-morgen",
    begonnen_am: "2026-11-09T07:03:05.123Z",
    beendet_am: gut.beendet_am,
    eingetragen_am: "2026-11-09T07:04:06.123Z",
    ergebnis: "teilweise",
    http_status: 200,
    teilergebnisse: gut.teilergebnisse,
    hinweis: "1 von 2 Agenten vollständig",
  });
  for (const [name, kaputt] of [
    ["Ergebnis unbekannt", { ...gut, ergebnis: "gut" }],
    ["begonnen_am unlesbar", { ...gut, begonnen_am: "gestern" }],
    ["beendet_am fehlt (NOT NULL)", { ...gut, beendet_am: null }],
    ["eingetragen_am fehlt (NOT NULL)", { ...gut, eingetragen_am: undefined }],
    ["ohne job", { ...gut, job: null }],
    ["http_status außerhalb 100–599", { ...gut, http_status: 700 }],
    ["teilergebnisse kein Array", { ...gut, teilergebnisse: {} }],
    ["Teilergebnis mit fremdem Ergebnis", { ...gut, teilergebnisse: [{ agent: "oracle", ergebnis: "super", fehler: null }] }],
    ["hinweis keine Zeichenkette", { ...gut, hinweis: 5 }],
    ["id keine Zahl", { ...gut, id: "7" }],
    ["id keine ganze Zahl", { ...gut, id: 7.5 }],
    ["kein Objekt", "zeile"],
  ]) {
    assert.equal(leseLaufNachweis(kaputt), null, name);
  }
  // Ohne id (etwa eine Zeile, die ein Test direkt übergibt): lesbar, id null.
  assert.equal(leseLaufNachweis(gut).id, null);
  const b = bewerteTotmann(TOTMANN_PLAN, [{ ...gut, begonnen_am: "gestern" }], MO_1004, null, NACHWEIS_SEIT);
  assert.deepEqual(b.wert.jobs.map((j) => j.lage), ["nicht_lesbar", "aus", "aus"]);
  assert.equal(b.status, "warnung");
  assert.match(b.hinweis, /Zeile in lauf_nachweis unlesbar \(briefing-morgen\)/);
  const ohneKennung = bewerteTotmann(TOTMANN_PLAN, [{ ...gut, job: 5 }], MO_1004, null, NACHWEIS_SEIT);
  assert.deepEqual(ohneKennung.wert.jobs.map((j) => j.lage), ["nicht_lesbar", "nicht_lesbar", "nicht_lesbar"], "ohne lesbare Kennung alle Jobs");
});

test("Totmann: kaputter Plan ist ein Fehler der Messung, kein stiller Ersatzwert", () => {
  assert.throws(() => letzterSollzeitpunkt({ ...aktiv(MORGEN), uhrzeit: "8:03" }, MO_1004), /Uhrzeit unlesbar/);
  assert.throws(() => letzterSollzeitpunkt({ ...aktiv(MORGEN), zeitzone: "America/New_York" }, MO_1004), /Zeitzone nicht unterstützt/);
  assert.throws(() => letzterSollzeitpunkt({ ...aktiv(MORGEN), job: "Briefing Morgen" }, MO_1004), /Job-Kennung ungültig/);
  assert.throws(() => bewerteJob({ ...MORGEN, aus_seit: "30.07.2026" }, [], MO_1004), /aus_seit unlesbar/);
  // §2.6 im Code: aktiv nur mit Messbeginn (mit Zeitzone) und gemessener Zeitzone.
  assert.throws(() => bewerteJob({ ...aktiv(MORGEN), aktiv_seit: null }, [], MO_1004), /aktiv_seit unlesbar/);
  assert.throws(() => bewerteJob({ ...aktiv(MORGEN), aktiv_seit: "2027-01-18T00:00:00" }, [], MO_1004), /aktiv_seit unlesbar/);
  assert.throws(() => bewerteJob({ ...aktiv(MORGEN), aktiv_seit: "2027-01-18" }, [], MO_1004), /aktiv_seit unlesbar/);
  assert.throws(() => bewerteJob({ ...aktiv(MORGEN), zeitzone_beleg: null }, [], MO_1004), /aktiv ohne gemessene Zeitzone/);
  assert.throws(() => bewerteJob({ ...aktiv(MORGEN), zeitzone_beleg: "  " }, [], MO_1004), /aktiv ohne gemessene Zeitzone/);
  assert.throws(() => bewerteJob({ ...MORGEN, stolperdraht_quittiert_bis: "21.11.2026" }, [], MO_1004), /stolperdraht_quittiert_bis unlesbar/);
  assert.throws(() => bewerteTotmann(TOTMANN_PLAN, [], MO_1004, null, "07.11.2026"), /NACHWEIS_SEIT unlesbar/);
  assert.throws(() => bewerteTotmann([MORGEN, MORGEN], [], MO_1004, null, NACHWEIS_SEIT), /doppelt/);
  assert.throws(() => bewerteTotmann([], [], MO_1004, null, NACHWEIS_SEIT), /ohne Jobs/);
  // NACHWEIS_SEIT, sobald festgehalten, steht im Wert (nur für den Tooltip).
  assert.equal(bewerteTotmann(TOTMANN_PLAN, [], MO_1004, null, "2026-11-20").wert.nachweis_seit, "2026-11-20");
});

test("Totmann §2.6 (M05b): aktiv entscheidet, nicht aus_seit — aktiviert mit stehengebliebenem aus_seit → rot 'überfällig', nicht bernstein 'aus'", () => {
  // Die Plan-Prüfung (pruefePlanJob) verlangt für aktiv: true kein aus_seit null; der Typ sagt nur
  // „gesetzt, wenn aktiv false ist" (lib/totmann.ts). Setzt der Aktivierungs-PR (§2.6) aktiv,
  // aktiv_seit und zeitzone_beleg und lässt aus_seit und grund stehen, ist der Job trotzdem aktiv:
  // Ohne Lauf wird der Totmann am ersten Werktag rot — genau der Alarm, den §2.6 will. Fragte die
  // Bewertung aus_seit statt aktiv, bliebe er bernstein „aus", und der erwartete Lauf hieße Stolperdraht.
  const stehen = { ...aktiv(MORGEN), aus_seit: MORGEN.aus_seit, grund: MORGEN.grund };
  assert.equal(stehen.aus_seit, "2026-07-30", "Voraussetzung: aus_seit wie im Plan");
  const ohne = bewerteJob(stehen, [], MO_1004);
  assert.deepEqual([ohne.lage, ohne.status], ["ueberfaellig", "fehler"]);
  assert.equal(ohne.sollzeitpunkt, S_MO);
  assert.equal(ohne.ueberfaellig_seit_berlin, "Mo 09.11. 08:03");
  const ok = lauf(JOB_BRIEFING_MORGEN, "2026-11-09T07:03:05Z");
  const mit = bewerteJob(stehen, [ok], MO_1004);
  assert.deepEqual([mit.lage, mit.status], ["ok", "ok"]);
  assert.equal(mit.stolperdraht_am, null, "der erwartete Lauf ist kein Stolperdraht");
  assert.equal(mit.bewerteter_lauf.begonnen_am, ok.begonnen_am);
  // Zeile „Crons" (Farbe des schlechtesten Jobs): rot. Der Hinweis zählt den Job, wie ausHinweis
  // über aktiv entscheidet, nicht zu den abgeschalteten.
  const b = bewerteTotmann([stehen, ABEND, AUTO], [], MO_1004, null, NACHWEIS_SEIT);
  assert.equal(b.status, "fehler");
  assert.deepEqual(
    b.wert.jobs.map((j) => [j.lage, j.status]),
    [
      ["ueberfaellig", "fehler"],
      ["aus", "warnung"],
      ["aus", "warnung"],
    ],
  );
  assert.equal(b.hinweis, "Briefing abends, Content Auto-Produce laut Plan aus seit 30.07.2026");
});

// ── Totmann: zweite Prüfung des Branches (Befunde logik-1 bis logik-4, anzeige-2) ──
// Je Befund ein Test, im Namen genannt; jeder ist gegen den Stand vor der Behebung (6388eb0) rot.

/** auto-produce aktiv seit Mo 09.11.2026 00:00 Berlin (wie die Proben der Prüfung). */
const AUTO_SEIT_MO = aktiv(AUTO, "2026-11-09T00:00:00+01:00");

test("Totmann (Prüfbefund logik-1): ein übersprungener Lauf an einem Tag ohne Sollzeitpunkt deckt keinen — Fr verpasst, Sa übersprungen → rot seit Fr", () => {
  // Letzter echter Lauf Do 12.11. 09:07 ok; Fr 13.11. fehlt; Sa 14.11. 11:30 ein manueller Lauf ohne
  // ?dry: "skipped, Wochenende" (api/content/auto-produce/route.ts). Vorher stand der Job dann von
  // Samstag bis Mo 11:07 auf grün "übersprungen" — ein gescheiterter Freitag blieb rot (Z5).
  const doOk = lauf(JOB_AUTO_PRODUCE, "2026-11-12T08:07:00Z");
  const saSkip = lauf(JOB_AUTO_PRODUCE, "2026-11-14T10:30:00Z", "uebersprungen", { hinweis: "status skipped · Wochenende — kein Content geplant" });
  const sa = bewerteJob(AUTO_SEIT_MO, [doOk, saSkip], new Date("2026-11-14T12:00:00Z"));
  assert.deepEqual([sa.lage, sa.status], ["ueberfaellig", "fehler"]);
  assert.equal(sa.sollzeitpunkt_berlin, "Fr 13.11. 09:07");
  assert.equal(sa.ueberfaellig_seit_berlin, "Fr 13.11. 09:07");
  assert.equal(sa.letzter_lauf.begonnen_am, saSkip.begonnen_am, "der Samstagslauf bleibt als letzter Lauf sichtbar");
  // Fällt auch der Montag aus: überfällig seit Freitag — der Samstagslauf hebt die Untergrenze nicht an.
  const mo = bewerteJob(AUTO_SEIT_MO, [doOk, saSkip], new Date("2026-11-16T11:00:00Z"));
  assert.equal(mo.lage, "ueberfaellig");
  assert.equal(mo.ueberfaellig_seit_berlin, "Fr 13.11. 09:07");
  // Gegenprobe ohne den Samstagslauf: dasselbe Urteil.
  assert.equal(bewerteJob(AUTO_SEIT_MO, [doOk], new Date("2026-11-14T12:00:00Z")).ueberfaellig_seit_berlin, "Fr 13.11. 09:07");
  // Die Lebenszeichen-Regel bleibt: Mo 09:07 übersprungen ("kein Kalendereintrag", ein Plan-Wochentag)
  // deckt den verpassten Freitag (Mo 10:00 Berlin, S = Fr 09:07).
  const moSkip = lauf(JOB_AUTO_PRODUCE, "2026-11-16T08:07:00Z", "uebersprungen", { hinweis: "status skipped · kein Kalendereintrag" });
  const gedeckt = bewerteJob(AUTO_SEIT_MO, [doOk, moSkip], new Date("2026-11-16T09:00:00Z"));
  assert.equal(gedeckt.sollzeitpunkt_berlin, "Fr 13.11. 09:07");
  assert.deepEqual([gedeckt.lage, gedeckt.status], ["ok", "ok"]);
  assert.equal(gedeckt.bewerteter_lauf.begonnen_am, moSkip.begonnen_am);
  // Folgt auf den deckenden Freitagslauf ("kein Kalendereintrag") ein Samstagslauf, bleibt der Freitag
  // der bewertete Lauf; der Samstag ist nur der letzte.
  const frSkip = lauf(JOB_AUTO_PRODUCE, "2026-11-20T08:07:00Z", "uebersprungen", { hinweis: "status skipped · kein Kalendereintrag" });
  const saSkip2 = lauf(JOB_AUTO_PRODUCE, "2026-11-21T10:30:00Z", "uebersprungen", { hinweis: "status skipped · Wochenende — kein Content geplant" });
  const frGedeckt = bewerteJob(AUTO_SEIT_MO, [frSkip, saSkip2], new Date("2026-11-21T11:00:00Z"));
  assert.deepEqual([frGedeckt.lage, frGedeckt.letzter_lauf.begonnen_am, frGedeckt.bewerteter_lauf.begonnen_am], ["ok", saSkip2.begonnen_am, frSkip.begonnen_am]);
  // Der Wochentag zählt in der Zone des Plans: So 15.11. 23:30 UTC ist in Europe/Berlin Mo 00:30.
  const doMorgen = lauf(JOB_BRIEFING_MORGEN, "2026-11-12T08:03:05Z");
  const nachtSkip = lauf(JOB_BRIEFING_MORGEN, "2026-11-15T23:30:00Z", "uebersprungen");
  const frueh = new Date("2026-11-16T05:00:00Z"); // S = Fr 13.11. 08:03 in beiden Zonen
  const utc = bewerteJob({ ...aktiv(MORGEN, "2026-11-09T00:00:00+01:00"), zeitzone: "UTC" }, [doMorgen, nachtSkip], frueh);
  assert.equal(utc.lage, "ueberfaellig", "Plan in UTC: Sonntag, deckt nicht");
  assert.equal(bewerteJob(aktiv(MORGEN, "2026-11-09T00:00:00+01:00"), [doMorgen, nachtSkip], frueh).lage, "ok", "Plan in Europe/Berlin: Montag, deckt");
});

test("Totmann (Prüfbefund logik-4): Lesbarkeit und Plausibilität nur für die Zeilen, die das Urteil tragen", () => {
  // Fr 13.11. 09:07 ok, aber die DB trug die Zeile 16 min nach beendet_am ein; danach Mo 16.11. 09:07
  // übersprungen ("kein Kalendereintrag", z. B. eine geleerte Kalenderwoche). Mo 12:00 Berlin: S = Mo
  // 09:07, gedeckt vom Montag. Vorher hielt die alte Zeile den Job rot "Zeitpunkt unplausibel".
  const frSchief = lauf(JOB_AUTO_PRODUCE, "2026-11-13T08:07:00Z", "ok", { eingetragen_am: "2026-11-13T08:24:00Z" });
  const moSkip = lauf(JOB_AUTO_PRODUCE, "2026-11-16T08:07:00Z", "uebersprungen", { hinweis: "status skipped · kein Kalendereintrag" });
  const moMittag = new Date("2026-11-16T11:00:00Z");
  const mo = bewerteJob(AUTO_SEIT_MO, [moSkip, frSchief], moMittag);
  assert.deepEqual([mo.lage, mo.status], ["ok", "ok"]);
  // Eine ganze Woche nur übersprungene Läufe: weiter grün (Fr 20.11. 12:00 Berlin).
  const frSkip = lauf(JOB_AUTO_PRODUCE, "2026-11-20T08:07:00Z", "uebersprungen");
  assert.equal(bewerteJob(AUTO_SEIT_MO, [frSkip, frSchief], new Date("2026-11-20T11:00:00Z")).lage, "ok");
  // Ebenso eine ältere unlesbare Zeile außerhalb des Fensters (vorher "nicht lesbar", rot).
  const b = bewerteTotmann([MORGEN, ABEND, AUTO_SEIT_MO], [moSkip, { ...frSchief, http_status: 0 }], moMittag, null, NACHWEIS_SEIT);
  assert.equal(b.wert.jobs[2].lage, "ok");
  assert.match(b.hinweis, /Zeile in lauf_nachweis unlesbar \(content-auto-produce\)/, "der Hinweis bleibt");
  // Gegenproben — trägt die Zeile das Urteil, bleibt es rot: die jüngste (auch ein Samstagslauf, der
  // nichts deckt) …
  const juengsteSchief = { ...moSkip, eingetragen_am: "2026-11-16T08:30:00Z" };
  assert.equal(bewerteJob(AUTO_SEIT_MO, [juengsteSchief, frSchief], moMittag).lage, "zeit_unplausibel");
  const frOk = lauf(JOB_AUTO_PRODUCE, "2026-11-20T08:07:00Z");
  const saSchief = lauf(JOB_AUTO_PRODUCE, "2026-11-21T10:30:00Z", "uebersprungen", { eingetragen_am: "2026-11-21T10:56:00Z" });
  assert.equal(bewerteJob(AUTO_SEIT_MO, [saSchief, frOk], new Date("2026-11-21T11:00:00Z")).lage, "zeit_unplausibel");
  // … eine nicht übersprungene im Fenster …
  const moOkSchief = lauf(JOB_AUTO_PRODUCE, "2026-11-16T08:07:00Z", "ok", { eingetragen_am: "2026-11-16T08:30:00Z" });
  const moSkipSpaet = lauf(JOB_AUTO_PRODUCE, "2026-11-16T09:30:00Z", "uebersprungen");
  assert.equal(bewerteJob(AUTO_SEIT_MO, [moSkipSpaet, moOkSchief], moMittag).lage, "zeit_unplausibel");
  // … die deckende im Fenster, auch wenn ein späterer Samstagslauf die jüngste ist …
  const frSkipSchief = lauf(JOB_AUTO_PRODUCE, "2026-11-20T08:07:00Z", "uebersprungen", { eingetragen_am: "2026-11-20T08:30:00Z" });
  const saSkip = lauf(JOB_AUTO_PRODUCE, "2026-11-21T10:30:00Z", "uebersprungen");
  assert.equal(bewerteJob(AUTO_SEIT_MO, [saSkip, frSkipSchief], new Date("2026-11-21T11:00:00Z")).lage, "zeit_unplausibel");
  // … eine unlesbare Zeile mit Ergebnis im Fenster, eine ohne lesbaren Beginn. Weitere Fälle unlesbarer
  // Zeilen (die zuletzt eingetragene, eine übersprungene im Fenster): Test zu Prüfbefund r3-logik-4.
  const kaputtNeu = { ...lauf(JOB_AUTO_PRODUCE, "2026-11-16T08:30:00Z"), http_status: 0 };
  assert.equal(bewerteTotmann([MORGEN, ABEND, AUTO_SEIT_MO], [moSkip, kaputtNeu], moMittag, null, NACHWEIS_SEIT).wert.jobs[2].lage, "nicht_lesbar");
  const ohneBeginn = { ...frSchief, begonnen_am: "gestern" };
  assert.equal(bewerteTotmann([MORGEN, ABEND, AUTO_SEIT_MO], [moSkip, ohneBeginn], moMittag, null, NACHWEIS_SEIT).wert.jobs[2].lage, "nicht_lesbar");
});

// ── Dritte Prüfung des Branches (r3-logik-1 bis r3-logik-4); die Routenfälle stehen in t-totmann (T-L8–T-L10) ──

/** Kopie der Zeile ohne id (wie eine Zeile, die ein Test direkt übergibt). */
const ohneId = (l) => {
  const k = { ...l };
  delete k.id;
  return k;
};

test("Totmann (Prüfbefunde r3-logik-1, D1): 'jüngste' heißt zuletzt eingetragen — wie die Route ordnet (eingetragen_am, bei Gleichstand id)", () => {
  // Überlappende Läufe am Fr 13.11.: der Cron um 09:07 läuft bis 09:40 und scheitert, ein manueller Lauf
  // 09:20–09:25 gelingt. Zuletzt eingetragen ist der Cron-Lauf; er entscheidet, so wie die Route ihn als
  // jüngste Zeile liest (vorher nach begonnen_am: der manuelle Lauf, grün).
  const cron = lauf(JOB_AUTO_PRODUCE, "2026-11-13T08:07:00Z", "fehler", { beendet_am: "2026-11-13T08:40:00Z", eingetragen_am: "2026-11-13T08:40:01Z" });
  const hand = lauf(JOB_AUTO_PRODUCE, "2026-11-13T08:20:00Z", "ok", { beendet_am: "2026-11-13T08:25:00Z", eingetragen_am: "2026-11-13T08:25:01Z" });
  const jetzt = new Date("2026-11-13T11:00:00Z");
  for (const laeufe of [
    [cron, hand],
    [hand, cron],
  ]) {
    const j = bewerteJob(AUTO_SEIT_MO, laeufe, jetzt);
    assert.deepEqual([j.lage, j.letzter_lauf.begonnen_am, j.bewerteter_lauf.begonnen_am], ["fehlgeschlagen", cron.begonnen_am, cron.begonnen_am]);
  }
  // Gleiche DB-Uhr: Die höhere id ist die zuletzt eingetragene (über die Route: T-L7).
  const gleich = "2026-11-13T08:08:06.000Z";
  const a = lauf(JOB_AUTO_PRODUCE, "2026-11-13T08:07:06Z", "ok", { id: 7, eingetragen_am: gleich });
  const b = lauf(JOB_AUTO_PRODUCE, "2026-11-13T08:07:05Z", "fehler", { id: 8, eingetragen_am: gleich });
  for (const laeufe of [
    [a, b],
    [b, a],
  ]) {
    assert.equal(bewerteJob(AUTO_SEIT_MO, laeufe, jetzt).lage, "fehlgeschlagen", "id 8 vor id 7");
    // Ohne id: der später begonnene, unabhängig von der Reihenfolge.
    assert.equal(bewerteJob(AUTO_SEIT_MO, laeufe.map(ohneId), jetzt).lage, "ok", "ohne id: begonnen_am");
  }
  // Abgeschalteter Job: Letzter Lauf ist der zuletzt eingetragene, nicht die Zukunftszeile.
  const zukunft = lauf(JOB_BRIEFING_ABEND, "2027-11-24T17:03:00Z", "ok", { eingetragen_am: "2026-11-24T17:04:01Z" });
  const echt = lauf(JOB_BRIEFING_ABEND, "2026-12-01T17:03:00Z");
  const aus = bewerteTotmann(TOTMANN_PLAN, [zukunft, echt], new Date("2026-12-01T20:00:00Z"), null, NACHWEIS_SEIT).wert.jobs[1];
  assert.deepEqual([aus.lage, aus.letzter_lauf.begonnen_am], ["laeuft_obwohl_aus", echt.begonnen_am]);
});

test("Totmann (Prüfbefund r3-logik-2): ob eine Zeile das Urteil trägt, entscheiden beide Uhren — ein Lauf zu S mit nachgehender App-Uhr bleibt rot", () => {
  // Fr 13.11. 09:07 Berlin läuft der Cron und scheitert; die App-Uhr geht 12 min nach: begonnen_am 08:55:05,
  // beendet_am 08:56:05 (App-Uhr), eingetragen_am 09:08:06 (DB-Uhr). Fr 10:00 ein Nachlauf mit richtiger
  // Uhr, übersprungen ("kein Kalendereintrag", ein Plan-Wochentag: Er deckt S). Fr 12:00 Berlin. Vorher
  // lag der Lauf nach begonnen_am vor dem Fenster (S − 10 min = 08:57), entging der Uhrenprüfung, und
  // der Nachlauf machte den Job grün.
  const frNachgehend = lauf(JOB_AUTO_PRODUCE, "2026-11-13T07:55:05Z", "fehler", { http_status: 500, eingetragen_am: "2026-11-13T08:08:06Z" });
  const frNachlauf = lauf(JOB_AUTO_PRODUCE, "2026-11-13T09:00:00Z", "uebersprungen", { hinweis: "status skipped · kein Kalendereintrag" });
  const jetzt = new Date("2026-11-13T11:00:00Z");
  const j = bewerteJob(AUTO_SEIT_MO, [frNachlauf, frNachgehend], jetzt);
  assert.deepEqual([j.lage, j.status], ["zeit_unplausibel", "fehler"]);
  assert.equal(j.hinweis, "App-Uhr (beendet_am) und DB-Uhr (eingetragen_am) weichen um mehr als 10 min ab");
  // Gegenprobe: derselbe Lauf mit richtiger Uhr wird bewertet → fehlgeschlagen.
  const frRichtig = lauf(JOB_AUTO_PRODUCE, "2026-11-13T08:07:05Z", "fehler", { http_status: 500 });
  assert.equal(bewerteJob(AUTO_SEIT_MO, [frNachlauf, frRichtig], jetzt).lage, "fehlgeschlagen");
  // Ebenso eine unlesbare Zeile: nach eingetragen_am im Fenster, Ergebnis fehler → "nicht lesbar".
  const b = bewerteTotmann([MORGEN, ABEND, AUTO_SEIT_MO], [frNachlauf, { ...frNachgehend, http_status: 0 }], jetzt, null, NACHWEIS_SEIT);
  assert.equal(b.wert.jobs[2].lage, "nicht_lesbar");
  // Liegt die Zeile nach beiden Uhren vor dem Fenster (Do 12.11.), trägt sie nicht (Prüfbefund logik-4).
  const doNachgehend = lauf(JOB_AUTO_PRODUCE, "2026-11-12T07:55:05Z", "fehler", { eingetragen_am: "2026-11-12T08:08:06Z" });
  assert.equal(bewerteJob(AUTO_SEIT_MO, [frNachlauf, doNachgehend], jetzt).lage, "ok");
});

test("Totmann (Prüfbefund r3-logik-3): eine Zukunftszeile hält den Job nur rot, solange sie die zuletzt eingetragene ist oder nach der DB-Uhr im Fenster liegt", () => {
  // Do 19.11. schrieb ein Lauf mit vorgehender App-Uhr: begonnen_am 01.03.2027, eingetragen (DB-Uhr) Do
  // 19.11. 09:08 Berlin. Danach laufen die Crons mit richtiger Uhr, aber ohne Kalendereintrag. Vorher blieb
  // die Zukunftszeile nach begonnen_am "die jüngste" und lag im Fenster: rot, bis ein Lauf mit Ergebnis kam.
  const zukunft = lauf(JOB_AUTO_PRODUCE, "2027-03-01T08:07:00Z", "ok", { eingetragen_am: "2026-11-19T08:08:01Z" });
  const skip = (beginn) => lauf(JOB_AUTO_PRODUCE, beginn, "uebersprungen", { hinweis: "status skipped · kein Kalendereintrag" });
  const frSkip = skip("2026-11-20T08:07:05Z");
  const fr = bewerteJob(AUTO_SEIT_MO, [zukunft, frSkip], new Date("2026-11-20T11:00:00Z"));
  assert.deepEqual([fr.lage, fr.status], ["ok", "ok"]);
  assert.deepEqual([fr.letzter_lauf.begonnen_am, fr.bewerteter_lauf.begonnen_am], [frSkip.begonnen_am, frSkip.begonnen_am], "zuletzt eingetragen und bewertet: Fr");
  const di = bewerteJob(AUTO_SEIT_MO, [zukunft, frSkip, skip("2026-11-23T08:07:05Z"), skip("2026-11-24T08:07:05Z")], new Date("2026-11-24T11:00:00Z"));
  assert.deepEqual([di.lage, di.bewerteter_lauf.begonnen_am], ["ok", "2026-11-24T08:07:05.000Z"]);
  // Solange sie die zuletzt eingetragene ist: rot (wie vorher).
  assert.equal(bewerteJob(AUTO_SEIT_MO, [zukunft], new Date("2026-11-19T11:00:00Z")).lage, "zeit_unplausibel");
  // Liegt sie nach der DB-Uhr im Fenster (der Lauf zu S selbst, App-Uhr ein Jahr voraus), trägt sie das
  // Urteil weiter, auch wenn danach ein deckender Lauf eingetragen wurde.
  const frZukunft = lauf(JOB_AUTO_PRODUCE, "2027-11-20T08:07:00Z", "fehler", { eingetragen_am: "2026-11-20T08:08:01Z" });
  assert.equal(bewerteJob(AUTO_SEIT_MO, [skip("2026-11-20T09:00:00Z"), frZukunft], new Date("2026-11-20T11:00:00Z")).lage, "zeit_unplausibel");
  // Ein übersprungener Lauf mit vorgehender App-Uhr deckt nach dem Wochentag der DB-Uhr: eingetragen Do
  // 19.11., begonnen_am fällt auf einen Samstag (06.03.2027). Fr und Mo verpasst, dazwischen ein
  // Samstagslauf: überfällig seit Fr 20.11. (nicht seit Mo 09.11., dem ersten Sollzeitpunkt).
  const doZukunftSkip = lauf(JOB_AUTO_PRODUCE, "2027-03-06T08:07:00Z", "uebersprungen", { eingetragen_am: "2026-11-19T08:08:01Z" });
  const saSkip = lauf(JOB_AUTO_PRODUCE, "2026-11-21T10:30:00Z", "uebersprungen", { hinweis: "status skipped · Wochenende — kein Content geplant" });
  const mo = bewerteJob(AUTO_SEIT_MO, [doZukunftSkip, saSkip], new Date("2026-11-23T11:00:00Z"));
  assert.deepEqual([mo.lage, mo.ueberfaellig_seit_berlin], ["ueberfaellig", "Fr 20.11. 09:07"]);
});

test("Totmann (Prüfbefund r3-logik-4): unlesbare Zeilen — die zuletzt eingetragene trägt das Urteil, eine übersprungene im Fenster nicht; Stolperdraht ohne lesbares eingetragen_am", () => {
  const moOk = lauf(JOB_AUTO_PRODUCE, "2026-11-16T08:07:05Z");
  const lage = (zeilen) => bewerteTotmann([MORGEN, ABEND, AUTO_SEIT_MO], zeilen, new Date("2026-11-16T11:00:00Z"), null, NACHWEIS_SEIT).wert.jobs[2].lage;
  // Mo 09:07 ok, Mo 10:00 eine jüngere Zeile "uebersprungen" mit unlesbarem http_status: Sie kann die
  // zuletzt eingetragene sein → "nicht lesbar" (rot). Über die Route: T-L9.
  const moSkipKaputt = { ...lauf(JOB_AUTO_PRODUCE, "2026-11-16T09:00:00Z", "uebersprungen"), http_status: 0 };
  assert.equal(lage([moOk, moSkipKaputt]), "nicht_lesbar");
  // Dieselbe Zeile vor dem ok-Lauf eingetragen (Mo 09:00 Berlin, im Fenster): Ein übersprungener Lauf ändert
  // kein Ergebnis → bewertet wird der lesbare ok-Lauf (grün). Mit unlesbarem Ergebnis: rot.
  const frueherKaputt = { ...lauf(JOB_AUTO_PRODUCE, "2026-11-16T08:00:00Z", "uebersprungen"), http_status: 0 };
  assert.equal(lage([moOk, frueherKaputt]), "ok");
  assert.equal(lage([moOk, { ...frueherKaputt, ergebnis: "gut" }]), "nicht_lesbar");
  // Ohne lesbares eingetragen_am kann eine Zeile die zuletzt eingetragene sein → "nicht lesbar", auch mit
  // altem Beginn.
  assert.equal(lage([moOk, { ...lauf(JOB_AUTO_PRODUCE, "2026-11-12T08:07:05Z"), eingetragen_am: null }]), "nicht_lesbar");
  // Eine unlesbare Zukunftszeile, eingetragen am Do 12.11.: zählt nach der DB-Uhr — sie liegt vor dem
  // Fenster und trägt nicht (Prüfbefund r3-logik-3).
  const alteZukunft = { ...lauf(JOB_AUTO_PRODUCE, "2027-03-01T08:07:00Z", "ok", { eingetragen_am: "2026-11-12T08:08:01Z" }), http_status: 0 };
  assert.equal(lage([moOk, alteZukunft]), "ok");
  // Abgeschalteter Job (ausloeser): unlesbare Zeile mit Zukunftsbeginn ohne lesbares eingetragen_am — der
  // Stolperdraht hängt dann an begonnen_am (rot bleibt rot), statt still zu entfallen.
  const ohneDbUhr = { ...lauf(JOB_BRIEFING_ABEND, "2027-11-24T17:03:00Z"), eingetragen_am: undefined };
  const aus = bewerteTotmann(TOTMANN_PLAN, [ohneDbUhr], new Date("2026-11-24T20:00:00Z"), null, NACHWEIS_SEIT).wert.jobs[1];
  assert.deepEqual([aus.lage, aus.stolperdraht_am, aus.stolperdraht_spalte], ["laeuft_obwohl_aus", "2027-11-24T17:03:00.000Z", "begonnen_am"]);
  assert.equal(aus.hinweis, "eine Zeile in lauf_nachweis ist teilweise unlesbar");
});

test("Totmann (Prüfbefund logik-2): Quittung oder aus_seit in der Zukunft → Planfehler; unplausible Zeile eines abgeschalteten Jobs → Stolperdraht nach eingetragen_am", () => {
  const mit = (aenderung) => TOTMANN_PLAN.map((j) => (j.job === JOB_BRIEFING_ABEND ? { ...j, ...aenderung } : j));
  const jetzt = new Date("2026-11-24T20:00:00Z"); // Di 21:00 Berlin
  // (a) Vorher still angenommen: Die Zeile blieb bernstein "aus", der Stolperdraht war blind.
  assert.throws(
    () => bewerteTotmann(mit({ stolperdraht_quittiert_bis: "2062-11-20T00:00:00+01:00" }), [], jetzt, null, NACHWEIS_SEIT),
    /Plan briefing-abend: stolperdraht_quittiert_bis liegt nach der Messzeit/,
  );
  // Grenze: dieselbe geduldete Uhrenabweichung wie für Zeilen (UHR_TOLERANZ_MS).
  const bis = (ms) => new Date(jetzt.getTime() + ms).toISOString();
  assert.doesNotThrow(() => bewerteTotmann(mit({ stolperdraht_quittiert_bis: bis(UHR_TOLERANZ_MS) }), [], jetzt, null, NACHWEIS_SEIT));
  assert.throws(() => bewerteTotmann(mit({ stolperdraht_quittiert_bis: bis(UHR_TOLERANZ_MS + 1) }), [], jetzt, null, NACHWEIS_SEIT), /liegt nach der Messzeit/);
  assert.throws(() => bewerteTotmann(mit({ aus_seit: "2062-07-30" }), [], jetzt, null, NACHWEIS_SEIT), /Plan briefing-abend: aus_seit liegt nach dem heutigen Tag/);
  // Heute zählt in Europe/Berlin: 24.11. 23:30 UTC ist dort schon der 25.11.
  const nacht = new Date("2026-11-24T23:30:00Z");
  assert.doesNotThrow(() => bewerteTotmann(mit({ aus_seit: "2026-11-25" }), [], nacht, null, NACHWEIS_SEIT));
  assert.throws(() => bewerteTotmann(mit({ aus_seit: "2026-11-26" }), [], nacht, null, NACHWEIS_SEIT), /aus_seit liegt nach dem heutigen Tag/);
  // Auch wenn lauf_nachweis nicht lesbar ist.
  assert.throws(() => bewerteTotmann(mit({ aus_seit: "2062-07-30" }), [], jetzt, "relation does not exist", NACHWEIS_SEIT), /aus_seit liegt nach dem heutigen Tag/);

  // (b) Abgeschalteter Job, App-Uhr ein Jahr voraus, DB-Uhr richtig: Stolperdraht nach eingetragen_am.
  const zukunft = lauf(JOB_BRIEFING_ABEND, "2027-11-24T17:03:00Z", "ok", { eingetragen_am: "2026-11-24T17:04:01Z" });
  const b = bewerteTotmann(TOTMANN_PLAN, [zukunft], jetzt, null, NACHWEIS_SEIT);
  const j = b.wert.jobs[1];
  assert.deepEqual([j.lage, j.status, b.status], ["laeuft_obwohl_aus", "fehler", "fehler"], "rot bleibt rot");
  assert.equal(j.stolperdraht_am, "2026-11-24T17:04:01.000Z", "Zeitpunkt nach der DB-Uhr, nicht 24.11.2027");
  assert.equal(j.stolperdraht_am_berlin, "24.11.2026 18:04");
  assert.equal(j.stolperdraht_spalte, "eingetragen_am");
  assert.equal(
    j.hinweis,
    "Zeitstempel des Laufs unplausibel, eingetragen am 24.11.2026 18:04 (DB-Uhr; begonnen_am 24.11.2027 18:03 liegt mehr als 10 min nach der Messzeit)",
  );
  // Eine Quittung bis jetzt reicht — vorher erst eine über den 24.11.2027 hinaus, die den Stolperdraht
  // bis dahin blind machte.
  const quittiert = mit({ stolperdraht_quittiert_bis: "2026-11-24T21:00:00+01:00" });
  assert.equal(bewerteTotmann(quittiert, [zukunft], jetzt, null, NACHWEIS_SEIT).wert.jobs[1].lage, "aus");
  // Ein späterer echter Lauf löst wieder aus, mit seinem Beginn.
  const echt = lauf(JOB_BRIEFING_ABEND, "2026-12-01T17:03:00Z");
  const wieder = bewerteTotmann(quittiert, [zukunft, echt], new Date("2026-12-01T20:00:00Z"), null, NACHWEIS_SEIT).wert.jobs[1];
  assert.deepEqual([wieder.lage, wieder.stolperdraht_am_berlin, wieder.stolperdraht_spalte], ["laeuft_obwohl_aus", "01.12.2026 18:03", "begonnen_am"]);
  assert.equal(wieder.hinweis, null);
  // App- gegen DB-Uhr verschoben (26 min): ebenso nach eingetragen_am.
  const schief = lauf(JOB_BRIEFING_ABEND, "2026-11-24T17:03:00Z", "ok", { eingetragen_am: "2026-11-24T17:30:00Z" });
  const s = bewerteTotmann(TOTMANN_PLAN, [schief], jetzt, null, NACHWEIS_SEIT).wert.jobs[1];
  assert.equal(s.stolperdraht_am_berlin, "24.11.2026 18:30");
  assert.match(s.hinweis, /^Zeitstempel des Laufs unplausibel, eingetragen am 24\.11\.2026 18:30 \(DB-Uhr; App-Uhr \(beendet_am\) und DB-Uhr \(eingetragen_am\) weichen um mehr als 10 min ab\)$/);
  // Teils unlesbare Zeile mit Zukunftsbeginn: dieselbe Regel, beide Hinweise.
  const teils = bewerteTotmann(TOTMANN_PLAN, [{ ...zukunft, http_status: 0 }], jetzt, null, NACHWEIS_SEIT).wert.jobs[1];
  assert.deepEqual([teils.lage, teils.stolperdraht_am_berlin, teils.stolperdraht_spalte], ["laeuft_obwohl_aus", "24.11.2026 18:04", "eingetragen_am"]);
  assert.match(teils.hinweis, /^Zeitstempel des Laufs unplausibel, eingetragen am 24\.11\.2026 18:04 .* · eine Zeile in lauf_nachweis ist teilweise unlesbar$/);
});

test("Totmann (Prüfbefund logik-3): Planfehler — aktiv ohne Wochentage, aktiv_seit mehr als 31 Tage voraus, ungültiger Kalendertag; keine Mindest-Karenz", () => {
  // Vorher: ohne Wochentage für immer "erster Sollzeitpunkt steht aus", nie rot.
  assert.throws(() => bewerteJob({ ...aktiv(MORGEN), wochentage: [] }, [], MO_1004), /Plan briefing-morgen: aktiv ohne Wochentage/);
  assert.throws(() => bewerteTotmann([{ ...aktiv(MORGEN), wochentage: [] }, ABEND, AUTO], [], MO_1004, null, NACHWEIS_SEIT), /aktiv ohne Wochentage/);
  // Tippfehler im Jahr: vorher bis 2062 "erster Sollzeitpunkt steht aus". Setzung: höchstens 31 Tage voraus.
  assert.throws(() => bewerteJob(aktiv(MORGEN, "2062-11-09T00:00:00+01:00"), [], MO_1004), /aktiv_seit liegt mehr als 31 Tage nach der Messzeit/);
  const TAGE_31 = 31 * 24 * 3_600_000;
  const vorgeplant = bewerteJob(aktiv(MORGEN, new Date(MO_1004.getTime() + TAGE_31).toISOString()), [], MO_1004);
  assert.equal(vorgeplant.lage, "erster_sollzeitpunkt_steht_aus", "genau 31 Tage voraus: erlaubt");
  assert.throws(() => bewerteJob(aktiv(MORGEN, new Date(MO_1004.getTime() + TAGE_31 + 1).toISOString()), [], MO_1004), /mehr als 31 Tage/);
  // Kalendertag und Uhrzeit streng: Date.parse machte aus dem 31.11. den 01.12. und nahm 24:00 an.
  for (const falsch of ["2026-11-31T00:00:00+01:00", "2027-02-29T00:00:00+01:00", "2026-11-30T24:00:00+01:00", "2026-11-09T08:60:00+01:00", "2026-11-09T08:03:00+24:00"]) {
    assert.throws(() => bewerteJob(aktiv(MORGEN, falsch), [], MO_1004), /aktiv_seit unlesbar/, falsch);
    assert.throws(() => bewerteJob({ ...MORGEN, stolperdraht_quittiert_bis: falsch }, [], MO_1004), /stolperdraht_quittiert_bis unlesbar/, falsch);
  }
  // Gegenprobe: der 29.02. eines Schaltjahrs ist ein Tag.
  const schaltjahr = new Date("2028-02-20T12:00:00Z");
  assert.equal(bewerteJob(aktiv(MORGEN, "2028-02-29T00:00:00+01:00"), [], schaltjahr).lage, "erster_sollzeitpunkt_steht_aus");
  assert.equal(bewerteJob({ ...MORGEN, stolperdraht_quittiert_bis: "2028-02-29T00:00:00+01:00" }, [], new Date("2028-03-01T12:00:00Z")).lage, "aus");
  // Bewusst keine Mindest-Karenz: Karenz 0 heißt "rot, bis der Lauf fertig ist" (Zeile erst im finally).
  const ohneKarenz = bewerteJob({ ...aktiv(MORGEN), karenz_h: 0 }, [], new Date("2026-11-09T07:04:00Z"));
  assert.deepEqual([ohneKarenz.lage, ohneKarenz.sollzeitpunkt_berlin], ["ueberfaellig", "Mo 09.11. 08:03"]);
});

test("Totmann (Prüfbefund anzeige-2): 'erster Sollzeitpunkt steht aus' nennt den ersten zählenden Sollzeitpunkt und den Urteilszeitpunkt", () => {
  // Aktiv seit Mo 16.11. 00:00, jetzt Mo 07:00 Berlin: Der jüngste S (Fr 13.11.) liegt davor und zählt nicht.
  const j = bewerteJob(aktiv(MORGEN, "2026-11-16T00:00:00+01:00"), [], new Date("2026-11-16T06:00:00Z"));
  assert.equal(j.lage, "erster_sollzeitpunkt_steht_aus");
  assert.equal(j.sollzeitpunkt_berlin, "Fr 13.11. 08:03");
  assert.equal(j.erster_sollzeitpunkt, "2026-11-16T07:03:00.000Z");
  assert.equal(j.erster_sollzeitpunkt_berlin, "Mo 16.11. 08:03");
  assert.equal(j.urteil_ab, "2026-11-16T09:03:00.000Z", "S + Karenz 2 h");
  assert.equal(j.urteil_ab_berlin, "Mo 16.11. 10:03");
  // Aktiviert nach dem heutigen Sollzeitpunkt: der erste zählende ist am nächsten Plan-Wochentag.
  const spaeter = bewerteJob(aktiv(MORGEN, "2026-11-16T09:00:00+01:00"), [], new Date("2026-11-16T08:30:00Z"));
  assert.deepEqual([spaeter.erster_sollzeitpunkt_berlin, spaeter.urteil_ab_berlin], ["Di 17.11. 08:03", "Di 17.11. 10:03"]);
  // Andere Lagen tragen keinen.
  assert.equal(bewerteJob(aktiv(MORGEN), [], MO_1004).erster_sollzeitpunkt, null);
  assert.equal(bewerteJob(MORGEN, [], MO_1004).urteil_ab, null);
});

// ── Mutationstest der dritten Nachbesserung (cf604a4), Runde 2: Tests gegen überlebende Mutanten ──
// X22 und X27 blieben bei 639 von 639 grünen Tests am Leben; je Mutant ein Fall, im Namen genannt.
// Den dritten Überlebenden (X14, Anzeige) prüft T-A15 in tests/t-totmann.test.mjs.

test("Totmann (Mutant X22): eine unlesbare Zeile mit derselben DB-Uhr (auf die Millisekunde) wie die zuletzt eingetragene lesbare kann die zuletzt eingetragene sein → 'nicht lesbar' (rot)", () => {
  // Fr 20.11. 09:07 Berlin läuft auto-produce (ok, eingetragen E). Eine zweite Zeile desselben Jobs,
  // übersprungen und mit einem Teilergebnis ohne agent (unlesbar; die SQL-Datei prüft nur, dass
  // teilergebnisse ein Array ist), trägt dasselbe eingetragen_am auf die Millisekunde. Bei Gleichstand
  // ordnet die Route nach id (spaeterEingetragen); die id einer unlesbaren Zeile kennt bewerteJob nicht.
  // Sie kann also die zuletzt eingetragene sein und trägt das Urteil. Mit "e > juengsterEingetragen"
  // statt "e >= juengsterEingetragen" (unlesbarTraegt in bewerteJob) wurde der Job grün.
  const R = lauf(JOB_AUTO_PRODUCE, "2026-11-20T08:07:05Z", "ok", { id: 7 });
  const U = lauf(JOB_AUTO_PRODUCE, "2026-11-20T08:07:00Z", "uebersprungen", {
    id: 8,
    eingetragen_am: R.eingetragen_am,
    teilergebnisse: [{ ergebnis: "ok" }],
    hinweis: "status skipped · kein Kalendereintrag",
  });
  assert.equal(leseLaufNachweis(U), null, "Voraussetzung: U ist unlesbar");
  const jetzt = new Date("2026-11-20T11:00:00Z"); // Fr 12:00 Berlin, S = Fr 20.11. 09:07
  const auto = (zeilen) => bewerteTotmann([MORGEN, ABEND, AUTO_SEIT_MO], zeilen, jetzt, null, NACHWEIS_SEIT).wert.jobs[2];
  for (const zeilen of [
    [R, U],
    [U, R],
  ]) {
    const j = auto(zeilen);
    assert.deepEqual([j.lage, j.status, j.letzter_lauf.begonnen_am, j.bewerteter_lauf], ["nicht_lesbar", "fehler", R.begonnen_am, null]);
  }
  // Die Grenze liegt genau beim Gleichstand: 1 ms später eingetragen ebenso rot; 1 ms früher ist R die
  // zuletzt eingetragene, und ein übersprungener Lauf ändert kein Ergebnis → grün (wie im Test zu r3-logik-4).
  const um = (ms) => ({ ...U, eingetragen_am: new Date(Date.parse(R.eingetragen_am) + ms).toISOString() });
  assert.equal(auto([R, um(1)]).lage, "nicht_lesbar");
  const frueher = auto([R, um(-1)]);
  assert.deepEqual([frueher.lage, frueher.status, frueher.bewerteter_lauf.begonnen_am], ["ok", "ok", R.begonnen_am]);
});

test("Totmann (Mutant X27): abgeschalteter Job, Zeile ohne lesbares begonnen_am — eine Abweichung zwischen beendet_am und eingetragen_am löst keinen Stolperdraht aus, es bleibt 'nicht lesbar' (bernstein)", () => {
  // Der Stolperdraht hängt an begonnen_am; eingetragen_am (DB-Uhr) tritt nur an seine Stelle, wenn
  // begonnen_am lesbar, die Zeit der Zeile aber unplausibel ist (ausloeser, Prüfbefund logik-2). Ohne
  // lesbares begonnen_am ist die Zeile "nicht lesbar" (bernstein, wie im Test zu Z4, SR-1, B4), gleich,
  // ob beendet_am und eingetragen_am zueinander passen. Rechnete ausloeser den Zeitgrund auch ohne
  // lesbares begonnen_am, wurde aus einer Abweichung von mehr als 10 min "läuft, obwohl als aus geführt"
  // (rot) mit eingetragen_am als Stolperdraht — ob die Zeile auslöst, hing dann an der Uhrenabweichung.
  // begonnen_am '-infinity': TIMESTAMPTZ kennt den Wert, der CHECK beendet_am >= begonnen_am hält, und
  // Date.parse liest ihn nicht (abgeleitet aus scripts/lauf_nachweis.sql, nicht gegen eine DB gemessen).
  const jetzt = new Date("2026-11-20T20:00:00Z"); // Fr 21:00 Berlin
  const ohneBeginn = (beendet, eingetragen) => ({
    ...lauf(JOB_BRIEFING_ABEND, "2026-11-20T17:03:00Z"),
    begonnen_am: "-infinity",
    beendet_am: beendet,
    eingetragen_am: eingetragen,
  });
  for (const [name, z] of [
    ["DB-Uhr 26 min nach beendet_am", ohneBeginn("2026-11-20T17:04:00.000Z", "2026-11-20T17:30:00.000Z")],
    ["DB-Uhr 26 min vor beendet_am", ohneBeginn("2026-11-20T17:30:00.000Z", "2026-11-20T17:04:00.000Z")],
    ["Uhren passen (1 s)", ohneBeginn("2026-11-20T17:04:00.000Z", "2026-11-20T17:04:01.000Z")],
  ]) {
    assert.equal(leseLaufNachweis(z), null, `${name}: Voraussetzung, die Zeile ist unlesbar`);
    const b = bewerteTotmann(TOTMANN_PLAN, [z], jetzt, null, NACHWEIS_SEIT);
    const j = b.wert.jobs[1];
    assert.deepEqual([j.lage, j.status, j.stolperdraht_am, j.stolperdraht_spalte, j.hinweis], ["nicht_lesbar", "warnung", null, null, null], name);
    assert.equal(b.status, "warnung", name);
  }
  // Gegenprobe: begonnen_am lesbar, die Zeile nur teils unlesbar (Teilergebnis ohne agent) — dieselbe
  // Abweichung löst aus, mit eingetragen_am als Stolperdraht und beiden Hinweisen.
  const teils = {
    ...lauf(JOB_BRIEFING_ABEND, "2026-11-20T17:03:00Z"),
    beendet_am: "2026-11-20T17:04:00.000Z",
    eingetragen_am: "2026-11-20T17:30:00.000Z",
    teilergebnisse: [{ ergebnis: "ok" }],
  };
  const g = bewerteTotmann(TOTMANN_PLAN, [teils], jetzt, null, NACHWEIS_SEIT).wert.jobs[1];
  assert.deepEqual([g.lage, g.status, g.stolperdraht_am, g.stolperdraht_spalte], ["laeuft_obwohl_aus", "fehler", "2026-11-20T17:30:00.000Z", "eingetragen_am"]);
  assert.equal(
    g.hinweis,
    "Zeitstempel des Laufs unplausibel, eingetragen am 20.11.2026 18:30 (DB-Uhr; App-Uhr (beendet_am) und DB-Uhr (eingetragen_am) weichen um mehr als 10 min ab) · eine Zeile in lauf_nachweis ist teilweise unlesbar",
  );
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
  [200, { status: "partial", pipeline: { status: "partial", completed: "4/5" } }, "teilweise"],
  // Prüfbefund SR-2: Die Route meldet jeden unbekannten Pipeline-Status als "partial".
  [200, { status: "partial", pipeline: { status: null } }, "fehler"],
  [200, { status: "partial", pipeline: { status: "running" } }, "fehler"],
  [200, { status: "partial" }, "fehler"],
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
  assert.equal(autoProduceNachweis(200, { status: "partial", pipeline: { status: "partial", completed: "4/5" } }, null).hinweis, "status partial · Pipeline-Stufen 4/5");
  assert.equal(autoProduceNachweis(200, { status: "partial", pipeline: { status: "running" } }, null).hinweis, "status partial · Pipeline-Status unbekannt (running)");
  assert.equal(autoProduceNachweis(200, { status: "partial", pipeline: { status: null } }, null).hinweis, "status partial · Pipeline-Status fehlt");
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
