// Ghost Protocol Agent Types

export type AgentTier = 0 | 1 | 2 | 3;
export type AgentStatus = "active" | "idle" | "error" | "offline" | "working";

export interface Agent {
  id: string;
  name: string;
  role: string;
  tier: AgentTier;
  llm_model: string;
  status: AgentStatus;
  persona: string;
  capabilities: string[];
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  from_agent: string;
  to_agent: string;
  content: string;
  message_type: "task" | "response" | "broadcast" | "alert";
  priority: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Metric {
  id: string;
  agent_id: string;
  metric_type: string;
  value: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Tier metadata
export const TIER_META: Record<AgentTier, { label: string; color: string; description: string }> = {
  0: { label: "THE BRAIN", color: "#ff3366", description: "Strategic Command" },
  1: { label: "C-SUITE", color: "#8b5cf6", description: "Executive Leadership" },
  2: { label: "DIRECTORS", color: "#06b6d4", description: "Department Heads" },
  3: { label: "OPERATORS", color: "#22c55e", description: "Execution Layer" },
};

// Agent registry with personas
export const AGENT_REGISTRY: Record<string, { icon: string; persona: string; tierColor: string }> = {
  STRATEGIST: { icon: "S", persona: "Elon Musk meets Jeff Bezos", tierColor: "#ff3366" },
  DONNA: { icon: "D", persona: "Donna Paulsen — Chief of Staff", tierColor: "#ff3366" },
  OPERATOR: { icon: "OP", persona: "Tim Cook", tierColor: "#8b5cf6" },
  ORACLE: { icon: "OR", persona: "Jim Simons", tierColor: "#8b5cf6" },
  ARCHITECT: { icon: "AR", persona: "Jensen Huang", tierColor: "#8b5cf6" },
  TREASURER: { icon: "TR", persona: "Warren Buffett", tierColor: "#8b5cf6" },
  PUBLISHER: { icon: "PU", persona: "Gary Vee", tierColor: "#8b5cf6" },
  COUNSEL: { icon: "CO", persona: "DACH Legal", tierColor: "#8b5cf6" },
  AMPLIFIER: { icon: "AM", persona: "Growth Hacker", tierColor: "#06b6d4" },
  MERCHANT: { icon: "ME", persona: "Product Lead", tierColor: "#06b6d4" },
  RESEARCHER: { icon: "RE", persona: "Research Head", tierColor: "#06b6d4" },
  SCRIBE: { icon: "SC", persona: "Content Producer", tierColor: "#22c55e" },
  TRADER: { icon: "TD", persona: "Market Analyst", tierColor: "#22c55e" },
  GUARDIAN: { icon: "GU", persona: "Data Engineer", tierColor: "#22c55e" },
  CONCIERGE: { icon: "CN", persona: "Community Support", tierColor: "#22c55e" },
  LOCALIZER: { icon: "LO", persona: "Cultural Intel", tierColor: "#22c55e" },
};
