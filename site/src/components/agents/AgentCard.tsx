"use client";

import Link from "next/link";
import type { Agent } from "@/lib/types";
import { aktivierungsAnzeige, registerEintragFuer, tierMetaFuer } from "@/lib/types";
import { useJetztIso } from "@/lib/hooks";

interface AgentCardProps {
  agent: Agent;
}

// Stufe 1 (06.11.2026, Befunde R3, R9, R13): Die Karte zeigt die letzte Aktivierung mit
// Zeit (agents.last_heartbeat) statt agents.status — der Registerstatus ist ein gespeicherter
// Wert ohne Messung und steht nur noch im title, als "nicht gemessen". Tier und Persona kommen
// mit Rückfall aus lib/types (tierMetaFuer, registerEintragFuer).
export function AgentCard({ agent }: AgentCardProps) {
  const registry = registerEintragFuer(agent);
  const tierMeta = tierMetaFuer(agent.tier);
  const jetzt = useJetztIso();
  const aktivierung = aktivierungsAnzeige(agent.last_heartbeat, jetzt, agent.status);
  // Ohne eigene Persona fällt die Anzeige auf die Rolle zurück; die steht schon unter dem
  // Namen und wird nicht doppelt gezeigt.
  const persona = registry.persona && registry.persona !== agent.role ? registry.persona : null;

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

      {/* LLM Model — laut Register (agents.llm_model) */}
      <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between">
        <span
          className="text-[10px] text-text-muted font-mono"
          title="Modell laut Register (agents.llm_model). Das bei einem Lauf aufgerufene Modell steht in metadata.model der Bus-Nachricht."
        >
          {agent.llm_model || "Modell nicht eingetragen"}
        </span>
        <div className="flex gap-1">
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
