// Objekt-Studio Schritt 7 (10.11.2026): Medien-Ablage — reine Regeln, ohne Netz, Storage und Datenbank.
//
// Was hier steht, rufen die Routen unter api/studio/[objekt]/medien auf; Storage und Datenbank liest
// lib/studio/medien-ablage.ts, den Startbild-Abgleich rechnet lib/studio/startbild.ts.
// - Beleg-Prüfung: Der Beleg der erzeugenden Sitzung kommt im JSON-Körper (nicht als Datei in den Bucket,
//   dessen MIME-Liste kein JSON erlaubt). Streng: unbekannte Felder, falsche Typen oder Werte außerhalb der
//   Spalten-CHECKs weisen ab (400), bevor eine Datei gelesen wird.
// - Dateisignatur aus den ersten Bytes: MP4 „ftyp“ ab Byte 4 (Marke ab Byte 8 nicht in KEINE_MP4_MARKEN), JPEG FF D8 FF,
//   PNG 89 50 4E 47 0D 0A 1A 0A.
// - Pfade: Upload nach eingang/<uuid>.<endung>; vor dem Messen verschiebt der Server nach arbeit/<uuid>.<endung>
//   (dorthin hat kein Upload-Token Zugriff); der Inhalts-Pfad ist <slug>/<sha256>.<mp4|jpg|png> wie der CHECK
//   studio_medium_pfad_check. Aufgeräumt wird nur unter eingang/ und arbeit/.
// - Einfüge-Reihenfolge Startbild → Original → Export: Das Original verweist auf das Startbild, der Export auf
//   das Original (Fremdschlüssel prüfen Fassung und Objekt).
// - Vorschau: die drei Zeilen genau so, wie sie eingefügt würden; Verweise auf noch nicht vergebene ids stehen
//   als "@startbild" bzw. "@original". vorschau_sha256 ist der SHA-256 ihrer kanonischen JSON-Form
//   (Schlüssel sortiert); Zeit- und Speicherwerte gehören nicht dazu.
// - Feldvergleich nach 23505: Zahlen als Dezimalwert, JSON mit sortierten Schlüsseln. Nur wenn jedes Feld
//   gleich ist, wird eine vorhandene Zeile weiterverwendet.

import { createHash } from "node:crypto";
import type { AnkerEintrag } from "./anker";
import type { AbgleichErgebnis, Ausschnitt, MedienRolle, MediumMime, PromptKlausel, UploadRolle } from "./typen";

/** Einfüge-Reihenfolge der drei Zeilen eines Videos. */
export const MEDIEN_ROLLEN: readonly MedienRolle[] = ["startbild", "original", "export"];
export const UPLOAD_ROLLEN: readonly UploadRolle[] = ["startbild", "original", "export", "abgleich"];

/** Privater Bucket der Medien. */
export const BUCKET = "studio";
/** Größte Datei: Limit des Buckets (50.000.000 B); eine Datei genau dieser Größe ist zulässig. */
export const DATEI_MAX_BYTES = 50_000_000;
/** Größter JSON-Körper der POST-Routen der Medien-Familie. */
export const JSON_MAX_BYTES = 1_000_000;

/** Zulässige MIME-Typen je Rolle; die Rolle "abgleich" nimmt nur Bilder. */
export const MIME_JE_ROLLE: Readonly<Record<UploadRolle, readonly MediumMime[]>> = {
  startbild: ["image/png", "image/jpeg"],
  original: ["video/mp4"],
  export: ["video/mp4"],
  abgleich: ["image/png", "image/jpeg"],
};

export const ENDUNG: Readonly<Record<MediumMime, "mp4" | "jpg" | "png">> = { "video/mp4": "mp4", "image/jpeg": "jpg", "image/png": "png" };
const MIME_JE_ENDUNG: Readonly<Record<string, MediumMime>> = { mp4: "video/mp4", jpg: "image/jpeg", png: "image/png" };

export function istUploadRolle(x: unknown): x is UploadRolle {
  return typeof x === "string" && (UPLOAD_ROLLEN as readonly string[]).includes(x);
}

export function istMime(x: unknown): x is MediumMime {
  return typeof x === "string" && Object.hasOwn(ENDUNG, x);
}

// ── Dateisignatur ──────────────────────────────────────────────────────────────────────────────────

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/**
 * Hauptmarken (ftyp, Byte 8–11) von ISO-BMFF-Dateien, die kein MP4-Video sind: QuickTime, HEIF- und AVIF-Bilder,
 * M4A/M4B/M4P-Audio. Ohne diese Liste galt jede Datei mit „ftyp“ als video/mp4 (Review-Befund 8, 10.11.2026). Eine
 * Sperrliste statt einer Zulassungsliste, damit kein echtes MP4 mit einer seltenen Marke (isom, mp41, mp42, avc1, iso4
 * … dash) abgewiesen wird.
 */
export const KEINE_MP4_MARKEN: ReadonlySet<string> = new Set(["qt  ", "heic", "heix", "heim", "heis", "mif1", "msf1", "avif", "avis", "M4A ", "M4B ", "M4P "]);

/** Art der Datei aus ihren ersten Bytes; null, wenn keine der drei Signaturen passt. Gelesen werden höchstens 8 Bytes. */
export function mimeAusSignatur(kopf: Uint8Array): MediumMime | null {
  if (kopf.length >= 8 && kopf[4] === 0x66 && kopf[5] === 0x74 && kopf[6] === 0x79 && kopf[7] === 0x70) {
    if (kopf.length < 12) return null;
    return KEINE_MP4_MARKEN.has(String.fromCharCode(kopf[8], kopf[9], kopf[10], kopf[11])) ? null : "video/mp4";
  }
  if (kopf.length >= 3 && kopf[0] === 0xff && kopf[1] === 0xd8 && kopf[2] === 0xff) return "image/jpeg";
  if (kopf.length >= 8 && PNG.every((b, i) => kopf[i] === b)) return "image/png";
  return null;
}

// ── Pfade ──────────────────────────────────────────────────────────────────────────────────────────

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ZWISCHEN_PFAD = new RegExp(`^(eingang|arbeit)/(${UUID})\\.(png|jpg|mp4)$`);
const SLUG = /^[a-z0-9-]{1,80}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export interface ZwischenPfad {
  bereich: "eingang" | "arbeit";
  uuid: string;
  mime: MediumMime;
}

/** eingang/<uuid>.<endung> bzw. arbeit/<uuid>.<endung> in genau dieser Form; sonst null. */
export function leseZwischenPfad(pfad: unknown): ZwischenPfad | null {
  if (typeof pfad !== "string") return null;
  const m = ZWISCHEN_PFAD.exec(pfad);
  return m ? { bereich: m[1] as ZwischenPfad["bereich"], uuid: m[2], mime: MIME_JE_ENDUNG[m[3]] } : null;
}

export function eingangPfad(uuid: string, mime: MediumMime): string {
  return `eingang/${uuid}.${ENDUNG[mime]}`;
}

/** Arbeitspfad zu einem Eingangspfad: gleicher Name unter arbeit/. Wirft bei einem anderen Pfad (Programmfehler). */
export function arbeitPfad(eingang: string): string {
  const z = leseZwischenPfad(eingang);
  if (z === null || z.bereich !== "eingang") throw new Error("kein Eingangspfad");
  return `arbeit/${z.uuid}.${ENDUNG[z.mime]}`;
}

/** Inhalts-Pfad <slug>/<sha256>.<endung> — dieselbe Regel wie der CHECK studio_medium_pfad_check. */
export function inhaltsPfad(slug: string, sha256: string, mime: MediumMime): string {
  if (!SLUG.test(slug) || !HEX64.test(sha256)) throw new Error("Inhalts-Pfad nur aus Slug und SHA-256");
  return `${slug}/${sha256}.${ENDUNG[mime]}`;
}

/** Darf die Aufräum-Regel diesen Pfad löschen? Nur Dateien unter eingang/ und arbeit/ in genau der Upload-Form. */
export function istAufraeumbar(pfad: unknown): boolean {
  return leseZwischenPfad(pfad) !== null;
}

// ── Beleg ──────────────────────────────────────────────────────────────────────────────────────────

export type Erzeuger = "higgsfield-connector" | "higgsfield-api";

export interface FfprobeWerte {
  breite: number;
  hoehe: number;
  fps: number;
  dauer_s: number;
  aigc_kennzeichen: boolean;
}

export interface Beleg {
  erzeuger: Erzeuger;
  modell: string;
  job_id: string;
  parameter: Record<string, unknown>;
  prompt: string;
  prompt_klauseln: PromptKlausel[];
  kosten_vorschau_credits: number | null;
  kosten_credits: number | null;
  kosten_usd: number | null;
  kosten_quelle: string | null;
  anker_id: string;
  ausschnitt: Ausschnitt;
  startbild_sha256: string;
  original_sha256: string;
  export_sha256: string;
  schnitt_von_s: number;
  schnitt_bis_s: number;
  ki_hinweis_text: string;
  ffprobe: { original: FfprobeWerte; export: FfprobeWerte };
  hinweise: Record<MedienRolle, string[]>;
}

export type Pruefung<T> = { ok: true; wert: T } | { ok: false; grund: string };

const BELEG_FELDER = new Set([
  "erzeuger",
  "modell",
  "job_id",
  "parameter",
  "prompt",
  "prompt_klauseln",
  "kosten_vorschau_credits",
  "kosten_credits",
  "kosten_usd",
  "kosten_quelle",
  "anker_id",
  "ausschnitt",
  "startbild_sha256",
  "original_sha256",
  "export_sha256",
  "schnitt_von_s",
  "schnitt_bis_s",
  "ki_hinweis_text",
  "ffprobe",
  "hinweise",
]);
/** Dürfen fehlen (gelten dann als null bzw. leer). */
const BELEG_OPTIONAL = new Set(["kosten_vorschau_credits", "kosten_usd", "hinweise"]);

const MODELL = /^[\w.:/-]{1,80}$/;
const JOB_ID = /^[\w.:-]{1,100}$/;
const ANKER_ID = /^[a-z0-9-]{1,40}$/;
const KLAUSEL_ID = /^[a-z0-9-]{1,40}$/;
const PROMPT_MAX = 2500;
const KI_HINWEIS_MAX = 200;
const QUELLE_MAX = 300;
const HINWEIS_MAX = 300;
const HINWEISE_JE_ROLLE = 20;
const KLAUSELN_MAX = 50;
const KOSTEN_MAX = 1_000_000;

export function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Zeichen wie char_length in Postgres (Codepoints, nicht UTF-16-Einheiten). */
export function zeichen(text: string): number {
  return Array.from(text).length;
}

/** Einzelnes Ersatzzeichen (UTF-16-Surrogat ohne Partner): in Postgres TEXT und JSONB nicht speicherbar. */
const EINZELNES_ERSATZZEICHEN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * In Postgres speicherbarer Text: ohne U+0000 und ohne einzelnes Ersatzzeichen (Nachbesserung ablauf7-1). Vorher ging
 * so ein Text durch den Prüflauf und scheiterte erst beim Einfügen, mit Dateien schon auf den Inhalts-Pfaden.
 */
export function speicherbarerText(s: string): boolean {
  return !s.includes("\u0000") && !EINZELNES_ERSATZZEICHEN.test(s);
}

const NICHT_SPEICHERBAR = "enthält U+0000 oder ein einzelnes Ersatzzeichen (in Postgres nicht speicherbar)";

function text(roh: unknown, feld: string, max: number): Pruefung<string> {
  if (typeof roh !== "string" || roh.trim() === "") return { ok: false, grund: `${feld}: Text fehlt` };
  if (!speicherbarerText(roh)) return { ok: false, grund: `${feld}: ${NICHT_SPEICHERBAR}` };
  if (zeichen(roh) > max) return { ok: false, grund: `${feld}: höchstens ${max} Zeichen` };
  return { ok: true, wert: roh };
}

/** Höchsttiefe und -größe von beleg.parameter (Nachbesserung sicherheit-2: tiefe Verschachtelung brach structuredClone). */
export const PARAMETER_TIEFE_MAX = 10;
export const PARAMETER_ZEICHEN_MAX = 10_000;

/** beleg.parameter ohne Rekursion prüfen: Tiefe, speicherbare Schlüssel und Texte, Größe als JSON; null = in Ordnung. */
function parameterGrund(roh: Record<string, unknown>): string | null {
  const stapel: Array<{ wert: unknown; tiefe: number }> = [{ wert: roh, tiefe: 1 }];
  while (stapel.length > 0) {
    const { wert, tiefe } = stapel.pop() as { wert: unknown; tiefe: number };
    if (typeof wert === "string") {
      if (!speicherbarerText(wert)) return `beleg.parameter: ${NICHT_SPEICHERBAR}`;
      continue;
    }
    if (typeof wert !== "object" || wert === null) continue;
    if (tiefe > PARAMETER_TIEFE_MAX) return `beleg.parameter: höchstens ${PARAMETER_TIEFE_MAX} Ebenen`;
    for (const [k, v] of Object.entries(wert)) {
      if (!Array.isArray(wert) && !speicherbarerText(k)) return `beleg.parameter: Schlüssel ${NICHT_SPEICHERBAR}`;
      stapel.push({ wert: v, tiefe: tiefe + 1 });
    }
  }
  if (JSON.stringify(roh).length > PARAMETER_ZEICHEN_MAX) return `beleg.parameter: höchstens ${PARAMETER_ZEICHEN_MAX.toLocaleString("de-DE")} Zeichen als JSON`;
  return null;
}

function kosten(roh: unknown, feld: string): Pruefung<number | null> {
  if (roh === null || roh === undefined) return { ok: true, wert: null };
  if (typeof roh !== "number" || !Number.isFinite(roh) || roh < 0 || roh > KOSTEN_MAX) {
    return { ok: false, grund: `${feld}: Zahl ≥ 0 oder null` };
  }
  return { ok: true, wert: roh };
}

function ganzzahl(roh: unknown, feld: string, min: number, max: number): Pruefung<number> {
  if (typeof roh !== "number" || !Number.isInteger(roh) || roh < min || roh > max) {
    return { ok: false, grund: `${feld}: ganze Zahl von ${min} bis ${max}` };
  }
  return { ok: true, wert: roh };
}

function positiv(roh: unknown, feld: string, max: number): Pruefung<number> {
  if (typeof roh !== "number" || !Number.isFinite(roh) || roh <= 0 || roh > max) return { ok: false, grund: `${feld}: Zahl > 0` };
  return { ok: true, wert: roh };
}

function hash(roh: unknown, feld: string): Pruefung<string> {
  if (typeof roh !== "string" || !HEX64.test(roh)) return { ok: false, grund: `${feld}: SHA-256 als 64 Hex-Zeichen (klein)` };
  return { ok: true, wert: roh };
}

/** Ausschnitt-Rezept: ganze Zahlen, Rechteck nicht leer, skalierung genau 1 (Paket C). Die Lage im Anker prüft rezeptImAnker. */
export function pruefeAusschnitt(roh: unknown): Pruefung<Ausschnitt> {
  if (!istObjekt(roh)) return { ok: false, grund: "ausschnitt: Objekt {x, y, breite, hoehe, skalierung}" };
  const unbekannt = Object.keys(roh).filter((k) => !["x", "y", "breite", "hoehe", "skalierung"].includes(k));
  if (unbekannt.length > 0) return { ok: false, grund: `ausschnitt: unbekanntes Feld ${unbekannt[0]}` };
  if (roh.skalierung !== 1) return { ok: false, grund: "ausschnitt.skalierung muss 1 sein (in Paket C ist nur der unskalierte Ausschnitt gemessen)" };
  const x = ganzzahl(roh.x, "ausschnitt.x", 0, 100_000);
  if (!x.ok) return x;
  const y = ganzzahl(roh.y, "ausschnitt.y", 0, 100_000);
  if (!y.ok) return y;
  const b = ganzzahl(roh.breite, "ausschnitt.breite", 1, 100_000);
  if (!b.ok) return b;
  const h = ganzzahl(roh.hoehe, "ausschnitt.hoehe", 1, 100_000);
  if (!h.ok) return h;
  return { ok: true, wert: { x: x.wert, y: y.wert, breite: b.wert, hoehe: h.wert, skalierung: 1 } };
}

/** Liegt das Rezept ganz im Anker (Maße laut Manifest)? Sonst der Grund für 400. */
export function rezeptImAnker(a: Ausschnitt, anker: Pick<AnkerEintrag, "id" | "breite" | "hoehe">): string | null {
  if (a.x + a.breite > anker.breite || a.y + a.hoehe > anker.hoehe) {
    return `Ausschnitt ${a.breite}×${a.hoehe} bei (${a.x}, ${a.y}) liegt außerhalb des Ankers ${anker.id} (${anker.breite}×${anker.hoehe})`;
  }
  return null;
}

function ffprobe(roh: unknown, feld: string): Pruefung<FfprobeWerte> {
  if (!istObjekt(roh)) return { ok: false, grund: `${feld}: Objekt {breite, hoehe, fps, dauer_s, aigc_kennzeichen}` };
  const unbekannt = Object.keys(roh).filter((k) => !["breite", "hoehe", "fps", "dauer_s", "aigc_kennzeichen"].includes(k));
  if (unbekannt.length > 0) return { ok: false, grund: `${feld}: unbekanntes Feld ${unbekannt[0]}` };
  const breite = ganzzahl(roh.breite, `${feld}.breite`, 1, 20_000);
  if (!breite.ok) return breite;
  const hoehe = ganzzahl(roh.hoehe, `${feld}.hoehe`, 1, 20_000);
  if (!hoehe.ok) return hoehe;
  const fps = positiv(roh.fps, `${feld}.fps`, 1000);
  if (!fps.ok) return fps;
  const dauer = positiv(roh.dauer_s, `${feld}.dauer_s`, 86_400);
  if (!dauer.ok) return dauer;
  if (typeof roh.aigc_kennzeichen !== "boolean") return { ok: false, grund: `${feld}.aigc_kennzeichen: true oder false` };
  return { ok: true, wert: { breite: breite.wert, hoehe: hoehe.wert, fps: fps.wert, dauer_s: dauer.wert, aigc_kennzeichen: roh.aigc_kennzeichen } };
}

function hinweise(roh: unknown): Pruefung<Record<MedienRolle, string[]>> {
  const leer: Record<MedienRolle, string[]> = { startbild: [], original: [], export: [] };
  if (roh === undefined || roh === null) return { ok: true, wert: leer };
  // Je Rolle, damit jeder Hinweis an der Zeile steht, die er betrifft (parameter.hinweise).
  if (!istObjekt(roh)) return { ok: false, grund: "hinweise: Objekt je Rolle {startbild, original, export} mit Textlisten" };
  for (const [rolle, liste] of Object.entries(roh)) {
    if (!(MEDIEN_ROLLEN as readonly string[]).includes(rolle)) return { ok: false, grund: `hinweise: unbekannte Rolle ${rolle}` };
    if (!Array.isArray(liste) || liste.length > HINWEISE_JE_ROLLE) return { ok: false, grund: `hinweise.${rolle}: Liste mit höchstens ${HINWEISE_JE_ROLLE} Texten` };
    for (const h of liste) {
      const t = text(h, `hinweise.${rolle}`, HINWEIS_MAX);
      if (!t.ok) return t;
    }
    leer[rolle as MedienRolle] = [...(liste as string[])];
  }
  return { ok: true, wert: leer };
}

/** Beleg aus dem JSON-Körper prüfen; jeder Verstoß ist ein 400 mit Grund. */
export function pruefeBeleg(roh: unknown): Pruefung<Beleg> {
  if (!istObjekt(roh)) return { ok: false, grund: "beleg: JSON-Objekt erwartet" };
  for (const k of Object.keys(roh)) {
    if (!BELEG_FELDER.has(k)) return { ok: false, grund: `beleg: unbekanntes Feld ${k}` };
  }
  for (const k of BELEG_FELDER) {
    if (!BELEG_OPTIONAL.has(k) && !Object.hasOwn(roh, k)) return { ok: false, grund: `beleg: Feld ${k} fehlt` };
  }
  if (roh.erzeuger !== "higgsfield-connector" && roh.erzeuger !== "higgsfield-api") {
    return { ok: false, grund: "beleg.erzeuger: higgsfield-connector oder higgsfield-api" };
  }
  if (typeof roh.modell !== "string" || !MODELL.test(roh.modell)) return { ok: false, grund: "beleg.modell: 1–80 Zeichen aus Buchstaben, Ziffern und . _ : / -" };
  if (typeof roh.job_id !== "string" || !JOB_ID.test(roh.job_id)) return { ok: false, grund: "beleg.job_id: 1–100 Zeichen aus Buchstaben, Ziffern und . _ : -" };
  if (!istObjekt(roh.parameter)) return { ok: false, grund: "beleg.parameter: JSON-Objekt" };
  if (Object.hasOwn(roh.parameter, "hinweise")) return { ok: false, grund: "beleg.parameter: Schlüssel hinweise ist vergeben (Hinweise je Rolle unter beleg.hinweise)" };
  const parameterFehler = parameterGrund(roh.parameter);
  if (parameterFehler !== null) return { ok: false, grund: parameterFehler };
  const prompt = text(roh.prompt, "beleg.prompt", PROMPT_MAX);
  if (!prompt.ok) return prompt;

  if (!Array.isArray(roh.prompt_klauseln) || roh.prompt_klauseln.length === 0 || roh.prompt_klauseln.length > KLAUSELN_MAX) {
    return { ok: false, grund: `beleg.prompt_klauseln: Liste mit 1–${KLAUSELN_MAX} Klauseln` };
  }
  const klauseln: PromptKlausel[] = [];
  for (const k of roh.prompt_klauseln as unknown[]) {
    if (!istObjekt(k) || Object.keys(k).some((s) => s !== "id" && s !== "text")) return { ok: false, grund: "beleg.prompt_klauseln: je Klausel {id, text}" };
    if (typeof k.id !== "string" || !KLAUSEL_ID.test(k.id)) return { ok: false, grund: "beleg.prompt_klauseln: id aus a–z, 0–9 und -, höchstens 40 Zeichen" };
    if (klauseln.some((v) => v.id === k.id)) return { ok: false, grund: `beleg.prompt_klauseln: id ${k.id} doppelt` };
    const t = text(k.text, `beleg.prompt_klauseln.${k.id}`, PROMPT_MAX);
    if (!t.ok) return t;
    klauseln.push({ id: k.id, text: t.wert });
  }

  const vorschau = kosten(roh.kosten_vorschau_credits, "beleg.kosten_vorschau_credits");
  if (!vorschau.ok) return vorschau;
  const credits = kosten(roh.kosten_credits, "beleg.kosten_credits");
  if (!credits.ok) return credits;
  const usd = kosten(roh.kosten_usd, "beleg.kosten_usd");
  if (!usd.ok) return usd;
  // Weg 2a (Connector) rechnet in Credits, Weg 2b (API) in USD — nie gemischt (Spez. §7.3).
  if (roh.erzeuger === "higgsfield-connector" && usd.wert !== null) return { ok: false, grund: "beleg.kosten_usd: nur für higgsfield-api; der Connector rechnet in Credits" };
  // Und umgekehrt (Review-Befund 7): API-Credits zählten sonst in den Credit-Deckel (E18).
  if (roh.erzeuger === "higgsfield-api" && (credits.wert !== null || vorschau.wert !== null)) {
    return { ok: false, grund: "beleg.kosten_credits/kosten_vorschau_credits: nur für higgsfield-connector; die API rechnet in USD" };
  }
  let quelle: string | null = null;
  if (roh.kosten_quelle !== null) {
    const q = text(roh.kosten_quelle, "beleg.kosten_quelle", QUELLE_MAX);
    if (!q.ok) return q;
    quelle = q.wert;
  }
  if (quelle === null && (vorschau.wert !== null || credits.wert !== null || usd.wert !== null)) {
    return { ok: false, grund: "beleg.kosten_quelle: Pflicht, sobald Kosten angegeben sind" };
  }

  if (typeof roh.anker_id !== "string" || !ANKER_ID.test(roh.anker_id)) return { ok: false, grund: "beleg.anker_id: Kennung aus dem Anker-Manifest" };
  const ausschnitt = pruefeAusschnitt(roh.ausschnitt);
  if (!ausschnitt.ok) return { ok: false, grund: `beleg.${ausschnitt.grund}` };

  const sb = hash(roh.startbild_sha256, "beleg.startbild_sha256");
  if (!sb.ok) return sb;
  const og = hash(roh.original_sha256, "beleg.original_sha256");
  if (!og.ok) return og;
  const ex = hash(roh.export_sha256, "beleg.export_sha256");
  if (!ex.ok) return ex;
  if (new Set([sb.wert, og.wert, ex.wert]).size !== 3) return { ok: false, grund: "beleg: Startbild, Original und Export müssen verschiedene Dateien sein (SHA-256 gleich)" };

  const von = roh.schnitt_von_s;
  const bis = roh.schnitt_bis_s;
  if (typeof von !== "number" || typeof bis !== "number" || !Number.isFinite(von) || !Number.isFinite(bis) || von < 0 || bis <= von || bis > 86_400) {
    return { ok: false, grund: "beleg.schnitt_von_s/schnitt_bis_s: 0 ≤ von < bis" };
  }
  const hinweis = text(roh.ki_hinweis_text, "beleg.ki_hinweis_text", KI_HINWEIS_MAX);
  if (!hinweis.ok) return hinweis;

  if (!istObjekt(roh.ffprobe) || Object.keys(roh.ffprobe).some((k) => k !== "original" && k !== "export")) {
    return { ok: false, grund: "beleg.ffprobe: Objekt {original, export}" };
  }
  const fo = ffprobe(roh.ffprobe.original, "beleg.ffprobe.original");
  if (!fo.ok) return fo;
  const fe = ffprobe(roh.ffprobe.export, "beleg.ffprobe.export");
  if (!fe.ok) return fe;
  const h = hinweise(roh.hinweise);
  if (!h.ok) return h;

  return {
    ok: true,
    wert: {
      erzeuger: roh.erzeuger,
      modell: roh.modell,
      job_id: roh.job_id,
      parameter: structuredClone(roh.parameter),
      prompt: prompt.wert,
      prompt_klauseln: klauseln,
      kosten_vorschau_credits: vorschau.wert,
      kosten_credits: credits.wert,
      kosten_usd: usd.wert,
      kosten_quelle: quelle,
      anker_id: roh.anker_id,
      ausschnitt: ausschnitt.wert,
      startbild_sha256: sb.wert,
      original_sha256: og.wert,
      export_sha256: ex.wert,
      schnitt_von_s: von,
      schnitt_bis_s: bis,
      ki_hinweis_text: hinweis.wert,
      ffprobe: { original: fo.wert, export: fe.wert },
      hinweise: h.wert,
    },
  };
}

/** Hash, den der Beleg für eine Rolle nennt. */
export function belegHash(b: Beleg, rolle: MedienRolle): string {
  return rolle === "startbild" ? b.startbild_sha256 : rolle === "original" ? b.original_sha256 : b.export_sha256;
}

// ── Geplante Zeilen (Vorschau) ─────────────────────────────────────────────────────────────────────

/** Spalten, die der Server einfügt: alle außer id, eingespielt_am (DB-Uhr) und den berechneten Ziel-Spalten der Fremdschlüssel. */
export const EINFUEGE_SPALTEN = [
  "objekt_slug",
  "art",
  "fassung",
  "startbild_id",
  "abgeleitet_von",
  "speicher_pfad",
  "sha256",
  "bytes",
  "mime",
  "breite",
  "hoehe",
  "fps",
  "dauer_s",
  "aigc_kennzeichen",
  "schnitt_von_s",
  "schnitt_bis_s",
  "anker_id",
  "anker_sha256",
  "ausschnitt",
  "startbild_abgleich",
  "startbild_abweichung_max",
  "erzeuger",
  "modell",
  "job_id",
  "parameter",
  "prompt",
  "prompt_klauseln",
  "ki_hinweis_text",
  "kosten_vorschau_credits",
  "kosten_credits",
  "kosten_usd",
  "kosten_quelle",
] as const;

export type EinfuegeSpalte = (typeof EINFUEGE_SPALTEN)[number];
export type ZeilenFelder = Record<EinfuegeSpalte, unknown>;

/** Platzhalter der Vorschau für ids, die erst beim Einfügen entstehen. */
export const VERWEIS_STARTBILD = "@startbild";
export const VERWEIS_ORIGINAL = "@original";

export interface VorschauZeile {
  rolle: MedienRolle;
  felder: ZeilenFelder;
}

export interface DateiMessung {
  sha256: string;
  bytes: number;
  mime: MediumMime;
}

export interface PlanEingabe {
  slug: string;
  beleg: Beleg;
  /** Anker-Eintrag des Manifests; sein Hash ist zugleich der Hash der live geladenen, geprüften Datei. */
  anker: Pick<AnkerEintrag, "id" | "sha256">;
  startbild: DateiMessung & { breite: number; hoehe: number };
  original: DateiMessung;
  export: DateiMessung;
  abgleich: Pick<AbgleichErgebnis, "urteil" | "abweichung_max">;
}

function leer(): Pick<ZeilenFelder, "fps" | "dauer_s" | "aigc_kennzeichen" | "schnitt_von_s" | "schnitt_bis_s" | "ausschnitt" | "startbild_abgleich" | "startbild_abweichung_max" | "erzeuger" | "modell" | "job_id" | "prompt" | "ki_hinweis_text" | "kosten_vorschau_credits" | "kosten_credits" | "kosten_usd" | "kosten_quelle"> {
  return {
    fps: null,
    dauer_s: null,
    aigc_kennzeichen: null,
    schnitt_von_s: null,
    schnitt_bis_s: null,
    ausschnitt: null,
    startbild_abgleich: null,
    startbild_abweichung_max: null,
    erzeuger: null,
    modell: null,
    job_id: null,
    prompt: null,
    ki_hinweis_text: null,
    kosten_vorschau_credits: null,
    kosten_credits: null,
    kosten_usd: null,
    kosten_quelle: null,
  };
}

function mitHinweisen(basis: Record<string, unknown>, liste: string[]): Record<string, unknown> {
  return liste.length > 0 ? { ...basis, hinweise: [...liste] } : { ...basis };
}

/**
 * Die drei Zeilen in Einfüge-Reihenfolge, mit allen Spalten. Kosten, Prompt und Klauseln stehen nur am Original
 * (CHECKs studio_medium_kosten_nur_original und _prompt_nur_original), job_id an Original und Export (Regel Nr. 1),
 * KI-Hinweis und Schnitt am Export, Ausschnitt und Abgleich am Startbild. Hinweise des Belegs stehen in
 * parameter.hinweise der Zeile, die sie betreffen; die Maße des Startbilds hat der Server gemessen.
 */
export function planeZeilen(e: PlanEingabe): VorschauZeile[] {
  const b = e.beleg;
  const gemeinsam = (d: DateiMessung) => ({
    objekt_slug: e.slug,
    speicher_pfad: inhaltsPfad(e.slug, d.sha256, d.mime),
    sha256: d.sha256,
    bytes: d.bytes,
    mime: d.mime,
    anker_id: e.anker.id,
    anker_sha256: e.anker.sha256,
  });
  const startbild: ZeilenFelder = {
    ...leer(),
    ...gemeinsam(e.startbild),
    art: "bild",
    fassung: "startbild",
    startbild_id: null,
    abgeleitet_von: null,
    breite: e.startbild.breite,
    hoehe: e.startbild.hoehe,
    ausschnitt: { ...b.ausschnitt },
    startbild_abgleich: e.abgleich.urteil,
    startbild_abweichung_max: e.abgleich.abweichung_max,
    parameter: mitHinweisen({}, b.hinweise.startbild),
    prompt_klauseln: [],
  };
  const original: ZeilenFelder = {
    ...leer(),
    ...gemeinsam(e.original),
    art: "video",
    fassung: "original",
    startbild_id: VERWEIS_STARTBILD,
    abgeleitet_von: null,
    breite: b.ffprobe.original.breite,
    hoehe: b.ffprobe.original.hoehe,
    fps: b.ffprobe.original.fps,
    dauer_s: b.ffprobe.original.dauer_s,
    aigc_kennzeichen: b.ffprobe.original.aigc_kennzeichen,
    erzeuger: b.erzeuger,
    modell: b.modell,
    job_id: b.job_id,
    parameter: mitHinweisen(structuredClone(b.parameter), b.hinweise.original),
    prompt: b.prompt,
    prompt_klauseln: b.prompt_klauseln.map((k) => ({ ...k })),
    kosten_vorschau_credits: b.kosten_vorschau_credits,
    kosten_credits: b.kosten_credits,
    kosten_usd: b.kosten_usd,
    kosten_quelle: b.kosten_quelle,
  };
  const exportZeile: ZeilenFelder = {
    ...leer(),
    ...gemeinsam(e.export),
    art: "video",
    fassung: "export",
    startbild_id: null,
    abgeleitet_von: VERWEIS_ORIGINAL,
    breite: b.ffprobe.export.breite,
    hoehe: b.ffprobe.export.hoehe,
    fps: b.ffprobe.export.fps,
    dauer_s: b.ffprobe.export.dauer_s,
    aigc_kennzeichen: b.ffprobe.export.aigc_kennzeichen,
    schnitt_von_s: b.schnitt_von_s,
    schnitt_bis_s: b.schnitt_bis_s,
    job_id: b.job_id,
    parameter: mitHinweisen({}, b.hinweise.export),
    prompt_klauseln: [],
    ki_hinweis_text: b.ki_hinweis_text,
  };
  const felder = { startbild, original, export: exportZeile };
  return MEDIEN_ROLLEN.map((rolle) => ({ rolle, felder: felder[rolle] }));
}

/** JSON mit rekursiv sortierten Schlüsseln (Arrays behalten ihre Reihenfolge); undefined fällt weg wie bei JSON.stringify. */
export function kanonisch(wert: unknown): string {
  const sortiert = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sortiert);
    if (istObjekt(x)) {
      const aus: Record<string, unknown> = {};
      for (const k of Object.keys(x).sort()) if (x[k] !== undefined) aus[k] = sortiert(x[k]);
      return aus;
    }
    return x;
  };
  return JSON.stringify(sortiert(wert));
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 der kanonischen Vorschau — das bestätigt der Inhaber mit „So einspielen“. */
export function vorschauHash(zeilen: readonly VorschauZeile[]): string {
  return sha256Text(kanonisch(zeilen));
}

/** Einfüge-Felder einer Vorschau-Zeile: die Platzhalter durch die ids der vorher eingefügten bzw. vorhandenen Zeilen ersetzt. */
export function einfuegeFelder(z: VorschauZeile, ids: { startbild?: number; original?: number }): ZeilenFelder {
  const f: ZeilenFelder = structuredClone(z.felder);
  if (f.startbild_id === VERWEIS_STARTBILD) {
    if (ids.startbild === undefined) throw new Error("Startbild-id fehlt: Reihenfolge Startbild → Original → Export verletzt");
    f.startbild_id = ids.startbild;
  }
  if (f.abgeleitet_von === VERWEIS_ORIGINAL) {
    if (ids.original === undefined) throw new Error("Original-id fehlt: Reihenfolge Startbild → Original → Export verletzt");
    f.abgeleitet_von = ids.original;
  }
  return f;
}

// ── Feldvergleich ──────────────────────────────────────────────────────────────────────────────────

const ZAHL_SPALTEN = new Set<string>([
  "startbild_id",
  "abgeleitet_von",
  "bytes",
  "breite",
  "hoehe",
  "fps",
  "dauer_s",
  "schnitt_von_s",
  "schnitt_bis_s",
  "startbild_abweichung_max",
  "kosten_vorschau_credits",
  "kosten_credits",
  "kosten_usd",
]);
const JSON_SPALTEN = new Set<string>(["ausschnitt", "parameter", "prompt_klauseln"]);

/** Dezimalwert einer Zahl oder Ziffernfolge ohne führende und nachgestellte Nullen ("6.500" → "6.5"); sonst null. */
export function dezimal(x: unknown): string | null {
  let s: string;
  if (typeof x === "number") {
    if (!Number.isFinite(x)) return null;
    s = Math.abs(x) < 1e21 && !/e/i.test(String(x)) ? String(x) : x.toFixed(20);
  } else if (typeof x === "string") {
    s = x.trim();
  } else {
    return null;
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const ganz = m[2].replace(/^0+(?=\d)/, "");
  const bruch = (m[3] ?? "").replace(/0+$/, "");
  const betrag = bruch ? `${ganz}.${bruch}` : ganz;
  return betrag === "0" ? "0" : `${m[1]}${betrag}`;
}

/** Vergleichsform eines Spaltenwerts: Zahlen als Dezimalwert, JSON kanonisch, sonst der Wert selbst. */
export function vergleichsWert(spalte: string, wert: unknown): string {
  if (wert === null || wert === undefined) return "null";
  if (ZAHL_SPALTEN.has(spalte)) return `zahl:${dezimal(wert) ?? `unlesbar:${kanonisch(wert)}`}`;
  if (JSON_SPALTEN.has(spalte)) return `json:${kanonisch(wert)}`;
  return `${typeof wert}:${kanonisch(wert)}`;
}

/** Spalten, in denen eine vorhandene Zeile von der geplanten abweicht (alle Einfüge-Spalten). */
export function abweichendeFelder(geplant: Readonly<Record<string, unknown>>, vorhanden: Readonly<Record<string, unknown>>): string[] {
  return EINFUEGE_SPALTEN.filter((s) => vergleichsWert(s, geplant[s]) !== vergleichsWert(s, vorhanden[s]));
}

/**
 * Felder, in denen eine bestätigte Vorschau (vom Browser zurückgeschickt) von der neuen abweicht, als
 * "<rolle>.<spalte>". Nur für die Meldung „Vorschau veraltet“; entschieden wird über vorschau_sha256.
 */
export function vorschauUnterschiede(alt: unknown, neu: readonly VorschauZeile[]): string[] {
  if (!Array.isArray(alt) || alt.length !== neu.length) return ["vorschau: Zeilenzahl oder Form"];
  const aus: string[] = [];
  neu.forEach((z, i) => {
    const a: unknown = alt[i];
    if (!istObjekt(a) || a.rolle !== z.rolle || !istObjekt(a.felder)) {
      aus.push(`${z.rolle}: Zeile fehlt oder Rolle weicht ab`);
      return;
    }
    for (const s of abweichendeFelder(z.felder, a.felder)) aus.push(`${z.rolle}.${s}`);
  });
  return aus;
}
