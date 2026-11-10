// Objekt-Studio Schritt 8 (10.11.2026): Prüfroute POST /api/studio/[objekt]/medien/[id]/pruefung, „freigeben“ in
// POST /api/content/status für Zeilen mit metadata.medium_id und die Prüfansicht (components/studio/PruefAnsicht.tsx).
// Lauf: npm test.
//
// Kein Netz: Supabase (REST und Storage) beantwortet tests/harness/fake.mjs. Die Medien-Zeilen stehen direkt in der
// Attrappe (wie nach einem Einspielen), die Export-Datei sind synthetische Bytes. Der Anker ist der Manifest-Eintrag
// hof-nacht aus lib/studio/anker.ts (nur sein öffentlicher Hash, keine Datei). Alle anderen Werte sind Testwerte.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomFillSync } from "node:crypto";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/server.js")).href, context);
    if (specifier === "server-only") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/dist/compiled/server-only/empty.js")).href, context);
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const SERVICE = "service-test-key-1234567890abcdef";
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key-0000000000",
  SUPABASE_SERVICE_KEY: SERVICE,
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
});

const fake = await import("./harness/fake.mjs");
const { welt, legeAn, zeile, zuruecksetzen } = fake;
fake.installiere();
const { legeObjektAn } = await import("./harness/studio-ablage.mjs");
const { React, jsxRuntime, renderToStaticMarkup } = await import("./harness/tsx.mjs");
const { ladeStudioBausteine, hookLaufzeit } = await import("./harness/studio.mjs");
const { NextRequest } = await import("next/server");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const counsel = await import("../src/lib/counsel-urteil.ts");
const anker = await import("../src/lib/studio/anker.ts");
const { KI_HINWEIS_BILD } = await import("../src/lib/studio/ki-hinweis.ts");
const lade = (rel) => import(pathToFileURL(path.join(SITE, rel)).href);
const pruefRoute = await lade("src/app/api/studio/[objekt]/medien/[id]/pruefung/route.ts");
const statusRoute = await lade("src/app/api/content/status/route.ts");
const studioRoute = await lade("src/app/api/studio/[objekt]/route.ts");
const freigabenRoute = await lade("src/app/api/freigaben/route.ts");
const freigabenCache = await lade("src/lib/freigaben-cache.ts");
const P = ladeStudioBausteine({ react: React, "react/jsx-runtime": jsxRuntime, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }).pruef;

const SLUG = "rittergut-seifersdorf";
const HOF = anker.ANKER_MANIFESTE[SLUG].eintraege.find((e) => e.id === "hof-nacht");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const EXPORT = (() => {
  const b = Buffer.alloc(650_000);
  randomFillSync(b);
  b.write("ftypisom", 4, "latin1");
  return b;
})();
const EXPORT_SHA = sha(EXPORT);
const EXPORT_PFAD = `${SLUG}/${EXPORT_SHA}.mp4`;

/** Drei Medien-Zeilen eines Videos direkt in der Attrappe; die Export-Datei im Bucket. */
function video({ startbild = {}, original = {}, export: ex = {} } = {}) {
  const basis = {
    objekt_slug: SLUG, anker_id: "hof-nacht", anker_sha256: HOF.sha256, breite: null, hoehe: null, fps: null, dauer_s: null, aigc_kennzeichen: null,
    schnitt_von_s: null, schnitt_bis_s: null, ausschnitt: null, startbild_abgleich: null, startbild_abweichung_max: null, erzeuger: null, modell: null,
    job_id: null, parameter: {}, prompt: null, prompt_klauseln: [], ki_hinweis_text: null, kosten_vorschau_credits: null, kosten_credits: null,
    kosten_usd: null, kosten_quelle: null, startbild_id: null, abgeleitet_von: null, eingespielt_am: "2026-11-10T14:30:00.000000+00:00",
  };
  welt.tabellen.studio_medium = [
    { ...basis, id: 1, art: "bild", fassung: "startbild", sha256: "1".repeat(64), speicher_pfad: `${SLUG}/${"1".repeat(64)}.png`, bytes: 10, mime: "image/png", breite: 3000, hoehe: 1687, ausschnitt: { x: 0, y: 120, breite: 3000, hoehe: 1687, skalierung: 1 }, startbild_abgleich: "bestanden", startbild_abweichung_max: 0, ...startbild },
    { ...basis, id: 2, art: "video", fassung: "original", sha256: "2".repeat(64), speicher_pfad: `${SLUG}/${"2".repeat(64)}.mp4`, bytes: 15_000_000, mime: "video/mp4", startbild_id: 1, erzeuger: "higgsfield-connector", modell: "test-modell", job_id: "job-1", fps: 24, dauer_s: 4.5, prompt: "Test-Prompt", prompt_klauseln: [{ id: "licht", text: "Licht ruhig." }, { id: "rahmen", text: "Rahmen bleibt." }], kosten_credits: 6.5, kosten_quelle: "Test", ...original },
    { ...basis, id: 3, art: "video", fassung: "export", sha256: EXPORT_SHA, speicher_pfad: EXPORT_PFAD, bytes: EXPORT.length, mime: "video/mp4", abgeleitet_von: 2, job_id: "job-1", breite: 1280, hoehe: 720, fps: 24, dauer_s: 2.5, schnitt_von_s: 0.25, schnitt_bis_s: 2.75, ki_hinweis_text: KI_HINWEIS_BILD, ...ex },
  ];
  legeObjektAn(welt.studio, EXPORT_PFAD, EXPORT, { mime: "video/mp4" });
}

function eingabe(extra = {}) {
  return {
    medium_sha256: EXPORT_SHA,
    pruefer_kuerzel: "TS",
    klauseln: [
      { id: "licht", bestanden: true },
      { id: "rahmen", bestanden: true },
    ],
    anker_abgleich: "bestanden",
    ki_hinweis_eingebrannt: true,
    durchsicht_volle_bildrate: true,
    rechte_status: "geklaert",
    rechte_nachweis: "Verweis (Testwert)",
    notiz: null,
    ...extra,
  };
}

async function pruefe(id, koerper, kopf = {}) {
  const req = new NextRequest(`http://harness.local/api/studio/${SLUG}/medien/${id}/pruefung`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", cookie: "gp-auth=test", ...kopf },
    body: typeof koerper === "string" ? koerper : JSON.stringify(koerper),
  });
  const res = await pruefRoute.POST(req, { params: Promise.resolve({ objekt: SLUG, id: String(id) }) });
  return { status: res.status, body: await res.json() };
}

async function freigeben(id) {
  const req = new NextRequest("http://harness.local/api/content/status", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", cookie: "gp-auth=test" },
    body: JSON.stringify({ id, aktion: "freigeben" }),
  });
  const res = await statusRoute.POST(req);
  return { status: res.status, body: await res.json() };
}

// Seit Schritt 9 steht die Pflichtzeile als eigene Zeile im Freigabetext (pruefeVideoFreigabe).
const PFLICHTZEILE = "Bild-/Videomaterial: KI-generierte Visualisierung, kein Foto der Bestandsimmobilie";
const CAPTION = `Caption zum Video, lang genug für die Regel.\n\n${PFLICHTZEILE}`;

/** Caption-Zeile zur Freigabe: COUNSEL FREIGABE über genau diesen Text (Format vor der Endprüfung: steps[1] = SCRIBE). */
function caption(metadata = {}) {
  return legeAn({
    id: 50,
    title: "Caption",
    status: "zur_freigabe",
    body: CAPTION,
    review_notes: "Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG",
    metadata: { objekt_slug: SLUG, steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: CAPTION }], medium_id: 3, ...metadata },
  });
}

const protokolle = () => welt.tabellen.studio_pruefung ?? [];

beforeEach(() => {
  zuruecksetzen();
  process.env.SUPABASE_SERVICE_KEY = SERVICE;
});

// ═══ Prüfroute ═══

test("MP-1 Prüfroute: speichert das Protokoll; urteil berechnet der Server mit der Regel, durch ist die Konstante, id und DB-Uhr setzt die Datenbank", async () => {
  video();
  const ok = await pruefe(3, eingabe());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.pruefung_id, ok.body.urteil, ok.body.gruende], [1, "bestanden", []]);
  const z = protokolle()[0];
  assert.equal(z.durch, "betreiber-session");
  assert.equal(z.urteil, "bestanden");
  assert.equal(z.medium_sha256, EXPORT_SHA);
  assert.match(z.geprueft_am, /\+00:00$/, "DB-Uhr der Attrappe");
  const gesendet = welt.log.filter((l) => l.methode === "POST" && l.tabelle === "studio_pruefung").map((l) => l.body);
  assert.ok(gesendet.every((b) => !("id" in b) && !("geprueft_am" in b)));
  // Mit einer nicht bestandenen Klausel: nicht bestanden, mit dem Grund der Regel; das jüngste Protokoll zählt.
  const schlecht = await pruefe(3, eingabe({ klauseln: [{ id: "licht", bestanden: true }, { id: "rahmen", bestanden: false }] }));
  assert.deepEqual([schlecht.body.urteil, schlecht.body.gruende], ["nicht_bestanden", ["Klausel „rahmen“ nicht bestanden"]]);
  const studio = await (await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) })).json();
  const k = studio.medien.wert.ketten[0];
  assert.deepEqual(k.urteil, { freigebbar: false, gruende: ["Klausel „rahmen“ nicht bestanden"], pruefung_id: 2 });
  assert.deepEqual(k.pruefungen.map((p) => p.id), [2, 1], "jüngstes zuerst");
  // Ohne Protokoll vorher: das Urteil sperrt mit „Prüfprotokoll fehlt“ (nur wenn keines da ist).
  zuruecksetzen();
  video();
  const leer = await (await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) })).json();
  assert.deepEqual(leer.medien.wert.ketten[0].urteil.gruende, ["Prüfprotokoll fehlt"]);
});

test("MP-2 Prüfroute: Medium unbekannt oder aus einem anderen Objekt → 404; Startbild statt Export → 400", async () => {
  video();
  assert.equal((await pruefe(99, eingabe())).status, 404);
  welt.tabellen.studio_medium[2].objekt_slug = "villa-x";
  assert.equal((await pruefe(3, eingabe())).status, 404);
  zuruecksetzen();
  video();
  const startbild = await pruefe(1, eingabe({ medium_sha256: "1".repeat(64) }));
  assert.equal(startbild.status, 400);
  assert.match(startbild.body.fehler, /gilt dem Export/);
  assert.equal(protokolle().length, 0);
});

test("MP-3 Prüfroute: fremder Hash → 409; Datei nachgehasht — verändert oder fehlend → 409; nichts gespeichert", async () => {
  video();
  const fremd = await pruefe(3, eingabe({ medium_sha256: "d".repeat(64) }));
  assert.equal(fremd.status, 409);
  assert.match(fremd.body.fehler, /medium_sha256 passt nicht zur gespeicherten Datei/);
  const o = welt.studio.objekte.get(EXPORT_PFAD);
  o.bytes[o.bytes.length - 1] ^= 0xff;
  const veraendert = await pruefe(3, eingabe());
  assert.equal(veraendert.status, 409);
  assert.match(veraendert.body.fehler, /weicht vom gespeicherten SHA-256 ab — nicht geprüft/);
  welt.studio.objekte.delete(EXPORT_PFAD);
  const fehlt = await pruefe(3, eingabe());
  assert.equal(fehlt.status, 409);
  assert.match(fehlt.body.fehler, /fehlt im Speicher/);
  assert.equal(protokolle().length, 0);
  assert.ok(welt.studio.log.filter((l) => l.op === "download" && l.pfad === EXPORT_PFAD).length >= 2, "nachgehasht");
});

test("MP-4 Prüfroute: Klauseln genau einmal, Verweis bei „geklärt“, kein urteil und kein durch vom Browser, Kürzel, Herkunft, Größe → 400/403/413/415", async () => {
  video();
  const faelle = [
    [eingabe({ klauseln: [{ id: "licht", bestanden: true }] }), /fehlt: rahmen/],
    [eingabe({ klauseln: [...eingabe().klauseln, { id: "wasser", bestanden: true }] }), /fremd oder doppelt: wasser/],
    [eingabe({ klauseln: [...eingabe().klauseln, { id: "licht", bestanden: true }] }), /fremd oder doppelt: licht/],
    [eingabe({ rechte_nachweis: "   " }), /geklaert nur mit Nachweis-Verweis/],
    [eingabe({ rechte_nachweis: null }), /geklaert nur mit Nachweis-Verweis/],
    [{ ...eingabe(), urteil: "bestanden" }, /urteil setzt der Server/],
    [{ ...eingabe(), durch: "jemand" }, /durch setzt der Server/],
    [eingabe({ pruefer_kuerzel: "T" }), /pruefer_kuerzel/],
    [eingabe({ anker_abgleich: "ja" }), /anker_abgleich/],
  ];
  for (const [koerper, muster] of faelle) {
    const r = await pruefe(3, koerper);
    assert.equal(r.status, 400, muster.source);
    assert.match(r.body.fehler, muster);
  }
  assert.equal((await pruefe(3, eingabe(), { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await pruefe(3, eingabe(), { "content-type": "text/plain" })).status, 415);
  assert.equal((await pruefe(3, JSON.stringify({ ...eingabe(), notiz: "x".repeat(1_000_001) }))).status, 413);
  assert.equal(protokolle().length, 0);
  // „offen“ ohne Verweis ist zulässig — und sperrt dann über Bedingung 9.
  const offen = await pruefe(3, eingabe({ rechte_status: "offen", rechte_nachweis: null }));
  assert.deepEqual([offen.status, offen.body.urteil, offen.body.gruende], [200, "nicht_bestanden", ["Rechte laut Prüfprotokoll nicht geklärt"]]);
});

// ═══ Freigeben mit metadata.medium_id ═══

test("MP-5 „freigeben“ mit medium_id: Medien-Regel sperrt → 409 mit erstem Grund und allen Gründen; die Zeile bleibt unverändert", async () => {
  video({ startbild: { startbild_abgleich: "nicht_bestanden", startbild_abweichung_max: 7 } });
  assert.equal((await pruefe(3, eingabe({ klauseln: [{ id: "licht", bestanden: true }, { id: "rahmen", bestanden: false }], anker_abgleich: "nicht_bestanden" }))).status, 200);
  caption();
  const vorher = structuredClone(zeile(50));
  const r = await freigeben(50);
  assert.equal(r.status, 409);
  assert.equal(r.body.fehler, "Klausel „rahmen“ nicht bestanden");
  assert.deepEqual(r.body.gruende, ["Klausel „rahmen“ nicht bestanden", "Anker-Abgleich nicht bestanden (Architektur, Personen, Wasser)", "Startbild-Abgleich nicht bestanden (größte Abweichung 7)"]);
  assert.deepEqual(zeile(50), vorher, "nichts geschrieben");
  assert.ok(!welt.log.some((l) => l.methode === "PATCH"), "kein Update");
  assert.ok(welt.studio.log.some((l) => l.op === "download" && l.pfad === EXPORT_PFAD), "Export vorher nachgehasht");
});

test("MP-6 „freigeben“ mit medium_id: alles erfüllt → 200, Beleg mit medium_id, nachgemessenem medium_sha256 und pruefung_id; Übergang bleibt an Status und updated_at gebunden", async () => {
  video();
  assert.equal((await pruefe(3, eingabe())).body.urteil, "bestanden");
  caption();
  const gelesen = zeile(50).updated_at;
  const r = await freigeben(50);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const f = zeile(50).metadata.freigabe;
  assert.equal(zeile(50).status, "freigegeben");
  assert.deepEqual([f.medium_id, f.medium_sha256, f.pruefung_id], [3, EXPORT_SHA, 1]);
  assert.equal(f.counsel_urteil, "FREIGABE");
  const patch = welt.log.find((l) => l.methode === "PATCH" && l.tabelle === "content");
  assert.match(patch.query, /status=eq\.zur_freigabe/);
  assert.ok(patch.query.includes(`updated_at=eq.${gelesen}`), patch.query);
});

test("MP-7 „freigeben“ mit medium_id: Export-Datei verändert, fremdes Objekt, unlesbare medium_id oder unbekanntes Medium → 409; Lesefehler → 502; ohne medium_id kein Medien-Zugriff", async () => {
  video();
  await pruefe(3, eingabe());
  caption();
  const o = welt.studio.objekte.get(EXPORT_PFAD);
  o.bytes[0] ^= 0xff;
  const datei = await freigeben(50);
  assert.equal(datei.status, 409);
  assert.match(datei.body.fehler, /Datei von Medium 3 weicht vom gespeicherten SHA-256 ab/);
  o.bytes[0] ^= 0xff;
  for (const [metadata, muster] of [
    [{ objekt_slug: "villa-x" }, /gehört nicht zum Objekt dieser Zeile/],
    [{ medium_id: "3" }, /metadata\.medium_id/],
    [{ medium_id: null }, /metadata\.medium_id/],
    [{ medium_id: 77 }, /Medium 77 nicht gefunden/],
  ]) {
    zuruecksetzen();
    video();
    await pruefe(3, eingabe());
    caption(metadata);
    const r = await freigeben(50);
    assert.equal(r.status, 409, String(muster));
    assert.match(r.body.fehler, muster);
    assert.equal(zeile(50).status, "zur_freigabe");
  }
  zuruecksetzen();
  video();
  caption();
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_pruefung" ? { status: 500, body: { message: "weg" } } : null);
  assert.equal((await freigeben(50)).status, 502);
  welt.stoerung = null;
  // Ohne medium_id: wie bisher, ohne Medien-Tabellen oder Storage.
  zuruecksetzen();
  legeAn({ id: 51, title: "Text", status: "zur_freigabe", body: CAPTION, review_notes: "URTEIL: FREIGABE-EMPFEHLUNG", metadata: { steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: CAPTION }] } });
  assert.equal((await freigeben(51)).status, 200);
  assert.ok(!welt.log.some((l) => String(l.tabelle).startsWith("studio_")) && welt.studio.log.length === 0);
});

test("MP-11 „freigeben“ liest die Kette nur innerhalb des Objekts: Original oder Startbild eines anderen Objekts, Export auf ein Startbild, Original auf ein Original → 409 mit dem Kettengrund", async () => {
  const faelle = [
    [(z) => (z[1].objekt_slug = "villa-x"), "Original des Exports fehlt"],
    [(z) => (z[0].objekt_slug = "villa-x"), "Startbild des Originals fehlt"],
    [(z) => (z[2].abgeleitet_von = 1), "Original des Exports fehlt"],
    [(z) => (z[1].startbild_id = 2), "Startbild des Originals fehlt"],
  ];
  for (const [verbiegen, grund] of faelle) {
    zuruecksetzen();
    video();
    // Protokoll an der intakten Kette; erst danach wird die Kette verbogen (wie es die Datenbank nie zuließe).
    assert.equal((await pruefe(3, eingabe())).body.urteil, "bestanden");
    caption();
    verbiegen(welt.tabellen.studio_medium);
    const r = await freigeben(50);
    assert.equal(r.status, 409, grund);
    assert.ok(r.body.gruende.includes(grund), JSON.stringify(r.body.gruende));
    assert.equal(zeile(50).status, "zur_freigabe");
  }
});

test("MP-12 „freigeben“ liest die Prüfprotokolle erst nach dem Nachhashen, jüngstes zuerst und begrenzt: ein währenddessen gespeichertes Protokoll zählt", async () => {
  video();
  assert.equal((await pruefe(3, eingabe())).body.urteil, "bestanden");
  caption();
  const alt = structuredClone(welt.tabellen.studio_pruefung[0]);
  const spaeter = new Date(Date.parse(alt.geprueft_am) + 60_000).toISOString().replace("Z", "000+00:00");
  let eingeschoben = false;
  welt.stoerung = (a) => {
    if (!eingeschoben && a.art === "storage" && a.op === "download") {
      eingeschoben = true;
      welt.tabellen.studio_pruefung.push({ ...alt, id: alt.id + 1, geprueft_am: spaeter, rechte_status: "offen", rechte_nachweis: null, urteil: "nicht_bestanden" });
    }
    return null;
  };
  try {
    const r = await freigeben(50);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.ok(r.body.gruende.includes("Rechte laut Prüfprotokoll nicht geklärt"), JSON.stringify(r.body.gruende));
    assert.equal(zeile(50).status, "zur_freigabe");
  } finally {
    welt.stoerung = null;
  }
  assert.ok(eingeschoben);
  const q = welt.log.filter((l) => l.methode === "GET" && l.tabelle === "studio_pruefung").map((l) => l.query);
  assert.ok(q.some((x) => x.includes("order=geprueft_am.desc,id.desc") && x.includes("limit=100")), q.join(" | "));
});

test("MP-13 Studio liest die Prüfprotokolle jüngstes zuerst, höchstens 500: gekappt warnt der Teil, das Urteil folgt dem jüngsten", async () => {
  video();
  assert.equal((await pruefe(3, eingabe())).body.urteil, "bestanden");
  const p = welt.tabellen.studio_pruefung[0];
  for (let i = 0; i < 499; i++) {
    const frueher = new Date(Date.parse(p.geprueft_am) - (i + 1) * 60_000).toISOString().replace("Z", "000+00:00");
    welt.tabellen.studio_pruefung.push({ ...structuredClone(p), id: 1000 + i, geprueft_am: frueher, rechte_status: "offen", rechte_nachweis: null, urteil: "nicht_bestanden" });
  }
  const s = await (await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) })).json();
  assert.match(s.medien.hinweis, /nur die jüngsten 500 Prüfprotokolle gelesen — ein Video ohne gelesenes Protokoll bleibt gesperrt/);
  assert.equal(s.medien.wert.ketten[0].urteil.pruefung_id, p.id);
  assert.equal(s.medien.wert.ketten[0].pruefungen[0].id, p.id);
  const q = welt.log.filter((l) => l.methode === "GET" && l.tabelle === "studio_pruefung").map((l) => l.query);
  assert.ok(q.some((x) => x.includes("order=geprueft_am.desc,id.desc") && x.includes("limit=500")), q.join(" | "));
});

test("MP-14 Prüfroute: Zeitüberschreitung beim Speichern (postgrest-js liefert sie als error) → 500 „Ausgang unbekannt“", async () => {
  video();
  welt.vorAntwort = async (a) => {
    if (a.methode === "POST" && a.tabelle === "studio_pruefung") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  try {
    const r = await pruefe(3, eingabe());
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.match(r.body.fehler, /^Prüfprotokoll: Zeitüberschreitung \(\d+ s\) — Ausgang unbekannt/);
  } finally {
    welt.vorAntwort = null;
  }
});

test("MP-15 „freigeben“ mit medium_id (Schritt 9): eine Prüfung für Caption und Medium — Pflichtzeile fehlt oder steht nur im Satz → 409; Caption-Grund vor Pflichtzeile vor Medien-Gründen", async () => {
  video({ startbild: { startbild_abgleich: "nicht_bestanden", startbild_abweichung_max: 7 } });
  assert.equal((await pruefe(3, eingabe())).status, 200);
  const ohne = "Caption zum Video, lang genug für die Regel, ohne die Pflichtzeile.";
  const imSatz = `Caption zum Video: ${PFLICHTZEILE}`;
  for (const text of [ohne, imSatz]) {
    zuruecksetzen();
    video({ startbild: { startbild_abgleich: "nicht_bestanden", startbild_abweichung_max: 7 } });
    await pruefe(3, eingabe());
    legeAn({ id: 50, title: "Caption", status: "zur_freigabe", body: text, review_notes: "URTEIL: FREIGABE-EMPFEHLUNG", metadata: { objekt_slug: SLUG, steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: text }], medium_id: 3 } });
    const r = await freigeben(50);
    assert.equal(r.status, 409, text);
    assert.deepEqual(r.body.gruende, [`Pflichtzeile zum KI-Hinweis fehlt im Freigabetext („${PFLICHTZEILE}“ als eigene Zeile)`, "Startbild-Abgleich nicht bestanden (größte Abweichung 7)"]);
    assert.equal(r.body.fehler, r.body.gruende[0]);
    assert.equal(zeile(50).status, "zur_freigabe");
  }
  // COUNSEL sperrt: dessen Grund zuerst, danach Pflichtzeile und Medium.
  zuruecksetzen();
  video({ startbild: { startbild_abgleich: "nicht_bestanden", startbild_abweichung_max: 7 } });
  await pruefe(3, eingabe());
  legeAn({ id: 50, title: "Caption", status: "zur_freigabe", body: ohne, review_notes: "URTEIL: ABLEHNUNG", metadata: { objekt_slug: SLUG, steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: ohne }], medium_id: 3 } });
  const r = await freigeben(50);
  assert.equal(r.status, 409);
  assert.match(r.body.gruende[0], /^COUNSEL-Urteil ABLEHNUNG/);
  assert.equal(r.body.gruende.length, 3);
});

/** Stapel, Studio-Karte und Freigeben für Zeile 50 (Schritt 9): Sperrgrund je Stelle. */
async function dreiStellen() {
  const stapel = await freigabenRoute.GET();
  const s = await stapel.json();
  const eintrag = s.wartend.find((e) => e.id === "50");
  const studio = await (await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) })).json();
  const karte = studio.assets.wert.find((a) => a.id === 50);
  return { eintrag, karte, abfrage: stapel.headers.get("x-freigaben-abfrage") };
}

test("MP-16 Schritt 9: Freigeben, Stapel und Studio-Karte nennen für eine Caption zu einem Video denselben Sperrgrund (eine Funktion); der Stapel zeigt medium mit Art, Hash und Prüfurteil", async () => {
  freigabenCache.setzeFreigabenZurueck();
  video({ startbild: { startbild_abgleich: "nicht_bestanden", startbild_abweichung_max: 7 } });
  assert.equal((await pruefe(3, eingabe())).status, 200);
  caption();
  const { eintrag, karte } = await dreiStellen();
  const server = await freigeben(50);
  assert.equal(server.status, 409);
  assert.equal(server.body.fehler, "Startbild-Abgleich nicht bestanden (größte Abweichung 7)");
  assert.equal(eintrag.freigabe_sperre, server.body.fehler, "Stapel");
  assert.equal(karte.freigabe_sperre, server.body.fehler, "Studio-Karte");
  assert.deepEqual(eintrag.medium, { id: 3, art: "video", fassung: "export", sha256: EXPORT_SHA, pruefung_id: 1, freigebbar: false, gruende: ["Startbild-Abgleich nicht bestanden (größte Abweichung 7)"] });
  // Pflichtzeile fehlt: an allen drei Stellen der Pflichtzeilen-Grund zuerst.
  zuruecksetzen();
  freigabenCache.setzeFreigabenZurueck();
  video();
  await pruefe(3, eingabe());
  const ohne = "Caption zum Video, lang genug für die Regel, ohne die Pflichtzeile.";
  legeAn({ id: 50, title: "Caption", status: "zur_freigabe", body: ohne, review_notes: "URTEIL: FREIGABE-EMPFEHLUNG", metadata: { objekt_slug: SLUG, steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: ohne }], medium_id: 3 } });
  const zwei = await dreiStellen();
  const r = await freigeben(50);
  assert.equal(r.status, 409);
  assert.match(r.body.fehler, /^Pflichtzeile zum KI-Hinweis fehlt im Freigabetext/);
  assert.equal(zwei.eintrag.freigabe_sperre, r.body.fehler);
  assert.equal(zwei.karte.freigabe_sperre, r.body.fehler);
  assert.equal(zwei.eintrag.medium.freigebbar, true);
  // Zeile ohne Video: kein medium, Sperre wie bisher.
  zuruecksetzen();
  freigabenCache.setzeFreigabenZurueck();
  legeAn({ id: 51, title: "Text", status: "zur_freigabe", body: CAPTION, review_notes: "URTEIL: FREIGABE-EMPFEHLUNG", metadata: { steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: CAPTION }] } });
  const s = await (await freigabenRoute.GET()).json();
  assert.equal(s.wartend[0].medium, null);
  assert.equal(s.wartend[0].freigabe_sperre, null);
  assert.ok(!welt.log.some((l) => String(l.tabelle).startsWith("studio_")), "ohne Video kein Zugriff auf die Medien");
});

test("MP-17 Schritt 9: Die Änderungsprobe des Stapels erkennt ein neues Prüfprotokoll (voll) — vorher wäre es bis zu 30 min unsichtbar geblieben; ohne Änderung nur die Probe", async () => {
  freigabenCache.setzeFreigabenZurueck();
  video();
  assert.equal((await pruefe(3, eingabe({ rechte_status: "offen", rechte_nachweis: null }))).status, 200);
  caption();
  const eins = await dreiStellen();
  assert.equal(eins.abfrage, "voll");
  assert.equal(eins.eintrag.freigabe_sperre, "Rechte laut Prüfprotokoll nicht geklärt");
  assert.equal((await dreiStellen()).abfrage, "unveraendert");
  assert.equal((await pruefe(3, eingabe())).body.urteil, "bestanden");
  const drei = await dreiStellen();
  assert.equal(drei.abfrage, "voll", "neues Protokoll → volle Abfrage");
  assert.equal(drei.eintrag.freigabe_sperre, null);
  assert.equal(drei.eintrag.medium.pruefung_id, 2);
  assert.equal((await freigeben(50)).status, 200, "der Server gibt jetzt frei");
});

// ═══ Prüfansicht ═══

test("MP-8 Prüfansicht (rein): Bildschritt = 1/fps, Gesamtzahl round(dauer × fps) (Export 2,5 s: 60), Zähler zählt distinkte Bilder, Pflichtfelder, Anfrage", () => {
  assert.equal(P.bildSchritt(24), 1 / 24);
  assert.equal(P.bildSchritt(25), 1 / 25);
  assert.equal(P.bildSchritt(null), null);
  assert.equal(P.bildSchritt(0), null);
  assert.equal(P.bilderGesamt(2.49, 24), 60, "gerundet, nicht abgeschnitten");
  assert.equal(P.bilderGesamt(4.5, 24), 108);
  assert.equal(P.bilderGesamt(null, 24), null);
  const z = P.bildZaehler(24);
  for (const t of [0, 0, 0.004, 1 / 24, 1 / 24 + 0.001, 2 / 24, 1 / 24]) z.sieh(t);
  assert.equal(z.anzahl, 3, "Bilder 0, 1 und 2 — Wiederholungen zählen nicht");
  const klauseln = [{ id: "licht" }, { id: "rahmen" }];
  const e = P.leereEingaben(klauseln);
  assert.equal(e.rechte, "offen", "Rechtefeld steht anfangs auf offen");
  assert.deepEqual(P.eingabenFehler(e, klauseln), ["Kürzel (2–6 Buchstaben)", "Klausel „licht“", "Klausel „rahmen“", "Architektur", "Personen", "Wasser", "KI-Hinweis"]);
  const voll = { ...e, kuerzel: "TS", klauseln: { licht: "bestanden", rahmen: "nicht_bestanden" }, architektur: "bestanden", personen: "bestanden", wasser: "nicht_bestanden", hinweis: "bestanden", durchsicht: true };
  assert.deepEqual(P.eingabenFehler(voll, klauseln), []);
  assert.deepEqual(P.eingabenFehler({ ...voll, rechte: "geklaert", nachweis: " " }, klauseln), ["Nachweis-Verweis zu den Rechten"]);
  const anfrage = P.alsAnfrage({ ...voll, rechte: "geklaert", nachweis: " Verweis " }, EXPORT_SHA, klauseln);
  assert.deepEqual(anfrage, {
    medium_sha256: EXPORT_SHA,
    pruefer_kuerzel: "TS",
    klauseln: [{ id: "licht", bestanden: true }, { id: "rahmen", bestanden: false }],
    anker_abgleich: "nicht_bestanden",
    ki_hinweis_eingebrannt: true,
    durchsicht_volle_bildrate: true,
    rechte_status: "geklaert",
    rechte_nachweis: "Verweis",
    notiz: null,
  });
  assert.equal(P.alsAnfrage({ ...voll, wasser: "bestanden" }, EXPORT_SHA, klauseln).anker_abgleich, "bestanden");
  assert.equal(P.alsAnfrage(voll, EXPORT_SHA, klauseln).rechte_nachweis, null, "offen: kein Verweis");
  assert.deepEqual(P.ausschnittStil({ x: 0, y: 120, breite: 2400, hoehe: 1350, skalierung: 1 }, { breite: 2400, hoehe: 1600 }), {
    rahmen: { aspectRatio: "2400 / 1350" },
    bild: { width: "100%", left: "0%", top: "-8.8889%" },
  });
});

/** Kette wie GET /api/studio sie liefert (aus der Attrappe gelesen). */
async function kette() {
  const s = await (await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) })).json();
  return s.medien.wert.ketten[0];
}

test("MP-9 Prüfansicht (Markup): Export zuerst, Original nur auf Wunsch; Bildzähler 0 von 60; Anker-ID neben dem Rechtefeld; Rechte anfangs offen; jede Klausel einzeln", async () => {
  video();
  const k = await kette();
  const html = renderToStaticMarkup(
    React.createElement(P.PruefAnsicht, { slug: SLUG, kette: k, anker: HOF, dateiAdresse: (id) => `/api/studio/${SLUG}/medien/${id}/datei`, holen: async () => new Response("{}"), gespeichert: () => {} }),
  );
  assert.match(html, /<video[^>]*src="\/api\/studio\/rittergut-seifersdorf\/medien\/3\/datei"[^>]*data-pruef-video="export"/);
  assert.match(html, /Original abspielen \(groß\)/);
  assert.match(html, /Einzelbilder gesehen: 0 von 60/);
  assert.match(html, /Einzelbild-Schritt 41,67 ms \(1\/24 s\)/);
  assert.match(html, /Rechte · Anker hof-nacht/);
  assert.match(html, /<option value="offen" selected="">offen<\/option>/);
  assert.equal((html.match(/data-pruefpunkt="klausel-/g) ?? []).length, 2);
  assert.match(html, /data-hinweis-wortlaut="passt"/);
  assert.match(html, new RegExp(`<img src="${HOF.url.replace(/[.]/g, "\\.")}"`));
  assert.match(html, /<button type="submit" aria-disabled="true"[^>]*data-protokoll-speichern/, "erst mit allen Pflichtfeldern");
});

test("MP-10 Prüfansicht (Ablauf): Auswahl → POST …/pruefung mit genau diesen Werten an die echte Route; Ergebnis und Neuladen", async () => {
  video();
  const k = await kette();
  const lz = hookLaufzeit();
  const P2 = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }).pruef;
  let neu = 0;
  const gesendet = [];
  const holen = async (url, init) => {
    gesendet.push({ url, body: JSON.parse(init.body) });
    const req = new NextRequest(`http://harness.local${url}`, { method: "POST", headers: { ...init.headers, "sec-fetch-site": "same-origin" }, body: init.body });
    return pruefRoute.POST(req, { params: Promise.resolve({ objekt: SLUG, id: "3" }) });
  };
  lz.setzeWurzel(P2.PruefAnsicht, { slug: SLUG, kette: k, anker: HOF, dateiAdresse: (id) => `/x/${id}`, holen, gespeichert: () => (neu += 1) });
  let baum = lz.rendere();
  const finde = (k2, pred) => {
    if (Array.isArray(k2)) for (const c of k2) { const r = finde(c, pred); if (r) return r; }
    else if (k2 && typeof k2 === "object") { if (pred(k2)) return k2; return finde(k2.kinder, pred); }
    return null;
  };
  const waehle = (punkt, wert) => {
    const feld = finde(baum, (n) => n.type === "fieldset" && n.props["data-pruefpunkt"] === punkt);
    const radios = [];
    (function sammle(n) { if (Array.isArray(n)) n.forEach(sammle); else if (n && typeof n === "object") { if (n.type === "input" && n.props.type === "radio") radios.push(n); sammle(n.kinder); } })(feld);
    radios[wert === "bestanden" ? 0 : 1].props.onChange();
    baum = lz.rendere();
  };
  const tippe = (attr, wert) => {
    finde(baum, (n) => n.props?.[attr] !== undefined && (n.type === "input" || n.type === "select")).props.onChange({ currentTarget: { value: wert, checked: wert } });
    baum = lz.rendere();
  };
  for (const [punkt, w] of [["klausel-licht", "bestanden"], ["klausel-rahmen", "nicht_bestanden"], ["architektur", "bestanden"], ["personen", "bestanden"], ["wasser", "nicht_bestanden"], ["hinweis", "bestanden"]]) waehle(punkt, w);
  tippe("data-durchsicht", true);
  tippe("data-kuerzel", "TS");
  const form = finde(baum, (n) => n.type === "form");
  form.props.onSubmit({ preventDefault() {} });
  baum = await lz.ruhe();
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0].url, `/api/studio/${SLUG}/medien/3/pruefung`);
  assert.deepEqual(gesendet[0].body, {
    medium_sha256: EXPORT_SHA,
    pruefer_kuerzel: "TS",
    klauseln: [{ id: "licht", bestanden: true }, { id: "rahmen", bestanden: false }],
    anker_abgleich: "nicht_bestanden",
    ki_hinweis_eingebrannt: true,
    durchsicht_volle_bildrate: true,
    rechte_status: "offen",
    rechte_nachweis: null,
    notiz: null,
  });
  const ergebnis = finde(baum, (n) => n.props?.["data-pruef-ergebnis"] !== undefined);
  assert.equal(ergebnis.props["data-pruef-ergebnis"], "nicht_bestanden");
  assert.equal(neu, 1, "Studio lädt nach dem Speichern neu");
  assert.equal(protokolle().length, 1);
  assert.equal(protokolle()[0].rechte_status, "offen");
});
