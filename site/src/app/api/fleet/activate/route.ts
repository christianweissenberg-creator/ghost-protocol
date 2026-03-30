import { NextRequest, NextResponse } from "next/server";

// POST — Activate multiple agents in sequence
// Used for morning briefings: DONNA → ORACLE → OPERATOR → PUBLISHER
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    agents = ["donna", "oracle", "operator"],
    task = "Morning briefing: Report your current status and top priority for today. Be concise (max 3 bullet points).",
  } = body;

  const results: Array<{ agent_id: string; success: boolean; response?: string; error?: string; cost_usd?: number }> = [];
  let totalCost = 0;

  for (const agentId of agents) {
    try {
      const baseUrl = request.nextUrl.origin;
      const res = await fetch(`${baseUrl}/api/agents/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, task }),
      });

      const data = await res.json();
      if (res.ok) {
        totalCost += data.usage?.cost_usd ?? 0;
        results.push({
          agent_id: agentId,
          success: true,
          response: data.response?.slice(0, 200),
          cost_usd: data.usage?.cost_usd,
        });
      } else {
        results.push({ agent_id: agentId, success: false, error: data.error });
      }
    } catch (err) {
      results.push({
        agent_id: agentId,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;

  return NextResponse.json({
    activated: successCount,
    total: agents.length,
    total_cost_usd: totalCost,
    results,
  });
}
