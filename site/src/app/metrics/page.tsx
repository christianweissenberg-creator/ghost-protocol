"use client";

// Kennzahlen — Stufe 1 (06.11.2026, Befunde R3, R11, R13, R14, R15).
// Jede Zahl mit Quelle: Agenten und Modelle aus dem Register (agents, ohne ausgeblendete),
// Listenpreise aus lib/kosten.ts (Schätzbasis, keine Abrechnung), Monatskosten aus
// /api/status (Schätzung, nur Claude-Läufe über das Dashboard), Metrik-Zeilen aus der Tabelle
// metrics (die neuesten 200). Das Budget ist ein Plan, keine Messung. Unbekanntes heißt
// "nicht gemessen" oder "nicht lesbar", nie 0. lib/agent-prompts.ts wird hier NICHT
// importiert (System-Prompts gehören nicht in den Browser).
// Nachbesserung 06.11.2026: Icons nur über eigene Schlüssel (ein metric_type "__proto__" ließ
// die Seite abstürzen). Eine leere Abfrage ist eine Aussage über den Browser-Lesezugriff, nicht
// über die Tabelle: Für metrics gibt es keine Server-Zählung als Gegenprobe.
// Tor-Prüfung 07.11.2026 (F2): Modellklassen, Modellliste und Preisbasis zählen das Modell, das
// das Dashboard aufruft (lib/agent-modelle.ts — nur die Zuordnung, keine Prompts), nicht mehr
// agents.llm_model. Das Register lieferte "Sonnet 10 · Haiku 6" (Seed bzw. Python-Pfad); laut
// Dashboard-Konfiguration sind es 7 Sonnet, 8 Haiku und SENTINEL ohne Prompt. Abweichungen des
// Registers stehen sichtbar da. Nachprüfung 07.11.2026 (ehrlichkeit-1): Der Satz dazu nennt seinen
// Umfang ("Aufrufe über das Dashboard") — der Python-Pfad (execution/agent_runner.py) ruft für
// AMPLIFIER, MERCHANT, SCRIBE und COUNSEL ein anderes Modell auf.

import { useMetrics } from "@/lib/hooks-metrics";
import { useAgents, useJetztIso } from "@/lib/hooks";
import { useSystemStatus } from "@/lib/hooks-status";
import { KPICard } from "@/components/ui/KPICard";
import { AttributionPanel } from "@/components/ui/AttributionPanel";
import { PREIS_QUELLE, preisJeMillion } from "@/lib/kosten";
import { dashboardModellFuer } from "@/lib/agent-modelle";
import {
  DASHBOARD_MODELL_QUELLE,
  agentenLeerHinweis,
  agentenZaehlung,
  aktivierungsAnzeige,
  datumZeit,
  eigenerEintrag,
  formatiereMetrikWert,
  formatierePreis,
  formatiereZahl,
  kostenMonatAnzeige,
  metrikEinheit,
  modellAnzeige,
  modellKlasse,
  modellKlassenText,
  modellUebersicht,
  tierMetaFuer,
} from "@/lib/types";
import type { ModellGruppe } from "@/lib/types";

const METRIC_ICONS: Record<string, string> = {
  api_cost: "💰",
  tokens_used: "🔤",
  tasks_completed: "✓",
  response_time: "⏱",
  error_count: "⚠",
};

const KLASSEN_FARBE: Record<ModellGruppe, { text: string; flaeche: string }> = {
  Sonnet: { text: "#8b5cf6", flaeche: "rgba(139, 92, 246, 0.3)" },
  Haiku: { text: "#06b6d4", flaeche: "rgba(6, 182, 212, 0.3)" },
  andere: { text: "#8a8994", flaeche: "rgba(138, 137, 148, 0.25)" },
  "ohne Prompt": { text: "#f59e0b", flaeche: "rgba(245, 158, 11, 0.18)" },
};

// Plan aus dem Projekt-Handbuch (CLAUDE.md, Abschnitt „Budget“), keine Messung.
const BUDGET_PLAN = {
  wert: "~€55",
  aufteilung: "VPS €6 · Claude-API ~€40 · Serper €5 · Domain €2",
  quelle: "Quelle: Budgetplan in CLAUDE.md (Abschnitt „Budget“). Plan, keine Messung.",
};

const PREIS_TITEL = `Listenpreis laut Tabelle (Schätzbasis) aus lib/kosten.ts.\n${PREIS_QUELLE}.\nModell laut ${DASHBOARD_MODELL_QUELLE}: mit ihm rufen activate und delegate auf und schätzen die Kosten. Maßgeblich bleibt die Anthropic-Rechnung.`;

export default function MetricsPage() {
  const {
    metrics,
    aggregated,
    loading: metricsLoading,
    error: metricsError,
    grenze,
    abgeschnitten: metrikenAbgeschnitten,
  } = useMetrics();
  // Nur sichtbare Agenten (Filter in useAgents, Befund R13).
  const { agents, ausgeblendet: agentsAusgeblendet, loading: agentsLoading, error: agentsError } = useAgents();
  const sys = useSystemStatus();
  const jetzt = useJetztIso();
  // Leere Agentenliste: Aussage über die Abfrage im Browser, Gegenprobe über /api/status.
  const agentenServer = agentenZaehlung(sys.status, sys.fehler);
  const registerLeer = agentenLeerHinweis(agentsAusgeblendet, agentenServer.anzahl);
  const registerLeerText = [registerLeer.text, registerLeer.zusatz].filter(Boolean).join(" ");
  const registerLeerStil = registerLeer.widerspruch ? { color: "var(--gp-amber)" } : undefined;

  // Modelle nach Dashboard-Konfiguration, einheitlich für Zählung, Verteilung und Tabelle;
  // Abweichungen des Registers und Agenten ohne Prompt getrennt (modellUebersicht).
  const uebersicht = modellUebersicht(agents, dashboardModellFuer);

  const kosten = kostenMonatAnzeige(sys.status, sys.fehler, sys.loading, sys.httpStatus);

  const agentenWert = agentsLoading ? "…" : agentsError ? "nicht lesbar" : formatiereZahl(agents.length);
  const agentenUnterzeile = agentsLoading
    ? "Register wird gelesen"
    : agentsError
      ? "Agenten-Register nicht lesbar"
      : modellKlassenText(uebersicht);

  const metrikWert = metricsLoading ? "…" : metricsError ? "nicht lesbar" : formatiereZahl(metrics.length);
  const metrikUnterzeile = metricsLoading
    ? "Tabelle metrics wird gelesen"
    : metricsError
      ? "Tabelle metrics nicht lesbar"
      : `in den neuesten ${grenze} Zeilen, im Browser gelesen · ${Object.keys(aggregated).length} Typen${metrikenAbgeschnitten ? " · Abfragegrenze erreicht" : ""}`;

  return (
    <div className="boot p-4 sm:p-6 lg:p-10 max-w-[1200px]">
      <div className="gp-masthead">
        <div className="gp-index-row"><span className="gp-index">04 / KENNZAHLEN</span><span className="gp-index-rule" /></div>
        <p className="gp-kicker">Budget-Plan, geschätzte Kosten, Modelle, Metrik-Zeilen</p>
        <h1 className="gp-wordmark">Met<em>rics</em></h1>
      </div>

      {/* Budget (Plan) neben den geschätzten Kosten, Register und Metrik-Zeilen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div title={BUDGET_PLAN.quelle}>
          <KPICard
            label="Monatsbudget (Plan)"
            value={BUDGET_PLAN.wert}
            subtitle={`Plan, nicht gemessen · ${BUDGET_PLAN.aufteilung}`}
            color="#f59e0b"
            icon="💰"
          />
        </div>
        <div title={kosten.titel}>
          <KPICard
            label="Claude-Kosten Monat (geschätzt)"
            value={kosten.wert}
            subtitle={kosten.unterzeile}
            color="#f59e0b"
          />
        </div>
        <div title={`Anzahl: Supabase-Tabelle agents, im Browser gelesen, ohne ausgeblendete Agenten. Klassen: Modell laut ${DASHBOARD_MODELL_QUELLE}, nicht agents.llm_model (Register).`}>
          <KPICard
            label="Agenten (Register, gelesen)"
            value={agentenWert}
            subtitle={agentenUnterzeile}
            color="#8b5cf6"
          />
        </div>
        <div title={metricsError ? `Tabelle metrics nicht lesbar: ${metricsError}` : `Quelle: Supabase-Tabelle metrics, im Browser gelesen (Anon-Key), die neuesten ${grenze} Zeilen über alle Typen. Keine Server-Zählung als Gegenprobe.`}>
          <KPICard
            label="Metrik-Zeilen (gelesen)"
            value={metrikWert}
            subtitle={metrikUnterzeile}
            color="#22c55e"
            icon="◇"
          />
        </div>
      </div>

      {/* Modelle laut Dashboard-Konfiguration; Register nur als Abweichung */}
      <div className="card-ghost p-5 mb-6">
        <h2
          className="text-sm font-semibold font-[family-name:var(--font-outfit)] mb-4 uppercase tracking-wider text-text-muted"
          title={`Quelle: ${DASHBOARD_MODELL_QUELLE} — das Modell, das das Dashboard aufruft`}
        >
          Modelle laut Dashboard-Konfiguration
        </h2>
        {agentsLoading ? (
          <div className="h-8 rounded-lg animate-pulse bg-surface-elevated" />
        ) : agentsError ? (
          <p className="text-xs break-words" style={{ color: "var(--gp-rose)" }}>
            Agenten-Register nicht lesbar: {agentsError}
          </p>
        ) : agents.length === 0 ? (
          <p className="text-xs text-text-muted" style={registerLeerStil} title={agentenServer.titel}>
            {registerLeerText}
          </p>
        ) : (
          <>
            <div className="flex gap-2 h-8 rounded-lg overflow-hidden">
              {uebersicht.klassen
                .filter((k) => k.anzahl > 0)
                .map((k) => (
                  <div
                    key={k.klasse}
                    className="flex items-center justify-center text-[10px] font-bold transition-all"
                    style={{
                      width: `${(k.anzahl / agents.length) * 100}%`,
                      background: KLASSEN_FARBE[k.klasse].flaeche,
                      color: KLASSEN_FARBE[k.klasse].text,
                    }}
                  >
                    {k.klasse} ({k.anzahl})
                  </div>
                ))}
            </div>
            <ul className="mt-4 space-y-1" title={PREIS_TITEL}>
              {uebersicht.modelle.map(({ modell, anzahl }) => (
                <li key={modell} className="text-[11px] text-text-secondary flex flex-wrap gap-x-2">
                  <span className="font-mono">{modell}</span>
                  <span className="text-text-muted">{anzahl} {anzahl === 1 ? "Agent" : "Agenten"}</span>
                  <span className="text-text-muted">· Listenpreis laut Tabelle (Schätzbasis): {formatierePreis(preisJeMillion(modell))}</span>
                </li>
              ))}
              {uebersicht.ohnePrompt.length > 0 && (
                <li className="text-[11px] flex flex-wrap gap-x-2" style={{ color: "var(--gp-amber)" }} data-modell="ohne-prompt">
                  <span>kein Dashboard-Prompt: {uebersicht.ohnePrompt.length} {uebersicht.ohnePrompt.length === 1 ? "Agent" : "Agenten"}</span>
                  <span className="text-text-muted">
                    · {uebersicht.ohnePrompt.map((a) => `${a.name} (Register: ${a.register ?? "nicht eingetragen"})`).join(", ")} — über das Dashboard nicht aktivierbar
                  </span>
                </li>
              )}
            </ul>
            {uebersicht.abweichend.length > 0 && (
              <p className="text-[10px] mt-2" style={{ color: "var(--gp-amber)" }} data-modell="abweichung">
                Register (agents.llm_model) weicht bei {uebersicht.abweichend.length}{" "}
                {uebersicht.abweichend.length === 1 ? "Agent" : "Agenten"} ab:{" "}
                {uebersicht.abweichend.map((a) => `${a.name} (Register ${a.register}, Dashboard ${a.dashboard})`).join(", ")} — Seed, Python-Pfad
                oder älterer Lauf; Aufrufe über das Dashboard nutzen das Dashboard-Modell.
              </p>
            )}
            <p className="text-[10px] text-text-muted mt-2">Preisquelle: {PREIS_QUELLE}.</p>
          </>
        )}
      </div>

      {/* Metrik-Typen */}
      {metricsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-ghost p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : metricsError ? (
        <div className="card-ghost p-8 text-center">
          <p className="text-sm break-words" style={{ color: "var(--gp-rose)" }}>
            Metriken nicht lesbar: {metricsError}
          </p>
          <p className="text-text-muted text-xs mt-2">Ohne Lesezugriff ist keine Aussage über die Tabelle metrics möglich.</p>
        </div>
      ) : Object.keys(aggregated).length === 0 ? (
        <div className="card-ghost p-8 text-center">
          <div className="text-4xl mb-3 opacity-20">◇</div>
          <p className="text-text-secondary text-sm">Die Abfrage im Browser lieferte keine Zeilen aus der Tabelle metrics.</p>
          <p className="text-text-muted text-xs mt-2">
            Ohne Gegenprobe (der Server zählt metrics nicht) ist nicht belegt, ob die Tabelle leer ist. Im Code
            schreibt nur /api/agents/activate in diese Tabelle (Typ llm_call, geschätzte Kosten je Lauf).
          </p>
        </div>
      ) : (
        <>
          <p className="text-[10px] text-text-muted mb-2">
            Alle Zahlen in den neuesten {grenze} Zeilen der Tabelle metrics
            {metrikenAbgeschnitten ? " — Abfragegrenze erreicht, ältere Zeilen fehlen" : ""}.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(aggregated).map(([type, data]) => {
              const einheit = metrikEinheit(type);
              return (
                <div key={type} className="card-ghost p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span>{eigenerEintrag(METRIC_ICONS, type) ?? "◇"}</span>
                    <span className="text-xs text-text-muted uppercase tracking-wider">
                      {type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div
                    className="text-xl font-bold font-[family-name:var(--font-outfit)] text-foreground"
                    title={data.latestAm ? `Jüngste Zeile: ${datumZeit(data.latestAm) ?? data.latestAm}` : undefined}
                  >
                    {data.latest === null ? "nicht lesbar" : formatiereMetrikWert(type, data.latest)}
                    {einheit && <span className="text-[10px] font-normal text-text-muted ml-1.5">{einheit}</span>}
                  </div>
                  <div className="text-[10px] text-text-muted mt-1">
                    jüngster Wert{data.latestAm ? ` · ${datumZeit(data.latestAm) ?? "Zeit unlesbar"}` : ""}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {data.count} {data.count === 1 ? "Zeile" : "Zeilen"} · Summe {formatiereMetrikWert(type, data.sum)}
                    {einheit ? ` ${einheit}` : ""} · in den neuesten {grenze} Zeilen
                  </div>
                  {data.unlesbar > 0 && (
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--gp-amber)" }}>
                      {data.unlesbar} {data.unlesbar === 1 ? "Zeile" : "Zeilen"} mit unlesbarem Wert, nicht mitgezählt
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modell und Listenpreis je Agent */}
      <div className="card-ghost p-5 mt-6">
        <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] mb-1 uppercase tracking-wider text-text-muted">
          Modell und Listenpreis je Agent
        </h2>
        <p className="text-[10px] text-text-muted mb-4">
          Listenpreis laut Tabelle (Schätzbasis), keine Abrechnung · {PREIS_QUELLE}
        </p>
        {agentsLoading ? (
          <div className="h-24 rounded-lg animate-pulse bg-surface-elevated" />
        ) : agentsError ? (
          <p className="text-xs break-words" style={{ color: "var(--gp-rose)" }}>
            Agenten-Register nicht lesbar: {agentsError}
          </p>
        ) : agents.length === 0 ? (
          <p className="text-xs text-text-muted" style={registerLeerStil} title={agentenServer.titel}>
            {registerLeerText}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="text-left py-2 font-medium">Agent</th>
                  <th className="text-left py-2 font-medium">Tier</th>
                  <th className="text-left py-2 font-medium" title={`Quelle: ${DASHBOARD_MODELL_QUELLE}`}>
                    Modell (Dashboard)
                  </th>
                  <th className="text-right py-2 font-medium" title={PREIS_TITEL}>
                    Listenpreis laut Tabelle (Schätzbasis)
                  </th>
                  <th className="text-left py-2 pl-3 font-medium" title="agents.llm_model: Seed, Python-Pfad oder letzter Dashboard-Lauf">
                    Register
                  </th>
                  <th className="text-right py-2 font-medium">Letzte Aktivierung</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const dashboard = dashboardModellFuer(agent.id);
                  const modell = modellAnzeige(dashboard, agent.llm_model);
                  const klasse: ModellGruppe = dashboard === null ? "ohne Prompt" : modellKlasse(dashboard);
                  const preis = dashboard === null ? null : preisJeMillion(dashboard);
                  const aktivierung = aktivierungsAnzeige(agent.last_heartbeat, jetzt, agent.status);
                  return (
                    <tr key={agent.id} className="border-b border-border-subtle hover:bg-surface-elevated/30">
                      <td className="py-2 font-semibold text-foreground">{agent.name}</td>
                      <td className="py-2 text-text-muted">
                        Tier {String(agent.tier ?? "?")} — {tierMetaFuer(agent.tier).label}
                      </td>
                      <td className="py-2" title={modell.titel}>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-mono mr-2"
                          style={{
                            background: KLASSEN_FARBE[klasse].flaeche,
                            color: KLASSEN_FARBE[klasse].text,
                          }}
                        >
                          {klasse}
                        </span>
                        <span className="font-mono text-text-muted">{dashboard ?? "kein Dashboard-Prompt"}</span>
                      </td>
                      <td className="py-2 text-right font-mono text-text-secondary" title={PREIS_TITEL}>
                        {dashboard === null ? "kein Dashboard-Aufruf" : formatierePreis(preis)}
                      </td>
                      <td
                        className="py-2 pl-3 font-mono"
                        style={{ color: modell.abweichung ? "var(--gp-amber)" : "var(--gp-ink-3)" }}
                        title={modell.titel}
                      >
                        {typeof agent.llm_model === "string" && agent.llm_model.trim() ? agent.llm_model : "nicht eingetragen"}
                        {modell.abweichung ? " — weicht ab" : ""}
                      </td>
                      <td className="py-2 text-right text-text-muted" title={aktivierung.titel}>
                        {aktivierung.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Steinadel-Kampagnen-Attribution (Rückkanal, reine Aggregate) */}
      <AttributionPanel />
    </div>
  );
}
