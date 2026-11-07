"use client";

// Command Center — Stufe 1 (05.11.2026).
// Vorher: feste Latenz, eine fest eingetragene Agentenzahl im Text, Engines ohne Bezug zu
// Ghost Protocol, eine Statuskarte mit festen Werten und ein Knopf, der ohne angezeigten
// Plan ausführte. Jetzt: Vitals und Panels aus /api/status, /api/freigaben
// und /api/objekte; die Auftragszeile plant erst und führt dann GENAU den gespeicherten
// Plan aus (Vertrag lib/auftrag-types.ts). Was nicht gemessen ist, steht so da.
// Fixrunde 06.11.2026: Status aus dem geteilten Abruf der Shell, Objekte einmal geladen und an
// Lagebild und Steinadel-Panel gereicht (R28). Abgeschnittene Läufe heißen "unvollständig" und
// zählen nicht als erfolgreich (R33). Enter während einer IME-Komposition plant nicht (R37).
// Bei 409 oder unbekanntem Ausgang des Ausführens ein Verweis auf den Message Bus (wie R10
// auf /donna). Nachrichten ausgeblendeter Agenten zählen nicht mit.
// Nachprüfung 06.11.2026: Antwortet /api/objekte mit 401, zeigen Lagebild und Steinadel-Panel
// "nicht angemeldet" wie die TopBar statt eines Export-Ausfalls (objekteLesungAus).
// Gesamtprüfung 06.11.2026: Eine gescheiterte, aber bezahlte Planung (HTTP 502) zeigt ihre
// Kosten ("Kosten des Fehlversuchs") und protokoll_fehler mit dem Hinweis, dass diese Kosten im
// Systemzustand fehlen — wie /donna (lesePlanungsFehlschlag). "Plan nicht gespeichert" steht
// nur einmal da (mitPraefix); auch dann fehlen die Planungskosten im Systemzustand.

import { useState } from "react";
import Link from "next/link";
import { useAgents, useMessages, useObjekte } from "@/lib/hooks";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import {
  PLANUNG_KOSTEN_FEHLEN,
  anzeigeFehler,
  ausgangUnbekannt,
  kostenSumme,
  lesePlanungsFehlschlag,
  laufZustand,
  mitPraefix,
  objekteLesungAus,
  useSystemStatus,
  zaehleLaeufe,
  type LaufZustand,
  type PlanungsFehlschlag,
} from "@/lib/hooks-status";
import {
  TIER_META,
  agentenLeerHinweis,
  agentenZaehlung,
  formatiereUsd,
  formatiereZahl,
  istSichtbarerAgent,
  messfeld,
  messTitel,
  realtimeAnzeige,
} from "@/lib/types";
import type { AgentTier } from "@/lib/types";
import { MAX_PLAN_SCHRITTE } from "@/lib/auftrag-types";
import type {
  AusfuehrenAnfrage,
  AusfuehrungAntwort,
  AusfuehrungsErgebnis,
  PlanAnfrage,
  PlanAntwort,
} from "@/lib/auftrag-types";
import { AgentCard } from "@/components/agents/AgentCard";
import { MessageFeed, istSichtbareNachricht } from "@/components/ui/MessageFeed";
import { Masthead } from "@/components/ui/Masthead";
import { SituationTable } from "@/components/ui/SituationTable";
import { FreigabePanel, SteinadelPanel, SystemzustandPanel } from "@/components/ui/CommandPanels";

// ── Auftragszeile (L.I.S.A.): erst planen, dann genau diesen Plan ausführen ──

type Phase = "bereit" | "plant" | "fuehrt_aus";

interface DelegateAntwort {
  ok: boolean;
  status: number;
  daten: unknown;
}

/** Ausführen ohne Ergebnis, aber auch ohne bekannten Fehler: schon gelaufen (409) oder Ausgang unbekannt. */
interface Ausgang {
  art: "schon_gelaufen" | "unbekannt";
  auftragId: string;
  /** Was die Antwort (oder ihr Fehlen) gesagt hat. */
  text: string;
}

function fehlerAusAntwort(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as { fehler?: unknown; error?: unknown };
  if (typeof o.fehler === "string" && o.fehler.trim()) return o.fehler;
  // Die Middleware (401) und ältere Routen melden "error" statt "fehler".
  if (typeof o.error === "string" && o.error.trim()) return o.error;
  return null;
}

function fehlerText(a: DelegateAntwort): string {
  if (a.status === 401) return "Nicht angemeldet (HTTP 401) — bitte neu anmelden.";
  return `HTTP ${a.status}: ${anzeigeFehler(fehlerAusAntwort(a.daten) ?? "ohne Fehlermeldung in der Antwort")}`;
}

/** Wirft nur ohne HTTP-Antwort (Netzfehler); jede Antwort kommt mit Status zurück. */
async function sendeAuftrag(body: PlanAnfrage | AusfuehrenAnfrage): Promise<DelegateAntwort> {
  const res = await fetch("/api/donna/delegate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const daten: unknown = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, daten };
}

function istPlanAntwort(x: unknown): x is PlanAntwort {
  if (!x || typeof x !== "object") return false;
  const o = x as Partial<PlanAntwort>;
  return (
    o.mode === "plan" &&
    typeof o.auftrag_id === "string" &&
    Array.isArray(o.delegation_plan?.agents) &&
    typeof o.planung === "object" &&
    o.planung !== null
  );
}

function istAusfuehrungAntwort(x: unknown): x is AusfuehrungAntwort {
  if (!x || typeof x !== "object") return false;
  const o = x as Partial<AusfuehrungAntwort>;
  return o.mode === "ausgefuehrt" && Array.isArray(o.results);
}

function kuerze(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)} … (gekürzt)` : text;
}

/** Enter plant nur ohne Umschalt und ohne laufende IME-Komposition (R37). Safari meldet den
 *  bestätigenden keydown nach compositionend mit isComposing false, aber keyCode 229. */
function istPlanEnter(e: React.KeyboardEvent): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229;
}

function zustandAnzeige(r: AusfuehrungsErgebnis, zustand: LaufZustand): { text: string; farbe: string; titel: string } {
  switch (zustand) {
    case "fehler":
      return {
        text: `Fehler: ${anzeigeFehler(String(r.fehler ?? "")) || "ohne Fehlertext"}`,
        farbe: "var(--gp-rose)",
        titel: "Der Lauf ist fehlgeschlagen.",
      };
    case "unvollstaendig":
      return {
        text: "unvollständig",
        farbe: "var(--gp-amber)",
        titel: `Vom Modell abgebrochen (stop_reason ${r.stop_reason ?? "nicht gemeldet"}): Die Antwort ist unvollständig und zählt nicht als erfolgreich.`,
      };
    case "unbekannt":
      return {
        text: "Vollständigkeit unbekannt",
        farbe: "var(--gp-amber)",
        titel: "Die Antwort meldet nicht, ob das Modell vollständig geantwortet hat (kein stop_reason). Zählt nicht als erfolgreich.",
      };
    case "fertig":
      return { text: "erledigt", farbe: "var(--gp-emerald)", titel: "Ohne Fehler und vollständig (stop_reason end_turn oder stop_sequence)." };
  }
}

function ErgebnisZeile({ r }: { r: AusfuehrungsErgebnis }) {
  const zustand = laufZustand(r);
  const anzeige = zustandAnzeige(r, zustand);
  const kosten = typeof r.cost === "number" ? `${formatiereUsd(r.cost, 4)} (geschätzt)` : "Kosten nicht gemessen";
  const text = kuerze(maskiereGeschuetzteNamen(typeof r.response === "string" ? r.response : ""), 800);
  return (
    <details className="bg-surface-elevated rounded-lg">
      <summary className="px-3 py-2 cursor-pointer text-xs flex flex-wrap items-center gap-2">
        <span className="font-[family-name:var(--font-jbmono)] min-w-[20px]" style={{ color: "var(--gp-gold)" }}>
          P{r.priority}
        </span>
        <span className="font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-cyan)" }}>
          {String(r.agent_id ?? "?").toUpperCase()}
        </span>
        <span style={{ color: anzeige.farbe }} title={anzeige.titel}>
          {anzeige.text}
        </span>
        <span className="ml-auto font-[family-name:var(--font-jbmono)] text-[10px]" style={{ color: "var(--gp-ink-3)" }}>
          {kosten}
        </span>
      </summary>
      <div className="px-3 pb-3 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto" style={{ color: "var(--gp-ink-2)" }}>
        {zustand === "fehler" ? "Kein Antworttext — der Lauf ist fehlgeschlagen." : text || "Antwort ohne Text."}
      </div>
    </details>
  );
}

// Gegencheck 06.11.2026 (B24): Nach jedem Ausführen liest das Command Center das Agenten-Register
// neu (onAusgefuehrt) — die Aktivierungen schreiben last_heartbeat, ein Realtime-Ereignis für
// agents ist nicht belegt.
function Auftragszeile({ onAusgefuehrt }: { onAusgefuehrt?: () => void }) {
  const [task, setTask] = useState("");
  const [phase, setPhase] = useState<Phase>("bereit");
  const [plan, setPlan] = useState<PlanAntwort | null>(null);
  const [ergebnis, setErgebnis] = useState<AusfuehrungAntwort | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  // Gescheiterte, aber bezahlte Planung: Kosten und Protokoll des Fehlversuchs (HTTP 502).
  const [fehlversuch, setFehlversuch] = useState<PlanungsFehlschlag | null>(null);
  const [ausgang, setAusgang] = useState<Ausgang | null>(null);

  const beschaeftigt = phase !== "bereit";
  const ausgangZumPlan = plan && ausgang && ausgang.auftragId === plan.auftrag_id ? ausgang : null;
  const schonGelaufen = ausgangZumPlan?.art === "schon_gelaufen";

  // Enter und Knopf erstellen beide NUR einen Plan; ausgeführt wird ausschließlich über
  // den zweiten Knopf mit der auftrag_id des angezeigten Plans.
  async function planErstellen() {
    const text = task.trim();
    if (!text || beschaeftigt) return;
    setPhase("plant");
    setFehler(null);
    setFehlversuch(null);
    setAusgang(null);
    setPlan(null);
    setErgebnis(null);
    try {
      const anfrage: PlanAnfrage = { task: text };
      const antwort = await sendeAuftrag(anfrage);
      if (!antwort.ok) {
        setFehler(fehlerText(antwort));
        const f = lesePlanungsFehlschlag(antwort.daten);
        if (f.planung || f.protokollFehler) setFehlversuch(f);
        return;
      }
      if (!istPlanAntwort(antwort.daten)) throw new Error("Antwort ist kein Plan im erwarteten Format.");
      setPlan(antwort.daten);
    } catch (e) {
      setFehler(e instanceof Error ? anzeigeFehler(e.message) : "unbekannter Fehler");
    } finally {
      setPhase("bereit");
    }
  }

  async function planAusfuehren() {
    if (!plan || plan.protokoll_fehler || ergebnis || beschaeftigt || schonGelaufen) return;
    const auftragId = plan.auftrag_id;
    setPhase("fuehrt_aus");
    setFehler(null);
    setAusgang(null);
    try {
      const anfrage: AusfuehrenAnfrage = { auftrag_id: auftragId, ausfuehren: true };
      const antwort = await sendeAuftrag(anfrage);
      if (antwort.ok && istAusfuehrungAntwort(antwort.daten)) {
        setErgebnis(antwort.daten);
      } else if (antwort.status === 409) {
        setAusgang({ art: "schon_gelaufen", auftragId, text: fehlerText(antwort) });
      } else if (ausgangUnbekannt(antwort, istAusfuehrungAntwort)) {
        setAusgang({
          art: "unbekannt",
          auftragId,
          text: antwort.ok ? "Antwort ohne Ergebnis im erwarteten Format" : fehlerText(antwort),
        });
      } else {
        setFehler(fehlerText(antwort));
      }
    } catch (e) {
      // Keine Antwort: Der Plan kann auf dem Server gelaufen sein oder noch laufen.
      setAusgang({
        art: "unbekannt",
        auftragId,
        text: `Verbindung abgebrochen (${anzeigeFehler(e instanceof Error ? e.message : String(e))})`,
      });
    } finally {
      setPhase("bereit");
      onAusgefuehrt?.();
    }
  }

  const schritte = plan ? [...plan.delegation_plan.agents].sort((a, b) => a.priority - b.priority) : [];
  const ausfuehrenGesperrt =
    !plan || !!plan.protokoll_fehler || !!ergebnis || schonGelaufen || schritte.length === 0 || beschaeftigt;
  const planung = plan?.planung;
  const planKosten =
    planung && typeof planung.kosten_usd_geschaetzt === "number"
      ? `${formatiereUsd(planung.kosten_usd_geschaetzt, 4)} (geschätzt)`
      : "nicht gemessen";
  const planKostenTitel = planung
    ? `Modell: ${planung.modell}\nTokens: ${planung.input_tokens ?? "?"} ein / ${planung.output_tokens ?? "?"} aus\nstop_reason: ${planung.stop_reason ?? "—"}\nSchätzung: Tokens × feste Preistabelle`
    : undefined;
  // Erfolg und Kosten aus den Ergebnissen selbst gezählt (R33, R32): erfolgreich heißt ohne
  // Fehler UND vollständig. Läufe ohne Kostenangabe fehlen in der Summe — das steht dabei;
  // hat kein Lauf eine Kostenangabe, heißt die Summe "nicht gemessen", nicht $0.
  const zaehlung = ergebnis ? zaehleLaeufe(ergebnis.results) : null;
  const summe = ergebnis && zaehlung
    ? kostenSumme(ergebnis.summary?.total_cost_usd_geschaetzt, zaehlung.gesamt, zaehlung.ohneKosten)
    : null;
  const summeText = summe && summe.art === "geschaetzt" ? `${formatiereUsd(summe.usd, 4)} (geschätzt)` : "nicht gemessen";
  const laeufeGesamt = zaehlung?.gesamt ?? 0;
  const laeufeErfolgreich = zaehlung?.fertig ?? 0;
  const ergebnisZusaetze = zaehlung
    ? [
        zaehlung.unvollstaendig > 0 ? `${formatiereZahl(zaehlung.unvollstaendig)} unvollständig` : null,
        zaehlung.unbekannt > 0 ? `${formatiereZahl(zaehlung.unbekannt)} ohne Angabe zur Vollständigkeit` : null,
        zaehlung.fehler > 0 ? `${formatiereZahl(zaehlung.fehler)} mit Fehler` : null,
      ].filter((x): x is string => x !== null)
    : [];
  const unbekannteKosten = zaehlung && summe?.art === "geschaetzt" ? zaehlung.ohneKosten : 0;
  // Nicht im Vertrag, aber von der Route mitgeliefert: Protokollfehler des Laufs (Liste).
  const rohProtokoll = ergebnis ? (ergebnis as { protokoll_fehler?: unknown }).protokoll_fehler : undefined;
  const laufProtokollFehler = Array.isArray(rohProtokoll)
    ? rohProtokoll.filter((p): p is string => typeof p === "string")
    : [];

  return (
    <div className="card-ghost card-active p-5 mb-8">
      <div className="flex items-center gap-3 mb-3">
        <span
          className="font-[family-name:var(--font-cormorant)] italic font-semibold text-xl leading-none"
          style={{ color: "var(--gp-gold)" }}
        >
          L.I.S.A.
        </span>
        <h2 className="text-sm font-medium font-[family-name:var(--font-outfit)] tracking-tight" style={{ color: "var(--gp-ink-2)" }}>
          Auftrag planen
        </h2>
        <span className="mono-label ml-auto">Erst Plan, dann Ausführung</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (istPlanEnter(e)) {
              e.preventDefault();
              void planErstellen();
            }
          }}
          placeholder="Was soll erledigt werden? z. B. „Schreibe ein YouTube-Skript über KI-Agenten“"
          className="flex-1 bg-surface-elevated border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50"
          disabled={beschaeftigt}
        />
        <button
          onClick={() => void planErstellen()}
          disabled={beschaeftigt || !task.trim()}
          className="px-4 py-2.5 bg-accent-violet/20 text-accent-violet text-sm font-medium rounded-lg hover:bg-accent-violet/30 transition-colors disabled:opacity-40"
        >
          {phase === "plant" ? "plant …" : "Plan erstellen"}
        </button>
      </div>

      {fehler && (
        <p className="text-xs mt-2 break-words" style={{ color: "var(--gp-rose)" }}>
          {fehler}
        </p>
      )}
      {fehlversuch && (
        <div className="mt-1 space-y-0.5 text-[11px] break-words" data-fehlversuch="planung">
          {fehlversuch.planung && (
            <p className="font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-ink-3)" }}>
              Kosten des Fehlversuchs:{" "}
              {typeof fehlversuch.planung.kosten_usd_geschaetzt === "number"
                ? `${formatiereUsd(fehlversuch.planung.kosten_usd_geschaetzt, 4)} (geschätzt)`
                : "nicht gemessen"}
              {` · Modell ${fehlversuch.planung.modell} · Tokens ${fehlversuch.planung.input_tokens ?? "nicht gemeldet"} ein / ${
                fehlversuch.planung.output_tokens ?? "nicht gemeldet"
              } aus · stop_reason ${fehlversuch.planung.stop_reason ?? "nicht gemeldet"}`}
            </p>
          )}
          {fehlversuch.protokollFehler && <p style={{ color: "var(--gp-amber)" }}>{fehlversuch.protokollFehler}</p>}
          {fehlversuch.kostenHinweis && <p style={{ color: "var(--gp-amber)" }}>{fehlversuch.kostenHinweis}</p>}
        </div>
      )}

      {plan && (
        <div className="mt-4 space-y-3">
          <div className="bg-surface-elevated rounded-lg p-3">
            <div className="flex flex-wrap items-baseline gap-2 mb-2">
              <span className="mono-label" style={{ color: "var(--gp-gold)" }}>Plan</span>
              <span className="text-[12px]" style={{ color: "var(--gp-ink-2)" }}>
                für „{maskiereGeschuetzteNamen(plan.original_task)}“
              </span>
              <span className="mono-label ml-auto" title={`Auftrag ${plan.auftrag_id}`}>
                {schritte.length} von höchstens {MAX_PLAN_SCHRITTE} Schritten
              </span>
            </div>
            {schritte.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--gp-amber)" }}>Der Plan enthält keine Schritte.</p>
            ) : (
              <div className="space-y-2">
                {schritte.map((a, i) => (
                  <div key={`${a.id}-${i}`} className="flex items-start gap-2 text-xs">
                    <span className="font-[family-name:var(--font-jbmono)] font-bold min-w-[20px]" style={{ color: "var(--gp-gold)" }}>
                      P{a.priority}
                    </span>
                    <span className="font-[family-name:var(--font-jbmono)] min-w-[84px]" style={{ color: "var(--gp-cyan)" }}>
                      {String(a.id).toUpperCase()}
                    </span>
                    <span style={{ color: "var(--gp-ink-2)" }}>{maskiereGeschuetzteNamen(String(a.task ?? ""))}</span>
                  </div>
                ))}
              </div>
            )}
            {plan.delegation_plan.reasoning && (
              <p className="text-xs mt-3 leading-relaxed" style={{ color: "var(--gp-ink-3)" }}>
                Begründung: {maskiereGeschuetzteNamen(plan.delegation_plan.reasoning)}
              </p>
            )}
            <p className="font-[family-name:var(--font-jbmono)] text-[10px] mt-2" style={{ color: "var(--gp-ink-3)" }} title={planKostenTitel}>
              Planungskosten: {planKosten}
              {planung?.modell ? ` · Modell ${planung.modell}` : ""}
            </p>
          </div>

          {plan.protokoll_fehler && (
            <div className="space-y-0.5">
              <p className="text-xs break-words" style={{ color: "var(--gp-rose)" }}>
                {anzeigeFehler(mitPraefix("Plan nicht gespeichert: ", plan.protokoll_fehler))} — Ausführen gesperrt.
              </p>
              <p className="text-[11px]" style={{ color: "var(--gp-amber)" }}>
                {PLANUNG_KOSTEN_FEHLEN}
              </p>
            </div>
          )}

          <button
            onClick={() => void planAusfuehren()}
            disabled={ausfuehrenGesperrt}
            className="w-full px-4 py-2 bg-accent-emerald/20 text-accent-emerald text-sm font-medium rounded-lg hover:bg-accent-emerald/30 transition-colors disabled:opacity-40"
          >
            {phase === "fuehrt_aus"
              ? "Agenten arbeiten …"
              : ergebnis
                ? "Plan ausgeführt"
                : schonGelaufen
                  ? "Bereits ausgeführt"
                  : "Genau diesen Plan ausführen"}
          </button>

          {ausgangZumPlan && (
            <p className="text-xs leading-relaxed break-words" style={{ color: "var(--gp-amber)" }}>
              {ausgangZumPlan.art === "schon_gelaufen"
                ? "Dieser Plan wurde bereits ausgeführt (HTTP 409). Die Ergebnisse stehen im Message Bus"
                : `Ausgang unbekannt — ${ausgangZumPlan.text}. Der Plan kann auf dem Server gelaufen sein oder noch laufen. Ergebnisse im Message Bus prüfen`}
              {" "}(Auftrag{" "}
              <span className="font-[family-name:var(--font-jbmono)]">{ausgangZumPlan.auftragId}</span>):{" "}
              <Link href="/messages" className="underline" style={{ color: "var(--gp-gold-hi)" }}>
                Message Bus öffnen →
              </Link>
              {ausgangZumPlan.art === "unbekannt" ? " Ein zweites Ausführen desselben Plans lehnt der Server ab (409)." : ""}
            </p>
          )}

          {ergebnis && (
            <div className="space-y-2">
              <p className="mono-label">Ergebnisse</p>
              {ergebnis.results.map((r, i) => (
                <ErgebnisZeile key={`${r.agent_id}-${i}`} r={r} />
              ))}
              <p className="font-[family-name:var(--font-jbmono)] text-[10px] text-right" style={{ color: "var(--gp-ink-3)" }}>
                {formatiereZahl(laeufeErfolgreich)} von {formatiereZahl(laeufeGesamt)}{" "}
                {laeufeGesamt === 1 ? "Lauf" : "Läufen"} erfolgreich
                {ergebnisZusaetze.length > 0 ? ` (${ergebnisZusaetze.join(", ")})` : ""} · Summe {summeText}
                {unbekannteKosten > 0
                  ? ` · ohne ${unbekannteKosten === 1 ? "1 Lauf" : `${formatiereZahl(unbekannteKosten)} Läufe`} mit unbekannten Kosten`
                  : ""}
              </p>
              {laufProtokollFehler.length > 0 && (
                <p className="text-xs leading-relaxed break-words" style={{ color: "var(--gp-rose)" }}>
                  Protokoll unvollständig: {anzeigeFehler(laufProtokollFehler.join(" · "))}
                </p>
              )}
              <p className="text-xs leading-relaxed" style={{ color: "var(--gp-amber)" }}>
                {ergebnis.hinweis || "Hinweis fehlt in der Antwort."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Seite ──

export default function CommandCenter() {
  const { agents, ausgeblendet, loading: agentsLoading, error: agentsError, refetch: agentenNeuLesen } = useAgents();
  const { messages, loading: messagesLoading, error: messagesError, realtime, realtimeFehler } = useMessages(30);
  // Der Abruf der Shell (SystemStatusProvider): Masthead, Panels und TopBar zeigen dieselbe
  // Messung, ohne zweiten Poller (R28).
  const sys = useSystemStatus();
  // /api/objekte einmal je Seitenaufruf; Lagebild und Steinadel-Panel bekommen denselben
  // Zustand, statt je selbst abzurufen (R28). Fehlertexte bereinigt (kein technischer Bezeichner),
  // ein 401 als "nicht angemeldet" gekennzeichnet (nicht als Ausfall des Exports).
  const objekte = objekteLesungAus(useObjekte());

  // Bei Abruffehler zählen alte Daten nicht als aktuell.
  const aktuell = sys.fehler ? null : sys.status;
  const ersterAbruf = sys.loading && !sys.status && !sys.fehler;
  const ohneMessung = ersterAbruf ? "…" : "nicht gemessen";
  const statusTitel = sys.fehler ? `Systemzustand nicht lesbar: ${sys.fehler}` : "Systemzustand wird geladen";

  const sichtbareAgenten = agents.filter(istSichtbarerAgent);

  // Vitals: jede Zahl aus /api/status mit Quelle im Tooltip.
  const agentenMw = aktuell ? messfeld(aktuell.agenten, "agenten") : null;
  let agentenWert: string;
  let agentenTitel: string;
  if (agentenMw?.wert) {
    // /api/status zählt alle Zeilen, auch ausgeblendete, und listet diese getrennt. Der Chip
    // zeigt die angezeigten Agenten (Zeilen minus ausgeblendete) — dieselbe Größe wie die
    // Ersatzquelle unten und wie die Agentflotte darunter.
    const ausgeblendet = Array.isArray(agentenMw.wert.ausgeblendet) ? agentenMw.wert.ausgeblendet : [];
    const angezeigt = Math.max(agentenMw.wert.anzahl - ausgeblendet.length, 0);
    agentenWert = formatiereZahl(angezeigt);
    agentenTitel = messTitel(
      agentenMw,
      `Zeilen in agents: ${formatiereZahl(agentenMw.wert.anzahl)}` +
        (ausgeblendet.length ? `, davon ausgeblendet: ${ausgeblendet.join(", ")}` : "")
    );
  } else if (ersterAbruf) {
    agentenWert = "…";
    agentenTitel = statusTitel;
  } else if (!agentsLoading && !agentsError && sichtbareAgenten.length > 0) {
    agentenWert = formatiereZahl(sichtbareAgenten.length);
    agentenTitel = "Ersatzquelle: Supabase-Tabelle agents, im Browser gelesen, ohne ausgeblendete Agenten";
  } else if (!agentsLoading && !agentsError) {
    // Gegencheck 06.11.2026: Eine leere Browser-Abfrage ist keine Zählung (gesperrter Lesezugriff
    // liefert ebenfalls keine Zeile) — vorher stand hier "0". Prüflauf: Ist der Systemzustand
    // gelesen, nennt der Titel dessen Messung samt Grund (etwa "nicht abgefragt") statt "wird geladen".
    agentenWert = ohneMessung;
    agentenTitel = agentenMw
      ? messTitel(agentenMw, "Die Abfrage im Browser lieferte keine Agenten")
      : `Die Abfrage im Browser lieferte keine Agenten; ${statusTitel}`;
  } else {
    agentenWert = agentsLoading ? "…" : "nicht gemessen";
    agentenTitel = agentsError
      ? `Agenten-Register nicht lesbar: ${agentsError}`
      : agentenMw
        ? messTitel(agentenMw)
        : statusTitel;
  }

  const bus = aktuell ? messfeld(aktuell.bus, "bus") : null;
  const supabase = aktuell ? messfeld(aktuell.supabase, "supabase") : null;
  const aktiv24 = aktuell ? messfeld(aktuell.aktive_agenten_24h, "aktive_agenten_24h") : null;

  const vitals = [
    { label: "Agenten", value: agentenWert, title: agentenTitel },
    {
      label: "Bus",
      value: bus?.wert ? formatiereZahl(bus.wert.anzahl) : ohneMessung,
      title: bus ? messTitel(bus, "Gesamtzahl der Nachrichten") : statusTitel,
    },
    {
      label: "Latenz",
      // Gegencheck 06.11.2026: gemessener Ausfall "Fehler", sonst "nicht gemessen" — nie "—".
      value:
        supabase?.status === "ok" && supabase.wert
          ? `${formatiereZahl(supabase.wert.latenz_ms)} ms`
          : supabase?.status === "fehler"
            ? "Fehler"
            : ohneMessung,
      title: supabase ? messTitel(supabase, "Probe-Abfrage Supabase") : statusTitel,
    },
    {
      label: "Aktiv 24 h",
      value: aktiv24?.wert ? formatiereZahl(aktiv24.wert.anzahl) : ohneMessung,
      title: aktiv24 ? messTitel(aktiv24) : statusTitel,
    },
  ];

  const tierCounts = sichtbareAgenten.reduce(
    (acc, a) => {
      acc[a.tier] = (acc[a.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  // Nachprüfung im Browser 06.11.2026: useMessages meldet Lesefehler (seit R12); der Feed zeigt
  // dann "nicht lesbar" statt "Noch keine Nachrichten im Bus" und der Kopf keine "Neueste 0".
  // Gegencheck 06.11.2026: Eine leere Liste ohne Fehler sagt nur, was die Abfrage lieferte
  // (leereAbfrageHinweis im Feed, mit der Server-Zählung als Gegenprobe) — der eigene Hinweis
  // "Lesen im Browser fehlgeschlagen" ist entfallen; er nannte einen nicht gemeldeten Fehlschlag.
  // Der Realtime-Zustand steht im Kopf: Ohne verbundenen Kanal ist die Liste der Stand beim Laden.
  const busGesamt = bus?.wert?.anzahl ?? null;
  const realtimeText = realtimeAnzeige(realtime).text;
  // Gegenprobe für eine leere Agentenliste wie auf /agents: Zeilen in agents laut /api/status.
  const agentenServer = agentenZaehlung(sys.status, sys.fehler);
  const agentenLeer = agentenLeerHinweis(ausgeblendet, agentenServer.anzahl);
  // Dieselbe Regel wie im Feed: Nachrichten ausgeblendeter Agenten zählen nicht mit.
  const sichtbareNachrichten = messages.filter(istSichtbareNachricht).length;
  const ausgeblendeteNachrichten = messages.length - sichtbareNachrichten;

  return (
    <div className="boot p-4 sm:p-6 lg:p-10 max-w-[1240px]">
      {/* §9.5 Masthead — ohne Koordinate (keine belegte Ortsangabe) */}
      <Masthead
        index="01 / LAGE"
        kicker="Ghost Protocol · Autonome KI-Corporation"
        word={["Maschinen", "raum", ""]}
        sub="Command Center — Lagebild über Objekte, Freigaben und Agenten. Was nicht gemessen ist, steht als „nicht gemessen“ da."
        vitals={vitals}
      />

      {/* §9.4 Signatur-Held: COP-Hologramm */}
      <div className="mb-8">
        <SituationTable lesung={objekte} />
      </div>

      {/* Panel-Reihe: Freigaben · Systemzustand · Steinadel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <FreigabePanel />
        <SystemzustandPanel lesung={sys} />
        <SteinadelPanel lesung={sys} objekte={objekte} />
      </div>

      {/* L.I.S.A. — Auftrag planen, dann genau diesen Plan ausführen */}
      <Auftragszeile onAusgefuehrt={() => void agentenNeuLesen()} />

      {/* Main Grid: Agents + Messages */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent Grid — 2 columns */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--font-cormorant)] font-semibold text-[26px] tracking-tight">
              Agent<em style={{ fontStyle: "italic", color: "var(--gp-gold)" }}>flotte</em>
            </h2>
            {/* Tier-Zähler erst nach dem Laden und nur mit gelesenen Agenten — sonst wäre jede 0
                ein Platzhalter (Gegencheck 06.11.2026: vorher "T0: 0 … T3: 0" bei leerer Abfrage) */}
            {!agentsLoading && !agentsError && sichtbareAgenten.length > 0 && (
              <div className="flex items-center gap-3">
                {([0, 1, 2, 3] as AgentTier[]).map((tier) => (
                  <span
                    key={tier}
                    className="text-[10px] flex items-center gap-1.5"
                    style={{ color: TIER_META[tier].color }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: TIER_META[tier].color }}
                    />
                    T{tier}: {tierCounts[tier] ?? 0}
                  </span>
                ))}
              </div>
            )}
          </div>

          {agentsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card-ghost p-4 h-36 animate-pulse">
                  <div className="h-3 bg-surface-elevated rounded w-1/3 mb-3" />
                  <div className="h-2 bg-surface-elevated rounded w-2/3 mb-2" />
                  <div className="h-2 bg-surface-elevated rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : agentsError ? (
            <div className="card-ghost p-5">
              <p className="text-sm break-words" style={{ color: "var(--gp-rose)" }}>
                Agenten-Register nicht lesbar: {agentsError}
              </p>
            </div>
          ) : sichtbareAgenten.length === 0 ? (
            // Gegencheck 06.11.2026: wie /agents — was die Abfrage lieferte, nie was in der Tabelle
            // steht (vorher "Register leer — in Supabase sind keine Agenten eingetragen.").
            <div className="card-ghost p-5" title={ausgeblendet > 0 ? undefined : agentenServer.titel}>
              <p className="text-sm" style={{ color: agentenLeer.widerspruch ? "var(--gp-amber)" : "var(--gp-ink-2)" }}>
                {agentenLeer.text}
              </p>
              {agentenLeer.zusatz && (
                <p className="text-xs mt-2" style={{ color: "var(--gp-ink-3)" }}>
                  {agentenLeer.zusatz}
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sichtbareAgenten.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>

        {/* Message Feed — 1 column */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--font-cormorant)] font-semibold text-[26px] tracking-tight">
              Message <em style={{ fontStyle: "italic", color: "var(--gp-gold)" }}>Bus</em>
            </h2>
            {/* Statt "Live": was die Liste wirklich zeigt (die neuesten bis zu 30 Zeilen) */}
            {!messagesLoading && messagesError && (
              <span
                className="mono-label"
                style={{ color: "var(--gp-rose)" }}
                title={`Supabase-Tabelle messages, im Browser nicht lesbar: ${maskiereGeschuetzteNamen(messagesError)}`}
              >
                nicht lesbar
              </span>
            )}
            {!messagesLoading && !messagesError && (
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                <span
                  className="mono-label"
                  title={`Supabase-Tabelle messages, im Browser gelesen (die neuesten ${formatiereZahl(messages.length)}); Gesamtzahl aus /api/status${
                    ausgeblendeteNachrichten > 0
                      ? `; ${formatiereZahl(ausgeblendeteNachrichten)} von ausgeblendeten Agenten nicht gezeigt`
                      : ""
                  }`}
                >
                  Neueste {formatiereZahl(sichtbareNachrichten)}
                  {typeof busGesamt === "number" ? ` von ${formatiereZahl(busGesamt)}` : ""}
                </span>
                {realtime !== "SUBSCRIBED" && (
                  <span
                    className="mono-label"
                    style={{ color: "var(--gp-amber)" }}
                    title={`${realtimeText}${realtimeFehler ? ` (${maskiereGeschuetzteNamen(realtimeFehler)})` : ""} — die Liste ist der Stand beim Laden; neue Nachrichten erscheinen erst nach Neuladen.`}
                  >
                    Stand beim Laden
                  </span>
                )}
              </div>
            )}
          </div>

          {messagesLoading ? (
            <div className="card-ghost p-4 h-64 animate-pulse">
              <div className="h-2 bg-surface-elevated rounded w-3/4 mb-3" />
              <div className="h-2 bg-surface-elevated rounded w-1/2 mb-3" />
              <div className="h-2 bg-surface-elevated rounded w-2/3" />
            </div>
          ) : (
            <MessageFeed
              messages={messages}
              fehler={messagesError}
              serverAnzahl={busGesamt}
              realtime={realtime}
              bezugIso={aktuell?.erzeugt_am ?? null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
