import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getAgentPrompt } from "@/lib/agent-prompts";
import {
  AGENTEN_FAEHIGKEITEN,
  ERLAUBTE_AGENTEN,
  istAuftragId,
  pruefePlan,
  pruefePlanSignatur,
  signierePlan,
} from "@/lib/auftrag";
import { PREIS_STAND_AB, leseTokenZahl, schaetzeKostenUsd } from "@/lib/kosten";
import {
  ANTHROPIC_SCHLUESSEL,
  QUELLE_PLANUNG,
  abschneideStatus,
  bereinigeFehler,
  fasseLaeufeZusammen,
  fehllaufMetadaten,
  leseProtokollEintraege,
  leseSchluessel,
  pruefeAnfrageHerkunft,
} from "@/lib/status-server";
import {
  MAX_PLAN_SCHRITTE,
  type AusfuehrungAntwort,
  type AusfuehrungsErgebnis,
  type DelegationsPlan,
  type PlanAntwort,
  type PlanSchritt,
  type PlanungsKosten,
} from "@/lib/auftrag-types";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// L.I.S.A. Auftragszeile — POST /api/donna/delegate (Slug "donna" = Alt-Name, Route stabil).
// Stufe 1 (05.11.2026), Vertrag lib/auftrag-types.ts: erst planen, dann GENAU diesen Plan
// ausführen. Der Plan wird als messages-Zeile gespeichert und zur Ausführung von dort
// geladen, nicht neu geplant. Ein zweites Ausführen derselben auftrag_id gibt 409.
// 06.11.2026: gescheiterte, aber bezahlte Planungen werden als Fehllauf-Zeile gespeichert
// (Befund R8); results tragen abgeschnitten und stop_reason (R33); Fehlertexte laufen durch
// bereinigeFehler (R17). Plan- und Fehllauf-Zeilen tragen metadata.preis_stand =
// PREIS_STAND_AB (lib/kosten.ts), damit GET /api/status die Preistabelle erkennt.
// Gesamtprüfung 06.11.2026: Protokollfehler aus activate kommen je Eintrag (Liste
// protokoll_fehler_liste, sonst Text am "; " geteilt) und werden je Eintrag bereinigt — vorher
// wurde der ganze Text als EIN Eintrag auf 160 Zeichen gekürzt, spätere Vermerke fielen weg.
// Cross-Site-POST → 403, ohne JSON-Content-Type → 415 (pruefeAnfrageHerkunft), vor jedem Aufruf.

type ServiceClient = ReturnType<typeof createServiceClient>;

const HINWEIS =
  "Ergebnisse sind ungeprüft und gehen nicht automatisch nach außen. Veröffentlicht wird nur über die Content-Pipeline mit COUNSEL und deiner Freigabe.";
/** Kürzung der Antworttexte in der JSON-Antwort; der volle Text steht im Message Bus. */
const MAX_ANTWORT_ZEICHEN = 4000;
/** Auszug je früherem Ergebnis, der an spätere Stufen angehängt wird. */
const MAX_VORERGEBNIS_ZEICHEN = 3000;

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function fehlerAntwort(status: number, fehler: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ fehler, ...extra }, { status });
}

/** Alle Text-Blöcke zusammen; Sonnet 5 liefert thinking-Blöcke vor dem Text. */
function textAus(inhalt: unknown): string {
  if (!Array.isArray(inhalt)) return "";
  return inhalt
    .map((block: unknown) =>
      istObjekt(block) && block.type === "text" && typeof block.text === "string" ? block.text : "",
    )
    .join("");
}

interface ClaudeErgebnis {
  text: string;
  /** Vollständig nur bei end_turn/stop_sequence (abschneideStatus in lib/status-server.ts). */
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Bereinigter Fehlertext; null, wenn eine lesbare Antwort kam. */
  fehler: string | null;
  /** true, sobald Claude mit HTTP 2xx geantwortet hat: dann ist der Aufruf bezahlt. */
  bezahlt: boolean;
  /**
   * Ursache eines unbezahlten Fehlers (Gegencheck 06.11.2026): "konfiguration" (Schlüssel fehlt
   * oder ist unbrauchbar, nichts gesendet), "netz" (keine Antwort), "http" (Claude antwortete mit
   * Fehlerstatus). null bei bezahlten Antworten.
   */
  fehlerArt?: "konfiguration" | "netz" | "http" | null;
}

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  model: string,
  maxTokens: number,
): Promise<ClaudeErgebnis> {
  const leer = { text: "", stopReason: null, inputTokens: null, outputTokens: null, bezahlt: false };
  // Befund R17: Schlüssel mit CR, LF oder NUL schon beim Lesen ablehnen (feste Meldung).
  const schluessel = leseSchluessel(ANTHROPIC_SCHLUESSEL);
  if (!schluessel.ok) return { ...leer, fehler: schluessel.meldung, fehlerArt: "konfiguration" };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": schluessel.wert,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
  } catch (e) {
    return { ...leer, fehler: bereinigeFehler(e), fehlerArt: "netz" };
  }
  if (!res.ok) return { ...leer, fehler: `Claude-API-Fehler: HTTP ${res.status}`, fehlerArt: "http" };

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ...leer, bezahlt: true, fehler: "Antwort von Claude nicht lesbar" };
  }
  if (!istObjekt(data)) return { ...leer, bezahlt: true, fehler: "Antwort von Claude nicht lesbar" };
  const usage = istObjekt(data.usage) ? data.usage : {};
  return {
    text: textAus(data.content),
    stopReason: typeof data.stop_reason === "string" && data.stop_reason.trim() ? data.stop_reason : null,
    inputTokens: leseTokenZahl(usage.input_tokens),
    outputTokens: leseTokenZahl(usage.output_tokens),
    fehler: null,
    bezahlt: true,
  };
}

/** Plan-JSON aus der Modellantwort lösen (das Modell kann Text drumherum schreiben). */
function lesePlanJson(text: string): { ok: true; wert: unknown } | { ok: false; grund: string } {
  const treffer = text.match(/\{[\s\S]*\}/);
  if (!treffer) return { ok: false, grund: "kein JSON in der Antwort" };
  try {
    return { ok: true, wert: JSON.parse(treffer[0]) };
  } catch {
    return { ok: false, grund: "JSON nicht lesbar" };
  }
}

/** Rolle von donna für from_role; Lesefehler nur ins Log, die Zeile wird trotzdem geschrieben. */
async function leseDonnaRolle(supabase: ServiceClient, kontext: string): Promise<string | null> {
  const { data, error } = await supabase.from("agents").select("role").eq("id", "donna").maybeSingle();
  if (error) console.error(`[delegate] Rolle von donna nicht lesbar (${kontext}): ${bereinigeFehler(error)}`);
  return istObjekt(data) && typeof data.role === "string" ? data.role : null;
}

// ── 1. Planen: POST { task } → PlanAntwort ───────────────────────────────────────────

async function planen(task: string): Promise<NextResponse> {
  const donnaPrompt = getAgentPrompt("donna");
  const modell = donnaPrompt?.model ?? "claude-haiku-4-5-20251001";
  const capabilitiesList = ERLAUBTE_AGENTEN.map(
    (id) => `- ${id.toUpperCase()}: ${AGENTEN_FAEHIGKEITEN[id]}`,
  ).join("\n");

  // Prompt wie bisher; Stufe 1 (05.11.2026): trader aus der Liste, zwei Regeln ergänzt
  // (Fakten/Annahmen, Content-Pipeline mit COUNSEL).
  const planningPrompt = `Du bist L.I.S.A. (Leadership Intelligence, Strategy & Alignment), Executive-COO-KI und Chief of Staff bei Ghost Protocol — die Verschmelzung von Donna Paulsens sozialer Antizipation und Pepper Potts' operativer Exzellenz. Kein Drama, keine Ausreden: klare Lage, klare Entscheidung, sauberer naechster Schritt.
Analysiere den folgenden Task und erstelle einen Delegations-Plan. Jeder Auftrag bekommt einen spezifischen Scope; was nicht entscheidungsreif ist, wird nicht delegiert.

VERFÜGBARE AGENTS:
${capabilitiesList}

REGELN:
- Wähle 1-${MAX_PLAN_SCHRITTE} Agents die für den Task am besten geeignet sind
- Gib jedem Agent einen SPEZIFISCHEN Auftrag (nicht generisch)
- Priorisiere: 1 = zuerst, 2 = danach, etc.
- Agents mit gleicher Priorität laufen parallel
- Trenne Fakten von Annahmen und erfinde keine Zahlen.
- Content für die Öffentlichkeit läuft über die Content-Pipeline mit COUNSEL.
- Antworte NUR im folgenden JSON-Format, kein anderer Text:

{"agents":[{"id":"agent_id","task":"Spezifischer Auftrag","priority":1}],"reasoning":"Warum diese Agents"}`;

  const antwort = await callClaude(
    planningPrompt,
    `TASK: ${task}`,
    modell,
    // Sonnet-5: adaptives Thinking ist default-AN und teilt sich max_tokens mit dem
    // Antwort-Text. 4096 reichte bei langen Auftraegen nicht (Plan-JSON abgeschnitten,
    // live beobachtet 27.07.). Kosten fallen nur fuer tatsaechlich generierte Tokens an.
    12000,
  );

  // Nicht bezahlt (Schlüssel, Netz, HTTP-Fehler): kein Fehllauf, nur die Meldung.
  // Gegencheck 06.11.2026: "nicht erreichbar" nur, wenn keine Antwort kam. Ein fehlender
  // Schlüssel ist Serverkonfiguration (500, wie activate), ein HTTP-Fehler eine Antwort von Claude.
  if (antwort.fehler && !antwort.bezahlt) {
    if (antwort.fehlerArt === "konfiguration") return fehlerAntwort(500, `L.I.S.A. nicht konfiguriert: ${antwort.fehler}`);
    if (antwort.fehlerArt === "http") return fehlerAntwort(502, `L.I.S.A.-Planung gescheitert: ${antwort.fehler}`);
    return fehlerAntwort(502, `L.I.S.A. nicht erreichbar: ${antwort.fehler}`);
  }

  const planung: PlanungsKosten = {
    modell,
    input_tokens: antwort.inputTokens,
    output_tokens: antwort.outputTokens,
    kosten_usd_geschaetzt: schaetzeKostenUsd(modell, antwort.inputTokens, antwort.outputTokens),
    stop_reason: antwort.stopReason,
  };

  // Fail-closed: geparst wird nur eine vollständige Antwort (stop_reason end_turn oder
  // stop_sequence). Auch parsebar könnte ein abgeschnittener Plan unvollständig sein.
  let grund: string | null = null;
  let plan: DelegationsPlan | null = null;
  if (antwort.fehler) {
    grund = `Plan nicht lesbar: ${antwort.fehler}`;
  } else if (abschneideStatus(antwort.stopReason) !== false) {
    grund =
      antwort.stopReason === "max_tokens"
        ? "Plan abgeschnitten"
        : antwort.stopReason === null
          ? "Plan unvollständig: stop_reason nicht gemeldet"
          : `Plan unvollständig (stop_reason ${antwort.stopReason})`;
  } else {
    const gelesen = lesePlanJson(antwort.text);
    const pruefung = gelesen.ok ? pruefePlan(gelesen.wert) : gelesen;
    if (pruefung.ok) plan = pruefung.plan;
    else grund = `Plan ungültig: ${pruefung.grund}`;
  }

  if (!plan) {
    const meldung = grund ?? "Plan ungültig";
    // Volle Modellantwort ins Server-Log (docker logs); die API-Antwort nennt nur den Grund.
    console.error(
      `[delegate] ${meldung} (stop_reason=${antwort.stopReason}, ${antwort.text.length} Zeichen):\n${antwort.text}`,
    );
    // Befund R8: Die Tokens sind bezahlt — als Fehllauf-Zeile speichern, damit die Kosten
    // im Systemzustand erscheinen. planung geht mit, damit sie auch hier sichtbar bleiben.
    const protokollFehler = await speichereFehllauf(task, planung, meldung);
    return fehlerAntwort(502, meldung, {
      planung,
      ...(protokollFehler ? { protokoll_fehler: protokollFehler } : {}),
    });
  }

  const auftragId = crypto.randomUUID();
  const ergebnis: PlanAntwort = {
    mode: "plan",
    auftrag_id: auftragId,
    original_task: task,
    delegation_plan: plan,
    planung,
    erstellt_am: new Date().toISOString(),
  };

  const protokollFehler = await speicherePlan(auftragId, task, plan, planung);
  if (protokollFehler) ergebnis.protokoll_fehler = protokollFehler;
  return NextResponse.json(ergebnis);
}

/** Plan als messages-Zeile speichern (Format wie in agents/activate). null = gespeichert. */
async function speicherePlan(
  auftragId: string,
  task: string,
  plan: DelegationsPlan,
  planung: PlanungsKosten,
): Promise<string | null> {
  try {
    const signatur = await signierePlan(auftragId, task, plan);
    if (!signatur) throw new Error("kein Server-Secret für die Plan-Signatur");

    const supabase = createServiceClient();
    const rolle = await leseDonnaRolle(supabase, `auftrag_id=${auftragId}`);

    const { error } = await supabase.from("messages").insert({
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      from_agent: "donna",
      from_role: rolle,
      // Empfänger leer: activate liest to_agents als Kontext; ein nie ausgeführter Plan
      // soll dort nicht als Auftrag auftauchen.
      to_agents: [],
      to_channels: [],
      content: { text: plan.reasoning, plan, original_task: task },
      message_type: "plan",
      priority: "normal",
      metadata: {
        source: QUELLE_PLANUNG,
        auftrag_id: auftragId,
        model: planung.modell,
        input_tokens: planung.input_tokens,
        output_tokens: planung.output_tokens,
        cost_usd: planung.kosten_usd_geschaetzt,
        preis_stand: PREIS_STAND_AB,
        plan_signatur: signatur,
      },
    });
    if (error) throw new Error(error.message);
    return null;
  } catch (e) {
    const grund = bereinigeFehler(e);
    console.error(`[delegate] Plan nicht gespeichert (auftrag_id=${auftragId}): ${grund}`);
    return `Plan nicht gespeichert: ${grund}`;
  }
}

/**
 * Gescheiterte, aber bezahlte Planung als Fehllauf-Zeile speichern (Befund R8, 06.11.2026).
 * message_type und content wie bei der Plan-Zeile, nur ohne Plan. null = gespeichert.
 */
async function speichereFehllauf(task: string, planung: PlanungsKosten, grund: string): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const rolle = await leseDonnaRolle(supabase, "Fehllauf der Planung");
    const { error } = await supabase.from("messages").insert({
      id: `msg-${crypto.randomUUID()}`,
      from_agent: "donna",
      from_role: rolle,
      // Empfänger leer: Protokollzeile, kein Auftrag und kein Kontext für spätere Läufe.
      to_agents: [],
      to_channels: [],
      content: { text: `Planung gescheitert: ${bereinigeFehler(grund)}`, original_task: task },
      message_type: "plan",
      priority: "normal",
      metadata: fehllaufMetadaten({
        art: "planung",
        model: planung.modell,
        input_tokens: planung.input_tokens,
        output_tokens: planung.output_tokens,
        cost_usd: planung.kosten_usd_geschaetzt,
        preis_stand: PREIS_STAND_AB,
        stop_reason: planung.stop_reason,
        grund,
      }),
    });
    if (error) throw new Error(error.message);
    return null;
  } catch (e) {
    const grundSpeichern = bereinigeFehler(e);
    console.error(`[delegate] Fehllauf der Planung nicht gespeichert: ${grundSpeichern}`);
    return `Fehllauf nicht gespeichert: ${grundSpeichern}`;
  }
}

// ── 2. Ausführen: POST { auftrag_id, ausfuehren: true } → AusfuehrungAntwort ─────────

interface Lauf {
  schritt: PlanSchritt;
  /** Voller Antworttext; leer bei Fehler. */
  text: string;
  cost: number | null;
  fehler: string | null;
  /** Befund R16/R33: null (nicht gemeldet) zählt wie unvollständig. */
  abgeschnitten: boolean | null;
  stopReason: string | null;
  protokollFehler: string[];
}

/** Hinweis vor einem nicht sicher vollständigen Text; null bei vollständiger Antwort. */
function unvollstaendigVermerk(l: Lauf): string | null {
  if (l.abgeschnitten === false) return null;
  if (l.abgeschnitten === true) {
    return l.stopReason === "max_tokens"
      ? "[Vom Modell abgeschnitten (max_tokens) — Antwort unvollständig]"
      : `[Antwort unvollständig (stop_reason ${l.stopReason ?? "unbekannt"})]`;
  }
  return "[Vollständigkeit nicht gemeldet (kein stop_reason) — als unvollständig behandelt]";
}

function vorergebnisBlock(laeufe: Lauf[]): string {
  const teile = laeufe.map((l) => {
    const zusatz = l.fehler ? "" : l.abgeschnitten === true ? " · abgeschnitten" : l.abgeschnitten === null ? " · Vollständigkeit unbekannt" : "";
    const kopf = `[${l.schritt.id.toUpperCase()} · Priorität ${l.schritt.priority}${zusatz}]`;
    if (l.fehler) return `${kopf}\nKein Ergebnis — ${l.fehler}`;
    const auszug =
      l.text.length > MAX_VORERGEBNIS_ZEICHEN ? `${l.text.slice(0, MAX_VORERGEBNIS_ZEICHEN)}\n[… gekürzt]` : l.text;
    return `${kopf}\n${auszug}`;
  });
  return `Ergebnisse vorheriger Schritte (ungeprüft):\n\n${teile.join("\n\n")}`;
}

function anzeigeText(l: Lauf): string {
  if (l.fehler) return "";
  const text =
    l.text.length > MAX_ANTWORT_ZEICHEN
      ? `${l.text.slice(0, MAX_ANTWORT_ZEICHEN)}\n\n[… gekürzt — vollständiger Text im Message Bus]`
      : l.text;
  const vermerk = unvollstaendigVermerk(l);
  return vermerk ? `${vermerk}\n\n${text}` : text;
}

/**
 * Abschneide-Status aus der activate-Antwort, fail-closed: true, wenn activate oder der
 * stop_reason es sagen; false nur, wenn activate false meldet und der stop_reason nicht
 * widerspricht; sonst null.
 */
function abschneideAusAntwort(gemeldet: unknown, stopReason: string | null): boolean | null {
  const ausStopReason = abschneideStatus(stopReason);
  if (gemeldet === true || ausStopReason === true) return true;
  if (gemeldet === false && ausStopReason === false) return false;
  return null;
}

/**
 * Protokollfehler aus activate je Eintrag (Gesamtprüfung 06.11.2026): vorrangig die Liste
 * protokoll_fehler_liste, sonst der Text protokoll_fehler am Trenner geteilt; eine Liste der
 * älteren Fassung geht auch. Je Eintrag bereinigt (höchstens 160 Zeichen je Eintrag); eine
 * unerwartete Form wird als eigener Eintrag gemeldet statt still verworfen (fail-closed).
 */
function leseProtokoll(liste: unknown, text: unknown): string[] {
  const gelesen = leseProtokollEintraege(liste, text);
  const eintraege = gelesen.eintraege.map((p) => bereinigeFehler(p));
  return gelesen.unlesbar ? [...eintraege, "protokoll_fehler nicht lesbar (activate-Vertrag)"] : eintraege;
}

async function aktiviereAgent(
  schritt: PlanSchritt,
  task: string,
  auftragId: string,
  cookie: string,
): Promise<Lauf> {
  const ohneErgebnis = (fehler: string, cost: number | null = null, stopReason: string | null = null): Lauf => ({
    schritt,
    text: "",
    cost,
    fehler,
    abgeschnitten: null,
    stopReason,
    protokollFehler: [],
  });

  try {
    const res = await fetch(`${BASE_URL}/api/agents/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ agent_id: schritt.id, task, auftrag_id: auftragId }),
    });
    const data: unknown = await res.json().catch(() => null);
    const d = istObjekt(data) ? data : {};
    // Auch ein Fehllauf (502) meldet seine usage: bezahlte Tokens sollen nicht verschwinden.
    const usage = istObjekt(d.usage) ? d.usage : {};
    const cost = typeof usage.cost_usd === "number" && Number.isFinite(usage.cost_usd) ? usage.cost_usd : null;
    const stopReason = typeof d.stop_reason === "string" && d.stop_reason.trim() ? d.stop_reason : null;
    const protokollFehler = leseProtokoll(d.protokoll_fehler_liste, d.protokoll_fehler);

    if (!res.ok) {
      const meldung = typeof d.fehler === "string" ? d.fehler : typeof d.error === "string" ? d.error : "";
      const stop = stopReason ? ` (stop_reason ${stopReason})` : "";
      return {
        ...ohneErgebnis(`HTTP ${res.status}${meldung ? `: ${bereinigeFehler(meldung)}` : ""}${stop}`, cost, stopReason),
        protokollFehler,
      };
    }

    const text = typeof d.response === "string" ? d.response : "";
    if (!text.trim()) return { ...ohneErgebnis("leere Antwort", cost, stopReason), protokollFehler };
    return {
      schritt,
      text,
      cost,
      fehler: null,
      abgeschnitten: abschneideAusAntwort(d.abgeschnitten, stopReason),
      stopReason,
      protokollFehler,
    };
  } catch (e) {
    return ohneErgebnis(`Aufruf fehlgeschlagen: ${bereinigeFehler(e)}`);
  }
}

async function ausfuehren(auftragId: string, cookie: string): Promise<NextResponse> {
  const supabase = createServiceClient();

  // Gespeicherten Plan laden.
  const { data: planZeilen, error: ladeFehler } = await supabase
    .from("messages")
    .select("id, from_role, content, metadata")
    .eq("metadata->>source", QUELLE_PLANUNG)
    .eq("metadata->>auftrag_id", auftragId)
    .limit(2);
  if (ladeFehler) {
    const grund = bereinigeFehler(ladeFehler);
    console.error(`[delegate] Plan nicht lesbar (auftrag_id=${auftragId}): ${grund}`);
    return fehlerAntwort(502, `Plan nicht lesbar: ${grund}`);
  }
  if (!planZeilen || planZeilen.length === 0) {
    return fehlerAntwort(404, "Plan nicht gefunden — bitte neu planen");
  }
  if (planZeilen.length > 1) {
    return fehlerAntwort(422, "Plan mehrdeutig (mehrere Zeilen mit dieser auftrag_id) — bitte neu planen");
  }

  // Schon ausgeführt?
  const { data: laeufeVorher, error: laufLeseFehler } = await supabase
    .from("messages")
    .select("id")
    .eq("metadata->>source", "delegate-run")
    .eq("metadata->>auftrag_id", auftragId)
    .limit(1);
  if (laufLeseFehler) {
    const grund = bereinigeFehler(laufLeseFehler);
    console.error(`[delegate] Ausführungsstatus nicht lesbar (auftrag_id=${auftragId}): ${grund}`);
    return fehlerAntwort(502, `Ausführungsstatus nicht lesbar: ${grund}`);
  }
  if (laeufeVorher && laeufeVorher.length > 0) {
    return fehlerAntwort(409, "Dieser Plan wurde bereits ausgeführt");
  }

  // Den gespeicherten Plan erneut prüfen, dann die Signatur (fail-closed).
  const zeile: Record<string, unknown> = planZeilen[0];
  const inhalt = istObjekt(zeile.content) ? zeile.content : {};
  const metadata = istObjekt(zeile.metadata) ? zeile.metadata : {};
  const originalTask = typeof inhalt.original_task === "string" ? inhalt.original_task : "";
  const pruefung = pruefePlan(inhalt.plan);
  if (!pruefung.ok) {
    return fehlerAntwort(422, `Gespeicherter Plan ungültig: ${pruefung.grund} — bitte neu planen`);
  }
  const plan = pruefung.plan;
  if (!(await pruefePlanSignatur(auftragId, originalTask, plan, metadata.plan_signatur))) {
    console.error(`[delegate] Plan-Signatur ungültig (auftrag_id=${auftragId}) — nicht ausgeführt`);
    return fehlerAntwort(422, "Gespeicherter Plan wurde verändert oder ist nicht signiert — bitte neu planen");
  }

  // Lauf-Zeile vor der Ausführung. Die feste id macht das Schreiben atomar: zwei gleichzeitige
  // Anfragen (Doppelklick, zweiter Tab) kann nur eine gewinnen, die zweite bekommt 409.
  // Ohne Lauf-Zeile wird nicht ausgeführt, sonst wäre ein zweites Ausführen nicht erkennbar.
  const gestartetAm = new Date().toISOString();
  const { error: laufSchreibFehler } = await supabase.from("messages").insert({
    id: `msg-run-${auftragId}`,
    from_agent: "donna",
    from_role: typeof zeile.from_role === "string" ? zeile.from_role : null,
    to_agents: [],
    to_channels: [],
    content: {
      text: `Plan-Ausführung gestartet (${plan.agents.length} Schritte)`,
      original_task: originalTask,
    },
    message_type: "plan_run",
    priority: "normal",
    metadata: { source: "delegate-run", auftrag_id: auftragId, gestartet_am: gestartetAm },
  });
  if (laufSchreibFehler) {
    if (laufSchreibFehler.code === "23505") {
      return fehlerAntwort(409, "Dieser Plan wurde bereits ausgeführt");
    }
    const grund = bereinigeFehler(laufSchreibFehler);
    console.error(`[delegate] Lauf-Zeile nicht geschrieben (auftrag_id=${auftragId}): ${grund}`);
    return fehlerAntwort(502, `Ausführung nicht protokolliert, deshalb nicht gestartet: ${grund}`);
  }

  // Ausführung nach priority aufsteigend; gleiche priority parallel. Ab der zweiten Stufe
  // bekommt jeder Auftrag die früheren Ergebnisse als Auszug angehängt.
  const laeufe: Lauf[] = [];
  const stufen = [...new Set(plan.agents.map((s) => s.priority))].sort((a, b) => a - b);
  for (const prioritaet of stufen) {
    const schritte = plan.agents.filter((s) => s.priority === prioritaet);
    const vorher = laeufe.length > 0 ? vorergebnisBlock(laeufe) : "";
    const stufe = await Promise.all(
      schritte.map((s) => aktiviereAgent(s, vorher ? `${s.task}\n\n${vorher}` : s.task, auftragId, cookie)),
    );
    laeufe.push(...stufe);
  }

  const protokollFehler = laeufe.flatMap((l) =>
    l.protokollFehler.map((p) => `${l.schritt.id.toUpperCase()}: ${p}`),
  );
  for (const l of laeufe) {
    if (l.fehler) console.error(`[delegate] ${l.schritt.id} fehlgeschlagen (auftrag_id=${auftragId}): ${l.fehler}`);
  }

  const results: AusfuehrungsErgebnis[] = laeufe.map((l) => ({
    agent_id: l.schritt.id,
    task: l.schritt.task,
    priority: l.schritt.priority,
    response: anzeigeText(l),
    cost: l.cost,
    fehler: l.fehler,
    // Gescheiterter Lauf: null (Vertrag lib/auftrag-types.ts).
    abgeschnitten: l.fehler ? null : l.abgeschnitten,
    stop_reason: l.stopReason,
  }));

  const ergebnis: AusfuehrungAntwort & { protokoll_fehler?: string[] } = {
    mode: "ausgefuehrt",
    auftrag_id: auftragId,
    original_task: originalTask,
    delegation_plan: plan,
    results,
    // R32/R33: erfolgreich = fehler null UND abgeschnitten false; Summe null ohne Kostenangabe.
    summary: fasseLaeufeZusammen(results),
    hinweis: HINWEIS,
  };
  if (protokollFehler.length > 0) ergebnis.protokoll_fehler = protokollFehler;
  return NextResponse.json(ergebnis);
}

// ── Einstieg ─────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const sperre = pruefeAnfrageHerkunft(request.headers);
  if (sperre) return fehlerAntwort(sperre.status, sperre.fehler);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fehlerAntwort(400, "Ungültiger JSON-Body");
  }
  if (!istObjekt(body)) return fehlerAntwort(400, "Ungültiger JSON-Body");

  // Früheres Ausführen ohne angezeigten Plan — Stufe 1 (05.11.2026) abgeschaltet.
  if (body.auto_execute !== undefined && body.auto_execute !== false) {
    return fehlerAntwort(400, "Bitte erst planen und dann genau diesen Plan ausführen.");
  }

  try {
    if (body.ausfuehren === true) {
      if (!istAuftragId(body.auftrag_id)) {
        return fehlerAntwort(400, "auftrag_id fehlt oder ist keine UUID");
      }
      return await ausfuehren(body.auftrag_id.toLowerCase(), request.headers.get("cookie") ?? "");
    }

    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (!task) return fehlerAntwort(400, "task fehlt");
    return await planen(task);
  } catch (err) {
    const grund = bereinigeFehler(err);
    console.error(`[delegate] unerwarteter Fehler: ${grund}`);
    return fehlerAntwort(500, grund);
  }
}
