"use client";

import { useState } from "react";

const AGENT_CAPABILITIES: Record<string, { label: string; skills: string; tier: number; color: string }> = {
  oracle: { label: "ORACLE", skills: "Marktanalyse, Wettbewerber-Intel, Trend-Erkennung", tier: 1, color: "#06b6d4" },
  researcher: { label: "RESEARCHER", skills: "Fakten-Recherche, Quellen, Deep-Dive-Analyse", tier: 2, color: "#22c55e" },
  scribe: { label: "SCRIBE", skills: "Content (YouTube, Threads, Newsletter, Artikel)", tier: 2, color: "#a855f7" },
  publisher: { label: "PUBLISHER", skills: "SEO, Scheduling, Qualitaetspruefung", tier: 2, color: "#3b82f6" },
  amplifier: { label: "AMPLIFIER", skills: "Distribution, Hashtags, Growth-Hacking", tier: 2, color: "#f97316" },
  treasurer: { label: "TREASURER", skills: "Finanzen, Budget, ROI-Analyse, Break-Even", tier: 1, color: "#eab308" },
  architect: { label: "ARCHITECT", skills: "Technische Architektur, DevOps, Code-Review", tier: 2, color: "#64748b" },
  merchant: { label: "MERCHANT", skills: "Monetarisierung, Pricing, Revenue-Streams", tier: 2, color: "#ec4899" },
  counsel: { label: "COUNSEL", skills: "Legal, Compliance, DSGVO, Impressum", tier: 2, color: "#78716c" },
  guardian: { label: "GUARDIAN", skills: "Security, Monitoring, Backup, Incidents", tier: 3, color: "#ef4444" },
  strategist: { label: "STRATEGIST", skills: "Strategie, OKRs, Vision, Roadmap", tier: 1, color: "#8b5cf6" },
  trader: { label: "TRADER", skills: "Krypto-Analyse, Trading-Signale, Portfolio", tier: 2, color: "#14b8a6" },
  concierge: { label: "CONCIERGE", skills: "Community, Support, FAQ, Onboarding", tier: 3, color: "#06b6d4" },
  localizer: { label: "LOCALIZER", skills: "Uebersetzung, Lokalisierung (EN/DE)", tier: 3, color: "#a3a3a3" },
};

interface DelegationAgent {
  id: string;
  task: string;
  priority: number;
}

interface DelegationResult {
  mode: string;
  original_task: string;
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

const QUICK_TASKS = [
  { label: "Morning Briefing", task: "Erstelle ein Morning Briefing: Top-3 KI/Krypto-News + Tagesplanung" },
  { label: "X-Thread", task: "Schreibe einen X/Twitter-Thread ueber die Vorteile von KI-Automation im Business" },
  { label: "YouTube-Skript", task: "Erstelle ein 10-Minuten YouTube-Skript ueber autonome KI-Systeme" },
  { label: "Newsletter", task: "Schreibe eine Newsletter-Ausgabe: AI Insider #1 — Die KI-Revolution" },
  { label: "Markt-Analyse", task: "Analysiere den aktuellen Krypto-Markt und identifiziere Trading-Chancen" },
  { label: "Content-Strategie", task: "Erstelle eine Content-Strategie fuer die naechsten 7 Tage" },
];

export default function DonnaPage() {
  const [task, setTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DelegationResult | null>(null);
  const [history, setHistory] = useState<DelegationResult[]>([]);
  const [error, setError] = useState("");

  async function handleDelegate(autoExecute = false, customTask?: string) {
    const taskText = customTask || task;
    if (!taskText.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/donna/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: taskText, auto_execute: autoExecute }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DelegationResult = await res.json();
      setResult(data);
      if (autoExecute) {
        setHistory((prev) => [data, ...prev].slice(0, 10));
        setTask("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler bei der Delegation");
    } finally {
      setLoading(false);
    }
  }

  async function executeCurrentPlan() {
    if (!result?.delegation_plan) return;
    await handleDelegate(true);
  }

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <span className="text-3xl">◈</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight font-[family-name:var(--font-outfit)]">
              DONNA
            </h1>
            <p className="text-text-muted text-sm mt-1">
              Chief of Staff — Automatische Task-Delegation an das Agent-Team
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Delegation Interface — 2 columns */}
        <div className="col-span-2 space-y-6">
          {/* Task Input */}
          <div className="card-ghost p-5">
            <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight mb-3">
              Task delegieren
            </h2>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleDelegate(false);
                }
              }}
              placeholder="Beschreibe den Task... DONNA analysiert und delegiert automatisch an die richtigen Agents."
              rows={3}
              className="w-full bg-surface-elevated border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-accent-violet/50 resize-none"
              disabled={loading}
            />
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => handleDelegate(false)}
                disabled={loading || !task.trim()}
                className="px-5 py-2.5 bg-accent-violet/20 text-accent-violet text-sm font-medium rounded-lg hover:bg-accent-violet/30 transition-colors disabled:opacity-40"
              >
                {loading ? "DONNA denkt..." : "Plan erstellen"}
              </button>
              <button
                onClick={() => handleDelegate(true)}
                disabled={loading || !task.trim()}
                className="px-5 py-2.5 bg-accent-emerald/20 text-accent-emerald text-sm font-medium rounded-lg hover:bg-accent-emerald/30 transition-colors disabled:opacity-40"
              >
                {loading ? "Agents arbeiten..." : "Sofort ausfuehren"}
              </button>
            </div>
          </div>

          {/* Quick Tasks */}
          <div className="card-ghost p-5">
            <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight mb-3">
              Quick Tasks
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_TASKS.map((qt) => (
                <button
                  key={qt.label}
                  onClick={() => {
                    setTask(qt.task);
                    handleDelegate(false, qt.task);
                  }}
                  disabled={loading}
                  className="text-left px-3 py-2.5 bg-surface-elevated rounded-lg text-xs text-text-secondary hover:text-foreground hover:bg-surface-elevated/80 transition-colors border border-border/50 disabled:opacity-40"
                >
                  <span className="font-medium text-foreground">{qt.label}</span>
                  <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{qt.task}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="card-ghost p-4 border-accent-rose/30">
              <p className="text-accent-rose text-sm">{error}</p>
            </div>
          )}

          {/* Result: Delegation Plan */}
          {result && (
            <div className="card-ghost p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight">
                  {result.mode === "auto_execute" ? "Ergebnis" : "Delegations-Plan"}
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
                  background: result.mode === "auto_execute" ? "rgba(34,197,94,0.15)" : "rgba(139,92,246,0.15)",
                  color: result.mode === "auto_execute" ? "#22c55e" : "#8b5cf6",
                }}>
                  {result.mode === "auto_execute" ? "AUSGEFUEHRT" : "PLAN"}
                </span>
              </div>

              {/* Reasoning */}
              <p className="text-xs text-text-muted mb-4 italic">
                {result.delegation_plan.reasoning}
              </p>

              {/* Agent Steps */}
              <div className="space-y-3">
                {result.delegation_plan.agents.map((agent, i) => {
                  const agentMeta = AGENT_CAPABILITIES[agent.id.toLowerCase()];
                  const agentResult = result.results?.find(
                    (r) => r.agent_id.toLowerCase() === agent.id.toLowerCase()
                  );

                  return (
                    <div key={i} className="bg-surface-elevated rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(139,92,246,0.15)", color: "#8b5cf6" }}
                        >
                          P{agent.priority}
                        </span>
                        <span
                          className="text-xs font-mono font-bold"
                          style={{ color: agentMeta?.color ?? "#8b5cf6" }}
                        >
                          {agent.id.toUpperCase()}
                        </span>
                        {agentMeta && (
                          <span className="text-[10px] text-text-muted">T{agentMeta.tier}</span>
                        )}
                        {agentResult && (
                          <span className="ml-auto text-[10px]" style={{
                            color: agentResult.response.startsWith("ERROR") ? "#ef4444" : "#22c55e",
                          }}>
                            {agentResult.response.startsWith("ERROR") ? "FEHLER" : "FERTIG"}
                            {agentResult.cost > 0 && ` — $${agentResult.cost.toFixed(4)}`}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary">{agent.task}</p>

                      {/* Agent Response (expandable) */}
                      {agentResult && !agentResult.response.startsWith("ERROR") && (
                        <details className="mt-2">
                          <summary className="text-[10px] text-accent-cyan cursor-pointer hover:underline">
                            Antwort anzeigen
                          </summary>
                          <div className="mt-2 text-xs text-text-secondary whitespace-pre-wrap max-h-64 overflow-y-auto bg-[#0a0a0f] rounded p-2 font-mono text-[11px]">
                            {agentResult.response.slice(0, 1500)}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Execute button if plan_only */}
              {result.mode === "plan_only" && (
                <button
                  onClick={executeCurrentPlan}
                  disabled={loading}
                  className="w-full mt-4 px-4 py-2.5 bg-accent-emerald/20 text-accent-emerald text-sm font-medium rounded-lg hover:bg-accent-emerald/30 transition-colors disabled:opacity-40"
                >
                  {loading ? "Agents arbeiten..." : "Plan ausfuehren →"}
                </button>
              )}

              {/* Summary */}
              {result.summary && (
                <div className="mt-4 flex items-center justify-between text-[10px] text-text-muted border-t border-border pt-3">
                  <span>{result.summary.agents_activated} Agents aktiviert</span>
                  <span>Kosten: ${result.summary.total_cost_usd.toFixed(4)}</span>
                </div>
              )}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="card-ghost p-5">
              <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight mb-3">
                Letzte Delegationen
              </h2>
              <div className="space-y-2">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs bg-surface-elevated rounded-lg px-3 py-2">
                    <span className="text-accent-emerald">✓</span>
                    <span className="text-text-secondary flex-1 truncate">{h.original_task}</span>
                    <span className="text-text-muted font-mono">
                      {h.delegation_plan.agents.length} Agents
                    </span>
                    {h.summary && (
                      <span className="text-text-muted font-mono">${h.summary.total_cost_usd.toFixed(4)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Agent Overview — 1 column */}
        <div className="space-y-6">
          {/* Agent Capabilities */}
          <div className="card-ghost p-5">
            <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight mb-3">
              Agent-Team
            </h2>
            <div className="space-y-2">
              {Object.entries(AGENT_CAPABILITIES).map(([id, agent]) => (
                <div key={id} className="flex items-start gap-2 text-xs">
                  <span
                    className="font-mono font-bold min-w-[70px] text-[11px]"
                    style={{ color: agent.color }}
                  >
                    {agent.label}
                  </span>
                  <span className="text-text-muted">{agent.skills}</span>
                </div>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div className="card-ghost p-5">
            <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight mb-3">
              So funktioniert DONNA
            </h2>
            <div className="space-y-3 text-xs text-text-secondary">
              <div className="flex gap-2">
                <span className="text-accent-violet font-bold">1.</span>
                <span>Du beschreibst den Task in natuerlicher Sprache</span>
              </div>
              <div className="flex gap-2">
                <span className="text-accent-violet font-bold">2.</span>
                <span>DONNA analysiert und waehlt 1-4 Agents aus</span>
              </div>
              <div className="flex gap-2">
                <span className="text-accent-violet font-bold">3.</span>
                <span>Agents mit gleicher Prioritaet arbeiten parallel</span>
              </div>
              <div className="flex gap-2">
                <span className="text-accent-violet font-bold">4.</span>
                <span>Ergebnisse werden zusammengefuehrt und angezeigt</span>
              </div>
            </div>
          </div>

          {/* Cost Info */}
          <div className="card-ghost p-5">
            <h2 className="text-sm font-semibold font-[family-name:var(--font-outfit)] tracking-tight mb-3">
              Kosten
            </h2>
            <div className="space-y-2 text-xs text-text-secondary">
              <div className="flex justify-between">
                <span>DONNA Planung</span>
                <span className="font-mono text-text-muted">~$0.002</span>
              </div>
              <div className="flex justify-between">
                <span>Pro Agent (Haiku)</span>
                <span className="font-mono text-text-muted">~$0.003</span>
              </div>
              <div className="flex justify-between">
                <span>Pro Agent (Sonnet)</span>
                <span className="font-mono text-text-muted">~$0.015</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 mt-2">
                <span className="font-medium text-foreground">Typische Delegation</span>
                <span className="font-mono text-accent-cyan">~$0.01-0.06</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
