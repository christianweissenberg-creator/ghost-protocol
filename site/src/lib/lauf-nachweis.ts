// Schreiber des Lauf-Nachweises für den Totmann (Objekt-Studio Stufe 2, Rest aus Stufe 1;
// docs/intern/objekt-studio-stufe-2.md §2.2 Punkt 2). Genutzt von GET /api/cron/briefing und
// GET /api/content/auto-produce, jeweils erst nach bestandener Secret-Prüfung und per finally —
// genau eine Zeile je Lauf, auch wenn der Lauf wirft. 400 und 401 schreiben bewusst nichts: Das
// Fehlen der Zeile ist das Signal.
//
// Nur aus Route Handlern importieren (Service-Rolle). Die reine Ableitung (Ergebnis,
// Teilergebnisse, Prüfung der Zeile) liegt in lib/status-server.ts und ist dort getestet.
//
// Prüfbefund SR-7: lib/supabase.ts wird erst im try geladen, nicht statisch. Die Datei legt beim
// Laden den Anon-Client an und wirft ohne NEXT_PUBLIC_SUPABASE_URL ("supabaseUrl is required.");
// statisch importiert, lud dann die ganze Cron-Route nicht mehr — auch 400 und 401 endeten in einer
// Ausnahme, obwohl die Routen vorher nicht von der Variable abhingen.

import {
  ABFRAGE_TIMEOUT_MS,
  bereinigeFehler,
  istZeitueberschreitung,
  laufNachweisZeile,
  pruefeAntwort,
  type NachweisInhalt,
} from "./status-server";
import { NACHWEIS_TABELLE } from "./totmann";

/**
 * Hängt genau eine Zeile an lauf_nachweis an und wirft nie. inhalt wird erst hier ausgewertet,
 * damit auch ein Fehler der Ableitung nur zum Vermerk wird. Ergebnis: null = geschrieben; sonst
 * der Vermerk für die Antwort (steht zusätzlich im Server-Log). Scheitert der Insert — auch weil
 * die Tabelle fehlt (SQL nicht ausgeführt), der Service-Schlüssel fehlt oder lib/supabase.ts nicht
 * lädt —, bleibt die eigentliche Antwort der Route unverändert; nur der Vermerk kommt dazu.
 * Prüfbefund SR-4: Nach einer Zeitüberschreitung ist der Ausgang unbekannt (der Abbruch kann nach
 * dem Absenden kommen, die Zeile kann trotzdem stehen) — der Vermerk sagt das, statt "nicht
 * geschrieben" zu behaupten.
 */
export async function schreibeLaufNachweis(
  job: string,
  begonnenAm: Date,
  beendetAm: Date,
  inhalt: () => NachweisInhalt,
): Promise<string | null> {
  try {
    const zeile = laufNachweisZeile(job, begonnenAm, beendetAm, inhalt());
    const { createServiceClient } = await import("./supabase");
    const res = await createServiceClient()
      .from(NACHWEIS_TABELLE)
      .insert(zeile)
      .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
    pruefeAntwort(res);
    return null;
  } catch (e) {
    const grund = bereinigeFehler(e);
    const vermerk = istZeitueberschreitung(e)
      ? `Lauf-Nachweis: Ausgang unbekannt — ${grund}; die Zeile kann trotzdem stehen`
      : `Lauf-Nachweis nicht geschrieben: ${grund}`;
    console.error(`[totmann] ${job}: ${vermerk}`);
    return vermerk;
  }
}
