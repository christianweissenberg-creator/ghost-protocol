"use client";

import { usePathname } from "next/navigation";

// Prototyp-Vorbild: schmale Top-Bar mit ● LIVE-Badge links + Breadcrumb,
// Frostglas-Unterkante. Rein präsentational.
const CRUMB: Record<string, string> = {
  "/": "Command Center",
  "/agents": "Agent-Flotte",
  "/messages": "Message Bus",
  "/metrics": "Metrics",
  "/content": "Content-Pipeline",
  "/donna": "L.I.S.A.",
  "/academy": "Academy",
};

export function TopBar() {
  const pathname = usePathname();
  const crumb = CRUMB[pathname] ?? "Command Center";

  return (
    <div
      className="sticky top-0 z-40 flex items-center gap-4 h-12 px-8"
      style={{
        background: "rgba(7, 8, 8, 0.72)",
        backdropFilter: "blur(14px) saturate(115%)",
        WebkitBackdropFilter: "blur(14px) saturate(115%)",
        borderBottom: "1px solid var(--gp-hairline)",
        boxShadow: "0 1px 0 rgba(201,168,106,0.06)",
      }}
    >
      <span className="inline-flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse-subtle"
          style={{ background: "var(--gp-emerald)", boxShadow: "0 0 8px rgba(34,197,94,0.6)" }}
        />
        <span
          className="font-[family-name:var(--font-jbmono)] text-[10px] tracking-[0.22em]"
          style={{ color: "var(--gp-emerald)" }}
        >
          LIVE
        </span>
      </span>
      <span className="mono-label" style={{ color: "var(--gp-ink-3)" }}>
        GP · HQ
      </span>
      <span style={{ color: "var(--gp-ink-3)" }}>/</span>
      <span className="font-[family-name:var(--font-jbmono)] text-[11px] tracking-[0.12em]" style={{ color: "var(--gp-ink-2)" }}>
        {crumb}
      </span>
      <span className="ml-auto mono-label" style={{ color: "var(--gp-gold)" }}>
        N48.137° · E11.575°
      </span>
    </div>
  );
}
