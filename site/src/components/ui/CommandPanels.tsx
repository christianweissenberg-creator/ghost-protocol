// Command-Center-Panels nach abgenommenem Prototyp (Command Center.dc.html):
// Neural Core (L.I.S.A.-Orchestrierung), System-Telemetrie, Die Engines (Marken).
// Rein präsentational; Demo-Werte im Prototyp-Stil.

function PanelHead({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="gp-index" style={{ fontSize: 13 }}>{index}</span>
      <h3 className="mono-label" style={{ color: "var(--gp-ink-2)" }}>{title}</h3>
    </div>
  );
}

// ── Orchestrierung · Neural Core (L.I.S.A.) ──
export function NeuralCore() {
  const rows = [
    { k: "Entscheidungen · heute", v: "24" },
    { k: "Auslastung", v: "38 %" },
    { k: "Wissensbasis", v: "1.284 Einträge" },
  ];
  return (
    <div className="card-ghost p-5">
      <PanelHead index="◇" title="Orchestrierung · Neural Core" />
      <div className="flex items-center gap-3 mb-4">
        <span
          className="font-[family-name:var(--font-cormorant)] italic font-semibold text-2xl leading-none"
          style={{ color: "var(--gp-gold)" }}
        >
          L.I.S.A.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse-subtle" style={{ background: "var(--gp-emerald)" }} />
          <span className="mono-label" style={{ color: "var(--gp-emerald)" }}>DENKT</span>
        </span>
        <span className="mono-label ml-auto">17 Agenten · 1 Dirigent</span>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.k} className="flex items-baseline justify-between">
            <span className="text-[12px]" style={{ color: "var(--gp-ink-2)" }}>{r.k}</span>
            <span className="font-[family-name:var(--font-jbmono)] text-[12px]" style={{ color: "var(--gp-gold-hi)" }}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── System-Telemetrie ──
export function SystemTelemetry({ activeAgents = 0 }: { activeAgents?: number }) {
  const metrics = [
    { label: "Agenten aktiv", value: `${activeAgents}/17`, color: "var(--gp-cyan)" },
    { label: "Exposés live", value: "0", color: "var(--gp-gold)" },
    { label: "Content heute", value: "0", color: "var(--gp-violet)" },
    { label: "System-Health", value: "100 %", color: "var(--gp-emerald)" },
  ];
  return (
    <div className="card-ghost p-5">
      <PanelHead index="◈" title="System-Telemetrie" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="font-[family-name:var(--font-cormorant)] font-semibold text-[26px] leading-none" style={{ color: m.color }}>
              {m.value}
            </div>
            <div className="mono-label mt-1.5">{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Die Engines (Marken/Motoren der Corporation) ──
const ENGINES = [
  { name: "ImmoNexus", tag: "STEINADEL · EXPOSÉ", metric: "3 Objekte", state: "AKTIV", color: "var(--gp-gold)" },
  { name: "CryptoDog", tag: "WHITEPULSE · TRADING", metric: "FLAT", state: "WACHE", color: "var(--gp-cyan)" },
  { name: "Edelmetall", tag: "GOLDDIGGER · XAU", metric: "PAUSIERT", state: "STANDBY", color: "var(--gp-amber)" },
];
export function BrandsEngines() {
  return (
    <div className="card-ghost p-5">
      <PanelHead index="▤" title="Die Engines" />
      <div className="space-y-3">
        {ENGINES.map((e) => (
          <div
            key={e.name}
            className="flex items-center gap-4 py-2.5"
            style={{ borderBottom: "1px solid var(--gp-hairline)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: e.color }} />
            <div className="min-w-0">
              <div className="font-[family-name:var(--font-cormorant)] font-semibold text-[19px] leading-none" style={{ color: "var(--gp-ink)" }}>
                {e.name}
              </div>
              <div className="mono-label mt-1">{e.tag}</div>
            </div>
            <div className="ml-auto text-right shrink-0">
              <div className="font-[family-name:var(--font-jbmono)] text-[12px]" style={{ color: e.color }}>{e.metric}</div>
              <div className="mono-label mt-0.5">{e.state}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
