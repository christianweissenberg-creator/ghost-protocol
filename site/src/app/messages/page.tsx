"use client";

import { useMessages, useAgents } from "@/lib/hooks";
import { CommandPanel } from "@/components/ui/CommandPanel";
import { useState } from "react";

const TYPE_COLORS: Record<string, string> = {
  task: "#06b6d4",
  response: "#22c55e",
  broadcast: "#8b5cf6",
  alert: "#ff3366",
};

const TYPE_LABELS: Record<string, string> = {
  task: "Aufgabe",
  response: "Antwort",
  broadcast: "Broadcast",
  alert: "Alert",
};

export default function MessagesPage() {
  const { messages, loading } = useMessages(100);
  const { agents } = useAgents();
  const [filter, setFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const filtered = messages.filter((msg) => {
    if (filter !== "all" && msg.message_type !== filter) return false;
    if (agentFilter !== "all" && msg.from_agent !== agentFilter && !msg.to_agents?.includes(agentFilter))
      return false;
    return true;
  });

  const typeCounts = messages.reduce(
    (acc, m) => {
      acc[m.message_type] = (acc[m.message_type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="p-8 max-w-[1200px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight font-[family-name:var(--font-outfit)]">
          Message Bus
        </h1>
        <p className="text-text-muted text-sm mt-1">
          Agent-Kommunikation in Echtzeit — Supabase Realtime
        </p>
      </div>

      {/* Stats Row */}
      <div className="flex gap-3 mb-6">
        {(["task", "response", "broadcast", "alert"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(filter === type ? "all" : type)}
            className={`card-ghost px-4 py-2.5 flex items-center gap-2 transition-all cursor-pointer ${
              filter === type ? "ring-1" : ""
            }`}
            style={{
              borderColor: filter === type ? TYPE_COLORS[type] : undefined,
              boxShadow: filter === type ? `0 0 0 1px ${TYPE_COLORS[type]}` : undefined,
            }}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: TYPE_COLORS[type] }}
            />
            <span className="text-xs text-text-secondary">{TYPE_LABELS[type]}</span>
            <span
              className="text-sm font-bold font-[family-name:var(--font-outfit)]"
              style={{ color: TYPE_COLORS[type] }}
            >
              {typeCounts[type] ?? 0}
            </span>
          </button>
        ))}

        {/* Agent Filter */}
        <div className="ml-auto">
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-text-secondary focus:outline-none focus:border-accent-violet"
          >
            <option value="all">Alle Agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-2 mb-4">
        <div className="status-dot status-active" />
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          Realtime Connected — {filtered.length} Nachrichten
        </span>
        {filter !== "all" && (
          <button
            onClick={() => setFilter("all")}
            className="text-[10px] text-accent-violet hover:underline ml-2"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Message List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card-ghost p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-ghost p-12 text-center">
          <div className="text-4xl mb-3 opacity-20">⇋</div>
          <p className="text-text-secondary text-sm">
            {messages.length === 0
              ? "Keine Nachrichten — Agents warten auf Aktivierung"
              : "Keine Nachrichten für diesen Filter"}
          </p>
          <p className="text-text-muted text-xs mt-2">
            Sobald Agents kommunizieren, erscheinen Nachrichten hier in Echtzeit
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((msg, i) => (
            <div
              key={msg.id}
              className="card-ghost p-4 hover:border-border transition-all animate-slide-up"
              style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
            >
              <div className="flex items-center gap-3 mb-2">
                {/* Type Badge */}
                <span
                  className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider font-medium"
                  style={{
                    background: `${TYPE_COLORS[msg.message_type] ?? "#666"}20`,
                    color: TYPE_COLORS[msg.message_type] ?? "#666",
                  }}
                >
                  {msg.message_type}
                </span>

                {/* Priority */}
                {(msg.priority === "urgent" || msg.priority === "critical") && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-rose/10 text-accent-rose font-mono">
                    {msg.priority.toUpperCase()}
                  </span>
                )}

                {/* Route */}
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground font-[family-name:var(--font-outfit)]">
                    {msg.from_agent}
                  </span>
                  <span className="text-text-muted">→</span>
                  <span className="text-sm text-text-secondary">
                    {msg.to_agents?.join(", ") || msg.to_channels?.join(", ") || "—"}
                  </span>
                </div>

                {/* Timestamp */}
                <span className="text-[10px] text-text-muted ml-auto font-mono">
                  {new Date(msg.created_at).toLocaleString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>

              {/* Content */}
              <p className="text-sm text-text-secondary leading-relaxed">
                {typeof msg.content === "string" ? msg.content : (msg.content as Record<string, unknown>)?.text as string ?? JSON.stringify(msg.content)}
              </p>

              {/* Metadata */}
              {msg.metadata && Object.keys(msg.metadata).length > 0 && (
                <div className="mt-2 pt-2 border-t border-border-subtle flex gap-2 flex-wrap">
                  {Object.entries(msg.metadata).map(([key, val]) => (
                    <span
                      key={key}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted font-mono"
                    >
                      {key}: {String(val)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Command Panel */}
      <div className="mt-6">
        <CommandPanel agents={agents} />
      </div>
    </div>
  );
}
