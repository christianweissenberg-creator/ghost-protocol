// Attrappe für den privaten Bucket „studio“ und die Tabellen studio_medium, studio_pruefung und studio_messplan
// (Objekt-Studio Schritt 7, 10.11.2026). Teil der Fake-Welt (tests/harness/fake.mjs); kein Netz.
//
// Storage (Pfade wie @supabase/storage-js 2.100.1, node_modules/@supabase/storage-js/dist/index.cjs):
// - POST /storage/v1/object/upload/sign/studio/<pfad>      → {url: "/object/upload/sign/studio/<pfad>?token=…"}
// - PUT  /storage/v1/object/upload/sign/studio/<pfad>?token  → legt die Datei an (ohne x-upsert: true nie überschreiben)
// - GET  /storage/v1/object/studio/<pfad>                   → Inhalt; fehlt die Datei: HTTP 400 mit statusCode "404"
//   (so antwortete Storage lange; nichtGefundenStatus = 404 stellt die neuere Antwort nach)
// - POST /storage/v1/object/move {bucketId, sourceKey, destinationKey} → verschiebt nur auf einen freien Pfad
// - DELETE /storage/v1/object/studio {prefixes}              → löscht genau diese Pfade
// - POST /storage/v1/object/list/studio {prefix, limit, offset} → eine Ebene unter dem Präfix
// - POST /storage/v1/object/sign/studio/<pfad> {expiresIn}   → {signedURL: "/object/sign/studio/<pfad>?token=…"}
// Jeder Aufruf steht in welt.studio.log ({op, pfad, ziel?, upsert?, …}); welt.stoerung bekommt {art: "storage", op, pfad}.
//
// Tabellen: was der Code voraussetzt, damit die Tests es prüfen können:
// - Lesen und Einfügen nur mit dem Service-Schlüssel; mit jedem anderen Schlüssel 42501. id, eingespielt_am bzw.
//   geprueft_am und die berechneten Spalten darf der Server nicht senden (42501); die DB-Uhr setzt die Attrappe
//   selbst (zeitstempel der Fake-Welt). UPDATE und DELETE: 42501 (nur anhängbar).
// - CHECK → 23514 (HTTP 400), UNIQUE → 23505 (HTTP 409), Fremdschlüssel → 23503 (HTTP 409), unbekannte Spalte →
//   PGRST204 (HTTP 400). messplanFehlt = true: studio_messplan antwortet wie eine fehlende Tabelle (PGRST205, 404).

export const BUCKET = "studio";

export function neueStudioWelt() {
  return {
    /** Pfad → { bytes: Buffer, mime, erstellt: ms, geaendert: ms } */
    objekte: new Map(),
    /** Token → Pfad (signierte Upload-URLs) */
    tokens: new Map(),
    naechsterToken: 1,
    log: [],
    /** Je Storage-Anfrage: Operation und ob sie ein Abbruchsignal trug (Frist des Service-Clients, Review-Befund 1). */
    signale: [],
    ids: { studio_medium: 1, studio_pruefung: 1, studio_messplan: 1 },
    messplanFehlt: false,
    /** HTTP-Status für ein fehlendes Objekt: 400 (statusCode "404" im Körper) oder 404. */
    nichtGefundenStatus: 400,
  };
}

function json(status, body, extra = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
}

function nichtGefunden(s) {
  return json(s.nichtGefundenStatus, { statusCode: "404", error: "not_found", message: "Object not found" });
}

/** Datei direkt in den Bucket legen (Test: wie ein Upload des Browsers); alterMs datiert sie zurück. */
export function legeObjektAn(s, pfad, bytes, { mime = "application/octet-stream", alterMs = 0 } = {}) {
  const jetzt = Date.now() - alterMs;
  s.objekte.set(pfad, { bytes: Buffer.from(bytes), mime, erstellt: jetzt, geaendert: jetzt });
}

function pfadNach(url, praefix) {
  const p = decodeURIComponent(url.pathname);
  if (!p.startsWith(praefix)) return null;
  const rest = p.slice(praefix.length);
  if (!rest.startsWith(`${BUCKET}/`)) return { bucket: rest.split("/")[0], pfad: null };
  return { bucket: BUCKET, pfad: rest.slice(BUCKET.length + 1) };
}

async function koerperBytes(roh) {
  if (roh === undefined || roh === null) return Buffer.alloc(0);
  if (typeof roh === "string") return Buffer.from(roh);
  if (roh instanceof ArrayBuffer) return Buffer.from(roh);
  if (ArrayBuffer.isView(roh)) return Buffer.from(roh.buffer, roh.byteOffset, roh.byteLength);
  if (typeof Blob !== "undefined" && roh instanceof Blob) return Buffer.from(await roh.arrayBuffer());
  if (typeof ReadableStream !== "undefined" && roh instanceof ReadableStream) return Buffer.from(await new Response(roh).arrayBuffer());
  throw new Error("Upload-Körper unbekannter Art");
}

/** Antwort der Storage-Attrappe; welt ist die Fake-Welt (welt.studio, welt.stoerung). */
export async function storageAntwort(welt, url, methode, kopf, rohKoerper, signal = null) {
  const s = welt.studio;
  const p = url.pathname;
  const daten = typeof rohKoerper === "string" && rohKoerper !== "" ? JSON.parse(rohKoerper) : undefined;
  const melde = (eintrag) => {
    s.log.push(eintrag);
    s.signale.push({ op: eintrag.op, signal: signal ?? null });
    const st = welt.stoerung?.({ art: "storage", ...eintrag });
    return st ? json(st.status, st.body) : null;
  };

  if (methode === "POST" && p.startsWith("/storage/v1/object/upload/sign/")) {
    const z = pfadNach(url, "/storage/v1/object/upload/sign/");
    const st = melde({ op: "sign_upload", pfad: z?.pfad, upsert: kopf.get("x-upsert") === "true" });
    if (st) return st;
    if (!z || z.bucket !== BUCKET) return json(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    const token = `tok-${s.naechsterToken++}`;
    s.tokens.set(token, { pfad: z.pfad, upsert: kopf.get("x-upsert") === "true" });
    return json(200, { url: `/object/upload/sign/${BUCKET}/${encodeURI(z.pfad)}?token=${token}` });
  }
  if (methode === "PUT" && p.startsWith("/storage/v1/object/upload/sign/")) {
    const z = pfadNach(url, "/storage/v1/object/upload/sign/");
    const token = url.searchParams.get("token");
    const st = melde({ op: "upload", pfad: z?.pfad, upsert: kopf.get("x-upsert") === "true" });
    if (st) return st;
    const t = s.tokens.get(token);
    if (!z || !t || t.pfad !== z.pfad) return json(400, { statusCode: "403", error: "Unauthorized", message: "invalid signature" });
    if (s.objekte.has(z.pfad) && !t.upsert) return json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    const bytes = await koerperBytes(rohKoerper);
    legeObjektAn(s, z.pfad, bytes, { mime: kopf.get("content-type") ?? "application/octet-stream" });
    return json(200, { Key: `${BUCKET}/${z.pfad}` });
  }
  if ((methode === "GET" || methode === "HEAD") && p.startsWith("/storage/v1/object/") && !p.startsWith("/storage/v1/object/sign/")) {
    const z = pfadNach(url, "/storage/v1/object/");
    const st = melde({ op: methode === "GET" ? "download" : "head", pfad: z?.pfad });
    if (st) return st;
    const o = z && z.bucket === BUCKET ? s.objekte.get(z.pfad) : undefined;
    if (!o) return nichtGefunden(s);
    return new Response(methode === "HEAD" ? null : o.bytes, { status: 200, headers: { "content-type": o.mime, "content-length": String(o.bytes.length) } });
  }
  if (methode === "POST" && p === "/storage/v1/object/move") {
    const st = melde({ op: "move", pfad: daten?.sourceKey, ziel: daten?.destinationKey });
    if (st) return st;
    if (daten?.bucketId !== BUCKET) return json(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    const o = s.objekte.get(daten.sourceKey);
    if (!o) return nichtGefunden(s);
    if (s.objekte.has(daten.destinationKey)) return json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    s.objekte.delete(daten.sourceKey);
    s.objekte.set(daten.destinationKey, { ...o, geaendert: Date.now() });
    return json(200, { message: "Successfully moved" });
  }
  if (methode === "DELETE" && p === `/storage/v1/object/${BUCKET}`) {
    const pfade = Array.isArray(daten?.prefixes) ? daten.prefixes : [];
    const st = melde({ op: "remove", pfade: [...pfade] });
    if (st) return st;
    const weg = [];
    for (const pf of pfade) {
      if (s.objekte.delete(pf)) weg.push({ name: pf, bucket_id: BUCKET });
    }
    return json(200, weg);
  }
  if (methode === "POST" && p === `/storage/v1/object/list/${BUCKET}`) {
    const praefix = String(daten?.prefix ?? "").replace(/\/$/, "");
    const st = melde({ op: "list", pfad: praefix });
    if (st) return st;
    const eintraege = [];
    for (const [pf, o] of s.objekte) {
      if (!pf.startsWith(`${praefix}/`)) continue;
      const name = pf.slice(praefix.length + 1);
      if (name.includes("/")) continue;
      eintraege.push({
        name,
        id: `id-${pf}`,
        created_at: new Date(o.erstellt).toISOString(),
        updated_at: new Date(o.geaendert).toISOString(),
        last_accessed_at: new Date(o.geaendert).toISOString(),
        metadata: { size: o.bytes.length, mimetype: o.mime },
      });
    }
    eintraege.sort((a, b) => (a.name < b.name ? -1 : 1));
    const offset = Number(daten?.offset ?? 0);
    const limit = Number(daten?.limit ?? 100);
    return json(200, eintraege.slice(offset, offset + limit));
  }
  if (methode === "POST" && p.startsWith("/storage/v1/object/sign/")) {
    const z = pfadNach(url, "/storage/v1/object/sign/");
    const st = melde({ op: "sign", pfad: z?.pfad, expiresIn: daten?.expiresIn });
    if (st) return st;
    if (!z || z.bucket !== BUCKET || !s.objekte.has(z.pfad)) return nichtGefunden(s);
    return json(200, { signedURL: `/object/sign/${BUCKET}/${encodeURI(z.pfad)}?token=lese-${s.naechsterToken++}` });
  }
  throw new Error(`Storage-Attrappe: ${methode} ${p} nicht nachgebaut`);
}

// ── Tabellen ─────────────────────────────────────────────────────────────────────────────────────

const SLUG = /^[a-z0-9-]{1,80}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ID40 = /^[a-z0-9-]{1,40}$/;

const MEDIUM_EINFUEGEN = [
  "objekt_slug", "art", "fassung", "startbild_id", "abgeleitet_von", "speicher_pfad", "sha256", "bytes", "mime", "breite", "hoehe", "fps",
  "dauer_s", "aigc_kennzeichen", "schnitt_von_s", "schnitt_bis_s", "anker_id", "anker_sha256", "ausschnitt", "startbild_abgleich",
  "startbild_abweichung_max", "erzeuger", "modell", "job_id", "parameter", "prompt", "prompt_klauseln", "ki_hinweis_text",
  "kosten_vorschau_credits", "kosten_credits", "kosten_usd", "kosten_quelle",
];
const MEDIUM_ALLE = ["id", ...MEDIUM_EINFUEGEN, "eingespielt_am", "startbild_ziel", "quelle_ziel"];
const PRUEFUNG_EINFUEGEN = [
  "medium_id", "medium_sha256", "durch", "pruefer_kuerzel", "klauseln", "anker_abgleich", "ki_hinweis_eingebrannt",
  "durchsicht_volle_bildrate", "rechte_status", "rechte_nachweis", "notiz", "urteil",
];
const PRUEFUNG_ALLE = ["id", ...PRUEFUNG_EINFUEGEN, "geprueft_am"];
const MESSPLAN_EINFUEGEN = ["objekt_slug", "eintrag", "von", "bis", "werte", "abfrage", "gemessen_am", "quelle"];
const MESSPLAN_ALLE = ["id", ...MESSPLAN_EINFUEGEN, "festgeschrieben_am"];

const SPALTEN = {
  studio_medium: { einfuegen: MEDIUM_EINFUEGEN, alle: MEDIUM_ALLE, uhr: "eingespielt_am" },
  studio_pruefung: { einfuegen: PRUEFUNG_EINFUEGEN, alle: PRUEFUNG_ALLE, uhr: "geprueft_am" },
  studio_messplan: { einfuegen: MESSPLAN_EINFUEGEN, alle: MESSPLAN_ALLE, uhr: "festgeschrieben_am" },
};

function istZahl(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function zeichen(t) {
  return Array.from(t).length;
}
function istJsonObjekt(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** CHECK-Verletzungen von studio_medium (leer = alle erfüllt), mit dem Namen des CHECKs, wo es einen gibt. */
export function mediumChecks(z) {
  const v = [];
  const pruefe = (bedingung, name) => {
    if (!bedingung) v.push(name);
  };
  pruefe(typeof z.objekt_slug === "string" && SLUG.test(z.objekt_slug), "objekt_slug");
  pruefe(["video", "bild"].includes(z.art), "art");
  pruefe(["startbild", "original", "export"].includes(z.fassung), "fassung");
  pruefe(typeof z.speicher_pfad === "string", "speicher_pfad NOT NULL");
  pruefe(typeof z.sha256 === "string" && HEX64.test(z.sha256), "sha256");
  pruefe(Number.isInteger(z.bytes) && z.bytes > 0, "bytes");
  pruefe(["video/mp4", "image/jpeg", "image/png"].includes(z.mime), "mime");
  pruefe(typeof z.anker_id === "string" && ID40.test(z.anker_id), "anker_id");
  pruefe(typeof z.anker_sha256 === "string" && HEX64.test(z.anker_sha256), "anker_sha256");
  pruefe(z.ausschnitt === null || istJsonObjekt(z.ausschnitt), "ausschnitt");
  pruefe(z.startbild_abgleich === null || ["bestanden", "nicht_bestanden"].includes(z.startbild_abgleich), "startbild_abgleich");
  pruefe(z.startbild_abweichung_max === null || (Number.isInteger(z.startbild_abweichung_max) && z.startbild_abweichung_max >= 0 && z.startbild_abweichung_max <= 255), "startbild_abweichung_max");
  pruefe(z.erzeuger === null || ["higgsfield-connector", "higgsfield-api"].includes(z.erzeuger), "erzeuger");
  pruefe(istJsonObjekt(z.parameter), "parameter");
  pruefe(z.prompt === null || (typeof z.prompt === "string" && zeichen(z.prompt) <= 2500), "prompt");
  pruefe(Array.isArray(z.prompt_klauseln), "prompt_klauseln");
  pruefe(z.ki_hinweis_text === null || (typeof z.ki_hinweis_text === "string" && zeichen(z.ki_hinweis_text) <= 200), "ki_hinweis_text");
  for (const k of ["kosten_vorschau_credits", "kosten_credits", "kosten_usd"]) pruefe(z[k] === null || (istZahl(z[k]) && z[k] >= 0), k);
  pruefe(z.kosten_quelle === null || (typeof z.kosten_quelle === "string" && zeichen(z.kosten_quelle) <= 300), "kosten_quelle");
  const endung = { "video/mp4": ".mp4", "image/jpeg": ".jpg", "image/png": ".png" }[z.mime];
  pruefe(z.speicher_pfad === `${z.objekt_slug}/${z.sha256}${endung}`, "studio_medium_pfad_check");
  pruefe(z.fassung === "original" || (z.kosten_vorschau_credits === null && z.kosten_credits === null && z.kosten_usd === null && z.kosten_quelle === null), "studio_medium_kosten_nur_original");
  pruefe(z.fassung === "original" || (z.prompt === null && Array.isArray(z.prompt_klauseln) && z.prompt_klauseln.length === 0), "studio_medium_prompt_nur_original");
  pruefe((z.art === "video") === (z.mime === "video/mp4"), "art_mime");
  pruefe(z.startbild_id === null || z.fassung === "original", "startbild_id_nur_original");
  pruefe(z.abgeleitet_von === null || z.fassung === "export", "abgeleitet_von_nur_export");
  pruefe(z.fassung !== "startbild" || (z.art === "bild" && z.ausschnitt !== null && z.startbild_abgleich !== null), "startbild_pflicht");
  pruefe(z.fassung !== "original" || z.art !== "video" || (z.startbild_id !== null && z.erzeuger !== null && z.modell !== null), "original_pflicht");
  pruefe(z.fassung !== "export" || z.abgeleitet_von !== null, "export_pflicht");
  pruefe((z.schnitt_von_s === null) === (z.schnitt_bis_s === null), "schnitt_beide");
  pruefe(z.schnitt_von_s === null || (istZahl(z.schnitt_von_s) && istZahl(z.schnitt_bis_s) && z.schnitt_von_s >= 0 && z.schnitt_bis_s > z.schnitt_von_s), "schnitt_fenster");
  return v;
}

export function pruefungChecks(z) {
  const v = [];
  const pruefe = (bedingung, name) => {
    if (!bedingung) v.push(name);
  };
  pruefe(Number.isInteger(z.medium_id), "medium_id NOT NULL");
  pruefe(typeof z.medium_sha256 === "string" && HEX64.test(z.medium_sha256), "medium_sha256");
  pruefe(typeof z.durch === "string" && ID40.test(z.durch), "durch");
  pruefe(typeof z.pruefer_kuerzel === "string" && /^[A-Za-z]{2,6}$/.test(z.pruefer_kuerzel), "pruefer_kuerzel");
  pruefe(Array.isArray(z.klauseln), "klauseln");
  pruefe(["bestanden", "nicht_bestanden"].includes(z.anker_abgleich), "anker_abgleich");
  pruefe(typeof z.ki_hinweis_eingebrannt === "boolean", "ki_hinweis_eingebrannt NOT NULL");
  pruefe(typeof z.durchsicht_volle_bildrate === "boolean", "durchsicht_volle_bildrate NOT NULL");
  pruefe(["offen", "geklaert"].includes(z.rechte_status), "rechte_status");
  pruefe(z.rechte_nachweis === null || (typeof z.rechte_nachweis === "string" && zeichen(z.rechte_nachweis) <= 300), "rechte_nachweis");
  pruefe(z.notiz === null || (typeof z.notiz === "string" && zeichen(z.notiz) <= 1000), "notiz");
  pruefe(["bestanden", "nicht_bestanden"].includes(z.urteil), "urteil");
  pruefe(z.rechte_status === "offen" || (typeof z.rechte_nachweis === "string" && z.rechte_nachweis.trim() !== ""), "studio_pruefung_rechte_check");
  return v;
}

/** Rolle der Anfrage aus dem apikey-Kopf: service_role (Service-Schlüssel der Umgebung), anon (öffentlicher Schlüssel). */
export function rolle(kopf) {
  const key = kopf.get("apikey");
  const service = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (key && service && key === service) return "service_role";
  if (key && key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return "anon";
  return "unbekannt";
}

function verweigert(tabelle, was, r) {
  return json(r === "anon" ? 401 : 403, { code: "42501", details: null, hint: null, message: `permission denied for ${was} ${tabelle}` });
}

/**
 * Tabellen-Attrappe. h = Hilfen der Fake-Welt ({ filtere, sortiere, antwortZeilen, zeitstempel }), damit diese
 * Datei sie nicht zirkulär importiert.
 */
export function studioTabelle(welt, tabelle, url, methode, kopf, body, h) {
  const s = welt.studio;
  const zeilen = (welt.tabellen[tabelle] ??= []);
  const def = SPALTEN[tabelle];
  if (!def) throw new Error(`studio-Tabelle ${tabelle} nicht nachgebaut`);
  if (tabelle === "studio_messplan" && s.messplanFehlt) {
    return json(404, { code: "PGRST205", details: null, hint: null, message: "Could not find the table 'public.studio_messplan' in the schema cache" });
  }
  const r = rolle(kopf);
  const select = url.searchParams.get("select");
  if (methode === "GET") {
    if (r !== "service_role") return verweigert(tabelle, "table", r);
    const alle = h.filtere(zeilen, url.searchParams);
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : Infinity;
    return h.antwortZeilen(h.sortiere(alle, url.searchParams.get("order")).slice(0, limit), select, kopf, alle.length);
  }
  if (methode === "PATCH" || methode === "DELETE") {
    // Trigger *_unveraenderlich (und kein UPDATE-/DELETE-Recht): gesperrt für jede Rolle.
    return json(403, { code: "42501", details: null, hint: null, message: `studio: ${methode === "PATCH" ? "UPDATE" : "DELETE"} auf ${tabelle} ist gesperrt (Beleg, nur anhaengen)` });
  }
  if (methode !== "POST") throw new Error(`Methode ${methode} auf ${tabelle}`);
  const liste = Array.isArray(body) ? body : [body];
  const neu = [];
  for (const roh of liste) {
    if (r !== "service_role") {
      return json(r === "anon" ? 401 : 403, { code: "42501", details: null, hint: null, message: `studio: INSERT auf ${tabelle} nur als service_role im Normalbetrieb` });
    }
    for (const k of Object.keys(roh)) {
      if (!def.alle.includes(k)) return json(400, { code: "PGRST204", details: null, hint: null, message: `Could not find the '${k}' column of '${tabelle}' in the schema cache` });
      if (!def.einfuegen.includes(k)) return verweigert(tabelle, "column", r);
    }
    // Wie BIGSERIAL in Postgres: Der Sequenzwert ist verbraucht, auch wenn das Einfügen danach scheitert.
    const z = { id: s.ids[tabelle]++ };
    for (const k of def.einfuegen) z[k] = roh[k] === undefined ? null : structuredClone(roh[k]);
    if (tabelle === "studio_medium") {
      if (z.parameter === null) z.parameter = {};
      if (z.prompt_klauseln === null) z.prompt_klauseln = [];
      z.startbild_ziel = z.startbild_id === null ? null : "startbild";
      z.quelle_ziel = z.abgeleitet_von === null ? null : "original";
      const v = mediumChecks(z);
      if (v.length > 0) {
        return json(400, { code: "23514", details: null, hint: null, message: `new row for relation "studio_medium" violates check constraint "${v[0]}"` });
      }
      if (zeilen.some((a) => a.sha256 === z.sha256 || a.speicher_pfad === z.speicher_pfad)) {
        return json(409, { code: "23505", details: null, hint: null, message: "duplicate key value violates unique constraint" });
      }
      const fk = (id, fassung) => zeilen.some((a) => a.id === id && a.fassung === fassung && a.objekt_slug === z.objekt_slug);
      if ((z.startbild_id !== null && !fk(z.startbild_id, "startbild")) || (z.abgeleitet_von !== null && !fk(z.abgeleitet_von, "original"))) {
        return json(409, { code: "23503", details: null, hint: null, message: "insert or update on table \"studio_medium\" violates foreign key constraint" });
      }
    } else if (tabelle === "studio_pruefung") {
      const v = pruefungChecks(z);
      if (v.length > 0) {
        return json(400, { code: "23514", details: null, hint: null, message: `new row for relation "studio_pruefung" violates check constraint "${v[0]}"` });
      }
      const medien = welt.tabellen.studio_medium ?? [];
      if (!medien.some((m) => m.id === z.medium_id && m.sha256 === z.medium_sha256)) {
        return json(409, { code: "23503", details: null, hint: null, message: "insert or update on table \"studio_pruefung\" violates foreign key constraint \"studio_pruefung_medium_fk\"" });
      }
    }
    // Trigger *_anlegen: DB-Uhr.
    z[def.uhr] = h.zeitstempel();
    neu.push(z);
  }
  zeilen.push(...neu);
  const darstellen = (kopf.get("prefer") ?? "").includes("return=representation");
  return darstellen ? h.antwortZeilen(neu, select, kopf) : new Response(null, { status: 201 });
}
