// Objekt-Studio Schritt 3, Änderungsprobe (09.11.2026): GET /api/content/liste fragt vor der vollen Abfrage
// nur id und updated_at derselben Zeilen ab und antwortet bei gleicher Kennung mit dem Zwischenstand
// ihrer letzten vollen Abfrage (lib/content-liste-cache.ts). Lauf: npm test.
//
// Die Route läuft im Prozess gegen die PostgREST-Attrappe aus tests/harness/fake.mjs; Zeiten stellen die
// Attrappen-Uhren von node:test (Date). Gezählt werden die Supabase-Anfragen je Listen-Anfrage
// (welt.log): Probe und volle Abfrage unterscheiden sich an der Spaltenliste. Änderungen an der Tabelle
// spielt der Test direkt in der Attrappe nach; ein UPDATE setzt updated_at neu wie der Trigger
// content_updated_at (scripts/setup_supabase_v2.sql:339-342).
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

// ═══ Tests ═══

test("R7-P1 Probe: select=id%2Cupdated_at, created_at absteigend, Grenze 50, Service-Schlüssel; volle Abfrage exakt wie bisher; Probe und volle Abfrage einer Anfrage teilen ein Abbruchsignal mit 8 s", async (t) => {
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
  assert.equal(gesehen[2].signal, gesehen[3].signal, "Probe und volle Abfrage einer Anfrage: ein Signal, zusammen höchstens 8 s");
  assert.notEqual(gesehen[1].signal, gesehen[2].signal, "jede Anfrage ihr eigenes Signal");
  assert.equal(erzeugt.size, 3, "ein Signal je Anfrage");
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
