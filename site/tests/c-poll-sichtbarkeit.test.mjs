// Freigabe-Stapel sparsam (09.11.2026): usePoll in lib/hooks-status.ts pausiert im verborgenen Tab wie die
// Liste auf /content (app/content/page.tsx). Lauf: npm test.
//
// Geprüft über alle Wege, auf denen usePoll abfragt: SystemStatusProvider (/api/status, in der Shell jeder
// Seite), useSystemStatus ohne Provider (Rückfall, /api/status) und useFreigaben (/api/freigaben: Panel
// "Wartet auf dich" auf dem Dashboard und /content). Die ECHTE Datei läuft mit der Hook-Laufzeit aus
// tests/harness/studio.mjs (Zustand, Effekte mit Abhängigkeiten und Aufräumen), ergänzt um createContext,
// useContext und createElement für den Provider. Zeitgeber laufen auf den Attrappen-Uhren von node:test
// (setTimeout, setInterval); fetch und document (visibilityState, visibilitychange) sind Attrappen.
// Kein Netz. Z_TSX_LIB_HOOKS_STATUS=<pfad> prüft statt der Repo-Datei eine Kopie (tests/harness/tsx.mjs).
//
// Unverändert und hier mitgeprüft: R28 (unter dem Provider fragt useSystemStatus nicht selbst ab) und R29
// (ein neuer Abruf bricht den vorigen ab; Abbau bricht den laufenden ab).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { ladeTsx } = await import("./harness/tsx.mjs");
const { hookLaufzeit } = await import("./harness/studio.mjs");
const regeln = await import("../src/lib/freigabe-regeln.ts");

/** Takt beider Nutzer (STATUS_TAKT_MS und Vorgabe von useFreigaben): 60 s. */
const TAKT = 60_000;
const ECHTER_FETCH = globalThis.fetch;

const offen = [];
afterEach(() => {
  for (const lz of offen.splice(0)) lz.abbauen();
  delete globalThis.document;
  globalThis.fetch = ECHTER_FETCH;
});

/** Hook-Laufzeit mit Kontext; lädt die echte lib/hooks-status.ts gegen sie. */
function laufzeit() {
  const lz = hookLaufzeit();
  offen.push(lz);
  const kontexte = [];
  const react = {
    ...lz.attrappen.react,
    createContext(standard) {
      const k = { aktuell: standard };
      k.Provider = ({ value, children }) => {
        k.aktuell = value;
        return children;
      };
      kontexte.push(k);
      return k;
    },
    useContext: (k) => k.aktuell,
    createElement: (type, props, ...kinder) => lz.jsx(type, { ...(props ?? {}), children: kinder.length === 1 ? kinder[0] : kinder }),
  };
  const modul = ladeTsx("lib/hooks-status.ts", { ...lz.attrappen, react, "./freigabe-regeln": regeln });
  return { lz, modul, kontexte };
}

/** Die Wege, auf denen usePoll abfragt; lies(modul) ist der Hook, den die Seite aufruft. */
const NUTZER = [
  { name: "SystemStatusProvider (/api/status)", pfad: "/api/status", provider: true, lies: (m) => m.useSystemStatus() },
  { name: "useSystemStatus ohne Provider (/api/status)", pfad: "/api/status", provider: false, lies: (m) => m.useSystemStatus() },
  { name: "useFreigaben (/api/freigaben)", pfad: "/api/freigaben", provider: false, lies: (m) => m.useFreigaben() },
];

/** Baut den Nutzer auf: Wurzel ist der Provider mit einem lesenden Kind oder der lesende Hook allein. */
function baue(nutzer, { leser = 1 } = {}) {
  const { lz, modul, kontexte } = laufzeit();
  const gelesen = [];
  const Leser = () => {
    gelesen.push(nutzer.lies(modul));
    return null;
  };
  const kinder = Array.from({ length: leser }, () => lz.jsx(Leser, {}));
  if (nutzer.provider) lz.setzeWurzel(modul.SystemStatusProvider, { children: kinder.length === 1 ? kinder[0] : kinder });
  else lz.setzeWurzel(Leser);
  return { lz, modul, kontexte, letzte: () => gelesen.at(-1), zuletzt: (anzahl) => gelesen.slice(-anzahl) };
}

/** fetch-Attrappe: zählt Abrufe je Pfad und antwortet sofort mit 200 und laufender Nummer; ein Abbruch lehnt ab wie fetch. */
function netz({ antworten = true } = {}) {
  const abrufe = [];
  globalThis.fetch = (url, init = {}) =>
    new Promise((ok, fehl) => {
      const a = { url, init, nr: abrufe.length + 1 };
      abrufe.push(a);
      init.signal?.addEventListener("abort", () => fehl(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
      a.antworte = () => ok({ status: 200, ok: true, json: async () => ({ erzeugt_am: "2026-11-09T08:00:00.000Z", nr: a.nr }) });
      if (antworten) a.antworte();
    });
  return { abrufe, an: (pfad) => abrufe.filter((a) => a.url === pfad), andere: (pfad) => abrufe.filter((a) => a.url !== pfad).map((a) => a.url) };
}

/** document-Attrappe mit visibilityState und visibilitychange (wie tests/r-content-server.test.mjs). */
function sichtbarkeit(start) {
  const lauscher = new Set();
  const doc = {
    visibilityState: start,
    addEventListener: (typ, fn) => typ === "visibilitychange" && lauscher.add(fn),
    removeEventListener: (typ, fn) => typ === "visibilitychange" && lauscher.delete(fn),
  };
  globalThis.document = doc;
  return {
    lauscher,
    setze(zustand) {
      doc.visibilityState = zustand;
      for (const fn of [...lauscher]) fn();
    },
  };
}

/** Zeit vorrücken und Antworten verarbeiten lassen. */
async function warte(t, lz, ms) {
  t.mock.timers.tick(ms);
  return lz.ruhe();
}

/** Gelesene Daten des Hooks (status bzw. freigaben). */
const daten = (lesung) => lesung.status ?? lesung.freigaben ?? null;

for (const nutzer of NUTZER) {
  test(`FS-H1 ${nutzer.name}: erster Abruf beim Aufbau auch im verborgenen Tab; im Takt kein Abruf, solange verborgen; beim Zurückkehren sofort einer, danach wieder im Takt`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const s = sichtbarkeit("hidden");
    const n = netz();
    const { lz, letzte } = baue(nutzer);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(n.an(nutzer.pfad).length, 1, "erster Abruf beim Aufbau, auch im verborgenen Tab");
    assert.deepEqual(daten(letzte()), { erzeugt_am: "2026-11-09T08:00:00.000Z", nr: 1 });
    await warte(t, lz, 3 * TAKT);
    assert.equal(n.an(nutzer.pfad).length, 1, "drei Takte im verborgenen Tab ohne Abruf");

    s.setze("visible");
    await lz.ruhe();
    assert.equal(n.an(nutzer.pfad).length, 2, "beim Zurückkehren sofort, ohne auf den Takt zu warten");
    assert.equal(daten(letzte()).nr, 2, "die Antwort des Abrufs bei der Rückkehr gilt");
    await warte(t, lz, TAKT - 1);
    assert.equal(n.an(nutzer.pfad).length, 2, "vor dem nächsten Takt kein weiterer Abruf");
    await warte(t, lz, 1);
    assert.equal(n.an(nutzer.pfad).length, 3, "danach wieder im Takt");
    await warte(t, lz, TAKT);
    assert.equal(n.an(nutzer.pfad).length, 4, "sichtbar: jeder Takt fragt ab");

    // Wieder verborgen: Der Wechsel selbst fragt nicht ab, der Takt pausiert erneut.
    s.setze("hidden");
    await lz.ruhe();
    assert.equal(n.an(nutzer.pfad).length, 4, "der Wechsel auf verborgen fragt nicht ab");
    await warte(t, lz, 2 * TAKT);
    assert.equal(n.an(nutzer.pfad).length, 4, "zwei weitere Takte verborgen ohne Abruf");
    s.setze("visible");
    await lz.ruhe();
    assert.equal(n.an(nutzer.pfad).length, 5);
    assert.deepEqual(n.andere(nutzer.pfad), [], "keine anderen Abrufe");
    for (const a of n.an(nutzer.pfad)) assert.equal(a.init.cache, "no-store");
  });

  test(`FS-H2 ${nutzer.name}: Abbau entfernt den Lauscher — vorher löst die Rückkehr einen Abruf aus, danach weder visibilitychange noch Takt; der laufende Abruf wird abgebrochen`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const s = sichtbarkeit("visible");
    const n = netz({ antworten: false });
    const { lz } = baue(nutzer);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(n.an(nutzer.pfad).length, 1);
    assert.equal(s.lauscher.size, 1, "visibilitychange abonniert, genau einmal");
    s.setze("hidden");
    s.setze("visible");
    await lz.ruhe();
    assert.equal(n.an(nutzer.pfad).length, 2, "Rückkehr: sofort ein Abruf");
    const [erster, laufend] = n.an(nutzer.pfad);
    assert.equal(erster.init.signal.aborted, true, "R29: der neue Abruf bricht den vorigen ab");
    assert.equal(laufend.init.signal.aborted, false);

    lz.abbauen();
    assert.equal(s.lauscher.size, 0, "Lauscher entfernt");
    assert.equal(laufend.init.signal.aborted, true, "laufender Abruf beim Abbau abgebrochen");
    s.setze("hidden");
    s.setze("visible");
    await warte(t, lz, 5 * TAKT);
    assert.equal(n.abrufe.length, 2, "nach dem Abbau kein Abruf, weder auf visibilitychange noch im Takt");
  });

  test(`FS-H3 ${nutzer.name}: ohne document (Server, Tests ohne DOM) nur der Takt wie bisher — erster Abruf beim Aufbau, dann jeder Takt`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    assert.equal(typeof globalThis.document, "undefined", "Testvoraussetzung: kein document");
    const n = netz();
    const { lz } = baue(nutzer);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(n.an(nutzer.pfad).length, 1, "erster Abruf beim Aufbau");
    await warte(t, lz, TAKT - 1);
    assert.equal(n.an(nutzer.pfad).length, 1);
    await warte(t, lz, 1);
    assert.equal(n.an(nutzer.pfad).length, 2, "nach einem Takt");
    await warte(t, lz, 3 * TAKT);
    assert.equal(n.an(nutzer.pfad).length, 5, "jeder Takt fragt ab");
    lz.abbauen();
    await warte(t, lz, 3 * TAKT);
    assert.equal(n.an(nutzer.pfad).length, 5, "nach dem Abbau kein Takt");
  });
}

test("FS-H4 R28 bleibt: Unter dem SystemStatusProvider fragen die Leser nicht selbst ab — ein Lauscher, ein Abruf beim Aufbau und genau einer je Rückkehr, für alle Leser dieselbe Antwort", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const s = sichtbarkeit("visible");
  const n = netz();
  const { lz, zuletzt } = baue(NUTZER[0], { leser: 3 });
  lz.rendere();
  await warte(t, lz, 0);
  assert.equal(n.abrufe.length, 1, "ein Abruf für Provider und drei Leser");
  assert.equal(s.lauscher.size, 1, "nur der Provider abonniert visibilitychange");
  s.setze("hidden");
  await warte(t, lz, 2 * TAKT);
  assert.equal(n.abrufe.length, 1);
  s.setze("visible");
  await lz.ruhe();
  assert.equal(n.abrufe.length, 2, "genau ein Abruf je Rückkehr");
  const [a, b, c] = zuletzt(3);
  assert.ok(a === b && b === c, "alle Leser lesen dieselbe Lesung des Providers");
  assert.equal(daten(a).nr, 2);
  await warte(t, lz, TAKT);
  assert.equal(n.abrufe.length, 3, "danach im Takt, einmal");
  assert.deepEqual(n.andere("/api/status"), []);
});

test("FS-H5 aktiv=false: Bekommt useSystemStatus einen Provider (aktiv wird false), entfernt der eigene Abruf Lauscher und Takt — keine Abrufe mehr auf visibilitychange oder im Takt", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const s = sichtbarkeit("visible");
  const n = netz();
  const { lz, kontexte, letzte } = baue(NUTZER[1]);
  lz.rendere();
  await warte(t, lz, 0);
  assert.equal(n.abrufe.length, 1, "ohne Provider: eigener Abruf");
  assert.equal(s.lauscher.size, 1, "eigener Lauscher");
  s.setze("hidden");
  s.setze("visible");
  await lz.ruhe();
  assert.equal(n.abrufe.length, 2, "eigener Abruf bei der Rückkehr");

  assert.equal(kontexte.length, 1, "ein Kontext (StatusKontext)");
  const geteilt = { status: null, fehler: null, loading: false, geladenAm: null, httpStatus: null, neuLaden: async () => {} };
  kontexte[0].aktuell = geteilt;
  lz.rendere();
  assert.equal(letzte(), geteilt, "liest jetzt den geteilten Abruf");
  assert.equal(s.lauscher.size, 0, "Lauscher entfernt, sobald aktiv false ist");
  s.setze("hidden");
  s.setze("visible");
  await warte(t, lz, 3 * TAKT);
  assert.equal(n.abrufe.length, 2, "kein eigener Abruf mehr");
});
