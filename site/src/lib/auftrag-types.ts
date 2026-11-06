// Vertrag der Auftragszeile (POST /api/donna/delegate) — Objekt-Studio Stufe 1, 05.11.2026
// (abgeschnitten, stop_reason und laeufe_ohne_kosten ergänzt am 06.11.2026).
//
// Ablauf: Erst planen, dann GENAU diesen Plan ausführen.
// 1. POST { task }                         → PlanAntwort. Der Server speichert den Plan als
//                                            messages-Zeile (metadata.source "delegate-plan").
// 2. POST { auftrag_id, ausfuehren: true } → AusfuehrungAntwort. Der Server lädt den
//                                            gespeicherten Plan und führt ihn aus; er plant
//                                            nicht neu. Ein zweites Ausführen derselben
//                                            auftrag_id wird abgelehnt (409).
// Das frühere { task, auto_execute: true } (Ausführen ohne angezeigten Plan) gibt 400.

export interface PlanSchritt {
  /** Agenten-ID aus der Erlaubt-Liste des Servers (ohne trader). */
  id: string;
  task: string;
  /** 1 = zuerst; gleiche Priorität läuft parallel; spätere Stufen bekommen die Ergebnisse früherer. */
  priority: number;
}

export interface DelegationsPlan {
  agents: PlanSchritt[];
  reasoning: string;
}

export interface PlanungsKosten {
  modell: string;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Schätzung: Tokens × feste Preistabelle (lib/kosten.ts). */
  kosten_usd_geschaetzt: number | null;
  stop_reason: string | null;
}

export interface PlanAntwort {
  mode: "plan";
  auftrag_id: string;
  original_task: string;
  delegation_plan: DelegationsPlan;
  planung: PlanungsKosten;
  erstellt_am: string;
  /** Gesetzt, wenn der Plan nicht gespeichert werden konnte; dann ist Ausführen gesperrt. */
  protokoll_fehler?: string;
}

export interface AusfuehrungsErgebnis {
  agent_id: string;
  task: string;
  priority: number;
  /** Antworttext, gekürzt; leer, wenn fehler gesetzt ist. */
  response: string;
  /** Geschätzte Kosten in USD; null, wenn unbekannt. */
  cost: number | null;
  fehler: string | null;
  /**
   * true = Antwort unvollständig (stop_reason weder end_turn noch stop_sequence, z. B.
   * max_tokens oder refusal); null = nicht gemeldet oder Lauf gescheitert. Ein Lauf zählt
   * nur als erfolgreich, wenn fehler null UND abgeschnitten === false ist.
   */
  abgeschnitten: boolean | null;
  stop_reason: string | null;
}

export interface AusfuehrungAntwort {
  mode: "ausgefuehrt";
  auftrag_id: string;
  original_task: string;
  delegation_plan: DelegationsPlan;
  results: AusfuehrungsErgebnis[];
  summary: {
    /** Läufe mit fehler === null UND abgeschnitten === false. */
    agents_activated: number;
    /** Nur die Agenten-Läufe mit Kostenangabe; die Planung steht in der PlanAntwort. null, wenn kein Lauf eine Kostenangabe hat. */
    total_cost_usd_geschaetzt: number | null;
    /** Läufe ohne Kostenangabe; sie fehlen in total_cost_usd_geschaetzt. */
    laeufe_ohne_kosten: number;
  };
  /** Immer gesetzt: Ergebnisse sind ungeprüft und gehen nicht automatisch nach außen. */
  hinweis: string;
}

export interface PlanAnfrage {
  task: string;
}

export interface AusfuehrenAnfrage {
  auftrag_id: string;
  ausfuehren: true;
}

export const MAX_PLAN_SCHRITTE = 4;
