import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Content-First Pipeline: RESEARCHER → SCRIBE → PUBLISHER → AMPLIFIER
// Orchestriert die 4-Agent-Kette für einen Content-Piece

interface PipelineRequest {
  topic: string;
  platform: "youtube" | "twitter" | "newsletter";
  format: "longform" | "short" | "thread" | "deep_dive" | "newsletter_issue";
  category: "ki_automation" | "krypto_trading" | "business_automation" | "ghost_protocol";
}

interface PipelineStep {
  agent: string;
  status: "pending" | "running" | "done" | "error";
  output?: string;
  cost?: number;
  duration_ms?: number;
}

// Activate an agent via internal API call
async function activateAgent(
  agentId: string,
  task: string,
  cookie: string
): Promise<{ response: string; cost: number; duration_ms: number }> {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/agents/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ agent_id: agentId, task }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Agent ${agentId} failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return {
    response: data.response ?? "",
    cost: data.usage?.cost_usd ?? 0,
    duration_ms: Date.now() - start,
  };
}

// POST — Run full content pipeline for a topic
export async function POST(request: NextRequest) {
  try {
    const body: PipelineRequest = await request.json();
    const { topic, platform, format, category } = body;

    if (!topic || !platform || !format) {
      return NextResponse.json(
        { error: "topic, platform, and format are required" },
        { status: 400 }
      );
    }

    const cookie = request.headers.get("cookie") ?? "";
    const steps: PipelineStep[] = [
      { agent: "researcher", status: "pending" },
      { agent: "scribe", status: "pending" },
      { agent: "publisher", status: "pending" },
      { agent: "amplifier", status: "pending" },
    ];

    let totalCost = 0;

    // ═══ STEP 1: RESEARCHER — Recherche & Fakten ═══
    steps[0].status = "running";
    const platformLabel = { youtube: "YouTube-Video", twitter: "X/Twitter-Thread", newsletter: "Newsletter-Ausgabe" }[platform];
    const formatLabel = { longform: "Longform (8-12 Min)", short: "Short (60 Sek)", thread: "Thread (5-8 Posts)", deep_dive: "Deep Dive (15+ Min)", newsletter_issue: "Newsletter-Ausgabe" }[format];
    const categoryLabel = { ki_automation: "KI & Automation", krypto_trading: "Krypto-Trading & DeFi", business_automation: "Business-Automation", ghost_protocol: "Ghost Protocol Behind-the-Scenes" }[category];

    try {
      const research = await activateAgent(
        "researcher",
        `RESEARCH-AUFTRAG: Recherchiere das Thema "${topic}" für ein ${platformLabel} im Format ${formatLabel}, Kategorie: ${categoryLabel}.

Liefere:
1. 5 Kernfakten mit Quellen (Studien, Statistiken, Experten-Zitate)
2. 3 kontroverse oder überraschende Perspektiven (Hook-Material)
3. Aktuelle Entwicklungen der letzten 30 Tage
4. 3 konkrete Beispiele oder Case Studies
5. SEO-Keywords (5 Stück) für ${platform}

Format: Strukturierte Bullet-Points, deutsch. Keine Floskeln, nur Fakten.`,
        cookie
      );
      steps[0].status = "done";
      steps[0].output = research.response;
      steps[0].cost = research.cost;
      steps[0].duration_ms = research.duration_ms;
      totalCost += research.cost;
    } catch (err) {
      steps[0].status = "error";
      steps[0].output = err instanceof Error ? err.message : "Unknown error";
    }

    // ═══ STEP 2: SCRIBE — Content schreiben ═══
    if (steps[0].status === "done") {
      steps[1].status = "running";
      const platformInstructions: Record<string, string> = {
        youtube: `Schreibe ein YouTube-Skript (${formatLabel}):
- Hook (erste 5 Sekunden, pattern interrupt)
- Intro (Problem + Versprechen, 30 Sek)
- 3-5 Hauptpunkte mit Übergängen
- CTA (Subscribe, Kommentar-Frage)
- Outro mit Teaser für nächstes Video
- [B-ROLL] und [GRAFIK] Markierungen für Schnitt
- Thumbnail-Titel-Vorschlag (max 60 Zeichen, neugierig machend)`,
        twitter: `Schreibe einen X/Twitter-Thread (${formatLabel}):
- Tweet 1: Hook mit Zahl oder provokanter These (max 280 Zeichen)
- Tweet 2-6: Hauptpunkte, jeder Tweet eigenständig lesbar
- Vorletzter Tweet: Zusammenfassung + Key Takeaway
- Letzter Tweet: CTA (Follow + Retweet-Bitte)
- Jeder Tweet: Max 280 Zeichen, Emoji sparsam (max 1 pro Tweet)
- Verwende Thread-Nummering: 1/ 2/ 3/ etc.`,
        newsletter: `Schreibe eine Newsletter-Ausgabe (${formatLabel}):
- Betreffzeile (max 50 Zeichen, Öffnungsrate-optimiert)
- Preview-Text (max 90 Zeichen)
- Begrüßung (persönlich, kurz)
- 1 Hauptthema (3-4 Absätze, storytelling)
- 3 Quick-Links/News (je 2 Sätze)
- 1 Tool/Ressource der Woche
- CTA (Antworten, Weiterleiten, Upgrade)
- P.S. mit persönlicher Note`,
      };

      try {
        const content = await activateAgent(
          "scribe",
          `CONTENT-PRODUKTION: Schreibe Content zum Thema "${topic}".

PLATTFORM: ${platformLabel}
KATEGORIE: ${categoryLabel}

RECHERCHE-ERGEBNISSE (von RESEARCHER):
${steps[0].output}

ANWEISUNGEN:
${platformInstructions[platform]}

STILREGELN:
- Tonalität: Professionell aber zugänglich, keine Corporate-Sprache
- Zielgruppe: Tech-affine Professionals, 25-45 Jahre, DACH-Raum
- Sprache: Deutsch, Anglizismen erlaubt bei Fachbegriffen
- Ghost Protocol NICHT erwähnen (Agenten sind unsichtbar)
- Brandname für extern: "AI Insider" (Arbeitstitel)

Liefere den fertigen Content, sofort publishbar.`,
          cookie
        );
        steps[1].status = "done";
        steps[1].output = content.response;
        steps[1].cost = content.cost;
        steps[1].duration_ms = content.duration_ms;
        totalCost += content.cost;
      } catch (err) {
        steps[1].status = "error";
        steps[1].output = err instanceof Error ? err.message : "Unknown error";
      }
    }

    // ═══ STEP 3: PUBLISHER — Formatierung & Scheduling ═══
    if (steps[1].status === "done") {
      steps[2].status = "running";
      try {
        const published = await activateAgent(
          "publisher",
          `PUBLISHING-AUFTRAG: Bereite diesen Content für die Veröffentlichung vor.

PLATTFORM: ${platform}
FORMAT: ${format}

CONTENT (von SCRIBE):
${steps[1].output}

AUFGABEN:
1. Qualitätsprüfung: Fakten-Check, Ton, Länge
2. SEO-Optimierung: Title Tags, Description, Hashtags
3. Scheduling-Empfehlung: Bester Zeitpunkt für ${platform} (DACH-Zielgruppe)
4. Thumbnail/Preview: Beschreibung für visuelles Asset
5. Cross-Promotion: Wie kann dieser Content auf den anderen Plattformen angeteasert werden?

Liefere:
- Finaler Content (mit deinen Korrekturen)
- Metadaten (Title, Description, Tags, Hashtags)
- Publishing-Zeitpunkt (Tag + Uhrzeit, DACH-optimiert)
- Cross-Promotion-Posts (1 Tweet, 1 Newsletter-Teaser)`,
          cookie
        );
        steps[2].status = "done";
        steps[2].output = published.response;
        steps[2].cost = published.cost;
        steps[2].duration_ms = published.duration_ms;
        totalCost += published.cost;
      } catch (err) {
        steps[2].status = "error";
        steps[2].output = err instanceof Error ? err.message : "Unknown error";
      }
    }

    // ═══ STEP 4: AMPLIFIER — Distribution-Plan ═══
    if (steps[2].status === "done") {
      steps[3].status = "running";
      try {
        const amplified = await activateAgent(
          "amplifier",
          `AMPLIFICATION-AUFTRAG: Erstelle den Distribution-Plan für diesen Content.

PLATTFORM: ${platform}
THEMA: ${topic}

PUBLISHER-OUTPUT:
${steps[2].output}

AUFGABEN:
1. Distribution-Timeline: Wann wo posten (7-Tage-Plan)
2. Engagement-Strategie: Kommentar-Antworten, Community-Posts, Repurposing
3. Hashtag-Strategie: 5 primäre + 5 sekundäre Hashtags
4. Influencer-Outreach: 3 Accounts zum Taggen/Mentionieren (deutsch, KI/Tech-Nische)
5. Repurposing: Wie wird der ${platformLabel} zu Content für die anderen 2 Plattformen?
6. KPI-Ziele: Views, Engagement-Rate, Follower-Growth (7-Tage-Ziel)

Liefere einen konkreten Aktionsplan mit Zeitpunkten.`,
          cookie
        );
        steps[3].status = "done";
        steps[3].output = amplified.response;
        steps[3].cost = amplified.cost;
        steps[3].duration_ms = amplified.duration_ms;
        totalCost += amplified.cost;
      } catch (err) {
        steps[3].status = "error";
        steps[3].output = err instanceof Error ? err.message : "Unknown error";
      }
    }

    const totalDuration = steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
    const completedSteps = steps.filter((s) => s.status === "done").length;

    return NextResponse.json({
      pipeline: "content-first",
      topic,
      platform,
      format,
      category,
      status: completedSteps === 4 ? "complete" : "partial",
      steps,
      summary: {
        total_cost_usd: Math.round(totalCost * 100000) / 100000,
        total_duration_ms: totalDuration,
        completed: `${completedSteps}/4`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET — Pipeline status and available options
export async function GET() {
  return NextResponse.json({
    pipeline: "content-first",
    description: "RESEARCHER → SCRIBE → PUBLISHER → AMPLIFIER",
    platforms: ["youtube", "twitter", "newsletter"],
    formats: {
      youtube: ["longform", "short", "deep_dive"],
      twitter: ["thread"],
      newsletter: ["newsletter_issue"],
    },
    categories: ["ki_automation", "krypto_trading", "business_automation", "ghost_protocol"],
    estimated_cost_per_piece: {
      youtube_longform: "$0.04-0.08 (4 Sonnet calls)",
      twitter_thread: "$0.02-0.04 (2 Sonnet + 2 Haiku)",
      newsletter: "$0.03-0.06 (4 mixed calls)",
    },
    launch_calendar: getLaunchCalendar(),
  });
}

// 4-Wochen Launch-Kalender
function getLaunchCalendar() {
  return {
    week1: {
      theme: "Launch & Grundlagen",
      monday: { platform: "twitter", format: "thread", topic: "Was ist eine Autonome KI-Corporation? 5 Dinge die du wissen musst" },
      tuesday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #1 — Warum KI-Agenten die nächste Revolution sind" },
      wednesday: { platform: "twitter", format: "thread", topic: "Die 3 größten Fehler beim Einsatz von KI im Business" },
      thursday: { platform: "youtube", format: "longform", topic: "KI-Agenten erklärt: So automatisierst du dein Business in 2026" },
      friday: { platform: "twitter", format: "thread", topic: "5 KI-Tools die ich täglich nutze (mit Alternativen)" },
    },
    week2: {
      theme: "Krypto & Trading",
      monday: { platform: "twitter", format: "thread", topic: "Wie KI den Krypto-Markt verändert — Daten statt Bauchgefühl" },
      tuesday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #2 — Algorithmic Trading: Mythos vs Realität" },
      wednesday: { platform: "youtube", format: "short", topic: "In 60 Sekunden: Was ist Elliott Wave Trading?" },
      thursday: { platform: "youtube", format: "longform", topic: "Auto-Trading mit KI: So baut man ein profitables System" },
      friday: { platform: "twitter", format: "thread", topic: "Fear & Greed Index: Warum die Masse immer falsch liegt" },
    },
    week3: {
      theme: "Business Automation",
      monday: { platform: "twitter", format: "thread", topic: "Ich habe 17 KI-Agenten gebaut — das passiert wenn sie zusammenarbeiten" },
      tuesday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #3 — Der 50€/Monat Autopilot: Realistischer KI-Stack" },
      wednesday: { platform: "youtube", format: "short", topic: "Claude vs GPT-4: Welche KI für welchen Use Case?" },
      thursday: { platform: "youtube", format: "longform", topic: "Von 0 auf automatisiert: KI-Workflows die wirklich funktionieren" },
      friday: { platform: "twitter", format: "thread", topic: "Die Zukunft der Arbeit: 5 Jobs die KI bis 2028 übernimmt" },
    },
    week4: {
      theme: "Deep Dives & Community",
      monday: { platform: "twitter", format: "thread", topic: "Open Source KI: Die besten Self-Hosted Alternativen 2026" },
      tuesday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #4 — Premium Launch: Was kommt als Nächstes" },
      wednesday: { platform: "youtube", format: "deep_dive", topic: "Deep Dive: Wie Reinforcement Learning Trading-Strategien optimiert" },
      thursday: { platform: "youtube", format: "short", topic: "3 KI-Automatisierungen die du HEUTE starten kannst" },
      friday: { platform: "twitter", format: "thread", topic: "Was ich in 4 Wochen KI-Content gelernt habe (Zahlen & Learnings)" },
    },
  };
}
