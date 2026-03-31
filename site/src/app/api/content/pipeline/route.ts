import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Content-First Pipeline: RESEARCHER → SCRIBE → PUBLISHER → AMPLIFIER
// Orchestriert die 4-Agent-Kette für einen Content-Piece

interface PipelineRequest {
  topic: string;
  platform: "youtube" | "twitter" | "newsletter" | "tiktok" | "instagram";
  format: "longform" | "short" | "thread" | "deep_dive" | "newsletter_issue" | "tiktok_short" | "reel" | "carousel" | "story";
  category: "ki_automation" | "krypto_trading" | "business_automation" | "ghost_protocol";
  repurpose_from?: string; // Original-Content für Repurposing
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
    const platformLabel: Record<string, string> = { youtube: "YouTube-Video", twitter: "X/Twitter-Thread", newsletter: "Newsletter-Ausgabe", tiktok: "TikTok-Video", instagram: "Instagram-Post" };
    const formatLabel: Record<string, string> = { longform: "Longform (8-12 Min)", short: "Short (60 Sek)", thread: "Thread (5-8 Posts)", deep_dive: "Deep Dive (15+ Min)", newsletter_issue: "Newsletter-Ausgabe", tiktok_short: "TikTok Short (30-60 Sek)", reel: "Reel (30-90 Sek)", carousel: "Carousel (5-10 Slides)", story: "Story (15 Sek Clips)" };
    const categoryLabel: Record<string, string> = { ki_automation: "KI & Automation", krypto_trading: "Krypto-Trading & DeFi", business_automation: "Business-Automation", ghost_protocol: "Ghost Protocol Behind-the-Scenes" };

    try {
      const research = await activateAgent(
        "researcher",
        `RESEARCH-AUFTRAG: Recherchiere das Thema "${topic}" für ein ${platformLabel[platform]} im Format ${formatLabel[format]}, Kategorie: ${categoryLabel[category]}.

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
        youtube: `Schreibe ein YouTube-Skript (${formatLabel[format]}):
- Hook (erste 5 Sekunden, pattern interrupt)
- Intro (Problem + Versprechen, 30 Sek)
- 3-5 Hauptpunkte mit Übergängen
- CTA (Subscribe, Kommentar-Frage)
- Outro mit Teaser für nächstes Video
- [B-ROLL] und [GRAFIK] Markierungen für Schnitt
- Thumbnail-Titel-Vorschlag (max 60 Zeichen, neugierig machend)`,
        twitter: `Schreibe einen X/Twitter-Thread (${formatLabel[format]}):
- Tweet 1: Hook mit Zahl oder provokanter These (max 280 Zeichen)
- Tweet 2-6: Hauptpunkte, jeder Tweet eigenständig lesbar
- Vorletzter Tweet: Zusammenfassung + Key Takeaway
- Letzter Tweet: CTA (Follow + Retweet-Bitte)
- Jeder Tweet: Max 280 Zeichen, Emoji sparsam (max 1 pro Tweet)
- Verwende Thread-Nummering: 1/ 2/ 3/ etc.`,
        newsletter: `Schreibe eine Newsletter-Ausgabe (${formatLabel[format]}):
- Betreffzeile (max 50 Zeichen, Öffnungsrate-optimiert)
- Preview-Text (max 90 Zeichen)
- Begrüßung (persönlich, kurz)
- 1 Hauptthema (3-4 Absätze, storytelling)
- 3 Quick-Links/News (je 2 Sätze)
- 1 Tool/Ressource der Woche
- CTA (Antworten, Weiterleiten, Upgrade)
- P.S. mit persönlicher Note`,
        tiktok: `Schreibe ein TikTok-Skript (${formatLabel[format]}):
- Hook (erste 1-2 Sekunden, provokant oder überraschend — "Das hat mir niemand gesagt über...")
- Problem/Trigger (3-5 Sek, relateable Pain Point)
- 3 Quick-Punkte (je 5-8 Sek, schnell geschnitten)
- Twist/Überraschung (unerwartete Perspektive)
- CTA (Follow + Kommentar-Frage, "Speichern wenn hilfreich")
- [TEXTOVERLAY] Markierungen für On-Screen-Text
- [TRANSITION] Markierungen für Schnitt-Effekte
- Trending Sounds Vorschlag (Kategorie: educational/tech)
- Hashtags: 3-5 Stück (#KI #Automation #TechTok #LernenMitTikTok)
- Max 60 Sekunden Gesamtlänge, schnelles Pacing
- Tonalität: Energisch, direkt, Gen-Z-kompatibel aber nicht cringe`,
        instagram: `Schreibe einen Instagram-Post (${formatLabel[format]}):
${format === "carousel" ? `CAROUSEL (5-10 Slides):
- Slide 1: Hook-Titel (max 8 Wörter, groß, bold — macht neugierig)
- Slide 2: Problem/Kontext (1 Satz + Icon/Grafik-Anweisung)
- Slide 3-8: Hauptpunkte (1 Punkt pro Slide, kurz, visuell)
- Slide 9: Zusammenfassung/Key Takeaway
- Slide 10: CTA ("Speichern ❤️ Teilen" + Profil-Verweis)
- Jede Slide: [DESIGN] Anweisung für Farben/Layout
- Design-Stil: Clean, modern, 2-3 Farben, große Schrift` :
format === "reel" ? `REEL (30-90 Sek):
- Hook (erste 1-3 Sek, visueller Pattern-Interrupt)
- 3-5 Punkte mit [B-ROLL] oder [SCREEN-RECORDING] Markierungen
- Text-Overlays für jeden Punkt (max 10 Wörter)
- Trending Audio Vorschlag
- CTA im letzten Frame ("Folgen für mehr")
- Caption: 2-3 Sätze + Hashtags (max 30)` :
`STORY-SERIE (3-5 Stories à 15 Sek):
- Story 1: Hook/Frage (Poll oder Quiz Sticker)
- Story 2-4: Hauptcontent (kurze Text-Slides oder Quick-Video)
- Story 5: CTA (Link-Sticker, "DM für mehr")
- Jede Story: [STICKER] Anweisungen (Poll, Quiz, Emoji Slider)`}
- Caption: Storytelling-Einstieg (2-3 Sätze) + Micro-CTA + Hashtags (20-30)
- Tonalität: Professionell-inspirierend, visual-first`,
      };

      try {
        const content = await activateAgent(
          "scribe",
          `CONTENT-PRODUKTION: Schreibe Content zum Thema "${topic}".

PLATTFORM: ${platformLabel[platform]}
KATEGORIE: ${categoryLabel[category]}

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
          `AMPLIFICATION-AUFTRAG: Erstelle den Distribution- und Repurposing-Plan für diesen Content.

ORIGINAL-PLATTFORM: ${platform}
THEMA: ${topic}

PUBLISHER-OUTPUT:
${steps[2].output}

ALLE 5 PLATTFORMEN: YouTube, X/Twitter, TikTok, Instagram, Newsletter

AUFGABEN:
1. Distribution-Timeline: 7-Tage-Plan über ALLE 5 Plattformen
2. Repurposing-Matrix (KRITISCH — 1→6 Strategie):
   ${platform === "youtube" ? `- YouTube Longform → 2 TikTok Shorts (Best-Of-Clips, je 30-60 Sek)
   - YouTube Longform → 1 Instagram Carousel (Key Points als Slides)
   - YouTube Longform → 1 Instagram Reel (Hook + Highlight, 60 Sek)
   - YouTube Longform → 1 X/Twitter Thread (Kernaussagen als Tweets)
   - YouTube Longform → Newsletter-Teaser (1 Absatz + Link)` :
   platform === "twitter" ? `- X Thread → 1 TikTok Short (Thread als Voiceover mit Text-Overlays)
   - X Thread → 1 Instagram Carousel (1 Tweet = 1 Slide)
   - X Thread → Newsletter Quick-Link
   - X Thread → YouTube Community Post` :
   platform === "tiktok" ? `- TikTok → Instagram Reel (Cross-Post mit angepasster Caption)
   - TikTok → YouTube Short (Cross-Post mit End-Screen)
   - TikTok → X/Twitter Post mit Video-Link
   - TikTok → Newsletter "Video der Woche"` :
   platform === "instagram" ? `- Instagram Carousel → TikTok (Slide-Slideshow mit Voiceover)
   - Instagram Carousel → X/Twitter Thread (1 Slide = 1 Tweet)
   - Instagram Reel → TikTok (Cross-Post)
   - Instagram → Newsletter Visual-Teaser` :
   `- Newsletter → 3 X/Twitter Tweets (Key Quotes)
   - Newsletter → 1 Instagram Carousel (Highlights)
   - Newsletter → 1 TikTok (Hot Take als Short)
   - Newsletter → YouTube Community Post (Teaser)`}
3. Für JEDEN Repurpose-Piece: Konkreten Content-Entwurf liefern (nicht nur Beschreibung!)
4. Hashtag-Strategie pro Plattform (plattform-spezifisch!)
5. Engagement-Strategie: Kommentar-Antworten, Community-Posts
6. Influencer-Outreach: 3 Accounts zum Taggen/Mentionieren (deutsch, KI/Tech-Nische)
7. KPI-Ziele pro Plattform (Views, Engagement-Rate, Follower-Growth, 7-Tage-Ziel)
8. Optimale Posting-Zeiten pro Plattform (DACH-Zielgruppe):
   - YouTube: Di/Do 17:00
   - X/Twitter: Mo-Fr 08:00 + 12:00
   - TikTok: Mo-Fr 18:00-20:00
   - Instagram: Di/Mi/Do 11:00 + 18:00
   - Newsletter: Di 09:00

Liefere einen konkreten Aktionsplan mit fertigen Repurpose-Entwürfen.`,
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
    description: "RESEARCHER → SCRIBE → PUBLISHER → AMPLIFIER (5 Plattformen, 1→6 Repurposing)",
    platforms: ["youtube", "twitter", "newsletter", "tiktok", "instagram"],
    formats: {
      youtube: ["longform", "short", "deep_dive"],
      twitter: ["thread"],
      newsletter: ["newsletter_issue"],
      tiktok: ["tiktok_short"],
      instagram: ["carousel", "reel", "story"],
    },
    categories: ["ki_automation", "krypto_trading", "business_automation", "ghost_protocol"],
    estimated_cost_per_piece: {
      youtube_longform: "$0.04-0.08 (4 Sonnet calls)",
      twitter_thread: "$0.02-0.04 (2 Sonnet + 2 Haiku)",
      newsletter: "$0.03-0.06 (4 mixed calls)",
      tiktok_short: "$0.02-0.04 (4 Haiku/Sonnet calls)",
      instagram_carousel: "$0.03-0.06 (4 mixed calls)",
      instagram_reel: "$0.02-0.04 (4 mixed calls)",
    },
    repurposing_strategy: {
      description: "1→6: Jedes Anchor-Piece (YouTube) wird zu 6+ Derivaten auf allen Plattformen",
      weekly_output: {
        anchor: "2 YouTube Videos/Woche",
        derivatives: "4 X-Threads + 4 Instagram Carousels + 2 Instagram Reels + 10 TikTok Shorts + 1 Newsletter = 21 Pieces",
        total: "~23 Content-Pieces/Woche",
      },
    },
    launch_calendar: getLaunchCalendar(),
  });
}

// 4-Wochen Launch-Kalender — 5 Plattformen, 1→6 Repurposing
// Strategie: 2 YouTube/Woche als Anchor → Repurposing auf alle Plattformen
// Mo: TikTok + Instagram | Di: YouTube (Anchor) + Newsletter | Mi: X-Thread + TikTok
// Do: YouTube (Anchor) + Instagram | Fr: X-Thread + TikTok
function getLaunchCalendar() {
  return {
    week1: {
      theme: "Launch & Grundlagen",
      monday: { platform: "tiktok", format: "tiktok_short", topic: "Was ist KI-Automation wirklich? Die Wahrheit in 60 Sekunden" },
      tuesday: { platform: "youtube", format: "longform", topic: "KI-Agenten erklärt: So automatisierst du dein Business in 2026" },
      wednesday: { platform: "twitter", format: "thread", topic: "Was ist eine Autonome KI-Corporation? 5 Dinge die du wissen musst" },
      thursday: { platform: "instagram", format: "carousel", topic: "Die 3 größten Fehler beim Einsatz von KI im Business" },
      friday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #1 — Warum KI-Agenten die nächste Revolution sind" },
    },
    week2: {
      theme: "Krypto & Trading",
      monday: { platform: "tiktok", format: "tiktok_short", topic: "In 60 Sekunden: Was ist Elliott Wave Trading?" },
      tuesday: { platform: "youtube", format: "longform", topic: "Auto-Trading mit KI: So baut man ein profitables System" },
      wednesday: { platform: "twitter", format: "thread", topic: "Wie KI den Krypto-Markt verändert — Daten statt Bauchgefühl" },
      thursday: { platform: "instagram", format: "carousel", topic: "Fear & Greed Index: Warum die Masse immer falsch liegt — 7 Charts" },
      friday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #2 — Algorithmic Trading: Mythos vs Realität" },
    },
    week3: {
      theme: "Business Automation",
      monday: { platform: "tiktok", format: "tiktok_short", topic: "Claude vs GPT-4: Welche KI wofür? 45-Sekunden-Vergleich" },
      tuesday: { platform: "youtube", format: "longform", topic: "Von 0 auf automatisiert: KI-Workflows die wirklich funktionieren" },
      wednesday: { platform: "twitter", format: "thread", topic: "Ich habe 17 KI-Agenten gebaut — das passiert wenn sie zusammenarbeiten" },
      thursday: { platform: "instagram", format: "carousel", topic: "Der 50€/Monat KI-Stack: 8 Tools die jedes Business braucht" },
      friday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #3 — Der 50€/Monat Autopilot: Realistischer KI-Stack" },
    },
    week4: {
      theme: "Deep Dives & Community",
      monday: { platform: "tiktok", format: "tiktok_short", topic: "3 KI-Automatisierungen die du HEUTE starten kannst" },
      tuesday: { platform: "youtube", format: "deep_dive", topic: "Deep Dive: Wie Reinforcement Learning Trading-Strategien optimiert" },
      wednesday: { platform: "twitter", format: "thread", topic: "Open Source KI: Die besten Self-Hosted Alternativen 2026" },
      thursday: { platform: "instagram", format: "carousel", topic: "Was ich in 4 Wochen KI-Content gelernt habe — Zahlen & Learnings" },
      friday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #4 — Premium Launch: Was kommt als Nächstes" },
    },
  };
}
