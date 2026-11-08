// Freigeben-Knopf mit Sperre (R4) — ausgelagert aus app/content/page.tsx (Objekt-Studio Schritt 2,
// 08.11.2026), Code unverändert übernommen. Gesperrt, solange pruefeFreigabe sperrt; der Grund steht
// sichtbar am Knopf. Maßgeblich bleibt die Prüfung auf dem Server (api/content/status, 409 + Grund).
// Die Datei heißt FreigabeKnopf.tsx; die Komponente heißt weiter FreigebenKnopf (wie bisher auf /content).

import { FARBE_BERNSTEIN, FARBE_ROT, bezugHinweis, maskiert } from "@/components/studio/beleg-hilfen";
import type { FreigabeLage } from "@/components/studio/beleg-hilfen";

/** Freigeben-Knopf mit Sperre (R4): gesperrt, solange pruefeFreigabe sperrt; Grund sichtbar. */
export function FreigebenKnopf({
  lage,
  pending,
  onFreigeben,
}: {
  lage: FreigabeLage;
  pending: boolean;
  onFreigeben: () => void;
}) {
  const gesperrt = !lage.pruefung.freigebbar;
  const grund = gesperrt ? maskiert(lage.pruefung.grund ?? "ohne Grund") : null;
  const hinweis = gesperrt ? null : bezugHinweis(lage.bezug);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onFreigeben}
        disabled={pending || gesperrt}
        title={grund ? `Freigeben gesperrt: ${grund}` : undefined}
        className="px-4 py-2 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-all disabled:opacity-40"
      >
        Freigeben
      </button>
      {grund && (
        <span className="text-[10px]" style={{ color: FARBE_ROT }}>
          Freigeben gesperrt: {grund}
        </span>
      )}
      {hinweis && (
        <span className="text-[10px]" style={{ color: FARBE_BERNSTEIN }}>
          {hinweis}
        </span>
      )}
    </div>
  );
}
