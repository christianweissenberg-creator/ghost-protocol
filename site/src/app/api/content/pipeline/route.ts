import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Content-First Pipeline: RESEARCHER → SCRIBE → COUNSEL → PUBLISHER → AMPLIFIER
// COUNSEL ist Pflicht-Schritt (fail-closed): ohne eindeutige Freigabe-Empfehlung
// stoppt die Pipeline, PUBLISHER/AMPLIFIER laufen NICHT.

interface PipelineRequest {
  topic?: string;
  platform: "youtube" | "twitter" | "x" | "newsletter" | "tiktok" | "instagram";
  format: "longform" | "short" | "thread" | "deep_dive" | "newsletter_issue" | "tiktok_short" | "reel" | "carousel" | "story";
  category?: "ki_automation" | "krypto_trading" | "business_automation" | "ghost_protocol";
  repurpose_from?: string; // Original-Content für Repurposing
  objekt_slug?: string; // Steinadel-Objekt (optional) — bindet Objektdaten in RESEARCHER/SCRIBE ein
}

interface PipelineStep {
  agent: string;
  status: "pending" | "running" | "done" | "error";
  output?: string;
  cost?: number;
  duration_ms?: number;
}

// Steinadel-Objekt, wie von /api/objekte geliefert (Export-API, read-only)
interface Kennzahl {
  label: string;
  wert: string;
}
interface Kampagne {
  kampagne: string;
  lpUrl: string;
  lpVariant: string;
}
interface Urls {
  objektSeite: string;
  expose: string;
  ogBild: string;
  cover: string;
}
interface ObjektApi {
  slug: string;
  name: string;
  untertitel: string;
  tagline: string;
  ort: string;
  baujahr: number;
  preis: string;
  kurzbeschreibung: string;
  statusBadge: string;
  afaProzent: number;
  istDenkmal: boolean;
  kennzahlen: Kennzahl[];
  urls: Urls;
  kampagnen: Kampagne[];
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

// Objektdaten per Slug aus der Steinadel-Export-API laden (Cookie-Weiterreichung
// wie bei activateAgent, da /api/objekte hinter der Auth-Middleware liegt)
async function fetchObjekt(slug: string, cookie: string): Promise<ObjektApi | null> {
  const res = await fetch(`${BASE_URL}/api/objekte`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const objekte: ObjektApi[] = data.objekte ?? [];
  return objekte.find((o) => o.slug === slug) ?? null;
}

// OBJEKTDATEN-Block für RESEARCHER/SCRIBE/COUNSEL — inkl. Zahlen-Regel
function buildObjektBlock(o: ObjektApi): string {
  const kennzahlenText = o.kennzahlen.map((k) => `- ${k.label}: ${k.wert}`).join("\n");
  const kampagnenText = o.kampagnen.length
    ? o.kampagnen.map((k) => `- ${k.kampagne} (${k.lpVariant}): ${k.lpUrl}`).join("\n")
    : "- (keine Kampagne hinterlegt)";
  return `OBJEKTDATEN (Steinadel-Export, read-only):
Name: ${o.name}
Untertitel: ${o.untertitel}
Tagline: ${o.tagline}
Ort: ${o.ort}
Baujahr: ${o.baujahr}
Preis: ${o.preis}
Kurzbeschreibung: ${o.kurzbeschreibung}
Status: ${o.statusBadge}
AfA-Satz: ${o.afaProzent} %
Denkmalobjekt: ${o.istDenkmal ? "ja" : "nein"}
Kennzahlen:
${kennzahlenText}
Kampagnen:
${kampagnenText}

REGEL: JEDE Zahl im Content muss aus diesen Objektdaten stammen — keine erfundenen
oder aus dem Gedächtnis ergänzten Zahlen. "${o.preis}" (preis) ist ein String und
wird WÖRTLICH übernommen, nicht gerundet oder umgerechnet. Das Wort "ImmoNexus"
darf NIEMALS im Content vorkommen (interner Codename, öffentliche Marke ist
ausschließlich "Steinadel").`;
}

// Erlaubtes Zeichenset für utm_content erzwingen
function sanitizeUtm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
}

// POST — Run full content pipeline for a topic (optional: an ein Steinadel-Objekt gebunden)
export async function POST(request: NextRequest) {
  const supabase = createServiceClient();
  let contentId: number | null = null;

  try {
    const body: PipelineRequest = await request.json();
    const { topic, platform, format, category, objekt_slug } = body;

    if (!platform || !format || (!topic && !objekt_slug)) {
      return NextResponse.json(
        { error: "platform, format und (topic oder objekt_slug) sind erforderlich" },
        { status: 400 }
      );
    }

    const cookie = request.headers.get("cookie") ?? "";

    // ═══ Objektdaten laden (falls objekt_slug gesetzt) ═══
    let objekt: ObjektApi | null = null;
    if (objekt_slug) {
      objekt = await fetchObjekt(objekt_slug, cookie);
      if (!objekt) {
        return NextResponse.json(
          { error: `Objekt "${objekt_slug}" nicht in der Steinadel-Export-API gefunden` },
          { status: 404 }
        );
      }
    }

    const thema = objekt ? objekt.name : (topic as string);
    const objektBlock = objekt ? buildObjektBlock(objekt) : null;

    const platformLabel: Record<string, string> = { youtube: "YouTube-Video", twitter: "X/Twitter-Thread", x: "X/Twitter-Thread", newsletter: "Newsletter-Ausgabe", tiktok: "TikTok-Video", instagram: "Instagram-Post" };
    const formatLabel: Record<string, string> = { longform: "Longform (8-12 Min)", short: "Short (60 Sek)", thread: "Thread (5-8 Posts)", deep_dive: "Deep Dive (15+ Min)", newsletter_issue: "Newsletter-Ausgabe", tiktok_short: "TikTok Short (30-60 Sek)", reel: "Reel (30-90 Sek)", carousel: "Carousel (5-10 Slides)", story: "Story (15 Sek Clips)" };
    const categoryLabel: Record<string, string> = { ki_automation: "KI & Automation", krypto_trading: "Krypto-Trading & DeFi", business_automation: "Business-Automation", ghost_protocol: "Ghost Protocol Behind-the-Scenes" };
    const categoryKey = category ?? "ghost_protocol";

    // ═══ Content-Zeile anlegen (Persistenz ab Start des Laufs) ═══
    const { data: inserted, error: insertErr } = await supabase
      .from("content")
      .insert({
        title: thema,
        content_type: format,
        status: "entwurf",
        platform,
        language: "de",
        created_by: "scribe",
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: `Content-Eintrag konnte nicht angelegt werden: ${insertErr?.message ?? "unbekannt"}` },
        { status: 500 }
      );
    }
    contentId = inserted.id as number;

    // ═══ UTM-Registry (nur bei Objekt + vorhandener Kampagne) ═══
    let utmContent: string | null = null;
    let ctaLink: string | null = null;
    let kampagneSlug: string | null = null;
    if (objekt && objekt.kampagnen.length > 0) {
      const kampagne = objekt.kampagnen[0];
      utmContent = sanitizeUtm(`${platform}-${objekt_slug}-${contentId}`);
      ctaLink =
        `${kampagne.lpUrl}?utm_source=${encodeURIComponent(platform)}` +
        `&utm_medium=social&utm_campaign=${encodeURIComponent(kampagne.kampagne)}` +
        `&utm_content=${utmContent}`;
      kampagneSlug = kampagne.kampagne;
    }

    const steps: PipelineStep[] = [
      { agent: "researcher", status: "pending" },
      { agent: "scribe", status: "pending" },
      { agent: "counsel", status: "pending" },
      { agent: "publisher", status: "pending" },
      { agent: "amplifier", status: "pending" },
    ];

    let totalCost = 0;

    // ═══ STEP 1: RESEARCHER — Recherche & Fakten ═══
    steps[0].status = "running";
    try {
      const research = await activateAgent(
        "researcher",
        `RESEARCH-AUFTRAG: Recherchiere das Thema "${thema}" für ein ${platformLabel[platform]} im Format ${formatLabel[format]}, Kategorie: ${categoryLabel[categoryKey]}.

Liefere:
1. 5 Kernfakten mit Quellen (Studien, Statistiken, Experten-Zitate)
2. 3 kontroverse oder überraschende Perspektiven (Hook-Material)
3. Aktuelle Entwicklungen der letzten 30 Tage
4. 3 konkrete Beispiele oder Case Studies
5. SEO-Keywords (5 Stück) für ${platform}

Format: Strukturierte Bullet-Points, deutsch. Keine Floskeln, nur Fakten.${objektBlock ? `\n\n${objektBlock}` : ""}`,
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
        x: `Schreibe einen X-Thread im Steinadel-Ton (premium, editorial, ruhig, max 1 Emoji):
- 6-7 Tweets, je maximal 270 Zeichen
- Nummerierung im Stil "1/7", "2/7", ...
- Tweet 1: Hook (Zahl, Frage oder These aus den Objektdaten — NICHT erfunden)
- Tweet 2-5/6: Hauptpunkte zum Objekt, jeder Tweet eigenständig lesbar
- Falls AfA/Steuerzahlen erwähnt werden: Modellrechnung-Disclaimer-Satz PFLICHT
  ("Modellrechnung — individuelle steuerliche Wirkung abhängig von persönlicher
  Situation und Behördenbescheinigung; keine Steuerberatung.")
- Letzter Tweet: CTA mit EXAKT diesem Link${ctaLink ? `: ${ctaLink}` : " (kein Kampagnen-Link hinterlegt — allgemeiner CTA)"}
- Keine Superlativ-Ketten, keine Caps-Lock-Dringlichkeit`,
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
          `CONTENT-PRODUKTION: Schreibe Content zum Thema "${thema}".

PLATTFORM: ${platformLabel[platform]}
KATEGORIE: ${categoryLabel[categoryKey]}

RECHERCHE-ERGEBNISSE (von RESEARCHER):
${steps[0].output}

ANWEISUNGEN:
${platformInstructions[platform] ?? platformInstructions.twitter}

STILREGELN:
- Tonalität: ${objekt ? "Steinadel — premium, editorial, ruhig" : "Professionell aber zugänglich, keine Corporate-Sprache"}
- Zielgruppe: ${objekt ? "Vermögende Kapitalanleger, Spitzensteuersatz, DACH-Raum" : "Tech-affine Professionals, 25-45 Jahre, DACH-Raum"}
- Sprache: Deutsch, Anglizismen erlaubt bei Fachbegriffen
- Ghost Protocol NICHT erwähnen (Agenten sind unsichtbar)
${objekt ? "" : `- Brandname für extern: "AI Insider" (Arbeitstitel)`}

Liefere den fertigen Content, sofort publishbar.${objektBlock ? `\n\n${objektBlock}` : ""}`,
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

    // Technischer Fehler in RESEARCHER/SCRIBE → Pipeline abbrechen, kein COUNSEL
    if (steps[0].status !== "done" || steps[1].status !== "done") {
      const failedStep = steps[0].status !== "done" ? steps[0] : steps[1];
      await supabase
        .from("content")
        .update({
          status: "fehler",
          metadata: { steps, fehler: `${failedStep.agent} fehlgeschlagen: ${failedStep.output}` },
        })
        .eq("id", contentId);

      return NextResponse.json({
        pipeline: "content-first",
        contentId,
        status: "fehler",
        steps,
        summary: { total_cost_usd: Math.round(totalCost * 100000) / 100000 },
      });
    }

    // ═══ STEP 3: COUNSEL — Pflicht-Review, fail-closed ═══
    steps[2].status = "running";
    try {
      const review = await activateAgent(
        "counsel",
        `Pruefe den folgenden Content STRIKT gegen dein STEINADEL-REGELPAKET (fail-closed). Zahlen NUR gegen die mitgelieferten Objektdaten abgleichen. Zitiere Verstoesse. Schliesse mit URTEIL:-Zeile ab.

CONTENT:
${steps[1].output}

${objektBlock ?? "OBJEKTDATEN: keine (Freitext-Content ohne Steinadel-Objektbezug)"}`,
        cookie
      );
      steps[2].status = "done";
      steps[2].output = review.response;
      steps[2].cost = review.cost;
      steps[2].duration_ms = review.duration_ms;
      totalCost += review.cost;
    } catch (err) {
      steps[2].status = "error";
      steps[2].output = err instanceof Error ? err.message : "Unknown error";
    }

    const counselOutput = steps[2].output ?? "";
    // Technischer Fehler ist KEINE fachliche Ablehnung — 'fehler' statt 'abgelehnt',
    // damit die Freigabe-Ansicht nicht faelschlich "COUNSEL lehnt ab" anzeigt.
    const counselTechnischGescheitert = steps[2].status !== "done";
    const rejected =
      counselTechnischGescheitert ||
      counselOutput.includes("URTEIL: ABLEHNUNG") ||
      !counselOutput.includes("URTEIL:");

    // COUNSEL-Ergebnis immer persistieren (auch bei Ablehnung) — inkl. steps,
    // sonst zeigt die Freigabe-Ansicht abgelehnte Laeufe ohne Kontext.
    await supabase
      .from("content")
      .update({
        reviewed_by: "counsel",
        review_notes: counselOutput,
        status: counselTechnischGescheitert ? "fehler" : rejected ? "abgelehnt" : "counsel_geprueft",
        metadata: {
          steps: steps.map((s) => ({ agent: s.agent, output: s.output, cost: s.cost, duration_ms: s.duration_ms })),
          thema,
          objekt_slug: objekt_slug ?? null,
          utm_content: utmContent,
          kampagne: kampagneSlug,
          cta_link: ctaLink,
        },
      })
      .eq("id", contentId);

    if (rejected) {
      return NextResponse.json({
        pipeline: "content-first",
        contentId,
        thema,
        platform,
        format,
        status: "abgelehnt",
        steps,
        summary: {
          total_cost_usd: Math.round(totalCost * 100000) / 100000,
          total_duration_ms: steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
          completed: `${steps.filter((s) => s.status === "done").length}/5`,
        },
      });
    }

    // ═══ STEP 4: PUBLISHER — Formatierung & Scheduling ═══
    steps[3].status = "running";
    try {
      const published = await activateAgent(
        "publisher",
        `PUBLISHING-AUFTRAG: Bereite diesen Content für die Veröffentlichung vor.

PLATTFORM: ${platform}
FORMAT: ${format}

CONTENT (von SCRIBE, COUNSEL-geprüft):
${steps[1].output}

COUNSEL-REVIEW:
${counselOutput}

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
      steps[3].status = "done";
      steps[3].output = published.response;
      steps[3].cost = published.cost;
      steps[3].duration_ms = published.duration_ms;
      totalCost += published.cost;
    } catch (err) {
      steps[3].status = "error";
      steps[3].output = err instanceof Error ? err.message : "Unknown error";
    }

    // ═══ STEP 5: AMPLIFIER — Distribution-Plan ═══
    if (steps[3].status === "done") {
      steps[4].status = "running";
      try {
        const amplified = await activateAgent(
          "amplifier",
          `AMPLIFICATION-AUFTRAG: Erstelle den Distribution- und Repurposing-Plan für diesen Content.

ORIGINAL-PLATTFORM: ${platform}
THEMA: ${thema}

PUBLISHER-OUTPUT:
${steps[3].output}

ALLE 5 PLATTFORMEN: YouTube, X/Twitter, TikTok, Instagram, Newsletter

AUFGABEN:
1. Distribution-Timeline: 7-Tage-Plan über ALLE 5 Plattformen
2. Repurposing-Matrix (1→6 Strategie) passend zur Original-Plattform
3. Für JEDEN Repurpose-Piece: Konkreten Content-Entwurf liefern (nicht nur Beschreibung!)
4. Hashtag-Strategie pro Plattform
5. KPI-Ziele pro Plattform (Views, Engagement-Rate, Follower-Growth, 7-Tage-Ziel)

Liefere einen konkreten Aktionsplan mit fertigen Repurpose-Entwürfen.`,
          cookie
        );
        steps[4].status = "done";
        steps[4].output = amplified.response;
        steps[4].cost = amplified.cost;
        steps[4].duration_ms = amplified.duration_ms;
        totalCost += amplified.cost;
      } catch (err) {
        steps[4].status = "error";
        steps[4].output = err instanceof Error ? err.message : "Unknown error";
      }
    }

    const totalDuration = steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
    const completedSteps = steps.filter((s) => s.status === "done").length;

    // Technischer Fehler in PUBLISHER/AMPLIFIER → status 'fehler'
    if (steps[3].status !== "done" || steps[4].status !== "done") {
      const failedStep = steps[3].status !== "done" ? steps[3] : steps[4];
      await supabase
        .from("content")
        .update({
          status: "fehler",
          metadata: {
            steps,
            fehler: `${failedStep.agent} fehlgeschlagen: ${failedStep.output}`,
            thema,
            objekt_slug: objekt_slug ?? null,
            utm_content: utmContent,
            kampagne: kampagneSlug,
            cta_link: ctaLink,
          },
        })
        .eq("id", contentId);

      return NextResponse.json({
        pipeline: "content-first",
        contentId,
        status: "fehler",
        steps,
        summary: { total_cost_usd: Math.round(totalCost * 100000) / 100000, total_duration_ms: totalDuration, completed: `${completedSteps}/5` },
      });
    }

    // ═══ Erfolgreicher Durchlauf: zur menschlichen Freigabe ═══
    await supabase
      .from("content")
      .update({
        body: steps[3].output,
        status: "zur_freigabe",
        metadata: {
          steps: steps.map((s) => ({ agent: s.agent, output: s.output, cost: s.cost, duration_ms: s.duration_ms })),
          thema,
          objekt_slug: objekt_slug ?? null,
          utm_content: utmContent,
          kampagne: kampagneSlug,
          cta_link: ctaLink,
          amplifier_empfehlung: steps[4].output,
        },
      })
      .eq("id", contentId);

    return NextResponse.json({
      pipeline: "content-first",
      contentId,
      thema,
      platform,
      format,
      category: categoryKey,
      status: completedSteps === 5 ? "complete" : "partial",
      steps,
      summary: {
        total_cost_usd: Math.round(totalCost * 100000) / 100000,
        total_duration_ms: totalDuration,
        completed: `${completedSteps}/5`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (contentId !== null) {
      await supabase
        .from("content")
        .update({ status: "fehler", metadata: { fehler: message } })
        .eq("id", contentId);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — Pipeline status and available options
export async function GET() {
  return NextResponse.json({
    pipeline: "content-first",
    description: "RESEARCHER → SCRIBE → COUNSEL → PUBLISHER → AMPLIFIER (5 Plattformen, COUNSEL fail-closed, optional an Steinadel-Objekt gebunden)",
    platforms: ["youtube", "twitter", "x", "newsletter", "tiktok", "instagram"],
    formats: {
      youtube: ["longform", "short", "deep_dive"],
      twitter: ["thread"],
      x: ["thread"],
      newsletter: ["newsletter_issue"],
      tiktok: ["tiktok_short"],
      instagram: ["carousel", "reel", "story"],
    },
    categories: ["ki_automation", "krypto_trading", "business_automation", "ghost_protocol"],
    estimated_cost_per_piece: {
      youtube_longform: "$0.04-0.08 (5 Sonnet/Haiku calls)",
      x_thread: "$0.03-0.05 (2 Sonnet + Haiku COUNSEL + 2 Sonnet)",
      newsletter: "$0.03-0.06 (5 mixed calls)",
      tiktok_short: "$0.02-0.04 (5 Haiku/Sonnet calls)",
      instagram_carousel: "$0.03-0.06 (5 mixed calls)",
      instagram_reel: "$0.02-0.04 (5 mixed calls)",
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
