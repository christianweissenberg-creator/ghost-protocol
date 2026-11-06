// Tests für die reinen Funktionen in lib/hooks-status.ts (Fixrunde 06.11.2026, Gruppe C):
// Abruf mit HTTP-Status (R26), laufende Nummer der Abrufe (R29), Kosten-Vollständigkeit (R20),
// Lauf-Zustand (R33), Kostensumme über Läufe (R32), unbekannter Ausgang (R10), Fehlertexte
// ohne geschützten Namen. Lauf: npm test.
// Nachprüfung 06.11.2026: Abschnitt-Grund für heute und "≥" vor laeufe_monat, gegengeprüft am
// echten werteKostenAus (lib/status-server.ts); 401 im Objekte-Pfad als "nicht angemeldet".
//
// hooks-status.ts importiert "./freigabe-regeln" ohne Endung (moduleResolution "bundler").
// Node braucht die Endung; der Resolve-Hook hängt sie für relative Importe aus .ts-Dateien an.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  anzeigeFehler,
  ausgangUnbekannt,
  erzeugeAbrufFolge,
  holeJson,
  istNichtAngemeldet,
  kostenLuecke,
  kostenSumme,
  kostenZeitraum,
  laeufeMonatUntergrenze,
  laufZustand,
  objekteLesungAus,
  objekteNichtAngemeldet,
  objektFehlerText,
  startZustand,
  uebernimmAbruf,
  zaehleLaeufe,
} = await import("../src/lib/hooks-status.ts");
// Produzent des Kostenwerts (nur Typ-Importe, im Test ladbar): Gegenprobe der Anzeige-Regeln.
const { werteKostenAus } = await import("../src/lib/status-server.ts");

const GESCHUETZT = /imm[ou][\s._-]*nexus/i;

/** Antwort-Attrappe: body als Objekt (JSON) oder als Text (z. B. Proxy-HTML). */
function antwort(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  };
}

function holenMit(res) {
  const aufrufe = [];
  const holen = async (url, init) => {
    aufrufe.push({ url, init });
    if (res instanceof Error) throw res;
    return res;
  };
  return { holen, aufrufe };
}

// ── holeJson (R26) ──

test("holeJson: 200 mit Objekt ist Erfolg, no-store und Signal gehen mit", async () => {
  const { holen, aufrufe } = holenMit(antwort(200, { erzeugt_am: "x" }));
  const ctrl = new AbortController();
  const e = await holeJson("/api/status", ctrl.signal, holen);
  assert.deepEqual(e, { ok: true, daten: { erzeugt_am: "x" }, httpStatus: 200 });
  assert.equal(aufrufe[0].url, "/api/status");
  assert.equal(aufrufe[0].init.cache, "no-store");
  assert.equal(aufrufe[0].init.signal, ctrl.signal);
});

test("holeJson: 401 heißt nicht angemeldet, mit Status, auch bei englischem error-Feld", async () => {
  const { holen } = holenMit(antwort(401, { error: "Unauthorized" }));
  const e = await holeJson("/api/status", undefined, holen);
  assert.deepEqual(e, { ok: false, fehler: "Nicht angemeldet (HTTP 401)", httpStatus: 401 });
});

test("holeJson: Fehlertext aus fehler, sonst error, sonst HTTP-Status", async () => {
  assert.deepEqual(await holeJson("/x", undefined, holenMit(antwort(500, { fehler: " DB weg " })).holen), {
    ok: false,
    fehler: "DB weg",
    httpStatus: 500,
  });
  assert.deepEqual(await holeJson("/x", undefined, holenMit(antwort(404, { error: "nicht da" })).holen), {
    ok: false,
    fehler: "nicht da",
    httpStatus: 404,
  });
  assert.deepEqual(await holeJson("/x", undefined, holenMit(antwort(503, "<html>Bad Gateway</html>")).holen), {
    ok: false,
    fehler: "HTTP 503",
    httpStatus: 503,
  });
});

test("holeJson: 2xx ohne JSON-Objekt ist kein Erfolg", async () => {
  for (const body of ["kein json", [1, 2], null]) {
    const e = await holeJson("/x", undefined, holenMit(antwort(200, body)).holen);
    assert.equal(e.ok, false, JSON.stringify(body));
    assert.equal(e.fehler, "HTTP 200: Antwort ist kein lesbares JSON-Objekt");
    assert.equal(e.httpStatus, 200);
  }
});

test("holeJson: Netzfehler ohne HTTP-Status, wirft nicht", async () => {
  const e = await holeJson("/x", undefined, holenMit(new TypeError("Failed to fetch")).holen);
  assert.deepEqual(e, { ok: false, fehler: "Server nicht erreichbar (Failed to fetch)", httpStatus: null });
});

test("holeJson: Fehlertexte zeigen den geschützten Namen nicht", async () => {
  const e = await holeJson("/x", undefined, holenMit(antwort(500, { fehler: "IMMONEXUS_EXPORT_TOKEN nicht gesetzt" })).holen);
  assert.equal(e.ok, false);
  assert.doesNotMatch(e.fehler, GESCHUETZT);
  const n = await holeJson("/x", undefined, holenMit(new Error("Immo-Nexus weg")).holen);
  assert.doesNotMatch(n.fehler, GESCHUETZT);
});

// ── Zustand und laufende Nummer (R29) ──

test("uebernimmAbruf: Erfolg setzt Daten und Zeit, Fehler behält beides und setzt den Status", () => {
  const z0 = startZustand();
  assert.deepEqual(z0, { daten: null, fehler: null, loading: true, geladenAm: null, httpStatus: null });
  const z1 = uebernimmAbruf(z0, { ok: true, daten: { n: 1 }, httpStatus: 200 }, "2026-11-06T10:00:00.000Z");
  assert.deepEqual(z1, { daten: { n: 1 }, fehler: null, loading: false, geladenAm: "2026-11-06T10:00:00.000Z", httpStatus: 200 });
  const z2 = uebernimmAbruf(z1, { ok: false, fehler: "Nicht angemeldet (HTTP 401)", httpStatus: 401 }, "2026-11-06T10:01:00.000Z");
  assert.deepEqual(z2, {
    daten: { n: 1 },
    fehler: "Nicht angemeldet (HTTP 401)",
    loading: false,
    geladenAm: "2026-11-06T10:00:00.000Z",
    httpStatus: 401,
  });
  const z3 = uebernimmAbruf(z2, { ok: true, daten: { n: 2 }, httpStatus: 200 }, "2026-11-06T10:02:00.000Z");
  assert.equal(z3.fehler, null);
  assert.equal(z3.httpStatus, 200);
});

test("erzeugeAbrufFolge: nur der zuletzt gestartete Abruf ist aktuell, der vorige wird abgebrochen", () => {
  const f = erzeugeAbrufFolge();
  const a = f.starte();
  assert.equal(f.istAktuell(a.nr), true);
  const b = f.starte();
  assert.equal(a.signal.aborted, true);
  assert.equal(b.signal.aborted, false);
  assert.equal(f.istAktuell(a.nr), false);
  assert.equal(f.istAktuell(b.nr), true);
});

test("erzeugeAbrufFolge: schliessen macht alle Nummern ungültig, oeffnen erlaubt neue", () => {
  const f = erzeugeAbrufFolge();
  const a = f.starte();
  f.schliessen();
  assert.equal(a.signal.aborted, true);
  assert.equal(f.istAktuell(a.nr), false);
  f.oeffnen();
  assert.equal(f.istAktuell(a.nr), false, "Abruf von vor dem Schließen bleibt ungültig");
  const b = f.starte();
  assert.equal(f.istAktuell(b.nr), true);
});

test("R29: ältere Antwort nach jüngerer überschreibt den Stand nicht (auch ohne wirksamen Abbruch)", async () => {
  // Wie usePoll.laden: starte → holeJson → nur aktuell übernehmen. Die Attrappe ignoriert das
  // Abbruchsignal, damit die laufende Nummer allein geprüft wird.
  const f = erzeugeAbrufFolge();
  let zustand = startZustand();
  const offen = [];
  const holen = () => new Promise((resolve) => offen.push(resolve));
  async function laden(zeit) {
    const { nr, signal } = f.starte();
    const e = await holeJson("/api/freigaben", signal, holen);
    if (!f.istAktuell(nr)) return;
    zustand = uebernimmAbruf(zustand, e, zeit);
  }
  const a = laden("A");
  const b = laden("B");
  offen[1](antwort(200, { wartend_gesamt: 2 })); // B (nach der Freigabe) kommt zuerst
  await b;
  offen[0](antwort(200, { wartend_gesamt: 3 })); // A (Stand vor der Freigabe) kommt danach
  await a;
  assert.deepEqual(zustand.daten, { wartend_gesamt: 2 });
  assert.equal(zustand.geladenAm, "B");

  // Ein älterer Fehlschlag nach einem jüngeren Erfolg setzt kein "nicht lesbar".
  const c = laden("C");
  const d = laden("D");
  offen[3](antwort(200, { wartend_gesamt: 1 }));
  await d;
  offen[2](antwort(500, { fehler: "alt" }));
  await c;
  assert.equal(zustand.fehler, null);
  assert.deepEqual(zustand.daten, { wartend_gesamt: 1 });
});

// ── Kosten (R20) ──

const KOSTEN = {
  heute_usd: 0.35,
  monat_usd: 4.2,
  planung_heute_usd: 0.05,
  planung_monat_usd: 0.6,
  laeufe_monat: 120,
  ohne_kosten_heute: 0,
  ohne_kosten_monat: 0,
  heute_vollstaendig: true,
  monat_vollstaendig: true,
  abgeschnitten: false,
};

test("kostenZeitraum: vollständiger Tag und Monat", () => {
  assert.deepEqual(kostenZeitraum(KOSTEN, "heute"), { usd: 0.35, vollstaendig: true, ohneKosten: 0, planungUsd: 0.05 });
  assert.deepEqual(kostenZeitraum(KOSTEN, "monat"), { usd: 4.2, vollstaendig: true, ohneKosten: 0, planungUsd: 0.6 });
  assert.equal(kostenLuecke(KOSTEN, "heute"), null);
  assert.equal(kostenLuecke(KOSTEN, "monat"), null);
});

test("kostenZeitraum: Lauf ohne Kosten am Monatsanfang macht nur den Monat unvollständig (R20)", () => {
  const w = { ...KOSTEN, ohne_kosten_monat: 1, monat_vollstaendig: false };
  assert.equal(kostenZeitraum(w, "heute").vollstaendig, true);
  assert.equal(kostenZeitraum(w, "monat").vollstaendig, false);
  assert.equal(kostenLuecke(w, "heute"), null);
  assert.equal(kostenLuecke(w, "monat"), "Monat ist eine Untergrenze: 1 Lauf ohne Kostenangabe.");
});

test("kostenZeitraum: unvollständiger Tag, abgeschnittene Abfrage, fehlende Angabe", () => {
  const heuteLuecke = { ...KOSTEN, ohne_kosten_heute: 2, ohne_kosten_monat: 2, heute_vollstaendig: false, monat_vollstaendig: false };
  assert.equal(kostenLuecke(heuteLuecke, "heute"), "Heute ist eine Untergrenze: 2 Läufe ohne Kostenangabe.");
  const abgeschnitten = { ...KOSTEN, abgeschnitten: true, monat_vollstaendig: false };
  assert.equal(kostenLuecke(abgeschnitten, "monat"), "Monat ist eine Untergrenze: Abfrage abgeschnitten (Zeilenlimit).");
  // Fehlt das Feld (älterer Server), gilt der Zeitraum als unvollständig (fail-closed).
  const ohneFeld = { ...KOSTEN };
  delete ohneFeld.heute_vollstaendig;
  assert.equal(kostenZeitraum(ohneFeld, "heute").vollstaendig, false);
  assert.equal(kostenLuecke(ohneFeld, "heute"), "Heute ist eine Untergrenze: Vollständigkeit vom Server nicht bestätigt.");
  assert.equal(kostenZeitraum({ ...KOSTEN, heute_vollstaendig: "true" }, "heute").vollstaendig, false);
});

test("kostenZeitraum: keine Zahl heißt nicht lesbar, fehlende Teilangaben null", () => {
  assert.equal(kostenZeitraum(null, "heute"), null);
  assert.equal(kostenZeitraum(undefined, "monat"), null);
  assert.equal(kostenZeitraum({ ...KOSTEN, heute_usd: null }, "heute"), null);
  assert.equal(kostenZeitraum({ ...KOSTEN, monat_usd: Number.NaN }, "monat"), null);
  const z = kostenZeitraum({ ...KOSTEN, planung_heute_usd: undefined, ohne_kosten_heute: "2" }, "heute");
  assert.equal(z.planungUsd, null);
  assert.equal(z.ohneKosten, null);
});

// ── Läufe (R33) und Kostensumme (R32) ──

test("laufZustand: erfolgreich nur ohne Fehler und mit abgeschnitten === false", () => {
  assert.equal(laufZustand({ fehler: null, abgeschnitten: false }), "fertig");
  assert.equal(laufZustand({ fehler: null, abgeschnitten: true }), "unvollstaendig");
  assert.equal(laufZustand({ fehler: null, abgeschnitten: null }), "unbekannt");
  assert.equal(laufZustand({ fehler: null }), "unbekannt");
  assert.equal(laufZustand({ fehler: "HTTP 502", abgeschnitten: false }), "fehler");
  assert.equal(laufZustand({ fehler: "", abgeschnitten: false }), "fehler");
  assert.equal(laufZustand({ fehler: "x", abgeschnitten: true }), "fehler");
});

test("zaehleLaeufe: zählt je Zustand und Läufe ohne Kostenangabe", () => {
  const z = zaehleLaeufe([
    { fehler: null, abgeschnitten: false, cost: 0.01 },
    { fehler: null, abgeschnitten: true, cost: 0.02 },
    { fehler: null, abgeschnitten: null, cost: null },
    { fehler: "leere Antwort", abgeschnitten: null, cost: null },
    { fehler: null, abgeschnitten: false },
    { fehler: null, abgeschnitten: false, cost: Number.NaN },
  ]);
  assert.deepEqual(z, { gesamt: 6, fertig: 3, unvollstaendig: 1, unbekannt: 1, fehler: 1, ohneKosten: 4 });
  assert.deepEqual(zaehleLaeufe([]), { gesamt: 0, fertig: 0, unvollstaendig: 0, unbekannt: 0, fehler: 0, ohneKosten: 0 });
});

test("kostenSumme: alle Kosten unbekannt heißt nicht gemessen, nie 0 (R32)", () => {
  assert.deepEqual(kostenSumme(0, 2, 2), { art: "nicht_gemessen" });
  assert.deepEqual(kostenSumme(null, 2, 2), { art: "nicht_gemessen" });
  assert.deepEqual(kostenSumme(null, 2, 0), { art: "nicht_gemessen" });
  assert.deepEqual(kostenSumme(0.5, 0, 0), { art: "nicht_gemessen" });
  assert.deepEqual(kostenSumme("0.5", 2, 0), { art: "nicht_gemessen" });
});

test("kostenSumme: teilweise unbekannt ist eine Untergrenze mit Anzahl", () => {
  assert.deepEqual(kostenSumme(0.0123, 2, 1), { art: "geschaetzt", usd: 0.0123, ohneKosten: 1 });
  assert.deepEqual(kostenSumme(0.0123, 2, 0), { art: "geschaetzt", usd: 0.0123, ohneKosten: 0 });
});

// ── Unbekannter Ausgang (R10) ──

const istErgebnis = (d) => d && d.mode === "ausgefuehrt" && Array.isArray(d.results);

test("ausgangUnbekannt: keine lesbare Antwort, 2xx ohne Ergebnis, 500, 502 ohne Text, 503+", () => {
  assert.equal(ausgangUnbekannt({ ok: false, status: 502, daten: null }, istErgebnis), true);
  assert.equal(ausgangUnbekannt({ ok: true, status: 200, daten: null }, istErgebnis), true);
  assert.equal(ausgangUnbekannt({ ok: true, status: 200, daten: { mode: "plan" } }, istErgebnis), true);
  assert.equal(ausgangUnbekannt({ ok: false, status: 500, daten: { fehler: "unerwartet" } }, istErgebnis), true);
  assert.equal(ausgangUnbekannt({ ok: false, status: 502, daten: { error: "Bad Gateway" } }, istErgebnis), true);
  assert.equal(ausgangUnbekannt({ ok: false, status: 504, daten: { fehler: "Zeitüberschreitung" } }, istErgebnis), true);
});

test("ausgangUnbekannt: bekannte Ausgänge (Ergebnis, 4xx, 502 der Route vor dem Start)", () => {
  assert.equal(ausgangUnbekannt({ ok: true, status: 200, daten: { mode: "ausgefuehrt", results: [] } }, istErgebnis), false);
  assert.equal(ausgangUnbekannt({ ok: false, status: 404, daten: { fehler: "Plan nicht gefunden" } }, istErgebnis), false);
  assert.equal(ausgangUnbekannt({ ok: false, status: 422, daten: { fehler: "Plan ungültig" } }, istErgebnis), false);
  assert.equal(ausgangUnbekannt({ ok: false, status: 401, daten: { error: "Unauthorized" } }, istErgebnis), false);
  assert.equal(
    ausgangUnbekannt({ ok: false, status: 502, daten: { fehler: "Ausführung nicht protokolliert, deshalb nicht gestartet" } }, istErgebnis),
    false,
  );
});

// ── Fehlertexte für die Anzeige ──

test("objektFehlerText: Codes als Klartext, kein technischer Bezeichner sichtbar", () => {
  // Heutige Form des Erzeugers (leseSchluessel, R23): ohne Variablennamen, Text bleibt stehen.
  assert.equal(objektFehlerText("Export-Token (Server-Umgebung) nicht gesetzt"), "Export-Token (Server-Umgebung) nicht gesetzt");
  // Gegencheck 06.11.2026: kein eigener Zweig mehr für die Altform; ein geschützter Name darin
  // bleibt trotzdem unsichtbar (anzeigeFehler maskiert).
  assert.doesNotMatch(objektFehlerText("IMMONEXUS_EXPORT_TOKEN nicht konfiguriert"), GESCHUETZT);
  assert.equal(objektFehlerText("quelle_nicht_erreichbar"), "Steinadel-Export nicht erreichbar");
  assert.equal(objektFehlerText("HTTP 500"), "HTTP 500");
  assert.doesNotMatch(objektFehlerText("Immo Nexus antwortet nicht"), GESCHUETZT);
  assert.equal(objektFehlerText("   "), "unbekannter Fehler");
});

test("anzeigeFehler: maskiert alle Schreibweisen und trimmt", () => {
  for (const t of ["ImmoNexus", "IMMONEXUS_X", "immo-nexus", "Immu Nexus", "immo.nexus"]) {
    assert.doesNotMatch(anzeigeFehler(`Fehler bei ${t} `), GESCHUETZT, t);
  }
  assert.equal(anzeigeFehler("  ok  "), "ok");
});

// ── Nachprüfung 06.11.2026: Kostenwert-Gründe gegen den Produzenten (werteKostenAus) ──

const JETZT = new Date("2026-11-06T12:00:00Z"); // Mitternacht Berlin: 2026-11-05T23:00:00Z
const kostenZeile = (zeit, kosten) => ({ zeit, kosten, quelle: "activation-api", art: null, preisStand: "2026-11-06" });

/** Monatszeilen, neueste zuerst; mitGestern: die geladenen Zeilen reichen vor Mitternacht zurück. */
function szenario({ ohneHeute, ohneGestern, mitGestern, abgeschnitten, gesamtBekannt }) {
  const zeilen = [];
  for (let i = 0; i < ohneHeute; i++) zeilen.push(kostenZeile(`2026-11-06T11:0${i}:00Z`, null));
  zeilen.push(kostenZeile("2026-11-06T10:00:00Z", 0.1), kostenZeile("2026-11-06T09:00:00Z", 0.2));
  if (mitGestern) {
    for (let i = 0; i < ohneGestern; i++) zeilen.push(kostenZeile(`2026-11-05T21:0${i}:00Z`, null));
    zeilen.push(kostenZeile("2026-11-05T20:00:00Z", 0.3));
  }
  const gesamt = gesamtBekannt ? (abgeschnitten ? 6000 : zeilen.length) : null;
  const a = werteKostenAus(zeilen, { gesamt, abgeschnitten }, JETZT, "2026-11-06");
  // Die Route verbindet die Hinweise mit " · " (verbinde in lib/status-server.ts).
  return { ...a, hinweis: a.hinweise.join(" · "), tagAbgeschnitten: abgeschnitten && !mitGestern };
}

test("Nachprüfung: Monat abgeschnitten, Tag nicht — Heute nennt keinen Abschnitt (Fall der Prüfer)", () => {
  const s = szenario({ ohneHeute: 1, ohneGestern: 0, mitGestern: true, abgeschnitten: true, gesamtBekannt: true });
  assert.match(s.hinweis, /Tagessumme unvollständig: 1 Lauf von heute ohne Kostenangabe\./);
  assert.equal(kostenLuecke(s.wert, "heute"), "Heute ist eine Untergrenze: 1 Lauf ohne Kostenangabe.");
  assert.equal(
    kostenLuecke(s.wert, "monat"),
    "Monat ist eine Untergrenze: 1 Lauf ohne Kostenangabe, Abfrage abgeschnitten (Zeilenlimit).",
  );
  // laeufe_monat ist die Gesamtzahl aus Supabase: exakt, kein "≥".
  assert.equal(s.wert.laeufe_monat, 6000);
  assert.equal(laeufeMonatUntergrenze(s.wert, s.hinweis), false);
});

test("Nachprüfung: Tag abgeschnitten ohne Lauf ohne Kosten — der Abschnitt ist der Grund", () => {
  const s = szenario({ ohneHeute: 0, ohneGestern: 0, mitGestern: false, abgeschnitten: true, gesamtBekannt: true });
  assert.equal(s.wert.heute_vollstaendig, false);
  assert.match(s.hinweis, /die geladenen Läufe reichen nicht bis Mitternacht zurück/);
  assert.equal(
    kostenLuecke(s.wert, "heute"),
    "Heute ist eine Untergrenze: Abfrage abgeschnitten (Zeilenlimit), die geladenen Läufe reichen nicht bis Mitternacht zurück.",
  );
});

test("Nachprüfung: ohne Angabe zur Tagesvollständigkeit kein abgeleiteter Abschnitt (fail-closed)", () => {
  const w = { ...KOSTEN, abgeschnitten: true, monat_vollstaendig: false };
  delete w.heute_vollstaendig;
  assert.equal(kostenLuecke(w, "heute"), "Heute ist eine Untergrenze: Vollständigkeit vom Server nicht bestätigt.");
  // Server-widersprüchlich (Tag unvollständig, nichts fehlt, nichts abgeschnitten): nicht erfinden.
  assert.equal(
    kostenLuecke({ ...KOSTEN, heute_vollstaendig: false }, "heute"),
    "Heute ist eine Untergrenze: Vollständigkeit vom Server nicht bestätigt.",
  );
  // Anzahl ohne Kosten nicht lesbar: der Abschnitt ist dann nicht als Ursache belegt.
  assert.equal(
    kostenLuecke({ ...KOSTEN, heute_vollstaendig: false, ohne_kosten_heute: "0", abgeschnitten: true }, "heute"),
    "Heute ist eine Untergrenze: Vollständigkeit vom Server nicht bestätigt.",
  );
});

test("Nachprüfung: alle Kombinationen — keine Behauptung, die der Server nicht deckt", () => {
  let faelle = 0;
  let entscheidbarAbgeschnitten = 0;
  for (const ohneHeute of [0, 1, 2])
    for (const ohneGestern of [0, 1])
      for (const mitGestern of [true, false])
        for (const abgeschnitten of [true, false])
          for (const gesamtBekannt of [true, false]) {
            const s = szenario({ ohneHeute, ohneGestern, mitGestern, abgeschnitten, gesamtBekannt });
            const fall = JSON.stringify({ ohneHeute, ohneGestern, mitGestern, abgeschnitten, gesamtBekannt });
            const heute = kostenLuecke(s.wert, "heute");
            const monat = kostenLuecke(s.wert, "monat");
            faelle += 1;
            if (s.wert.heute_vollstaendig) {
              assert.equal(heute, null, fall);
              assert.match(s.hinweis, /Tagessumme vollständig|^(?!.*Tagessumme)/, fall);
            } else {
              assert.equal(/ohne Kostenangabe/.test(heute), ohneHeute > 0, fall);
              // Ein genannter Abschnitt muss den Tag wirklich betreffen …
              if (/abgeschnitten/.test(heute)) {
                assert.ok(s.tagAbgeschnitten, fall);
                assert.match(s.hinweis, /Tagessumme unvollständig:[^.]*Mitternacht/, fall);
              }
              // … und wird genannt, wo er sich aus dem Kostenwert ableiten lässt.
              if (s.tagAbgeschnitten && ohneHeute === 0) {
                entscheidbarAbgeschnitten += 1;
                assert.match(heute, /Abfrage abgeschnitten/, fall);
              }
            }
            if (s.wert.monat_vollstaendig) assert.equal(monat, null, fall);
            else assert.equal(/Abfrage abgeschnitten/.test(monat), abgeschnitten, fall);
            assert.equal(laeufeMonatUntergrenze(s.wert, s.hinweis), abgeschnitten && !gesamtBekannt, fall);
          }
  assert.equal(faelle, 48);
  assert.ok(entscheidbarAbgeschnitten > 0, "der entscheidbare Fall kommt im Raster vor");
});

test("laeufeMonatUntergrenze: nur abgeschnitten UND Hinweis 'keine Gesamtzahl'", () => {
  const s = szenario({ ohneHeute: 0, ohneGestern: 0, mitGestern: true, abgeschnitten: true, gesamtBekannt: false });
  assert.match(s.hinweis, /Supabase lieferte keine Gesamtzahl/);
  assert.equal(laeufeMonatUntergrenze(s.wert, s.hinweis), true);
  assert.equal(laeufeMonatUntergrenze(s.wert, undefined), false);
  assert.equal(laeufeMonatUntergrenze({ ...s.wert, abgeschnitten: false }, s.hinweis), false);
  assert.equal(laeufeMonatUntergrenze(null, s.hinweis), false);
});

// ── Nachprüfung 06.11.2026: 401 im Objekte-Pfad ──

test("objektFehlerText und objekteNichtAngemeldet: nur der 401 der Middleware heißt nicht angemeldet", () => {
  assert.equal(objektFehlerText("HTTP 401"), "Nicht angemeldet (HTTP 401)");
  assert.equal(objekteNichtAngemeldet("HTTP 401"), true);
  assert.equal(objekteNichtAngemeldet(" HTTP 401 "), true);
  // Kein Ausfall wird als Anmeldeproblem ausgegeben.
  for (const f of ["HTTP 4010", "HTTP 403", "HTTP 500", "Export antwortete mit HTTP 401", "quelle_nicht_erreichbar", "", null, undefined]) {
    assert.equal(objekteNichtAngemeldet(f), false, String(f));
  }
});

test("objekteLesungAus: Fehlertext bereinigt, 401 gekennzeichnet, sonst false", () => {
  const objekte = [{ slug: "a", name: "A", preis: "1" }];
  // Nachprüfung im Browser 06.11.2026: dazu die Ursache (fehlerArt), siehe n-browser-nachpruefung.
  assert.deepEqual(objekteLesungAus({ objekte, loading: false, error: null }), {
    objekte, loading: false, error: null, nichtAngemeldet: false, fehlerArt: null,
  });
  assert.deepEqual(objekteLesungAus({ objekte: [], loading: false, error: "HTTP 401" }), {
    objekte: [], loading: false, error: "Nicht angemeldet (HTTP 401)", nichtAngemeldet: true, fehlerArt: "nicht_angemeldet",
  });
  // Heutige Form der Route (R23) mit fehler_art; die Ursache kommt aus fehler_art, nicht aus dem Text.
  const token = objekteLesungAus({
    objekte: [],
    loading: false,
    error: "Export-Token (Server-Umgebung) nicht gesetzt",
    fehlerArt: "konfiguration",
  });
  assert.equal(token.error, "Export-Token (Server-Umgebung) nicht gesetzt");
  assert.equal(token.nichtAngemeldet, false);
  assert.equal(token.fehlerArt, "konfiguration");
  assert.equal(objekteLesungAus({ objekte: [], loading: true, error: null }).loading, true);
});

test("useObjekte meldet einen HTTP-Status ohne Fehlerfeld als `HTTP ${status}` (Grundlage der 401-Erkennung)", async () => {
  // useObjekte (lib/hooks.ts) lädt den Supabase-Client und ist hier nicht ladbar; geprüft wird
  // die Stelle, die den Fehlertext bildet. Ändert sie sich, erkennt objekteNichtAngemeldet nichts mehr.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/lib/hooks.ts", import.meta.url), "utf8");
  const start = src.indexOf("export function useObjekte");
  assert.ok(start >= 0, "useObjekte nicht gefunden");
  const rumpf = src.slice(start, src.indexOf("\n}\n", start));
  assert.match(rumpf, /fetch\("\/api\/objekte"/);
  assert.match(rumpf, /typeof daten\.fehler === "string" \? daten\.fehler : `HTTP \$\{res\.status\}`/);
});

test("istNichtAngemeldet: Fehler mit 401, sonst nicht", () => {
  assert.equal(istNichtAngemeldet({ fehler: "Nicht angemeldet (HTTP 401)", httpStatus: 401 }), true);
  assert.equal(istNichtAngemeldet({ fehler: "HTTP 500", httpStatus: 500 }), false);
  assert.equal(istNichtAngemeldet({ fehler: "Server nicht erreichbar (x)", httpStatus: null }), false);
  assert.equal(istNichtAngemeldet({ fehler: null, httpStatus: 401 }), false);
});
