import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET || "ghost-cron-2026";

// Mapping: Wochentag (Mo-Fr) → Kalender-Key
const DAY_MAP: Record<number, string> = {
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
};

// Woche berechnen (relativ zum Launch-Datum)
function getCurrentWeek(launchDate: string): number {
  const launch = new Date(launchDate);
  const now = new Date();
  const diffMs = now.getTime() - launch.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(4, (diffWeeks % 4) + 1)); // Zyklisch 1-4
}

// Kategorie aus Topic erraten
function guessCategory(topic: string): string {
  const lower = topic.toLowerCase();
  if (lower.includes("krypto") || lower.includes("trading") || lower.includes("bitcoin") || lower.includes("elliott")) {
    return "krypto_trading";
  }
  if (lower.includes("business") || lower.includes("automat") || lower.includes("workflow")) {
    return "business_automation";
  }
  if (lower.includes("ghost") || lower.includes("behind")) {
    return "ghost_protocol";
  }
  return "ki_automation";
}

// GET /api/content/auto-produce?secret=ghost-cron-2026
// Produziert automatisch das Content-Piece des Tages aus dem Launch-Kalender
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Launch-Datum (konfigurierbar, default: nächster Montag als Referenz)
  const launchDate = process.env.CONTENT_LAUNCH_DATE || "2026-04-07";
  const dryRun = request.nextUrl.searchParams.get("dry") === "true";

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=So, 1=Mo, ..., 5=Fr, 6=Sa

  // Nur Mo-Fr produzieren
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({
      status: "skipped",
      reason: "Wochenende — kein Content geplant",
      day: now.toLocaleDateString("de-DE", { weekday: "long" }),
    });
  }

  const dayKey = DAY_MAP[dayOfWeek];
  const weekNum = getCurrentWeek(launchDate);
  const weekKey = `week${weekNum}`;

  // Kalender laden
  const calendarRes = await fetch(`${BASE_URL}/api/content/pipeline`);
  if (!calendarRes.ok) {
    return NextResponse.json({ error: "Kalender nicht erreichbar" }, { status: 500 });
  }
  const calendarData = await calendarRes.json();
  const weekData = calendarData.launch_calendar?.[weekKey];

  if (!weekData) {
    return NextResponse.json({ error: `Woche ${weekKey} nicht im Kalender` }, { status: 404 });
  }

  const todayEntry = weekData[dayKey];
  if (!todayEntry) {
    return NextResponse.json({ error: `Kein Eintrag für ${dayKey} in ${weekKey}` }, { status: 404 });
  }

  const { platform, format, topic } = todayEntry;
  const category = guessCategory(topic);

  // Dry-Run: Nur zeigen was produziert würde
  if (dryRun) {
    return NextResponse.json({
      status: "dry_run",
      date: now.toISOString(),
      week: weekNum,
      weekTheme: weekData.theme,
      day: dayKey,
      scheduled: { platform, format, topic, category },
      message: "Dry-Run — kein Content produziert. Entferne ?dry=true für echte Produktion.",
    });
  }

  // Content-Pipeline starten
  const pipelineRes = await fetch(`${BASE_URL}/api/content/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "gp-auth=authenticated",
    },
    body: JSON.stringify({ topic, platform, format, category }),
  });

  if (!pipelineRes.ok) {
    const err = await pipelineRes.json().catch(() => ({}));
    return NextResponse.json({
      status: "error",
      scheduled: { platform, format, topic, category },
      error: err,
    }, { status: 500 });
  }

  const result = await pipelineRes.json();

  return NextResponse.json({
    status: result.status === "complete" ? "produced" : "partial",
    date: now.toISOString(),
    week: weekNum,
    weekTheme: weekData.theme,
    day: dayKey,
    scheduled: { platform, format, topic, category },
    pipeline: {
      completed: result.summary?.completed,
      cost: result.summary?.total_cost_usd,
      duration_ms: result.summary?.total_duration_ms,
    },
    // Finalen Content (PUBLISHER Output) als Hauptergebnis
    content: result.steps?.find((s: { agent: string }) => s.agent === "publisher")?.output?.slice(0, 2000),
  });
}
