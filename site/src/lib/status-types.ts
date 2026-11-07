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

// ── Totmann für Crons und Agenten (Objekt-Studio Stufe 2, Rest aus Stufe 1) ──
// Spezifikation: docs/intern/objekt-studio-stufe-2.md §2.2–2.4. Plan: lib/totmann.ts; Bewertung:
// bewerteTotmann() in lib/status-server.ts; Tabelle: scripts/lauf_nachweis.sql (Entwurf).

/** Ergebnis eines Laufs; dieselben Werte wie der CHECK auf lauf_nachweis.ergebnis. */
export type LaufErgebnis = "ok" | "teilweise" | "fehler" | "uebersprungen";

/** Ergebnis je Agent eines Laufs (lauf_nachweis.teilergebnisse); fehler bereinigt (bereinigeFehler). */
export interface LaufTeilergebnis {
  agent: string;
  ergebnis: LaufErgebnis;
  fehler: string | null;
}

/**
 * Eine gelesene Zeile aus lauf_nachweis. begonnen_am und beendet_am stammen beide aus der App-Uhr,
 * eingetragen_am aus der DB-Uhr (DEFAULT now()). Alle drei sind NOT NULL (scripts/lauf_nachweis.sql);
 * eingetragen_am liest der Totmann für den Uhrenabgleich (Prüfbefunde Z2, SR-5).
 */
export interface LaufNachweisLesung {
  job: string;
  begonnen_am: string;
  beendet_am: string;
  eingetragen_am: string;
  ergebnis: LaufErgebnis;
  http_status: number | null;
  teilergebnisse: LaufTeilergebnis[];
  hinweis: string | null;
}

/**
 * Lage eines Jobs nach der Tabelle in §2.3. Farbe (status): ok → "ok"; teilweise und aus →
 * "warnung"; fehlgeschlagen, ueberfaellig, laeuft_obwohl_aus und zeit_unplausibel → "fehler";
 * erster_sollzeitpunkt_steht_aus → "nicht_gemessen"; nicht_lesbar → "warnung", wenn der Job aus
 * ist, sonst "fehler". zeit_unplausibel (aktiver Job, Prüfbefunde Z2, SR-5): begonnen_am liegt nach
 * der Messzeit, oder App- und DB-Uhr der Zeile weichen zu weit ab — der Zeile wird nicht geglaubt.
 */
export type CronLage =
  | "ok"
  | "teilweise"
  | "fehlgeschlagen"
  | "ueberfaellig"
  | "erster_sollzeitpunkt_steht_aus"
  | "aus"
  | "laeuft_obwohl_aus"
  | "zeit_unplausibel"
  | "nicht_lesbar";

// Felder nach dem 07.11.2026 (Prüfbefunde Z1, Z3, Z5, Z6) sind optional: Eine Antwort ohne sie
// liest cronsAnzeige (lib/types.ts) wie bisher.
export interface CronJobStand {
  job: string;
  bezeichnung: string;
  /** Plan in Worten, z. B. "Mo–Fr 08:03 Europe/Berlin (angenommen, VPS-Zeitzone nicht gemessen), Karenz 2 h (Setzung)". */
  plan: string;
  /** Woher der Plan stammt (lib/totmann.ts, fundstelle). */
  fundstelle: string;
  aktiv: boolean;
  /** ISO-Zeitpunkt aus dem Plan, ab dem ein aktiver Job laufen muss; null bei abgeschalteten Jobs. */
  aktiv_seit?: string | null;
  /** JJJJ-MM-TT, nur bei abgeschalteten Jobs. */
  aus_seit: string | null;
  grund: string | null;
  lage: CronLage;
  status: MessStatus;
  /** Jüngster Sollzeitpunkt S mit S + Karenz ≤ Messzeit (ISO); null bei abgeschalteten Jobs oder ohne Sollzeitpunkt. */
  sollzeitpunkt: string | null;
  /** S in Europe/Berlin, z. B. "Mo 09.11. 08:03" — der Browser kann in einer anderen Zeitzone stehen. */
  sollzeitpunkt_berlin: string | null;
  /** Nur bei ueberfaellig: erster verpasster Sollzeitpunkt nach dem letzten Lauf bzw. ab aktiv_seit (ISO). */
  ueberfaellig_seit?: string | null;
  /** ueberfaellig_seit in Europe/Berlin, z. B. "Di 17.11. 08:03". */
  ueberfaellig_seit_berlin?: string | null;
  /** Nur bei laeuft_obwohl_aus: begonnen_am des jüngsten auslösenden Laufs (ISO). */
  stolperdraht_am?: string | null;
  /** stolperdraht_am in Europe/Berlin, z. B. "20.11.2026 18:03". */
  stolperdraht_am_berlin?: string | null;
  /** Jüngste Zeile dieses Jobs in lauf_nachweis; null = keine Zeile oder nicht lesbar. */
  letzter_lauf: LaufNachweisLesung | null;
  /**
   * Die Zeile, aus der ok, teilweise oder fehlgeschlagen folgt: der jüngste Lauf ab S − 10 min mit
   * einem Ergebnis außer uebersprungen, sonst der übersprungene. Kann älter sein als letzter_lauf —
   * ein übersprungener Lauf überdeckt kein früheres Ergebnis (Prüfbefund Z5). null sonst.
   */
  bewerteter_lauf?: LaufNachweisLesung | null;
  /** Begründung zur Lage, z. B. warum die Zeit unplausibel ist oder dass eine Zeile teilweise unlesbar ist. */
  hinweis?: string | null;
}

export interface CronsWert {
  /** Je Job des Plans ein Eintrag, in Plan-Reihenfolge. */
  jobs: CronJobStand[];
  /**
   * NACHWEIS_SEIT aus lib/totmann.ts: Tag, seit dem lauf_nachweis in Produktion besteht; null, solange
   * Deploy und SQL nicht festgehalten sind — dann behauptet der Tooltip kein Beobachtungsfenster.
   */
  nachweis_seit: string | null;
  /** Lesefehler von lauf_nachweis (bereinigt, auch eine fehlende Tabelle); null = gelesen. */
  lesefehler: string | null;
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
  /**
   * Totmann: je Job des Plans (lib/totmann.ts) die jüngste Zeile aus lauf_nachweis, bewertet nach
   * §2.3; status = Farbe des schlechtesten Jobs. Ausnahme von der Grundregel oben: Steht der
   * schlechteste Job auf "erster Sollzeitpunkt steht aus", ist status "nicht_gemessen", wert und
   * gemessen_am bleiben aber gesetzt — gelesen wurde, nur geurteilt werden kann noch nicht.
   * Fehlt der Service-Schlüssel, wurde lauf_nachweis nicht abgefragt: gemessen_am ist dann null,
   * wert trägt die Jobs als "nicht lesbar" (Prüfbefunde SR-6, B9).
   * Antworten von vor dem Totmann tragen hier wert null und status "nicht_gemessen"; der Leser
   * (cronsFeld in lib/types.ts) verträgt beides.
   */
  crons: Messwert<CronsWert>;
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
