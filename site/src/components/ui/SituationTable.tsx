// MASTERPROMPT §9.4 — COP-Hologramm "Situation Table" (Signatur-Held, §5)
// Rein präsentational: DACH-Lagebild als leuchtendes Hologramm mit Graticule,
// Radar-Sweep, HQ-Fadenkreuz und geplotteten Entitäten (Steinadel gold,
// Engines nach Marken-Farbe). Keine Logik, keine Daten-Calls.

const ENTITIES = [
  // Steinadel-Objekte (gold) — Sachsen-Cluster; Callouts in verschiedene Richtungen
  { x: 372, y: 208, color: "var(--gp-gold)", label: "RITTERGUT SEIFERSDORF", sub: "STEINADEL · DD", focus: true, dx: 34, dy: 26 },
  { x: 332, y: 190, color: "var(--gp-gold)", label: "STADTPALAIS LEIPZIG", sub: "STEINADEL · L", focus: false, dx: -44, dy: 52 },
  { x: 362, y: 186, color: "var(--gp-gold)", label: "GUTSHOF MORITZBURG", sub: "STEINADEL · MEI", focus: false, dx: 40, dy: -34 },
  // Engines nach Marken-Farbe
  { x: 258, y: 236, color: "var(--gp-cyan)", label: "CRYPTODOG", sub: "ENGINE · FSN1", focus: false, dx: -96, dy: 18 },
  { x: 262, y: 248, color: "var(--gp-amber)", label: "GOLDDIGGER", sub: "ENGINE · FSN1", focus: false, dx: 26, dy: 34 },
  { x: 205, y: 148, color: "var(--gp-violet)", label: "WHITEPULSE", sub: "SIGNAL · NET", focus: false, dx: -78, dy: -26 },
];

// HQ = Sülzetal / Magdeburger Börde
const HQ = { x: 300, y: 158 };

export function SituationTable() {
  return (
    <div className="card-ghost cop-panel overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-3">
          <span className="gp-index">COP</span>
          <h2 className="mono-label" style={{ color: "var(--gp-ink-2)" }}>
            Situation Table — DACH Lagebild
          </h2>
        </div>
        <span className="mono-label" style={{ color: "var(--gp-gold)" }}>
          KLASSIFIZIERT · GP-EYES ONLY
        </span>
      </div>

      <svg
        viewBox="0 0 560 320"
        className="w-full h-auto block"
        role="img"
        aria-label="Lagebild: Steinadel-Objekte und Engines in der DACH-Region"
      >
        <defs>
          {/* Projektor-Bloom im HQ-Zentrum */}
          <radialGradient id="cop-bloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3fd8ec" stopOpacity="0.30" />
            <stop offset="42%" stopColor="#0f8ba0" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#0f8ba0" stopOpacity="0" />
          </radialGradient>
          {/* Radar-Sweep */}
          <radialGradient id="cop-sweep-grad" cx="0%" cy="50%" r="100%">
            <stop offset="0%" stopColor="#37d6ea" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#37d6ea" stopOpacity="0" />
          </radialGradient>
          {/* Glow-Filter (HQ-Fadenkreuz, innerster Ring) */}
          <filter id="cop-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Graticule */}
        <g stroke="rgba(126,205,224,0.05)" strokeWidth="0.5">
          {Array.from({ length: 13 }, (_, i) => (
            <line key={`v${i}`} x1={40 + i * 40} y1="16" x2={40 + i * 40} y2="304" />
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <line key={`h${i}`} x1="24" y1={30 + i * 38} x2="536" y2={30 + i * 38} />
          ))}
        </g>

        {/* Stilisierte DACH-Kontur (Hologramm-Abstraktion) */}
        <path
          d="M 240 60 L 282 52 L 316 62 L 344 56 L 366 76 L 384 104 L 396 140 L 388 176
             L 402 210 L 384 238 L 350 250 L 356 270 L 322 288 L 282 280 L 244 290
             L 214 272 L 186 276 L 168 254 L 178 230 L 158 210 L 172 186 L 158 158
             L 178 132 L 170 104 L 198 92 L 212 66 Z"
          fill="rgba(63,216,236,0.025)"
          stroke="rgba(126,205,224,0.22)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        {/* AT/CH angedeutet */}
        <path
          d="M 244 290 L 282 280 L 322 288 L 372 284 L 420 296 L 380 312 L 300 314 L 252 306 Z"
          fill="none"
          stroke="rgba(126,205,224,0.10)"
          strokeWidth="0.75"
          strokeLinejoin="round"
        />
        <path
          d="M 168 254 L 214 272 L 244 290 L 252 306 L 196 310 L 152 292 L 140 268 Z"
          fill="none"
          stroke="rgba(126,205,224,0.10)"
          strokeWidth="0.75"
          strokeLinejoin="round"
        />

        {/* Projektor-Bloom */}
        <circle cx={HQ.x} cy={HQ.y} r="150" fill="url(#cop-bloom)" />

        {/* Ringe */}
        <circle cx={HQ.x} cy={HQ.y} r="120" fill="none" stroke="rgba(126,205,224,0.08)" strokeWidth="0.75" />
        <circle cx={HQ.x} cy={HQ.y} r="80" fill="none" stroke="rgba(126,205,224,0.12)" strokeWidth="0.75" />
        <circle cx={HQ.x} cy={HQ.y} r="40" fill="none" stroke="rgba(126,205,224,0.18)" strokeWidth="0.75" filter="url(#cop-glow)" />

        {/* Radar-Sweep (7s, stetig) — Keil von 0° bis −28° */}
        <g className="cop-sweep" style={{ transformOrigin: `${HQ.x}px ${HQ.y}px` }}>
          <path
            d={`M ${HQ.x} ${HQ.y} L ${HQ.x + 150} ${HQ.y} A 150 150 0 0 0 ${HQ.x + 132.4} ${HQ.y - 70.4} Z`}
            fill="url(#cop-sweep-grad)"
            opacity="0.55"
          />
        </g>

        {/* HQ-Fadenkreuz */}
        <g stroke="#eafdff" strokeWidth="1" filter="url(#cop-glow)">
          <line x1={HQ.x - 12} y1={HQ.y} x2={HQ.x - 4} y2={HQ.y} />
          <line x1={HQ.x + 4} y1={HQ.y} x2={HQ.x + 12} y2={HQ.y} />
          <line x1={HQ.x} y1={HQ.y - 12} x2={HQ.x} y2={HQ.y - 4} />
          <line x1={HQ.x} y1={HQ.y + 4} x2={HQ.x} y2={HQ.y + 12} />
          <circle cx={HQ.x} cy={HQ.y} r="2" fill="#eafdff" stroke="none" />
        </g>
        <text
          x={HQ.x + 18}
          y={HQ.y - 12}
          fill="rgba(234,253,255,0.75)"
          style={{ font: "500 8px var(--font-jbmono)", letterSpacing: "0.18em" }}
        >
          HQ · SÜLZETAL
        </text>

        {/* Entitäten — Callout je Entität in eigene Richtung (keine Label-Kollision) */}
        {ENTITIES.map((e) => {
          const lx = e.x + e.dx;
          const ly = e.y + e.dy;
          return (
            <g key={e.label}>
              {e.focus && (
                <circle
                  className="cop-focus-ring"
                  cx={e.x}
                  cy={e.y}
                  r="9"
                  fill="none"
                  stroke={e.color}
                  strokeWidth="0.75"
                />
              )}
              <line
                x1={e.x + Math.sign(e.dx) * 4}
                y1={e.y + Math.sign(e.dy) * 4}
                x2={lx - Math.sign(e.dx) * 4}
                y2={ly - 4}
                stroke={e.color}
                strokeWidth="0.5"
                opacity="0.55"
              />
              <circle cx={e.x} cy={e.y} r="3" fill={e.color} />
              <text
                x={lx}
                y={ly}
                fill={e.color}
                textAnchor={e.dx < 0 ? "end" : "start"}
                style={{ font: "500 7.5px var(--font-jbmono)", letterSpacing: "0.16em" }}
              >
                {e.label}
              </text>
              <text
                x={lx}
                y={ly + 9}
                fill="rgba(169,167,159,0.6)"
                textAnchor={e.dx < 0 ? "end" : "start"}
                style={{ font: "400 6.5px var(--font-jbmono)", letterSpacing: "0.14em" }}
              >
                {e.sub}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
