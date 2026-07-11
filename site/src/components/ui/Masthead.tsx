// MASTERPROMPT §9.5 — Editorialer Masthead (rein präsentational, keine Logik)
// Index + Haarlinie → Kicker (Mono) → große Cormorant-Wortmarke (betonte Silbe
// kursiv+Gold) → Fließtext → rechts Mono-Vitals-Chips mit Eck-Ticks.

interface Vital {
  label: string;
  value: string | number;
}

interface MastheadProps {
  index: string; // z.B. "01 / LAGE"
  kicker: string; // Mono-Zeile über der Wortmarke
  /** Wortmarke: [Normalteil, Gold-Kursiv-Teil, optional Rest] */
  word: [string, string, string?];
  sub?: string;
  vitals?: Vital[];
  coord?: string; // z.B. "N48.137° · E11.575°" — rechts in der Index-Zeile
}

export function Masthead({ index, kicker, word, sub, vitals, coord }: MastheadProps) {
  return (
    <header className="gp-masthead">
      <div className="gp-index-row">
        <span className="gp-index">{index}</span>
        <span className="gp-index-rule" />
        {coord && (
          <span
            className="font-[family-name:var(--font-jbmono)] text-[10px] tracking-[0.18em] shrink-0"
            style={{ color: "var(--gp-ink-3)" }}
          >
            {coord}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-8 flex-wrap">
        <div>
          <p className="gp-kicker">{kicker}</p>
          <h1 className="gp-wordmark">
            {word[0]}
            <em>{word[1]}</em>
            {word[2] ?? ""}
          </h1>
          {sub && <p className="gp-sub">{sub}</p>}
        </div>
        {vitals && vitals.length > 0 && (
          <div className="flex gap-2.5 flex-wrap pb-1.5">
            {vitals.map((v) => (
              <span key={v.label} className="gp-chip">
                {v.label} <b>{v.value}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
