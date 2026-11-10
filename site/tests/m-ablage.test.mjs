// Objekt-Studio Schritt 7 (10.11.2026): Medien-Ablage — Routen upload-url, medien (Prüflauf und Einspielen),
// abgleich und [id]/datei, dazu die Teile medien, kosten_credits und messung von GET /api/studio/[objekt].
// Lauf: npm test.
//
// Kein Netz: Supabase (REST und Storage) beantwortet tests/harness/fake.mjs mit tests/harness/studio-ablage.mjs,
// steinadel.de eine Attrappe in dieser Datei. Nur synthetische Bilder (sharp) und Videos (MP4-Kopf „ftyp“, sonst
// Zufallsbytes); keine Anker- oder Probe-Dateien. Das Anker-Manifest ist synthetisch (tests/harness/anker-attrappe.mjs,
// per registerHooks statt src/lib/studio/anker.ts geladen). Die Umgebungswerte sind Test-Werte dieses Prozesses.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomFillSync } from "node:crypto";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANKER_ECHT = pathToFileURL(path.join(SITE, "src/lib/studio/anker.ts")).href;
const ANKER_ATTRAPPE = pathToFileURL(path.join(SITE, "tests/harness/anker-attrappe.mjs")).href;

// Wie tests/s-studio.test.mjs; dazu die Umlenkung von src/lib/studio/anker.ts auf die Attrappe.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let r;
    if (specifier === "next/server") r = nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/server.js")).href, context);
    else if (specifier === "server-only") r = nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/dist/compiled/server-only/empty.js")).href, context);
    else if (specifier.startsWith("@/")) r = nextResolve(pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
    else if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) r = nextResolve(`${specifier}.ts`, context);
    else r = nextResolve(specifier, context);
    if (r.url === ANKER_ECHT && context.parentURL !== ANKER_ATTRAPPE) return { ...r, url: ANKER_ATTRAPPE, format: "module" };
    return r;
  },
});

const SERVICE = "service-test-key-1234567890abcdef";
const ANON = "anon-test-key-0000000000";
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_KEY: SERVICE,
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
});

const fake = await import("./harness/fake.mjs");
const { welt, zuruecksetzen } = fake;
fake.installiere();
const { legeObjektAn } = await import("./harness/studio-ablage.mjs");
const attrappe = await import("./harness/anker-attrappe.mjs");
const sharp = createRequire(path.join(SITE, "package.json"))("sharp");
const { createClient } = createRequire(path.join(SITE, "package.json"))("@supabase/supabase-js");
const { NextRequest } = await import("next/server");
const ablage = await import("../src/lib/studio/medien-ablage.ts");
const medien = await import("../src/lib/studio/medien.ts");
const lade = (rel) => import(pathToFileURL(path.join(SITE, rel)).href);
const uploadRoute = await lade("src/app/api/studio/[objekt]/medien/upload-url/route.ts");
const medienRoute = await lade("src/app/api/studio/[objekt]/medien/route.ts");
const abgleichRoute = await lade("src/app/api/studio/[objekt]/medien/abgleich/route.ts");
const dateiRoute = await lade("src/app/api/studio/[objekt]/medien/[id]/datei/route.ts");
const studioRoute = await lade("src/app/api/studio/[objekt]/route.ts");

const SLUG = "rittergut-seifersdorf";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const UUID_PFAD = /^eingang\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|mp4)$/;

// ─── Synthetische Dateien ──────────────────────────────────────────────────────────────────────

async function rauschJpeg(breite, hoehe, saat) {
  const roh = Buffer.alloc(breite * hoehe * 3);
  let s = saat;
  for (let i = 0; i < roh.length; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    roh[i] = s & 0xff;
  }
  return sharp(roh, { raw: { width: breite, height: hoehe, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

/** MP4-Attrappe: Box-Kopf mit „ftyp“ ab Byte 4, danach Zufallsbytes. */
function mp4(bytes) {
  const b = Buffer.alloc(bytes);
  randomFillSync(b);
  b.writeUInt32BE(0x18, 0);
  b.write("ftypisom", 4, "latin1");
  return b;
}

const ANKER_BYTES = await rauschJpeg(400, 260, 4711);
const ANKER_URL = "https://steinadel.de/objekte/test/test-anker.jpg";
/** Anker-Datei mit derselben Größe, ein Byte in der Mitte gekippt (Hash weicht ab, Größe nicht). */
const ANKER_GEKIPPT = (() => {
  const b = Buffer.from(ANKER_BYTES);
  b[b.length >> 1] ^= 0xff;
  return b;
})();
const REZEPT = { x: 12, y: 30, breite: 320, hoehe: 180, skalierung: 1 };
const MANIFEST = Object.freeze({
  gemessen_am: "2026-11-10T07:59:15Z",
  messweg: "synthetisch (Test)",
  cover_anker: "test-anker",
  eintraege: Object.freeze([
    {
      id: "test-anker",
      url: ANKER_URL,
      sha256: sha(ANKER_BYTES),
      bytes: ANKER_BYTES.length,
      breite: 400,
      hoehe: 260,
      art: "visualisierung",
      herkunft: { text: "synthetisch", expose_seite: null },
      personen: { stand: "nein", text: null },
      als_anker: true,
      hinweis: null,
    },
    {
      id: "kein-anker",
      url: "https://steinadel.de/objekte/test/kein-anker.jpg",
      sha256: "b".repeat(64),
      bytes: 10,
      breite: 10,
      hoehe: 10,
      art: "ki_stimmungsbild",
      herkunft: { text: "synthetisch", expose_seite: null },
      personen: { stand: "nicht_geprueft", text: null },
      als_anker: false,
      hinweis: null,
    },
  ]),
});

const STARTBILD = await sharp(ANKER_BYTES).extract({ left: REZEPT.x, top: REZEPT.y, width: REZEPT.breite, height: REZEPT.hoehe }).png().toBuffer();
/** Original über der Puffergrenze von Next (15.000.000 B), Export 650.000 B — synthetisch. */
const ORIGINAL = mp4(15_000_000);
const EXPORT = mp4(650_000);
const DATEIEN = {
  startbild: { bytes: STARTBILD, mime: "image/png" },
  original: { bytes: ORIGINAL, mime: "video/mp4" },
  export: { bytes: EXPORT, mime: "video/mp4" },
};

const KI_HINWEIS = "KI-generierte Visualisierung des geplanten Zustands – unverbindlich, keine reale Aufnahme";

function beleg(extra = {}, dateien = DATEIEN) {
  return {
    erzeuger: "higgsfield-connector",
    modell: "test-modell",
    job_id: "test-job-0001",
    parameter: { stufe: "test", laenge_s: 4 },
    prompt: "Synthetischer Test-Prompt. Licht ruhig. Rahmen fest.",
    prompt_klauseln: [
      { id: "licht", text: "Licht ruhig." },
      { id: "rahmen", text: "Rahmen fest." },
    ],
    kosten_vorschau_credits: 6.5,
    kosten_credits: 6.5,
    kosten_quelle: "Kostenvorschau im Test",
    anker_id: "test-anker",
    ausschnitt: { ...REZEPT },
    startbild_sha256: sha(dateien.startbild.bytes),
    original_sha256: sha(dateien.original.bytes),
    export_sha256: sha(dateien.export.bytes),
    schnitt_von_s: 0.25,
    schnitt_bis_s: 2.75,
    ki_hinweis_text: KI_HINWEIS,
    ffprobe: {
      original: { breite: 1920, hoehe: 1080, fps: 24, dauer_s: 4.5, aigc_kennzeichen: true },
      export: { breite: 1280, hoehe: 720, fps: 24, dauer_s: 2.5, aigc_kennzeichen: false },
    },
    hinweise: { startbild: ["Test-Hinweis zum Startbild"], original: ["Test-Hinweis zum Original"] },
    ...extra,
  };
}

// ─── Attrappe für steinadel.de ─────────────────────────────────────────────────────────────────

const steinadel = { abrufe: 0, antwort: null, tor: null, angekommen: null };
const harnessFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname !== "steinadel.de") return harnessFetch(input, init);
  steinadel.abrufe += 1;
  steinadel.angekommen?.();
  if (steinadel.tor) await steinadel.tor;
  if (steinadel.antwort) return steinadel.antwort(url);
  if (url.href === ANKER_URL) return new Response(ANKER_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
  return new Response("nicht gefunden", { status: 404 });
};

function exportMitCover(cover = ANKER_URL) {
  welt.objekteAntwort = {
    status: 200,
    body: { version: "1", quelle: "Test-Export", generiert_am: "2026-11-10T07:00:00Z", objekte: [{ slug: SLUG, name: "RitterGut", urls: { cover } }] },
  };
}

beforeEach(() => {
  zuruecksetzen();
  ablage.setzeSperreZurueck();
  attrappe.setzeTestManifest(SLUG, MANIFEST);
  exportMitCover();
  Object.assign(steinadel, { abrufe: 0, antwort: null, tor: null, angekommen: null });
  process.env.SUPABASE_SERVICE_KEY = SERVICE;
});

// ─── Anfragen ──────────────────────────────────────────────────────────────────────────────────

const HERKUNFT = { "content-type": "application/json", "sec-fetch-site": "same-origin", cookie: "gp-auth=test" };

async function post(route, pfad, koerper, kopf = {}) {
  const req = new NextRequest(`http://harness.local/api/studio/${SLUG}/medien${pfad}`, {
    method: "POST",
    headers: { ...HERKUNFT, ...kopf },
    body: typeof koerper === "string" ? koerper : JSON.stringify(koerper),
  });
  const res = await route.POST(req, { params: Promise.resolve({ objekt: SLUG }) });
  return { status: res.status, body: await res.json().catch(() => null), kopf: res.headers };
}

async function holeDatei(id, kopf = {}) {
  const req = new NextRequest(`http://harness.local/api/studio/${SLUG}/medien/${id}/datei`, { headers: { cookie: "gp-auth=test", ...kopf } });
  const res = await dateiRoute.GET(req, { params: Promise.resolve({ objekt: SLUG, id: String(id) }) });
  return { status: res.status, ort: res.headers.get("location"), body: res.status === 302 ? null : await res.json().catch(() => null), kopf: res.headers };
}

async function holeStudio() {
  const req = new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } });
  const res = await studioRoute.GET(req, { params: Promise.resolve({ objekt: SLUG }) });
  return res.json();
}

/** Upload wie der Browser: Upload-URLs vom Server, dann PUT je Datei auf die signierte URL. */
async function hochladen(dateien = DATEIEN) {
  const r = await post(uploadRoute, "/upload-url", { dateien: Object.entries(dateien).map(([rolle, d]) => ({ rolle, bytes: d.bytes.length, mime: d.mime })) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const eingang = {};
  for (const d of r.body.dateien) {
    const res = await fetch(d.signedUrl, { method: "PUT", headers: { "content-type": d.mime, "x-upsert": "false" }, body: dateien[d.rolle].bytes });
    assert.equal(res.status, 200, await res.text());
    eingang[d.rolle] = d.pfad;
  }
  return eingang;
}

const pruefen = (eingang, b = beleg()) => post(medienRoute, "", { eingang, beleg: b, nur_pruefen: true });
const einspielen = (eingang, b, v) => post(medienRoute, "", { eingang, beleg: b, bestaetigt: v.vorschau_sha256, vorschau: v.vorschau });

/** Prüflauf und Einspielen mit frisch hochgeladenen Dateien; liefert beide Antworten. */
async function ganzEinspielen(b = beleg(), dateien = DATEIEN) {
  const eingang = await hochladen(dateien);
  const v = await pruefen(eingang, b);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const e = await einspielen(eingang, b, v.body);
  return { eingang, v, e };
}

const ops = (von = 0) => welt.studio.log.slice(von).map((l) => l.op);
const zeilen = () => welt.tabellen.studio_medium ?? [];
const objektPfade = () => [...welt.studio.objekte.keys()].sort();

// ═══ upload-url ═══

test("M-U1 upload-url: 50.000.000 B gehen, 50.000.001 B → 413; Pfad eingang/<uuid>.<endung> vom Server; Token ohne upsert", async () => {
  const r = await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "original", bytes: 50_000_000, mime: "video/mp4" }, { rolle: "startbild", bytes: 1, mime: "image/jpeg" }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.kopf.get("cache-control"), "no-store");
  assert.deepEqual(r.body.dateien.map((d) => d.rolle), ["original", "startbild"]);
  for (const d of r.body.dateien) {
    assert.match(d.pfad, UUID_PFAD);
    assert.ok(d.pfad.endsWith(d.mime === "video/mp4" ? ".mp4" : ".jpg"), d.pfad);
    assert.match(d.signedUrl, new RegExp(`^http://supabase\\.test/storage/v1/object/upload/sign/studio/${d.pfad.replace(".", "\\.")}\\?token=tok-\\d+$`));
    assert.match(d.token, /^tok-\d+$/);
  }
  const signiert = welt.studio.log.filter((l) => l.op === "sign_upload");
  assert.equal(signiert.length, 2);
  assert.ok(signiert.every((l) => l.upsert === false), "kein upsert in der Anfrage");
  const zuGross = await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "original", bytes: 50_000_001, mime: "video/mp4" }] });
  assert.equal(zuGross.status, 413);
  assert.equal(zuGross.body.fehler_art, "zu_gross");
  assert.equal(welt.studio.log.filter((l) => l.op === "sign_upload").length, 2, "keine URL für die zu große Datei");
});

test("M-U2 upload-url: MIME passt nicht zur Rolle → 415; Eingabefehler → 400; JSON über 1 MB → 413; fremde Herkunft → 403/415", async () => {
  const falsch = await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "original", bytes: 10, mime: "image/png" }] });
  assert.equal(falsch.status, 415);
  assert.equal(falsch.body.fehler_art, "dateityp");
  assert.equal((await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "abgleich", bytes: 10, mime: "video/mp4" }] })).status, 415);
  for (const koerper of [{}, { dateien: [] }, { dateien: [{ rolle: "poster", bytes: 1, mime: "image/png" }] }, { dateien: [{ rolle: "export", bytes: 0, mime: "video/mp4" }] }, { dateien: [{ rolle: "export", bytes: 1, mime: "video/mp4" }, { rolle: "export", bytes: 1, mime: "video/mp4" }] }]) {
    assert.equal((await post(uploadRoute, "/upload-url", koerper)).status, 400, JSON.stringify(koerper));
  }
  const gross = await post(uploadRoute, "/upload-url", JSON.stringify({ dateien: [{ rolle: "export", bytes: 1, mime: "video/mp4" }], polster: "x".repeat(1_000_001) }));
  assert.equal(gross.status, 413);
  assert.equal((await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "export", bytes: 1, mime: "video/mp4" }] }, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "export", bytes: 1, mime: "video/mp4" }] }, { "content-type": "text/plain" })).status, 415);
  assert.equal(welt.studio.log.filter((l) => l.op === "sign_upload").length, 0);
});

// ═══ Prüflauf ═══

test("M-P1 Prüflauf schreibt nichts (kein move, kein insert, kein remove) und liefert drei Zeilen samt vorschau_sha256", async () => {
  const eingang = await hochladen();
  const vorher = welt.studio.log.length;
  const v = await pruefen(eingang);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.deepEqual([...new Set(ops(vorher))].sort(), ["download", "list"], ops(vorher).join(","));
  assert.equal(zeilen().length, 0);
  assert.deepEqual(objektPfade(), Object.values(eingang).sort(), "die Eingangsdateien bleiben liegen");
  assert.equal(v.body.art, "vorschau");
  assert.deepEqual(v.body.vorschau.map((z) => z.rolle), ["startbild", "original", "export"]);
  assert.equal(v.body.vorschau_sha256, medien.vorschauHash(v.body.vorschau));
  const [sb, og, ex] = v.body.vorschau.map((z) => z.felder);
  // Hash und Größe vom Server gemessen; der Pfad hängt am Inhalt.
  assert.equal(og.sha256, sha(ORIGINAL));
  assert.equal(og.bytes, 15_000_000);
  assert.equal(og.speicher_pfad, `${SLUG}/${sha(ORIGINAL)}.mp4`);
  assert.equal(sb.speicher_pfad, `${SLUG}/${sha(STARTBILD)}.png`);
  assert.equal(sb.startbild_abgleich, "bestanden");
  assert.equal(sb.startbild_abweichung_max, 0);
  assert.deepEqual([sb.breite, sb.hoehe], [320, 180], "Maße des Startbilds vom Server gemessen");
  assert.deepEqual(sb.parameter, { hinweise: ["Test-Hinweis zum Startbild"] });
  assert.equal(og.startbild_id, "@startbild");
  assert.equal(ex.abgeleitet_von, "@original");
  // Kosten, Prompt und Klauseln nur am Original; job_id an Original und Export; KI-Hinweis und Schnitt am Export.
  assert.equal(og.kosten_credits, 6.5);
  for (const z of [sb, ex]) {
    assert.equal(z.kosten_credits, null);
    assert.equal(z.prompt, null);
    assert.deepEqual(z.prompt_klauseln, []);
  }
  assert.equal(og.job_id, "test-job-0001");
  assert.equal(ex.job_id, "test-job-0001");
  assert.equal(ex.ki_hinweis_text, KI_HINWEIS);
  assert.deepEqual([ex.schnitt_von_s, ex.schnitt_bis_s], [0.25, 2.75]);
  assert.deepEqual(og.parameter, { stufe: "test", laenge_s: 4, hinweise: ["Test-Hinweis zum Original"] });
  for (const z of [sb, og, ex]) {
    assert.ok(!("id" in z) && !("eingespielt_am" in z), "keine id, keine DB-Uhr in der Vorschau");
    assert.equal(z.anker_sha256, sha(ANKER_BYTES));
  }
  assert.ok(v.body.speicher.rss_vorher_b > 0 && v.body.speicher.rss_nachher_b > 0 && v.body.speicher.max_rss_kib > 0);
  assert.equal(v.body.abgleich.toleranz, 2);
});

test("M-P2 Prüflauf: Datei-Signatur passt nicht → 415; Anker-Hash weicht ab → 409; Anker nicht erreichbar → 502; Beleg-Hash weicht ab → 409", async () => {
  // Original mit PNG-Inhalt, als MP4 angekündigt.
  const falsch = { ...DATEIEN, original: { bytes: STARTBILD, mime: "video/mp4" } };
  const e1 = await hochladen(falsch);
  const r1 = await pruefen(e1, beleg({}, { ...falsch, original: { bytes: Buffer.concat([STARTBILD, Buffer.from("x")]) } }));
  // (Beleg-Hash ohnehin anders; die Signatur fällt vorher auf.)
  assert.equal(r1.status, 415, JSON.stringify(r1.body));
  assert.equal(r1.body.fehler_art, "dateityp");
  assert.deepEqual(objektPfade(), [], "nach dem Fehler sind die eigenen Eingangsdateien gelöscht");

  steinadel.antwort = () => new Response(Buffer.from("andere Bytes"), { status: 200, headers: { "content-type": "image/jpeg" } });
  const e2 = await hochladen();
  const r2 = await pruefen(e2);
  assert.equal(r2.status, 409);
  assert.match(r2.body.fehler, /Anker test-anker: Live-Datei weicht vom Manifest ab/);

  // Gleiche Größe, anderer Inhalt (ein Byte gekippt): Hier fällt nur der Hash auf, nicht die Größe (Nachbesserung
  // mutanten-1, Mutant M2b „Hash-Vergleich nur im Pfad mit Bytes entfernt“).
  steinadel.antwort = () => new Response(ANKER_GEKIPPT, { status: 200, headers: { "content-type": "image/jpeg" } });
  const e2b = await hochladen();
  const r2b = await pruefen(e2b);
  assert.equal(r2b.status, 409, JSON.stringify(r2b.body));
  assert.match(r2b.body.fehler, /Anker test-anker: Live-Datei weicht vom Manifest ab.*gleiche Größe, anderer Inhalt/);
  assert.equal(zeilen().length, 0);

  steinadel.antwort = () => new Response("weg", { status: 503 });
  const e3 = await hochladen();
  const r3 = await pruefen(e3);
  assert.equal(r3.status, 502);
  assert.match(r3.body.fehler, /Anker test-anker nicht erreichbar: HTTP 503/);

  steinadel.antwort = null;
  const e4 = await hochladen();
  const r4 = await pruefen(e4, beleg({ export_sha256: "c".repeat(64) }));
  assert.equal(r4.status, 409);
  assert.match(r4.body.fehler, /export: SHA-256 der Datei .* weicht vom Beleg ab/);
  assert.equal(zeilen().length, 0);
});

test("M-P3 Prüflauf: Anker aus dem Manifest nötig (400), kein Nicht-Anker (400), Rezept im Anker (400), Export-Cover zeigt auf den Anker (409)", async () => {
  const e = await hochladen();
  assert.match((await pruefen(e, beleg({ anker_id: "unbekannt" }))).body.fehler, /steht nicht im Anker-Manifest/);
  assert.match((await pruefen(e, beleg({ anker_id: "kein-anker" }))).body.fehler, /kein zulässiger Anker/);
  const aussen = await pruefen(e, beleg({ ausschnitt: { ...REZEPT, y: 81 } }));
  assert.equal(aussen.status, 400);
  assert.match(aussen.body.fehler, /außerhalb des Ankers test-anker \(400×260\)/);
  assert.equal(steinadel.abrufe, 0, "vor jedem Abruf abgewiesen");
  assert.deepEqual(objektPfade(), Object.values(e).sort(), "400 vor der Sperre: Dateien bleiben liegen");
  exportMitCover("https://steinadel.de/objekte/test/ki-cover.jpg");
  const cover = await pruefen(e);
  assert.equal(cover.status, 409);
  assert.match(cover.body.fehler, /Export-Cover zeigt nicht mehr auf den Anker test-anker/);
});

test("M-P4 Beleg-Schema: unbekanntes Feld, fehlendes Feld, gleiche Hashes, USD beim Connector, Kosten ohne Quelle → 400; fremde Herkunft → 403, kein JSON → 415 — alles ohne Dateiarbeit", async () => {
  const e = await hochladen();
  const vorher = welt.studio.log.length;
  const faelle = [
    [beleg({ farbe: "rot" }), /unbekanntes Feld farbe/],
    [(() => { const b = beleg(); delete b.job_id; return b; })(), /Feld job_id fehlt/],
    [beleg({ export_sha256: sha(ORIGINAL) }), /verschiedene Dateien/],
    [beleg({ kosten_usd: 0.42 }), /nur für higgsfield-api/],
    [beleg({ kosten_quelle: null }), /kosten_quelle: Pflicht/],
    [beleg({ parameter: { hinweise: [] } }), /Schlüssel hinweise ist vergeben/],
    [beleg({ prompt: "x".repeat(2501) }), /höchstens 2500 Zeichen/],
    [beleg({ prompt_klauseln: [{ id: "a", text: "x" }, { id: "a", text: "y" }] }), /doppelt/],
    [beleg({ ausschnitt: { ...REZEPT, skalierung: 2 } }), /skalierung muss 1 sein/],
    [beleg({ schnitt_von_s: 3, schnitt_bis_s: 3 }), /0 ≤ von < bis/],
    [beleg({ hinweise: ["flach"] }), /hinweise: Objekt je Rolle/],
  ];
  for (const [b, muster] of faelle) {
    const r = await pruefen(e, b);
    assert.equal(r.status, 400, muster.source);
    assert.match(r.body.fehler, muster);
  }
  assert.deepEqual(ops(vorher), [], "keine Datei gelesen, verschoben oder gelöscht");
  // Modus: genau eines von nur_pruefen und bestaetigt
  assert.equal((await post(medienRoute, "", { eingang: e, beleg: beleg() })).status, 400);
  assert.equal((await post(medienRoute, "", { eingang: e, beleg: beleg(), nur_pruefen: true, bestaetigt: "a".repeat(64) })).status, 400);
  assert.equal((await post(medienRoute, "", { eingang: { ...e, export: e.original }, beleg: beleg(), nur_pruefen: true })).status, 400);
  assert.equal((await post(medienRoute, "", { eingang: { ...e, export: "Objekt/x.mp4" }, beleg: beleg(), nur_pruefen: true })).status, 400);
  // Herkunft vor allem anderen, in beiden Modi: fremde Seite → 403, kein JSON → 415
  for (const kopf of [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) {
    const p = await post(medienRoute, "", { eingang: e, beleg: beleg(), nur_pruefen: true }, kopf);
    assert.equal(p.status, 403, JSON.stringify(kopf));
    assert.equal(p.body.fehler_art, "herkunft");
    assert.equal((await post(medienRoute, "", { eingang: e, beleg: beleg(), bestaetigt: "a".repeat(64), vorschau: [] }, kopf)).status, 403, JSON.stringify(kopf));
  }
  assert.equal((await post(medienRoute, "", { eingang: e, beleg: beleg(), nur_pruefen: true }, { "content-type": "text/plain" })).status, 415);
  assert.deepEqual(ops(vorher), [], "auch nach Modus- und Herkunftsfehlern keine Datei gelesen, verschoben oder gelöscht");
  assert.equal(zeilen().length, 0);
});

// ═══ Einspielen ═══

test("M-E1 Einspielen: 15-MB-Attrappe, drei Zeilen in Reihenfolge Startbild → Original → Export; move nach arbeit/ vor dem Messen; Hash und Größe vom Server", async () => {
  const eingang = await hochladen();
  const v = await pruefen(eingang);
  const vorher = welt.studio.log.length;
  const e = await einspielen(eingang, beleg(), v.body);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.art, "eingespielt");
  // Storage: je Datei erst move eingang/ → arbeit/, dann Lesen am neuen Ort; nie ein Eingangspfad gelesen.
  const log = welt.studio.log.slice(vorher);
  for (const rolle of ["startbild", "original", "export"]) {
    const arbeit = medien.arbeitPfad(eingang[rolle]);
    const mv = log.findIndex((l) => l.op === "move" && l.pfad === eingang[rolle] && l.ziel === arbeit);
    const dl = log.findIndex((l) => l.op === "download" && l.pfad === arbeit);
    assert.ok(mv >= 0 && dl > mv, `${rolle}: move ${mv}, download ${dl}`);
  }
  assert.ok(!log.some((l) => l.op === "download" && l.pfad?.startsWith("eingang/")), "kein Hash vor dem move");
  // Inhalts-Pfade, eingang/ und arbeit/ leer
  assert.deepEqual(objektPfade(), [`${SLUG}/${sha(EXPORT)}.mp4`, `${SLUG}/${sha(ORIGINAL)}.mp4`, `${SLUG}/${sha(STARTBILD)}.png`].sort());
  // Zeilen: Reihenfolge, Kette, DB-Uhr
  const z = zeilen();
  assert.deepEqual(z.map((r) => r.fassung), ["startbild", "original", "export"]);
  assert.deepEqual(e.body.zeilen.map((r) => [r.rolle, r.id, r.wiederverwendet]), [["startbild", 1, false], ["original", 2, false], ["export", 3, false]]);
  assert.equal(z[1].startbild_id, 1);
  assert.equal(z[2].abgeleitet_von, 2);
  assert.equal(z[1].sha256, sha(ORIGINAL));
  assert.equal(z[1].bytes, 15_000_000);
  assert.ok(z.every((r) => typeof r.eingespielt_am === "string" && /\+00:00$/.test(r.eingespielt_am)), "eingespielt_am setzt die DB-Uhr");
  const einfuegen = welt.log.filter((l) => l.methode === "POST" && l.tabelle === "studio_medium");
  assert.equal(einfuegen.length, 3);
  assert.ok(einfuegen.every((l) => !("id" in l.body) && !("eingespielt_am" in l.body)), "weder id noch DB-Uhr gesendet");
  assert.ok(einfuegen.every((l) => !/resolution=merge|on_conflict/.test(l.query)), "kein upsert");
  assert.ok(e.body.speicher.max_rss_kib > 0);
  assert.ok(!ablage.sperreBelegt(), "Sperre wieder frei");
});

test("M-E2 Vorschau veraltet → 409 mit Feldliste, nichts eingefügt; ohne mitgeschickte Vorschau eine Ersatzliste", async () => {
  const eingang = await hochladen();
  const v = await pruefen(eingang);
  const r = await einspielen(eingang, beleg({ modell: "anderes-modell" }), v.body);
  assert.equal(r.status, 409);
  assert.match(r.body.fehler, /Vorschau veraltet/);
  assert.deepEqual(r.body.felder, ["original.modell"]);
  assert.equal(zeilen().length, 0);
  assert.deepEqual(objektPfade(), [], "Arbeitsdateien nach dem Fehler gelöscht");
  const e2 = await hochladen();
  const v2 = await pruefen(e2);
  const r2 = await post(medienRoute, "", { eingang: e2, beleg: beleg(), bestaetigt: "d".repeat(64) });
  assert.equal(r2.status, 409);
  assert.deepEqual(r2.body.felder, ["bestätigte Vorschau nicht mitgeschickt oder passt nicht zu bestaetigt"]);
  assert.notEqual(v2.body.vorschau_sha256, "d".repeat(64));
  assert.equal(zeilen().length, 0);
});

test("M-E3 Nach dem Prüflauf ausgetauschte Datei im Eingang → 409 beim Einspielen, nichts eingefügt", async () => {
  const eingang = await hochladen();
  const v = await pruefen(eingang);
  assert.equal(v.status, 200);
  legeObjektAn(welt.studio, eingang.export, mp4(650_000), { mime: "video/mp4" });
  const r = await einspielen(eingang, beleg(), v.body);
  assert.equal(r.status, 409);
  assert.match(r.body.fehler, /export: SHA-256 der Datei .* weicht vom Beleg ab/);
  assert.equal(zeilen().length, 0);
  assert.ok(!objektPfade().some((p) => p.startsWith(`${SLUG}/`)), "kein Inhalts-Pfad angelegt");
});

test("M-E4 23505: Teilstand wird bei gleichem Beleg fortgesetzt (Startbild weiterverwendet); alle drei gleich vorhanden → 409 „vorhanden“ mit ids", async () => {
  let stoeren = true;
  welt.stoerung = (a) => (stoeren && a.art === "supabase" && a.methode === "POST" && a.tabelle === "studio_medium" && a.body?.fassung === "original" ? { status: 500, body: { message: "Verbindung abgebrochen" } } : null);
  const erst = await ganzEinspielen();
  assert.equal(erst.e.status, 500);
  assert.equal(erst.e.body.fehler_art, "schreibfehler");
  assert.deepEqual(zeilen().map((z) => z.fassung), ["startbild"], "Teilstand: nur das Startbild");
  stoeren = false;
  welt.stoerung = null;
  const weiter = await ganzEinspielen();
  assert.equal(weiter.e.status, 200, JSON.stringify(weiter.e.body));
  assert.deepEqual(weiter.e.body.zeilen.map((r) => [r.rolle, r.id, r.wiederverwendet]), [["startbild", 1, true], ["original", 3, false], ["export", 4, false]]);
  assert.equal(zeilen().find((z) => z.fassung === "original").startbild_id, 1);
  // Alles schon da: 409 vorhanden, keine neue Zeile, keine Datei unter eingang/ oder arbeit/.
  const nochmal = await ganzEinspielen();
  assert.equal(nochmal.e.status, 409);
  assert.deepEqual(nochmal.e.body.vorhanden, { startbild: 1, original: 3, export: 4 });
  assert.equal(zeilen().length, 3);
  assert.ok(objektPfade().every((p) => p.startsWith(`${SLUG}/`)), objektPfade().join(", "));
});

test("M-E5 Vorhandene Zeile mit abweichendem Feld → 409 mit Feldliste vor dem ersten Schreiben: keine neue Zeile, keine Inhaltsdatei (je Feldgruppe ein Fall, auch Kette in beide Richtungen)", async () => {
  const anderesStartbild = await sharp(ANKER_BYTES).extract({ left: REZEPT.x + 1, top: REZEPT.y, width: REZEPT.breite, height: REZEPT.hoehe }).png().toBuffer();
  const faelle = [
    // Kette: dasselbe Original mit einem anderen Startbild
    { name: "Kette", dateien: { ...DATEIEN, startbild: { bytes: anderesStartbild, mime: "image/png" } }, beleg: (d) => beleg({ ausschnitt: { ...REZEPT, x: REZEPT.x + 1 } }, d), felder: ["original.startbild_id"] },
    // Spiegelfall: derselbe Export zu einem anderen Original
    { name: "Spiegel", dateien: { ...DATEIEN, original: { bytes: mp4(1_000_000), mime: "video/mp4" } }, beleg: (d) => beleg({}, d), felder: ["export.abgeleitet_von"] },
    // Anker: dasselbe Startbild mit anderem Rezept (Abgleich ändert sich mit)
    { name: "Anker", dateien: DATEIEN, beleg: (d) => beleg({ ausschnitt: { ...REZEPT, x: REZEPT.x + 1 } }, d), felder: ["startbild.ausschnitt", "startbild.startbild_abgleich", "startbild.startbild_abweichung_max"] },
    { name: "Erzeugung", dateien: DATEIEN, beleg: (d) => beleg({ modell: "anderes-modell", prompt: "Anderer synthetischer Prompt." }, d), felder: ["original.modell", "original.prompt"] },
    { name: "Kosten", dateien: DATEIEN, beleg: (d) => beleg({ kosten_credits: 9 }, d), felder: ["original.kosten_credits"] },
    { name: "ffprobe", dateien: DATEIEN, beleg: (d) => beleg({ ffprobe: { ...beleg().ffprobe, original: { ...beleg().ffprobe.original, fps: 25 } } }, d), felder: ["original.fps"] },
    { name: "Schnitt und KI-Hinweis", dateien: DATEIEN, beleg: (d) => beleg({ schnitt_von_s: 0.5, ki_hinweis_text: "Anderer Hinweis" }, d), felder: ["export.schnitt_von_s", "export.ki_hinweis_text"] },
  ];
  for (const f of faelle) {
    zuruecksetzen();
    ablage.setzeSperreZurueck();
    exportMitCover();
    assert.equal((await ganzEinspielen()).e.status, 200, f.name);
    const vorher = zeilen().length;
    const r = (await ganzEinspielen(f.beleg(f.dateien), f.dateien)).e;
    assert.equal(r.status, 409, `${f.name}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body.felder, f.felder, f.name);
    assert.match(r.body.fehler, /bestehen schon mit abweichenden Feldern — nichts verschoben, nichts eingefügt/);
    // Vorprüfung (Review-Befund 4): keine neue Zeile, auch nicht das neue Startbild oder Original, und keine Datei
    // auf einem neuen Inhalts-Pfad; eingang/ und arbeit/ sind leer.
    assert.equal(zeilen().length, vorher, f.name);
    const neu = Object.values(f.dateien).map((d) => medien.inhaltsPfad(SLUG, sha(d.bytes), d.mime));
    assert.deepEqual(objektPfade(), [...new Set(Object.values(DATEIEN).map((d) => medien.inhaltsPfad(SLUG, sha(d.bytes), d.mime)))].sort(), `${f.name}: ${neu.join(", ")}`);
  }
});

test("M-E5b Wettlauf: entsteht eine abweichende Zeile erst nach der Vorprüfung, greift der Vergleich bei 23505 — 409 mit Feldliste, nicht weiterverwendet", async () => {
  assert.equal((await ganzEinspielen()).e.status, 200);
  const og = structuredClone(zeilen()[1]);
  zuruecksetzen();
  ablage.setzeSperreZurueck();
  exportMitCover();
  let eingeschoben = null;
  welt.vorAntwort = async (a) => {
    if (eingeschoben === null && a.methode === "POST" && a.tabelle === "studio_medium" && a.body?.fassung === "original") {
      const sb = welt.tabellen.studio_medium.find((z) => z.fassung === "startbild");
      eingeschoben = { ...og, id: 99, startbild_id: sb.id, modell: "anderes-modell" };
      welt.tabellen.studio_medium.push(eingeschoben);
    }
  };
  try {
    const r = (await ganzEinspielen()).e;
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.deepEqual(r.body.felder, ["original.modell"]);
    assert.match(r.body.fehler, /^original: Zeile 99 besteht schon mit abweichenden Feldern — nicht weiterverwendet/);
    assert.ok(!zeilen().some((z) => z.fassung === "export"), "kein Export an der fremden Zeile");
  } finally {
    welt.vorAntwort = null;
  }
});

test("M-E10 Einspielen mit JPEG-Startbild (Nachbesserung mutanten-4): Inhalts-Pfad und speicher_pfad enden auf .jpg, nie .jpeg", async () => {
  const jpg = await sharp(ANKER_BYTES).extract({ left: REZEPT.x, top: REZEPT.y, width: REZEPT.breite, height: REZEPT.hoehe }).jpeg({ quality: 92 }).toBuffer();
  const dateien = { ...DATEIEN, startbild: { bytes: jpg, mime: "image/jpeg" } };
  const { eingang, v, e } = await ganzEinspielen(beleg({}, dateien), dateien);
  assert.match(eingang.startbild, /^eingang\/[0-9a-f-]+\.jpg$/);
  const ziel = `${SLUG}/${sha(jpg)}.jpg`;
  assert.equal(v.body.vorschau[0].felder.speicher_pfad, ziel);
  assert.equal(v.body.vorschau[0].felder.mime, "image/jpeg");
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(zeilen().length, 3);
  assert.equal(zeilen()[0].speicher_pfad, ziel);
  assert.ok(objektPfade().includes(ziel), objektPfade().join(" | "));
  assert.ok(!objektPfade().some((p) => p.endsWith(".jpeg")), "keine .jpeg-Datei");
  // Neu kodiert: gemessen und als nicht bestanden vermerkt — eingespielt wird trotzdem (die Regel sperrt später).
  assert.equal(zeilen()[0].startbild_abgleich, "nicht_bestanden");
});

test("M-E9 Zeitüberschreitung beim Einfügen (postgrest-js liefert sie als error, ohne zu werfen) → 500 mit „Ausgang unbekannt“", async () => {
  welt.vorAntwort = async (a) => {
    if (a.methode === "POST" && a.tabelle === "studio_medium" && a.body?.fassung === "original") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  try {
    const r = (await ganzEinspielen()).e;
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.equal(r.body.fehler_art, "schreibfehler");
    assert.match(r.body.fehler, /^Einfügen original fehlgeschlagen: Zeitüberschreitung \(\d+ s\) — Ausgang unbekannt; erneutes Einspielen mit gleichem Beleg setzt fort$/);
  } finally {
    welt.vorAntwort = null;
  }
});

test("M-E6 Feldvergleich normalisiert: Zahlen als Dezimalwert (NUMERIC als Text), JSON mit anderer Schlüsselfolge → gleich, also „vorhanden“", async () => {
  assert.equal((await ganzEinspielen()).e.status, 200);
  for (const z of zeilen()) {
    if (z.fps !== null) z.fps = "24.000";
    if (z.dauer_s !== null) z.dauer_s = String(z.dauer_s);
    if (z.kosten_credits !== null) z.kosten_credits = "6.500";
    if (z.ausschnitt) z.ausschnitt = { skalierung: 1, hoehe: REZEPT.hoehe, breite: REZEPT.breite, y: REZEPT.y, x: REZEPT.x };
  }
  const r = (await ganzEinspielen()).e;
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.vorhanden, { startbild: 1, original: 2, export: 3 });
  assert.equal(medien.dezimal("6.500"), "6.5");
  assert.equal(medien.dezimal(6.5), "6.5");
  assert.equal(medien.dezimal("007"), "7");
  assert.equal(medien.dezimal("0.000"), "0");
  assert.equal(medien.dezimal("abc"), null);
});

test("M-E7 Inhalts-Pfad schon belegt: gleiche Datei → weiter (Arbeitsdatei gelöscht); andere Datei → 409", async () => {
  const pfad = `${SLUG}/${sha(EXPORT)}.mp4`;
  legeObjektAn(welt.studio, pfad, EXPORT, { mime: "video/mp4" });
  const ok = await ganzEinspielen();
  assert.equal(ok.e.status, 200, JSON.stringify(ok.e.body));
  assert.ok(!objektPfade().some((p) => p.startsWith("arbeit/")));
  zuruecksetzen();
  ablage.setzeSperreZurueck();
  exportMitCover();
  legeObjektAn(welt.studio, pfad, mp4(650_000), { mime: "video/mp4" });
  const r = await ganzEinspielen();
  assert.equal(r.e.status, 409);
  assert.match(r.e.body.fehler, /export: unter .* liegt eine andere Datei/);
  assert.equal(zeilen().length, 0);
});

// ═══ Sperre, Aufräumen ═══

/**
 * Wartet höchstens ms auf p, sonst ein klarer Fehler statt eines hängenden Laufs: Fehlt die Sperre, wartet der zweite
 * Job am Tor der Anker-Attrappe (die das Abort-Signal nicht kennt), und der Test hinge bis zur Frist des Runners.
 */
async function binnen(p, ms, was) {
  let uhr;
  const frist = new Promise((_, nein) => {
    uhr = setTimeout(() => nein(new Error(`${was}: keine Antwort binnen ${ms} ms (wartet am Tor statt an der Sperre?)`)), ms);
  });
  try {
    return await Promise.race([p, frist]);
  } finally {
    clearTimeout(uhr);
  }
}

test("M-S1 Prozess-Sperre: ein zweiter Job, während einer läuft → 409 „läuft schon seit …“; danach frei", async () => {
  const eingang = await hochladen();
  let oeffnen;
  steinadel.tor = new Promise((f) => (oeffnen = f));
  const angekommen = new Promise((f) => (steinadel.angekommen = f));
  const erster = pruefen(eingang);
  try {
    await binnen(angekommen, 5_000, "erster Job");
    const zweiter = await binnen(post(abgleichRoute, "/abgleich", { eingang: eingang.startbild, anker_id: "test-anker", ausschnitt: REZEPT }), 5_000, "zweiter Job");
    assert.equal(zweiter.status, 409);
    assert.match(zweiter.body.fehler, /Ein Job läuft schon seit .* \(pruefen\)/);
    assert.equal(zweiter.body.laeuft.art, "pruefen");
    const dritter = await binnen(pruefen(eingang), 5_000, "dritter Job");
    assert.equal(dritter.status, 409);
    assert.ok(objektPfade().includes(eingang.startbild), "die abgewiesene Anfrage löscht keine Datei");
  } finally {
    // Immer öffnen: sonst warten der erste und jeder weitere Job am Tor, und die Folgetests hängen mit.
    oeffnen();
    steinadel.tor = null;
  }
  assert.equal((await erster).status, 200);
  assert.ok(!ablage.sperreBelegt());
  assert.equal((await pruefen(eingang)).status, 200, "nach dem Ende wieder frei");
});

test("M-A1 Aufräumen: nur Reste unter eingang/ und arbeit/ älter als 2 h; nie ein Inhalts-Pfad, nie eine junge Datei; GET löscht nie", async () => {
  const uuid = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
  const STUNDE = 3_600_000;
  legeObjektAn(welt.studio, `eingang/${uuid(1)}.png`, Buffer.from("alt"), { alterMs: 3 * STUNDE });
  legeObjektAn(welt.studio, `arbeit/${uuid(2)}.mp4`, Buffer.from("alt"), { alterMs: 3 * STUNDE });
  legeObjektAn(welt.studio, `eingang/${uuid(3)}.png`, Buffer.from("jung"), { alterMs: 10 * 60_000 });
  legeObjektAn(welt.studio, `${SLUG}/${"e".repeat(64)}.png`, Buffer.from("inhalt"), { alterMs: 3 * STUNDE });
  legeObjektAn(welt.studio, "eingang/kaputt.png", Buffer.from("fremde Form"), { alterMs: 3 * STUNDE });
  await holeStudio();
  assert.ok(!ops().includes("remove") && !ops().includes("list"), "GET räumt nicht auf");
  const r = await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "export", bytes: 1, mime: "video/mp4" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.aufgeraeumt, { geloescht: 2, fehler: null });
  const remove = welt.studio.log.filter((l) => l.op === "remove");
  assert.equal(remove.length, 1);
  assert.deepEqual(remove[0].pfade.sort(), [`arbeit/${uuid(2)}.mp4`, `eingang/${uuid(1)}.png`]);
  assert.deepEqual(objektPfade(), [`${SLUG}/${"e".repeat(64)}.png`, "eingang/kaputt.png", `eingang/${uuid(3)}.png`].sort());
  // Die Lösch-Regel selbst: nur die Upload-Form unter eingang/ und arbeit/.
  for (const p of [`${SLUG}/${"e".repeat(64)}.png`, "eingang/kaputt.png", `eingang/${uuid(1)}.jpeg`, `../eingang/${uuid(1)}.png`]) assert.equal(medien.istAufraeumbar(p), false, p);
  await assert.rejects(() => ablage.loescheZwischen(null, [`${SLUG}/${"e".repeat(64)}.png`]), /außerhalb von eingang\/ und arbeit\//);
});

test("M-A2 Aufräumen schont die Dateien der eigenen Anfrage: nach mehr als 2 h Pause gehen Prüflauf, Einspielen und Abgleich durch; nur fremde alte Reste gehen", async () => {
  const STUNDE = 3_600_000;
  const altern = (pfad) => {
    const o = welt.studio.objekte.get(pfad);
    o.erstellt -= 3 * STUNDE;
    o.geaendert -= 3 * STUNDE;
  };
  const fremd = (n) => `eingang/0000000${n}-0000-4000-8000-00000000000${n}.png`;
  const eingang = await hochladen();
  for (const p of Object.values(eingang)) altern(p);
  legeObjektAn(welt.studio, fremd(1), Buffer.from("alt"), { alterMs: 3 * STUNDE });
  const v = await pruefen(eingang);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.ok(Object.values(eingang).every((p) => objektPfade().includes(p)), "die eigenen Eingangsdateien bleiben liegen");
  assert.ok(!objektPfade().includes(fremd(1)), "der fremde alte Rest ist weg");
  legeObjektAn(welt.studio, fremd(2), Buffer.from("alt"), { alterMs: 3 * STUNDE });
  const e = await einspielen(eingang, beleg(), v.body);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.art, "eingespielt");
  assert.equal(zeilen().length, 3);
  assert.ok(!objektPfade().includes(fremd(2)));
  const g = await hochladen({ abgleich: { bytes: STARTBILD, mime: "image/png" } });
  altern(g.abgleich);
  const r = await post(abgleichRoute, "/abgleich", { eingang: g.abgleich, anker_id: "test-anker", ausschnitt: REZEPT });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.abgleich.urteil, "bestanden");
});

// ═══ abgleich ═══

test("M-G1 abgleich: legt keine Zeile an, löscht das Bild danach und nennt Abgleich, Versionen und speicher", async () => {
  const eingang = await hochladen({ abgleich: { bytes: STARTBILD, mime: "image/png" } });
  const r = await post(abgleichRoute, "/abgleich", { eingang: eingang.abgleich, anker_id: "test-anker", ausschnitt: REZEPT });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.abgleich.urteil, "bestanden");
  assert.equal(r.body.abgleich.abweichung_max, 0);
  assert.match(r.body.abgleich.versionen.sharp, /^\d+\.\d+/);
  assert.match(r.body.abgleich.versionen.vips, /^\d+\.\d+/);
  assert.equal(r.body.abgleich.versionen.nativ, true, "nativ (Nachbesserung infra-1)");
  assert.ok(r.body.speicher.rss_vorher_b > 0 && r.body.speicher.max_rss_kib > 0);
  assert.equal(r.body.datei.geloescht, true);
  assert.deepEqual(objektPfade(), [], "das Bild ist gelöscht");
  assert.equal(zeilen().length, 0);
  assert.ok(!welt.log.some((l) => l.methode === "POST" && String(l.tabelle).startsWith("studio_")), "kein Insert");
  // JPEG neu kodiert: gemessen, nicht bestanden; ein Video wird nicht angenommen.
  const jpg = await sharp(STARTBILD).jpeg({ quality: 92 }).toBuffer();
  const e2 = await hochladen({ abgleich: { bytes: jpg, mime: "image/jpeg" } });
  const r2 = await post(abgleichRoute, "/abgleich", { eingang: e2.abgleich, anker_id: "test-anker", ausschnitt: REZEPT });
  assert.equal(r2.body.abgleich.urteil, "nicht_bestanden");
  assert.ok(r2.body.abgleich.abweichung_max > 2);
  assert.equal((await post(abgleichRoute, "/abgleich", { eingang: e2.abgleich.replace(".jpg", ".mp4"), anker_id: "test-anker", ausschnitt: REZEPT })).status, 400);
  assert.equal((await post(abgleichRoute, "/abgleich", { eingang: e2.abgleich, anker_id: "test-anker", ausschnitt: { ...REZEPT, x: 81 } })).status, 400);
  assert.equal((await post(abgleichRoute, "/abgleich", { eingang: e2.abgleich, anker_id: "test-anker", ausschnitt: REZEPT }, { "sec-fetch-site": "cross-site" })).status, 403);
  const signatur = await hochladen({ abgleich: { bytes: Buffer.from("kein Bild, nur Text"), mime: "image/png" } });
  const r3 = await post(abgleichRoute, "/abgleich", { eingang: signatur.abgleich, anker_id: "test-anker", ausschnitt: REZEPT });
  assert.equal(r3.status, 415);
  assert.ok(!objektPfade().includes(signatur.abgleich), "auch nach einem Fehler gelöscht");
  // Anker mit gleicher Größe, anderem Inhalt → 409, ohne Abgleich (Nachbesserung mutanten-1).
  steinadel.antwort = () => new Response(ANKER_GEKIPPT, { status: 200, headers: { "content-type": "image/jpeg" } });
  const e4 = await hochladen({ abgleich: { bytes: STARTBILD, mime: "image/png" } });
  const r4 = await post(abgleichRoute, "/abgleich", { eingang: e4.abgleich, anker_id: "test-anker", ausschnitt: REZEPT });
  assert.equal(r4.status, 409, JSON.stringify(r4.body));
  assert.match(r4.body.fehler, /Anker test-anker: Live-Datei weicht vom Manifest ab.*gleiche Größe, anderer Inhalt/);
  assert.equal(r4.body.abgleich, undefined);
  assert.ok(!objektPfade().includes(e4.abgleich), "auch nach der Abweisung gelöscht");
});

// ═══ datei ═══

test("M-D1 datei: 302 auf eine signierte URL (10 min) nach dem Nachhashen; Hash weicht ab → 409 ohne URL (auch am Ende einer 15-MB-Datei)", async () => {
  assert.equal((await ganzEinspielen()).e.status, 200);
  const ok = await holeDatei(3, { "sec-fetch-site": "same-origin" });
  assert.equal(ok.status, 302);
  assert.equal(ok.kopf.get("cache-control"), "no-store");
  assert.match(ok.ort, new RegExp(`^http://supabase\\.test/storage/v1/object/sign/studio/${SLUG}/${sha(EXPORT)}\\.mp4\\?token=lese-\\d+$`));
  const signiert = welt.studio.log.filter((l) => l.op === "sign");
  assert.deepEqual(signiert.map((l) => l.expiresIn), [600]);
  // Das letzte Byte des Originals (15.000.000 B) ändern: nachgehasht wird jede Größe.
  const o = welt.studio.objekte.get(`${SLUG}/${sha(ORIGINAL)}.mp4`);
  o.bytes[o.bytes.length - 1] ^= 0xff;
  const r = await holeDatei(2);
  assert.equal(r.status, 409);
  assert.match(r.body.fehler, /Medium 2: Datei weicht von der Zeile ab/);
  assert.equal(r.ort, null);
  assert.equal(welt.studio.log.filter((l) => l.op === "sign").length, 1, "keine URL ausgestellt");
  welt.studio.objekte.delete(`${SLUG}/${sha(STARTBILD)}.png`);
  assert.equal((await holeDatei(1)).status, 409, "fehlende Datei");
});

test("M-D2 datei: fremde Herkunft → 403, unbekannte oder fremde id → 404, Kennung → 400 — jeweils ohne Storage-Abruf", async () => {
  assert.equal((await ganzEinspielen()).e.status, 200);
  const vorher = welt.studio.log.length;
  assert.equal((await holeDatei(3, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await holeDatei(3, { "sec-fetch-site": "same-site" })).status, 403);
  assert.equal((await holeDatei(99)).status, 404);
  zeilen()[2].objekt_slug = "villa-x";
  assert.equal((await holeDatei(3)).status, 404, "Medium eines anderen Objekts");
  const kaputt = await dateiRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}/medien/x/datei`), { params: Promise.resolve({ objekt: SLUG, id: "0x3" }) });
  assert.equal(kaputt.status, 400);
  assert.equal(welt.studio.log.length, vorher);
});

// ═══ Attrappe der Datenbank ═══

test("M-B1 Attrappe der DB: Insert mit id oder eingespielt_am → 42501; ohne Service-Schlüssel → 42501; Kosten an Startbild oder Export → 23514; UPDATE/DELETE gesperrt", async () => {
  const service = createClient("http://supabase.test", SERVICE);
  const anon = createClient("http://supabase.test", ANON);
  const startbild = {
    objekt_slug: SLUG, art: "bild", fassung: "startbild", speicher_pfad: `${SLUG}/${"a".repeat(64)}.png`, sha256: "a".repeat(64), bytes: 10, mime: "image/png",
    anker_id: "test-anker", anker_sha256: "b".repeat(64), ausschnitt: { ...REZEPT }, startbild_abgleich: "bestanden",
  };
  for (const extra of [{ id: 7 }, { eingespielt_am: "2020-01-01T00:00:00Z" }, { startbild_ziel: "startbild" }]) {
    const r = await service.from("studio_medium").insert({ ...startbild, ...extra });
    assert.equal(r.error?.code, "42501", JSON.stringify(extra));
  }
  assert.equal((await anon.from("studio_medium").insert(startbild)).error?.code, "42501");
  assert.equal((await anon.from("studio_medium").select("*")).error?.code, "42501");
  assert.equal((await service.from("studio_medium").insert({ ...startbild, kosten_credits: 1, kosten_quelle: "x" })).error?.code, "23514");
  assert.equal((await service.from("studio_medium").insert({ ...startbild, speicher_pfad: `${SLUG}/${"a".repeat(64)}.jpeg` })).error?.code, "23514");
  const ok = await service.from("studio_medium").insert(startbild).select("id, eingespielt_am").single();
  assert.equal(ok.error, null);
  assert.equal((await service.from("studio_medium").insert(startbild)).error?.code, "23505");
  const exportZeile = { ...startbild, art: "video", fassung: "export", mime: "video/mp4", sha256: "c".repeat(64), speicher_pfad: `${SLUG}/${"c".repeat(64)}.mp4`, ausschnitt: null, startbild_abgleich: null, abgeleitet_von: ok.data.id };
  assert.equal((await service.from("studio_medium").insert({ ...exportZeile, kosten_credits: 1, kosten_quelle: "x" })).error?.code, "23514");
  assert.equal((await service.from("studio_medium").insert(exportZeile)).error?.code, "23503", "Export auf ein Startbild statt ein Original");
  assert.equal((await service.from("studio_medium").update({ bytes: 11 }).eq("id", ok.data.id)).error?.code, "42501");
  assert.equal((await service.from("studio_medium").delete().eq("id", ok.data.id)).error?.code, "42501");
});

// ═══ GET /api/studio/[objekt]: Medien, Credits, Messplan ═══

test("M-R1 Studio: Credits = Summe der Originale (6,5), Deckel 100, Rest 93,5 — getrennt von USD; Medien-Kette vollständig", async () => {
  assert.equal((await ganzEinspielen()).e.status, 200);
  const s = await holeStudio();
  assert.deepEqual(s.kosten_credits.wert, { summe: 6.5, deckel: 100, rest: 93.5, originale: 1, originale_ohne_angabe: 0 });
  assert.equal(s.kosten_credits.status, "ok");
  assert.ok(Date.parse(s.kosten_credits.gemessen_am) > 0);
  assert.equal(s.medien.status, "ok", s.medien.hinweis);
  assert.equal(s.medien.wert.ketten.length, 1);
  const k = s.medien.wert.ketten[0];
  assert.deepEqual([k.export.id, k.original.id, k.startbild.id], [3, 2, 1]);
  assert.deepEqual(k.luecken, []);
  // USD (Weg 2b) eines weiteren Originals zählt nie in die Credits; Kosten an einer Nicht-Original-Zeile (an der
  // Datenbank vorbei eingetragen) werden nicht summiert, der Teil warnt.
  zeilen().push({ ...zeilen()[1], id: 10, sha256: "f".repeat(64), speicher_pfad: `${SLUG}/${"f".repeat(64)}.mp4`, erzeuger: "higgsfield-api", kosten_credits: null, kosten_vorschau_credits: null, kosten_usd: 0.42 });
  zeilen().push({ ...zeilen()[2], id: 11, sha256: "9".repeat(64), speicher_pfad: `${SLUG}/${"9".repeat(64)}.mp4`, kosten_credits: 5, kosten_quelle: "falsch" });
  // Trägt ein Connector-Original an der Datenbank vorbei auch USD, zählen nur seine Credits (Mutant X6).
  zeilen().push({ ...zeilen()[1], id: 12, sha256: "8".repeat(64), speicher_pfad: `${SLUG}/${"8".repeat(64)}.mp4`, kosten_credits: 1.5, kosten_vorschau_credits: 1.5, kosten_usd: 0.42 });
  const w = await holeStudio();
  assert.equal(w.kosten_credits.wert.summe, 8, "6,5 + 1,5 Credits, ohne die 0,42 USD");
  assert.equal(w.kosten_credits.wert.originale, 3);
  assert.equal(w.kosten_credits.wert.originale_ohne_angabe, 1);
  assert.equal(w.kosten_credits.status, "warnung");
  assert.match(w.kosten_credits.hinweis, /2 Original\(e\) mit USD-Kosten \(Weg 2b\) — nicht in den Credits/);
  assert.match(w.kosten_credits.hinweis, /1 Zeile\(n\) außer Originalen mit Credits — nicht summiert/);
});

test("M-R2 Studio: Messplan-Tabelle fehlt → „nicht angelegt“ (nie 0, nie fehler); leer → „noch kein Eintrag (Schritt 11)“; regel nach dem Fensterstart → Abweichung", async () => {
  welt.studio.messplanFehlt = true;
  const fehlt = (await holeStudio()).messung;
  assert.deepEqual(fehlt.wert, { art: "nicht_angelegt", code: "PGRST205" });
  assert.equal(fehlt.status, "nicht_gemessen");
  assert.match(fehlt.hinweis, /nicht angelegt \(PGRST205\)/);
  welt.studio.messplanFehlt = false;
  // Postgres meldet eine fehlende Tabelle als 42P01 (je nach Schema-Cache statt PGRST205): ebenso „nicht angelegt“ (Mutant X7b).
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_messplan" ? { status: 404, body: { code: "42P01", details: null, hint: null, message: 'relation "public.studio_messplan" does not exist' } } : null);
  try {
    const p01 = (await holeStudio()).messung;
    assert.deepEqual(p01.wert, { art: "nicht_angelegt", code: "42P01" });
    assert.match(p01.hinweis, /nicht angelegt \(42P01\)/);
  } finally {
    welt.stoerung = null;
  }
  const { tabelleFehltCode } = await lade("src/lib/studio/messplan.ts");
  assert.deepEqual([tabelleFehltCode({ code: "42P01" }), tabelleFehltCode({ code: "PGRST205" }), tabelleFehltCode({ code: "42501" })], ["42P01", "PGRST205", null]);
  const leer = (await holeStudio()).messung;
  assert.deepEqual(leer.wert, { art: "leer" });
  assert.equal(leer.hinweis, "noch kein Eintrag (Schritt 11)");
  const zeile = (id, eintrag, fest, extra = {}) => ({ id, objekt_slug: SLUG, eintrag, von: null, bis: null, werte: { schwelle: 2 }, abfrage: null, gemessen_am: null, quelle: "Test", festgeschrieben_am: fest, ...extra });
  welt.tabellen.studio_messplan = [
    zeile(1, "regel", "2026-11-20T10:00:00.000000+00:00"),
    zeile(2, "regel", "2026-11-21T10:00:00.000000+00:00"),
    zeile(3, "fensterstart", "2026-11-22T10:00:00.000000+00:00", { von: "2026-11-22T00:00:00+00:00" }),
    zeile(4, "regel", "2026-11-23T10:00:00.000000+00:00"),
    zeile(5, "zwischenstand", "2026-11-29T10:00:00.000000+00:00"),
    zeile(6, "fensterstart", "2026-11-30T10:00:00.000000+00:00", { von: "2026-12-01T00:00:00+00:00" }),
    zeile(7, "regel", "2026-11-01T10:00:00.000000+00:00", { objekt_slug: "villa-x" }),
  ];
  const m = (await holeStudio()).messung;
  assert.equal(m.status, "warnung");
  assert.equal(m.wert.fensterstart, "2026-11-22T00:00:00.000Z");
  assert.deepEqual(m.wert.zeilen.map((z) => [z.id, z.lage]), [[1, "abgeloest"], [2, "gilt"], [3, "gilt"], [4, "abweichung"], [5, "gilt"], [6, "abweichung"]]);
  assert.equal(m.wert.abweichungen, 2);
});

test("M-R3 Studio: unlesbare Medien-Zeile → Teil medien und Credits „fehler“, nie eine halbe Liste; GET liest den Storage nicht", async () => {
  assert.equal((await ganzEinspielen()).e.status, 200);
  const vorher = welt.studio.log.length;
  zeilen()[1].bytes = "viele";
  const s = await holeStudio();
  assert.equal(s.medien.status, "fehler");
  assert.equal(s.medien.wert, null);
  assert.match(s.medien.hinweis, /Medium 2: bytes unlesbar/);
  assert.equal(s.kosten_credits.status, "fehler");
  assert.equal(s.kosten_credits.wert, null);
  assert.equal(welt.studio.log.length, vorher, "kein Storage-Aufruf beim Seitenaufbau");
});

test("M-R4 Studio-Kette nur innerhalb des Objekts und der Fassung: Export auf ein Startbild, Original oder Startbild eines anderen Objekts, Original auf ein Original → Lücke statt Kettenglied", async () => {
  assert.equal((await ganzEinspielen()).e.status, 200);
  const lesen = await lade("src/lib/studio/lesen.ts");
  const [sb, og, ex] = zeilen().map((z) => lesen.leseMediumZeile(z));
  const kette = (liste) => lesen.medienKetten(liste).ketten[0];
  const ganz = kette([sb, og, ex]);
  assert.deepEqual([ganz.original?.id, ganz.startbild?.id, ganz.luecken], [og.id, sb.id, []]);
  const faelle = [
    [[sb, og, { ...ex, abgeleitet_von: sb.id }], "original", `Original ${sb.id} nicht gefunden`],
    [[sb, { ...og, objekt_slug: "villa-x" }, ex], "original", `Original ${og.id} nicht gefunden`],
    [[{ ...sb, objekt_slug: "villa-x" }, og, ex], "startbild", `Startbild ${sb.id} nicht gefunden`],
    [[sb, { ...og, startbild_id: og.id }, ex], "startbild", `Startbild ${og.id} nicht gefunden`],
  ];
  for (const [liste, glied, luecke] of faelle) {
    const k = kette(liste);
    assert.equal(k[glied], null, luecke);
    assert.deepEqual(k.luecken, [luecke]);
    assert.equal(k.urteil.freigebbar, false);
  }
});

test("M-F1 Frist für Storage-Aufrufe: jede Anfrage der Medien-Routen an den Storage trägt ein Abbruchsignal; fetchMitFrist bricht eine hängende Anfrage ab und lässt ein eigenes Signal stehen", async () => {
  legeObjektAn(welt.studio, "eingang/00000001-0000-4000-8000-000000000001.png", Buffer.from("alt"), { alterMs: 3 * 3_600_000 });
  assert.equal((await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "export", bytes: 1, mime: "video/mp4" }] })).status, 200);
  assert.equal((await ganzEinspielen()).e.status, 200);
  const g = await hochladen({ abgleich: { bytes: STARTBILD, mime: "image/png" } });
  assert.equal((await post(abgleichRoute, "/abgleich", { eingang: g.abgleich, anker_id: "test-anker", ausschnitt: REZEPT })).status, 200);
  assert.equal((await holeDatei(3)).status, 302);
  // upload ist der PUT des Browsers auf die signierte URL — kein Aufruf des Service-Clients.
  const server = welt.studio.signale.filter((s) => s.op !== "upload");
  const arten = new Set(server.map((s) => s.op));
  for (const op of ["sign_upload", "list", "remove", "move", "download", "sign"]) assert.ok(arten.has(op), `${op} kam vor`);
  assert.deepEqual(server.filter((s) => !(s.signal instanceof AbortSignal)).map((s) => s.op), [], "jede Storage-Anfrage des Servers mit Signal");
  assert.equal(ablage.STORAGE_TIMEOUT_MS, 15_000);
  const vorher = globalThis.fetch;
  try {
    let gesehen = null;
    globalThis.fetch = (input, init) => {
      gesehen = init?.signal ?? null;
      return new Promise((_, nein) => init?.signal?.addEventListener("abort", () => nein(init.signal.reason)));
    };
    const t0 = Date.now();
    await assert.rejects(() => ablage.fetchMitFrist(30)("http://supabase.test/storage/v1/object/move", { method: "POST" }), (e) => e?.name === "TimeoutError");
    assert.ok(Date.now() - t0 < 2_000, "bricht nach der Frist ab");
    assert.ok(gesehen instanceof AbortSignal);
    const eigenes = new AbortController();
    globalThis.fetch = async (input, init) => {
      gesehen = init?.signal;
      return new Response("{}");
    };
    await ablage.fetchMitFrist(30)("http://supabase.test/x", { signal: eigenes.signal });
    assert.equal(gesehen, eigenes.signal, "ein eigenes Signal bleibt (Download mit 120 s)");
  } finally {
    globalThis.fetch = vorher;
  }
});

test("M-F2 Gekappte Listen: Medienliste gekappt → Credits „warnung“ (Summe Untergrenze); Messplan mit 500 Einträgen → „fehler“ statt vollständig", async () => {
  assert.equal((await ganzEinspielen()).e.status, 200);
  const lesen = await lade("src/lib/studio/lesen.ts");
  const gekappt = lesen.medienAusZeilen(zeilen(), "2026-11-10T15:00:00.000Z", true);
  assert.equal(gekappt.wert.abgeschnitten, true);
  const c = lesen.creditsAusMedien(gekappt);
  assert.equal(c.status, "warnung");
  assert.match(c.hinweis, /^Medienliste gekappt — Summe ist Untergrenze, Rest Obergrenze/);
  const voll = lesen.medienAusZeilen(zeilen(), "2026-11-10T15:00:00.000Z", false);
  assert.equal(voll.wert.abgeschnitten, false);
  assert.equal(lesen.creditsAusMedien(voll).status, "ok");
  const zeit = (i) => new Date(Date.UTC(2026, 10, 20, 10) + i * 1000).toISOString().replace("Z", "000+00:00");
  const eintrag = (i) => ({ id: i, objekt_slug: SLUG, eintrag: "regel", von: null, bis: null, werte: { schwelle: 2 }, abfrage: null, gemessen_am: null, quelle: "Test", festgeschrieben_am: zeit(i) });
  welt.tabellen.studio_messplan = Array.from({ length: 500 }, (_, i) => eintrag(i + 1));
  const m = (await holeStudio()).messung;
  assert.equal(m.status, "fehler");
  assert.equal(m.wert, null);
  assert.match(m.hinweis, /^500 oder mehr Einträge — nicht vollständig gelesen/);
  assert.ok(welt.log.some((l) => l.tabelle === "studio_messplan" && l.query.includes("limit=500")));
  welt.tabellen.studio_messplan = welt.tabellen.studio_messplan.slice(0, 499);
  assert.equal((await holeStudio()).messung.status, "ok");
});

test("M-F3 Beleg: Die API rechnet nur in USD (Credits → 400), der Connector nur in Credits; Signatur: ftyp-Marken von QuickTime, HEIF/AVIF und M4A sind kein MP4", () => {
  const api = medien.pruefeBeleg(beleg({ erzeuger: "higgsfield-api", kosten_usd: 0.42 }));
  assert.equal(api.ok, false);
  assert.match(api.grund, /nur für higgsfield-connector; die API rechnet in USD/);
  const apiUsd = medien.pruefeBeleg(beleg({ erzeuger: "higgsfield-api", kosten_usd: 0.42, kosten_credits: null, kosten_vorschau_credits: null }));
  assert.equal(apiUsd.ok, true, apiUsd.grund);
  const kopf = (marke) => {
    const b = Buffer.alloc(16);
    b.writeUInt32BE(24, 0);
    b.write(`ftyp${marke}`, 4, "latin1");
    return new Uint8Array(b);
  };
  for (const m of ["isom", "mp42", "mp41", "avc1", "iso5", "dash"]) assert.equal(medien.mimeAusSignatur(kopf(m)), "video/mp4", m);
  for (const m of ["qt  ", "heic", "mif1", "avif", "M4A "]) assert.equal(medien.mimeAusSignatur(kopf(m)), null, m);
  assert.equal(medien.mimeAusSignatur(kopf("isom").subarray(0, 10)), null, "zu kurz für die Marke");
});

// ═══ Medien-Panel gegen die echten Routen ═══

test("M-K1 Medien-Panel (ladeHoch, pruefen, einspielen) gegen die echten Routen: PUT auf die signierte URL, Vorschau zurück, Einspielen; Abweisung mit Feldliste lesbar", async () => {
  const { React, jsxRuntime } = await import("./harness/tsx.mjs");
  const { ladeStudioBausteine } = await import("./harness/studio.mjs");
  const regeln = await import("../src/lib/freigabe-regeln.ts");
  const counsel = await import("../src/lib/counsel-urteil.ts");
  const P = ladeStudioBausteine({ react: React, "react/jsx-runtime": jsxRuntime, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }).medien;
  const browser = [];
  /** fetch des Browsers: eigene Routen im Prozess (same-origin), alles andere an die Attrappen. */
  const holen = async (url, init = {}) => {
    browser.push([init.method ?? "GET", url.startsWith("/") ? url : new URL(url).pathname]);
    if (!url.startsWith("/")) return fetch(url, init);
    const route = url.endsWith("/upload-url") ? uploadRoute : url.endsWith("/abgleich") ? abgleichRoute : medienRoute;
    const req = new NextRequest(`http://harness.local${url}`, { method: init.method, headers: { ...init.headers, "sec-fetch-site": "same-origin", cookie: "gp-auth=test" }, body: init.body });
    return route.POST(req, { params: Promise.resolve({ objekt: SLUG }) });
  };
  const datei = (bytes, name, type) => new File([bytes], name, { type });
  const dateien = [
    { rolle: "startbild", datei: datei(STARTBILD, "start.png", "image/png"), mime: "image/png" },
    { rolle: "original", datei: datei(ORIGINAL, "original.mp4", "video/mp4"), mime: "video/mp4" },
    { rolle: "export", datei: datei(EXPORT, "export.mp4", ""), mime: P.mimeFuerDatei({ name: "export.mp4", type: "" }) },
  ];
  assert.equal(dateien[2].mime, "video/mp4", "MIME aus der Endung, wenn der Browser keinen nennt");
  const meldungen = [];
  const hoch = await P.ladeHoch(SLUG, dateien, holen, (m) => meldungen.push(m));
  assert.equal(hoch.art, "ok", JSON.stringify(hoch));
  assert.ok(meldungen.some((m) => m.startsWith("Original hochladen (15 MB)")), meldungen.join(" | "));
  assert.ok(meldungen.some((m) => m.startsWith("Original hochladen: 15 MB von 15 MB (100 %)")), "Fortschritt je Datei (Nachbesserung oberflaeche-2)");
  const puts = browser.filter(([m]) => m === "PUT");
  assert.equal(puts.length, 3);
  assert.ok(puts.every(([, p]) => p.startsWith("/storage/v1/object/upload/sign/studio/eingang/")), JSON.stringify(puts));
  assert.ok(!browser.some(([m, p]) => m !== "PUT" && p.startsWith("/storage/")), "der Browser ruft den Storage nur per PUT auf die signierte URL");
  const v = await P.pruefen(SLUG, hoch.eingang, beleg(), holen);
  assert.equal(v.art, "vorschau", JSON.stringify(v).slice(0, 300));
  assert.equal(v.abgleich.urteil, "bestanden");
  assert.equal(P.abgleichText(v.abgleich), "bestanden — größte Abweichung 0 (Toleranz 2)");
  const e = await P.einspielen(SLUG, hoch.eingang, beleg(), v, holen);
  assert.equal(e.art, "eingespielt", JSON.stringify(e));
  assert.deepEqual(e.zeilen.map((z) => [z.rolle, z.id, z.wiederverwendet]), [["startbild", 1, false], ["original", 2, false], ["export", 3, false]]);
  // Noch einmal dieselben Dateien: Abweisung „vorhanden“ mit ids, lesbar fürs Panel.
  const hoch2 = await P.ladeHoch(SLUG, dateien, holen);
  const v2 = await P.pruefen(SLUG, hoch2.eingang, beleg(), holen);
  const e2 = await P.einspielen(SLUG, hoch2.eingang, beleg(), v2, holen);
  assert.equal(e2.art, "abgewiesen");
  assert.equal(e2.httpStatus, 409);
  assert.deepEqual(e2.vorhanden, { startbild: 1, original: 2, export: 3 });
  // Veraltete Vorschau: Feldliste lesbar.
  const hoch3 = await P.ladeHoch(SLUG, dateien, holen);
  const v3 = await P.pruefen(SLUG, hoch3.eingang, beleg(), holen);
  const e3 = await P.einspielen(SLUG, hoch3.eingang, beleg({ modell: "anderes-modell" }), v3, holen);
  assert.equal(e3.art, "abgewiesen");
  assert.deepEqual(e3.felder, ["original.modell"]);
  assert.match(e3.text, /^Vorschau veraltet: .*\(HTTP 409\)$/);
  // Abgleich ohne Zeile über das Panel.
  const ha = await P.ladeHoch(SLUG, [{ rolle: "abgleich", datei: datei(STARTBILD, "a.png", "image/png"), mime: "image/png" }], holen);
  const a = await P.abgleichen(SLUG, ha.eingang.abgleich, "test-anker", { x: REZEPT.x, y: REZEPT.y, breite: REZEPT.breite, hoehe: REZEPT.hoehe }, holen);
  assert.equal(a.art, "abgleich", JSON.stringify(a));
  assert.equal(a.abgleich.abweichung_max, 0);
  assert.ok(a.speicher.max_rss_kib > 0);
  // Auswahl-Prüfung im Browser (Bedienhilfe; maßgeblich ist der Server).
  assert.deepEqual(P.auswahlFehler({ startbild: null, original: datei(ORIGINAL, "o.mp4", "video/mp4"), export: datei(STARTBILD, "e.png", "image/png"), beleg: null }), [
    "Startbild fehlt",
    "Export: Dateityp image/png passt nicht",
    "Beleg (JSON) fehlt",
  ]);
});

// ═══ Medien-Panel als Bauteil (Hook-Laufzeit) gegen die echten Routen — Nachbesserung oberflaeche-1, -2, -5, -6, -8, -9, mutanten-6 ═══

/** Knoten im aufgelösten Baum (Tiefensuche) bzw. alle passenden. */
function findeAlle(k, pred, aus = []) {
  if (Array.isArray(k)) for (const c of k) findeAlle(c, pred, aus);
  else if (k && typeof k === "object") {
    if (pred(k)) aus.push(k);
    findeAlle(k.kinder, pred, aus);
  }
  return aus;
}
const findeEinen = (k, pred) => findeAlle(k, pred)[0] ?? null;
/** Sichtbarer Text eines Teilbaums. */
function textVon(k) {
  if (Array.isArray(k)) return k.map(textVon).join("");
  if (k === null || k === undefined || typeof k === "boolean") return "";
  if (typeof k !== "object") return String(k);
  return textVon(k.kinder);
}

/**
 * Medien-Panel in der Hook-Laufzeit; holen leitet eigene Routen an die echten Handler, alles andere (PUT auf die signierte
 * URL) an die Storage-Attrappe. tor: optionale Sperre vor dem PUT einer Rolle (respektiert das Abbruchsignal).
 */
async function panelLaufzeit() {
  const { jsxRuntime } = await import("./harness/tsx.mjs");
  void jsxRuntime;
  const { ladeStudioBausteine, hookLaufzeit } = await import("./harness/studio.mjs");
  const regeln = await import("../src/lib/freigabe-regeln.ts");
  const counsel = await import("../src/lib/counsel-urteil.ts");
  const lz = hookLaufzeit();
  const P = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }).medien;
  const log = [];
  const tore = new Map();
  const holen = async (url, init = {}) => {
    const methode = init.method ?? "GET";
    log.push([methode, url.startsWith("/") ? url : new URL(url).pathname, init.body && typeof init.body === "string" ? JSON.parse(init.body) : null]);
    if (!url.startsWith("/")) {
      const pfad = new URL(url).pathname;
      const rolle = [...tore.keys()].find((r) => pfad.includes(r));
      if (rolle !== undefined) {
        await new Promise((ja, nein) => {
          tore.get(rolle).oeffnen = ja;
          init.signal?.addEventListener("abort", () => nein(init.signal.reason ?? new DOMException("Abgebrochen", "AbortError")), { once: true });
        });
      }
      return fetch(url, init);
    }
    const route = url.endsWith("/upload-url") ? uploadRoute : url.endsWith("/abgleich") ? abgleichRoute : medienRoute;
    const req = new NextRequest(`http://harness.local${url}`, { method: methode, headers: { ...init.headers, "sec-fetch-site": "same-origin", cookie: "gp-auth=test" }, body: init.body });
    return route.POST(req, { params: Promise.resolve({ objekt: SLUG }) });
  };
  const s = await holeStudio();
  let neu = 0;
  lz.setzeWurzel(P.MedienPanel, { slug: SLUG, medien: s.medien, credits: s.kosten_credits, neuLaden: () => (neu += 1), holen });
  const baum = () => lz.rendere();
  return { lz, P, holen, log, tore, baum, neuGeladen: () => neu };
}

const alsDatei = (bytes, name, type) => new File([bytes], name, { type });
const BELEG_DATEI = () => alsDatei(Buffer.from(JSON.stringify(beleg())), "beleg.json", "application/json");

/** Dateien im Panel wählen (wie der Browser: onChange mit FileList). */
function waehleDateien(t, dateien) {
  for (const [feld, datei] of Object.entries(dateien)) {
    const input = findeEinen(t.baum(), (n) => n.type === "input" && n.props["data-dateiwahl"] === feld);
    input.props.onChange({ currentTarget: { files: datei === null ? [] : [datei] } });
  }
}
const knopf = (t, attr) => findeEinen(t.baum(), (n) => n.type === "button" && n.props[attr] !== undefined);
const einspielStand = (t) => findeEinen(t.baum(), (n) => n.type === "details" && n.props["data-einspielen"] !== undefined).props["data-einspielen"];

test("M-K2 Panel: Während des Laufs sind Dateiwahl und Knopf gesperrt; „Abbrechen“ da; die Vorschau nennt die Dateien; ohne Häkchen kein Einspielen, mit Häkchen genau eine Anfrage (Nachbesserung oberflaeche-1, mutanten-6)", async () => {
  const t = await panelLaufzeit();
  t.tore.set("eingang/", {});
  waehleDateien(t, { startbild: alsDatei(STARTBILD, "start.png", "image/png"), original: alsDatei(ORIGINAL, "original.mp4", "video/mp4"), export: alsDatei(EXPORT, "export.mp4", "video/mp4"), beleg: BELEG_DATEI() });
  knopf(t, "data-pruefen-knopf").props.onClick();
  await binnen((async () => { while (!t.tore.get("eingang/").oeffnen) await new Promise((r) => setImmediate(r)); })(), 5_000, "PUT am Tor");
  t.lz.rendere();
  assert.equal(einspielStand(t), "laeuft");
  const eingaben = findeAlle(t.baum(), (n) => n.type === "input" && ["startbild", "original", "export", "beleg"].includes(n.props["data-dateiwahl"]));
  assert.deepEqual(eingaben.map((n) => n.props.disabled), [true, true, true, true], "Dateiwahl gesperrt");
  assert.equal(knopf(t, "data-pruefen-knopf").props["aria-disabled"], true);
  assert.ok(knopf(t, "data-einspielen-abbrechen"), "Abbrechen während Upload und Prüflauf");
  // Tor öffnen (und für die übrigen PUTs entfernen): Der Rest läuft durch bis zur Vorschau.
  const tor = t.tore.get("eingang/");
  t.tore.delete("eingang/");
  tor.oeffnen();
  await binnen((async () => { for (let i = 0; i < 400 && einspielStand(t) !== "vorschau"; i += 1) await t.lz.ruhe(2); })(), 10_000, "Vorschau");
  assert.equal(einspielStand(t), "vorschau");
  const fuer = textVon(findeEinen(t.baum(), (n) => n.props?.["data-vorschau-fuer"] !== undefined));
  assert.match(fuer, /Startbild „start\.png“ \(127 kB\) · Original „original\.mp4“ \(15 MB\) · Export „export\.mp4“ \(650 kB\) · Beleg „beleg\.json“/);
  // Ohne Häkchen: kein Einspielen (mutanten-6, X58).
  const vorher = t.log.length;
  knopf(t, "data-einspielen-knopf").props.onClick();
  await t.lz.ruhe(5);
  assert.ok(!t.log.slice(vorher).some(([m, , b]) => m === "POST" && b?.bestaetigt), "kein POST mit bestaetigt ohne Häkchen");
  assert.equal(einspielStand(t), "vorschau");
  // Mit Häkchen: genau eine Anfrage, drei Zeilen.
  findeEinen(t.baum(), (n) => n.type === "input" && n.props["data-bestaetigen"] !== undefined).props.onChange({ currentTarget: { checked: true } });
  knopf(t, "data-einspielen-knopf").props.onClick();
  await binnen((async () => { for (let i = 0; i < 400 && einspielStand(t) !== "fertig"; i += 1) await t.lz.ruhe(2); })(), 10_000, "Einspielen");
  assert.equal(t.log.slice(vorher).filter(([m, , b]) => m === "POST" && b?.bestaetigt).length, 1);
  assert.equal(zeilen().length, 3);
  assert.equal(t.neuGeladen(), 1);
});

test("M-K3 Panel: Ein veralteter Lauf setzt keinen Stand; Abbrechen und Abbau beenden Upload und Prüflauf (kein POST …/medien danach); Frist ohne Daten; Fortschritt in Prozent (Nachbesserung oberflaeche-1, -2)", async () => {
  // (a) Auswahl während des Laufs geändert (Sperre umgangen): Der alte Lauf läuft ins Leere — keine alte Vorschau.
  const t = await panelLaufzeit();
  t.tore.set("eingang/", {});
  const dateien = { startbild: alsDatei(STARTBILD, "start.png", "image/png"), original: alsDatei(ORIGINAL, "original.mp4", "video/mp4"), export: alsDatei(EXPORT, "export.mp4", "video/mp4"), beleg: BELEG_DATEI() };
  waehleDateien(t, dateien);
  knopf(t, "data-pruefen-knopf").props.onClick();
  await binnen((async () => { while (!t.tore.get("eingang/").oeffnen) await new Promise((r) => setImmediate(r)); })(), 5_000, "PUT am Tor");
  waehleDateien(t, { beleg: alsDatei(Buffer.from(JSON.stringify(beleg({ modell: "anderes-modell" }))), "beleg-2.json", "application/json") });
  assert.equal(einspielStand(t), "bereit");
  await t.lz.ruhe(20);
  assert.equal(einspielStand(t), "bereit", "der alte Lauf setzt keine Vorschau");
  assert.ok(!t.log.some(([m, u, b]) => m === "POST" && u.endsWith("/medien") && b?.nur_pruefen), "kein Prüflauf des alten Laufs");
  // (b) Abbrechen während des Uploads: Abbruch-Hinweis, kein Prüflauf.
  const t2 = await panelLaufzeit();
  t2.tore.set("eingang/", {});
  waehleDateien(t2, dateien);
  knopf(t2, "data-pruefen-knopf").props.onClick();
  await binnen((async () => { while (!t2.tore.get("eingang/").oeffnen) await new Promise((r) => setImmediate(r)); })(), 5_000, "PUT am Tor");
  knopf(t2, "data-einspielen-abbrechen").props.onClick();
  await t2.lz.ruhe(20);
  assert.equal(einspielStand(t2), "fehler");
  const fehler = textVon(findeEinen(t2.baum(), (n) => n.props?.["data-medien-fehler"] !== undefined));
  assert.match(fehler, /Abgebrochen — kein weiterer Schritt dieses Laufs\./);
  assert.match(fehler, /bleiben bis zu 2 h im Eingang/);
  assert.ok(!t2.log.some(([m, u]) => m === "POST" && u.endsWith("/medien")), "kein Prüflauf nach dem Abbruch");
  // (c) Seite verlassen (Abbau) während des Uploads: kein weiterer PUT, kein Prüflauf.
  const t3 = await panelLaufzeit();
  t3.tore.set("eingang/", {});
  waehleDateien(t3, dateien);
  knopf(t3, "data-pruefen-knopf").props.onClick();
  await binnen((async () => { while (!t3.tore.get("eingang/").oeffnen) await new Promise((r) => setImmediate(r)); })(), 5_000, "PUT am Tor");
  const puts = () => t3.log.filter(([m]) => m === "PUT").length;
  const putsVorher = puts();
  t3.lz.abbauen();
  await t3.lz.ruhe(20);
  assert.equal(puts(), putsVorher, "kein weiterer PUT nach dem Abbau");
  assert.ok(!t3.log.some(([m, u]) => m === "POST" && u.endsWith("/medien")), "kein Prüflauf nach dem Abbau");
  // (d) Frist: Kommen keine Daten an, bricht der Upload nach der Frist ab (hier 30 ms statt 60 s).
  const { P } = t;
  const meldungen = [];
  const haengt = (_url, _datei, _kopf, o) => new Promise((_, nein) => o.signal.addEventListener("abort", () => nein(o.signal.reason)));
  const r = await P.ladeHoch(SLUG, [{ rolle: "original", datei: alsDatei(ORIGINAL, "o.mp4", "video/mp4"), mime: "video/mp4" }], t.holen, (m) => meldungen.push(m), { senden: haengt, stillstandMs: 30 });
  assert.equal(r.art, "abgewiesen");
  assert.match(r.text, /^Upload von Original gescheitert: seit 0,03 s keine Daten übertragen — abgebrochen \(Netz\)$/);
  assert.equal(r.hinweis, P.HINWEIS_UPLOAD);
  assert.equal(P.UPLOAD_STILLSTAND_MS, 60_000);
  // (e) Fortschritt: je Prozentschritt eine Meldung; jede Meldung setzt die Frist neu.
  const schritte = (_url, datei, _kopf, o) =>
    new Promise((ja) => {
      let n = 0;
      const weiter = () => {
        n += 1;
        o.fortschritt(Math.min(datei.size, Math.round((datei.size * n) / 4)));
        if (n < 4) setTimeout(weiter, 15);
        else ja({ status: 200, text: "{}" });
      };
      setTimeout(weiter, 15);
    });
  const m2 = [];
  const ok = await P.ladeHoch(SLUG, [{ rolle: "export", datei: alsDatei(EXPORT, "e.mp4", "video/mp4"), mime: "video/mp4" }], t.holen, (m) => m2.push(m), { senden: schritte, stillstandMs: 40 });
  assert.equal(ok.art, "ok", JSON.stringify(ok));
  assert.deepEqual(m2.filter((m) => m.includes("%")), ["Export hochladen: 162,5 kB von 650 kB (25 %) …", "Export hochladen: 325 kB von 650 kB (50 %) …", "Export hochladen: 487,5 kB von 650 kB (75 %) …", "Export hochladen: 650 kB von 650 kB (100 %) …"]);
});

test("M-K4 Panel-Texte: PUT-Fehler nennt Datei und Ursache des Storage, Hinweis je Schritt; Sperre mit Zeit in Europe/Berlin und Job-Art; Credits: Rest als Obergrenze, wenn die Summe eine Untergrenze ist (Nachbesserung oberflaeche-6, -8, -9)", async () => {
  const { P } = await panelLaufzeit();
  const storageFehler = async (url, init) => (init?.method === "PUT" ? new Response(JSON.stringify({ statusCode: "403", error: "Unauthorized", message: "invalid signature" }), { status: 400, headers: { "content-type": "application/json" } }) : null);
  const holen = async (url, init = {}) => {
    const f = await storageFehler(url, init);
    if (f) return f;
    const req = new NextRequest(`http://harness.local${url}`, { method: init.method, headers: { ...init.headers, "sec-fetch-site": "same-origin", cookie: "gp-auth=test" }, body: init.body });
    return uploadRoute.POST(req, { params: Promise.resolve({ objekt: SLUG }) });
  };
  const r = await P.ladeHoch(SLUG, [{ rolle: "original", datei: alsDatei(ORIGINAL, "o.mp4", "video/mp4"), mime: "video/mp4" }], holen);
  assert.equal(r.text, "Upload von Original gescheitert: invalid signature (HTTP 400)");
  assert.equal(r.hinweis, P.HINWEIS_UPLOAD);
  // Sperre: Antwort der Route mit laeuft {art, seit} → Klartext und Berliner Zeit statt UTC und Kennung.
  const eingang = await hochladen();
  let oeffnen;
  steinadel.tor = new Promise((f) => (oeffnen = f));
  const angekommen = new Promise((f) => (steinadel.angekommen = f));
  const erster = pruefen(eingang);
  try {
    await binnen(angekommen, 5_000, "erster Job");
    const zweiter = await binnen(P.pruefen(SLUG, eingang, beleg(), async (url, init) => medienRoute.POST(new NextRequest(`http://harness.local${url}`, { method: "POST", headers: { ...init.headers, "sec-fetch-site": "same-origin", cookie: "gp-auth=test" }, body: init.body }), { params: Promise.resolve({ objekt: SLUG }) })), 5_000, "zweiter Job");
    assert.equal(zweiter.art, "abgewiesen");
    assert.match(zweiter.text, /^Ein Job \(Prüflauf\) läuft schon seit .+ \(Europe\/Berlin\) — bitte danach erneut \(HTTP 409\)$/);
    assert.doesNotMatch(zweiter.text, /\d{4}-\d{2}-\d{2}T|\(pruefen\)/, "keine UTC-Zeit, keine interne Kennung");
    assert.equal(zweiter.hinweis, P.HINWEIS_BELEGT);
  } finally {
    oeffnen();
    steinadel.tor = null;
  }
  assert.equal((await erster).status, 200);
  // Credits: Summe Untergrenze (Status warnung) → Rest höchstens.
  const c = P.creditsText({ wert: { summe: 6.5, deckel: 100, rest: 93.5, originale: 2, originale_ohne_angabe: 1 }, status: "warnung", quelle: "Test", gemessen_am: "2026-11-10T15:00:00Z", hinweis: "1 ohne Angabe" });
  assert.deepEqual(c, { wert: "≥ 6,5 Credits", unter: "Deckel 100 · Rest höchstens 93,5 · 2 Original(e) · 1 ohne Angabe" });
  assert.equal(P.creditsText({ wert: { summe: 6.5, deckel: 100, rest: 93.5, originale: 1, originale_ohne_angabe: 0 }, status: "ok", quelle: "Test", gemessen_am: "2026-11-10T15:00:00Z" }).unter, "Deckel 100 · Rest 93,5 · 1 Original(e)");
});

test("M-K5 Abgleich im Panel: Eingaben während der Messung gesperrt; das Ergebnis nennt Bild, Anker und Rezept; jede Änderung verwirft es; „Noch offen“ nennt, was fehlt (Nachbesserung oberflaeche-5)", async () => {
  const t = await panelLaufzeit();
  const abgleichStand = () => findeEinen(t.baum(), (n) => n.type === "details" && n.props["data-abgleich"] !== undefined).props["data-abgleich"];
  const offen = () => textVon(findeEinen(t.baum(), (n) => n.props?.["data-abgleich-fehlt"] !== undefined));
  assert.match(offen(), /Noch offen: Bild \(PNG oder JPEG\) · x \(ganze Zahl\) · y \(ganze Zahl\) · Breite \(ganze Zahl\) · Höhe \(ganze Zahl\)/);
  waehleDateien(t, { abgleich: alsDatei(STARTBILD, "a.png", "image/png") });
  const tippe = (k, v) => findeEinen(t.baum(), (n) => n.type === "input" && n.props["data-rezept"] === k).props.onChange({ currentTarget: { value: v } });
  for (const [k, v] of Object.entries({ x: REZEPT.x, y: REZEPT.y, breite: REZEPT.breite, hoehe: REZEPT.hoehe })) tippe(k, String(v));
  // Das Panel liest das echte Manifest (Browser-Modul); die Route hier die Test-Attrappe — also deren Anker wählen.
  findeEinen(t.baum(), (n) => n.type === "select" && n.props["data-abgleich-anker"] !== undefined).props.onChange({ currentTarget: { value: "test-anker" } });
  assert.equal(knopf(t, "data-abgleich-knopf").props["aria-disabled"], false);
  t.tore.set("eingang/", {});
  knopf(t, "data-abgleich-knopf").props.onClick();
  await binnen((async () => { while (!t.tore.get("eingang/").oeffnen) await new Promise((r) => setImmediate(r)); })(), 5_000, "PUT am Tor");
  t.lz.rendere();
  assert.equal(abgleichStand(), "laeuft");
  assert.ok(findeAlle(t.baum(), (n) => n.type === "input" && n.props["data-rezept"] !== undefined).every((n) => n.props.disabled === true), "Rezept gesperrt");
  assert.equal(findeEinen(t.baum(), (n) => n.type === "select" && n.props["data-abgleich-anker"] !== undefined).props.disabled, true, "Anker gesperrt");
  const tor = t.tore.get("eingang/");
  t.tore.delete("eingang/");
  tor.oeffnen();
  await binnen((async () => { for (let i = 0; i < 400 && abgleichStand() !== "fertig" && abgleichStand() !== "fehler"; i += 1) await t.lz.ruhe(2); })(), 10_000, "Abgleich");
  assert.equal(abgleichStand(), "fertig", textVon(findeEinen(t.baum(), (n) => n.props?.["data-medien-fehler"] !== undefined)));
  const gemessen = textVon(findeEinen(t.baum(), (n) => n.props?.["data-abgleich-gemessen"] !== undefined));
  assert.match(gemessen, /^Gemessen: Bild „a\.png“ \(320×180\) gegen Anker test-anker \(400×260, SHA-256 [0-9a-f]{16}…\) · Rezept 320×180 bei \(12, 30\)$/);
  tippe("y", "31");
  assert.equal(abgleichStand(), "bereit", "Rezept geändert → Ergebnis verworfen");
  assert.equal(findeEinen(t.baum(), (n) => n.props?.["data-abgleich-gemessen"] !== undefined), null);
});

// ═══ Niedrige Befunde der Gegenprüfung (B): Eingaben, Grenzen, Harness, Testlücken ═══

test("M-P5 Beleg (Nachbesserung ablauf7-1, sicherheit-2): U+0000 und einzelne Ersatzzeichen → 400 vor jeder Dateiarbeit; beleg.parameter höchstens 10 Ebenen und 10.000 Zeichen — auch 120.000 Ebenen ergeben 400, nicht 500", async () => {
  const e = await hochladen();
  const vorher = welt.studio.log.length;
  let tief = {};
  for (let i = 0; i < 120_000; i += 1) tief = { a: tief };
  for (const [b, muster] of [
    [beleg({ prompt: "Test-Prompt mit \u0000 darin" }), /beleg\.prompt: enthält U\+0000 oder ein einzelnes Ersatzzeichen/],
    [beleg({ ki_hinweis_text: "Hinweis \ud800 kaputt" }), /beleg\.ki_hinweis_text: enthält U\+0000/],
    [beleg({ kosten_quelle: "Quelle\u0000" }), /beleg\.kosten_quelle: enthält U\+0000/],
    [beleg({ hinweise: { export: ["Hinweis \udc00"] } }), /hinweise\.export: enthält U\+0000/],
    [beleg({ prompt_klauseln: [{ id: "licht", text: "Licht\u0000" }] }), /beleg\.prompt_klauseln\.licht: enthält U\+0000/],
    [beleg({ parameter: { stufe: "a\u0000b" } }), /beleg\.parameter: enthält U\+0000/],
    [beleg({ parameter: { ["schlüssel\ud800"]: 1 } }), /beleg\.parameter: Schlüssel enthält U\+0000/],
    [beleg({ parameter: { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: 1 } } } } } } } } } } } }), /beleg\.parameter: höchstens 10 Ebenen/],
    [beleg({ parameter: tief }), /beleg\.parameter: höchstens 10 Ebenen/],
    [beleg({ parameter: { lang: "x".repeat(10_001) } }), /beleg\.parameter: höchstens 10\.000 Zeichen als JSON/],
  ]) {
    const r = await pruefen(e, b);
    assert.equal(r.status, 400, muster.source);
    assert.match(r.body.fehler, muster);
  }
  assert.equal((await pruefen(e, beleg({ parameter: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } } }))).status, 200, "10 Ebenen gehen");
  assert.deepEqual(ops(vorher).filter((o) => o !== "download" && o !== "list"), [], "die abgewiesenen Belege ohne Dateiarbeit");
  assert.ok(medien.speicherbarerText("Umlaute äöü und 😀 sind speicherbar"));
  assert.equal(medien.speicherbarerText("a\u0000"), false);
  assert.equal(medien.speicherbarerText("\ud83d"), false);
});

test("M-G2 Pixelgrenze (Nachbesserung sicherheit-2): Ein Bild über 40 Mio. Bildpunkten → 413 mit Grund statt 500 „programmfehler“ — im Abgleich und im Prüflauf (Text je Modus)", async () => {
  // 6400 × 6400 = 40,96 Mio. Bildpunkte, als Palette-PNG nur rund 40 kB (gemessen lokal: 39.973 B).
  const riesig = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png({ compressionLevel: 9, palette: true }).toBuffer();
  const g = await hochladen({ abgleich: { bytes: riesig, mime: "image/png" } });
  const r = await post(abgleichRoute, "/abgleich", { eingang: g.abgleich, anker_id: "test-anker", ausschnitt: REZEPT });
  assert.equal(r.status, 413, JSON.stringify(r.body));
  assert.equal(r.body.fehler_art, "zu_gross");
  assert.match(r.body.fehler, /^Abgleich nicht möglich: Bild über 40\.000\.000 Bildpunkten — Grenze des Abgleichs$/);
  const dateien = { ...DATEIEN, startbild: { bytes: riesig, mime: "image/png" } };
  const e = await hochladen(dateien);
  const p = await pruefen(e, beleg({}, dateien));
  assert.equal(p.status, 413, JSON.stringify(p.body));
  assert.match(p.body.fehler, /^Prüflauf nicht möglich: Bild über 40\.000\.000 Bildpunkten/);
});

test("M-U3 upload-url räumt nicht auf, solange ein Job läuft (Mutant X40): alte Reste bleiben, aufgeraeumt ist null", async () => {
  const eingang = await hochladen();
  const alt = "eingang/00000009-0000-4000-8000-000000000009.png";
  let oeffnen;
  steinadel.tor = new Promise((f) => (oeffnen = f));
  const angekommen = new Promise((f) => (steinadel.angekommen = f));
  const erster = pruefen(eingang);
  try {
    await binnen(angekommen, 5_000, "erster Job");
    // Erst jetzt anlegen: Der erste Job räumt beim Start selbst auf (vor dem Anker-Abruf, an dem er wartet).
    legeObjektAn(welt.studio, alt, Buffer.from("alt"), { alterMs: 3 * 3_600_000 });
    const r = await binnen(post(uploadRoute, "/upload-url", { dateien: [{ rolle: "export", bytes: 1, mime: "video/mp4" }] }), 5_000, "upload-url");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.aufgeraeumt, null, "während eines Jobs kein Aufräumen");
    assert.ok(objektPfade().includes(alt), "der alte Rest bleibt");
  } finally {
    oeffnen();
    steinadel.tor = null;
  }
  assert.equal((await erster).status, 200);
});

test("M-P6 Endung je Rolle im Eingangspfad (Mutant X57): Startbild mit .mp4 oder Original mit .png → 400 vor Sperre, Anker-Abruf und Dateiarbeit", async () => {
  const e = await hochladen();
  const vorher = welt.studio.log.length;
  for (const eingang of [{ ...e, startbild: "eingang/00000001-0000-4000-8000-000000000001.mp4" }, { ...e, original: "eingang/00000002-0000-4000-8000-000000000002.png" }]) {
    const r = await post(medienRoute, "", { eingang, beleg: beleg(), nur_pruefen: true });
    assert.equal(r.status, 400, JSON.stringify(eingang));
  }
  assert.equal(steinadel.abrufe, 0, "kein Anker-Abruf");
  assert.deepEqual(ops(vorher), [], "keine Dateiarbeit");
});

test("M-J1 JSON-Körper (Mutant X52): Kündigt Content-Length mehr als 1 MB an, wird der Körper gar nicht gelesen", async () => {
  let gelesen = false;
  // highWaterMark 0: pull läuft erst beim Lesen (sonst füllt der Strom seine Warteschlange schon beim Anlegen).
  const strom = new ReadableStream(
    {
      pull() {
        gelesen = true;
        throw new Error("Körper gelesen");
      },
    },
    { highWaterMark: 0 },
  );
  const anfrage = { headers: new Headers({ "content-length": String(medien.JSON_MAX_BYTES + 1) }), body: strom };
  assert.deepEqual(await ablage.leseJsonKoerper(anfrage), { art: "zu_gross" });
  assert.equal(gelesen, false);
});

test("M-E11 Spaltenvergleich (Nachbesserung ablauf7-3): Jede der 32 Einfüge-Spalten zählt beim Vergleich mit einer vorhandenen Zeile — je Rolle eine abweichende Spalte, genau diese gemeldet", async () => {
  const SPALTEN = ["objekt_slug", "art", "fassung", "startbild_id", "abgeleitet_von", "speicher_pfad", "sha256", "bytes", "mime", "breite", "hoehe", "fps", "dauer_s", "aigc_kennzeichen", "schnitt_von_s", "schnitt_bis_s", "anker_id", "anker_sha256", "ausschnitt", "startbild_abgleich", "startbild_abweichung_max", "erzeuger", "modell", "job_id", "parameter", "prompt", "prompt_klauseln", "ki_hinweis_text", "kosten_vorschau_credits", "kosten_credits", "kosten_usd", "kosten_quelle"];
  assert.deepEqual([...medien.EINFUEGE_SPALTEN].sort(), [...SPALTEN].sort(), "die Einfüge-Spalten sind genau diese 32");
  const eingang = await hochladen();
  const v = await pruefen(eingang);
  assert.equal(v.status, 200);
  const anders = (w) => (w === null ? 7 : typeof w === "number" ? w + 1 : typeof w === "boolean" ? !w : typeof w === "string" ? `${w}x` : Array.isArray(w) ? [...w, { id: "neu", text: "neu" }] : { ...w, neu: 1 });
  for (const { rolle, felder } of v.body.vorschau) {
    assert.deepEqual(medien.abweichendeFelder(felder, structuredClone(felder)), [], `${rolle}: gleich`);
    for (const s of SPALTEN) {
      const vorhanden = { ...structuredClone(felder), [s]: anders(felder[s]) };
      assert.deepEqual(medien.abweichendeFelder(felder, vorhanden), [s], `${rolle}.${s}`);
    }
  }
});

test("M-E12 Einspielen (Nachbesserung ablauf7-3): Hinweise stehen je Rolle in parameter.hinweise der Zeile, die sie betreffen; die Maße des Startbilds misst der Server (nicht aus dem Rezept)", async () => {
  const b = beleg({ hinweise: { startbild: ["H-Start"], original: ["H-Original"], export: ["H-Export"] } });
  const { e } = await ganzEinspielen(b);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  const [sb, og, ex] = zeilen();
  assert.deepEqual(sb.parameter, { hinweise: ["H-Start"] });
  assert.deepEqual(og.parameter, { stufe: "test", laenge_s: 4, hinweise: ["H-Original"] });
  assert.deepEqual(ex.parameter, { hinweise: ["H-Export"] });
  // Startbild einen Bildpunkt breiter als das Rezept: gemessen, nicht übernommen (Abgleich: Maße passen nicht).
  zuruecksetzen();
  ablage.setzeSperreZurueck();
  exportMitCover();
  const breiter = await sharp(ANKER_BYTES).extract({ left: REZEPT.x, top: REZEPT.y, width: REZEPT.breite + 1, height: REZEPT.hoehe }).png().toBuffer();
  const dateien = { ...DATEIEN, startbild: { bytes: breiter, mime: "image/png" } };
  const v = await pruefen(await hochladen(dateien), beleg({}, dateien));
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const startbild = v.body.vorschau[0].felder;
  assert.deepEqual([startbild.breite, startbild.hoehe], [REZEPT.breite + 1, REZEPT.hoehe]);
  assert.equal(startbild.startbild_abgleich, "nicht_bestanden");
  assert.match(v.body.abgleich.grund, /Maße passen nicht/);
});

test("M-B2 Attrappe der DB so streng wie das SQL (Nachbesserung ablauf7-2): ausdrückliches null in parameter/prompt_klauseln → 23502; Typen (INT, NUMERIC, BOOLEAN) → 22P02/22003; U+0000 → 22P05, einzelnes Ersatzzeichen → 22P02; Storage-PUT über 50 MB oder mit fremdem MIME-Typ → abgewiesen", async () => {
  const service = createClient("http://supabase.test", SERVICE);
  const startbild = {
    objekt_slug: SLUG, art: "bild", fassung: "startbild", speicher_pfad: `${SLUG}/${"a".repeat(64)}.png`, sha256: "a".repeat(64), bytes: 10, mime: "image/png",
    anker_id: "test-anker", anker_sha256: "b".repeat(64), ausschnitt: { ...REZEPT }, startbild_abgleich: "bestanden",
  };
  for (const [extra, code] of [
    [{ parameter: null }, "23502"],
    [{ prompt_klauseln: null }, "23502"],
    [{ breite: 1920.5 }, "22P02"],
    [{ hoehe: 3e9 }, "22003"],
    [{ fps: "abc" }, "22P02"],
    [{ dauer_s: {} }, "22P02"],
    [{ aigc_kennzeichen: "ja" }, "22P02"],
    [{ ki_hinweis_text: "a\u0000b" }, "22P05"],
    [{ parameter: { x: "\ud800" } }, "22P02"],
  ]) {
    const r = await service.from("studio_medium").insert({ ...startbild, ...extra });
    assert.equal(r.error?.code, code, JSON.stringify(extra));
  }
  // Ohne die Schlüssel greifen die Defaults; ein numerischer Text ist für NUMERIC zulässig.
  assert.equal((await service.from("studio_medium").insert({ ...startbild, fps: "24.000" })).error, null);
  // Storage: Grenze 50.000.000 B und die MIME-Liste des Buckets.
  const r1 = await post(uploadRoute, "/upload-url", { dateien: [{ rolle: "export", bytes: 1, mime: "video/mp4" }] });
  const ziel = r1.body.dateien[0];
  const zuGross = await fetch(ziel.signedUrl, { method: "PUT", headers: { "content-type": "video/mp4", "x-upsert": "false" }, body: Buffer.alloc(50_000_001) });
  assert.equal(zuGross.status, 400);
  assert.equal((await zuGross.json()).statusCode, "413");
  const fremd = await fetch(ziel.signedUrl, { method: "PUT", headers: { "content-type": "text/plain", "x-upsert": "false" }, body: Buffer.from("x") });
  assert.equal(fremd.status, 400);
  assert.equal((await fremd.json()).statusCode, "415");
  assert.ok(!objektPfade().includes(ziel.pfad), "nichts gespeichert");
});
