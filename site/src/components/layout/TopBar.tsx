"use client";

import { useEffect, useState } from "react";
import { useAktivPfad } from "@/components/layout/aktiv-pfad";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import { kostenLuecke, kostenZeitraum, useSystemStatus, type SystemStatusLesung } from "@/lib/hooks-status";
// Aus lib/types, nicht aus den Panels: sonst lüde die TopBar auf jeder Seite lib/hooks mit.
import { formatiereUsd, formatiereUsdUntergrenze, messfeld, messTitel, uhrzeit } from "@/lib/types";

// Prototyp-Vorbild: ● LIVE-Badge + Breadcrumb links, Vitals rechts. Frostglas-Unterkante.
// Stufe 1 (05.11.2026): Die festen Werte für Systemzustand und Monatsumsatz sind entfernt —
// dahinter stand keine Messung. Die Ortskoordinate ist entfernt: Der Ort ist nicht der
// Firmensitz, eine belegte Koordinate gibt es nicht. Kosten heute und die LIVE-Pille kommen
// aus /api/status (useSystemStatus).
// Fixrunde 06.11.2026: Die TopBar liest den geteilten Abruf der Shell (SystemStatusProvider,
// R28). Frisch heißt: letzter erfolgreicher Abruf im Browser (geladenAm), verglichen mit der
// Browseruhr; erzeugt_am (Serveruhr) steht nur noch im Titel (R27). HTTP 401 zeigt
// bernsteinfarben "NICHT ANGEMELDET" statt OFFLINE (R26). Kosten heute: der Betrag, wenn der
// Tag vollständig ist, sonst "≥ Betrag" als Untergrenze mit Grund im Titel (R20).
// Gesamtprüfung 06.11.2026: Die Untergrenze wird abgerundet (formatiereUsdUntergrenze) — gerundet
// lag "≥ $0,02" für gemessene 0,016 über der Summe; unter $0,01 steht "> $0 (gemessen unter $0,01)".
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

// Älter als das gilt der letzte erfolgreiche Abruf nicht mehr als live (Abruf alle 60 s).
const LIVE_HOECHSTALTER_MS = 3 * 60_000;

function Vital({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span className="hidden xl:inline-flex flex-col items-end leading-none" title={title}>
      <span className="mono-label" style={{ fontSize: 8 }}>{label}</span>
      <span className="font-[family-name:var(--font-jbmono)] text-[10px] mt-1" style={{ color: "var(--gp-gold-hi)" }}>
        {value}
      </span>
    </span>
  );
}

type Pille = { text: string; farbe: string; glow: string; puls: boolean; title: string };

const GRUEN = { farbe: "var(--gp-emerald)", glow: "0 0 8px rgba(34,197,94,0.6)" };
const BERNSTEIN = { farbe: "var(--gp-amber)", glow: "0 0 8px rgba(245,158,11,0.5)" };
const ROSE = { farbe: "var(--gp-rose)", glow: "0 0 8px rgba(255,77,106,0.5)" };

// Prüflauf 06.11.2026: /api/status antwortet selbst nur mit 200 oder 500 (JSON), die Middleware
// mit 401 (status/route.ts, middleware.ts). 502, 503 und 504 stammen deshalb vom Reverse-Proxy
// davor (Coolify/Traefik): Der Dashboard-Server hat dann nicht geantwortet — rot "OFFLINE" wie
// ohne jede Antwort, nicht "NICHT LESBAR — der Server antwortete".
const GATEWAY_STATUS = new Set([502, 503, 504]);

// LIVE nur bei erreichbarem Supabase UND frischem Abruf. Für die nicht vorgegebenen
// Fälle (Abruf veraltet, Supabase "warnung" oder "nicht_gemessen") bernstein statt grün.
function livePille(lesung: SystemStatusLesung, jetzt: number | null): Pille {
  const { status, fehler, httpStatus, geladenAm } = lesung;
  if (fehler) {
    // 401: Server und Middleware antworten, nur die Sitzung fehlt. Gemessen ist damit nichts —
    // bernstein wie UNGEMESSEN, nicht rot wie ein nicht erreichbarer Server.
    if (httpStatus === 401) {
      return {
        text: "NICHT ANGEMELDET",
        ...BERNSTEIN,
        puls: false,
        title:
          "Nicht angemeldet (HTTP 401): Der Server antwortet, liest den Systemzustand aber erst nach der Anmeldung. Supabase ist damit nicht gemessen.",
      };
    }
    // Gegencheck 06.11.2026: "OFFLINE" nur ohne jede Antwort (Netzfehler). Hat der Server
    // geantwortet (500, 200 ohne lesbares JSON …), ist er erreichbar — nur der Systemzustand
    // war nicht lesbar.
    if (httpStatus !== null && GATEWAY_STATUS.has(httpStatus)) {
      return {
        text: "OFFLINE",
        ...ROSE,
        puls: false,
        title: `Keine Antwort des Dashboard-Servers: Der vorgeschaltete Proxy meldet HTTP ${httpStatus}. Systemzustand nicht lesbar: ${fehler}`,
      };
    }
    if (httpStatus !== null) {
      return {
        text: "NICHT LESBAR",
        ...BERNSTEIN,
        puls: false,
        title: `Der Server antwortete (HTTP ${httpStatus}), der Systemzustand war aber nicht lesbar: ${fehler}`,
      };
    }
    return { text: "OFFLINE", ...ROSE, puls: false, title: `Systemzustand nicht lesbar: ${fehler}` };
  }
  if (!status) {
    return { text: "PRÜFT", ...BERNSTEIN, puls: true, title: "Systemzustand wird geladen" };
  }
  const supabase = messfeld(status.supabase, "supabase");
  if (supabase.status === "fehler") {
    return { text: "OFFLINE", ...ROSE, puls: false, title: `Supabase: Fehler\n${messTitel(supabase)}` };
  }
  if (jetzt === null) {
    return { text: "PRÜFT", ...BERNSTEIN, puls: true, title: "Systemzustand wird bewertet" };
  }
  // Frische aus zwei Zeitpunkten derselben Uhr (Browser): geladenAm und jetzt. Die Serveruhr
  // (erzeugt_am) kann gegen die Browseruhr versetzt sein und steht deshalb nur im Titel.
  const abgerufen = geladenAm ? Date.parse(geladenAm) : Number.NaN;
  const serverZeit = uhrzeit(status.erzeugt_am) ?? "Zeitpunkt unlesbar";
  if (!Number.isFinite(abgerufen)) {
    return {
      text: "UNGEMESSEN",
      ...BERNSTEIN,
      puls: false,
      title: `Zeitpunkt des letzten Abrufs fehlt.\nMessung des Servers: ${serverZeit}\n${messTitel(supabase)}`,
    };
  }
  const titel = `Letzter erfolgreicher Abruf: ${uhrzeit(geladenAm) ?? "?"} (Browseruhr)\nMessung des Servers: ${serverZeit} (Serveruhr)\n${messTitel(supabase)}`;
  if (supabase.status !== "ok") {
    const text = supabase.status === "warnung" ? "WARNUNG" : "UNGEMESSEN";
    return { text, ...BERNSTEIN, puls: false, title: titel };
  }
  if (jetzt - abgerufen > LIVE_HOECHSTALTER_MS) {
    return { text: "VERALTET", ...BERNSTEIN, puls: false, title: `Letzter erfolgreicher Abruf älter als 3 Minuten.\n${titel}` };
  }
  return { text: "LIVE", ...GRUEN, puls: true, title: titel };
}

function kostenHeute(lesung: SystemStatusLesung): { text: string; title: string } {
  const { status, fehler, loading, httpStatus } = lesung;
  if (fehler) {
    return {
      text: "nicht gemessen",
      title: httpStatus === 401 ? "Nicht angemeldet (HTTP 401)" : `Systemzustand nicht lesbar: ${fehler}`,
    };
  }
  if (!status) return { text: loading ? "lädt …" : "nicht gemessen", title: "Systemzustand wird geladen" };
  const kosten = messfeld(status.kosten, "kosten");
  // Ein Betrag nur aus einem lesbaren Kostenwert ("ok" oder "warnung"). Ist der Tag
  // vollständig, steht der Betrag da; sonst "≥ Betrag", denn Läufe ohne Kostenangabe oder eine
  // abgeschnittene Abfrage fehlen in der Summe. Der Grund steht im title.
  const lesbar = kosten.status === "ok" || kosten.status === "warnung" ? kosten.wert : null;
  const heute = kostenZeitraum(lesbar, "heute");
  if (!heute) return { text: "nicht gemessen", title: messTitel(kosten) };
  if (heute.vollstaendig) {
    return { text: `${formatiereUsd(heute.usd)} (geschätzt)`, title: messTitel(kosten, "Tagessumme laut Server vollständig.") };
  }
  return {
    text: `${formatiereUsdUntergrenze(heute.usd)} (geschätzt)`,
    title: messTitel(kosten, kostenLuecke(lesbar, "heute") ?? undefined),
  };
}

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  // Nicht usePathname(): Unter der per Rewrite ausgelieferten Login-Seite wiche die Brotkrume
  // im Browser vom Server-HTML ab (React #418, components/layout/aktiv-pfad.ts).
  const pathname = useAktivPfad();
  const crumb = CRUMB[pathname] ?? "Command Center";
  const lesung = useSystemStatus();
  // Browserzeit als State: Uhr und Frische-Prüfung der LIVE-Pille, ohne Date.now() im Render.
  const [jetzt, setJetzt] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setJetzt(Date.now());
    const start = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(start);
      clearInterval(t);
    };
  }, []);

  const clock = jetzt === null ? "--:--:--" : new Date(jetzt).toLocaleTimeString("de-DE", { hour12: false });
  const pille = livePille(lesung, jetzt);
  const kosten = kostenHeute(lesung);

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
      <span className="inline-flex items-center gap-2" title={maskiereGeschuetzteNamen(pille.title)}>
        <span
          className={`w-1.5 h-1.5 rounded-full${pille.puls ? " animate-pulse-subtle" : ""}`}
          style={{ background: pille.farbe, boxShadow: pille.glow }}
        />
        <span
          className="font-[family-name:var(--font-jbmono)] text-[10px] tracking-[0.22em]"
          style={{ color: pille.farbe }}
        >
          {pille.text}
        </span>
      </span>
      <span className="hidden sm:inline mono-label" style={{ color: "var(--gp-ink-3)" }}>GP · HQ</span>
      <span className="hidden sm:inline" style={{ color: "var(--gp-ink-3)" }}>/</span>
      <span className="font-[family-name:var(--font-jbmono)] text-[10px] sm:text-[11px] tracking-[0.12em] truncate" style={{ color: "var(--gp-ink-2)" }}>
        {crumb}
      </span>

      <div className="ml-auto flex items-center gap-6">
        <Vital label="Kosten heute" value={kosten.text} title={maskiereGeschuetzteNamen(kosten.title)} />
        <span className="hidden xl:inline-flex flex-col items-end leading-none">
          <span className="mono-label" style={{ fontSize: 8 }}>Uhrzeit</span>
          <span className="font-[family-name:var(--font-jbmono)] text-[10px] mt-1" style={{ color: "var(--gp-ink-2)" }}>{clock}</span>
        </span>
      </div>
    </div>
  );
}
