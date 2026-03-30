import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { randomUUID } from "crypto";

// GET — Fetch recent messages
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") ?? "50");
  const agent = searchParams.get("agent");

  try {
    const supabase = createServiceClient();
    let query = supabase
      .from("messages")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (agent) {
      query = query.or(`from_agent.eq.${agent},to_agents.cs.{${agent}}`);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST — Send a message (matches Supabase messages schema)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      from_agent,       // agent id: "donna"
      to_agents = [],   // array: ["oracle"]
      to_channels = [], // array: ["#market-intel"]
      content,          // JSONB: { text: "...", type: "briefing_request" }
      message_type = "task",
      priority = "normal",
      metadata = {},
    } = body;

    if (!from_agent || !content) {
      return NextResponse.json(
        { error: "from_agent and content are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Get sender role
    const { data: sender } = await supabase
      .from("agents")
      .select("role")
      .eq("id", from_agent)
      .single();

    // Insert message
    const { data, error } = await supabase
      .from("messages")
      .insert({
        id: `msg-${randomUUID().slice(0, 8)}`,
        from_agent,
        from_role: sender?.role ?? null,
        to_agents,
        to_channels,
        content: typeof content === "string" ? { text: content } : content,
        message_type,
        priority,
        metadata: { ...metadata, source: "command-center" },
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Update agent status to "working" for receivers
    if (to_agents.length > 0) {
      await supabase
        .from("agents")
        .update({ status: "working", updated_at: new Date().toISOString() })
        .in("id", to_agents);
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
