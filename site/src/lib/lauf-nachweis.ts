// Schreiber des Lauf-Nachweises für den Totmann (Objekt-Studio Stufe 2, Rest aus Stufe 1;
// docs/intern/objekt-studio-stufe-2.md §2.2 Punkt 2). Genutzt von GET /api/cron/briefing und
// GET /api/content/auto-produce, jeweils erst nach bestandener Secret-Prüfung und per finally —
// genau eine Zeile je Lauf, auch wenn der Lauf wirft. 400 und 401 schreiben bewusst nichts: Das
// Fehlen der Zeile ist das Signal.
//
// Nur aus Route Handlern importieren (Service-Rolle). Die reine Ableitung (Ergebnis,
// Teilergebnisse, Prüfung der Zeile) liegt in lib/status-server.ts und ist dort getestet.

import { createServiceClient } from "./supabase";
import { ABFRAGE_TIMEOUT_MS, bereinigeFehler, laufNachweisZeile, pruefeAntwort, type NachweisInhalt } from "./status-server";
import { NACHWEIS_TABELLE } from "./totmann";

/**
 * Hängt genau eine Zeile an lauf_nachweis an und wirft nie. inhalt wird erst hier ausgewertet,
 * damit auch ein Fehler der Ableitung nur zum Vermerk wird. Ergebnis: null = geschrieben; sonst
 * der Vermerk für die Antwort (steht zusätzlich im Server-Log). Scheitert der Insert — auch weil
 * die Tabelle fehlt (SQL nicht ausgeführt) oder der Service-Schlüssel fehlt —, bleibt die
 * eigentliche Antwort der Route unverändert; nur der Vermerk kommt dazu.
 */
export async function schreibeLaufNachweis(
  job: string,
  begonnenAm: Date,
  beendetAm: Date,
  inhalt: () => NachweisInhalt,
): Promise<string | null> {
  try {
    const zeile = laufNachweisZeile(job, begonnenAm, beendetAm, inhalt());
    const res = await createServiceClient()
      .from(NACHWEIS_TABELLE)
      .insert(zeile)
      .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
    pruefeAntwort(res);
    return null;
  } catch (e) {
    const vermerk = `Lauf-Nachweis nicht geschrieben: ${bereinigeFehler(e)}`;
    console.error(`[totmann] ${job}: ${vermerk}`);
    return vermerk;
  }
}
