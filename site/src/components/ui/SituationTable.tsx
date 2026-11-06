"use client";

// MASTERPROMPT §9.4 + abgenommener Prototyp "Command Center.dc.html"
// COP-Hologramm: teal Gitter + Radar-Sweep, Gold-Bullseye-Knoten mit bordeten Werte-Pillen.
// Objekt-Pillen kommen aus /api/objekte (Steinadel-Export-API, einmal beim Laden der Seite)
// — keine hartkodierten Objekte oder erfundenen Preise (Betreiber-Auftrag 29.07.2026).
// Stufe 1 (05.11.2026): Das Bild ist schematisch. Stadtname am HQ, Koordinaten,
// Breitengrade und Sektor-Angabe sind entfernt (der Ort war nicht der Firmensitz, eine
// belegte Geokoordinate gibt es nicht); die Positionen sind feste Plätze, keine Orte.
// Die beiden Pillen ohne Bezug zu Ghost Protocol sind gelöscht. Die Export-Pille zeigt den
// echten Abrufzustand, und mehr Objekte als Plätze erscheinen als "+N WEITERE" statt still
// zu fehlen.
// Fixrunde 06.11.2026 (R28): Das Command Center lädt /api/objekte einmal und reicht die Objekte
// als Prop an Lagebild und Steinadel-Panel; beide zeigen damit denselben Abrufzustand. Ohne
// Prop ruft das Lagebild selbst ab. Fehlertexte kommen bereinigt an (objektFehlerText).
// Nachprüfung 06.11.2026: Ein 401 (keine Sitzung) ist kein Ausfall des Exports; der wurde gar
// nicht abgefragt. Das Lagebild sagt dann bernstein "NICHT ANGEMELDET" wie die TopBar, nicht rot
// "EXPORT OFFLINE".
// Gesamtprüfung 06.11.2026 (R24 einheitlich): Name und Preis aus dem Export erscheinen maskiert
// wie auf /content — der geschützte Name steht in keinem sichtbaren Text.

import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import { useObjekte } from "@/lib/hooks";
import { objekteFehlerAnzeige, objekteLesungAus, objekteLesungFehlerArt, type ObjekteLesung } from "@/lib/hooks-status";

type Entity = {
  key: string;
  x: number;
  y: number;
  color: string;
  label: string;
  side: "l" | "r";
  focus?: boolean;
};

// Schematischer Mittelpunkt des Lagebilds — keine Geokoordinate.
const HQ = { x: 236, y: 232 };

// Feste Plätze für bis zu 5 Objekt-Pillen (so gewählt, dass auch lange Labels wie
// "… · PREIS AUF ANFRAGE" im 720er-viewBox bleiben)
const OBJEKT_SLOTS: Array<Pick<Entity, "x" | "y" | "side" | "focus">> = [
  { x: 392, y: 112, side: "r", focus: true },
  { x: 372, y: 330, side: "r" },
  { x: 430, y: 372, side: "r" },
  { x: 300, y: 64, side: "r" },
  { x: 290, y: 180, side: "l" },
];

// Platz der Export-Pille und der "+N WEITERE"-Pille (frei gewordener Platz).
const EXPORT_SLOT = { x: 508, y: 176, side: "r" as const };
const WEITERE_SLOT = { x: 486, y: 250, side: "r" as const };

function pillWidth(label: string) {
  return label.length * 5.15 + 22;
}

/** Rückfall ohne Prop: eigener Abruf von /api/objekte, Fehlertext bereinigt, 401 erkannt. */
function LagebildMitAbruf() {
  return <Lagebild lesung={objekteLesungAus(useObjekte())} />;
}

export function SituationTable({ lesung }: { lesung?: ObjekteLesung }) {
  return lesung ? <Lagebild lesung={lesung} /> : <LagebildMitAbruf />;
}

function Lagebild({ lesung }: { lesung: ObjekteLesung }) {
  const { objekte, loading, error } = lesung;
  // Nachprüfung im Browser 06.11.2026: Die Ursache bestimmt Wortlaut und Farbe
  // (objekteFehlerAnzeige). 401: Die Sitzung fehlt, der Export wurde nicht abgefragt — sein
  // Zustand ist ungemessen. Fehlendes Token: "nicht konfiguriert" statt "offline".
  const fehlerArt = objekteLesungFehlerArt(lesung);
  const anzeige = fehlerArt ? objekteFehlerAnzeige(fehlerArt) : null;
  const ohneSitzung = fehlerArt === "nicht_angemeldet";
  const fehlerFarbe = anzeige?.farbe === "amber" ? "var(--gp-amber)" : "var(--gp-rose)";

  const objektEntities: Entity[] = error
    ? []
    : objekte.slice(0, OBJEKT_SLOTS.length).map((o, i) => ({
        ...OBJEKT_SLOTS[i],
        key: `objekt-${o.slug}-${i}`,
        color: "var(--gp-gold)",
        label: maskiereGeschuetzteNamen(`${o.name} · ${o.preis}`).toUpperCase(),
      }));

  // "STEINADEL · EXPORT-API" ist die reale Anbindung; die Farbe folgt dem Abruf statt fest
  // zu leuchten (laden = gedämpft, ohne Sitzung = bernstein, Fehler = rose, ok = cyan). Ohne
  // Sitzung steht "EXPORT" statt "EXPORT-API": "UNGEMESSEN" ist länger, und die Pille muss im
  // 720er-viewBox bleiben (pillWidth, höchstens 33 Zeichen ab EXPORT_SLOT).
  const exportEntity: Entity = {
    ...EXPORT_SLOT,
    key: "export-api",
    color: loading ? "var(--gp-ink-3)" : anzeige ? fehlerFarbe : "var(--gp-cyan)",
    label: loading ? "STEINADEL · EXPORT-API · SYNC…" : anzeige ? anzeige.pille : "STEINADEL · EXPORT-API · OK",
  };

  const weitere = error ? 0 : Math.max(objekte.length - OBJEKT_SLOTS.length, 0);
  const weitereEntity: Entity[] =
    weitere > 0
      ? [{ ...WEITERE_SLOT, key: "weitere", color: "var(--gp-ink-2)", label: `+${weitere} WEITERE` }]
      : [];

  const entities: Entity[] = [...objektEntities, exportEntity, ...weitereEntity];
  const statusLabel = loading ? "SYNC…" : anzeige ? anzeige.kopf : `${objekte.length} OBJEKTE`;
  const statusFarbe = anzeige ? fehlerFarbe : "var(--gp-gold)";
  const statusTitel = anzeige
    ? ohneSitzung
      ? anzeige.titel
      : `${anzeige.titel} Fehler: ${error}`
    : "Quelle: /api/objekte (Steinadel-Export, beim Laden der Seite)";

  return (
    <div className="card-ghost cop-panel overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-3">
          <span className="gp-index">COP</span>
          <h2 className="mono-label" style={{ color: "var(--gp-ink-2)" }}>
            Lagebild · Steinadel-Objekte
          </h2>
        </div>
        <span className="mono-label" style={{ color: statusFarbe }} title={statusTitel}>
          {statusLabel}
        </span>
      </div>

      <svg
        viewBox="0 0 720 440"
        className="w-full h-auto block"
        role="img"
        aria-label="Lagebild, schematisch, keine Geokoordinaten: Steinadel-Objekte und Export-Anbindung um das HQ"
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

        {/* Gitter (schematisch, ohne Breitengrad-Beschriftung) */}
        <g stroke="rgba(126,205,224,0.05)" strokeWidth="0.5">
          {Array.from({ length: 16 }, (_, i) => (
            <line key={`v${i}`} x1={40 + i * 44} y1="18" x2={40 + i * 44} y2="422" />
          ))}
          {Array.from({ length: 10 }, (_, i) => (
            <line key={`h${i}`} x1="24" y1={34 + i * 42} x2="700" y2={34 + i * 42} />
          ))}
        </g>

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

        {/* HQ — Fadenkreuz */}
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
          HQ
        </text>

        {/* Entitäten: Gold-Bullseye-Knoten + Werte-Pille */}
        {entities.map((e) => {
          const w = pillWidth(e.label);
          const gap = 16;
          const pillX = e.side === "r" ? e.x + gap : e.x - gap - w;
          const textX = e.side === "r" ? pillX + 11 : pillX + w - 11;
          const lineX2 = e.side === "r" ? pillX : pillX + w;
          return (
            <g key={e.key}>
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
