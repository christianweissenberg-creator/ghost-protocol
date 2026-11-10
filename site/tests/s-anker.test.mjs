// Objekt-Studio Schritt 6 (10.11.2026): Anker-Manifest (lib/studio/anker.ts), Hash-Prüfung und Cover-Abgleich
// (lib/studio/anker-pruefung.ts), Route GET /api/studio/[objekt]/anker und Anker-Panel
// (components/studio/AnkerPanel.tsx). Lauf: npm test.
//
// Kein Netz: /api/objekte (Steinadel-Export) und Supabase beantworten die Attrappen aus tests/harness/fake.mjs,
// steinadel.de eine eigene Attrappe in dieser Datei. Bilddateien gibt es im Test nicht — die Attrappe liefert
// Test-Bytes, deren SHA-256 der Test selbst rechnet. Die Hashes und Maße des echten Manifests prüft der Test
// gegen die Messung vom 10.11.2026 (Werte unten), nicht gegen einen Abruf.
// Die Umgebungswerte sind Test-Werte dieses Prozesses, keine echten Schlüssel.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wie tests/s-studio.test.mjs: "@/…" → src/….ts, "next/server" → node_modules, relative Importe ohne Endung
// aus .ts → ".ts", "server-only" → die leere Fassung, die Next.js im Server-Bundle nimmt.
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

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key-0000000000",
  SUPABASE_SERVICE_KEY: "service-test-key-1234567890abcdef",
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
});

const fake = await import("./harness/fake.mjs");
const { welt, zuruecksetzen } = fake;
fake.installiere();
const { React, jsxRuntime, renderToStaticMarkup, finde, ts } = await import("./harness/tsx.mjs");
const { ladeAnkerPanel, ladeStudioBausteine, hookLaufzeit, alsMarkup } = await import("./harness/studio.mjs");
const { NextRequest } = await import("next/server");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const counsel = await import("../src/lib/counsel-urteil.ts");
const types = await import("../src/lib/types.ts");
const objekte = await import("../src/lib/studio/objekte.ts");
const anker = await import("../src/lib/studio/anker.ts");
const pruefung = await import("../src/lib/studio/anker-pruefung.ts");
const studioRoute = await import(pathToFileURL(path.join(SITE, "src/app/api/studio/[objekt]/route.ts")).href);
const ankerRoute = await import(pathToFileURL(path.join(SITE, "src/app/api/studio/[objekt]/anker/route.ts")).href);

const NAME = ["Immo", "Nexus"].join("");
const ENTHAELT_NAMEN = /imm[ou][\s._-]*nexus/i;
const SLUG = "rittergut-seifersdorf";
const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const MANIFEST = anker.ANKER_MANIFESTE[SLUG];
const HILFEN = ladeStudioBausteine({ ...ECHT, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }).hilfen;

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
/** Sichtbarer Text (ohne Tags und title-Attribute). */
const sichtbar = (html) => ent(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

/** Zeitpunkt in Europe/Berlin mit Zonenangabe, unabhängig von lib/types.ts gerechnet. */
const BERLIN_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function berlin(iso) {
  const t = Object.fromEntries(BERLIN_FORMAT.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${t.day}.${t.month}.${t.year} ${t.hour}:${t.minute}:${t.second} (Europe/Berlin)`;
}

// ─── Attrappe für steinadel.de ────────────────────────────────────────────────
// dateien: Pfad → Antwort (Funktion (url, init) → Response bzw. Promise) oder { bytes, typ }. Jeder Abruf wird
// mit seinen Optionen protokolliert; ohne Eintrag antwortet die Attrappe 404.

const steinadel = { dateien: new Map(), abrufe: [], aktiv: 0, hoechstens: 0, verzoegerungMs: 0 };
const harnessFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname !== "steinadel.de") return harnessFetch(input, init);
  steinadel.abrufe.push({ url: url.href, init });
  steinadel.aktiv += 1;
  steinadel.hoechstens = Math.max(steinadel.hoechstens, steinadel.aktiv);
  try {
    if (steinadel.verzoegerungMs > 0) await new Promise((fertig) => setTimeout(fertig, steinadel.verzoegerungMs));
    const d = steinadel.dateien.get(url.pathname);
    if (typeof d === "function") return await d(url, init);
    if (d === undefined) return new Response("nicht gefunden", { status: 404, headers: { "content-type": "text/plain" } });
    return new Response(d.bytes, { status: 200, headers: { "content-type": d.typ ?? "image/jpeg" } });
  } finally {
    steinadel.aktiv -= 1;
  }
};

beforeEach(() => {
  zuruecksetzen();
  steinadel.dateien.clear();
  steinadel.abrufe.length = 0;
  steinadel.aktiv = 0;
  steinadel.hoechstens = 0;
  steinadel.verzoegerungMs = 0;
  process.env.SUPABASE_SERVICE_KEY = "service-test-key-1234567890abcdef";
});

/** Strom aus Stücken; zaehler.gezogen zählt die Lesevorgänge, zaehler.abgebrochen den Abbruch durch den Leser. */
function strom(stuecke, zaehler) {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      zaehler.gezogen += 1;
      if (i < stuecke.length) c.enqueue(stuecke[i++]);
      else c.close();
    },
    cancel() {
      zaehler.abgebrochen = true;
    },
  });
}

/** AbortSignal.timeout mitschreiben: Millisekunden je Signal. */
async function mitZeitlimits(fn) {
  const original = AbortSignal.timeout;
  const ms = new WeakMap();
  AbortSignal.timeout = (n) => {
    const s = original.call(AbortSignal, n);
    ms.set(s, n);
    return s;
  };
  try {
    return await fn((signal) => ms.get(signal) ?? null);
  } finally {
    AbortSignal.timeout = original;
  }
}

// ─── Testdaten ───────────────────────────────────────────────────────────────

const BYTES_A = new TextEncoder().encode("ANKER-TESTDATEI-A ".repeat(40)); // 720 B
const BYTES_B = new TextEncoder().encode("ANKER-TESTDATEI-B ".repeat(40)); // 720 B, anderer Inhalt
const TEST_URL = "https://steinadel.de/objekte/test/anker-a.jpg";

function testEintrag(felder = {}) {
  return {
    id: "test-a",
    url: TEST_URL,
    sha256: sha(BYTES_A),
    bytes: BYTES_A.length,
    breite: 3000,
    hoehe: 2000,
    art: "visualisierung",
    herkunft: { text: "Testherkunft", expose_seite: 7 },
    personen: { stand: "nein", text: null },
    als_anker: true,
    hinweis: null,
    ...felder,
  };
}

/** Test-Manifest: a wird richtig ausgeliefert, b fehlt (404); Cover-Anker a. */
function testManifest() {
  return {
    gemessen_am: "2026-11-10T07:59:15Z",
    messweg: "Test",
    cover_anker: "test-a",
    eintraege: [testEintrag(), testEintrag({ id: "test-b", url: "https://steinadel.de/objekte/test/anker-b.jpg", sha256: sha(BYTES_B), bytes: BYTES_B.length })],
  };
}

const COVER_URL = "https://steinadel.de/objekte/rittergut/hero-hof-nacht.jpg";
const RITTERGUT = { slug: SLUG, name: "RitterGut Seifersdorf", ort: "Testort", baujahr: 1335, preis: "ab 1 € (Testwert)", statusBadge: "Vermarktung", afaProzent: 100, istDenkmal: true };

function exportMit(objekt = { ...RITTERGUT, urls: { cover: COVER_URL } }) {
  return { status: 200, body: { version: "1", quelle: "Testquelle", generiert_am: "2026-11-10T07:00:00Z", objekte: [objekt] } };
}

async function holeAnker(slug = SLUG, { cookie = "gp-auth=test", params, suche = "" } = {}) {
  const req = new NextRequest(`http://harness.local/api/studio/${encodeURIComponent(slug)}/anker${suche}`, { headers: { cookie } });
  const res = await ankerRoute.GET(req, { params: params ?? Promise.resolve({ objekt: slug }) });
  return { status: res.status, kopf: res.headers, body: await res.json() };
}

async function holeStudio(slug = SLUG) {
  const req = new NextRequest(`http://harness.local/api/studio/${slug}`, { headers: { cookie: "gp-auth=test" } });
  const res = await studioRoute.GET(req, { params: Promise.resolve({ objekt: slug }) });
  return res.json();
}

// ═══ M: Manifest ═══

/** Messung der Live-Dateien am 10.11.2026, 07:59:15–07:59:17Z (je ein Abruf, im Speicher): Pfad, Bytes, SHA-256, Maße. */
const GEMESSEN = [
  ["hof-nacht", "/objekte/rittergut/hero-hof-nacht.jpg", 667131, "4ea1631f9799b83c808db4facffeebcfb2c31ff05ef5edb0fd79445a42a19a0e", 3000, 2018],
  ["terrasse-pergola", "/objekte/rittergut/wintergarten.jpg", 370164, "594f8cd87280648a631829fa7407df0cb9aef2dab960251c1d9601eef7b3d9b4", 2000, 1042],
  ["lofts-balkone", "/objekte/rittergut/lofts-balkone.jpg", 368317, "c950ee134a837b8c87a05a6ca17f8ec4bf842bdfd2707554c8cd7729b9f9433d", 2000, 1042],
  ["jagdhaus", "/objekte/rittergut-seifersdorf/gebaeude/jagdhaus.jpg", 745788, "f2bd5d2cd0d9659cb329d81a0a4a15752d11fd8a1c82e69037d7370ff894dfb0", 2000, 1200],
  ["gutshaus", "/objekte/rittergut-seifersdorf/gebaeude/gutshaus.jpg", 840213, "06f1a59be2cc446f21fa195cc15fc180e7fe52b82cd05e1dccbbc1a63962b0f9", 2000, 1200],
  ["schwerthof", "/objekte/rittergut-seifersdorf/gebaeude/schwerthof.jpg", 589852, "24827bfc84648532bd4e672033f8af6b5948d16aa7325eb68655a160c08ce30e", 2000, 1042],
  ["fassade-golden", "/objekte/rittergut/fassade-golden.jpg", 212685, "ca6e7f1b14de8156a68a8b8da1ff6f1be3f95b905eb4cff6ab667e62cd876637", 1500, 900],
  ["burghof", "/objekte/rittergut-seifersdorf/gebaeude/burghof.jpg", 332579, "1a26001503abba004cd59259606a3c961e51bf5e723db8267d9007ab79baf6e5", 1500, 900],
  ["fassade-abend", "/objekte/rittergut/fassade-sonnenuntergang.jpg", 153814, "43813810938a8dec70601379efea1d4df925ad96dbbfae5cee8d41b84d9e2cce", 1484, 890],
  ["wintergarten-2", "/objekte/rittergut/wintergarten-2.jpg", 160267, "09e6eb04fda56932dfad394a78fad976f703d3bf1522a6ef5dc2c7bbd27f1c08", 1285, 643],
  ["loft-stimmung", "/objekte/rittergut/interieur-loft.jpg", 124242, "4e34bb945af0e74b93ee773aed6dd2b0e9e31d8b933c24ba7d966902d5f77664", 686, 858],
];

test("AN-M1 Manifest: je Objekt der Allow-List genau eines, Felder wie vereinbart, eindeutig, eingefroren", () => {
  assert.deepEqual(Object.keys(anker.ANKER_MANIFESTE), [...objekte.STUDIO_OBJEKTE]);
  assert.equal(MANIFEST.gemessen_am, "2026-11-10T07:59:15Z");
  assert.ok(Number.isFinite(Date.parse(MANIFEST.gemessen_am)));
  assert.equal(MANIFEST.cover_anker, "hof-nacht");
  const felder = ["id", "url", "sha256", "bytes", "breite", "hoehe", "art", "herkunft", "personen", "als_anker", "hinweis"];
  for (const e of MANIFEST.eintraege) {
    assert.deepEqual(Object.keys(e), felder, e.id);
    assert.deepEqual(Object.keys(e.herkunft), ["text", "expose_seite"], e.id);
    assert.deepEqual(Object.keys(e.personen), ["stand", "text"], e.id);
    assert.match(e.sha256, /^[0-9a-f]{64}$/, e.id);
    for (const n of [e.bytes, e.breite, e.hoehe]) assert.ok(Number.isSafeInteger(n) && n > 0, e.id);
    assert.ok(anker.istManifestUrl(e.url), e.url);
    assert.ok(["visualisierung", "ki_stimmungsbild"].includes(e.art), e.id);
    assert.ok(["ja", "nein", "nicht_geprueft"].includes(e.personen.stand), e.id);
    assert.equal(typeof e.als_anker, "boolean");
    assert.ok(e.hinweis === null || (typeof e.hinweis === "string" && e.hinweis.length > 0));
    for (const teil of [e, e.herkunft, e.personen]) assert.ok(Object.isFrozen(teil), e.id);
  }
  for (const feld of ["id", "url", "sha256"]) {
    const werte = MANIFEST.eintraege.map((e) => e[feld]);
    assert.equal(new Set(werte).size, werte.length, feld);
  }
  assert.ok(Object.isFrozen(anker.ANKER_MANIFESTE) && Object.isFrozen(MANIFEST) && Object.isFrozen(MANIFEST.eintraege));
  const cover = MANIFEST.eintraege.find((e) => e.id === MANIFEST.cover_anker);
  assert.equal(cover.url, COVER_URL);
  assert.equal(cover.als_anker, true);
});

test("AN-M2 Manifest = Messung vom 10.11.2026: Adresse, Bytes, SHA-256, Maße; hof-nacht beginnt mit 4ea1631f9799b83c", () => {
  assert.deepEqual(
    MANIFEST.eintraege.map((e) => [e.id, anker.dateiPfad(e.url), e.bytes, e.sha256, e.breite, e.hoehe]),
    GEMESSEN,
  );
  assert.ok(MANIFEST.eintraege.every((e) => e.url === `${anker.ANKER_URSPRUNG}${anker.dateiPfad(e.url)}`));
  assert.ok(MANIFEST.eintraege[0].sha256.startsWith("4ea1631f9799b83c"));
});

test("AN-M3 Manifest: Art, Exposé-Seite, Personen, Eignung — interieur-loft ist 'KI-Stimmungsbild, kein Anker'", () => {
  const je = Object.fromEntries(MANIFEST.eintraege.map((e) => [e.id, e]));
  // Exposé-Seiten: nur die vier mit byte-gleichem Seiten-Export belegt.
  assert.deepEqual(
    Object.fromEntries(MANIFEST.eintraege.map((e) => [e.id, e.herkunft.expose_seite])),
    { "hof-nacht": 18, "terrasse-pergola": 4, "lofts-balkone": 45, jagdhaus: null, gutshaus: null, schwerthof: null, "fassade-golden": null, burghof: null, "fassade-abend": 37, "wintergarten-2": null, "loft-stimmung": null },
  );
  assert.deepEqual(
    Object.fromEntries(MANIFEST.eintraege.map((e) => [e.id, anker.personenText(e.personen)])),
    { "hof-nacht": "ja, ca. 8", "terrasse-pergola": "ja", "lofts-balkone": "nicht geprüft", jagdhaus: "nicht geprüft", gutshaus: "nicht geprüft", schwerthof: "nicht geprüft", "fassade-golden": "ja", burghof: "ja", "fassade-abend": "nicht geprüft", "wintergarten-2": "nicht geprüft", "loft-stimmung": "nicht geprüft" },
  );
  const loft = je["loft-stimmung"];
  assert.equal(anker.dateiName(loft.url), "interieur-loft.jpg");
  assert.equal(loft.art, "ki_stimmungsbild");
  assert.equal(loft.als_anker, false);
  assert.equal(anker.artText(loft), "KI-Stimmungsbild, kein Anker");
  assert.deepEqual(MANIFEST.eintraege.filter((e) => !e.als_anker).map((e) => e.id), ["loft-stimmung"]);
  for (const e of MANIFEST.eintraege.filter((x) => x.als_anker)) {
    assert.equal(e.art, "visualisierung", e.id);
    assert.equal(anker.artText(e), "Visualisierung", e.id);
  }
  // "Nur mit Vorsicht" genau bei den Ankern unter 1920 px Breite.
  const vorsicht = MANIFEST.eintraege.filter((e) => e.hinweis?.startsWith("nur mit Vorsicht")).map((e) => e.id);
  assert.deepEqual(vorsicht, MANIFEST.eintraege.filter((e) => e.als_anker && e.breite < 1920).map((e) => e.id));
  assert.deepEqual(vorsicht, ["fassade-golden", "burghof", "fassade-abend", "wintergarten-2"]);
  assert.equal(anker.artText({ art: "visualisierung", als_anker: false }), "Visualisierung, kein Anker");
  assert.equal(anker.personenText({ stand: "nein", text: null }), "nein");
  assert.equal(anker.personenText({ stand: "nicht_geprueft", text: "x" }), "nicht geprüft, x");
});

test("AN-M4 Manifest nur mit öffentlichen Fakten: kein Rechtestatus, kein geschützter Name, Bauträger nicht genannt", () => {
  const daten = JSON.stringify(anker.ANKER_MANIFESTE);
  assert.doesNotMatch(daten, /recht|lizenz|urheber|genehmig|geklärt|geklaert|freigegeben|copyright|©/i);
  assert.doesNotMatch(daten, ENTHAELT_NAMEN);
  assert.doesNotMatch(daten, /Bauträger/);
  assert.doesNotMatch(daten, /\bFoto\b/, "ein Anker heißt nie Foto");
  // Die Datei selbst: keine Laufzeit-Importe (Browser und Server lesen sie), nur der Typ der Allow-List.
  const quelle = readFileSync(path.join(SITE, "src/lib/studio/anker.ts"), "utf8");
  const sf = ts.createSourceFile("anker.ts", quelle, ts.ScriptTarget.Latest, true);
  const importe = sf.statements.filter((s) => ts.isImportDeclaration(s));
  assert.ok(importe.every((s) => s.importClause?.isTypeOnly), "nur import type");
});

test("AN-M5 ankerManifest: nur Objekte der Allow-List, keine geerbten Schlüssel", () => {
  assert.equal(anker.ankerManifest(SLUG), MANIFEST);
  for (const s of ["constructor", "__proto__", "toString", "hasOwnProperty", "villa-x", "", 5, null, undefined, [SLUG]]) {
    assert.equal(anker.ankerManifest(s), null, String(s));
  }
});

// ═══ S: Sicherheit — nur Manifest-Adressen ═══

test("AN-S1 istManifestUrl: nur https://steinadel.de/objekte/….jpg in normalisierter Schreibweise", () => {
  for (const ok of ["https://steinadel.de/objekte/x.jpg", "https://steinadel.de/objekte/a-b/c-1/d2.jpg", ...MANIFEST.eintraege.map((e) => e.url)]) {
    assert.equal(anker.istManifestUrl(ok), true, ok);
  }
  for (const nein of [
    "http://steinadel.de/objekte/rittergut/hero-hof-nacht.jpg",
    "https://steinadel.de.evil.example/objekte/a.jpg",
    "https://evil.example/objekte/a.jpg",
    "https://evil.example/steinadel.de/objekte/a.jpg",
    "https://steinadel.de@evil.example/objekte/a.jpg",
    "https://user:pw@steinadel.de/objekte/a.jpg",
    "https://user@steinadel.de/objekte/a.jpg",
    "https://:pw@steinadel.de/objekte/a.jpg",
    "https://steinadel.de/api/objekte/a.jpg",
    "https://steinadel.de:8443/objekte/a.jpg",
    "https://steinadel.de:443/objekte/a.jpg",
    "https://STEINADEL.de/objekte/a.jpg",
    "https://www.steinadel.de/objekte/a.jpg",
    "https://steinadel.de/objekte/../api/objekte/export",
    "https://steinadel.de/objekte/../a.jpg",
    "https://steinadel.de/objekte/%2e%2e/a.jpg",
    "https://steinadel.de/objekte/a%2Fb.jpg",
    "https://steinadel.de/objekte/a.jpg?x=1",
    "https://steinadel.de/objekte/a.jpg#x",
    "https://steinadel.de/objekte/a.jpg/",
    "https://steinadel.de/api/objekte/export",
    "https://steinadel.de/objekte.jpg",
    "https://steinadel.de/objekte/a.png",
    "https://steinadel.de/objekte/A.jpg",
    "https://steinadel.de/objekte//a.jpg",
    "https://steinadel.de/objekte/a-.jpg",
    "https://steinadel.de/objekte/-a.jpg",
    "https://steinadel.de/objekte/a--b.jpg",
    "https://steinadel.de\\objekte\\a.jpg",
    " https://steinadel.de/objekte/a.jpg",
    "https://127.0.0.1/objekte/a.jpg",
    "https://[::1]/objekte/a.jpg",
    "https://169.254.169.254/objekte/a.jpg",
    "file:///objekte/a.jpg",
    "/objekte/rittergut/hero-hof-nacht.jpg",
    `https://steinadel.de/objekte/${"a".repeat(300)}.jpg`,
    "",
    null,
    42,
    { href: "https://steinadel.de/objekte/x.jpg" },
  ]) {
    assert.equal(anker.istManifestUrl(nein), false, String(nein));
  }
});

test("AN-S2 Hash-Prüfung ruft eine Adresse außerhalb des Musters nie ab", async () => {
  for (const url of ["http://127.0.0.1:8000/objekte/a.jpg", "https://steinadel.de/api/objekte/export", "https://steinadel.de/objekte/a.jpg?x=1"]) {
    const r = await pruefung.pruefeAnkerDatei(testEintrag({ url }));
    assert.equal(r.status, "nicht_erreichbar", url);
    assert.equal(r.http_status, null);
    assert.equal(r.hinweis, "Adresse liegt nicht unter https://steinadel.de/objekte/ — nicht abgerufen");
  }
  assert.equal(steinadel.abrufe.length, 0, "kein Abruf");
  assert.equal(welt.log.length + welt.objektAbrufe, 0);
});

// ═══ H: Hash-Prüfung einer Datei ═══

test("AN-H1 unverändert: gleicher SHA-256 und gleiche Größe; Abruf ohne Cache, ohne Weiterleitung, mit 10 s Zeitlimit", async () => {
  steinadel.dateien.set("/objekte/test/anker-a.jpg", { bytes: BYTES_A });
  const vorher = Date.now();
  const { r, ms } = await mitZeitlimits(async (msVon) => {
    const r = await pruefung.pruefeAnkerDatei(testEintrag());
    return { r, ms: msVon(steinadel.abrufe[0].init.signal) };
  });
  assert.deepEqual({ ...r, gemessen_am: "x" }, {
    id: "test-a",
    status: "unveraendert",
    sha256_soll: sha(BYTES_A),
    sha256_live: sha(BYTES_A),
    bytes_soll: 720,
    bytes_live: 720,
    http_status: 200,
    gemessen_am: "x",
    hinweis: null,
  });
  assert.ok(Date.parse(r.gemessen_am) >= vorher - 5 && Date.parse(r.gemessen_am) <= Date.now() + 5);
  assert.equal(steinadel.abrufe.length, 1);
  assert.equal(steinadel.abrufe[0].url, TEST_URL);
  assert.equal(steinadel.abrufe[0].init.redirect, "manual");
  assert.equal(steinadel.abrufe[0].init.cache, "no-store");
  assert.equal(ms, 10_000);
  assert.equal(pruefung.ANKER_TIMEOUT_MS, 10_000);
});

test("AN-H2 geändert: gleiche Größe, anderer Inhalt bzw. andere Größe — mit Live-Hash und Grund", async () => {
  steinadel.dateien.set("/objekte/test/anker-a.jpg", { bytes: BYTES_B });
  const r1 = await pruefung.pruefeAnkerDatei(testEintrag());
  assert.equal(r1.status, "geaendert");
  assert.equal(r1.sha256_live, sha(BYTES_B));
  assert.equal(r1.bytes_live, 720);
  assert.equal(r1.http_status, 200);
  assert.equal(r1.hinweis, "gleiche Größe, anderer Inhalt");
  // Kürzer, als HTML (Fehlerseite mit 200): Größe und Typ im Grund.
  const kurz = BYTES_A.slice(0, 500);
  steinadel.dateien.set("/objekte/test/anker-a.jpg", { bytes: kurz, typ: "text/html; charset=utf-8" });
  const r2 = await pruefung.pruefeAnkerDatei(testEintrag());
  assert.equal(r2.status, "geaendert");
  assert.equal(r2.sha256_live, sha(kurz));
  assert.equal(r2.bytes_live, 500);
  assert.equal(r2.hinweis, "500 B statt 720 B; Antwort vom Typ text/html");
  // Typ in Großbuchstaben: kleingeschrieben im Grund; ohne Typ-Angabe: kein Zusatz.
  steinadel.dateien.set("/objekte/test/anker-a.jpg", { bytes: kurz, typ: "Text/HTML" });
  assert.equal((await pruefung.pruefeAnkerDatei(testEintrag())).hinweis, "500 B statt 720 B; Antwort vom Typ text/html");
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => new Response(BYTES_B, { status: 200 }));
  const ohneTyp = await pruefung.pruefeAnkerDatei(testEintrag());
  assert.equal(ohneTyp.status, "geaendert");
  assert.equal(ohneTyp.hinweis, "gleiche Größe, anderer Inhalt");
  // Leerer Inhalt: 0 B ist hier gemessen, kein Platzhalter.
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } }));
  const r3 = await pruefung.pruefeAnkerDatei(testEintrag());
  assert.equal(r3.status, "geaendert");
  assert.equal(r3.bytes_live, 0);
  assert.equal(r3.hinweis, "0 B statt 720 B");
  // Gleicher Hash, aber die Manifest-Größe stimmt nicht: nie "unverändert".
  steinadel.dateien.set("/objekte/test/anker-a.jpg", { bytes: BYTES_A });
  const r4 = await pruefung.pruefeAnkerDatei(testEintrag({ bytes: 721 }));
  assert.equal(r4.status, "geaendert");
  assert.equal(r4.hinweis, "720 B statt 721 B");
  // Gleiche Größe, Hash im Manifest anders: "geändert", auch wenn die Datei sonst passt.
  const r5 = await pruefung.pruefeAnkerDatei(testEintrag({ sha256: sha(BYTES_B) }));
  assert.equal(r5.status, "geaendert");
  assert.equal(r5.hinweis, "gleiche Größe, anderer Inhalt");
  assert.equal(new Intl.NumberFormat("de-DE").format(667131), "667.131", "Zahlformat der Hinweise");
});

test("AN-H3 Größenlimit: Eine längere Live-Datei wird nur bis zur Manifest-Größe gelesen, dann abgebrochen", async () => {
  const zaehler = { gezogen: 0, abgebrochen: false };
  const stueck = new Uint8Array(100).fill(7);
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => new Response(strom(Array.from({ length: 1000 }, () => stueck), zaehler), { status: 200 }));
  const r = await pruefung.pruefeAnkerDatei(testEintrag({ bytes: 250 }));
  assert.equal(r.status, "geaendert");
  assert.equal(r.sha256_live, null, "kein Hash einer abgebrochenen Datei");
  assert.equal(r.bytes_live, null);
  assert.equal(r.http_status, 200);
  assert.equal(r.hinweis, "Live-Datei länger als die Manifest-Datei (250 B); Abruf dort abgebrochen");
  await new Promise((fertig) => setImmediate(fertig));
  assert.equal(zaehler.abgebrochen, true, "Strom abgebrochen");
  assert.ok(zaehler.gezogen <= 6, `nur bis knapp über das Limit gelesen (${zaehler.gezogen} Stücke)`);
  // Genau die Manifest-Größe ist erlaubt.
  const genau = { gezogen: 0, abgebrochen: false };
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => new Response(strom([BYTES_A.slice(0, 360), BYTES_A.slice(360)], genau), { status: 200 }));
  assert.equal((await pruefung.pruefeAnkerDatei(testEintrag())).status, "unveraendert");
  assert.equal(genau.abgebrochen, false);
});

test("AN-H4 nicht erreichbar: HTTP-Fehler und Weiterleitung (nicht gefolgt), Inhalt verworfen", async () => {
  const z404 = { gezogen: 0, abgebrochen: false };
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => new Response(strom([new Uint8Array(10)], z404), { status: 404 }));
  const r1 = await pruefung.pruefeAnkerDatei(testEintrag());
  assert.deepEqual([r1.status, r1.http_status, r1.hinweis, r1.sha256_live, r1.bytes_live], ["nicht_erreichbar", 404, "HTTP 404", null, null]);
  await new Promise((fertig) => setImmediate(fertig));
  assert.equal(z404.abgebrochen, true, "Inhalt der Fehlerantwort nicht gelesen");
  for (const status of [400, 500, 503, 204, 206]) {
    steinadel.dateien.set("/objekte/test/anker-a.jpg", () => new Response(status === 204 ? null : "x", { status }));
    const r = await pruefung.pruefeAnkerDatei(testEintrag());
    assert.deepEqual([r.status, r.http_status, r.hinweis], ["nicht_erreichbar", status, `HTTP ${status}`], String(status));
  }
  for (const status of [300, 301, 302, 307, 308]) {
    steinadel.abrufe.length = 0;
    steinadel.dateien.set("/objekte/test/anker-a.jpg", () => new Response(null, { status, headers: { location: "http://127.0.0.1:8000/intern" } }));
    const r = await pruefung.pruefeAnkerDatei(testEintrag());
    assert.deepEqual([r.status, r.http_status, r.hinweis], ["nicht_erreichbar", status, `Weiterleitung (HTTP ${status}) — nicht gefolgt`]);
    assert.deepEqual(steinadel.abrufe.map((a) => a.url), [TEST_URL], "Ziel der Weiterleitung nicht abgerufen");
  }
  // Laufzeit nach Browser-Art: opaqueredirect mit Status 0.
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => ({ status: 0, type: "opaqueredirect", headers: new Headers(), body: null }));
  const r2 = await pruefung.pruefeAnkerDatei(testEintrag());
  assert.deepEqual([r2.status, r2.http_status, r2.hinweis], ["nicht_erreichbar", null, "Weiterleitung — nicht gefolgt"]);
});

test("AN-H5 nicht erreichbar: Netzfehler mit Code, Zeitlimit, Abbruch beim Lesen — Grund bereinigt, Zeitpunkt des Versuchs", async () => {
  const fehler = new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }) });
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => {
    throw fehler;
  });
  const vorher = new Date().toISOString();
  const r1 = await pruefung.pruefeAnkerDatei(testEintrag());
  assert.deepEqual([r1.status, r1.http_status, r1.hinweis], ["nicht_erreichbar", null, "fetch failed (ENOTFOUND)"]);
  assert.ok(r1.gemessen_am >= vorher);
  // Steht der Code schon in der Meldung, kommt er nicht doppelt.
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => {
    throw new TypeError("getaddrinfo ENOTFOUND steinadel.de", { cause: { code: "ENOTFOUND" } });
  });
  assert.equal((await pruefung.pruefeAnkerDatei(testEintrag())).hinweis, "getaddrinfo ENOTFOUND steinadel.de");
  // Ursache ohne brauchbaren Code: kein Zusatz.
  for (const ursache of [{ code: "enotfound" }, { code: 5 }, "ECONNRESET", null]) {
    steinadel.dateien.set("/objekte/test/anker-a.jpg", () => {
      throw new TypeError("fetch failed", { cause: ursache });
    });
    assert.equal((await pruefung.pruefeAnkerDatei(testEintrag())).hinweis, "fetch failed", JSON.stringify(ursache));
  }
  // Zeitlimit beim Verbinden.
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  assert.equal((await pruefung.pruefeAnkerDatei(testEintrag())).hinweis, "Zeitüberschreitung (10 s)");
  // Zeitlimit und Abriss beim Lesen.
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => {
    let i = 0;
    return new Response(
      new ReadableStream({
        pull(c) {
          if (i++ === 0) c.enqueue(new Uint8Array(10));
          else c.error(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
        },
      }),
      { status: 200 },
    );
  });
  const r2 = await pruefung.pruefeAnkerDatei(testEintrag());
  assert.deepEqual([r2.status, r2.http_status, r2.hinweis, r2.sha256_live, r2.bytes_live], ["nicht_erreichbar", 200, "Abbruch beim Lesen: Zeitüberschreitung (10 s)", null, null]);
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => {
    let i = 0;
    return new Response(
      new ReadableStream({
        pull(c) {
          if (i++ === 0) c.enqueue(new Uint8Array(10));
          else c.error(new TypeError("terminated"));
        },
      }),
      { status: 200 },
    );
  });
  assert.equal((await pruefung.pruefeAnkerDatei(testEintrag())).hinweis, "Abbruch beim Lesen: terminated");
  // Schlüssel und Adressen im Fehlertext gehen nur bereinigt hinaus.
  steinadel.dateien.set("/objekte/test/anker-a.jpg", () => {
    throw new Error(`kaputt bei https://intern.example/x mit ${process.env.SUPABASE_SERVICE_KEY}`);
  });
  assert.equal((await pruefung.pruefeAnkerDatei(testEintrag())).hinweis, "kaputt bei [URL] mit [entfernt]");
});

// ═══ G: Gleichzeitigkeit ═══

test("AN-G1 mitHoechstens: höchstens n zugleich, Reihenfolge der Liste, jedes Element genau einmal", async () => {
  for (const [n, laenge] of [[4, 11], [1, 5], [3, 3], [8, 2]]) {
    let aktiv = 0;
    let hoechstens = 0;
    const gesehen = [];
    const aus = await pruefung.mitHoechstens(n, Array.from({ length: laenge }, (_, i) => i), async (i) => {
      aktiv += 1;
      hoechstens = Math.max(hoechstens, aktiv);
      gesehen.push(i);
      await new Promise((fertig) => setTimeout(fertig, (laenge - i) % 3));
      aktiv -= 1;
      return i * 10;
    });
    assert.deepEqual(aus, Array.from({ length: laenge }, (_, i) => i * 10), `${n}/${laenge}`);
    assert.deepEqual([...gesehen].sort((a, b) => a - b), Array.from({ length: laenge }, (_, i) => i));
    assert.equal(hoechstens, Math.min(n, laenge), `${n}/${laenge}`);
  }
  assert.deepEqual(await pruefung.mitHoechstens(4, [], async () => 1), []);
  assert.equal(pruefung.ANKER_GLEICHZEITIG, 4);
});

test("AN-G2 pruefeAnkerDateien: alle Manifest-Dateien, höchstens 4 Abrufe zugleich, Ergebnisse in Manifest-Reihenfolge", async () => {
  steinadel.verzoegerungMs = 5;
  const r = await pruefung.pruefeAnkerDateien(MANIFEST.eintraege);
  assert.deepEqual(r.map((x) => x.id), MANIFEST.eintraege.map((e) => e.id));
  assert.deepEqual([...steinadel.abrufe.map((a) => a.url)].sort(), MANIFEST.eintraege.map((e) => e.url).sort());
  assert.equal(steinadel.hoechstens, 4);
  assert.ok(r.every((x) => x.status === "nicht_erreichbar" && x.hinweis === "HTTP 404"));
});

// ═══ C: Cover-Abgleich ═══

function cover(wert, objekt = null) {
  const o = objekt ?? { ...RITTERGUT, urls: { objektSeite: "https://steinadel.de/projekte/x", cover: wert } };
  return pruefung.coverAusExport({ objekte: [o] }, SLUG, MANIFEST, "2026-11-10T08:00:00.000Z");
}

test("AN-C1 Cover unverändert: urls.cover zeigt auf hero-hof-nacht.jpg (absolut oder ab der Wurzel)", () => {
  const r = cover(COVER_URL);
  assert.deepEqual(r, {
    anker_id: "hof-nacht",
    soll: COVER_URL,
    quelle: "urls.cover im Steinadel-Export über /api/objekte",
    gemessen_am: "2026-11-10T08:00:00.000Z",
    status: "unveraendert",
    ist: COVER_URL,
    hinweis: null,
  });
  assert.equal(cover("/objekte/rittergut/hero-hof-nacht.jpg").status, "unveraendert");
  assert.equal(cover(`  ${COVER_URL}  `).status, "unveraendert");
  // Abfrage oder Fragment: dieselbe Datei, nur vermerkt; die Abfrage erscheint nicht in der Anzeige.
  for (const zusatz of ["?v=2", "#oben", "?token=geheim-123"]) {
    const z = cover(`${COVER_URL}${zusatz}`);
    assert.equal(z.status, "unveraendert", zusatz);
    assert.equal(z.ist, COVER_URL);
    assert.equal(z.hinweis, "Adresse mit Zugangsdaten, Abfrage oder Fragment; verglichen wurden Ursprung und Pfad");
  }
});

test("AN-C2 Cover geändert: anderer Pfad, Host, Protokoll, Zugangsdaten; leer, kein Text oder keine Web-Adresse", () => {
  const ziel = "urls.cover zeigt nicht mehr auf hero-hof-nacht.jpg";
  for (const [wert, ist] of [
    ["https://steinadel.de/objekte/rittergut/ki-cover-1.jpg", "https://steinadel.de/objekte/rittergut/ki-cover-1.jpg"],
    ["https://storage.example/objekt-visuals/rittergut/cover.jpg?v=3", "https://storage.example/objekt-visuals/rittergut/cover.jpg"],
    ["http://steinadel.de/objekte/rittergut/hero-hof-nacht.jpg", "http://steinadel.de/objekte/rittergut/hero-hof-nacht.jpg"],
    ["https://www.steinadel.de/objekte/rittergut/hero-hof-nacht.jpg", "https://www.steinadel.de/objekte/rittergut/hero-hof-nacht.jpg"],
    ["//evil.example/objekte/rittergut/hero-hof-nacht.jpg", "https://evil.example/objekte/rittergut/hero-hof-nacht.jpg"],
    ["hero-hof-nacht.jpg", "https://steinadel.de/hero-hof-nacht.jpg"],
    ["https://steinadel.de/objekte/rittergut/hero-hof-nacht.JPG", "https://steinadel.de/objekte/rittergut/hero-hof-nacht.JPG"],
  ]) {
    const r = cover(wert);
    assert.equal(r.status, "geaendert", wert);
    assert.equal(r.ist, ist, wert);
    assert.match(r.hinweis, new RegExp(`^${ziel}`), wert);
  }
  const zugang = cover("https://nutzer:pw@steinadel.de/objekte/rittergut/hero-hof-nacht.jpg");
  assert.equal(zugang.status, "geaendert");
  assert.equal(zugang.ist, COVER_URL, "Zugangsdaten erscheinen nicht");
  assert.equal(zugang.hinweis, `${ziel} (Adresse mit Zugangsdaten, Abfrage oder Fragment; verglichen wurden Ursprung und Pfad)`);
  for (const [wert, hinweis] of [
    [null, "Der Export nennt kein Cover (urls.cover leer)"],
    ["", "Der Export nennt kein Cover (urls.cover leer)"],
    ["   ", "Der Export nennt kein Cover (urls.cover leer)"],
    [undefined, "Der Export nennt kein Cover (urls.cover leer)"],
    [5, "urls.cover ist kein Text"],
    [{ url: COVER_URL }, "urls.cover ist kein Text"],
    [[COVER_URL], "urls.cover ist kein Text"],
    ["https://", "urls.cover ist keine lesbare Web-Adresse"],
    ["javascript:alert(1)", "urls.cover ist keine lesbare Web-Adresse"],
    ["data:image/jpeg;base64,AAAA", "urls.cover ist keine lesbare Web-Adresse"],
  ]) {
    const r = cover(wert);
    assert.deepEqual([r.status, r.ist, r.hinweis], ["geaendert", null, hinweis], String(wert));
  }
  assert.equal(cover(null, { ...RITTERGUT }).hinweis, "Der Export nennt kein Cover (urls fehlt)");
  assert.equal(cover(null, { ...RITTERGUT, urls: "x" }).hinweis, "Der Export nennt kein Cover (urls fehlt)");
});

test("AN-C3 Cover nicht lesbar: Objekt fehlt im Export oder Antwort ohne Objektliste", () => {
  const ohne = pruefung.coverAusExport({ objekte: [{ slug: "villa-x", urls: { cover: COVER_URL } }] }, SLUG, MANIFEST, "2026-11-10T08:00:00.000Z");
  assert.deepEqual([ohne.status, ohne.fehler_art, ohne.hinweis, ohne.ist], ["nicht_lesbar", "nicht_im_export", "Objekt „rittergut-seifersdorf“ nicht im Steinadel-Export", null]);
  for (const daten of [null, {}, { objekte: "x" }, []]) {
    const r = pruefung.coverAusExport(daten, SLUG, MANIFEST, "2026-11-10T08:00:00.000Z");
    assert.deepEqual([r.status, r.fehler_art, r.hinweis], ["nicht_lesbar", "quelle_fehler", "Antwort ohne Objektliste"], JSON.stringify(daten));
  }
  // Ein Manifest ohne seinen Cover-Anker ist ein Programmfehler, kein Prüfergebnis.
  assert.throws(() => pruefung.coverAusExport({ objekte: [] }, SLUG, { ...MANIFEST, cover_anker: "fehlt" }, "x"), /Cover-Anker „fehlt“ fehlt im Manifest/);
});

test("AN-C4 Cover-Anzeige: geschützter Name maskiert, lange Adresse gekürzt", () => {
  const r = cover(`https://steinadel.de/${NAME}/cover.jpg`);
  assert.equal(r.status, "geaendert");
  assert.doesNotMatch(r.ist, ENTHAELT_NAMEN);
  assert.ok(r.ist.includes(regeln.NAMENS_ERSATZ));
  const lang = cover(`https://steinadel.de/${"a".repeat(400)}.jpg`);
  assert.equal(lang.ist.length, pruefung.COVER_ANZEIGE_MAX);
  assert.ok(lang.ist.endsWith("…"));
  const passend = `https://steinadel.de/${"b".repeat(pruefung.COVER_ANZEIGE_MAX - 25)}.jpg`;
  assert.equal(passend.length, pruefung.COVER_ANZEIGE_MAX);
  assert.equal(cover(passend).ist, passend, "genau am Limit ungekürzt");
});

test("AN-C6 coverFehler: Zeitpunkt, Grund und Ursache des Export-Abrufs; ohne Angaben neutrale Ersatztexte", () => {
  const teil = { wert: null, status: "fehler", quelle: "x", gemessen_am: "2026-11-10T08:30:00.000Z", hinweis: "HTTP 401", fehler_art: "nicht_angemeldet" };
  assert.deepEqual(pruefung.coverFehler(teil, MANIFEST), {
    anker_id: "hof-nacht",
    soll: COVER_URL,
    quelle: "urls.cover im Steinadel-Export über /api/objekte",
    gemessen_am: "2026-11-10T08:30:00.000Z",
    status: "nicht_lesbar",
    ist: null,
    hinweis: "HTTP 401",
    fehler_art: "nicht_angemeldet",
  });
  const vorher = Date.now();
  const leer = pruefung.coverFehler({ wert: null, status: "fehler", quelle: "x", gemessen_am: null }, MANIFEST);
  assert.ok(Date.parse(leer.gemessen_am) >= vorher - 5);
  assert.equal(leer.hinweis, "Export nicht lesbar");
  assert.equal(leer.fehler_art, "unbekannt");
});

test("AN-C5 vergleicheCover: relative Angaben ab der Wurzel von steinadel.de, die Adresse wird nie abgerufen", () => {
  assert.deepEqual(anker.vergleicheCover("/objekte/rittergut/hero-hof-nacht.jpg", COVER_URL), { art: "adresse", gleich: true, adresse: COVER_URL, zusatz: false });
  assert.deepEqual(anker.vergleicheCover("objekte/rittergut/hero-hof-nacht.jpg", COVER_URL), { art: "adresse", gleich: true, adresse: COVER_URL, zusatz: false });
  assert.deepEqual(anker.vergleicheCover(COVER_URL, "kein url"), { art: "unlesbar" });
  assert.equal(steinadel.abrufe.length, 0);
});

// ═══ R: Route GET /api/studio/[objekt]/anker ═══

test("AN-R1 400 bei falscher Form, 404 außerhalb der Allow-List — ohne jeden Abruf", async () => {
  welt.objekteAntwort = exportMit();
  for (const s of ["Rittergut", "../objekte", "ritter gut", "x".repeat(81)]) {
    const r = await holeAnker(s);
    assert.equal(r.status, 400, s);
    assert.equal(r.body.fehler_art, "eingabe");
    assert.match(r.body.fehler, /Ungültige Objekt-Kennung/);
  }
  const r = await holeAnker("villa-x");
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { fehler: "Objekt nicht im Studio", fehler_art: "nicht_im_studio" });
  assert.equal(r.kopf.get("cache-control"), "no-store");
  assert.equal(steinadel.abrufe.length, 0, "kein Abruf auf steinadel.de");
  assert.equal(welt.objektAbrufe, 0, "kein Export-Abruf");
  assert.equal(welt.log.length, 0, "keine Datenbank");
});

test("AN-R2 200: je Manifest-Datei ein Ergebnis in Manifest-Reihenfolge, Cover aus dem Export, ohne Cache", async () => {
  welt.objekteAntwort = exportMit();
  const je = Object.fromEntries(MANIFEST.eintraege.map((e) => [e.id, e]));
  // hof-nacht: Test-Bytes (Hash anders), loft: 404, Rest: Weiterleitung.
  steinadel.dateien.set("/objekte/rittergut/hero-hof-nacht.jpg", { bytes: BYTES_A });
  for (const e of MANIFEST.eintraege.slice(1, -1)) steinadel.dateien.set(anker.dateiPfad(e.url), () => new Response(null, { status: 302, headers: { location: "/" } }));
  const r = await holeAnker();
  assert.equal(r.status, 200);
  assert.equal(r.kopf.get("cache-control"), "no-store");
  const b = r.body;
  assert.deepEqual(Object.keys(b), ["objekt_slug", "erzeugt_am", "manifest_gemessen_am", "anker", "export_cover"]);
  assert.equal(b.objekt_slug, SLUG);
  assert.equal(b.manifest_gemessen_am, "2026-11-10T07:59:15Z");
  assert.deepEqual(b.anker.map((a) => a.id), MANIFEST.eintraege.map((e) => e.id));
  for (const a of b.anker) {
    assert.equal(a.sha256_soll, je[a.id].sha256);
    assert.equal(a.bytes_soll, je[a.id].bytes);
    assert.ok(Number.isFinite(Date.parse(a.gemessen_am)), a.id);
  }
  assert.deepEqual([b.anker[0].status, b.anker[0].sha256_live, b.anker[0].hinweis], ["geaendert", sha(BYTES_A), "720 B statt 667.131 B"]);
  assert.deepEqual([b.anker[10].status, b.anker[10].http_status], ["nicht_erreichbar", 404]);
  assert.ok(b.anker.slice(1, -1).every((a) => a.status === "nicht_erreichbar" && a.hinweis === "Weiterleitung (HTTP 302) — nicht gefolgt"));
  assert.deepEqual(steinadel.abrufe.map((a) => a.url), MANIFEST.eintraege.map((e) => e.url), "jede Manifest-Datei genau einmal, keine Weiterleitung verfolgt");
  assert.equal(welt.objektAbrufe, 1);
  assert.deepEqual([b.export_cover.status, b.export_cover.ist, b.export_cover.anker_id], ["unveraendert", COVER_URL, "hof-nacht"]);
  assert.equal(welt.log.length, 0, "keine Datenbank");
});

test("AN-R3 Kein SSRF: Abfrageparameter und Kennung lenken keinen Abruf um; nur Manifest-Adressen und /api/objekte", async () => {
  welt.objekteAntwort = exportMit();
  const r = await holeAnker(SLUG, { suche: "?url=http://127.0.0.1:8000/x&datei=../../etc/passwd&objekt=villa-x" });
  assert.equal(r.status, 200);
  const erlaubt = new Set(MANIFEST.eintraege.map((e) => e.url));
  assert.ok(steinadel.abrufe.every((a) => erlaubt.has(a.url)), steinadel.abrufe.map((a) => a.url).join(", "));
  assert.equal(steinadel.abrufe.length, MANIFEST.eintraege.length);
  // Route-Quelle: liest weder searchParams noch nextUrl noch einen Body.
  const quelle = readFileSync(path.join(SITE, "src/app/api/studio/[objekt]/anker/route.ts"), "utf8").replace(/\/\/.*$/gm, "");
  for (const verboten of ["searchParams", "nextUrl", "request.json", "request.text", "request.url"]) assert.ok(!quelle.includes(verboten), verboten);
});

test("AN-R4 Gleichzeitige Anfragen teilen eine laufende Prüfung; danach startet jede Anfrage neu", async () => {
  welt.objekteAntwort = exportMit();
  steinadel.verzoegerungMs = 5;
  const [a, b] = await Promise.all([holeAnker(), holeAnker()]);
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, b.body, "dasselbe Ergebnis");
  assert.equal(steinadel.abrufe.length, MANIFEST.eintraege.length, "jede Datei nur einmal");
  assert.equal(welt.objektAbrufe, 1, "Export nur einmal");
  const c = await holeAnker();
  assert.equal(c.status, 200);
  assert.equal(steinadel.abrufe.length, 2 * MANIFEST.eintraege.length, "neue Prüfung nach dem Ende der alten");
  assert.equal(welt.objektAbrufe, 2);
  assert.notEqual(c.body.erzeugt_am, undefined);
});

test("AN-R5 Programmfehler: 500 mit bereinigtem Grund; eine gescheiterte Prüfung blockiert die nächste nicht", async () => {
  welt.objekteAntwort = exportMit();
  const r = await holeAnker(SLUG, { params: Promise.reject(new Error("params kaputt bei https://intern.example/x")) });
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { fehler: "Anker-Prüfung nicht ermittelbar: params kaputt bei [URL]", fehler_art: "programmfehler" });
  assert.equal(r.kopf.get("cache-control"), "no-store");
  // Eine Antwort, die beim Lesen des Kopfs wirft (kein echtes Response-Verhalten), lässt die Prüfung scheitern.
  steinadel.dateien.set("/objekte/rittergut/hero-hof-nacht.jpg", () => ({
    status: 200,
    type: "basic",
    headers: {
      get() {
        throw new Error("Kopf kaputt");
      },
    },
    body: null,
  }));
  const kaputt = await holeAnker();
  assert.equal(kaputt.status, 500);
  assert.equal(kaputt.body.fehler, "Anker-Prüfung nicht ermittelbar: Kopf kaputt");
  steinadel.dateien.clear();
  const danach = await holeAnker();
  assert.equal(danach.status, 200, "keine hängende Prüfung");
});

test("AN-R6 Cover über die Route: Export-Fehler mit derselben Ursache und demselben Grund wie der Objektkopf", async () => {
  const faelle = [
    { status: 502, body: { fehler: "quelle_nicht_erreichbar", fehler_art: "nicht_erreichbar", objekte: [] } },
    { status: 502, body: { fehler: "quelle_http_503", fehler_art: "quelle_fehler", objekte: [] } },
    { status: 500, body: { fehler: "Export-Token (Server-Umgebung) nicht gesetzt", fehler_art: "konfiguration", objekte: [] } },
    { status: 401, body: { error: "Unauthorized" } },
    { status: 502, body: { fehler: `upstream https://export.example/v1?token=abc antwortet nicht (${process.env.SUPABASE_SERVICE_KEY})` } },
    { wirf: new TypeError("fetch failed") },
  ];
  for (const antwort of faelle) {
    zuruecksetzen();
    welt.objekteAntwort = antwort;
    const kopf = (await holeStudio()).objekt;
    zuruecksetzen();
    welt.objekteAntwort = antwort;
    const c = (await holeAnker()).body.export_cover;
    assert.equal(c.status, "nicht_lesbar", JSON.stringify(antwort));
    assert.equal(c.ist, null);
    assert.equal(c.fehler_art, kopf.fehler_art, JSON.stringify(antwort));
    assert.equal(c.hinweis, kopf.hinweis, JSON.stringify(antwort));
    assert.equal(c.quelle, "urls.cover im Steinadel-Export über /api/objekte");
    assert.ok(Number.isFinite(Date.parse(c.gemessen_am)));
    for (const roh of ["export.example", "token=abc", process.env.SUPABASE_SERVICE_KEY]) assert.ok(!JSON.stringify(c).includes(roh), roh);
  }
  // HTML statt JSON (Proxy) mit 200.
  zuruecksetzen();
  const vorher = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === "string" ? input : input.url);
    if (url.endsWith("/api/objekte")) return new Response("<!doctype html><p>Wartung</p>", { status: 200, headers: { "content-type": "text/html" } });
    return vorher(input, init);
  };
  try {
    const c = (await holeAnker()).body.export_cover;
    assert.deepEqual([c.status, c.fehler_art, c.hinweis], ["nicht_lesbar", "quelle_fehler", "Antwort von /api/objekte nicht lesbar"]);
  } finally {
    globalThis.fetch = vorher;
  }
  // Cover zeigt woanders hin.
  zuruecksetzen();
  welt.objekteAntwort = exportMit({ ...RITTERGUT, urls: { cover: "https://steinadel.de/objekte/rittergut/ki-cover.jpg" } });
  const g = (await holeAnker()).body.export_cover;
  assert.deepEqual([g.status, g.ist], ["geaendert", "https://steinadel.de/objekte/rittergut/ki-cover.jpg"]);
});

test("AN-R7 Export-Abruf der Anker-Route: Sitzung weitergereicht, ohne Cache, 20 s Zeitlimit; Anker-Abrufe je 10 s", async () => {
  welt.objekteAntwort = exportMit();
  const abrufe = [];
  const vorher = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    abrufe.push({ url: String(typeof input === "string" ? input : input.url), init });
    return vorher(input, init);
  };
  try {
    await mitZeitlimits(async (msVon) => {
      await holeAnker(SLUG, { cookie: "gp-auth=sitzung-456" });
      const exportAbrufe = abrufe.filter((a) => a.url.endsWith("/api/objekte"));
      assert.deepEqual(
        exportAbrufe.map((a) => ({ url: a.url, cookie: new Headers(a.init.headers).get("cookie"), cache: a.init.cache, ms: msVon(a.init.signal) })),
        [{ url: "http://harness.local/api/objekte", cookie: "gp-auth=sitzung-456", cache: "no-store", ms: 20_000 }],
      );
      const dateiAbrufe = abrufe.filter((a) => a.url.startsWith("https://steinadel.de/"));
      assert.equal(dateiAbrufe.length, MANIFEST.eintraege.length);
      assert.ok(dateiAbrufe.every((a) => msVon(a.init.signal) === 10_000 && a.init.redirect === "manual" && a.init.cache === "no-store"));
      assert.ok(dateiAbrufe.every((a) => new Headers(a.init.headers ?? {}).get("cookie") === null), "die Sitzung geht nicht an steinadel.de");
    });
  } finally {
    globalThis.fetch = vorher;
  }
});

test("AN-R8 Route und Module: nur GET, force-dynamic, nodejs; Prüfung und Export-Abruf nur auf dem Server", () => {
  assert.equal(ankerRoute.dynamic, "force-dynamic");
  assert.equal(ankerRoute.runtime, "nodejs");
  assert.deepEqual(Object.keys(ankerRoute).filter((k) => /^[A-Z]+$/.test(k)), ["GET"]);
  for (const datei of ["src/lib/studio/anker-pruefung.ts", "src/lib/studio/export-abruf.ts"]) {
    const sf = ts.createSourceFile(datei, readFileSync(path.join(SITE, datei), "utf8"), ts.ScriptTarget.Latest, true);
    assert.ok(sf.statements.some((s) => ts.isImportDeclaration(s) && !s.importClause && s.moduleSpecifier.text === "server-only"), datei);
  }
  const studioQuelle = readFileSync(path.join(SITE, "src/app/api/studio/[objekt]/route.ts"), "utf8");
  assert.ok(studioQuelle.includes('from "@/lib/studio/export-abruf"'), "Studio-Route nutzt denselben Export-Abruf");
});

test("AN-E1 Ende zu Ende mit Test-Manifest: richtig ausgeliefert = unverändert mit Zeitpunkt, fehlende Datei = nicht erreichbar", async () => {
  welt.objekteAntwort = exportMit({ ...RITTERGUT, urls: { cover: TEST_URL } });
  steinadel.dateien.set("/objekte/test/anker-a.jpg", { bytes: BYTES_A });
  const m = testManifest();
  const antwort = await pruefung.pruefeAnker(SLUG, m, "gp-auth=test");
  assert.deepEqual(antwort.anker.map((a) => [a.id, a.status, a.http_status]), [["test-a", "unveraendert", 200], ["test-b", "nicht_erreichbar", 404]]);
  assert.equal(antwort.export_cover.status, "unveraendert");
  assert.equal(antwort.manifest_gemessen_am, m.gemessen_am);
  const P = ladeAnkerPanel(ECHT, { anker, types, hilfen: HILFEN });
  const html = renderToStaticMarkup(React.createElement(P.AnkerAnsicht, { manifest: m, lesung: { art: "daten", antwort }, pruefen: () => {} }));
  const karteA = sichtbar(/<article[^>]*data-anker="test-a".*?<\/article>/s.exec(html)[0]);
  assert.ok(karteA.includes(`Hash-Status unverändert · ${sha(BYTES_A).slice(0, 16)}… · gemessen ${berlin(antwort.anker[0].gemessen_am)}`), karteA);
  const karteB = sichtbar(/<article[^>]*data-anker="test-b".*?<\/article>/s.exec(html)[0]);
  assert.ok(karteB.includes(`Hash-Status nicht erreichbar · Soll ${sha(BYTES_B).slice(0, 16)}… · gemessen ${berlin(antwort.anker[1].gemessen_am)} HTTP 404`), karteB);
  assert.ok(sichtbar(html).includes("Hash-Status: 1 unverändert · 1 nicht erreichbar"));
});

// ═══ P: Anker-Panel ═══

const PANEL = ladeAnkerPanel(ECHT, { anker, types, hilfen: HILFEN });

/** Antwort der Route für das echte Manifest, alle Dateien mit status; ueber: id → Felder. */
function antwortFuer(status = "unveraendert", ueber = {}, cover = {}) {
  return {
    objekt_slug: SLUG,
    erzeugt_am: "2026-11-10T09:00:05.000Z",
    manifest_gemessen_am: MANIFEST.gemessen_am,
    anker: MANIFEST.eintraege.map((e) => ({
      id: e.id,
      status,
      sha256_soll: e.sha256,
      sha256_live: status === "unveraendert" ? e.sha256 : null,
      bytes_soll: e.bytes,
      bytes_live: status === "unveraendert" ? e.bytes : null,
      http_status: 200,
      gemessen_am: "2026-11-10T09:00:01.000Z",
      hinweis: null,
      ...(ueber[e.id] ?? {}),
    })),
    export_cover: {
      anker_id: "hof-nacht",
      soll: COVER_URL,
      quelle: "urls.cover im Steinadel-Export über /api/objekte",
      gemessen_am: "2026-11-10T09:00:02.000Z",
      status: "unveraendert",
      ist: COVER_URL,
      hinweis: null,
      ...cover,
    },
  };
}

function panelHtml(lesung, manifest = MANIFEST) {
  return renderToStaticMarkup(React.createElement(PANEL.AnkerAnsicht, { manifest, lesung, pruefen: () => {} }));
}

/** Karte eines Ankers im Markup des Panels. */
function karte(html, id) {
  return new RegExp(`<article[^>]*data-anker="${id}".*?</article>`, "s").exec(html)?.[0] ?? "";
}

test("AN-P1 Abnahme: je Bild Art, Maße, Exposé-Seite, Personen, Herkunft und Hash-Status 'unverändert' mit Messzeitpunkt; hof-nacht 4ea1631f…", () => {
  const html = panelHtml({ art: "daten", antwort: antwortFuer() });
  const t = sichtbar(html);
  assert.equal((html.match(/<article[^>]*data-anker=/g) ?? []).length, 11);
  assert.ok(t.includes("Anker-Material · 11"), t.slice(0, 500));
  assert.ok(t.includes("11 Bilder im Manifest · 10 als Anker zulässig, alle Visualisierungen (Renderings), keine Fotos · 1 ohne Ankerfunktion"));
  assert.ok(t.includes(`Hash-Status: 11 unverändert · Prüfung beendet ${berlin("2026-11-10T09:00:05.000Z")}`));
  const gemessen = berlin("2026-11-10T09:00:01.000Z");
  assert.equal(gemessen, "10.11.2026 10:00:01 (Europe/Berlin)");
  const hof = sichtbar(karte(html, "hof-nacht"));
  for (const teil of [
    "hof-nacht Visualisierung",
    "/objekte/rittergut/hero-hof-nacht.jpg",
    "Maße 3000 × 2018 px · 667.131 B",
    "Exposé-Seite S. 18",
    "Personen ja, ca. 8",
    "Als Anker ja",
    "Herkunft Visualisierung aus dem Objekt-Exposé",
    `Hash-Status unverändert · 4ea1631f9799b83c… · gemessen ${gemessen}`,
    "Vorlage der Probe vom 05.11.2026",
  ]) {
    assert.ok(hof.includes(teil), `${teil}\n${hof}`);
  }
  const loft = sichtbar(karte(html, "loft-stimmung"));
  for (const teil of ["loft-stimmung KI-Stimmungsbild, kein Anker", "/objekte/rittergut/interieur-loft.jpg", "Maße 686 × 858 px · 124.242 B", "Exposé-Seite entfällt (KI-Bild, nicht aus dem Exposé)", "Als Anker nein", "Hash-Status unverändert · 4e34bb945af0e74b…"]) {
    assert.ok(loft.includes(teil), `${teil}\n${loft}`);
  }
  const exposeErwartet = { "hof-nacht": "S. 18", "terrasse-pergola": "S. 4", "lofts-balkone": "S. 45", "fassade-abend": "S. 37", "loft-stimmung": "entfällt (KI-Bild, nicht aus dem Exposé)" };
  for (const e of MANIFEST.eintraege) {
    const k = karte(html, e.id);
    const s = sichtbar(k);
    assert.ok(s.includes(`Exposé-Seite ${exposeErwartet[e.id] ?? "nicht belegt"} Personen`), `${e.id}: ${s}`);
    assert.ok(s.includes(`Maße ${e.breite} × ${e.hoehe} px`), e.id);
    assert.ok(s.includes(`Herkunft ${e.herkunft.text}`), e.id);
    assert.ok(s.includes(`Personen ${anker.personenText(e.personen)}`), e.id);
    assert.ok(s.includes(`Hash-Status unverändert · ${e.sha256.slice(0, 16)}… · gemessen ${gemessen}`), e.id);
    assert.match(k, new RegExp(`<a href="${e.url}" target="_blank" rel="noopener noreferrer"`), e.id);
    assert.match(k, /data-hash-status="unveraendert"/);
    // Volle Hashes im title.
    assert.ok(ent(k).includes(`SHA-256 laut Manifest: ${e.sha256}`), e.id);
  }
  assert.ok(t.includes(`Export-Cover (urls.cover): unverändert · zeigt auf ${COVER_URL} · Soll: hero-hof-nacht.jpg (Anker hof-nacht) · geprüft ${berlin("2026-11-10T09:00:02.000Z")}`), t.slice(0, 1200));
  assert.match(html, /<button type="button" class="[^"]*" data-alle-pruefen="true">Alle prüfen<\/button>/, "Knopf aktiv");
  assert.equal((html.match(/<button/g) ?? []).length, 1);
});

test("AN-P2 Während der Prüfung: 'wird geprüft …', Knopf gesperrt, kein Status und keine Zahl als Platzhalter", () => {
  const html = panelHtml({ art: "laedt" });
  const t = sichtbar(html);
  assert.equal((html.match(/data-hash="laedt"/g) ?? []).length, 11);
  assert.equal((html.match(/data-hash-status="laedt"/g) ?? []).length, 11);
  assert.ok(t.includes("Prüfung läuft …"));
  assert.ok(t.includes("Export-Cover (urls.cover): wird geprüft … · Soll: hero-hof-nacht.jpg (Anker hof-nacht)"));
  assert.match(html, /<button type="button"[^>]*disabled=""[^>]*>Alle prüfen<\/button>/);
  for (const s of ["unverändert", "geändert", "nicht erreichbar", "gemessen 10.11.2026 10"]) assert.ok(!t.includes(s), s);
  assert.ok(t.includes(`Manifest-Werte gemessen ${berlin(MANIFEST.gemessen_am)} an den ausgelieferten Dateien`));
});

test("AN-P3 Prüfung nicht lesbar: Grund sichtbar, Karten 'nicht geprüft', Knopf wieder aktiv", () => {
  const html = panelHtml({ art: "abgewiesen", httpStatus: 404, text: "Objekt nicht im Studio (HTTP 404)" });
  const t = sichtbar(html);
  assert.ok(t.includes("Hash-Prüfung nicht lesbar: Objekt nicht im Studio (HTTP 404)"));
  assert.match(html, /role="alert"/);
  assert.equal((html.match(/data-hash="nicht_geprueft"/g) ?? []).length, 11);
  assert.ok(t.includes("Export-Cover (urls.cover): nicht geprüft"));
  assert.doesNotMatch(html, /disabled=""/);
});

test("AN-P4 Gemischte Ergebnisse: geändert mit Live-Hash, nicht erreichbar mit Soll und Grund, fehlendes und unbekanntes Ergebnis", () => {
  const liveHash = "ab".repeat(32);
  const antwort = antwortFuer("unveraendert", {
    "hof-nacht": { status: "geaendert", sha256_live: liveHash, bytes_live: 700000, hinweis: "700.000 B statt 667.131 B" },
    gutshaus: { status: "nicht_erreichbar", sha256_live: null, bytes_live: null, http_status: 404, hinweis: "HTTP 404" },
    burghof: { status: "kaputt" },
  });
  antwort.anker = antwort.anker.filter((a) => a.id !== "jagdhaus");
  const html = panelHtml({ art: "daten", antwort });
  const t = sichtbar(html);
  assert.ok(t.includes("Hash-Status: 7 unverändert · 1 geändert · 1 nicht erreichbar · 2 ohne Ergebnis"), t.slice(0, 900));
  assert.match(html, new RegExp(`data-anker-stand="daten"`));
  const stand = /<p[^>]*data-anker-stand="daten"[^>]*>/.exec(html)[0];
  assert.ok(stand.includes("var(--gp-rose)"), "rot bei geändert");
  assert.ok(sichtbar(karte(html, "hof-nacht")).includes(`Hash-Status geändert · live ${liveHash.slice(0, 16)}… statt 4ea1631f9799b83c… · gemessen`));
  assert.ok(sichtbar(karte(html, "hof-nacht")).includes("700.000 B statt 667.131 B"));
  assert.ok(sichtbar(karte(html, "gutshaus")).includes("Hash-Status nicht erreichbar · Soll 06f1a59be2cc446f… · gemessen"));
  assert.ok(sichtbar(karte(html, "gutshaus")).includes("HTTP 404"));
  for (const id of ["jagdhaus", "burghof"]) {
    assert.ok(sichtbar(karte(html, id)).includes("Hash-Status kein Ergebnis für diese Datei"), id);
    assert.match(karte(html, id), /data-hash-status="(ohne_ergebnis|kaputt)"/);
  }
  // Nur nicht erreichbar oder ohne Ergebnis: bernsteinfarben, nicht grün.
  const nurFehlt = antwortFuer();
  nurFehlt.anker[3].status = "nicht_erreichbar";
  const html2 = panelHtml({ art: "daten", antwort: nurFehlt });
  assert.ok(/<p[^>]*data-anker-stand="daten"[^>]*>/.exec(html2)[0].includes("var(--gp-amber)"));
  const ohne = antwortFuer();
  ohne.anker.pop();
  const html3 = panelHtml({ art: "daten", antwort: ohne });
  assert.ok(/<p[^>]*data-anker-stand="daten"[^>]*>/.exec(html3)[0].includes("var(--gp-amber)"));
  assert.ok(/<p[^>]*data-anker-stand="daten"[^>]*>/.exec(panelHtml({ art: "daten", antwort: antwortFuer() }))[0].includes("var(--gp-emerald)"));
});

test("AN-P5 Cover-Zeile: geändert und nicht lesbar mit Grund; unbekannter Status bernsteinfarben", () => {
  const g = sichtbar(panelHtml({ art: "daten", antwort: antwortFuer("unveraendert", {}, { status: "geaendert", ist: "https://steinadel.de/objekte/rittergut/ki.jpg", hinweis: "urls.cover zeigt nicht mehr auf hero-hof-nacht.jpg" }) }));
  assert.ok(g.includes("Export-Cover (urls.cover): geändert · zeigt auf https://steinadel.de/objekte/rittergut/ki.jpg · Soll: hero-hof-nacht.jpg (Anker hof-nacht)"), g.slice(0, 1200));
  assert.ok(g.includes("urls.cover zeigt nicht mehr auf hero-hof-nacht.jpg"));
  const n = sichtbar(panelHtml({ art: "daten", antwort: antwortFuer("unveraendert", {}, { status: "nicht_lesbar", ist: null, hinweis: "Steinadel-Export nicht erreichbar", fehler_art: "nicht_erreichbar" }) }));
  assert.ok(n.includes("Export-Cover (urls.cover): nicht lesbar · Soll: hero-hof-nacht.jpg (Anker hof-nacht) · geprüft"), n.slice(0, 1200));
  assert.ok(n.includes("Steinadel-Export nicht erreichbar"));
  assert.ok(!n.includes("zeigt auf"));
  const u = panelHtml({ art: "daten", antwort: antwortFuer("unveraendert", {}, { status: "seltsam" }) });
  assert.ok(sichtbar(u).includes("Export-Cover (urls.cover): unbekannter Status"));
  assert.match(u, /data-export-cover="unbekannt"/);
});

test("AN-P6 Abweichender Manifest-Stand des Servers wird sichtbar; Texte des Servers maskiert", () => {
  const antwort = antwortFuer("unveraendert", { "hof-nacht": { sha256_soll: "cd".repeat(32), hinweis: `Hinweis ${NAME}` } }, { status: "geaendert", ist: `https://steinadel.de/${NAME}.jpg`, hinweis: `Grund ${NAME}` });
  const html = panelHtml({ art: "daten", antwort });
  assert.ok(sichtbar(karte(html, "hof-nacht")).includes("Der Server prüft gegen einen anderen Manifest-Stand als diese Seite — bitte die Seite neu laden."));
  assert.equal((html.match(/data-manifest-abweichung/g) ?? []).length, 1);
  assert.doesNotMatch(ent(html), ENTHAELT_NAMEN);
  const fehler = panelHtml({ art: "abgewiesen", httpStatus: null, text: `Netzfehler: ${NAME}` });
  assert.doesNotMatch(ent(fehler), ENTHAELT_NAMEN);
});

test("AN-P7 leseAnkerAntwort: nur lesbare Prüfergebnisse sind Daten; Fehlertext der Route maskiert", () => {
  const gut = antwortFuer();
  assert.deepEqual(PANEL.leseAnkerAntwort(200, gut), { art: "daten", antwort: gut });
  for (const daten of [null, {}, "x", { anker: "x", export_cover: { status: "ok" } }, { anker: [{ id: 1, status: "ok" }], export_cover: { status: "ok" } }, { anker: [{ id: "a" }], export_cover: { status: "ok" } }, { anker: [], export_cover: null }, { anker: [], export_cover: {} }, { anker: [null], export_cover: { status: "ok" } }]) {
    assert.deepEqual(PANEL.leseAnkerAntwort(200, daten), { art: "abgewiesen", httpStatus: 200, text: "Antwort ohne lesbares Prüfergebnis" }, JSON.stringify(daten));
  }
  assert.deepEqual(PANEL.leseAnkerAntwort(204, { anker: [], export_cover: { status: "unveraendert" } }).art, "daten");
  assert.deepEqual(PANEL.leseAnkerAntwort(401, { error: "Unauthorized" }), { art: "abgewiesen", httpStatus: 401, text: "Nicht angemeldet (HTTP 401) — bitte neu anmelden." });
  assert.deepEqual(PANEL.leseAnkerAntwort(404, { fehler: "Objekt nicht im Studio" }), { art: "abgewiesen", httpStatus: 404, text: "Objekt nicht im Studio (HTTP 404)" });
  assert.deepEqual(PANEL.leseAnkerAntwort(500, { fehler: "  ", error: "Boom" }), { art: "abgewiesen", httpStatus: 500, text: "Boom (HTTP 500)" });
  assert.deepEqual(PANEL.leseAnkerAntwort(502, null), { art: "abgewiesen", httpStatus: 502, text: "ohne Fehlertext (HTTP 502)" });
  assert.deepEqual(PANEL.leseAnkerAntwort(300, gut).art, "abgewiesen");
  const masken = PANEL.leseAnkerAntwort(500, { fehler: `kaputt ${NAME}` });
  assert.doesNotMatch(masken.text, ENTHAELT_NAMEN);
});

test("AN-P8 Panel prüft einmal beim Aufbau und je Klick 'Alle prüfen'; späte Antworten alter Läufe zählen nicht; Abbau bricht ab", async () => {
  const abrufe = [];
  const vorher = globalThis.fetch;
  globalThis.fetch = (url, init) => new Promise((fertig) => abrufe.push({ url, init, fertig }));
  try {
    const lz = hookLaufzeit();
    const P = ladeAnkerPanel(lz.attrappen, { anker, types, hilfen: HILFEN });
    lz.setzeWurzel(P.AnkerPanel, { slug: SLUG });
    let baum = lz.rendere();
    await lz.ruhe();
    assert.equal(abrufe.length, 1, "ein Abruf beim Aufbau");
    assert.equal(abrufe[0].url, "/api/studio/rittergut-seifersdorf/anker");
    assert.equal(abrufe[0].init.cache, "no-store");
    let html = alsMarkup(baum);
    assert.match(html, /disabled=""[^>]*>Alle prüfen/, "gesperrt, solange geprüft wird");
    abrufe[0].fertig({ status: 200, json: async () => antwortFuer() });
    baum = await lz.ruhe();
    html = alsMarkup(baum);
    assert.ok(sichtbar(html).includes("Hash-Status: 11 unverändert"), sichtbar(html).slice(0, 600));
    assert.doesNotMatch(html, /disabled=""/);
    // Klick: neuer Lauf, "wird geprüft" bis zur neuen Antwort.
    finde(baum, (k) => k.type === "button")[0].props.onClick();
    baum = await lz.ruhe();
    assert.equal(abrufe.length, 2);
    assert.equal(abrufe[1].url, "/api/studio/rittergut-seifersdorf/anker");
    html = alsMarkup(baum);
    assert.equal((html.match(/data-hash="laedt"/g) ?? []).length, 11);
    // Noch ein Klick, bevor Lauf 2 antwortet: Lauf 2 wird abgebrochen, seine späte Antwort zählt nicht.
    finde(baum, (k) => k.type === "button")[0].props.onClick();
    baum = await lz.ruhe();
    assert.equal(abrufe.length, 3);
    assert.equal(abrufe[1].init.signal.aborted, true);
    abrufe[1].fertig({ status: 200, json: async () => antwortFuer("geaendert") });
    baum = await lz.ruhe();
    assert.equal((alsMarkup(baum).match(/data-hash="laedt"/g) ?? []).length, 11, "späte Antwort von Lauf 2 verworfen");
    abrufe[2].fertig({ status: 500, json: async () => ({ fehler: "Boom" }) });
    baum = await lz.ruhe();
    assert.ok(sichtbar(alsMarkup(baum)).includes("Hash-Prüfung nicht lesbar: Boom (HTTP 500)"));
    // Netzfehler und JSON ohne Inhalt.
    finde(baum, (k) => k.type === "button")[0].props.onClick();
    await lz.ruhe();
    abrufe[3].fertig(Promise.reject(new TypeError(`Failed to fetch ${NAME}`)));
    baum = await lz.ruhe();
    assert.ok(sichtbar(alsMarkup(baum)).includes(`Hash-Prüfung nicht lesbar: Netzfehler: Failed to fetch ${regeln.NAMENS_ERSATZ}`));
    finde(baum, (k) => k.type === "button")[0].props.onClick();
    await lz.ruhe();
    abrufe[4].fertig({ status: 200, json: async () => { throw new SyntaxError("kein JSON"); } });
    baum = await lz.ruhe();
    assert.ok(sichtbar(alsMarkup(baum)).includes("Hash-Prüfung nicht lesbar: Antwort ohne lesbares Prüfergebnis"));
    // Abbau: laufende Abfrage abgebrochen.
    finde(baum, (k) => k.type === "button")[0].props.onClick();
    await lz.ruhe();
    assert.equal(abrufe.length, 6);
    lz.abbauen();
    assert.equal(abrufe[5].init.signal.aborted, true);
    assert.ok(abrufe.every((a) => a.url === "/api/studio/rittergut-seifersdorf/anker"));
  } finally {
    globalThis.fetch = vorher;
  }
});

test("AN-P9 Ohne Manifest (Kennung außerhalb der Liste): kein Abruf, sichtbarer Hinweis statt Panel", async () => {
  const abrufe = [];
  const vorher = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    abrufe.push({ url, init });
    return new Promise(() => {});
  };
  try {
    const lz = hookLaufzeit();
    const P = ladeAnkerPanel(lz.attrappen, { anker, types, hilfen: HILFEN });
    lz.setzeWurzel(P.AnkerPanel, { slug: "villa-x" });
    const baum = lz.rendere();
    await lz.ruhe();
    assert.equal(abrufe.length, 0);
    const t = sichtbar(alsMarkup(baum));
    assert.ok(t.includes("Anker-Material Für dieses Objekt gibt es kein Anker-Manifest."), t);
    assert.equal(finde(baum, (k) => k.type === "button").length, 0);
  } finally {
    globalThis.fetch = vorher;
  }
});

test("AN-P10 Panel responsiv (Klassen): einspaltig bis lg, min-w-0, Umbruch für Pfade und Hashes, keine feste Breite", () => {
  const html = panelHtml({ art: "daten", antwort: antwortFuer("geaendert", { "hof-nacht": { sha256_live: "ab".repeat(32) } }) });
  assert.match(html, /^<section class="card-ghost p-5 mb-6 min-w-0" data-anker-panel="true"/);
  const raster = [...html.matchAll(/class="(grid [^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(raster)], ["grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4", "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mt-3 text-xs"]);
  assert.equal((html.match(/<article class="card-ghost p-4 min-w-0"/g) ?? []).length, 11);
  // Herkunft und Hash-Status über beide Spalten der Karte (ab sm), die übrigen Felder je eine.
  assert.equal((html.match(/<div class="min-w-0 sm:col-span-2">/g) ?? []).length, 22);
  assert.equal((html.match(/<div class="min-w-0"><dt class="mono-label">/g) ?? []).length, 44);
  assert.equal((html.match(/<p class="text-\[11px\] break-all"><a /g) ?? []).length, 11, "Dateipfade brechen um");
  assert.ok((html.match(/font-\[family-name:var\(--font-jbmono\)\] break-all/g) ?? []).length >= 11, "Hashes brechen um");
  assert.doesNotMatch(html, /(?:^|[\s"])(?:min-)?w-\[\d+px\]/);
  assert.match(html, /<button type="button" class="shrink-0 /);
  // Art-Abzeichen ohne CSS-Großschreibung: Der Seitentext (innerText) trägt den Wortlaut der Abnahme.
  const abzeichen = [...html.matchAll(/<span class="([^"]*)"[^>]*data-anker-art="true">([^<]*)<\/span>/g)];
  assert.equal(abzeichen.length, 11);
  assert.ok(abzeichen.every(([, klassen]) => !/\buppercase\b/.test(klassen)), "keine Großschreibung per CSS");
  assert.deepEqual(abzeichen.filter(([, , t]) => t !== "Visualisierung").map(([, , t]) => t), ["KI-Stimmungsbild, kein Anker"]);
  // Kein Bauträger, kein Name; "Foto" nur verneint.
  const t = sichtbar(html);
  assert.ok(!t.includes("Bauträger"));
  assert.deepEqual(t.match(/Fotos?/g), ["Fotos"]);
  assert.ok(t.includes("keine Fotos"));
});
