import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET || "ghost-cron-2026";

async function activateAgent(agentId: string, task: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/agents/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "gp-auth=authenticated",
    },
    body: JSON.stringify({ agent_id: agentId, task }),
  });
  if (!res.ok) return `ERROR: ${res.status}`;
  const data = await res.json();
  return data.response ?? "";
}

// GET /api/cron/briefing?type=morning&secret=ghost-cron-2026
// Called by external cron (Coolify/systemd timer) or manual trigger
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get("type") ?? "morning";
  const results: Record<string, string> = {};

  if (type === "morning") {
    // ═══ MORNING BRIEFING (08:00 CET, Mo-Fr) ═══
    results.oracle = await activateAgent(
      "oracle",
      `MORNING BRIEFING ${new Date().toLocaleDateString("de-DE")}:
Scanne die wichtigsten KI- und Krypto-Entwicklungen.
Liefere in maximal 200 Wörtern:
1. Top-3 relevante News für Ghost Protocol (KI-Automation, Krypto, Business)
2. Marktsentiment: BULLISH / BEARISH / NEUTRAL mit Begründung
3. 2 Content-Ideen die sich aus den News ergeben (mit Plattform-Empfehlung)
Keine Floskeln. Fakten zuerst.`
    );

    results.donna = await activateAgent(
      "donna",
      `MORNING BRIEFING ${new Date().toLocaleDateString("de-DE")}:
Tagesplanung für Ghost Protocol. Erstelle eine priorisierte Liste:
1. Welcher Content ist heute laut Redaktionsplan fällig? (Wochentag beachten)
2. Welche Agents müssen dafür aktiviert werden?
3. Gibt es offene Tasks oder Blocker?
Maximal 5 Punkte, sortiert nach Priorität. Jeder Punkt mit klarer Aktion.`
    );
  } else if (type === "evening") {
    // ═══ EVENING SUMMARY (18:00 CET, Mo-Fr) ═══
    results.treasurer = await activateAgent(
      "treasurer",
      `EVENING SUMMARY ${new Date().toLocaleDateString("de-DE")}:
Tagesabschluss-Report:
1. Geschätzte API-Kosten heute (basierend auf Agent-Aktivierungen)
2. Content-Output: Wie viele Pieces wurden heute produziert?
3. Fortschritt Richtung Break-Even und €10k MRR
Maximal 100 Wörter. Zahlen vor Prosa.`
    );

    results.strategist = await activateAgent(
      "strategist",
      `EVENING SUMMARY ${new Date().toLocaleDateString("de-DE")}:
Strategischer Tagesabschluss:
1. Was wurde heute erreicht? (Content, Growth, Infrastruktur)
2. Eine strategische Entscheidung für morgen
3. Fortschritt zum Wochenziel in Prozent
Maximal 100 Wörter. Entscheidung statt Analyse.`
    );
  } else {
    return NextResponse.json({ error: "type must be 'morning' or 'evening'" }, { status: 400 });
  }

  return NextResponse.json({
    type,
    timestamp: new Date().toISOString(),
    agents: Object.keys(results),
    results,
  });
}
