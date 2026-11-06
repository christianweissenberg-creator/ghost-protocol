// Gemeinsame Preistabelle für Agenten-Läufe — Stufe 1 (05.11.2026, Preise korrigiert 06.11.2026).
//
// SCHÄTZUNG, keine Abrechnung: Tokens aus der usage der Anthropic-Antwort × Listenpreis je
// Million Tokens. Prompt-Caching, Rabatte und spätere Preisänderungen bildet sie nicht ab;
// maßgeblich bleibt die Anthropic-Rechnung.
//
// Quelle der Preise: Modell- und Preistabelle der claude-api-Referenz von Claude Code,
// Stand 06.10.2026, nicht live gegen die Anthropic-Preisseite geprüft:
//   claude-sonnet-5    2 USD Input / 10 USD Output je Mio. Tokens
//   claude-haiku-4-5   1 USD Input /  5 USD Output je Mio. Tokens
// Bis 05.11.2026 rechnete die Tabelle mit 3 / 15 (jedes Modell mit "sonnet") und 0,8 / 4
// (alles andere). Sonnet-Läufe waren damit um 50 % zu hoch, Haiku-Läufe um 20 % zu niedrig
// geschätzt. Bereits gespeicherte cost_usd-Werte bleiben, wie sie geschrieben wurden.
// Ein Modell, das hier nicht steht, bekommt keine Schätzung (null) und keinen Ersatzpreis.

export interface PreisJeMillion {
  /** USD je Million Input-Tokens */
  input: number;
  /** USD je Million Output-Tokens */
  output: number;
}

export const PREIS_QUELLE = "Listenpreise laut claude-api-Referenz, Stand 06.10.2026, nicht live geprüft";
/** Ab diesem Tag (Europe/Berlin) rechnen activate und delegate mit dieser Tabelle. */
export const PREIS_STAND_AB = "2026-11-06";

const PREISE: Readonly<Record<string, PreisJeMillion>> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

/** Modell-ID ohne Datums-Suffix, klein geschrieben: claude-haiku-4-5-20251001 → claude-haiku-4-5. */
export function basisModell(modell: string): string {
  return modell.trim().toLowerCase().replace(/-\d{8}$/, "");
}

/** Listenpreis je Million Tokens; null, wenn das Modell nicht in der Tabelle steht. */
export function preisJeMillion(modell: string): PreisJeMillion | null {
  return PREISE[basisModell(modell)] ?? null;
}

/** Token-Zahl aus der usage lesen; null, wenn nicht gemeldet. Nie 0 als Platzhalter. */
export function leseTokenZahl(wert: unknown): number | null {
  return typeof wert === "number" && Number.isFinite(wert) && wert >= 0 ? wert : null;
}

/**
 * Geschätzte Kosten eines Laufs in USD. null, wenn eine der beiden Token-Zahlen fehlt oder
 * das Modell keinen Tabellenpreis hat — ein nicht gemessener Lauf wird nicht als 0 verbucht.
 */
export function schaetzeKostenUsd(
  modell: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  const eingabe = leseTokenZahl(inputTokens);
  const ausgabe = leseTokenZahl(outputTokens);
  const preis = preisJeMillion(modell);
  if (eingabe === null || ausgabe === null || preis === null) return null;
  return (eingabe * preis.input + ausgabe * preis.output) / 1_000_000;
}
