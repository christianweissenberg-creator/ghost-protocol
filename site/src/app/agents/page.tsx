"use client";

// Agentflotte — Stufe 1 (05.11.2026).
// Das frühere Fallback-ROSTER ist entfernt: feste Einheiten mit erfundenen Kosten je
// Einheit, festem Status und Modellen, die dem Register widersprachen. Angezeigt wird nur,
// was im Agenten-Register in Supabase steht, ohne AUSGEBLENDETE_AGENTEN (lib/types.ts).
// Zahlen in Kopfzeile und Gruppen werden aus diesen Daten gezählt, nicht festgeschrieben.
// Stufe 1 (06.11.2026, Befund R13): Den Filter macht useAgents zentral; "ausgeblendet" zählt
// die herausgefilterten Zeilen.
// Nachbesserung 06.11.2026: Eine leere Liste sagt, was die Abfrage im Browser geliefert hat,
// nicht, was in der Tabelle steht; Gegenprobe ist die Zählung über /api/status.
// Tor-Prüfung 07.11.2026 (F2): Das Modell je Karte kommt aus der Dashboard-Konfiguration
// (lib/agent-modelle.ts), nicht aus dem Register; die Unterzeile sagt das.

import { useAgents } from "@/lib/hooks";
import { useSystemStatus } from "@/lib/hooks-status";
import { AgentCard } from "@/components/agents/AgentCard";
import { TIER_META, TIER_UNBEKANNT, agentenLeerHinweis, agentenZaehlung } from "@/lib/types";
import type { AgentTier } from "@/lib/types";

const TIERS = [0, 1, 2, 3] as AgentTier[];

function mehrzahl(n: number, eins: string, mehr: string): string {
  return `${n} ${n === 1 ? eins : mehr}`;
}

export default function AgentsPage() {
  // agents enthält nur sichtbare Agenten (Filter in useAgents).
  const { agents: sichtbare, ausgeblendet, loading, error } = useAgents();
  // Gegenprobe für eine leere Liste: Zeilen in agents laut /api/status (geteilter Abruf der Shell).
  const sys = useSystemStatus();
  const server = agentenZaehlung(sys.status, sys.fehler);
  const leer = agentenLeerHinweis(ausgeblendet, server.anzahl);
  // Tier-Spalte ist in Supabase ein freier INTEGER: Zeilen außerhalb 0–3 bekommen eine
  // eigene Gruppe, statt still zu fehlen.
  const ohneBekanntesTier = sichtbare.filter((a) => !TIERS.includes(a.tier));
  const belegteTiers = TIERS.filter((t) => sichtbare.some((a) => a.tier === t)).length;

  const kopfzeile = loading
    ? "Register lädt …"
    : error
      ? "Register nicht lesbar"
      : `${mehrzahl(sichtbare.length, "Einheit", "Einheiten")} · ${mehrzahl(belegteTiers, "Tier", "Tiers")}`;

  return (
    <div className="boot p-4 sm:p-6 lg:p-10 max-w-[1400px]">
      <div className="gp-masthead">
        <div className="gp-index-row">
          <span className="gp-index">02 / FLOTTE</span>
          <span className="gp-index-rule" />
          <span className="mono-label" title="Gezählt aus der Supabase-Tabelle agents, im Browser gelesen, ohne ausgeblendete Agenten">
            {kopfzeile}
          </span>
        </div>
        <p className="gp-kicker">Operator-Grid — Autonome KI-Corporation</p>
        <h1 className="gp-wordmark">Agent<em>flotte</em></h1>
        <p className="gp-sub">
          Die Spezialisten nach Tier — letzte Aktivierung und Kanäle aus dem Agenten-Register, Modell laut Dashboard-Konfiguration (abweichendes Register markiert).
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="card-ghost p-4 h-32 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="card-ghost p-5">
          <p className="text-sm break-words" style={{ color: "var(--gp-rose)" }}>
            Register nicht lesbar: {error}
          </p>
        </div>
      ) : sichtbare.length === 0 ? (
        <div className="card-ghost p-5" title={ausgeblendet > 0 ? undefined : server.titel}>
          <p className="text-sm" style={{ color: leer.widerspruch ? "var(--gp-amber)" : "var(--gp-ink-2)" }}>
            {leer.text}
          </p>
          {leer.zusatz && (
            <p className="text-xs mt-2" style={{ color: "var(--gp-ink-3)" }}>
              {leer.zusatz}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {TIERS.map((tier) => {
            const meta = TIER_META[tier];
            const live = sichtbare.filter((a) => a.tier === tier);
            if (live.length === 0) return null;
            return (
              <div key={tier}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                  <h2 className="mono-label" style={{ color: meta.color }}>
                    Tier {tier} — {meta.label}
                  </h2>
                  <span className="text-xs" style={{ color: "var(--gp-ink-3)" }}>
                    {meta.description} ({live.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {live.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                  ))}
                </div>
              </div>
            );
          })}

          {ohneBekanntesTier.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--gp-ink-3)" }} />
                <h2 className="mono-label">Tier {TIER_UNBEKANNT.label}</h2>
                <span className="text-xs" style={{ color: "var(--gp-ink-3)" }}>
                  {TIER_UNBEKANNT.description} ({ohneBekanntesTier.length})
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ohneBekanntesTier.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
