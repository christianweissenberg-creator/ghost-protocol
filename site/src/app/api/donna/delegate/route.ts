import { NextRequest, NextResponse } from "next/server";
import { getAgentPrompt } from "@/lib/agent-prompts";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// L.I.S.A. Auto-Delegation: Analysiert einen Task und delegiert an die richtigen Agents
// POST /api/donna/delegate — L.I.S.A. entscheidet wer was macht (Slug "donna" = Alt-Name, Route stabil)

const AGENT_CAPABILITIES: Record<string, string> = {
  oracle: "Marktanalyse, Wettbewerber-Intel, Daten-Recherche, Trend-Erkennung",
  researcher: "Fakten-Recherche, Quellen, Studien, Deep-Dive-Analyse",
  scribe: "Content schreiben (YouTube-Skripte, Threads, Newsletter, Artikel)",
  publisher: "Content formatieren, SEO, Scheduling, Qualitätsprüfung",
  amplifier: "Content-Distribution, Hashtags, Engagement, Growth-Hacking",
  treasurer: "Finanzen, Budget, Kosten-Tracking, ROI-Analyse, Break-Even",
  architect: "Technische Architektur, Infrastruktur, DevOps, Code-Review",
  merchant: "Monetarisierung, Pricing, Affiliate, Revenue-Streams",
  counsel: "Legal-Review, Compliance, Datenschutz, DSGVO, Impressum",
  guardian: "Security, Monitoring, Backup, Uptime, Incident Response",
  strategist: "Strategie, OKRs, Vision, Roadmap, Wettbewerbs-Analyse",
  trader: "Krypto-Analyse, Marktdaten, Trading-Signale, Portfolio",
  concierge: "Community, Support, FAQ, Onboarding, User-Feedback",
  localizer: "Übersetzung, Lokalisierung, Kulturelle Adaption (EN/DE)",
};

async function callClaude(systemPrompt: string, userMessage: string, model: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "ERROR: No API key";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) return `ERROR: Claude ${res.status}`;
  const data = await res.json();
  // Sonnet-5+ kann thinking-Bloecke VOR dem Text liefern → ersten Text-Block nehmen
  return data.content?.find((b: { type?: string }) => b.type === "text")?.text ?? "";
}

async function activateAgent(agentId: string, task: string, cookie: string): Promise<{ response: string; cost: number }> {
  const res = await fetch(`${BASE_URL}/api/agents/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ agent_id: agentId.toLowerCase(), task }),
  });
  if (!res.ok) return { response: `ERROR: ${res.status}`, cost: 0 };
  const data = await res.json();
  return { response: data.response ?? "", cost: data.usage?.cost_usd ?? 0 };
}

interface DelegationPlan {
  agents: Array<{ id: string; task: string; priority: number }>;
  reasoning: string;
}

export async function POST(request: NextRequest) {
  try {
    const { task, auto_execute = false } = await request.json();
    if (!task) {
      return NextResponse.json({ error: "task is required" }, { status: 400 });
    }

    const cookie = request.headers.get("cookie") ?? "";

    // Step 1: L.I.S.A. analysiert den Task und erstellt einen Delegations-Plan
    const donnaPrompt = getAgentPrompt("donna");
    const capabilitiesList = Object.entries(AGENT_CAPABILITIES)
      .map(([id, cap]) => `- ${id.toUpperCase()}: ${cap}`)
      .join("\n");

    const planningPrompt = `Du bist L.I.S.A. (Leadership Intelligence, Strategy & Alignment), Executive-COO-KI und Chief of Staff bei Ghost Protocol — die Verschmelzung von Donna Paulsens sozialer Antizipation und Pepper Potts' operativer Exzellenz. Kein Drama, keine Ausreden: klare Lage, klare Entscheidung, sauberer naechster Schritt.
Analysiere den folgenden Task und erstelle einen Delegations-Plan. Jeder Auftrag bekommt einen spezifischen Scope; was nicht entscheidungsreif ist, wird nicht delegiert.

VERFÜGBARE AGENTS:
${capabilitiesList}

REGELN:
- Wähle 1-4 Agents die für den Task am besten geeignet sind
- Gib jedem Agent einen SPEZIFISCHEN Auftrag (nicht generisch)
- Priorisiere: 1 = zuerst, 2 = danach, etc.
- Agents mit gleicher Priorität laufen parallel
- Antworte NUR im folgenden JSON-Format, kein anderer Text:

{"agents":[{"id":"agent_id","task":"Spezifischer Auftrag","priority":1}],"reasoning":"Warum diese Agents"}`;

    const donnaResponse = await callClaude(
      planningPrompt,
      `TASK: ${task}`,
      donnaPrompt?.model ?? "claude-haiku-4-5-20251001",
      // Sonnet-5 verbraucht Budget fuer thinking-Bloecke VOR dem Text —
      // 1024 schnitt das Plan-JSON mittendrin ab (Parse-Fail → 500)
      4096
    );

    // Parse L.I.S.A.'s delegation plan
    let plan: DelegationPlan;
    try {
      // Extract JSON from response (L.I.S.A. might add extra text)
      const jsonMatch = donnaResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      plan = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({
        error: "L.I.S.A. could not create a delegation plan",
        raw_response: donnaResponse.slice(0, 500),
      }, { status: 500 });
    }

    // Step 2: Execute if auto_execute is true
    if (auto_execute) {
      const results: Array<{
        agent_id: string;
        task: string;
        priority: number;
        response: string;
        cost: number;
      }> = [];
      let totalCost = 0;

      // Group by priority and execute in order
      const priorities = [...new Set(plan.agents.map((a) => a.priority))].sort();

      for (const prio of priorities) {
        const batch = plan.agents.filter((a) => a.priority === prio);
        // Execute same-priority agents in parallel
        const batchResults = await Promise.all(
          batch.map(async (agent) => {
            const { response, cost } = await activateAgent(agent.id, agent.task, cookie);
            return { agent_id: agent.id, task: agent.task, priority: prio, response, cost };
          })
        );
        results.push(...batchResults);
        totalCost += batchResults.reduce((sum, r) => sum + r.cost, 0);
      }

      return NextResponse.json({
        mode: "auto_execute",
        original_task: task,
        delegation_plan: plan,
        results: results.map((r) => ({
          ...r,
          response: r.response.slice(0, 1000),
        })),
        summary: {
          agents_activated: results.length,
          total_cost_usd: Math.round(totalCost * 100000) / 100000,
        },
      });
    }

    // Step 3: Return plan only (for review before execution)
    return NextResponse.json({
      mode: "plan_only",
      original_task: task,
      delegation_plan: plan,
      execute_url: "/api/donna/delegate",
      instruction: "Send the same request with auto_execute: true to execute this plan",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
