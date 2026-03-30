import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAgentPrompt } from "@/lib/agent-prompts";
import { randomUUID } from "crypto";

// POST — Activate an agent via Claude API
// Sends the agent's system prompt + context (recent messages) to Claude
// Records the response as a message in the bus
export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "sk-ant-your-key-here" || apiKey.length < 10) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured. Set it in site/.env.local" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { agent_id, task, context } = body;

    if (!agent_id) {
      return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
    }

    const agentPrompt = getAgentPrompt(agent_id);
    if (!agentPrompt) {
      return NextResponse.json({ error: `No prompt configured for agent: ${agent_id}` }, { status: 404 });
    }

    const supabase = createServiceClient();

    // Get agent info
    const { data: agent } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agent_id)
      .single();

    if (!agent) {
      return NextResponse.json({ error: `Agent not found: ${agent_id}` }, { status: 404 });
    }

    // Get recent messages involving this agent (for context)
    const { data: recentMessages } = await supabase
      .from("messages")
      .select("*")
      .or(`from_agent.eq.${agent_id},to_agents.cs.{${agent_id}}`)
      .order("created_at", { ascending: false })
      .limit(10);

    // Build context from recent messages
    const messageContext = (recentMessages ?? [])
      .reverse()
      .map((m) => {
        const text = typeof m.content === "string" ? m.content : (m.content as Record<string, unknown>)?.text ?? JSON.stringify(m.content);
        const direction = m.from_agent === agent_id ? "YOU SENT" : `FROM ${m.from_agent}`;
        return `[${direction}] (${m.message_type}): ${text}`;
      })
      .join("\n");

    // Build the user message
    const userMessage = task
      ? task
      : context
        ? context
        : messageContext
          ? `Here are your recent messages on the bus:\n\n${messageContext}\n\nBased on this context, what is your next action? Be specific and actionable.`
          : `You have just been activated. Introduce yourself briefly and state your first priority action for Ghost Protocol. Be concise.`;

    // Call Claude API
    const startTime = Date.now();
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: agentPrompt.model,
        max_tokens: agentPrompt.maxTokens,
        system: agentPrompt.systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeResponse.ok) {
      const errData = await claudeResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: `Claude API error: ${claudeResponse.status} — ${JSON.stringify(errData)}` },
        { status: 502 }
      );
    }

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text ?? "";
    const inputTokens = claudeData.usage?.input_tokens ?? 0;
    const outputTokens = claudeData.usage?.output_tokens ?? 0;
    const latencyMs = Date.now() - startTime;

    // Calculate cost
    const isSonnet = agentPrompt.model.includes("sonnet");
    const costPerMInputTokens = isSonnet ? 3.0 : 0.80;   // Sonnet: $3/M, Haiku: $0.80/M
    const costPerMOutputTokens = isSonnet ? 15.0 : 4.0;   // Sonnet: $15/M, Haiku: $4/M
    const cost = (inputTokens * costPerMInputTokens + outputTokens * costPerMOutputTokens) / 1_000_000;

    // Update agent in Supabase
    await supabase
      .from("agents")
      .update({
        status: "online",
        last_heartbeat: new Date().toISOString(),
        total_input_tokens: (agent.total_input_tokens ?? 0) + inputTokens,
        total_output_tokens: (agent.total_output_tokens ?? 0) + outputTokens,
        total_cost_usd: (agent.total_cost_usd ?? 0) + cost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", agent_id);

    // Log response as a message on the bus
    await supabase.from("messages").insert({
      id: `msg-${randomUUID().slice(0, 8)}`,
      from_agent: agent_id,
      from_role: agent.role,
      to_agents: ["donna"],
      to_channels: [],
      content: { text: responseText, type: "agent_activation" },
      message_type: "response",
      priority: "normal",
      metadata: {
        model: agentPrompt.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: cost,
        latency_ms: latencyMs,
        source: "activation-api",
      },
    });

    // Log metric
    await supabase.from("metrics").insert({
      id: `met-${randomUUID().slice(0, 8)}`,
      agent_id,
      metric_type: "llm_call",
      value: cost,
      metadata: {
        model: agentPrompt.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        latency_ms: latencyMs,
      },
    });

    return NextResponse.json({
      agent_id,
      model: agentPrompt.model,
      response: responseText,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: cost, latency_ms: latencyMs },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
