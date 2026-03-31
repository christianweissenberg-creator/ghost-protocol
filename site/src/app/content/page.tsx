"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { KPICard } from "@/components/ui/KPICard";

// ═══ TYPES ═══

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

interface CalendarEntry {
  platform: string;
  format: string;
  topic: string;
}

interface CalendarWeek {
  theme: string;
  monday: CalendarEntry;
  tuesday: CalendarEntry;
  wednesday: CalendarEntry;
  thursday: CalendarEntry;
  friday: CalendarEntry;
}

interface PipelineStep {
  agent: string;
  status: string;
  output?: string;
  cost?: number;
  duration_ms?: number;
}

interface PipelineResult {
  topic: string;
  platform: string;
  status: string;
  steps: PipelineStep[];
  summary: { total_cost_usd: number; total_duration_ms: number; completed: string };
}

// ═══ CONSTANTS ═══

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

const PLATFORM_ICONS: Record<string, string> = {
  youtube: "▶",
  twitter: "𝕏",
  newsletter: "✉",
};

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "#ff0000",
  twitter: "#1da1f2",
  newsletter: "#8b5cf6",
};

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Mo",
  tuesday: "Di",
  wednesday: "Mi",
  thursday: "Do",
  friday: "Fr",
};

const CATEGORIES = [
  { value: "ki_automation", label: "KI & Automation" },
  { value: "krypto_trading", label: "Krypto-Trading" },
  { value: "business_automation", label: "Business-Automation" },
  { value: "ghost_protocol", label: "Behind the Scenes" },
];

// ═══ COMPONENT ═══

export default function ContentPage() {
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pipeline" | "calendar" | "content">("pipeline");
  const [calendar, setCalendar] = useState<Record<string, CalendarWeek> | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [selectedWeek, setSelectedWeek] = useState("week1");

  // Custom pipeline form
  const [customTopic, setCustomTopic] = useState("");
  const [customPlatform, setCustomPlatform] = useState<string>("youtube");
  const [customFormat, setCustomFormat] = useState<string>("longform");
  const [customCategory, setCustomCategory] = useState<string>("ki_automation");

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

    async function fetchCalendar() {
      try {
        const res = await fetch("/api/content/pipeline");
        if (res.ok) {
          const data = await res.json();
          setCalendar(data.launch_calendar);
        }
      } catch {
        // Calendar fetch failed silently
      }
    }

    fetchContent();
    fetchCalendar();

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

  const runPipeline = useCallback(async (topic: string, platform: string, format: string, category: string) => {
    setPipelineRunning(true);
    setPipelineResult(null);
    try {
      const res = await fetch("/api/content/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, platform, format, category }),
      });
      if (res.ok) {
        const data = await res.json();
        setPipelineResult(data);
      }
    } catch {
      // Pipeline error
    } finally {
      setPipelineRunning(false);
    }
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
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight font-[family-name:var(--font-outfit)]">
          Content Pipeline
        </h1>
        <p className="text-text-muted text-sm mt-1">
          Content-First Strategie — RESEARCHER → SCRIBE → PUBLISHER → AMPLIFIER
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 p-1 bg-surface-elevated rounded-lg w-fit">
        {(["pipeline", "calendar", "content"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === tab
                ? "bg-accent-violet/20 text-accent-violet"
                : "text-text-muted hover:text-foreground"
            }`}
          >
            {tab === "pipeline" ? "Pipeline" : tab === "calendar" ? "4-Wochen-Kalender" : "Content"}
          </button>
        ))}
      </div>

      {/* ═══ TAB: PIPELINE ═══ */}
      {activeTab === "pipeline" && (
        <div className="space-y-6">
          {/* Pipeline Flow Visualization */}
          <div className="card-ghost p-5">
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
              Agent-Pipeline Flow
            </h2>
            <div className="flex items-center gap-2">
              {["RESEARCHER", "SCRIBE", "PUBLISHER", "AMPLIFIER"].map((agent, i) => {
                const step = pipelineResult?.steps?.[i];
                const color = step?.status === "done" ? "#22c55e" : step?.status === "running" ? "#f59e0b" : step?.status === "error" ? "#ff3366" : "#6b6b7b";
                return (
                  <div key={agent} className="flex items-center gap-2 flex-1">
                    <div className="flex-1">
                      <div
                        className="rounded-lg p-3 text-center transition-all"
                        style={{ background: `${color}10`, border: `1px solid ${color}30` }}
                      >
                        <div className="text-[10px] font-mono mb-1" style={{ color }}>
                          {step?.status === "running" ? "..." : step?.status === "done" ? "DONE" : step?.status === "error" ? "ERR" : "WAIT"}
                        </div>
                        <div className="text-xs font-semibold text-foreground">{agent}</div>
                        {step?.cost !== undefined && (
                          <div className="text-[9px] text-text-muted mt-1">
                            ${(step.cost * 100).toFixed(2)}c
                          </div>
                        )}
                      </div>
                    </div>
                    {i < 3 && <span className="text-text-muted text-lg">→</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Run Pipeline Form */}
          <div className="card-ghost p-5">
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
              Content produzieren
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Thema
                </label>
                <input
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder="z.B. Wie KI-Agenten zusammenarbeiten..."
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Kategorie
                </label>
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent-violet"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Plattform
                </label>
                <div className="flex gap-2">
                  {(["youtube", "twitter", "newsletter"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setCustomPlatform(p);
                        setCustomFormat(p === "twitter" ? "thread" : p === "newsletter" ? "newsletter_issue" : "longform");
                      }}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        customPlatform === p
                          ? "text-foreground"
                          : "bg-surface-elevated text-text-muted hover:text-foreground"
                      }`}
                      style={customPlatform === p ? {
                        background: `${PLATFORM_COLORS[p]}20`,
                        border: `1px solid ${PLATFORM_COLORS[p]}40`,
                        color: PLATFORM_COLORS[p],
                      } : {}}
                    >
                      {PLATFORM_ICONS[p]} {p === "youtube" ? "YouTube" : p === "twitter" ? "X/Twitter" : "Newsletter"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Format
                </label>
                <select
                  value={customFormat}
                  onChange={(e) => setCustomFormat(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent-violet"
                >
                  {customPlatform === "youtube" && (
                    <>
                      <option value="longform">Longform (8-12 Min)</option>
                      <option value="short">Short (60 Sek)</option>
                      <option value="deep_dive">Deep Dive (15+ Min)</option>
                    </>
                  )}
                  {customPlatform === "twitter" && (
                    <option value="thread">Thread (5-8 Posts)</option>
                  )}
                  {customPlatform === "newsletter" && (
                    <option value="newsletter_issue">Newsletter-Ausgabe</option>
                  )}
                </select>
              </div>
            </div>
            <button
              onClick={() => {
                if (customTopic.trim()) {
                  runPipeline(customTopic, customPlatform, customFormat, customCategory);
                }
              }}
              disabled={pipelineRunning || !customTopic.trim()}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                pipelineRunning
                  ? "bg-accent-violet/10 text-accent-violet cursor-wait"
                  : "bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {pipelineRunning ? "Pipeline läuft... (4 Agents, ~30-60 Sek)" : "Content produzieren"}
            </button>
          </div>

          {/* Pipeline Result */}
          {pipelineResult && (
            <div className="card-ghost p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] text-text-muted uppercase tracking-widest">
                  Pipeline-Ergebnis
                </h2>
                <div className="flex items-center gap-3 text-[10px] text-text-muted">
                  <span>Kosten: ${pipelineResult.summary.total_cost_usd.toFixed(4)}</span>
                  <span>Dauer: {(pipelineResult.summary.total_duration_ms / 1000).toFixed(1)}s</span>
                  <span
                    className={`px-2 py-0.5 rounded font-mono ${
                      pipelineResult.status === "complete" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {pipelineResult.summary.completed}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {pipelineResult.steps.map((step) => (
                  <div key={step.agent} className="bg-surface-elevated rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[9px] px-2 py-0.5 rounded font-mono uppercase ${
                        step.status === "done" ? "bg-green-500/10 text-green-400" :
                        step.status === "error" ? "bg-red-500/10 text-red-400" :
                        "bg-gray-500/10 text-gray-400"
                      }`}>
                        {step.agent}
                      </span>
                      {step.duration_ms && (
                        <span className="text-[9px] text-text-muted">{(step.duration_ms / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {step.output && (
                      <pre className="text-xs text-text-secondary whitespace-pre-wrap max-h-[200px] overflow-y-auto font-mono leading-relaxed">
                        {step.output.slice(0, 2000)}{step.output.length > 2000 ? "..." : ""}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost Overview */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card-ghost p-4 text-center">
              <div className="text-2xl font-bold text-accent-violet font-[family-name:var(--font-outfit)]">~$0.04</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">Pro YouTube-Video</div>
              <div className="text-[9px] text-text-muted mt-0.5">4 Agent-Calls (Sonnet)</div>
            </div>
            <div className="card-ghost p-4 text-center">
              <div className="text-2xl font-bold text-accent-cyan font-[family-name:var(--font-outfit)]">~$0.02</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">Pro Twitter-Thread</div>
              <div className="text-[9px] text-text-muted mt-0.5">2 Sonnet + 2 Haiku</div>
            </div>
            <div className="card-ghost p-4 text-center">
              <div className="text-2xl font-bold text-accent-emerald font-[family-name:var(--font-outfit)]">~$3.20</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">Pro Woche (20 Pieces)</div>
              <div className="text-[9px] text-text-muted mt-0.5">Budget: $13.80/Monat</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: 4-WOCHEN-KALENDER ═══ */}
      {activeTab === "calendar" && calendar && (
        <div className="space-y-6">
          {/* Week Selector */}
          <div className="flex gap-2">
            {(["week1", "week2", "week3", "week4"] as const).map((week, i) => {
              const weekData = calendar[week];
              return (
                <button
                  key={week}
                  onClick={() => setSelectedWeek(week)}
                  className={`flex-1 p-3 rounded-lg text-left transition-all ${
                    selectedWeek === week
                      ? "bg-accent-violet/10 border border-accent-violet/30"
                      : "card-ghost hover:border-border"
                  }`}
                >
                  <div className="text-[10px] text-text-muted uppercase tracking-widest">
                    Woche {i + 1}
                  </div>
                  <div className={`text-sm font-semibold mt-1 ${selectedWeek === week ? "text-accent-violet" : "text-foreground"}`}>
                    {weekData?.theme}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Calendar Grid */}
          {calendar[selectedWeek] && (
            <div className="card-ghost p-5">
              <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
                {calendar[selectedWeek].theme} — Redaktionsplan
              </h2>
              <div className="space-y-2">
                {WEEKDAYS.map((day) => {
                  const entry = calendar[selectedWeek]?.[day];
                  if (!entry) return null;
                  const platformColor = PLATFORM_COLORS[entry.platform] ?? "#6b6b7b";
                  return (
                    <div
                      key={day}
                      className="flex items-center gap-3 bg-surface-elevated rounded-lg p-3 hover:bg-surface-elevated/80 transition-all cursor-pointer group"
                      onClick={() => {
                        setCustomTopic(entry.topic);
                        setCustomPlatform(entry.platform);
                        setCustomFormat(entry.format);
                        setActiveTab("pipeline");
                      }}
                    >
                      <div className="w-8 text-center">
                        <span className="text-xs font-bold text-text-muted">{WEEKDAY_LABELS[day]}</span>
                      </div>
                      <div
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase"
                        style={{ background: `${platformColor}15`, color: platformColor }}
                      >
                        {PLATFORM_ICONS[entry.platform]} {entry.platform}
                      </div>
                      <div className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-muted">
                        {entry.format}
                      </div>
                      <div className="flex-1 text-sm text-foreground group-hover:text-accent-violet transition-colors">
                        {entry.topic}
                      </div>
                      <span className="text-text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                        Produzieren →
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Weekly Stats */}
          <div className="grid grid-cols-4 gap-4">
            <KPICard label="Content/Woche" value={5} color="#8b5cf6" icon="▣" />
            <KPICard label="YouTube" value={2} subtitle="1 Longform + 1 Short" color="#ff0000" />
            <KPICard label="X/Twitter" value={2} subtitle="Threads" color="#1da1f2" />
            <KPICard label="Newsletter" value={1} subtitle="Dienstags" color="#8b5cf6" />
          </div>

          {/* Monthly Overview */}
          <div className="card-ghost p-5">
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">
              4-Wochen-Ziele
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="text-accent-violet font-semibold text-xs mb-2">Output</h3>
                <ul className="space-y-1 text-text-secondary text-xs">
                  <li>20 Content-Pieces total</li>
                  <li>4 YouTube Longform + 2 Shorts + 2 Deep Dives</li>
                  <li>8 X/Twitter Threads</li>
                  <li>4 Newsletter-Ausgaben</li>
                </ul>
              </div>
              <div>
                <h3 className="text-accent-cyan font-semibold text-xs mb-2">KPI-Ziele (Woche 4)</h3>
                <ul className="space-y-1 text-text-secondary text-xs">
                  <li>YouTube: 500+ Subscriber, 5.000+ Views</li>
                  <li>X/Twitter: 1.000+ Follower, 50k+ Impressions</li>
                  <li>Newsletter: 200+ Subscriber</li>
                  <li>Kosten: &lt;$15 API-Kosten total</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: CONTENT ═══ */}
      {activeTab === "content" && (
        <div className="space-y-6">
          {/* Pipeline Flow */}
          <div className="card-ghost p-5">
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
              Pipeline Status
            </h2>
            <div className="flex items-center gap-2">
              {STATUS_FLOW.map((step, i) => (
                <div key={step.key} className="flex items-center gap-2 flex-1">
                  <div className="flex-1">
                    <div
                      className="rounded-lg p-3 text-center transition-all"
                      style={{ background: `${step.color}10`, border: `1px solid ${step.color}30` }}
                    >
                      <div className="text-2xl font-bold font-[family-name:var(--font-outfit)]" style={{ color: step.color }}>
                        {statusCounts[step.key] ?? 0}
                      </div>
                      <div className="text-[10px] text-text-muted uppercase tracking-wider mt-1">{step.label}</div>
                      <div className="text-[9px] mt-1 font-mono" style={{ color: step.color }}>{step.agent}</div>
                    </div>
                  </div>
                  {i < STATUS_FLOW.length - 1 && <span className="text-text-muted text-lg">→</span>}
                </div>
              ))}
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-4">
            <KPICard label="Total Content" value={content.length} color="#8b5cf6" icon="▣" />
            <KPICard label="Published" value={statusCounts["published"] ?? 0} subtitle="Live & aktiv" color="#22c55e" />
            <KPICard label="In Review" value={statusCounts["review"] ?? 0} subtitle="Wartet auf Legal" color="#f59e0b" />
            <KPICard label="Draft" value={statusCounts["draft"] ?? 0} subtitle="In Arbeit" color="#6b6b7b" />
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
                Keine Inhalte — Content Pipeline wartet auf Aktivierung
              </p>
              <p className="text-text-muted text-xs mt-2">
                Wechsle zum Pipeline-Tab um den ersten Content zu produzieren
              </p>
              <button
                onClick={() => setActiveTab("pipeline")}
                className="mt-4 px-4 py-2 rounded-lg bg-accent-violet/20 text-accent-violet text-xs font-medium hover:bg-accent-violet/30 transition-all"
              >
                Pipeline starten
              </button>
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
                        style={{ background: `${statusMeta.color}20`, color: statusMeta.color }}
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
                      <span className="text-[10px] text-text-muted font-mono">Agent: {item.agent_id}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
