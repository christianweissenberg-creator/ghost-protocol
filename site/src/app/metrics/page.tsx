"use client";

import { useMetrics } from "@/lib/hooks-metrics";
import { useAgents } from "@/lib/hooks";
import { KPICard } from "@/components/ui/KPICard";

const METRIC_ICONS: Record<string, string> = {
  api_cost: "💰",
  tokens_used: "🔤",
  tasks_completed: "✓",
  response_time: "⏱",
  error_count: "⚠",
};

export default function MetricsPage() {
  const { metrics, aggregated, loading: metricsLoading } = useMetrics();
  const { agents } = useAgents();

  // Cost estimate: Sonnet ~$3/M input, Haiku ~$0.25/M input
  const sonnetAgents = agents.filter((a) => a.llm_model?.includes("sonnet")).length;
  const haikuAgents = agents.filter((a) => a.llm_model?.includes("haiku")).length;

  return (
    <div className="p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight font-[family-name:var(--font-outfit)]">
          Metrics
        </h1>
        <p className="text-text-muted text-sm mt-1">
          Agent-Performance, API-Kosten, System-Health
        </p>
      </div>

      {/* Budget Overview */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Monatsbudget"
          value="€55"
          subtitle="VPS €6 + API ~€40 + Tools €9"
          color="#f59e0b"
          icon="💰"
        />
        <KPICard
          label="Sonnet Agents"
          value={sonnetAgents}
          subtitle="~$3/M tokens"
          color="#8b5cf6"
        />
        <KPICard
          label="Haiku Agents"
          value={haikuAgents}
          subtitle="~$0.25/M tokens"
          color="#06b6d4"
        />
        <KPICard
          label="Metriken"
          value={metrics.length}
          subtitle={`${Object.keys(aggregated).length} Typen`}
          color="#22c55e"
          icon="◇"
        />
      </div>

      {/* Agent LLM Distribution */}
      <div className="card-ghost p-5 mb-6">
        <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] mb-4 uppercase tracking-wider text-text-muted">
          LLM-Verteilung
        </h2>
        <div className="flex gap-2 h-8 rounded-lg overflow-hidden">
          <div
            className="flex items-center justify-center text-[10px] font-bold transition-all"
            style={{
              width: `${(sonnetAgents / Math.max(agents.length, 1)) * 100}%`,
              background: "rgba(139, 92, 246, 0.3)",
              color: "#8b5cf6",
            }}
          >
            Sonnet ({sonnetAgents})
          </div>
          <div
            className="flex items-center justify-center text-[10px] font-bold transition-all"
            style={{
              width: `${(haikuAgents / Math.max(agents.length, 1)) * 100}%`,
              background: "rgba(6, 182, 212, 0.3)",
              color: "#06b6d4",
            }}
          >
            Haiku ({haikuAgents})
          </div>
        </div>
      </div>

      {/* Metric Types */}
      {metricsLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-ghost p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : Object.keys(aggregated).length === 0 ? (
        <div className="card-ghost p-12 text-center">
          <div className="text-4xl mb-3 opacity-20">◇</div>
          <p className="text-text-secondary text-sm">
            Keine Metriken vorhanden — Agents sammeln noch keine Daten
          </p>
          <p className="text-text-muted text-xs mt-2">
            Metriken werden automatisch erfasst sobald Agents aktiv arbeiten
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {Object.entries(aggregated).map(([type, data]) => (
            <div key={type} className="card-ghost p-4">
              <div className="flex items-center gap-2 mb-2">
                <span>{METRIC_ICONS[type] ?? "◇"}</span>
                <span className="text-xs text-text-muted uppercase tracking-wider">
                  {type.replace(/_/g, " ")}
                </span>
              </div>
              <div className="text-xl font-bold font-[family-name:var(--font-outfit)] text-foreground">
                {data.latest.toLocaleString("de-DE")}
              </div>
              <div className="text-[10px] text-text-muted mt-1">
                {data.count} Einträge — Summe: {data.sum.toLocaleString("de-DE")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agent Cost Table */}
      <div className="card-ghost p-5 mt-6">
        <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] mb-4 uppercase tracking-wider text-text-muted">
          Agent-Kostenübersicht (geschätzt)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="text-left py-2 font-medium">Agent</th>
                <th className="text-left py-2 font-medium">Tier</th>
                <th className="text-left py-2 font-medium">LLM</th>
                <th className="text-right py-2 font-medium">Cost/1M Token</th>
                <th className="text-right py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const isSonnet = agent.llm_model?.includes("sonnet");
                const costPer1M = isSonnet ? "$3.00" : "$0.25";
                return (
                  <tr key={agent.id} className="border-b border-border-subtle hover:bg-surface-elevated/30">
                    <td className="py-2 font-semibold text-foreground">{agent.name}</td>
                    <td className="py-2 text-text-muted">Tier {agent.tier}</td>
                    <td className="py-2">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{
                          background: isSonnet ? "rgba(139,92,246,0.15)" : "rgba(6,182,212,0.15)",
                          color: isSonnet ? "#8b5cf6" : "#06b6d4",
                        }}
                      >
                        {isSonnet ? "Sonnet" : "Haiku"}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono text-text-secondary">{costPer1M}</td>
                    <td className="py-2 text-right">
                      <span className={`status-dot inline-block status-${agent.status}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
