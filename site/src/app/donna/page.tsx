"use client";

// L.I.S.A. — Auftragszeile. Stufe 1 (05.11.2026), Vertrag lib/auftrag-types.ts: erst planen,
// dann GENAU diesen Plan ausführen (per auftrag_id). Es gibt kein Ausführen ohne angezeigten
// Plan; Quick-Tasks füllen nur das Eingabefeld. Alle Kosten kommen aus der Server-Antwort
// (Tokens × feste Preistabelle) und sind Schätzungen; fehlt ein Wert, steht "nicht gemessen".
// Fixrunde 06.11.2026: Abgeschnittene Läufe heißen "unvollständig" und zählen nicht als
// erfolgreich (R33). Die Historie speichert, wie viele Läufe ohne Kostenangabe waren; hat
// keiner eine, steht "Kosten nicht gemessen" statt 0 (R32). Bei 409 ein Verweis auf die
// Ergebnisse im Message Bus, bei verlorener Antwort "Ausgang unbekannt" statt nur "Bitte neu
// planen" (R10). Enter während einer IME-Komposition plant nicht (R37).
// Gesamtprüfung 06.11.2026: Eine gescheiterte Planung zeigt neben den Kosten des Fehlversuchs
// auch protokoll_fehler mit dem Hinweis, dass diese Kosten im Systemzustand fehlen
// (lesePlanungsFehlschlag, wie das Command Center). Ein Plan ohne gespeicherte Plan-Zeile nennt
// dasselbe für die Planungskosten. Ein Historieneintrag im Altformat ohne lesbaren Plan heißt
// "Schritte nicht gespeichert" statt "0 Schritte"; eine gespeicherte Summe 0 ohne Läufe heißt
// "Kosten nicht gemessen", nie "geschätzt 0,0000 USD".

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MAX_PLAN_SCHRITTE,
  type AusfuehrungAntwort,
  type AusfuehrungsErgebnis,
  type PlanAntwort,
  type PlanungsKosten,
} from "@/lib/auftrag-types";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import {
  PLANUNG_KOSTEN_FEHLEN,
  anzeigeFehler,
  ausgangUnbekannt,
  kostenSumme,
  lesePlanungsFehlschlag,
  laufZustand,
  zaehleLaeufe,
  type KostenSumme,
  type LaufZustand,
} from "@/lib/hooks-status";

// Nur Beschriftung. Welche Agenten erlaubt sind, entscheidet der Server (lib/auftrag.ts);
// die Seite importiert die Liste bewusst nicht, sonst kämen die System-Prompts ins Browser-Bundle.
// Stufe 1 (05.11.2026): TRADER entfernt; die Tier-Angaben entfallen, weil sie weder zu den
// Prompts noch zum Seed in scripts/setup_supabase_v2.sql passten.
const AGENT_TEAM: Array<{ id: string; skills: string }> = [
  { id: "oracle", skills: "Marktanalyse, Wettbewerber-Intel, Trend-Erkennung" },
  { id: "researcher", skills: "Fakten-Recherche, Quellen, Deep-Dive-Analyse" },
  { id: "scribe", skills: "Content (YouTube, Threads, Newsletter, Artikel)" },
  { id: "publisher", skills: "SEO, Scheduling, Qualitätsprüfung" },
  { id: "amplifier", skills: "Distribution, Hashtags, Growth-Hacking" },
  { id: "treasurer", skills: "Finanzen, Budget, ROI-Analyse, Break-Even" },
  { id: "architect", skills: "Technische Architektur, DevOps, Code-Review" },
  { id: "merchant", skills: "Monetarisierung, Pricing, Revenue-Streams" },
  { id: "counsel", skills: "Legal, Compliance, DSGVO, Impressum" },
  { id: "guardian", skills: "Security, Monitoring, Backup, Incidents" },
  { id: "strategist", skills: "Strategie, OKRs, Vision, Roadmap" },
  { id: "concierge", skills: "Community, Support, FAQ, Onboarding" },
  { id: "localizer", skills: "Übersetzung, Lokalisierung (EN/DE)" },
];

// Stufe 1 (05.11.2026): "Morning Briefing" (Krypto-News) und "Markt-Analyse"
// (Trading-Chancen) entfernt. Ein Klick füllt nur das Eingabefeld.
const QUICK_TASKS = [
  { label: "X-Thread", task: "Schreibe einen X/Twitter-Thread über die Vorteile von KI-Automation im Business" },
  { label: "YouTube-Skript", task: "Erstelle ein 10-Minuten YouTube-Skript über autonome KI-Systeme" },
  { label: "Newsletter", task: "Schreibe eine Newsletter-Ausgabe: AI Insider #1 — Die KI-Revolution" },
  { label: "Content-Strategie", task: "Erstelle eine Content-Strategie für die nächsten 7 Tage" },
];

type Ausfuehrung = AusfuehrungAntwort & { protokoll_fehler?: string[] };

interface HistorienEintrag {
  auftrag_id: string | null;
  original_task: string;
  /** Anzahl der Läufe; null bei Alteinträgen ohne lesbaren Plan (nicht gespeichert, nie 0 als Ersatz). */
  schritte: number | null;
  /** Läufe ohne Fehler; null bei Einträgen aus der Zeit vor Stufe 1. */
  erfolgreich: number | null;
  /** Läufe ohne Fehler UND als vollständig gemeldet (R33); null bei Einträgen vor dem 06.11.2026. */
  vollstaendig: number | null;
  kosten_usd_geschaetzt: number | null;
  /** Läufe ohne Kostenangabe (R32); null bei Einträgen vor dem 06.11.2026. */
  ohne_kosten: number | null;
  ausgefuehrt_am: string | null;
}

// Neuer Schlüssel für den aktuellen Auftrag (das alte Format war ohne auftrag_id nicht
// ausführbar); die Historie behält ihren Schlüssel und liest alte Einträge mit.
const SPEICHER_AKTUELL = "gp-lisa-auftrag";
const SPEICHER_HISTORIE = "gp-donna-history";

type Phase = "bereit" | "planen" | "ausfuehren";

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function istPlanAntwort(d: unknown): d is PlanAntwort {
  return (
    istObjekt(d) &&
    d.mode === "plan" &&
    typeof d.auftrag_id === "string" &&
    typeof d.original_task === "string" &&
    istObjekt(d.delegation_plan) &&
    Array.isArray(d.delegation_plan.agents) &&
    istObjekt(d.planung)
  );
}

function istAusfuehrung(d: unknown): d is Ausfuehrung {
  return (
    istObjekt(d) &&
    d.mode === "ausgefuehrt" &&
    typeof d.auftrag_id === "string" &&
    Array.isArray(d.results) &&
    istObjekt(d.summary) &&
    typeof d.hinweis === "string"
  );
}

function zahlOderNull(wert: unknown): number | null {
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

/** Historie tolerant lesen: neue Einträge und solche aus der Zeit vor Stufe 1. */
function leseHistorie(roh: string | null): HistorienEintrag[] {
  if (!roh) return [];
  const liste: unknown = JSON.parse(roh);
  if (!Array.isArray(liste)) return [];
  const eintraege: HistorienEintrag[] = [];
  for (const e of liste) {
    if (!istObjekt(e) || typeof e.original_task !== "string") continue;
    if (typeof e.schritte === "number") {
      eintraege.push({
        auftrag_id: typeof e.auftrag_id === "string" ? e.auftrag_id : null,
        original_task: e.original_task,
        schritte: e.schritte,
        erfolgreich: zahlOderNull(e.erfolgreich),
        vollstaendig: zahlOderNull(e.vollstaendig),
        kosten_usd_geschaetzt: zahlOderNull(e.kosten_usd_geschaetzt),
        ohne_kosten: zahlOderNull(e.ohne_kosten),
        ausgefuehrt_am: typeof e.ausgefuehrt_am === "string" ? e.ausgefuehrt_am : null,
      });
    } else {
      // Altformat: { original_task, delegation_plan: { agents }, summary: { total_cost_usd } }
      const agents = istObjekt(e.delegation_plan) ? e.delegation_plan.agents : null;
      eintraege.push({
        auftrag_id: null,
        original_task: e.original_task,
        schritte: Array.isArray(agents) ? agents.length : null,
        erfolgreich: null,
        vollstaendig: null,
        kosten_usd_geschaetzt: istObjekt(e.summary) ? zahlOderNull(e.summary.total_cost_usd) : null,
        ohne_kosten: null,
        ausgefuehrt_am: null,
      });
    }
  }
  return eintraege.slice(0, 10);
}

/** Schreibt in den Browser-Speicher; true nur bei Erfolg (Speicher voll oder gesperrt → false). */
function speichere(schluessel: string, wert: unknown): boolean {
  try {
    if (wert === null) localStorage.removeItem(schluessel);
    else localStorage.setItem(schluessel, JSON.stringify(wert));
    return true;
  } catch {
    // Persistenz ist Komfort, kein Muss; der Aufrufer entscheidet, ob er das zeigt.
    return false;
  }
}

function usd(wert: number | null): string {
  if (wert === null) return "nicht gemessen";
  if (wert > 0 && wert < 0.0001) return "< 0,0001 USD";
  return `${wert.toLocaleString("de-DE", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} USD`;
}

function anzahl(wert: number | null): string {
  return wert === null ? "nicht gemessen" : wert.toLocaleString("de-DE");
}

function zeitpunkt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function fehlerText(status: number, daten: unknown): string {
  if (status === 401) return "Nicht angemeldet (HTTP 401) — bitte neu anmelden";
  const meldung = istObjekt(daten) ? (daten.fehler ?? daten.error) : null;
  return typeof meldung === "string" && meldung ? `${anzeigeFehler(meldung)} (HTTP ${status})` : `HTTP ${status}`;
}

/** Enter plant nur ohne Umschalt und ohne laufende IME-Komposition (R37). Safari meldet den
 *  bestätigenden keydown nach compositionend mit isComposing false, aber keyCode 229. */
function istPlanEnter(e: React.KeyboardEvent): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229;
}

const ZUSTAND_TEXT: Record<LaufZustand, { text: string; farbe: string }> = {
  fehler: { text: "FEHLER", farbe: "var(--gp-rose)" },
  unvollstaendig: { text: "UNVOLLSTÄNDIG", farbe: "var(--gp-amber)" },
  unbekannt: { text: "VOLLSTÄNDIGKEIT UNBEKANNT", farbe: "var(--gp-amber)" },
  fertig: { text: "FERTIG", farbe: "var(--gp-emerald)" },
};

function zustandTitel(r: AusfuehrungsErgebnis, zustand: LaufZustand): string {
  if (zustand === "unvollstaendig") {
    return `Vom Modell abgebrochen (stop_reason ${r.stop_reason ?? "nicht gemeldet"}): Die Antwort ist unvollständig und zählt nicht als erfolgreich.`;
  }
  if (zustand === "unbekannt") {
    return "Die Antwort meldet nicht, ob das Modell vollständig geantwortet hat (kein stop_reason). Zählt nicht als erfolgreich.";
  }
  if (zustand === "fertig") return "Ohne Fehler und vollständig (stop_reason end_turn oder stop_sequence).";
  return "Der Lauf ist fehlgeschlagen.";
}

/** "geschätzt X", "geschätzt X · n ohne Kostenangabe" oder "Kosten nicht gemessen" (R32). */
function summenText(summe: KostenSumme): string {
  if (summe.art === "nicht_gemessen") return "Kosten nicht gemessen";
  const zusatz = summe.ohneKosten > 0 ? ` · ${summe.ohneKosten} ohne Kostenangabe` : "";
  return `geschätzt ${usd(summe.usd)}${zusatz}`;
}

/** Läufe eines Historieneintrags: neue Einträge zählen nur vollständige Läufe als erfolgreich (R33). */
function historieLaeufe(h: HistorienEintrag): { text: string; titel?: string } {
  if (h.schritte === null) {
    return { text: "Schritte nicht gespeichert", titel: "Älterer Eintrag ohne lesbaren Plan: Die Zahl der Schritte ist nicht gespeichert." };
  }
  if (h.vollstaendig !== null) {
    return {
      text: `${h.vollstaendig}/${h.schritte} erfolgreich`,
      titel: `Erfolgreich = ohne Fehler und vollständig.${
        h.erfolgreich !== null ? ` Ohne Fehler: ${h.erfolgreich}, davon vollständig: ${h.vollstaendig}.` : ""
      }`,
    };
  }
  if (h.erfolgreich !== null) {
    return {
      text: `${h.erfolgreich}/${h.schritte} ohne Fehler`,
      titel: "Älterer Eintrag: Ob die Antworten vollständig waren, ist nicht gespeichert.",
    };
  }
  return { text: `${h.schritte} Schritte` };
}

/** Kosten eines Historieneintrags (R32). Ältere Einträge kennen die Läufe ohne Kostenangabe nicht. */
function historieKosten(h: HistorienEintrag): { text: string; titel?: string } {
  if (h.ohne_kosten !== null && h.schritte !== null) {
    return { text: summenText(kostenSumme(h.kosten_usd_geschaetzt, h.schritte, h.ohne_kosten)) };
  }
  if (h.kosten_usd_geschaetzt === null) return { text: "Kosten nicht gemessen" };
  if (h.kosten_usd_geschaetzt === 0 && (h.schritte === null || h.schritte === 0)) {
    return {
      text: "Kosten nicht gemessen",
      titel: "Älterer Eintrag mit gespeicherter Summe 0 und ohne gespeicherte Läufe: Eine Messung ist nicht belegt.",
    };
  }
  if (h.kosten_usd_geschaetzt === 0) {
    return {
      text: "Kosten nicht gemessen",
      titel:
        "Älterer Eintrag mit gespeicherter Summe 0: Kein Lauf hatte eine Kostenangabe (abgeleitet — jeder gemessene Lauf kostet mehr als 0).",
    };
  }
  return {
    text: `geschätzt ${usd(h.kosten_usd_geschaetzt)}`,
    titel: "Älterer Eintrag: Nicht gespeichert, ob Läufe ohne Kostenangabe fehlen; die Summe kann zu klein sein.",
  };
}

async function sende(body: object): Promise<{ ok: boolean; status: number; daten: unknown }> {
  const res = await fetch("/api/donna/delegate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const daten: unknown = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, daten };
}

function PlanungsZeile({ planung, titel }: { planung: PlanungsKosten; titel: string }) {
  return (
    <div className="text-[11px] leading-relaxed" style={{ color: "var(--gp-ink-2)" }}>
      <span className="mono-label mr-2">{titel}</span>
      Tokens rein {anzahl(planung.input_tokens)} · raus {anzahl(planung.output_tokens)} · geschätzt{" "}
      <span className="font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-gold)" }}>
        {usd(planung.kosten_usd_geschaetzt)}
      </span>{" "}
      · {planung.modell} · stop_reason {planung.stop_reason ?? "nicht gemeldet"}
    </div>
  );
}

export default function DonnaPage() {
  const [task, setTask] = useState("");
  const [phase, setPhase] = useState<Phase>("bereit");
  const [plan, setPlan] = useState<PlanAntwort | null>(null);
  const [ausfuehrung, setAusfuehrung] = useState<Ausfuehrung | null>(null);
  // art "unbekannt": Die Antwort aufs Ausführen ging verloren oder war unlesbar (R10).
  // protokoll und kostenHinweis: gescheiterte Planung, deren Fehllauf-Zeile nicht gespeichert wurde.
  const [fehler, setFehler] = useState<{
    text: string;
    planung: PlanungsKosten | null;
    protokoll?: string | null;
    kostenHinweis?: string | null;
    art?: "unbekannt";
    auftragId?: string;
  } | null>(null);
  // art "schon_gelaufen": 409, der Plan lief bereits (Ergebnisse im Message Bus);
  // "neu_planen": 404/422, dieser Plan ist nicht ausführbar.
  const [gesperrt, setGesperrt] = useState<{
    auftragId: string;
    grund: string;
    art: "schon_gelaufen" | "neu_planen";
  } | null>(null);
  const [historie, setHistorie] = useState<HistorienEintrag[]>([]);
  // Gegencheck 06.11.2026: Lesefehler des Browser-Speichers sichtbar statt still verschluckt.
  // Eine nicht lesbare Historie wird nicht überschrieben, bis sie verworfen ist.
  const [historieFehler, setHistorieFehler] = useState<string | null>(null);
  const [auftragFehler, setAuftragFehler] = useState<string | null>(null);
  // Prüflauf 06.11.2026: Ist schon der Zugriff gesperrt (Website-Daten blockiert), ist nicht
  // bekannt, ob etwas gespeichert ist — dann kein "gespeichert, aber nicht lesbar" und kein
  // Verwerfen-Knopf, sondern der Hinweis, dass hier nichts gespeichert wird.
  const [speicherGesperrt, setSpeicherGesperrt] = useState<string | null>(null);

  // Aktuellen Auftrag und Historie aus diesem Browser laden — je Schlüssel für sich. Vorher
  // lagen beide in einem try: Ein kaputter Auftrag ließ die Historie ungelesen, und die nächste
  // Ausführung schrieb [neu] über die gespeicherten Einträge. Geschrieben wird nur in den
  // Handlern, damit der Leerzustand beim ersten Rendern nichts überschreibt.
  useEffect(() => {
    let rohAuftrag: string | null;
    let rohHistorie: string | null;
    try {
      rohAuftrag = localStorage.getItem(SPEICHER_AKTUELL);
      rohHistorie = localStorage.getItem(SPEICHER_HISTORIE);
    } catch (e) {
      setSpeicherGesperrt(e instanceof Error && e.message ? e.message : "kein Zugriff");
      return;
    }
    try {
      const aktuell: unknown = rohAuftrag ? JSON.parse(rohAuftrag) : null;
      if (istObjekt(aktuell)) {
        if (istPlanAntwort(aktuell.plan)) setPlan(aktuell.plan);
        if (istAusfuehrung(aktuell.ausfuehrung)) setAusfuehrung(aktuell.ausfuehrung);
      }
    } catch (e) {
      setAuftragFehler(e instanceof Error && e.message ? e.message : "unlesbar");
    }
    try {
      setHistorie(leseHistorie(rohHistorie));
    } catch (e) {
      setHistorieFehler(e instanceof Error && e.message ? e.message : "unlesbar");
    }
  }, []);

  const beschaeftigt = phase !== "bereit";
  const planAusgefuehrt = !!plan && !!ausfuehrung && ausfuehrung.auftrag_id === plan.auftrag_id;
  const sperre = gesperrt && plan && gesperrt.auftragId === plan.auftrag_id ? gesperrt : null;
  const sperrGrund = plan?.protokoll_fehler ?? sperre?.grund ?? null;
  const schonGelaufen = !plan?.protokoll_fehler && sperre?.art === "schon_gelaufen";

  async function planErstellen() {
    const text = task.trim();
    if (!text || beschaeftigt) return;
    setPhase("planen");
    setFehler(null);
    setPlan(null);
    setAusfuehrung(null);
    // Der alte (auch ein unlesbarer) Auftrag wird entfernt — danach gilt der Hinweis nicht mehr.
    if (speichere(SPEICHER_AKTUELL, null)) setAuftragFehler(null);
    try {
      const r = await sende({ task: text });
      if (!r.ok || !istPlanAntwort(r.daten)) {
        const f = lesePlanungsFehlschlag(r.daten);
        setFehler({
          text: fehlerText(r.status, r.daten),
          planung: f.planung,
          protokoll: f.protokollFehler,
          kostenHinweis: f.kostenHinweis,
        });
        return;
      }
      setPlan(r.daten);
      // Ein neu gespeicherter Auftrag ersetzt den unlesbaren — der Hinweis gilt dann nicht mehr.
      if (speichere(SPEICHER_AKTUELL, { plan: r.daten, ausfuehrung: null })) setAuftragFehler(null);
    } catch (e) {
      setFehler({ text: e instanceof Error ? anzeigeFehler(e.message) : "Planung fehlgeschlagen", planung: null });
    } finally {
      setPhase("bereit");
    }
  }

  async function planAusfuehren() {
    if (!plan || beschaeftigt || planAusgefuehrt || sperrGrund) return;
    const auftragId = plan.auftrag_id;
    setPhase("ausfuehren");
    setFehler(null);
    try {
      const r = await sende({ auftrag_id: auftragId, ausfuehren: true });
      if (r.ok && istAusfuehrung(r.daten)) {
        const ergebnis = r.daten;
        setAusfuehrung(ergebnis);
        if (speichere(SPEICHER_AKTUELL, { plan, ausfuehrung: ergebnis })) setAuftragFehler(null);
        const zaehlung = zaehleLaeufe(ergebnis.results);
        const eintrag: HistorienEintrag = {
          auftrag_id: ergebnis.auftrag_id,
          original_task: ergebnis.original_task,
          schritte: zaehlung.gesamt,
          erfolgreich: zaehlung.gesamt - zaehlung.fehler,
          vollstaendig: zaehlung.fertig,
          kosten_usd_geschaetzt: zahlOderNull(ergebnis.summary?.total_cost_usd_geschaetzt),
          ohne_kosten: zaehlung.ohneKosten,
          ausgefuehrt_am: new Date().toISOString(),
        };
        const neu = [eintrag, ...historie].slice(0, 10);
        setHistorie(neu);
        // Eine gespeicherte, aber nicht lesbare Historie bleibt stehen (sonst wären ihre
        // Einträge still weg); gespeichert wird erst wieder nach "verwerfen".
        if (historieFehler === null) speichere(SPEICHER_HISTORIE, neu);
        return;
      }
      const text = r.ok ? `Antwort ohne Ergebnis im erwarteten Format (HTTP ${r.status})` : fehlerText(r.status, r.daten);
      if (r.status === 409) {
        // Der Plan lief schon (zweiter Tab, Doppelklick, verlorene Antwort). Ausführen bleibt
        // gesperrt; die Ergebnisse stehen im Message Bus.
        setGesperrt({ auftragId, grund: text, art: "schon_gelaufen" });
        return;
      }
      if (ausgangUnbekannt(r, istAusfuehrung)) {
        setFehler({ text, planung: null, art: "unbekannt", auftragId });
        return;
      }
      setFehler({ text, planung: null });
      // 404 (Plan weg), 422 (Plan ungültig/verändert): neu planen.
      if (r.status === 404 || r.status === 422) setGesperrt({ auftragId, grund: text, art: "neu_planen" });
    } catch (e) {
      // Keine Antwort: Der Plan kann auf dem Server gelaufen sein oder noch laufen.
      setFehler({
        text: `Verbindung abgebrochen (${anzeigeFehler(e instanceof Error ? e.message : String(e))})`,
        planung: null,
        art: "unbekannt",
        auftragId,
      });
    } finally {
      setPhase("bereit");
    }
  }

  // Erfolgreich heißt ohne Fehler UND vollständig (R33); die Summe ist "nicht gemessen", wenn
  // kein Lauf eine Kostenangabe hat (R32).
  const zaehlung = ausfuehrung ? zaehleLaeufe(ausfuehrung.results) : null;
  const laufSumme =
    ausfuehrung && zaehlung
      ? kostenSumme(ausfuehrung.summary?.total_cost_usd_geschaetzt, zaehlung.gesamt, zaehlung.ohneKosten)
      : null;
  const planZurAusfuehrung = plan && ausfuehrung && plan.auftrag_id === ausfuehrung.auftrag_id ? plan : null;

  return (
    <div className="boot p-4 sm:p-6 lg:p-10 max-w-[1400px]">
      {/* Header */}
      <div className="gp-masthead">
        <div className="gp-index-row"><span className="gp-index">06 / EXECUTIVE</span><span className="gp-index-rule" /></div>
        <div>
          <p className="gp-kicker">Leadership Intelligence, Strategy &amp; Alignment</p>
          <div>
            <h1 className="gp-wordmark">
              L.I.S.<em>A.</em>
            </h1>
            <p className="gp-sub">
              Executive-COO-KI — Donna Paulsens Antizipation, Pepper Potts&apos; operative Disziplin. Plant Aufträge für das Agent-Team; ausgeführt wird erst nach deiner Prüfung.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Links: Auftragszeile — 2 Spalten */}
        <div className="lg:col-span-2 space-y-6">
          {/* Eingabe */}
          <div className="card-ghost card-active p-5">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
                Auftrag planen
              </h2>
              <span className="mono-label ml-auto">Schritt 1 von 2</span>
            </div>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => {
                if (istPlanEnter(e)) {
                  e.preventDefault();
                  void planErstellen();
                }
              }}
              placeholder="Beschreibe den Auftrag. L.I.S.A. erstellt daraus einen Plan; ausgeführt wird erst, wenn du genau diesen Plan bestätigst."
              rows={3}
              className="w-full bg-surface-elevated border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50 resize-none"
              disabled={beschaeftigt}
            />
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <button
                onClick={planErstellen}
                disabled={beschaeftigt || !task.trim()}
                aria-busy={phase === "planen"}
                className="px-5 py-2.5 bg-accent-violet/20 text-accent-violet text-sm font-medium rounded-lg hover:bg-accent-violet/30 transition-colors disabled:opacity-40"
              >
                {phase === "planen" ? "L.I.S.A. plant …" : "Plan erstellen"}
              </button>
              <span className="text-[11px]" style={{ color: "var(--gp-ink-3)" }}>
                Enter = Plan erstellen · Umschalt+Enter = neue Zeile
              </span>
            </div>
          </div>

          {/* Quick Tasks — füllen nur das Eingabefeld */}
          <div className="card-ghost p-5">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
                Vorlagen
              </h2>
              <span className="mono-label ml-auto">füllen nur das Eingabefeld</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_TASKS.map((qt) => (
                <button
                  key={qt.label}
                  onClick={() => setTask(qt.task)}
                  disabled={beschaeftigt}
                  className="text-left px-3 py-2.5 bg-surface-elevated rounded-lg text-xs text-text-secondary hover:text-foreground transition-colors border border-border disabled:opacity-40"
                >
                  <span className="font-medium text-foreground">{qt.label}</span>
                  <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{qt.task}</p>
                </button>
              ))}
            </div>
          </div>

          <div aria-live="polite" className="space-y-6">
            {/* Fehler */}
            {fehler && fehler.art === "unbekannt" && (
              <div className="card-ghost p-4" style={{ borderColor: "var(--gp-amber)" }}>
                <p className="text-sm" style={{ color: "var(--gp-amber)" }}>
                  Ausgang unbekannt — Ergebnisse unter{" "}
                  <Link href="/messages" className="underline" style={{ color: "var(--gp-gold-hi)" }}>
                    /messages
                  </Link>{" "}
                  prüfen.
                </p>
                <p className="text-xs mt-2 leading-relaxed break-words" style={{ color: "var(--gp-ink-2)" }}>
                  {fehler.text}. Der Plan kann auf dem Server gelaufen sein oder noch laufen
                  {fehler.auftragId ? (
                    <>
                      {" "}(Auftrag <span className="font-[family-name:var(--font-jbmono)]">{fehler.auftragId}</span>)
                    </>
                  ) : null}
                  . Ein zweites Ausführen desselben Plans lehnt der Server ab (409).
                </p>
              </div>
            )}
            {fehler && fehler.art !== "unbekannt" && (
              <div className="card-ghost p-4" style={{ borderColor: "var(--gp-rose)" }}>
                <p className="text-sm" style={{ color: "var(--gp-rose)" }}>{fehler.text}</p>
                {fehler.planung && (
                  <div className="mt-2">
                    <PlanungsZeile planung={fehler.planung} titel="Kosten des Fehlversuchs" />
                  </div>
                )}
                {fehler.protokoll && (
                  <p className="text-xs mt-2 break-words" style={{ color: "var(--gp-amber)" }}>
                    {fehler.protokoll}
                  </p>
                )}
                {fehler.kostenHinweis && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--gp-amber)" }}>
                    {fehler.kostenHinweis}
                  </p>
                )}
              </div>
            )}

            {/* Plan (Schritt 2: genau diesen ausführen) */}
            {plan && !planAusgefuehrt && (
              <div className="card-ghost card-active p-5">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
                    Plan
                  </h2>
                  <span className="mono-label ml-auto">Schritt 2 von 2</span>
                </div>
                <p className="text-[11px] mb-3" style={{ color: "var(--gp-ink-3)" }}>
                  <span className="font-[family-name:var(--font-jbmono)]">Auftrag {plan.auftrag_id}</span>
                  {zeitpunkt(plan.erstellt_am) && <> · erstellt {zeitpunkt(plan.erstellt_am)}</>}
                </p>
                <p className="text-xs mb-1" style={{ color: "var(--gp-ink-2)" }}>
                  <span className="mono-label mr-2">Für</span>
                  {maskiereGeschuetzteNamen(plan.original_task)}
                </p>
                <p className="text-xs italic mb-4" style={{ color: "var(--gp-ink-2)" }}>
                  {plan.delegation_plan.reasoning ? maskiereGeschuetzteNamen(plan.delegation_plan.reasoning) : "Keine Begründung geliefert."}
                </p>

                <ol className="space-y-2">
                  {plan.delegation_plan.agents.map((schritt, i) => (
                    <li key={i} className="bg-surface-elevated rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[10px] font-[family-name:var(--font-jbmono)] font-bold px-1.5 py-0.5 rounded"
                          style={{ border: "1px solid var(--gp-hairline)", color: "var(--gp-gold)" }}
                        >
                          P{schritt.priority}
                        </span>
                        <span className="text-xs font-[family-name:var(--font-jbmono)] font-bold" style={{ color: "var(--gp-cyan)" }}>
                          {schritt.id.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary whitespace-pre-wrap">{maskiereGeschuetzteNamen(String(schritt.task ?? ""))}</p>
                    </li>
                  ))}
                </ol>
                <p className="text-[11px] mt-2" style={{ color: "var(--gp-ink-3)" }}>
                  Gleiche Priorität läuft parallel; spätere Stufen bekommen die Ergebnisse früherer als ungeprüften Auszug.
                </p>

                <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--gp-hairline)" }}>
                  <PlanungsZeile planung={plan.planung} titel="Planung" />
                  <p className="text-[10px] mt-1" style={{ color: "var(--gp-ink-3)" }}>
                    Tokens laut Anthropic-Antwort; Kosten = Tokens × feste Preistabelle, also eine Schätzung.
                  </p>
                </div>

                {sperrGrund && schonGelaufen && (
                  <p
                    className="text-xs mt-3 leading-relaxed break-words"
                    style={{ color: "var(--gp-amber)" }}
                    title={`Antwort des Servers: ${anzeigeFehler(sperrGrund)}`}
                  >
                    Dieser Plan wurde bereits ausgeführt (HTTP 409). Die Ergebnisse stehen im Message Bus
                    (Auftrag <span className="font-[family-name:var(--font-jbmono)]">{plan.auftrag_id}</span>):{" "}
                    <Link href="/messages" className="underline" style={{ color: "var(--gp-gold-hi)" }}>
                      Message Bus öffnen →
                    </Link>
                  </p>
                )}
                {sperrGrund && !schonGelaufen && (
                  <p className="text-xs mt-3 break-words" style={{ color: "var(--gp-amber)" }}>
                    Ausführen gesperrt: {anzeigeFehler(sperrGrund)}. Bitte neu planen.
                  </p>
                )}
                {plan.protokoll_fehler && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--gp-amber)" }}>
                    {PLANUNG_KOSTEN_FEHLEN}
                  </p>
                )}

                <button
                  onClick={planAusfuehren}
                  disabled={beschaeftigt || !!sperrGrund}
                  aria-busy={phase === "ausfuehren"}
                  className="w-full mt-4 px-4 py-2.5 bg-accent-emerald/20 text-accent-emerald text-sm font-medium rounded-lg hover:bg-accent-emerald/30 transition-colors disabled:opacity-40"
                >
                  {phase === "ausfuehren" ? "Agenten arbeiten …" : schonGelaufen ? "Bereits ausgeführt" : "Genau diesen Plan ausführen"}
                </button>
              </div>
            )}

            {/* Ergebnisse */}
            {ausfuehrung && (
              <div className="card-ghost p-5">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
                    Ergebnisse
                  </h2>
                  <span className="mono-label ml-auto" style={{ color: "var(--gp-amber)" }}>ungeprüft</span>
                </div>
                <p className="text-[11px] mb-3" style={{ color: "var(--gp-ink-3)" }}>
                  <span className="font-[family-name:var(--font-jbmono)]">Auftrag {ausfuehrung.auftrag_id}</span>
                </p>
                <p className="text-xs mb-3" style={{ color: "var(--gp-ink-2)" }}>
                  <span className="mono-label mr-2">Für</span>
                  {maskiereGeschuetzteNamen(ausfuehrung.original_task)}
                </p>

                <div
                  className="rounded-lg px-3 py-2 mb-4 text-xs"
                  style={{ border: "1px solid var(--gp-amber)", color: "var(--gp-amber)" }}
                >
                  {ausfuehrung.hinweis}
                </div>

                <ol className="space-y-3">
                  {ausfuehrung.results.map((r, i) => {
                    const zustand = laufZustand(r);
                    const anzeige = ZUSTAND_TEXT[zustand];
                    const antwort = typeof r.response === "string" ? maskiereGeschuetzteNamen(r.response) : "";
                    return (
                      <li key={i} className="bg-surface-elevated rounded-lg p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span
                            className="text-[10px] font-[family-name:var(--font-jbmono)] font-bold px-1.5 py-0.5 rounded"
                            style={{ border: "1px solid var(--gp-hairline)", color: "var(--gp-gold)" }}
                          >
                            P{r.priority}
                          </span>
                          <span className="text-xs font-[family-name:var(--font-jbmono)] font-bold" style={{ color: "var(--gp-cyan)" }}>
                            {String(r.agent_id ?? "?").toUpperCase()}
                          </span>
                          <span
                            className="ml-auto text-[10px] font-[family-name:var(--font-jbmono)]"
                            style={{ color: anzeige.farbe }}
                            title={zustandTitel(r, zustand)}
                          >
                            {anzeige.text}
                          </span>
                          <span className="text-[10px] font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-ink-3)" }}>
                            {typeof r.cost === "number" ? `geschätzt ${usd(r.cost)}` : "Kosten nicht gemessen"}
                          </span>
                        </div>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap">{maskiereGeschuetzteNamen(String(r.task ?? ""))}</p>
                        {zustand === "fehler" && (
                          <p className="text-xs mt-2" style={{ color: "var(--gp-rose)" }}>
                            {anzeigeFehler(String(r.fehler ?? "")) || "Fehler ohne Text"}
                          </p>
                        )}
                        {zustand === "unvollstaendig" && (
                          <p className="text-xs mt-2" style={{ color: "var(--gp-amber)" }}>
                            Antwort unvollständig: vom Modell abgebrochen (stop_reason {r.stop_reason ?? "nicht gemeldet"}).
                          </p>
                        )}
                        {zustand !== "fehler" && antwort && (
                          <details className="mt-2">
                            <summary className="text-[11px] cursor-pointer hover:underline" style={{ color: "var(--gp-cyan)" }}>
                              {zustand === "unvollstaendig" ? "Teilantwort anzeigen (unvollständig, ungeprüft)" : "Antwort anzeigen (ungeprüft)"}
                            </summary>
                            <div
                              className="mt-2 text-[11px] whitespace-pre-wrap max-h-80 overflow-y-auto rounded p-2 font-[family-name:var(--font-jbmono)]"
                              style={{ background: "var(--gp-bg-0)", color: "var(--gp-ink-2)" }}
                            >
                              {antwort}
                            </div>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ol>

                {ausfuehrung.protokoll_fehler && ausfuehrung.protokoll_fehler.length > 0 && (
                  <div className="mt-4 text-xs" style={{ color: "var(--gp-amber)" }}>
                    <p className="mono-label mb-1" style={{ color: "var(--gp-amber)" }}>Protokoll unvollständig</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {ausfuehrung.protokoll_fehler.map((p, i) => (
                        <li key={i}>{anzeigeFehler(String(p))}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div
                  className="mt-4 pt-3 space-y-1 text-[11px]"
                  style={{ borderTop: "1px solid var(--gp-hairline)", color: "var(--gp-ink-2)" }}
                >
                  <p>
                    {zaehlung?.fertig ?? 0} von {zaehlung?.gesamt ?? 0} Läufen erfolgreich
                    {zaehlung && zaehlung.unvollstaendig > 0 && <> · {zaehlung.unvollstaendig} unvollständig</>}
                    {zaehlung && zaehlung.unbekannt > 0 && <> · {zaehlung.unbekannt} ohne Angabe zur Vollständigkeit</>}
                    {zaehlung && zaehlung.fehler > 0 && <> · {zaehlung.fehler} mit Fehler</>}
                    {" · "}Agenten-Läufe{" "}
                    {laufSumme && laufSumme.art === "geschaetzt" ? (
                      <>
                        geschätzt{" "}
                        <span className="font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-gold)" }}>
                          {usd(laufSumme.usd)}
                        </span>
                        {laufSumme.ohneKosten > 0 && (
                          <>
                            {" "}· {laufSumme.ohneKosten} {laufSumme.ohneKosten === 1 ? "Lauf" : "Läufe"} ohne Kostenangabe, nicht mitgezählt
                          </>
                        )}
                      </>
                    ) : (
                      <span className="font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-gold)" }}>
                        Kosten nicht gemessen
                      </span>
                    )}
                  </p>
                  {planZurAusfuehrung && <PlanungsZeile planung={planZurAusfuehrung.planung} titel="Planung" />}
                  <p className="text-[10px]" style={{ color: "var(--gp-ink-3)" }}>
                    Kosten = Tokens × feste Preistabelle, also Schätzungen. Volle Antworttexte stehen im Message Bus.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Browser-Speicher nicht lesbar (Gegencheck 06.11.2026) bzw. gesperrt (Prüflauf) */}
          {speicherGesperrt && (
            <p className="text-[11px]" style={{ color: "var(--gp-amber)" }} role="status">
              Browser-Speicher gesperrt ({maskiereGeschuetzteNamen(speicherGesperrt)}) — Auftrag und Historie werden in
              diesem Browser nicht gespeichert.
            </p>
          )}
          {auftragFehler && (
            <p className="text-[11px]" style={{ color: "var(--gp-amber)" }} role="status">
              Gespeicherter Auftrag in diesem Browser nicht lesbar ({maskiereGeschuetzteNamen(auftragFehler)}) — nicht
              wiederhergestellt.
            </p>
          )}
          {historieFehler && (
            <div className="card-ghost p-5 space-y-2" role="status">
              <p className="text-xs" style={{ color: "var(--gp-amber)" }}>
                Letzte Ausführungen: gespeicherte Historie in diesem Browser nicht lesbar (
                {maskiereGeschuetzteNamen(historieFehler)}). Neue Ausführungen werden nicht gespeichert, solange sie
                nicht verworfen ist.
              </p>
              <button
                onClick={() => {
                  // Nur nach erfolgreichem Löschen gilt die Historie als verworfen.
                  if (speichere(SPEICHER_HISTORIE, null)) setHistorieFehler(null);
                }}
                className="text-[10px] px-2 py-1 rounded bg-surface-elevated text-text-muted hover:text-foreground transition-colors"
              >
                Gespeicherte Historie verwerfen
              </button>
            </div>
          )}

          {/* Historie */}
          {historie.length > 0 && (
            <div className="card-ghost p-5">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
                  Letzte Ausführungen
                </h2>
                <span className="mono-label ml-auto">nur in diesem Browser gespeichert</span>
              </div>
              <div className="space-y-2">
                {historie.map((h, i) => {
                  const laeufe = historieLaeufe(h);
                  const kosten = historieKosten(h);
                  return (
                  <div key={h.auftrag_id ?? `alt-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-surface-elevated rounded-lg px-3 py-2">
                    <span className="text-text-secondary flex-1 min-w-[12rem] truncate">{maskiereGeschuetzteNamen(h.original_task)}</span>
                    <span className="font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-ink-3)" }} title={laeufe.titel}>
                      {laeufe.text}
                    </span>
                    <span className="font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-ink-3)" }} title={kosten.titel}>
                      {kosten.text}
                    </span>
                    {zeitpunkt(h.ausgefuehrt_am) && (
                      <span className="font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-ink-3)" }}>
                        {zeitpunkt(h.ausgefuehrt_am)}
                      </span>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Rechts: Agent-Team und Ablauf — 1 Spalte */}
        <div className="space-y-6">
          <div className="card-ghost p-5">
            <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight mb-3">
              Agent-Team
            </h2>
            <div className="space-y-2">
              {AGENT_TEAM.map((agent) => (
                <div key={agent.id} className="flex items-start gap-2 text-xs">
                  <span
                    className="font-[family-name:var(--font-jbmono)] font-bold min-w-[84px] text-[11px]"
                    style={{ color: "var(--gp-cyan)" }}
                  >
                    {agent.id.toUpperCase()}
                  </span>
                  <span className="text-text-muted">{agent.skills}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-ghost p-5">
            <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight mb-3">
              So läuft ein Auftrag
            </h2>
            <ol className="space-y-3 text-xs text-text-secondary">
              {[
                "Du beschreibst den Auftrag.",
                `L.I.S.A. erstellt einen Plan mit 1 bis ${MAX_PLAN_SCHRITTE} Agenten; der Server speichert ihn.`,
                "Du prüfst den Plan und führst genau diesen aus. Ein zweites Ausführen ist gesperrt.",
                "Gleiche Priorität läuft parallel; spätere Stufen bekommen die Ergebnisse früherer.",
                "Ergebnisse sind ungeprüft. Veröffentlicht wird nur über die Content-Pipeline mit COUNSEL und deiner Freigabe.",
              ].map((schritt, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-bold" style={{ color: "var(--gp-gold)" }}>{i + 1}.</span>
                  <span>{schritt}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
