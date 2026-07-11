"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Prototyp-Vorbild: ● LIVE-Badge + Breadcrumb links, Vitals rechts
// (System · Kosten heute · Umsatz MTD · Uhrzeit). Frostglas-Unterkante.
const CRUMB: Record<string, string> = {
  "/": "Command Center",
  "/agents": "Agent-Flotte",
  "/messages": "Message Bus",
  "/metrics": "Metrics",
  "/content": "Content-Pipeline",
  "/donna": "L.I.S.A.",
  "/expose": "Exposé-Engine",
  "/academy": "Academy",
};

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <span className="hidden xl:inline-flex flex-col items-end leading-none">
      <span className="mono-label" style={{ fontSize: 8 }}>{label}</span>
      <span className="font-[family-name:var(--font-jbmono)] text-[10px] mt-1" style={{ color: "var(--gp-gold-hi)" }}>
        {value}
      </span>
    </span>
  );
}

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const pathname = usePathname();
  const crumb = CRUMB[pathname] ?? "Command Center";
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const t = setInterval(
      () => setClock(new Date().toLocaleTimeString("de-DE", { hour12: false })),
      1000
    );
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="sticky top-0 z-30 flex items-center gap-3 sm:gap-4 h-12 px-4 sm:px-8"
      style={{
        background: "rgba(7, 8, 8, 0.72)",
        backdropFilter: "blur(14px) saturate(115%)",
        WebkitBackdropFilter: "blur(14px) saturate(115%)",
        borderBottom: "1px solid var(--gp-hairline)",
        boxShadow: "0 1px 0 rgba(201,168,106,0.06)",
      }}
    >
      {/* Hamburger (nur mobil) */}
      <button
        onClick={onMenu}
        aria-label="Menü öffnen"
        className="lg:hidden -ml-1 w-8 h-8 flex flex-col items-center justify-center gap-[3px] rounded-md shrink-0"
        style={{ border: "1px solid var(--gp-hairline)" }}
      >
        <span className="block w-3.5 h-[1.5px]" style={{ background: "var(--gp-gold)" }} />
        <span className="block w-3.5 h-[1.5px]" style={{ background: "var(--gp-gold)" }} />
        <span className="block w-3.5 h-[1.5px]" style={{ background: "var(--gp-gold)" }} />
      </button>
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
      <span className="hidden sm:inline mono-label" style={{ color: "var(--gp-ink-3)" }}>GP · HQ</span>
      <span className="hidden sm:inline" style={{ color: "var(--gp-ink-3)" }}>/</span>
      <span className="font-[family-name:var(--font-jbmono)] text-[10px] sm:text-[11px] tracking-[0.12em] truncate" style={{ color: "var(--gp-ink-2)" }}>
        {crumb}
      </span>

      <div className="ml-auto flex items-center gap-6">
        <Vital label="System" value="100 %" />
        <Vital label="Kosten heute" value="$0,35" />
        <Vital label="Umsatz MTD" value="€4.870" />
        <span className="hidden xl:inline-flex flex-col items-end leading-none">
          <span className="mono-label" style={{ fontSize: 8 }}>Uhrzeit</span>
          <span className="font-[family-name:var(--font-jbmono)] text-[10px] mt-1" style={{ color: "var(--gp-ink-2)" }}>{clock}</span>
        </span>
        <span className="mono-label" style={{ color: "var(--gp-gold)" }}>N48.137° · E11.575°</span>
      </div>
    </div>
  );
}
