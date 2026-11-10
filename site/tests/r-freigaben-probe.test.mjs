// Freigabe-Stapel sparsam, Änderungsprobe (09.11.2026): GET /api/freigaben fragt vor der vollen Abfrage nur
// id und updated_at derselben Zeilen ab — beide Listen mit denselben Filtern, derselben Sortierung, denselben
// Grenzen und count "exact" — und antwortet bei gleicher Kennung aus dem Zwischenstand ihrer letzten vollen
// Abfrage (lib/freigaben-cache.ts). Lauf: npm test.
//
// Die Route läuft im Prozess gegen die PostgREST-Attrappe aus tests/harness/fake.mjs; Zeiten stellen die
// Attrappen-Uhren von node:test (Date). Gezählt werden die Supabase-Anfragen je Anfrage an die Route
// (welt.log): Probe und volle Abfrage unterscheiden sich an der Spaltenliste, wartend und hängend am Filter.
// Änderungen an der Tabelle spielt der Test direkt in der Attrappe nach; ein UPDATE setzt updated_at neu wie
// der Trigger content_updated_at (scripts/setup_supabase_v2.sql:339-342). Antworten, die die Attrappe so nicht
// gibt (Objekt statt Zeilenliste, Zählung fehlt oder unlesbar, Zeile ohne id), ersetzt ein Wrapper um fetch,
// nachdem die Attrappe die Abfrage protokolliert hat. Gleichzeitigkeit: Ein Tor hält die Antwort der
// Attrappe zurück, nachdem sie berechnet ist — die Route bekommt den Stand vom Beginn der Abfrage, aber
// später (wie Postgres, das den Stand vom Beginn einer Abfrage liest).
// Mutationsprüfung (FS-M3, FS-M4, 09.11.2026): alter_stunden und Höchstdauer nach einer Probe, die Zeit braucht.
// Kein Netz: Jeder Abruf geht an die Attrappe oder wirft. Die Umgebungswerte unten sind Test-Werte dieses
// Prozesses, keine echten Schlüssel. Jeder Test beginnt ohne Zwischenstand. Module werden je Test geladen:
// Fehlt eines (Stand vor der Änderungsprobe), scheitert der einzelne Test, nicht die Datei.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wie tests/r-content-probe.test.mjs: "@/…" → src/….ts, "next/server" → node_modules, relative Importe ohne
// Endung aus .ts → ".ts", "server-only" → die leere Fassung, die Next.js im Server-Bundle nimmt.
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

const modulCache = new Map();
/** Modul je Test laden (gecacht); fehlt es, scheitert nur der Test, der es braucht. */
async function ladeModul(rel) {
  const datei = path.join(SITE, rel);
  if (!modulCache.has(datei)) modulCache.set(datei, await import(pathToFileURL(datei).href));
  return modulCache.get(datei);
}
const freigabenRoute = () => ladeModul("src/app/api/freigaben/route.ts");
const zwischenstand = () => ladeModul("src/lib/freigaben-cache.ts");

/** Grenzen ("hängend" seit), wie sie in den Abfragen standen — in der Reihenfolge des Protokolls. */
const grenzen = [];

beforeEach(async () => {
  zuruecksetzen();
  process.env.SUPABASE_SERVICE_KEY = SERVICE;
  globalThis.fetch = FAKE_FETCH;
  grenzen.length = 0;
  const speicher = await zwischenstand().catch(() => null);
  speicher?.setzeFreigabenZurueck();
});

// ═══ Hilfen ═══

/** Abfragen, wie die Attrappe sie protokolliert (decodeURIComponent der Query); G steht für die Grenze. */
// Seit Objekt-Studio Schritt 9 lesen volle Abfrage und Probe metadata->medium_id mit (Caption zu einem Video).
const SPALTEN_VOLL = "id,title,platform,status,created_at,updated_at,body,review_notes,metadata->>objekt_slug,metadata->steps,metadata->medium_id";
const FILTER_WARTEND = "status=eq.zur_freigabe&order=created_at.asc,id.asc&limit=100";
const FILTER_HAENGEND = 'status=in.(entwurf,counsel_geprueft)&or=(updated_at.lt."G",and(updated_at.is.null,created_at.lt."G"))&order=created_at.asc,id.asc&limit=50';
const ARTEN = new Map([
  [`select=id,updated_at,metadata->medium_id&${FILTER_WARTEND}`, "probe/wartend"],
  [`select=id,updated_at,metadata->medium_id&${FILTER_HAENGEND}`, "probe/haengend"],
  [`select=${SPALTEN_VOLL}&${FILTER_WARTEND}`, "voll/wartend"],
  [`select=${SPALTEN_VOLL}&${FILTER_HAENGEND}`, "voll/haengend"],
]);
const GRENZE_IM_FILTER = /updated_at\.lt\."([^"]+)",and\(updated_at\.is\.null,created_at\.lt\."([^"]+)"\)/;

/** Supabase-Anfragen seit dem letzten Aufruf, sortiert, als "probe/…" / "voll/…" (alles andere wörtlich); leert das Protokoll. */
function anfragen() {
  const arten = welt.log.map((l) => {
    let q = l.query;
    const m = GRENZE_IM_FILTER.exec(q);
    if (m && m[1] === m[2]) {
      grenzen.push(m[1]);
      q = q.replaceAll(`"${m[1]}"`, '"G"');
    }
    const art = l.methode === "GET" && l.tabelle === "content" ? ARTEN.get(q) : undefined;
    return art ?? `${l.methode} ${l.tabelle} ${l.query}`;
  });
  welt.log.length = 0;
  return arten.sort();
}
const PROBE = ["probe/haengend", "probe/wartend"];
const VOLL = ["voll/haengend", "voll/wartend"];
const PROBE_UND_VOLL = [...PROBE, ...VOLL];

const istProbe = (url) => url.searchParams.get("select") === "id,updated_at,metadata->medium_id";
const istVoll = (url) => url.searchParams.get("select") === SPALTEN_VOLL;
const istWartend = (url) => url.searchParams.get("status") === "eq.zur_freigabe";
const istHaengend = (url) => url.searchParams.has("or");
const urlVon = (a) => (a.url instanceof URL ? a.url : new URL(a.url));

const T0 = Date.parse("2026-11-09T08:00:00.000Z");
const MIN = 60_000;
const STUNDE = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();
/** Erstellzeit der Testzeile i: i Minuten nach dem 01.11.2026, 08:00 UTC — größere i sind neuer. */
const am = (i) => iso(Date.UTC(2026, 10, 1, 8) + i * MIN);

/** Geschützter Name nur zusammengesetzt (wie tests/s-studio.test.mjs), damit er hier nicht als Literal steht. */
const NAME = ["Immo", "Nexus"].join("");
const TEXT = "Denkmal-Altbau in Leipzig, saniert 2024. Jetzt Exposé anfordern.";
const FREIGABE = "Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG";
const schritte = (text = TEXT) => [
  { agent: "researcher", status: "done", output: "Recherche" },
  { agent: "scribe", status: "done", output: text },
  { agent: "counsel", status: "done", output: FREIGABE },
  { agent: "publisher", status: "done", output: text },
  { agent: "amplifier", status: "done", output: "Plan" },
];

/** content-Zeile mit Postgres-Defaults (fake.legeAn); Vorgabe: wartet zur Freigabe, geprüft, regelkonform. */
function zeileDb(id, felder = {}) {
  const erstellt = felder.created_at ?? am(id);
  return legeAn({
    id,
    title: `Lauf ${id}`,
    content_type: "thread",
    platform: "x",
    status: "zur_freigabe",
    body: TEXT,
    review_notes: FREIGABE,
    metadata: { objekt_slug: "villa-x", steps: schritte() },
    created_at: erstellt,
    updated_at: erstellt,
    ...felder,
  });
}

/** UPDATE wie in Postgres: Felder setzen; updated_at setzt der Trigger content_updated_at neu. */
function aktualisiere(id, felder) {
  const zeile = fake.zeile(id);
  assert.ok(zeile, `Zeile ${id} fehlt`);
  Object.assign(zeile, felder);
  zeile.updated_at = fake.zeitstempel();
}

function loesche(id) {
  const i = welt.content.findIndex((z) => z.id === id);
  assert.ok(i >= 0, `Zeile ${id} fehlt`);
  welt.content.splice(i, 1);
}

/** Standard-Tabelle bei T0: fünf wartende, zwei hängende (3 h und 5 h ohne Änderung), zwei außerhalb beider Listen. */
function standard() {
  for (let i = 1; i <= 5; i++) zeileDb(i);
  zeileDb(11, { status: "entwurf", updated_at: iso(T0 - 3 * STUNDE) });
  zeileDb(12, { status: "counsel_geprueft", updated_at: iso(T0 - 5 * STUNDE) });
  zeileDb(21, { status: "freigegeben" });
  zeileDb(22, { status: "entwurf", updated_at: iso(T0 - 10 * MIN) });
}

/**
 * Was der Stapel jetzt zeigen muss (ids und Zählungen), unabhängig von der Route aus der Tabelle bestimmt:
 * wartend = zur_freigabe; hängend = entwurf/counsel_geprueft mit updated_at (ersatzweise created_at) vor
 * jetzt − 2 h; beide nach created_at, id aufsteigend, höchstens 100 bzw. 50.
 */
function erwartet(jetzt = Date.now()) {
  const us = (x) => fake.mikrosekunden(x);
  const grenze = (jetzt - 2 * STUNDE) * 1000;
  const sortiert = (zeilen) => zeilen.slice().sort((a, b) => us(a.created_at) - us(b.created_at) || a.id - b.id);
  const wartend = sortiert(welt.content.filter((z) => z.status === "zur_freigabe"));
  const haengend = sortiert(
    welt.content.filter((z) => ["entwurf", "counsel_geprueft"].includes(z.status) && (z.updated_at === null ? us(z.created_at) : us(z.updated_at)) < grenze),
  );
  return {
    wartend: wartend.slice(0, 100).map((z) => String(z.id)),
    wartend_gesamt: wartend.length,
    haengend: haengend.slice(0, 50).map((z) => String(z.id)),
    haengend_gesamt: haengend.length,
  };
}
/** ids und Zählungen einer Antwort, vergleichbar mit erwartet(). */
const kurz = (body) => ({ wartend: body.wartend.map((e) => e.id), wartend_gesamt: body.wartend_gesamt, haengend: body.haengend.map((e) => e.id), haengend_gesamt: body.haengend_gesamt });

async function hole() {
  const { GET } = await freigabenRoute();
  const res = await GET();
  return { status: res.status, kopf: res.headers, body: await res.json() };
}

/** Antwort einer vollen Abfrage zur selben Uhr: Zwischenstand verwerfen, neu lesen (setzt den Zwischenstand neu). */
async function vollZurSelbenUhr() {
  (await zwischenstand()).setzeFreigabenZurueck();
  const r = await hole();
  assert.deepEqual(anfragen(), VOLL, "Vergleichsabfrage: voll");
  return r;
}

/** Fehlerantwort wie vor der Änderungsprobe (fehlerAntwort der Route): leere Listen, Zählungen 0, nur mit "fehler" zu deuten. */
const fehlerBody = (fehler, quelle, jetzt = Date.now()) => ({
  erzeugt_am: iso(jetzt),
  wartend: [],
  wartend_gesamt: 0,
  haengend: [],
  haengend_gesamt: 0,
  quelle,
  fehler,
});

const abbruch = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

/**
 * Antworten, die die Attrappe so nicht gibt: Für passende Abfragen (pruefe(url)) liefert fetch statt der Antwort
 * der Attrappe { status, body, bereich } — bereich ist der content-range-Header (daraus liest supabase-js die
 * Zählung). Die Attrappe beantwortet und protokolliert die Abfrage vorher trotzdem.
 */
function ersetzeAntwort(pruefe, ersatz) {
  globalThis.fetch = async (input, init = {}) => {
    const res = await FAKE_FETCH(input, init);
    const url = new URL(typeof input === "string" ? input : input.url);
    if (!pruefe(url)) return res;
    const { status = 200, body, bereich } = ersatz;
    const kopf = { "content-type": "application/json", ...(bereich ? { "content-range": bereich } : {}) };
    return new Response(JSON.stringify(body), { status, headers: kopf });
  };
}

/** Tor: warte() hält an, bis oeffnen(); angekommen erfüllt sich, sobald jemand dort steht. */
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

/**
 * Hält die erste passende Abfrage nach der Antwort der Attrappe am Tor: Die Antwort trägt den Stand vom
 * Beginn der Abfrage, die Route bekommt sie erst nach oeffnen(). Weitere Abfragen laufen durch.
 */
function halteNachAntwort(pruefe, torX) {
  let frei = true;
  globalThis.fetch = async (input, init = {}) => {
    const res = await FAKE_FETCH(input, init);
    const url = new URL(typeof input === "string" ? input : input.url);
    if (frei && pruefe(url)) {
      frei = false;
      await torX.warte();
    }
    return res;
  };
}

/** Wartet, bis die Anfrage am Tor steht. Endet sie vorher (sie stellt die erwartete Abfrage nicht), scheitert der Test, statt zu hängen. */
async function bisAmTor(torX, anfrage) {
  const ende = anfrage.then(
    () => "beendet",
    () => "beendet",
  );
  const was = await Promise.race([torX.angekommen.then(() => "am Tor"), ende]);
  assert.equal(was, "am Tor", "Die Anfrage endete, ohne das Tor zu erreichen");
}

/**
 * Zeitlimit der Tests mit Toren (FS-P10). Stellt die Route eine andere Abfrage als erwartet, wartet eine Anfrage
 * an einem Tor, das kein Test öffnet; ohne Grenze hinge npm test dann, statt einen roten Test zu zeigen.
 * Normal enden diese Tests in Millisekunden.
 */
const TOR_TEST_GRENZE = { timeout: 10_000 };

/**
 * Zeitlimits auf der Attrappen-Uhr (wie tests/r-content-probe.test.mjs): AbortSignal.timeout(ms) liefert ein
 * Signal mit der Frist jetzt + ms. dauert(a, ms) lässt die Supabase-Abfrage a ms brauchen: Läuft ihr Signal
 * vorher ab, steht die Uhr danach auf der Frist und die Abfrage endet mit dem Abbruch; sonst steht die Uhr ms
 * weiter.
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

// ═══ Tests ═══

test("FS-P1 Form: Probe-Abfragen wie die vollen — Filter (Grenze je Anfrage neu), Sortierung, Grenzen 100/50, count exact —, aber nur id und updated_at, mit Service-Schlüssel; volle Abfragen exakt wie vor der Änderungsprobe; Probe-Paar und volles Paar je ein eigenes Abbruchsignal von 8 s", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const { ABFRAGE_TIMEOUT_MS } = await ladeModul("src/lib/status-server.ts");
  standard();
  const erzeugt = new Map();
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const signal = original.call(AbortSignal, ms);
    erzeugt.set(signal, ms);
    return signal;
  });
  let nr = 0;
  const gesehen = [];
  welt.vorAntwort = async (a) => {
    if (a.art === "supabase") gesehen.push({ nr, a });
  };
  for (const [i, vorher] of [
    [1, () => {}],
    [2, () => t.mock.timers.tick(MIN)],
    [
      3,
      () => {
        aktualisiere(2, { review_notes: "URTEIL: ABLEHNUNG" });
        t.mock.timers.tick(MIN);
      },
    ],
  ]) {
    vorher();
    nr = i;
    assert.equal((await hole()).status, 200, `Anfrage ${i}`);
  }
  // Rohform der URL, wie supabase-js sie sendet. Die vollen Abfragen sind die an a62a4bd (vor der
  // Änderungsprobe) mit derselben Attrappe gemessenen, nur mit der Grenze dieser Anfrage.
  const SEL_VOLL = "id%2Ctitle%2Cplatform%2Cstatus%2Ccreated_at%2Cupdated_at%2Cbody%2Creview_notes%2Cmetadata-%3E%3Eobjekt_slug%2Cmetadata-%3Esteps%2Cmetadata-%3Emedium_id";
  const SEL_PROBE = "id%2Cupdated_at%2Cmetadata-%3Emedium_id";
  const wartendRoh = (sel) => `?select=${sel}&status=eq.zur_freigabe&order=created_at.asc%2Cid.asc&limit=100`;
  const haengendRoh = (sel, jetzt) => {
    const g = encodeURIComponent(iso(jetzt - 2 * STUNDE));
    return `?select=${sel}&status=in.%28entwurf%2Ccounsel_geprueft%29&or=%28updated_at.lt.%22${g}%22%2Cand%28updated_at.is.null%2Ccreated_at.lt.%22${g}%22%29%29&order=created_at.asc%2Cid.asc&limit=50`;
  };
  const je = (i) => gesehen.filter((g) => g.nr === i).map((g) => g.a);
  const form = (liste) => liste.map((a) => [a.methode, a.tabelle, a.url.search, a.kopf.get("prefer"), a.kopf.get("apikey") === SERVICE ? "service" : a.kopf.get("apikey")]);
  const sortiert = (liste) => liste.slice().sort((x, y) => (x[2] < y[2] ? -1 : 1));
  const zeile = (search) => ["GET", "content", search, "count=exact", "service"];
  assert.deepEqual(sortiert(form(je(1))), sortiert([zeile(wartendRoh(SEL_VOLL)), zeile(haengendRoh(SEL_VOLL, T0))]), "1. Anfrage: nur voll");
  assert.deepEqual(sortiert(form(je(2))), sortiert([zeile(wartendRoh(SEL_PROBE)), zeile(haengendRoh(SEL_PROBE, T0 + MIN))]), "2. Anfrage: nur die Probe");
  const dritte = je(3);
  assert.deepEqual(sortiert(form(dritte.slice(0, 2))), sortiert([zeile(wartendRoh(SEL_PROBE)), zeile(haengendRoh(SEL_PROBE, T0 + 2 * MIN))]), "3. Anfrage: zuerst die Probe");
  assert.deepEqual(sortiert(form(dritte.slice(2))), sortiert([zeile(wartendRoh(SEL_VOLL)), zeile(haengendRoh(SEL_VOLL, T0 + 2 * MIN))]), "3. Anfrage: dann voll, mit derselben Grenze");

  // Zeitlimit: je Paar ein Signal von 8 s; Probe-Paar und volles Paar derselben Anfrage getrennt.
  for (const a of gesehen.map((g) => g.a)) assert.equal(erzeugt.get(a.signal), ABFRAGE_TIMEOUT_MS, a.url.search);
  const signale = (liste) => new Set(liste.map((a) => a.signal));
  assert.equal(signale(je(1)).size, 1, "volles Paar: ein gemeinsames Signal (wie vor der Änderungsprobe)");
  assert.equal(signale(je(2)).size, 1, "Probe-Paar: ein gemeinsames Signal");
  assert.equal(signale(dritte.slice(0, 2)).size, 1);
  assert.equal(signale(dritte.slice(2)).size, 1);
  assert.notEqual(dritte[0].signal, dritte[2].signal, "Probe und volle Abfrage einer Anfrage: je ein eigenes Signal");
  assert.equal(erzeugt.size, 4, "ein Signal je Paar, keines ohne Abfrage");
});

test("FS-P2 Erste Anfrage nur voll (2 Abfragen), jede weitere ohne Änderung nur die Probe (2 Abfragen): gleiche Einträge, neues erzeugt_am, alter_stunden mit der Uhr der Anfrage; 30 Anfragen im Takt von 60 s: genau eine volle Abfrage; die Antwort aus dem Zwischenstand gleicht der einer vollen Abfrage zur selben Uhr", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  // Einträge mit allen abgeleiteten Feldern: Urteil ABLEHNUNG, leerer Text, Freigabetext ≠ geprüfter Text,
  // ohne steps, geschützter Name im Titel, ohne Plattform, hängend mit updated_at null (Alter ab created_at).
  zeileDb(6, { review_notes: "Prüfung.\nURTEIL: ABLEHNUNG" });
  zeileDb(7, { body: "   ", title: `Lauf zu ${NAME}` });
  zeileDb(8, { body: `${TEXT} Ergänzt nach der Prüfung.`, platform: null });
  zeileDb(9, { metadata: {} });
  zeileDb(13, { status: "counsel_geprueft", updated_at: null, created_at: iso(T0 - 7 * STUNDE) });
  const erste = await hole();
  assert.equal(erste.status, 200);
  assert.deepEqual(anfragen(), VOLL, "ohne Zwischenstand: nur voll");
  assert.equal(erste.kopf.get("x-freigaben-abfrage"), "voll");
  assert.equal(erste.kopf.get("cache-control"), "no-store");
  assert.equal(erste.body.erzeugt_am, iso(T0));
  assert.equal(erste.body.fehler, null);
  assert.deepEqual(kurz(erste.body), erwartet());
  assert.deepEqual(erste.body.haengend.map((e) => [e.id, e.alter_stunden]), [["11", 3], ["12", 5], ["13", 7]]);
  // Testvoraussetzung: Die abgeleiteten Felder sind verschieden besetzt.
  const nach = (body, id) => [...body.wartend, ...body.haengend].find((e) => e.id === id);
  assert.equal(nach(erste.body, "6").counsel.urteil, "ABLEHNUNG");
  assert.equal(nach(erste.body, "7").text_leer, true);
  assert.equal(nach(erste.body, "7").title.includes(NAME), false, "Name maskiert");
  assert.equal(nach(erste.body, "8").geprueft_ungleich_freigabe, true);
  assert.equal(nach(erste.body, "9").geprueft_ungleich_freigabe, true);
  assert.equal(nach(erste.body, "1").freigabe_sperre, null);

  let letzte = erste;
  for (let takt = 1; takt < 30; takt++) {
    t.mock.timers.tick(MIN);
    const r = await hole();
    assert.equal(r.status, 200, `Takt ${takt}`);
    assert.deepEqual(anfragen(), PROBE, `Takt ${takt}: nur die Probe`);
    assert.equal(r.kopf.get("x-freigaben-abfrage"), "unveraendert", `Takt ${takt}`);
    assert.equal(r.kopf.get("cache-control"), "no-store", `Takt ${takt}`);
    assert.equal(r.body.erzeugt_am, iso(T0 + takt * MIN), `Takt ${takt}: erzeugt_am wie bisher, zur Antwort`);
    assert.deepEqual(kurz(r.body), kurz(erste.body), `Takt ${takt}: gleiche Einträge`);
    letzte = r;
  }
  assert.equal(Date.now() - T0, 29 * MIN);
  // alter_stunden mit der Uhr der Anfrage: 29 min später, eine Nachkommastelle (Stunden seit updated_at,
  // ersatzweise created_at — status-types.ts).
  assert.deepEqual(letzte.body.haengend.map((e) => [e.id, e.alter_stunden]), [["11", 3.5], ["12", 5.5], ["13", 7.5]]);
  const alterJetzt = (id) => {
    const z = fake.zeile(Number(id));
    return Math.round(((Date.now() - fake.mikrosekunden(z.updated_at ?? z.created_at) / 1000) / STUNDE) * 10) / 10;
  };
  assert.deepEqual(
    letzte.body.wartend.map((e) => [e.id, e.alter_stunden]),
    letzte.body.wartend.map((e) => [e.id, alterJetzt(e.id)]),
  );
  assert.notDeepEqual(
    letzte.body.wartend.map((e) => e.alter_stunden),
    erste.body.wartend.map((e) => e.alter_stunden),
    "Testvoraussetzung: Das Alter hat sich seit der vollen Abfrage geändert",
  );
  // Gleichlauf: dieselbe Antwort wie eine volle Abfrage zur selben Uhr — alle Felder, auch erzeugt_am.
  const voll = await vollZurSelbenUhr();
  assert.equal(voll.kopf.get("x-freigaben-abfrage"), "voll");
  assert.deepEqual(letzte.body, voll.body, "Antwort aus dem Zwischenstand = Antwort der vollen Abfrage zur selben Uhr");
});

test("FS-P3 Änderungen werden erkannt — UPDATE (neues updated_at), INSERT, DELETE, Statuswechsel, Reihenfolge: je Probe und volle Abfrage, die neuen Einträge in der Antwort, danach wieder nur die Probe; eine Änderung außerhalb beider Listen ändert nichts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const faelle = [
    ["UPDATE wartend (review_notes)", () => aktualisiere(2, { review_notes: "URTEIL: ABLEHNUNG" }), (b) => assert.equal(b.wartend.find((e) => e.id === "2").counsel.urteil, "ABLEHNUNG")],
    ["UPDATE nur updated_at", () => aktualisiere(3, {}), (b) => assert.equal(b.wartend.find((e) => e.id === "3").alter_stunden, 0)],
    ["INSERT wartend", () => zeileDb(9), (b) => assert.equal(b.wartend_gesamt, 6)],
    ["DELETE wartend", () => loesche(2), (b) => assert.equal(b.wartend_gesamt, 4)],
    ["Statuswechsel zur_freigabe → freigegeben", () => aktualisiere(1, { status: "freigegeben" }), (b) => assert.equal(b.wartend.some((e) => e.id === "1"), false)],
    ["Statuswechsel hängend → zur_freigabe", () => aktualisiere(11, { status: "zur_freigabe" }), (b) => assert.ok(b.wartend.some((e) => e.id === "11") && !b.haengend.some((e) => e.id === "11"))],
    ["UPDATE hängend (danach nicht mehr hängend)", () => aktualisiere(12, { review_notes: "neu geprüft" }), (b) => assert.equal(b.haengend_gesamt, 1)],
    ["INSERT hängend (alter Entwurf)", () => zeileDb(14, { status: "entwurf", updated_at: iso(T0 - 4 * STUNDE) }), (b) => assert.equal(b.haengend_gesamt, 3)],
    [
      "Reihenfolge (created_at getauscht, updated_at unverändert)",
      () => {
        const [a, b] = [fake.zeile(1), fake.zeile(4)];
        [a.created_at, b.created_at] = [b.created_at, a.created_at];
      },
      (b) => assert.deepEqual(b.wartend.map((e) => e.id), ["4", "2", "3", "1", "5"]),
    ],
  ];
  const { setzeFreigabenZurueck } = (await zwischenstand().catch(() => null)) ?? {};
  for (const [name, aendere, pruefe] of faelle) {
    zuruecksetzen();
    setzeFreigabenZurueck?.();
    standard();
    await hole();
    assert.deepEqual(anfragen(), VOLL, name);
    const vorher = await hole();
    assert.deepEqual(anfragen(), PROBE, `${name}: vorher nichts geändert`);
    aendere();
    const r = await hole();
    assert.equal(r.status, 200, name);
    assert.deepEqual(anfragen(), PROBE_UND_VOLL, `${name}: Probe erkennt die Änderung, dann voll`);
    assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll", name);
    assert.deepEqual(kurz(r.body), erwartet(), `${name}: die neuen Einträge`);
    pruefe(r.body);
    assert.notDeepEqual(r.body, vorher.body, `${name}: Testvoraussetzung — die Antwort hat sich geändert`);
    const danach = await hole();
    assert.deepEqual(anfragen(), PROBE, `${name}: Zwischenstand ersetzt`);
    assert.equal(danach.kopf.get("x-freigaben-abfrage"), "unveraendert", name);
    assert.deepEqual(danach.body, r.body, `${name}: dieselbe Antwort aus dem Zwischenstand`);
  }
  // Gegenkontrolle: Änderungen an Zeilen, die in keiner Liste stehen, lassen die Probe gleich.
  for (const [name, aendere] of [
    ["UPDATE freigegeben", () => aktualisiere(21, { review_notes: "nachträglich" })],
    ["UPDATE junger Entwurf (nicht hängend)", () => aktualisiere(22, { body: "neuer Entwurf" })],
    ["INSERT freigegeben", () => zeileDb(23, { status: "freigegeben" })],
  ]) {
    zuruecksetzen();
    setzeFreigabenZurueck?.();
    standard();
    const erste = await hole();
    assert.deepEqual(anfragen(), VOLL, name);
    aendere();
    const r = await hole();
    assert.deepEqual(anfragen(), PROBE, `${name}: Stapel unverändert, keine volle Abfrage`);
    assert.equal(r.kopf.get("x-freigaben-abfrage"), "unveraendert", name);
    assert.deepEqual(r.body, erste.body, name);
    assert.deepEqual(kurz(r.body), erwartet(), name);
  }
});

test("FS-P4 2-h-Grenze: Ein Entwurf, der sie überschreitet, ändert die Probe (Grenze je Anfrage neu) und führt zur vollen Abfrage; vorher und danach nur die Probe", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  // 1 h 59 min ohne Änderung: noch nicht hängend.
  zeileDb(15, { status: "entwurf", updated_at: iso(T0 - 2 * STUNDE + MIN) });
  const erste = await hole();
  assert.deepEqual(anfragen(), VOLL);
  assert.deepEqual(erste.body.haengend.map((e) => e.id), ["11", "12"]);
  assert.deepEqual(grenzen.splice(0), [iso(T0 - 2 * STUNDE)], "Grenze = Uhr der Anfrage − 2 h");

  t.mock.timers.tick(MIN);
  let r = await hole();
  assert.deepEqual(anfragen(), PROBE, "genau auf der Grenze (updated_at = Grenze): noch nicht hängend");
  assert.deepEqual(grenzen.splice(0), [iso(T0 + MIN - 2 * STUNDE)], "die Probe rechnet die Grenze neu");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "unveraendert");

  t.mock.timers.tick(1);
  r = await hole();
  assert.deepEqual(anfragen(), PROBE_UND_VOLL, "Grenze überschritten: Probe anders, volle Abfrage");
  const g = iso(T0 + MIN + 1 - 2 * STUNDE);
  assert.deepEqual(grenzen.splice(0), [g, g], "Probe und volle Abfrage einer Anfrage mit derselben Grenze");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll");
  assert.deepEqual(r.body.haengend.map((e) => e.id), ["11", "12", "15"]);
  assert.equal(r.body.haengend_gesamt, 3);
  assert.equal(r.body.haengend.find((e) => e.id === "15").alter_stunden, 2);
  assert.deepEqual(kurz(r.body), erwartet());

  t.mock.timers.tick(MIN);
  r = await hole();
  assert.deepEqual(anfragen(), PROBE, "danach wieder nur die Probe");
  assert.deepEqual(r.body.haengend.map((e) => e.id), ["11", "12", "15"]);
});

test("FS-P4b 2-h-Grenze hinter Position 50: Stehen schon 50 ältere hängende Einträge vor ihm, steht ein Entwurf, der die Grenze überschreitet, nicht in der hängenden Liste der Probe — er erhöht nur ihre Zählung; auch das ändert die Kennung, und die Route liest voll", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  for (let i = 1; i <= 3; i++) zeileDb(i);
  // 50 hängende Einträge (3 h ohne Änderung), alle älter (created_at) als der Entwurf 299.
  for (let i = 201; i <= 250; i++) zeileDb(i, { status: "entwurf", updated_at: iso(T0 - 3 * STUNDE) });
  // 1 h 59 min ohne Änderung: noch nicht hängend; nach created_at hinter allen 50.
  zeileDb(299, { status: "entwurf", updated_at: iso(T0 - 2 * STUNDE + MIN) });
  const erste = await hole();
  assert.deepEqual(anfragen(), VOLL);
  assert.deepEqual([erste.body.haengend.length, erste.body.haengend_gesamt], [50, 50]);

  // Mitlesen, was die Probe der hängenden Liste der Route liefert: ids und content-range (daraus die Zählung).
  const proben = [];
  globalThis.fetch = async (input, init = {}) => {
    const res = await FAKE_FETCH(input, init);
    const url = new URL(typeof input === "string" ? input : input.url);
    if (istProbe(url) && istHaengend(url)) {
      proben.push({ ids: (await res.clone().json()).map((z) => String(z.id)), bereich: res.headers.get("content-range") });
    }
    return res;
  };

  t.mock.timers.tick(MIN);
  let r = await hole();
  assert.deepEqual(anfragen(), PROBE, "genau auf der Grenze: noch nicht hängend, nur die Probe");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "unveraendert");
  assert.equal(proben.length, 1);
  assert.equal(proben[0].bereich, "0-49/50");

  t.mock.timers.tick(1);
  r = await hole();
  assert.equal(proben.length, 2);
  assert.equal(proben[1].ids.includes("299"), false, "der Entwurf steht nicht in der hängenden Liste der Probe (Position 51)");
  assert.deepEqual(proben[1].ids, proben[0].ids, "die hängende Liste der Probe ist dieselbe wie vorher");
  assert.equal(proben[1].bereich, "0-49/51", "nur die Zählung der Probe ist gestiegen");
  assert.deepEqual(anfragen(), PROBE_UND_VOLL, "geänderte Zählung: Kennung anders, volle Abfrage");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll");
  assert.deepEqual([r.body.haengend.length, r.body.haengend_gesamt], [50, 51]);
  assert.equal(r.body.haengend.some((e) => e.id === "299"), false, "gezeigt werden weiter die 50 ältesten");
  assert.deepEqual(kurz(r.body), erwartet());

  t.mock.timers.tick(MIN);
  r = await hole();
  assert.deepEqual(anfragen(), PROBE, "danach wieder nur die Probe");
  assert.equal(r.body.haengend_gesamt, 51);
  assert.deepEqual(kurz(r.body), erwartet());
});

test("FS-P5 Zählung jenseits der Grenzen: Mehr als 100 wartende oder 50 hängende Einträge — ein INSERT oder DELETE hinter der Grenze ändert nur die Zählung; die Probe erkennt sie, die volle Abfrage liefert sie; ein UPDATE hinter der Grenze ändert nichts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  for (let i = 1; i <= 101; i++) zeileDb(i);
  for (let i = 201; i <= 251; i++) zeileDb(i, { status: "entwurf", updated_at: iso(T0 - 3 * STUNDE) });
  const erste = await hole();
  assert.deepEqual(anfragen(), VOLL);
  assert.deepEqual([erste.body.wartend.length, erste.body.wartend_gesamt, erste.body.haengend.length, erste.body.haengend_gesamt], [100, 101, 50, 51]);

  const faelle = [
    ["INSERT wartend hinter der Grenze", () => zeileDb(102), [100, 102, 50, 51]],
    ["DELETE wartend hinter der Grenze", () => loesche(102), [100, 101, 50, 51]],
    ["INSERT hängend hinter der Grenze", () => zeileDb(252, { status: "entwurf", updated_at: iso(T0 - 3 * STUNDE) }), [100, 101, 50, 52]],
    ["Statuswechsel hängend hinter der Grenze", () => aktualisiere(252, { status: "abgelehnt" }), [100, 101, 50, 51]],
  ];
  for (const [name, aendere, zahlen] of faelle) {
    const vorher = await hole();
    assert.deepEqual(anfragen(), PROBE, `${name}: vorher nichts geändert`);
    aendere();
    const r = await hole();
    assert.deepEqual(anfragen(), PROBE_UND_VOLL, `${name}: nur die Zählung anders — Probe, dann voll`);
    assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll", name);
    assert.deepEqual([r.body.wartend.length, r.body.wartend_gesamt, r.body.haengend.length, r.body.haengend_gesamt], zahlen, name);
    assert.deepEqual(kurz(r.body).wartend, kurz(vorher.body).wartend, `${name}: die gezeigten Einträge bleiben`);
    assert.deepEqual(kurz(r.body), erwartet(), name);
  }
  // Gegenkontrolle: UPDATE des 101. wartenden Eintrags — weder Liste noch Zählung ändern sich.
  aktualisiere(101, { review_notes: "nachgeprüft" });
  const r = await hole();
  assert.deepEqual(anfragen(), PROBE, "UPDATE hinter der Grenze: Antwort unverändert, keine volle Abfrage");
  assert.deepEqual(kurz(r.body), erwartet());
});

test("FS-P6 Höchstdauer 30 min ab Beginn der vollen Abfrage: knapp darunter nur die Probe, ab 30 min voll — auch ohne Änderung; Uhr zurückgestellt: voll", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  // Jede volle Abfrage dauert 4 s (die wartende des Paars); die 30 min zählen ab ihrem Beginn.
  welt.vorAntwort = async (a) => {
    if (istVoll(urlVon(a)) && istWartend(urlVon(a))) t.mock.timers.tick(4_000);
  };
  const MIN30 = 30 * MIN;
  const erste = await hole();
  assert.deepEqual(anfragen(), VOLL);
  assert.equal(erste.body.erzeugt_am, iso(T0 + 4_000));

  t.mock.timers.setTime(T0 + MIN30 - 1);
  let r = await hole();
  assert.deepEqual(anfragen(), PROBE, "29:59,999 min nach Beginn der vollen Abfrage: nur die Probe");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "unveraendert");

  t.mock.timers.tick(1);
  r = await hole();
  assert.deepEqual(anfragen(), VOLL, "30 min: voll, ohne Probe — auch ohne Änderung");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll");
  assert.deepEqual(kurz(r.body), kurz(erste.body));

  // Die Frist beginnt mit der neuen vollen Abfrage (T0 + 30 min) neu.
  t.mock.timers.setTime(T0 + 2 * MIN30 - 1);
  r = await hole();
  assert.deepEqual(anfragen(), PROBE);

  // Uhr zurückgestellt (vor den Beginn der letzten vollen Abfrage): Alter unbestimmbar → voll.
  t.mock.timers.setTime(T0 + MIN30 - 1);
  r = await hole();
  assert.deepEqual(anfragen(), VOLL, "Uhr zurückgestellt");
  t.mock.timers.tick(MIN);
  r = await hole();
  assert.deepEqual(anfragen(), PROBE, "danach wieder im Takt nur die Probe");

  const { FREIGABEN_VOLL_SPAETESTENS_MS } = await zwischenstand();
  assert.equal(FREIGABEN_VOLL_SPAETESTENS_MS, MIN30);
});

test("FS-P7 Probe scheitert — in jeder der beiden Abfragen: Lesefehler, Zeitüberschreitung, Objekt statt Zeilenliste, fehlende oder unlesbare Zählung, Zeile ohne id oder updated_at: 502 mit leeren Listen, ohne Header und ohne volle Abfrage, nie aus dem Zwischenstand; der Zwischenstand bleibt", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  const erste = await hole();
  assert.deepEqual(anfragen(), VOLL);
  const stand = (await zwischenstand()).gueltigerFreigabenStand(Date.now());
  assert.ok(stand, "Zwischenstand nach der ersten Anfrage");
  const zeit = "2026-11-01T08:01:00.000000+00:00";
  const OHNE_LISTE = "Supabase nicht lesbar: Änderungsprobe: Antwort ohne Zeilenliste";
  const OHNE_ID = "Supabase nicht lesbar: Änderungsprobe: Zeile ohne id oder updated_at";
  const faelle = [
    ["Lesefehler", { stoerung: { status: 500, body: { code: "XX000", message: `kaputt: ${SERVICE} bei https://abc.supabase.co/rest/v1/content` } } }, "Supabase nicht lesbar: kaputt: [entfernt] bei [URL]"],
    ["Zeitüberschreitung", { abbruch: true }, "Supabase nicht lesbar: Zeitüberschreitung (8 s)"],
    ["Objekt statt Liste", { ersatz: { body: { zeilen: [] }, bereich: "0-0/1" } }, OHNE_LISTE],
    ["null statt Liste", { ersatz: { body: null, bereich: "*/0" } }, OHNE_LISTE],
    ["Zählung fehlt", { ersatz: { body: [] } }, "Supabase nicht lesbar: Zählung ohne Ergebnis"],
    ["Zählung unlesbar", { ersatz: { body: [], bereich: "*/*" } }, "Supabase nicht lesbar: Änderungsprobe: Zählung unlesbar"],
    ["Zeile ohne id", { ersatz: { body: [{ updated_at: zeit }], bereich: "0-0/1" } }, OHNE_ID],
    ["id null", { ersatz: { body: [{ id: null, updated_at: zeit }], bereich: "0-0/1" } }, OHNE_ID],
    ["Zeile ohne updated_at", { ersatz: { body: [{ id: 1 }], bereich: "0-0/1" } }, OHNE_ID],
    ["updated_at keine Zeichenkette", { ersatz: { body: [{ id: 1, updated_at: 5 }], bereich: "0-0/1" } }, OHNE_ID],
    ["Zeile kein Objekt", { ersatz: { body: [3], bereich: "0-0/1" } }, OHNE_ID],
  ];
  for (const [liste, trifft] of [
    ["wartend", istWartend],
    ["hängend", istHaengend],
  ]) {
    for (const [name, art, grund] of faelle) {
      const probe = (url) => istProbe(url) && trifft(url);
      globalThis.fetch = FAKE_FETCH;
      welt.stoerung = art.stoerung ? (a) => (probe(urlVon(a)) ? art.stoerung : null) : null;
      welt.vorAntwort = art.abbruch
        ? async (a) => {
            if (probe(urlVon(a))) throw abbruch();
          }
        : null;
      if (art.ersatz) ersetzeAntwort(probe, art.ersatz);
      t.mock.timers.tick(MIN);
      const r = await hole();
      const fall = `Probe ${liste}, ${name}`;
      assert.equal(r.status, 502, fall);
      assert.deepEqual(r.body, fehlerBody(grund, erste.body.quelle), `${fall}: Fehler mit leeren Listen, nie der Zwischenstand`);
      assert.equal(r.kopf.get("cache-control"), "no-store", fall);
      assert.equal(r.kopf.get("x-freigaben-abfrage"), null, fall);
      assert.deepEqual(anfragen(), PROBE, `${fall}: keine volle Abfrage`);
      assert.equal((await zwischenstand()).gueltigerFreigabenStand(Date.now()), stand, `${fall}: derselbe Zwischenstand`);
    }
  }
  globalThis.fetch = FAKE_FETCH;
  welt.stoerung = null;
  welt.vorAntwort = null;
  t.mock.timers.tick(MIN);
  const danach = await hole();
  assert.deepEqual(anfragen(), PROBE, "Zwischenstand noch da");
  assert.equal(danach.kopf.get("x-freigaben-abfrage"), "unveraendert");
  assert.deepEqual(kurz(danach.body), kurz(erste.body));
});

test("FS-P8 Volle Abfrage scheitert — nach geänderter Probe und ohne Zwischenstand, in jeder der beiden Abfragen: 502 wie vor der Änderungsprobe, ohne Header; der Zwischenstand bleibt derselbe; die nächste Anfrage liest Probe und voll und liefert die neuen Einträge", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  const faelle = [
    ["Lesefehler", { stoerung: { status: 500, body: { code: "XX000", message: "kaputt" } } }, "Supabase nicht lesbar: kaputt"],
    ["Zeitüberschreitung", { abbruch: true }, "Supabase nicht lesbar: Zeitüberschreitung (8 s)"],
    ["Objekt statt Liste", { ersatz: { body: { id: 1 }, bereich: "0-0/1" } }, "Supabase nicht lesbar: Antwort ohne Zeilenliste"],
    ["Zählung fehlt", { ersatz: { body: [] } }, "Supabase nicht lesbar: Zählung ohne Ergebnis"],
    ["Zeile ohne created_at", { ersatz: { body: [{ id: 1, status: "zur_freigabe", updated_at: null }], bereich: "0-0/1" } }, "Supabase nicht lesbar: Eintrag 1 ohne lesbares created_at"],
  ];
  async function volleAbfrageScheitert(wann, erwartetAnfragen, stand) {
    for (const [liste, trifft] of [
      ["wartend", istWartend],
      ["hängend", istHaengend],
    ]) {
      for (const [name, art, grund] of faelle) {
        const voll = (url) => istVoll(url) && trifft(url);
        globalThis.fetch = FAKE_FETCH;
        welt.stoerung = art.stoerung ? (a) => (voll(urlVon(a)) ? art.stoerung : null) : null;
        welt.vorAntwort = art.abbruch
          ? async (a) => {
              if (voll(urlVon(a))) throw abbruch();
            }
          : null;
        if (art.ersatz) ersetzeAntwort(voll, art.ersatz);
        t.mock.timers.tick(MIN);
        const r = await hole();
        const fall = `${wann}, volle Abfrage ${liste}, ${name}`;
        assert.equal(r.status, 502, fall);
        assert.equal(r.body.fehler, grund, fall);
        assert.deepEqual(r.body, fehlerBody(grund, r.body.quelle), fall);
        assert.equal(r.kopf.get("cache-control"), "no-store", fall);
        assert.equal(r.kopf.get("x-freigaben-abfrage"), null, `${fall}: kein Header`);
        assert.deepEqual(anfragen(), erwartetAnfragen, fall);
        assert.equal((await zwischenstand()).gueltigerFreigabenStand(Date.now()), stand, `${fall}: Zwischenstand nicht ersetzt, nicht geleert`);
      }
    }
    globalThis.fetch = FAKE_FETCH;
    welt.stoerung = null;
    welt.vorAntwort = null;
  }

  await volleAbfrageScheitert("ohne Zwischenstand", VOLL, null);
  const erste = await hole();
  assert.deepEqual([erste.status, erste.kopf.get("x-freigaben-abfrage"), anfragen()], [200, "voll", VOLL], "Gegenkontrolle: die 200 trägt den Header");
  const stand = (await zwischenstand()).gueltigerFreigabenStand(Date.now());
  assert.ok(stand);
  aktualisiere(2, { review_notes: "URTEIL: ABLEHNUNG" });
  await volleAbfrageScheitert("nach geänderter Probe", PROBE_UND_VOLL, stand);

  t.mock.timers.tick(MIN);
  const r = await hole();
  assert.equal(r.status, 200);
  assert.deepEqual(anfragen(), PROBE_UND_VOLL, "wieder voll gelesen, nicht der alte Zwischenstand");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll");
  assert.equal(r.body.wartend.find((e) => e.id === "2").counsel.urteil, "ABLEHNUNG");
  assert.deepEqual(kurz(r.body), erwartet());
  await hole();
  assert.deepEqual(anfragen(), PROBE);
});

test("FS-P9 Wettlauf: Ändert sich zwischen Probe und voller Abfrage noch etwas, trägt der Zwischenstand die Kennung der vollen Zeilen — die nächste Anfrage ohne weitere Änderung liest nur die Probe", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  await hole();
  assert.deepEqual(anfragen(), VOLL);
  aktualisiere(1, { review_notes: "URTEIL: ABLEHNUNG" });
  let einmal = true;
  welt.vorAntwort = async (a) => {
    if (einmal && istVoll(urlVon(a))) {
      einmal = false;
      aktualisiere(3, { review_notes: "zwischen Probe und voller Abfrage geändert" });
    }
  };
  const r = await hole();
  assert.deepEqual(anfragen(), PROBE_UND_VOLL);
  assert.equal(r.body.wartend.find((e) => e.id === "3").alter_stunden, 0, "die vollen Zeilen tragen die zweite Änderung");
  welt.vorAntwort = null;
  const danach = await hole();
  assert.deepEqual(anfragen(), PROBE, "Kennung des Zwischenstands = Kennung der vollen Zeilen");
  assert.equal(danach.kopf.get("x-freigaben-abfrage"), "unveraendert");
  assert.deepEqual(danach.body, r.body);
});

test("FS-P10a Gleichzeitig: Endet eine ältere volle Abfrage zuletzt, wird der Zwischenstand älter — die nächste Anfrage erkennt das mit der Probe und liest voll, nie ein veralteter Stapel", TOR_TEST_GRENZE, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  const S1 = erwartet();
  const torA = tor();
  halteNachAntwort((url) => istVoll(url) && istWartend(url), torA);
  const anfrageA = hole();
  await bisAmTor(torA, anfrageA);
  aktualisiere(2, { status: "freigegeben" });
  const S2 = erwartet();
  const b = await hole();
  assert.deepEqual(kurz(b.body), S2, "B: noch kein Zwischenstand, liest voll");
  const c = await hole();
  assert.deepEqual([c.kopf.get("x-freigaben-abfrage"), kurz(c.body)], ["unveraendert", S2]);
  torA.oeffnen();
  const a = await anfrageA;
  assert.equal(a.status, 200);
  assert.deepEqual(kurz(a.body), S1, "A liefert den Stand vom Beginn ihrer Abfrage");
  assert.deepEqual(anfragen(), [...VOLL, ...VOLL, ...PROBE].sort());
  const speicher = await zwischenstand();
  assert.deepEqual(speicher.gueltigerFreigabenStand(Date.now()).wartend.zeilen.map((z) => String(z.id)), S1.wartend, "A endete zuletzt: Zwischenstand jetzt der ältere");
  const d = await hole();
  assert.deepEqual(anfragen(), PROBE_UND_VOLL, "die Probe erkennt den älteren Zwischenstand");
  assert.deepEqual([d.kopf.get("x-freigaben-abfrage"), kurz(d.body)], ["voll", S2], "kein veralteter Stapel");
  const e = await hole();
  assert.deepEqual([anfragen(), kurz(e.body)], [PROBE, S2]);
});

test("FS-P10b Gleichzeitig: Speichert eine ältere volle Abfrage während der Probe den alten Stand, antwortet die Anfrage mit den Zeilen, gegen die ihre Probe verglichen hat — nie mit dem alten Stand", TOR_TEST_GRENZE, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  const S1 = erwartet();
  const torA0 = tor();
  const torA = tor();
  // Erste volle Abfrage (A0) und erste Probe (A) je am eigenen Tor.
  let a0Frei = true;
  let aFrei = true;
  globalThis.fetch = async (input, init = {}) => {
    const res = await FAKE_FETCH(input, init);
    const url = new URL(typeof input === "string" ? input : input.url);
    if (a0Frei && istVoll(url) && istWartend(url)) {
      a0Frei = false;
      await torA0.warte();
    } else if (aFrei && istProbe(url) && istWartend(url)) {
      aFrei = false;
      await torA.warte();
    }
    return res;
  };
  const anfrageA0 = hole();
  await bisAmTor(torA0, anfrageA0);
  aktualisiere(2, { status: "freigegeben" });
  const S2 = erwartet();
  const b = await hole();
  assert.deepEqual(kurz(b.body), S2, "B speichert S2");
  const anfrageA = hole();
  await bisAmTor(torA, anfrageA);
  torA0.oeffnen();
  const antwortA0 = await anfrageA0;
  assert.deepEqual(kurz(antwortA0.body), S1, "A0 liefert den Stand vom Beginn ihrer Abfrage");
  assert.deepEqual(
    (await zwischenstand()).gueltigerFreigabenStand(Date.now()).wartend.zeilen.map((z) => String(z.id)),
    S1.wartend,
    "A0 endete zuletzt: Zwischenstand jetzt S1",
  );
  torA.oeffnen();
  const a = await anfrageA;
  assert.equal(a.status, 200);
  assert.equal(a.kopf.get("x-freigaben-abfrage"), "unveraendert");
  assert.deepEqual(kurz(a.body), S2, "A: Die Probe sah S2 und verglich gegen S2 — nie S1");
  assert.deepEqual(anfragen(), [...VOLL, ...VOLL, ...PROBE].sort());
});

test("FS-P10c Gleichzeitig: Sieht die Probe noch den alten Stand, während eine andere Anfrage den neuen speichert, antwortet die Anfrage mit den Zeilen, gegen die ihre Probe verglichen hat", TOR_TEST_GRENZE, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  const S1 = erwartet();
  await hole();
  assert.deepEqual(anfragen(), VOLL);
  const torA = tor();
  halteNachAntwort((url) => istProbe(url) && istWartend(url), torA);
  const anfrageA = hole();
  await bisAmTor(torA, anfrageA);
  aktualisiere(2, { status: "freigegeben" });
  const S2 = erwartet();
  const b = await hole();
  assert.deepEqual([b.kopf.get("x-freigaben-abfrage"), kurz(b.body)], ["voll", S2], "B speichert S2");
  torA.oeffnen();
  const a = await anfrageA;
  assert.equal(a.kopf.get("x-freigaben-abfrage"), "unveraendert");
  assert.deepEqual(kurz(a.body), S1, "A: die Zeilen, gegen die ihre Probe verglich (S1), nicht der inzwischen gespeicherte Stand S2");
  assert.deepEqual(anfragen(), [...PROBE, ...PROBE_UND_VOLL].sort());
});

test("FS-P11 Mit Zwischenstand: fehlender Schlüssel → 502 wie bisher ohne Abfrage, unerwartete Ausnahme → 500 wie bisher — beide ohne Einträge und ohne Header; danach gilt der Zwischenstand weiter", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  const erste = await hole();
  assert.deepEqual(anfragen(), VOLL);
  await hole();
  assert.deepEqual(anfragen(), PROBE, "Zwischenstand vorhanden");
  delete process.env.SUPABASE_SERVICE_KEY;
  let r = await hole();
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, fehlerBody("Supabase nicht lesbar: Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt", erste.body.quelle));
  assert.equal(r.kopf.get("x-freigaben-abfrage"), null);
  assert.equal(r.kopf.get("cache-control"), "no-store");
  assert.deepEqual(anfragen(), [], "Supabase nicht abgefragt");
  process.env.SUPABASE_SERVICE_KEY = SERVICE;
  const zeitlimit = t.mock.method(AbortSignal, "timeout", () => {
    throw new Error("unerwartet");
  });
  r = await hole();
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, fehlerBody("Freigaben nicht ermittelbar: unerwartet", erste.body.quelle));
  assert.equal(r.kopf.get("x-freigaben-abfrage"), null);
  assert.deepEqual(anfragen(), []);
  zeitlimit.mock.restore();
  r = await hole();
  assert.deepEqual(anfragen(), PROBE);
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "unveraendert");
  assert.deepEqual(r.body, erste.body);
});

test("FS-P12 Zeitlimit je Paar: Probe 3 s und volle Abfrage 6 s — zusammen über 8 s, jedes Paar darunter: nach einer Änderung 200 voll, danach wieder nur die Probe; erst ein Paar, das selbst 8 s braucht, scheitert", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const dauert = zeitlimitsAufAttrappenUhr(t);
  standard();
  let probeMs = 3_000;
  let vollMs = 6_000;
  // Je Paar braucht die wartende Abfrage die Zeit; die hängende teilt das Signal und ist sofort fertig.
  welt.vorAntwort = async (a) => {
    const url = urlVon(a);
    if (istProbe(url)) await dauert(a, istWartend(url) ? probeMs : 0);
    else if (istVoll(url)) await dauert(a, istWartend(url) ? vollMs : 0);
  };
  let r = await hole();
  assert.deepEqual([r.status, anfragen()], [200, VOLL]);
  assert.equal(r.body.erzeugt_am, iso(T0 + 6_000));
  t.mock.timers.setTime(T0 + MIN);
  r = await hole();
  assert.deepEqual([r.status, r.kopf.get("x-freigaben-abfrage"), anfragen()], [200, "unveraendert", PROBE]);

  aktualisiere(2, { review_notes: "URTEIL: ABLEHNUNG" });
  t.mock.timers.setTime(T0 + 2 * MIN);
  r = await hole();
  assert.equal(r.status, 200, `Probe 3 s, dann volle Abfrage 6 s mit eigenen 8 s: ${JSON.stringify(r.body.fehler)}`);
  assert.deepEqual(anfragen(), PROBE_UND_VOLL);
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll");
  assert.equal(r.body.wartend.find((e) => e.id === "2").counsel.urteil, "ABLEHNUNG");
  assert.equal(r.body.erzeugt_am, iso(T0 + 2 * MIN + 9_000), "nach 3 s Probe und 6 s voller Abfrage");
  t.mock.timers.setTime(T0 + 3 * MIN);
  r = await hole();
  assert.deepEqual([r.status, r.kopf.get("x-freigaben-abfrage"), anfragen()], [200, "unveraendert", PROBE], "Zwischenstand ersetzt");

  // Gegenkontrolle: Braucht ein Paar selbst 8 s, bricht sein eigenes Signal es ab.
  const stand = (await zwischenstand()).gueltigerFreigabenStand(Date.now());
  assert.ok(stand);
  probeMs = 8_000;
  t.mock.timers.setTime(T0 + 4 * MIN);
  r = await hole();
  assert.deepEqual([r.status, r.body.fehler, anfragen()], [502, "Supabase nicht lesbar: Zeitüberschreitung (8 s)", PROBE], "Probe 8 s");
  assert.equal(Date.now() - (T0 + 4 * MIN), 8_000, "Probe nach 8 s abgebrochen");
  probeMs = 3_000;
  vollMs = 8_000;
  aktualisiere(3, { review_notes: "URTEIL: ABLEHNUNG" });
  t.mock.timers.setTime(T0 + 5 * MIN);
  r = await hole();
  assert.deepEqual([r.status, r.body.fehler, anfragen()], [502, "Supabase nicht lesbar: Zeitüberschreitung (8 s)", PROBE_UND_VOLL], "volle Abfrage 8 s");
  assert.equal(Date.now() - (T0 + 5 * MIN), 11_000, "3 s Probe, dann 8 s volle Abfrage bis zum Abbruch");
  assert.equal((await zwischenstand()).gueltigerFreigabenStand(Date.now()), stand, "Zwischenstand unverändert");
});

test("FS-P13 Leerer Stapel: Auch ein leerer Zwischenstand gilt — die nächste Anfrage stellt nur die Probe; ein INSERT in den leeren Stapel und das Löschen des letzten Eintrags erkennt sie", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  zeileDb(21, { status: "freigegeben" });
  const erste = await hole();
  assert.deepEqual([erste.status, erste.kopf.get("x-freigaben-abfrage"), kurz(erste.body), anfragen()], [200, "voll", { wartend: [], wartend_gesamt: 0, haengend: [], haengend_gesamt: 0 }, VOLL]);
  const zweite = await hole();
  assert.deepEqual([anfragen(), zweite.kopf.get("x-freigaben-abfrage")], [PROBE, "unveraendert"], "leerer Stapel, nichts geändert: nur die Probe");
  assert.deepEqual(zweite.body, erste.body);

  zeileDb(1);
  const dritte = await hole();
  assert.deepEqual([anfragen(), dritte.kopf.get("x-freigaben-abfrage"), kurz(dritte.body).wartend], [PROBE_UND_VOLL, "voll", ["1"]], "INSERT in den leeren Stapel");
  loesche(1);
  const vierte = await hole();
  assert.deepEqual([anfragen(), vierte.kopf.get("x-freigaben-abfrage"), kurz(vierte.body).wartend], [PROBE_UND_VOLL, "voll", []], "letzter Eintrag gelöscht");
  const fuenfte = await hole();
  assert.deepEqual([anfragen(), fuenfte.kopf.get("x-freigaben-abfrage")], [PROBE, "unveraendert"], "wieder leer, nichts geändert: nur die Probe");
});

test("FS-P14 Kennung und Zwischenstand (lib/freigaben-cache.ts): je Liste Zählung, Reihenfolge, ids und updated_at; andere Spalten nicht; unlesbare Zeilen oder Zählungen → keine Kennung; gültig ab vollAm bis unter 30 min, mit dem Lesefehler eines Videos bis unter 90 s (Nachtrag d1-regression-2, d2-stapel-3)", async () => {
  const C = await zwischenstand();
  assert.equal(C.FREIGABEN_PROBE_SPALTEN, "id,updated_at,metadata->medium_id");
  assert.equal(C.FREIGABEN_ABFRAGE_HEADER, "x-freigaben-abfrage");
  const a = { id: 1, updated_at: "2026-11-09T08:00:00.000001+00:00", title: "A" };
  const b = { id: 2, updated_at: null, title: "B" };
  const L = (zeilen, gesamt = zeilen.length) => ({ zeilen, gesamt });
  const K = (w, h = L([])) => C.freigabenKennung(w, h);
  assert.equal(typeof K(L([])), "string", "leerer Stapel hat eine Kennung");
  assert.equal(K(L([a, b])), K(L([{ id: 1, updated_at: a.updated_at }, { id: 2, updated_at: null, body: "x" }])), "andere Spalten zählen nicht");
  assert.notEqual(K(L([a, b])), K(L([b, a])), "Reihenfolge");
  assert.notEqual(K(L([a])), K(L([a, b])), "Anzahl der Zeilen");
  assert.notEqual(K(L([a], 1)), K(L([a], 101)), "Zählung wartend");
  assert.notEqual(K(L([]), L([a], 1)), K(L([]), L([a], 51)), "Zählung hängend");
  assert.notEqual(K(L([a])), K(L([{ ...a, updated_at: "2026-11-09T08:00:00.000002+00:00" }])), "updated_at");
  assert.notEqual(K(L([b])), K(L([{ ...b, updated_at: "2026-11-09T08:00:00+00:00" }])), "updated_at null → gesetzt");
  assert.notEqual(K(L([a])), K(L([{ ...a, id: 3 }])), "id");
  assert.notEqual(K(L([a]), L([])), K(L([]), L([a])), "Liste: wartend ≠ hängend");
  for (const kaputt of [[null], [7], ["x"], [{ updated_at: null }], [{ id: null, updated_at: null }], [{ id: "", updated_at: null }], [{ id: 1 }], [{ id: 1, updated_at: 5 }], [a, { id: 2 }]]) {
    assert.equal(K(L(kaputt)), null, `wartend ${JSON.stringify(kaputt)}`);
    assert.equal(K(L([]), L(kaputt)), null, `hängend ${JSON.stringify(kaputt)}`);
  }
  for (const gesamt of [Number.NaN, -1, 1.5, "1", null, undefined, Number.POSITIVE_INFINITY]) {
    assert.equal(K({ zeilen: [a], gesamt }), null, `Zählung wartend ${String(gesamt)}`);
    assert.equal(K(L([]), { zeilen: [a], gesamt }), null, `Zählung hängend ${String(gesamt)}`);
  }
  C.setzeFreigabenZurueck();
  assert.equal(C.gueltigerFreigabenStand(1_000), null, "leer");
  const w = L([a, b]);
  const h = L([], 0);
  C.merkeFreigaben(w, h, 1_000);
  const s = C.gueltigerFreigabenStand(1_000);
  assert.deepEqual(s, { kennung: K(w, h), wartend: w, haengend: h, medien: { kennung: "", daten: null }, vollAm: 1_000, gueltigMs: C.FREIGABEN_VOLL_SPAETESTENS_MS });
  assert.equal(s.wartend, w, "die rohen Zeilen, nicht kopiert oder abgeleitet");
  assert.equal(C.gueltigerFreigabenStand(1_000 + C.FREIGABEN_VOLL_SPAETESTENS_MS - 1), s, "knapp unter 30 min");
  assert.equal(C.gueltigerFreigabenStand(1_000 + C.FREIGABEN_VOLL_SPAETESTENS_MS), null, "30 min");
  assert.equal(C.gueltigerFreigabenStand(999), null, "Uhr vor vollAm");
  C.merkeFreigaben(L([{ title: "ohne id", updated_at: null }]), h, 2_000);
  assert.equal(C.gueltigerFreigabenStand(2_000), null, "ohne Kennung kein Zwischenstand, auch der vorige nicht");
  C.merkeFreigaben(w, h, 3_000);
  assert.notEqual(C.gueltigerFreigabenStand(3_000), null);
  C.merkeFreigaben(L([a], Number.NaN), h, 4_000);
  assert.equal(C.gueltigerFreigabenStand(4_000), null, "unlesbare Zählung: kein Zwischenstand");
  C.merkeFreigaben(w, h, 5_000);
  C.setzeFreigabenZurueck();
  assert.equal(C.gueltigerFreigabenStand(5_000), null, "zurückgesetzt");
  // Mit dem Lesefehler eines Videos: Höchstalter 90 s statt 30 min (Nachtrag d2-stapel-3).
  assert.equal(C.FREIGABEN_FEHLERSTAND_MS, 90_000);
  C.merkeFreigaben(w, h, 6_000, { kennung: "", daten: null }, C.FREIGABEN_FEHLERSTAND_MS);
  assert.equal(C.gueltigerFreigabenStand(6_000 + C.FREIGABEN_FEHLERSTAND_MS - 1).gueltigMs, C.FREIGABEN_FEHLERSTAND_MS, "knapp unter 90 s");
  assert.equal(C.gueltigerFreigabenStand(6_000 + C.FREIGABEN_FEHLERSTAND_MS), null, "90 s");
});

// ═══ Mutationsprüfung (09.11.2026) ═══
// Je Test in Klammern der Mutant, der vorher die ganze Suite überlebte (Mutationslauf gegen c5442fa in einer
// eigenen Kopie). Jeder Test ist mit seinem Mutanten rot und ohne ihn grün; Produktcode unverändert. FS-M1 und
// FS-M2 stehen in tests/c-poll-sichtbarkeit.test.mjs.

test("FS-M3 (P40) Nach einer Probe, die Zeit braucht, rechnet die volle Abfrage alter_stunden mit der Uhr der Anfrage (wie vor der Änderungsprobe und wie die Antwort aus dem Zwischenstand), nicht mit der Uhr nach der Probe — an der Rundungsgrenze: 179 s alt bei Beginn der Anfrage = 0,0 h; 182 s (nach 3 s Probe) wären 0,1 h", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  standard();
  await hole();
  assert.deepEqual(anfragen(), VOLL);
  // Eintrag 2 ändert sich 179 s vor Beginn der nächsten Anfrage; updated_at setzt der Trigger.
  const beginn = T0 + 10 * MIN;
  t.mock.timers.setTime(beginn - 179_000);
  aktualisiere(2, { review_notes: "URTEIL: ABLEHNUNG" });
  t.mock.timers.setTime(beginn);
  // Die Probe braucht 3 s (die wartende Abfrage des Paars), die volle Abfrage keine Zeit.
  welt.vorAntwort = async (a) => {
    if (istProbe(urlVon(a)) && istWartend(urlVon(a))) t.mock.timers.tick(3_000);
  };
  const r = await hole();
  welt.vorAntwort = null;
  assert.deepEqual(anfragen(), PROBE_UND_VOLL, "Änderung erkannt: Probe, dann voll");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll");
  assert.equal(r.body.erzeugt_am, iso(beginn + 3_000), "Testvoraussetzung: Die Probe hat 3 s gebraucht");
  const eintrag = r.body.wartend.find((e) => e.id === "2");
  assert.equal(eintrag.counsel.urteil, "ABLEHNUNG", "die volle Abfrage trägt die Änderung");
  assert.equal(eintrag.alter_stunden, 0, "179 s bei Beginn der Anfrage = 0,0 h; mit der Uhr nach der Probe wären es 182 s = 0,1 h");

  // Gegenkontrolle: Die Rundungsgrenze liegt zwischen 179 s und 182 s. Dieselbe Zeile, 182 s alt bei Beginn der
  // nächsten Anfrage (Antwort aus dem Zwischenstand), ist 0,1 h alt.
  const danach = await hole();
  assert.deepEqual(anfragen(), PROBE);
  assert.equal(danach.kopf.get("x-freigaben-abfrage"), "unveraendert");
  assert.equal(danach.body.wartend.find((e) => e.id === "2").alter_stunden, 0.1, "182 s bei Beginn der Anfrage = 0,1 h");
});

test("FS-M4 (P48) Höchstdauer nach einer Probe, die Zeit braucht: Die 30 min zählen ab der Uhr unmittelbar vor der vollen Abfrage (vollAm), nicht ab Beginn der Anfrage und nicht ab ihrem Ende — Probe 3 s, volle Abfrage 4 s: bis vollAm + 30 min − 1 ms nur die Probe, ab vollAm + 30 min voll", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const MIN30 = 30 * MIN;
  standard();
  await hole();
  assert.deepEqual(anfragen(), VOLL);
  const beginn = T0 + MIN;
  t.mock.timers.setTime(beginn);
  aktualisiere(2, { review_notes: "URTEIL: ABLEHNUNG" });
  // Nach der Änderung braucht die Anfrage die Probe (3 s) und die volle Abfrage (4 s), je die wartende des Paars.
  welt.vorAntwort = async (a) => {
    const url = urlVon(a);
    if (istProbe(url) && istWartend(url)) t.mock.timers.tick(3_000);
    if (istVoll(url) && istWartend(url)) t.mock.timers.tick(4_000);
  };
  const geaendert = await hole();
  welt.vorAntwort = null;
  assert.deepEqual(anfragen(), PROBE_UND_VOLL, "Änderung erkannt: Probe, dann voll");
  assert.equal(geaendert.kopf.get("x-freigaben-abfrage"), "voll");
  assert.equal(geaendert.body.erzeugt_am, iso(beginn + 7_000), "Testvoraussetzung: 3 s Probe, dann 4 s volle Abfrage");
  const vollAm = beginn + 3_000;

  // Ab hier dauern die Abfragen keine Zeit; die Uhr stellt nur der Test.
  t.mock.timers.setTime(vollAm + MIN30 - 1);
  let r = await hole();
  assert.deepEqual(anfragen(), PROBE, "29:59,999 min nach Beginn der vollen Abfrage (30:02,999 min nach Beginn der Anfrage): nur die Probe");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "unveraendert");
  assert.deepEqual(kurz(r.body), kurz(geaendert.body));

  t.mock.timers.tick(1);
  r = await hole();
  assert.deepEqual(anfragen(), VOLL, "30 min nach Beginn der vollen Abfrage (29:56 min nach ihrem Ende): voll, ohne Probe");
  assert.equal(r.kopf.get("x-freigaben-abfrage"), "voll");
  assert.deepEqual(kurz(r.body), kurz(geaendert.body));
});
