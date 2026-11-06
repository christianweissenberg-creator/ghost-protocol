import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { istSichtbarerAgent } from "@/lib/types";
import { bereinigeFehler, istObjekt, pruefeAnfrageHerkunft } from "@/lib/status-server";
import { randomUUID } from "crypto";

// Agenten-IDs sind kurze Slugs ("donna", "oracle"); der Filter unten baut sie in einen
// PostgREST-or-Ausdruck ein, deshalb nur diese Zeichen.
const AGENT_ID = /^[a-z0-9_-]{1,64}$/i;

/** Einheitliche Fehlerantwort: Feld fehler; error bleibt für ältere Leser (CommandPanel). */
function fehlerAntwort(status: number, fehler: string) {
  return NextResponse.json({ fehler, error: fehler }, { status });
}

/** Liste von Agenten-IDs bzw. Kanälen; null, wenn kein Array aus nicht leeren Texten. */
function textListe(wert: unknown): string[] | null {
  if (!Array.isArray(wert)) return null;
  return wert.every((x) => typeof x === "string" && x.trim() !== "") ? (wert as string[]) : null;
}

// GET — Fetch recent messages
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const gewuenscht = parseInt(searchParams.get("limit") ?? "50", 10);
  // Supabase liefert ohnehin höchstens 1000 Zeilen je Antwort ("Max rows").
  const limit = Number.isFinite(gewuenscht) ? Math.min(Math.max(gewuenscht, 1), 1000) : 50;
  const agent = searchParams.get("agent");
  if (agent !== null && !AGENT_ID.test(agent)) {
    return fehlerAntwort(400, "agent ist keine gültige Agenten-ID");
  }

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
    if (error) return fehlerAntwort(500, `Nachrichten nicht lesbar: ${bereinigeFehler(error)}`);
    return NextResponse.json(data);
  } catch (err) {
    return fehlerAntwort(500, bereinigeFehler(err));
  }
}

// POST — Send a message (matches Supabase messages schema)
// Stufe 1 (06.11.2026, Befunde R3 + R13): setzt agents.status nicht mehr auf "working" —
// kein Prozess arbeitet den Bus ab, und niemand setzte den Status zurück. Ausgeblendete
// Agenten (lib/types.ts, z. B. trader) sind weder Absender noch Empfänger: 400.
export async function POST(request: NextRequest) {
  // Gesamtprüfung 06.11.2026: Cross-Site-POST → 403, ohne JSON-Content-Type → 415.
  const sperre = pruefeAnfrageHerkunft(request.headers);
  if (sperre) return fehlerAntwort(sperre.status, sperre.fehler);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fehlerAntwort(400, "Ungültiger JSON-Body");
  }
  if (!istObjekt(body)) return fehlerAntwort(400, "Ungültiger JSON-Body");

  const {
    from_agent,       // agent id: "donna"
    content,          // JSONB: { text: "...", type: "briefing_request" }
    message_type = "task",
    priority = "normal",
    metadata = {},
  } = body;
  const toAgents = textListe(body.to_agents ?? []);     // array: ["oracle"]
  const toChannels = textListe(body.to_channels ?? []); // array: ["#market-intel"]

  if (typeof from_agent !== "string" || !from_agent.trim() || !content) {
    return fehlerAntwort(400, "from_agent und content sind Pflicht");
  }
  if (toAgents === null) return fehlerAntwort(400, "to_agents muss eine Liste von Agenten-IDs sein");
  if (toChannels === null) return fehlerAntwort(400, "to_channels muss eine Liste von Kanälen sein");
  if (!istObjekt(metadata)) return fehlerAntwort(400, "metadata muss ein Objekt sein");

  const ausgeblendet = [...new Set([from_agent, ...toAgents].map((id) => id.trim().toLowerCase()))].filter(
    (id) => !istSichtbarerAgent({ id }),
  );
  if (ausgeblendet.length > 0) {
    return fehlerAntwort(400, `Ausgeblendeter Agent nicht erlaubt: ${ausgeblendet.join(", ")}`);
  }

  try {
    const supabase = createServiceClient();

    // Get sender role
    const { data: sender } = await supabase
      .from("agents")
      .select("role")
      .eq("id", from_agent)
      .maybeSingle();

    // Insert message
    const { data, error } = await supabase
      .from("messages")
      .insert({
        id: `msg-${randomUUID().slice(0, 8)}`,
        from_agent,
        from_role: istObjekt(sender) && typeof sender.role === "string" ? sender.role : null,
        to_agents: toAgents,
        to_channels: toChannels,
        content: typeof content === "string" ? { text: content } : content,
        message_type,
        priority,
        metadata: { ...metadata, source: "command-center" },
      })
      .select()
      .single();

    if (error) return fehlerAntwort(500, `Nachricht nicht gespeichert: ${bereinigeFehler(error)}`);

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return fehlerAntwort(500, bereinigeFehler(err));
  }
}
