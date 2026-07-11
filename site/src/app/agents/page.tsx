"use client";

import { useAgents } from "@/lib/hooks";
import { AgentCard } from "@/components/agents/AgentCard";
import { TIER_META } from "@/lib/types";
import type { AgentTier } from "@/lib/types";

export default function AgentsPage() {
  const { agents, loading } = useAgents();

  const tiers = [0, 1, 2, 3] as AgentTier[];

  return (
    <div className="boot p-10 max-w-[1400px]">
      <div className="gp-masthead">
        <div className="gp-index-row"><span className="gp-index">02 / FLOTTE</span><span className="gp-index-rule" /></div>
        <p className="gp-kicker">Operator-Grid — Supabase Realtime</p>
        <h1 className="gp-wordmark">Agent<em>flotte</em></h1>
        <p className="gp-sub">{agents.length} Agenten in 4 Tiers. Tier-Farbkodierung, Live-Status, Kosten.</p>
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
