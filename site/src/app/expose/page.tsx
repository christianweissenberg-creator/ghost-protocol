"use client";

// Exposé-Engine — GP-Ansicht der ImmoNexus×GhostProtocol-Integration.
// KONZEPT: ImmoNexus (separates Projekt/Repo) hält die Immobilien-Objekte
// (Steinadel, aus HubSpot). GhostProtocol wickelt hierüber das MARKETING ab:
// Exposé-Generierung (SCRIBE) → Review (CASSANDRA/COUNSEL) → Publikation
// (PUBLISHER) → Distribution (AMPLIFIER). Objekte kommen READ-ONLY aus
// ImmoNexus (künftig via API); GP schreibt NICHT in ImmoNexus.
// Aktuell Demo-/Platzhalterdaten bis die ImmoNexus-API angebunden ist.

import { useState } from "react";

type Status = "IN REVIEW" | "PUBLIZIERT" | "ENTWURF";
type Objekt = {
  id: string;
  name: string;
  ort: string;
  region: string;
  preis: string;
  status: Status;
  facts: { k: string; v: string }[];
  teaser: string;
  quelle: string;
};

const OBJEKTE: Objekt[] = [
  {
    id: "A-2288",
    name: "Villa Seeblick",
    ort: "Am Ostufer des Tegernsees",
    region: "TEGERNSEE · OBERBAYERN",
    preis: "€ 14.800.000",
    status: "IN REVIEW",
    quelle: "GENERIERT VON IMMONEXUS",
    facts: [
      { k: "Wohnfläche", v: "640 m²" },
      { k: "Grundstück", v: "2.400 m²" },
      { k: "Zimmer", v: "9 · 5 SZ" },
      { k: "Baujahr", v: "2021" },
      { k: "Energie", v: "A+ · 28 kWh" },
      { k: "Seezugang", v: "42 m privat" },
    ],
    teaser:
      "Eingebettet in alten Baumbestand, mit 42 Metern eigenem Seeufer — ein Rückzugsort, wie ihn der Tegernsee nur selten freigibt.",
  },
  {
    id: "A-2261",
    name: "Rittergut Seifersdorf",
    ort: "Denkmal-Investment · Dresden / TSMC-Region",
    region: "SACHSEN · DENKMAL-AfA",
    preis: "€ 8.900.000",
    status: "PUBLIZIERT",
    quelle: "GENERIERT VON IMMONEXUS",
    facts: [
      { k: "Wohnfläche", v: "1.180 m²" },
      { k: "Einheiten", v: "7 WE" },
      { k: "Denkmal-AfA", v: "bis 90 %" },
      { k: "Baujahr", v: "1728" },
      { k: "Rendite", v: "3,8 % p.a." },
      { k: "Lage", v: "Halbleiter-Boom" },
    ],
    teaser:
      "Barockes Rittergut mit Denkmal-AfA — Kapitalanlage im Sog des Dresdner Halbleiter-Aufschwungs.",
  },
  {
    id: "A-2304",
    name: "Stadtpalais Leipzig",
    ort: "Gründerzeit · Musikviertel",
    region: "LEIPZIG · SACHSEN",
    preis: "€ 6.400.000",
    status: "ENTWURF",
    quelle: "GENERIERT VON IMMONEXUS",
    facts: [
      { k: "Wohnfläche", v: "820 m²" },
      { k: "Einheiten", v: "5 WE" },
      { k: "Etagen", v: "4 + DG" },
      { k: "Baujahr", v: "1897" },
      { k: "Zustand", v: "Kernsaniert" },
      { k: "Stellplätze", v: "6 TG" },
    ],
    teaser:
      "Repräsentatives Gründerzeit-Palais im Musikviertel — kernsaniert, voll vermietet, prestigeträchtige Adresse.",
  },
];

const STATUS_COLOR: Record<Status, string> = {
  "IN REVIEW": "var(--gp-amber)",
  PUBLIZIERT: "var(--gp-emerald)",
  ENTWURF: "var(--gp-ink-3)",
};

const KAMPAGNE = [
  { agent: "SCRIBE", task: "Exposé-Text + Objekt-Storytelling" },
  { agent: "ORACLE", task: "Standort-Dossier (Lage, Marktdaten, Rendite)" },
  { agent: "PUBLISHER", task: "Publikation steinadel.de + SEO" },
  { agent: "AMPLIFIER", task: "Distribution (Social, Investoren-Verteiler)" },
];

export default function ExposePage() {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="boot p-10 max-w-[1280px]">
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
        <span className="inline-flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse-subtle" style={{ background: "var(--gp-emerald)" }} />
          <span className="mono-label" style={{ color: "var(--gp-emerald)" }}>HubSpot synchron</span>
        </span>
        <span className="mono-label">steinadel.de · {OBJEKTE.length} Objekte</span>
        <span className="ml-auto mono-label" style={{ color: "var(--gp-ink-3)" }}>Quelle: ImmoNexus (read-only)</span>
      </div>

      {/* Objekt-Akten */}
      <div className="space-y-5">
        {OBJEKTE.map((o) => {
          const open = openId === o.id;
          return (
            <div key={o.id} className="card-ghost overflow-hidden">
              <div className="flex flex-col lg:flex-row">
                {/* Objektfoto-Feld (Platzhalter) */}
                <div
                  className="lg:w-[280px] shrink-0 relative min-h-[150px]"
                  style={{
                    background:
                      "radial-gradient(120% 120% at 30% 20%, rgba(201,168,106,0.12), rgba(6,9,11,0.6) 60%), #070809",
                    borderRight: "1px solid var(--gp-hairline)",
                  }}
                >
                  <span className="absolute top-3 left-3 mono-label" style={{ color: "var(--gp-ink-3)" }}>{o.region}</span>
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
                      style={{ border: `0.8px solid ${STATUS_COLOR[o.status]}55` }}
                    >
                      <span className="w-1 h-1 rounded-full" style={{ background: STATUS_COLOR[o.status] }} />
                      <span className="mono-label" style={{ color: STATUS_COLOR[o.status] }}>{o.status}</span>
                    </span>
                    <span className="mono-label">Exposé · #{o.id} · {o.quelle}</span>
                  </div>
                  <h2 className="font-[family-name:var(--font-cormorant)] font-semibold text-[30px] leading-none" style={{ color: "var(--gp-ink)" }}>
                    {o.name}
                  </h2>
                  <p className="text-[13px] mt-1.5" style={{ color: "var(--gp-ink-2)" }}>{o.ort}</p>
                  <p className="font-[family-name:var(--font-cormorant)] text-[24px] mt-2" style={{ color: "var(--gp-gold-hi)" }}>
                    {o.preis} <span className="text-[11px] font-[family-name:var(--font-jbmono)]" style={{ color: "var(--gp-emerald)" }}>✓ Richtwert bestätigt</span>
                  </p>

                  {/* Fakten-Grid */}
                  <div className="grid grid-cols-3 gap-x-6 gap-y-3 mt-4">
                    {o.facts.map((f) => (
                      <div key={f.k}>
                        <div className="font-[family-name:var(--font-jbmono)] text-[13px]" style={{ color: "var(--gp-ink)" }}>{f.v}</div>
                        <div className="mono-label mt-0.5">{f.k}</div>
                      </div>
                    ))}
                  </div>

                  <p className="text-[12.5px] leading-relaxed mt-4 italic" style={{ color: "var(--gp-ink-2)", fontFamily: "var(--font-cormorant)", fontSize: 15 }}>
                    „{o.teaser}"
                  </p>

                  <button
                    onClick={() => setOpenId(open ? null : o.id)}
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
    </div>
  );
}
