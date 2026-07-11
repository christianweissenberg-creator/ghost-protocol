"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Prototyp-Vorbild: Gold-Diamant-Logo, gruppierte Nav mit Icons,
// Aktiv-Item = Gold-Linksbalken + Gold-Text + getönte Pille.
const NAV_GROUPS: { title: string; items: { href: string; label: string; glyph: string }[] }[] = [
  {
    title: "Steuerung",
    items: [
      { href: "/", label: "Command Center", glyph: "◈" },
      { href: "/agents", label: "Agent-Flotte", glyph: "◎" },
      { href: "/donna", label: "L.I.S.A.", glyph: "✦" },
    ],
  },
  {
    title: "Signale",
    items: [
      { href: "/messages", label: "Message Bus", glyph: "⇋" },
      { href: "/metrics", label: "Metrics", glyph: "◇" },
    ],
  },
  {
    title: "Produktion",
    items: [
      { href: "/expose", label: "Exposé-Engine", glyph: "⌂" },
      { href: "/content", label: "Content-Pipeline", glyph: "▣" },
      { href: "/academy", label: "Academy", glyph: "◉" },
    ],
  },
];

const TIER_INDICATORS = [
  { tier: 0, label: "Brain", color: "bg-accent-rose" },
  { tier: 1, label: "C-Suite", color: "bg-accent-violet" },
  { tier: 2, label: "Directors", color: "bg-accent-cyan" },
  { tier: 3, label: "Operators", color: "bg-accent-emerald" },
];

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();

  return (
    <aside
      className={`gp-drawer fixed left-0 top-0 bottom-0 w-[252px] flex flex-col z-50 ${open ? "is-open" : ""}`}
      style={{
        // Exakt aus Prototyp: Glas-Gradient + Gold-Border .8px + blur 26px
        background: "linear-gradient(rgba(17, 18, 24, 0.72), rgba(9, 10, 14, 0.6))",
        backdropFilter: "blur(26px) saturate(1.35)",
        WebkitBackdropFilter: "blur(26px) saturate(1.35)",
        borderRight: "0.8px solid rgba(201, 168, 106, 0.11)",
        boxShadow: "inset -1px 0 0 rgba(255,255,255,0.05)",
      }}
    >
      {/* Logo: Gold-Diamant + Wortmarke */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-5" style={{ borderBottom: "1px solid var(--gp-hairline)" }}>
        <div
          className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(145deg, rgba(231,211,161,0.16), rgba(138,109,59,0.10))",
            border: "1px solid rgba(201,168,106,0.30)",
          }}
        >
          <span
            className="block w-3.5 h-3.5 rotate-45 rounded-[2px]"
            style={{ background: "linear-gradient(145deg, var(--gp-gold-hi), var(--gp-gold-lo))" }}
          />
        </div>
        <div>
          <h1
            className="font-[family-name:var(--font-cormorant)] font-semibold text-[19px] leading-none tracking-tight"
            style={{ color: "var(--gp-ink)" }}
          >
            Ghost <em style={{ fontStyle: "italic", color: "var(--gp-gold)" }}>Protocol</em>
          </h1>
          <p className="mono-label mt-1.5">Maschinenraum</p>
        </div>
        {/* Close (nur mobil) */}
        <button
          onClick={onClose}
          aria-label="Menü schließen"
          className="lg:hidden ml-auto -mr-1 w-8 h-8 flex items-center justify-center rounded-lg"
          style={{ color: "var(--gp-ink-3)", border: "1px solid var(--gp-hairline)" }}
        >
          ✕
        </button>
      </div>

      {/* Gruppierte Navigation */}
      <nav className="flex-1 px-3 py-5 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mono-label px-3 mb-2">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group relative flex items-center gap-3 pl-3.5 pr-3 py-2 rounded-lg text-[13px] transition-colors"
                    style={
                      isActive
                        ? {
                            color: "var(--gp-gold-hi)",
                            background: "rgba(201, 168, 106, 0.08)",
                            boxShadow: "inset 0 0 0 1px rgba(201,168,106,0.20)",
                          }
                        : { color: "var(--gp-ink-2)" }
                    }
                  >
                    {isActive && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full"
                        style={{ background: "var(--gp-gold)", boxShadow: "0 0 8px rgba(201,168,106,0.6)" }}
                      />
                    )}
                    <span
                      className="text-[13px] leading-none"
                      style={{ color: isActive ? "var(--gp-gold)" : "var(--gp-ink-3)" }}
                    >
                      {item.glyph}
                    </span>
                    <span className={isActive ? "" : "group-hover:text-[color:var(--gp-ink)]"}>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
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

      <div className="px-5 py-3" style={{ borderTop: "1px solid var(--gp-hairline)" }}>
        <p className="font-[family-name:var(--font-jbmono)] text-[9px] tracking-[0.18em]" style={{ color: "var(--gp-ink-3)" }}>
          V0.2.0 — NEURAL NOIR
        </p>
      </div>
    </aside>
  );
}
