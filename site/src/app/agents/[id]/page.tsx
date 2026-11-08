"use client";

// Agent-Detail — Stufe 1 (06.11.2026, Befunde R3, R9, R13, R15, R22).
// Angezeigt wird die letzte Aktivierung (agents.last_heartbeat, schreibt nur
// /api/agents/activate), nicht der gespeicherte Registerstatus. Ein Lesefehler heißt
// "nicht lesbar", ein fehlender Agent "nicht gefunden". Die Aktivierung meldet nur dann
// grün, wenn die Antwort vollständig und sauber protokolliert ist. Kosten sind Schätzungen
// und zählen nur Aktivierungen über das Dashboard.
// Nachbesserung 06.11.2026: Die Verbrauchssummen sind Untergrenzen ("≥"). activate schreibt sie
// nur nach einer Antwort mit Text fort; Fehlläufe (HTTP 502, bezahlt) und Läufe, deren
// bedingtes Update scheitert, fehlen darin. /api/status summiert Fehlläufe dagegen mit.
// Gesamtprüfung 06.11.2026: Die Untergrenze wird abgerundet (formatiereUsdUntergrenze), nie
// "≥ < $0,0001". Der Kostentitel nennt die alte Preistabelle, mit der Beträge vor dem
// 06.11.2026 geschätzt wurden. Nachrichten ausgeblendeter Agenten (istSichtbareNachricht, wie
// Command Center und /messages) werden weder gezeigt noch gezählt; ihre Zahl steht dabei.
// Leertexte sagen, was die Abfrage im Browser lieferte, nicht, was in der Tabelle steht. Eine
// Fehlerantwort der Aktivierung zeigt Kosten und Protokollfehler (werteAktivierungAus).
// Tor-Prüfung 07.11.2026: Modell des Dashboard-Aufrufs aus lib/agent-modelle.ts neben dem Register,
// eine Abweichung sichtbar (F2). Kosten aus den Tokens × aktuelle Preistabelle statt der
// gespeicherten Summe: Juli-Läufe waren mit der alten Tabelle (Sonnet 3/15) geschätzt, und die
// Spalte rundet je Lauf auf 4 Stellen (F3, F4; kostenUntergrenzeAnzeige in lib/types.ts).
// "Modell letzter Lauf" zählt auch Planungen und Fehlläufe, mit Art (F7, letzterLaufAnzeige).
// Nachprüfung 07.11.2026 (ehrlichkeit-2): Die Kosten nehmen je geladenem Lauf dessen Modell; "≥"
// nur, wenn die geladenen Läufe die Token-Summen genau ergeben, sonst "≈" mit Begründung.

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { DETAIL_NACHRICHTEN_GRENZE, anzeigeFehler, istGueltigeAgentId, useAgentDetail, useJetztIso } from "@/lib/hooks";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import { PREIS_QUELLE, PREIS_STAND_AB, preisJeMillion } from "@/lib/kosten";
// Nur die Zuordnung Agent → Modell, keine System-Prompts (lib/agent-prompts.ts nie im Browser).
import { dashboardModellFuer } from "@/lib/agent-modelle";
import {
  aktivierungsAnzeige,
  datumZeit,
  formatiereZahl,
  istSichtbareNachricht,
  istSichtbarerAgent,
  kostenUntergrenzeAnzeige,
  letzterLaufAnzeige,
  modellAnzeige,
  registerEintragFuer,
  tierMetaFuer,
  werteAktivierungAus,
} from "@/lib/types";
import type { AktivierungsErgebnis, Message } from "@/lib/types";

const ERGEBNIS_FARBE: Record<AktivierungsErgebnis["art"], string> = {
  ok: "text-accent-emerald",
  warnung: "text-accent-amber",
  fehler: "text-accent-rose",
};

/** Token-Summe aus agents als Untergrenze ("≥"): Fehlläufe und nicht fortgeschriebene Läufe
 *  fehlen. 0 oder fehlend ist keine Messung (DB-Default), sondern "nicht gemessen". */
function tokenSummeText(wert: unknown): string {
  if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) return "nicht gemessen";
  return `≥ ${formatiereZahl(wert)}`;
}

const VERBRAUCH_TITEL = [
  "Token-Summen in agents, fortgeschrieben von /api/agents/activate (Tokens laut Claude-Antwort).",
  `Kosten: diese Tokens × Listenpreis laut lib/kosten.ts (${PREIS_QUELLE}), je geladenem Lauf mit seinem Modell (metadata.model), sonst mit dem Dashboard-Modell — auch für Läufe, die vor der Tabelle vom ${PREIS_STAND_AB.split("-").reverse().join(".")} mit der alten geschätzt wurden. „≥“ nur, wenn die geladenen Läufe die Summen genau ergeben, sonst „≈“.`,
  "Untergrenze: Es fehlen Fehlläufe (HTTP 502: bezahlt, aber ohne verwertbare Antwort), Läufe ohne gemeldete Tokens und Läufe, deren Summen nicht fortgeschrieben wurden (gleichzeitige Änderung oder Schreibfehler).",
  "Die Monatskosten aus /api/status summieren die je Lauf gespeicherten Schätzungen und zählen Fehlläufe mit; beide Zahlen können deshalb voneinander abweichen.",
  "Maßgeblich ist die Anthropic-Rechnung.",
].join("\n");

function nachrichtText(msg: Message): string {
  const inhalt = msg.content as unknown;
  if (typeof inhalt === "string") return inhalt;
  const text = (inhalt as Record<string, unknown> | null)?.text;
  if (typeof text === "string") return text;
  try {
    return JSON.stringify(inhalt) ?? "";
  } catch {
    return "unlesbarer Inhalt";
  }
}

function configWert(wert: unknown): string {
  if (wert !== null && typeof wert === "object") {
    try {
      return JSON.stringify(wert);
    } catch {
      return "unlesbar";
    }
  }
  return String(wert);
}

export default function AgentDetailPage() {
  const params = useParams();
  const roheId = params?.id;
  const agentId = typeof roheId === "string" ? roheId : Array.isArray(roheId) ? String(roheId[0] ?? "") : "";

  const { agent, agentFehler, messages, messagesFehler, loading, neuLaden } = useAgentDetail(agentId);
  const jetzt = useJetztIso();
  const [activating, setActivating] = useState(false);
  const [activateResult, setActivateResult] = useState<AktivierungsErgebnis | null>(null);

  async function handleActivate() {
    if (!agent) return;
    setActivating(true);
    setActivateResult(null);

    try {
      const res = await fetch("/api/agents/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id }),
      });
      const data: unknown = await res.json().catch(() => null);
      setActivateResult(werteAktivierungAus(res.ok, res.status, data));
    } catch (err) {
      setActivateResult({ art: "fehler", text: `Fehler: ${anzeigeFehler(err)}`, hinweise: [] });
    } finally {
      setActivating(false);
      // Summen und letzte Aktivierung neu lesen — Realtime allein ist nicht belegt.
      neuLaden();
    }
  }

  const zurueck = (
    <Link href="/agents" className="text-accent-violet text-sm hover:underline mt-2 block">
      Zurück zur Agentflotte
    </Link>
  );

  if (!istGueltigeAgentId(agentId)) {
    return (
      <div className="p-8">
        <div className="card-ghost p-12 text-center">
          <p className="text-text-secondary">Agent nicht gefunden — ungültige Kennung</p>
          {zurueck}
        </div>
      </div>
    );
  }

  if (!istSichtbarerAgent({ id: agentId })) {
    return (
      <div className="p-8">
        <div className="card-ghost p-12 text-center">
          <p className="text-text-secondary">Agent &quot;{agentId}&quot; ist im Dashboard ausgeblendet</p>
          {zurueck}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="card-ghost p-8 h-48 animate-pulse" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8">
        <div className="card-ghost p-12 text-center">
          {agentFehler ? (
            <p className="break-words" style={{ color: "var(--gp-rose)" }}>
              Agent &quot;{agentId}&quot; nicht lesbar: {agentFehler}
            </p>
          ) : (
            <>
              <p className="text-text-secondary">Die Abfrage im Browser lieferte keinen Agenten &quot;{agentId}&quot;.</p>
              <p className="text-text-muted text-xs mt-2">
                Ob er in der Tabelle steht, ist damit nicht belegt — ein gesperrter Lesezugriff liefert ebenfalls keine Zeile.
              </p>
            </>
          )}
          {zurueck}
        </div>
      </div>
    );
  }

  // Nachrichten ausgeblendeter Agenten (z. B. trader → oracle) zeigt und zählt die Seite nicht —
  // dieselbe Regel wie Command Center und /messages (istSichtbareNachricht, lib/types.ts).
  const sichtbareNachrichten = messages.filter(istSichtbareNachricht);
  const ausgeblendeteNachrichten = messages.length - sichtbareNachrichten.length;

  const registry = registerEintragFuer(agent);
  const persona = registry.persona && registry.persona !== agent.role ? registry.persona : null;
  const tierMeta = tierMetaFuer(agent.tier);
  const aktivierung = aktivierungsAnzeige(agent.last_heartbeat, jetzt, agent.status);
  // Modell des Dashboard-Aufrufs (lib/agent-modelle.ts) gegen das Register (agents.llm_model).
  const dashboardModell = dashboardModellFuer(agent.id);
  const modell = modellAnzeige(dashboardModell, agent.llm_model);
  // Modell des letzten Laufs laut Bus-Nachricht (metadata.model): Aktivierung, Planung oder Fehllauf.
  const letzterLauf = letzterLaufAnzeige(messages, agent.id, DETAIL_NACHRICHTEN_GRENZE, messagesFehler);
  // Jeder geladene Lauf rechnet mit seinem Modell; "≥" nur, wenn die Läufe die Summen ergeben.
  const kosten = kostenUntergrenzeAnzeige(agent, dashboardModell, preisJeMillion, PREIS_STAND_AB, {
    liste: messages,
    grenze: DETAIL_NACHRICHTEN_GRENZE,
    fehler: messagesFehler,
  });

  return (
    <div className="p-8 max-w-[1200px]">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link href="/agents" className="text-text-muted text-xs hover:text-accent-violet transition-colors">
          Agentflotte
        </Link>
        <span className="text-text-muted text-xs mx-2">/</span>
        <span className="text-xs text-foreground">{agent.name}</span>
      </div>

      {agentFehler && (
        <div className="card-ghost p-3 mb-4">
          <p className="text-xs break-words" style={{ color: "var(--gp-amber)" }}>
            Neu lesen fehlgeschlagen, angezeigt wird der zuletzt gelesene Stand: {agentFehler}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="card-ghost p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-xl font-bold font-[family-name:var(--font-outfit)]"
              style={{ background: `${registry.tierColor}15`, color: registry.tierColor }}
            >
              {registry.icon}
            </div>
            <div>
              <h1 className="text-2xl font-bold font-[family-name:var(--font-outfit)] tracking-tight">
                {agent.name}
              </h1>
              <p className="text-text-secondary text-sm">{agent.role}</p>
              {persona && <p className="text-text-muted text-xs mt-1 italic">&quot;{persona}&quot;</p>}
            </div>
          </div>

          {/* Letzte Aktivierung statt Registerstatus */}
          <div className="text-right" title={aktivierung.titel}>
            <p className="text-sm text-text-secondary">{aktivierung.text}</p>
            <p className="text-[10px] text-text-muted mt-1">
              Registerstatus, nicht gemessen: {agent.status || "—"}
            </p>
          </div>
        </div>

        {/* Meta Row */}
        <div className="flex flex-wrap gap-4 mt-6 pt-4 border-t border-border-subtle">
          <MetaBlock label="Tier" value={`T${String(agent.tier ?? "?")} — ${tierMeta.label}`} color={tierMeta.color} />
          <MetaBlock
            label="Modell (Dashboard)"
            value={dashboardModell ?? "kein Dashboard-Prompt"}
            title={modell.titel}
            color={modell.ohnePrompt ? "var(--gp-amber)" : undefined}
          />
          <MetaBlock
            label="Modell (Register)"
            value={`${typeof agent.llm_model === "string" && agent.llm_model.trim() ? agent.llm_model : "nicht eingetragen"}${modell.abweichung ? " — weicht ab" : ""}`}
            title={modell.titel}
            color={modell.abweichung ? "var(--gp-amber)" : undefined}
          />
          <MetaBlock label="Modell letzter Lauf" value={letzterLauf.text} title={letzterLauf.titel} />
          <MetaBlock label="Kanäle" value={agent.channels?.join(", ") || "—"} />
          <MetaBlock
            label="Letzte Aktivierung"
            value={datumZeit(agent.last_heartbeat) ?? (agent.last_heartbeat ? "unlesbar" : "nie aktiviert")}
            title={aktivierung.titel}
          />
        </div>
      </div>

      {/* Grid: Stats + Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Token Usage */}
        <div className="card-ghost p-4">
          <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Verbrauch</h3>
          <p className="text-[10px] text-text-muted mb-3" title={VERBRAUCH_TITEL}>
            geschätzt, nur Dashboard-Aktivierungen · Untergrenze: Fehlläufe fehlen
          </p>
          <div className="space-y-3" title={VERBRAUCH_TITEL}>
            <StatRow label="Input-Tokens" value={tokenSummeText(agent.total_input_tokens)} />
            <StatRow label="Output-Tokens" value={tokenSummeText(agent.total_output_tokens)} />
            <div title={kosten.titel}>
              <StatRow label="Kosten (geschätzt)" value={kosten.text} color="#f59e0b" />
              <p className="text-[10px] text-text-muted mt-1 text-right" data-kosten-etikett>
                {kosten.etikett}
              </p>
            </div>
          </div>
        </div>

        {/* Config */}
        <div className="card-ghost p-4">
          <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">Konfiguration</h3>
          {agent.config && Object.keys(agent.config).length > 0 ? (
            <div className="space-y-1">
              {Object.entries(agent.config).map(([key, val]) => (
                <div key={key} className="flex justify-between gap-2 text-xs">
                  <span className="text-text-muted font-mono">{key}</span>
                  <span className="text-text-secondary break-all text-right">{maskiereGeschuetzteNamen(configWert(val))}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-xs">Keine Konfiguration gesetzt</p>
          )}
        </div>

        {/* Actions */}
        <div className="card-ghost p-4">
          <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">Aktionen</h3>
          <button
            onClick={handleActivate}
            disabled={activating}
            className="w-full px-4 py-2 rounded-lg text-xs font-medium bg-accent-violet text-white hover:bg-accent-violet/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors mb-2"
          >
            {activating ? "Aktiviere …" : "Agent aktivieren (Claude-API)"}
          </button>
          {activateResult && (
            <div className={`text-[10px] mt-1 ${ERGEBNIS_FARBE[activateResult.art]}`}>
              <p className="break-words">{maskiereGeschuetzteNamen(activateResult.text)}</p>
              {activateResult.hinweise.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {activateResult.hinweise.map((h, i) => (
                    <li key={i} className="break-words">
                      {maskiereGeschuetzteNamen(h)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-[9px] text-text-muted mt-2">
            Sendet den System-Prompt an die Claude-API und schreibt die Antwort auf den Bus. Jeder Aufruf kostet; die Kosten werden geschätzt.
          </p>
        </div>
      </div>

      {/* Message History */}
      <div className="card-ghost p-4">
        <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
          {messagesFehler
            ? "Nachrichten — nicht lesbar"
            : `Nachrichten (${sichtbareNachrichten.length} in den neuesten ${DETAIL_NACHRICHTEN_GRENZE})`}
        </h3>
        {!messagesFehler && ausgeblendeteNachrichten > 0 && (
          <p className="text-[10px] text-text-muted mb-3" data-ausgeblendet={ausgeblendeteNachrichten}>
            {ausgeblendeteNachrichten} von ausgeblendeten Agenten nicht angezeigt
          </p>
        )}
        {messagesFehler ? (
          <p className="text-xs text-center py-6 break-words" style={{ color: "var(--gp-rose)" }}>
            Nachrichten nicht lesbar: {messagesFehler}
          </p>
        ) : messages.length === 0 ? (
          <p className="text-text-muted text-xs text-center py-6">
            Die Abfrage im Browser lieferte keine Nachrichten von oder an diesen Agenten.
          </p>
        ) : sichtbareNachrichten.length === 0 ? (
          <p className="text-text-muted text-xs text-center py-6">
            Keine Nachrichten sichtbarer Agenten in den neuesten {DETAIL_NACHRICHTEN_GRENZE}.
          </p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {sichtbareNachrichten.map((msg) => {
              const isFrom = msg.from_agent === agentId;
              return (
                <div key={msg.id} className="flex gap-3 text-xs">
                  <span className="text-text-muted font-mono w-[110px] shrink-0">
                    {new Date(msg.created_at).toLocaleString("de-DE", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                  <span className={isFrom ? "text-accent-cyan" : "text-accent-violet"}>
                    {isFrom ? "→" : "←"}
                  </span>
                  <span className="text-text-secondary flex-1 truncate">
                    {maskiereGeschuetzteNamen(nachrichtText(msg))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaBlock({ label, value, color, title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <div className="flex-1 min-w-[140px]" title={title}>
      <p className="text-[10px] text-text-muted uppercase tracking-widest mb-1">{label}</p>
      <p className="text-sm font-medium break-words" style={color ? { color } : undefined}>{value}</p>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-sm font-semibold font-mono" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}
