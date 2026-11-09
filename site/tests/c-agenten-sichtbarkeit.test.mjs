// Agenten sparsam (09.11.2026): useAgents und useAgentDetail (lib/hooks.ts) lesen im verborgenen Tab nicht mehr im
// 60-s-Takt — wie usePoll (lib/hooks-status.ts, tests/c-poll-sichtbarkeit.test.mjs) und die Liste auf /content
// (app/content/page.tsx). Lauf: npm test.
//
// Nutzer: useAgents auf Dashboard (app/page.tsx), /agents, /metrics und /messages (je Seite ein Aufruf),
// useAgentDetail auf /agents/[id]. Die ECHTE Datei läuft mit der Hook-Laufzeit aus tests/harness/studio.mjs
// (Zustand, Effekte mit Abhängigkeiten und Aufräumen). Zeitgeber laufen auf den Attrappen-Uhren von node:test
// (setInterval, setTimeout); Supabase (Abfragen, Realtime-Kanal) und document sind Attrappen. Kein Netz.
// Z_TSX_LIB_HOOKS=<pfad> prüft statt der Repo-Datei eine Kopie (tests/harness/tsx.mjs).
//
// document liegt auf einem echten EventTarget von Node: Es wertet die Optionen von addEventListener und
// removeEventListener aus wie der Browser (etwa once und capture); eine einfache Attrappe übersähe { once: true }.
// Dazu führt die Attrappe An- und Abmeldungen nach der Regel des Browsers mit (Typ, Funktion, capture).
//
// Unverändert und hier mitgeprüft: die erste Lesung beim Aufbau (auch verborgen), ohne document nur der Takt, der
// Realtime-Kanal, refetch und neuLaden (lesen auch im verborgenen Tab sofort) und das Fehlerverhalten (ein
// Lesefehler lässt die Liste stehen und setzt error). Überlappende Lesungen (AS-U1 bis AS-U4): useAgents übernahm
// jede Antwort, auch eine ältere, die nach einer neueren ankam (AS-U1 zeigt das im Takt allein); jetzt gilt nur die
// zuletzt gestartete Lesung (wie R29 in lib/hooks-status.ts). useAgentDetail verwirft den älteren Lauf über die
// Effekt-Bereinigung.
// Jeder Test hat ein eigenes Zeitlimit: Wartet eine Abfrage auf eine Antwort, die kein Test gibt, wird der Test rot,
// statt npm test aufzuhängen.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { ladeTsx } = await import("./harness/tsx.mjs");
const { hookLaufzeit } = await import("./harness/studio.mjs");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const types = await import("../src/lib/types.ts");

/** Takt beider Hooks (AGENTEN_TAKT_MS in lib/hooks.ts): 60 s. */
const TAKT = 60_000;
/** Zeitlimit je Test; normal enden die Tests in Millisekunden. */
const GRENZE = { timeout: 10_000 };
const LESEFEHLER = "Lesefehler (Test)";

const offen = [];
afterEach(() => {
  for (const lz of offen.splice(0)) lz.abbauen();
  delete globalThis.document;
});

/**
 * Supabase-Attrappe. Jede Abfrage wird mit ihrer Tabelle festgehalten und bekommt je Tabelle eine laufende Nummer;
 * ihre Antwort trägt dieselbe Nummer (Feld lesung), so ist sichtbar, wessen Antwort der Hook zeigt. sofort: Die
 * Abfrage antwortet gleich; sonst erst mit a.antworte() oder a.scheitere() (Lesefehler). Realtime-Kanäle werden
 * gezählt.
 */
function datenbank({ sofort = true } = {}) {
  const abfragen = [];
  const kanaele = { angelegt: 0, entfernt: 0 };
  const an = (tabelle) => abfragen.filter((a) => a.tabelle === tabelle);
  const agent = (nr, id = "oracle") => ({ id, name: id.toUpperCase(), tier: 1, lesung: nr });
  const daten = (a) =>
    a.tabelle === "messages"
      ? [{ id: `m-${a.nr}`, from_agent: "oracle", to_agents: [], lesung: a.nr }]
      : a.einzeln
        ? agent(a.nr)
        : [agent(a.nr), agent(a.nr, "trader")];
  function from(tabelle) {
    const a = { tabelle, einzeln: false, nr: 0, offen: false };
    const kette = {
      select: () => kette,
      order: () => kette,
      eq: () => kette,
      or: () => kette,
      limit: () => kette,
      maybeSingle() {
        a.einzeln = true;
        return kette;
      },
      then(ok, fehl) {
        const antwort = new Promise((loesen) => {
          a.nr = an(tabelle).length + 1;
          a.offen = true;
          const ende = (wert) => {
            assert.ok(a.offen, `Abfrage ${tabelle} ${a.nr} ist schon beantwortet`);
            a.offen = false;
            loesen(wert);
          };
          a.antworte = () => ende({ data: daten(a), error: null });
          a.scheitere = () => ende({ data: null, error: { message: LESEFEHLER } });
          abfragen.push(a);
          if (sofort) a.antworte();
        });
        return antwort.then(ok, fehl);
      },
    };
    return kette;
  }
  const kanal = { on: () => kanal, subscribe: () => kanal };
  const supabase = {
    from,
    channel() {
      kanaele.angelegt += 1;
      return kanal;
    },
    removeChannel() {
      kanaele.entfernt += 1;
    },
  };
  return { supabase, abfragen, kanaele, an };
}

/** Baut eine Seite, die den Hook aufruft (lies), gegen die echte lib/hooks.ts; hält jede Lesung des Hooks fest. */
function baue(lies, db) {
  const lz = hookLaufzeit();
  offen.push(lz);
  const modul = ladeTsx("lib/hooks.ts", {
    ...lz.attrappen,
    "./supabase": { supabase: db.supabase },
    "./freigabe-regeln": regeln,
    "./types": types,
  });
  const gelesen = [];
  lz.setzeWurzel(() => {
    gelesen.push(lies(modul));
    return null;
  });
  return { lz, gelesen, letzte: () => gelesen.at(-1) };
}

/**
 * document-Attrappe auf einem echten EventTarget von Node (wie FS-M1 in tests/c-poll-sichtbarkeit.test.mjs).
 * angemeldet() zählt die Lauscher auf visibilitychange nach der Regel des Browsers: Ein Lauscher ist Typ, Funktion
 * und capture; abmelden trifft nur dieselbe Kombination. anmeldungen() zählt jeden Aufruf von addEventListener.
 */
function sichtbarkeit(start) {
  const ziel = new EventTarget();
  const lauscher = [];
  let anmeldungen = 0;
  const capture = (optionen) => (typeof optionen === "boolean" ? optionen : Boolean(optionen?.capture));
  const stelle = (typ, fn, c) => lauscher.findIndex((l) => l.typ === typ && l.fn === fn && l.capture === c);
  const doc = {
    visibilityState: start,
    addEventListener(typ, fn, optionen) {
      anmeldungen += 1;
      if (stelle(typ, fn, capture(optionen)) < 0) lauscher.push({ typ, fn, capture: capture(optionen) });
      ziel.addEventListener(typ, fn, optionen);
    },
    removeEventListener(typ, fn, optionen) {
      const i = stelle(typ, fn, capture(optionen));
      if (i >= 0) lauscher.splice(i, 1);
      ziel.removeEventListener(typ, fn, optionen);
    },
  };
  globalThis.document = doc;
  return {
    angemeldet: () => lauscher.filter((l) => l.typ === "visibilitychange").length,
    anmeldungen: () => anmeldungen,
    setze(zustand) {
      doc.visibilityState = zustand;
      ziel.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

/** Zeit vorrücken und Antworten verarbeiten lassen. */
async function warte(t, lz, ms) {
  t.mock.timers.tick(ms);
  return lz.ruhe();
}

/** Takt für Takt vorrücken: Jeder Takt wird verarbeitet, bevor der nächste kommt (wie im Browser 60 s später). */
async function takte(t, lz, anzahl) {
  for (let i = 0; i < anzahl; i += 1) await warte(t, lz, TAKT);
}

/** Die beiden Hooks; stand() ist die Nummer der Lesung, deren Antwort der Hook zeigt. */
const NUTZER = [
  {
    name: "useAgents (Dashboard, /agents, /metrics, /messages)",
    detail: false,
    aufruf: "refetch",
    lies: (m) => m.useAgents(),
    neuLesen: (l) => l.refetch(),
    stand: (l) => l.agents[0]?.lesung ?? null,
  },
  {
    name: "useAgentDetail (/agents/[id])",
    detail: true,
    aufruf: "neuLaden",
    lies: (m) => m.useAgentDetail("oracle"),
    neuLesen: (l) => l.neuLaden(),
    stand: (l) => {
      assert.equal(l.messages[0]?.lesung ?? null, l.agent?.lesung ?? null, "Agent und Nachrichten aus demselben Lauf");
      return l.agent?.lesung ?? null;
    },
  },
];

/** Lesungen bisher (Abfragen an agents). useAgentDetail liest je Lauf danach die Nachrichten des Agenten. */
function lesungen(nutzer, db) {
  const agenten = db.an("agents").length;
  assert.equal(db.an("messages").length, nutzer.detail ? agenten : 0, "je Lauf: Agent und Nachrichten (Detail) bzw. nur agents");
  return agenten;
}

for (const nutzer of NUTZER) {
  test(`AS-H1 ${nutzer.name}: erste Lesung beim Aufbau auch im verborgenen Tab; im Takt keine Lesung, solange verborgen; beim Zurückkehren sofort eine, deren Antwort gilt; danach wieder im Takt`, GRENZE, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const s = sichtbarkeit("hidden");
    const db = datenbank();
    const { lz, letzte } = baue(nutzer.lies, db);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(lesungen(nutzer, db), 1, "erste Lesung beim Aufbau, auch im verborgenen Tab");
    assert.equal(nutzer.stand(letzte()), 1);
    assert.equal(letzte().loading, false);
    await takte(t, lz, 3);
    assert.equal(lesungen(nutzer, db), 1, "drei Takte im verborgenen Tab ohne Lesung");

    s.setze("visible");
    await lz.ruhe();
    assert.equal(lesungen(nutzer, db), 2, "beim Zurückkehren sofort, ohne auf den Takt zu warten");
    assert.equal(nutzer.stand(letzte()), 2, "die Antwort der Lesung bei der Rückkehr gilt");
    await warte(t, lz, TAKT - 1);
    assert.equal(lesungen(nutzer, db), 2, "vor dem nächsten Takt keine weitere Lesung");
    await warte(t, lz, 1);
    assert.equal(lesungen(nutzer, db), 3, "danach wieder im Takt");
    await takte(t, lz, 1);
    assert.equal(lesungen(nutzer, db), 4, "sichtbar: jeder Takt liest");

    // Wieder verborgen: Der Wechsel selbst liest nicht, der Takt pausiert erneut.
    s.setze("hidden");
    await lz.ruhe();
    assert.equal(lesungen(nutzer, db), 4, "der Wechsel auf verborgen liest nicht");
    await takte(t, lz, 2);
    assert.equal(lesungen(nutzer, db), 4, "zwei weitere Takte verborgen ohne Lesung");
    s.setze("visible");
    await lz.ruhe();
    assert.equal(lesungen(nutzer, db), 5, "auch die zweite Rückkehr liest sofort");
    assert.equal(nutzer.stand(letzte()), 5);
  });

  test(`AS-H2 ${nutzer.name}: Rückkehr zwischen zwei Takten (bei 90 s) liest sofort; der nächste Takt kommt im alten Raster bei 120 s, nicht erst 60 s nach der Rückkehr`, GRENZE, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const s = sichtbarkeit("visible");
    const db = datenbank();
    const { lz, letzte } = baue(nutzer.lies, db);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(lesungen(nutzer, db), 1, "0 s: erste Lesung beim Aufbau");
    await warte(t, lz, TAKT);
    assert.equal(lesungen(nutzer, db), 2, "60 s: Takt");
    await warte(t, lz, 10_000);
    s.setze("hidden");
    await warte(t, lz, 20_000);
    assert.equal(lesungen(nutzer, db), 2, "70 s bis 90 s verborgen: keine Lesung");
    s.setze("visible");
    await lz.ruhe();
    assert.equal(lesungen(nutzer, db), 3, "90 s: Rückkehr, sofort eine Lesung");
    assert.equal(nutzer.stand(letzte()), 3);
    await warte(t, lz, 30_000 - 1);
    assert.equal(lesungen(nutzer, db), 3, "bis 119,999 s keine weitere Lesung");
    await warte(t, lz, 1);
    assert.equal(lesungen(nutzer, db), 4, "120 s: Takt im alten Raster (60 s, 120 s, 180 s …)");
    await warte(t, lz, 30_000);
    assert.equal(lesungen(nutzer, db), 4, "150 s, 60 s nach der Rückkehr: keine Lesung");
    await warte(t, lz, 30_000);
    assert.equal(lesungen(nutzer, db), 5, "180 s: Takt");
  });

  test(`AS-H3 ${nutzer.name}: Der Lauscher bleibt über jeden Wechsel wirksam (document auf echtem EventTarget) — jede Rückkehr liest sofort, kein Wechsel auf verborgen; nach dem Abbau ist er abgemeldet, und weder visibilitychange noch Takt lesen; der Realtime-Kanal bleibt einer wie bisher`, GRENZE, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const s = sichtbarkeit("visible");
    const db = datenbank();
    const { lz } = baue(nutzer.lies, db);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(lesungen(nutzer, db), 1, "erste Lesung beim Aufbau");
    assert.equal(s.angemeldet(), 1, "ein Lauscher auf visibilitychange");
    // Die Uhr steht: Jede weitere Lesung hier kommt aus dem Lauscher, keine aus dem Takt.
    for (let rueckkehr = 1; rueckkehr <= 3; rueckkehr += 1) {
      s.setze("hidden");
      await lz.ruhe();
      assert.equal(lesungen(nutzer, db), rueckkehr, `Wechsel ${rueckkehr} auf verborgen: keine Lesung`);
      s.setze("visible");
      await lz.ruhe();
      assert.equal(lesungen(nutzer, db), rueckkehr + 1, `Rückkehr ${rueckkehr}: sofort eine Lesung`);
    }
    assert.equal(s.angemeldet(), 1, "weiterhin genau ein Lauscher");
    assert.equal(db.kanaele.angelegt, 1, "Realtime: ein Kanal; Wechsel legen keinen an");

    lz.abbauen();
    assert.equal(s.angemeldet(), 0, "Lauscher mit denselben Angaben abgemeldet, mit denen er angemeldet wurde");
    assert.equal(db.kanaele.entfernt, 1, "Realtime-Kanal beim Abbau entfernt wie bisher");
    s.setze("hidden");
    s.setze("visible");
    await takte(t, lz, 3);
    assert.equal(lesungen(nutzer, db), 4, "nach dem Abbau keine Lesung, weder auf visibilitychange noch im Takt");
  });

  test(`AS-H4 ${nutzer.name}: ohne document (Server, Tests ohne DOM) nur der Takt wie bisher — erste Lesung beim Aufbau, dann jeder Takt; nach dem Abbau keiner`, GRENZE, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    assert.equal(typeof globalThis.document, "undefined", "Testvoraussetzung: kein document");
    const db = datenbank();
    const { lz, letzte } = baue(nutzer.lies, db);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(lesungen(nutzer, db), 1, "erste Lesung beim Aufbau");
    await warte(t, lz, TAKT - 1);
    assert.equal(lesungen(nutzer, db), 1);
    await warte(t, lz, 1);
    assert.equal(lesungen(nutzer, db), 2, "nach einem Takt");
    await takte(t, lz, 3);
    assert.equal(lesungen(nutzer, db), 5, "jeder Takt liest");
    assert.equal(nutzer.stand(letzte()), 5);
    lz.abbauen();
    await takte(t, lz, 3);
    assert.equal(lesungen(nutzer, db), 5, "nach dem Abbau kein Takt");
  });

  test(`AS-H6 ${nutzer.name}: ${nutzer.aufruf} bleibt unverändert — auch im verborgenen Tab liest der Aufruf sofort, und seine Antwort gilt`, GRENZE, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    sichtbarkeit("hidden");
    const db = datenbank();
    const { lz, letzte } = baue(nutzer.lies, db);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(lesungen(nutzer, db), 1, "erste Lesung beim Aufbau");
    await nutzer.neuLesen(letzte());
    await lz.ruhe();
    assert.equal(lesungen(nutzer, db), 2, `${nutzer.aufruf} liest sofort, auch im verborgenen Tab`);
    assert.equal(nutzer.stand(letzte()), 2, "seine Antwort gilt");
  });
}

test("AS-H5 useAgentDetail mit abfragbar = false (ausgeblendeter Agent, ungültige Kennung): kein Lauscher, kein Takt, keine Abfrage, kein Realtime-Kanal — auch nicht bei visibilitychange", GRENZE, async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  for (const id of ["trader", "../agents"]) {
    const s = sichtbarkeit("visible");
    const db = datenbank();
    const { lz, gelesen, letzte } = baue((m) => m.useAgentDetail(id), db);
    lz.rendere();
    await warte(t, lz, 0);
    assert.equal(letzte().abfragbar, false, id);
    assert.equal(letzte().loading, false, id);
    assert.equal(s.anmeldungen(), 0, `${id}: kein Lauscher angemeldet`);
    const darstellungen = gelesen.length;
    s.setze("hidden");
    s.setze("visible");
    await takte(t, lz, 3);
    // Ein Takt oder Lauscher erhöhte den Ladezähler; jede Erhöhung wäre eine neue Darstellung.
    assert.equal(gelesen.length, darstellungen, `${id}: weder Takt noch Lauscher — keine neue Darstellung`);
    assert.equal(db.abfragen.length, 0, `${id}: keine Abfrage`);
    assert.equal(db.kanaele.angelegt, 0, `${id}: kein Realtime-Kanal`);
    lz.abbauen();
  }
});

// ═══ Überlappende Lesungen ═══

test("AS-U1 useAgents: Überlappende Lesungen im Takt — kommt die Antwort einer älteren Lesung nach der einer neueren an, bleibt die neuere stehen (Daten und Fehler); vorher überschrieb die ältere sie", GRENZE, async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  sichtbarkeit("visible");
  const db = datenbank({ sofort: false });
  const { lz, letzte } = baue((m) => m.useAgents(), db);
  lz.rendere();
  await lz.ruhe();
  db.an("agents")[0].antworte();
  await lz.ruhe();
  assert.equal(letzte().agents[0].lesung, 1);

  await warte(t, lz, TAKT); // 60 s: Lesung 2, ihre Antwort lässt auf sich warten
  await warte(t, lz, TAKT); // 120 s: Lesung 3
  const [, zwei, drei] = db.an("agents");
  assert.ok(zwei.offen && drei.offen, "zwei Lesungen gleichzeitig offen");
  drei.antworte();
  await lz.ruhe();
  assert.equal(letzte().agents[0].lesung, 3, "die neuere Antwort gilt");
  zwei.antworte();
  await lz.ruhe();
  assert.equal(letzte().agents[0].lesung, 3, "die ältere Antwort kommt später an und überschreibt die neuere nicht");

  await warte(t, lz, TAKT); // 180 s: Lesung 4
  await warte(t, lz, TAKT); // 240 s: Lesung 5
  const [, , , vier, fuenf] = db.an("agents");
  fuenf.antworte();
  await lz.ruhe();
  vier.scheitere();
  await lz.ruhe();
  assert.equal(letzte().error, null, "ein Lesefehler der älteren Lesung überschreibt die neuere nicht");
  assert.equal(letzte().agents[0].lesung, 5);
  assert.equal(letzte().loading, false);
});

test("AS-U2 useAgents: Rückkehr kurz vor dem Takt startet zwei Lesungen; es gilt nur die zuletzt gestartete, gleich in welcher Reihenfolge die Antworten ankommen", GRENZE, async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const s = sichtbarkeit("visible");
  const db = datenbank({ sofort: false });
  const { lz, letzte } = baue((m) => m.useAgents(), db);
  lz.rendere();
  await lz.ruhe();
  db.an("agents")[0].antworte();
  await lz.ruhe();

  // Rückkehr bei 59,5 s, Takt bei 60 s; die Antwort des Takts kommt zuerst.
  await warte(t, lz, 10_000);
  s.setze("hidden");
  await warte(t, lz, 49_500);
  s.setze("visible");
  await warte(t, lz, 500);
  assert.equal(db.an("agents").length, 3, "Rückkehr und Takt: zwei Lesungen");
  let [, rueckkehr, takt] = db.an("agents");
  assert.ok(rueckkehr.offen && takt.offen, "beide offen");
  takt.antworte();
  await lz.ruhe();
  assert.equal(letzte().agents[0].lesung, 3);
  rueckkehr.antworte();
  await lz.ruhe();
  assert.equal(letzte().agents[0].lesung, 3, "die ältere Antwort (Rückkehr) überschreibt die des Takts nicht");

  // Dasselbe bei 119,5 s und 120 s; die Antworten kommen in der Reihenfolge des Starts.
  await warte(t, lz, 10_000);
  s.setze("hidden");
  await warte(t, lz, 49_500);
  s.setze("visible");
  await warte(t, lz, 500);
  assert.equal(db.an("agents").length, 5, "Rückkehr und Takt: zwei weitere Lesungen");
  [, , , rueckkehr, takt] = db.an("agents");
  rueckkehr.antworte();
  await lz.ruhe();
  assert.equal(letzte().agents[0].lesung, 3, "läuft schon eine jüngere Lesung, gilt die ältere Antwort nicht (wie R29)");
  takt.antworte();
  await lz.ruhe();
  assert.equal(letzte().agents[0].lesung, 5, "die Antwort der jüngsten Lesung gilt");
  assert.equal(letzte().error, null);
  assert.equal(letzte().loading, false);
});

test("AS-U3 useAgents: Fehlerverhalten wie bisher, auch bei der Lesung nach der Rückkehr — die zuletzt gelesene Liste bleibt stehen und error ist gesetzt; die nächste erfolgreiche Lesung im Takt löscht ihn", GRENZE, async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const s = sichtbarkeit("hidden");
  const db = datenbank({ sofort: false });
  const { lz, letzte } = baue((m) => m.useAgents(), db);
  lz.rendere();
  await lz.ruhe();
  db.an("agents")[0].antworte();
  await lz.ruhe();
  assert.equal(letzte().agents[0].lesung, 1);
  await takte(t, lz, 2); // 120 s, verborgen
  s.setze("visible");
  await lz.ruhe();
  assert.equal(db.an("agents").length, 2, "verborgen keine Lesung im Takt; Rückkehr: sofort eine");
  db.an("agents")[1].scheitere();
  await lz.ruhe();
  assert.equal(letzte().error, LESEFEHLER, "Lesefehler sichtbar");
  assert.equal(letzte().agents[0].lesung, 1, "die zuletzt gelesene Liste bleibt stehen");
  assert.equal(letzte().ausgeblendet, 1);
  assert.equal(letzte().loading, false);
  await takte(t, lz, 1); // 180 s
  db.an("agents")[2].antworte();
  await lz.ruhe();
  assert.equal(letzte().error, null, "die nächste erfolgreiche Lesung löscht den Fehler");
  assert.equal(letzte().agents[0].lesung, 3);
});

test("AS-U4 useAgentDetail: Rückkehr kurz vor dem Takt startet zwei Läufe; der ältere wird verworfen (Effekt-Bereinigung), auch wenn seine Antwort zuletzt ankommt — und liest danach keine Nachrichten mehr", GRENZE, async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const s = sichtbarkeit("visible");
  const db = datenbank({ sofort: false });
  const { lz, letzte } = baue((m) => m.useAgentDetail("oracle"), db);
  lz.rendere();
  await lz.ruhe();
  db.an("agents")[0].antworte();
  await lz.ruhe();
  db.an("messages")[0].antworte();
  await lz.ruhe();
  assert.equal(letzte().agent.lesung, 1);
  assert.equal(letzte().messages[0].lesung, 1);

  // Rückkehr bei 59,5 s, Takt bei 60 s.
  await warte(t, lz, 10_000);
  s.setze("hidden");
  await warte(t, lz, 49_500);
  s.setze("visible");
  await lz.ruhe();
  await warte(t, lz, 500);
  assert.equal(db.an("agents").length, 3, "Rückkehr und Takt: zwei Läufe");
  const [, aelter, neuer] = db.an("agents");
  neuer.antworte();
  await lz.ruhe();
  assert.equal(db.an("messages").length, 2, "der neuere Lauf liest danach die Nachrichten");
  db.an("messages")[1].antworte();
  await lz.ruhe();
  assert.equal(letzte().agent.lesung, 3);
  assert.equal(letzte().messages[0].lesung, 2);
  aelter.antworte();
  await lz.ruhe();
  assert.equal(letzte().agent.lesung, 3, "die spätere Antwort des älteren Laufs wird verworfen");
  assert.equal(db.an("messages").length, 2, "der ältere Lauf liest keine Nachrichten mehr");
  assert.equal(letzte().agentFehler, null);
  assert.equal(letzte().loading, false);
});
