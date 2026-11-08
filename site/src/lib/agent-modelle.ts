// Modell je Agent für Aufrufe über das Dashboard — Tor-Prüfung 07.11.2026 (Befund F2).
//
// Einzige Quelle der Zuordnung Agent → Modell: lib/agent-prompts.ts liest model hier
// (AGENT_MODELLE), /api/agents/activate und /api/donna/delegate rufen damit die Claude-API auf.
// Diese Datei enthält KEINE System-Prompts und importiert nichts — Client-Komponenten
// (Agentenkarten, /agents/[id], /metrics) lesen das Modell hier. lib/agent-prompts.ts darf nie in
// eine Client-Komponente gelangen, sonst stehen alle Prompts im öffentlichen JS-Bundle.
//
// agents.llm_model (Register) ist etwas anderes: Seed (scripts/setup_supabase_v2.sql), der
// ruhende Python-Pfad oder der letzte Dashboard-Lauf (activate schreibt llm_model erst nach
// einem Lauf, Befund R15). Ein Agent ohne Eintrag hier hat keinen Dashboard-Prompt; activate
// antwortet dann 404.

export type DashboardModell = "claude-sonnet-5" | "claude-haiku-4-5-20251001";

export const AGENT_MODELLE = {
  strategist: "claude-sonnet-5",
  donna: "claude-sonnet-5",
  oracle: "claude-sonnet-5",
  operator: "claude-sonnet-5",
  architect: "claude-sonnet-5",
  treasurer: "claude-haiku-4-5-20251001",
  publisher: "claude-sonnet-5",
  counsel: "claude-haiku-4-5-20251001",
  amplifier: "claude-haiku-4-5-20251001",
  merchant: "claude-haiku-4-5-20251001",
  researcher: "claude-sonnet-5",
  scribe: "claude-haiku-4-5-20251001",
  guardian: "claude-haiku-4-5-20251001",
  concierge: "claude-haiku-4-5-20251001",
  localizer: "claude-haiku-4-5-20251001",
} as const satisfies Record<string, DashboardModell>;

/**
 * Modell, das das Dashboard für diesen Agenten aufruft; null = kein Dashboard-Prompt. Gleiche
 * Schlüsselregel wie getAgentPrompt (lib/agent-prompts.ts): genau die Kennung, nur eigene
 * Schlüssel — "constructor" trifft nicht Object.prototype.
 */
export function dashboardModellFuer(agentId: unknown): DashboardModell | null {
  if (typeof agentId !== "string" || !Object.prototype.hasOwnProperty.call(AGENT_MODELLE, agentId)) return null;
  return AGENT_MODELLE[agentId as keyof typeof AGENT_MODELLE];
}
