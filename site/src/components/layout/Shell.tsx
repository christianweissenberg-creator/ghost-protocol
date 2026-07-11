"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

// App-Shell: hält den Mobile-Nav-Zustand. Auf lg+ ist die Sidebar fix sichtbar;
// darunter ist sie ein Off-Canvas-Drawer, den der Hamburger in der TopBar öffnet.
export function Shell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Drawer bei Navigation schließen
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Backdrop (nur mobil, wenn offen) */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
          aria-hidden="true"
        />
      )}

      <div className="relative z-[1] flex-1 lg:ml-[252px] min-h-screen flex flex-col">
        <TopBar onMenu={() => setNavOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </>
  );
}
