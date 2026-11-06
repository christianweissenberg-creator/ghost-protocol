"use client";

// Kampagnen-Attribution aus dem Steinadel-Rückkanal (/api/attribution) —
// reine Aggregate (Leads/Termine/Klicks/Spend/CPL), keine Personendaten.
// Gesamtprüfung 06.11.2026: Vorher stand bei JEDEM Fehler "RÜCKKANAL NICHT ERREICHBAR" — auch
// ohne Sitzung (401) oder ohne Token (500), also mit falscher Ursache. Jetzt: 401 nicht
// angemeldet, 500 Serverkonfiguration (Meldung des Servers, maskiert), 502 nicht erreichbar.
// Gegencheck 06.11.2026: Die Ursache kommt aus "fehler_art" der Route, nicht mehr aus dem Status
// allein. Vorher hieß jede 502 "RÜCKKANAL NICHT ERREICHBAR", auch wenn steinadel.de mit 401/403
// oder unlesbarem JSON geantwortet hatte, und jede 500 "Serverkonfiguration", auch ohne Beleg.
// Werte aus dem Rückkanal (Kampagne, Kanal, utm_content, Variante) erscheinen maskiert wie auf
// /content (R24).
import { Fragment, useEffect, useState } from "react";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";

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
  fehler_art?: string;
}

function euro(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/** Wert aus dem Rückkanal für die Anzeige: Text, geschützter Name maskiert. */
function wert(w: unknown): string {
  return maskiereGeschuetzteNamen(w === null || w === undefined ? "" : String(w));
}

export interface AttributionFehler {
  text: string;
  /** "amber": ungemessen oder Quelle nicht erreichbar; "rose": Konfigurations- oder Antwortfehler. */
  ton: "amber" | "rose";
}

const RUECKKANAL_HTTP = /^rueckkanal_http_(\d{3})$/;

/**
 * Fehlerzustand des Rückkanals aus HTTP-Status und Antwort; null = Antwort verwertbar. 401 kommt
 * von der Middleware (keine Sitzung). Sonst entscheidet "fehler_art" der Route (api/attribution):
 * konfiguration, nicht_erreichbar oder quelle_fehler. Ein Fehlerstatus ohne fehler_art (etwa eine
 * 500 von Next selbst oder eine 502 des Reverse-Proxys) nennt keine Ursache.
 */
export function attributionFehler(status: number | null, daten: unknown): AttributionFehler | null {
  const d = daten !== null && typeof daten === "object" && !Array.isArray(daten) ? (daten as Record<string, unknown>) : null;
  const meldung = d && typeof d.fehler === "string" && d.fehler.trim() ? d.fehler.trim() : null;
  const art = d && typeof d.fehler_art === "string" ? d.fehler_art : null;
  if (status === null) return { text: "RÜCKKANAL NICHT ABRUFBAR — keine Antwort vom Dashboard-Server", ton: "amber" };
  if (status === 401) return { text: "NICHT ANGEMELDET (HTTP 401) — Rückkanal erst nach der Anmeldung lesbar", ton: "amber" };
  if (status < 200 || status >= 300) {
    if (art === "konfiguration") {
      return { text: `SERVERKONFIGURATION (HTTP ${status}): ${maskiereGeschuetzteNamen(meldung ?? "ohne Fehlertext")}`, ton: "rose" };
    }
    if (art === "nicht_erreichbar") {
      return { text: "RÜCKKANAL NICHT ERREICHBAR — steinadel.de /api/kampagnen/attribution (Netzfehler oder Zeitlimit)", ton: "amber" };
    }
    if (art === "quelle_fehler") {
      const http = meldung ? RUECKKANAL_HTTP.exec(meldung) : null;
      const was = http
        ? `antwortete mit HTTP ${http[1]}`
        : meldung === "rueckkanal_antwort_unlesbar"
          ? "Antwort nicht lesbar (kein JSON)"
          : maskiereGeschuetzteNamen(meldung ?? "ohne Fehlertext");
      return { text: `RÜCKKANAL MELDET FEHLER — steinadel.de ${was}`, ton: "rose" };
    }
    return { text: `FEHLER (HTTP ${status}): ${maskiereGeschuetzteNamen(meldung ?? "ohne Fehlertext")}`, ton: "rose" };
  }
  if (!d) return { text: "ANTWORT NICHT LESBAR — kein JSON-Objekt", ton: "rose" };
  if (meldung) return { text: `FEHLER: ${maskiereGeschuetzteNamen(meldung)}`, ton: "rose" };
  if (!Array.isArray(d.kampagnen)) return { text: "ANTWORT OHNE KAMPAGNENLISTE", ton: "rose" };
  return null;
}

export function AttributionPanel() {
  const [zustand, setZustand] = useState<"laden" | "fehler" | "erfolg">("laden");
  const [daten, setDaten] = useState<AttributionResponse | null>(null);
  const [fehler, setFehler] = useState<AttributionFehler | null>(null);
  const [offen, setOffen] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      let status: number | null = null;
      let d: unknown = null;
      try {
        const res = await fetch("/api/attribution", { cache: "no-store" });
        status = res.status;
        d = await res.json().catch(() => null);
      } catch {
        status = null;
      }
      if (abgebrochen) return;
      const f = attributionFehler(status, d);
      if (f) {
        setFehler(f);
        setZustand("fehler");
        return;
      }
      setDaten(d as AttributionResponse);
      setZustand("erfolg");
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
      {zustand === "fehler" && fehler && (
        <p className="mono-label break-words" style={{ color: fehler.ton === "rose" ? "var(--gp-rose)" : "var(--gp-amber)" }}>
          {fehler.text}
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
                  {daten.kampagnen.map((k, zeile) => (
                    <Fragment key={`${zeile}-${String(k.kampagne)}`}>
                      <tr
                        className="cursor-pointer"
                        style={{ borderTop: "1px solid var(--gp-hairline)" }}
                        onClick={() => setOffen(offen === k.kampagne ? null : k.kampagne)}
                      >
                        <td className="py-2 pr-4 font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-ink)" }}>
                          {wert(k.kampagne)}
                        </td>
                        <td className="py-2 pr-4">{k.kanal === null || k.kanal === undefined ? "—" : wert(k.kanal)}</td>
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
                              {(Array.isArray(k.nach_utm_content) ? k.nach_utm_content : []).map((c, i) => (
                                <div key={`${i}-${String(c.utm_content)}`} className="mono-label">
                                  {wert(c.utm_content)}: {c.klicks} Klicks · {c.leads} Leads
                                </div>
                              ))}
                              {Array.isArray(k.nach_lp_variant) && k.nach_lp_variant.length > 0 && (
                                <div className="mono-label" style={{ color: "var(--gp-cyan)" }}>
                                  A/B: {wert(k.nach_lp_variant.map((v) => `${v.lp_variant}=${v.leads}`).join(" · "))}
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
