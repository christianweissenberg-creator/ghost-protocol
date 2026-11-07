// Totmann für Crons und Agenten — Plan als Konstante (Objekt-Studio Stufe 2, Rest aus Stufe 1;
// docs/intern/objekt-studio-stufe-2.md §2.2 Punkt 3 und §2.3).
//
// Die Datei hat bewusst keine Imports: GET /api/status liest den Plan, die Schreiber in
// /api/cron/briefing und /api/content/auto-produce nehmen die Job-Namen, und die Tests laden sie
// direkt (tests/b-status-server.test.mjs). Die Bewertung liegt in lib/status-server.ts
// (letzterSollzeitpunkt, bewerteJob, bewerteTotmann), das SQL der Tabelle in
// scripts/lauf_nachweis.sql (Entwurf, nicht ausgeführt).
//
// Zeitzone offen: Für die curl-Jobs gibt es nur den Kommentar „CET" (setup-vps-crons.sh:20).
// crontab:3 („Alle Zeiten in UTC") gilt für die Python-Jobs des DONNA-Schedulers und ist
// nicht versioniert. Maßgeblich ist die Systemzeitzone des VPS, sie ist nicht gemessen.
// Vor aktiv:true messen.
//
// Vor jedem aktiv:true gilt §2.6 der Spezifikation (neues CRON_SECRET, Middleware-Ausnahme R7,
// Header statt ?secret=, gemessene Zeitzone, umgebauter Launch-Kalender) — im selben PR, sonst
// wird der Totmann am ersten Werktag rot.

/** Tabelle des Lauf-Nachweises (scripts/lauf_nachweis.sql). Nur die Service-Rolle liest und hängt an. */
export const NACHWEIS_TABELLE = "lauf_nachweis";

/**
 * Datum (JJJJ-MM-TT, Europe/Berlin), seit dem der Schreiber im Code steht (Branch feat/totmann,
 * 07.11.2026). Kein Deploy-Datum: Die Tabelle lauf_nachweis gibt es erst nach Ausführung von
 * scripts/lauf_nachweis.sql, und die ist ein Inhaberentscheid. Ein aktiver Job, dessen jüngster
 * Sollzeitpunkt vor diesem Tag liegt, heißt "erster Sollzeitpunkt steht aus" (nicht gemessen).
 */
export const NACHWEIS_SEIT = "2026-11-07";

export const JOB_BRIEFING_MORGEN = "briefing-morgen";
export const JOB_BRIEFING_ABEND = "briefing-abend";
export const JOB_AUTO_PRODUCE = "content-auto-produce";
/**
 * Job der Probe-Läufe (GET /api/content/auto-produce?dry=true). Er steht in keinem Plan und zählt
 * deshalb für keinen Sollzeitpunkt — auch nicht als Stolperdraht eines abgeschalteten Jobs.
 */
export const JOB_AUTO_PRODUCE_PROBE = "content-auto-produce-probe";

export interface TotmannJob {
  /** Kennung in lauf_nachweis.job (CHECK ^[a-z0-9-]{1,40}$). */
  job: string;
  bezeichnung: string;
  /** Wochentage wie crontab und Date.getDay(): 0 = So, 1 = Mo … 6 = Sa. */
  wochentage: readonly number[];
  /** Ortszeit HH:MM in zeitzone. */
  uhrzeit: string;
  zeitzone: "Europe/Berlin";
  /** Setzung nach HAENGEND_AB_MS (lib/status-server.ts), nicht gemessen: Die Laufdauern sind unbekannt. */
  karenz_h: number;
  aktiv: boolean;
  /** JJJJ-MM-TT; gesetzt, wenn aktiv false ist. */
  aus_seit: string | null;
  grund: string | null;
  fundstelle: string;
}

// Uhrzeiten und Wochentage aus scripts/setup-vps-crons.sh:21, :24, :27 (crontab "3 8 * * 1-5",
// "3 18 * * 1-5", "7 9 * * 1-5"). Alle drei aus seit dem Betreiber-Entscheid vom 30.07.2026
// (GG/decisions_log.md, Abschnitt 30.07.2026). Das gilt nur für den VPS-Crontab; die GitHub-
// Zeitpläne liefen bis 28.09.2026 weiter und schrieben nie einen Nachweis (Spezifikation §2.1).
export const TOTMANN_PLAN: readonly TotmannJob[] = [
  {
    job: JOB_BRIEFING_MORGEN,
    bezeichnung: "Briefing morgens",
    wochentage: [1, 2, 3, 4, 5],
    uhrzeit: "08:03",
    zeitzone: "Europe/Berlin",
    karenz_h: 2,
    aktiv: false,
    aus_seit: "2026-07-30",
    grund: "Crons abgeschaltet (Betreiber-Entscheid)",
    fundstelle: "GG/decisions_log.md Abschnitt 30.07.2026; scripts/setup-vps-crons.sh:21",
  },
  {
    job: JOB_BRIEFING_ABEND,
    bezeichnung: "Briefing abends",
    wochentage: [1, 2, 3, 4, 5],
    uhrzeit: "18:03",
    zeitzone: "Europe/Berlin",
    karenz_h: 2,
    aktiv: false,
    aus_seit: "2026-07-30",
    grund: "Crons abgeschaltet (Betreiber-Entscheid)",
    fundstelle: "GG/decisions_log.md Abschnitt 30.07.2026; scripts/setup-vps-crons.sh:24",
  },
  {
    job: JOB_AUTO_PRODUCE,
    bezeichnung: "Content Auto-Produce",
    wochentage: [1, 2, 3, 4, 5],
    uhrzeit: "09:07",
    zeitzone: "Europe/Berlin",
    karenz_h: 2,
    aktiv: false,
    aus_seit: "2026-07-30",
    grund: "Crons abgeschaltet (Betreiber-Entscheid)",
    fundstelle: "GG/decisions_log.md Abschnitt 30.07.2026; scripts/setup-vps-crons.sh:27",
  },
];
