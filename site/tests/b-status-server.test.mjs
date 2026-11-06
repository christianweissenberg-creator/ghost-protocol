// Tests für die Server-Helfer der Gruppe B (lib/status-server.ts): Schlüssel lesen,
// Fehler bereinigen, Abschneide-Status, Fehllauf-Metadaten, bedingte Summen, Zusammenfassung
// der Auftragszeile und Kostenauswertung für GET /api/status. Lauf: npm test.
// Alle Schlüssel hier sind erfundene Testwerte.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANTHROPIC_SCHLUESSEL,
  EXPORT_TOKEN,
  KOSTEN_QUELLEN,
  MIN_SCHLUESSEL_STUECK,
  QUELLE_FEHLLAUF,
  SUMMEN_SPALTEN,
  abschneideStatus,
  bereinigeFehler,
  fasseLaeufeZusammen,
  fehllaufMetadaten,
  leseSchluessel,
  ohneRandLeerraum,
  planeSummen,
  werteKostenAus,
} from "../src/lib/status-server.ts";

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
