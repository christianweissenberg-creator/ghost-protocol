// Plan-Prüfung und Erlaubt-Liste der Auftragszeile (POST /api/donna/delegate) —
// Stufe 1 (05.11.2026). Vertrag: ./auftrag-types.ts.
//
// Nur für Server-Code: importiert agent-prompts (System-Prompts) und das Server-Secret.
// Client-Seiten nehmen die Typen aus auftrag-types.ts, nie diese Datei.

import { getAgentPrompt } from "./agent-prompts";
import { getSessionSecret } from "./auth";
import { MAX_PLAN_SCHRITTE, type DelegationsPlan, type PlanSchritt } from "./auftrag-types";

/**
 * Fähigkeiten für den Planungs-Prompt. Stufe 1 (05.11.2026): aus delegate/route.ts hierher
 * verschoben, damit Prompt und Prüfung dieselbe Liste lesen; trader gestrichen (Ghost
 * Protocol hat nichts mit Trading zu tun).
 */
export const AGENTEN_FAEHIGKEITEN: Readonly<Record<string, string>> = {
  oracle: "Marktanalyse, Wettbewerber-Intel, Daten-Recherche, Trend-Erkennung",
  researcher: "Fakten-Recherche, Quellen, Studien, Deep-Dive-Analyse",
  scribe: "Content schreiben (YouTube-Skripte, Threads, Newsletter, Artikel)",
  publisher: "Content formatieren, SEO, Scheduling, Qualitätsprüfung",
  amplifier: "Content-Distribution, Hashtags, Engagement, Growth-Hacking",
  treasurer: "Finanzen, Budget, Kosten-Tracking, ROI-Analyse, Break-Even",
  architect: "Technische Architektur, Infrastruktur, DevOps, Code-Review",
  merchant: "Monetarisierung, Pricing, Affiliate, Revenue-Streams",
  counsel: "Legal-Review, Compliance, Datenschutz, DSGVO, Impressum",
  guardian: "Security, Monitoring, Backup, Uptime, Incident Response",
  strategist: "Strategie, OKRs, Vision, Roadmap, Wettbewerbs-Analyse",
  concierge: "Community, Support, FAQ, Onboarding, User-Feedback",
  localizer: "Übersetzung, Lokalisierung, Kulturelle Adaption (EN/DE)",
};

/** Agenten, an die delegiert werden darf: Fähigkeitsliste ∩ Agenten mit System-Prompt. */
export const ERLAUBTE_AGENTEN: readonly string[] = Object.keys(AGENTEN_FAEHIGKEITEN).filter(
  (id) => getAgentPrompt(id) !== null,
);

/** Höchste Priorität eines Plan-Schritts (1 = zuerst). */
export const MAX_PRIORITAET = 4;
/** Höchstlänge des Auftragstexts je Schritt. */
export const MAX_TASK_ZEICHEN = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** auftrag_id im UUID-Format (crypto.randomUUID()). */
export function istAuftragId(wert: unknown): wert is string {
  return typeof wert === "string" && UUID.test(wert);
}

export type PlanPruefung = { ok: true; plan: DelegationsPlan } | { ok: false; grund: string };

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function abgelehnt(grund: string): PlanPruefung {
  return { ok: false, grund };
}

/**
 * Prüft einen Plan aus der Modellantwort oder aus der gespeicherten messages-Zeile.
 * id wird getrimmt und klein geschrieben (die Agentenliste im Prompt steht in
 * Großbuchstaben), task und reasoning getrimmt. Ergebnis numerisch nach priority sortiert;
 * die Sortierung ist stabil, gleiche Priorität behält ihre Reihenfolge.
 */
export function pruefePlan(roh: unknown): PlanPruefung {
  if (!istObjekt(roh)) return abgelehnt("Plan ist kein Objekt");
  if (typeof roh.reasoning !== "string") return abgelehnt("reasoning fehlt oder ist kein Text");
  const liste = roh.agents;
  if (!Array.isArray(liste)) return abgelehnt("agents ist keine Liste");
  if (liste.length < 1 || liste.length > MAX_PLAN_SCHRITTE) {
    return abgelehnt(`${liste.length} Schritte, erlaubt sind 1 bis ${MAX_PLAN_SCHRITTE}`);
  }

  const schritte: PlanSchritt[] = [];
  for (let i = 0; i < liste.length; i++) {
    const nr = i + 1;
    const schritt: unknown = liste[i];
    if (!istObjekt(schritt)) return abgelehnt(`Schritt ${nr} ist kein Objekt`);

    if (typeof schritt.id !== "string") return abgelehnt(`Schritt ${nr}: id fehlt`);
    const id = schritt.id.trim().toLowerCase();
    if (!ERLAUBTE_AGENTEN.includes(id)) {
      return abgelehnt(`Schritt ${nr}: Agent ${JSON.stringify(id.slice(0, 40))} ist nicht erlaubt`);
    }

    if (typeof schritt.task !== "string" || !schritt.task.trim()) {
      return abgelehnt(`Schritt ${nr}: task fehlt oder ist leer`);
    }
    const task = schritt.task.trim();
    if (task.length > MAX_TASK_ZEICHEN) {
      return abgelehnt(`Schritt ${nr}: task hat ${task.length} Zeichen, erlaubt sind ${MAX_TASK_ZEICHEN}`);
    }

    const prioritaet = schritt.priority;
    if (
      typeof prioritaet !== "number" ||
      !Number.isInteger(prioritaet) ||
      prioritaet < 1 ||
      prioritaet > MAX_PRIORITAET
    ) {
      return abgelehnt(`Schritt ${nr}: priority muss eine ganze Zahl von 1 bis ${MAX_PRIORITAET} sein`);
    }

    schritte.push({ id, task, priority: prioritaet });
  }

  schritte.sort((a, b) => a.priority - b.priority);
  return { ok: true, plan: { agents: schritte, reasoning: roh.reasoning.trim() } };
}

// ── Signatur des gespeicherten Plans ────────────────────────────────────────────────
// Stufe 1 (05.11.2026): "Genau diesen Plan ausführen" heißt, dass zwischen Anzeige und
// Ausführung niemand die gespeicherte messages-Zeile verändert haben darf. Das hängt nicht
// davon ab, wer die Zeile schreiben darf: Die Plan-Zeile trägt eine HMAC-SHA256-Signatur
// mit dem Server-Secret; ohne gültige Signatur wird nicht ausgeführt (fail-closed). Der
// Domänen-Präfix trennt sie von den Session-Tokens, die mit demselben Secret signiert werden.

const encoder = new TextEncoder();

async function hmacHex(nachricht: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(nachricht)));
  let hex = "";
  for (let i = 0; i < sig.length; i++) hex += sig[i].toString(16).padStart(2, "0");
  return hex;
}

function planNachricht(auftragId: string, originalTask: string, plan: DelegationsPlan): string {
  return JSON.stringify([
    "gp-delegate-plan-v1",
    auftragId,
    originalTask,
    plan.reasoning,
    plan.agents.map((s) => [s.id, s.task, s.priority]),
  ]);
}

function gleichKonstant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signatur für die Plan-Zeile; null, wenn kein Server-Secret gesetzt ist. */
export async function signierePlan(
  auftragId: string,
  originalTask: string,
  plan: DelegationsPlan,
): Promise<string | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  return hmacHex(planNachricht(auftragId, originalTask, plan), secret);
}

/** true nur, wenn die gespeicherte Signatur zum geprüften Plan passt. */
export async function pruefePlanSignatur(
  auftragId: string,
  originalTask: string,
  plan: DelegationsPlan,
  signatur: unknown,
): Promise<boolean> {
  if (typeof signatur !== "string" || !/^[0-9a-f]{64}$/.test(signatur)) return false;
  const erwartet = await signierePlan(auftragId, originalTask, plan);
  return erwartet !== null && gleichKonstant(erwartet, signatur);
}
