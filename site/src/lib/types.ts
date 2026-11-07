// Ghost Protocol Agent Types — matches Supabase schema

import type { PreisJeMillion } from "./kosten";
import type {
  CronJobStand,
  CronLage,
  CronsWert,
  LaufErgebnis,
  LaufNachweisLesung,
  MessStatus,
  Messwert,
  SystemStatus,
} from "./status-types";

export type AgentTier = 0 | 1 | 2 | 3;
export type AgentStatus = "online" | "offline" | "error" | "maintenance" | "working";

export interface Agent {
  id: string;            // "donna", "oracle" etc.
  name: string;          // "DONNA", "ORACLE" etc.
  role: string;
  tier: AgentTier;
  llm_model: string;
  status: AgentStatus;
  channels: string[];
  last_heartbeat: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  timestamp: string;
  from_agent: string;          // agent id ("donna")
  from_role: string | null;
  to_channels: string[];
  to_agents: string[];
  message_type: string;
  priority: string;            // "normal", "high", "urgent", "critical"
  content: Record<string, unknown>;  // JSONB
  requires_legal_review: boolean;
  confidence: number;
  parent_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Metric {
  id: string;
  agent_id: string;
  metric_type: string;
  value: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Tier metadata
export const TIER_META: Record<AgentTier, { label: string; color: string; description: string }> = {
  0: { label: "THE BRAIN", color: "#ff3366", description: "Strategic Command" },
  1: { label: "C-SUITE", color: "#8b5cf6", description: "Executive Leadership" },
  2: { label: "DIRECTORS", color: "#06b6d4", description: "Department Heads" },
  3: { label: "OPERATORS", color: "#22c55e", description: "Execution Layer" },
};

// Stufe 1 (06.11.2026, Befund R9): Die Tier-Spalte ist in Supabase ein freier INTEGER. Ein
// Wert außerhalb 0–3 ließ die Detailseite abstürzen (TIER_META[4].label). Jeder Leser holt die
// Tier-Daten deshalb hier, mit Rückfall statt undefined.
export const TIER_UNBEKANNT: Readonly<{ label: string; color: string; description: string }> = {
  label: "unbekannt",
  color: "#6f6e69",
  description: "Tier-Wert außerhalb 0–3",
};

export function tierMetaFuer(tier: unknown): { label: string; color: string; description: string } {
  if (typeof tier === "number" && Object.prototype.hasOwnProperty.call(TIER_META, tier)) {
    return TIER_META[tier as AgentTier];
  }
  return TIER_UNBEKANNT;
}

// Agent registry with personas
// Stufe 1 (05.11.2026): TRADER entfernt — der Agent gehört nicht zu Ghost Protocol.
// Alle Leser greifen mit Fallback zu (AgentCard, agents/[id]); eine unbekannte ID, etwa
// eine alte trader-Zeile in Supabase, bekommt Kürzel und Rolle aus der Zeile selbst.
// Stufe 1 (06.11.2026, Befund R13): Die ORACLE-Persona ist gestrichen wie im Prompt
// (lib/agent-prompts.ts). Eine leere Persona heißt "keine"; registerEintragFuer() setzt dann
// die Rolle aus der Zeile ein.
export const AGENT_REGISTRY: Record<string, { icon: string; persona: string; tierColor: string }> = {
  STRATEGIST: { icon: "S", persona: "Elon Musk meets Jeff Bezos", tierColor: "#ff3366" },
  DONNA: { icon: "L", persona: "L.I.S.A. — Executive-COO-KI (Donna Paulsen × Pepper Potts)", tierColor: "#ff3366" },
  OPERATOR: { icon: "OP", persona: "Tim Cook", tierColor: "#8b5cf6" },
  ORACLE: { icon: "OR", persona: "", tierColor: "#8b5cf6" },
  ARCHITECT: { icon: "AR", persona: "Jensen Huang", tierColor: "#8b5cf6" },
  TREASURER: { icon: "TR", persona: "Warren Buffett", tierColor: "#8b5cf6" },
  PUBLISHER: { icon: "PU", persona: "Gary Vee", tierColor: "#8b5cf6" },
  COUNSEL: { icon: "CO", persona: "DACH Legal", tierColor: "#8b5cf6" },
  AMPLIFIER: { icon: "AM", persona: "Growth Hacker", tierColor: "#06b6d4" },
  MERCHANT: { icon: "ME", persona: "Product Lead", tierColor: "#06b6d4" },
  RESEARCHER: { icon: "RE", persona: "Research Head", tierColor: "#06b6d4" },
  SCRIBE: { icon: "SC", persona: "Content Producer", tierColor: "#22c55e" },
  GUARDIAN: { icon: "GU", persona: "Data Engineer", tierColor: "#22c55e" },
  CONCIERGE: { icon: "CN", persona: "Community Support", tierColor: "#22c55e" },
  LOCALIZER: { icon: "LO", persona: "Cultural Intel", tierColor: "#22c55e" },
};

// Stufe 1 (05.11.2026): Agenten-IDs, die das Dashboard nicht mehr zeigt. Die Zeile kann
// in Supabase weiter existieren; Command Center und Agentflotte filtern sie hier heraus,
// statt dass jede Seite eine eigene Liste führt.
export const AUSGEBLENDETE_AGENTEN: readonly string[] = ["trader"];

export function istSichtbarerAgent(agent: Pick<Agent, "id">): boolean {
  return !AUSGEBLENDETE_AGENTEN.includes(String(agent.id ?? "").toLowerCase());
}

/**
 * Registereintrag (Kürzel, Persona, Farbe) für die Anzeige. Ohne Eintrag: Kürzel aus dem
 * Namen, graue Farbe. Ohne Persona (leer, z. B. ORACLE): die Rolle aus der Zeile.
 * Nur eigene Schlüssel zählen — ein Name wie "constructor" trifft nicht Object.prototype.
 */
export function registerEintragFuer(agent: Pick<Agent, "name" | "role">): { icon: string; persona: string; tierColor: string } {
  const name = typeof agent.name === "string" ? agent.name : "";
  const rolle = typeof agent.role === "string" ? agent.role : "";
  const eintrag = Object.prototype.hasOwnProperty.call(AGENT_REGISTRY, name) ? AGENT_REGISTRY[name] : null;
  if (!eintrag) return { icon: name.slice(0, 2) || "?", persona: rolle, tierColor: "#666" };
  return { ...eintrag, persona: eintrag.persona.trim() ? eintrag.persona : rolle };
}

// ── Letzte Aktivierung statt Registerstatus — Stufe 1 (06.11.2026, Befund R3) ──
// agents.status ist ein gespeicherter Wert: activate setzt "online", POST /api/messages
// "working", niemand setzt ihn zurück. Gemessen ist nur das Ereignis: last_heartbeat schreibt
// allein /api/agents/activate, und zwar nach einer Antwort mit Text.

export const AKTIVIERUNG_QUELLE = "agents.last_heartbeat — schreibt nur /api/agents/activate nach einer Antwort mit Text";

export interface AktivierungsAnzeige {
  /** "zuletzt aktiviert vor 3 h", "nie aktiviert" oder "Aktivierungszeit unlesbar". */
  text: string;
  /** title-Text: Zeitpunkt, Quelle und der Registerstatus als "nicht gemessen". */
  titel: string;
  /** false bei "nie aktiviert" und unlesbarem Zeitpunkt. */
  aktiviert: boolean;
}

/**
 * Anzeige der letzten Aktivierung. bezugIso ist die Uhrzeit, gegen die "vor X" gerechnet wird;
 * fehlt sie, steht der absolute Zeitpunkt da. registerStatus erscheint nur im title, als
 * "Registerstatus, nicht gemessen".
 */
export function aktivierungsAnzeige(
  lastHeartbeat: string | null | undefined,
  bezugIso: string | null | undefined,
  registerStatus?: string | null,
): AktivierungsAnzeige {
  const register =
    typeof registerStatus === "string" && registerStatus.trim()
      ? `\nRegisterstatus, nicht gemessen: ${registerStatus}`
      : "";
  if (lastHeartbeat === null || lastHeartbeat === undefined || lastHeartbeat === "") {
    return {
      text: "nie aktiviert",
      titel: `Keine Aktivierung eingetragen.\nQuelle: ${AKTIVIERUNG_QUELLE}${register}`,
      aktiviert: false,
    };
  }
  const zeit = typeof lastHeartbeat === "string" ? datumZeit(lastHeartbeat) : null;
  if (zeit === null) {
    return {
      text: "Aktivierungszeit unlesbar",
      titel: `Wert in agents.last_heartbeat nicht lesbar: ${String(lastHeartbeat)}\nQuelle: ${AKTIVIERUNG_QUELLE}${register}`,
      aktiviert: false,
    };
  }
  const bezug = typeof bezugIso === "string" && Number.isFinite(Date.parse(bezugIso)) ? bezugIso : null;
  const text = bezug ? `zuletzt aktiviert ${vorZeit(lastHeartbeat, bezug)}` : `zuletzt aktiviert ${zeit}`;
  return {
    text,
    titel: `Letzte Aktivierung: ${zeit}\nQuelle: ${AKTIVIERUNG_QUELLE}${register}`,
    aktiviert: true,
  };
}

export const PRIORITY_COLORS: Record<string, string> = {
  normal: "#6b6b7b",
  high: "#f59e0b",
  urgent: "#ff3366",
  critical: "#ff0000",
};

// ── Anzeige von Messwerten — Stufe 1 (05.11.2026) ──
// Reine Helfer ohne Abhängigkeiten. Sie liegen hier und nicht bei den Panels, damit die
// TopBar (im Layout jeder Seite) sie nutzen kann, ohne über die Panels lib/hooks und damit
// den Supabase-Client auf jeder Seite mitzuladen.

const ZAHL = new Intl.NumberFormat("de-DE");
const USD_2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_4 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function formatiereZahl(n: number): string {
  return ZAHL.format(n);
}

/** USD im deutschen Format, z. B. "$0,35". Ein Kleinstbetrag erscheint als "< $0,01" statt
 *  "$0,00" — sonst sähe ein bezahlter Lauf wie kein Lauf aus. */
export function formatiereUsd(betrag: number, stellen: 2 | 4 = 2): string {
  const format = stellen === 4 ? USD_4 : USD_2;
  const kleinster = stellen === 4 ? 0.0001 : 0.01;
  if (betrag > 0 && betrag < kleinster / 2) return `< $${format.format(kleinster)}`;
  return `$${format.format(betrag)}`;
}

/** HH:MM:SS in der Zeitzone des Browsers; null, wenn der Zeitpunkt fehlt oder unlesbar ist. */
export function uhrzeit(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString("de-DE", { hour12: false });
}

/** Datum und Uhrzeit im deutschen Format; null, wenn der Zeitpunkt fehlt oder unlesbar ist. */
export function datumZeit(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString("de-DE");
}

/** "vor 3 h" — Bezug ist der Messzeitpunkt des Servers (erzeugt_am), nicht die Browseruhr:
 *  Die Angabe gilt für den Moment der Messung und bleibt beim Rendern rein. */
export function vorZeit(iso: string, bezugIso: string): string {
  const ms = Date.parse(bezugIso) - Date.parse(iso);
  if (!Number.isFinite(ms)) return "Zeitpunkt unlesbar";
  const minuten = Math.floor(Math.max(ms, 0) / 60_000);
  if (minuten < 1) return "vor < 1 min";
  if (minuten < 60) return `vor ${minuten} min`;
  const stunden = Math.floor(minuten / 60);
  if (stunden < 48) return `vor ${stunden} h`;
  return `vor ${Math.floor(stunden / 24)} Tagen`;
}

/** Messfeld aus der Antwort; fehlt es (Server und Vertrag auseinander), wird es ehrlich
 *  "nicht gemessen" mit Grund — statt die Anzeige abstürzen zu lassen. */
export function messfeld<T>(m: Messwert<T> | null | undefined, name: string): Messwert<T> {
  if (m && typeof m === "object" && typeof m.status === "string") return m;
  return {
    wert: null,
    status: "nicht_gemessen",
    quelle: "/api/status",
    gemessen_am: null,
    hinweis: `Feld „${name}“ fehlt in der Antwort.`,
  };
}

const STATUS_FARBE: Record<MessStatus, string> = {
  ok: "var(--gp-emerald)",
  warnung: "var(--gp-amber)",
  fehler: "var(--gp-rose)",
  nicht_gemessen: "var(--gp-ink-3)",
};

export function statusFarbe(status: MessStatus): string {
  // Prüfbefund anzeige-5 (zweite Prüfung): Object.hasOwn statt Index — ein Status wie "toString"
  // aus einer fremden Antwort ergab sonst die geerbte Funktion als Farbe.
  return Object.hasOwn(STATUS_FARBE, status) ? STATUS_FARBE[status] : "var(--gp-ink-3)";
}

/** Klartext für ein Messfeld ohne Wert. */
export function statusText(status: MessStatus, nichtGemessen = "nicht gemessen"): string {
  if (status === "fehler") return "Fehler";
  if (status === "warnung") return "Warnung";
  if (status === "ok") return "ok";
  return nichtGemessen;
}

/** title-Text eines Messfelds: Quelle, Hinweis, Messzeitpunkt. */
export function messTitel(m: Messwert<unknown>, zusatz?: string): string {
  return [
    `Quelle: ${m.quelle}`,
    m.hinweis ? `Hinweis: ${m.hinweis}` : null,
    `gemessen: ${datumZeit(m.gemessen_am) ?? "nicht gemessen"}`,
    zusatz ?? null,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Totmann: Zeile „Crons" im Systemzustand (Objekt-Studio Stufe 2, §2.4) ──
// Der Server bewertet (bewerteTotmann in lib/status-server.ts), hier entsteht nur der Text — mit
// vorZeit, Bezug ist der Messzeitpunkt erzeugt_am. Nie „kein Lauf seit 30.07.": Die GitHub-Läufe
// bis 28.09.2026 haben nie einen Nachweis geschrieben (Spezifikation §2.4).
// Abweichung von §2.4 (datumZeit), Prüfbefund anzeige-4: Zeitpunkte im Tooltip stehen in
// Europe/Berlin (berlinDatumZeit) mit Zonenangabe, wie die Texte des Servers in der Zeile. Mit
// datumZeit (Zeitzone des Browsers) nannten Zeile und Tooltip für denselben Lauf verschiedene
// Uhrzeiten, sobald der Browser nicht auf Europe/Berlin stand.

let berlinZeitFormat: Intl.DateTimeFormat | null = null;

/** "09.11.2026 08:03:05" in Europe/Berlin; null, wenn der Zeitpunkt fehlt oder unlesbar ist. */
function berlinDatumZeit(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  berlinZeitFormat ??= new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const teil: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of berlinZeitFormat.formatToParts(new Date(t))) teil[p.type] = p.value;
  return `${teil.day}.${teil.month}.${teil.year} ${teil.hour}:${teil.minute}:${teil.second}`;
}

/** Zeitpunkt für den Tooltip: "09.11.2026 08:03:05 (Europe/Berlin)"; unlesbar → der Rohwert. */
function berlinZeitText(iso: string | null | undefined): string {
  const t = berlinDatumZeit(iso);
  return t === null ? (iso ?? "unbekannt") : `${t} (Europe/Berlin)`;
}

/**
 * Dieselbe Folge wie STATUS_RANG in lib/status-server.ts (Server-Datei, hier nicht importierbar).
 * Exportiert, damit tests/t-totmann.test.mjs die Gleichheit beider prüft (Prüfbefund B5).
 */
export const CRON_STATUS_RANG: Readonly<Record<MessStatus, number>> = { ok: 0, nicht_gemessen: 1, warnung: 2, fehler: 3 };

/**
 * Vorrang im Zeilentext bei gleicher Farbe (Prüfbefunde Z7, B3): zuerst Lagen mit Laufergebnis oder
 * Lauf-Mangel, dann "nicht lesbar" und "erster Sollzeitpunkt steht aus", zuletzt das gewollte "aus".
 * Vorher nannte die Zeile den ersten Job in Plan-Reihenfolge — ein abgeschalteter Job (bernstein)
 * verdrängte so den Teilausfall eines aktiven Jobs (ebenfalls bernstein) in den Tooltip.
 */
const LAGE_VORRANG: Readonly<Record<CronLage, number>> = {
  fehlgeschlagen: 0,
  ueberfaellig: 0,
  laeuft_obwohl_aus: 0,
  zeit_unplausibel: 0,
  teilweise: 0,
  ok: 0,
  nicht_lesbar: 1,
  erster_sollzeitpunkt_steht_aus: 1,
  aus: 2,
};

const ERGEBNIS_TEXT: Record<LaufErgebnis, string> = {
  ok: "ok",
  teilweise: "teilweise",
  fehler: "fehler",
  uebersprungen: "übersprungen",
};

// Prüfbefund anzeige-5 (zweite Prüfung): Object.hasOwn statt "in" bzw. Index. Vorher griffen die
// Rückfallregeln nicht für Namen aus Object.prototype: Ein Status "toString" ergab "0 von 3 Jobs:
// undefined", ein Ergebnis "constructor" im Tooltip den Quelltext einer Funktion.
function cronRang(status: unknown): number {
  return typeof status === "string" && Object.hasOwn(CRON_STATUS_RANG, status) ? CRON_STATUS_RANG[status as MessStatus] : CRON_STATUS_RANG.fehler;
}

function lageVorrang(lage: unknown): number {
  return typeof lage === "string" && Object.hasOwn(LAGE_VORRANG, lage) ? LAGE_VORRANG[lage as CronLage] : 0;
}

/** Ergebnis in Worten; ein unbekannter Wert erscheint, wie er ist. */
function ergebnisText(ergebnis: string): string {
  return Object.hasOwn(ERGEBNIS_TEXT, ergebnis) ? ERGEBNIS_TEXT[ergebnis as LaufErgebnis] : ergebnis;
}

function istSatz(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Text oder leer (null, fehlend) — ein Objekt im Text ergäbe "[object Object]". */
function istTextOderLeer(x: unknown): boolean {
  return x === null || x === undefined || typeof x === "string";
}

/**
 * Eine Zeile aus lauf_nachweis, wie die Anzeige sie liest. Prüfbefund B8: Auch die Teilergebnisse
 * werden geprüft — ein null-Element ließ cronsAnzeige vorher mitten im Rendern werfen.
 */
function istLaufLesung(x: unknown): boolean {
  if (!istSatz(x)) return false;
  return (
    typeof x.begonnen_am === "string" &&
    typeof x.ergebnis === "string" &&
    istTextOderLeer(x.hinweis) &&
    istTextOderLeer(x.eingetragen_am) &&
    (x.http_status === null || x.http_status === undefined || typeof x.http_status === "number") &&
    Array.isArray(x.teilergebnisse) &&
    x.teilergebnisse.every((t) => istSatz(t) && typeof t.agent === "string" && typeof t.ergebnis === "string" && istTextOderLeer(t.fehler))
  );
}

const CRON_TEXTFELDER = [
  "plan",
  "fundstelle",
  "aktiv_seit",
  "aus_seit",
  "grund",
  "sollzeitpunkt",
  "sollzeitpunkt_berlin",
  "erster_sollzeitpunkt_berlin",
  "urteil_ab_berlin",
  "ueberfaellig_seit_berlin",
  "stolperdraht_am_berlin",
  "stolperdraht_spalte",
  "stolperdraht_quittiert_bis_berlin",
  "hinweis",
] as const;

function istCronJob(x: unknown): x is CronJobStand {
  if (!istSatz(x)) return false;
  return (
    typeof x.job === "string" &&
    typeof x.bezeichnung === "string" &&
    typeof x.lage === "string" &&
    typeof x.status === "string" &&
    typeof x.aktiv === "boolean" &&
    (x.letzter_lauf === null || istLaufLesung(x.letzter_lauf)) &&
    (x.bewerteter_lauf === null || x.bewerteter_lauf === undefined || istLaufLesung(x.bewerteter_lauf)) &&
    CRON_TEXTFELDER.every((k) => istTextOderLeer(x[k]))
  );
}

/**
 * Feld crons aus /api/status. Alte Antworten (vor dem Totmann: wert null, "nicht_gemessen") gehen
 * unverändert durch; eine unlesbare Job-Liste wird wert null mit Grund — der Status (die Farbe)
 * des Servers bleibt.
 */
export function cronsFeld(m: Messwert<CronsWert> | null | undefined): Messwert<CronsWert> {
  const f = messfeld(m, "crons");
  if (f.wert === null) return f;
  const w: unknown = f.wert;
  const jobs = typeof w === "object" && w !== null ? (w as Record<string, unknown>).jobs : undefined;
  if (Array.isArray(jobs) && jobs.length > 0 && jobs.every(istCronJob)) return f;
  return {
    ...f,
    wert: null,
    hinweis: [f.hinweis, "Job-Liste der Antwort unlesbar"].filter(Boolean).join(" · "),
  };
}

/** "2026-07-30" → "30.07.2026"; anderes bleibt, wie es ist. */
function tagAnzeige(datum: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (datum ?? "unbekannt");
}

/** Die Zeile, aus der die Lage folgt; ohne bewerteter_lauf (ältere Antwort) die jüngste. */
function bewerteterLauf(j: CronJobStand): LaufNachweisLesung | null {
  return j.bewerteter_lauf ?? j.letzter_lauf;
}

function teilAnzeige(j: CronJobStand): string {
  const lauf = bewerteterLauf(j);
  const teile = lauf?.teilergebnisse ?? [];
  const gelaufen = teile.filter((t) => t.ergebnis !== "uebersprungen");
  const gescheitert = gelaufen.filter((t) => t.ergebnis === "fehler").length;
  const unvollstaendig = gelaufen.filter((t) => t.ergebnis === "teilweise").length;
  if (gescheitert > 0) {
    return `${gescheitert} von ${gelaufen.length} Agenten gescheitert${unvollstaendig > 0 ? ` · ${unvollstaendig} unvollständig` : ""}`;
  }
  if (unvollstaendig > 0) return `${unvollstaendig} von ${gelaufen.length} Agenten unvollständig`;
  return lauf?.hinweis ? `teilweise · ${lauf.hinweis}` : "teilweise";
}

/** Kurztext eines Jobs ohne Bezeichnung, z. B. "überfällig seit Mo 09.11. 08:03 · letzter Lauf nie". */
export function cronJobText(j: CronJobStand, bezugIso: string): string {
  const letzter = j.letzter_lauf ? vorZeit(j.letzter_lauf.begonnen_am, bezugIso) : "nie";
  switch (j.lage) {
    case "ok":
      return `${bewerteterLauf(j)?.ergebnis === "uebersprungen" ? "übersprungen" : "ok"} · letzter Lauf ${letzter}`;
    case "teilweise":
      return teilAnzeige(j);
    case "fehlgeschlagen":
      return "fehlgeschlagen";
    case "ueberfaellig":
      // Prüfbefund Z3: der erste verpasste Sollzeitpunkt; eine ältere Antwort kennt nur den jüngsten.
      return `überfällig seit ${j.ueberfaellig_seit_berlin ?? j.sollzeitpunkt_berlin ?? "unbekannt"} · letzter Lauf ${letzter}`;
    case "erster_sollzeitpunkt_steht_aus":
      return "erster Sollzeitpunkt steht aus";
    case "aus":
      return `aus seit ${tagAnzeige(j.aus_seit)}`;
    case "laeuft_obwohl_aus": {
      // Prüfbefund Z6: mit Datum statt im Präsens — ein einziger Lauf hielt die Zeile sonst monatelang
      // rot mit "läuft". Eine ältere Antwort ohne das Datum behält den alten Text.
      const kern = j.stolperdraht_am_berlin
        ? `lief zuletzt am ${j.stolperdraht_am_berlin}, obwohl als aus geführt`
        : "läuft, obwohl als aus geführt";
      return j.hinweis ? `${kern} · ${j.hinweis}` : kern;
    }
    case "zeit_unplausibel":
      return `Zeitpunkt des Laufs unplausibel${j.hinweis ? `: ${j.hinweis}` : ""}`;
    case "nicht_lesbar":
      return j.aktiv ? "Nachweis nicht lesbar" : `aus seit ${tagAnzeige(j.aus_seit)} · Nachweis nicht lesbar`;
    default:
      return "Lage unbekannt";
  }
}

/** Tooltip-Zeile eines gelesenen Laufs: Zeitpunkte (Europe/Berlin), Ergebnis, HTTP-Status, Hinweis. */
function laufZeile(titel: string, lauf: LaufNachweisLesung): string[] {
  const beginn = berlinDatumZeit(lauf.begonnen_am);
  const teile = [
    beginn === null ? "Zeitpunkt unlesbar" : `${beginn} (Europe/Berlin)`,
    ergebnisText(lauf.ergebnis),
    lauf.http_status !== null && lauf.http_status !== undefined ? `HTTP ${lauf.http_status}` : "ohne HTTP-Status",
    lauf.hinweis,
    lauf.eingetragen_am ? `eingetragen ${berlinDatumZeit(lauf.eingetragen_am) ?? "unlesbar"} (Europe/Berlin, DB-Uhr)` : null,
  ];
  const zeilen = [`  ${titel}: ${teile.filter(Boolean).join(" · ")}`];
  if (lauf.teilergebnisse.length > 0) {
    const agenten = lauf.teilergebnisse.map((t) => `${t.agent} ${ergebnisText(t.ergebnis)}${t.fehler ? ` (${t.fehler})` : ""}`);
    zeilen.push(`  Agenten: ${agenten.join(" · ")}`);
  }
  return zeilen;
}

/** Liegt der gemeldete Sollzeitpunkt vor aktiv_seit? Dann zählt er nicht (Prüfbefund anzeige-2). */
function sollVorAktivierung(j: CronJobStand): boolean {
  if (!j.aktiv || !j.aktiv_seit || !j.sollzeitpunkt) return false;
  const s = Date.parse(j.sollzeitpunkt);
  const seit = Date.parse(j.aktiv_seit);
  return Number.isFinite(s) && Number.isFinite(seit) && s < seit;
}

/** "Mo 16.11. 10:03" → "10:03", wenn der Tag derselbe ist wie in bezug ("Mo 16.11. 08:03"). */
function ohneGleichenTag(text: string, bezug: string): string {
  const tag = (t: string) => t.split(" ").slice(0, 2).join(" ");
  return tag(text) === tag(bezug) ? text.split(" ").slice(2).join(" ") : text;
}

/**
 * title-Zeilen eines Jobs: Plan-Setzung, Lage (wie die Zeile), Plan mit Fundstelle, Sollzeitpunkte,
 * Stolperdraht und Quittung, letzter Lauf mit Ergebnis, Teilergebnisse je Agent. Zweite Prüfung:
 * - anzeige-1: Der Stolperdraht nennt seinen Lauf immer; stammt er aus einer teilweise unlesbaren
 *   Zeile, heißt es nicht mehr "keine Zeile in lauf_nachweis" (das widersprach der roten Zeile).
 * - anzeige-2: Je Job die Lage; bei "erster Sollzeitpunkt steht aus" der erste zählende Sollzeitpunkt
 *   mit dem Urteilszeitpunkt statt eines S vor aktiv_seit; aktiv_seit heißt "laut Plan" (Setzung des
 *   Aktivierungs-PR, kein gemessener Zustand des VPS).
 * - anzeige-3: Die Quittung des Stolperdrahts ist sichtbar.
 * - anzeige-4: Zeitpunkte in Europe/Berlin mit Zonenangabe (Abweichung von §2.4, siehe oben).
 */
function cronJobTitel(j: CronJobStand, w: CronsWert, bezugIso: string): string[] {
  const planAktiv = j.aktiv_seit ? `laut Plan aktiv seit ${berlinZeitText(j.aktiv_seit)}` : "laut Plan aktiv";
  const lage = cronJobText(j, bezugIso);
  const zeilen = [
    `${j.bezeichnung} (${j.job}): ${j.aktiv ? planAktiv : `aus seit ${tagAnzeige(j.aus_seit)}${j.grund ? ` — ${j.grund}` : ""}`}`,
    `  Lage: ${lage}`,
    `  Plan: ${j.plan} · Fundstelle: ${j.fundstelle}`,
  ];
  if (j.sollzeitpunkt_berlin && !sollVorAktivierung(j)) zeilen.push(`  Sollzeitpunkt: ${j.sollzeitpunkt_berlin} (Europe/Berlin)`);
  if (j.erster_sollzeitpunkt_berlin) {
    const urteil = j.urteil_ab_berlin ? `, Urteil ab ${ohneGleichenTag(j.urteil_ab_berlin, j.erster_sollzeitpunkt_berlin)}` : "";
    zeilen.push(`  Erster zählender Sollzeitpunkt: ${j.erster_sollzeitpunkt_berlin} (Europe/Berlin)${urteil}`);
  }
  if (j.ueberfaellig_seit_berlin) zeilen.push(`  Überfällig seit: ${j.ueberfaellig_seit_berlin} (Europe/Berlin, erster verpasster Sollzeitpunkt)`);
  if (j.lage === "laeuft_obwohl_aus" && j.stolperdraht_am_berlin) {
    zeilen.push(
      j.stolperdraht_spalte === "eingetragen_am"
        ? `  Stolperdraht: Lauf eingetragen ${j.stolperdraht_am_berlin} (Europe/Berlin, DB-Uhr — Zeitstempel des Laufs unplausibel)`
        : `  Stolperdraht: Lauf begonnen ${j.stolperdraht_am_berlin} (Europe/Berlin)`,
    );
  }
  if (j.stolperdraht_quittiert_bis_berlin) {
    zeilen.push(`  Stolperdraht quittiert bis ${j.stolperdraht_quittiert_bis_berlin} (Europe/Berlin, Plan lib/totmann.ts) — Läufe davor lösen nicht aus`);
  }
  // Steht der Hinweis schon in der Lage (Stolperdraht, unplausible Zeit), nicht zweimal.
  if (j.hinweis && !lage.includes(j.hinweis)) zeilen.push(`  Hinweis: ${j.hinweis}`);
  const lauf = j.letzter_lauf;
  const bewertet = j.bewerteter_lauf ?? null;
  if (lauf) {
    zeilen.push(...laufZeile("Letzter Lauf", lauf));
    if (bewertet && (bewertet.begonnen_am !== lauf.begonnen_am || bewertet.ergebnis !== lauf.ergebnis)) {
      zeilen.push(...laufZeile("Bewertet (ein übersprungener Lauf überdeckt kein früheres Ergebnis)", bewertet));
    }
  } else if (j.lage === "laeuft_obwohl_aus") {
    // Prüfbefund anzeige-1: Der Stolperdraht kam aus einer Zeile, die nur teilweise lesbar ist.
    const wann = j.stolperdraht_am_berlin
      ? ` (${j.stolperdraht_spalte === "eingetragen_am" ? "eingetragen" : "begonnen"} ${j.stolperdraht_am_berlin}, Europe/Berlin)`
      : "";
    zeilen.push(`  Letzter Lauf: Zeile teilweise unlesbar${wann}`);
  } else if (j.lage === "nicht_lesbar" || w.lesefehler !== null) {
    zeilen.push("  Letzter Lauf: Nachweis nicht lesbar");
  } else if (!j.aktiv) {
    // Ehrlicher Text bei "aus" (§2.4). Prüfbefund B1: ein "seit" nur, wenn NACHWEIS_SEIT festgehalten
    // ist — vorher stand hier der Tag, an dem der Code entstand, ohne Tabelle und ohne Schreiber.
    zeilen.push(
      w.nachweis_seit
        ? `  Letzter Lauf: Nachweis-Tabelle seit ${tagAnzeige(w.nachweis_seit)}: kein Lauf · VPS-Crontab selbst nicht gemessen`
        : "  Letzter Lauf: keine Zeile in lauf_nachweis · seit wann die Tabelle besteht, ist nicht festgehalten · VPS-Crontab selbst nicht gemessen",
    );
  } else {
    const seit = berlinDatumZeit(j.aktiv_seit);
    const wann = j.aktiv_seit ? ` (laut Plan aktiv seit ${seit === null ? j.aktiv_seit : `${seit}, Europe/Berlin`})` : "";
    zeilen.push(`  Letzter Lauf: keiner in lauf_nachweis${wann}`);
  }
  return zeilen;
}

export interface CronsAnzeige {
  /** Text der Zeile; null ohne lesbare Job-Liste (dann zeigt die Zeile den Status in Worten). */
  text: string | null;
  /** Zusatz für den title: je Job Plan-Fundstelle, letzter Lauf mit Ergebnis, Teilergebnisse. */
  zusatz: string | undefined;
}

/**
 * Text der Zeile „Crons": beschreibt den schlechtesten Job (dessen Farbe die Zeile trägt).
 * Alle ok: "3 Jobs ok · letzter Lauf vor 2 h". Ein schlechtester Job: "<Bezeichnung>: <Lage>".
 * Mehrere mit derselben Lage: "aus seit 30.07.2026" (alle Jobs) bzw. "2 von 3 Jobs: …". Bei
 * gleicher Farbe zuerst Lagen mit Laufergebnis, dann "nicht lesbar", zuletzt "aus" (LAGE_VORRANG).
 */
export function cronsAnzeige(m: Messwert<CronsWert>, bezugIso: string): CronsAnzeige {
  const w = m.wert;
  if (!w || !Array.isArray(w.jobs) || w.jobs.length === 0) return { text: null, zusatz: undefined };
  const jobs = w.jobs;
  const schlechtesterRang = Math.max(...jobs.map((j) => cronRang(j.status)));
  let text: string;
  if (schlechtesterRang === CRON_STATUS_RANG.ok) {
    const juengster = jobs
      .map((j) => j.letzter_lauf?.begonnen_am)
      .filter((t): t is string => typeof t === "string" && Number.isFinite(Date.parse(t)))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    text = `${jobs.length} ${jobs.length === 1 ? "Job" : "Jobs"} ok${juengster ? ` · letzter Lauf ${vorZeit(juengster, bezugIso)}` : ""}`;
  } else {
    // Array.prototype.sort ist stabil: bei gleichem Vorrang bleibt die Plan-Reihenfolge.
    const schlecht = jobs
      .filter((j) => cronRang(j.status) === schlechtesterRang)
      .sort((a, b) => lageVorrang(a.lage) - lageVorrang(b.lage));
    const texte = schlecht.map((j) => cronJobText(j, bezugIso));
    if (schlecht.length === 1) {
      text = `${schlecht[0].bezeichnung}: ${texte[0]}`;
    } else if (texte.every((t) => t === texte[0])) {
      text = schlecht.length === jobs.length ? texte[0] : `${schlecht.length} von ${jobs.length} Jobs: ${texte[0]}`;
    } else {
      text = `${schlecht[0].bezeichnung}: ${texte[0]} · +${schlecht.length - 1} weitere`;
    }
  }
  const zusatz = jobs.flatMap((j) => cronJobTitel(j, w, bezugIso)).join("\n");
  return { text, zusatz };
}

// ── Kosten, Modelle und Metriken — Stufe 1 (06.11.2026, Befunde R11, R14, R15) ──

const USD_GENAU = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const ZAHL_FEIN = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6 });

/** USD mit genau 4 Nachkommastellen, z. B. "$0,0210". Ein positiver Betrag, der gerundet
 *  0 ergäbe, erscheint als "< $0,0001" — ein bezahlter Lauf sieht nie wie kein Lauf aus. */
export function formatiereUsd4(betrag: number): string {
  if (betrag > 0 && betrag < 0.00005) return `< $${USD_GENAU.format(0.0001)}`;
  return `$${USD_GENAU.format(betrag)}`;
}

/**
 * Untergrenze in USD mit "≥" (Gesamtprüfung 06.11.2026, gemessen): Vorher stand "≥ " vor dem
 * kaufmännisch gerundeten Betrag — 0,016 ergab "≥ $0,02", eine Grenze ÜBER der gemessenen
 * Summe, und 0,004 ergab "≥ < $0,01". Jetzt wird auf die letzte Stelle abgerundet; ein Betrag
 * über 0, aber unter der kleinsten Stelle, heißt "> $0 (gemessen unter $0,01)". stellen 4: genau
 * vier Nachkommastellen wie formatiereUsd4.
 */
export function formatiereUsdUntergrenze(betrag: number, stellen: 2 | 4 = 2): string {
  const format = stellen === 4 ? USD_GENAU : USD_2;
  const faktor = stellen === 4 ? 10_000 : 100;
  if (betrag > 0 && betrag < 1 / faktor) return `> $0 (gemessen unter $${format.format(1 / faktor)})`;
  // Zuschlag von 1e-6 Stellen gegen Gleitkomma-Reste (0,29 × 100 = 28,999…); er liegt weit unter
  // der Auflösung der Kostenwerte (Vielfache von 1e-6 USD) und hebt keinen Betrag über die Summe.
  return `≥ $${format.format(Math.floor(betrag * faktor + 1e-6) / faktor)}`;
}

export type ModellKlasse = "Sonnet" | "Haiku" | "andere";

/** Modellklasse aus der Modell-ID, ohne Rücksicht auf Groß- und Kleinschreibung. Was weder
 *  "sonnet" noch "haiku" enthält, ist "andere" — keine Klasse wird als Rest angenommen. */
export function modellKlasse(modell: string | null | undefined): ModellKlasse {
  const m = typeof modell === "string" ? modell.toLowerCase() : "";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("haiku")) return "Haiku";
  return "andere";
}

/** Listenpreis je Million Tokens als Text, Input und Output getrennt; null heißt
 *  "kein Tabellenpreis" (das Modell steht nicht in lib/kosten.ts). */
export function formatierePreis(preis: PreisJeMillion | null): string {
  if (!preis) return "kein Tabellenpreis";
  return `Input ${formatiereUsd(preis.input)} · Output ${formatiereUsd(preis.output)} je Mio. Tokens`;
}

/** Zeilengrenze der Abfrage in useMetrics: Alle Zahlen gelten "in den neuesten 200 Zeilen". */
export const METRIK_ABFRAGE_GRENZE = 200;

export interface MetrikAggregat {
  /** Summe der lesbaren Werte in den geladenen Zeilen. */
  sum: number;
  /** Zeilen dieses Typs mit lesbarem Wert. */
  count: number;
  /** Wert der jüngsten Zeile (created_at), nicht das Maximum; null, wenn kein Wert lesbar ist. */
  latest: number | null;
  /** created_at der jüngsten Zeile mit lesbarem Wert. */
  latestAm: string | null;
  /** Zeilen mit unlesbarem Wert; sie fehlen in sum, count und latest. */
  unlesbar: number;
}

const DEZIMALZAHL = /^\s*-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\s*$/i;

function leseMetrikWert(wert: unknown): number | null {
  if (typeof wert === "number") return Number.isFinite(wert) ? wert : null;
  // NUMERIC kann als Text ankommen; nur eine reine Dezimalzahl gilt.
  if (typeof wert === "string" && DEZIMALZAHL.test(wert)) {
    const n = Number(wert);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Metrik-Zeilen je Typ zusammenfassen. Die Abfrage sortiert absteigend nach created_at; die
 * erste lesbare Zeile je Typ ist daher die jüngste. Eine spätere Zeile ersetzt sie nur, wenn
 * beide Zeitstempel lesbar sind und ihrer nachweislich jünger ist.
 */
export function aggregiereMetriken(
  zeilen: readonly Pick<Metric, "metric_type" | "value" | "created_at">[],
): Record<string, MetrikAggregat> {
  // Map statt {}: ein Typ wie "__proto__" darf kein Prototyp-Feld treffen.
  const typen = new Map<string, MetrikAggregat & { latestMs: number | null }>();
  for (const zeile of zeilen) {
    const typ = typeof zeile.metric_type === "string" && zeile.metric_type.trim() ? zeile.metric_type : "unbekannt";
    let a = typen.get(typ);
    if (!a) {
      a = { sum: 0, count: 0, latest: null, latestAm: null, unlesbar: 0, latestMs: null };
      typen.set(typ, a);
    }
    const wert = leseMetrikWert(zeile.value);
    if (wert === null) {
      a.unlesbar += 1;
      continue;
    }
    a.sum += wert;
    a.count += 1;
    const ms = typeof zeile.created_at === "string" ? Date.parse(zeile.created_at) : NaN;
    const zeit = Number.isFinite(ms) ? ms : null;
    if (a.latest === null || (zeit !== null && a.latestMs !== null && zeit > a.latestMs)) {
      a.latest = wert;
      a.latestAm = typeof zeile.created_at === "string" ? zeile.created_at : null;
      a.latestMs = zeit;
    }
  }
  return Object.fromEntries(
    [...typen].map(([typ, a]) => [
      typ,
      { sum: a.sum, count: a.count, latest: a.latest, latestAm: a.latestAm, unlesbar: a.unlesbar },
    ]),
  );
}

/** llm_call-Zeilen schreibt /api/agents/activate mit value = geschätzte Kosten in USD. */
export function metrikEinheit(typ: string): string | null {
  return typ === "llm_call" ? "USD (geschätzt)" : null;
}

/** Wert einer Metrik-Zeile als Text: llm_call als USD mit 4 Nachkommastellen, sonst bis
 *  6 Nachkommastellen (kein Runden kleiner Werte auf "0"). */
export function formatiereMetrikWert(typ: string, wert: number): string {
  return typ === "llm_call" ? formatiereUsd4(wert) : ZAHL_FEIN.format(wert);
}

// ── Realtime-Kanal — Stufe 1 (06.11.2026, Befund R12) ──
// Der Zustand stammt allein aus dem subscribe-Callback des Supabase-Kanals. Vor dem ersten
// Callback ist er "unbekannt" — nie "verbunden" als Annahme.

export type RealtimeZustand = "unbekannt" | "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export function leseRealtimeZustand(status: unknown): RealtimeZustand {
  const s = String(status ?? "");
  return s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED" ? s : "unbekannt";
}

/** Text und vorhandene Statusklasse (globals.css: status-online/-error/-offline). */
export function realtimeAnzeige(zustand: RealtimeZustand): { text: string; klasse: string } {
  switch (zustand) {
    case "SUBSCRIBED":
      return { text: "Realtime verbunden", klasse: "status-online" };
    case "CHANNEL_ERROR":
      return { text: "Realtime-Fehler", klasse: "status-error" };
    case "TIMED_OUT":
      return { text: "Realtime: Zeitüberschreitung", klasse: "status-error" };
    case "CLOSED":
      return { text: "Realtime getrennt", klasse: "status-offline" };
    default:
      return { text: "Realtime: unbekannt", klasse: "status-offline" };
  }
}

// ── Monatskosten aus /api/status — Stufe 1 (06.11.2026, Befund R11) ──

export interface KachelAnzeige {
  wert: string;
  unterzeile: string;
  titel: string;
}

/**
 * Geschätzte Monatskosten für die Kennzahlen-Seite. Ein Betrag steht nur da, wenn ein Wert
 * gemeldet ist; ist der Monat nicht nachweislich vollständig (monat_vollstaendig !== true),
 * ist er eine Untergrenze und trägt "≥". Bei Abruffehler gelten alte Daten nicht.
 */
export function kostenMonatAnzeige(
  status: SystemStatus | null,
  fehler: string | null,
  loading: boolean,
  httpStatus: number | null = null
): KachelAnzeige {
  if (fehler) {
    // Gegencheck 06.11.2026 (R26 auch hier): 401 heißt nicht angemeldet, nicht "nicht lesbar" —
    // dieselbe Regel wie TopBar und Panels (istNichtAngemeldet).
    if (httpStatus === 401) {
      return {
        wert: "nicht angemeldet",
        unterzeile: "Kosten erst nach der Anmeldung lesbar",
        titel: "Nicht angemeldet (HTTP 401): Die Sitzung ist abgelaufen; der Systemzustand wurde nicht gelesen.",
      };
    }
    return { wert: "nicht lesbar", unterzeile: "Systemzustand nicht lesbar", titel: `Systemzustand nicht lesbar: ${fehler}` };
  }
  if (!status) {
    return loading
      ? { wert: "…", unterzeile: "Systemzustand wird geladen", titel: "Systemzustand wird geladen" }
      : { wert: "nicht gemessen", unterzeile: "kein Systemzustand", titel: "Kein Systemzustand geladen" };
  }
  const kosten = messfeld(status.kosten, "kosten");
  const w = kosten.wert;
  const monat = w && typeof w.monat_usd === "number" && Number.isFinite(w.monat_usd) ? w.monat_usd : null;
  if (kosten.status === "fehler" || kosten.status === "nicht_gemessen" || w === null || monat === null) {
    return {
      wert: kosten.status === "fehler" ? "Fehler" : "nicht gemessen",
      unterzeile: "Schätzung, nur Claude-Läufe über das Dashboard",
      titel: messTitel(kosten),
    };
  }
  const unvollstaendig = w.monat_vollstaendig !== true;
  const kleinbetrag = monat > 0 && monat < 0.005;
  // Untergrenze abgerundet (formatiereUsdUntergrenze), vollständige Summe gerundet.
  const betrag = unvollstaendig
    ? formatiereUsdUntergrenze(monat, kleinbetrag ? 4 : 2)
    : kleinbetrag
      ? formatiereUsd4(monat)
      : formatiereUsd(monat);
  const gruende: string[] = [];
  if (w.monat_vollstaendig === undefined) gruende.push("Vollständigkeit nicht gemeldet");
  if (typeof w.ohne_kosten_monat === "number" && w.ohne_kosten_monat > 0) {
    gruende.push(`${formatiereZahl(w.ohne_kosten_monat)} Läufe ohne Kostenangabe fehlen in der Summe`);
  }
  if (w.abgeschnitten === true) gruende.push("Abfrage abgeschnitten");
  return {
    wert: betrag,
    unterzeile: `geschätzt · nur Claude-Läufe über das Dashboard · seit Monatsbeginn${unvollstaendig ? " · Untergrenze" : ""}`,
    titel: messTitel(
      kosten,
      [...gruende, "Budget in EUR, Kosten in USD — nicht umgerechnet"].join("\n"),
    ),
  };
}

// ── Antwort von POST /api/agents/activate — Stufe 1 (06.11.2026, Befund R22) ──

export interface AktivierungsErgebnis {
  /** "ok" nur bei HTTP 2xx, abgeschnitten === false, stop_reason end_turn/stop_sequence,
   *  Antworttext vorhanden und ohne protokoll_fehler. */
  art: "ok" | "warnung" | "fehler";
  text: string;
  hinweise: string[];
}

const VOLLSTAENDIGE_STOPS = new Set(["end_turn", "stop_sequence"]);

/** Trenner, mit dem activate protokoll_fehler als Text verbindet (lib/status-server.ts). */
const PROTOKOLL_TRENNER = "; ";

/**
 * Protokollfehler der Aktivierung als Hinweise: vorrangig die Liste protokoll_fehler_liste (je
 * Eintrag ein Hinweis, Gesamtprüfung 06.11.2026), sonst protokoll_fehler als Text (am "; "
 * geteilt) oder als Liste (ältere Fassung). Unerwartete Formen heißen "unlesbarer Eintrag".
 */
function protokollHinweise(d: Record<string, unknown>): string[] {
  const liste = d.protokoll_fehler_liste;
  const pf = d.protokoll_fehler;
  const textGesetzt = typeof pf === "string" && pf.trim() !== "";
  let roh: unknown[];
  if (Array.isArray(liste) && (liste.length > 0 || !textGesetzt)) roh = liste;
  else if (typeof pf === "string") roh = pf.split(PROTOKOLL_TRENNER);
  else if (Array.isArray(pf)) roh = pf;
  else if (pf === undefined || pf === null) roh = [];
  else roh = [pf];
  const hinweise: string[] = [];
  if (liste !== undefined && liste !== null && !Array.isArray(liste)) hinweise.push("Protokoll: unlesbarer Eintrag");
  for (const eintrag of roh) {
    if (typeof eintrag !== "string") hinweise.push("Protokoll: unlesbarer Eintrag");
    else if (eintrag.trim()) hinweise.push(`Protokoll: ${eintrag.trim()}`);
  }
  // Fehlt die Bus-Zeile des Laufs (messages-Insert gescheitert), fehlen seine Kosten auch im
  // Systemzustand: /api/status summiert nur messages-Zeilen.
  if (roh.some((e) => typeof e === "string" && e.trim().startsWith("messages-Insert"))) {
    hinweise.push("Keine Bus-Zeile gespeichert — die Kosten dieses Laufs fehlen im Systemzustand (/api/status).");
  }
  return hinweise;
}

/**
 * Wertet die Antwort der Aktivierung aus. Fehlerformat: fehler (neu) oder error (alt).
 * protokoll_fehler kommt als Liste (protokoll_fehler_liste), als Text (Vertrag) oder als Liste
 * der älteren Fassung. Alles, was nicht nachweislich vollständig und sauber protokolliert ist,
 * wird "warnung" — nie grün.
 * Gesamtprüfung 06.11.2026: Auch eine Fehlerantwort trägt ihre Hinweise. Ein bezahlter Fehllauf
 * (HTTP 502 mit usage) zeigt seine geschätzten Kosten; vorher sah er aus wie ein unbezahlter
 * Fehler. protokoll_fehler einer Fehlerantwort erscheint ebenfalls.
 */
export function werteAktivierungAus(httpOk: boolean, httpStatus: number, daten: unknown): AktivierungsErgebnis {
  const d = daten !== null && typeof daten === "object" ? (daten as Record<string, unknown>) : {};
  if (!httpOk) {
    const grund =
      typeof d.fehler === "string" && d.fehler.trim()
        ? d.fehler
        : typeof d.error === "string" && d.error.trim()
          ? d.error
          : `HTTP ${httpStatus}`;
    const fehlerHinweise: string[] = [];
    // usage steht in einer Fehlerantwort nur bei einem bezahlten Fehllauf (activate: leere oder
    // unlesbare Antwort nach HTTP 2xx von Claude).
    if (d.usage !== null && typeof d.usage === "object" && !Array.isArray(d.usage)) {
      const u = d.usage as Record<string, unknown>;
      fehlerHinweise.push(
        typeof u.cost_usd === "number" && Number.isFinite(u.cost_usd)
          ? `Kosten (geschätzt): ${formatiereUsd4(u.cost_usd)} — bezahlt, ohne verwertbare Antwort`
          : "Kosten: nicht gemessen — Aufruf bezahlt, ohne verwertbare Antwort",
      );
    }
    fehlerHinweise.push(...protokollHinweise(d));
    return { art: "fehler", text: `Fehler: ${grund}`, hinweise: fehlerHinweise };
  }

  const hinweise: string[] = protokollHinweise(d);

  const stop = typeof d.stop_reason === "string" && d.stop_reason ? d.stop_reason : null;
  if (d.abgeschnitten === true) {
    hinweise.push(`Antwort abgeschnitten (stop_reason: ${stop ?? "nicht gemeldet"})`);
  } else if (d.abgeschnitten !== false || stop === null || !VOLLSTAENDIGE_STOPS.has(stop)) {
    hinweise.push(`Vollständigkeit nicht bestätigt (stop_reason: ${stop ?? "nicht gemeldet"})`);
  }

  const antwort = typeof d.response === "string" ? d.response : "";
  if (!antwort.trim()) hinweise.push("Antworttext leer");

  const usage = d.usage !== null && typeof d.usage === "object" ? (d.usage as Record<string, unknown>) : {};
  const kosten =
    typeof usage.cost_usd === "number" && Number.isFinite(usage.cost_usd)
      ? `Kosten (geschätzt): ${formatiereUsd4(usage.cost_usd)}`
      : "Kosten: nicht gemessen";

  const vorschau = antwort.length > 100 ? `${antwort.slice(0, 100)} …` : antwort;
  if (hinweise.length > 0) {
    return { art: "warnung", text: `Antwort erhalten, nicht als vollständig bestätigt: ${vorschau}`, hinweise: [...hinweise, kosten] };
  }
  return { art: "ok", text: `Agent aktiviert: ${vorschau}`, hinweise: [kosten] };
}

// ── Metadaten einer Bus-Nachricht als Text — Stufe 1 (06.11.2026) ──

/** Leere Werte heißen "nicht gemessen", Objekte erscheinen als JSON, cost_usd trägt
 *  "(geschätzt)" — die Kosten sind Schätzungen aus lib/kosten.ts. */
export function metaWertText(schluessel: string, wert: unknown): string {
  const name = schluessel === "cost_usd" ? "cost_usd (geschätzt)" : schluessel;
  let text: string;
  if (wert === null || wert === undefined) text = "nicht gemessen";
  else if (typeof wert === "object") {
    try {
      text = JSON.stringify(wert);
    } catch {
      text = "unlesbar";
    }
  } else text = String(wert);
  return `${name}: ${text.length > 120 ? `${text.slice(0, 120)} …` : text}`;
}

// ── Gegencheck 06.11.2026: Nachrichten aus Python und Fehlläufe ──

/**
 * Ein Wert als JSON-Objekt: Objekt bleibt Objekt; ein Text, der ein JSON-Objekt ist, wird zu
 * diesem Objekt. Python-Agenten (agents/base_agent.py bis 06.11.2026) schrieben content und
 * metadata als JSON-Text in die JSONB-Spalten; /messages zerlegte metadata dann in Chips aus
 * einzelnen Zeichen. null, wenn kein Objekt.
 */
export function alsJsonObjekt(wert: unknown): Record<string, unknown> | null {
  if (typeof wert === "object" && wert !== null && !Array.isArray(wert)) return wert as Record<string, unknown>;
  if (typeof wert === "string" && wert.trim().startsWith("{")) {
    try {
      const geparst: unknown = JSON.parse(wert);
      if (typeof geparst === "object" && geparst !== null && !Array.isArray(geparst)) return geparst as Record<string, unknown>;
    } catch {
      // kein JSON-Objekt: bleibt Text
    }
  }
  return null;
}

/** Metadaten für die Anzeige: Einträge eines Objekts (auch als JSON-Text); anderer Text als ein Eintrag. */
export function metadatenEintraege(meta: unknown): [string, unknown][] {
  const obj = alsJsonObjekt(meta);
  if (obj) return Object.entries(obj);
  if (typeof meta === "string" && meta.trim()) return [["metadata", meta]];
  return [];
}

/** Anzeigetext eines Nachrichteninhalts: Text, Feld "text" eines Objekts (auch als JSON-Text), sonst JSON. */
export function nachrichtInhaltText(inhalt: unknown): string {
  const obj = alsJsonObjekt(inhalt);
  if (obj && typeof obj.text === "string") return obj.text;
  if (typeof inhalt === "string") return inhalt;
  try {
    return JSON.stringify(inhalt) ?? "";
  } catch {
    return "unlesbarer Inhalt";
  }
}

/**
 * Fehllauf: bezahlter Aufruf ohne verwertbare Antwort (metadata.source "fehllauf", geschrieben von
 * api/agents/activate und api/donna/delegate mit message_type "response"). Command Center und
 * /messages zählen ihn nicht als Antwort.
 */
export function istFehllaufNachricht(m: { metadata?: unknown }): boolean {
  return alsJsonObjekt(m.metadata)?.source === "fehllauf";
}

// ── Nachbesserung 06.11.2026 (Prüfrunde nach Stufe 1) ──

/**
 * Eintrag einer festen Tabelle (Icons, Farben) nur für eigene Schlüssel. Ein Wert aus den
 * Daten wie "__proto__" oder "constructor" trifft so nie Object.prototype — sonst landete ein
 * Objekt als React-Kind auf der Seite (Absturz) oder als Farbe im Markup.
 */
export function eigenerEintrag<T>(tabelle: Readonly<Record<string, T>>, schluessel: unknown): T | undefined {
  return typeof schluessel === "string" && Object.prototype.hasOwnProperty.call(tabelle, schluessel)
    ? tabelle[schluessel]
    : undefined;
}

function alsTextListe(wert: unknown): string[] {
  return Array.isArray(wert) ? wert.map((x) => String(x)) : [];
}

/**
 * Sichtbar, wenn der Absender kein ausgeblendeter Agent ist und die Nachricht nicht nur an
 * ausgeblendete Agenten geht (ohne Kanal). Dieselbe Regel wie im MessageFeed des Command
 * Centers (components/ui/MessageFeed.tsx); /messages listet und zählt damit.
 */
export function istSichtbareNachricht(m: Pick<Message, "from_agent" | "to_agents" | "to_channels">): boolean {
  if (!istSichtbarerAgent({ id: String(m.from_agent ?? "") })) return false;
  const an = alsTextListe(m.to_agents);
  const kanaele = alsTextListe(m.to_channels);
  if (an.length > 0 && kanaele.length === 0 && an.every((a) => !istSichtbarerAgent({ id: a }))) return false;
  return true;
}

/** Empfänger einer Nachricht ohne ausgeblendete Agenten; kein Array heißt keine Empfänger. */
export function sichtbareEmpfaenger(m: Pick<Message, "to_agents">): string[] {
  return alsTextListe(m.to_agents).filter((a) => istSichtbarerAgent({ id: a }));
}

/** Kanäle einer Nachricht als Textliste; kein Array heißt keine Kanäle. */
export function nachrichtKanaele(m: Pick<Message, "to_channels">): string[] {
  return alsTextListe(m.to_channels);
}

/**
 * Neue Nachricht (Realtime-INSERT) oben einfügen, höchstens grenze Einträge. Steht dieselbe id
 * schon in der Liste — etwa weil ein Neuladen die Zeile vor dem Realtime-Ereignis gelesen hat —,
 * bleibt die Liste unverändert: keine Dublette, kein doppelter React-Schlüssel.
 */
export function nachrichtVorne<T extends { id?: unknown }>(liste: T[], neu: T, grenze: number): T[] {
  const id = neu.id;
  if (id !== undefined && id !== null && id !== "" && liste.some((m) => m.id === id)) return liste;
  return [neu, ...liste].slice(0, grenze);
}

export interface ServerZaehlung {
  /** Gesamtzahl laut Server; null, wenn nicht aktuell gemessen. */
  anzahl: number | null;
  /** title-Text: Quelle und Messzeitpunkt oder der Grund, warum keine Zahl vorliegt. */
  titel: string;
}

/**
 * Gesamtzahl der Zeilen in messages laut /api/status (Service-Key, count exact) als Gegenprobe
 * zur Liste im Browser. Wie im Command Center gelten bei einem Abruffehler alte Daten nicht.
 */
export function busZaehlung(status: SystemStatus | null, fehler: string | null): ServerZaehlung {
  if (fehler) return { anzahl: null, titel: `Systemzustand nicht lesbar: ${fehler}` };
  if (!status) return { anzahl: null, titel: "Systemzustand nicht geladen" };
  const bus = messfeld(status.bus, "bus");
  const n = bus.wert && typeof bus.wert.anzahl === "number" ? bus.wert.anzahl : null;
  if (n === null || !Number.isFinite(n) || n < 0 || (bus.status !== "ok" && bus.status !== "warnung")) {
    return { anzahl: null, titel: messTitel(bus) };
  }
  return { anzahl: n, titel: messTitel(bus, "Gesamtzahl der Zeilen in messages, gezählt mit dem Service-Key") };
}

/**
 * Gesamtzahl der Zeilen in agents laut /api/status (Service-Key, count exact, ausgeblendete
 * mitgezählt) als Gegenprobe zur Liste im Browser. Bei Abruffehler gelten alte Daten nicht.
 */
export function agentenZaehlung(status: SystemStatus | null, fehler: string | null): ServerZaehlung {
  if (fehler) return { anzahl: null, titel: `Systemzustand nicht lesbar: ${fehler}` };
  if (!status) return { anzahl: null, titel: "Systemzustand nicht geladen" };
  const agenten = messfeld(status.agenten, "agenten");
  const n = agenten.wert && typeof agenten.wert.anzahl === "number" ? agenten.wert.anzahl : null;
  if (n === null || !Number.isFinite(n) || n < 0 || (agenten.status !== "ok" && agenten.status !== "warnung")) {
    return { anzahl: null, titel: messTitel(agenten) };
  }
  return { anzahl: n, titel: messTitel(agenten, "Zeilen in agents, gezählt mit dem Service-Key, ausgeblendete mitgezählt") };
}

export interface LeerHinweis {
  text: string;
  zusatz: string | null;
  /** Browser-Liste und Server-Zählung widersprechen sich: in Warnfarbe zeigen. */
  widerspruch: boolean;
}

/**
 * Leertext, wenn die Abfrage im Browser keine Zeile lieferte. Er sagt, was die Abfrage
 * geliefert hat, nie, was in der Tabelle steht. Gegenprobe ist eine Zählung über /api/status
 * (serverAnzahl; null = nicht verfügbar). Zählt der Server Zeilen, widersprechen sich beide.
 * was: Mehrzahl im Akkusativ, z. B. "Nachrichten" oder "Agenten".
 */
export function leereAbfrageHinweis(was: string, serverAnzahl: number | null): LeerHinweis {
  if (serverAnzahl !== null && serverAnzahl > 0) {
    return {
      text: `Die Abfrage im Browser lieferte keine ${was}, der Server zählt ${formatiereZahl(serverAnzahl)}.`,
      zusatz: "Widerspruch: Lesen im Browser vermutlich gesperrt oder fehlgeschlagen — Lesezugriff prüfen.",
      widerspruch: true,
    };
  }
  if (serverAnzahl === 0) {
    return {
      text: `Die Abfrage im Browser lieferte keine ${was}.`,
      zusatz: `Der Server zählt ebenfalls 0 ${was} (Gegenprobe über /api/status).`,
      widerspruch: false,
    };
  }
  return {
    text: `Die Abfrage im Browser lieferte keine ${was}.`,
    zusatz: "Gegenprobe über /api/status nicht verfügbar — ob die Tabelle leer ist, ist nicht belegt.",
    widerspruch: false,
  };
}

/** Leertext für das Agenten-Register (Agentflotte, /metrics), wenn keine sichtbare Einheit gelesen wurde. */
export function agentenLeerHinweis(ausgeblendet: number, serverAnzahl: number | null): LeerHinweis {
  if (ausgeblendet > 0) {
    return {
      text: `Die Abfrage im Browser lieferte nur ausgeblendete Agenten (${formatiereZahl(ausgeblendet)}) — keine Einheit wird angezeigt.`,
      zusatz: null,
      widerspruch: false,
    };
  }
  return leereAbfrageHinweis("Agenten", serverAnzahl);
}

/**
 * Leertext für /messages, wenn nach Ausblenden und Filtern nichts zu zeigen ist.
 * gelesen: alle gelesenen Zeilen; ausgeblendet: davon Nachrichten ausgeblendeter Agenten.
 */
export function nachrichtenLeerHinweis(a: {
  gelesen: number;
  ausgeblendet: number;
  grenze: number;
  serverAnzahl: number | null;
}): LeerHinweis {
  if (a.gelesen === 0) return leereAbfrageHinweis("Nachrichten", a.serverAnzahl);
  if (a.ausgeblendet >= a.gelesen) {
    return {
      text: `Keine Nachrichten sichtbarer Agenten in den neuesten ${a.grenze} — ${formatiereZahl(a.ausgeblendet)} von ausgeblendeten Agenten nicht angezeigt.`,
      zusatz: null,
      widerspruch: false,
    };
  }
  return { text: `Keine Nachrichten für diesen Filter in den neuesten ${a.grenze}.`, zusatz: null, widerspruch: false };
}
