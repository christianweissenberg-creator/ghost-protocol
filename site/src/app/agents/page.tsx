"use client";

import { useAgents } from "@/lib/hooks";
import { AgentCard } from "@/components/agents/AgentCard";
import { TIER_META } from "@/lib/types";
import type { AgentTier } from "@/lib/types";

export default function AgentsPage() {
  const { agents, loading } = useAgents();

  const tiers = [0, 1, 2, 3] as AgentTier[];

  return (
    <div className="p-8 max-w-[1400px]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight font-[family-name:var(--font-outfit)]">
          Agent Fleet
        </h1>
        <p className="text-text-muted text-sm mt-1">
          {agents.length} Agents in 4 Tiers — Supabase Realtime
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="card-ghost p-4 h-36 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {tiers.map((tier) => {
            const tierAgents = agents.filter((a) => a.tier === tier);
            if (tierAgents.length === 0) return null;
            const meta = TIER_META[tier];

            return (
              <div key={tier}>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ background: meta.color }}
                  />
                  <h2
                    className="text-sm font-semibold uppercase tracking-widest font-[family-name:var(--font-outfit)]"
                    style={{ color: meta.color }}
                  >
                    Tier {tier} — {meta.label}
                  </h2>
                  <span className="text-xs text-text-muted">
                    {meta.description} ({tierAgents.length} Agents)
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {tierAgents.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
