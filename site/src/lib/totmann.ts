// Totmann für Crons und Agenten — Plan als Konstante (Objekt-Studio Stufe 2, Rest aus Stufe 1;
// docs/intern/objekt-studio-stufe-2.md §2.2 Punkt 3 und §2.3).
//
// Die Datei hat bewusst keine Imports: GET /api/status liest den Plan, die Schreiber in
// /api/cron/briefing und /api/content/auto-produce nehmen die Job-Namen, und die Tests laden sie
// direkt (tests/b-status-server.test.mjs). Die Bewertung liegt in lib/status-server.ts
// (letzterSollzeitpunkt, bewerteJob, bewerteTotmann), das SQL der Tabelle in
// scripts/lauf_nachweis.sql (ausgeführt am 07.11.2026).
//
// Zeitzone offen: Für die curl-Jobs gibt es nur den Kommentar „CET" (setup-vps-crons.sh:20).
// crontab:3 („Alle Zeiten in UTC") gilt für die Python-Jobs des DONNA-Schedulers und ist
// nicht versioniert. Maßgeblich ist die Systemzeitzone des VPS, sie ist nicht gemessen.
// Vor aktiv:true messen und mit Beleg in zeitzone_beleg eintragen; ohne Beleg lehnt die
// Plan-Prüfung (lib/status-server.ts) einen aktiven Job ab. Läuft der VPS auf UTC, heißt der Plan
// zeitzone "UTC" — oder der Crontab wird auf Europe/Berlin gestellt (Prüfbefund Z8).
//
// Vor jedem aktiv:true gilt §2.6 der Spezifikation (neues CRON_SECRET, Middleware-Ausnahme R7,
// Header statt ?secret=, gemessene Zeitzone, umgebauter Launch-Kalender) — im selben PR, und mit
// aktiv_seit (ab wann der Crontab den Job ausführt) und zeitzone_beleg. Sollzeitpunkte vor
// aktiv_seit heißen "erster Sollzeitpunkt steht aus"; ein fester Tag für alle Jobs (die frühere
// NACHWEIS_SEIT-Regel) ließ jede spätere Aktivierung sofort rot werden (Prüfbefund Z1).

/** Tabelle des Lauf-Nachweises (scripts/lauf_nachweis.sql). Nur die Service-Rolle liest und hängt an. */
export const NACHWEIS_TABELLE = "lauf_nachweis";

/**
 * Tag (JJJJ-MM-TT, Europe/Berlin), seit dem lauf_nachweis in Produktion besteht und der Schreiber
 * deployt ist — der spätere von Deploy und Ausführung von scripts/lauf_nachweis.sql (§2.2 Punkt 3:
 * "<Deploy-Datum>"). null, solange das nicht festgehalten ist: Das SQL ist seit 07.11.2026
 * ausgeführt (Migration 20261107094750), der Schreiber aber noch nicht deployt. Nach dem Deploy in
 * einem eigenen Commit setzen.
 * Nur für den Tooltip „Nachweis-Tabelle seit …: kein Lauf" (§2.4). Prüfbefund B1: Vorher stand hier
 * der Tag, an dem der Code entstand (07.11.2026), und der Tooltip behauptete ein Beobachtungsfenster,
 * in dem es weder Tabelle noch Schreiber gab. Das Urteil über aktive Jobs hängt an aktiv_seit.
 */
export const NACHWEIS_SEIT: string | null = null;

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
  /**
   * Wochentage wie crontab und Date.getDay(): 0 = So, 1 = Mo … 6 = Sa. Bei aktiv nicht leer (sonst nie ein
   * Sollzeitpunkt). Ein übersprungener Lauf deckt einen Sollzeitpunkt nur, wenn er an einem dieser Tage
   * begann (Prüfbefund logik-1).
   */
  wochentage: readonly number[];
  /** Ortszeit HH:MM in zeitzone. */
  uhrzeit: string;
  /** Europe/Berlin (Sommerzeit über Intl) oder UTC für einen VPS auf UTC (Prüfbefund Z8). */
  zeitzone: "Europe/Berlin" | "UTC";
  /**
   * Beleg der gemessenen Systemzeitzone des VPS (Befehl und Datum); null = nicht gemessen, zeitzone
   * ist dann eine Annahme, und die Plan-Zeile im Tooltip sagt das (Prüfbefund B10). Pflicht, bevor
   * aktiv true wird (§2.6).
   */
  zeitzone_beleg: string | null;
  /** Setzung nach HAENGEND_AB_MS (lib/status-server.ts), nicht gemessen: Die Laufdauern sind unbekannt. */
  karenz_h: number;
  aktiv: boolean;
  /**
   * Pflicht, wenn aktiv true ist: ISO-Zeitpunkt mit Zeitzone (z. B. "2027-01-18T00:00:00+01:00"), ab
   * dem der Crontab den Job ausführt — gesetzt im Aktivierungs-PR (§2.6), frühestens zu dessen
   * Deploy. Sollzeitpunkte davor heißen "erster Sollzeitpunkt steht aus" (nicht gemessen). Höchstens
   * 31 Tage nach der Messzeit, sonst Planfehler (Prüfbefund logik-3, gegen Tippfehler im Jahr).
   */
  aktiv_seit: string | null;
  /** JJJJ-MM-TT; gesetzt, wenn aktiv false ist; nicht nach heute (Europe/Berlin, Prüfbefund logik-2). */
  aus_seit: string | null;
  /**
   * Nur bei aktiv false: ISO-Zeitpunkt mit Zeitzone, bis zu dem der Stolperdraht quittiert ist — ein
   * Lauf, der bis dahin begann, löst ihn nicht mehr aus (Prüfbefund Z6; die Tabelle nimmt nur Anhänge
   * an, eine Zeile lässt sich nicht zurücknehmen). Gesetzt im Code nach Klärung des Laufs, die
   * Git-Historie ist die Quittung. null = nichts quittiert. Nie in der Zukunft (mehr als 10 min nach
   * der Messzeit ist ein Planfehler, Prüfbefund logik-2); ist die Zeit einer Zeile unplausibel, zählt
   * ihr eingetragen_am (DB-Uhr) — dann reicht eine Quittung bis zur Klärung.
   */
  stolperdraht_quittiert_bis: string | null;
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
    zeitzone_beleg: null,
    karenz_h: 2,
    aktiv: false,
    aktiv_seit: null,
    aus_seit: "2026-07-30",
    stolperdraht_quittiert_bis: null,
    grund: "Crons abgeschaltet (Betreiber-Entscheid)",
    fundstelle: "GG/decisions_log.md Abschnitt 30.07.2026; scripts/setup-vps-crons.sh:21",
  },
  {
    job: JOB_BRIEFING_ABEND,
    bezeichnung: "Briefing abends",
    wochentage: [1, 2, 3, 4, 5],
    uhrzeit: "18:03",
    zeitzone: "Europe/Berlin",
    zeitzone_beleg: null,
    karenz_h: 2,
    aktiv: false,
    aktiv_seit: null,
    aus_seit: "2026-07-30",
    stolperdraht_quittiert_bis: null,
    grund: "Crons abgeschaltet (Betreiber-Entscheid)",
    fundstelle: "GG/decisions_log.md Abschnitt 30.07.2026; scripts/setup-vps-crons.sh:24",
  },
  {
    job: JOB_AUTO_PRODUCE,
    bezeichnung: "Content Auto-Produce",
    wochentage: [1, 2, 3, 4, 5],
    uhrzeit: "09:07",
    zeitzone: "Europe/Berlin",
    zeitzone_beleg: null,
    karenz_h: 2,
    aktiv: false,
    aktiv_seit: null,
    aus_seit: "2026-07-30",
    stolperdraht_quittiert_bis: null,
    grund: "Crons abgeschaltet (Betreiber-Entscheid)",
    fundstelle: "GG/decisions_log.md Abschnitt 30.07.2026; scripts/setup-vps-crons.sh:27",
  },
];
