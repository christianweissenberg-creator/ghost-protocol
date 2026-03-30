"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AGENT_REGISTRY, TIER_META } from "@/lib/types";
import type { Agent, Message, AgentTier } from "@/lib/types";
import Link from "next/link";

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [activateResult, setActivateResult] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: agentData } = await supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .single();

      if (agentData) setAgent(agentData as Agent);

      const { data: msgData } = await supabase
        .from("messages")
        .select("*")
        .or(`from_agent.eq.${agentId},to_agents.cs.{${agentId}}`)
        .order("created_at", { ascending: false })
        .limit(20);

      setMessages((msgData ?? []) as Message[]);
      setLoading(false);
    }
    load();

    // Realtime for this agent
    const channel = supabase
      .channel(`agent-${agentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agents", filter: `id=eq.${agentId}` },
        (payload) => setAgent(payload.new as Agent)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          if (msg.from_agent === agentId || msg.to_agents?.includes(agentId)) {
            setMessages((prev) => [msg, ...prev].slice(0, 20));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [agentId]);

  async function handleActivate() {
    if (!agent) return;
    setActivating(true);
    setActivateResult(null);

    try {
      const res = await fetch("/api/agents/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setActivateResult(`Agent aktiviert: ${data.response?.slice(0, 100)}...`);
      } else {
        setActivateResult(`Fehler: ${data.error}`);
      }
    } catch (err) {
      setActivateResult(`Fehler: ${err instanceof Error ? err.message : "Unbekannt"}`);
    } finally {
      setActivating(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="card-ghost p-8 h-48 animate-pulse" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8">
        <div className="card-ghost p-12 text-center">
          <p className="text-text-secondary">Agent &quot;{agentId}&quot; nicht gefunden</p>
          <Link href="/agents" className="text-accent-violet text-sm hover:underline mt-2 block">
            Zurück zur Fleet
          </Link>
        </div>
      </div>
    );
  }

  const registry = AGENT_REGISTRY[agent.name] ?? { icon: agent.name.slice(0, 2), persona: agent.role, tierColor: "#666" };
  const tierMeta = TIER_META[agent.tier as AgentTier];

  return (
    <div className="p-8 max-w-[1200px]">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link href="/agents" className="text-text-muted text-xs hover:text-accent-violet transition-colors">
          Agent Fleet
        </Link>
        <span className="text-text-muted text-xs mx-2">/</span>
        <span className="text-xs text-foreground">{agent.name}</span>
      </div>

      {/* Header */}
      <div className="card-ghost p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-xl font-bold font-[family-name:var(--font-outfit)]"
              style={{ background: `${registry.tierColor}15`, color: registry.tierColor }}
            >
              {registry.icon}
            </div>
            <div>
              <h1 className="text-2xl font-bold font-[family-name:var(--font-outfit)] tracking-tight">
                {agent.name}
              </h1>
              <p className="text-text-secondary text-sm">{agent.role}</p>
              <p className="text-text-muted text-xs mt-1 italic">&quot;{registry.persona}&quot;</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`status-dot status-${agent.status}`} />
            <span className="text-sm text-text-secondary uppercase tracking-wide">{agent.status}</span>
          </div>
        </div>

        {/* Meta Row */}
        <div className="flex gap-4 mt-6 pt-4 border-t border-border-subtle">
          <MetaBlock label="Tier" value={`T${agent.tier} — ${tierMeta.label}`} color={tierMeta.color} />
          <MetaBlock label="LLM" value={agent.llm_model} />
          <MetaBlock label="Channels" value={agent.channels?.join(", ") || "—"} />
          <MetaBlock label="Heartbeat" value={agent.last_heartbeat ? new Date(agent.last_heartbeat).toLocaleString("de-DE") : "Never"} />
        </div>
      </div>

      {/* Grid: Stats + Actions */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        {/* Token Usage */}
        <div className="card-ghost p-4">
          <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">Token Usage</h3>
          <div className="space-y-3">
            <StatRow label="Input Tokens" value={agent.total_input_tokens?.toLocaleString() ?? "0"} />
            <StatRow label="Output Tokens" value={agent.total_output_tokens?.toLocaleString() ?? "0"} />
            <StatRow label="Total Cost" value={`$${(agent.total_cost_usd ?? 0).toFixed(4)}`} color="#f59e0b" />
          </div>
        </div>

        {/* Config */}
        <div className="card-ghost p-4">
          <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">Config</h3>
          {agent.config && Object.keys(agent.config).length > 0 ? (
            <div className="space-y-1">
              {Object.entries(agent.config).map(([key, val]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="text-text-muted font-mono">{key}</span>
                  <span className="text-text-secondary">{String(val)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-xs">Keine Config gesetzt</p>
          )}
        </div>

        {/* Actions */}
        <div className="card-ghost p-4">
          <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">Actions</h3>
          <button
            onClick={handleActivate}
            disabled={activating}
            className="w-full px-4 py-2 rounded-lg text-xs font-medium bg-accent-violet text-white hover:bg-accent-violet/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors mb-2"
          >
            {activating ? "Aktiviere..." : "Agent Aktivieren (Claude API)"}
          </button>
          {activateResult && (
            <p className={`text-[10px] mt-1 ${activateResult.startsWith("Fehler") ? "text-accent-rose" : "text-accent-emerald"}`}>
              {activateResult}
            </p>
          )}
          <p className="text-[9px] text-text-muted mt-2">
            Sendet System-Prompt an Claude API und registriert Agent-Response
          </p>
        </div>
      </div>

      {/* Message History */}
      <div className="card-ghost p-4">
        <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
          Message History ({messages.length})
        </h3>
        {messages.length === 0 ? (
          <p className="text-text-muted text-xs text-center py-6">Keine Nachrichten</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {messages.map((msg) => {
              const isFrom = msg.from_agent === agentId;
              return (
                <div key={msg.id} className="flex gap-3 text-xs">
                  <span className="text-text-muted font-mono w-[110px] shrink-0">
                    {new Date(msg.created_at).toLocaleString("de-DE", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                  <span className={isFrom ? "text-accent-cyan" : "text-accent-violet"}>
                    {isFrom ? "→" : "←"}
                  </span>
                  <span className="text-text-secondary flex-1 truncate">
                    {typeof msg.content === "string"
                      ? msg.content
                      : (msg.content as Record<string, unknown>)?.text as string ?? JSON.stringify(msg.content)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaBlock({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex-1">
      <p className="text-[10px] text-text-muted uppercase tracking-widest mb-1">{label}</p>
      <p className="text-sm font-medium" style={color ? { color } : undefined}>{value}</p>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-sm font-semibold font-mono" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}
