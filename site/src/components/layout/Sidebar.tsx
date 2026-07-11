"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Command Center", index: "01" },
  { href: "/agents", label: "Agent-Flotte", index: "02" },
  { href: "/messages", label: "Message Bus", index: "03" },
  { href: "/metrics", label: "Metrics", index: "04" },
  { href: "/content", label: "Content Pipeline", index: "05" },
  { href: "/donna", label: "L.I.S.A.", index: "06" },
  { href: "/academy", label: "Academy", index: "07" },
];

const TIER_INDICATORS = [
  { tier: 0, label: "Brain", color: "bg-accent-rose" },
  { tier: 1, label: "C-Suite", color: "bg-accent-violet" },
  { tier: 2, label: "Directors", color: "bg-accent-cyan" },
  { tier: 3, label: "Operators", color: "bg-accent-emerald" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-[240px] flex flex-col z-50 border-r"
      style={{
        background: "rgba(9, 10, 13, 0.72)",
        backdropFilter: "blur(18px) saturate(115%)",
        WebkitBackdropFilter: "blur(18px) saturate(115%)",
        borderColor: "var(--gp-hairline)",
        boxShadow: "inset -1px 0 0 rgba(201,168,106,0.07)",
      }}
    >
      {/* Wortmarke — editorial */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: "1px solid var(--gp-hairline)" }}>
        <p className="gp-index mb-2">GP / HQ</p>
        <h1
          className="font-[family-name:var(--font-cormorant)] font-semibold text-[22px] leading-none tracking-tight"
          style={{ color: "var(--gp-ink)" }}
        >
          Ghost <em style={{ fontStyle: "italic", color: "var(--gp-gold)" }}>Protocol</em>
        </h1>
        <p className="mono-label mt-2">Maschinenraum</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors"
              style={
                isActive
                  ? {
                      color: "var(--gp-gold-hi)",
                      background: "rgba(201, 168, 106, 0.08)",
                      boxShadow: "inset 0 0 0 1px rgba(201,168,106,0.22)",
                    }
                  : { color: "var(--gp-ink-2)" }
              }
            >
              <span
                className="font-[family-name:var(--font-jbmono)] text-[9px] tracking-[0.18em]"
                style={{ color: isActive ? "var(--gp-gold)" : "var(--gp-ink-3)" }}
              >
                {item.index}
              </span>
              <span className={isActive ? "" : "group-hover:text-[color:var(--gp-ink)]"}>
                {item.label}
              </span>
              {isActive && (
                <span
                  className="ml-auto w-1 h-1 rounded-full"
                  style={{ background: "var(--gp-gold)" }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Tier Status */}
      <div className="px-5 py-4 space-y-2" style={{ borderTop: "1px solid var(--gp-hairline)" }}>
        <p className="mono-label mb-2">Agent Tiers</p>
        {TIER_INDICATORS.map((t) => (
          <div key={t.tier} className="flex items-center gap-2 text-xs" style={{ color: "var(--gp-ink-2)" }}>
            <div className={`w-1.5 h-1.5 rounded-full ${t.color}`} />
            <span className="font-[family-name:var(--font-jbmono)] text-[10px] tracking-[0.14em]">
              T{t.tier}
            </span>
            <span className="ml-auto text-[11px]" style={{ color: "var(--gp-ink-3)" }}>
              {t.label}
            </span>
          </div>
        ))}
      </div>

      {/* Version */}
      <div className="px-5 py-3" style={{ borderTop: "1px solid var(--gp-hairline)" }}>
        <p className="font-[family-name:var(--font-jbmono)] text-[9px] tracking-[0.18em]" style={{ color: "var(--gp-ink-3)" }}>
          V0.2.0 — NEURAL NOIR
        </p>
      </div>
    </aside>
  );
}
