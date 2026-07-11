"use client";

import { useAgents } from "@/lib/hooks";
import { AgentCard } from "@/components/agents/AgentCard";
import { TIER_META } from "@/lib/types";
import type { AgentTier } from "@/lib/types";

// Kanonische 17-Agenten-Flotte (statisch, wenn Supabase noch nicht geseedet).
// Nach Prototyp: Name, Rolle, Modell, Status, Kosten je Agent.
type Roster = { name: string; role: string; tier: AgentTier; model: "Sonnet" | "Haiku"; cost: string };
const ROSTER: Roster[] = [
  { name: "STRATEGIST", role: "CEO & Chief Strategist", tier: 0, model: "Sonnet", cost: "$0,00" },
  { name: "L.I.S.A.", role: "Executive-COO-KI · Chief of Staff", tier: 0, model: "Sonnet", cost: "$0,02" },
  { name: "ORACLE", role: "Chief Intelligence Officer", tier: 1, model: "Sonnet", cost: "$0,06" },
  { name: "ARCHITECT", role: "Chief Technology Officer", tier: 1, model: "Sonnet", cost: "$0,00" },
  { name: "TREASURER", role: "Chief Financial Officer", tier: 1, model: "Haiku", cost: "$0,00" },
  { name: "PUBLISHER", role: "Chief Marketing Officer", tier: 1, model: "Sonnet", cost: "$0,00" },
  { name: "COUNSEL", role: "Chief Legal Officer", tier: 1, model: "Sonnet", cost: "$0,00" },
  { name: "AMPLIFIER", role: "Growth & Distribution Director", tier: 2, model: "Haiku", cost: "$0,00" },
  { name: "MERCHANT", role: "Product & Revenue Director", tier: 2, model: "Sonnet", cost: "$0,00" },
  { name: "RESEARCHER", role: "Research & Innovation Director", tier: 2, model: "Sonnet", cost: "$0,00" },
  { name: "SCRIBE", role: "Content Producer", tier: 3, model: "Haiku", cost: "$0,00" },
  { name: "TRADER", role: "Marktanalyst", tier: 3, model: "Haiku", cost: "$0,00" },
  { name: "GUARDIAN", role: "Site Reliability Engineer", tier: 3, model: "Haiku", cost: "$0,00" },
  { name: "CONCIERGE", role: "Community & Customer Success", tier: 3, model: "Haiku", cost: "$0,00" },
  { name: "LOCALIZER", role: "Cultural Intelligence", tier: 3, model: "Haiku", cost: "$0,00" },
  { name: "SENTINEL", role: "Threat & Anomaly Watch", tier: 3, model: "Haiku", cost: "$0,00" },
  { name: "OPERATOR", role: "Task Execution Runtime", tier: 3, model: "Haiku", cost: "$0,00" },
];

function RosterCard({ a }: { a: Roster }) {
  const color = TIER_META[a.tier].color;
  return (
    <div className="card-ghost p-4 group">
      <div className="flex items-start gap-2.5">
        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div
            className="font-[family-name:var(--font-cormorant)] font-semibold text-[20px] leading-none tracking-tight"
            style={{ color: "var(--gp-ink)" }}
          >
            {a.name}
          </div>
          <div className="text-[11px] mt-1.5 leading-snug" style={{ color: "var(--gp-ink-2)" }}>
            {a.role}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3.5 pt-3" style={{ borderTop: "1px solid var(--gp-hairline)" }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full" style={{ background: "var(--gp-ink-3)" }} />
          <span className="mono-label">Bereit</span>
        </span>
        <span className="mono-label">{a.model}</span>
        <span className="font-[family-name:var(--font-jbmono)] text-[10px]" style={{ color: "var(--gp-gold)" }}>{a.cost}</span>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { agents, loading } = useAgents();
  const tiers = [0, 1, 2, 3] as AgentTier[];
  const useStatic = !loading && agents.length === 0;

  return (
    <div className="boot p-10 max-w-[1400px]">
      <div className="gp-masthead">
        <div className="gp-index-row"><span className="gp-index">02 / FLOTTE</span><span className="gp-index-rule" /><span className="mono-label">17 EINHEITEN · 4 TIERS</span></div>
        <p className="gp-kicker">Operator-Grid — Autonome KI-Corporation</p>
        <h1 className="gp-wordmark">Agent<em>flotte</em></h1>
        <p className="gp-sub">Siebzehn Spezialisten in vier Tiers — Tier-Farbkodierung, Status, Modell, Kosten je Einheit.</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="card-ghost p-4 h-32 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {tiers.map((tier) => {
            const meta = TIER_META[tier];
            const live = agents.filter((a) => a.tier === tier);
            const roster = ROSTER.filter((a) => a.tier === tier);
            const count = useStatic ? roster.length : live.length;
            if (count === 0) return null;
            return (
              <div key={tier}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                  <h2 className="mono-label" style={{ color: meta.color }}>
                    Tier {tier} — {meta.label}
                  </h2>
                  <span className="text-xs" style={{ color: "var(--gp-ink-3)" }}>
                    {meta.description} ({count})
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {useStatic
                    ? roster.map((a) => <RosterCard key={a.name} a={a} />)
                    : live.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
