// Objekt-Studio: Abruf des Steinadel-Exports über /api/objekte (Schritt 2, 08.11.2026; in Schritt 6,
// 10.11.2026, aus api/studio/[objekt]/route.ts hierher verlegt, weil auch der Cover-Abgleich der
// Anker-Prüfung den Export liest — dieselbe Regel für beide, unverändert).
//
// Abgerufen wird mit der Sitzung der Anfrage, wie die Pipeline (fetchObjekt in
// api/content/pipeline/route.ts). Der Zugang zum Export bleibt in /api/objekte: Diese Datei liest kein
// Export-Token und gibt keines aus. Fehler kommen als Teil "fehler" mit Ursache (fehler_art) und
// bereinigtem Grund zurück, nie als Ausnahme.

import "server-only";
import { bereinigeFehler, istZeitueberschreitung } from "../status-server";
import { QUELLE_EXPORT, exportFehlerAusAntwort, teilFehler } from "./lesen";
import type { StudioMesswert } from "./typen";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
// Über dem Zeitlimit von /api/objekte (15 s), damit dessen eigene Fehlerantwort ankommt — gleicher
// Wert wie OBJEKT_TIMEOUT_MS der Pipeline.
export const EXPORT_TIMEOUT_MS = 20_000;

/** Gelesener Export (JSON von /api/objekte mit Status 2xx) oder der gescheiterte Teil ohne Wert. */
export type ExportLesung =
  | { art: "daten"; daten: unknown; abgerufenAm: string }
  | { art: "fehler"; teil: StudioMesswert<never> };

function zeitOderGrund(e: unknown): string {
  return istZeitueberschreitung(e) ? `Zeitüberschreitung (${EXPORT_TIMEOUT_MS / 1000} s)` : bereinigeFehler(e);
}

export async function leseExport(cookie: string): Promise<ExportLesung> {
  const versuchAm = new Date().toISOString();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/objekte`, {
      headers: { Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
  } catch (e) {
    return { art: "fehler", teil: teilFehler(QUELLE_EXPORT, versuchAm, "nicht_erreichbar", zeitOderGrund(e)) };
  }
  const abgerufenAm = new Date().toISOString();
  let daten: unknown = null;
  try {
    daten = await res.json();
  } catch (e) {
    // Unlesbares JSON (SyntaxError) zählt wie eine Antwort ohne Inhalt; jeder andere Fehler beim
    // Lesen ist ein Abbruch (Zeitlimit, abgerissene Verbindung) — wie in api/objekte/route.ts.
    const kaputtesJson = e instanceof SyntaxError || (e instanceof Error && e.name === "SyntaxError");
    if (!kaputtesJson) {
      return { art: "fehler", teil: teilFehler(QUELLE_EXPORT, abgerufenAm, "nicht_erreichbar", zeitOderGrund(e)) };
    }
    if (res.ok) {
      return { art: "fehler", teil: teilFehler(QUELLE_EXPORT, abgerufenAm, "quelle_fehler", "Antwort von /api/objekte nicht lesbar") };
    }
  }
  if (!res.ok) return { art: "fehler", teil: exportFehlerAusAntwort<never>(res.status, daten, abgerufenAm) };
  return { art: "daten", daten, abgerufenAm };
}
