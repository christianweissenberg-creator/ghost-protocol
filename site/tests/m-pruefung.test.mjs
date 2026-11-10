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
const { React, jsxRuntime, renderToStaticMarkup, ladeTsx } = await import("./harness/tsx.mjs");
const { ladeStudioBausteine, ladeMedienPanel, hookLaufzeit } = await import("./harness/studio.mjs");
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

test("MP-4 Prüfroute: Klauseln genau einmal, Verweis bei „geklärt“, kein urteil und kein durch vom Browser, Kürzel, U+0000 und einzelne Ersatzzeichen in Notiz und Nachweis (Nachtrag d2-oberflaeche-6), Herkunft, Größe → 400/403/413/415", async () => {
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
    // Nachtrag d2-oberflaeche-6: U+0000 oder ein einzelnes Ersatzzeichen → 400 mit Feldname, nicht 500 beim Einfügen.
    [eingabe({ notiz: "Notiz\u0000mit Null" }), /^notiz: enthält U\+0000 oder ein einzelnes Ersatzzeichen/],
    [eingabe({ notiz: "Notiz \ud800 allein" }), /^notiz: enthält U\+0000 oder ein einzelnes Ersatzzeichen/],
    [eingabe({ rechte_nachweis: "Verweis\u0000" }), /^rechte_nachweis: enthält U\+0000 oder ein einzelnes Ersatzzeichen/],
    [eingabe({ rechte_nachweis: "Verweis \udc00" }), /^rechte_nachweis: enthält U\+0000 oder ein einzelnes Ersatzzeichen/],
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
  assert.deepEqual(r.body.gruende, ["Klausel „rahmen“ nicht bestanden", "Anker-Abgleich nicht bestanden (geprüft: Architektur, Personen, Wasser — Einzelurteile in der Notiz)", "Startbild-Abgleich nicht bestanden (größte Abweichung 7)"]);
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

test("MP-7 „freigeben“ mit medium_id: Export-Datei verändert, fremdes Objekt, unlesbare medium_id, unbekanntes Medium oder kein Export → 409; Lesefehler → 502; ohne medium_id (auch null) kein Medien-Zugriff", async () => {
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
    [{ medium_id: 77 }, /Medium 77 nicht gefunden/],
    [{ medium_id: 2 }, /^Medium ist kein Export$/],
  ]) {
    zuruecksetzen();
    video();
    await pruefe(3, eingabe());
    caption(metadata);
    const vorher = welt.studio.log.length;
    const r = await freigeben(50);
    assert.equal(r.status, 409, String(muster));
    assert.match(r.body.fehler, muster);
    assert.equal(zeile(50).status, "zur_freigabe");
    // Nachbesserung caption9-2: kein Export → gesperrt, bevor eine Datei gelesen wird (kein Nachhashen des Originals).
    if (metadata.medium_id === 2) assert.ok(!welt.studio.log.slice(vorher).some((l) => l.op === "download"), "nichts nachgehasht");
  }
  // Nachbesserung caption9-2: medium_id null heißt „ohne Video“ wie ein fehlender Schlüssel (der Stapel sieht beides
  // gleich) — Freigeben ohne Medien-Zugriff.
  zuruecksetzen();
  legeAn({ id: 52, title: "Text", status: "zur_freigabe", body: CAPTION, review_notes: "URTEIL: FREIGABE-EMPFEHLUNG", metadata: { steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: CAPTION }], medium_id: null } });
  assert.equal((await freigeben(52)).status, 200);
  assert.ok(!welt.log.some((l) => String(l.tabelle).startsWith("studio_")) && welt.studio.log.length === 0);
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
  // Aus dem Zwischenstand: dieselbe Sperre und dasselbe Medium wie beim vollen Lesen (Nachbesserung caption9-5).
  const zwei = await dreiStellen();
  assert.equal(zwei.abfrage, "unveraendert");
  assert.equal(zwei.eintrag.freigabe_sperre, "Rechte laut Prüfprotokoll nicht geklärt");
  assert.deepEqual(zwei.eintrag.medium, eins.eintrag.medium);
  assert.equal((await pruefe(3, eingabe())).body.urteil, "bestanden");
  const drei = await dreiStellen();
  assert.equal(drei.abfrage, "voll", "neues Protokoll → volle Abfrage");
  assert.equal(drei.eintrag.freigabe_sperre, null);
  assert.equal(drei.eintrag.medium.pruefung_id, 2);
  assert.equal((await freigeben(50)).status, 200, "der Server gibt jetzt frei");
});

/** Eine Anfrage an den Stapel: Eintrag der Zeile id, Abfrage-Art und ganze Antwort. */
async function stapelEintrag(id = "50") {
  const res = await freigabenRoute.GET();
  const s = await res.json();
  return { eintrag: [...s.wartend, ...s.haengend].find((e) => e.id === id) ?? null, abfrage: res.headers.get("x-freigaben-abfrage"), s };
}

/** Werte eines in()-Filters aus der Abfrage (wie welt.log sie festhält), als Zahlen; undefined ohne diesen Filter. */
const inListe = (query, feld) => [...query.matchAll(/(?:^|&)(\w+)=in\.\(([^)]*)\)/g)].find((m) => m[1] === feld)?.[2].split(",").map(Number);

/** Caption-Metadaten wie caption(), mit eigener id und medium_id. */
const captionMeta = (medium_id) => ({ objekt_slug: SLUG, steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: CAPTION }], medium_id });

test("MP-19 Stapel fail-closed (Nachbesserung mutanten-2, caption9-2): fremdes Objekt, unlesbare id, unbekanntes Medium, kein Export, über 25 Videos — derselbe Grund wie beim Freigeben; null heißt ohne Video an allen Stellen", async () => {
  for (const [metadata, grund] of [
    [{ objekt_slug: "villa-x" }, "Medium 3 gehört nicht zum Objekt dieser Zeile"],
    [{ medium_id: "3" }, "Medium der Zeile nicht lesbar (metadata.medium_id)"],
    [{ medium_id: 77 }, "Medium 77 nicht gefunden"],
    [{ medium_id: 2 }, "Medium ist kein Export"],
  ]) {
    zuruecksetzen();
    freigabenCache.setzeFreigabenZurueck();
    video();
    await pruefe(3, eingabe());
    caption(metadata);
    const { eintrag, karte } = await dreiStellen();
    assert.equal(eintrag.freigabe_sperre, grund, JSON.stringify(metadata));
    assert.equal(eintrag.medium.freigebbar, false);
    assert.deepEqual(eintrag.medium.gruende, [grund]);
    // Die Studio-Karte zeigt nur Zeilen dieses Objekts (die Zeile von villa-x prüft MP-20 über das andere Objekt).
    if (metadata.objekt_slug === undefined) assert.equal(karte.freigabe_sperre, grund, `Studio-Karte ${JSON.stringify(metadata)} (Nachtrag d1-nachweis-2)`);
    const server = await freigeben(50);
    assert.deepEqual([server.status, server.body.fehler], [409, grund], "derselbe Grund beim Freigeben");
  }
  // null wie ein fehlender Schlüssel: kein Video — Stapel, Karte und Freigeben gleich.
  zuruecksetzen();
  freigabenCache.setzeFreigabenZurueck();
  video();
  caption({ medium_id: null });
  const ohne = await dreiStellen();
  assert.equal(ohne.eintrag.medium, null);
  assert.equal(ohne.eintrag.freigabe_sperre, null);
  assert.equal(ohne.karte.freigabe_sperre, null);
  assert.equal((await freigeben(50)).status, 200);
  // Über 25 Videos: das mit der höchsten id wird nicht gelesen — „nicht ermittelt“ und gesperrt, nie frei.
  zuruecksetzen();
  freigabenCache.setzeFreigabenZurueck();
  for (let i = 0; i < 26; i += 1) {
    legeAn({ id: 200 + i, title: `Caption ${i}`, status: "zur_freigabe", body: CAPTION, review_notes: "URTEIL: FREIGABE-EMPFEHLUNG", metadata: captionMeta(101 + i) });
  }
  const { s } = await stapelEintrag();
  assert.equal(s.wartend.find((e) => e.id === "225").freigabe_sperre, "Urteil der Medien-Regel nicht ermittelt");
  assert.deepEqual(s.wartend.find((e) => e.id === "225").medium.gruende, ["Urteil der Medien-Regel nicht ermittelt"]);
  assert.equal(s.wartend.find((e) => e.id === "200").freigabe_sperre, "Medium 101 nicht gefunden");
  // Sammelabfrage (Nachtrag d1-regression-1): eine Abfrage für alle Videos — keines gefunden, also keine Originale und
  // keine Startbilder —, mit genau den 25 kleinsten ids; die Protokolle je gelesenem Video, keines für das 26.
  const medienAbfragen = welt.log.filter((l) => l.tabelle === "studio_medium");
  assert.equal(medienAbfragen.length, 1, "eine Sammelabfrage");
  assert.deepEqual(inListe(medienAbfragen[0].query, "id"), Array.from({ length: 25 }, (_, i) => 101 + i), "höchstens 25 Videos je Anfrage gelesen");
  const protokolle = welt.log.filter((l) => l.tabelle === "studio_pruefung" && !/(?:^|&)limit=1(?:&|$)/.test(l.query));
  assert.deepEqual(protokolle.map((l) => Number(/(?:^|&)medium_id=eq\.(\d+)/.exec(l.query)?.[1])).sort((x, y) => x - y), Array.from({ length: 25 }, (_, i) => 101 + i));
});

test("MP-20 Studio-Karte fail-closed (Nachbesserung mutanten-3, caption9-2): Medienteil nicht lesbar → nicht ermittelt; fremdes Objekt, unbekannt, kein Export — Karte, Stapel und Freigeben nennen denselben Grund; Nachlesen gescheitert → nicht ermittelt", async () => {
  const karte = async () => (await (await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) })).json()).assets.wert.find((a) => a.id === 50);
  video();
  await pruefe(3, eingabe());
  caption();
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_medium" ? { status: 500, body: { message: "weg" } } : null);
  try {
    assert.equal((await karte()).freigabe_sperre, "Urteil der Medien-Regel nicht ermittelt");
  } finally {
    welt.stoerung = null;
  }
  for (const [id, grund] of [
    [4, "Medium 4 gehört nicht zum Objekt dieser Zeile"],
    [77, "Medium 77 nicht gefunden"],
    [2, "Medium ist kein Export"],
  ]) {
    zuruecksetzen();
    freigabenCache.setzeFreigabenZurueck();
    video();
    // Export eines anderen Objekts (id 4), direkt in der Attrappe.
    welt.tabellen.studio_medium.push({ ...welt.tabellen.studio_medium[2], id: 4, objekt_slug: "villa-x", sha256: "d".repeat(64), speicher_pfad: `villa-x/${"d".repeat(64)}.mp4` });
    await pruefe(3, eingabe());
    caption({ medium_id: id });
    const { eintrag, karte: k } = await dreiStellen();
    const server = await freigeben(50);
    assert.deepEqual([k.freigabe_sperre, eintrag.freigabe_sperre, server.body.fehler], [grund, grund, grund], `Medium ${id}`);
  }
  // Nachlesen der fremden id scheitert: nicht ermittelt (gesperrt), nie frei.
  zuruecksetzen();
  video();
  caption({ medium_id: 77 });
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_medium" && String(a.params.get("id")).startsWith("in.") ? { status: 500, body: { message: "weg" } } : null);
  try {
    assert.equal((await karte()).freigabe_sperre, "Urteil der Medien-Regel nicht ermittelt");
  } finally {
    welt.stoerung = null;
  }
});

test("MP-21 Stapel-Zwischenstand (Nachbesserung caption9-1, Nachtrag d1-regression-2, d2-stapel-3): der Lesefehler eines Videos gilt höchstens 90 s — bis dahin aus dem Zwischenstand mit demselben Grund, danach liest die nächste Anfrage voll und nennt den richtigen Grund; die Medienkennung ist beantwortet, bevor die erste Medien-Zeile gelesen wird", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-10T15:00:00.000Z") });
  const FEHLERSTAND = freigabenCache.FREIGABEN_FEHLERSTAND_MS;
  freigabenCache.setzeFreigabenZurueck();
  video();
  await pruefe(3, eingabe({ rechte_status: "offen", rechte_nachweis: null }));
  caption();
  let einmal = true;
  welt.stoerung = (a) => {
    if (!einmal || a.art !== "supabase" || a.tabelle !== "studio_medium") return null;
    einmal = false;
    return { status: 500, body: { message: "Verbindung abgebrochen (einmalig)" } };
  };
  try {
    const eins = await stapelEintrag();
    assert.equal(eins.abfrage, "voll");
    assert.match(eins.eintrag.freigabe_sperre, /^Medium 3 nicht lesbar: Verbindung abgebrochen \(einmalig\)/);
  } finally {
    welt.stoerung = null;
  }
  t.mock.timers.tick(FEHLERSTAND - 1);
  const zwei = await stapelEintrag();
  assert.equal(zwei.abfrage, "unveraendert", "der Fehlerstand gilt bis knapp 90 s");
  assert.match(zwei.eintrag.freigabe_sperre, /^Medium 3 nicht lesbar: Verbindung abgebrochen \(einmalig\)/);
  t.mock.timers.tick(1);
  const drei = await stapelEintrag();
  assert.equal(drei.abfrage, "voll", "nach 90 s liest die Route voll");
  assert.equal(drei.eintrag.freigabe_sperre, "Rechte laut Prüfprotokoll nicht geklärt");
  t.mock.timers.tick(FEHLERSTAND);
  const vier = await stapelEintrag();
  assert.equal(vier.abfrage, "unveraendert", "ohne Lesefehler gilt der Stand wieder bis zu 30 min");
  assert.equal(vier.eintrag.freigabe_sperre, "Rechte laut Prüfprotokoll nicht geklärt");
  // Reihenfolge: erst die Kennung (beantwortet), dann die Medien-Zeilen — die Kennung ist nie jünger als die Daten.
  freigabenCache.setzeFreigabenZurueck();
  const reihe = [];
  welt.vorAntwort = async (a) => {
    if (a.art !== "supabase") return;
    if (a.tabelle === "studio_pruefung" && a.params.get("limit") === "1") {
      reihe.push("kennung:start");
      await new Promise((r) => setTimeout(r, 25));
      reihe.push("kennung:ende");
    } else if (a.tabelle === "studio_medium" || a.tabelle === "studio_pruefung") {
      reihe.push(a.tabelle);
    }
  };
  try {
    assert.equal((await stapelEintrag()).abfrage, "voll");
  } finally {
    welt.vorAntwort = null;
  }
  const ende = reihe.indexOf("kennung:ende");
  assert.ok(ende >= 0 && ende < reihe.indexOf("studio_medium") && ende < reihe.indexOf("studio_pruefung"), reihe.join(" → "));
});

/** Zwei weitere Videos neben video(): Ketten 11 → 12 → 13 und 21 → 22 → 23, je mit einem Prüfprotokoll wie das von 3. */
function weitereVideos() {
  const [sb, og, ex] = welt.tabellen.studio_medium;
  const proto = protokolle()[0];
  for (const basis of [10, 20]) {
    const h = (n) => (basis + n).toString(16).padStart(2, "0").repeat(32); // eindeutig je id, 64 Hex-Zeichen
    welt.tabellen.studio_medium.push(
      { ...sb, id: basis + 1, sha256: h(1), speicher_pfad: `${SLUG}/${h(1)}.png` },
      { ...og, id: basis + 2, sha256: h(2), speicher_pfad: `${SLUG}/${h(2)}.mp4`, startbild_id: basis + 1 },
      { ...ex, id: basis + 3, sha256: h(3), speicher_pfad: `${SLUG}/${h(3)}.mp4`, abgeleitet_von: basis + 2 },
    );
    welt.tabellen.studio_pruefung.push({ ...proto, id: proto.id + basis, medium_id: basis + 3, medium_sha256: h(3) });
  }
  for (const [id, medium_id] of [[51, 13], [52, 23]]) {
    legeAn({ id, title: `Caption ${id}`, status: "zur_freigabe", body: CAPTION, review_notes: "Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG", metadata: captionMeta(medium_id) });
  }
}

test("MP-24 Stapel liest Videos in Sammelabfragen (Nachtrag d1-regression-1, d1-nachweis-6, d1-regression-3): Kennung, drei Rundreisen für die Ketten (gleich wie viele Videos) und die Protokolle je Video — jede Abfrage mit eigenem Zeitlimit von 8 s wie bei Karte und Freigeben, keine mit dem Signal der content-Abfrage; Urteile wie auf der Studio-Karte", async (t) => {
  const { ABFRAGE_TIMEOUT_MS } = await lade("src/lib/status-server.ts");
  const erzeugt = new Map();
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const signal = original.call(AbortSignal, ms);
    erzeugt.set(signal, ms);
    return signal;
  });
  /** Eine volle Stapel-Abfrage; je Supabase-Anfrage Tabelle, Abfrage und Signal. */
  async function messen() {
    freigabenCache.setzeFreigabenZurueck();
    const gesehen = [];
    welt.vorAntwort = async (a) => {
      if (a.art === "supabase") gesehen.push({ tabelle: a.tabelle, query: decodeURIComponent(a.url.search.slice(1)), signal: a.signal, abgebrochen: a.signal?.aborted ?? null });
    };
    try {
      const { s, abfrage } = await stapelEintrag();
      assert.equal(abfrage, "voll");
      return { s, gesehen };
    } finally {
      welt.vorAntwort = null;
    }
  }
  const pruefen = ({ gesehen }, exporte) => {
    const content = gesehen.filter((g) => g.tabelle === "content");
    const studio = gesehen.filter((g) => g.tabelle.startsWith("studio_"));
    const kennung = studio.filter((g) => g.tabelle === "studio_pruefung" && /(?:^|&)limit=1(?:&|$)/.test(g.query));
    const medien = studio.filter((g) => g.tabelle === "studio_medium");
    const protokolleJe = studio.filter((g) => g.tabelle === "studio_pruefung" && !kennung.includes(g));
    assert.equal(content.length, 2);
    assert.equal(new Set(content.map((g) => g.signal)).size, 1, "volles content-Paar: ein Signal");
    assert.equal(kennung.length, 1, "eine Kennung");
    assert.equal(medien.length, 3, "drei Rundreisen für die Ketten, gleich wie viele Videos");
    assert.deepEqual(medien.map((g) => inListe(g.query, "id")), [exporte, exporte.map((e) => e - 1), exporte.map((e) => e - 2)], "Medien, Originale, Startbilder");
    assert.deepEqual(protokolleJe.map((g) => Number(/(?:^|&)medium_id=eq\.(\d+)/.exec(g.query)?.[1])).sort((x, y) => x - y), exporte, "Protokolle je Video");
    for (const g of studio) {
      assert.equal(erzeugt.get(g.signal), ABFRAGE_TIMEOUT_MS, `eigenes Zeitlimit von 8 s: ${g.tabelle} ${g.query}`);
      assert.equal(g.abgebrochen, false);
      assert.ok(!content.some((c) => c.signal === g.signal), "nie das Signal der content-Abfrage");
    }
    assert.equal(new Set(studio.map((g) => g.signal)).size, studio.length, "jede Abfrage ihr eigenes Signal (Kennung eingeschlossen)");
  };
  // Ein Video.
  video();
  await pruefe(3, eingabe({ rechte_status: "offen", rechte_nachweis: null }));
  caption();
  pruefen(await messen(), [3]);
  // Drei Videos: dieselbe Zahl an Rundreisen; jedes Urteil wie auf der Studio-Karte.
  weitereVideos();
  const drei = await messen();
  pruefen(drei, [3, 13, 23]);
  const vorStudio = welt.log.length;
  const studio = await (await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) })).json();
  // Alle Videos gehören zum Objekt: Die Karte liest keine fremden Medien nach (Nachtrag d1-nachweis-3, F3).
  assert.ok(!welt.log.slice(vorStudio).some((l) => l.tabelle === "studio_medium" && inListe(l.query, "id") !== undefined), "im Normalfall keine Abfrage nach fremden Medien");
  for (const id of ["50", "51", "52"]) {
    const eintrag = drei.s.wartend.find((e) => e.id === id);
    const karte = studio.assets.wert.find((a) => String(a.id) === id);
    assert.equal(eintrag.freigabe_sperre, "Rechte laut Prüfprotokoll nicht geklärt", id);
    assert.equal(karte.freigabe_sperre, eintrag.freigabe_sperre, `Karte ${id}`);
  }
});

test("MP-26 leseKetten (Nachtrag d1-regression-1): je Medium dieselbe Kette wie leseKette einzeln — auch mit Original aus einem anderen Objekt, falscher Fassung, fehlenden oder unlesbaren Zeilen, geteiltem Original und unbekannter id; eine gescheiterte Rundreise trifft nur die Ketten, die sie brauchen", async () => {
  const urteil = await lade("src/lib/studio/medien-urteil.ts");
  const { createServiceClient } = await lade("src/lib/supabase.ts");
  const client = createServiceClient();
  video();
  await pruefe(3, eingabe());
  weitereVideos();
  const zeilen = welt.tabellen.studio_medium;
  const [sb, og, ex] = zeilen;
  zeilen.find((z) => z.id === 12).objekt_slug = "villa-x"; // Original aus einem anderen Objekt
  zeilen.find((z) => z.id === 22).fassung = "export"; // Original mit falscher Fassung
  const h = (n) => n.toString(16).padStart(2, "0").repeat(32);
  zeilen.push(
    { ...ex, id: 33, sha256: h(33), abgeleitet_von: 2 }, // teilt sich das Original 2 mit Export 3
    { ...ex, id: 43, sha256: h(43), abgeleitet_von: null }, // ohne Original
    { ...ex, id: 53, sha256: h(53), abgeleitet_von: 99 }, // Original fehlt
    { ...og, id: 62, sha256: h(62), startbild_id: 98 }, // Startbild fehlt
    { ...ex, id: 63, sha256: h(63), abgeleitet_von: 62 },
    { ...og, id: 72, sha256: h(72), art: "ton" }, // unlesbare Zeile
    { ...ex, id: 73, sha256: h(73), abgeleitet_von: 72 },
    { ...sb, id: 81, sha256: h(81), objekt_slug: "villa-x" }, // Startbild aus einem anderen Objekt
    { ...og, id: 82, sha256: h(82), startbild_id: 81 },
    { ...ex, id: 83, sha256: h(83), abgeleitet_von: 82 },
  );
  const ids = [2, 3, 13, 23, 33, 43, 53, 63, 73, 77, 83];
  const gesammelt = await urteil.leseKetten(client, ids);
  for (const id of ids) assert.deepEqual(gesammelt.get(id), await urteil.leseKette(client, id, null), `Kette ${id}`);
  // Stichproben, damit der Vergleich nicht leer ausgeht.
  assert.equal(gesammelt.get(3).original.id, 2);
  assert.equal(gesammelt.get(3).startbild.id, 1);
  assert.equal(gesammelt.get(13).original, null, "fremdes Objekt");
  assert.equal(gesammelt.get(23).original, null, "falsche Fassung");
  assert.equal(gesammelt.get(63).startbild, null, "Startbild fehlt");
  assert.equal(gesammelt.get(83).startbild, null, "Startbild aus einem anderen Objekt");
  assert.deepEqual(gesammelt.get(77), { art: "fehlt" });
  assert.deepEqual(gesammelt.get(73), { art: "fehler", grund: "Zeile nicht lesbar: Medium 72: art unlesbar" });
  // Höchstens drei Rundreisen, jede id höchstens einmal gefragt.
  const vorher = welt.log.length;
  await urteil.leseKetten(client, ids);
  const runden = welt.log.slice(vorher).filter((l) => l.tabelle === "studio_medium").map((l) => inListe(l.query, "id"));
  assert.equal(runden.length, 3);
  assert.equal(new Set(runden.flat()).size, runden.flat().length, "keine id doppelt gefragt");
  // Eine Zeile ohne lesbare id lässt sich keiner Kette zuordnen: Die ganze Rundreise gilt als unlesbar, statt die
  // gefragten Medien als „fehlt“ zu melden.
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_medium" ? { status: 200, body: [{ ...zeilen.find((z) => z.id === 3), id: null }] } : null);
  try {
    const ohneId = await urteil.leseKetten(client, [3, 43]);
    assert.equal(ohneId.get(3).art, "fehler");
    assert.match(ohneId.get(3).grund, /^Zeile nicht lesbar: /);
    assert.deepEqual(ohneId.get(43), ohneId.get(3), "dieselbe Rundreise, derselbe Grund");
  } finally {
    welt.stoerung = null;
  }
  // Scheitert die zweite Rundreise (Originale), trifft das nur die Ketten mit Original; die ohne bleiben lesbar.
  let nr = 0;
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_medium" && (nr += 1) === 2 ? { status: 500, body: { message: "Rundreise 2 gestört" } } : null);
  try {
    const gestoert = await urteil.leseKetten(client, [3, 43]);
    assert.deepEqual(gestoert.get(3), { art: "fehler", grund: "Rundreise 2 gestört" });
    assert.equal(gestoert.get(43).art, "ok");
    assert.equal(gestoert.get(43).original, null);
  } finally {
    welt.stoerung = null;
  }
});

test("MP-27 Studio-Karte (Nachtrag d1-nachweis-3, F2): fremde Medien höchstens 25 je Anfrage nachgelesen — 26 Captions mit unbekannten Videos: 25 „nicht gefunden“, das mit der höchsten id „nicht ermittelt“, je wie im Stapel, solange dort keine weiteren Video-Captions stehen (d2-stapel-4 d)", async () => {
  freigabenCache.setzeFreigabenZurueck();
  video();
  for (let i = 0; i < 26; i += 1) {
    legeAn({ id: 200 + i, title: `Caption ${i}`, status: "zur_freigabe", body: CAPTION, review_notes: "URTEIL: FREIGABE-EMPFEHLUNG", metadata: captionMeta(101 + i) });
  }
  const vorher = welt.log.length;
  const studio = await (await studioRoute.GET(new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } }), { params: Promise.resolve({ objekt: SLUG }) })).json();
  const nachgelesen = welt.log.slice(vorher).filter((l) => l.tabelle === "studio_medium" && inListe(l.query, "id") !== undefined);
  assert.equal(nachgelesen.length, 1);
  assert.deepEqual(inListe(nachgelesen[0].query, "id"), Array.from({ length: 25 }, (_, i) => 101 + i), "höchstens 25, die kleinsten ids");
  const { s } = await stapelEintrag();
  for (let i = 0; i < 26; i += 1) {
    const karte = studio.assets.wert.find((a) => a.id === 200 + i);
    const eintrag = s.wartend.find((e) => e.id === String(200 + i));
    const erwartet = i < 25 ? `Medium ${101 + i} nicht gefunden` : "Urteil der Medien-Regel nicht ermittelt";
    assert.equal(karte.freigabe_sperre, erwartet, `Karte ${200 + i}`);
    assert.equal(eintrag.freigabe_sperre, erwartet, `Stapel ${200 + i}`);
  }
});

test("MP-28 Stapel: Lesefehler der Prüfprotokolle eines Videos (Nachtrag d1-regression-1) — „Medium 3 nicht lesbar“ mit Grund, nie „kein Prüfprotokoll“ oder frei; die Kennung bleibt lesbar", async () => {
  freigabenCache.setzeFreigabenZurueck();
  video();
  await pruefe(3, eingabe());
  caption();
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_pruefung" && a.params.get("limit") !== "1" ? { status: 500, body: { message: "Protokolle gestört" } } : null);
  try {
    const { eintrag, abfrage } = await stapelEintrag();
    assert.equal(abfrage, "voll");
    assert.equal(eintrag.freigabe_sperre, "Medium 3 nicht lesbar: Protokolle gestört");
    assert.deepEqual(eintrag.medium.gruende, ["Medium 3 nicht lesbar: Protokolle gestört"]);
  } finally {
    welt.stoerung = null;
  }
});

test("MP-29 Stapel (Nachtrag d2-stapel-1, d2-stapel-4 a): Die Protokolle je Video beginnen, bevor die erste Rundreise der Ketten endet (parallel, nicht danach); bei gestörten Protokollen zählt wie beim Freigeben zuerst gefunden, Objekt und Fassung", async () => {
  video();
  await pruefe(3, eingabe());
  caption();
  weitereVideos();
  // Parallelität: Die erste Rundreise (Medien) wird angehalten; die Protokolle müssen schon vorher beginnen.
  freigabenCache.setzeFreigabenZurueck();
  const reihe = [];
  let rundreise = 0;
  welt.vorAntwort = async (a) => {
    if (a.art !== "supabase") return;
    if (a.tabelle === "studio_medium" && (rundreise += 1) === 1) {
      reihe.push("kette1:start");
      await new Promise((r) => setTimeout(r, 40));
      reihe.push("kette1:ende");
    } else if (a.tabelle === "studio_pruefung" && a.params.get("limit") !== "1") {
      reihe.push(`protokoll:${a.params.get("medium_id")}`);
    }
  };
  try {
    assert.equal((await stapelEintrag()).abfrage, "voll");
  } finally {
    welt.vorAntwort = null;
  }
  const ende = reihe.indexOf("kette1:ende");
  const protokolle = reihe.filter((x) => x.startsWith("protokoll:"));
  assert.deepEqual(protokolle.sort(), ["protokoll:eq.13", "protokoll:eq.23", "protokoll:eq.3"]);
  for (const p of protokolle) assert.ok(reihe.indexOf(p) < ende, `${p} vor dem Ende der ersten Rundreise: ${reihe.join(" → ")}`);
  // Vorrang: Protokolle gestört — trotzdem erst nicht gefunden, fremdes Objekt, kein Export (wie mediumZurFreigabe).
  for (const [metadata, grund] of [
    [{ medium_id: 77 }, "Medium 77 nicht gefunden"],
    [{ objekt_slug: "villa-x" }, "Medium 3 gehört nicht zum Objekt dieser Zeile"],
    [{ medium_id: 2 }, "Medium ist kein Export"],
    [{}, "Medium 3 nicht lesbar: Protokolle gestört"],
  ]) {
    zuruecksetzen();
    freigabenCache.setzeFreigabenZurueck();
    video();
    await pruefe(3, eingabe());
    caption(metadata);
    welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_pruefung" && a.params.get("limit") !== "1" ? { status: 500, body: { message: "Protokolle gestört" } } : null);
    try {
      const { eintrag } = await stapelEintrag();
      assert.equal(eintrag.freigabe_sperre, grund, JSON.stringify(metadata));
    } finally {
      welt.stoerung = null;
    }
    if (grund !== "Medium 3 nicht lesbar: Protokolle gestört") {
      const server = await freigeben(50);
      assert.deepEqual([server.status, server.body.fehler], [409, grund], `Freigeben ${JSON.stringify(metadata)}`);
    }
  }
});

test("MP-25 Stapel bei dauerhaftem Medien-Lesefehler (Nachtrag d1-regression-2, d2-stapel-3): höchstens eine volle Abfrage je 90 s — 11 nacheinander laufende Anfragen im Takt von 30 s lesen viermal voll (bei 0, 90, 180 und 270 s), jede Antwort nennt den Lesefehler", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-10T15:00:00.000Z") });
  freigabenCache.setzeFreigabenZurueck();
  video();
  await pruefe(3, eingabe());
  caption();
  welt.stoerung = (a) => (a.art === "supabase" && a.tabelle === "studio_medium" ? { status: 500, body: { message: "Dauerstörung" } } : null);
  const arten = [];
  const vorher = welt.log.length;
  try {
    for (let i = 0; i < 11; i += 1) {
      if (i > 0) t.mock.timers.tick(30_000);
      const r = await stapelEintrag();
      arten.push(r.abfrage);
      assert.match(r.eintrag.freigabe_sperre, /^Medium 3 nicht lesbar: Dauerstörung/, `Anfrage ${i}`);
    }
  } finally {
    welt.stoerung = null;
  }
  assert.deepEqual(arten.map((a, i) => (a === "voll" ? i * 30 : null)).filter((x) => x !== null), [0, 90, 180, 270], arten.join(", "));
  const volleContent = welt.log.slice(vorher).filter((l) => l.tabelle === "content" && /(?:^|&)select=[^&]*body/.test(l.query));
  assert.equal(volleContent.length, 8, "vier volle Paare content (wartend und hängend)");
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
  // Einzelbild-Ziel (Nachbesserung regel8-1): Mitte des Nachbarbilds; am Ende auf das letzte Bild gekappt.
  assert.equal(P.schrittZiel(0, 1, 24, 60), 1.5 / 24);
  assert.equal(P.schrittZiel(0.041666, 1, 24, 60), 1.5 / 24, "die abgeschnittene Grenze (Chrome) zählt zum vorigen Bild");
  assert.equal(P.schrittZiel(1.5 / 24, 1, 24, 60), 2.5 / 24);
  assert.equal(P.schrittZiel(1.5 / 24, -1, 24, 60), 0.5 / 24);
  assert.equal(P.schrittZiel(0, -1, 24, 60), 0.5 / 24, "nie vor das erste Bild");
  assert.equal(P.schrittZiel(2.5, -1, 24, 60), 58.5 / 24, "ab dem Ende (Zeit = Dauer): das vorletzte Bild");
  assert.equal(P.schrittZiel(59.5 / 24, 1, 24, 60), 59.5 / 24, "nie hinter das letzte Bild");
  assert.equal(P.schrittZiel(2.5, -1, 24, null), 59.5 / 24, "ohne Bildzahl ungekappt");
  assert.equal(P.schrittZiel(1.3015, 1, 25, null), 33.5 / 25, "andere Bildrate");
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
    // Nachbesserung regel8-5: die Einzelurteile zum Anker als erste Zeile der Notiz.
    notiz: "Anker: Architektur bestanden · Personen bestanden · Wasser nicht bestanden",
  });
  assert.equal(P.alsAnfrage({ ...voll, notiz: " eigene Notiz " }, EXPORT_SHA, klauseln).notiz, "Anker: Architektur bestanden · Personen bestanden · Wasser nicht bestanden\neigene Notiz");
  assert.equal(P.ankerVermerk({ architektur: null, personen: "nicht_bestanden", wasser: "bestanden" }), "Anker: Architektur offen · Personen nicht bestanden · Wasser bestanden");
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
  // Nachbesserung regel8-4 und oberflaeche-10: Anker ab 768 px neben dem Video; das Video hat einen Namen.
  assert.match(html, /class="grid grid-cols-1 md:grid-cols-2 gap-4"/);
  assert.match(html, /<video[^>]*aria-label="Export #3 in voller Bildrate"/);
  assert.match(html, /<textarea[^>]*maxLength="900"[^>]*data-notiz/);
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
    notiz: "Anker: Architektur bestanden · Personen bestanden · Wasser nicht bestanden",
  });
  const ergebnis = finde(baum, (n) => n.props?.["data-pruef-ergebnis"] !== undefined);
  assert.equal(ergebnis.props["data-pruef-ergebnis"], "nicht_bestanden");
  assert.equal(neu, 1, "Studio lädt nach dem Speichern neu");
  assert.equal(protokolle().length, 1);
  assert.equal(protokolle()[0].rechte_status, "offen");
});

// ═══ Prüfansicht mit Video-Attrappe (Nachbesserung regel8-1, regel8-2, mutanten-5) ═══

/** Knoten im aufgelösten Baum der Hook-Laufzeit (Tiefensuche). */
function findeKnoten(k, pred) {
  if (Array.isArray(k)) {
    for (const c of k) {
      const r = findeKnoten(c, pred);
      if (r) return r;
    }
  } else if (k && typeof k === "object") {
    if (pred(k)) return k;
    return findeKnoten(k.kinder, pred);
  }
  return null;
}

/**
 * Video-Attrappe nach dem in Chrome gemessenen Verhalten (Gegenprüfung regel8-1): currentTime wird auf ganze µs
 * abgeschnitten gespeichert (1/24 → 0,041666), Bild k liegt bei round(k/fps · 10⁶) µs (Bild 1 bei 41667 µs); gezeigt
 * wird das letzte Bild mit Zeitstempel ≤ currentTime. requestVideoFrameCallback meldet ein dargestelltes Bild einmal
 * je Anmeldung (zeige), mit wachsender Uhr wie im Browser.
 */
function videoAttrappe({ fps, bilder }) {
  const us = (k) => Math.round((k / fps) * 1e6);
  let t = 0;
  let uhr = 0;
  let naechster = 1;
  const rueckrufe = new Map();
  const v = {
    duration: bilder / fps,
    pausiert: false,
    playbackRate: 1,
    pause() {
      v.pausiert = true;
    },
    get currentTime() {
      return t / 1e6;
    },
    set currentTime(s) {
      t = Math.max(0, Math.floor(s * 1e6));
    },
    requestVideoFrameCallback(cb) {
      const h = naechster++;
      rueckrufe.set(h, cb);
      return h;
    },
    cancelVideoFrameCallback(h) {
      rueckrufe.delete(h);
    },
    /** Bild unter der aktuellen Zeit: das letzte mit Zeitstempel ≤ currentTime. */
    bild() {
      let k = 0;
      while (k + 1 < bilder && us(k + 1) <= t) k += 1;
      return k;
    },
    /** Bild k (Standard: das unter der Zeit) darstellen — jeder angemeldete Rückruf genau einmal. */
    zeige(k = v.bild()) {
      const cbs = [...rueckrufe.values()];
      rueckrufe.clear();
      for (const cb of cbs) cb((uhr += 16.7), { mediaTime: us(k) / 1e6, presentedFrames: uhr });
    },
    anmeldungen: () => rueckrufe.size,
  };
  return v;
}

test("MP-18 Prüfansicht mit Video-Attrappe (Chrome-Verhalten): Zähler zählt distinkte Bilder; ± 1 Bild trifft vorwärts und rückwärts jedes Bild, auch ab dem Ende; der Quellwechsel zählt neu", async () => {
  video();
  const k = await kette();
  const lz = hookLaufzeit();
  const P2 = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }).pruef;
  lz.setzeWurzel(P2.PruefAnsicht, { slug: SLUG, kette: k, anker: HOF, dateiAdresse: (id) => `/x/${id}`, holen: async () => new Response("{}"), gespeichert: () => {} });
  const ref = findeKnoten(lz.rendere(), (n) => n.type === "video").props.ref;
  // Wie React: Der Ref hängt am Element, bevor die Effekte laufen — hier: setzen, dann Effekte erneut.
  const v = videoAttrappe({ fps: 24, bilder: 60 });
  ref.current = v;
  lz.abbauen();
  lz.wiederAufbauen();
  assert.equal(v.anmeldungen(), 1, "der Effekt meldet requestVideoFrameCallback an");
  const zaehler = () => findeKnoten(lz.rendere(), (n) => n.props?.["data-bildzaehler"] !== undefined).props["data-bildzaehler"];
  const knopf = (attr) => findeKnoten(lz.rendere(), (n) => n.type === "button" && n.props[attr] !== undefined).props;
  // Sieben Meldungen auf drei Bilder (Pause, Zeitlupe, Rücksprung): gezählt werden drei.
  for (const bild of [0, 0, 1, 1, 2, 2, 1]) v.zeige(bild);
  assert.equal(zaehler(), "3/60");
  assert.equal(v.anmeldungen(), 1, "nach jeder Meldung neu angemeldet");
  // Vorwärts ab 0: jeder Druck genau ein Bild weiter, jedes Bild 1 … 59 einmal; das Video steht.
  v.currentTime = 0;
  const vor = [];
  for (let i = 0; i < 59; i += 1) {
    knopf("data-bild-vor").onClick();
    v.zeige();
    vor.push(v.bild());
  }
  assert.deepEqual(vor, Array.from({ length: 59 }, (_, i) => i + 1));
  assert.equal(v.pausiert, true);
  assert.equal(zaehler(), "60/60");
  knopf("data-bild-vor").onClick();
  assert.equal(v.bild(), 59, "am letzten Bild bleibt + 1 dort");
  // Rückwärts ab dem Ende (abgespielt: Zeit = Dauer): der erste Druck wirkt, jedes Bild 58 … 0 einmal.
  v.currentTime = v.duration;
  assert.equal(v.bild(), 59);
  const zurueck = [];
  for (let i = 0; i < 59; i += 1) {
    knopf("data-bild-zurueck").onClick();
    zurueck.push(v.bild());
  }
  assert.deepEqual(zurueck, Array.from({ length: 59 }, (_, i) => 58 - i));
  knopf("data-bild-zurueck").onClick();
  assert.equal(v.bild(), 0, "am ersten Bild bleibt − 1 dort");
  // Aus einer Pause mitten im Bild: genau ein Bild in jede Richtung.
  v.currentTime = 1.3015;
  assert.equal(v.bild(), 31);
  knopf("data-bild-vor").onClick();
  assert.equal(v.bild(), 32);
  knopf("data-bild-zurueck").onClick();
  knopf("data-bild-zurueck").onClick();
  assert.equal(v.bild(), 30);
  // Quellwechsel auf das Original: alte Anmeldung aufgehoben, die neue Quelle zählt von 0.
  const v2 = videoAttrappe({ fps: 24, bilder: 108 });
  ref.current = v2;
  knopf("data-quelle-wechsel").onClick();
  lz.rendere();
  assert.equal(v.anmeldungen(), 0, "Anmeldung am Export aufgehoben");
  assert.equal(v2.anmeldungen(), 1, "am Original angemeldet");
  assert.equal(zaehler(), "0/108");
  v2.zeige(0);
  v2.zeige(1);
  v2.zeige(1);
  assert.equal(zaehler(), "2/108");
});

test("MP-18b Prüfansicht (Nachtrag d1-nachweis-5): Die Bildzahl kommt aus der Dauer des geladenen Videos, erst ohne sie aus dem Beleg — Beleg 2,53 s, Video 60 Bilder (2,5 s): der erste Rückschritt ab dem Ende trifft Bild 58", async () => {
  video({ export: { dauer_s: 2.53 } });
  const k = await kette();
  assert.equal(k.export.dauer_s, 2.53);
  const lz = hookLaufzeit();
  const P2 = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }).pruef;
  lz.setzeWurzel(P2.PruefAnsicht, { slug: SLUG, kette: k, anker: HOF, dateiAdresse: (id) => `/x/${id}`, holen: async () => new Response("{}"), gespeichert: () => {} });
  const ref = findeKnoten(lz.rendere(), (n) => n.type === "video").props.ref;
  const v = videoAttrappe({ fps: 24, bilder: 60 });
  ref.current = v;
  lz.abbauen();
  lz.wiederAufbauen();
  const knopf = (attr) => findeKnoten(lz.rendere(), (n) => n.type === "button" && n.props[attr] !== undefined).props;
  // Nach dem Beleg wären es 61 Bilder (2,53 × 24 gerundet), und der erste Druck bliebe am letzten Bild stehen.
  v.currentTime = v.duration;
  assert.equal(v.bild(), 59);
  knopf("data-bild-zurueck").onClick();
  assert.equal(v.bild(), 58);
  knopf("data-bild-vor").onClick();
  knopf("data-bild-vor").onClick();
  assert.equal(v.bild(), 59, "vorwärts bleibt am letzten Bild des Videos");
});


test("MP-22 Prüfansicht (Nachbesserung oberflaeche-4): Videofehler mit eigenem Zustand und neutraler Ursache; „Video neu laden“ lädt nur das Video (frische Anfrage), Eingaben und gesehene Bilder bleiben; der Prüfbereich hält die Eingaben über Schließen und Öffnen", async () => {
  video();
  const k = await kette();
  const lz = hookLaufzeit();
  const B = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln });
  lz.setzeWurzel(B.pruef.PruefAnsicht, { slug: SLUG, kette: k, anker: HOF, dateiAdresse: (id) => `/api/studio/${SLUG}/medien/${id}/datei`, holen: async () => new Response("{}"), gespeichert: () => {} });
  const baum = () => lz.rendere();
  const radio = (wurzel, punkt, i) => {
    const feld = findeKnoten(wurzel, (n) => n.type === "fieldset" && n.props["data-pruefpunkt"] === punkt);
    const radios = [];
    (function sammle(n) { if (Array.isArray(n)) n.forEach(sammle); else if (n && typeof n === "object") { if (n.type === "input" && n.props.type === "radio") radios.push(n); sammle(n.kinder); } })(feld);
    return radios[i];
  };
  radio(baum(), "architektur", 0).props.onChange();
  // Videofehler: eigener Zustand, neutrale Ursache, kein Rat zum Schließen.
  findeKnoten(baum(), (n) => n.type === "video").props.onError();
  const meldung = () => findeKnoten(baum(), (n) => n.props?.["data-video-fehler"] !== undefined);
  assert.ok(meldung(), "Meldung da");
  assert.equal(findeKnoten(meldung(), (n) => n.type === "p").kinder, B.pruef.VIDEO_FEHLER_TEXT);
  assert.doesNotMatch(B.pruef.VIDEO_FEHLER_TEXT, /Ansicht neu öffnen/);
  radio(baum(), "wasser", 1).props.onChange();
  assert.ok(meldung(), "ein Klick auf einen Prüfpunkt löscht die Meldung nicht");
  // Gesehene Bilder vor dem Neuladen.
  const ref = findeKnoten(baum(), (n) => n.type === "video").props.ref;
  const v1 = videoAttrappe({ fps: 24, bilder: 60 });
  ref.current = v1;
  lz.abbauen();
  lz.wiederAufbauen();
  v1.zeige(0);
  v1.zeige(1);
  const zaehler = () => findeKnoten(baum(), (n) => n.props?.["data-bildzaehler"] !== undefined).props["data-bildzaehler"];
  assert.equal(zaehler(), "2/60");
  // Neu laden: neue Anfrage an die Datei-Route, Meldung weg, Eingaben und Zählung bleiben.
  const v2 = videoAttrappe({ fps: 24, bilder: 60 });
  ref.current = v2;
  findeKnoten(baum(), (n) => n.type === "button" && n.props["data-video-neu-laden"] !== undefined).props.onClick();
  assert.equal(findeKnoten(baum(), (n) => n.type === "video").props.src, `/api/studio/${SLUG}/medien/3/datei?neu=1`);
  assert.equal(meldung(), null);
  assert.equal(v1.anmeldungen(), 0, "altes Element abgemeldet");
  assert.equal(v2.anmeldungen(), 1, "neues Element angemeldet");
  v2.zeige(1);
  v2.zeige(2);
  assert.equal(zaehler(), "3/60", "Bild 1 schon gesehen, Bild 2 neu");
  assert.equal(radio(baum(), "architektur", 0).props.checked, true);
  assert.equal(radio(baum(), "wasser", 1).props.checked, true);

  // Prüfbereich (Medien-Panel) als Wurzel: Er reicht seine gehaltenen Eingaben an die Ansicht; Schließen und Öffnen
  // verliert sie nicht. Die Ansicht wird mitgeschnitten, damit sichtbar ist, was sie bekommt.
  const lz2 = hookLaufzeit();
  const B2 = ladeStudioBausteine({ ...lz2.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln });
  const aufrufe = [];
  const pruef = { ...B2.pruef, PruefAnsicht: (props) => (aufrufe.push(props), B2.pruef.PruefAnsicht(props)) };
  const M = ladeMedienPanel({ ...lz2.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }, { anker: ladeTsx("lib/studio/anker.ts", {}), types: ladeTsx("lib/types.ts", {}), hilfen: B2.hilfen, pruef });
  lz2.setzeWurzel(M.PruefBereich, { k, slug: SLUG, anker: HOF, holen: async () => new Response("{}"), neuLaden: () => {} });
  const baum2 = () => lz2.rendere();
  const oeffne = (offen) => findeKnoten(baum2(), (n) => n.type === "details").props.onToggle({ currentTarget: { open: offen } });
  oeffne(true);
  radio(baum2(), "personen", 1).props.onChange();
  baum2();
  assert.equal(aufrufe.at(-1).gehalten.wert.personen, "nicht_bestanden", "der Bereich hält die Eingabe");
  oeffne(false);
  assert.equal(findeKnoten(baum2(), (n) => n.type === "video"), null, "geschlossen: kein Video");
  const vorher = aufrufe.length;
  oeffne(true);
  baum2();
  assert.ok(aufrufe.length > vorher, "wieder geöffnet");
  assert.equal(aufrufe.at(-1).gehalten.wert.personen, "nicht_bestanden", "nach dem Wiederöffnen erhalten");
  assert.equal(radio(baum2(), "personen", 1).props.checked, true);
});

test("MP-30 Prüfbereich (Nachtrag d2-oberflaeche-2): Nach dem Speichern, Schließen und Öffnen bleibt „Prüfprotokoll speichern“ ohne Änderung gesperrt — kein zweites gleiches Protokoll; nach einer Änderung wieder frei", async () => {
  video();
  const k = await kette();
  const lz = hookLaufzeit();
  const B = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln });
  const gesendet = [];
  const holen = async (url, init) => {
    gesendet.push(JSON.parse(init.body));
    const req = new NextRequest(`http://harness.local${url}`, { method: "POST", headers: { ...init.headers, "sec-fetch-site": "same-origin" }, body: init.body });
    return pruefRoute.POST(req, { params: Promise.resolve({ objekt: SLUG, id: "3" }) });
  };
  const M = ladeMedienPanel({ ...lz.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }, { anker: ladeTsx("lib/studio/anker.ts", {}), types: ladeTsx("lib/types.ts", {}), hilfen: B.hilfen });
  lz.setzeWurzel(M.PruefBereich, { k, slug: SLUG, anker: HOF, holen, neuLaden: () => {} });
  const baum = () => lz.rendere();
  const oeffne = (offen) => findeKnoten(baum(), (n) => n.type === "details").props.onToggle({ currentTarget: { open: offen } });
  const waehle = (punkt, i) => {
    const feld = findeKnoten(baum(), (n) => n.type === "fieldset" && n.props["data-pruefpunkt"] === punkt);
    const radios = [];
    (function sammle(n) { if (Array.isArray(n)) n.forEach(sammle); else if (n && typeof n === "object") { if (n.type === "input" && n.props.type === "radio") radios.push(n); sammle(n.kinder); } })(feld);
    radios[i].props.onChange();
  };
  const form = () => findeKnoten(baum(), (n) => n.type === "form");
  const knopf = () => findeKnoten(baum(), (n) => n.type === "button" && n.props["data-protokoll-speichern"] !== undefined);
  const hinweis = () => findeKnoten(baum(), (n) => n.props?.["data-erneut-speichern"] !== undefined);
  oeffne(true);
  for (const punkt of ["klausel-licht", "klausel-rahmen", "architektur", "personen", "wasser", "hinweis"]) waehle(punkt, 0);
  findeKnoten(baum(), (n) => n.props?.["data-durchsicht"] !== undefined && n.type === "input").props.onChange({ currentTarget: { checked: true } });
  findeKnoten(baum(), (n) => n.props?.["data-kuerzel"] !== undefined && n.type === "input").props.onChange({ currentTarget: { value: "TS" } });
  form().props.onSubmit({ preventDefault() {} });
  await lz.ruhe();
  assert.equal(gesendet.length, 1);
  assert.equal(protokolle().length, 1);
  // Schließen und Öffnen baut die Ansicht neu auf: gesperrt, mit Hinweis, kein zweiter POST.
  oeffne(false);
  baum();
  oeffne(true);
  assert.equal(knopf().props["aria-disabled"], true, "nach Schließen und Öffnen gesperrt");
  assert.ok(hinweis(), "Hinweis „Gespeichert. Ein weiteres Protokoll erst nach einer Änderung“");
  form().props.onSubmit({ preventDefault() {} });
  await lz.ruhe();
  assert.equal(gesendet.length, 1, "kein zweites gleiches Protokoll");
  assert.equal(protokolle().length, 1);
  // Nach einer Änderung wieder frei; zurück zur gespeicherten Auswahl wieder gesperrt.
  waehle("wasser", 1);
  assert.equal(knopf().props["aria-disabled"], false);
  waehle("wasser", 0);
  assert.equal(knopf().props["aria-disabled"], true, "gleich der gespeicherten Anfrage");
  waehle("wasser", 1);
  form().props.onSubmit({ preventDefault() {} });
  await lz.ruhe();
  assert.equal(gesendet.length, 2);
  assert.equal(protokolle().length, 2);
});

test("MP-23 Prüfansicht (Nachbesserung oberflaeche-7): Felder während des Speicherns gesperrt; nach Erfolg kein zweites Protokoll ohne Änderung; jede Änderung (auch eine Klausel) gibt den Knopf frei; Enter in einem Eingabefeld sendet nicht ab", async () => {
  video();
  const k = await kette();
  const lz = hookLaufzeit();
  const P2 = ladeStudioBausteine({ ...lz.attrappen, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln }).pruef;
  const gesendet = [];
  let tor = null;
  const holen = async (url, init) => {
    gesendet.push(JSON.parse(init.body));
    if (tor) await tor;
    const req = new NextRequest(`http://harness.local${url}`, { method: "POST", headers: { ...init.headers, "sec-fetch-site": "same-origin" }, body: init.body });
    return pruefRoute.POST(req, { params: Promise.resolve({ objekt: SLUG, id: "3" }) });
  };
  lz.setzeWurzel(P2.PruefAnsicht, { slug: SLUG, kette: k, anker: HOF, dateiAdresse: (id) => `/x/${id}`, holen, gespeichert: () => {} });
  const baum = () => lz.rendere();
  const waehle = (punkt, wert) => {
    const feld = findeKnoten(baum(), (n) => n.type === "fieldset" && n.props["data-pruefpunkt"] === punkt);
    const radios = [];
    (function sammle(n) { if (Array.isArray(n)) n.forEach(sammle); else if (n && typeof n === "object") { if (n.type === "input" && n.props.type === "radio") radios.push(n); sammle(n.kinder); } })(feld);
    radios[wert === "bestanden" ? 0 : 1].props.onChange();
  };
  for (const [punkt, w] of [["klausel-licht", "bestanden"], ["klausel-rahmen", "bestanden"], ["architektur", "bestanden"], ["personen", "bestanden"], ["wasser", "bestanden"], ["hinweis", "bestanden"]]) waehle(punkt, w);
  findeKnoten(baum(), (n) => n.props?.["data-durchsicht"] !== undefined && n.type === "input").props.onChange({ currentTarget: { checked: true } });
  findeKnoten(baum(), (n) => n.props?.["data-kuerzel"] !== undefined && n.type === "input").props.onChange({ currentTarget: { value: "TS" } });
  const form = () => findeKnoten(baum(), (n) => n.type === "form");
  const knopf = () => findeKnoten(baum(), (n) => n.type === "button" && n.props["data-protokoll-speichern"] !== undefined);
  // Enter in einem Eingabefeld: kein Absenden; im Textfeld der Notiz: Zeilenumbruch erlaubt.
  let verhindert = 0;
  form().props.onKeyDown({ key: "Enter", target: { tagName: "INPUT" }, preventDefault: () => (verhindert += 1) });
  form().props.onKeyDown({ key: "Enter", target: { tagName: "TEXTAREA" }, preventDefault: () => (verhindert += 1) });
  assert.equal(verhindert, 1);
  // Während des Speicherns: Felder gesperrt.
  let oeffnen;
  tor = new Promise((f) => (oeffnen = f));
  form().props.onSubmit({ preventDefault() {} });
  assert.equal(findeKnoten(baum(), (n) => n.type === "fieldset" && n.props["data-pruef-felder"] !== undefined).props.disabled, true, "Felder gesperrt");
  assert.equal(knopf().props["aria-disabled"], true);
  form().props.onSubmit({ preventDefault() {} });
  oeffnen();
  tor = null;
  await lz.ruhe();
  assert.equal(gesendet.length, 1, "kein zweites Absenden während des Speicherns");
  assert.ok(findeKnoten(baum(), (n) => n.props?.["data-pruef-ergebnis"] !== undefined), "Protokoll gespeichert");
  // Nach Erfolg: gesperrt bis zur nächsten Änderung.
  assert.equal(knopf().props["aria-disabled"], true, "nach Erfolg gesperrt");
  form().props.onSubmit({ preventDefault() {} });
  await lz.ruhe();
  assert.equal(gesendet.length, 1, "kein zweites Protokoll ohne Änderung");
  assert.equal(protokolle().length, 1);
  // Eine Klausel ändern gibt frei (vorher setzten Klauseln den Stand nicht zurück).
  waehle("klausel-rahmen", "nicht_bestanden");
  assert.equal(knopf().props["aria-disabled"], false);
  form().props.onSubmit({ preventDefault() {} });
  await lz.ruhe();
  assert.equal(gesendet.length, 2);
  assert.equal(protokolle().length, 2);
});
