"use client";

// Hooks für den ehrlichen Systemzustand und den Freigabe-Stapel (Objekt-Studio Stufe 1).
// Beide lesen nur über den Server (/api/status, /api/freigaben) und nie direkt mit dem
// Anon-Key. Fehler werden zurückgegeben, nicht verschluckt: Die Anzeige muss "nicht
// lesbar" von "leer" unterscheiden können.
//
// Fixrunde 06.11.2026:
// - R28: /api/status wird einmal gepollt. SystemStatusProvider (eingebunden in der Shell)
//   hält den Abruf, useSystemStatus() liest ihn aus dem Context. Ohne Provider ruft der Hook
//   selbst ab (Rückfall). TopBar, Command Center und Panels zeigen so dieselbe Messung.
// - R29: Jeder Abruf bekommt eine laufende Nummer. Nur der zuletzt gestartete setzt Daten
//   und Fehler; ein neuer Abruf bricht den vorigen ab.
// - R26: Der HTTP-Status des letzten Abrufs geht mit (httpStatus). 401 heißt "nicht
//   angemeldet": Der Server ist erreichbar, gemessen ist nichts.
// - Fehlertexte für die Anzeige zeigen den geschützten Namen nie (lib/freigabe-regeln.ts).
// Dazu kommen reine Anzeige-Regeln ohne React, die mehrere Seiten teilen: Vollständigkeit der
// Kosten (R20), Zustand eines Agenten-Laufs (R33), Kostensumme über Läufe (R32) und der
// unbekannte Ausgang eines Ausführen-Aufrufs (R10). Tests: tests/c-hooks-status.test.mjs.
// Nachprüfung 06.11.2026: Der Grund "Abfrage abgeschnitten" steht für heute nur, wenn der
// Kostenwert ihn für den Tag belegt; "≥" vor laeufe_monat nur ohne Gesamtzahl. Ein 401 von
// /api/objekte heißt "nicht angemeldet", nicht "Export offline" (ObjekteLesung.nichtAngemeldet).
// Gesamtprüfung 06.11.2026: Antworten der Planung (POST /api/donna/delegate mit task) liest
// lesePlanungsFehlschlag für Command Center und /donna gleich — Kosten des Fehlversuchs,
// protokoll_fehler und der Hinweis, dass diese Kosten im Systemzustand fehlen.
// Freigabe-Stapel sparsam (09.11.2026): usePoll pausiert im verborgenen Tab wie die Liste auf
// /content — der erste Abruf beim Aufbau wie bisher, im Takt kein Abruf, solange
// document.visibilityState "hidden" ist, beim Wechsel auf sichtbar sofort einer, danach wieder im
// Takt; ohne document (Server, Tests ohne DOM) nur der Takt. Gilt für /api/status
// (SystemStatusProvider, Rückfall in useSystemStatus) und /api/freigaben (useFreigaben).
// Tests: tests/c-poll-sichtbarkeit.test.mjs.

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { maskiereGeschuetzteNamen } from "./freigabe-regeln";
import type { PlanungsKosten } from "./auftrag-types";
import type { ObjektLite } from "./hooks";
import type { FreigabenAntwort, KostenWert, SystemStatus } from "./status-types";

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function istZahl(wert: unknown): wert is number {
  return typeof wert === "number" && Number.isFinite(wert);
}

/** Text für die Anzeige: getrimmt, geschützter Name maskiert (Inhaber-Regel 05.11.2026). */
export function anzeigeFehler(text: string): string {
  return maskiereGeschuetzteNamen(text.trim());
}

/** Fehlertext aus einer JSON-Antwort: "fehler", ersatzweise "error" (Middleware, ältere Routen). */
function meldungAus(json: unknown): string | null {
  if (!istObjekt(json)) return null;
  for (const feld of ["fehler", "error"]) {
    const wert = json[feld];
    if (typeof wert === "string" && wert.trim()) return wert.trim();
  }
  return null;
}

// ── Abruf (rein, ohne React) ──

/** Ergebnis eines Abrufs. httpStatus null = keine HTTP-Antwort (Netzfehler, Abbruch). */
export type AbrufErgebnis<T> =
  | { ok: true; daten: T; httpStatus: number }
  | { ok: false; fehler: string; httpStatus: number | null };

/**
 * Ein GET-Abruf mit JSON-Antwort. Erfolg nur bei 2xx UND einem JSON-Objekt. 401 heißt "nicht
 * angemeldet" (so antwortet die Middleware ohne gültige Session). Wirft nie.
 */
export async function holeJson<T>(url: string, signal?: AbortSignal, holen?: typeof fetch): Promise<AbrufErgebnis<T>> {
  let res: Response;
  try {
    res = await (holen ?? fetch)(url, { cache: "no-store", signal });
  } catch (e) {
    const grund = e instanceof Error && e.message ? e.message : String(e);
    return { ok: false, fehler: `Server nicht erreichbar (${anzeigeFehler(grund)})`, httpStatus: null };
  }
  if (res.status === 401) return { ok: false, fehler: "Nicht angemeldet (HTTP 401)", httpStatus: 401 };
  const json: unknown = await res.json().catch(() => null);
  if (res.ok && istObjekt(json)) return { ok: true, daten: json as T, httpStatus: res.status };
  const meldung = meldungAus(json);
  const fehler = meldung
    ? anzeigeFehler(meldung)
    : res.ok
      ? `HTTP ${res.status}: Antwort ist kein lesbares JSON-Objekt`
      : `HTTP ${res.status}`;
  return { ok: false, fehler, httpStatus: res.status };
}

export interface PollZustand<T> {
  daten: T | null;
  fehler: string | null;
  loading: boolean;
  /** ISO-Zeitpunkt des letzten erfolgreichen Abrufs im Browser (Browseruhr). */
  geladenAm: string | null;
  /** HTTP-Status des letzten abgeschlossenen Abrufs; null ohne HTTP-Antwort oder vor dem ersten. */
  httpStatus: number | null;
}

export function startZustand<T>(): PollZustand<T> {
  return { daten: null, fehler: null, loading: true, geladenAm: null, httpStatus: null };
}

/** Übernimmt ein Abrufergebnis. Ein Fehler behält die letzten Daten; ob sie noch gelten, entscheidet die Anzeige. */
export function uebernimmAbruf<T>(z: PollZustand<T>, e: AbrufErgebnis<T>, jetztIso: string): PollZustand<T> {
  if (e.ok) return { daten: e.daten, fehler: null, loading: false, geladenAm: jetztIso, httpStatus: e.httpStatus };
  return { daten: z.daten, fehler: e.fehler, loading: false, geladenAm: z.geladenAm, httpStatus: e.httpStatus };
}

export interface AbrufFolge {
  /** Neuer Abruf: bricht den vorigen ab und liefert Nummer und Abbruchsignal. */
  starte(): { nr: number; signal: AbortSignal };
  /** true nur für den zuletzt gestarteten Abruf und nur, solange die Folge offen ist. */
  istAktuell(nr: number): boolean;
  oeffnen(): void;
  /** Beim Unmount: laufenden Abruf abbrechen und alle vergebenen Nummern ungültig machen. */
  schliessen(): void;
}

/** Laufende Nummer der Abrufe einer Hook-Instanz (R29). */
export function erzeugeAbrufFolge(): AbrufFolge {
  let nr = 0;
  let offen = true;
  let laufend: AbortController | null = null;
  return {
    starte() {
      laufend?.abort();
      laufend = new AbortController();
      nr += 1;
      return { nr, signal: laufend.signal };
    },
    istAktuell(n) {
      return offen && n === nr;
    },
    oeffnen() {
      offen = true;
    },
    schliessen() {
      offen = false;
      nr += 1;
      laufend?.abort();
      laufend = null;
    },
  };
}

// ── Hooks ──

/** Tab verborgen (document.visibilityState "hidden")? Ohne document (Server, Tests ohne DOM) nie. */
function tabVerborgen(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function usePoll<T>(url: string, intervallMs: number, aktiv: boolean) {
  const [zustand, setZustand] = useState<PollZustand<T>>(startZustand);
  const [folge] = useState(erzeugeAbrufFolge);

  const laden = useCallback(async () => {
    const { nr, signal } = folge.starte();
    const ergebnis = await holeJson<T>(url, signal);
    // Eine ältere Antwort, die nach einer jüngeren ankommt, wird verworfen (R29).
    if (!folge.istAktuell(nr)) return;
    const jetzt = new Date().toISOString();
    setZustand((z) => uebernimmAbruf(z, ergebnis, jetzt));
  }, [url, folge]);

  useEffect(() => {
    if (!aktiv) return;
    folge.oeffnen();
    // Erster Abruf beim Aufbau wie bisher, auch im verborgenen Tab (wie die Liste auf /content).
    const start = setTimeout(laden, 0);
    // Verborgener Tab: Der Takt fragt nicht ab. Beim Zurückkehren sofort ein Abruf, danach wieder im
    // Takt. Ohne document (Server, Tests ohne DOM) läuft nur der Takt.
    const takt = setInterval(() => {
      if (!tabVerborgen()) void laden();
    }, intervallMs);
    const beiSichtwechsel = () => {
      if (!tabVerborgen()) void laden();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", beiSichtwechsel);
    return () => {
      folge.schliessen();
      clearTimeout(start);
      clearInterval(takt);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", beiSichtwechsel);
    };
  }, [laden, intervallMs, aktiv, folge]);

  return { zustand, laden };
}

export interface SystemStatusLesung {
  /** Letzte erfolgreich gelesene Antwort; bleibt bei einem späteren Fehler stehen. */
  status: SystemStatus | null;
  fehler: string | null;
  loading: boolean;
  /** ISO-Zeitpunkt des letzten erfolgreichen Abrufs (Browseruhr). */
  geladenAm: string | null;
  /** HTTP-Status des letzten abgeschlossenen Abrufs; null ohne HTTP-Antwort. 401 = nicht angemeldet. */
  httpStatus: number | null;
  neuLaden: () => Promise<void>;
}

const STATUS_URL = "/api/status";
const STATUS_TAKT_MS = 60_000;

const StatusKontext = createContext<SystemStatusLesung | null>(null);

function alsStatusLesung(z: PollZustand<SystemStatus>, neuLaden: () => Promise<void>): SystemStatusLesung {
  return { status: z.daten, fehler: z.fehler, loading: z.loading, geladenAm: z.geladenAm, httpStatus: z.httpStatus, neuLaden };
}

/** Hält den einen Abruf von /api/status für alles darunter (R28), im verborgenen Tab pausiert. Eingebunden in der Shell. */
export function SystemStatusProvider({ children, intervallMs = STATUS_TAKT_MS }: { children?: ReactNode; intervallMs?: number }) {
  const { zustand, laden } = usePoll<SystemStatus>(STATUS_URL, intervallMs, true);
  const wert = useMemo(() => alsStatusLesung(zustand, laden), [zustand, laden]);
  return createElement(StatusKontext.Provider, { value: wert }, children);
}

/**
 * Der letzte Abruf endete mit 401: keine gültige Sitzung (so antwortet die Middleware). Der
 * Server ist erreichbar, gemessen ist nichts. Anzeige bernstein wie "ungemessen", nicht rot wie
 * ein Ausfall (R26).
 */
export function istNichtAngemeldet(l: { fehler: string | null; httpStatus: number | null }): boolean {
  return l.fehler !== null && l.httpStatus === 401;
}

/**
 * Systemzustand. Unter dem SystemStatusProvider liest der Hook dessen Abruf und startet keinen
 * eigenen; intervallMs gilt dann nicht. Ohne Provider ruft er selbst ab. status bleibt null,
 * bis der erste Abruf gelingt.
 */
export function useSystemStatus(intervallMs = STATUS_TAKT_MS): SystemStatusLesung {
  const geteilt = useContext(StatusKontext);
  const eigen = usePoll<SystemStatus>(STATUS_URL, intervallMs, geteilt === null);
  return geteilt ?? alsStatusLesung(eigen.zustand, eigen.laden);
}

export interface FreigabenLesung {
  freigaben: FreigabenAntwort | null;
  fehler: string | null;
  loading: boolean;
  geladenAm: string | null;
  /** HTTP-Status des letzten abgeschlossenen Abrufs; null ohne HTTP-Antwort. */
  httpStatus: number | null;
  neuLaden: () => Promise<void>;
}

/** Freigabe-Stapel alle 60 s, im verborgenen Tab pausiert (eigener Abruf je Aufrufer). */
export function useFreigaben(intervallMs = 60_000): FreigabenLesung {
  const { zustand, laden } = usePoll<FreigabenAntwort>("/api/freigaben", intervallMs, true);
  return {
    freigaben: zustand.daten,
    fehler: zustand.fehler,
    loading: zustand.loading,
    geladenAm: zustand.geladenAm,
    httpStatus: zustand.httpStatus,
    neuLaden: laden,
  };
}

// ── Objekte (Typ und Fehlertext; geladen wird mit useObjekte aus lib/hooks) ──

/** Objekte aus /api/objekte, einmal je Seite geladen und an Lagebild und Steinadel-Panel gereicht (R28). */
export interface ObjekteLesung {
  objekte: ObjektLite[];
  loading: boolean;
  /** Fehlertext für die Anzeige (objektFehlerText); null ohne Fehler. */
  error: string | null;
  /**
   * true: /api/objekte antwortete 401, die Sitzung fehlt oder ist abgelaufen. Der Export wurde
   * dann gar nicht abgefragt; die Anzeige sagt "nicht angemeldet" statt "offline". Fehlt das
   * Feld, gilt false.
   */
  nichtAngemeldet?: boolean;
  /**
   * Ursache des Fehlers (Nachprüfung im Browser 06.11.2026); null ohne Fehler. Fehlt das Feld
   * bei einem Fehler, gilt "unbekannt" — die Anzeige sagt dann "nicht lesbar", nie "offline".
   */
  fehlerArt?: ObjekteFehlerArt | null;
}

/**
 * Ursache eines Objekte-Fehlers. Vorher hieß jeder Fehler "EXPORT OFFLINE" bzw. "Quelle nicht
 * erreichbar", auch ein fehlendes Export-Token (der Export wurde dann gar nicht abgefragt).
 */
export type ObjekteFehlerArt = "nicht_angemeldet" | "konfiguration" | "nicht_erreichbar" | "quelle_fehler" | "unbekannt";

// Fehlertext von useObjekte (lib/hooks.ts) für eine Antwort ohne Feld "fehler": `HTTP ${status}`.
// Ohne Sitzung antwortet die Middleware mit 401 {error: "Unauthorized"}, also "HTTP 401". Die
// Route selbst antwortet nie mit 401 (nur 200, 500 und 502 mit "fehler"); ein 401 des Exports
// kommt als 502 "quelle_http_401" an und bleibt ein Fehler der Quelle.
const OBJEKTE_OHNE_SITZUNG = "HTTP 401";
// Codes der Route (api/objekte/route.ts): Fehlerantwort des Exports mit dessen Status.
const QUELLE_HTTP = /^quelle_http_(\d{3})$/;

/** Fehler von useObjekte als "nicht angemeldet" (401 der Middleware)? */
export function objekteNichtAngemeldet(fehler: string | null | undefined): boolean {
  return typeof fehler === "string" && fehler.trim() === OBJEKTE_OHNE_SITZUNG;
}

/** Fehler von /api/objekte für die Anzeige: Fehlercode als Klartext, technische Bezeichner nie sichtbar. */
export function objektFehlerText(fehler: string): string {
  const t = fehler.trim();
  if (t === OBJEKTE_OHNE_SITZUNG) return "Nicht angemeldet (HTTP 401)";
  if (t === "quelle_nicht_erreichbar") return "Steinadel-Export nicht erreichbar";
  const quelleStatus = QUELLE_HTTP.exec(t);
  if (quelleStatus) return `Steinadel-Export antwortete mit HTTP ${quelleStatus[1]}`;
  if (t === "quelle_antwort_unlesbar") return "Antwort des Steinadel-Exports nicht lesbar";
  // Gegencheck 06.11.2026: Der Zweig für die Altform mit Variablennamen (vor R23) ist entfernt;
  // die Route im selben Build nennt ihn nicht mehr. anzeigeFehler maskiert den geschützten Namen.
  return anzeigeFehler(t) || "unbekannter Fehler";
}

/**
 * Ursache eines Fehlers von useObjekte: 401 der Middleware, sonst das Feld "fehler_art" der Route,
 * sonst aus dem Code abgeleitet. Was keiner Regel entspricht (etwa "Failed to fetch" oder ein
 * HTTP 500 ohne Fehlerfeld), ist "unbekannt". null ohne Fehler.
 */
export function objekteFehlerArt(fehler: string | null | undefined, fehlerArt?: string | null): ObjekteFehlerArt | null {
  if (typeof fehler !== "string") return null;
  if (objekteNichtAngemeldet(fehler)) return "nicht_angemeldet";
  if (fehlerArt === "konfiguration" || fehlerArt === "nicht_erreichbar" || fehlerArt === "quelle_fehler") return fehlerArt;
  const t = fehler.trim();
  if (t === "quelle_nicht_erreichbar") return "nicht_erreichbar";
  if (QUELLE_HTTP.test(t) || t === "quelle_antwort_unlesbar") return "quelle_fehler";
  return "unbekannt";
}

/** ObjekteLesung aus dem Ergebnis von useObjekte (lib/hooks): Fehlertext bereinigt, Ursache bestimmt. */
export function objekteLesungAus(r: {
  objekte: ObjektLite[];
  loading: boolean;
  error: string | null;
  fehlerArt?: string | null;
}): ObjekteLesung {
  return {
    objekte: r.objekte,
    loading: r.loading,
    error: r.error === null ? null : objektFehlerText(r.error),
    nichtAngemeldet: objekteNichtAngemeldet(r.error),
    fehlerArt: objekteFehlerArt(r.error, r.fehlerArt),
  };
}

/**
 * Ursache aus einer ObjekteLesung; null beim Laden oder ohne Fehler. Lesungen ohne fehlerArt
 * (ältere Aufrufer) fallen auf nichtAngemeldet zurück, sonst "unbekannt".
 */
export function objekteLesungFehlerArt(l: ObjekteLesung): ObjekteFehlerArt | null {
  if (l.loading || l.error === null) return null;
  if (l.fehlerArt) return l.fehlerArt;
  return l.nichtAngemeldet === true ? "nicht_angemeldet" : "unbekannt";
}

/** Wortlaut je Fehlerursache für Lagebild und Steinadel-Panel (dieselbe Regel an beiden Stellen). */
export interface ObjekteFehlerAnzeige {
  /** Statuszeile des Lagebilds. */
  kopf: string;
  /** Export-Pille im Lagebild (SVG): höchstens 33 Zeichen, sonst verlässt sie die viewBox. */
  pille: string;
  /** Wert im Steinadel-Panel. */
  panel: string;
  /** Erklärung im Tooltip; der Fehlertext steht dahinter. */
  titel: string;
  farbe: "amber" | "rose";
}

export function objekteFehlerAnzeige(art: ObjekteFehlerArt | null | undefined): ObjekteFehlerAnzeige {
  switch (art) {
    case "nicht_angemeldet":
      return {
        kopf: "NICHT ANGEMELDET",
        pille: "STEINADEL · EXPORT · UNGEMESSEN",
        panel: "nicht angemeldet",
        titel: "Nicht angemeldet (HTTP 401): Ohne gültige Sitzung liest das Dashboard den Steinadel-Export nicht; er wurde nicht abgefragt.",
        farbe: "amber",
      };
    case "konfiguration":
      return {
        kopf: "EXPORT NICHT KONFIGURIERT",
        pille: "STEINADEL · EXPORT · OHNE ZUGANG",
        panel: "Zugang nicht konfiguriert",
        titel: "Serverkonfiguration: Der Zugang zum Steinadel-Export fehlt oder ist unbrauchbar; der Export wurde nicht abgefragt.",
        farbe: "rose",
      };
    case "nicht_erreichbar":
      return {
        kopf: "EXPORT OFFLINE",
        pille: "STEINADEL · EXPORT-API · OFFLINE",
        panel: "Quelle nicht erreichbar",
        titel: "Der Steinadel-Export war nicht erreichbar (Netzfehler oder Zeitlimit).",
        farbe: "rose",
      };
    case "quelle_fehler":
      return {
        kopf: "EXPORT-FEHLER",
        pille: "STEINADEL · EXPORT-API · FEHLER",
        panel: "Quelle meldet Fehler",
        titel: "Der Steinadel-Export antwortete, aber mit Fehlerstatus oder unlesbarer Antwort.",
        farbe: "rose",
      };
    default:
      return {
        kopf: "EXPORT NICHT LESBAR",
        pille: "STEINADEL · EXPORT · NICHT LESBAR",
        panel: "nicht lesbar",
        titel: "Die Objektliste war nicht lesbar; die Ursache ist nicht bekannt.",
        farbe: "rose",
      };
  }
}

// ── Anzeige-Regeln (rein, ohne React) ──

/** Kostensumme eines Zeitraums aus /api/status (R20). Immer eine Schätzung. */
export interface KostenZeitraum {
  usd: number;
  /** false: Die Summe ist eine Untergrenze und wird mit "≥" gezeigt. */
  vollstaendig: boolean;
  /** Läufe ohne Kostenangabe im Zeitraum; null, wenn der Server es nicht meldet. */
  ohneKosten: number | null;
  /** Anteil der L.I.S.A.-Planungen; null, wenn der Server ihn nicht meldet. */
  planungUsd: number | null;
}

/**
 * Tages- oder Monatssumme aus dem Kostenwert. null, wenn die Summe fehlt oder keine Zahl ist.
 * Vollständig nur bei ausdrücklichem true vom Server (fail-closed).
 */
export function kostenZeitraum(w: KostenWert | null | undefined, zeitraum: "heute" | "monat"): KostenZeitraum | null {
  if (!w || typeof w !== "object") return null;
  const heute = zeitraum === "heute";
  const usd: unknown = heute ? w.heute_usd : w.monat_usd;
  if (!istZahl(usd)) return null;
  const ohne: unknown = heute ? w.ohne_kosten_heute : w.ohne_kosten_monat;
  const planung: unknown = heute ? w.planung_heute_usd : w.planung_monat_usd;
  return {
    usd,
    vollstaendig: (heute ? w.heute_vollstaendig : w.monat_vollstaendig) === true,
    ohneKosten: istZahl(ohne) ? ohne : null,
    planungUsd: istZahl(planung) ? planung : null,
  };
}

/**
 * Warum ein Zeitraum nur eine Untergrenze ist; null, wenn er vollständig oder nicht lesbar ist.
 * Genannt wird nur, was der Kostenwert belegt. abgeschnitten gilt für die Monatsabfrage. Einen
 * eigenen Abschnitt für heute meldet der Vertrag nicht: Der Server wertet den Tag nur dann als
 * abgeschnitten, wenn die geladenen Läufe nicht bis Mitternacht zurückreichen, und setzt
 * heute_vollstaendig = Tag nicht abgeschnitten UND ohne_kosten_heute === 0 (werteKostenAus in
 * lib/status-server.ts). Meldet er den Tag als unvollständig ohne einen Lauf ohne Kostenangabe,
 * ist der Abschnitt die Ursache; sonst ist offen, ob er den Tag betrifft, und er wird für heute
 * nicht genannt (der Hinweis des Servers steht daneben). Nachprüfung 06.11.2026: Vorher stand
 * hier "Abfrage abgeschnitten" auch dann, wenn der Server den Tag als nicht abgeschnitten meldete.
 */
export function kostenLuecke(w: KostenWert | null | undefined, zeitraum: "heute" | "monat"): string | null {
  const z = kostenZeitraum(w, zeitraum);
  if (!z || z.vollstaendig || !w) return null;
  const gruende: string[] = [];
  if (z.ohneKosten !== null && z.ohneKosten > 0) {
    gruende.push(`${z.ohneKosten.toLocaleString("de-DE")} ${z.ohneKosten === 1 ? "Lauf" : "Läufe"} ohne Kostenangabe`);
  }
  if (w.abgeschnitten === true) {
    if (zeitraum === "monat") {
      gruende.push("Abfrage abgeschnitten (Zeilenlimit)");
    } else if (w.heute_vollstaendig === false && z.ohneKosten === 0) {
      gruende.push("Abfrage abgeschnitten (Zeilenlimit), die geladenen Läufe reichen nicht bis Mitternacht zurück");
    }
  }
  if (gruende.length === 0) gruende.push("Vollständigkeit vom Server nicht bestätigt");
  return `${zeitraum === "heute" ? "Heute" : "Monat"} ist eine Untergrenze: ${gruende.join(", ")}.`;
}

/**
 * Ist laeufe_monat nur eine Untergrenze? Der Server meldet die exakte Gesamtzahl aus Supabase,
 * auch wenn die Kostenzeilen abgeschnitten sind (werteKostenAus: laeufe_monat = gesamt ??
 * zeilen.length). Nur ohne Gesamtzahl zählt er die geladenen Zeilen und sagt das im Hinweis
 * ("Supabase lieferte keine Gesamtzahl", lib/status-server.ts). Ein Feld dafür hat der Vertrag
 * nicht; deshalb wird dieser Hinweis erkannt. Untergrenze nur, wenn dazu abgeschnitten ist.
 */
export function laeufeMonatUntergrenze(w: KostenWert | null | undefined, hinweis: string | null | undefined): boolean {
  if (!w || w.abgeschnitten !== true) return false;
  return typeof hinweis === "string" && /keine Gesamtzahl/i.test(hinweis);
}

/** Zustand eines Agenten-Laufs für die Anzeige (R33, Vertrag lib/auftrag-types.ts). */
export type LaufZustand = "fehler" | "unvollstaendig" | "unbekannt" | "fertig";

/**
 * "fertig" nur ohne Fehler UND mit abgeschnitten === false. abgeschnitten true: vom Modell
 * abgebrochen (z. B. max_tokens). Fehlt die Angabe (null, ältere Antworten), ist die
 * Vollständigkeit unbekannt; auch das zählt nicht als erfolgreich.
 */
export function laufZustand(r: { fehler?: unknown; abgeschnitten?: unknown }): LaufZustand {
  if (r.fehler !== null && r.fehler !== undefined) return "fehler";
  if (r.abgeschnitten === true) return "unvollstaendig";
  if (r.abgeschnitten === false) return "fertig";
  return "unbekannt";
}

export interface LaufZaehlung {
  gesamt: number;
  /** Erfolgreich: ohne Fehler und als vollständig gemeldet. */
  fertig: number;
  unvollstaendig: number;
  unbekannt: number;
  fehler: number;
  /** Läufe, deren cost keine Zahl ist. */
  ohneKosten: number;
}

export function zaehleLaeufe(results: ReadonlyArray<{ fehler?: unknown; abgeschnitten?: unknown; cost?: unknown }>): LaufZaehlung {
  const z: LaufZaehlung = { gesamt: 0, fertig: 0, unvollstaendig: 0, unbekannt: 0, fehler: 0, ohneKosten: 0 };
  for (const r of results) {
    z.gesamt += 1;
    z[laufZustand(r)] += 1;
    if (!istZahl(r.cost)) z.ohneKosten += 1;
  }
  return z;
}

export type KostenSumme = { art: "nicht_gemessen" } | { art: "geschaetzt"; usd: number; ohneKosten: number };

/**
 * Geschätzte Summe über Läufe (R32). "nicht_gemessen", wenn kein Lauf eine Kostenangabe hat
 * oder die Summe keine Zahl ist, nie 0 als Platzhalter. ohneKosten > 0: Die Summe ist eine
 * Untergrenze.
 */
export function kostenSumme(summe: unknown, laeufe: number, ohneKosten: number): KostenSumme {
  if (!istZahl(summe) || !(laeufe > 0) || ohneKosten >= laeufe) return { art: "nicht_gemessen" };
  return { art: "geschaetzt", usd: summe, ohneKosten: Math.max(0, ohneKosten) };
}

/**
 * Ist der Ausgang eines Ausführen-Aufrufs (POST /api/donna/delegate mit ausfuehren) unbekannt
 * (R10)? Dann kann der Plan auf dem Server gelaufen sein oder noch laufen. Ja bei: keiner
 * lesbaren JSON-Antwort (Netzfehler, Proxy-Fehlerseite), 2xx ohne Ergebnis im erwarteten
 * Format, 500 (allgemeiner Fehlerfang der Route, kann nach dem Start fallen), 502 ohne
 * Fehlertext der Route und 503 aufwärts. Bekannt sind 4xx und 502 mit Fehlertext: So meldet
 * die Route Fehler vor dem Start. 409 (schon ausgeführt) behandelt der Aufrufer vorher.
 * Ein Netzfehler (fetch wirft) ist immer unbekannt; das prüft der Aufrufer im catch.
 */
export function ausgangUnbekannt(
  a: { ok: boolean; status: number; daten: unknown },
  istErgebnis: (d: unknown) => boolean,
): boolean {
  if (!istObjekt(a.daten)) return true;
  if (a.ok) return !istErgebnis(a.daten);
  if (a.status === 502) return !(typeof a.daten.fehler === "string" && a.daten.fehler.trim() !== "");
  return a.status >= 500;
}

// ── Antworten der Planung (Gesamtprüfung 06.11.2026) ──
// Eine gescheiterte, aber bezahlte Planung antwortet 502 { fehler, planung, protokoll_fehler? }
// (api/donna/delegate/route.ts). Vorher warf das Command Center nur fehler weg; Kosten und
// protokoll_fehler gingen verloren, /donna verwarf protokoll_fehler. Ist protokoll_fehler gesetzt,
// wurde die Fehllauf-Zeile nicht gespeichert: Dann fehlen diese Kosten auch in /api/status, das
// nur messages-Zeilen summiert. Dasselbe gilt für eine Plan-Antwort mit protokoll_fehler ("Plan
// nicht gespeichert"): Ohne Plan-Zeile fehlen die Planungskosten im Systemzustand.

/** Hinweis bei gescheiterter Planung, deren Fehllauf-Zeile nicht gespeichert wurde. */
export const FEHLVERSUCH_KOSTEN_FEHLEN =
  "Kosten dieses Fehlversuchs fehlen im Systemzustand (/api/status): Die Fehllauf-Zeile wurde nicht gespeichert.";
/** Hinweis bei einem Plan, dessen Plan-Zeile nicht gespeichert wurde. */
export const PLANUNG_KOSTEN_FEHLEN =
  "Kosten dieser Planung fehlen im Systemzustand (/api/status): Die Plan-Zeile wurde nicht gespeichert.";

function zahlOderNull(wert: unknown): number | null {
  return istZahl(wert) ? wert : null;
}

/** planung aus einer Antwort der Planung (Erfolg oder 502); null, wenn sie fehlt oder kein Modell nennt. */
export function lesePlanungsKosten(daten: unknown): PlanungsKosten | null {
  if (!istObjekt(daten) || !istObjekt(daten.planung)) return null;
  const p = daten.planung;
  if (typeof p.modell !== "string" || !p.modell.trim()) return null;
  return {
    modell: p.modell,
    input_tokens: zahlOderNull(p.input_tokens),
    output_tokens: zahlOderNull(p.output_tokens),
    kosten_usd_geschaetzt: zahlOderNull(p.kosten_usd_geschaetzt),
    stop_reason: typeof p.stop_reason === "string" && p.stop_reason.trim() ? p.stop_reason : null,
  };
}

export interface PlanungsFehlschlag {
  /** fehler (ersatzweise error) der Antwort, maskiert; null ohne Text. */
  meldung: string | null;
  /** Kosten des Fehlversuchs laut Route; null, wenn nicht gemeldet. */
  planung: PlanungsKosten | null;
  /** protokoll_fehler der Antwort, maskiert; null, wenn keiner gemeldet ist. */
  protokollFehler: string | null;
  /** Gesetzt, wenn die Kosten des Fehlversuchs im Systemzustand fehlen. */
  kostenHinweis: string | null;
}

/** protokoll_fehler als Anzeigetext; ein gesetzter, aber unlesbarer Wert heißt so (fail-closed). */
function protokollTextAus(daten: unknown): string | null {
  if (!istObjekt(daten)) return null;
  const pf = daten.protokoll_fehler;
  if (pf === undefined || pf === null) return null;
  if (typeof pf === "string") return pf.trim() ? anzeigeFehler(pf) : null;
  if (Array.isArray(pf)) {
    const texte = pf.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => anzeigeFehler(x));
    return texte.length > 0 ? texte.join(" · ") : null;
  }
  return "Protokollfehler gemeldet, Text nicht lesbar";
}

/** Antwort einer gescheiterten Planung lesen (Command Center und /donna). */
export function lesePlanungsFehlschlag(daten: unknown): PlanungsFehlschlag {
  const meldung = meldungAus(daten);
  const protokollFehler = protokollTextAus(daten);
  return {
    meldung: meldung === null ? null : anzeigeFehler(meldung),
    planung: lesePlanungsKosten(daten),
    protokollFehler,
    kostenHinweis: protokollFehler === null ? null : FEHLVERSUCH_KOSTEN_FEHLEN,
  };
}

/** Text mit Präfix, ohne es zu verdoppeln: delegate liefert schon "Plan nicht gespeichert: …". */
export function mitPraefix(praefix: string, text: string): string {
  const t = text.trim();
  return t.toLowerCase().startsWith(praefix.trim().toLowerCase()) ? t : `${praefix}${t}`;
}
