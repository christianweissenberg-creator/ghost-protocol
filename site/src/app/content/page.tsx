"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { KPICard } from "@/components/ui/KPICard";
import { objekteFehlerArt, objektFehlerText, useFreigaben } from "@/lib/hooks-status";
import type { ObjekteFehlerArt } from "@/lib/hooks-status";
import { werteCounselAus } from "@/lib/counsel-urteil";
import type { CounselAuswertung } from "@/lib/counsel-urteil";
import {
  MIN_FREIGABE_ZEICHEN,
  enthaeltGeschuetztenNamen,
  maskiereGeschuetzteNamen,
  pruefeFreigabe,
} from "@/lib/freigabe-regeln";
import type { FreigabePruefung } from "@/lib/freigabe-regeln";
import type { CounselUrteil } from "@/lib/status-types";

// Stufe 1 (05.11.2026) — Freigabe mit Beleg-Kette:
// - Die Kachel "Zur Freigabe" zählt über /api/freigaben (alle wartenden Einträge), nicht
//   mehr innerhalb der 50 geladenen Zeilen; Lesefehler heißen "nicht lesbar".
// - Freigeben/Ablehnen/Gepostet werten die Antwort von /api/content/status aus und zeigen
//   Fehler (400/409/500) an; vorher blieb ein abgewiesener Klick unsichtbar.
// - Jede Zeile zeigt, worauf das COUNSEL-Urteil beruht (Beleg-Kette), und ob der Text zur
//   Freigabe derselbe ist, den COUNSEL geprüft hat.
// - Feste, nie gemessene Kostenangaben sind entfernt; Ziele heißen "Ziel, nicht gemessen".
//
// Fixrunde 06.11.2026 (adversariale Prüfung, Befunde R2, R4, R10, R19, R24, R31, R34, R35, R38):
// - Freigeben ist gesperrt, solange pruefeFreigabe(werteCounselAus(review_notes), body) sperrt;
//   der Sperrgrund steht am Knopf. Maßgeblich bleibt die Prüfung auf dem Server (409 + Grund).
// - Grünes FREIGABE nur, wenn COUNSEL genau den Freigabetext geprüft hat; sonst bernsteinfarben
//   "COUNSEL prüfte die Vorfassung · Freigabetext ungeprüft". Welcher Text freigegeben wird,
//   entscheidet der Inhaber (R2) — diese Seite zeigt nur an.
// - Der geschützte Name erscheint nur im Freigabetext roh (mit Warnung, Freigabe gesperrt);
//   COUNSEL-Text und alle übrigen Modell-, Server- und Betreibertexte werden maskiert angezeigt.
//   Freigabetext ist der body einer Zeile bzw. im Pipeline-Ergebnis die PUBLISHER-Ausgabe eines
//   Laufs, der zur Freigabe gelangt ist (complete/partial). Eine PUBLISHER-Ausgabe aus einem
//   abgebrochenen Lauf (etwa Namensschutz-Abbruch) ist kein Freigabetext und wird maskiert.
// - "Content produzieren" sendet je Lauf eine lauf_id. Nach unbekanntem Ausgang (Netzwerkfehler,
//   5xx, kein lesbares JSON) sendet der nächste Klick dieselbe ID, damit der Server einen schon
//   gestarteten Lauf erkennt (409) statt einen zweiten bezahlten Lauf zu starten.
// - Der Starttab kommt aus ?tab=content|pipeline|calendar (useSearchParams in Suspense).
//
// Gesamtprüfung 06.11.2026:
// - Kopieren (X-Thread-Vorschau) nur bei Status freigegeben oder gepostet UND nur, wenn
//   pruefeFreigabe den Text durchlässt und kein geschützter Name darin steht (kopierSperre).
//   Vorher kopierte der Knopf in jedem Status, auch abgelehnte und gesperrte Texte. Veröffentlicht
//   wird von Hand per Kopieren; das Server-Gate sperrt nur den Statuswechsel.
// - CTA-Link mit geschütztem Namen: Anzeige maskiert, rote Warnung, Kopieren gesperrt (vorher
//   wurde maskiert angezeigt, aber roh kopiert).
// - LinkedIn hat in der Pipeline weder Format noch Anweisungen: Die Seite sagt das und startet
//   dafür keinen Lauf (vorher 400 ohne format). Ob LinkedIn Plattform wird, entscheidet der
//   Inhaber (R39); die Seite nimmt das nicht vorweg.
// - Untergrenzen der Laufkosten ("mindestens") werden abgerundet, nie über der Summe.

// ═══ TYPES ═══

/** Vermerk mit Stufe und Grund, wie die Pipeline ihn in metadata schreibt (seit Stufe 1). */
interface Vermerk {
  stufe?: string;
  grund?: string;
  detail?: string;
  am?: string;
}

interface CounselVermerk {
  urteil?: string;
  zeile?: string | null;
  grund?: string;
  geprueft?: string;
  am?: string;
}

/** Betreiber-Entscheidung aus /api/content/status (metadata.freigabe, metadata.gepostet). */
interface AktionsVermerk {
  aktion?: string;
  am?: string;
  durch?: string;
  grund?: string;
  published_url?: string;
}

interface ObjektSnapshot {
  abgerufen_am?: string;
  export?: { version?: string | null; quelle?: string | null; generiert_am?: string | null } | null;
  objekt?: Record<string, unknown> | null;
}

interface StepEintrag {
  agent: string;
  status?: string;
  output?: string;
  fehler?: string;
  cost?: number | null;
  duration_ms?: number;
}

interface ContentMetadata {
  thema?: string;
  objekt_slug?: string | null;
  utm_content?: string | null;
  kampagne?: string | null;
  cta_link?: string | null;
  amplifier_empfehlung?: string;
  /** Vor Stufe 1 ein Text, seit Stufe 1 ein Vermerk mit Stufe und Grund. */
  fehler?: string | Vermerk;
  warnungen?: Vermerk[];
  steps?: StepEintrag[];
  counsel?: CounselVermerk;
  regelpaket?: { version?: string | null; stand?: string | null };
  objekt_snapshot?: ObjektSnapshot | null;
  researcher_quellen?: string;
  freigabe_hinweis?: { geprueft?: string; zur_freigabe?: string; identisch?: boolean };
  freigabe?: AktionsVermerk;
  gepostet?: AktionsVermerk;
  abgelehnt_durch?: string;
  metriken_verlauf?: unknown[];
}

interface ContentItem {
  id: number;
  title: string;
  content_type: string;
  status: string;
  body: string | null;
  platform: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  published_url: string | null;
  published_at: string | null;
  views: number | null;
  engagement: number | null;
  performance: Record<string, unknown> | null;
  metadata: ContentMetadata | null;
  created_at: string;
  updated_at: string;
}

interface ObjektOption {
  slug: string;
  name: string;
}

interface CalendarEntry {
  platform: string;
  format: string;
  topic: string;
}

// Stufe 1 (05.11.2026): Wochen dürfen leer sein (Woche 2 nach Streichung der
// Trading-Themen) — theme null, Tage optional.
interface CalendarWeek {
  theme: string | null;
  monday?: CalendarEntry;
  tuesday?: CalendarEntry;
  wednesday?: CalendarEntry;
  thursday?: CalendarEntry;
  friday?: CalendarEntry;
}

interface PipelineStep {
  agent: string;
  status: string;
  output?: string;
  fehler?: string;
  /** Geschätzt; null = nicht gemeldet. */
  cost?: number | null;
  duration_ms?: number;
  abgeschnitten?: boolean | null;
}

interface PipelineResult {
  contentId?: number;
  thema?: string;
  platform?: string;
  status: string;
  steps: PipelineStep[];
  summary?: {
    /** null: keine gelaufene Stufe hat Kosten gemeldet (Gegencheck 06.11.2026). */
    total_cost_usd?: number | null;
    kosten_unvollstaendig?: boolean;
    total_duration_ms?: number;
    completed?: string;
  };
  /** Vermerk; bei einer 500 der Route mit Schritten der Text der Meldung. */
  fehler?: Vermerk | string;
  counsel?: CounselVermerk;
  warnungen?: Vermerk[];
  speicherfehler?: string[];
  freigabe_hinweis?: { identisch?: boolean };
}

type Tab = "pipeline" | "calendar" | "content";

/** Eingaben eines Laufs aus dem Formular "Content produzieren". */
interface LaufEingaben {
  topic: string;
  platform: string;
  format: string;
  category: string;
  objektSlug: string;
}

/**
 * Ausgang eines Klicks auf "Content produzieren" (Befund R10).
 * - ergebnis: Antwort mit Schritten — der Lauf ist zu Ende (complete, abgelehnt, fehler …).
 * - existiert: 409 — zu dieser lauf_id gibt es schon eine content-Zeile; kein neuer Lauf.
 * - abgewiesen: 4xx mit lesbarer Antwort — vor jedem bezahlten Aufruf abgewiesen.
 * - nicht_gestartet: 5xx der Route mit Fehlertext, ohne Eintragsnummer — kein Eintrag, nichts bezahlt.
 * - abgebrochen: 5xx der Route mit Fehlertext und Eintragsnummer oder status "fehler" — der Lauf ist
 *   mit Fehler zu Ende (eine Zeile existiert).
 * - unbekannt: Netzwerkfehler, Antwort ohne lesbares JSON oder ohne Fehlertext der Route
 *   (etwa 502/504 eines Reverse-Proxys) — der Lauf kann laufen.
 * - nicht_gesendet: keine Lauf-ID erzeugbar; es wurde nichts gesendet.
 */
type LaufAusgang =
  | { art: "ergebnis"; ergebnis: PipelineResult }
  | { art: "existiert"; text: string; contentId: number | null }
  | { art: "abgewiesen"; text: string }
  | { art: "nicht_gestartet"; text: string }
  | { art: "abgebrochen"; text: string; contentId: number | null }
  | { art: "unbekannt"; text: string; contentId: number | null }
  | { art: "nicht_gesendet"; text: string };

type LaufMeldung = Exclude<LaufAusgang, { art: "ergebnis" }>;

/** Bezug des COUNSEL-Urteils zum Freigabetext (body). */
type FassungsBezug = "identisch" | "abweichend" | "nicht_pruefbar" | "kein_text";

/** Was der Pipeline-Fluss gerade zeigen kann. */
type FlussLage = "kein_lauf" | "laeuft" | "ergebnis" | "unbekannt";

interface FreigabeLage {
  counsel: CounselAuswertung;
  pruefung: FreigabePruefung;
  bezug: FassungsBezug;
  /** Von COUNSEL geprüfter Text (metadata.steps[1].output, SCRIBE); null = nicht gespeichert. */
  geprueftText: string | null;
  /** Der Freigabetext enthält den geschützten Namen. */
  nameImText: boolean;
}

// ═══ CONSTANTS ═══

// Status-Reihenfolge in der Freigabe-Ansicht: zur_freigabe zuerst (braucht Aktion),
// dann Entwurfs-/Zwischenstände & Fehlschläge, dann freigegeben, dann gepostet.
const STATUS_ORDER = ["zur_freigabe", "entwurf", "counsel_geprueft", "fehler", "abgelehnt", "freigegeben", "gepostet"];

const STATUS_META: Record<string, { label: string; color: string }> = {
  entwurf: { label: "Entwurf", color: "#6b6b7b" },
  counsel_geprueft: { label: "Counsel geprüft", color: "#38bdf8" },
  zur_freigabe: { label: "Zur Freigabe", color: "#f59e0b" },
  fehler: { label: "Fehler", color: "#ff4d6a" },
  abgelehnt: { label: "Abgelehnt", color: "#ff4d6a" },
  freigegeben: { label: "Freigegeben", color: "#22c55e" },
  gepostet: { label: "Gepostet", color: "#8b5cf6" },
};

const TYPE_LABELS: Record<string, string> = {
  article: "Artikel",
  report: "Report",
  social_post: "Social Post",
  newsletter: "Newsletter",
  product: "Produkt",
  thread: "Thread",
  longform: "Longform",
  carousel: "Carousel",
};

const PLATFORM_ICONS: Record<string, string> = {
  youtube: "▶",
  x: "𝕏",
  twitter: "𝕏",
  newsletter: "✉",
  tiktok: "♪",
  instagram: "◎",
  linkedin: "in",
};

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "#ff0000",
  x: "#1da1f2",
  twitter: "#1da1f2",
  newsletter: "#8b5cf6",
  tiktok: "#00f2ea",
  instagram: "#e1306c",
  linkedin: "#0a66c2",
};

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Mo",
  tuesday: "Di",
  wednesday: "Mi",
  thursday: "Do",
  friday: "Fr",
};

// Stufe 1 (05.11.2026): "Krypto-Trading" entfernt — kein Thema von Ghost Protocol.
const CATEGORIES = [
  { value: "ki_automation", label: "KI & Automation" },
  { value: "business_automation", label: "Business-Automation" },
  { value: "ghost_protocol", label: "Behind the Scenes" },
];

/**
 * Formate je Plattform, wie POST /api/content/pipeline sie annimmt (FORMATE_JE_PLATTFORM dort).
 * linkedin steht im Formular, hat in der Pipeline aber kein Format: Entscheidung offen (R39).
 */
const FORMATE_JE_PLATTFORM: Record<string, readonly string[]> = {
  youtube: ["longform", "short", "deep_dive"],
  x: ["thread"],
  twitter: ["thread"],
  tiktok: ["tiktok_short"],
  instagram: ["carousel", "reel", "story"],
  newsletter: ["newsletter_issue"],
};

/** Hinweis, wenn eine Plattform im Formular kein Pipeline-Format hat; null, wenn sie eines hat. */
function plattformOhneFormat(plattform: string): string | null {
  if (Object.prototype.hasOwnProperty.call(FORMATE_JE_PLATTFORM, plattform)) return null;
  return plattform === "linkedin"
    ? "LinkedIn ist in der Pipeline nicht hinterlegt (kein Format, keine Anweisungen) — ob es kommt, entscheidet der Inhaber. Für LinkedIn startet hier kein Lauf."
    : `Plattform „${maskiereGeschuetzteNamen(plattform)}“ ist in der Pipeline nicht hinterlegt — kein Lauf.`;
}

const TWEET_MAX = 280;

/** So viele Zeilen lädt die Liste; die Kacheln außer "Zur Freigabe" zählen nur darin. */
const LISTE_LIMIT = 50;

/** Höchstlänge des Ablehnungsgrunds — gleich wie in /api/content/status. */
const GRUND_MAX = 500;

/** Status, in denen ein Text zur Freigabe (body) erwartet wird. */
const STATUS_MIT_TEXT = ["zur_freigabe", "freigegeben", "gepostet"];

/** Felder des Objekt-Snapshots in der Reihenfolge, wie buildObjektBlock sie nutzt. */
const SNAPSHOT_ZEILEN: [string, string][] = [
  ["name", "Name"],
  ["untertitel", "Untertitel"],
  ["tagline", "Tagline"],
  ["ort", "Ort"],
  ["baujahr", "Baujahr"],
  ["preis", "Preis"],
  ["kurzbeschreibung", "Kurzbeschreibung"],
  ["statusBadge", "Status"],
  ["afaProzent", "AfA-Satz"],
  ["istDenkmal", "Denkmal"],
  ["kennzahlen", "Kennzahlen"],
  ["kampagnen", "Kampagnen"],
];

// Gegencheck 06.11.2026: 502 hat keine eigene Bezeichnung mehr. "Quelle nicht erreichbar" stand
// vor jeder 502 der Pipeline, auch bei fehlendem Token oder unvollständigem Objekt, wo die
// Quelle erreichbar war oder gar nicht abgefragt wurde. Die Ursache steht im Fehlertext.
const HTTP_ART: Record<number, string> = {
  400: "Abgewiesen",
  401: "Nicht angemeldet",
  404: "Nicht gefunden",
  409: "Konflikt",
  500: "Serverfehler",
};

const TABS: readonly Tab[] = ["pipeline", "calendar", "content"];

/** Reihenfolge der Pipeline-Stufen (agent-Namen wie in api/content/pipeline/route.ts). */
const STUFEN = ["researcher", "scribe", "counsel", "publisher", "amplifier"] as const;

/** Format der lauf_id laut Vertrag mit POST /api/content/pipeline (sonst 400). */
const LAUF_ID_MUSTER = /^[A-Za-z0-9:_-]{8,80}$/;

const AUSGANG_UNBEKANNT = "Ausgang unbekannt — der Lauf kann noch laufen, Content-Tab prüfen";

const FARBE_GRUEN = "var(--gp-emerald)";
const FARBE_ROT = "var(--gp-rose)";
const FARBE_BERNSTEIN = "var(--gp-amber)";

// body an Tweet-Grenzen splitten: Zeilen die mit "N/" oder "**N/M**" beginnen,
// Markdown-Bold-Sterne entfernen. Ohne Treffer: gesamter Body als ein Block.
function splitTweets(body: string): string[] {
  const lines = body.split("\n");
  const tweetStart = /^\*{0,2}\d+\/\d*\*{0,2}/;
  const tweets: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (tweetStart.test(line.trim())) {
      if (current.length) tweets.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) tweets.push(current.join("\n").trim());
  const cleaned = tweets.map((t) => t.replace(/\*\*/g, "")).filter((t) => t.length > 0);
  return cleaned.length > 0 ? cleaned : [body.trim()];
}

function charCountColor(len: number): string {
  if (len > TWEET_MAX) return "var(--gp-rose)";
  if (len > TWEET_MAX - 30) return "var(--gp-amber)";
  return "var(--gp-ink-3)";
}

// ═══ HILFSFUNKTIONEN (Stufe 1, 05.11.2026) ═══

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

/** Wie istObjekt, behält aber den deklarierten Typ (metadata kommt ungeprüft aus der DB). */
function alsObjekt<T extends object>(wert: T | string | null | undefined): T | null {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert) ? wert : null;
}

function ohne<T>(eintraege: Record<number, T>, id: number): Record<number, T> {
  const kopie = { ...eintraege };
  delete kopie[id];
  return kopie;
}

/** Fehler- oder Warnvermerk lesbar machen; alte Zeilen haben einen Text statt Vermerk. Maskiert. */
function vermerkText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? maskiert(v) : null;
  if (!istObjekt(v) || typeof v.grund !== "string" || !v.grund) return null;
  const stufe = typeof v.stufe === "string" && v.stufe ? `${v.stufe.toUpperCase()}: ` : "";
  const detail = typeof v.detail === "string" && v.detail ? ` (${v.detail})` : "";
  return maskiert(`${stufe}${v.grund}${detail}`);
}

function zeitText(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "nicht gespeichert";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? maskiert(iso) : d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function istHttpUrl(wert: string): boolean {
  try {
    const url = new URL(wert.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Für die Anzeige: geschützten Namen ersetzen. Gilt für alle Texte außer dem Freigabetext (body). */
function maskiert(text: string): string {
  return maskiereGeschuetzteNamen(text);
}

/** Wert aus DB oder Server für die Anzeige: maskiert; null/undefined ergeben einen leeren Text. */
function maskiertWert(wert: unknown): string {
  if (wert === null || wert === undefined) return "";
  return maskiert(typeof wert === "string" ? wert : String(wert));
}

/** Fehlertext einer JSON-Antwort (Feld fehler, sonst error); null, wenn keiner. */
function serverText(daten: unknown): string | null {
  if (!istObjekt(daten)) return null;
  if (typeof daten.fehler === "string" && daten.fehler.trim()) return daten.fehler;
  if (typeof daten.error === "string" && daten.error.trim()) return daten.error;
  return null;
}

function fehlerMeldung(status: number, daten: unknown): string {
  return maskiert(`${HTTP_ART[status] ?? "Fehler"} (HTTP ${status}): ${serverText(daten) ?? "ohne Fehlertext"}`);
}

/** Ein Snapshot-Feld als Textzeilen; Fehlendes heißt "nicht im Export", nie ein Ersatzwert. */
function snapshotWert(feld: string, wert: unknown): string[] {
  if (wert === null || wert === undefined || wert === "") return ["nicht im Export"];
  if (typeof wert === "boolean") return [wert ? "ja" : "nein"];
  if (feld === "afaProzent" && typeof wert === "number") return [`${wert} %`];
  if (Array.isArray(wert)) {
    if (wert.length === 0) return ["keine"];
    return wert.map((e) => {
      if (!istObjekt(e)) return String(e);
      const teil = (k: string) => (e[k] === undefined || e[k] === null || e[k] === "" ? "fehlt" : String(e[k]));
      if (feld === "kennzahlen") return `${teil("label")}: ${teil("wert")}`;
      if (feld === "kampagnen") return `${teil("kampagne")} (${teil("lpVariant")}): ${teil("lpUrl")}`;
      return JSON.stringify(e);
    });
  }
  if (typeof wert === "object") return [JSON.stringify(wert)];
  return [String(wert)];
}

/**
 * Letzte Erfassung aus performance; was nicht übergeben wurde, heißt "nicht erfasst".
 * Seit Stufe 1 schreibt /api/content/status immer "durch" mit. Fehlt es, stammt die Erfassung
 * von vorher: Damals wurde Fehlendes als 0 gespeichert, eine 0 ist dort kein Messwert (R19).
 */
function metrikenText(perf: Record<string, unknown> | null): string {
  if (!istObjekt(perf) || Object.keys(perf).length === 0) return "noch nicht erfasst";
  const imp = typeof perf.impressions === "number" ? `${perf.impressions} Impressions` : "Impressions nicht erfasst";
  const lik = typeof perf.likes === "number" ? `${perf.likes} Likes` : "Likes nicht erfasst";
  const zeit = typeof perf.erfasst_am === "string" ? zeitText(perf.erfasst_am) : "Zeitpunkt nicht gespeichert";
  const werte = `${imp} · ${lik} · ${zeit}`;
  const mitStufe1 = typeof perf.durch === "string" && perf.durch.trim() !== "";
  return mitStufe1 ? werte : `Erfassung vor Stufe 1, 0 kann Platzhalter sein — gespeichert: ${werte}`;
}

/** Eingaben für /api/content/status → nur ausgefüllte Felder; sonst Fehlermeldung. */
function metrikenNutzlast(d: { impressions: string; likes: string }): Record<string, number> | string {
  const nutzlast: Record<string, number> = {};
  const felder: [string, string, string][] = [
    ["impressions", d.impressions, "Impressions"],
    ["likes", d.likes, "Likes"],
  ];
  for (const [feld, roh, name] of felder) {
    const text = roh.trim();
    if (!text) continue;
    const zahl = Number(text);
    if (!Number.isInteger(zahl) || zahl < 0) return `${name}: ganze Zahl ab 0 erwartet`;
    nutzlast[feld] = zahl;
  }
  return Object.keys(nutzlast).length > 0 ? nutzlast : "Keine Metrik eingegeben";
}

function ablehnungText(meta: ContentMetadata): string {
  if (meta.abgelehnt_durch === "betreiber") {
    const grund = meta.freigabe?.grund;
    return maskiert(`Abgelehnt durch den Betreiber${grund ? ` — Grund: ${grund}` : " (ohne Grund)"}`);
  }
  if (meta.counsel?.urteil) {
    return maskiert(
      `Abgelehnt: COUNSEL-Urteil ${meta.counsel.urteil}${meta.counsel.grund ? ` (${meta.counsel.grund})` : ""} — nur FREIGABE lässt durch`
    );
  }
  return "Abgelehnt (Lauf vor Stufe 1: ohne Vermerk, wer abgelehnt hat)";
}

// ═══ STARTTAB (R38) ═══

/** ?tab=… aus der URL; Unbekanntes oder Fehlendes → null (dann gilt "pipeline"). */
function tabAusUrl(wert: string | null): Tab | null {
  return wert !== null && (TABS as readonly string[]).includes(wert) ? (wert as Tab) : null;
}

/**
 * Sichtbarer Tab: Ein Klick gilt, solange ?tab= in der URL derselbe ist wie beim Klick.
 * Ändert ein Link den Parameter, gewinnt wieder die URL. Ohne Effekt und ohne setState im Render.
 */
function sichtbarerTab(wahl: { tab: Tab; urlTab: string | null } | null, urlTab: string | null): Tab {
  if (wahl && wahl.urlTab === urlTab) return wahl.tab;
  return tabAusUrl(urlTab) ?? "pipeline";
}

// ═══ LAUF-ID UND AUSGANG (R10) ═══

/**
 * Neue Lauf-ID je Klick (crypto.randomUUID; ohne sicheren Kontext eine v4-UUID aus
 * crypto.getRandomValues). null, wenn keine Zufallsquelle da ist — dann startet kein Lauf.
 */
function neueLaufId(
  quelle: Partial<Pick<Crypto, "randomUUID" | "getRandomValues">> | undefined = globalThis.crypto
): string | null {
  let id: string | null = null;
  if (quelle && typeof quelle.randomUUID === "function") {
    id = quelle.randomUUID();
  } else if (quelle && typeof quelle.getRandomValues === "function") {
    const b = quelle.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return id !== null && LAUF_ID_MUSTER.test(id) ? id : null;
}

/** content_id (409) bzw. contentId (500) aus der Antwort; null, wenn keine gültige Nummer. */
function eintragsNummer(daten: Record<string, unknown> | null): number | null {
  if (!daten) return null;
  for (const wert of [daten.content_id, daten.contentId]) {
    if (typeof wert === "number" && Number.isInteger(wert) && wert > 0) return wert;
    if (typeof wert === "string" && /^[1-9]\d*$/.test(wert)) return Number(wert);
  }
  return null;
}

function statusLabel(status: unknown): string {
  if (typeof status !== "string" || !status) return "Status nicht gemeldet";
  return Object.prototype.hasOwnProperty.call(STATUS_META, status) ? STATUS_META[status].label : status;
}

/** Antwort mit lesbaren Schritten (jeder mit agent und status als Text)? */
function istLaufErgebnis(daten: Record<string, unknown>): boolean {
  return (
    typeof daten.status === "string" &&
    Array.isArray(daten.steps) &&
    daten.steps.every((s) => istObjekt(s) && typeof s.agent === "string" && typeof s.status === "string")
  );
}

/**
 * Antwort von POST /api/content/pipeline einordnen. Nur eine 4xx-Antwort mit lesbarem JSON
 * heißt "abgewiesen" (409: "Lauf existiert bereits").
 *
 * Gegencheck 06.11.2026: Eine 5xx mit JSON-Fehlertext (Feld "fehler") ist die Antwort des
 * Pipeline-Handlers selbst. Er läuft synchron (kein Nachlauf nach der Antwort) und ist damit
 * zu Ende; vorher hieß auch sie "der Lauf kann noch laufen". Mit lesbaren Schritten ist sie ein
 * Ergebnis (Status fehler, Kosten aus den Schritten), mit Eintragsnummer "abgebrochen", ohne Nummer
 * "nicht gestartet" — die Nummer entsteht beim Insert, vor dem ersten bezahlten Aufruf.
 * "Unbekannt" bleiben: Netzwerkfehler, Antworten ohne lesbares JSON oder ohne Fehlertext der
 * Route (etwa 502/504 eines Reverse-Proxys) und 2xx ohne lesbare Schritte.
 */
function werteLaufAntwortAus(status: number, daten: unknown): LaufAusgang {
  const obj = istObjekt(daten) ? daten : null;
  const nummer = eintragsNummer(obj);
  if (status >= 200 && status < 300) {
    if (obj && istLaufErgebnis(obj)) return { art: "ergebnis", ergebnis: obj as unknown as PipelineResult };
    return { art: "unbekannt", text: `${AUSGANG_UNBEKANNT} · Antwort (HTTP ${status}) nicht lesbar`, contentId: nummer };
  }
  if (obj && status === 409) {
    return {
      art: "existiert",
      text: `Lauf existiert bereits (#${nummer ?? "Nummer nicht gemeldet"}, ${maskiert(statusLabel(obj.status))})`,
      contentId: nummer,
    };
  }
  if (obj && status >= 400 && status < 500) {
    return { art: "abgewiesen", text: maskiert(`Lauf abgewiesen (HTTP ${status}): ${serverText(obj) ?? "ohne Fehlertext"}`) };
  }
  const routenFehler = obj && status >= 500 && typeof obj.fehler === "string" && obj.fehler.trim() ? obj.fehler : null;
  if (obj && routenFehler !== null) {
    if (istLaufErgebnis(obj)) {
      // 500 "Status zur_freigabe nicht gespeichert": alle Schritte samt Kosten liegen vor.
      const fehler = istObjekt(obj.fehler_vermerk) ? obj.fehler_vermerk : routenFehler;
      return { art: "ergebnis", ergebnis: { ...obj, fehler } as unknown as PipelineResult };
    }
    // Prüflauf 06.11.2026: status "fehler" setzt die Route nur, wenn eine Zeile existiert — auch
    // ohne lesbare Nummer ist das kein "nicht gestartet".
    if (nummer !== null || obj.status === "fehler") {
      const eintrag = nummer !== null ? `, Eintrag #${nummer}` : ", Eintragsnummer nicht lesbar";
      return { art: "abgebrochen", text: maskiert(`Lauf abgebrochen (HTTP ${status}${eintrag}): ${routenFehler}`), contentId: nummer };
    }
    return { art: "nicht_gestartet", text: maskiert(`Lauf nicht gestartet (HTTP ${status}): ${routenFehler}`) };
  }
  const teile = [AUSGANG_UNBEKANNT];
  if (nummer !== null) teile.push(`Eintrag #${nummer}`);
  teile.push(obj ? fehlerMeldung(status, obj) : `HTTP ${status} ohne lesbare Antwort`);
  return { art: "unbekannt", text: teile.join(" · "), contentId: nummer };
}

function netzwerkAusgang(e: unknown): LaufAusgang {
  const text = e instanceof Error && e.message ? e.message : "unbekannt";
  return { art: "unbekannt", text: `${AUSGANG_UNBEKANNT} · Netzwerkfehler: ${maskiert(text)}`, contentId: null };
}

/**
 * Prüflauf 06.11.2026 (R10 bei Wiederholung): Sendet ein Klick die offene Lauf-ID eines
 * unbekannten Ausgangs erneut, belegt eine Antwort ohne Ergebnis (nicht gestartet, abgebrochen,
 * abgewiesen) nur den Ausgang DIESES Versuchs. Der frühere Versuch mit derselben Lauf-ID kann
 * weiterlaufen und bezahlt werden; er bleibt "unbekannt", und die Lauf-ID bleibt, damit der
 * Server einen zweiten Lauf weiter mit 409 abweist. Bekannt wird er nur durch ein Ergebnis oder
 * 409 ("Lauf existiert bereits"). Vorher verwarf eine solche Antwort die Lauf-ID, und der
 * nächste Klick konnte einen zweiten bezahlten Lauf starten.
 */
function ausgangBeiWiederholung(ausgang: LaufAusgang, wiederholung: boolean): LaufAusgang {
  if (!wiederholung || ausgang.art === "ergebnis" || ausgang.art === "existiert" || ausgang.art === "unbekannt") {
    return ausgang;
  }
  return {
    art: "unbekannt",
    text: `${AUSGANG_UNBEKANNT} (früherer Versuch mit dieser Lauf-ID) · Dieser Versuch: ${ausgang.text}`,
    contentId: null,
  };
}

/** Nach unbekanntem Ausgang bleibt die Lauf-ID für den nächsten Klick; nach bekanntem wird sie verworfen. */
function laufIdNachAusgang(ausgang: LaufAusgang, laufId: string): string | null {
  return ausgang.art === "unbekannt" ? laufId : null;
}

/** Ein Lauf: POST mit lauf_id, Antwort einordnen. Wirft nie — jeder Fehler wird zum Ausgang. */
async function sendeLauf(holen: typeof fetch, eingaben: LaufEingaben, laufId: string): Promise<LaufAusgang> {
  try {
    const res = await holen("/api/content/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: eingaben.topic || undefined,
        platform: eingaben.platform,
        format: eingaben.format,
        category: eingaben.category,
        objekt_slug: eingaben.objektSlug || undefined,
        lauf_id: laufId,
      }),
    });
    const daten: unknown = await res.json().catch(() => null);
    return werteLaufAntwortAus(res.status, daten);
  } catch (e) {
    return netzwerkAusgang(e);
  }
}

// ═══ PIPELINE-FLUSS (R34) ═══

function stufenEtikett(lage: FlussLage, status: string | undefined): { text: string; farbe: string } {
  if (lage === "laeuft") return { text: "läuft", farbe: "#f59e0b" };
  if (lage === "unbekannt") return { text: "unbekannt", farbe: "#f59e0b" };
  if (lage === "kein_lauf") return { text: "—", farbe: "#6b6b7b" };
  if (status === "done") return { text: "fertig", farbe: "#22c55e" };
  if (status === "error") return { text: "Fehler", farbe: "#ff3366" };
  if (status === "running") return { text: "nicht abgeschlossen", farbe: "#f59e0b" };
  return { text: "nicht ausgeführt", farbe: "#6b6b7b" };
}

/** Hinweiszeile unter dem Fluss nach Laufende: gescheiterte Stufe und nicht ausgeführte Stufen. */
function flussHinweis(r: PipelineResult): string | null {
  const steps = Array.isArray(r.steps) ? r.steps : [];
  // Stufennamen stammen aus der Server-Antwort und werden wie alle Servertexte maskiert (R24).
  const offen = steps.filter((s) => s.status !== "done" && s.status !== "error").map((s) => maskiert(s.agent.toUpperCase()));
  const offenText =
    offen.length > 0 ? ` — ${offen.join(", ")} ${offen.length === 1 ? "wurde" : "wurden"} nicht ausgeführt.` : ".";
  if (r.status === "abgelehnt") {
    return `COUNSEL-Urteil ${alsUrteil(r.counsel?.urteil)}${offenText}`;
  }
  if (r.status === "fehler") {
    const gescheitert = steps.find((s) => s.status === "error");
    // Vermerk-Objekt; ein reiner Text (500 der Route mit Schritten ohne Vermerk) zählt als Grund.
    const f: Vermerk | null = typeof r.fehler === "string" ? { grund: r.fehler } : alsObjekt(r.fehler);
    const stufeRoh =
      typeof f?.stufe === "string" && f.stufe ? f.stufe.toUpperCase() : gescheitert ? gescheitert.agent.toUpperCase() : null;
    const stufe = stufeRoh === null ? null : maskiert(stufeRoh);
    const grundRoh =
      typeof f?.grund === "string" && f.grund
        ? `${f.grund}${typeof f.detail === "string" && f.detail ? ` (${f.detail})` : ""}`
        : (gescheitert?.fehler ?? null);
    return `Abbruch${stufe ? ` in Stufe ${stufe}` : ""}: ${grundRoh ? maskiert(grundRoh) : "ohne Grund"}${offenText}`;
  }
  if (offen.length > 0) return `Lauf beendet (${maskiert(r.status)})${offenText}`;
  return null;
}

/**
 * Untergrenze mit 4 Stellen (Gesamtprüfung 06.11.2026): abgerundet statt gerundet, damit
 * "mindestens" nie über der gemeldeten Summe liegt; unter $0.0001 "mehr als $0".
 */
function mindestensText(summe: number): string {
  if (summe > 0 && summe < 0.0001) return "mehr als $0 (gemeldet unter $0.0001)";
  return `mindestens $${(Math.floor(summe * 10_000 + 1e-6) / 10_000).toFixed(4)}`;
}

/** Geschätzte Kosten eines Laufs; ohne jede Kostenangabe "nicht gemeldet", nie 0 als Ersatz. */
function laufKostenText(r: PipelineResult): string {
  const gelaufen = r.steps.filter((s) => s.status !== "pending");
  const mitKosten = gelaufen.filter((s) => typeof s.cost === "number");
  if (mitKosten.length === 0) return "nicht gemeldet";
  const summe =
    typeof r.summary?.total_cost_usd === "number"
      ? r.summary.total_cost_usd
      : mitKosten.reduce((acc, s) => acc + (s.cost as number), 0);
  const ohne = gelaufen.length - mitKosten.length;
  if (ohne > 0) return `${mindestensText(summe)} · ${ohne} ${ohne === 1 ? "Stufe" : "Stufen"} ohne Angabe`;
  if (r.summary?.kosten_unvollstaendig) return `${mindestensText(summe)} · unvollständig`;
  return `$${summe.toFixed(4)}`;
}

// ═══ FREIGABE-LAGE (R2, R4, R24) ═══

function alsUrteil(wert: unknown): CounselUrteil {
  return wert === "FREIGABE" || wert === "ABLEHNUNG" ? wert : "UNKLAR";
}

/** Von COUNSEL geprüfter Text: metadata.steps[1].output (SCRIBE); null, wenn nicht gespeichert. */
function geprueftenText(meta: ContentMetadata): string | null {
  const schritt: unknown = Array.isArray(meta.steps) ? meta.steps[1] : undefined;
  if (!istObjekt(schritt) || typeof schritt.output !== "string") return null;
  if (typeof schritt.agent === "string" && schritt.agent.toLowerCase() !== "scribe") return null;
  return schritt.output;
}

/**
 * Hat COUNSEL genau den Freigabetext geprüft? Gleichheit nur durch direkten Vergleich mit dem
 * gespeicherten geprüften Text; der Hinweis aus der Pipeline kann nur eine Abweichung belegen.
 */
function fassungsBezug(
  body: string | null | undefined,
  geprueft: string | null,
  hinweis: { identisch?: boolean } | null | undefined
): FassungsBezug {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return "kein_text";
  if (geprueft !== null) return geprueft.trim() === text ? "identisch" : "abweichend";
  return istObjekt(hinweis) && hinweis.identisch === false ? "abweichend" : "nicht_pruefbar";
}

function freigabeLage(item: Pick<ContentItem, "body" | "review_notes" | "metadata">): FreigabeLage {
  const meta = alsObjekt(item.metadata) ?? {};
  const counsel = werteCounselAus(item.review_notes);
  const geprueftText = geprueftenText(meta);
  return {
    counsel,
    pruefung: pruefeFreigabe(counsel, item.body),
    bezug: fassungsBezug(item.body, geprueftText, alsObjekt(meta.freigabe_hinweis)),
    geprueftText,
    nameImText: enthaeltGeschuetztenNamen(item.body),
  };
}

// Nachprüfung 06.11.2026: Die Namensprüfung faltet den Text Zeichen für Zeichen; die Liste rief
// freigabeLage bei jedem Render für jede Zeile auf, auch bei jedem Tastendruck in einem Feld der
// Seite (laut Gesamtprüfung rund 23 ms je Render bei 50 Zeilen à 8.000 Zeichen, im Browser nicht
// gemessen). Die Lage hängt nur am Eintrag, und Einträge werden nie verändert, sondern ersetzt
// (setContent mit neuen Objekten) — ein Merker je Objekt reicht.
const LAGE_JE_EINTRAG = new WeakMap<object, FreigabeLage>();

function freigabeLageGemerkt(item: Pick<ContentItem, "body" | "review_notes" | "metadata">): FreigabeLage {
  const gemerkt = LAGE_JE_EINTRAG.get(item);
  if (gemerkt) return gemerkt;
  const lage = freigabeLage(item);
  LAGE_JE_EINTRAG.set(item, lage);
  return lage;
}

/** Status, in denen der Freigabetext kopiert werden darf (veröffentlicht wird von Hand per Kopieren). */
const STATUS_KOPIERBAR = ["freigegeben", "gepostet"];

/**
 * Darf der Freigabetext (body) kopiert werden? null = ja. Nur bei Status freigegeben oder
 * gepostet, nur wenn pruefeFreigabe den Text durchlässt und kein geschützter Name darin steht
 * (Gesamtprüfung 06.11.2026, fail-closed). Sonst der Grund für den gesperrten Knopf.
 */
function kopierSperre(status: string, lage: FreigabeLage): string | null {
  if (!STATUS_KOPIERBAR.includes(status)) return "Kopieren erst nach Freigabe";
  if (lage.nameImText) return "Kopieren gesperrt: Der Text enthält einen geschützten Namen";
  if (!lage.pruefung.freigebbar) return `Kopieren gesperrt: ${maskiert(lage.pruefung.grund ?? "Prüfregel nicht erfüllt")}`;
  return null;
}

/**
 * Ist der Lauf zur Freigabe gelangt? Nur mit status complete/partial hat der Server die
 * PUBLISHER-Ausgabe als Freigabetext (body) gespeichert (api/content/pipeline/route.ts, Ende
 * des Laufs); jeder Abbruch antwortet mit status "fehler" bzw. "abgelehnt" ohne body.
 */
function laufZurFreigabe(status: unknown): boolean {
  return status === "complete" || status === "partial";
}

/** Bezug im frischen Pipeline-Ergebnis: SCRIBE-Text gegen PUBLISHER-Text (= body) direkt vergleichen. */
function ergebnisBezug(r: PipelineResult): FassungsBezug {
  if (!laufZurFreigabe(r.status)) return "kein_text";
  const scribe = r.steps.find((s) => s.agent === "scribe")?.output;
  const publisher = r.steps.find((s) => s.agent === "publisher")?.output;
  return fassungsBezug(publisher, typeof scribe === "string" ? scribe : null, r.freigabe_hinweis);
}

/**
 * COUNSEL-Urteil bezogen auf den Freigabetext (R2): grünes FREIGABE nur, wenn COUNSEL genau
 * diesen Text geprüft hat. Welche Fassung freigegeben wird, entscheidet der Inhaber.
 */
function urteilAnzeige(urteil: CounselUrteil, bezug: FassungsBezug): { text: string; farbe: string; erklaerung: string | null } {
  if (urteil === "ABLEHNUNG") return { text: "ABLEHNUNG", farbe: FARBE_ROT, erklaerung: null };
  if (urteil !== "FREIGABE") return { text: urteil, farbe: FARBE_BERNSTEIN, erklaerung: null };
  switch (bezug) {
    case "identisch":
      return { text: "FREIGABE", farbe: FARBE_GRUEN, erklaerung: "COUNSEL hat genau den Freigabetext geprüft." };
    case "abweichend":
      return {
        text: "COUNSEL prüfte die Vorfassung · Freigabetext ungeprüft",
        farbe: FARBE_BERNSTEIN,
        erklaerung: "Das Urteil FREIGABE gilt der Vorfassung (SCRIBE), nicht dem Freigabetext.",
      };
    case "kein_text":
      return {
        text: "FREIGABE der geprüften Fassung · kein Freigabetext",
        farbe: FARBE_BERNSTEIN,
        erklaerung: "Es gibt keinen Freigabetext, für den das Urteil gelten könnte.",
      };
    default:
      return {
        text: "FREIGABE der geprüften Fassung · Bezug zum Freigabetext nicht prüfbar",
        farbe: FARBE_BERNSTEIN,
        erklaerung: "Der geprüfte Text ist nicht gespeichert; ob er dem Freigabetext entspricht, ist nicht prüfbar.",
      };
  }
}

/**
 * Ausgabe einer Stufe im Pipeline-Ergebnis (R24). Roh bleibt nur der Freigabetext: die
 * PUBLISHER-Ausgabe eines Laufs, der zur Freigabe gelangt ist (laufZurFreigabe, Stufe "done").
 * Jede andere Ausgabe wird maskiert — auch eine PUBLISHER-Ausgabe aus einem abgebrochenen Lauf:
 * Der Namensschutz-Abbruch der Pipeline behält sie nur als Beleg in metadata.steps, nicht als body.
 * warnung: Hinweis, wenn die PUBLISHER-Ausgabe den geschützten Namen enthält; sonst null.
 */
function stufenAusgabe(step: PipelineStep, laufStatus: unknown): { text: string; warnung: string | null } | null {
  if (typeof step.output !== "string" || !step.output) return null;
  const publisher = step.agent === "publisher";
  const freigabetext = publisher && step.status === "done" && laufZurFreigabe(laufStatus);
  const voll = freigabetext ? step.output : maskiert(step.output);
  let warnung: string | null = null;
  if (publisher && enthaeltGeschuetztenNamen(step.output)) {
    if (freigabetext) warnung = "Der Freigabetext enthält einen geschützten Namen — Freigabe gesperrt.";
    else if (laufStatus === "fehler")
      warnung = "PUBLISHER-Ausgabe enthielt einen geschützten Namen — Lauf abgebrochen, nicht zur Freigabe gestellt.";
    else warnung = "PUBLISHER-Ausgabe enthält einen geschützten Namen — nicht als Freigabetext bestätigt.";
  }
  return { text: voll.length > 2000 ? `${voll.slice(0, 2000)}...` : voll, warnung };
}

/** Hinweis am Freigeben-Knopf, wenn freigebbar, aber COUNSEL nicht genau diesen Text geprüft hat. */
function bezugHinweis(bezug: FassungsBezug): string | null {
  if (bezug === "abweichend") return "Freigabetext ungeprüft — COUNSEL prüfte die Vorfassung";
  if (bezug === "nicht_pruefbar") return "Bezug zur geprüften Fassung nicht prüfbar";
  return null;
}

/**
 * Zusatz zum Objektlisten-Fehler (Gegencheck 06.11.2026). "Ein Lauf ist nur ohne Objekt möglich"
 * stimmt nur, wenn der Dashboard-Server geantwortet hat und der Export das Problem ist. Bei 401
 * weist die Middleware auch den Lauf ab; bei unbekannter Ursache (etwa Netzfehler) ist offen, ob
 * ein Lauf möglich ist.
 */
function objekteHinweisZusatz(art: ObjekteFehlerArt): string {
  if (art === "konfiguration" || art === "nicht_erreichbar" || art === "quelle_fehler") {
    return " — ein Lauf ist nur ohne Objekt möglich.";
  }
  if (art === "nicht_angemeldet") return " — ohne gültige Sitzung startet auch kein Lauf; bitte neu anmelden.";
  return "";
}

/** Hinweis unter den Kacheln (R31): nur mit frischer Zahl, nie bei Lesefehler. */
function wartendHinweis(a: {
  wartendGesamt: number | null;
  lesefehler: string | null;
  listeFehler: string | null;
  listeLaedt: boolean;
  inListe: number;
  stand: string | null;
  /** Die Liste hat LISTE_LIMIT Zeilen geladen, ältere fehlen also. */
  listeVoll: boolean;
}): string | null {
  if (a.lesefehler || a.wartendGesamt === null || a.listeFehler || a.listeLaedt) return null;
  if (a.wartendGesamt <= a.inListe) return null;
  const stand = a.stand ? ` (Stand ${zeitText(a.stand)})` : "";
  if (a.listeVoll) {
    return `Die Liste zeigt nur die letzten ${LISTE_LIMIT} Einträge; insgesamt warten ${a.wartendGesamt} auf Freigabe${stand}.`;
  }
  // Gegencheck 06.11.2026: Erreicht die Liste die Grenze nicht, ist sie nicht die Ursache. Die
  // Ursache ist nicht gemessen (veraltete Liste oder Zeitversatz der beiden Abrufe).
  return `Liste und Server-Zählung weichen ab: in der Liste ${a.inListe} wartend, laut Server ${a.wartendGesamt}${stand} — Seite neu laden.`;
}

// ═══ BAUSTEINE ═══

function PipelineFluss({ lage, ergebnis }: { lage: FlussLage; ergebnis: PipelineResult | null }) {
  const hinweis =
    lage === "laeuft"
      ? { text: "Lauf aktiv — welche Stufe gerade arbeitet, meldet der Server erst am Ende.", farbe: FARBE_BERNSTEIN }
      : lage === "unbekannt"
        ? { text: "Ausgang unbekannt — der Stand der Stufen ist nicht bekannt, Content-Tab prüfen.", farbe: FARBE_BERNSTEIN }
        : lage === "ergebnis" && ergebnis
          ? (() => {
              const text = flussHinweis(ergebnis);
              return text ? { text, farbe: ergebnis.status === "complete" ? FARBE_BERNSTEIN : FARBE_ROT } : null;
            })()
          : null;
  return (
    <div className="card-ghost p-5">
      <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
        Agent-Pipeline Flow
      </h2>
      {/* Browser-Prüfung 06.11.2026: Bei 375 px war die Stufenleiste 466 px breit und die ganze
          Seite scrollte waagrecht (Scrollbreite 514 statt 369). Jetzt scrollt nur die Leiste in
          ihrer Karte; ab etwa 520 px Kartenbreite passt sie ohne Scrollen. */}
      <div className="overflow-x-auto" data-fluss-leiste>
      <div className="grid min-w-[480px] grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-1">
        {STUFEN.flatMap((agent, i) => {
          const step = lage === "ergebnis" ? ergebnis?.steps.find((s) => s.agent === agent) : undefined;
          const { text, farbe } = stufenEtikett(lage, step?.status);
          const items = [
            <div
              key={agent}
              className="rounded-lg p-2 text-center transition-all"
              style={{ background: `${farbe}10`, border: `1px solid ${farbe}30` }}
              data-stufe={agent}
            >
              <div className="text-[9px] font-mono mb-0.5" style={{ color: farbe }}>
                {text}
              </div>
              <div className="text-[10px] font-semibold text-foreground truncate">{agent.toUpperCase()}</div>
              {typeof step?.cost === "number" && (
                <div className="text-[8px] text-text-muted mt-0.5">
                  ${step.cost.toFixed(4)} gesch.
                </div>
              )}
            </div>,
          ];
          if (i < STUFEN.length - 1) items.push(<span key={`arrow-${i}`} className="text-text-muted text-sm">→</span>);
          return items;
        })}
      </div>
      </div>
      {hinweis && (
        <p className="mt-3 text-[11px]" style={{ color: hinweis.farbe }}>
          {hinweis.text}
        </p>
      )}
    </div>
  );
}

/** Freigeben-Knopf mit Sperre (R4): gesperrt, solange pruefeFreigabe sperrt; Grund sichtbar. */
function FreigebenKnopf({
  lage,
  pending,
  onFreigeben,
}: {
  lage: FreigabeLage;
  pending: boolean;
  onFreigeben: () => void;
}) {
  const gesperrt = !lage.pruefung.freigebbar;
  const grund = gesperrt ? maskiert(lage.pruefung.grund ?? "ohne Grund") : null;
  const hinweis = gesperrt ? null : bezugHinweis(lage.bezug);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onFreigeben}
        disabled={pending || gesperrt}
        title={grund ? `Freigeben gesperrt: ${grund}` : undefined}
        className="px-4 py-2 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-all disabled:opacity-40"
      >
        Freigeben
      </button>
      {grund && (
        <span className="text-[10px]" style={{ color: FARBE_ROT }}>
          Freigeben gesperrt: {grund}
        </span>
      )}
      {hinweis && (
        <span className="text-[10px]" style={{ color: FARBE_BERNSTEIN }}>
          {hinweis}
        </span>
      )}
    </div>
  );
}

/** Meldung nach einem Klick ohne Ergebnis (R10): nur echte 4xx heißen "abgewiesen". */
function LaufMeldungAnzeige({
  meldung,
  offeneLaufId,
  oeffne,
}: {
  meldung: LaufMeldung;
  offeneLaufId: string | null;
  oeffne: (contentId: number | null) => void;
}) {
  const offen = meldung.art === "unbekannt" || meldung.art === "existiert";
  // Gegencheck 06.11.2026: Auch ein abgebrochener Lauf hat einen Eintrag, den man öffnen kann.
  const mitEintrag = offen || meldung.art === "abgebrochen";
  const contentId = mitEintrag ? meldung.contentId : null;
  return (
    <div className="mt-3 space-y-1.5 text-[11px]" role="alert" data-lauf-ausgang={meldung.art}>
      <p style={{ color: offen ? FARBE_BERNSTEIN : FARBE_ROT }}>{meldung.text}</p>
      {meldung.art === "unbekannt" && offeneLaufId && (
        <p className="text-[10px] text-text-muted">
          Der nächste Klick sendet dieselbe Lauf-ID ({offeneLaufId.slice(0, 8)}…): Läuft der Lauf schon, meldet der
          Server „Lauf existiert bereits“, statt einen zweiten zu starten.
        </p>
      )}
      {mitEintrag && (
        <button
          onClick={() => oeffne(contentId)}
          className="text-[10px] px-2 py-1 rounded bg-surface-elevated text-text-muted hover:text-foreground transition-colors"
        >
          {contentId !== null ? `Eintrag #${contentId} im Content-Tab öffnen` : "Content-Tab öffnen"}
        </button>
      )}
    </div>
  );
}

// ═══ BELEG-KETTE ═══

function BelegZeile({ titel, vermerk, children }: { titel: string; vermerk?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-3 py-2 border-t" style={{ borderColor: "var(--gp-hairline)" }}>
      <div className="mono-label pt-0.5">{titel}</div>
      <div className="min-w-0 text-xs text-text-secondary space-y-1">
        {children}
        {vermerk && <p className="text-[10px] text-text-muted">{vermerk}</p>}
      </div>
    </div>
  );
}

function BelegKette({
  item,
  kopiere,
  kopierStatus,
}: {
  item: ContentItem;
  kopiere: (key: string, text: string) => void;
  kopierStatus: (key: string) => string;
}) {
  const meta = alsObjekt(item.metadata) ?? {};
  // Urteil aus dem gespeicherten COUNSEL-Text abgeleitet — dieselbe Auswertung wie in der
  // Pipeline (lib/counsel-urteil.ts), kein eigenes Feld. Grün nur, wenn COUNSEL genau den
  // Freigabetext geprüft hat (R2).
  const lage = freigabeLageGemerkt(item);
  const counsel = lage.counsel;
  const anzeige = urteilAnzeige(counsel.urteil, lage.bezug);
  const counselUnvollstaendig = alsObjekt(meta.fehler)?.stufe === "counsel";
  const regel = alsObjekt(meta.regelpaket);
  const snapshot = alsObjekt(meta.objekt_snapshot);
  const snapshotObjekt = alsObjekt(snapshot?.objekt);
  const exportKopf = alsObjekt(snapshot?.export);
  const researcherSchritt: unknown = Array.isArray(meta.steps) ? meta.steps[0] : undefined;
  const researcherText =
    istObjekt(researcherSchritt) && typeof researcherSchritt.output === "string" ? researcherSchritt.output : null;
  const ctaLink = typeof meta.cta_link === "string" && meta.cta_link ? meta.cta_link : null;
  // Gesamtprüfung 06.11.2026: Ein CTA-Link mit geschütztem Namen wird nie kopiert (fail-closed).
  const ctaMitNamen = ctaLink !== null && enthaeltGeschuetztenNamen(ctaLink);
  const ctaKey = `${item.id}-cta`;
  const freigabe = alsObjekt(meta.freigabe);
  const gepostet = alsObjekt(meta.gepostet);
  const mitText = STATUS_MIT_TEXT.includes(item.status);

  const kopfZeilen: [string, string][] = [
    ["Export-Version", exportKopf?.version ?? "nicht im Export-Kopf"],
    ["Export-Quelle", exportKopf?.quelle ?? "nicht im Export-Kopf"],
    ["Export erzeugt", exportKopf?.generiert_am ? zeitText(exportKopf.generiert_am) : "nicht im Export-Kopf"],
    ["Abgerufen", zeitText(snapshot?.abgerufen_am)],
  ];

  return (
    <div className="rounded-lg px-3 pt-3 pb-1" style={{ border: "1px solid var(--gp-hairline)", background: "rgba(11, 12, 16, 0.4)" }}>
      <h4 className="mono-label mb-1" style={{ color: "var(--gp-gold)" }}>
        Beleg-Kette
      </h4>

      <BelegZeile titel="COUNSEL-Urteil" vermerk="abgeleitet aus dem COUNSEL-Text">
        <p>
          <span
            className="font-semibold font-[family-name:var(--font-jbmono)]"
            style={{ color: anzeige.farbe }}
            data-urteil-anzeige={lage.bezug}
          >
            {anzeige.text}
          </span>
          <span className="text-text-muted"> · {counsel.grund}</span>
        </p>
        {anzeige.erklaerung && <p className="text-[10px] text-text-muted">{anzeige.erklaerung}</p>}
        {counsel.zeile && (
          <p className="font-[family-name:var(--font-jbmono)] text-[11px] break-words">{maskiert(counsel.zeile)}</p>
        )}
        {meta.counsel?.geprueft && (
          <p className="text-[10px] text-text-muted">
            geprüft: {maskiert(String(meta.counsel.geprueft))}
            {meta.counsel.am ? ` · ${zeitText(meta.counsel.am)}` : ""}
          </p>
        )}
        {counselUnvollstaendig && (
          <p className="text-[10px]" style={{ color: "var(--gp-amber)" }}>
            COUNSEL-Antwort unvollständig (siehe Fehler) — das Urteil ist nicht maßgeblich.
          </p>
        )}
      </BelegZeile>

      {mitText && (
        <BelegZeile
          titel="Prüfregel"
          vermerk={`Für Freigeben: COUNSEL-Urteil FREIGABE, Text ab ${MIN_FREIGABE_ZEICHEN} Zeichen, kein geschützter Name.`}
        >
          {lage.pruefung.freigebbar ? (
            <p style={{ color: FARBE_GRUEN }}>erfüllt</p>
          ) : (
            <p style={{ color: FARBE_ROT }}>nicht erfüllt: {maskiert(lage.pruefung.grund ?? "ohne Grund")}</p>
          )}
        </BelegZeile>
      )}

      <BelegZeile titel="Regelpaket">
        {regel ? (
          <p className="font-[family-name:var(--font-jbmono)]">
            {maskiertWert(regel.version ?? "Version nicht lesbar")} · Stand {maskiertWert(regel.stand ?? "nicht lesbar")}
          </p>
        ) : (
          <p>nicht gespeichert (Lauf vor Stufe 1)</p>
        )}
      </BelegZeile>

      <BelegZeile titel="Objekt-Snapshot">
        {snapshot ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {kopfZeilen.map(([label, wert]) => (
                  <tr key={label} className="align-top">
                    <th scope="row" className="text-left font-normal text-text-muted pr-3 py-0.5 whitespace-nowrap">
                      {label}
                    </th>
                    <td className="py-0.5 font-[family-name:var(--font-jbmono)] break-words">{maskiert(wert)}</td>
                  </tr>
                ))}
                {snapshotObjekt ? (
                  SNAPSHOT_ZEILEN.map(([feld, label]) => (
                    <tr key={feld} className="align-top border-t" style={{ borderColor: "var(--gp-hairline)" }}>
                      <th scope="row" className="text-left font-normal text-text-muted pr-3 py-0.5 whitespace-nowrap">
                        {label}
                      </th>
                      <td className="py-0.5 font-[family-name:var(--font-jbmono)] break-words">
                        {snapshotWert(feld, snapshotObjekt[feld]).map((zeile, i) => (
                          <div key={i}>{maskiert(zeile)}</div>
                        ))}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="py-0.5">Snapshot ohne Objektfelder</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{meta.objekt_slug ? "kein Snapshot gespeichert" : "kein Snapshot gespeichert (Lauf ohne Objekt)"}</p>
        )}
      </BelegZeile>

      <BelegZeile titel="RESEARCHER-Quellen" vermerk="Modellangabe, ungeprüft">
        <p>{typeof meta.researcher_quellen === "string" ? maskiert(meta.researcher_quellen) : "kein Vermerk gespeichert (Lauf vor Stufe 1)"}</p>
        {researcherText ? (
          <details>
            <summary className="cursor-pointer text-[10px] text-text-muted hover:text-foreground">
              RESEARCHER-Text anzeigen
            </summary>
            <pre className="mt-2 text-xs whitespace-pre-wrap bg-surface-elevated rounded-lg p-3 max-h-[260px] overflow-y-auto font-mono leading-relaxed">
              {maskiert(researcherText)}
            </pre>
          </details>
        ) : (
          <p className="text-[10px] text-text-muted">RESEARCHER-Text nicht gespeichert</p>
        )}
      </BelegZeile>

      <BelegZeile titel="CTA-Link" vermerk="Nur als Text: Prüf-Klicks würden die Steinadel-Zählung verfälschen.">
        {ctaLink ? (
          <>
            {ctaMitNamen && (
              <p role="alert" data-cta-sperre="name" style={{ color: FARBE_ROT }}>
                CTA-Link enthält einen geschützten Namen — nicht verwenden. Kopieren gesperrt.
              </p>
            )}
            <div className="flex items-start gap-2">
              <code
                className={`break-all font-[family-name:var(--font-jbmono)] text-[11px]${ctaMitNamen ? "" : " select-all"}`}
                style={{ color: "var(--gp-gold-hi)" }}
              >
                {maskiert(ctaLink)}
              </code>
              <button
                onClick={() => {
                  if (!ctaMitNamen) kopiere(ctaKey, ctaLink);
                }}
                disabled={ctaMitNamen}
                title={ctaMitNamen ? "CTA-Link enthält einen geschützten Namen — Kopieren gesperrt" : undefined}
                className="shrink-0 text-[10px] px-2 py-1 rounded bg-surface-elevated text-text-muted hover:text-foreground transition-colors disabled:opacity-40"
              >
                {kopierStatus(ctaKey)}
              </button>
            </div>
          </>
        ) : (
          <p>kein CTA-Link gespeichert</p>
        )}
        {meta.utm_content && (
          <p>
            <span className="text-text-muted">utm_content: </span>
            <span className="font-mono">{maskiertWert(meta.utm_content)}</span>
          </p>
        )}
      </BelegZeile>

      {/* Betreibertexte (Grund, URL) wie alle übrigen Texte maskiert — wie in ablehnungText (R24) */}
      <BelegZeile titel="Betreiber">
        {freigabe ? (
          <p>
            {freigabe.aktion === "ablehnen"
              ? "abgelehnt"
              : freigabe.aktion === "freigeben"
                ? "freigegeben"
                : maskiertWert(freigabe.aktion ?? "Aktion")}
            {" · "}
            {zeitText(freigabe.am)} · {maskiertWert(freigabe.durch ?? "unbekannt")}
            {freigabe.grund ? ` · Grund: ${maskiertWert(freigabe.grund)}` : ""}
          </p>
        ) : (
          <p>keine Entscheidung gespeichert</p>
        )}
        {gepostet && (
          <p>
            gepostet · {zeitText(gepostet.am)}
            {gepostet.published_url ? (
              <span className="font-[family-name:var(--font-jbmono)] break-all"> · {maskiertWert(gepostet.published_url)}</span>
            ) : null}
          </p>
        )}
      </BelegZeile>
    </div>
  );
}

// ═══ COMPONENT ═══

// useSearchParams braucht auf einer vorgerenderten Seite eine Suspense-Grenze, sonst bricht
// der Produktions-Build ab (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
// use-search-params.md, "Prerendering"). Bis die Parameter feststehen, steht der Platzhalter.
export default function ContentPage() {
  return (
    <Suspense fallback={<ContentLaedt />}>
      <ContentSeite />
    </Suspense>
  );
}

function ContentLaedt() {
  return (
    <div className="p-6 lg:p-10 max-w-[1100px]">
      <p className="text-xs text-text-muted">Content-Ansicht lädt …</p>
    </div>
  );
}

function ContentSeite() {
  const [content, setContent] = useState<ContentItem[]>([]);
  // Prüflauf 06.11.2026: Hat die Abfrage die Grenze erreicht (ältere Zeilen abgeschnitten)?
  // Realtime-Einfügungen ändern das nicht — vorher galt die Liste schon durch sie als voll.
  const [listeAbgeschnitten, setListeAbgeschnitten] = useState(false);
  const [contentFehler, setContentFehler] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Starttab aus ?tab=content|pipeline|calendar (R38); ein Klick gilt, bis sich ?tab= ändert.
  // null nur mit /pages-Verzeichnis (Doku "Good to know"); dann gilt der Standard-Tab.
  const urlTab = useSearchParams()?.get("tab") ?? null;
  const [tabWahl, setTabWahl] = useState<{ tab: Tab; urlTab: string | null } | null>(null);
  const activeTab = sichtbarerTab(tabWahl, urlTab);
  const setActiveTab = useCallback((tab: Tab) => setTabWahl({ tab, urlTab }), [urlTab]);
  const [calendar, setCalendar] = useState<Record<string, CalendarWeek> | null>(null);
  const [kalenderFehler, setKalenderFehler] = useState<string | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  // Ausgang ohne Ergebnis (abgewiesen, existiert, unbekannt, nicht gesendet) — R10.
  const [laufMeldung, setLaufMeldung] = useState<LaufMeldung | null>(null);
  // Lauf-ID nach unbekanntem Ausgang: Der nächste Klick sendet sie erneut (R10).
  const [offeneLaufId, setOffeneLaufId] = useState<string | null>(null);
  const laufAktiv = useRef(false);
  const [selectedWeek, setSelectedWeek] = useState("week1");

  // Custom pipeline form
  const [customTopic, setCustomTopic] = useState("");
  const [customPlatform, setCustomPlatform] = useState<string>("x");
  const [customFormat, setCustomFormat] = useState<string>("thread");
  const [customCategory, setCustomCategory] = useState<string>("ki_automation");
  const [objekte, setObjekte] = useState<ObjektOption[]>([]);
  const [selectedObjekt, setSelectedObjekt] = useState<string>("");

  // Freigabe-Ansicht (Content-Tab)
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [counselOpen, setCounselOpen] = useState<Record<number, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [publishedUrlDraft, setPublishedUrlDraft] = useState<Record<number, string>>({});
  const [metricsDraft, setMetricsDraft] = useState<Record<number, { impressions: string; likes: string }>>({});
  const [grundDraft, setGrundDraft] = useState<Record<number, string>>({});
  const [aktionFehler, setAktionFehler] = useState<Record<number, string>>({});
  const [actionPending, setActionPending] = useState<number | null>(null);
  // Nachprüfung 06.11.2026: Grund, warum die Objektliste fehlt; null = gelesen oder noch offen.
  // Text und Ursache (Gegencheck 06.11.2026: die Ursache entscheidet, was unter der Auswahl steht).
  const [objekteFehler, setObjekteFehler] = useState<{ text: string; art: ObjekteFehlerArt } | null>(null);

  // Stufe 1: Zähler "Zur Freigabe" über den Server, nicht über die geladenen 50 Zeilen.
  const {
    freigaben,
    fehler: freigabenFehler,
    loading: freigabenLaden,
    neuLaden: freigabenNeuLaden,
  } = useFreigaben();

  useEffect(() => {
    async function fetchContent() {
      const { data, error } = await supabase
        .from("content")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LISTE_LIMIT);
      // Stufe 1: Lesefehler anzeigen statt als leere Liste ("Keine Inhalte") auszugeben.
      if (error) {
        setContentFehler(error.message);
      } else {
        const zeilen = (data ?? []) as ContentItem[];
        setContent(zeilen);
        setListeAbgeschnitten(zeilen.length >= LISTE_LIMIT);
        setContentFehler(null);
      }
      setLoading(false);
    }

    async function fetchCalendar() {
      try {
        const res = await fetch("/api/content/pipeline");
        if (res.ok) {
          const data = await res.json();
          setCalendar(data.launch_calendar ?? null);
          if (!data.launch_calendar) setKalenderFehler("Antwort ohne launch_calendar");
        } else {
          setKalenderFehler(`HTTP ${res.status}`);
        }
      } catch (e) {
        setKalenderFehler(e instanceof Error ? e.message : "unbekannt");
      }
    }

    // Objekt-Liste optional — das Formular läuft auch ohne. Nachprüfung 06.11.2026: Fehlt sie,
    // steht der Grund unter der Auswahl; vorher zeigte die Auswahl still nur "ohne Objekt".
    async function fetchObjekte() {
      try {
        const res = await fetch("/api/objekte", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        const fehlerFeld = data && typeof data.fehler === "string" ? data.fehler : null;
        if (!res.ok || fehlerFeld || !data || !Array.isArray(data.objekte)) {
          if (!fehlerFeld && res.ok) {
            setObjekteFehler({ text: "Antwort ohne Objektliste", art: "unbekannt" });
            return;
          }
          // Codeform wie useObjekte: Fehlerfeld der Route, sonst "HTTP <Status>" (401 der Middleware).
          const roh = fehlerFeld ?? `HTTP ${res.status}`;
          const fehlerArt = data && typeof data.fehler_art === "string" ? data.fehler_art : null;
          setObjekteFehler({ text: objektFehlerText(roh), art: objekteFehlerArt(roh, fehlerArt) ?? "unbekannt" });
          return;
        }
        const liste: ObjektOption[] = data.objekte.map((o: { slug: string; name: string }) => ({
          slug: o.slug,
          name: o.name,
        }));
        setObjekte(liste);
        setObjekteFehler(null);
      } catch (e) {
        setObjekteFehler({ text: objektFehlerText(e instanceof Error ? e.message : "unbekannter Fehler"), art: "unbekannt" });
      }
    }

    fetchContent();
    fetchCalendar();
    fetchObjekte();

    const channel = supabase
      .channel("content-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "content" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setContent((prev) => [payload.new as ContentItem, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setContent((prev) =>
              prev.map((c) =>
                c.id === (payload.new as ContentItem).id ? (payload.new as ContentItem) : c
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Ein Lauf je Klick mit lauf_id (R10). Nach unbekanntem Ausgang sendet der nächste Klick
  // dieselbe ID: Läuft der Lauf schon, antwortet der Server 409 statt einen zweiten bezahlten
  // Lauf zu starten. Nach bekanntem Ausgang (Ergebnis, 4xx, 409) wird die ID verworfen.
  const runPipeline = useCallback(
    async (eingaben: LaufEingaben) => {
      if (laufAktiv.current) return;
      // Ohne Pipeline-Format (z. B. LinkedIn, R39 offen) startet kein Lauf.
      const ohneFormat = plattformOhneFormat(eingaben.platform);
      if (ohneFormat || !(FORMATE_JE_PLATTFORM[eingaben.platform] ?? []).includes(eingaben.format)) {
        setLaufMeldung({ art: "nicht_gesendet", text: ohneFormat ?? "Lauf nicht gestartet — Format passt nicht zur Plattform." });
        return;
      }
      // Wiederholung: dieselbe Lauf-ID nach unbekanntem Ausgang (ausgangBeiWiederholung).
      const wiederholung = offeneLaufId !== null;
      const laufId = offeneLaufId ?? neueLaufId();
      if (laufId === null) {
        setLaufMeldung({
          art: "nicht_gesendet",
          text: "Lauf nicht gestartet — der Browser liefert keine Zufallszahlen für die Lauf-ID.",
        });
        return;
      }
      laufAktiv.current = true;
      setOffeneLaufId(laufId);
      setPipelineRunning(true);
      setPipelineResult(null);
      setLaufMeldung(null);
      try {
        const ausgang = ausgangBeiWiederholung(await sendeLauf((input, init) => fetch(input, init), eingaben, laufId), wiederholung);
        if (ausgang.art === "ergebnis") setPipelineResult(ausgang.ergebnis);
        else setLaufMeldung(ausgang);
        setOffeneLaufId(laufIdNachAusgang(ausgang, laufId));
      } finally {
        laufAktiv.current = false;
        setPipelineRunning(false);
      }
    },
    [offeneLaufId]
  );

  // Eine Zeile neu lesen (nach 409 oder wenn die Antwort keine Zeile mitbringt). null nur, wenn
  // die Zeile gelesen und ersetzt wurde. Gegencheck 06.11.2026: Liefert das Lesen keine Zeile
  // (gelöscht oder nicht lesbar), bleibt die Anzeige alt — das steht jetzt da, statt
  // "Eintrag neu geladen".
  const ladeEintrag = useCallback(async (id: number): Promise<string | null> => {
    const { data, error } = await supabase.from("content").select("*").eq("id", id).maybeSingle();
    if (error) return `Neu laden fehlgeschlagen: ${error.message}`;
    if (!data) return "Neu laden lieferte keine Zeile";
    setContent((prev) => prev.map((c) => (c.id === id ? (data as ContentItem) : c)));
    return null;
  }, []);

  // Aktion an /api/content/status senden. Stufe 1 (05.11.2026): Antwort auswerten —
  // Fehler (400/409/500) stehen sichtbar an der Zeile; bei Erfolg kommt die geänderte
  // Zeile aus der Antwort (Realtime bleibt zusätzlich aktiv).
  const sendStatusAction = useCallback(
    async (id: number, aktion: string, extra?: Record<string, unknown>): Promise<boolean> => {
      setActionPending(id);
      setAktionFehler((prev) => ohne(prev, id));
      try {
        const res = await fetch("/api/content/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, aktion, ...extra }),
        });
        const daten: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          let meldung = fehlerMeldung(res.status, daten);
          if (res.status === 409) {
            const nachladeFehler = await ladeEintrag(id);
            meldung += nachladeFehler ? ` · ${nachladeFehler} — Anzeige veraltet` : " · Eintrag neu geladen";
          }
          setAktionFehler((prev) => ({ ...prev, [id]: meldung }));
          return false;
        }
        const eintrag = istObjekt(daten) ? daten.eintrag : null;
        if (istObjekt(eintrag) && eintrag.id === id) {
          setContent((prev) => prev.map((c) => (c.id === id ? (eintrag as unknown as ContentItem) : c)));
        } else {
          const nachladeFehler = await ladeEintrag(id);
          if (nachladeFehler) {
            setAktionFehler((prev) => ({ ...prev, [id]: `Aktion gespeichert, Anzeige veraltet: ${nachladeFehler}` }));
          }
        }
        if (aktion === "freigeben" || aktion === "ablehnen") void freigabenNeuLaden();
        return true;
      } catch (e) {
        setAktionFehler((prev) => ({
          ...prev,
          [id]: `Netzwerkfehler: ${e instanceof Error ? e.message : "unbekannt"} — Ergebnis unbekannt, Seite neu laden`,
        }));
        return false;
      } finally {
        setActionPending(null);
      }
    },
    [ladeEintrag, freigabenNeuLaden]
  );

  const kopiere = useCallback((key: string, text: string) => {
    const merke = (wert: string) => {
      setCopiedKey(wert);
      setTimeout(() => setCopiedKey((k) => (k === wert ? null : k)), 2000);
    };
    // navigator.clipboard fehlt ohne sicheren Kontext; dann sichtbar scheitern.
    if (!navigator.clipboard) {
      merke(`${key}:fehler`);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => merke(key),
      () => merke(`${key}:fehler`)
    );
  }, []);

  const kopierStatus = useCallback(
    (key: string) => (copiedKey === key ? "Kopiert ✓" : copiedKey === `${key}:fehler` ? "Kopieren fehlgeschlagen" : "Kopieren"),
    [copiedKey]
  );

  const statusCounts = content.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Zahlen aus der geladenen Liste: bei Lesefehler "nicht lesbar", nie 0 als Ersatz.
  const listenWert = (n: number): string | number => (contentFehler ? "nicht lesbar" : loading ? "lädt" : n);

  const freigabeLesefehler = freigabenFehler ?? freigaben?.fehler ?? null;
  // R31: Nach einem Lesefehler behält useFreigaben die alten Daten — die Zahl ist dann nicht
  // mehr gemessen und wird verworfen (wie im Panel "Wartet auf dich").
  const wartendGesamt =
    !freigabeLesefehler && typeof freigaben?.wartend_gesamt === "number" ? freigaben.wartend_gesamt : null;
  const hinweisWartend = wartendHinweis({
    wartendGesamt,
    lesefehler: freigabeLesefehler,
    listeFehler: contentFehler,
    listeLaedt: loading,
    inListe: statusCounts["zur_freigabe"] ?? 0,
    stand: freigaben?.erzeugt_am ?? null,
    listeVoll: listeAbgeschnitten,
  });
  const flussLage: FlussLage = pipelineRunning
    ? "laeuft"
    : pipelineResult
      ? "ergebnis"
      : laufMeldung?.art === "unbekannt"
        ? "unbekannt"
        : "kein_lauf";
  // R2 im Ergebnis: grün nur, wenn der Freigabetext (PUBLISHER) der geprüfte Text (SCRIBE) ist.
  const ergebnisCounsel = pipelineResult?.counsel?.urteil ? pipelineResult.counsel : null;
  const ergebnisUrteil =
    pipelineResult && ergebnisCounsel
      ? urteilAnzeige(alsUrteil(ergebnisCounsel.urteil), ergebnisBezug(pipelineResult))
      : null;
  const zurFreigabeWert: string | number = freigabeLesefehler
    ? "nicht lesbar"
    : wartendGesamt !== null
      ? wartendGesamt
      : freigabenLaden
        ? "lädt"
        : "nicht lesbar";
  const zurFreigabeUntertitel = freigabeLesefehler
    ? `Wartet auf dich · ${maskiert(freigabeLesefehler)}`
    : `Wartet auf dich · alle Einträge${freigaben?.erzeugt_am ? `, Stand ${zeitText(freigaben.erzeugt_am)}` : ""}`;

  // Content nach STATUS_ORDER gruppieren
  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: content.filter((c) => c.status === status),
  })).filter((g) => g.items.length > 0);

  const gewaehlteWoche = calendar?.[selectedWeek] ?? null;
  const tageMitEintrag = gewaehlteWoche ? WEEKDAYS.filter((day) => gewaehlteWoche[day]) : [];

  return (
    <div className="boot p-6 lg:p-10 max-w-[1100px]">
      {/* Header */}
      <div className="gp-masthead">
        <div className="gp-index-row"><span className="gp-index">05 / PRODUKTION</span><span className="gp-index-rule" /></div>
        <p className="gp-kicker">RESEARCHER → SCRIBE → COUNSEL → PUBLISHER → AMPLIFIER</p>
        <h1 className="gp-wordmark">Content <em>Pipeline</em></h1>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 p-1 bg-surface-elevated rounded-lg w-fit">
        {(["pipeline", "calendar", "content"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === tab
                ? "bg-accent-violet/20 text-accent-violet"
                : "text-text-muted hover:text-foreground"
            }`}
          >
            {tab === "pipeline" ? "Pipeline" : tab === "calendar" ? "4-Wochen-Kalender" : "Content"}
          </button>
        ))}
      </div>

      {/* ═══ TAB: PIPELINE ═══ */}
      {activeTab === "pipeline" && (
        <div className="space-y-6">
          {/* Pipeline-Fluss (R34): nach Laufende "nicht ausgeführt" statt WAIT, während des Laufs "läuft" */}
          <PipelineFluss lage={flussLage} ergebnis={pipelineResult} />

          {/* Run Pipeline Form */}
          <div className="card-ghost p-5">
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
              Content produzieren
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Objekt (Steinadel)
                </label>
                <select
                  value={selectedObjekt}
                  onChange={(e) => setSelectedObjekt(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent-violet"
                >
                  <option value="">ohne Objekt</option>
                  {objekte.map((o) => (
                    <option key={o.slug} value={o.slug}>{maskiertWert(o.name)}</option>
                  ))}
                </select>
                {objekteFehler && (
                  <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "var(--gp-rose)" }} role="status">
                    Objektliste nicht lesbar: {maskiertWert(objekteFehler.text)}
                    {objekteHinweisZusatz(objekteFehler.art)}
                  </p>
                )}
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Thema {selectedObjekt && <span className="normal-case opacity-60">(wird aus Objekt übernommen)</span>}
                </label>
                <input
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  disabled={!!selectedObjekt}
                  placeholder="z.B. Wie KI-Agenten zusammenarbeiten..."
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet disabled:opacity-40"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Kategorie
                </label>
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent-violet"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Plattform
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {(["youtube", "x", "linkedin", "tiktok", "instagram", "newsletter"] as const).map((p) => {
                    const labels: Record<string, string> = { youtube: "YT", x: "X", linkedin: "LI", tiktok: "TT", instagram: "IG", newsletter: "Mail" };
                    const defaultFormats: Record<string, string> = { youtube: "longform", x: "thread", tiktok: "tiktok_short", instagram: "carousel", newsletter: "newsletter_issue" };
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          setCustomPlatform(p);
                          // Ohne Pipeline-Format (linkedin): leer statt undefined; der Lauf startet dann nicht.
                          setCustomFormat(defaultFormats[p] ?? "");
                        }}
                        className={`px-1.5 py-2 rounded-lg text-[10px] font-medium transition-all ${
                          customPlatform === p
                            ? "text-foreground"
                            : "bg-surface-elevated text-text-muted hover:text-foreground"
                        }`}
                        style={customPlatform === p ? {
                          background: `${PLATFORM_COLORS[p]}20`,
                          border: `1px solid ${PLATFORM_COLORS[p]}40`,
                          color: PLATFORM_COLORS[p],
                        } : {}}
                      >
                        {PLATFORM_ICONS[p]} {labels[p]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Format
                </label>
                <select
                  value={customFormat}
                  onChange={(e) => setCustomFormat(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent-violet"
                >
                  {customPlatform === "youtube" && (
                    <>
                      <option value="longform">Longform (8-12 Min)</option>
                      <option value="short">Short (60 Sek)</option>
                      <option value="deep_dive">Deep Dive (15+ Min)</option>
                    </>
                  )}
                  {customPlatform === "x" && (
                    <option value="thread">Thread (6-7 Tweets, Steinadel-Ton)</option>
                  )}
                  {customPlatform === "tiktok" && (
                    <option value="tiktok_short">TikTok Short (30-60 Sek)</option>
                  )}
                  {customPlatform === "instagram" && (
                    <>
                      <option value="carousel">Carousel (5-10 Slides)</option>
                      <option value="reel">Reel (30-90 Sek)</option>
                      <option value="story">Story-Serie (3-5 Stories)</option>
                    </>
                  )}
                  {customPlatform === "newsletter" && (
                    <option value="newsletter_issue">Newsletter-Ausgabe</option>
                  )}
                  {plattformOhneFormat(customPlatform) !== null && <option value="">kein Format hinterlegt</option>}
                </select>
              </div>
            </div>
            {plattformOhneFormat(customPlatform) !== null && (
              <p className="mb-3 text-[11px]" role="note" data-plattform-ohne-format={customPlatform} style={{ color: FARBE_BERNSTEIN }}>
                {plattformOhneFormat(customPlatform)}
              </p>
            )}
            <button
              onClick={() => {
                if (customTopic.trim() || selectedObjekt) {
                  void runPipeline({
                    topic: customTopic,
                    platform: customPlatform,
                    format: customFormat,
                    category: customCategory,
                    objektSlug: selectedObjekt,
                  });
                }
              }}
              disabled={pipelineRunning || (!customTopic.trim() && !selectedObjekt) || plattformOhneFormat(customPlatform) !== null}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                pipelineRunning
                  ? "bg-accent-violet/10 text-accent-violet cursor-wait"
                  : "bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {pipelineRunning ? "Pipeline läuft … (bis zu 5 Agenten)" : "Content produzieren"}
            </button>
            {laufMeldung && (
              <LaufMeldungAnzeige
                meldung={laufMeldung}
                offeneLaufId={offeneLaufId}
                oeffne={(id) => {
                  setActiveTab("content");
                  if (id !== null) setExpandedId(id);
                }}
              />
            )}
          </div>

          {/* Pipeline Result */}
          {pipelineResult && (
            <div className="card-ghost p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] text-text-muted uppercase tracking-widest">
                  Pipeline-Ergebnis
                </h2>
                <div className="flex items-center gap-3 text-[10px] text-text-muted">
                  <span>Kosten (geschätzt): {laufKostenText(pipelineResult)}</span>
                  {pipelineResult.summary?.total_duration_ms !== undefined && (
                    <span>Dauer: {(pipelineResult.summary.total_duration_ms / 1000).toFixed(1)}s</span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded font-mono ${
                      pipelineResult.status === "complete" ? "bg-green-500/10 text-green-400" :
                      pipelineResult.status === "abgelehnt" || pipelineResult.status === "fehler" ? "bg-red-500/10 text-red-400" :
                      "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {maskiert(pipelineResult.status)}
                    {pipelineResult.summary?.completed ? ` · ${maskiertWert(pipelineResult.summary.completed)}` : ""}
                  </span>
                </div>
              </div>

              {/* Stufe 1: Ergebnis-Vermerke der Pipeline */}
              <div className="space-y-1.5 mb-4 text-[11px]">
                {ergebnisCounsel && ergebnisUrteil && (
                  <p className="text-text-secondary">
                    COUNSEL-Urteil:{" "}
                    <span className="font-mono" style={{ color: ergebnisUrteil.farbe }}>
                      {ergebnisUrteil.text}
                    </span>
                    {ergebnisCounsel.grund ? ` · ${maskiert(ergebnisCounsel.grund)}` : ""}
                    {ergebnisCounsel.zeile ? ` · ${maskiert(ergebnisCounsel.zeile)}` : ""}
                  </p>
                )}
                {pipelineResult.fehler && (
                  <p style={{ color: "var(--gp-rose)" }}>Fehler: {vermerkText(pipelineResult.fehler) ?? "ohne Grund"}</p>
                )}
                {pipelineResult.freigabe_hinweis?.identisch === false && (
                  <p style={{ color: "var(--gp-amber)" }}>
                    Der Text zur Freigabe (PUBLISHER) ist nicht der von COUNSEL geprüfte Text (SCRIBE).
                  </p>
                )}
                {(pipelineResult.speicherfehler ?? []).length > 0 && (
                  <p style={{ color: "var(--gp-rose)" }}>
                    Speichern fehlgeschlagen: {maskiert((pipelineResult.speicherfehler ?? []).join(" · "))}
                  </p>
                )}
                {(pipelineResult.warnungen ?? []).map((w, i) => (
                  <p key={i} style={{ color: "var(--gp-amber)" }}>
                    Warnung: {vermerkText(w) ?? "ohne Grund"}
                  </p>
                ))}
              </div>

              <div className="space-y-3">
                {pipelineResult.steps.map((step) => (
                  <div key={step.agent} className="bg-surface-elevated rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[9px] px-2 py-0.5 rounded font-mono uppercase ${
                        step.status === "done" ? "bg-green-500/10 text-green-400" :
                        step.status === "error" ? "bg-red-500/10 text-red-400" :
                        "bg-gray-500/10 text-gray-400"
                      }`}>
                        {maskiert(step.agent)}
                      </span>
                      {step.duration_ms !== undefined && step.status !== "pending" && (
                        <span className="text-[9px] text-text-muted">{(step.duration_ms / 1000).toFixed(1)}s</span>
                      )}
                      {step.status !== "pending" && (
                        <span className="text-[9px] text-text-muted">
                          {typeof step.cost === "number" ? `$${step.cost.toFixed(4)} gesch.` : "Kosten nicht gemeldet"}
                        </span>
                      )}
                      {step.abgeschnitten === true && (
                        <span className="text-[9px]" style={{ color: "var(--gp-amber)" }}>abgeschnitten</span>
                      )}
                    </div>
                    {typeof step.fehler === "string" && step.fehler && (
                      <p className="text-[11px] mb-2" style={{ color: "var(--gp-rose)" }}>{maskiert(step.fehler)}</p>
                    )}
                    {(() => {
                      const ausgabe = stufenAusgabe(step, pipelineResult.status);
                      if (!ausgabe) return null;
                      return (
                        <>
                          {ausgabe.warnung && (
                            <p className="text-[11px] mb-2" role="alert" style={{ color: "var(--gp-rose)" }}>
                              {ausgabe.warnung}
                            </p>
                          )}
                          <pre className="text-xs text-text-secondary whitespace-pre-wrap max-h-[200px] overflow-y-auto font-mono leading-relaxed">
                            {ausgabe.text}
                          </pre>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Stufe 1 (05.11.2026): Die Kostenkacheln (~$0.03 bis ~$4.60/Woche) sind entfernt —
              feste Annahmen ohne Messung. Die geschätzten Kosten eines Laufs stehen im Ergebnis. */}
        </div>
      )}

      {/* ═══ TAB: 4-WOCHEN-KALENDER ═══ */}
      {activeTab === "calendar" && !calendar && (
        <div className="card-ghost p-5 text-sm">
          {kalenderFehler ? (
            <span style={{ color: "var(--gp-rose)" }}>Kalender nicht lesbar: {maskiert(kalenderFehler)}</span>
          ) : (
            <span className="text-text-muted">Kalender lädt …</span>
          )}
        </div>
      )}
      {activeTab === "calendar" && calendar && (
        <div className="space-y-6">
          {/* Week Selector */}
          <div className="grid grid-cols-4 gap-2">
            {(["week1", "week2", "week3", "week4"] as const).map((week, i) => {
              const weekData = calendar[week];
              return (
                <button
                  key={week}
                  onClick={() => setSelectedWeek(week)}
                  className={`p-2.5 rounded-lg text-left transition-all ${
                    selectedWeek === week
                      ? "bg-accent-violet/10 border border-accent-violet/30"
                      : "card-ghost hover:border-border"
                  }`}
                >
                  <div className="text-[9px] text-text-muted uppercase tracking-widest">
                    W{i + 1}
                  </div>
                  <div className={`text-xs font-semibold mt-0.5 leading-tight ${selectedWeek === week ? "text-accent-violet" : "text-foreground"}`}>
                    {weekData ? weekData.theme ?? "ohne Einträge" : "nicht im Kalender"}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Calendar Grid */}
          {gewaehlteWoche && (
            <div className="card-ghost p-5">
              <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
                {gewaehlteWoche.theme ?? "Ohne Thema"} — Redaktionsplan
              </h2>
              {tageMitEintrag.length === 0 ? (
                <p className="text-xs text-text-muted">
                  Keine Einträge in dieser Woche. An diesen Tagen produziert der Auto-Lauf nichts.
                </p>
              ) : (
                <div className="space-y-2">
                  {tageMitEintrag.map((day) => {
                    const entry = gewaehlteWoche[day];
                    if (!entry) return null;
                    const platformColor = PLATFORM_COLORS[entry.platform] ?? "#6b6b7b";
                    return (
                      <div
                        key={day}
                        className="bg-surface-elevated rounded-lg p-3 hover:bg-surface-elevated/80 transition-all cursor-pointer group"
                        onClick={() => {
                          setCustomTopic(entry.topic);
                          setCustomPlatform(entry.platform);
                          setCustomFormat(entry.format);
                          setActiveTab("pipeline");
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-bold text-text-muted w-6">{WEEKDAY_LABELS[day]}</span>
                          <div
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase"
                            style={{ background: `${platformColor}15`, color: platformColor }}
                          >
                            {PLATFORM_ICONS[entry.platform]} {entry.platform}
                          </div>
                          <div className="text-[9px] px-1.5 py-0.5 rounded bg-surface text-text-muted">
                            {entry.format}
                          </div>
                          <span className="text-text-muted text-[10px] opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                            Produzieren →
                          </span>
                        </div>
                        <div className="text-sm text-foreground group-hover:text-accent-violet transition-colors pl-8">
                          {entry.topic}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Weekly Stats — Stufe 1: Planwerte, als Ziel beschriftet */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard label="Pieces/Woche" value={"~23"} subtitle="Ziel, nicht gemessen" color="#8b5cf6" icon="▣" />
            <KPICard label="YouTube" value={2} subtitle="Anchor Content · Ziel, nicht gemessen" color="#ff0000" />
            <KPICard label="X/Twitter" value={4} subtitle="Threads · Ziel, nicht gemessen" color="#1da1f2" />
            <KPICard label="TikTok" value={10} subtitle="Shorts · Ziel, nicht gemessen" color="#00f2ea" />
            <KPICard label="Instagram" value={6} subtitle="Carousels + Reels · Ziel, nicht gemessen" color="#e1306c" />
            <KPICard label="Newsletter" value={1} subtitle="Wöchentlich · Ziel, nicht gemessen" color="#8b5cf6" />
          </div>

          {/* Monthly Overview */}
          <div className="card-ghost p-5">
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">
              4-Wochen-Ziele — 1→6 Repurposing-Strategie · Ziel, nicht gemessen
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="text-accent-violet font-semibold text-xs mb-2">Wöchentlicher Output (Ziel, nicht gemessen)</h3>
                <ul className="space-y-1 text-text-secondary text-xs">
                  <li>2 YouTube Videos (Anchor) → Repurposing auf alle Plattformen</li>
                  <li>4 X/Twitter Threads (2 original + 2 repurposed)</li>
                  <li>~10 TikTok Shorts (Clips + Original)</li>
                  <li>4 Instagram Carousels + 2 Reels</li>
                  <li>1 Newsletter-Ausgabe</li>
                  <li className="text-accent-violet font-medium">= ~23 Pieces/Woche, ~92/Monat</li>
                </ul>
              </div>
              <div>
                <h3 className="text-accent-cyan font-semibold text-xs mb-2">KPI-Ziele (Woche 4) — Ziel, nicht gemessen</h3>
                <ul className="space-y-1 text-text-secondary text-xs">
                  <li>YouTube: 500+ Subscriber, 5.000+ Views</li>
                  <li>X/Twitter: 1.000+ Follower, 50k+ Impressions</li>
                  <li>TikTok: 2.000+ Follower, 100k+ Views</li>
                  <li>Instagram: 800+ Follower, 30k+ Reach</li>
                  <li>Newsletter: 200+ Subscriber</li>
                  <li>Kosten: &lt;$20 API-Kosten total</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: CONTENT — FREIGABE-ANSICHT ═══ */}
      {activeTab === "content" && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard label="Zur Freigabe" value={zurFreigabeWert} subtitle={zurFreigabeUntertitel} color="var(--gp-amber)" />
            <KPICard label="Freigegeben" value={listenWert(statusCounts["freigegeben"] ?? 0)} subtitle={`Bereit zum Posten · in den letzten ${LISTE_LIMIT}`} color="#22c55e" />
            {/* R35: gezählt wird die Markierung durch den Betreiber, nicht ein gemessener Live-Zustand */}
            <KPICard label="Gepostet" value={listenWert(statusCounts["gepostet"] ?? 0)} subtitle={`als gepostet markiert · in den letzten ${LISTE_LIMIT}`} color="#8b5cf6" />
            <KPICard label="Abgelehnt/Fehler" value={listenWert((statusCounts["abgelehnt"] ?? 0) + (statusCounts["fehler"] ?? 0))} subtitle={`COUNSEL/Betreiber/Technik · in den letzten ${LISTE_LIMIT}`} color="#ff4d6a" />
          </div>

          {hinweisWartend && (
            <p className="text-[11px]" style={{ color: "var(--gp-amber)" }}>
              {hinweisWartend}
            </p>
          )}

          {contentFehler ? (
            <div className="card-ghost p-6 text-sm" role="alert" style={{ color: "var(--gp-rose)" }}>
              Content nicht lesbar: {maskiert(contentFehler)}
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="card-ghost p-4 h-20 animate-pulse" />
              ))}
            </div>
          ) : content.length === 0 ? (
            <div className="card-ghost p-12 text-center">
              <div className="text-4xl mb-3 opacity-20">▣</div>
              {/* R35: nur was gemessen ist — die Abfrage lieferte nichts; keine Ursache behaupten */}
              <p className="text-text-secondary text-sm">
                Die Abfrage lieferte keine Content-Einträge.
              </p>
              <p className="text-text-muted text-xs mt-2">
                Content wird im Pipeline-Tab produziert.
              </p>
              <button
                onClick={() => setActiveTab("pipeline")}
                className="mt-4 px-4 py-2 rounded-lg bg-accent-violet/20 text-accent-violet text-xs font-medium hover:bg-accent-violet/30 transition-all"
              >
                Zum Pipeline-Tab
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map((group) => {
                const meta = STATUS_META[group.status] ?? { label: group.status, color: "#6b6b7b" };
                return (
                  <div key={group.status} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider"
                        style={{ background: `${meta.color}20`, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-text-muted">{group.items.length} Eintrag/Einträge</span>
                    </div>

                    {group.items.map((item) => {
                      const open = expandedId === item.id;
                      const tweets = item.body ? splitTweets(item.body) : [];
                      const meta_ = item.metadata ?? {};
                      const pubDraft = publishedUrlDraft[item.id] ?? "";
                      const pubGueltig = istHttpUrl(pubDraft);
                      const metricsD = metricsDraft[item.id] ?? { impressions: "", likes: "" };
                      const grundD = grundDraft[item.id] ?? "";
                      const pending = actionPending === item.id;
                      // Stufe 1: geprüfter Text (SCRIBE, steps[1]) gegen den Text zur Freigabe (body);
                      // Fixrunde: dieselbe Prüfregel wie der Server (R4), Bezug des Urteils (R2), Name (R24).
                      const lage = freigabeLageGemerkt(item);
                      const erwarteText = STATUS_MIT_TEXT.includes(item.status);
                      const bodyLeer = !item.body || !item.body.trim();
                      const geprueftText = lage.geprueftText;
                      const fassungVerschieden = geprueftText !== null && geprueftText.trim() !== (item.body ?? "").trim();
                      const nurVermerkVerschieden = geprueftText === null && !bodyLeer && lage.bezug === "abweichend";
                      const fehlerText = vermerkText(meta_.fehler);
                      // Gesamtprüfung 06.11.2026: Kopieren nur nach Freigabe und ohne Sperrgrund.
                      const sperreKopieren = kopierSperre(item.status, lage);
                      const warnungen = Array.isArray(meta_.warnungen) ? meta_.warnungen : [];
                      const verlaufAnzahl = Array.isArray(meta_.metriken_verlauf) ? meta_.metriken_verlauf.length : 0;

                      return (
                        <div key={item.id} className="card-ghost p-4 hover:border-border transition-all">
                          <div
                            className="flex items-center gap-3 mb-1 cursor-pointer"
                            onClick={() => setExpandedId(open ? null : item.id)}
                          >
                            <span
                              className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider"
                              style={{ background: `${meta.color}20`, color: meta.color }}
                            >
                              {meta.label}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
                              {TYPE_LABELS[item.content_type] ?? maskiertWert(item.content_type)}
                            </span>
                            {item.platform && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
                                {PLATFORM_ICONS[item.platform] ?? ""} {maskiertWert(item.platform)}
                              </span>
                            )}
                            {erwarteText && bodyLeer && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase" style={{ background: "rgba(255, 77, 106, 0.15)", color: "var(--gp-rose)" }}>
                                Text leer
                              </span>
                            )}
                            {lage.nameImText && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase" style={{ background: "rgba(255, 77, 106, 0.15)", color: "var(--gp-rose)" }}>
                                Geschützter Name im Text
                              </span>
                            )}
                            <span className="text-[10px] text-text-muted ml-auto font-mono">
                              {new Date(item.created_at).toLocaleDateString("de-DE")}
                            </span>
                            <span className="text-text-muted text-xs">{open ? "▾" : "▸"}</span>
                          </div>
                          <h3 className="text-sm font-semibold text-foreground">
                            {typeof item.title === "string" ? maskiert(item.title) : "ohne Titel"}
                          </h3>

                          {open && (
                            <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                              {/* Stufe 1: leerer Text zur Freigabe */}
                              {erwarteText && bodyLeer && (
                                <div
                                  className="rounded-lg p-3 text-xs font-semibold"
                                  role="alert"
                                  style={{ border: "1px solid rgba(255, 77, 106, 0.45)", background: "rgba(255, 77, 106, 0.08)", color: "var(--gp-rose)" }}
                                >
                                  Text leer — es gibt keinen Text zur Freigabe.
                                </div>
                              )}

                              {/* R24: Der Freigabetext bleibt roh (er ist, was gepostet würde); Freigeben sperrt pruefeFreigabe */}
                              {lage.nameImText && (
                                <div
                                  className="rounded-lg p-3 text-xs font-semibold"
                                  role="alert"
                                  style={{ border: "1px solid rgba(255, 77, 106, 0.45)", background: "rgba(255, 77, 106, 0.08)", color: "var(--gp-rose)" }}
                                >
                                  Der Freigabetext enthält einen geschützten Namen — Freigabe gesperrt. Der Text darf so nicht
                                  veröffentlicht werden.
                                </div>
                              )}

                              {/* Stufe 1: geprüfte Fassung ≠ Fassung zur Freigabe */}
                              {erwarteText && fassungVerschieden && (
                                <div
                                  className="rounded-lg p-3 space-y-2"
                                  style={{ border: "1px solid rgba(245, 158, 11, 0.35)", background: "rgba(245, 158, 11, 0.06)" }}
                                >
                                  <p className="text-xs" style={{ color: "var(--gp-amber)" }}>
                                    Der Text zur Freigabe ist nicht der Text, den COUNSEL geprüft hat.
                                  </p>
                                  <details>
                                    <summary className="cursor-pointer text-[11px] text-text-secondary hover:text-foreground">
                                      Von COUNSEL geprüft (SCRIBE)
                                    </summary>
                                    <pre className="mt-2 text-xs text-text-secondary whitespace-pre-wrap bg-surface-elevated rounded-lg p-3 max-h-[300px] overflow-y-auto font-mono leading-relaxed">
                                      {maskiert(geprueftText)}
                                    </pre>
                                  </details>
                                  <details>
                                    <summary className="cursor-pointer text-[11px] text-text-secondary hover:text-foreground">
                                      Zur Freigabe (PUBLISHER)
                                    </summary>
                                    <pre className="mt-2 text-xs text-text-secondary whitespace-pre-wrap bg-surface-elevated rounded-lg p-3 max-h-[300px] overflow-y-auto font-mono leading-relaxed">
                                      {bodyLeer ? "Text leer" : item.body}
                                    </pre>
                                  </details>
                                </div>
                              )}
                              {erwarteText && nurVermerkVerschieden && (
                                <p className="text-xs" style={{ color: "var(--gp-amber)" }}>
                                  Laut Vermerk der Pipeline ist der Text zur Freigabe nicht der Text, den COUNSEL geprüft hat.
                                </p>
                              )}
                              {erwarteText && !bodyLeer && geprueftText === null && (
                                <p className="text-[10px] text-text-muted">
                                  Vergleich mit dem geprüften Text nicht möglich: SCRIBE-Text nicht gespeichert.
                                </p>
                              )}

                              {/* X-Thread-Vorschau */}
                              {item.body && (
                                <div>
                                  <h4 className="text-[10px] text-text-muted uppercase tracking-widest mb-2">
                                    X-Thread-Vorschau
                                  </h4>
                                  {sperreKopieren && (
                                    <p className="text-[10px] mb-2" data-kopier-sperre={item.id} style={{ color: FARBE_BERNSTEIN }}>
                                      {sperreKopieren}
                                    </p>
                                  )}
                                  <div className="space-y-2">
                                    {tweets.map((tweet, idx) => {
                                      const key = `${item.id}-${idx}`;
                                      const len = tweet.length;
                                      return (
                                        <div key={key} className="card-ghost p-3">
                                          <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
                                            {tweet}
                                          </p>
                                          <div className="flex items-center justify-between mt-2">
                                            <button
                                              onClick={() => {
                                                if (sperreKopieren === null) kopiere(key, tweet);
                                              }}
                                              disabled={sperreKopieren !== null}
                                              title={sperreKopieren ?? undefined}
                                              className="text-[10px] px-2 py-1 rounded bg-surface-elevated text-text-muted hover:text-foreground transition-colors disabled:opacity-40"
                                            >
                                              {kopierStatus(key)}
                                            </button>
                                            <span className="text-[10px] font-mono" style={{ color: charCountColor(len) }}>
                                              {len}/{TWEET_MAX}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* COUNSEL-Review */}
                              {item.review_notes && (
                                <div>
                                  <button
                                    onClick={() => setCounselOpen((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                                    className="text-[10px] text-text-muted uppercase tracking-widest hover:text-foreground transition-colors"
                                  >
                                    {counselOpen[item.id] ? "▾" : "▸"} COUNSEL-Review
                                  </button>
                                  {counselOpen[item.id] && (
                                    <>
                                      {enthaeltGeschuetztenNamen(item.review_notes) && (
                                        <p className="mt-2 text-[10px] text-text-muted">
                                          Geschützter Name im COUNSEL-Text ersetzt.
                                        </p>
                                      )}
                                      <pre className="mt-2 text-xs text-text-secondary whitespace-pre-wrap bg-surface-elevated rounded-lg p-3 max-h-[300px] overflow-y-auto font-mono leading-relaxed">
                                        {maskiert(item.review_notes)}
                                      </pre>
                                    </>
                                  )}
                                </div>
                              )}

                              {/* Stufe 1: Beleg-Kette (ersetzt den klickbaren CTA-Link) */}
                              <BelegKette item={item} kopiere={kopiere} kopierStatus={kopierStatus} />

                              {/* Technischer Fehler */}
                              {item.status === "fehler" && fehlerText && (
                                <p className="text-[11px]" style={{ color: "var(--gp-rose)" }}>
                                  Fehler: {fehlerText}
                                </p>
                              )}

                              {/* Stufe 1: Wer abgelehnt hat (COUNSEL oder Betreiber) */}
                              {item.status === "abgelehnt" && (
                                <p className="text-[11px]" style={{ color: "var(--gp-rose)" }}>
                                  {ablehnungText(meta_)}
                                </p>
                              )}

                              {warnungen.length > 0 && (
                                <ul className="text-[11px] space-y-0.5" style={{ color: "var(--gp-amber)" }}>
                                  {warnungen.map((w, i) => (
                                    <li key={i}>Warnung: {vermerkText(w) ?? "ohne Grund"}</li>
                                  ))}
                                </ul>
                              )}

                              {/* Aktionen nach Status */}
                              {item.status === "zur_freigabe" && (
                                <div className="space-y-2">
                                  <FreigebenKnopf
                                    lage={lage}
                                    pending={pending}
                                    onFreigeben={() => void sendStatusAction(item.id, "freigeben")}
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      type="text"
                                      value={grundD}
                                      maxLength={GRUND_MAX}
                                      onChange={(e) => setGrundDraft((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                      placeholder="Grund der Ablehnung (optional)"
                                      aria-label="Grund der Ablehnung (optional)"
                                      className="flex-1 min-w-[220px] bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet"
                                    />
                                    <span className="text-[10px] font-mono text-text-muted">
                                      {grundD.length}/{GRUND_MAX}
                                    </span>
                                    <button
                                      onClick={async () => {
                                        const grund = grundD.trim();
                                        const ok = await sendStatusAction(item.id, "ablehnen", grund ? { grund } : undefined);
                                        if (ok) setGrundDraft((prev) => ohne(prev, item.id));
                                      }}
                                      disabled={pending}
                                      className="px-4 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all disabled:opacity-40"
                                    >
                                      Ablehnen
                                    </button>
                                  </div>
                                </div>
                              )}

                              {item.status === "freigegeben" && (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="url"
                                      required
                                      value={pubDraft}
                                      onChange={(e) => setPublishedUrlDraft((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                      placeholder="https://… Link zum veröffentlichten Beitrag (Pflicht)"
                                      aria-label="Link zum veröffentlichten Beitrag (Pflicht)"
                                      className="flex-1 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet"
                                    />
                                    <button
                                      onClick={async () => {
                                        const ok = await sendStatusAction(item.id, "gepostet", { published_url: pubDraft.trim() });
                                        if (ok) setPublishedUrlDraft((prev) => ohne(prev, item.id));
                                      }}
                                      disabled={pending || !pubGueltig}
                                      className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30 transition-all disabled:opacity-40 whitespace-nowrap"
                                    >
                                      Als gepostet markieren
                                    </button>
                                  </div>
                                  {pubDraft.trim() !== "" && !pubGueltig && (
                                    <p className="text-[10px]" style={{ color: "var(--gp-rose)" }}>
                                      Keine gültige http(s)-URL
                                    </p>
                                  )}
                                </div>
                              )}

                              {item.status === "gepostet" && (
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={metricsD.impressions}
                                      onChange={(e) => setMetricsDraft((prev) => ({ ...prev, [item.id]: { ...metricsD, impressions: e.target.value } }))}
                                      placeholder="Impressions"
                                      className="w-28 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet"
                                    />
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={metricsD.likes}
                                      onChange={(e) => setMetricsDraft((prev) => ({ ...prev, [item.id]: { ...metricsD, likes: e.target.value } }))}
                                      placeholder="Likes"
                                      className="w-28 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet"
                                    />
                                    <button
                                      onClick={async () => {
                                        // Stufe 1: nur ausgefüllte Felder senden — leer heißt nicht erfasst, nicht 0.
                                        const nutzlast = metrikenNutzlast(metricsD);
                                        if (typeof nutzlast === "string") {
                                          setAktionFehler((prev) => ({ ...prev, [item.id]: nutzlast }));
                                          return;
                                        }
                                        const ok = await sendStatusAction(item.id, "metriken", nutzlast);
                                        if (ok) setMetricsDraft((prev) => ohne(prev, item.id));
                                      }}
                                      disabled={pending || (!metricsD.impressions.trim() && !metricsD.likes.trim())}
                                      className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30 transition-all disabled:opacity-40"
                                    >
                                      Speichern
                                    </button>
                                  </div>
                                  <p className="text-[10px] text-text-muted">
                                    Letzte Erfassung: {metrikenText(item.performance)}
                                    {verlaufAnzahl > 0 ? ` · ${verlaufAnzahl} frühere im Verlauf` : ""}
                                  </p>
                                </div>
                              )}

                              {aktionFehler[item.id] && (
                                <p className="text-[11px]" role="alert" style={{ color: "var(--gp-rose)" }}>
                                  {maskiert(aktionFehler[item.id])}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
