"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { KPICard } from "@/components/ui/KPICard";

// ═══ TYPES ═══

interface ContentItem {
  id: number;
  title: string;
  content_type: string;
  status: string;
  body: string | null;
  platform: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  published_url: string | null;
  published_at: string | null;
  views: number | null;
  engagement: number | null;
  metadata: {
    thema?: string;
    objekt_slug?: string | null;
    utm_content?: string | null;
    kampagne?: string | null;
    cta_link?: string | null;
    amplifier_empfehlung?: string;
    fehler?: string;
    steps?: { agent: string; output?: string; cost?: number; duration_ms?: number }[];
  } | null;
  created_at: string;
  updated_at: string;
}

interface ObjektOption {
  slug: string;
  name: string;
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
  contentId?: number;
  thema?: string;
  platform: string;
  status: string;
  steps: PipelineStep[];
  summary: { total_cost_usd: number; total_duration_ms: number; completed: string };
}

// ═══ CONSTANTS ═══

// Status-Reihenfolge in der Freigabe-Ansicht: zur_freigabe zuerst (braucht Aktion),
// dann Entwurfs-/Zwischenstände & Fehlschläge, dann freigegeben, dann gepostet.
const STATUS_ORDER = ["zur_freigabe", "entwurf", "counsel_geprueft", "fehler", "abgelehnt", "freigegeben", "gepostet"];

const STATUS_META: Record<string, { label: string; color: string }> = {
  entwurf: { label: "Entwurf", color: "#6b6b7b" },
  counsel_geprueft: { label: "Counsel geprüft", color: "#38bdf8" },
  zur_freigabe: { label: "Zur Freigabe", color: "#f59e0b" },
  fehler: { label: "Fehler", color: "#ff4d6a" },
  abgelehnt: { label: "Abgelehnt", color: "#ff4d6a" },
  freigegeben: { label: "Freigegeben", color: "#22c55e" },
  gepostet: { label: "Gepostet", color: "#8b5cf6" },
};

const TYPE_LABELS: Record<string, string> = {
  article: "Artikel",
  report: "Report",
  social_post: "Social Post",
  newsletter: "Newsletter",
  product: "Produkt",
  thread: "Thread",
  longform: "Longform",
  carousel: "Carousel",
};

const PLATFORM_ICONS: Record<string, string> = {
  youtube: "▶",
  x: "𝕏",
  twitter: "𝕏",
  newsletter: "✉",
  tiktok: "♪",
  instagram: "◎",
};

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "#ff0000",
  x: "#1da1f2",
  twitter: "#1da1f2",
  newsletter: "#8b5cf6",
  tiktok: "#00f2ea",
  instagram: "#e1306c",
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

const TWEET_MAX = 280;

// body an Tweet-Grenzen splitten: Zeilen die mit "N/" oder "**N/M**" beginnen,
// Markdown-Bold-Sterne entfernen. Ohne Treffer: gesamter Body als ein Block.
function splitTweets(body: string): string[] {
  const lines = body.split("\n");
  const tweetStart = /^\*{0,2}\d+\/\d*\*{0,2}/;
  const tweets: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (tweetStart.test(line.trim())) {
      if (current.length) tweets.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) tweets.push(current.join("\n").trim());
  const cleaned = tweets.map((t) => t.replace(/\*\*/g, "")).filter((t) => t.length > 0);
  return cleaned.length > 0 ? cleaned : [body.trim()];
}

function charCountColor(len: number): string {
  if (len > TWEET_MAX) return "var(--gp-rose)";
  if (len > TWEET_MAX - 30) return "var(--gp-amber)";
  return "var(--gp-ink-3)";
}

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
  const [customPlatform, setCustomPlatform] = useState<string>("x");
  const [customFormat, setCustomFormat] = useState<string>("thread");
  const [customCategory, setCustomCategory] = useState<string>("ki_automation");
  const [objekte, setObjekte] = useState<ObjektOption[]>([]);
  const [selectedObjekt, setSelectedObjekt] = useState<string>("");

  // Freigabe-Ansicht (Content-Tab)
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [counselOpen, setCounselOpen] = useState<Record<number, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [publishedUrlDraft, setPublishedUrlDraft] = useState<Record<number, string>>({});
  const [metricsDraft, setMetricsDraft] = useState<Record<number, { impressions: string; likes: string }>>({});
  const [actionPending, setActionPending] = useState<number | null>(null);

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

    async function fetchObjekte() {
      try {
        const res = await fetch("/api/objekte", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const liste: ObjektOption[] = (data.objekte ?? []).map((o: { slug: string; name: string }) => ({
            slug: o.slug,
            name: o.name,
          }));
          setObjekte(liste);
        }
      } catch {
        // Objekt-Liste optional — Formular funktioniert auch ohne
      }
    }

    fetchContent();
    fetchCalendar();
    fetchObjekte();

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

  const runPipeline = useCallback(
    async (topic: string, platform: string, format: string, category: string, objektSlug: string) => {
      setPipelineRunning(true);
      setPipelineResult(null);
      try {
        const res = await fetch("/api/content/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: topic || undefined,
            platform,
            format,
            category,
            objekt_slug: objektSlug || undefined,
          }),
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
    },
    []
  );

  // Aktion an /api/content/status senden — Ergebnis kommt via Realtime zurück,
  // hier nur optimistisches Fehler-Feedback.
  const sendStatusAction = useCallback(
    async (id: number, aktion: string, extra?: Record<string, unknown>) => {
      setActionPending(id);
      try {
        await fetch("/api/content/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, aktion, ...extra }),
        });
      } finally {
        setActionPending(null);
      }
    },
    []
  );

  const copyTweet = useCallback((key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  }, []);

  const statusCounts = content.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Content nach STATUS_ORDER gruppieren
  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: content.filter((c) => c.status === status),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="boot p-6 lg:p-10 max-w-[1100px]">
      {/* Header */}
      <div className="gp-masthead">
        <div className="gp-index-row"><span className="gp-index">05 / PRODUKTION</span><span className="gp-index-rule" /></div>
        <p className="gp-kicker">RESEARCHER → SCRIBE → COUNSEL → PUBLISHER → AMPLIFIER</p>
        <h1 className="gp-wordmark">Content <em>Pipeline</em></h1>
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
            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-1">
              {["RESEARCHER", "SCRIBE", "COUNSEL", "PUBLISHER", "AMPLIFIER"].flatMap((agent, i) => {
                const step = pipelineResult?.steps?.[i];
                const color = step?.status === "done" ? "#22c55e" : step?.status === "running" ? "#f59e0b" : step?.status === "error" ? "#ff3366" : "#6b6b7b";
                const items = [
                  <div
                    key={agent}
                    className="rounded-lg p-2 text-center transition-all"
                    style={{ background: `${color}10`, border: `1px solid ${color}30` }}
                  >
                    <div className="text-[9px] font-mono mb-0.5" style={{ color }}>
                      {step?.status === "running" ? "..." : step?.status === "done" ? "DONE" : step?.status === "error" ? "ERR" : "WAIT"}
                    </div>
                    <div className="text-[10px] font-semibold text-foreground truncate">{agent}</div>
                    {step?.cost !== undefined && (
                      <div className="text-[8px] text-text-muted mt-0.5">
                        ${(step.cost * 100).toFixed(2)}c
                      </div>
                    )}
                  </div>,
                ];
                if (i < 4) items.push(<span key={`arrow-${i}`} className="text-text-muted text-sm">→</span>);
                return items;
              })}
            </div>
            {pipelineResult?.status === "abgelehnt" && (
              <p className="mt-3 text-[11px]" style={{ color: "var(--gp-rose)" }}>
                COUNSEL hat den Content abgelehnt — PUBLISHER/AMPLIFIER wurden NICHT ausgeführt.
              </p>
            )}
          </div>

          {/* Run Pipeline Form */}
          <div className="card-ghost p-5">
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-4">
              Content produzieren
            </h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Objekt (Steinadel)
                </label>
                <select
                  value={selectedObjekt}
                  onChange={(e) => setSelectedObjekt(e.target.value)}
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent-violet"
                >
                  <option value="">ohne Objekt</option>
                  {objekte.map((o) => (
                    <option key={o.slug} value={o.slug}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-widest block mb-1">
                  Thema {selectedObjekt && <span className="normal-case opacity-60">(wird aus Objekt übernommen)</span>}
                </label>
                <input
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  disabled={!!selectedObjekt}
                  placeholder="z.B. Wie KI-Agenten zusammenarbeiten..."
                  className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet disabled:opacity-40"
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
                <div className="grid grid-cols-5 gap-1.5">
                  {(["youtube", "x", "tiktok", "instagram", "newsletter"] as const).map((p) => {
                    const labels: Record<string, string> = { youtube: "YT", x: "X", tiktok: "TT", instagram: "IG", newsletter: "Mail" };
                    const defaultFormats: Record<string, string> = { youtube: "longform", x: "thread", tiktok: "tiktok_short", instagram: "carousel", newsletter: "newsletter_issue" };
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          setCustomPlatform(p);
                          setCustomFormat(defaultFormats[p]);
                        }}
                        className={`px-1.5 py-2 rounded-lg text-[10px] font-medium transition-all ${
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
                        {PLATFORM_ICONS[p]} {labels[p]}
                      </button>
                    );
                  })}
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
                  {customPlatform === "x" && (
                    <option value="thread">Thread (6-7 Tweets, Steinadel-Ton)</option>
                  )}
                  {customPlatform === "tiktok" && (
                    <option value="tiktok_short">TikTok Short (30-60 Sek)</option>
                  )}
                  {customPlatform === "instagram" && (
                    <>
                      <option value="carousel">Carousel (5-10 Slides)</option>
                      <option value="reel">Reel (30-90 Sek)</option>
                      <option value="story">Story-Serie (3-5 Stories)</option>
                    </>
                  )}
                  {customPlatform === "newsletter" && (
                    <option value="newsletter_issue">Newsletter-Ausgabe</option>
                  )}
                </select>
              </div>
            </div>
            <button
              onClick={() => {
                if (customTopic.trim() || selectedObjekt) {
                  runPipeline(customTopic, customPlatform, customFormat, customCategory, selectedObjekt);
                }
              }}
              disabled={pipelineRunning || (!customTopic.trim() && !selectedObjekt)}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                pipelineRunning
                  ? "bg-accent-violet/10 text-accent-violet cursor-wait"
                  : "bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {pipelineRunning ? "Pipeline läuft... (5 Agents, ~30-60 Sek)" : "Content produzieren"}
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
                  {pipelineResult.summary.total_duration_ms !== undefined && (
                    <span>Dauer: {(pipelineResult.summary.total_duration_ms / 1000).toFixed(1)}s</span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded font-mono ${
                      pipelineResult.status === "complete" ? "bg-green-500/10 text-green-400" :
                      pipelineResult.status === "abgelehnt" ? "bg-red-500/10 text-red-400" :
                      "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {pipelineResult.summary.completed ?? pipelineResult.status}
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
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="card-ghost p-2.5 text-center">
              <div className="text-lg font-bold font-[family-name:var(--font-outfit)]" style={{ color: "#ff0000" }}>~$0.06</div>
              <div className="text-[8px] text-text-muted uppercase tracking-wider mt-0.5">YouTube</div>
            </div>
            <div className="card-ghost p-2.5 text-center">
              <div className="text-lg font-bold font-[family-name:var(--font-outfit)]" style={{ color: "#1da1f2" }}>~$0.04</div>
              <div className="text-[8px] text-text-muted uppercase tracking-wider mt-0.5">X/Thread</div>
            </div>
            <div className="card-ghost p-2.5 text-center">
              <div className="text-lg font-bold font-[family-name:var(--font-outfit)]" style={{ color: "#00f2ea" }}>~$0.03</div>
              <div className="text-[8px] text-text-muted uppercase tracking-wider mt-0.5">TikTok</div>
            </div>
            <div className="card-ghost p-2.5 text-center">
              <div className="text-lg font-bold font-[family-name:var(--font-outfit)]" style={{ color: "#e1306c" }}>~$0.04</div>
              <div className="text-[8px] text-text-muted uppercase tracking-wider mt-0.5">Instagram</div>
            </div>
            <div className="card-ghost p-2.5 text-center">
              <div className="text-lg font-bold font-[family-name:var(--font-outfit)]" style={{ color: "#8b5cf6" }}>~$0.04</div>
              <div className="text-[8px] text-text-muted uppercase tracking-wider mt-0.5">Newsletter</div>
            </div>
            <div className="card-ghost p-2.5 text-center">
              <div className="text-lg font-bold text-accent-emerald font-[family-name:var(--font-outfit)]">~$4.60</div>
              <div className="text-[8px] text-text-muted uppercase tracking-wider mt-0.5">Pro Woche</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: 4-WOCHEN-KALENDER ═══ */}
      {activeTab === "calendar" && calendar && (
        <div className="space-y-6">
          {/* Week Selector */}
          <div className="grid grid-cols-4 gap-2">
            {(["week1", "week2", "week3", "week4"] as const).map((week, i) => {
              const weekData = calendar[week];
              return (
                <button
                  key={week}
                  onClick={() => setSelectedWeek(week)}
                  className={`p-2.5 rounded-lg text-left transition-all ${
                    selectedWeek === week
                      ? "bg-accent-violet/10 border border-accent-violet/30"
                      : "card-ghost hover:border-border"
                  }`}
                >
                  <div className="text-[9px] text-text-muted uppercase tracking-widest">
                    W{i + 1}
                  </div>
                  <div className={`text-xs font-semibold mt-0.5 leading-tight ${selectedWeek === week ? "text-accent-violet" : "text-foreground"}`}>
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
                      className="bg-surface-elevated rounded-lg p-3 hover:bg-surface-elevated/80 transition-all cursor-pointer group"
                      onClick={() => {
                        setCustomTopic(entry.topic);
                        setCustomPlatform(entry.platform);
                        setCustomFormat(entry.format);
                        setActiveTab("pipeline");
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-bold text-text-muted w-6">{WEEKDAY_LABELS[day]}</span>
                        <div
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase"
                          style={{ background: `${platformColor}15`, color: platformColor }}
                        >
                          {PLATFORM_ICONS[entry.platform]} {entry.platform}
                        </div>
                        <div className="text-[9px] px-1.5 py-0.5 rounded bg-surface text-text-muted">
                          {entry.format}
                        </div>
                        <span className="text-text-muted text-[10px] opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                          Produzieren →
                        </span>
                      </div>
                      <div className="text-sm text-foreground group-hover:text-accent-violet transition-colors pl-8">
                        {entry.topic}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Weekly Stats */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard label="Pieces/Woche" value={"~23"} color="#8b5cf6" icon="▣" />
            <KPICard label="YouTube" value={2} subtitle="Anchor Content" color="#ff0000" />
            <KPICard label="X/Twitter" value={4} subtitle="Threads" color="#1da1f2" />
            <KPICard label="TikTok" value={10} subtitle="Shorts" color="#00f2ea" />
            <KPICard label="Instagram" value={6} subtitle="Carousels + Reels" color="#e1306c" />
            <KPICard label="Newsletter" value={1} subtitle="Wöchentlich" color="#8b5cf6" />
          </div>

          {/* Monthly Overview */}
          <div className="card-ghost p-5">
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">
              4-Wochen-Ziele — 1→6 Repurposing-Strategie
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="text-accent-violet font-semibold text-xs mb-2">Wöchentlicher Output</h3>
                <ul className="space-y-1 text-text-secondary text-xs">
                  <li>2 YouTube Videos (Anchor) → Repurposing auf alle Plattformen</li>
                  <li>4 X/Twitter Threads (2 original + 2 repurposed)</li>
                  <li>~10 TikTok Shorts (Clips + Original)</li>
                  <li>4 Instagram Carousels + 2 Reels</li>
                  <li>1 Newsletter-Ausgabe</li>
                  <li className="text-accent-violet font-medium">= ~23 Pieces/Woche, ~92/Monat</li>
                </ul>
              </div>
              <div>
                <h3 className="text-accent-cyan font-semibold text-xs mb-2">KPI-Ziele (Woche 4)</h3>
                <ul className="space-y-1 text-text-secondary text-xs">
                  <li>YouTube: 500+ Subscriber, 5.000+ Views</li>
                  <li>X/Twitter: 1.000+ Follower, 50k+ Impressions</li>
                  <li>TikTok: 2.000+ Follower, 100k+ Views</li>
                  <li>Instagram: 800+ Follower, 30k+ Reach</li>
                  <li>Newsletter: 200+ Subscriber</li>
                  <li>Kosten: &lt;$20 API-Kosten total</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: CONTENT — FREIGABE-ANSICHT ═══ */}
      {activeTab === "content" && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard label="Zur Freigabe" value={statusCounts["zur_freigabe"] ?? 0} subtitle="Wartet auf dich" color="#f59e0b" />
            <KPICard label="Freigegeben" value={statusCounts["freigegeben"] ?? 0} subtitle="Bereit zum Posten" color="#22c55e" />
            <KPICard label="Gepostet" value={statusCounts["gepostet"] ?? 0} subtitle="Live" color="#8b5cf6" />
            <KPICard label="Abgelehnt/Fehler" value={(statusCounts["abgelehnt"] ?? 0) + (statusCounts["fehler"] ?? 0)} subtitle="COUNSEL/Technik" color="#ff4d6a" />
          </div>

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
            <div className="space-y-6">
              {grouped.map((group) => {
                const meta = STATUS_META[group.status] ?? { label: group.status, color: "#6b6b7b" };
                return (
                  <div key={group.status} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider"
                        style={{ background: `${meta.color}20`, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-text-muted">{group.items.length} Eintrag/Einträge</span>
                    </div>

                    {group.items.map((item) => {
                      const open = expandedId === item.id;
                      const tweets = item.body ? splitTweets(item.body) : [];
                      const meta_ = item.metadata ?? {};
                      const pubDraft = publishedUrlDraft[item.id] ?? "";
                      const metricsD = metricsDraft[item.id] ?? { impressions: "", likes: "" };

                      return (
                        <div key={item.id} className="card-ghost p-4 hover:border-border transition-all">
                          <div
                            className="flex items-center gap-3 mb-1 cursor-pointer"
                            onClick={() => setExpandedId(open ? null : item.id)}
                          >
                            <span
                              className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider"
                              style={{ background: `${meta.color}20`, color: meta.color }}
                            >
                              {meta.label}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
                              {TYPE_LABELS[item.content_type] ?? item.content_type}
                            </span>
                            {item.platform && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
                                {PLATFORM_ICONS[item.platform] ?? ""} {item.platform}
                              </span>
                            )}
                            <span className="text-[10px] text-text-muted ml-auto font-mono">
                              {new Date(item.created_at).toLocaleDateString("de-DE")}
                            </span>
                            <span className="text-text-muted text-xs">{open ? "▾" : "▸"}</span>
                          </div>
                          <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>

                          {open && (
                            <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                              {/* X-Thread-Vorschau */}
                              {item.body && (
                                <div>
                                  <h4 className="text-[10px] text-text-muted uppercase tracking-widest mb-2">
                                    X-Thread-Vorschau
                                  </h4>
                                  <div className="space-y-2">
                                    {tweets.map((tweet, idx) => {
                                      const key = `${item.id}-${idx}`;
                                      const len = tweet.length;
                                      return (
                                        <div key={key} className="card-ghost p-3">
                                          <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
                                            {tweet}
                                          </p>
                                          <div className="flex items-center justify-between mt-2">
                                            <button
                                              onClick={() => copyTweet(key, tweet)}
                                              className="text-[10px] px-2 py-1 rounded bg-surface-elevated text-text-muted hover:text-foreground transition-colors"
                                            >
                                              {copiedKey === key ? "Kopiert ✓" : "Kopieren"}
                                            </button>
                                            <span className="text-[10px] font-mono" style={{ color: charCountColor(len) }}>
                                              {len}/{TWEET_MAX}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* COUNSEL-Review */}
                              {item.review_notes && (
                                <div>
                                  <button
                                    onClick={() => setCounselOpen((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                                    className="text-[10px] text-text-muted uppercase tracking-widest hover:text-foreground transition-colors"
                                  >
                                    {counselOpen[item.id] ? "▾" : "▸"} COUNSEL-Review
                                  </button>
                                  {counselOpen[item.id] && (
                                    <pre className="mt-2 text-xs text-text-secondary whitespace-pre-wrap bg-surface-elevated rounded-lg p-3 max-h-[300px] overflow-y-auto font-mono leading-relaxed">
                                      {item.review_notes}
                                    </pre>
                                  )}
                                </div>
                              )}

                              {/* CTA-Link / UTM */}
                              {(meta_.cta_link || meta_.utm_content) && (
                                <div className="text-[11px] text-text-secondary space-y-1">
                                  {meta_.cta_link && (
                                    <div>
                                      <span className="text-text-muted">CTA-Link: </span>
                                      <a href={meta_.cta_link} target="_blank" rel="noopener" className="break-all" style={{ color: "var(--gp-gold-hi)" }}>
                                        {meta_.cta_link}
                                      </a>
                                    </div>
                                  )}
                                  {meta_.utm_content && (
                                    <div>
                                      <span className="text-text-muted">utm_content: </span>
                                      <span className="font-mono">{meta_.utm_content}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Technischer Fehler */}
                              {item.status === "fehler" && meta_.fehler && (
                                <p className="text-[11px]" style={{ color: "var(--gp-rose)" }}>
                                  Fehler: {meta_.fehler}
                                </p>
                              )}

                              {/* Aktionen nach Status */}
                              {item.status === "zur_freigabe" && (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => sendStatusAction(item.id, "freigeben")}
                                    disabled={actionPending === item.id}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-all disabled:opacity-40"
                                  >
                                    Freigeben
                                  </button>
                                  <button
                                    onClick={() => sendStatusAction(item.id, "ablehnen")}
                                    disabled={actionPending === item.id}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all disabled:opacity-40"
                                  >
                                    Ablehnen
                                  </button>
                                </div>
                              )}

                              {item.status === "freigegeben" && (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={pubDraft}
                                    onChange={(e) => setPublishedUrlDraft((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    placeholder="Published URL (optional)"
                                    className="flex-1 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet"
                                  />
                                  <button
                                    onClick={() => sendStatusAction(item.id, "gepostet", { published_url: pubDraft || undefined })}
                                    disabled={actionPending === item.id}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30 transition-all disabled:opacity-40 whitespace-nowrap"
                                  >
                                    Als gepostet markieren
                                  </button>
                                </div>
                              )}

                              {item.status === "gepostet" && (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    value={metricsD.impressions}
                                    onChange={(e) => setMetricsDraft((prev) => ({ ...prev, [item.id]: { ...metricsD, impressions: e.target.value } }))}
                                    placeholder="Impressions"
                                    className="w-28 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet"
                                  />
                                  <input
                                    type="number"
                                    value={metricsD.likes}
                                    onChange={(e) => setMetricsDraft((prev) => ({ ...prev, [item.id]: { ...metricsD, likes: e.target.value } }))}
                                    placeholder="Likes"
                                    className="w-28 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-accent-violet"
                                  />
                                  <button
                                    onClick={() =>
                                      sendStatusAction(item.id, "metriken", {
                                        impressions: Number(metricsD.impressions) || 0,
                                        likes: Number(metricsD.likes) || 0,
                                      })
                                    }
                                    disabled={actionPending === item.id}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-violet/20 text-accent-violet hover:bg-accent-violet/30 transition-all disabled:opacity-40"
                                  >
                                    Speichern
                                  </button>
                                  {(item.views ?? 0) > 0 && (
                                    <span className="text-[10px] text-text-muted ml-auto">
                                      Erfasst: {item.views} Impressions · {item.engagement} Likes
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
