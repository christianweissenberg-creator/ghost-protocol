"use client";

import { useState } from "react";
import { useAgents, useMessages } from "@/lib/hooks";
import { TIER_META } from "@/lib/types";
import { AgentCard } from "@/components/agents/AgentCard";
import { KPICard } from "@/components/ui/KPICard";
import { MessageFeed } from "@/components/ui/MessageFeed";
import type { AgentTier } from "@/lib/types";

interface DelegationAgent {
  id: string;
  task: string;
  priority: number;
}

interface DelegationResult {
  mode: string;
  delegation_plan: {
    agents: DelegationAgent[];
    reasoning: string;
  };
  results?: Array<{
    agent_id: string;
    task: string;
    priority: number;
    response: string;
    cost: number;
  }>;
  summary?: { agents_activated: number; total_cost_usd: number };
}

export default function CommandCenter() {
  const { agents, loading: agentsLoading } = useAgents();
  const { messages, loading: messagesLoading } = useMessages(30);
  const [donnaTask, setDonnaTask] = useState("");
  const [donnaLoading, setDonnaLoading] = useState(false);
  const [donnaResult, setDonnaResult] = useState<DelegationResult | null>(null);
  const [donnaError, setDonnaError] = useState("");

  async function handleDonnaDelegate(autoExecute = false) {
    if (!donnaTask.trim()) return;
    setDonnaLoading(true);
    setDonnaError("");
    setDonnaResult(null);
    try {
      const res = await fetch("/api/donna/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: donnaTask, auto_execute: autoExecute }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDonnaResult(data);
      if (autoExecute) setDonnaTask("");
    } catch (err) {
      setDonnaError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setDonnaLoading(false);
    }
  }

  const activeCount = agents.filter((a) => a.status === "online" || a.status === "working").length;
  const tierCounts = agents.reduce(
    (acc, a) => {
      acc[a.tier] = (acc[a.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );

  return (
    <div className="p-8 max-w-[1200px]">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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

      {/* DONNA Quick-Delegate */}
      <div className="card-ghost p-5 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-accent-rose text-lg">◈</span>
          <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
            DONNA — Task delegieren
          </h2>
          <span className="text-[10px] text-text-muted ml-auto uppercase tracking-widest">
            Auto-Delegation
          </span>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={donnaTask}
            onChange={(e) => setDonnaTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleDonnaDelegate(false);
              }
            }}
            placeholder="Was soll erledigt werden? z.B. 'Schreibe einen YouTube-Script über KI-Agenten'"
            className="flex-1 bg-surface-elevated border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50"
            disabled={donnaLoading}
          />
          <button
            onClick={() => handleDonnaDelegate(false)}
            disabled={donnaLoading || !donnaTask.trim()}
            className="px-4 py-2.5 bg-accent-violet/20 text-accent-violet text-sm font-medium rounded-lg hover:bg-accent-violet/30 transition-colors disabled:opacity-40"
          >
            {donnaLoading ? "..." : "Plan"}
          </button>
          <button
            onClick={() => handleDonnaDelegate(true)}
            disabled={donnaLoading || !donnaTask.trim()}
            className="px-4 py-2.5 bg-accent-emerald/20 text-accent-emerald text-sm font-medium rounded-lg hover:bg-accent-emerald/30 transition-colors disabled:opacity-40"
          >
            {donnaLoading ? "..." : "Go"}
          </button>
        </div>

        {donnaError && (
          <p className="text-accent-rose text-xs mt-2">{donnaError}</p>
        )}

        {donnaResult && (
          <div className="mt-4 space-y-3">
            {/* Plan */}
            <div className="bg-surface-elevated rounded-lg p-3">
              <p className="text-[10px] text-text-muted uppercase tracking-widest mb-2">
                Delegations-Plan — {donnaResult.delegation_plan.reasoning}
              </p>
              <div className="space-y-2">
                {donnaResult.delegation_plan.agents.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-accent-violet font-mono font-bold min-w-[16px]">
                      P{a.priority}
                    </span>
                    <span className="text-accent-cyan font-mono min-w-[80px]">
                      {a.id.toUpperCase()}
                    </span>
                    <span className="text-text-secondary">{a.task}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Results (if auto_execute) */}
            {donnaResult.results && (
              <div className="space-y-2">
                {donnaResult.results.map((r, i) => (
                  <details key={i} className="bg-surface-elevated rounded-lg">
                    <summary className="px-3 py-2 cursor-pointer text-xs flex items-center gap-2">
                      <span className="text-accent-cyan font-mono">{r.agent_id.toUpperCase()}</span>
                      <span className="text-text-muted">
                        {r.response.startsWith("ERROR") ? "❌" : "✅"} {r.cost > 0 ? `$${r.cost.toFixed(4)}` : ""}
                      </span>
                    </summary>
                    <div className="px-3 pb-3 text-xs text-text-secondary whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {r.response.slice(0, 800)}
                    </div>
                  </details>
                ))}
                {donnaResult.summary && (
                  <p className="text-[10px] text-text-muted text-right">
                    {donnaResult.summary.agents_activated} Agents — ${donnaResult.summary.total_cost_usd.toFixed(4)}
                  </p>
                )}
              </div>
            )}

            {/* Execute button if plan_only */}
            {donnaResult.mode === "plan_only" && (
              <button
                onClick={() => handleDonnaDelegate(true)}
                disabled={donnaLoading}
                className="w-full px-4 py-2 bg-accent-emerald/20 text-accent-emerald text-sm font-medium rounded-lg hover:bg-accent-emerald/30 transition-colors"
              >
                {donnaLoading ? "Agents arbeiten..." : "Plan ausführen →"}
              </button>
            )}
          </div>
        )}
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
