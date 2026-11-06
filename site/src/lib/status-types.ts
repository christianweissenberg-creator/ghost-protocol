// Verträge für den ehrlichen Systemzustand (GET /api/status) und den Freigabe-Stapel
// (GET /api/freigaben) — Objekt-Studio Stufe 1, 05.11.2026 (erweitert 06.11.2026).
//
// Grundregel: Jede angezeigte Zahl trägt ihre Quelle und ihren Messzeitpunkt. Was nicht
// gemessen ist, hat status "nicht_gemessen" und wert = null — nie 0, nie ein Platzhalter.
// Kosten sind immer Schätzungen (Tokens × Preistabelle in lib/kosten.ts) und heißen auch so.

export type MessStatus = "ok" | "warnung" | "fehler" | "nicht_gemessen";

export interface Messwert<T> {
  /** Gemessener Wert; null, wenn nicht gemessen oder die Messung fehlschlug. */
  wert: T | null;
  status: MessStatus;
  /** Woher der Wert stammt, für Menschen lesbar, z. B. "Supabase · Tabelle agents". */
  quelle: string;
  /** ISO-Zeitpunkt der Messung; null, wenn nicht gemessen. */
  gemessen_am: string | null;
  /** Einschränkungen der Messung oder Grund für "nicht_gemessen". */
  hinweis?: string;
}

/**
 * Geschätzte Kosten aus messages.metadata.cost_usd. Gezählt werden Zeilen mit
 * metadata.source "activation-api" (Agenten-Läufe), "delegate-plan" (L.I.S.A.-Planungen)
 * und "fehllauf" (bezahlte Aufrufe ohne verwertbare Antwort; metadata.art "aktivierung"
 * oder "planung"). Tag und Monat beginnen um Mitternacht Europe/Berlin.
 */
export interface KostenWert {
  heute_usd: number;
  monat_usd: number;
  /** Anteil der L.I.S.A.-Planungen (source "delegate-plan" und Fehlläufe mit art "planung"). */
  planung_heute_usd: number;
  planung_monat_usd: number;
  /** Gezählte Zeilen im Monat, mit und ohne Kostenangabe. */
  laeufe_monat: number;
  /** Zeilen ohne cost_usd; sie fehlen in der jeweiligen Summe. */
  ohne_kosten_heute: number;
  ohne_kosten_monat: number;
  /** true nur, wenn im Zeitraum keine Zeile ohne Kostenangabe ist und nichts abgeschnitten wurde. */
  heute_vollstaendig: boolean;
  monat_vollstaendig: boolean;
  /** Zeilenlimit der Abfrage erreicht: Summen sind Untergrenzen. */
  abgeschnitten: boolean;
}

export interface SystemStatus {
  erzeugt_am: string;
  /** Probe-Abfrage mit dem Service-Key, Dauer in ms. */
  supabase: Messwert<{ latenz_ms: number }>;
  /** Zeilen in agents; ausgeblendet = Agenten, die das Dashboard nicht mehr zeigt (z. B. trader). */
  agenten: Messwert<{ anzahl: number; ausgeblendet: string[] }>;
  /** Gesamtzahl der Zeilen in messages (count exact, nicht die geladenen 30). */
  bus: Messwert<{ anzahl: number }>;
  /** Jüngste messages-Zeile mit metadata.source = "activation-api". */
  letzte_aktivierung: Messwert<{ am: string; agent: string }>;
  /** Verschiedene from_agent mit Aktivierung in den letzten 24 Stunden. */
  aktive_agenten_24h: Messwert<{ anzahl: number; agenten: string[] }>;
  /** content-Zeilen mit created_at ab Mitternacht Europe/Berlin. */
  content_heute: Messwert<{ anzahl: number }>;
  /** wartend = status zur_freigabe; haengend = entwurf/counsel_geprueft älter als 2 h; fehler_7_tage = status fehler. */
  freigabe: Messwert<{ wartend: number; haengend: number; fehler_7_tage: number }>;
  /** Schätzung, nur Läufe über das Dashboard (siehe KostenWert). */
  kosten: Messwert<KostenWert>;
  /** Abruf des Steinadel-Exports über den Server, mit Timeout. */
  steinadel_export: Messwert<{ objekte: number; latenz_ms: number }>;
  /** Nur ob ANTHROPIC_API_KEY gesetzt ist — nie der Wert. */
  anthropic: Messwert<{ konfiguriert: boolean }>;
  /** Kein Lauf-Nachweis im Dashboard lesbar: immer "nicht_gemessen" mit Hinweis. */
  crons: Messwert<null>;
  /** Der Riegel liegt im Agenten-Container (GP_EXTERNAL_POSTING); vom Dashboard nicht messbar. */
  posting_riegel: Messwert<null>;
  /** Kein gespeicherter Zustellstatus: "nicht_gemessen". */
  telegram: Messwert<null>;
}

export type CounselUrteil = "FREIGABE" | "ABLEHNUNG" | "UNKLAR";

export interface FreigabeEintrag {
  id: string;
  title: string | null;
  platform: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  /** Stunden seit updated_at (ersatzweise created_at), eine Nachkommastelle. */
  alter_stunden: number;
  objekt_slug: string | null;
  /** Aus review_notes mit werteCounselAus() abgeleitet — kein gespeichertes Feld; zeile mit maskiertem Namen. */
  counsel: { urteil: CounselUrteil; zeile: string | null; abgeleitet: true };
  /** Sperrgrund aus pruefeFreigabe() (lib/freigabe-regeln.ts); null = serverseitig freigebbar. */
  freigabe_sperre: string | null;
  /** body leer oder nur Leerraum. */
  text_leer: boolean;
  text_zeichen: number;
  /** body (PUBLISHER-Fassung) weicht vom COUNSEL-geprüften Text (metadata.steps[1].output) ab. */
  geprueft_ungleich_freigabe: boolean;
}

export interface FreigabenAntwort {
  erzeugt_am: string;
  /** status = zur_freigabe, älteste zuerst, höchstens 100 Einträge. */
  wartend: FreigabeEintrag[];
  wartend_gesamt: number;
  /** status in (entwurf, counsel_geprueft) ohne Änderung seit mehr als 2 Stunden. */
  haengend: FreigabeEintrag[];
  haengend_gesamt: number;
  quelle: string;
  /** Lesefehler; dann sind die Listen leer und die Zahlen 0 nur als "nicht lesbar" zu deuten. */
  fehler: string | null;
}
