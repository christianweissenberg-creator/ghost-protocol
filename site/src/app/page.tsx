"use client";

import { useAgents, useMessages } from "@/lib/hooks";
import { TIER_META } from "@/lib/types";
import { AgentCard } from "@/components/agents/AgentCard";
import { KPICard } from "@/components/ui/KPICard";
import { MessageFeed } from "@/components/ui/MessageFeed";
import type { AgentTier } from "@/lib/types";

export default function CommandCenter() {
  const { agents, loading: agentsLoading } = useAgents();
  const { messages, loading: messagesLoading } = useMessages(30);

  const activeCount = agents.filter((a) => a.status === "online" || a.status === "working").length;
  const tierCounts = agents.reduce(
    (acc, a) => {
      acc[a.tier] = (acc[a.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight font-[family-name:var(--font-outfit)]">
          Command Center
        </h1>
        <p className="text-text-muted text-sm mt-1">
          Ghost Protocol — Autonomous AI Corporation
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Agents Total"
          value={agents.length}
          subtitle="17 geplant"
          color="#8b5cf6"
          icon="◎"
        />
        <KPICard
          label="Active"
          value={activeCount}
          subtitle={`${agents.length - activeCount} idle/offline`}
          color="#22c55e"
          icon="◈"
        />
        <KPICard
          label="Messages"
          value={messages.length}
          subtitle="Letzte 30"
          color="#06b6d4"
          icon="⇋"
        />
        <KPICard
          label="Supabase"
          value={agentsLoading ? "..." : "Connected"}
          subtitle="Realtime aktiv"
          color={agentsLoading ? "#f59e0b" : "#22c55e"}
          icon="◇"
        />
      </div>

      {/* Main Grid: Agents + Messages */}
      <div className="grid grid-cols-3 gap-6">
        {/* Agent Grid — 2 columns */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
              Agent Fleet
            </h2>
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
          </div>

          {agentsLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card-ghost p-4 h-36 animate-pulse">
                  <div className="h-3 bg-surface-elevated rounded w-1/3 mb-3" />
                  <div className="h-2 bg-surface-elevated rounded w-2/3 mb-2" />
                  <div className="h-2 bg-surface-elevated rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>

        {/* Message Feed — 1 column */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
              Message Bus
            </h2>
            <span className="text-[10px] text-text-muted uppercase tracking-widest">
              Live
            </span>
          </div>

          {messagesLoading ? (
            <div className="card-ghost p-4 h-64 animate-pulse">
              <div className="h-2 bg-surface-elevated rounded w-3/4 mb-3" />
              <div className="h-2 bg-surface-elevated rounded w-1/2 mb-3" />
              <div className="h-2 bg-surface-elevated rounded w-2/3" />
            </div>
          ) : (
            <MessageFeed messages={messages} />
          )}

          {/* System Status */}
          <div className="card-ghost p-4 mt-4">
            <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">
              System Status
            </h3>
            <div className="space-y-2">
              <StatusRow label="Supabase" status="connected" />
              <StatusRow label="Realtime" status="subscribed" />
              <StatusRow label="Agents DB" status={agents.length > 0 ? "seeded" : "empty"} />
              <StatusRow label="Message Bus" status={messages.length > 0 ? "active" : "waiting"} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, status }: { label: string; status: string }) {
  const isGood = ["connected", "subscribed", "seeded", "active"].includes(status);
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-secondary">{label}</span>
      <span
        className="font-mono text-[10px]"
        style={{ color: isGood ? "#22c55e" : "#f59e0b" }}
      >
        {status}
      </span>
    </div>
  );
}
