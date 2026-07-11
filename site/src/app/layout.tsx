import type { Metadata } from "next";
import { Outfit, Cormorant_Garamond, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/layout/Sidebar";
import "./globals.css";

// Neural Noir Editorial (MASTERPROMPT §3):
// Cormorant Garamond = Editorial-Display · Outfit = UI · JetBrains Mono = Metadaten
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

const jbMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Ghost Protocol — Command Center",
  description: "Autonomous AI Corporation Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${outfit.variable} ${cormorant.variable} ${jbMono.variable} h-full`}
    >
      <body className="min-h-full flex bg-background text-foreground antialiased">
        {/* §9.2 Environment-Layer: Lichtquelle + Glow + Vignette + Grain — nie interaktiv */}
        <div className="gp-env" aria-hidden="true">
          <div className="gp-vignette" />
          <div className="gp-grain" />
        </div>
        <Sidebar />
        <main className="relative z-[1] flex-1 ml-[240px] min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
