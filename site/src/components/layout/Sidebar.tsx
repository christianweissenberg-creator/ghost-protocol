"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Command Center", icon: "◈" },
  { href: "/agents", label: "Agents", icon: "◎" },
  { href: "/messages", label: "Message Bus", icon: "⇋" },
  { href: "/metrics", label: "Metrics", icon: "◇" },
  { href: "/content", label: "Content Pipeline", icon: "▣" },
  { href: "/donna", label: "DONNA", icon: "◈" },
  { href: "/academy", label: "Academy", icon: "◉" },
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
    <aside className="fixed left-0 top-0 bottom-0 w-[240px] bg-surface border-r border-border flex flex-col z-50">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent-violet/20 flex items-center justify-center">
            <span className="text-accent-violet font-bold text-sm font-[family-name:var(--font-outfit)]">G</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight font-[family-name:var(--font-outfit)]">
              Ghost Protocol
            </h1>
            <p className="text-[10px] text-text-muted uppercase tracking-widest">
              Command Center
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-accent-violet/10 text-accent-violet"
                  : "text-text-secondary hover:text-foreground hover:bg-surface-elevated"
              }`}
            >
              <span className="text-base opacity-60">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Tier Status */}
      <div className="px-5 py-4 border-t border-border space-y-2">
        <p className="text-[10px] text-text-muted uppercase tracking-widest mb-2">
          Agent Tiers
        </p>
        {TIER_INDICATORS.map((t) => (
          <div key={t.tier} className="flex items-center gap-2 text-xs text-text-secondary">
            <div className={`w-2 h-2 rounded-full ${t.color}`} />
            <span>Tier {t.tier}</span>
            <span className="text-text-muted ml-auto">{t.label}</span>
          </div>
        ))}
      </div>

      {/* Version */}
      <div className="px-5 py-3 border-t border-border">
        <p className="text-[10px] text-text-muted font-mono">v0.1.0 — Phase 1</p>
      </div>
    </aside>
  );
}
