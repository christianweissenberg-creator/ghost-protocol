"use client";

// Kampagnen-Attribution aus dem Steinadel-Rückkanal (/api/attribution) —
// reine Aggregate (Leads/Termine/Klicks/Spend/CPL), keine Personendaten.
import { Fragment, useEffect, useState } from "react";

interface UtmContentSplit {
  utm_content: string;
  leads: number;
  klicks: number;
}
interface VariantSplit {
  lp_variant: string;
  leads: number;
}
interface KampagnenZeile {
  kampagne: string;
  kanal: string | null;
  leads: number;
  termine: number;
  klicks: number;
  spend_cents: number | null;
  cpl_cents: number | null;
  nach_utm_content: UtmContentSplit[];
  nach_lp_variant: VariantSplit[];
}
interface AttributionResponse {
  generiert_am?: string;
  moeglicherweise_unvollstaendig?: boolean;
  kampagnen?: KampagnenZeile[];
  fehler?: string;
}

function euro(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function AttributionPanel() {
  const [zustand, setZustand] = useState<"laden" | "fehler" | "erfolg">("laden");
  const [daten, setDaten] = useState<AttributionResponse | null>(null);
  const [offen, setOffen] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      try {
        const res = await fetch("/api/attribution", { cache: "no-store" });
        const d: AttributionResponse = await res.json();
        if (abgebrochen) return;
        if (!res.ok || d.fehler || !d.kampagnen) {
          setZustand("fehler");
          return;
        }
        setDaten(d);
        setZustand("erfolg");
      } catch {
        if (!abgebrochen) setZustand("fehler");
      }
    })();
    return () => {
      abgebrochen = true;
    };
  }, []);

  return (
    <div className="card-ghost p-5 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <span className="mono-label" style={{ color: "var(--gp-gold)" }}>
          STEINADEL-ATTRIBUTION · RÜCKKANAL (READ-ONLY)
        </span>
        {zustand === "erfolg" && daten?.generiert_am && (
          <span className="ml-auto mono-label" style={{ color: "var(--gp-ink-3)" }}>
            Stand: {new Date(daten.generiert_am).toLocaleString("de-DE")}
          </span>
        )}
      </div>

      {zustand === "laden" && (
        <p className="mono-label" style={{ color: "var(--gp-ink-3)" }}>Lade Kampagnen-Aggregate …</p>
      )}
      {zustand === "fehler" && (
        <p className="mono-label" style={{ color: "var(--gp-amber)" }}>
          RÜCKKANAL NICHT ERREICHBAR — steinadel.de /api/kampagnen/attribution
        </p>
      )}

      {zustand === "erfolg" && daten?.kampagnen && (
        <>
          {daten.moeglicherweise_unvollstaendig && (
            <p className="mono-label mb-2" style={{ color: "var(--gp-amber)" }}>
              Hinweis: Datenmenge am Abruf-Deckel — Zahlen möglicherweise unvollständig.
            </p>
          )}
          {daten.kampagnen.length === 0 && (
            <p className="mono-label" style={{ color: "var(--gp-ink-3)" }}>
              Noch keine Kampagnen-Daten (keine Leads/Klicks mit utm_campaign).
            </p>
          )}
          {daten.kampagnen.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]" style={{ color: "var(--gp-ink-2)" }}>
                <thead>
                  <tr className="mono-label text-left" style={{ color: "var(--gp-ink-3)" }}>
                    <th className="py-1 pr-4">Kampagne</th>
                    <th className="py-1 pr-4">Kanal</th>
                    <th className="py-1 pr-4 text-right">Klicks</th>
                    <th className="py-1 pr-4 text-right">Leads</th>
                    <th className="py-1 pr-4 text-right">Termine</th>
                    <th className="py-1 pr-4 text-right">Spend</th>
                    <th className="py-1 text-right">CPL</th>
                  </tr>
                </thead>
                <tbody>
                  {daten.kampagnen.map((k) => (
                    <Fragment key={k.kampagne}>
                      <tr
                        className="cursor-pointer"
                        style={{ borderTop: "1px solid var(--gp-hairline)" }}
                        onClick={() => setOffen(offen === k.kampagne ? null : k.kampagne)}
                      >
                        <td className="py-2 pr-4 font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-ink)" }}>
                          {k.kampagne}
                        </td>
                        <td className="py-2 pr-4">{k.kanal ?? "—"}</td>
                        <td className="py-2 pr-4 text-right">{k.klicks}</td>
                        <td className="py-2 pr-4 text-right" style={{ color: "var(--gp-emerald)" }}>{k.leads}</td>
                        <td className="py-2 pr-4 text-right">{k.termine}</td>
                        <td className="py-2 pr-4 text-right">{euro(k.spend_cents)}</td>
                        <td className="py-2 text-right" style={{ color: "var(--gp-gold-hi)" }}>{euro(k.cpl_cents)}</td>
                      </tr>
                      {offen === k.kampagne && (
                        <tr>
                          <td colSpan={7} className="pb-3">
                            <div className="pl-2 space-y-1">
                              {k.nach_utm_content.map((c) => (
                                <div key={c.utm_content} className="mono-label">
                                  {c.utm_content}: {c.klicks} Klicks · {c.leads} Leads
                                </div>
                              ))}
                              {k.nach_lp_variant.length > 0 && (
                                <div className="mono-label" style={{ color: "var(--gp-cyan)" }}>
                                  A/B: {k.nach_lp_variant.map((v) => `${v.lp_variant}=${v.leads}`).join(" · ")}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
