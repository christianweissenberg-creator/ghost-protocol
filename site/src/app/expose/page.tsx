"use client";

// Exposé-Engine — GP-Ansicht der Steinadel×GhostProtocol-Integration.
// KONZEPT: Das Steinadel Backoffice (separates Projekt/Repo) hält die
// Immobilien-Objekte. Objekte kommen READ-ONLY aus der Steinadel-Export-API über
// /api/objekte, GP schreibt NICHT ins Backoffice.
// Stufe 1 (05.11.2026): sichtbarer Name ist "Steinadel", der interne Codename erscheint
// nirgends mehr. Die Env-Variable des Export-Tokens bleibt als technischer Bezeichner.
// Stufe 1 (06.11.2026, Befund R35): Die Seite beschreibt nur, was gebaut ist. Die
// Content-Pipeline (/api/content/pipeline) bereitet Inhalte zu einem Objekt bis zur Freigabe
// vor ("zur_freigabe"); einen Schreibpfad zu steinadel.de, ein Exposé- oder Dossier-Erzeugnis
// gibt es nicht — veröffentlicht wird von Hand. Die Sync-Leiste beruht auf EINEM Abruf beim
// Laden und pulsiert deshalb nicht (Puls = wiederholte, frische Messung, vgl. TopBar).
// Gesamtprüfung 06.11.2026 (R24 einheitlich): Jeder Anzeigewert aus dem Export (Name, Slug,
// Texte, Kennzahlen, Kampagnen) erscheint maskiert wie auf /content. Ein Link (Objektseite,
// Exposé, Kampagne) wird nur gezeigt, wenn seine URL den geschützten Namen nicht enthält; sonst
// steht dort ein Hinweis statt des Links. Ob der Export den Namen enthält, ist nicht gemessen.

import { useEffect, useState } from "react";
import { enthaeltGeschuetztenNamen, maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import { objekteFehlerAnzeige, objekteFehlerArt, objektFehlerText } from "@/lib/hooks-status";
import type { ObjekteFehlerArt } from "@/lib/hooks-status";

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
  fehler_art?: string;
};

type Ladezustand = "laden" | "fehler" | "erfolg";

/** Fehler beim Laden der Objektliste: Text für die Anzeige und Ursache. */
type ExportFehler = { text: string; art: ObjekteFehlerArt };

type ExportLesung =
  | { art: "erfolg"; objekte: ObjektApi[]; generiertAm: string | null }
  | { art: "fehler"; fehler: ExportFehler };

/**
 * Antwort von /api/objekte einordnen (Gegencheck 06.11.2026). Vorher hieß jeder Fehler "QUELLE
 * NICHT LESBAR — Steinadel Export-API", auch bei 401 (keine Sitzung) und fehlendem Token, wo der
 * Export gar nicht abgefragt wurde. Jetzt dieselbe Regel wie Lagebild und Steinadel-Panel:
 * Fehlerfeld und fehler_art der Route, sonst "HTTP <Status>" (401 der Middleware).
 */
function werteExportAus(status: number, daten: unknown): ExportLesung {
  const d = typeof daten === "object" && daten !== null && !Array.isArray(daten) ? (daten as ExportResponse) : null;
  const fehlerFeld = d && typeof d.fehler === "string" && d.fehler.trim() ? d.fehler : null;
  const ok = status >= 200 && status < 300;
  if (ok && d && !fehlerFeld && Array.isArray(d.objekte)) {
    return { art: "erfolg", objekte: d.objekte, generiertAm: d.generiert_am ?? null };
  }
  if (ok && !fehlerFeld) return { art: "fehler", fehler: { text: "Antwort ohne Objektliste", art: "unbekannt" } };
  const roh = fehlerFeld ?? `HTTP ${status}`;
  const fehlerArt = d && typeof d.fehler_art === "string" ? d.fehler_art : null;
  return { art: "fehler", fehler: { text: objektFehlerText(roh), art: objekteFehlerArt(roh, fehlerArt) ?? "unbekannt" } };
}

/** Fehlerkarte: Ursache wie im Lagebild (Kopf, Erklärung) und der Fehlertext sichtbar. */
function ExportFehlerKarte({ fehler }: { fehler: ExportFehler | null }) {
  const anzeige = objekteFehlerAnzeige(fehler?.art ?? "unbekannt");
  const farbe = anzeige.farbe === "amber" ? "var(--gp-amber)" : "var(--gp-rose)";
  return (
    <div className="card-ghost px-5 py-4 space-y-1" role="status">
      <span className="mono-label" style={{ color: farbe }}>
        {anzeige.kopf} — Steinadel Export-API
      </span>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--gp-ink-3)" }}>
        {anzeige.titel}
        {fehler ? ` Fehler: ${fehler.text}` : ""}
      </p>
    </div>
  );
}

const KAMPAGNE = [
  { agent: "SCRIBE", task: "Exposé-Text + Objekt-Storytelling" },
  { agent: "ORACLE", task: "Standort-Dossier (Lage, Marktdaten, Rendite)" },
  { agent: "PUBLISHER", task: "SEO" },
  { agent: "AMPLIFIER", task: "Distribution (Social, Investoren-Verteiler)" },
];

function statusFarbe(statusBadge: string): string {
  return statusBadge === "Vermarktung" ? "var(--gp-emerald)" : "var(--gp-amber)";
}

/** Anzeigewert aus dem Export: Text, geschützter Name maskiert; fehlend → leer. */
function m(wert: unknown): string {
  return wert === null || wert === undefined ? "" : maskiereGeschuetzteNamen(String(wert));
}

/** URL aus dem Export für einen Link: nur http(s) und ohne geschützten Namen, sonst null. */
function linkZiel(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim() || enthaeltGeschuetztenNamen(url)) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function LinkOderHinweis({ url, text, className, farbe }: { url: unknown; text: string; className: string; farbe: string }) {
  const ziel = linkZiel(url);
  if (ziel) {
    return (
      <a href={ziel} target="_blank" rel="noopener" className={className} style={{ color: farbe }}>
        {text}
      </a>
    );
  }
  const mitNamen = typeof url === "string" && enthaeltGeschuetztenNamen(url);
  return (
    <span className={className} style={{ color: "var(--gp-ink-3)" }} title={mitNamen ? "Die URL enthält einen geschützten Namen und wird nicht verlinkt." : "Keine gültige http(s)-URL im Export."}>
      {text.replace(/\s*→$/, "")} ({mitNamen ? "Link gesperrt: geschützter Name" : "kein gültiger Link"})
    </span>
  );
}

export default function ExposePage() {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [zustand, setZustand] = useState<Ladezustand>("laden");
  const [objekte, setObjekte] = useState<ObjektApi[]>([]);
  const [generiertAm, setGeneriertAm] = useState<string | null>(null);
  const [abgerufenAm, setAbgerufenAm] = useState<string | null>(null);
  const [fehler, setFehler] = useState<ExportFehler | null>(null);

  useEffect(() => {
    let abgebrochen = false;

    async function laden() {
      try {
        const res = await fetch("/api/objekte", { cache: "no-store" });
        // Ohne lesbares JSON (etwa HTML eines Reverse-Proxys) zählt nur der Status.
        const daten: unknown = await res.json().catch(() => null);
        if (abgebrochen) return;

        const lesung = werteExportAus(res.status, daten);
        if (lesung.art === "fehler") {
          setFehler(lesung.fehler);
          setZustand("fehler");
          return;
        }

        setObjekte(lesung.objekte);
        setGeneriertAm(lesung.generiertAm);
        setAbgerufenAm(new Date().toISOString());
        setFehler(null);
        setZustand("erfolg");
      } catch (e) {
        if (abgebrochen) return;
        setFehler({ text: objektFehlerText(e instanceof Error ? e.message : "unbekannter Fehler"), art: "unbekannt" });
        setZustand("fehler");
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
          <span className="mono-label" style={{ color: "var(--gp-gold)" }}>STEINADEL BACKOFFICE · STEINADEL.DE</span>
        </div>
        {/* Stufe 1 (05.11.2026): "— Engine aktiv" entfernt, der Zustand wird nicht gemessen. */}
        <p className="gp-kicker">Steinadel · Exposé-Engine</p>
        <h1 className="gp-wordmark">Stein<em>adel</em></h1>
        <p className="gp-sub">
          Objekte kommen aus dem Steinadel Backoffice. Ghost Protocol bereitet Inhalte zu einem Objekt
          in der Content-Pipeline bis zur Freigabe vor — veröffentlicht wird von Hand.
        </p>
      </div>

      {/* Sync-Leiste */}
      <div className="card-ghost flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 mb-8">
        {zustand === "erfolg" ? (
          <>
            {/* Ein Abruf beim Laden, keine wiederholte Messung: Punkt ohne Puls, mit Abrufzeit. */}
            <span
              className="inline-flex items-center gap-2"
              title={`Einmaliger Abruf beim Laden der Seite${abgerufenAm ? ` um ${new Date(abgerufenAm).toLocaleTimeString("de-DE", { hour12: false })}` : ""}; wird nicht wiederholt.`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--gp-emerald)" }} />
              <span className="mono-label" style={{ color: "var(--gp-emerald)" }}>steinadel.de · {objekte.length} Objekte</span>
            </span>
            {abgerufenAm && (
              <span className="mono-label" style={{ color: "var(--gp-ink-3)" }}>
                abgerufen {new Date(abgerufenAm).toLocaleTimeString("de-DE", { hour12: false })}
              </span>
            )}
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

      {/* Fehlerzustand: Ursache wie im Lagebild (Gegencheck 06.11.2026) */}
      {zustand === "fehler" && <ExportFehlerKarte fehler={fehler} />}

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
                      {m(o.ort).toUpperCase()}
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
                        <span className="mono-label" style={{ color: statusFarbe(o.statusBadge) }}>{m(o.statusBadge)}</span>
                      </span>
                      <span className="mono-label">Exposé · {m(o.slug)}</span>
                    </div>
                    <h2 className="font-[family-name:var(--font-cormorant)] font-semibold text-[30px] leading-none" style={{ color: "var(--gp-ink)" }}>
                      {m(o.name)}
                    </h2>
                    <p className="text-[13px] mt-1.5" style={{ color: "var(--gp-ink-2)" }}>{m(o.untertitel)}</p>
                    <p className="text-[13px] mt-0.5" style={{ color: "var(--gp-ink-2)" }}>{m(o.ort)}</p>
                    {o.tagline && (
                      <p className="text-[12.5px] italic mt-1" style={{ color: "var(--gp-ink-3)" }}>
                        {m(o.tagline)}
                      </p>
                    )}
                    <p className="font-[family-name:var(--font-cormorant)] text-[24px] mt-2" style={{ color: "var(--gp-gold-hi)" }}>
                      {m(o.preis)}
                    </p>

                    {/* Fakten-Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 mt-4">
                      {o.kennzahlen.map((f, i) => (
                        <div key={`${i}-${f.label}`}>
                          <div className="font-[family-name:var(--font-jbmono)] text-[13px]" style={{ color: "var(--gp-ink)" }}>{m(f.wert)}</div>
                          <div className="mono-label mt-0.5">{m(f.label)}</div>
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
                      „{m(o.kurzbeschreibung)}“
                    </p>

                    {/* Links */}
                    <div className="flex items-center gap-4 mt-4">
                      <LinkOderHinweis url={o.urls?.objektSeite} text="Objektseite →" className="text-[12px]" farbe="var(--gp-gold-hi)" />
                      <LinkOderHinweis url={o.urls?.expose} text="Exposé →" className="text-[12px]" farbe="var(--gp-gold-hi)" />
                    </div>

                    {/* Kampagnen (falls vorhanden) */}
                    {o.kampagnen && o.kampagnen.length > 0 && (
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        {o.kampagnen.map((k, i) => (
                          <LinkOderHinweis
                            key={`${i}-${k.kampagne}`}
                            url={k.lpUrl}
                            text={`${m(k.kampagne)} (${m(k.lpVariant)}) →`}
                            className="mono-label"
                            farbe="var(--gp-cyan)"
                          />
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
                      {/* Stufe 1 (05.11.2026): Der Knopf zeigt nur die feste Vorlage unten und
                          beauftragt nichts — "beauftragen" hätte eine Aktion behauptet. */}
                      {open ? "Ablauf schließen" : "Kampagnen-Ablauf ansehen →"}
                    </button>

                    {open && (
                      <div className="mt-4 pt-4 space-y-2" style={{ borderTop: "1px solid var(--gp-hairline)" }}>
                        <p className="mono-label mb-2">Kampagnen-Ablauf (Vorlage) → Agent-Team</p>
                        {KAMPAGNE.map((s, i) => (
                          <div key={s.agent} className="flex items-start gap-2 text-[12px]">
                            <span className="font-[family-name:var(--font-jbmono)] text-[10px] min-w-[16px]" style={{ color: "var(--gp-gold)" }}>P{i + 1}</span>
                            <span className="font-[family-name:var(--font-jbmono)] text-[10px] min-w-[74px]" style={{ color: "var(--gp-cyan)" }}>{s.agent}</span>
                            <span style={{ color: "var(--gp-ink-2)" }}>{s.task}</span>
                          </div>
                        ))}
                        {/* Stufe 1 (05.11.2026): Die frühere Kostenangabe hatte keine Quelle — keine Schätzung ohne Rechnung. */}
                        <p className="mono-label pt-2" style={{ color: "var(--gp-ink-3)" }}>
                          Nicht beauftragt · Freigabe durch dich · veröffentlicht wird von Hand · Kosten: nicht gemessen
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
