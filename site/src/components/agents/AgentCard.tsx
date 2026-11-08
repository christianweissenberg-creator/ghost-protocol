"use client";

import Link from "next/link";
import type { Agent } from "@/lib/types";
import { aktivierungsAnzeige, modellAnzeige, registerEintragFuer, tierMetaFuer } from "@/lib/types";
import { useJetztIso } from "@/lib/hooks";
// Nur die Zuordnung Agent → Modell, keine System-Prompts (lib/agent-prompts.ts nie im Browser).
import { dashboardModellFuer } from "@/lib/agent-modelle";

interface AgentCardProps {
  agent: Agent;
}

// Stufe 1 (06.11.2026, Befunde R3, R9, R13): Die Karte zeigt die letzte Aktivierung mit
// Zeit (agents.last_heartbeat) statt agents.status — der Registerstatus ist ein gespeicherter
// Wert ohne Messung und steht nur noch im title, als "nicht gemessen". Tier und Persona kommen
// mit Rückfall aus lib/types (tierMetaFuer, registerEintragFuer).
// Tor-Prüfung 07.11.2026 (F2): Das Modell kommt aus der Dashboard-Konfiguration
// (lib/agent-modelle.ts) — das Modell, das activate aufruft. agents.llm_model (Register) stand für
// AMPLIFIER, MERCHANT und SCRIBE auf Sonnet, obwohl alle ihre Läufe auf Haiku liefen; eine
// Abweichung steht jetzt sichtbar als zweite Zeile da, ein Agent ohne Prompt als solcher.
export function AgentCard({ agent }: AgentCardProps) {
  const registry = registerEintragFuer(agent);
  const tierMeta = tierMetaFuer(agent.tier);
  const jetzt = useJetztIso();
  const aktivierung = aktivierungsAnzeige(agent.last_heartbeat, jetzt, agent.status);
  // Ohne eigene Persona fällt die Anzeige auf die Rolle zurück; die steht schon unter dem
  // Namen und wird nicht doppelt gezeigt.
  const persona = registry.persona && registry.persona !== agent.role ? registry.persona : null;
  const modell = modellAnzeige(dashboardModellFuer(agent.id), agent.llm_model);

  return (
    <Link href={`/agents/${agent.id}`} className="card-ghost p-4 group animate-slide-up block cursor-pointer hover:border-accent-violet/30">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Agent Avatar */}
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center font-semibold text-xs font-[family-name:var(--font-outfit)]"
            style={{
              background: `${registry.tierColor}15`,
              color: registry.tierColor,
            }}
          >
            {registry.icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
              {agent.name}
            </h3>
            <p className="text-xs text-text-muted">{agent.role}</p>
          </div>
        </div>

        {/* Letzte Aktivierung (Ereignis mit Zeit), kein Registerstatus */}
        <span
          className="text-[10px] text-text-muted tracking-wide text-right max-w-[45%]"
          title={aktivierung.titel}
        >
          {aktivierung.text}
        </span>
      </div>

      {/* Tier Badge */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
          style={{
            background: `${tierMeta.color}15`,
            color: tierMeta.color,
          }}
        >
          Tier {String(agent.tier ?? "?")} — {tierMeta.label}
        </span>
      </div>

      {/* Persona */}
      {persona && (
        <p className="text-xs text-text-secondary leading-relaxed">
          {persona}
        </p>
      )}

      {/* Modell des Dashboard-Aufrufs (lib/agent-modelle.ts); Register nur bei Abweichung bzw. ohne Prompt */}
      <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between gap-2">
        <div className="min-w-0" title={modell.titel}>
          <p
            className="text-[10px] font-mono break-all"
            style={{ color: modell.ohnePrompt ? "var(--gp-amber)" : "var(--gp-ink-3)" }}
            data-modell="dashboard"
          >
            {modell.text}
          </p>
          {modell.register && (
            <p
              className="text-[9px] font-mono break-all mt-0.5"
              style={{ color: modell.abweichung ? "var(--gp-amber)" : "var(--gp-ink-3)" }}
              data-modell="register"
            >
              {modell.register}
            </p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {(agent.channels ?? []).slice(0, 3).map((ch) => (
            <span
              key={ch}
              className="text-[9px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted"
            >
              {ch}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
