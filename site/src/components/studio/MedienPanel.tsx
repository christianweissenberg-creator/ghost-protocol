"use client";

// Medien-Panel des Objekt-Studios (Schritt 7, 10.11.2026): „Video einspielen“ mit Prüflauf, Vorschau und
// ausdrücklicher Bestätigung, die Medienliste je Video (Export → Original → Startbild) und der Startbild-Abgleich
// ohne Datenbank-Zeile (Toleranz-Messung). Seit Schritt 8 je Video das Urteil der Medien-Regel mit allen Gründen
// (vom Server berechnet), das jüngste Prüfprotokoll und die Prüfansicht (components/studio/PruefAnsicht.tsx); sie
// wird erst beim Öffnen aufgebaut, damit der Seitenaufbau kein Video lädt.
//
// Hochgeladen wird direkt in den privaten Bucket: Der Server stellt je Datei eine signierte Upload-URL aus
// (POST …/medien/upload-url), der Browser schickt die Datei per PUT dorthin — das ist der einzige Storage-Zugriff
// des Browsers; Tabellen und Bucket liest nur der Server. Hash, Größe, Signatur und Abgleich misst der Server;
// das Panel zeigt seine Vorschau und schickt deren vorschau_sha256 mit „So einspielen“ zurück. Erst Häkchen,
// dann Knopf (Bestätigung des Inhabers). Nach jedem Fehler verwirft der Server die hochgeladenen Dateien; dann
// beginnt das Einspielen neu.
// Je Video außerdem „Text erzeugen“ (components/studio/TextErzeugen.tsx): die Caption zu diesem Video über die Pipeline —
// ein bezahlter Lauf, erst nach Bestätigung (Nachbesserung Paket C, Auftrag C).
// Nachbesserung (Gegenprüfung von f5ba8eb, oberflaeche-1, -2, -5, -6, -8, -9, -10): Jeder Lauf hat eine Nummer; ein
// veralteter Lauf setzt keinen Stand mehr. Während eines Laufs sind Dateiwahl und Felder gesperrt; jede Änderung
// verwirft Vorschau bzw. Ergebnis. Der Upload meldet Fortschritt je Datei, lässt sich abbrechen und bricht nach
// UPLOAD_STILLSTAND_MS ohne Daten ab; beim Verlassen der Seite bricht er ab. Die Vorschau nennt die Dateien, für die
// sie gilt; das Abgleich-Ergebnis Bild, Anker und Rezept. Fehlerhinweise je Schritt, Zeiten in Europe/Berlin.
// Keine Zahl ohne Quelle: Was der Beleg der erzeugenden Sitzung nennt (ffprobe, Credits), steht als „laut Beleg“
// da; was der Server gemessen hat, als „gemessen“. Texte der Datenbank erscheinen maskiert. Zeiten in
// Europe/Berlin mit Zonenangabe, wie im übrigen Studio.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ankerManifest, kurzHash } from "@/lib/studio/anker";
import type { AnkerEintrag, AnkerManifest } from "@/lib/studio/anker";
import type {
  AbgleichErgebnis,
  MedienKette,
  MedienRolle,
  MediumMime,
  SpeicherMessung,
  StudioCredits,
  StudioMedienTeil,
  StudioMedium,
  StudioMesswert,
  UploadRolle,
} from "@/lib/studio/typen";
import { berlinDatumZeit } from "@/lib/types";
import { FARBE_BERNSTEIN, FARBE_GRUEN, FARBE_ROT, istObjekt, maskiert } from "@/components/studio/beleg-hilfen";
import { PruefAnsicht, leereEingaben } from "@/components/studio/PruefAnsicht";
import { TextErzeugen } from "@/components/studio/TextErzeugen";
import type { PruefEingaben } from "@/components/studio/PruefAnsicht";

// ── Texte ──

function zeitBerlin(iso: unknown, ersatz: string): string {
  const t = typeof iso === "string" ? berlinDatumZeit(iso) : null;
  return t === null ? ersatz : `${t} (Europe/Berlin)`;
}

export function zahl(n: number, nachkomma = 4): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: nachkomma });
}

/** Byte-Zahl mit Einheit; die genaue Zahl steht im title. */
export function bytesText(b: number): string {
  if (b >= 1_000_000) return `${zahl(b / 1_000_000, 2)} MB`;
  if (b >= 1_000) return `${zahl(b / 1_000, 1)} kB`;
  return `${b} B`;
}

const ROLLEN_TEXT: Readonly<Record<MedienRolle, string>> = { startbild: "Startbild", original: "Original", export: "Export" };

/** Pfad der Datei-Route eines Mediums (302 auf eine signierte URL nach dem Nachhashen). */
export function dateiPfad(slug: string, id: number): string {
  return `/api/studio/${encodeURIComponent(slug)}/medien/${id}/datei`;
}

/** Credits als Text: Summe, Deckel und Rest — oder warum es keine Summe gibt. Nie mit USD gemischt. */
export function creditsText(m: StudioMesswert<StudioCredits>): { wert: string; unter: string } {
  const c = m.wert;
  if (m.status === "fehler" || c === null) return { wert: "nicht lesbar", unter: maskiert(m.hinweis ?? "Lesefehler") };
  const deckel = c.deckel === null ? "Deckel nicht entschieden (E18)" : `Deckel ${zahl(c.deckel)}`;
  if (c.summe === null) return { wert: c.originale === 0 ? "kein Video verbucht" : "keine Credit-Angabe", unter: `${deckel} · ${c.originale} Original(e)` };
  // Ist die Summe nur eine Untergrenze (Status nicht ok), ist der Rest eine Obergrenze (Nachbesserung oberflaeche-8).
  const rest = c.rest === null ? "" : ` · Rest ${m.status === "ok" ? "" : "höchstens "}${zahl(c.rest)}`;
  const ohne = c.originale_ohne_angabe > 0 ? ` · ${c.originale_ohne_angabe} ohne Angabe` : "";
  return { wert: `${m.status === "ok" ? "" : "≥ "}${zahl(c.summe)} Credits`, unter: `${deckel}${rest} · ${c.originale} Original(e)${ohne}` };
}

// ── Abläufe (ohne React; holen = fetch, in Tests eine Attrappe) ──

export type Holen = (url: string, init?: RequestInit) => Promise<Response>;

export interface Abweisung {
  art: "abgewiesen";
  httpStatus: number | null;
  text: string;
  felder: string[];
  vorhanden: { startbild: number; original: number; export: number } | null;
  /** Was mit den hochgeladenen Dateien geschieht — je nach Schritt verschieden (Nachbesserung oberflaeche-6). */
  hinweis?: string;
}

/** Hinweise unter einer Abweisung, je nachdem, wo sie entstand (Nachbesserung oberflaeche-6). */
export const HINWEIS_NICHTS_HOCHGELADEN = "Noch nichts hochgeladen; bitte neu beginnen.";
export const HINWEIS_UPLOAD = "Schon hochgeladene Dateien dieses Laufs bleiben bis zu 2 h im Eingang; der Server räumt sie danach auf. Bitte neu beginnen.";
export const HINWEIS_SERVER = "Der Server hat die hochgeladenen Dateien dieses Laufs verworfen, sofern er sie schon bearbeitet hatte; bitte neu beginnen.";
export const HINWEIS_BELEGT = "Die hochgeladenen Dateien bleiben liegen; nach dem laufenden Job erneut starten.";
export const HINWEIS_ABBRUCH = "Schon hochgeladene Dateien bleiben bis zu 2 h im Eingang; ein schon gesendeter Prüflauf endet auf dem Server, schreibt aber nichts.";

/** Job-Arten der Prozess-Sperre in Klartext (medien-ablage.ts, JobArt). */
const JOB_TEXT: Readonly<Record<string, string>> = { pruefen: "Prüflauf", einspielen: "Einspielen", abgleich: "Abgleich" };

function abweisungAus(httpStatus: number | null, daten: unknown, ersatz: string, hinweis: string = HINWEIS_SERVER): Abweisung {
  const obj = istObjekt(daten) ? daten : null;
  const feld = (k: string): string | null => {
    const w = obj?.[k];
    return typeof w === "string" && w.trim() ? w : null;
  };
  // Eigene Routen melden fehler; der Storage (PUT auf die signierte URL) meldet {statusCode, error, message}.
  let text = feld("fehler") ?? feld("message") ?? feld("error") ?? ersatz;
  let hinweisText = hinweis;
  // Prozess-Sperre (409): Zeit in Europe/Berlin und die Job-Art in Klartext statt UTC und interner Kennung (oberflaeche-9).
  const laeuft = obj && istObjekt(obj.laeuft) ? obj.laeuft : null;
  if (laeuft && typeof laeuft.seit === "string") {
    text = `Ein Job (${JOB_TEXT[String(laeuft.art)] ?? "unbekannte Art"}) läuft schon seit ${zeitBerlin(laeuft.seit, "unbekannt")} — bitte danach erneut`;
    hinweisText = HINWEIS_BELEGT;
  }
  const felder = obj && Array.isArray(obj.felder) ? obj.felder.filter((f): f is string => typeof f === "string").map(maskiert) : [];
  const v = obj && istObjekt(obj.vorhanden) ? obj.vorhanden : null;
  const vorhanden =
    v && typeof v.startbild === "number" && typeof v.original === "number" && typeof v.export === "number"
      ? { startbild: v.startbild, original: v.original, export: v.export }
      : null;
  const status = httpStatus === null ? "Netz" : `HTTP ${httpStatus}`;
  return { art: "abgewiesen", httpStatus, text: maskiert(`${httpStatus === 401 ? "Nicht angemeldet — bitte neu anmelden" : text} (${status})`), felder, vorhanden, hinweis: hinweisText };
}

/** Abbruch durch den Betreiber oder das Verlassen der Seite (kein Fehler des Servers). */
function abgebrochen(hinweis: string): Abweisung {
  return { art: "abgewiesen", httpStatus: null, text: "Abgebrochen — kein weiterer Schritt dieses Laufs.", felder: [], vorhanden: null, hinweis };
}

async function postJson(holen: Holen, url: string, koerper: unknown, signal?: AbortSignal): Promise<{ status: number | null; daten: unknown }> {
  try {
    const res = await holen(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(koerper), cache: "no-store", signal });
    return { status: res.status, daten: await res.json().catch(() => null) };
  } catch (e) {
    return { status: null, daten: { fehler: `Netzfehler: ${e instanceof Error ? e.message : "unbekannt"}` } };
  }
}

/** MIME einer gewählten Datei: der Typ des Browsers, sonst aus der Endung; null, wenn keiner der drei passt. */
export function mimeFuerDatei(d: { name: string; type: string }): MediumMime | null {
  const typ = d.type.toLowerCase();
  if (typ === "video/mp4" || typ === "image/jpeg" || typ === "image/png") return typ;
  const endung = /\.([a-z0-9]+)$/i.exec(d.name)?.[1]?.toLowerCase();
  return endung === "mp4" ? "video/mp4" : endung === "jpg" || endung === "jpeg" ? "image/jpeg" : endung === "png" ? "image/png" : null;
}

export interface Datei {
  name: string;
  type: string;
  size: number;
}

/** Anzeigename einer Upload-Rolle (oberflaeche-9: keine Rollen-Kennungen im sichtbaren Text). */
const UPLOAD_TEXT: Readonly<Record<UploadRolle, string>> = { startbild: "Startbild", original: "Original", export: "Export", abgleich: "Bild" };

/** Höchste Zeit ohne übertragene Daten beim Upload einer Datei; danach Abbruch (Frist, Nachbesserung oberflaeche-2). */
export const UPLOAD_STILLSTAND_MS = 60_000;

/** PUT einer Datei auf die signierte URL; fortschritt mit den bisher übertragenen Bytes. */
export type Senden = (
  url: string,
  datei: Blob,
  kopf: Record<string, string>,
  o: { signal: AbortSignal; fortschritt: (geladen: number) => void },
) => Promise<{ status: number; text: string }>;

/** PUT per XMLHttpRequest — nur so meldet der Browser den Upload-Fortschritt. Abbruch über das Signal. */
export const sendenPerXhr: Senden = (url, datei, kopf, o) =>
  new Promise((ja, nein) => {
    if (o.signal.aborted) {
      nein(o.signal.reason ?? new DOMException("Abgebrochen", "AbortError"));
      return;
    }
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    for (const [k, v] of Object.entries(kopf)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => o.fortschritt(e.loaded);
    x.onload = () => ja({ status: x.status, text: x.responseText });
    x.onerror = () => nein(new Error("Netzfehler beim Upload"));
    x.onabort = () => nein(o.signal.reason ?? new DOMException("Abgebrochen", "AbortError"));
    o.signal.addEventListener("abort", () => x.abort(), { once: true });
    x.send(datei);
  });

/** PUT über holen (fetch); ohne Fortschritt. Für Tests und Umgebungen ohne XMLHttpRequest. */
export function sendenPerHolen(holen: Holen): Senden {
  return async (url, datei, kopf, o) => {
    const res = await holen(url, { method: "PUT", headers: kopf, body: datei, signal: o.signal });
    o.fortschritt(datei.size);
    return { status: res.status, text: await res.text().catch(() => "") };
  };
}

/** Im Browser der PUT mit Fortschritt; ohne XMLHttpRequest (Tests) undefined — dann über holen. */
function browserSenden(): Senden | undefined {
  return typeof XMLHttpRequest === "function" ? sendenPerXhr : undefined;
}

export interface LadeOptionen {
  /** Abbruch des ganzen Laufs (Knopf „Abbrechen“, Verlassen der Seite). */
  signal?: AbortSignal;
  /** PUT einer Datei; ohne Angabe über holen. Das Panel nimmt im Browser sendenPerXhr (Fortschritt). */
  senden?: Senden;
  /** Frist ohne übertragene Daten (Standard UPLOAD_STILLSTAND_MS). */
  stillstandMs?: number;
}

function jsonOderNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Upload-URLs anfordern und jede Datei per PUT auf ihre signierte URL laden (nie mit upsert). Liefert je Rolle den
 * Eingangspfad des Servers oder die Abweisung des ersten gescheiterten Schritts. Seit der Nachbesserung
 * oberflaeche-2 mit Fortschritt je Datei (melde), Abbruch über o.signal und einer Frist: Kommen UPLOAD_STILLSTAND_MS
 * lang keine Daten an, bricht der Upload ab. Ein Abbruch beginnt keinen weiteren Schritt.
 */
export async function ladeHoch(
  slug: string,
  dateien: ReadonlyArray<{ rolle: UploadRolle; datei: Datei & Blob; mime: MediumMime }>,
  holen: Holen,
  melde: (text: string) => void = () => {},
  o: LadeOptionen = {},
): Promise<{ art: "ok"; eingang: Partial<Record<UploadRolle, string>> } | Abweisung> {
  const lauf = o.signal;
  melde("Upload-URLs anfordern …");
  const u = await postJson(holen, `/api/studio/${encodeURIComponent(slug)}/medien/upload-url`, {
    dateien: dateien.map((d) => ({ rolle: d.rolle, bytes: d.datei.size, mime: d.mime })),
  }, lauf);
  if (lauf?.aborted) return abgebrochen(HINWEIS_NICHTS_HOCHGELADEN);
  if (u.status !== 200 || !istObjekt(u.daten) || !Array.isArray(u.daten.dateien)) return abweisungAus(u.status, u.daten, "Upload-URLs nicht erhalten", HINWEIS_NICHTS_HOCHGELADEN);
  const senden = o.senden ?? sendenPerHolen(holen);
  const stillstand = o.stillstandMs ?? UPLOAD_STILLSTAND_MS;
  const eingang: Partial<Record<UploadRolle, string>> = {};
  for (const d of dateien) {
    const anzeige = UPLOAD_TEXT[d.rolle] ?? "Datei";
    const ziel = (u.daten.dateien as unknown[]).find((x): x is Record<string, unknown> => istObjekt(x) && x.rolle === d.rolle);
    if (!ziel || typeof ziel.signedUrl !== "string" || typeof ziel.pfad !== "string") return abweisungAus(u.status, null, `Upload-URL für ${anzeige} fehlt in der Antwort`, HINWEIS_UPLOAD);
    melde(`${anzeige} hochladen (${bytesText(d.datei.size)}) …`);
    const datei = new AbortController();
    const beiAbbruch = () => datei.abort(lauf?.reason);
    lauf?.addEventListener("abort", beiAbbruch, { once: true });
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const wache = () => {
      clearTimeout(uhr);
      uhr = setTimeout(() => datei.abort(new DOMException(`seit ${zahl(stillstand / 1000)} s keine Daten übertragen — abgebrochen`, "TimeoutError")), stillstand);
    };
    let prozentVorher = -1;
    try {
      wache();
      const r = await senden(ziel.signedUrl, d.datei, { "content-type": d.mime, "x-upsert": "false", "cache-control": "max-age=3600" }, {
        signal: datei.signal,
        fortschritt: (geladen) => {
          wache();
          const prozent = d.datei.size > 0 ? Math.min(100, Math.floor((geladen / d.datei.size) * 100)) : 100;
          if (prozent !== prozentVorher) {
            prozentVorher = prozent;
            melde(`${anzeige} hochladen: ${bytesText(geladen)} von ${bytesText(d.datei.size)} (${prozent} %) …`);
          }
        },
      });
      if (r.status < 200 || r.status >= 300) {
        const antwort = jsonOderNull(r.text);
        const obj = istObjekt(antwort) ? antwort : null;
        const grund = [obj?.message, obj?.error].find((w): w is string => typeof w === "string" && w.trim() !== "") ?? null;
        return abweisungAus(r.status, { fehler: `Upload von ${anzeige} gescheitert${grund ? `: ${grund}` : ""}` }, "", HINWEIS_UPLOAD);
      }
    } catch (e) {
      if (lauf?.aborted) return abgebrochen(HINWEIS_UPLOAD);
      const frist = datei.signal.aborted && datei.signal.reason instanceof DOMException && datei.signal.reason.name === "TimeoutError" ? datei.signal.reason.message : null;
      return abweisungAus(null, { fehler: `Upload von ${anzeige} gescheitert: ${frist ?? (e instanceof Error ? e.message : "unbekannt")}` }, "Upload gescheitert", HINWEIS_UPLOAD);
    } finally {
      clearTimeout(uhr);
      lauf?.removeEventListener("abort", beiAbbruch);
    }
    eingang[d.rolle] = ziel.pfad;
  }
  return { art: "ok", eingang };
}

export interface VorschauZeileAnzeige {
  rolle: MedienRolle;
  felder: Record<string, unknown>;
}

export interface Vorschau {
  art: "vorschau";
  zeilen: VorschauZeileAnzeige[];
  vorschau_sha256: string;
  abgleich: AbgleichErgebnis;
  speicher: SpeicherMessung | null;
}

/** Antwort des Prüflaufs lesen; die Zeilen bleiben unverändert, damit sie genau so zurückgehen. */
export function leseVorschau(status: number | null, daten: unknown): Vorschau | Abweisung {
  if (status === 200 && istObjekt(daten) && daten.art === "vorschau" && Array.isArray(daten.vorschau) && typeof daten.vorschau_sha256 === "string" && istObjekt(daten.abgleich)) {
    const zeilen = (daten.vorschau as unknown[]).filter((z): z is VorschauZeileAnzeige => istObjekt(z) && typeof z.rolle === "string" && istObjekt(z.felder));
    if (zeilen.length === 3) {
      return { art: "vorschau", zeilen, vorschau_sha256: daten.vorschau_sha256, abgleich: daten.abgleich as unknown as AbgleichErgebnis, speicher: istObjekt(daten.speicher) ? (daten.speicher as unknown as SpeicherMessung) : null };
    }
  }
  return abweisungAus(status, daten, "Prüflauf ohne lesbare Vorschau");
}

export interface Eingespielt {
  art: "eingespielt";
  zeilen: Array<{ rolle: MedienRolle; id: number; wiederverwendet: boolean }>;
}

export function leseEingespielt(status: number | null, daten: unknown): Eingespielt | Abweisung {
  if (status === 200 && istObjekt(daten) && daten.art === "eingespielt" && Array.isArray(daten.zeilen)) {
    const zeilen = (daten.zeilen as unknown[]).filter(
      (z): z is { rolle: MedienRolle; id: number; wiederverwendet: boolean } => istObjekt(z) && typeof z.rolle === "string" && typeof z.id === "number" && typeof z.wiederverwendet === "boolean",
    );
    if (zeilen.length === 3) return { art: "eingespielt", zeilen };
  }
  return abweisungAus(status, daten, "Einspielen ohne lesbare Antwort");
}

export function pruefen(slug: string, eingang: Record<MedienRolle, string>, beleg: unknown, holen: Holen, signal?: AbortSignal): Promise<Vorschau | Abweisung> {
  return postJson(holen, `/api/studio/${encodeURIComponent(slug)}/medien`, { eingang, beleg, nur_pruefen: true }, signal).then((r) => leseVorschau(r.status, r.daten));
}

export function einspielen(slug: string, eingang: Record<MedienRolle, string>, beleg: unknown, vorschau: Vorschau, holen: Holen, signal?: AbortSignal): Promise<Eingespielt | Abweisung> {
  return postJson(holen, `/api/studio/${encodeURIComponent(slug)}/medien`, { eingang, beleg, bestaetigt: vorschau.vorschau_sha256, vorschau: vorschau.zeilen }, signal).then((r) =>
    leseEingespielt(r.status, r.daten),
  );
}

export function abgleichen(
  slug: string,
  eingang: string,
  ankerId: string,
  ausschnitt: Record<string, number>,
  holen: Holen,
  signal?: AbortSignal,
): Promise<{ art: "abgleich"; abgleich: AbgleichErgebnis; speicher: SpeicherMessung | null } | Abweisung> {
  return postJson(holen, `/api/studio/${encodeURIComponent(slug)}/medien/abgleich`, { eingang, anker_id: ankerId, ausschnitt: { ...ausschnitt, skalierung: 1 } }, signal).then((r) => {
    if (r.status === 200 && istObjekt(r.daten) && istObjekt(r.daten.abgleich)) {
      return { art: "abgleich" as const, abgleich: r.daten.abgleich as unknown as AbgleichErgebnis, speicher: istObjekt(r.daten.speicher) ? (r.daten.speicher as unknown as SpeicherMessung) : null };
    }
    return abweisungAus(r.status, r.daten, "Abgleich ohne lesbare Antwort");
  });
}

// ── Bausteine ──

export function abgleichText(a: Pick<AbgleichErgebnis, "urteil" | "abweichung_max" | "toleranz" | "grund">): string {
  const urteil = a.urteil === "bestanden" ? "bestanden" : "nicht bestanden";
  if (a.abweichung_max === null) return `${urteil} — ${a.grund ?? "nicht verglichen"}`;
  return `${urteil} — größte Abweichung ${a.abweichung_max} (Toleranz ${a.toleranz})`;
}

/** Versionen des Abgleichs; „WebAssembly“, wenn sharp nicht nativ läuft (Nachbesserung infra-1). */
export function versionenText(v: Partial<AbgleichErgebnis["versionen"]> | null | undefined): string {
  const art = v?.nativ === true ? "nativ" : v?.nativ === false ? "WebAssembly, nicht nativ" : "Laufart unbekannt";
  return `sharp ${v?.sharp ?? "?"}, libvips ${v?.vips ?? "?"} (${art})`;
}

function speicherText(s: SpeicherMessung | null): string | null {
  if (s === null) return null;
  return `Speicher des Servers: RSS ${bytesText(s.rss_vorher_b)} → ${bytesText(s.rss_nachher_b)} · Spitze des Prozesses (maxRSS) ${bytesText(s.max_rss_kib * 1024)}`;
}

function Wert({ titel, children, ...daten }: { titel: string; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <div className="min-w-0">
      <dt className="mono-label">{titel}</dt>
      <dd className="break-words" {...daten}>
        {children}
      </dd>
    </div>
  );
}

function HashZeile({ m }: { m: StudioMedium }) {
  return (
    <span className="font-[family-name:var(--font-jbmono)] wrap-anywhere" title={`SHA-256 (vom Server beim Einspielen berechnet): ${m.sha256}\nBytes: ${m.bytes}`}>
      {kurzHash(m.sha256)} · {bytesText(m.bytes)}
    </span>
  );
}

function videoWerte(m: StudioMedium): string {
  const teile = [
    m.breite !== null && m.hoehe !== null ? `${m.breite}×${m.hoehe}` : null,
    m.fps !== null ? `${zahl(m.fps)} fps` : null,
    m.dauer_s !== null ? `${zahl(m.dauer_s)} s` : null,
    m.aigc_kennzeichen === null ? null : `AIGC-Kennzeichen ${m.aigc_kennzeichen ? "ja" : "nein"}`,
  ].filter(Boolean);
  return teile.length > 0 ? `${teile.join(" · ")} (laut Beleg, ffprobe)` : "keine Angaben im Beleg";
}

/** Urteil der Medien-Regel (Server) mit allen Gründen und das jüngste Prüfprotokoll. */
function FreigabeUrteil({ k }: { k: MedienKette }) {
  const p = k.pruefungen?.[0] ?? null;
  return (
    <div className="mt-3 text-[11px] break-words" data-medien-urteil={k.urteil.freigebbar ? "freigebbar" : "gesperrt"}>
      <p className="font-semibold" style={{ color: k.urteil.freigebbar ? FARBE_GRUEN : FARBE_ROT }}>
        Freigabe (Medien-Regel, Server): {k.urteil.freigebbar ? "freigebbar" : `gesperrt — ${k.urteil.gruende.length} Grund/Gründe`}
      </p>
      {k.urteil.gruende.length > 0 && (
        <ul className="list-disc pl-5 mt-1" data-medien-gruende>
          {k.urteil.gruende.map((g) => (
            <li key={g}>{maskiert(g)}</li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-text-muted mt-1" data-juengstes-protokoll={p?.id ?? "keins"}>
        {k.pruefungen === null
          ? "Prüfprotokolle nicht lesbar."
          : p === null
            ? "Noch kein Prüfprotokoll."
            : `Jüngstes Prüfprotokoll #${p.id} · ${zeitBerlin(p.geprueft_am, "ohne Zeitpunkt")} · Kürzel ${maskiert(p.pruefer_kuerzel)} · Urteil ${p.urteil === "bestanden" ? "bestanden" : "nicht bestanden"} · Rechte ${p.rechte_status === "geklaert" ? "geklärt" : "offen"} · ${k.pruefungen.length} Protokoll(e)`}
      </p>
    </div>
  );
}

/**
 * Prüfansicht erst beim Öffnen aufbauen: Ein geschlossenes Video lädt nichts. Die Eingaben der Checkliste hält der
 * Bereich (Nachbesserung oberflaeche-4): Schließen und wieder Öffnen verliert sie nicht, erst ein Neuladen der Seite.
 */
export function PruefBereich({ k, slug, anker, holen, neuLaden }: { k: MedienKette; slug: string; anker: AnkerEintrag | null; holen: Holen; neuLaden: () => void }) {
  const [offen, setOffen] = useState(false);
  const [eingaben, setEingaben] = useState<PruefEingaben | null>(null);
  const leer = () => leereEingaben(k.original?.prompt_klauseln ?? []);
  const gehalten = { wert: eingaben ?? leer(), setze: (f: (e: PruefEingaben) => PruefEingaben) => setEingaben((alt) => f(alt ?? leer())) };
  return (
    <details className="mt-3" onToggle={(e) => setOffen(e.currentTarget.open)} data-pruefbereich={k.export.id}>
      <summary className="cursor-pointer text-[12px]" style={{ color: "var(--gp-ink)" }}>
        Prüfansicht öffnen (Export in voller Bildrate, Anker daneben, Prüfprotokoll)
      </summary>
      {offen && <PruefAnsicht slug={slug} kette={k} anker={anker} dateiAdresse={(id) => dateiPfad(slug, id)} holen={holen} gespeichert={neuLaden} gehalten={gehalten} />}
    </details>
  );
}

function KettenKarte({ k, slug, freigabe }: { k: MedienKette; slug: string; freigabe?: ReactNode }) {
  const ex = k.export;
  const og = k.original;
  const sb = k.startbild;
  return (
    <article className="card-ghost p-4 min-w-0" data-medium={ex.id} data-luecken={k.luecken.length}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="font-[family-name:var(--font-jbmono)] text-[10px] text-text-muted">Export #{ex.id}</span>
        <span className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider" style={{ background: "var(--gp-hairline)", color: "var(--gp-gold)" }}>
          Video
        </span>
        <span className="text-[11px] text-text-muted break-words">
          Anker {maskiert(ex.anker_id)} · eingespielt {zeitBerlin(ex.eingespielt_am, "ohne Zeitpunkt")}
        </span>
      </div>
      {k.luecken.length > 0 && (
        <p className="text-[11px] break-words" style={{ color: FARBE_ROT }} data-ketten-luecke>
          Kette unvollständig: {k.luecken.map(maskiert).join(" · ")}
        </p>
      )}
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-2 text-xs">
        <Wert titel="Export (Datei)" data-export-hash={ex.sha256}>
          <HashZeile m={ex} /> · <a href={dateiPfad(slug, ex.id)} target="_blank" rel="noopener" className="underline" data-datei-link={ex.id}>ansehen</a>
        </Wert>
        <Wert titel="Export (Video)">{videoWerte(ex)}</Wert>
        <Wert titel="Schnitt">
          {ex.schnitt_von_s !== null && ex.schnitt_bis_s !== null ? `${zahl(ex.schnitt_von_s)}–${zahl(ex.schnitt_bis_s)} s im Original (laut Beleg)` : "kein Schnittfenster"}
        </Wert>
        <Wert titel="KI-Hinweis im Bild (laut Beleg)" data-ki-hinweis="">
          {ex.ki_hinweis_text === null ? "nicht angegeben" : `„${maskiert(ex.ki_hinweis_text)}“`}
        </Wert>
        <Wert titel="Original">
          {og === null ? (
            <span style={{ color: FARBE_ROT }}>fehlt</span>
          ) : (
            <>
              #{og.id} · <HashZeile m={og} /> · <a href={dateiPfad(slug, og.id)} target="_blank" rel="noopener" className="underline" data-datei-link={og.id}>ansehen</a>
              <span className="block text-[10px] text-text-muted">nur auf Wunsch: Das Original ist groß (Egress)</span>
            </>
          )}
        </Wert>
        <Wert titel="Erzeugung (laut Beleg)">
          {og === null ? "—" : `${maskiert(og.erzeuger ?? "ohne Erzeuger")} · ${maskiert(og.modell ?? "ohne Modell")} · Job ${maskiert(og.job_id ?? "ohne id")} · ${videoWerte(og)}`}
        </Wert>
        <Wert titel="Credits (laut Beleg)" data-credits={og?.kosten_credits === null || og === null ? "keine" : String(og.kosten_credits)}>
          {og === null || og.kosten_credits === null ? "keine Angabe" : `${zahl(og.kosten_credits)} Credits${og.kosten_vorschau_credits !== null ? ` (Vorschau ${zahl(og.kosten_vorschau_credits)})` : ""}`}
          {og?.kosten_quelle ? <span className="block text-[10px] text-text-muted">Quelle: {maskiert(og.kosten_quelle)}</span> : null}
        </Wert>
        <Wert titel="Startbild-Abgleich (gemessen)" data-startbild-abgleich={sb?.startbild_abgleich ?? "fehlt"}>
          {sb === null ? (
            <span style={{ color: FARBE_ROT }}>Startbild fehlt</span>
          ) : (
            <>
              <span style={{ color: sb.startbild_abgleich === "bestanden" ? FARBE_GRUEN : FARBE_ROT }}>
                {sb.startbild_abgleich === "bestanden" ? "bestanden" : "nicht bestanden"}
                {sb.startbild_abweichung_max !== null ? ` — größte Abweichung ${sb.startbild_abweichung_max}` : " — nicht verglichen"}
              </span>
              <span className="block text-[10px] text-text-muted">
                #{sb.id} · <HashZeile m={sb} />
                {sb.ausschnitt ? ` · Ausschnitt ${sb.ausschnitt.breite}×${sb.ausschnitt.hoehe} bei (${sb.ausschnitt.x}, ${sb.ausschnitt.y})` : ""} ·{" "}
                <a href={dateiPfad(slug, sb.id)} target="_blank" rel="noopener" className="underline" data-datei-link={sb.id}>ansehen</a>
              </span>
            </>
          )}
        </Wert>
      </dl>
      {freigabe}
    </article>
  );
}

function Vorschautabelle({ v }: { v: Vorschau }) {
  const spalten = Array.from(new Set(v.zeilen.flatMap((z) => Object.keys(z.felder)))).sort();
  const anzeige = (x: unknown): string => (x === null ? "null" : typeof x === "string" ? maskiert(x) : maskiert(JSON.stringify(x)));
  return (
    <div className="overflow-x-auto mt-2" data-vorschau-tabelle>
      <table className="text-[10px] font-[family-name:var(--font-jbmono)] min-w-full">
        <thead>
          <tr>
            <th className="text-left pr-3">Spalte</th>
            {v.zeilen.map((z) => (
              <th key={z.rolle} className="text-left pr-3">
                {ROLLEN_TEXT[z.rolle] ?? maskiert(z.rolle)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spalten.map((s) => (
            <tr key={s} className="align-top">
              <td className="pr-3 text-text-muted">{s}</td>
              {v.zeilen.map((z) => (
                <td key={z.rolle} className="pr-3 max-w-[22rem] break-all">
                  {anzeige(z.felder[s])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type EinspielStand =
  | { art: "bereit" }
  | { art: "laeuft"; text: string; abbrechbar: boolean }
  | { art: "vorschau"; eingang: Record<MedienRolle, string>; beleg: unknown; vorschau: Vorschau; fuer: string }
  | { art: "fertig"; ergebnis: Eingespielt }
  | { art: "fehler"; abweisung: Abweisung };

/** Lauf-Steuerung eines Panels: Nummer des aktuellen Laufs und sein Abbruch (Nachbesserung oberflaeche-1, -2). */
interface LaufSteuerung {
  nr: number;
  steuerung: AbortController | null;
}

/** Neuen Lauf beginnen: der vorige bricht ab und zählt nicht mehr; aktuell() ist nur für diesen Lauf wahr. */
function beginneLauf(l: LaufSteuerung): { signal: AbortSignal; aktuell: () => boolean } {
  l.steuerung?.abort();
  const steuerung = new AbortController();
  const nr = (l.nr += 1);
  l.steuerung = steuerung;
  return { signal: steuerung.signal, aktuell: () => l.nr === nr };
}

/** Laufenden Lauf verwerfen (Abbruch, Eingabe geändert, Seite verlassen): späte Antworten zählen nicht mehr. */
function verwirfLauf(l: LaufSteuerung): void {
  l.nr += 1;
  l.steuerung?.abort();
  l.steuerung = null;
}

/** Gewählte Dateien und Beleg des Formulars. */
export interface Auswahl {
  startbild: (Datei & Blob) | null;
  original: (Datei & Blob) | null;
  export: (Datei & Blob) | null;
  beleg: (Datei & Blob) | null;
}

/** Was vor dem Hochladen fehlt oder nicht passt (im Browser geprüft; maßgeblich ist der Server). */
export function auswahlFehler(a: Auswahl): string[] {
  const fehler: string[] = [];
  const erlaubt: Record<MedienRolle, MediumMime[]> = { startbild: ["image/png", "image/jpeg"], original: ["video/mp4"], export: ["video/mp4"] };
  for (const rolle of ["startbild", "original", "export"] as const) {
    const d = a[rolle];
    if (d === null) fehler.push(`${ROLLEN_TEXT[rolle]} fehlt`);
    else if (!erlaubt[rolle].includes(mimeFuerDatei(d) as MediumMime)) fehler.push(`${ROLLEN_TEXT[rolle]}: Dateityp ${d.type || "unbekannt"} passt nicht`);
    else if (d.size > 50_000_000) fehler.push(`${ROLLEN_TEXT[rolle]}: größer als 50.000.000 B`);
  }
  if (a.beleg === null) fehler.push("Beleg (JSON) fehlt");
  return fehler;
}

/** Gewählte Dateien mit Name und Größe: Die Vorschau zeigt, für welche Auswahl sie gilt (Nachbesserung oberflaeche-1). */
export function auswahlText(a: Auswahl): string {
  const teil = (titel: string, d: (Datei & Blob) | null) => (d === null ? `${titel} —` : `${titel} „${maskiert(d.name)}“ (${bytesText(d.size)})`);
  return [teil("Startbild", a.startbild), teil("Original", a.original), teil("Export", a.export), teil("Beleg", a.beleg)].join(" · ");
}

function Dateiwahl({
  titel,
  akzeptiert,
  datenFeld,
  wahl,
  gesperrt = false,
}: {
  titel: string;
  akzeptiert: string;
  datenFeld: string;
  wahl: (d: (Datei & Blob) | null) => void;
  gesperrt?: boolean;
}) {
  return (
    <label className="block min-w-0 text-[11px]">
      <span className="mono-label block">{titel}</span>
      <input
        type="file"
        accept={akzeptiert}
        disabled={gesperrt}
        className="mt-1 block w-full min-w-0 text-[11px] disabled:opacity-40"
        data-dateiwahl={datenFeld}
        onChange={(e) => wahl(e.currentTarget.files?.[0] ?? null)}
      />
    </label>
  );
}

function Abweisungsanzeige({ a }: { a: Abweisung }) {
  return (
    <div className="text-[11px] break-words mt-2" style={{ color: FARBE_ROT }} role="alert" data-medien-fehler={a.httpStatus ?? "netz"}>
      <p>{a.text}</p>
      {a.felder.length > 0 && <p className="mt-1">Abweichende Felder: {a.felder.join(", ")}</p>}
      {a.vorhanden && (
        <p className="mt-1" style={{ color: FARBE_BERNSTEIN }} data-vorhanden>
          Schon vorhanden: Startbild #{a.vorhanden.startbild}, Original #{a.vorhanden.original}, Export #{a.vorhanden.export}
        </p>
      )}
      <p className="mt-1 text-text-muted" data-medien-fehler-hinweis>
        {a.hinweis ?? HINWEIS_SERVER}
      </p>
    </div>
  );
}

/** Abbau, Neuladen und Schließen während eines Laufs: Abbruch bzw. Rückfrage des Browsers (Nachbesserung oberflaeche-2). */
function useLaufSchutz(lauf: { current: LaufSteuerung }, laeuft: boolean): void {
  // Seite verlassen (Navigation im Dashboard baut die Seite ab): laufenden Upload und Prüflauf abbrechen.
  useEffect(() => {
    const l = lauf.current;
    return () => verwirfLauf(l);
  }, [lauf]);
  // Neu laden oder Tab schließen, solange ein Lauf läuft: Der Browser fragt nach (beforeunload).
  useEffect(() => {
    if (!laeuft || typeof window === "undefined") return;
    const warne = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warne);
    return () => window.removeEventListener("beforeunload", warne);
  }, [laeuft]);
}

function Einspielen({ slug, holen, eingespielt }: { slug: string; holen: Holen; eingespielt: () => void }) {
  const [auswahl, setAuswahl] = useState<Auswahl>({ startbild: null, original: null, export: null, beleg: null });
  const [stand, setStand] = useState<EinspielStand>({ art: "bereit" });
  const [bestaetigt, setBestaetigt] = useState(false);
  const lauf = useRef<LaufSteuerung>({ nr: 0, steuerung: null });
  const ergebnis = useRef<HTMLDivElement | null>(null);
  const laeuft = stand.art === "laeuft";
  const fehlt = auswahlFehler(auswahl);
  useLaufSchutz(lauf, laeuft);
  // Fokus auf das Ergebnis, wenn ein Lauf endet: Der fokussierte Knopf verschwindet sonst (Nachbesserung oberflaeche-10).
  useEffect(() => {
    if (stand.art === "vorschau" || stand.art === "fertig" || stand.art === "fehler") ergebnis.current?.focus();
  }, [stand.art]);

  const pruefeLauf = useCallback(async () => {
    if (auswahlFehler(auswahl).length > 0 || auswahl.beleg === null) return;
    const l = beginneLauf(lauf.current);
    const setze = (s: EinspielStand) => {
      if (l.aktuell()) setStand(s);
    };
    setBestaetigt(false);
    setze({ art: "laeuft", text: "Beleg lesen …", abbrechbar: true });
    let beleg: unknown;
    try {
      beleg = JSON.parse(await auswahl.beleg.text());
    } catch {
      setze({ art: "fehler", abweisung: { art: "abgewiesen", httpStatus: null, text: "Beleg ist kein gültiges JSON", felder: [], vorhanden: null, hinweis: HINWEIS_NICHTS_HOCHGELADEN } });
      return;
    }
    const dateien = (["startbild", "original", "export"] as const).map((rolle) => {
      const datei = auswahl[rolle] as Datei & Blob;
      return { rolle, datei, mime: mimeFuerDatei(datei) as MediumMime };
    });
    const hoch = await ladeHoch(slug, dateien, holen, (text) => setze({ art: "laeuft", text, abbrechbar: true }), { signal: l.signal, senden: browserSenden() });
    if (!l.aktuell()) return;
    if (hoch.art !== "ok") {
      setze({ art: "fehler", abweisung: hoch });
      return;
    }
    const eingang = { startbild: hoch.eingang.startbild as string, original: hoch.eingang.original as string, export: hoch.eingang.export as string };
    setze({ art: "laeuft", text: "Prüflauf: Server liest die Dateien und gleicht das Startbild ab …", abbrechbar: true });
    const v = await pruefen(slug, eingang, beleg, holen, l.signal);
    if (!l.aktuell()) return;
    setBestaetigt(false);
    setze(v.art === "vorschau" ? { art: "vorschau", eingang, beleg, vorschau: v, fuer: auswahlText(auswahl) } : { art: "fehler", abweisung: v });
  }, [auswahl, slug, holen]);

  const spieleEin = useCallback(async () => {
    if (stand.art !== "vorschau" || !bestaetigt) return;
    const { eingang, beleg, vorschau } = stand;
    const l = beginneLauf(lauf.current);
    // Einspielen ist nicht abbrechbar: Ist die Anfrage gesendet, legt der Server die Zeilen an.
    setStand({ art: "laeuft", text: "Einspielen: verschieben, nachmessen, Zeilen anlegen … (nicht abbrechbar)", abbrechbar: false });
    const r = await einspielen(slug, eingang, beleg, vorschau, holen, l.signal);
    setBestaetigt(false);
    if (!l.aktuell()) return;
    if (r.art === "eingespielt") {
      setStand({ art: "fertig", ergebnis: r });
      eingespielt();
    } else {
      setStand({ art: "fehler", abweisung: r });
    }
  }, [stand, bestaetigt, slug, holen, eingespielt]);

  const abbrechen = () => {
    verwirfLauf(lauf.current);
    setBestaetigt(false);
    setStand({ art: "fehler", abweisung: abgebrochen(HINWEIS_ABBRUCH) });
  };

  // Jede Änderung der Auswahl verwirft Vorschau und Häkchen; ein laufender Lauf zählt dann nicht mehr.
  const waehle = (feld: keyof Auswahl) => (d: (Datei & Blob) | null) => {
    verwirfLauf(lauf.current);
    setAuswahl((a) => ({ ...a, [feld]: d }));
    setStand({ art: "bereit" });
    setBestaetigt(false);
  };

  return (
    <details className="mt-4" data-einspielen={stand.art}>
      <summary className="cursor-pointer text-[12px]" style={{ color: "var(--gp-ink)" }}>
        Video einspielen
      </summary>
      <p className="text-[10px] text-text-muted mt-2 break-words">
        Startbild, Original und Export gehen über signierte Upload-URLs direkt in den privaten Speicher; der Beleg (JSON der erzeugenden
        Sitzung) im Körper der Anfrage. Der Prüflauf legt keine Zeile und keine Inhaltsdatei an (gelöscht werden nur Reste älter als 2 h und bei einem Fehler die eigenen Uploads). Eingefügt wird erst nach Häkchen und „So einspielen“; Zeilen sind
        danach unveränderlich.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <Dateiwahl titel="Startbild (PNG oder JPEG)" akzeptiert="image/png,image/jpeg" datenFeld="startbild" wahl={waehle("startbild")} gesperrt={laeuft} />
        <Dateiwahl titel="Original (MP4)" akzeptiert="video/mp4" datenFeld="original" wahl={waehle("original")} gesperrt={laeuft} />
        <Dateiwahl titel="Export (MP4)" akzeptiert="video/mp4" datenFeld="export" wahl={waehle("export")} gesperrt={laeuft} />
        <Dateiwahl titel="Beleg (JSON)" akzeptiert="application/json,.json" datenFeld="beleg" wahl={waehle("beleg")} gesperrt={laeuft} />
      </div>
      {fehlt.length > 0 && <p className="text-[10px] mt-2 break-words text-text-muted" data-auswahl-fehlt>Noch offen: {fehlt.join(" · ")}</p>}
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={() => {
            if (!laeuft && fehlt.length === 0) void pruefeLauf();
          }}
          aria-disabled={laeuft || fehlt.length > 0}
          className="min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
          data-pruefen-knopf
        >
          Hochladen und Prüflauf starten
        </button>
        {stand.art === "laeuft" && stand.abbrechbar && (
          <button type="button" onClick={abbrechen} className="min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity" data-einspielen-abbrechen>
            Abbrechen
          </button>
        )}
      </div>
      {/* Nur der Statustext ist eine Live-Region; Vorschau und Fehler bekommen den Fokus (oberflaeche-10). */}
      <div aria-live="polite" className="mt-2">
        {stand.art === "laeuft" && (
          <p className="text-[11px] break-words" style={{ color: "var(--gp-ink-3)" }} data-medien-laeuft>
            {stand.text}
          </p>
        )}
      </div>
      <div ref={ergebnis} tabIndex={-1} className="outline-none min-w-0" data-einspiel-ergebnis>
        {stand.art === "fehler" && <Abweisungsanzeige a={stand.abweisung} />}
        {stand.art === "fertig" && (
          <p className="text-[11px] break-words" style={{ color: FARBE_GRUEN }} data-eingespielt>
            Eingespielt:{" "}
            {stand.ergebnis.zeilen.map((z) => `${ROLLEN_TEXT[z.rolle] ?? z.rolle} #${z.id}${z.wiederverwendet ? " (bestand schon gleich)" : ""}`).join(" · ")}
          </p>
        )}
        {stand.art === "vorschau" && (
          <div className="mt-2 min-w-0" data-vorschau={stand.vorschau.vorschau_sha256}>
            <p className="text-[11px] break-words" style={{ color: "var(--gp-ink)" }}>
              Vorschau (nichts geschrieben) · Startbild-Abgleich:{" "}
              <span style={{ color: stand.vorschau.abgleich.urteil === "bestanden" ? FARBE_GRUEN : FARBE_ROT }} data-vorschau-abgleich={stand.vorschau.abgleich.urteil}>
                {abgleichText(stand.vorschau.abgleich)}
              </span>
            </p>
            <p className="text-[10px] break-words" style={{ color: "var(--gp-ink-2)" }} data-vorschau-fuer>
              Gilt für: {stand.fuer}
            </p>
            <p className="text-[10px] text-text-muted break-words">
              vorschau_sha256 {kurzHash(stand.vorschau.vorschau_sha256)} · {versionenText(stand.vorschau.abgleich.versionen)}
              {speicherText(stand.vorschau.speicher) ? ` · ${speicherText(stand.vorschau.speicher)}` : ""}
            </p>
            <Vorschautabelle v={stand.vorschau} />
            <label className="flex items-start gap-2 mt-3 text-[11px]">
              <input type="checkbox" checked={bestaetigt} onChange={(e) => setBestaetigt(e.currentTarget.checked)} data-bestaetigen className="mt-0.5" />
              <span>Ich habe die drei Zeilen geprüft. So sollen sie unveränderlich angelegt werden.</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (bestaetigt) void spieleEin();
              }}
              aria-disabled={!bestaetigt}
              className="mt-2 min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
              data-einspielen-knopf
            >
              So einspielen
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

type AbgleichStand =
  | { art: "bereit" }
  | { art: "laeuft"; text: string }
  | { art: "fehler"; abweisung: Abweisung }
  | { art: "fertig"; abgleich: AbgleichErgebnis; speicher: SpeicherMessung | null; datei: string };

/** Was vor dem Abgleich fehlt (im Browser geprüft; maßgeblich ist der Server). */
export function abgleichOffen(datei: Datei | null, ankerId: string, rezept: Record<"x" | "y" | "breite" | "hoehe", string>): string[] {
  const offen: string[] = [];
  const mime = datei === null ? null : mimeFuerDatei(datei);
  if (datei === null) offen.push("Bild (PNG oder JPEG)");
  else if (mime !== "image/png" && mime !== "image/jpeg") offen.push(`Bild: Dateityp ${datei.type || "unbekannt"} passt nicht`);
  if (ankerId === "") offen.push("Anker");
  for (const [k, name] of [["x", "x"], ["y", "y"], ["breite", "Breite"], ["hoehe", "Höhe"]] as const) {
    if (!/^\d{1,6}$/.test(rezept[k])) offen.push(`${name} (ganze Zahl)`);
  }
  return offen;
}

function Abgleich({ slug, manifest, holen }: { slug: string; manifest: AnkerManifest | null; holen: Holen }) {
  const anker = manifest?.eintraege.filter((e) => e.als_anker) ?? [];
  const [datei, setDatei] = useState<(Datei & Blob) | null>(null);
  const [ankerId, setAnkerId] = useState(anker[0]?.id ?? "");
  const [rezept, setRezept] = useState({ x: "", y: "", breite: "", hoehe: "" });
  const [stand, setStand] = useState<AbgleichStand>({ art: "bereit" });
  const lauf = useRef<LaufSteuerung>({ nr: 0, steuerung: null });
  const laeuft = stand.art === "laeuft";
  const offen = abgleichOffen(datei, ankerId, rezept);
  const bereit = offen.length === 0 && !laeuft;
  useLaufSchutz(lauf, laeuft);

  // Jede Änderung von Bild, Anker oder Rezept verwirft das Ergebnis (Nachbesserung oberflaeche-5).
  const geaendert = () => {
    verwirfLauf(lauf.current);
    setStand({ art: "bereit" });
  };

  const messen = useCallback(async () => {
    const mime = datei === null ? null : mimeFuerDatei(datei);
    if (!bereit || datei === null || mime === null) return;
    const l = beginneLauf(lauf.current);
    const setze = (s: AbgleichStand) => {
      if (l.aktuell()) setStand(s);
    };
    const werte = Object.fromEntries(Object.entries(rezept).map(([k, v]) => [k, Number(v)]));
    const hoch = await ladeHoch(slug, [{ rolle: "abgleich", datei, mime }], holen, (text) => setze({ art: "laeuft", text }), { signal: l.signal, senden: browserSenden() });
    if (!l.aktuell()) return;
    if (hoch.art !== "ok") {
      setze({ art: "fehler", abweisung: hoch });
      return;
    }
    setze({ art: "laeuft", text: "Abgleich läuft …" });
    const r = await abgleichen(slug, hoch.eingang.abgleich as string, ankerId, werte, holen, l.signal);
    if (!l.aktuell()) return;
    setze(r.art === "abgleich" ? { art: "fertig", abgleich: r.abgleich, speicher: r.speicher, datei: datei.name } : { art: "fehler", abweisung: r });
  }, [bereit, datei, slug, holen, ankerId, rezept]);

  const feld = (k: keyof typeof rezept, titel: string) => (
    <label className="block text-[11px] min-w-0">
      <span className="mono-label block">{titel}</span>
      <input
        inputMode="numeric"
        value={rezept[k]}
        disabled={laeuft}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setRezept((r) => ({ ...r, [k]: v }));
          geaendert();
        }}
        className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1 disabled:opacity-40"
        data-rezept={k}
      />
    </label>
  );

  return (
    <details className="mt-3" data-abgleich={stand.art}>
      <summary className="cursor-pointer text-[12px]" style={{ color: "var(--gp-ink)" }}>
        Startbild-Abgleich messen (ohne Zeile)
      </summary>
      <p className="text-[10px] text-text-muted mt-2 break-words">
        Lädt ein Bild hoch, schneidet den Anker nach dem Rezept aus und vergleicht Pixel für Pixel; legt keine Zeile an und löscht das Bild
        danach. Dient der Toleranz-Messung im Container (Antwort mit den Versionen von sharp und libvips). Skalierung: 1.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-3">
        <div className="sm:col-span-4 min-w-0">
          <Dateiwahl
            titel="Bild (PNG oder JPEG)"
            akzeptiert="image/png,image/jpeg"
            datenFeld="abgleich"
            gesperrt={laeuft}
            wahl={(d) => {
              setDatei(d);
              geaendert();
            }}
          />
        </div>
        <label className="sm:col-span-4 block text-[11px] min-w-0">
          <span className="mono-label block">Anker</span>
          <select
            value={ankerId}
            disabled={laeuft}
            onChange={(e) => {
              setAnkerId(e.currentTarget.value);
              geaendert();
            }}
            className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1 disabled:opacity-40"
            data-abgleich-anker
          >
            {anker.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id} ({e.breite}×{e.hoehe})
              </option>
            ))}
          </select>
        </label>
        {feld("x", "x")}
        {feld("y", "y")}
        {feld("breite", "Breite")}
        {feld("hoehe", "Höhe")}
      </div>
      {offen.length > 0 && !laeuft && (
        <p className="text-[10px] mt-2 break-words text-text-muted" data-abgleich-fehlt>
          Noch offen: {offen.join(" · ")}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          if (bereit) void messen();
        }}
        aria-disabled={!bereit}
        className="mt-3 min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
        data-abgleich-knopf
      >
        Abgleich messen
      </button>
      <div aria-live="polite" className="mt-2">
        {stand.art === "laeuft" && <p className="text-[11px]" style={{ color: "var(--gp-ink-3)" }}>{stand.text}</p>}
      </div>
      {stand.art === "fehler" && <Abweisungsanzeige a={stand.abweisung} />}
      {stand.art === "fertig" && (
        <div className="text-[11px] break-words" data-abgleich-ergebnis={stand.abgleich.urteil}>
          <p style={{ color: stand.abgleich.urteil === "bestanden" ? FARBE_GRUEN : FARBE_ROT }}>{abgleichText(stand.abgleich)}</p>
          <p className="text-[10px] break-words" style={{ color: "var(--gp-ink-2)" }} data-abgleich-gemessen>
            Gemessen: Bild „{maskiert(stand.datei)}“ ({stand.abgleich.startbild.breite}×{stand.abgleich.startbild.hoehe}) gegen Anker {maskiert(stand.abgleich.anker.id)} (
            {stand.abgleich.anker.breite}×{stand.abgleich.anker.hoehe}, SHA-256 {kurzHash(stand.abgleich.anker.sha256)}) · Rezept {stand.abgleich.ausschnitt.breite}×
            {stand.abgleich.ausschnitt.hoehe} bei ({stand.abgleich.ausschnitt.x}, {stand.abgleich.ausschnitt.y})
          </p>
          <p className="text-[10px] text-text-muted">
            {stand.abgleich.mittel !== null ? `Mittel ${zahl(stand.abgleich.mittel)} · Anteil über der Toleranz ${zahl((stand.abgleich.anteil_ueber_toleranz ?? 0) * 100, 2)} % · ` : ""}
            {versionenText(stand.abgleich.versionen)}
            {speicherText(stand.speicher) ? ` · ${speicherText(stand.speicher)}` : ""}
          </p>
        </div>
      )}
    </details>
  );
}

/** Medien-Panel: Liste der Videos des Objekts mit Urteil und Prüfansicht, „Video einspielen“ und der Abgleich. */
export function MedienPanel({
  slug,
  medien,
  credits,
  neuLaden,
  holen = fetch,
}: {
  slug: string;
  medien: StudioMedienTeil;
  credits: StudioMesswert<StudioCredits>;
  neuLaden: () => void;
  holen?: Holen;
}) {
  const manifest = ankerManifest(slug);
  const c = creditsText(credits);
  const w = medien.wert;
  return (
    <section className="card-ghost p-5 mb-8 min-w-0" data-medien-panel data-status={medien.status}>
      <h2 className="text-[10px] text-text-muted uppercase tracking-widest">Video / Medien{w ? ` · ${w.ketten.length}` : ""}</h2>
      <p className="text-[12px] mt-1 break-words" style={{ color: "var(--gp-ink-2)" }} data-medien-credits title={maskiert(`Quelle: ${credits.quelle}${credits.hinweis ? `\nHinweis: ${credits.hinweis}` : ""}`)}>
        Higgsfield-Credits: {c.wert} · {c.unter}
      </p>
      {/* Nur der Hinweis auf den Erzeugungsweg: Das Studio ruft Higgsfield nie selbst auf. */}
      <p className="text-[11px] mt-1 break-words" style={{ color: "var(--gp-ink-2)" }} data-erzeugungsweg>
        Higgsfield im Studio: aktiver Erzeugungsweg ist die Connector-Sitzung (Higgsfield-Connector in einer Claude-Sitzung). Das Studio ruft
        Higgsfield nicht auf.
      </p>
      {medien.status === "fehler" || w === null ? (
        <p className="text-[11px] mt-3 break-words" style={{ color: FARBE_ROT }} role="alert" data-medien-stand="fehler">
          Medien nicht lesbar: {maskiert(medien.hinweis ?? "unbekannter Fehler")}
        </p>
      ) : (
        <>
          {medien.hinweis && (
            <p className="text-[11px] mt-2 break-words" style={{ color: FARBE_BERNSTEIN }} data-medien-hinweis>
              {maskiert(medien.hinweis)}
            </p>
          )}
          {w.ketten.length === 0 ? (
            <p className="text-[11px] mt-3 text-text-muted" data-medien-stand="leer">
              Noch kein Video eingespielt (gelesen {zeitBerlin(medien.gemessen_am, "ohne Zeitpunkt")}).
            </p>
          ) : (
            <div className="space-y-3 mt-3" data-medien-stand="daten">
              {w.ketten.map((k) => (
                <KettenKarte
                  key={k.export.id}
                  k={k}
                  slug={slug}
                  freigabe={
                    <>
                      <FreigabeUrteil k={k} />
                      <PruefBereich k={k} slug={slug} anker={manifest?.eintraege.find((e) => e.id === k.export.anker_id) ?? null} holen={holen} neuLaden={neuLaden} />
                      {/* Caption zu diesem Video (Nachbesserung Paket C, Auftrag C; Ablauf Video-Asset, Schritt 5). */}
                      <TextErzeugen slug={slug} medium={{ id: k.export.id, sha256: k.export.sha256 }} holen={holen} fertig={neuLaden} />
                    </>
                  }
                />
              ))}
            </div>
          )}
          {w.einzeln.length > 0 && (
            <p className="text-[11px] mt-2 break-words" style={{ color: FARBE_BERNSTEIN }} data-medien-einzeln>
              Zeilen ohne Export: #{w.einzeln.join(", #")}
            </p>
          )}
        </>
      )}
      <Einspielen slug={slug} holen={holen} eingespielt={neuLaden} />
      <Abgleich slug={slug} manifest={manifest} holen={holen} />
    </section>
  );
}
