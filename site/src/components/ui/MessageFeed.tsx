"use client";

import type { Message } from "@/lib/types";

interface MessageFeedProps {
  messages: Message[];
}

const TYPE_COLORS: Record<string, string> = {
  task: "#06b6d4",
  response: "#22c55e",
  broadcast: "#8b5cf6",
  alert: "#ff3366",
};

export function MessageFeed({ messages }: MessageFeedProps) {
  if (messages.length === 0) {
    return (
      <div className="card-ghost p-6 text-center">
        <p className="text-text-muted text-sm">Keine Nachrichten — Agents warten auf Aktivierung</p>
        <p className="text-text-muted text-xs mt-1">Supabase Realtime verbindet automatisch</p>
      </div>
    );
  }

  return (
    <div className="card-ghost divide-y divide-border-subtle max-h-[400px] overflow-y-auto">
      {messages.map((msg) => (
        <div key={msg.id} className="p-3 hover:bg-surface-elevated/50 transition-colors animate-slide-up">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
              style={{
                background: `${TYPE_COLORS[msg.message_type] ?? "#666"}20`,
                color: TYPE_COLORS[msg.message_type] ?? "#666",
              }}
            >
              {msg.message_type}
            </span>
            <span className="text-xs font-semibold text-foreground">
              {msg.from_agent}
            </span>
            <span className="text-text-muted text-xs">→</span>
            <span className="text-xs text-text-secondary">
              {msg.to_agent}
            </span>
            <span className="text-[10px] text-text-muted ml-auto font-mono">
              {new Date(msg.created_at).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">
            {msg.content}
          </p>
        </div>
      ))}
    </div>
  );
}
