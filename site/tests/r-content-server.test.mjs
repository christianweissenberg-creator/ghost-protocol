// Objekt-Studio Schritt 3 (08.11.2026): /content liest die Tabelle content über den Server.
// Lauf: npm test.
//
// Teil L — Leser und Grenzen (lib/content-liste.ts), rein und ohne Netz.
// Teil R — GET /api/content/liste und GET /api/content/eintrag/[id] laufen im Prozess gegen die
//   PostgREST-Attrappe aus tests/harness/fake.mjs: dieselbe Abfrage wie vorher im Browser (Spalten,
//   Filter, Sortierung, Grenze), Service-Schlüssel, Fehler mit "fehler" und "fehler_art", no-store,
//   Segment-Config. Dazu: Die Middleware (nur gelesen) schützt beide Pfade.
// Teil S — die Seite mit Hook-Laufzeit, fetch-Attrappe und Attrappen-Uhren von node:test: erste
//   Abfrage, Takt 15 s, Stand-Zeile, Fehler mit und ohne gelesene Liste, verborgener Tab, Abbau,
//   Vorrang lokaler Änderungen, Überholen, Zeitlimit, Neulesen nach einem Lauf, Neuladen einer Zeile;
//   seit der Prüfung vom 09.11.2026 auch: sofort neu lesen nach einer verworfenen Abfrage, keine Abfrage
//   nach dem Verlassen, Abbau und Wiederaufbau wie im Strict Mode.
// Teil Z — Simulation: Der Supabase-Client des Browsers hat keine Rechte auf content (anon und
//   authenticated). Jeder Zugriff scheitert wie bei PostgREST ohne Recht (42501, HTTP 401), Realtime
//   liefert nichts. /content und das Objekt-Studio zeigen trotzdem alle Zeilen — über die echten Routen
//   im Prozess.
// Teil M — Mutationsprüfung (09.11.2026): no-store auf jeder Antwort beider Routen, gelesen_am nach der
//   Abfrage, 500 programmfehler bei einer unerwarteten Ausnahme, Antwort ohne lesbares JSON auf der Seite.
// Kein Netz: Jeder Abruf geht an eine Attrappe oder wirft. Die Umgebungswerte unten sind Test-Werte
// dieses Prozesses, keine echten Schlüssel. Module werden je Test geladen: Fehlt eines (Stand vor
// Schritt 3), scheitert der einzelne Test, nicht die Datei.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wie tests/s-studio.test.mjs: "@/…" → src/….ts, "next/server" → node_modules, relative Importe ohne
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

const ANON = "anon-test-key-0000000000";
const SERVICE = "service-test-key-1234567890abcdef";
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_KEY: SERVICE,
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
  GP_SESSION_SECRET: "session-test-secret-0123456789",
});

const fake = await import("./harness/fake.mjs");
const { welt, legeAn, zuruecksetzen } = fake;
fake.installiere();
const FAKE_FETCH = globalThis.fetch;
const { React, jsxRuntime, renderToStaticMarkup, ladeTsx, finde, text } = await import("./harness/tsx.mjs");
const { ladeStudioBausteine, hookLaufzeit, alsMarkup } = await import("./harness/studio.mjs");
const { NextRequest } = await import("next/server");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const counsel = await import("../src/lib/counsel-urteil.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const types = await import("../src/lib/types.ts");

const modulCache = new Map();
/** Modul je Test laden (gecacht); fehlt es, scheitert nur der Test, der es braucht. */
async function ladeModul(rel) {
  const datei = path.join(SITE, rel);
  if (!modulCache.has(datei)) modulCache.set(datei, await import(pathToFileURL(datei).href));
  return modulCache.get(datei);
}
const contentListe = () => ladeModul("src/lib/content-liste.ts");
const listeRoute = () => ladeModul("src/app/api/content/liste/route.ts");
const eintragRoute = () => ladeModul("src/app/api/content/eintrag/[id]/route.ts");
const studioRoute = () => ladeModul("src/app/api/studio/[objekt]/route.ts");

const offeneSeiten = [];
beforeEach(() => {
  zuruecksetzen();
  process.env.SUPABASE_SERVICE_KEY = SERVICE;
  globalThis.fetch = FAKE_FETCH;
});
afterEach(() => {
  for (const lz of offeneSeiten.splice(0)) lz.abbauen();
  globalThis.fetch = FAKE_FETCH;
  delete globalThis.document;
});

// ═══ Teil L: Leser und Grenzen ═══

const GUT = { zeilen: [{ id: 1 }], grenze: 50, abgeschnitten: false, gelesen_am: "2026-11-08T21:00:00Z", quelle: "x" };

test("R3-L1 Leser der Liste: Erfolg nur bei 2xx mit Zeilen, Abschneide-Angabe und lesbarem Zeitpunkt — sonst ein Fehlertext, nie eine leere Liste", async () => {
  const L = await contentListe();
  assert.deepEqual(L.leseListenAntwort(200, GUT), { ok: true, zeilen: [{ id: 1 }], abgeschnitten: false, gelesenAm: GUT.gelesen_am });
  assert.deepEqual(L.leseListenAntwort(299, { ...GUT, zeilen: [], abgeschnitten: true }), { ok: true, zeilen: [], abgeschnitten: true, gelesenAm: GUT.gelesen_am });
  const faelle = [
    [502, { fehler: "permission denied for table content", fehler_art: "supabase" }, "permission denied for table content"],
    [500, { fehler: "  Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt  ", fehler_art: "konfiguration" }, "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt"],
    [401, { error: "Unauthorized" }, "Nicht angemeldet (HTTP 401)"],
    [401, { fehler: "anders" }, "Nicht angemeldet (HTTP 401)"],
    [503, { error: "Service Unavailable" }, "Service Unavailable"],
    [502, { fehler: "   ", error: "Bad Gateway" }, "Bad Gateway"],
    [504, null, "HTTP 504"],
    [500, ["fehler"], "HTTP 500"],
    [199, GUT, "HTTP 199"],
    [300, GUT, "HTTP 300"],
    [200, null, "Antwort ohne lesbare Zeilenliste (HTTP 200)"],
    [200, [GUT], "Antwort ohne lesbare Zeilenliste (HTTP 200)"],
    [200, { ...GUT, zeilen: undefined }, "Antwort ohne lesbare Zeilenliste (HTTP 200)"],
    [200, { ...GUT, zeilen: { 0: { id: 1 } } }, "Antwort ohne lesbare Zeilenliste (HTTP 200)"],
    [200, { ...GUT, zeilen: [{ id: 1 }, null] }, "Antwort ohne lesbare Zeilenliste (HTTP 200)"],
    [200, { ...GUT, zeilen: [[1]] }, "Antwort ohne lesbare Zeilenliste (HTTP 200)"],
    [200, { ...GUT, abgeschnitten: "nein" }, "Antwort ohne Angabe, ob die Liste abgeschnitten ist (HTTP 200)"],
    [200, { ...GUT, abgeschnitten: undefined }, "Antwort ohne Angabe, ob die Liste abgeschnitten ist (HTTP 200)"],
    [200, { ...GUT, gelesen_am: "gestern" }, "Antwort ohne lesbaren Zeitpunkt der Abfrage (HTTP 200)"],
    [200, { ...GUT, gelesen_am: 1762635600000 }, "Antwort ohne lesbaren Zeitpunkt der Abfrage (HTTP 200)"],
    [201, { ...GUT, gelesen_am: undefined }, "Antwort ohne lesbaren Zeitpunkt der Abfrage (HTTP 201)"],
  ];
  for (const [status, daten, fehler] of faelle) {
    assert.deepEqual(L.leseListenAntwort(status, daten), { ok: false, fehler }, `${status} ${JSON.stringify(daten)}`);
  }
});

test("R3-L2 Leser einer Zeile: 'keine' nur bei 404 mit fehler_art nicht_gefunden; die Zeile muss die angefragte id tragen", async () => {
  const L = await contentListe();
  assert.deepEqual(L.leseEintragAntwort(200, { eintrag: { id: 7, status: "x" } }, 7), { art: "zeile", zeile: { id: 7, status: "x" } });
  assert.deepEqual(L.leseEintragAntwort(404, { fehler: "Eintrag 7 nicht gefunden", fehler_art: "nicht_gefunden" }, 7), { art: "keine" });
  const faelle = [
    [404, null, "HTTP 404"],
    [404, { fehler: "Seite fehlt" }, "Seite fehlt"],
    [404, { fehler: "x", fehler_art: "eingabe" }, "x"],
    [400, { fehler: "Ungültige id", fehler_art: "eingabe" }, "Ungültige id"],
    [502, { fehler: "permission denied", fehler_art: "supabase" }, "permission denied"],
    [401, { error: "Unauthorized" }, "Nicht angemeldet (HTTP 401)"],
    [200, { eintrag: { id: 8 } }, "Antwort ohne die Zeile #7 (HTTP 200)"],
    [200, { eintrag: { id: "7" } }, "Antwort ohne die Zeile #7 (HTTP 200)"],
    [200, { eintrag: [{ id: 7 }] }, "Antwort ohne die Zeile #7 (HTTP 200)"],
    [200, { eintrag: null }, "Antwort ohne die Zeile #7 (HTTP 200)"],
    [200, null, "Antwort ohne die Zeile #7 (HTTP 200)"],
    [300, { eintrag: { id: 7 } }, "HTTP 300"],
  ];
  for (const [status, daten, fehler] of faelle) {
    assert.deepEqual(L.leseEintragAntwort(status, daten, 7), { art: "fehler", fehler }, `${status} ${JSON.stringify(daten)}`);
  }
});

test("R3-L3 Grenzen: Liste 50 wie vorher, Takt 15 s, Zeitlimit im Browser zwischen dem der Route (8 s) und dem Takt; Pfade; id nur als positive ganze Zahl", async () => {
  const L = await contentListe();
  const { ABFRAGE_TIMEOUT_MS } = await ladeModul("src/lib/status-server.ts");
  assert.equal(L.CONTENT_LISTE_GRENZE, 50);
  assert.equal(L.CONTENT_TAKT_MS, 15_000);
  assert.equal(L.CONTENT_ABRUF_GRENZE_MS, 12_000);
  assert.ok(L.CONTENT_ABRUF_GRENZE_MS > ABFRAGE_TIMEOUT_MS && L.CONTENT_ABRUF_GRENZE_MS < L.CONTENT_TAKT_MS);
  assert.equal(L.CONTENT_LISTE_PFAD, "/api/content/liste");
  assert.equal(L.contentEintragPfad(7), "/api/content/eintrag/7");
  for (const [roh, id] of [["1", 1], ["7", 7], ["9007199254740991", 9007199254740991]]) assert.equal(L.leseContentId(roh), id, roh);
  for (const roh of ["", "0", "-1", "+7", "07", "1.5", "1e3", " 7", "7 ", "abc", "0x1f", "9007199254740992", "12345678901234567"]) {
    assert.equal(L.leseContentId(roh), null, JSON.stringify(roh));
  }
  // Stand-Zeile: Datum und Uhrzeit mit Sekunden, wie toLocaleString de-DE (Zeitzone des Browsers).
  const iso = "2026-11-08T21:30:05.123Z";
  assert.equal(L.standZeit(iso), new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" }));
  assert.match(L.standZeit(iso), /:05$/);
  assert.equal(L.standZeit("kein Datum"), "Zeitpunkt unlesbar");
});

// ═══ Teil R: Routen im Prozess ═══

/** content-Zeile mit Postgres-Defaults (fake.legeAn); created_at bestimmt die Reihenfolge der Liste. */
function zeileDb(id, { am, status = "zur_freigabe", slug = null } = {}) {
  return legeAn({
    id,
    title: `Lauf ${id}`,
    content_type: "thread",
    platform: "x",
    status,
    body: `Text ${id}`,
    review_notes: "URTEIL: FREIGABE-EMPFEHLUNG",
    created_at: am,
    updated_at: am,
    metadata: slug === null ? {} : { objekt_slug: slug },
  });
}

async function holeListe() {
  const { GET } = await listeRoute();
  const res = await GET();
  return { status: res.status, kopf: res.headers, body: await res.json() };
}

async function holeEintrag(id) {
  const { GET } = await eintragRoute();
  const req = new NextRequest(`http://harness.local/api/content/eintrag/${encodeURIComponent(id)}`, { headers: { cookie: "gp-auth=test" } });
  const res = await GET(req, { params: Promise.resolve({ id: String(id) }) });
  return { status: res.status, kopf: res.headers, body: await res.json() };
}

/** Schlüssel (apikey) jeder Supabase-Anfrage mitschneiden. */
function schluesselMitschnitt() {
  const schluessel = [];
  welt.vorAntwort = async (a) => {
    if (a.art === "supabase") schluessel.push(`${a.tabelle}:${a.kopf.get("apikey") === SERVICE ? "service" : a.kopf.get("apikey") === ANON ? "anon" : "?"}`);
  };
  return schluessel;
}

const gespeichert = (id) => JSON.parse(JSON.stringify(fake.zeile(id)));

test("R2-R1 GET /api/content/liste: dieselbe Abfrage wie vorher im Browser — alle Spalten, neueste zuerst, höchstens 50, ohne Filter; Service-Schlüssel; no-store", async () => {
  // ids absichtlich nicht in Zeitfolge: Sortiert wird nach created_at, nicht nach id.
  for (const [id, am] of [[3, "2026-11-01T10:00:00Z"], [1, "2026-11-03T10:00:00Z"], [2, "2026-11-02T10:00:00Z"], [5, "2026-07-27T20:47:25.406613Z"], [4, "2026-11-08T07:00:00Z"]]) {
    zeileDb(id, { am, slug: id === 2 ? "rittergut-seifersdorf" : null });
  }
  const schluessel = schluesselMitschnitt();
  const vorher = Date.now();
  const { status, kopf, body } = await holeListe();
  assert.equal(status, 200);
  assert.equal(kopf.get("cache-control"), "no-store");
  assert.deepEqual(body.zeilen.map((z) => z.id), [4, 1, 2, 3, 5]);
  for (const z of body.zeilen) assert.deepEqual(z, gespeichert(z.id), `alle Spalten von #${z.id}`);
  assert.equal(body.grenze, 50);
  assert.equal(body.abgeschnitten, false);
  assert.equal(body.quelle, (await contentListe()).CONTENT_QUELLE);
  const gelesen = Date.parse(body.gelesen_am);
  assert.ok(gelesen >= vorher && gelesen <= Date.now(), body.gelesen_am);
  assert.deepEqual(welt.log.map((l) => [l.methode, l.tabelle, l.query]), [["GET", "content", "select=*&order=created_at.desc&limit=50"]]);
  assert.deepEqual(schluessel, ["content:service"]);
});

test("R2-R2 Grenze 50: die 50 neuesten von 55, abgeschnitten erst ab 50 Zeilen — dieselben Zeilen wie die Browser-Abfrage vor Schritt 3, keine weniger", async () => {
  const { supabase } = await ladeModul("src/lib/supabase.ts");
  const browserAbfrage = () => supabase.from("content").select("*").order("created_at", { ascending: false }).limit(50);
  for (const [anzahl, abgeschnitten] of [[55, true], [50, true], [49, false], [0, false]]) {
    zuruecksetzen();
    // Zeitpunkte als Permutation (37 und 55 teilerfremd): Einfügereihenfolge ≠ Zeitfolge.
    for (let i = 1; i <= anzahl; i++) zeileDb(i, { am: new Date(Date.UTC(2026, 10, 1) + ((i * 37) % 55) * 60_000).toISOString() });
    const { status, body } = await holeListe();
    assert.equal(status, 200);
    assert.equal(body.zeilen.length, Math.min(anzahl, 50), `${anzahl} Zeilen`);
    assert.equal(body.abgeschnitten, abgeschnitten, `${anzahl} Zeilen`);
    const erwartet = welt.content
      .slice()
      .sort((a, b) => fake.mikrosekunden(b.created_at) - fake.mikrosekunden(a.created_at))
      .slice(0, 50)
      .map((z) => z.id);
    assert.deepEqual(body.zeilen.map((z) => z.id), erwartet);
    // Gegenprobe: dieselbe Abfrage direkt mit supabase-js (so fragte /content bis Schritt 2).
    const browser = await browserAbfrage();
    assert.equal(browser.error, null);
    assert.deepEqual(body.zeilen, browser.data, `${anzahl} Zeilen: Route und Browser-Abfrage gleich`);
  }
});

test("R2-R3 Liste: Lesefehler → 502 supabase mit bereinigtem Grund und ohne Zeilenliste; Abbruch → Zeitüberschreitung; fehlender Schlüssel → 500 konfiguration ohne Abfrage", async () => {
  zeileDb(1, { am: "2026-11-08T07:00:00Z" });
  welt.stoerung = (a) =>
    a.tabelle === "content" ? { status: 500, body: { code: "XX000", message: `kaputt: ${SERVICE} bei https://abc.supabase.co/rest/v1/content` } } : null;
  let r = await holeListe();
  assert.equal(r.status, 502);
  assert.equal(r.kopf.get("cache-control"), "no-store");
  assert.deepEqual(r.body, { fehler: "kaputt: [entfernt] bei [URL]", fehler_art: "supabase" });
  welt.stoerung = null;
  welt.vorAntwort = async () => {
    throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  };
  r = await holeListe();
  assert.deepEqual([r.status, r.body], [502, { fehler: "Zeitüberschreitung (8 s)", fehler_art: "supabase" }]);
  welt.vorAntwort = null;
  welt.log.length = 0;
  delete process.env.SUPABASE_SERVICE_KEY;
  r = await holeListe();
  assert.equal(r.status, 500);
  assert.equal(r.kopf.get("cache-control"), "no-store");
  assert.deepEqual(r.body, { fehler: "Supabase-Service-Schlüssel (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration" });
  assert.deepEqual(welt.log, [], "Supabase nicht abgefragt");
});

test("R2-R4 GET /api/content/eintrag/[id]: alle Spalten der Zeile mit dieser id; 404 nicht_gefunden; Service-Schlüssel; no-store", async () => {
  zeileDb(7, { am: "2026-11-08T07:00:00Z", status: "freigegeben" });
  zeileDb(8, { am: "2026-11-08T08:00:00Z" });
  const schluessel = schluesselMitschnitt();
  const r = await holeEintrag(7);
  assert.equal(r.status, 200);
  assert.equal(r.kopf.get("cache-control"), "no-store");
  assert.deepEqual(r.body.eintrag, gespeichert(7));
  assert.ok(Number.isFinite(Date.parse(r.body.gelesen_am)));
  assert.equal(r.body.quelle, (await contentListe()).CONTENT_QUELLE);
  assert.deepEqual(welt.log.map((l) => [l.methode, l.tabelle, l.query]), [["GET", "content", "select=*&id=eq.7"]]);
  assert.deepEqual(schluessel, ["content:service"]);
  const fehlt = await holeEintrag(9);
  assert.equal(fehlt.status, 404);
  assert.equal(fehlt.kopf.get("cache-control"), "no-store");
  assert.deepEqual(fehlt.body, { fehler: "Eintrag 9 nicht gefunden", fehler_art: "nicht_gefunden" });
});

test("R2-R5 Eintrag: ungültige id → 400 eingabe ohne Abfrage; Lesefehler → 502 supabase; fehlender Schlüssel → 500 konfiguration", async () => {
  zeileDb(7, { am: "2026-11-08T07:00:00Z" });
  for (const roh of ["abc", "0", "-1", "07", "1.5", "1e3", " 7", "9007199254740992"]) {
    const r = await holeEintrag(roh);
    assert.equal(r.status, 400, JSON.stringify(roh));
    assert.deepEqual(r.body, { fehler: "Ungültige id: erwartet ist eine positive ganze Zahl", fehler_art: "eingabe" });
  }
  assert.deepEqual(welt.log, [], "keine Abfrage bei ungültiger id");
  welt.stoerung = () => ({ status: 401, body: { code: "42501", message: "permission denied for table content" } });
  const r = await holeEintrag(7);
  assert.deepEqual([r.status, r.body], [502, { fehler: "permission denied for table content", fehler_art: "supabase" }]);
  welt.stoerung = null;
  welt.log.length = 0;
  delete process.env.SUPABASE_SERVICE_KEY;
  const ohne = await holeEintrag(7);
  assert.deepEqual([ohne.status, ohne.body.fehler_art], [500, "konfiguration"]);
  assert.deepEqual(welt.log, []);
});

test("R2-R6 Beide Routen: nur GET, dynamic 'force-dynamic', runtime 'nodejs'; Supabase nur über createServiceClient", async () => {
  for (const [lade, datei] of [
    [listeRoute, "src/app/api/content/liste/route.ts"],
    [eintragRoute, "src/app/api/content/eintrag/[id]/route.ts"],
  ]) {
    const m = await lade();
    assert.deepEqual(Object.keys(m).sort(), ["GET", "dynamic", "runtime"], datei);
    assert.equal(m.dynamic, "force-dynamic");
    assert.equal(m.runtime, "nodejs");
    const quelle = readFileSync(path.join(SITE, datei), "utf8");
    assert.match(quelle, /^import \{ createServiceClient, istKonfigurationsFehler \} from "@\/lib\/supabase";$/m);
    assert.doesNotMatch(quelle, /\{ supabase \}|\bsupabase\.from/);
  }
});

test("R2-R7 Zeitlimit: Beide Routen geben der Supabase-Abfrage ein Abbruchsignal mit ABFRAGE_TIMEOUT_MS (8 s) mit", async (t) => {
  const { ABFRAGE_TIMEOUT_MS } = await ladeModul("src/lib/status-server.ts");
  zeileDb(7, { am: "2026-11-08T07:00:00Z" });
  const erzeugt = new Map();
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const signal = original.call(AbortSignal, ms);
    erzeugt.set(signal, ms);
    return signal;
  });
  const signale = [];
  welt.vorAntwort = async (a) => {
    if (a.art === "supabase") signale.push(a.signal);
  };
  assert.equal((await holeListe()).status, 200);
  assert.equal((await holeEintrag(7)).status, 200);
  assert.equal(signale.length, 2, "eine Abfrage je Route");
  for (const signal of signale) assert.equal(erzeugt.get(signal), ABFRAGE_TIMEOUT_MS);
});

test("R2-M1 Middleware (nur gelesen): Ohne gültige Sitzung 401 auf beiden neuen Pfaden, mit Sitzung durch; der Matcher erfasst sie", async () => {
  for (const datei of ["src/app/api/content/liste/route.ts", "src/app/api/content/eintrag/[id]/route.ts"]) {
    assert.ok(existsSync(path.join(SITE, datei)), `Route fehlt: ${datei}`);
  }
  const mw = await ladeModul("src/middleware.ts");
  const { signSession } = await ladeModul("src/lib/auth.ts");
  const pfade = ["/api/content/liste", "/api/content/eintrag/7"];
  const matcher = mw.config.matcher.map((m) => new RegExp(`^${m}$`));
  for (const p of pfade) assert.ok(matcher.some((r) => r.test(p)), `Matcher erfasst ${p}`);
  const vorher = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const token = await signSession(process.env.GP_SESSION_SECRET);
    for (const p of pfade) {
      const ohne = await mw.middleware(new NextRequest(`http://harness.local${p}`));
      assert.equal(ohne.status, 401, p);
      assert.deepEqual(await ohne.json(), { error: "Unauthorized" });
      const gefaelscht = await mw.middleware(new NextRequest(`http://harness.local${p}`, { headers: { cookie: "gp-auth=1762635600000.00" } }));
      assert.equal(gefaelscht.status, 401, `${p} mit gefälschtem Cookie`);
      const mit = await mw.middleware(new NextRequest(`http://harness.local${p}`, { headers: { cookie: `gp-auth=${token}` } }));
      assert.equal(mit.headers.get("x-middleware-next"), "1", `${p} mit Sitzung`);
    }
  } finally {
    if (vorher === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = vorher;
  }
});

// ═══ Teil S: Seite mit Takt ═══

const TEXT = "Denkmal-Altbau in Leipzig, 4 Zimmer, saniert 2024. Jetzt Exposé anfordern.";
const NOTES = "Prüfung ok.\nURTEIL: FREIGABE-EMPFEHLUNG";
const VERMERK = { aktion: "freigeben", am: "2026-11-08T21:00:00Z", durch: "betreiber-session", text_sha256: "0".repeat(64), text_zeichen: 75 };

/** content-Zeile, wie die Route sie liefert (Testdaten). */
function z(id, { status = "zur_freigabe", extra = {} } = {}) {
  const am = `2026-11-05T10:${String(id % 60).padStart(2, "0")}:00Z`;
  return {
    id,
    title: `Eintrag ${id}`,
    content_type: "thread",
    status,
    body: TEXT,
    platform: "x",
    created_by: "scribe",
    reviewed_by: "counsel",
    review_notes: NOTES,
    published_url: null,
    published_at: null,
    views: 0,
    engagement: 0,
    performance: null,
    metadata: {
      steps: [
        { agent: "researcher", status: "done", output: "Recherche" },
        { agent: "scribe", status: "done", output: TEXT },
        { agent: "counsel", status: "done", output: NOTES },
        { agent: "publisher", status: "done", output: TEXT },
        { agent: "amplifier", status: "done", output: "Plan" },
      ],
      counsel: { urteil: "FREIGABE", geprueft: "SCRIBE-Text (steps[1])" },
      ...extra,
    },
    created_at: am,
    updated_at: am,
  };
}

const liste = (zeilen, gelesen_am, abgeschnitten = zeilen.length >= 50) => ({ zeilen, grenze: 50, abgeschnitten, gelesen_am, quelle: "Test" });
const T1 = "2026-11-08T21:00:01.000Z";
const T2 = "2026-11-08T21:00:16.000Z";
const T3 = "2026-11-08T21:00:31.000Z";

/** Vorbereitete Pipeline-Antwort: Der Lauf bleibt offen, bis der Test ihn beantwortet (n.pipeline()). */
const OFFEN = Symbol("offen");

/**
 * fetch-Attrappe der Seite. Liste und Zeile beantwortet der Test (antworte/wirf), auch später; ein
 * Abbruch über das Signal lehnt ab wie fetch (AbortError). antworteText liefert einen Körper, der kein
 * JSON ist (etwa die Fehlerseite eines Proxys): json() scheitert dann wie bei fetch. Kalender und
 * Objekte beantwortet sie selbst, Status und Pipeline aus vorbereiteten Antworten ([Status, Daten]; für
 * die Pipeline auch ein Error = Netzfehler oder OFFEN); alles andere wirft.
 */
function netz({ statusAntworten = [], pipelineAntworten = [] } = {}) {
  const abrufe = [];
  const offen = { status: [...statusAntworten], pipeline: [...pipelineAntworten] };
  globalThis.fetch = (url, init = {}) =>
    new Promise((ok, fehl) => {
      const a = { url, init, erledigt: false };
      a.antworte = (status, daten) => {
        a.erledigt = true;
        ok({ status, ok: status >= 200 && status < 300, json: async () => daten });
      };
      a.antworteText = (status, roh) => {
        a.erledigt = true;
        ok({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(roh) });
      };
      a.wirf = (e) => {
        a.erledigt = true;
        fehl(e);
      };
      abrufe.push(a);
      init.signal?.addEventListener("abort", () => a.wirf(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
      if (url === "/api/content/pipeline" && !init.method) a.antworte(200, { launch_calendar: null });
      else if (url === "/api/objekte") a.antworte(200, { objekte: [] });
      else if (url === "/api/content/status" && init.method === "POST") {
        const naechste = offen.status.shift();
        if (naechste) a.antworte(...naechste);
        else a.wirf(new Error("Test: keine Status-Antwort vorbereitet"));
      } else if (url === "/api/content/pipeline" && init.method === "POST") {
        const naechste = offen.pipeline.shift();
        if (naechste instanceof Error) a.wirf(naechste);
        else if (Array.isArray(naechste)) a.antworte(...naechste);
        else if (naechste !== OFFEN) a.wirf(new Error("Test: keine Pipeline-Antwort vorbereitet"));
      } else if (url !== "/api/content/liste" && !/^\/api\/content\/eintrag\/\d+$/.test(url)) {
        a.wirf(new Error(`Test: unerwarteter Abruf ${url}`));
      }
    });
  return {
    abrufe,
    liste: () => abrufe.filter((a) => a.url === "/api/content/liste"),
    eintrag: () => abrufe.filter((a) => a.url.startsWith("/api/content/eintrag/")),
    pipeline: () => abrufe.filter((a) => a.url === "/api/content/pipeline" && a.init.method === "POST"),
  };
}

/**
 * /content mit Hook-Laufzeit; Supabase steht nur bereit, wenn browserClient übergeben wird (Teil Z).
 * Fehlt lib/content-liste.ts (Stand vor Schritt 3), lädt die Seite ohne — dann scheitert der Test an
 * dem, was die Seite tut, nicht am fehlenden Modul (Rückprobe).
 */
async function contentSeite({ suche = "tab=content", freigaben = null, browserClient } = {}) {
  const lz = hookLaufzeit();
  offeneSeiten.push(lz);
  const listenModul = await contentListe().catch(() => null);
  const attrappen = {
    ...lz.attrappen,
    "next/navigation": { useSearchParams: () => new URLSearchParams(suche) },
    ...(listenModul ? { "@/lib/content-liste": listenModul } : {}),
    "@/components/ui/KPICard": {
      KPICard: ({ label, value, subtitle }) => lz.jsx("div", { "data-kpi": label, children: `${label}: ${String(value)} · ${subtitle ?? ""}` }),
    },
    "@/lib/hooks-status": {
      objektFehlerText: hooksStatus.objektFehlerText,
      objekteFehlerArt: hooksStatus.objekteFehlerArt,
      useFreigaben: () => ({ freigaben, fehler: null, loading: false, geladenAm: null, neuLaden: async () => {} }),
    },
    "@/lib/counsel-urteil": counsel,
    "@/lib/freigabe-regeln": regeln,
    ...(browserClient ? { "@/lib/supabase": { supabase: browserClient } } : {}),
  };
  const studio = ladeStudioBausteine(attrappen);
  const seite = ladeTsx("app/content/page.tsx", { ...attrappen, ...studio.module });
  lz.setzeWurzel(seite.default);
  return lz;
}

/** Sichtbarkeit des Tabs (document-Attrappe mit visibilitychange). */
function sichtbarkeit(start = "visible") {
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

const merkmal = (baum, name) => finde(baum, (k) => k.props?.[name] !== undefined);
const standZeile = (baum) => (merkmal(baum, "data-liste-stand").length === 1 ? text(merkmal(baum, "data-liste-stand")[0]) : merkmal(baum, "data-liste-stand").length === 0 ? null : "mehrfach");
const alarm = (baum) => (merkmal(baum, "data-abfrage-fehler").length > 0 ? text(merkmal(baum, "data-abfrage-fehler")[0]) : null);
const kachel = (baum, label) => text(finde(baum, (k) => k.props?.["data-kpi"] === label)[0]);
const eintraege = (baum) => finde(baum, (k) => k.type === "h3" && /^Eintrag \d+$/.test(text(k))).map(text);
const standText = async (iso) => `Liste: Stand ${(await contentListe()).standZeit(iso)} (letzte erfolgreiche Abfrage über den Server) · neue Abfrage alle 15 s`;

async function oeffne(lz, baum, id) {
  const karte = finde(
    baum,
    (k) => k.type === "div" && String(k.props.className ?? "").startsWith("card-ghost p-4") && finde(k, (h) => h.type === "h3" && text(h) === `Eintrag ${id}`).length === 1,
  )[0];
  assert.ok(karte, `Karte für Eintrag ${id} fehlt`);
  finde(karte, (k) => k.type === "div" && typeof k.props.onClick === "function" && String(k.props.className ?? "").includes("cursor-pointer"))[0].props.onClick();
  return lz.ruhe(2);
}

async function klicke(lz, knopf) {
  assert.ok(knopf, "Knopf nicht gefunden");
  assert.notEqual(knopf.props.disabled, true, `Knopf gesperrt: ${text(knopf)}`);
  knopf.props.onClick({ stopPropagation() {} });
  return lz.ruhe();
}
const freigebenKnopf = (baum) => finde(baum, (k) => k.type === "button" && text(k) === "Freigeben")[0];

/** Seite starten und die erste Abfrage mit den Zeilen beantworten. */
async function gestartet(n, lz, zeilen, gelesen_am = T1) {
  lz.rendere();
  await lz.ruhe();
  assert.equal(n.liste().length, 1, "erste Abfrage");
  n.liste()[0].antworte(200, liste(zeilen, gelesen_am));
  return lz.ruhe();
}

test("R3-S1 Erste Abfrage über GET /api/content/liste ohne Cache; danach Liste, Kacheln und Stand-Zeile mit gelesen_am — vorher 'lädt' ohne Stand", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const n = netz();
  const lz = await contentSeite();
  lz.rendere();
  let baum = await lz.ruhe();
  assert.equal(n.liste().length, 1);
  const [erste] = n.liste();
  assert.equal(erste.init.cache, "no-store");
  assert.ok(erste.init.signal instanceof AbortSignal);
  assert.equal(standZeile(baum), null, "keine Stand-Zeile vor der ersten Antwort");
  assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: lädt"), kachel(baum, "Freigegeben"));
  erste.antworte(200, liste([z(3), z(2), z(1, { status: "freigegeben" })], T1));
  baum = await lz.ruhe();
  assert.deepEqual(eintraege(baum).sort(), ["Eintrag 1", "Eintrag 2", "Eintrag 3"]);
  assert.equal(standZeile(baum), await standText(T1));
  assert.equal(
    kachel(baum, "Freigegeben"),
    "Freigegeben: 1 · 0 bereit zum Posten (mit Betreiber-Vermerk) · 1 freigegeben ohne Betreiber-Vermerk (Altbestand) · in den letzten 50",
  );
  assert.equal(alarm(baum), null);
  assert.ok(!text(baum).includes("Content nicht lesbar"));
});

test("R3-S2 Takt 15 s: erst nach 15 s die nächste Abfrage; jede Abfrage ersetzt die Liste — neue Zeilen erscheinen, fehlende verschwinden, der Stand rückt vor", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const n = netz();
  const lz = await contentSeite();
  let baum = await gestartet(n, lz, [z(2), z(1)]);
  t.mock.timers.tick(14_999);
  await lz.ruhe();
  assert.equal(n.liste().length, 1, "vor Ablauf des Takts keine Abfrage");
  t.mock.timers.tick(1);
  await lz.ruhe();
  assert.equal(n.liste().length, 2, "nach 15 s die zweite Abfrage");
  assert.equal(n.liste()[1].init.cache, "no-store");
  n.liste()[1].antworte(200, liste([z(4), z(2), z(1)], T2));
  baum = await lz.ruhe();
  assert.deepEqual(eintraege(baum).sort(), ["Eintrag 1", "Eintrag 2", "Eintrag 4"]);
  assert.equal(standZeile(baum), await standText(T2));
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  assert.equal(n.liste().length, 3);
  n.liste()[2].antworte(200, liste([z(4)], T3));
  baum = await lz.ruhe();
  assert.deepEqual(eintraege(baum), ["Eintrag 4"]);
  assert.equal(standZeile(baum), await standText(T3));
});

test("R3-S3 Gescheiterte Neuabfrage: Die Liste bleibt sichtbar, der Fehler steht darüber mit dem alten Stand; der nächste erfolgreiche Takt räumt ihn ab", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const freigaben = { erzeugt_am: "2026-11-08T21:00:00Z", wartend: [], wartend_gesamt: 5, haengend: [], haengend_gesamt: 0, quelle: "x", fehler: null };
  const n = netz();
  const lz = await contentSeite({ freigaben });
  let baum = await gestartet(n, lz, [z(2), z(1, { status: "freigegeben" })]);
  const kachelVorher = kachel(baum, "Freigegeben");
  assert.ok(text(baum).includes("Liste und Server-Zählung weichen ab"), "Hinweis bei frischer Liste");
  const L = await contentListe();
  const faelle = [
    [(a) => a.antworte(502, { fehler: "permission denied for table content", fehler_art: "supabase" }), "permission denied for table content"],
    [(a) => a.antworte(401, { error: "Unauthorized" }), "Nicht angemeldet (HTTP 401)"],
    [(a) => a.antworte(200, { zeilen: "keine" }), "Antwort ohne lesbare Zeilenliste (HTTP 200)"],
    [(a) => a.wirf(new TypeError("Failed to fetch")), "Server nicht erreichbar (Failed to fetch)"],
  ];
  for (const [i, [beantworte, grund]] of faelle.entries()) {
    t.mock.timers.tick(15_000);
    await lz.ruhe();
    beantworte(n.liste()[i + 1]);
    baum = await lz.ruhe();
    assert.equal(alarm(baum), `Neue Abfrage fehlgeschlagen: ${grund} — angezeigt bleibt der Stand ${L.standZeit(T1)}; nächster Versuch im Takt.`);
    assert.deepEqual(eintraege(baum).sort(), ["Eintrag 1", "Eintrag 2"], "Liste bleibt sichtbar");
    assert.equal(standZeile(baum), await standText(T1), "Stand der letzten erfolgreichen Abfrage");
    assert.equal(kachel(baum, "Freigegeben"), kachelVorher, "Kacheln der sichtbaren Liste");
    assert.ok(!text(baum).includes("Content nicht lesbar"));
    assert.ok(!text(baum).includes("Liste und Server-Zählung weichen ab"), "kein Vergleich mit veralteter Liste");
  }
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  n.liste()[5].antworte(200, liste([z(3), z(2), z(1, { status: "freigegeben" })], T3));
  baum = await lz.ruhe();
  assert.equal(alarm(baum), null);
  assert.equal(standZeile(baum), await standText(T3));
  assert.deepEqual(eintraege(baum).sort(), ["Eintrag 1", "Eintrag 2", "Eintrag 3"]);
});

test("R3-S4 Erste Abfrage scheitert: 'Content nicht lesbar' statt der Liste, Kacheln 'nicht lesbar', nie 'keine Einträge'; der Takt versucht es weiter", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const n = netz();
  const lz = await contentSeite();
  lz.rendere();
  await lz.ruhe();
  n.liste()[0].antworte(502, { fehler: "permission denied for table content", fehler_art: "supabase" });
  let baum = await lz.ruhe();
  const pruefe = (grund) => {
    const tx = text(baum);
    assert.ok(tx.includes(`Content nicht lesbar: ${grund}Neuer Versuch automatisch alle 15 s.`), tx.slice(0, 1500));
    assert.ok(!tx.includes("Die Abfrage lieferte keine Content-Einträge"));
    assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: nicht lesbar"));
    assert.equal(standZeile(baum), null);
    assert.equal(alarm(baum), null);
  };
  pruefe("permission denied for table content");
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  n.liste()[1].antworte(200, { zeilen: [], grenze: 50, abgeschnitten: false });
  baum = await lz.ruhe();
  pruefe("Antwort ohne lesbaren Zeitpunkt der Abfrage (HTTP 200)");
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  n.liste()[2].antworte(200, liste([z(1)], T2));
  baum = await lz.ruhe();
  assert.deepEqual(eintraege(baum), ["Eintrag 1"]);
  assert.equal(standZeile(baum), await standText(T2));
  assert.ok(!text(baum).includes("Content nicht lesbar"));
  // Eine wirklich leere Liste meldet die Route mit zeilen: [] — nur dann "keine Einträge".
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  n.liste()[3].antworte(200, liste([], T3));
  baum = await lz.ruhe();
  assert.ok(text(baum).includes("Die Abfrage lieferte keine Content-Einträge."));
});

test("R3-S5 Verborgener Tab: Der Takt fragt nicht ab; beim Zurückkehren sofort eine Abfrage, danach wieder im Takt", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const s = sichtbarkeit("visible");
  const n = netz();
  const lz = await contentSeite();
  let baum = await gestartet(n, lz, [z(1)]);
  assert.equal(s.lauscher.size, 1, "visibilitychange abonniert");
  s.setze("hidden");
  await lz.ruhe();
  t.mock.timers.tick(45_000);
  await lz.ruhe();
  assert.equal(n.liste().length, 1, "drei Takte im verborgenen Tab ohne Abfrage");
  s.setze("visible");
  await lz.ruhe();
  assert.equal(n.liste().length, 2, "beim Zurückkehren sofort, ohne auf den Takt zu warten");
  n.liste()[1].antworte(200, liste([z(2), z(1)], T2));
  baum = await lz.ruhe();
  assert.equal(standZeile(baum), await standText(T2));
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  assert.equal(n.liste().length, 3, "danach wieder im Takt");
});

test("R3-S6 Seite verlassen: Takt gestoppt, Lauscher entfernt, laufende Abfrage abgebrochen — eine späte Antwort ändert nichts", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const s = sichtbarkeit("visible");
  const n = netz();
  const lz = await contentSeite();
  await gestartet(n, lz, [z(1)]);
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  const laufend = n.liste()[1];
  const markup = alsMarkup(await lz.ruhe());
  lz.abbauen();
  assert.equal(laufend.init.signal.aborted, true, "laufende Abfrage abgebrochen");
  assert.equal(s.lauscher.size, 0, "Lauscher entfernt");
  t.mock.timers.tick(60_000);
  const nachher = await lz.ruhe();
  assert.equal(n.liste().length, 2, "kein Takt nach dem Verlassen");
  assert.equal(alsMarkup(nachher), markup, "der Abbruch setzt keinen Fehler und keinen Stand");
});

test("R3-S7 Lokale Änderung hat Vorrang: Eine Abfrage, die vor einer Aktion begann, setzt die Zeile nicht zurück; die Seite liest sofort neu", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const freigegeben = { ...z(2, { status: "freigegeben", extra: { freigabe: VERMERK } }) };
  const n = netz({ statusAntworten: [[200, { eintrag: freigegeben }]] });
  const lz = await contentSeite();
  let baum = await gestartet(n, lz, [z(2)]);
  baum = await oeffne(lz, baum, 2);
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  const alt = n.liste()[1];
  assert.equal(alt.erledigt, false, "Abfrage läuft noch");
  baum = await klicke(lz, freigebenKnopf(baum));
  assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: 1 · 1 bereit zum Posten"), kachel(baum, "Freigegeben"));
  alt.antworte(200, liste([z(2)], T2));
  baum = await lz.ruhe();
  assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: 1 · 1 bereit zum Posten"), "ältere Abfrage verworfen");
  assert.equal(standZeile(baum), await standText(T1), "Stand bleibt bei der zuletzt übernommenen Abfrage");
  // Prüfung 09.11.2026: Nach dem Verwerfen sofort die nächste Abfrage, nicht erst im Takt.
  assert.equal(n.liste().length, 3, "sofort neu gelesen, ohne auf den Takt zu warten");
  n.liste()[2].antworte(200, liste([freigegeben], T3));
  baum = await lz.ruhe();
  assert.equal(standZeile(baum), await standText(T3));
  assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: 1 · 1 bereit zum Posten"));
});

test("R3-S8 Eine neuere Abfrage überholt die ältere: Die ältere wird abgebrochen und meldet keinen Fehler; es gilt die neuere", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const s = sichtbarkeit("visible");
  const n = netz();
  const lz = await contentSeite();
  await gestartet(n, lz, [z(1)]);
  t.mock.timers.tick(10_000);
  s.setze("hidden");
  s.setze("visible");
  await lz.ruhe();
  t.mock.timers.tick(5_000);
  let baum = await lz.ruhe();
  const [, aelter, neuer] = n.liste();
  assert.equal(n.liste().length, 3);
  assert.equal(aelter.init.signal.aborted, true, "ältere abgebrochen");
  assert.equal(neuer.init.signal.aborted, false);
  // Prüfung 09.11.2026: schon vor der Antwort der neueren — die abgebrochene meldet keinen Fehler.
  assert.equal(alarm(baum), null, "der Abbruch der älteren ist kein Fehler");
  assert.equal(standZeile(baum), await standText(T1));
  neuer.antworte(200, liste([z(9), z(1)], T3));
  baum = await lz.ruhe();
  assert.equal(alarm(baum), null, "Überholen ist kein Fehler");
  assert.equal(standZeile(baum), await standText(T3));
  assert.deepEqual(eintraege(baum).sort(), ["Eintrag 1", "Eintrag 9"]);
});

test("R3-S9 Abfrage ohne Antwort: nach 12 s abgebrochen und als Fehler sichtbar, vor dem nächsten Takt — mit und ohne gelesene Liste", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const n = netz();
  const lz = await contentSeite();
  let baum = await gestartet(n, lz, [z(1)]);
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  const haengt = n.liste()[1];
  t.mock.timers.tick(11_999);
  baum = await lz.ruhe();
  assert.equal(haengt.init.signal.aborted, false);
  assert.equal(alarm(baum), null);
  t.mock.timers.tick(1);
  baum = await lz.ruhe();
  assert.equal(haengt.init.signal.aborted, true);
  const L = await contentListe();
  assert.equal(alarm(baum), `Neue Abfrage fehlgeschlagen: keine Antwort binnen 12 s — angezeigt bleibt der Stand ${L.standZeit(T1)}; nächster Versuch im Takt.`);
  assert.deepEqual(eintraege(baum), ["Eintrag 1"]);
  // Ohne gelesene Liste: dasselbe Zeitlimit, dann "Content nicht lesbar".
  const n2 = netz();
  const lz2 = await contentSeite();
  lz2.rendere();
  await lz2.ruhe();
  t.mock.timers.tick(12_000);
  const baum2 = await lz2.ruhe();
  assert.equal(n2.liste()[0].init.signal.aborted, true);
  assert.ok(text(baum2).includes("Content nicht lesbar: keine Antwort binnen 12 s"), text(baum2).slice(0, 800));
});

const ERGEBNIS = {
  pipeline: "content-first",
  contentId: 50,
  status: "complete",
  counsel: { urteil: "FREIGABE", grund: "URTEIL-Zeile", zeile: "URTEIL: FREIGABE-EMPFEHLUNG" },
  steps: ["researcher", "scribe", "counsel", "publisher", "amplifier"].map((agent) => ({ agent, status: "done", output: TEXT, cost: 0.01 })),
  summary: { total_cost_usd: 0.05, total_duration_ms: 1000, completed: "5/5" },
};

/** Topic eintragen und "Content produzieren" klicken (Pipeline-Tab). */
async function laufStarten(lz, baum) {
  const feld = finde(baum, (k) => k.type === "input" && String(k.props.placeholder ?? "").startsWith("z.B."))[0];
  feld.props.onChange({ target: { value: "KI-Agenten im Mittelstand" } });
  baum = await lz.ruhe(2);
  return klicke(lz, finde(baum, (k) => k.type === "button" && text(k) === "Content produzieren")[0]);
}

test("R3-S10 Nach jedem Pipeline-Lauf liest die Seite sofort neu — mit Ergebnis, nach unbekanntem Ausgang und bei 'Lauf existiert': Die Zeile steht im Content-Tab, ohne auf den Takt zu warten", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  // Prüfung 09.11.2026: Die Pipeline legt die Zeile schon beim Start an — auch ohne Ergebnis kann es sie geben.
  const ausgaenge = [
    ["Ergebnis", [200, ERGEBNIS], "Pipeline-Ergebnis"],
    ["unbekannter Ausgang (Netzfehler)", new TypeError("Failed to fetch"), "Netzwerkfehler: Failed to fetch"],
    ["Lauf existiert (409)", [409, { fehler: "Lauf existiert bereits", content_id: 50, status: "zur_freigabe" }], "Lauf existiert bereits (#50, Zur Freigabe)"],
  ];
  for (const [name, antwort, meldung] of ausgaenge) {
    const n = netz({ pipelineAntworten: [antwort] });
    const lz = await contentSeite({ suche: "" });
    let baum = await gestartet(n, lz, [z(1)]);
    baum = await laufStarten(lz, baum);
    assert.equal(n.pipeline().length, 1, name);
    assert.ok(text(baum).includes(meldung), `${name}: ${text(baum).slice(0, 800)}`);
    assert.equal(n.liste().length, 2, `${name}: Neulesen direkt nach dem Lauf`);
    n.liste()[1].antworte(200, liste([z(50), z(1)], T2));
    await lz.ruhe();
    baum = await klicke(lz, finde(baum, (k) => k.type === "button" && text(k) === "Content")[0]);
    assert.deepEqual(eintraege(baum).sort(), ["Eintrag 1", "Eintrag 50"], name);
    assert.equal(standZeile(baum), await standText(T2), name);
  }
});

test("R3-S11 Eine Zeile neu laden (nach 409): GET /api/content/eintrag/<id> ohne Cache; Ersatz der Zeile oder sichtbarer Grund, nie still", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const KONFLIKT = [409, { fehler: "Eintrag hat sich zwischenzeitlich geändert (Status oder Inhalt) — neu laden" }];
  const faelle = [
    [(a) => a.antworte(200, { eintrag: z(2, { status: "freigegeben", extra: { freigabe: VERMERK } }) }), " · Eintrag neu geladen", 1],
    [(a) => a.antworte(404, { fehler: "Eintrag 2 nicht gefunden", fehler_art: "nicht_gefunden" }), " · Neu laden lieferte keine Zeile — Anzeige veraltet", 0],
    [(a) => a.antworte(404, null), " · Neu laden fehlgeschlagen: HTTP 404 — Anzeige veraltet", 0],
    [(a) => a.antworte(502, { fehler: "permission denied", fehler_art: "supabase" }), " · Neu laden fehlgeschlagen: permission denied — Anzeige veraltet", 0],
    [(a) => a.wirf(new TypeError("Failed to fetch")), " · Neu laden fehlgeschlagen: Server nicht erreichbar (Failed to fetch) — Anzeige veraltet", 0],
    [(a) => a.antworte(200, { eintrag: z(3) }), " · Neu laden fehlgeschlagen: Antwort ohne die Zeile #2 (HTTP 200) — Anzeige veraltet", 0],
  ];
  for (const [beantworte, meldung, freigegebenDanach] of faelle) {
    const n = netz({ statusAntworten: [KONFLIKT] });
    const lz = await contentSeite();
    let baum = await gestartet(n, lz, [z(2)]);
    baum = await oeffne(lz, baum, 2);
    baum = await klicke(lz, freigebenKnopf(baum));
    assert.equal(n.eintrag().length, 1, meldung);
    const [abruf] = n.eintrag();
    assert.equal(abruf.url, "/api/content/eintrag/2");
    assert.equal(abruf.init.cache, "no-store");
    beantworte(abruf);
    baum = await lz.ruhe();
    const tx = text(baum);
    assert.ok(tx.includes(`Konflikt (HTTP 409): Eintrag hat sich zwischenzeitlich geändert (Status oder Inhalt) — neu laden${meldung}`), `${meldung}\n${tx.slice(0, 2500)}`);
    assert.ok(kachel(baum, "Freigegeben").startsWith(`Freigegeben: ${freigegebenDanach}`), kachel(baum, "Freigegeben"));
  }
});

test("R3-S12 Auch das Neuladen einer Zeile (nach 409) hat Vorrang vor einer Abfrage, die davor begann", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const n = netz({ statusAntworten: [[409, { fehler: "Eintrag hat sich zwischenzeitlich geändert (Status oder Inhalt) — neu laden" }]] });
  const lz = await contentSeite();
  let baum = await gestartet(n, lz, [z(2)]);
  baum = await oeffne(lz, baum, 2);
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  const alt = n.liste()[1];
  assert.equal(alt.erledigt, false, "Abfrage läuft noch");
  baum = await klicke(lz, freigebenKnopf(baum));
  n.eintrag()[0].antworte(200, { eintrag: z(2, { status: "freigegeben", extra: { freigabe: VERMERK } }) });
  baum = await lz.ruhe();
  assert.ok(text(baum).includes("· Eintrag neu geladen"));
  assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: 1 · 1 bereit zum Posten"), kachel(baum, "Freigegeben"));
  alt.antworte(200, liste([z(2)], T2));
  baum = await lz.ruhe();
  assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: 1 · 1 bereit zum Posten"), "ältere Abfrage verworfen");
  assert.equal(standZeile(baum), await standText(T1));
  assert.equal(n.liste().length, 3, "sofort neu gelesen (Prüfung 09.11.2026)");
});

test("R3-S13 Eine neue Zeile in einer verworfenen Antwort erscheint ohne weiteren Takt: Nach dem Verwerfen liest die Seite sofort neu", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const freigegeben = z(2, { status: "freigegeben", extra: { freigabe: VERMERK } });
  const n = netz({ statusAntworten: [[200, { eintrag: freigegeben }]] });
  const lz = await contentSeite();
  let baum = await gestartet(n, lz, [z(2)]);
  baum = await oeffne(lz, baum, 2);
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  const takt = n.liste()[1];
  baum = await klicke(lz, freigebenKnopf(baum));
  // Die Antwort des Takts bringt die neue Zeile 7, wird aber verworfen (Zeile 2 lokal ersetzt).
  takt.antworte(200, liste([z(7), z(2)], T2));
  baum = await lz.ruhe();
  assert.deepEqual(eintraege(baum).sort(), ["Eintrag 2"], "verworfen");
  assert.equal(standZeile(baum), await standText(T1));
  assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: 1 · 1 bereit zum Posten"), "lokale Änderung bleibt");
  assert.equal(n.liste().length, 3, "sofort die nächste Abfrage");
  assert.equal(n.liste()[2].init.cache, "no-store");
  n.liste()[2].antworte(200, liste([z(7), freigegeben], T3));
  baum = await lz.ruhe();
  assert.deepEqual(eintraege(baum).sort(), ["Eintrag 2", "Eintrag 7"], "neue Zeile ohne weiteren Takt");
  assert.equal(standZeile(baum), await standText(T3));
  assert.ok(kachel(baum, "Freigegeben").startsWith("Freigegeben: 1 · 1 bereit zum Posten"), kachel(baum, "Freigegeben"));
  // Kein Doppel: Bis zum nächsten Takt keine weitere Abfrage.
  t.mock.timers.tick(14_999);
  await lz.ruhe();
  assert.equal(n.liste().length, 3);
});

test("R3-S14 Ein Lauf, der erst nach dem Verlassen der Seite endet, startet keine Abfrage mehr", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const n = netz({ pipelineAntworten: [OFFEN] });
  const lz = await contentSeite({ suche: "" });
  const baum = await gestartet(n, lz, [z(1)]);
  await laufStarten(lz, baum);
  const [lauf] = n.pipeline();
  assert.equal(lauf.erledigt, false, "Lauf offen");
  assert.equal(n.liste().length, 1);
  lz.abbauen();
  lauf.antworte(200, ERGEBNIS);
  await lz.ruhe();
  t.mock.timers.tick(60_000);
  await lz.ruhe();
  assert.equal(n.liste().length, 1, "keine Abfrage nach dem Verlassen");
});

test("R3-S15 Abbauen und wieder aufbauen (Strict Mode im Entwicklungsmodus): Die Seite fragt danach wieder ab — sofort, im Takt und nach einem Lauf", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const n = netz({ pipelineAntworten: [[200, ERGEBNIS]] });
  const lz = await contentSeite({ suche: "" });
  let baum = await gestartet(n, lz, [z(1)]);
  lz.abbauen();
  lz.wiederAufbauen();
  await lz.ruhe();
  assert.equal(n.liste().length, 2, "Abfrage beim erneuten Aufbau");
  n.liste()[1].antworte(200, liste([z(2), z(1)], T2));
  baum = await lz.ruhe();
  t.mock.timers.tick(15_000);
  await lz.ruhe();
  assert.equal(n.liste().length, 3, "Takt läuft wieder");
  n.liste()[2].antworte(200, liste([z(2), z(1)], T3));
  baum = await lz.ruhe();
  baum = await laufStarten(lz, baum);
  assert.ok(text(baum).includes("Pipeline-Ergebnis"));
  assert.equal(n.liste().length, 4, "Neulesen nach dem Lauf");
});

// ═══ Teil Z: Browser-Client ohne Rechte auf content (Simulation) ═══

const SLUG = "rittergut-seifersdorf";
const RITTERGUT = {
  slug: SLUG,
  name: "RitterGut Seifersdorf",
  untertitel: "",
  tagline: null,
  ort: "Testort",
  baujahr: 1335,
  preis: "ab 123.456 € (Testwert)",
  kurzbeschreibung: "",
  statusBadge: "Vermarktung",
  afaProzent: 100,
  istDenkmal: true,
  kennzahlen: [],
  urls: { objektSeite: "https://steinadel.example/rittergut", expose: "", ogBild: "", cover: "" },
  kampagnen: [],
};

/** Wie PostgREST ohne Recht auf die Tabelle: 42501, für den Schlüssel des Browser-Clients HTTP 401. Andere Tabellen und der Service-Schlüssel bleiben unberührt. */
function browserOhneRechte() {
  welt.stoerung = (a) =>
    a.tabelle === "content" && a.kopf.get("apikey") === ANON
      ? { status: 401, body: { code: "42501", details: null, hint: null, message: "permission denied for table content" } }
      : null;
}

/** Abrufe des Browsers mit relativem Pfad gehen an die echten Routen im Prozess; absolute an die Attrappen. */
function serverImProzess() {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/")) return FAKE_FETCH(input, init);
    const voll = new URL(url, "http://harness.local");
    const req = new NextRequest(voll.href, { headers: { cookie: "gp-auth=test" } });
    const p = voll.pathname;
    if (p === "/api/content/liste") return (await listeRoute()).GET(req);
    const eintrag = /^\/api\/content\/eintrag\/([^/]+)$/.exec(p);
    if (eintrag) return (await eintragRoute()).GET(req, { params: Promise.resolve({ id: decodeURIComponent(eintrag[1]) }) });
    const studio = /^\/api\/studio\/([^/]+)$/.exec(p);
    if (studio) return (await studioRoute()).GET(req, { params: Promise.resolve({ objekt: decodeURIComponent(studio[1]) }) });
    if (p === "/api/content/pipeline" && !init.method) return Response.json({ launch_calendar: null });
    if (p === "/api/objekte") return Response.json({ objekte: [] });
    throw new Error(`Test: unerwarteter Abruf ${url}`);
  };
}

async function studioAnsicht() {
  const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
  const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
  const studio = ladeStudioBausteine({ ...ECHT, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln });
  return ladeTsx("components/studio/StudioAnsicht.tsx", {
    ...ECHT,
    ...studio.module,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks-status": hooksStatus,
    "@/lib/types": types,
    "@/lib/studio/objekte": await ladeModul("src/lib/studio/objekte.ts"),
    "@/lib/studio/regeln": await ladeModul("src/lib/studio/regeln.ts"),
  });
}

test("R6 Browser-Client ohne Rechte auf content (Simulation): Er bekommt für content nur Fehler; /content und das Studio zeigen trotzdem alle Zeilen über den Server", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // 12 Zeilen: 7 des RitterGuts, 3 eines anderen Objekts, 2 ohne Objekt.
  for (let i = 1; i <= 12; i++) {
    zeileDb(i, { am: new Date(Date.UTC(2026, 6, 27, 20) + i * 600_000).toISOString(), status: i % 3 === 0 ? "abgelehnt" : "zur_freigabe", slug: i <= 7 ? SLUG : i <= 10 ? "villa-x" : null });
  }
  welt.tabellen.agents = [{ id: "oracle", name: "ORACLE", tier: 1 }];
  welt.objekteAntwort = { status: 200, body: { version: "1", quelle: "Test-Export", generiert_am: "2026-11-08T07:30:00Z", objekte: [RITTERGUT] } };
  browserOhneRechte();

  // 1. Der Supabase-Client des Browsers (lib/supabase.ts): Jede Art Zugriff auf content scheitert.
  const { supabase } = await ladeModul("src/lib/supabase.ts");
  const versuche = {
    lesen: () => supabase.from("content").select("*").order("created_at", { ascending: false }).limit(50),
    zeile: () => supabase.from("content").select("*").eq("id", 1).maybeSingle(),
    einfuegen: () => supabase.from("content").insert({ title: "x" }),
    aendern: () => supabase.from("content").update({ status: "freigegeben" }).eq("id", 1),
    loeschen: () => supabase.from("content").delete().eq("id", 1),
  };
  for (const [name, versuch] of Object.entries(versuche)) {
    const { data, error } = await versuch();
    assert.equal(error?.code, "42501", `${name}: ${JSON.stringify(error)}`);
    assert.equal(data, null, name);
  }
  assert.equal(welt.content.length, 12, "nichts geschrieben, nichts gelöscht");
  assert.ok(welt.content.every((z) => z.status !== "freigegeben"));
  // Andere Tabellen bleiben für den Browser-Client lesbar (die Simulation betrifft nur content).
  const agents = await supabase.from("agents").select("*");
  assert.equal(agents.error, null);
  assert.equal(agents.data.length, 1);

  // 2. /content: alle 12 Zeilen über GET /api/content/liste; Realtime-Kanäle würden nichts liefern.
  const kanaele = [];
  const inert = { on: () => inert, subscribe: () => inert };
  const browserClient = new Proxy(supabase, {
    get(ziel, name) {
      if (name === "channel") {
        return (kanal) => {
          kanaele.push(kanal);
          return inert;
        };
      }
      if (name === "removeChannel") return () => {};
      return Reflect.get(ziel, name);
    },
  });
  const anfragen = schluesselMitschnitt();
  serverImProzess();
  const lz = await contentSeite({ browserClient });
  lz.rendere();
  const baum = await lz.ruhe();
  const tx = text(baum);
  assert.ok(!tx.includes("Content nicht lesbar"), tx.slice(0, 800));
  const sichtbar = finde(baum, (k) => k.type === "h3" && /^Lauf \d+$/.test(text(k))).map((k) => Number(text(k).slice(5)));
  assert.deepEqual(sichtbar.sort((a, b) => a - b), welt.content.map((z) => z.id).sort((a, b) => a - b), "alle Zeilen der Tabelle");
  assert.ok(standZeile(baum)?.startsWith("Liste: Stand "), "Stand-Zeile");
  assert.deepEqual(kanaele, [], "kein Realtime-Kanal");
  assert.ok(anfragen.length > 0 && anfragen.every((a) => a === "content:service"), anfragen.join(", "));

  // 3. Studio: alle 7 Zeilen des RitterGuts über GET /api/studio/<slug>.
  const V = await studioAnsicht();
  const lzStudio = hookLaufzeit();
  offeneSeiten.push(lzStudio);
  const erfasst = [];
  const seite = ladeTsx("app/studio/[objekt]/page.tsx", {
    ...lzStudio.attrappen,
    "next/navigation": { useParams: () => ({ objekt: SLUG }) },
    "@/components/studio/StudioAnsicht": {
      StudioAnsicht: (props) => {
        erfasst.push(props);
        return null;
      },
      leseStudioAntwort: V.leseStudioAntwort,
    },
    "@/components/studio/beleg-hilfen": { maskiert: regeln.maskiereGeschuetzteNamen },
  });
  lzStudio.setzeWurzel(seite.default);
  lzStudio.rendere();
  await lzStudio.ruhe();
  const lesung = erfasst[erfasst.length - 1].lesung;
  assert.equal(lesung.art, "daten", JSON.stringify(lesung).slice(0, 300));
  assert.equal(lesung.antwort.assets.status, "ok", JSON.stringify(lesung.antwort.assets).slice(0, 300));
  assert.equal(lesung.antwort.assets.gesamt, 7);
  const html = renderToStaticMarkup(React.createElement(V.StudioAnsicht, { slug: SLUG, lesung, kopiere: () => {}, kopierStatus: () => "Kopieren" }));
  const assets = [...html.matchAll(/data-asset="(\d+)"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  assert.deepEqual(assets, [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(anfragen.every((a) => a === "content:service"), anfragen.join(", "));
});

// ═══ Teil M: Mutationsprüfung (09.11.2026) ═══
// Je Test in Klammern die Mutanten, die vorher die ganze Suite überlebten (Mutationslauf gegen 35ad61a in
// einer eigenen Kopie). Jeder Test ist mit seinem Mutanten rot und ohne ihn grün; Produktcode unverändert.

test("R-M1 (M35, M36) Cache-Control no-store auf jeder Antwort beider Routen — auch 400 eingabe, 502 supabase und 500 konfiguration der Zeile", async () => {
  zeileDb(7, { am: "2026-11-08T07:00:00Z" });
  const pruefe = (name, r, status, art) => {
    assert.equal(r.status, status, name);
    assert.equal(r.body.fehler_art, art, name);
    assert.equal(r.kopf.get("cache-control"), "no-store", `${name}: Cache-Control`);
  };
  pruefe("Liste", await holeListe(), 200, undefined);
  pruefe("Zeile", await holeEintrag(7), 200, undefined);
  pruefe("Zeile fehlt", await holeEintrag(9), 404, "nicht_gefunden");
  for (const roh of ["abc", "0", "07", " 7"]) pruefe(`Zeile ${JSON.stringify(roh)}`, await holeEintrag(roh), 400, "eingabe");
  welt.stoerung = (a) => (a.tabelle === "content" ? { status: 500, body: { code: "XX000", message: "kaputt" } } : null);
  pruefe("Liste, Lesefehler", await holeListe(), 502, "supabase");
  pruefe("Zeile, Lesefehler", await holeEintrag(7), 502, "supabase");
  welt.stoerung = null;
  welt.vorAntwort = async () => {
    throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  };
  pruefe("Liste, Zeitüberschreitung", await holeListe(), 502, "supabase");
  pruefe("Zeile, Zeitüberschreitung", await holeEintrag(7), 502, "supabase");
  welt.vorAntwort = null;
  delete process.env.SUPABASE_SERVICE_KEY;
  pruefe("Liste ohne Schlüssel", await holeListe(), 500, "konfiguration");
  pruefe("Zeile ohne Schlüssel", await holeEintrag(7), 500, "konfiguration");
});

test("R-M2 (M46) Liste: gelesen_am ist der Zeitpunkt nach der Abfrage (Uhr des Servers) — dauert die Abfrage 4 s, liegt er 4 s nach ihrem Beginn", async (t) => {
  zeileDb(1, { am: "2026-11-08T07:00:00Z" });
  // Attrappen-Uhr für Date: Sie steht still, bis die PostgREST-Attrappe während der Abfrage 4 s vorstellt.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-08T21:00:00.000Z") });
  welt.vorAntwort = async (a) => {
    if (a.art === "supabase") t.mock.timers.tick(4_000);
  };
  const { status, body } = await holeListe();
  assert.equal(status, 200);
  assert.equal(welt.log.length, 1, "genau eine Abfrage");
  assert.equal(body.gelesen_am, "2026-11-08T21:00:04.000Z");
});

test("R-M3 (M71) Unerwartete Ausnahme in einer Route: 500 programmfehler mit bereinigtem Grund und no-store — nicht 502 supabase; Supabase nicht abgefragt", async (t) => {
  zeileDb(7, { am: "2026-11-08T07:00:00Z" });
  // Die Ausnahme fällt im try-Block der Route selbst: Das Abbruchsignal wirft schon beim Erzeugen. Abruffehler
  // fängt supabase-js dagegen selbst ab und meldet sie als error (R2-R3: AbortError → 502 supabase).
  t.mock.method(AbortSignal, "timeout", () => {
    throw new Error(`unerwartet: ${SERVICE} bei https://abc.supabase.co/rest/v1/content`);
  });
  const ausListe = await holeListe();
  assert.equal(ausListe.status, 500);
  assert.equal(ausListe.kopf.get("cache-control"), "no-store");
  assert.deepEqual(ausListe.body, { fehler: "Content-Liste nicht ermittelbar: unerwartet: [entfernt] bei [URL]", fehler_art: "programmfehler" });
  const ausZeile = await holeEintrag(7);
  assert.equal(ausZeile.status, 500);
  assert.equal(ausZeile.kopf.get("cache-control"), "no-store");
  assert.deepEqual(ausZeile.body, { fehler: "Eintrag nicht ermittelbar: unerwartet: [entfernt] bei [URL]", fehler_art: "programmfehler" });
  assert.deepEqual(welt.log, [], "Supabase nicht abgefragt");
});

test("R-M4 (M79) Antwort ohne lesbares JSON (etwa die Fehlerseite eines Proxys) heißt 'HTTP <Status>', nicht 'Server nicht erreichbar' — Neuabfrage, erste Abfrage und Neuladen einer Zeile", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const PROXY_SEITE = "<!doctype html><title>Proxy</title><p>Gateway-Fehler</p>";
  const L = await contentListe();

  // 1. Neuabfrage nach gelesener Liste: Die Liste bleibt, der Grund ist der Status.
  const n1 = netz();
  const lz1 = await contentSeite();
  let baum = await gestartet(n1, lz1, [z(1)]);
  t.mock.timers.tick(15_000);
  await lz1.ruhe();
  n1.liste()[1].antworteText(502, PROXY_SEITE);
  baum = await lz1.ruhe();
  assert.equal(alarm(baum), `Neue Abfrage fehlgeschlagen: HTTP 502 — angezeigt bleibt der Stand ${L.standZeit(T1)}; nächster Versuch im Takt.`);
  assert.deepEqual(eintraege(baum), ["Eintrag 1"]);
  lz1.abbauen();

  // 2. Erste Abfrage: "Content nicht lesbar" mit dem Status.
  const n2 = netz();
  const lz2 = await contentSeite();
  lz2.rendere();
  await lz2.ruhe();
  n2.liste()[0].antworteText(504, PROXY_SEITE);
  baum = await lz2.ruhe();
  const tx = text(baum);
  assert.ok(tx.includes("Content nicht lesbar: HTTP 504Neuer Versuch automatisch alle 15 s."), tx.slice(0, 1500));
  assert.ok(!tx.includes("Server nicht erreichbar"), tx.slice(0, 1500));
  lz2.abbauen();

  // 3. Neuladen einer Zeile nach 409: GET /api/content/eintrag/<id> liest den Körper ebenso.
  const n3 = netz({ statusAntworten: [[409, { fehler: "Eintrag hat sich zwischenzeitlich geändert (Status oder Inhalt) — neu laden" }]] });
  const lz3 = await contentSeite();
  baum = await gestartet(n3, lz3, [z(2)]);
  baum = await oeffne(lz3, baum, 2);
  baum = await klicke(lz3, freigebenKnopf(baum));
  assert.equal(n3.eintrag().length, 1);
  n3.eintrag()[0].antworteText(502, PROXY_SEITE);
  baum = await lz3.ruhe();
  const tx3 = text(baum);
  assert.ok(
    tx3.includes("Konflikt (HTTP 409): Eintrag hat sich zwischenzeitlich geändert (Status oder Inhalt) — neu laden · Neu laden fehlgeschlagen: HTTP 502 — Anzeige veraltet"),
    tx3.slice(0, 2500),
  );
});
