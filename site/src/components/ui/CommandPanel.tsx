"use client";

// Command Panel — Stufe 1 (06.11.2026, Befund R13).
// Absender und Empfänger nur aus der übergebenen Liste (useAgents liefert nur sichtbare
// Agenten). Steht die Auswahl nicht in der Liste — etwa der Vorgabewert, wenn das Register
// nicht lesbar ist —, ist Senden gesperrt, statt still an eine nicht angezeigte ID zu gehen.
// Fehler liest das Panel aus "fehler" (neu) oder "error" (alt).

import { useState } from "react";
import type { Agent } from "@/lib/types";
import { anzeigeFehler } from "@/lib/hooks";

interface CommandPanelProps {
  agents: Agent[];
  /** Lesefehler des Agenten-Registers (useAgents); gesetzt heißt: "keine Agenten" ist nicht belegt. */
  agentsFehler?: string | null;
  onSend?: () => void;
}

export function CommandPanel({ agents, agentsFehler = null, onSend }: CommandPanelProps) {
  const [from, setFrom] = useState("donna");
  const [to, setTo] = useState("oracle");
  const [content, setContent] = useState("");
  const [type, setType] = useState<"task" | "broadcast">("task");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const fromGueltig = agents.some((a) => a.id === from);
  const toGueltig = agents.some((a) => a.id === to);
  const auswahlGueltig = fromGueltig && toGueltig;

  async function handleSend() {
    if (!content.trim() || !auswahlGueltig || sending) return;
    setSending(true);
    setLastResult(null);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_agent: from,
          to_agents: [to],
          content: { text: content.trim(), type: "manual_command" },
          message_type: type,
          priority: "normal",
          metadata: { manual: true },
        }),
      });

      if (res.ok) {
        setLastResult(`Nachricht an ${to} gesendet`);
        setContent("");
        onSend?.();
      } else {
        const err: unknown = await res.json().catch(() => null);
        const d = err !== null && typeof err === "object" ? (err as Record<string, unknown>) : {};
        const grund =
          typeof d.fehler === "string" && d.fehler.trim()
            ? d.fehler
            : typeof d.error === "string" && d.error.trim()
              ? d.error
              : `HTTP ${res.status}`;
        setLastResult(`Fehler: ${anzeigeFehler(grund)}`);
      }
    } catch (err) {
      setLastResult(`Fehler: ${anzeigeFehler(err)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card-ghost p-4">
      <h3 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">
        Command Panel
      </h3>

      {/* From / To Row */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <label className="text-[10px] text-text-muted mb-1 block">Von</label>
          <select
            value={fromGueltig ? from : ""}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full bg-surface-elevated border border-border-subtle rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent-violet"
          >
            {!fromGueltig && <option value="">— Absender wählen —</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.id})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end pb-1.5 text-text-muted text-xs">→</div>
        <div className="flex-1">
          <label className="text-[10px] text-text-muted mb-1 block">An</label>
          <select
            value={toGueltig ? to : ""}
            onChange={(e) => setTo(e.target.value)}
            className="w-full bg-surface-elevated border border-border-subtle rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent-violet"
          >
            {!toGueltig && <option value="">— Empfänger wählen —</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.id})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Type */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setType("task")}
          className={`text-[10px] px-2 py-1 rounded transition-colors ${
            type === "task"
              ? "bg-accent-cyan/20 text-accent-cyan"
              : "bg-surface-elevated text-text-muted hover:text-text-secondary"
          }`}
        >
          Aufgabe
        </button>
        <button
          onClick={() => setType("broadcast")}
          className={`text-[10px] px-2 py-1 rounded transition-colors ${
            type === "broadcast"
              ? "bg-accent-violet/20 text-accent-violet"
              : "bg-surface-elevated text-text-muted hover:text-text-secondary"
          }`}
        >
          Broadcast
        </button>
      </div>

      {/* Message */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Nachricht an Agent..."
        rows={3}
        className="w-full bg-surface-elevated border border-border-subtle rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-violet mb-3"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey) handleSend();
        }}
      />

      {/* Send */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] text-text-muted">
          {auswahlGueltig
            ? "⌘+Enter zum Senden"
            : agentsFehler
              ? // Gegencheck 06.11.2026: vorher hieß ein Lesefehler wie ein leeres Register.
                `Agenten-Register nicht lesbar: ${anzeigeFehler(agentsFehler)} — Senden gesperrt`
              : agents.length === 0
                ? "Keine Agenten geladen — Senden gesperrt"
                : "Absender oder Empfänger wählen — Senden gesperrt"}
        </span>
        <button
          onClick={handleSend}
          disabled={sending || !content.trim() || !auswahlGueltig}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent-violet text-white hover:bg-accent-violet/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "Sende..." : "Senden"}
        </button>
      </div>

      {/* Result */}
      {lastResult && (
        <p
          className={`text-[10px] mt-2 ${
            lastResult.startsWith("Fehler") ? "text-accent-rose" : "text-accent-emerald"
          }`}
        >
          {lastResult}
        </p>
      )}
    </div>
  );
}
