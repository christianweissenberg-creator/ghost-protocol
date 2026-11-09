// Objekt-Studio Schritt 3, Änderungsprobe (09.11.2026): GET /api/content/liste fragt vor der vollen Abfrage
// nur id und updated_at derselben Zeilen ab und antwortet bei gleicher Kennung mit dem Zwischenstand
// ihrer letzten vollen Abfrage (lib/content-liste-cache.ts). Lauf: npm test.
//
// Die Route läuft im Prozess gegen die PostgREST-Attrappe aus tests/harness/fake.mjs; Zeiten stellen die
// Attrappen-Uhren von node:test (Date). Gezählt werden die Supabase-Anfragen je Listen-Anfrage
// (welt.log): Probe und volle Abfrage unterscheiden sich an der Spaltenliste. Änderungen an der Tabelle
// spielt der Test direkt in der Attrappe nach; ein UPDATE setzt updated_at neu wie der Trigger
// content_updated_at (scripts/setup_supabase_v2.sql:339-342).
// Zeitlimits (AbortSignal.timeout) laufen in R7-P12 auf derselben Attrappen-Uhr; gleichzeitige Anfragen
// (R7-P13 bis R7-P15) halten an Toren in welt.vorAntwort.
// Mutationsprüfung (R7-M1 bis R7-M4, 09.11.2026): Höchstdauer nach einer erkannten Änderung, Header
// x-content-abfrage nur bei 200, leere Liste.
// Kein Netz: Jeder Abruf geht an die Attrappe oder wirft. Die Umgebungswerte unten sind Test-Werte dieses
// Prozesses, keine echten Schlüssel. Jeder Test beginnt ohne Zwischenstand. Module werden je Test
// geladen: Fehlt eines (Stand vor der Änderungsprobe), scheitert der einzelne Test, nicht die Datei.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wie tests/r-content-server.test.mjs: "@/…" → src/….ts, "next/server" → node_modules, relative Importe
// ohne Endung aus .ts → ".ts", "server-only" → die leere Fassung, die Next.js im Server-Bundle nimmt.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/server.js")).href, context);
    if (specifier === "server-only") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/dist/compiled/server-only/empty.js")).href, context);
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const SERVICE = "service-test-key-1234567890abcdef";
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key-0000000000",
  SUPABASE_SERVICE_KEY: SERVICE,
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
  GP_SESSION_SECRET: "session-test-secret-0123456789",
});

const fake = await import("./harness/fake.mjs");
const { welt, legeAn, zuruecksetzen } = fake;
fake.installiere();
const FAKE_FETCH = globalThis.fetch;
const { NextRequest } = await import("next/server");

const modulCache = new Map();
/** Modul je Test laden (gecacht); fehlt es, scheitert nur der Test, der es braucht. */
async function ladeModul(rel) {
  const datei = path.join(SITE, rel);
  if (!modulCache.has(datei)) modulCache.set(datei, await import(pathToFileURL(datei).href));
  return modulCache.get(datei);
}
const listeRoute = () => ladeModul("src/app/api/content/liste/route.ts");
const zwischenspeicher = () => ladeModul("src/lib/content-liste-cache.ts");

beforeEach(async () => {
  zuruecksetzen();
  process.env.SUPABASE_SERVICE_KEY = SERVICE;
  globalThis.fetch = FAKE_FETCH;
  const speicher = await zwischenspeicher().catch(() => null);
  speicher?.setzeContentListeZurueck();
});

// ═══ Hilfen ═══

/** Abfragen, wie die Attrappe sie protokolliert (decodeURIComponent der Query). */
const PROBE = "select=id,updated_at&order=created_at.desc&limit=50";
const VOLL = "select=*&order=created_at.desc&limit=50";
const istProbe = (a) => a.art === "supabase" && a.tabelle === "content" && a.params.get("select") === "id,updated_at";
const istVoll = (a) => a.art === "supabase" && a.tabelle === "content" && a.params.get("select") === "*";

/** Supabase-Anfragen seit dem letzten Aufruf als "probe" / "voll" (alles andere wörtlich); leert das Protokoll. */
function anfragen() {
  const arten = welt.log.map((l) =>
    l.methode === "GET" && l.tabelle === "content" && l.query === PROBE ? "probe" : l.methode === "GET" && l.tabelle === "content" && l.query === VOLL ? "voll" : `${l.methode} ${l.tabelle} ${l.query}`,
  );
  welt.log.length = 0;
  return arten;
}

const T0 = Date.parse("2026-11-09T08:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
/** Erstellzeit der Testzeile i: i Minuten nach dem 01.11.2026, 08:00 UTC — größere i sind neuer. */
const am = (i) => iso(Date.UTC(2026, 10, 1, 8) + i * 60_000);

/** content-Zeile mit Postgres-Defaults (fake.legeAn); created_at bestimmt die Reihenfolge der Liste. */
function zeileDb(id, erstellt = am(id)) {
  return legeAn({ id, title: `Lauf ${id}`, content_type: "thread", platform: "x", status: "zur_freigabe", body: `Text ${id}`, created_at: erstellt, updated_at: erstellt });
}

/** UPDATE wie in Postgres: Felder setzen; updated_at setzt der Trigger content_updated_at neu. */
function aktualisiere(id, felder) {
  const zeile = fake.zeile(id);
  Object.assign(zeile, felder);
  zeile.updated_at = fake.zeitstempel();
}

function loesche(id) {
  const i = welt.content.findIndex((z) => z.id === id);
  assert.ok(i >= 0, `Zeile ${id} fehlt`);
  welt.content.splice(i, 1);
}

/** Was die volle Abfrage jetzt liefern muss: die 50 neuesten Zeilen nach created_at, alle Spalten. */
function tabelle() {
  return welt.content
    .slice()
    .sort((a, b) => fake.mikrosekunden(b.created_at) - fake.mikrosekunden(a.created_at))
    .slice(0, 50)
    .map((z) => JSON.parse(JSON.stringify(z)));
}

async function holeListe(anfrage) {
  const { GET } = await listeRoute();
  const res = await GET(anfrage);
  return { status: res.status, kopf: res.headers, body: await res.json() };
}

const abbruch = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

/**
 * Zeitlimits auf der Attrappen-Uhr (Date von node:test): AbortSignal.timeout(ms) liefert ein Signal mit der
 * Frist jetzt + ms. Die zurückgegebene Funktion dauert(a, ms) lässt die Supabase-Abfrage a ms brauchen:
 * Läuft ihr Signal vorher ab, steht die Uhr danach auf der Frist und die Abfrage endet mit dem Abbruch —
 * wie fetch, das dann mit signal.reason ablehnt; sonst steht die Uhr ms weiter.
 */
function zeitlimitsAufAttrappenUhr(t) {
  const fristen = new Map();
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const steuerung = new AbortController();
    fristen.set(steuerung.signal, { bis: Date.now() + ms, steuerung });
    return steuerung.signal;
  });
  return async function dauert(a, ms) {
    const frist = fristen.get(a.signal);
    if (!frist) throw new Error(`Abfrage ohne Zeitlimit: ${a.url.search}`);
    if (frist.bis <= Date.now() + ms) {
      t.mock.timers.tick(Math.max(0, frist.bis - Date.now()));
      if (!frist.steuerung.signal.aborted) frist.steuerung.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      throw a.signal.reason;
    }
    t.mock.timers.tick(ms);
  };
}

/** Tor für welt.vorAntwort: warte() hält die Abfrage an, bis oeffnen(); angekommen erfüllt sich, sobald sie dort steht. */
function tor() {
  let oeffnen;
  let ankommen;
  const offen = new Promise((r) => (oeffnen = r));
  const angekommen = new Promise((r) => (ankommen = r));
  return {
    angekommen,
    oeffnen: () => oeffnen(),
    async warte() {
      ankommen();
      await offen;
    },
  };
}

/** Wartet, bis die Listen-Anfrage am Tor steht. Endet sie vorher (sie stellt die erwartete Abfrage nicht), scheitert der Test, statt zu hängen. */
async function bisAmTor(torX, anfrage) {
  const ende = anfrage.then(
    () => "beendet",
    () => "beendet",
  );
  const was = await Promise.race([torX.angekommen.then(() => "am Tor"), ende]);
  assert.equal(was, "am Tor", "Die Anfrage endete, ohne das Tor zu erreichen");
}

/** Probe auf einem Schnappschuss: id und updated_at der Zeilen, die eine Probe jetzt läse. */
const probeSicht = () => tabelle().map((z) => ({ id: z.id, updated_at: z.updated_at }));

// ═══ Tests ═══

test("R7-P1 Probe: select=id%2Cupdated_at, created_at absteigend, Grenze 50, Service-Schlüssel; volle Abfrage exakt wie bisher; jede Supabase-Abfrage mit eigenem Abbruchsignal von 8 s — auch Probe und volle Abfrage derselben Anfrage", async (t) => {
  const { ABFRAGE_TIMEOUT_MS } = await ladeModul("src/lib/status-server.ts");
  for (const id of [1, 2, 3]) zeileDb(id);
  const erzeugt = new Map();
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const signal = original.call(AbortSignal, ms);
    erzeugt.set(signal, ms);
    return signal;
  });
  const gesehen = [];
  welt.vorAntwort = async (a) => {
    if (a.art === "supabase") gesehen.push(a);
  };
  assert.equal((await holeListe()).status, 200, "1. Anfrage: kein Zwischenstand");
  assert.equal((await holeListe()).status, 200, "2. Anfrage: nichts geändert");
  aktualisiere(2, { status: "freigegeben" });
  assert.equal((await holeListe()).status, 200, "3. Anfrage: Zeile 2 geändert");
  // Die Form, die supabase-js wirklich sendet (Rohform der URL; das Komma der Spaltenliste kodiert).
  assert.deepEqual(
    gesehen.map((a) => [a.methode, a.tabelle, a.url.search, a.kopf.get("apikey") === SERVICE ? "service" : a.kopf.get("apikey")]),
    [
      ["GET", "content", "?select=*&order=created_at.desc&limit=50", "service"],
      ["GET", "content", "?select=id%2Cupdated_at&order=created_at.desc&limit=50", "service"],
      ["GET", "content", "?select=id%2Cupdated_at&order=created_at.desc&limit=50", "service"],
      ["GET", "content", "?select=*&order=created_at.desc&limit=50", "service"],
    ],
  );
  for (const a of gesehen) assert.equal(erzeugt.get(a.signal), ABFRAGE_TIMEOUT_MS, a.url.search);
  // Ein gemeinsames Signal ließe der vollen Abfrage nach der Probe nur den Rest der 8 s (R7-P12).
  assert.notEqual(gesehen[2].signal, gesehen[3].signal, "Probe und volle Abfrage einer Anfrage: je ein eigenes Signal");
  assert.notEqual(gesehen[1].signal, gesehen[2].signal, "jede Anfrage ihr eigenes Signal");
  assert.equal(new Set(gesehen.map((a) => a.signal)).size, 4, "ein Signal je Supabase-Abfrage");
  assert.equal(erzeugt.size, 4, "kein Signal ohne Abfrage");
});

test("R7-P2 Erste Anfrage nur voll, die nächste ohne Änderung nur die Probe — gleiche Zeilen, neuer gelesen_am, Header unveraendert, auch für eine andere Sitzung; 120 Takte in 29:45 min: genau eine volle Abfrage", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  for (let i = 1; i <= 12; i++) zeileDb(i);
  const erste = await holeListe();
  assert.equal(erste.status, 200);
  assert.deepEqual(anfragen(), ["voll"]);
  assert.equal(erste.kopf.get("x-content-abfrage"), "voll");
  assert.equal(erste.kopf.get("cache-control"), "no-store");
  assert.deepEqual(erste.body.zeilen, tabelle());
  assert.equal(erste.body.gelesen_am, iso(T0));

  t.mock.timers.tick(15_000);
  // Eine andere Sitzung (anderes Cookie): Die Liste ist für alle gleich, der Zwischenstand gilt auch für sie.
  const zweite = await holeListe(new NextRequest("http://harness.local/api/content/liste", { headers: { cookie: "gp-auth=andere-sitzung" } }));
  assert.equal(zweite.status, 200);
  assert.deepEqual(anfragen(), ["probe"], "nur die Probe");
  assert.equal(zweite.kopf.get("x-content-abfrage"), "unveraendert");
  assert.equal(zweite.kopf.get("cache-control"), "no-store");
  assert.deepEqual(zweite.body.zeilen, erste.body.zeilen);
  assert.equal(zweite.body.gelesen_am, iso(T0 + 15_000), "gelesen_am nach der Probe, nicht der Zeitpunkt der vollen Abfrage");
  const ohneZeit = (body) => {
    const rest = { ...body };
    delete rest.gelesen_am;
    return rest;
  };
  assert.deepEqual(ohneZeit(zweite.body), ohneZeit(erste.body), "grenze, abgeschnitten und quelle wie bei der vollen Abfrage");

  const arten = [];
  for (let takt = 2; takt < 120; takt++) {
    t.mock.timers.tick(15_000);
    const r = await holeListe();
    assert.equal(r.status, 200, `Takt ${takt}`);
    assert.equal(r.kopf.get("x-content-abfrage"), "unveraendert", `Takt ${takt}`);
    assert.deepEqual(r.body.zeilen, erste.body.zeilen, `Takt ${takt}`);
    assert.equal(r.body.gelesen_am, iso(T0 + takt * 15_000), `Takt ${takt}`);
    arten.push(...anfragen());
  }
  assert.equal(Date.now() - T0, 29 * 60_000 + 45_000);
  assert.deepEqual(arten, Array(118).fill("probe"), "120 Anfragen: eine volle Abfrage, 119 Proben");
});

test("R7-P3 Änderungen werden erkannt — UPDATE (neues updated_at), INSERT, DELETE, geänderte Reihenfolge: je Probe und volle Abfrage, die neuen Zeilen in der Antwort, danach wieder nur die Probe; eine Änderung außerhalb der 50 neuesten ändert die Liste nicht", async () => {
  const faelle = [
    ["UPDATE", () => aktualisiere(3, { status: "freigegeben", review_notes: "geändert" })],
    ["UPDATE nur updated_at", () => aktualisiere(5, {})],
    ["INSERT", () => zeileDb(9)],
    ["DELETE", () => loesche(2)],
    [
      "Reihenfolge (created_at getauscht, updated_at unverändert)",
      () => {
        const [a, b] = [fake.zeile(1), fake.zeile(4)];
        [a.created_at, b.created_at] = [b.created_at, a.created_at];
      },
    ],
  ];
  const { setzeContentListeZurueck } = (await zwischenspeicher().catch(() => null)) ?? {};
  for (const [name, aendere] of faelle) {
    zuruecksetzen();
    setzeContentListeZurueck?.();
    for (let i = 1; i <= 5; i++) zeileDb(i);
    await holeListe();
    assert.deepEqual(anfragen(), ["voll"], name);
    await holeListe();
    assert.deepEqual(anfragen(), ["probe"], `${name}: vorher nichts geändert`);
    const vorher = tabelle();
    aendere();
    const nachher = tabelle();
    assert.notDeepEqual(nachher, vorher, `${name}: Testvoraussetzung — die Tabelle hat sich geändert`);
    const r = await holeListe();
    assert.equal(r.status, 200, name);
    assert.deepEqual(anfragen(), ["probe", "voll"], name);
    assert.equal(r.kopf.get("x-content-abfrage"), "voll", name);
    assert.deepEqual(r.body.zeilen, nachher, name);
    const danach = await holeListe();
    assert.deepEqual(anfragen(), ["probe"], `${name}: Zwischenstand ersetzt`);
    assert.equal(danach.kopf.get("x-content-abfrage"), "unveraendert", name);
    assert.deepEqual(danach.body.zeilen, nachher, name);
  }
  // Gegenkontrolle: 55 Zeilen, geändert wird die älteste — sie steht nicht in der Liste der 50 neuesten.
  zuruecksetzen();
  setzeContentListeZurueck?.();
  for (let i = 1; i <= 55; i++) zeileDb(i);
  const erste = await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  assert.equal(erste.body.abgeschnitten, true);
  aktualisiere(1, { status: "abgelehnt" });
  const r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "Liste unverändert: keine volle Abfrage");
  assert.deepEqual(r.body.zeilen, tabelle());
  assert.deepEqual(r.body.zeilen, erste.body.zeilen);
  assert.equal(r.body.abgeschnitten, true);
});

test("R7-P4 Höchstdauer 30 min ab Beginn der vollen Abfrage: knapp darunter nur die Probe, ab 30 min voll — auch ohne Änderung; Uhr zurückgestellt: voll", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  for (let i = 1; i <= 3; i++) zeileDb(i);
  // Jede volle Abfrage dauert 4 s; die 30 min zählen ab ihrem Beginn.
  welt.vorAntwort = async (a) => {
    if (istVoll(a)) t.mock.timers.tick(4_000);
  };
  const MIN30 = 30 * 60_000;
  const erste = await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  assert.equal(erste.body.gelesen_am, iso(T0 + 4_000));

  t.mock.timers.setTime(T0 + MIN30 - 1);
  let r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "29:59,999 min nach Beginn der vollen Abfrage: nur die Probe");
  assert.equal(r.kopf.get("x-content-abfrage"), "unveraendert");

  t.mock.timers.tick(1);
  r = await holeListe();
  assert.deepEqual(anfragen(), ["voll"], "30 min: voll, ohne Probe — auch ohne Änderung");
  assert.equal(r.kopf.get("x-content-abfrage"), "voll");
  assert.deepEqual(r.body.zeilen, erste.body.zeilen);

  // Die Frist beginnt mit der neuen vollen Abfrage (T0 + 30 min) neu.
  t.mock.timers.setTime(T0 + 2 * MIN30 - 1);
  r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"]);

  // Uhr zurückgestellt (vor den Beginn der letzten vollen Abfrage): Alter unbestimmbar → voll.
  t.mock.timers.setTime(T0 + MIN30 - 1);
  r = await holeListe();
  assert.deepEqual(anfragen(), ["voll"], "Uhr zurückgestellt");
  t.mock.timers.tick(15_000);
  r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "danach wieder im Takt nur die Probe");

  const { CONTENT_VOLL_SPAETESTENS_MS } = await zwischenspeicher();
  assert.equal(CONTENT_VOLL_SPAETESTENS_MS, MIN30);
});

test("R7-P5 Probe scheitert — Lesefehler, Zeitüberschreitung, Antwort ohne Liste, Zeile ohne id oder updated_at: 502 supabase ohne Zeilen, ohne Header und ohne volle Abfrage; der Zwischenstand bleibt", async () => {
  for (let i = 1; i <= 3; i++) zeileDb(i);
  const erste = await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  const antwort = (status, body) => ({ stoerung: (a) => (istProbe(a) ? { status, body } : null) });
  const zeit = "2026-11-01T08:01:00.000000+00:00";
  const OHNE_LISTE = "Änderungsprobe: Antwort ohne Zeilenliste";
  const OHNE_ID = "Änderungsprobe: Zeile ohne id oder updated_at";
  const faelle = [
    ["Lesefehler", antwort(500, { code: "XX000", message: `kaputt: ${SERVICE} bei https://abc.supabase.co/rest/v1/content` }), "kaputt: [entfernt] bei [URL]"],
    ["kein Recht", antwort(401, { code: "42501", message: "permission denied for table content" }), "permission denied for table content"],
    [
      "Zeitüberschreitung",
      {
        vorAntwort: async (a) => {
          if (istProbe(a)) throw abbruch();
        },
      },
      "Zeitüberschreitung (8 s)",
    ],
    ["Objekt statt Liste", antwort(200, { zeilen: [] }), OHNE_LISTE],
    ["null statt Liste", antwort(200, null), OHNE_LISTE],
    ["Zeile ohne id", antwort(200, [{ updated_at: zeit }]), OHNE_ID],
    ["id null", antwort(200, [{ id: 1, updated_at: zeit }, { id: null, updated_at: zeit }]), OHNE_ID],
    ["id leer", antwort(200, [{ id: "", updated_at: zeit }]), OHNE_ID],
    ["Zeile ohne updated_at", antwort(200, [{ id: 1 }]), OHNE_ID],
    ["updated_at keine Zeichenkette", antwort(200, [{ id: 1, updated_at: 5 }]), OHNE_ID],
    ["Zeile kein Objekt", antwort(200, [3]), OHNE_ID],
  ];
  for (const [name, stoerung, grund] of faelle) {
    welt.stoerung = stoerung.stoerung ?? null;
    welt.vorAntwort = stoerung.vorAntwort ?? null;
    const r = await holeListe();
    assert.equal(r.status, 502, name);
    assert.deepEqual(r.body, { fehler: grund, fehler_art: "supabase" }, `${name}: Fehler ohne Zeilen`);
    assert.equal(r.kopf.get("cache-control"), "no-store", name);
    assert.equal(r.kopf.get("x-content-abfrage"), null, name);
    assert.deepEqual(anfragen(), ["probe"], `${name}: keine volle Abfrage`);
  }
  welt.stoerung = null;
  welt.vorAntwort = null;
  const danach = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "Zwischenstand noch da");
  assert.equal(danach.kopf.get("x-content-abfrage"), "unveraendert");
  assert.deepEqual(danach.body.zeilen, erste.body.zeilen);
});

test("R7-P6 Volle Abfrage scheitert nach geänderter Probe: 502 wie bisher, der Zwischenstand bleibt derselbe; die nächste Anfrage liest wieder Probe und voll und liefert die neuen Zeilen", async () => {
  for (let i = 1; i <= 3; i++) zeileDb(i);
  const erste = await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  const speicher = await zwischenspeicher().catch(() => null);
  const stand = speicher?.gueltigerContentStand(Date.now());
  aktualisiere(2, { status: "abgelehnt" });
  const faelle = [
    ["Lesefehler", { stoerung: (a) => (istVoll(a) ? { status: 500, body: { code: "XX000", message: "kaputt" } } : null) }, "kaputt"],
    [
      "Zeitüberschreitung",
      {
        vorAntwort: async (a) => {
          if (istVoll(a)) throw abbruch();
        },
      },
      "Zeitüberschreitung (8 s)",
    ],
    ["Objekt statt Liste", { stoerung: (a) => (istVoll(a) ? { status: 200, body: { id: 1 } } : null) }, "Antwort ohne Zeilenliste"],
  ];
  for (const [name, stoerung, grund] of faelle) {
    welt.stoerung = stoerung.stoerung ?? null;
    welt.vorAntwort = stoerung.vorAntwort ?? null;
    const r = await holeListe();
    assert.equal(r.status, 502, name);
    assert.deepEqual(r.body, { fehler: grund, fehler_art: "supabase" }, name);
    assert.equal(r.kopf.get("cache-control"), "no-store", name);
    assert.deepEqual(anfragen(), ["probe", "voll"], name);
    assert.ok(speicher, "lib/content-liste-cache.ts fehlt");
    assert.ok(stand, "Zwischenstand nach der ersten Anfrage");
    assert.equal(speicher.gueltigerContentStand(Date.now()), stand, `${name}: derselbe Zwischenstand, nicht ersetzt, nicht geleert`);
  }
  welt.stoerung = null;
  welt.vorAntwort = null;
  const r = await holeListe();
  assert.equal(r.status, 200);
  assert.deepEqual(anfragen(), ["probe", "voll"], "wieder voll gelesen, nicht der alte Zwischenstand");
  assert.equal(r.kopf.get("x-content-abfrage"), "voll");
  assert.deepEqual(r.body.zeilen, tabelle());
  assert.notDeepEqual(r.body.zeilen, erste.body.zeilen);
  await holeListe();
  assert.deepEqual(anfragen(), ["probe"]);
});

test("R7-P7 Wettlauf: Ändert sich zwischen Probe und voller Abfrage noch etwas, trägt der Zwischenstand die Kennung der vollen Zeilen — die nächste Anfrage ohne weitere Änderung liest nur die Probe", async () => {
  for (let i = 1; i <= 4; i++) zeileDb(i);
  await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  aktualisiere(1, { status: "freigegeben" });
  let einmal = true;
  welt.vorAntwort = async (a) => {
    if (einmal && istVoll(a)) {
      einmal = false;
      aktualisiere(3, { review_notes: "zwischen Probe und voller Abfrage geändert" });
    }
  };
  const r = await holeListe();
  assert.deepEqual(anfragen(), ["probe", "voll"]);
  assert.deepEqual(r.body.zeilen, tabelle(), "die vollen Zeilen tragen beide Änderungen");
  welt.vorAntwort = null;
  const danach = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "Kennung des Zwischenstands = Kennung der vollen Zeilen");
  assert.equal(danach.kopf.get("x-content-abfrage"), "unveraendert");
  assert.deepEqual(danach.body.zeilen, r.body.zeilen);
  const { gueltigerContentStand, contentKennung } = await zwischenspeicher();
  assert.equal(gueltigerContentStand(Date.now()).kennung, contentKennung(r.body.zeilen));
});

test("R7-P8 gelesen_am ist der Zeitpunkt nach der letzten Supabase-Abfrage der Anfrage — nach der Probe, wenn nur sie lief, sonst nach der vollen Abfrage", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  for (let i = 1; i <= 2; i++) zeileDb(i);
  // Die Probe dauert 2 s, die volle Abfrage 3 s.
  welt.vorAntwort = async (a) => {
    if (istProbe(a)) t.mock.timers.tick(2_000);
    if (istVoll(a)) t.mock.timers.tick(3_000);
  };
  let r = await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  assert.equal(r.body.gelesen_am, iso(T0 + 3_000));
  r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"]);
  assert.equal(r.body.gelesen_am, iso(T0 + 5_000), "nach der Probe");
  aktualisiere(1, { status: "freigegeben" });
  r = await holeListe();
  assert.deepEqual(anfragen(), ["probe", "voll"]);
  assert.equal(r.body.gelesen_am, iso(T0 + 10_000), "nach der vollen Abfrage, nicht nach der Probe");
});

test("R7-P9 Mit Zwischenstand: fehlender Schlüssel → 500 konfiguration ohne Abfrage, unerwartete Ausnahme → 500 programmfehler — beide ohne Zeilen; danach gilt der Zwischenstand weiter", async (t) => {
  for (let i = 1; i <= 2; i++) zeileDb(i);
  const erste = await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "Zwischenstand vorhanden");
  delete process.env.SUPABASE_SERVICE_KEY;
  let r = await holeListe();
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { fehler: "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration" });
  assert.equal(r.kopf.get("cache-control"), "no-store");
  assert.deepEqual(anfragen(), [], "Supabase nicht abgefragt");
  process.env.SUPABASE_SERVICE_KEY = SERVICE;
  const zeitlimit = t.mock.method(AbortSignal, "timeout", () => {
    throw new Error("unerwartet");
  });
  r = await holeListe();
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { fehler: "Content-Liste nicht ermittelbar: unerwartet", fehler_art: "programmfehler" });
  assert.deepEqual(anfragen(), []);
  zeitlimit.mock.restore();
  r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"]);
  assert.equal(r.kopf.get("x-content-abfrage"), "unveraendert");
  assert.deepEqual(r.body.zeilen, erste.body.zeilen);
});

test("R7-P10 Volle Zeilen ohne lesbare Kennung (Zeile ohne id): Antwort wie bisher, aber kein Zwischenstand — auch ein älterer gilt nicht mehr; die nächste Anfrage liest wieder nur voll", async () => {
  for (let i = 1; i <= 2; i++) zeileDb(i);
  await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  aktualisiere(1, { status: "freigegeben" });
  // Kann bei content nicht vorkommen (id ist der Primärschlüssel); die Attrappe liefert sie trotzdem.
  const OHNE_ID = [{ title: "ohne id", updated_at: "2026-11-01T08:01:00.000000+00:00" }];
  welt.stoerung = (a) => (istVoll(a) ? { status: 200, body: OHNE_ID } : null);
  let r = await holeListe();
  assert.equal(r.status, 200);
  assert.deepEqual(anfragen(), ["probe", "voll"]);
  assert.equal(r.kopf.get("x-content-abfrage"), "voll");
  assert.deepEqual(r.body.zeilen, OHNE_ID, "die Zeilen der vollen Abfrage, wie bisher");
  r = await holeListe();
  assert.deepEqual(anfragen(), ["voll"], "ohne Zwischenstand keine Probe");
  welt.stoerung = null;
  r = await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  assert.deepEqual(r.body.zeilen, tabelle());
  await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "wieder ein Zwischenstand");
});

test("R7-P11 Kennung und Zwischenstand (lib/content-liste-cache.ts): Reihenfolge, Anzahl und updated_at zählen, andere Spalten nicht; unlesbare Zeilen → keine Kennung; gültig ab vollAm bis unter 30 min", async () => {
  const C = await zwischenspeicher();
  assert.equal(C.CONTENT_PROBE_SPALTEN, "id,updated_at");
  assert.equal(C.CONTENT_ABFRAGE_HEADER, "x-content-abfrage");
  const a = { id: 1, updated_at: "2026-11-09T08:00:00.000001+00:00", title: "A" };
  const b = { id: 2, updated_at: null, title: "B" };
  assert.equal(C.contentKennung([]), "[]");
  assert.equal(C.contentKennung([a, b]), C.contentKennung([{ id: 1, updated_at: a.updated_at }, { id: 2, updated_at: null, body: "x" }]), "andere Spalten zählen nicht");
  assert.notEqual(C.contentKennung([a, b]), C.contentKennung([b, a]), "Reihenfolge");
  assert.notEqual(C.contentKennung([a]), C.contentKennung([a, b]), "Anzahl");
  assert.notEqual(C.contentKennung([a]), C.contentKennung([{ ...a, updated_at: "2026-11-09T08:00:00.000002+00:00" }]), "updated_at");
  assert.notEqual(C.contentKennung([b]), C.contentKennung([{ ...b, updated_at: "2026-11-09T08:00:00+00:00" }]), "updated_at null → gesetzt");
  assert.notEqual(C.contentKennung([a]), C.contentKennung([{ ...a, id: 3 }]), "id");
  assert.notEqual(C.contentKennung([{ id: 12, updated_at: null }, { id: 3, updated_at: null }]), C.contentKennung([{ id: 1, updated_at: null }, { id: 23, updated_at: null }]), "ids eindeutig getrennt");
  for (const kaputt of [[null], [[1, "x"]], ["x"], [7], [{ updated_at: null }], [{ id: null, updated_at: null }], [{ id: "", updated_at: null }], [{ id: Number.NaN, updated_at: null }], [{ id: {}, updated_at: null }], [{ id: 1 }], [{ id: 1, updated_at: 5 }], [{ id: 1, updated_at: {} }], [a, { id: 2 }]]) {
    assert.equal(C.contentKennung(kaputt), null, JSON.stringify(kaputt));
  }
  C.setzeContentListeZurueck();
  assert.equal(C.gueltigerContentStand(1_000), null, "leer");
  const zeilen = [a, b];
  C.merkeContentListe(zeilen, 1_000);
  const s = C.gueltigerContentStand(1_000);
  assert.deepEqual(s, { kennung: C.contentKennung(zeilen), zeilen, vollAm: 1_000 });
  assert.equal(C.gueltigerContentStand(1_000 + C.CONTENT_VOLL_SPAETESTENS_MS - 1), s, "knapp unter 30 min");
  assert.equal(C.gueltigerContentStand(1_000 + C.CONTENT_VOLL_SPAETESTENS_MS), null, "30 min");
  assert.equal(C.gueltigerContentStand(999), null, "Uhr vor vollAm");
  C.merkeContentListe([{ title: "ohne id", updated_at: null }], 2_000);
  assert.equal(C.gueltigerContentStand(2_000), null, "ohne Kennung kein Zwischenstand, auch der vorige nicht");
  C.merkeContentListe(zeilen, 3_000);
  assert.notEqual(C.gueltigerContentStand(3_000), null);
  C.setzeContentListeZurueck();
  assert.equal(C.gueltigerContentStand(3_000), null, "zurückgesetzt");
});

test("R7-P12 Zeitlimit je Abfrage: Probe 3 s und volle Abfrage 6 s — zusammen über 8 s, jede für sich darunter: nach einer Änderung 200 voll mit den neuen Zeilen, danach wieder nur die Probe; erst eine Abfrage, die selbst 8 s braucht, scheitert", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const dauert = zeitlimitsAufAttrappenUhr(t);
  for (let i = 1; i <= 3; i++) zeileDb(i);
  let probeMs = 3_000;
  let vollMs = 6_000;
  welt.vorAntwort = async (a) => {
    if (istProbe(a)) await dauert(a, probeMs);
    else if (istVoll(a)) await dauert(a, vollMs);
  };
  let r = await holeListe();
  assert.deepEqual([r.status, anfragen()], [200, ["voll"]]);
  assert.equal(r.body.gelesen_am, iso(T0 + 6_000));
  t.mock.timers.setTime(T0 + 15_000);
  r = await holeListe();
  assert.deepEqual([r.status, r.kopf.get("x-content-abfrage"), anfragen()], [200, "unveraendert", ["probe"]]);

  aktualisiere(2, { status: "freigegeben" });
  t.mock.timers.setTime(T0 + 30_000);
  r = await holeListe();
  assert.equal(r.status, 200, `Probe 3 s, dann volle Abfrage 6 s mit eigenen 8 s: ${JSON.stringify(r.body.fehler ?? null)}`);
  assert.deepEqual(anfragen(), ["probe", "voll"]);
  assert.equal(r.kopf.get("x-content-abfrage"), "voll");
  assert.deepEqual(r.body.zeilen, tabelle(), "mit der geänderten Zeile 2");
  assert.equal(r.body.gelesen_am, iso(T0 + 39_000), "nach 3 s Probe und 6 s voller Abfrage");
  t.mock.timers.setTime(T0 + 45_000);
  r = await holeListe();
  assert.deepEqual([r.status, r.kopf.get("x-content-abfrage"), anfragen()], [200, "unveraendert", ["probe"]], "Zwischenstand ersetzt: wieder nur die Probe");
  assert.deepEqual(r.body.zeilen, tabelle());

  // Gegenkontrolle: Braucht eine Abfrage selbst 8 s, bricht ihr eigenes Signal sie ab.
  const stand = (await zwischenspeicher()).gueltigerContentStand(Date.now());
  assert.ok(stand);
  probeMs = 8_000;
  t.mock.timers.setTime(T0 + 60_000);
  r = await holeListe();
  assert.deepEqual([r.status, r.body, anfragen()], [502, { fehler: "Zeitüberschreitung (8 s)", fehler_art: "supabase" }, ["probe"]], "Probe 8 s");
  assert.equal(Date.now() - (T0 + 60_000), 8_000, "Probe nach 8 s abgebrochen");
  probeMs = 3_000;
  vollMs = 8_000;
  aktualisiere(3, { status: "abgelehnt" });
  t.mock.timers.setTime(T0 + 75_000);
  r = await holeListe();
  assert.deepEqual([r.status, r.body, anfragen()], [502, { fehler: "Zeitüberschreitung (8 s)", fehler_art: "supabase" }, ["probe", "voll"]], "volle Abfrage 8 s");
  assert.equal(Date.now() - (T0 + 75_000), 11_000, "3 s Probe, dann 8 s volle Abfrage bis zum Abbruch");
  assert.equal((await zwischenspeicher()).gueltigerContentStand(Date.now()), stand, "Zwischenstand unverändert");
});

test("R7-P13 Gleichzeitig: Endet eine ältere volle Abfrage zuletzt, wird der Zwischenstand älter — die nächste Anfrage erkennt das mit der Probe und liest voll, nie eine veraltete Liste", async () => {
  for (let i = 1; i <= 3; i++) zeileDb(i);
  const S1 = tabelle();
  const torA = tor();
  let ersteVolle = true;
  welt.vorAntwort = async (a) => {
    if (ersteVolle && istVoll(a)) {
      ersteVolle = false;
      a.schnappschuss = tabelle(); // Postgres liest den Stand vom Beginn der Abfrage
      await torA.warte();
    }
  };
  welt.stoerung = (a) => (a.schnappschuss ? { status: 200, body: a.schnappschuss } : null);
  const anfrageA = holeListe();
  await bisAmTor(torA, anfrageA);
  assert.deepEqual(anfragen(), ["voll"], "A: volle Abfrage läuft");
  aktualisiere(2, { status: "freigegeben" });
  const S2 = tabelle();
  const b = await holeListe();
  assert.deepEqual(anfragen(), ["voll"], "B: noch kein Zwischenstand");
  assert.deepEqual(b.body.zeilen, S2);
  const c = await holeListe();
  assert.deepEqual([anfragen(), c.kopf.get("x-content-abfrage")], [["probe"], "unveraendert"]);
  assert.deepEqual(c.body.zeilen, S2);
  torA.oeffnen();
  const a = await anfrageA;
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.zeilen, S1, "A liefert ihren Schnappschuss");
  assert.deepEqual((await zwischenspeicher()).gueltigerContentStand(Date.now()).zeilen, S1, "A endete zuletzt: Zwischenstand jetzt der ältere");
  const d = await holeListe();
  assert.deepEqual(anfragen(), ["probe", "voll"], "die Probe erkennt den älteren Zwischenstand");
  assert.equal(d.kopf.get("x-content-abfrage"), "voll");
  assert.deepEqual(d.body.zeilen, S2, "keine veraltete Liste");
  const e = await holeListe();
  assert.deepEqual(anfragen(), ["probe"]);
  assert.deepEqual(e.body.zeilen, S2);
});

test("R7-P14 Gleichzeitig: Endet eine ältere volle Abfrage während der Probe und speichert den alten Stand, antwortet die Anfrage mit den Zeilen, gegen die ihre Probe verglichen hat — nie mit dem alten Stand", async () => {
  for (let i = 1; i <= 3; i++) zeileDb(i);
  const S1 = tabelle();
  const torA0 = tor();
  const torA = tor();
  let a0 = true;
  let probeA = true;
  welt.vorAntwort = async (a) => {
    if (a0 && istVoll(a)) {
      a0 = false;
      a.schnappschuss = tabelle(); // Postgres liest den Stand vom Beginn der Abfrage
      await torA0.warte();
    } else if (probeA && istProbe(a)) {
      probeA = false;
      await torA.warte(); // Ergebnis erst nach dem Tor: die Tabelle von dann (S2)
    }
  };
  welt.stoerung = (a) => (a.schnappschuss ? { status: 200, body: a.schnappschuss } : null);
  const anfrageA0 = holeListe();
  await bisAmTor(torA0, anfrageA0);
  aktualisiere(2, { status: "freigegeben" });
  const S2 = tabelle();
  const b = await holeListe();
  assert.deepEqual(b.body.zeilen, S2, "B speichert S2");
  const anfrageA = holeListe();
  await bisAmTor(torA, anfrageA);
  torA0.oeffnen();
  const antwortA0 = await anfrageA0;
  assert.deepEqual(antwortA0.body.zeilen, S1, "A0 liefert ihren Schnappschuss");
  assert.deepEqual((await zwischenspeicher()).gueltigerContentStand(Date.now()).zeilen, S1, "A0 endete zuletzt: Zwischenstand jetzt S1");
  torA.oeffnen();
  const a = await anfrageA;
  assert.equal(a.status, 200);
  assert.equal(a.kopf.get("x-content-abfrage"), "unveraendert");
  assert.deepEqual(a.body.zeilen, S2, "A: Die Probe sah S2 und verglich gegen S2 — nie S1");
  assert.deepEqual(anfragen(), ["voll", "voll", "probe"]);
});

test("R7-P15 Gleichzeitig: Sieht die Probe noch den alten Stand, während eine andere Anfrage den neuen speichert, antwortet die Anfrage mit den Zeilen, gegen die ihre Probe verglichen hat", async () => {
  for (let i = 1; i <= 3; i++) zeileDb(i);
  const S1 = tabelle();
  await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  const torA = tor();
  let erste = true;
  welt.vorAntwort = async (a) => {
    if (erste && istProbe(a)) {
      erste = false;
      a.schnappschuss = probeSicht(); // Postgres liest den Stand vom Beginn der Abfrage
      await torA.warte();
    }
  };
  welt.stoerung = (a) => (a.schnappschuss ? { status: 200, body: a.schnappschuss } : null);
  const anfrageA = holeListe();
  await bisAmTor(torA, anfrageA);
  aktualisiere(2, { status: "freigegeben" });
  const S2 = tabelle();
  const b = await holeListe();
  assert.deepEqual(b.body.zeilen, S2, "B speichert S2");
  torA.oeffnen();
  const a = await anfrageA;
  assert.equal(a.kopf.get("x-content-abfrage"), "unveraendert");
  assert.deepEqual(a.body.zeilen, S1, "A: die Zeilen, gegen die ihre Probe verglich (S1), nicht der inzwischen gespeicherte Stand S2");
  assert.deepEqual(anfragen(), ["probe", "probe", "voll"]);
});

// ═══ Mutationsprüfung (09.11.2026) ═══
// Je Test in Klammern der Mutant, der vorher die ganze Suite überlebte (Mutationslauf gegen 08f018e in einer
// eigenen Kopie). Jeder Test ist mit seinem Mutanten rot und ohne ihn grün; Produktcode unverändert.

test("R7-M1 (M10) Höchstdauer nach einer erkannten Änderung ab Beginn der vollen Abfrage, nicht ab Beginn der Probe davor — Probe 3 s, volle Abfrage 4 s: 29:59,999 min danach nur die Probe, ab 30 min voll", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const MIN30 = 30 * 60_000;
  for (let i = 1; i <= 3; i++) zeileDb(i);
  await holeListe();
  assert.deepEqual(anfragen(), ["voll"]);
  // Nach der Änderung braucht die Anfrage die Probe (3 s) und die volle Abfrage (4 s).
  welt.vorAntwort = async (a) => {
    if (istProbe(a)) t.mock.timers.tick(3_000);
    if (istVoll(a)) t.mock.timers.tick(4_000);
  };
  t.mock.timers.setTime(T0 + 60_000);
  aktualisiere(2, { status: "freigegeben" });
  const geaendert = await holeListe();
  assert.deepEqual(anfragen(), ["probe", "voll"]);
  assert.equal(geaendert.body.gelesen_am, iso(T0 + 67_000), "3 s Probe, dann 4 s volle Abfrage");
  const vollBeginn = T0 + 63_000;

  // Ab hier dauern die Abfragen keine Zeit; die Uhr stellt nur der Test.
  welt.vorAntwort = null;
  t.mock.timers.setTime(vollBeginn + MIN30 - 1);
  let r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "29:59,999 min nach Beginn der vollen Abfrage (30:02,999 min nach Beginn der Probe): nur die Probe");
  assert.equal(r.kopf.get("x-content-abfrage"), "unveraendert");
  assert.deepEqual(r.body.zeilen, geaendert.body.zeilen);

  t.mock.timers.tick(1);
  r = await holeListe();
  assert.deepEqual(anfragen(), ["voll"], "30 min nach Beginn der vollen Abfrage: voll, ohne Probe");
  assert.equal(r.kopf.get("x-content-abfrage"), "voll");
  assert.deepEqual(r.body.zeilen, geaendert.body.zeilen);
});

test("R7-M2 (M11) Nach einer erkannten Änderung beginnt die Höchstdauer neu: Der neue Zwischenstand gilt 30 min ab seiner eigenen vollen Abfrage, nicht ab der des ersetzten Stands", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const MIN = 60_000;
  for (let i = 1; i <= 3; i++) zeileDb(i);
  const erste = await holeListe();
  assert.deepEqual(anfragen(), ["voll"], "erste volle Abfrage bei 0 min");
  t.mock.timers.setTime(T0 + 10 * MIN);
  aktualisiere(1, { status: "abgelehnt" });
  const geaendert = await holeListe();
  assert.deepEqual(anfragen(), ["probe", "voll"], "Änderung erkannt, zweite volle Abfrage bei 10 min");
  assert.notDeepEqual(geaendert.body.zeilen, erste.body.zeilen);

  t.mock.timers.setTime(T0 + 30 * MIN);
  let r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "30 min nach der ersten, 20 min nach der zweiten vollen Abfrage: nur die Probe");
  assert.equal(r.kopf.get("x-content-abfrage"), "unveraendert");
  assert.deepEqual(r.body.zeilen, geaendert.body.zeilen);

  t.mock.timers.setTime(T0 + 40 * MIN - 1);
  r = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "29:59,999 min nach der zweiten vollen Abfrage: nur die Probe");
  t.mock.timers.tick(1);
  r = await holeListe();
  assert.deepEqual(anfragen(), ["voll"], "30 min nach der zweiten vollen Abfrage: voll, ohne Probe");
  assert.equal(r.kopf.get("x-content-abfrage"), "voll");
  assert.deepEqual(r.body.zeilen, geaendert.body.zeilen);
});

test("R7-M3 (M26) Header x-content-abfrage nur bei 200: Scheitert die volle Abfrage — ohne Zwischenstand oder nach geänderter Probe —, fehlt er auf der 502; ebenso auf 500 konfiguration und 500 programmfehler", async (t) => {
  for (let i = 1; i <= 3; i++) zeileDb(i);
  const faelle = [
    ["Lesefehler", { stoerung: (a) => (istVoll(a) ? { status: 500, body: { code: "XX000", message: "kaputt" } } : null) }, "kaputt"],
    [
      "Zeitüberschreitung",
      {
        vorAntwort: async (a) => {
          if (istVoll(a)) throw abbruch();
        },
      },
      "Zeitüberschreitung (8 s)",
    ],
    ["Objekt statt Liste", { stoerung: (a) => (istVoll(a) ? { status: 200, body: { id: 1 } } : null) }, "Antwort ohne Zeilenliste"],
  ];
  async function volleAbfrageScheitert(wann, erwartet) {
    for (const [name, stoerung, grund] of faelle) {
      welt.stoerung = stoerung.stoerung ?? null;
      welt.vorAntwort = stoerung.vorAntwort ?? null;
      const r = await holeListe();
      assert.deepEqual([r.status, r.body, anfragen()], [502, { fehler: grund, fehler_art: "supabase" }, erwartet], `${wann}, ${name}`);
      assert.equal(r.kopf.get("x-content-abfrage"), null, `${wann}, ${name}: kein Header`);
    }
    welt.stoerung = null;
    welt.vorAntwort = null;
  }

  await volleAbfrageScheitert("ohne Zwischenstand", ["voll"]);
  let r = await holeListe();
  assert.deepEqual([r.status, r.kopf.get("x-content-abfrage"), anfragen()], [200, "voll", ["voll"]], "Gegenkontrolle: die 200 trägt ihn");
  aktualisiere(2, { status: "freigegeben" });
  await volleAbfrageScheitert("nach geänderter Probe", ["probe", "voll"]);

  delete process.env.SUPABASE_SERVICE_KEY;
  r = await holeListe();
  assert.deepEqual([r.status, r.body.fehler_art, r.kopf.get("x-content-abfrage"), anfragen()], [500, "konfiguration", null, []]);
  process.env.SUPABASE_SERVICE_KEY = SERVICE;
  const zeitlimit = t.mock.method(AbortSignal, "timeout", () => {
    throw new Error("unerwartet");
  });
  r = await holeListe();
  assert.deepEqual([r.status, r.body.fehler_art, r.kopf.get("x-content-abfrage"), anfragen()], [500, "programmfehler", null, []]);
  zeitlimit.mock.restore();

  r = await holeListe();
  assert.deepEqual([r.status, r.kopf.get("x-content-abfrage"), anfragen()], [200, "voll", ["probe", "voll"]], "danach die neuen Zeilen");
  assert.deepEqual(r.body.zeilen, tabelle());
});

test("R7-M4 (M50) Leere Liste: Auch ein leerer Zwischenstand gilt — die nächste Anfrage stellt nur die Probe; ein INSERT in die leere Tabelle und das Löschen der letzten Zeile erkennt sie", async () => {
  const erste = await holeListe();
  assert.deepEqual([erste.status, erste.kopf.get("x-content-abfrage"), erste.body.zeilen, erste.body.abgeschnitten, anfragen()], [200, "voll", [], false, ["voll"]]);
  const zweite = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "leere Tabelle, nichts geändert: nur die Probe");
  assert.deepEqual([zweite.status, zweite.kopf.get("x-content-abfrage"), zweite.body.zeilen], [200, "unveraendert", []]);

  zeileDb(1);
  const dritte = await holeListe();
  assert.deepEqual(anfragen(), ["probe", "voll"], "INSERT in die leere Tabelle");
  assert.equal(dritte.kopf.get("x-content-abfrage"), "voll");
  assert.deepEqual(dritte.body.zeilen, tabelle());
  assert.equal(dritte.body.zeilen.length, 1);

  loesche(1);
  const vierte = await holeListe();
  assert.deepEqual(anfragen(), ["probe", "voll"], "letzte Zeile gelöscht");
  assert.deepEqual([vierte.kopf.get("x-content-abfrage"), vierte.body.zeilen], ["voll", []]);
  const fuenfte = await holeListe();
  assert.deepEqual(anfragen(), ["probe"], "wieder leer, nichts geändert: nur die Probe");
  assert.deepEqual([fuenfte.status, fuenfte.kopf.get("x-content-abfrage"), fuenfte.body.zeilen], [200, "unveraendert", []]);
});
