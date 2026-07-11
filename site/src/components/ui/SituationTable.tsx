// MASTERPROMPT §9.4 + abgenommener Prototyp "Command Center.dc.html"
// COP-Hologramm: DACH/Sektor-Süd-Lagebild, München-HQ, teal Gitter + Radar-Sweep,
// Gold-Bullseye-Knoten mit bordeten Werte-Pillen. Rein präsentational.

type Entity = {
  x: number;
  y: number;
  color: string;
  label: string;
  side: "l" | "r";
  focus?: boolean;
};

// HQ München (N48.137° E11.575°)
const HQ = { x: 236, y: 232 };

const ENTITIES: Entity[] = [
  // Steinadel-Objekte (gold) — mit Objektwert
  { x: 392, y: 132, color: "var(--gp-gold)", label: "GUT FALKENHOF · €22,5M", side: "r", focus: true },
  { x: 372, y: 330, color: "var(--gp-gold)", label: "VILLA SEEBLICK · €14,8M · REVIEW", side: "r" },
  { x: 486, y: 372, color: "var(--gp-gold)", label: "CHALET ALPENBLICK · €9,9M", side: "r" },
  // System-Entitäten nach Marken-/Signalfarbe
  { x: 508, y: 176, color: "var(--gp-cyan)", label: "HUBSPOT · STEINADEL-SYNC", side: "r" },
  { x: 486, y: 250, color: "var(--gp-violet)", label: "WHITEPULSE · SIGNAL-NET", side: "r" },
  { x: 452, y: 300, color: "var(--gp-amber)", label: "GOLDDIGGER · XAU", side: "r" },
];

function pillWidth(label: string) {
  return label.length * 5.15 + 22;
}

export function SituationTable() {
  return (
    <div className="card-ghost cop-panel overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-3">
          <span className="gp-index">COP</span>
          <h2 className="mono-label" style={{ color: "var(--gp-ink-2)" }}>
            Common Operational Picture — DACH · Sektor Süd
          </h2>
        </div>
        <span className="mono-label" style={{ color: "var(--gp-gold)" }}>
          N48.137° E11.575° · STATUS 235
        </span>
      </div>

      <svg
        viewBox="0 0 720 440"
        className="w-full h-auto block"
        role="img"
        aria-label="Lagebild Sektor Süd: Steinadel-Objekte und Engines um München-HQ"
      >
        <defs>
          <radialGradient id="cop-bloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3fd8ec" stopOpacity="0.28" />
            <stop offset="42%" stopColor="#0f8ba0" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#0f8ba0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cop-sweep-grad" cx="0%" cy="50%" r="100%">
            <stop offset="0%" stopColor="#37d6ea" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#37d6ea" stopOpacity="0" />
          </radialGradient>
          <filter id="cop-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Graticule + Breitengrad-Labels */}
        <g stroke="rgba(126,205,224,0.05)" strokeWidth="0.5">
          {Array.from({ length: 16 }, (_, i) => (
            <line key={`v${i}`} x1={40 + i * 44} y1="18" x2={40 + i * 44} y2="422" />
          ))}
          {Array.from({ length: 10 }, (_, i) => (
            <line key={`h${i}`} x1="24" y1={34 + i * 42} x2="700" y2={34 + i * 42} />
          ))}
        </g>
        {[
          { y: 118, t: "48.4°N" },
          { y: 244, t: "48.1°N" },
          { y: 370, t: "47.8°N" },
        ].map((l) => (
          <text
            key={l.t}
            x="30"
            y={l.y}
            fill="rgba(126,205,224,0.32)"
            style={{ font: "400 7px var(--font-jbmono)", letterSpacing: "0.14em" }}
          >
            {l.t}
          </text>
        ))}

        {/* Projektor-Bloom */}
        <circle cx={HQ.x} cy={HQ.y} r="200" fill="url(#cop-bloom)" />

        {/* Range-Ringe */}
        {[56, 112, 168, 224].map((r, i) => (
          <circle
            key={r}
            cx={HQ.x}
            cy={HQ.y}
            r={r}
            fill="none"
            stroke={`rgba(126,205,224,${0.16 - i * 0.03})`}
            strokeWidth="0.75"
            filter={i === 0 ? "url(#cop-glow)" : undefined}
          />
        ))}

        {/* Radar-Sweep (7s, stetig) */}
        <g className="cop-sweep" style={{ transformOrigin: `${HQ.x}px ${HQ.y}px` }}>
          <path
            d={`M ${HQ.x} ${HQ.y} L ${HQ.x + 224} ${HQ.y} A 224 224 0 0 0 ${HQ.x + 197.6} ${HQ.y - 105.1} Z`}
            fill="url(#cop-sweep-grad)"
          />
        </g>

        {/* HQ München — Fadenkreuz */}
        <g stroke="#eafdff" strokeWidth="1" filter="url(#cop-glow)">
          <line x1={HQ.x - 13} y1={HQ.y} x2={HQ.x - 5} y2={HQ.y} />
          <line x1={HQ.x + 5} y1={HQ.y} x2={HQ.x + 13} y2={HQ.y} />
          <line x1={HQ.x} y1={HQ.y - 13} x2={HQ.x} y2={HQ.y - 5} />
          <line x1={HQ.x} y1={HQ.y + 5} x2={HQ.x} y2={HQ.y + 13} />
          <circle cx={HQ.x} cy={HQ.y} r="2.2" fill="#eafdff" stroke="none" />
        </g>
        <circle cx={HQ.x} cy={HQ.y} r="18" fill="none" stroke="rgba(234,253,255,0.28)" strokeWidth="0.5" />
        <text
          x={HQ.x + 22}
          y={HQ.y + 3}
          fill="rgba(234,253,255,0.78)"
          style={{ font: "500 8px var(--font-jbmono)", letterSpacing: "0.2em" }}
        >
          MÜNCHEN · HQ
        </text>

        {/* Entitäten: Gold-Bullseye-Knoten + Werte-Pille */}
        {ENTITIES.map((e) => {
          const w = pillWidth(e.label);
          const gap = 16;
          const pillX = e.side === "r" ? e.x + gap : e.x - gap - w;
          const textX = e.side === "r" ? pillX + 11 : pillX + w - 11;
          const lineX2 = e.side === "r" ? pillX : pillX + w;
          return (
            <g key={e.label}>
              {/* Konnektor */}
              <line
                x1={e.x + (e.side === "r" ? 6 : -6)}
                y1={e.y}
                x2={lineX2}
                y2={e.y}
                stroke={e.color}
                strokeWidth="0.6"
                opacity="0.5"
              />
              {/* Bullseye-Knoten */}
              {e.focus && (
                <circle className="cop-focus-ring" cx={e.x} cy={e.y} r="11" fill="none" stroke={e.color} strokeWidth="0.75" />
              )}
              <circle cx={e.x} cy={e.y} r="6" fill="none" stroke={e.color} strokeWidth="1" opacity="0.9" />
              <circle cx={e.x} cy={e.y} r="2.3" fill={e.color} />
              {/* Pille */}
              <rect
                x={pillX}
                y={e.y - 9}
                width={w}
                height="18"
                rx="4"
                fill="rgba(6, 9, 11, 0.82)"
                stroke={e.color}
                strokeOpacity="0.4"
                strokeWidth="0.75"
              />
              <text
                x={textX}
                y={e.y + 3}
                textAnchor={e.side === "r" ? "start" : "end"}
                fill={e.color}
                style={{ font: "500 7.5px var(--font-jbmono)", letterSpacing: "0.12em" }}
              >
                {e.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
