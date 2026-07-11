import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionSecret, signSession } from "@/lib/auth";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
// Kein schwacher Default mehr — ohne gesetztes CRON_SECRET ist der Endpunkt
// deaktiviert (fail-closed).
const CRON_SECRET = process.env.CRON_SECRET;

// Interner Server-zu-Server-Call: gültiges, signiertes Session-Cookie erzeugen
// (ersetzt das frühere statische "gp-auth=authenticated").
async function internalCookie(): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) return "";
  return `${SESSION_COOKIE}=${await signSession(secret)}`;
}

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
  if (lower.includes("krypto") || lower.includes("trading") || lower.includes("bitcoin") || lower.includes("elliott") || lower.includes("fear") || lower.includes("greed")) {
    return "krypto_trading";
  }
  if (lower.includes("business") || lower.includes("automat") || lower.includes("workflow") || lower.includes("stack") || lower.includes("tool")) {
    return "business_automation";
  }
  if (lower.includes("ghost") || lower.includes("behind") || lower.includes("gelernt")) {
    return "ghost_protocol";
  }
  return "ki_automation";
}

// GET /api/content/auto-produce?secret=ghost-cron-2026
// Produziert automatisch das Content-Piece des Tages aus dem Launch-Kalender
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
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

  // Kalender laden (interner Call → signiertes Cookie mitsenden)
  const calendarRes = await fetch(`${BASE_URL}/api/content/pipeline`, {
    headers: { Cookie: await internalCookie() },
  });
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
      Cookie: await internalCookie(),
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
