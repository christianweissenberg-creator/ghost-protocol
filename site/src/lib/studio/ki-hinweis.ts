// Objekt-Studio Schritt 8 (10.11.2026): Wortlaut des KI-Hinweises — reine Daten ohne Imports (Server und Browser).
//
// KI_HINWEIS_BILD wird vom ersten bis zum letzten Bild ins Video eingebrannt; die Medien-Regel
// (lib/medien-freigabe.ts, Bedingung 5) verlangt genau diesen Wortlaut im Export (ki_hinweis_text). Er sagt, dass das
// Video einen geplanten Zustand zeigt; „Abweichungen möglich“ entfällt, weil es nichts absichert. Der Wortlaut ist eine
// Setzung, bis der Inhaber ihn bestätigt (E31).
// KI_PFLICHTZEILE_CAPTION steht in jeder Caption zu einem Video, mit demselben Wortlaut wie das Social-Kit von
// Steinadel (Einbau in die Pipeline: Schritt 9).

export const KI_HINWEIS_BILD = "KI-generierte Visualisierung des geplanten Zustands – unverbindlich, keine reale Aufnahme";

export const KI_PFLICHTZEILE_CAPTION = "Bild-/Videomaterial: KI-generierte Visualisierung, kein Foto der Bestandsimmobilie";
