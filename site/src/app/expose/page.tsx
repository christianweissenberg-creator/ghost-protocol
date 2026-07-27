"use client";

// Exposé-Engine — GP-Ansicht der ImmoNexus×GhostProtocol-Integration.
// KONZEPT: ImmoNexus (separates Projekt/Repo) hält die Immobilien-Objekte
// (Steinadel). GhostProtocol wickelt hierüber das MARKETING ab:
// Exposé-Generierung (SCRIBE) → Review (CASSANDRA/COUNSEL) → Publikation
// (PUBLISHER) → Distribution (AMPLIFIER). Objekte kommen READ-ONLY aus der
// Steinadel-Export-API über /api/objekte, GP schreibt NICHT in ImmoNexus.

import { useEffect, useState } from "react";

type Kennzahl = { label: string; wert: string };
type Kampagne = { kampagne: string; lpUrl: string; lpVariant: string };
type Urls = { objektSeite: string; expose: string; ogBild: string; cover: string };

type ObjektApi = {
  slug: string;
  name: string;
  untertitel: string;
  tagline: string;
  ort: string;
  baujahr: number;
  preis: string;
  kurzbeschreibung: string;
  statusBadge: string;
  afaProzent: number;
  istDenkmal: boolean;
  kennzahlen: Kennzahl[];
  urls: Urls;
  kampagnen: Kampagne[];
};

type ExportResponse = {
  version?: string;
  quelle?: string;
  generiert_am?: string;
  regeln?: unknown;
  objekte?: ObjektApi[];
  fehler?: string;
};

type Ladezustand = "laden" | "fehler" | "erfolg";

const KAMPAGNE = [
  { agent: "SCRIBE", task: "Exposé-Text + Objekt-Storytelling" },
  { agent: "ORACLE", task: "Standort-Dossier (Lage, Marktdaten, Rendite)" },
  { agent: "PUBLISHER", task: "Publikation steinadel.de + SEO" },
  { agent: "AMPLIFIER", task: "Distribution (Social, Investoren-Verteiler)" },
];

function statusFarbe(statusBadge: string): string {
  return statusBadge === "Vermarktung" ? "var(--gp-emerald)" : "var(--gp-amber)";
}

export default function ExposePage() {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [zustand, setZustand] = useState<Ladezustand>("laden");
  const [objekte, setObjekte] = useState<ObjektApi[]>([]);
  const [generiertAm, setGeneriertAm] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;

    async function laden() {
      try {
        const res = await fetch("/api/objekte", { cache: "no-store" });
        const daten: ExportResponse = await res.json();
        if (abgebrochen) return;

        if (!res.ok || daten.fehler || !daten.objekte) {
          setZustand("fehler");
          return;
        }

        setObjekte(daten.objekte);
        setGeneriertAm(daten.generiert_am ?? null);
        setZustand("erfolg");
      } catch {
        if (!abgebrochen) setZustand("fehler");
      }
    }

    laden();
    return () => {
      abgebrochen = true;
    };
  }, []);

  return (
    <div className="boot p-4 sm:p-6 lg:p-10 max-w-[1280px]">
      <div className="gp-masthead">
        <div className="gp-index-row">
          <span className="gp-index">04 / EXPOSÉ</span>
          <span className="gp-index-rule" />
          <span className="mono-label" style={{ color: "var(--gp-gold)" }}>IMMONEXUS · STEINADEL.DE</span>
        </div>
        <p className="gp-kicker">ImmoNexus · Exposé-Engine — Engine aktiv</p>
        <h1 className="gp-wordmark">Stein<em>adel</em></h1>
        <p className="gp-sub">
          Objekte kommen aus ImmoNexus. Ghost Protocol wickelt das Marketing ab —
          Luxus-Exposé, Standort-Dossier, Publikation und Distribution in einem Durchlauf.
        </p>
      </div>

      {/* Sync-Leiste */}
      <div className="card-ghost flex items-center gap-4 px-5 py-3 mb-8">
        {zustand === "erfolg" ? (
          <>
            <span className="inline-flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-subtle" style={{ background: "var(--gp-emerald)" }} />
              <span className="mono-label" style={{ color: "var(--gp-emerald)" }}>steinadel.de · {objekte.length} Objekte</span>
            </span>
            <span className="mono-label" style={{ color: "var(--gp-ink-3)" }}>Quelle: Steinadel Export-API (read-only)</span>
            {generiertAm && (
              <span className="ml-auto mono-label" style={{ color: "var(--gp-ink-3)" }}>
                Stand: {new Date(generiertAm).toLocaleString("de-DE")}
              </span>
            )}
          </>
        ) : (
          <span className="mono-label" style={{ color: "var(--gp-ink-3)" }}>
            Quelle: Steinadel Export-API (read-only)
          </span>
        )}
      </div>

      {/* Ladezustand */}
      {zustand === "laden" && (
        <p className="mono-label" style={{ color: "var(--gp-ink-3)" }}>
          Lade Objekte von steinadel.de …
        </p>
      )}

      {/* Fehlerzustand */}
      {zustand === "fehler" && (
        <div className="card-ghost px-5 py-4">
          <span className="mono-label" style={{ color: "var(--gp-amber)" }}>
            QUELLE NICHT ERREICHBAR — steinadel.de Export-API
          </span>
        </div>
      )}

      {/* Objekt-Akten */}
      {zustand === "erfolg" && (
        <div className="space-y-5">
          {objekte.map((o) => {
            const open = openSlug === o.slug;
            const denkmalFehlt = o.istDenkmal && !o.kennzahlen.some((k) => k.label === "Denkmal-AfA");
            return (
              <div key={o.slug} className="card-ghost overflow-hidden">
                <div className="flex flex-col lg:flex-row">
                  {/* Objektfoto-Feld */}
                  <div
                    className="lg:w-[280px] shrink-0 relative min-h-[150px]"
                    style={{
                      // Layer-Reihenfolge: Gradient (oben) über Cover-Bild; Farbe separat —
                      // in der background-Shorthand darf die Farbe nur im letzten Layer stehen.
                      backgroundColor: "#070809",
                      backgroundImage:
                        "radial-gradient(120% 120% at 30% 20%, rgba(201,168,106,0.12), rgba(6,9,11,0.6) 60%)" +
                        (o.urls.cover ? `, url("${o.urls.cover}")` : ""),
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      borderRight: "1px solid var(--gp-hairline)",
                    }}
                  >
                    <span className="absolute top-3 left-3 mono-label" style={{ color: "var(--gp-ink-3)" }}>
                      {o.ort.toUpperCase()}
                    </span>
                    <span
                      className="absolute bottom-3 left-3 font-[family-name:var(--font-cormorant)] text-3xl"
                      style={{ color: "rgba(231,211,161,0.35)" }}
                    >
                      ⌂
                    </span>
                  </div>

                  {/* Objekt-Inhalt */}
                  <div className="flex-1 p-5">
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded"
                        style={{ border: "0.8px solid " + statusFarbe(o.statusBadge) + "55" }}
                      >
                        <span className="w-1 h-1 rounded-full" style={{ background: statusFarbe(o.statusBadge) }} />
                        <span className="mono-label" style={{ color: statusFarbe(o.statusBadge) }}>{o.statusBadge}</span>
                      </span>
                      <span className="mono-label">Exposé · {o.slug}</span>
                    </div>
                    <h2 className="font-[family-name:var(--font-cormorant)] font-semibold text-[30px] leading-none" style={{ color: "var(--gp-ink)" }}>
                      {o.name}
                    </h2>
                    <p className="text-[13px] mt-1.5" style={{ color: "var(--gp-ink-2)" }}>{o.untertitel}</p>
                    <p className="text-[13px] mt-0.5" style={{ color: "var(--gp-ink-2)" }}>{o.ort}</p>
                    {o.tagline && (
                      <p className="text-[12.5px] italic mt-1" style={{ color: "var(--gp-ink-3)" }}>
                        {o.tagline}
                      </p>
                    )}
                    <p className="font-[family-name:var(--font-cormorant)] text-[24px] mt-2" style={{ color: "var(--gp-gold-hi)" }}>
                      {o.preis}
                    </p>

                    {/* Fakten-Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 mt-4">
                      {o.kennzahlen.map((f) => (
                        <div key={f.label}>
                          <div className="font-[family-name:var(--font-jbmono)] text-[13px]" style={{ color: "var(--gp-ink)" }}>{f.wert}</div>
                          <div className="mono-label mt-0.5">{f.label}</div>
                        </div>
                      ))}
                      {denkmalFehlt && (
                        <div>
                          <div className="font-[family-name:var(--font-jbmono)] text-[13px]" style={{ color: "var(--gp-ink)" }}>{o.afaProzent} %</div>
                          <div className="mono-label mt-0.5">Denkmal-AfA</div>
                        </div>
                      )}
                    </div>

                    <p className="text-[12.5px] leading-relaxed mt-4 italic" style={{ color: "var(--gp-ink-2)", fontFamily: "var(--font-cormorant)", fontSize: 15 }}>
                      „{o.kurzbeschreibung}"
                    </p>

                    {/* Links */}
                    <div className="flex items-center gap-4 mt-4">
                      <a
                        href={o.urls.objektSeite}
                        target="_blank"
                        rel="noopener"
                        className="text-[12px]"
                        style={{ color: "var(--gp-gold-hi)" }}
                      >
                        Objektseite →
                      </a>
                      <a
                        href={o.urls.expose}
                        target="_blank"
                        rel="noopener"
                        className="text-[12px]"
                        style={{ color: "var(--gp-gold-hi)" }}
                      >
                        Exposé →
                      </a>
                    </div>

                    {/* Kampagnen (falls vorhanden) */}
                    {o.kampagnen && o.kampagnen.length > 0 && (
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        {o.kampagnen.map((k) => (
                          <a
                            key={k.kampagne}
                            href={k.lpUrl}
                            target="_blank"
                            rel="noopener"
                            className="mono-label"
                            style={{ color: "var(--gp-cyan)" }}
                          >
                            {k.kampagne} ({k.lpVariant}) →
                          </a>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => setOpenSlug(open ? null : o.slug)}
                      className="mt-4 px-4 py-2 rounded-lg text-[12px] transition-colors"
                      style={{
                        color: "var(--gp-gold-hi)",
                        background: "rgba(201,168,106,0.10)",
                        border: "0.8px solid rgba(201,168,106,0.3)",
                      }}
                    >
                      {open ? "Kampagne schließen" : "Marketing-Kampagne beauftragen →"}
                    </button>

                    {open && (
                      <div className="mt-4 pt-4 space-y-2" style={{ borderTop: "1px solid var(--gp-hairline)" }}>
                        <p className="mono-label mb-2">Kampagnen-Plan → Agent-Team</p>
                        {KAMPAGNE.map((s, i) => (
                          <div key={s.agent} className="flex items-start gap-2 text-[12px]">
                            <span className="font-[family-name:var(--font-jbmono)] text-[10px] min-w-[16px]" style={{ color: "var(--gp-gold)" }}>P{i + 1}</span>
                            <span className="font-[family-name:var(--font-jbmono)] text-[10px] min-w-[74px]" style={{ color: "var(--gp-cyan)" }}>{s.agent}</span>
                            <span style={{ color: "var(--gp-ink-2)" }}>{s.task}</span>
                          </div>
                        ))}
                        <p className="mono-label pt-2" style={{ color: "var(--gp-ink-3)" }}>
                          Freigabe durch dich vor Publikation · geschätzt ~$0,08
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
