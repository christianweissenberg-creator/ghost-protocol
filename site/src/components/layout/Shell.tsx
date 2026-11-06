"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { SystemStatusProvider } from "@/lib/hooks-status";

// App-Shell: hält den Mobile-Nav-Zustand. Auf lg+ ist die Sidebar fix sichtbar;
// darunter ist sie ein Off-Canvas-Drawer, den der Hamburger in der TopBar öffnet.
// Fixrunde 06.11.2026 (R28): Die Shell hält den einen Abruf von /api/status
// (SystemStatusProvider). TopBar und Seiten lesen ihn mit useSystemStatus(), statt je
// einen eigenen Poller zu starten.
export function Shell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Drawer bei Navigation schließen. Beim Rendern statt im Effekt (React-Muster „State bei
  // geänderter Eingabe anpassen“): gleiche Wirkung, ohne setState im Effekt.
  const [navPfad, setNavPfad] = useState(pathname);
  if (navPfad !== pathname) {
    setNavPfad(pathname);
    setNavOpen(false);
  }

  return (
    <SystemStatusProvider>
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

      {/* Browser-Prüfung 06.11.2026: min-w-0, sonst wächst dieser Flex-Bereich mit seinem breitesten
          Inhalt (Stufenleiste auf /content: 480 px) und die ganze Seite scrollt bei 375 px waagrecht. */}
      <div className="relative z-[1] flex-1 min-w-0 lg:ml-[252px] min-h-screen flex flex-col">
        <TopBar onMenu={() => setNavOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </SystemStatusProvider>
  );
}
