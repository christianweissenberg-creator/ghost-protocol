"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { KPICard } from "@/components/ui/KPICard";

interface ContentItem {
  id: string;
  title: string;
  content_type: string;
  status: string;
  agent_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const STATUS_FLOW = [
  { key: "draft", label: "Draft", color: "#6b6b7b", agent: "SCRIBE" },
  { key: "review", label: "Review", color: "#f59e0b", agent: "COUNSEL" },
  { key: "approved", label: "Approved", color: "#06b6d4", agent: "PUBLISHER" },
  { key: "published", label: "Published", color: "#22c55e", agent: "AMPLIFIER" },
];

const TYPE_LABELS: Record<string, string> = {
  article: "Artikel",
  report: "Report",
  social_post: "Social Post",
  newsletter: "Newsletter",
  product: "Produkt",
};

export default function ContentPage() {
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchContent() {
      const { data } = await supabase
        .from("content")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      setContent(data ?? []);
      setLoading(false);
    }

    fetchContent();

    // Realtime for content updates
    const channel = supabase
      .channel("content-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "content" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setContent((prev) => [payload.new as ContentItem, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setContent((prev) =>
              prev.map((c) =>
                c.id === (payload.new as ContentItem).id ? (payload.new as ContentItem) : c
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const statusCounts = content.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight font-[family-name:var(--font-outfit)]">
          Content Pipeline
        </h1>
        <p className="text-text-muted text-sm mt-1">
          Oracle → Scribe → Counsel → Publisher → Amplifier
        </p>
      </div>

      {/* Pipeline Visualization */}
      <div className="card-ghost p-5 mb-6">
        <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
          Pipeline Flow
        </h2>
        <div className="flex items-center gap-2">
          {STATUS_FLOW.map((step, i) => (
            <div key={step.key} className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <div
                  className="rounded-lg p-3 text-center transition-all"
                  style={{
                    background: `${step.color}10`,
                    border: `1px solid ${step.color}30`,
                  }}
                >
                  <div
                    className="text-2xl font-bold font-[family-name:var(--font-outfit)]"
                    style={{ color: step.color }}
                  >
                    {statusCounts[step.key] ?? 0}
                  </div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">
                    {step.label}
                  </div>
                  <div
                    className="text-[9px] mt-1 font-mono"
                    style={{ color: step.color }}
                  >
                    {step.agent}
                  </div>
                </div>
              </div>
              {i < STATUS_FLOW.length - 1 && (
                <span className="text-text-muted text-lg">→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Total Content"
          value={content.length}
          color="#8b5cf6"
          icon="▣"
        />
        <KPICard
          label="Published"
          value={statusCounts["published"] ?? 0}
          subtitle="Live & aktiv"
          color="#22c55e"
        />
        <KPICard
          label="In Review"
          value={statusCounts["review"] ?? 0}
          subtitle="Wartet auf Legal"
          color="#f59e0b"
        />
        <KPICard
          label="Draft"
          value={statusCounts["draft"] ?? 0}
          subtitle="In Arbeit"
          color="#6b6b7b"
        />
      </div>

      {/* Content List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card-ghost p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : content.length === 0 ? (
        <div className="card-ghost p-12 text-center">
          <div className="text-4xl mb-3 opacity-20">▣</div>
          <p className="text-text-secondary text-sm">
            Keine Inhalte — Content Pipeline wartet auf Agent-Aktivierung
          </p>
          <p className="text-text-muted text-xs mt-2">
            ORACLE liefert Intel → SCRIBE produziert → COUNSEL prüft → PUBLISHER veröffentlicht
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {content.map((item) => {
            const statusMeta = STATUS_FLOW.find((s) => s.key === item.status) ?? STATUS_FLOW[0];
            return (
              <div key={item.id} className="card-ghost p-4 hover:border-border transition-all">
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider"
                    style={{
                      background: `${statusMeta.color}20`,
                      color: statusMeta.color,
                    }}
                  >
                    {statusMeta.label}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
                    {TYPE_LABELS[item.content_type] ?? item.content_type}
                  </span>
                  <span className="text-[10px] text-text-muted ml-auto font-mono">
                    {new Date(item.created_at).toLocaleDateString("de-DE")}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-text-muted font-mono">
                    Agent: {item.agent_id}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
