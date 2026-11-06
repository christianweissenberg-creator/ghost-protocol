import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAgentPrompt } from "@/lib/agent-prompts";
import { istAuftragId } from "@/lib/auftrag";
import { PREIS_STAND_AB, leseTokenZahl, schaetzeKostenUsd } from "@/lib/kosten";
import {
  ANTHROPIC_SCHLUESSEL,
  QUELLE_AKTIVIERUNG,
  PROTOKOLL_TRENNER,
  QUELLE_FEHLLAUF,
  SUMMEN_SPALTEN,
  abschneideStatus,
  bereinigeFehler,
  fehllaufMetadaten,
  istObjekt,
  leseSchluessel,
  planeSummen,
  pruefeAnfrageHerkunft,
  type SummenSpalte,
} from "@/lib/status-server";
import { randomUUID } from "crypto";

// POST — Activate an agent via Claude API
// Sends the agent's system prompt + context (recent messages) to Claude
// Records the response as a message in the bus
//
// Vertrag (Stufe 1, 05.11.2026; erweitert 06.11.2026):
//   200 → { agent_id, model, response, usage: { input_tokens, output_tokens, cost_usd, latency_ms },
//           stop_reason: string|null, abgeschnitten: boolean|null, protokoll_fehler: string|null,
//           protokoll_fehler_liste: string[] }
//   Fehler → { fehler, error } (Leser lesen fehler ?? error).
//   protokoll_fehler_liste (Gesamtprüfung 06.11.2026): jeder Protokollfehler als eigener,
//   bereinigter Eintrag; protokoll_fehler bleibt derselbe Inhalt als Text (mit PROTOKOLL_TRENNER
//   "; " verbunden). Leser nehmen die Liste: Der Text wurde dort als EIN Eintrag auf 160 Zeichen
//   gekürzt, spätere Vermerke wie "metrics-Insert" fielen weg.
//   Vor allem anderen: pruefeAnfrageHerkunft (lib/status-server.ts) — Cross-Site-POST → 403,
//   ohne Content-Type application/json → 415, vor jedem bezahlten Aufruf.
//   abgeschnitten: false nur bei stop_reason end_turn/stop_sequence, true bei jedem anderen
//   gemeldeten Grund, null ohne stop_reason (Befund R16).
//   Leere oder unlesbare Antwort → 502 mit usage; die bezahlten Tokens stehen als
//   Fehllauf-Zeile im Message Bus (metadata.source "fehllauf", Befund R8).
//   Jede Zeile mit cost_usd trägt metadata.preis_stand = PREIS_STAND_AB (lib/kosten.ts):
//   GET /api/status erkennt daran, mit welcher Preistabelle geschätzt wurde.

/** Höchstzahl bedingter Schreibversuche für die Token-Summen (Befund R22 d). */
const MAX_SUMMEN_VERSUCHE = 3;

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Einheitliche Fehlerantwort: Feld fehler; error bleibt für ältere Leser. */
function fehlerAntwort(status: number, fehler: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ...extra, fehler, error: fehler }, { status });
}

/** Alle Text-Blöcke zusammen; Sonnet 5 liefert thinking-Blöcke vor dem Text. */
function textAus(inhalt: unknown): string {
  if (!Array.isArray(inhalt)) return "";
  return inhalt
    .map((block: unknown) => {
      if (typeof block !== "object" || block === null) return "";
      const b = block as { type?: unknown; text?: unknown };
      return b.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .join("");
}

/** Kurzer, bereinigter Grund aus einer Fehlerantwort der Claude-API. */
function claudeFehlerText(daten: unknown): string {
  if (!istObjekt(daten)) return "";
  const fehler = istObjekt(daten.error) ? daten.error : null;
  if (fehler) {
    const teile = [fehler.type, fehler.message].filter((t): t is string => typeof t === "string" && t !== "");
    if (teile.length > 0) return bereinigeFehler(teile.join(": "));
  }
  return bereinigeFehler(JSON.stringify(daten));
}

/** Protokoll-Fehler sammeln: bereinigt ins Server-Log und in protokoll_fehler der Antwort. */
function vermerke(fehler: string[], agentId: string, text: string): void {
  console.error(`[activate] ${text} (agent=${agentId})`);
  fehler.push(text);
}

/**
 * Schreibvorgang prüfen statt das Ergebnis zu verwerfen — Stufe 1 (05.11.2026).
 * Fehler gehen bereinigt ins Server-Log und in protokoll_fehler der Antwort (Befund R17).
 */
async function protokolliere(
  was: string,
  agentId: string,
  fehler: string[],
  aktion: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  try {
    const { error } = await aktion();
    if (error) vermerke(fehler, agentId, `${was}: ${bereinigeFehler(error)}`);
  } catch (e) {
    vermerke(fehler, agentId, `${was}: ${bereinigeFehler(e)}`);
  }
}

/**
 * Token-Summen fortschreiben, ohne parallele Läufe zu verlieren (Befund R22 d, 06.11.2026):
 * Das Update trifft die Zeile nur, wenn die Summen noch die gelesenen Werte haben (null per
 * IS NULL). Trifft es keine Zeile, wird neu gelesen; höchstens MAX_SUMMEN_VERSUCHE Versuche.
 * Gelingt es nicht, wird nichts überschrieben und protokoll_fehler gesetzt.
 * true = Summen und felder sind geschrieben.
 */
async function schreibeSummen(
  supabase: ServiceClient,
  agentId: string,
  gelesen: Record<string, unknown>,
  zuwachs: Record<SummenSpalte, number>,
  felder: Record<string, unknown>,
  fehler: string[],
): Promise<boolean> {
  let alt = gelesen;
  for (let versuch = 1; versuch <= MAX_SUMMEN_VERSUCHE; versuch++) {
    const plan = planeSummen(alt, zuwachs);
    if (!plan.ok) {
      vermerke(fehler, agentId, `agents: Token-Summen nicht fortgeschrieben — ${plan.grund}`);
      return false;
    }
    let abfrage = supabase
      .from("agents")
      .update({ ...felder, ...plan.neu })
      .eq("id", agentId);
    for (const b of plan.bedingungen) {
      abfrage = b.alt === null ? abfrage.is(b.spalte, null) : abfrage.eq(b.spalte, b.alt);
    }
    let ergebnis: { data: unknown; error: { message: string } | null };
    try {
      ergebnis = await abfrage.select("id");
    } catch (e) {
      vermerke(fehler, agentId, `agents-Update: ${bereinigeFehler(e)}`);
      return false;
    }
    if (ergebnis.error) {
      vermerke(fehler, agentId, `agents-Update: ${bereinigeFehler(ergebnis.error)}`);
      return false;
    }
    if (!Array.isArray(ergebnis.data)) {
      // Nicht erkennbar, ob geschrieben wurde: kein zweiter Versuch, sonst droht Doppelzählung.
      vermerke(fehler, agentId, "agents-Update: Ergebnis nicht prüfbar — Token-Summen möglicherweise nicht fortgeschrieben");
      return false;
    }
    if (ergebnis.data.length > 0) return true;
    if (versuch === MAX_SUMMEN_VERSUCHE) break;

    // Keine Zeile getroffen: die Summen wurden seit dem Lesen geändert. Neu lesen.
    const frisch = await supabase
      .from("agents")
      .select(SUMMEN_SPALTEN.join(", "))
      .eq("id", agentId)
      .maybeSingle();
    if (frisch.error) {
      vermerke(fehler, agentId, `agents: Summen nicht neu lesbar — ${bereinigeFehler(frisch.error)}`);
      return false;
    }
    if (!istObjekt(frisch.data)) {
      vermerke(fehler, agentId, "agents: Zeile beim erneuten Lesen nicht gefunden — Token-Summen nicht fortgeschrieben");
      return false;
    }
    alt = frisch.data;
  }
  vermerke(
    fehler,
    agentId,
    `agents: Token-Summen nicht fortgeschrieben — Zeile wurde in ${MAX_SUMMEN_VERSUCHE} Versuchen jeweils gleichzeitig geändert`,
  );
  return false;
}

function optionalerText(wert: unknown): { ok: true; text: string | null } | { ok: false } {
  if (wert === undefined || wert === null) return { ok: true, text: null };
  if (typeof wert !== "string") return { ok: false };
  return { ok: true, text: wert.trim() ? wert : null };
}

/** protokoll_fehler (Text) und protokoll_fehler_liste (Einträge) für die Antwort. */
function protokollFelder(fehler: string[]): { protokoll_fehler: string | null; protokoll_fehler_liste: string[] } {
  return { protokoll_fehler: fehler.length > 0 ? fehler.join(PROTOKOLL_TRENNER) : null, protokoll_fehler_liste: [...fehler] };
}

export async function POST(request: NextRequest) {
  // Gesamtprüfung 06.11.2026: fremde Herkunft oder kein JSON → abgelehnt, vor allem anderen.
  const sperre = pruefeAnfrageHerkunft(request.headers);
  if (sperre) return fehlerAntwort(sperre.status, sperre.fehler);

  // Befund R17: Schlüssel mit CR, LF oder NUL schon hier ablehnen (feste Meldung, kein Wert).
  const schluessel = leseSchluessel(ANTHROPIC_SCHLUESSEL);
  if (!schluessel.ok) return fehlerAntwort(500, schluessel.meldung);

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fehlerAntwort(400, "Ungültiger JSON-Body");
    }
    const b = istObjekt(body) ? body : {};
    const agentId = b.agent_id;
    if (typeof agentId !== "string" || !agentId) {
      return fehlerAntwort(400, "agent_id fehlt");
    }
    const task = optionalerText(b.task);
    const context = optionalerText(b.context);
    if (!task.ok || !context.ok) {
      return fehlerAntwort(400, "task und context müssen Text sein");
    }
    // Stufe 1 (05.11.2026): Zuordnung zum Auftrag der Auftragszeile; nur UUID, sonst ignoriert.
    const auftragId = istAuftragId(b.auftrag_id) ? b.auftrag_id.toLowerCase() : null;

    const agentPrompt = getAgentPrompt(agentId);
    if (!agentPrompt) {
      return fehlerAntwort(404, `Kein System-Prompt für Agent „${agentId}“ konfiguriert`);
    }

    // Vor dem bezahlten Aufruf: fehlt der Service-Key, wirft das hier und nicht danach.
    const supabase = createServiceClient();

    // Get agent info — Lesefehler ist nicht "nicht gefunden".
    const { data: agent, error: agentFehler } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .maybeSingle();
    if (agentFehler) {
      const grund = bereinigeFehler(agentFehler);
      console.error(`[activate] Agent nicht lesbar (agent=${agentId}): ${grund}`);
      return fehlerAntwort(502, `Agent nicht lesbar: ${grund}`);
    }
    if (!istObjekt(agent)) {
      return fehlerAntwort(404, `Agent nicht gefunden: ${agentId}`);
    }
    const rolle = typeof agent.role === "string" ? agent.role : null;

    // Get recent messages involving this agent (for context)
    const { data: recentMessages, error: kontextFehler } = await supabase
      .from("messages")
      .select("*")
      .or(`from_agent.eq.${agentId},to_agents.cs.{${agentId}}`)
      .order("created_at", { ascending: false })
      .limit(10);
    if (kontextFehler) {
      console.error(`[activate] Kontext nicht lesbar (agent=${agentId}): ${bereinigeFehler(kontextFehler)}`);
    }

    // Build context from recent messages — Fehllauf-Zeilen sind Protokoll, kein Kontext.
    const messageContext = (recentMessages ?? [])
      .filter((m) => !(istObjekt(m.metadata) && m.metadata.source === QUELLE_FEHLLAUF))
      .reverse()
      .map((m) => {
        const text = typeof m.content === "string" ? m.content : (m.content as Record<string, unknown>)?.text ?? JSON.stringify(m.content);
        const direction = m.from_agent === agentId ? "YOU SENT" : `FROM ${m.from_agent}`;
        return `[${direction}] (${m.message_type}): ${text}`;
      })
      .join("\n");

    // Build the user message
    const userMessage = task.text
      ? task.text
      : context.text
        ? context.text
        : messageContext
          ? `Here are your recent messages on the bus:\n\n${messageContext}\n\nBased on this context, what is your next action? Be specific and actionable.`
          : `You have just been activated. Introduce yourself briefly and state your first priority action for Ghost Protocol. Be concise.`;

    // Call Claude API
    const startTime = Date.now();
    let claudeResponse: Response;
    try {
      claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": schluessel.wert,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: agentPrompt.model,
          max_tokens: agentPrompt.maxTokens,
          system: agentPrompt.systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
    } catch (e) {
      const grund = bereinigeFehler(e);
      console.error(`[activate] Claude nicht erreichbar (agent=${agentId}): ${grund}`);
      return fehlerAntwort(502, `Claude nicht erreichbar: ${grund}`);
    }

    if (!claudeResponse.ok) {
      const errData: unknown = await claudeResponse.json().catch(() => null);
      const detail = claudeFehlerText(errData);
      console.error(`[activate] Claude-API-Fehler HTTP ${claudeResponse.status} (agent=${agentId}): ${detail}`);
      return fehlerAntwort(502, `Claude-API-Fehler: HTTP ${claudeResponse.status}${detail ? ` — ${detail}` : ""}`);
    }

    // Ab hier ist der Aufruf bezahlt, auch wenn die Antwort unbrauchbar ist.
    let claudeData: unknown = null;
    let lesbar = true;
    try {
      claudeData = await claudeResponse.json();
    } catch {
      lesbar = false;
    }
    const d = istObjekt(claudeData) ? claudeData : null;
    const usage = d && istObjekt(d.usage) ? d.usage : {};
    const responseText = d ? textAus(d.content) : "";
    const stopReason = d && typeof d.stop_reason === "string" && d.stop_reason.trim() ? d.stop_reason : null;
    // Befund R16: false nur bei end_turn/stop_sequence, true bei jedem anderen Grund, null ohne Angabe.
    const abgeschnitten = abschneideStatus(stopReason);
    // Nicht gemeldete Tokens bleiben null — nie 0 als Platzhalter.
    const inputTokens = leseTokenZahl(usage.input_tokens);
    const outputTokens = leseTokenZahl(usage.output_tokens);
    const latencyMs = Date.now() - startTime;
    // Schätzung über die gemeinsame Preistabelle (lib/kosten.ts).
    const cost = schaetzeKostenUsd(agentPrompt.model, inputTokens, outputTokens);
    const usageAntwort = { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: cost, latency_ms: latencyMs };

    // Leere oder unlesbare Antwort ist kein Erfolg: 502, keine Aktivierung, aber eine
    // Fehllauf-Zeile mit den bezahlten Tokens (Befund R8, 06.11.2026).
    if (!responseText.trim()) {
      const grund = d ? "leere Antwort" : "Antwort von Claude nicht lesbar";
      console.error(
        `[activate] Fehllauf: ${grund} (agent=${agentId}, json_lesbar=${lesbar}, stop_reason=${stopReason}, input_tokens=${inputTokens}, output_tokens=${outputTokens}, kosten_usd_geschaetzt=${cost})`,
      );
      const fehllaufFehler: string[] = [];
      await protokolliere("messages-Insert (Fehllauf)", agentId, fehllaufFehler, () =>
        supabase.from("messages").insert({
          id: `msg-${randomUUID()}`,
          from_agent: agentId,
          from_role: rolle,
          // Empfänger leer: Protokollzeile, kein Auftrag und kein Kontext für spätere Läufe.
          to_agents: [],
          to_channels: [],
          content: {
            text: `Fehllauf: ${grund} — kein verwertbares Ergebnis${stopReason ? ` (stop_reason ${stopReason})` : ""}`,
            type: "fehllauf",
          },
          message_type: "response",
          priority: "normal",
          metadata: fehllaufMetadaten(
            {
              art: "aktivierung",
              model: agentPrompt.model,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cost_usd: cost,
              preis_stand: PREIS_STAND_AB,
              stop_reason: stopReason,
              grund,
            },
            { latency_ms: latencyMs, ...(auftragId ? { auftrag_id: auftragId } : {}) },
          ),
        }),
      );
      return fehlerAntwort(502, grund, {
        agent_id: agentId,
        model: agentPrompt.model,
        stop_reason: stopReason,
        abgeschnitten,
        usage: usageAntwort,
        ...protokollFelder(fehllaufFehler),
      });
    }

    const protokollFehler: string[] = [];
    const tokensGemessen = inputTokens !== null && outputTokens !== null && cost !== null;
    const jetzt = new Date().toISOString();
    // Befund R15: llm_model = das tatsächlich aufgerufene Modell.
    const felder = { status: "online", last_heartbeat: jetzt, llm_model: agentPrompt.model, updated_at: jetzt };

    // Update agent in Supabase — Summen nur mit gemessenen Tokens und nur bedingt (R22 d).
    let summenGeschrieben = false;
    if (tokensGemessen) {
      summenGeschrieben = await schreibeSummen(
        supabase,
        agentId,
        agent,
        { total_input_tokens: inputTokens, total_output_tokens: outputTokens, total_cost_usd: cost },
        felder,
        protokollFehler,
      );
    } else {
      vermerke(protokollFehler, agentId, "agents: Token-Summen nicht fortgeschrieben — usage fehlt in der Claude-Antwort");
    }
    if (!summenGeschrieben) {
      // Ohne Summen kann nichts verloren gehen: Status, Zeit und Modell trotzdem schreiben.
      await protokolliere("agents-Update", agentId, protokollFehler, () =>
        supabase.from("agents").update(felder).eq("id", agentId),
      );
    }

    // Log response as a message on the bus
    await protokolliere("messages-Insert", agentId, protokollFehler, () =>
      supabase.from("messages").insert({
        id: `msg-${randomUUID().slice(0, 8)}`,
        from_agent: agentId,
        from_role: rolle,
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
          preis_stand: PREIS_STAND_AB,
          latency_ms: latencyMs,
          stop_reason: stopReason,
          source: QUELLE_AKTIVIERUNG,
          ...(auftragId ? { auftrag_id: auftragId } : {}),
        },
      }),
    );

    // Log metric — ohne eigene id (metrics.id ist BIGSERIAL), value ist NOT NULL.
    if (cost === null) {
      protokollFehler.push("metrics: keine Zeile geschrieben — Kosten nicht gemessen (usage fehlt)");
    } else {
      await protokolliere("metrics-Insert", agentId, protokollFehler, () =>
        supabase.from("metrics").insert({
          agent_id: agentId,
          metric_type: "llm_call",
          value: cost,
          metadata: {
            model: agentPrompt.model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            latency_ms: latencyMs,
            preis_stand: PREIS_STAND_AB,
          },
        }),
      );
    }

    return NextResponse.json({
      agent_id: agentId,
      model: agentPrompt.model,
      response: responseText,
      usage: usageAntwort,
      stop_reason: stopReason,
      abgeschnitten,
      ...protokollFelder(protokollFehler),
    });
  } catch (err) {
    const grund = bereinigeFehler(err);
    console.error(`[activate] unerwarteter Fehler: ${grund}`);
    return fehlerAntwort(500, grund);
  }
}
