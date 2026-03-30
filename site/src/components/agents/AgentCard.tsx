"use client";

import Link from "next/link";
import type { Agent } from "@/lib/types";
import { AGENT_REGISTRY, TIER_META } from "@/lib/types";

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const registry = AGENT_REGISTRY[agent.name] ?? {
    icon: agent.name.slice(0, 2),
    persona: agent.role,
    tierColor: "#666",
  };
  const tierMeta = TIER_META[agent.tier];

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

        {/* Status */}
        <div className="flex items-center gap-1.5">
          <div className={`status-dot status-${agent.status}`} />
          <span className="text-[10px] text-text-muted uppercase tracking-wide">
            {agent.status}
          </span>
        </div>
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
          Tier {agent.tier} — {tierMeta.label}
        </span>
      </div>

      {/* Persona */}
      <p className="text-xs text-text-secondary leading-relaxed">
        {registry.persona}
      </p>

      {/* LLM Model */}
      <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between">
        <span className="text-[10px] text-text-muted font-mono">
          {agent.llm_model}
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
