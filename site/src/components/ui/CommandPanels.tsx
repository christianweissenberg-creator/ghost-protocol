"use client";

// Command-Center-Panels — Stufe 1 (05.11.2026).
// Ersetzt Neural Core, System-Telemetrie und "Die Engines": Die alten Kacheln zeigten
// fest eingetragene Werte ohne Messung und zwei Engines ohne Bezug zu Ghost Protocol.
// Jetzt kommt jede Zahl aus /api/freigaben, /api/status oder /api/objekte und trägt Quelle,
// Hinweis und Messzeit im title-Attribut. Was nicht gemessen ist, steht als "nicht gemessen"
// da — nie als 0. Die Formatierer liegen in lib/types.ts (auch von der TopBar genutzt).
// Fixrunde 06.11.2026: COUNSEL-Badge grün nur, wenn der Freigabetext der geprüfte ist (R2,
// Anzeige; welcher Text freigegeben wird, entscheidet der Inhaber), Sperrgrund des Servers
// sichtbar, Link direkt auf die Freigabe-Liste (R38), Kosten mit "≥" bei unvollständigem
// Zeitraum und Planungsanteil (R20). Status und Objekte kommen aus je einem Abruf der Seite
// bzw. der Shell (R28). Texte aus Antworten zeigen den geschützten Namen nicht.
// Nachprüfung 06.11.2026: Badges brechen um statt aus der Karte zu ragen; der R2-Hinweis steht
// in zwei kurzen Badges. Ein 401 heißt in allen Panels bernstein "nicht angemeldet" wie in der
// TopBar, nicht rot "nicht lesbar" oder "Quelle nicht erreichbar". "≥" vor "Läufe im Monat"
// nur, wenn der Server die Gesamtzahl nicht kennt.
// Gesamtprüfung 06.11.2026: Nach einem Abruffehler zeigt der Kostenblock nichts mehr aus der
// alten Messung (Statuspunkt, Hinweis, Messzeit) — wie Command Center und TopBar. Untergrenzen
// ("≥") werden abgerundet (formatiereUsdUntergrenze), nie über der gemessenen Summe.
// Stufe 2 (07.11.2026, Totmann): Die Zeile „Crons" zeigt den Plan aus lib/totmann.ts gegen
// lauf_nachweis (Text: cronsAnzeige in lib/types.ts), Textfarbe = Farbe des schlechtesten Jobs.

import Link from "next/link";
import { useObjekte } from "@/lib/hooks";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import {
  istNichtAngemeldet,
  kostenLuecke,
  kostenZeitraum,
  laeufeMonatUntergrenze,
  objekteFehlerAnzeige,
  objekteLesungAus,
  objekteLesungFehlerArt,
  useFreigaben,
  useSystemStatus,
  type KostenZeitraum,
  type ObjekteLesung,
  type SystemStatusLesung,
} from "@/lib/hooks-status";
import type { CounselUrteil, FreigabeEintrag, Messwert, SystemStatus } from "@/lib/status-types";
import {
  cronsAnzeige,
  cronsFeld,
  datumZeit,
  formatiereUsd,
  formatiereUsdUntergrenze,
  formatiereZahl,
  messfeld,
  messTitel,
  statusFarbe,
  statusText,
  uhrzeit,
  vorZeit,
} from "@/lib/types";

const EINE_STELLE = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ── Bausteine ──

type Ton = "emerald" | "amber" | "rose";

// Randfarben als rgba der Token-Farben: an eine var(--gp-…) lässt sich kein Alpha anhängen.
const TON: Record<Ton, { farbe: string; rand: string }> = {
  emerald: { farbe: "var(--gp-emerald)", rand: "rgba(34, 197, 94, 0.35)" },
  amber: { farbe: "var(--gp-amber)", rand: "rgba(245, 158, 11, 0.38)" },
  rose: { farbe: "var(--gp-rose)", rand: "rgba(255, 77, 106, 0.4)" },
};

const URTEIL_TON: Record<CounselUrteil, Ton> = {
  FREIGABE: "emerald",
  ABLEHNUNG: "rose",
  UNKLAR: "amber",
};

// Ein Badge ist höchstens so breit wie seine Zeile. Passt der Text nicht, bricht er im Badge um,
// statt in die Nachbarkarte zu ragen oder die Seite waagerecht scrollen zu lassen (Nachprüfung
// 06.11.2026: mit whitespace-nowrap ragte ein 56-Zeichen-Badge 22–178 px aus der Karte).
function Badge({ text, ton, title }: { text: string; ton: Ton; title?: string }) {
  const t = TON[ton];
  return (
    <span
      title={title}
      className="inline-flex items-center max-w-full px-1.5 py-px rounded break-words font-[family-name:var(--font-jbmono)] text-[9px] tracking-[0.12em] uppercase"
      style={{ color: t.farbe, border: `0.8px solid ${t.rand}` }}
    >
      {text}
    </span>
  );
}

function PanelHead({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="gp-index" style={{ fontSize: 13 }}>{index}</span>
      <h3 className="mono-label" style={{ color: "var(--gp-ink-2)" }}>{title}</h3>
    </div>
  );
}

function Hinweis({ children, farbe = "var(--gp-ink-3)" }: { children: React.ReactNode; farbe?: string }) {
  return (
    <p className="font-[family-name:var(--font-jbmono)] text-[10px] leading-relaxed break-words" style={{ color: farbe }}>
      {children}
    </p>
  );
}

// ── Freigaben: Was wartet auf den Inhaber? ──

interface BadgeDaten {
  text: string;
  ton: Ton;
  title: string;
}

/**
 * COUNSEL-Badges einer Zeile in Anzeigereihenfolge (R2, Anzeige). Grün nur, wenn COUNSEL
 * FREIGABE sagt UND der Server meldet, dass der Freigabetext der geprüfte ist
 * (geprueft_ungleich_freigabe === false). Sonst bernstein, und ein eigenes Badge davor sagt, was
 * mit dem Freigabetext ist: "Freigabetext ungeprüft" (weicht von der geprüften Fassung ab) bzw.
 * "Fassung unbestätigt" (Angabe fehlt). Zwei kurze Badges statt eines langen, damit jedes in
 * die Karte passt. Welcher Text freigegeben wird, entscheidet der Inhaber (offen).
 */
function counselBadges(e: FreigabeEintrag): BadgeDaten[] {
  const urteil: CounselUrteil = e.counsel?.urteil ?? "UNKLAR";
  const zeile = e.counsel?.zeile ? maskiereGeschuetzteNamen(e.counsel.zeile) : "keine gefunden";
  const herkunft = `Aus review_notes abgeleitet, kein gespeichertes Urteil.\nURTEIL-Zeile: ${zeile}`;
  const offen = "Welcher Text freigegeben wird, entscheidet der Inhaber (offen).";
  const abweichung = e.geprueft_ungleich_freigabe;
  if (urteil === "FREIGABE" && abweichung === true) {
    return [
      {
        text: "Freigabetext ungeprüft",
        ton: "amber",
        title: `Der Freigabetext weicht von der Fassung ab, die COUNSEL geprüft hat (SCRIBE, metadata.steps[1]).\n${offen}`,
      },
      {
        text: "COUNSEL: Vorfassung freigegeben",
        ton: "amber",
        title: `Das FREIGABE-Urteil gilt für die geprüfte Fassung, nicht für den Freigabetext.\n${offen}\n${herkunft}`,
      },
    ];
  }
  if (urteil === "FREIGABE" && abweichung !== false) {
    return [
      {
        text: "Fassung unbestätigt",
        ton: "amber",
        title: `Der Server meldet nicht, ob der Freigabetext die geprüfte Fassung ist.\n${offen}`,
      },
      {
        text: "COUNSEL FREIGABE · abgeleitet",
        ton: "amber",
        title: `Das FREIGABE-Urteil ist nur für die Fassung belegt, die COUNSEL geprüft hat.\n${herkunft}`,
      },
    ];
  }
  const badges: BadgeDaten[] = [];
  if (abweichung === true) {
    badges.push({
      text: "Geprüft ≠ Freigabe-Text",
      ton: "amber",
      title: "Der Text zur Freigabe weicht von dem Text ab, den COUNSEL geprüft hat.",
    });
  }
  badges.push({ text: `COUNSEL ${urteil} · abgeleitet`, ton: URTEIL_TON[urteil] ?? "amber", title: herkunft });
  return badges;
}

function FreigabeZeile({ e }: { e: FreigabeEintrag }) {
  const titel = maskiereGeschuetzteNamen(e.title?.trim() || "ohne Titel");
  const alter = Number.isFinite(e.alter_stunden) ? `seit ${EINE_STELLE.format(e.alter_stunden)} h` : "Alter unbekannt";
  const badges = counselBadges(e);
  // Sperrgrund aus pruefeFreigabe() auf dem Server; null = serverseitig freigebbar.
  const sperre =
    typeof e.freigabe_sperre === "string" && e.freigabe_sperre.trim() !== ""
      ? maskiereGeschuetzteNamen(e.freigabe_sperre.trim())
      : null;
  return (
    <li className="py-2" style={{ borderTop: "1px solid var(--gp-hairline)" }}>
      <div className="flex items-baseline gap-3">
        <span className="text-[12.5px] truncate" style={{ color: "var(--gp-ink)" }} title={titel}>
          {titel}
        </span>
        <span
          className="ml-auto shrink-0 font-[family-name:var(--font-jbmono)] text-[10px]"
          style={{ color: "var(--gp-ink-3)" }}
          title="Stunden seit der letzten Änderung (ersatzweise seit Anlage), vom Server berechnet"
        >
          {alter}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-1">
        <span className="mono-label" style={{ fontSize: 9 }}>{e.platform ?? "ohne Plattform"}</span>
        {e.text_leer && <Badge text="Text leer" ton="rose" title="Der Freigabe-Text ist leer oder nur Leerraum." />}
        {badges.map((b) => (
          <Badge key={b.text} text={b.text} ton={b.ton} title={b.title} />
        ))}
      </div>
      {sperre && (
        <p
          className="font-[family-name:var(--font-jbmono)] text-[10px] leading-relaxed mt-1 break-words"
          style={{ color: "var(--gp-rose)" }}
          title="Sperrgrund des Servers (pruefeFreigabe)"
        >
          Freigabe gesperrt: {sperre}
        </p>
      )}
    </li>
  );
}

export function FreigabePanel() {
  const lesung = useFreigaben();
  const { freigaben, fehler, loading } = lesung;
  // Lesefehler aus dem Abruf (HTTP) oder vom Server gemeldet: Die Nullen in der Antwort
  // heißen dann "nicht lesbar", nicht "leer" (Vertrag status-types.ts).
  const formFehler =
    freigaben && typeof freigaben.wartend_gesamt !== "number" ? "Antwort ohne wartend_gesamt" : null;
  const lesefehler = fehler ?? freigaben?.fehler ?? formFehler;
  const ohneSitzung = istNichtAngemeldet(lesung);
  const daten = lesefehler ? null : freigaben;
  const gesamt = daten?.wartend_gesamt ?? 0;
  const sichtbar = (daten?.wartend ?? []).slice(0, 4);
  const weitere = Math.max(gesamt - sichtbar.length, 0);
  const haengend = daten?.haengend_gesamt;

  return (
    <div className="card-ghost p-5 flex flex-col">
      <PanelHead index="◇" title="Wartet auf dich" />

      {lesefehler ? (
        <div>
          <div
            className="font-[family-name:var(--font-cormorant)] font-semibold text-[26px] leading-none"
            style={{ color: ohneSitzung ? "var(--gp-amber)" : "var(--gp-rose)" }}
          >
            {ohneSitzung ? "nicht angemeldet" : "nicht lesbar"}
          </div>
          <div className="mt-2">
            <Hinweis>
              {ohneSitzung
                ? "Nicht angemeldet (HTTP 401): Der Freigabe-Stapel ist erst nach der Anmeldung lesbar."
                : maskiereGeschuetzteNamen(lesefehler)}
            </Hinweis>
          </div>
        </div>
      ) : !daten ? (
        <p className="mono-label">{loading ? "lädt …" : "nicht lesbar"}</p>
      ) : (
        <>
          <div
            className="flex items-baseline gap-3"
            title={maskiereGeschuetzteNamen(`Quelle: ${daten.quelle}\nStand: ${datumZeit(daten.erzeugt_am) ?? "unbekannt"}`)}
          >
            <span className="font-[family-name:var(--font-cormorant)] font-semibold text-[44px] leading-none" style={{ color: "var(--gp-gold-hi)" }}>
              {formatiereZahl(gesamt)}
            </span>
            <span className="mono-label">zur Freigabe</span>
          </div>

          {gesamt === 0 ? (
            <p className="text-[12.5px] mt-3" style={{ color: "var(--gp-ink-2)" }}>Nichts wartet auf dich.</p>
          ) : (
            <ul className="mt-3">
              {sichtbar.map((e) => (
                <FreigabeZeile key={e.id} e={e} />
              ))}
            </ul>
          )}
          {weitere > 0 && (
            <p className="mono-label mt-1" style={{ fontSize: 9 }}>+{formatiereZahl(weitere)} weitere</p>
          )}

          <p
            className="font-[family-name:var(--font-jbmono)] text-[11px] mt-3"
            style={{ color: typeof haengend === "number" && haengend > 0 ? "var(--gp-amber)" : "var(--gp-ink-2)" }}
            title="Entwurf oder COUNSEL-geprüft, seit mehr als 2 Stunden ohne Änderung"
          >
            Hängen ohne Fortschritt: {typeof haengend === "number" ? formatiereZahl(haengend) : "nicht gemessen"}
          </p>
        </>
      )}

      <Link href="/content?tab=content" className="mt-auto pt-4 text-[12px]" style={{ color: "var(--gp-gold-hi)" }}>
        Zur Freigabe-Ansicht →
      </Link>
    </div>
  );
}

// ── Systemzustand: je Messfeld eine Zeile ──

type StatusLesung = SystemStatusLesung;

interface Zustandszeile {
  key: string;
  label: string;
  m: Messwert<unknown>;
  /** Wert-Text; null, wenn kein Wert vorliegt — dann wird der Status ausgeschrieben. */
  text: string | null;
  /** Ersatz für "nicht gemessen", wenn das Feld grundsätzlich nicht messbar ist. */
  leer?: string;
  zusatz?: string;
  /** Farbe des Wert-Texts, wenn sie dem Status folgen soll (Crons); sonst Gold für Werte. */
  textFarbe?: string;
}

function anzahlText(n: number, eins: string, mehr: string): string {
  return `${formatiereZahl(n)} ${n === 1 ? eins : mehr}`;
}

function zustandszeilen(s: SystemStatus): Zustandszeile[] {
  const supabase = messfeld(s.supabase, "supabase");
  const exportApi = messfeld(s.steinadel_export, "steinadel_export");
  const anthropic = messfeld(s.anthropic, "anthropic");
  const aktivierung = messfeld(s.letzte_aktivierung, "letzte_aktivierung");
  const aktiv = messfeld(s.aktive_agenten_24h, "aktive_agenten_24h");
  const content = messfeld(s.content_heute, "content_heute");
  // Gegencheck 06.11.2026 (B20): /api/status misst hängende und gescheiterte Läufe seit Stufe 1,
  // gezeigt wurde das nirgends. Wartende stehen im Panel "Wartet auf dich" und nur im Titel.
  const freigabe = messfeld(s.freigabe, "freigabe");
  // Totmann (Stufe 2, §2.4): Text aus vorZeit/datumZeit (cronsAnzeige in lib/types.ts), Farbe des
  // schlechtesten Jobs; der title nennt je Job Plan-Fundstelle, letzten Lauf und Teilergebnisse.
  // Alte Antworten (wert null) zeigen weiter "nicht gemessen".
  const crons = cronsFeld(s.crons);
  const cronsZeile = cronsAnzeige(crons, s.erzeugt_am);
  return [
    {
      key: "supabase",
      label: "Supabase",
      m: supabase,
      text: supabase.wert ? `${formatiereZahl(supabase.wert.latenz_ms)} ms` : null,
    },
    {
      key: "steinadel_export",
      label: "Steinadel-Export",
      m: exportApi,
      text: exportApi.wert
        ? `${anzahlText(exportApi.wert.objekte, "Objekt", "Objekte")} · ${formatiereZahl(exportApi.wert.latenz_ms)} ms`
        : null,
    },
    {
      key: "anthropic",
      label: "Anthropic",
      m: anthropic,
      text: anthropic.wert ? (anthropic.wert.konfiguriert ? "konfiguriert" : "nicht konfiguriert") : null,
    },
    {
      key: "letzte_aktivierung",
      label: "Letzte Aktivierung",
      m: aktivierung,
      text: aktivierung.wert ? `${vorZeit(aktivierung.wert.am, s.erzeugt_am)} · ${aktivierung.wert.agent}` : null,
      zusatz: aktivierung.wert ? `Zeitpunkt: ${datumZeit(aktivierung.wert.am) ?? "unlesbar"}` : undefined,
    },
    {
      key: "aktive_agenten_24h",
      label: "Aktiv in 24 h",
      m: aktiv,
      text: aktiv.wert ? anzahlText(aktiv.wert.anzahl, "Agent", "Agenten") : null,
      zusatz: aktiv.wert?.agenten?.length ? `Agenten: ${aktiv.wert.agenten.join(", ")}` : undefined,
    },
    {
      key: "content_heute",
      label: "Content heute",
      m: content,
      text: content.wert ? anzahlText(content.wert.anzahl, "Eintrag", "Einträge") : null,
    },
    {
      key: "freigabe",
      label: "Pipeline",
      m: freigabe,
      text: freigabe.wert
        ? `${formatiereZahl(freigabe.wert.haengend)} hängend · ${formatiereZahl(freigabe.wert.fehler_7_tage)} Fehler (7 T)`
        : null,
      zusatz: freigabe.wert
        ? `Wartend auf Freigabe: ${formatiereZahl(freigabe.wert.wartend)} · hängend = Entwurf oder COUNSEL-geprüft, seit mehr als 2 h ohne Änderung · Fehler = Status fehler, angelegt in den letzten 7 Tagen`
        : undefined,
    },
    {
      key: "crons",
      label: "Crons",
      m: crons,
      text: cronsZeile.text === null ? null : maskiereGeschuetzteNamen(cronsZeile.text),
      zusatz: cronsZeile.zusatz,
      textFarbe: cronsZeile.text === null || crons.status === "ok" ? undefined : statusFarbe(crons.status),
    },
    { key: "posting_riegel", label: "Posting-Riegel", m: messfeld(s.posting_riegel, "posting_riegel"), text: null, leer: "nicht messbar" },
    { key: "telegram", label: "Telegram", m: messfeld(s.telegram, "telegram"), text: null },
  ];
}

function ZustandsZeile({ z }: { z: Zustandszeile }) {
  const hatWert = z.text !== null;
  const farbeText = z.textFarbe ?? (hatWert ? "var(--gp-gold-hi)" : z.m.status === "fehler" ? "var(--gp-rose)" : "var(--gp-ink-3)");
  return (
    <div className="flex items-center gap-2.5" title={maskiereGeschuetzteNamen(messTitel(z.m, z.zusatz))}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusFarbe(z.m.status) }} />
      <span className="text-[12px]" style={{ color: "var(--gp-ink-2)" }}>{z.label}</span>
      <span className="ml-auto min-w-0 text-right break-words font-[family-name:var(--font-jbmono)] text-[11px]" style={{ color: farbeText }}>
        {z.text ?? statusText(z.m.status, z.leer)}
      </span>
    </div>
  );
}

function SystemzustandAnsicht({ lesung }: { lesung: StatusLesung }) {
  const { status, fehler, loading } = lesung;
  const ohneSitzung = istNichtAngemeldet(lesung);
  const fehlerFarbe = ohneSitzung ? "var(--gp-amber)" : "var(--gp-rose)";
  const messzeit = status ? uhrzeit(status.erzeugt_am) : null;
  const fuss = fehler
    ? ohneSitzung
      ? "nicht angemeldet"
      : "nicht lesbar"
    : status
      ? messzeit
        ? `gemessen um ${messzeit}`
        : "Messzeit unlesbar"
      : loading
        ? "lädt …"
        : "nicht lesbar";

  return (
    <div className="card-ghost p-5 flex flex-col">
      <PanelHead index="◈" title="Systemzustand" />
      {fehler ? (
        <Hinweis farbe={fehlerFarbe}>
          {ohneSitzung
            ? "Nicht angemeldet (HTTP 401): Der Systemzustand ist erst nach der Anmeldung lesbar, gemessen ist nichts."
            : `Systemzustand nicht lesbar: ${fehler}`}
        </Hinweis>
      ) : !status ? (
        <p className="mono-label">{loading ? "lädt …" : "nicht lesbar"}</p>
      ) : (
        <div className="space-y-2">
          {zustandszeilen(status).map((z) => (
            <ZustandsZeile key={z.key} z={z} />
          ))}
        </div>
      )}
      <p className="mono-label mt-auto pt-4" style={{ fontSize: 9, color: fehler ? fehlerFarbe : "var(--gp-ink-3)" }}>
        {fuss}
      </p>
    </div>
  );
}

function SystemzustandMitAbruf() {
  const lesung = useSystemStatus();
  return <SystemzustandAnsicht lesung={lesung} />;
}

/** Ohne Prop liest das Panel den Abruf der Shell (useSystemStatus, kein eigener Poller unter
 *  dem SystemStatusProvider); das Command Center reicht dieselbe Lesung durch. */
export function SystemzustandPanel({ lesung }: { lesung?: StatusLesung }) {
  return lesung ? <SystemzustandAnsicht lesung={lesung} /> : <SystemzustandMitAbruf />;
}

// ── Steinadel: Objekte aus dem Export, Kosten der Agenten-Läufe (geschätzt) ──

function KostenZeile({ label, wert, title }: { label: string; wert: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={title}>
      <span className="text-[12px]" style={{ color: "var(--gp-ink-2)" }}>{label}</span>
      <span className="font-[family-name:var(--font-jbmono)] text-[12px] text-right" style={{ color: "var(--gp-gold-hi)" }}>{wert}</span>
    </div>
  );
}

/** "≥ " vor jedem Betrag eines unvollständigen Zeitraums: Die Summe ist eine Untergrenze (R20),
 *  abgerundet statt gerundet (Gesamtprüfung 06.11.2026). */
function betrag(z: KostenZeitraum, usd: number): string {
  return z.vollstaendig ? formatiereUsd(usd) : formatiereUsdUntergrenze(usd);
}

function planungText(z: KostenZeitraum): string {
  return z.planungUsd === null ? "nicht gemeldet" : betrag(z, z.planungUsd);
}

function KostenBlock({ lesung }: { lesung: StatusLesung }) {
  const { status, fehler, loading } = lesung;
  // Bei einem Abruffehler gelten alte Daten nicht (useSystemStatus behält sie): kein alter
  // Statuspunkt, Hinweis oder Messzeitpunkt neben "nicht lesbar" (Gesamtprüfung 06.11.2026).
  const kosten = status && !fehler ? messfeld(status.kosten, "kosten") : null;
  // Beträge nur aus einem lesbaren Kostenwert ("ok" oder "warnung").
  const lesbar = kosten && (kosten.status === "ok" || kosten.status === "warnung") ? kosten.wert : null;
  const heute = kostenZeitraum(lesbar, "heute");
  const monat = kostenZeitraum(lesbar, "monat");

  let inhalt: React.ReactNode;
  if (fehler && istNichtAngemeldet(lesung)) {
    inhalt = <Hinweis farbe="var(--gp-amber)">nicht angemeldet (HTTP 401): Kosten erst nach der Anmeldung lesbar</Hinweis>;
  } else if (fehler) {
    inhalt = <Hinweis farbe="var(--gp-rose)">nicht lesbar: {fehler}</Hinweis>;
  } else if (!kosten) {
    inhalt = <p className="mono-label">{loading ? "lädt …" : "nicht lesbar"}</p>;
  } else if (!lesbar || !heute || !monat) {
    inhalt = (
      <p className="font-[family-name:var(--font-jbmono)] text-[12px]" style={{ color: "var(--gp-ink-3)" }}>
        {lesbar ? "nicht lesbar" : statusText(kosten.status)}
      </p>
    );
  } else {
    // Unvollständig heißt: Läufe ohne Kostenangabe oder eine abgeschnittene Abfrage fehlen in
    // der Summe. Dann steht "≥" vor dem Betrag; der Grund steht darunter.
    const luecken = [kostenLuecke(lesbar, "heute"), kostenLuecke(lesbar, "monat")].filter(
      (l): l is string => l !== null,
    );
    // laeufe_monat ist die Gesamtzahl aus Supabase, auch bei abgeschnittener Kostenabfrage; "≥"
    // nur, wenn der Server meldet, dass die Gesamtzahl fehlte (dann zählt er geladene Zeilen).
    const laeufeUntergrenze = laeufeMonatUntergrenze(lesbar, kosten.hinweis);
    const laeufe =
      typeof lesbar.laeufe_monat === "number" && Number.isFinite(lesbar.laeufe_monat)
        ? `${laeufeUntergrenze ? "≥ " : ""}${formatiereZahl(lesbar.laeufe_monat)}`
        : "nicht gemeldet";
    const laeufeTitel = laeufeUntergrenze
      ? "Untergrenze: Supabase lieferte keine Gesamtzahl, gezählt sind nur die geladenen Läufe."
      : "Läufe im Monat mit und ohne Kostenangabe, Gesamtzahl laut Supabase.";
    inhalt = (
      <div className="space-y-1.5">
        <KostenZeile label="Heute" wert={betrag(heute, heute.usd)} />
        <KostenZeile label="Monat" wert={betrag(monat, monat.usd)} />
        <KostenZeile
          label="davon L.I.S.A.-Planung"
          wert={`${planungText(heute)} · ${planungText(monat)}`}
          title="Anteil der Planungen (heute · Monat), auch fehlgeschlagene Planungen mit Kostenangabe"
        />
        <KostenZeile label="Läufe im Monat" wert={laeufe} title={laeufeTitel} />
        {luecken.length > 0 && (
          <div className="pt-1 space-y-0.5">
            {luecken.map((l) => (
              <Hinweis key={l} farbe="var(--gp-amber)">{l}</Hinweis>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4" title={kosten ? maskiereGeschuetzteNamen(messTitel(kosten)) : undefined}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: kosten ? statusFarbe(kosten.status) : "var(--gp-ink-3)" }} />
        <span className="mono-label">Kosten (geschätzt)</span>
      </div>
      {inhalt}
      {kosten?.hinweis && (
        <div className="mt-2">
          <Hinweis>{maskiereGeschuetzteNamen(kosten.hinweis)}</Hinweis>
        </div>
      )}
    </div>
  );
}

function SteinadelAnsicht({ lesung, objekte: o }: { lesung: StatusLesung; objekte: ObjekteLesung }) {
  // 401 (keine Sitzung): Der Export wurde nicht abgefragt; das ist kein Ausfall der Quelle.
  // Nachprüfung im Browser 06.11.2026: Wortlaut je Ursache wie im Lagebild (objekteFehlerAnzeige);
  // ein fehlendes Token heißt "Zugang nicht konfiguriert", nicht "Quelle nicht erreichbar".
  const fehlerArt = objekteLesungFehlerArt(o);
  const anzeige = fehlerArt ? objekteFehlerAnzeige(fehlerArt) : null;
  const objektText = o.loading ? "SYNC…" : anzeige ? anzeige.panel : anzahlText(o.objekte.length, "Objekt", "Objekte");
  const objektFarbe = o.loading
    ? "var(--gp-ink-3)"
    : anzeige
      ? anzeige.farbe === "amber"
        ? "var(--gp-amber)"
        : "var(--gp-rose)"
      : "var(--gp-gold)";
  const objektTitel = anzeige
    ? fehlerArt === "nicht_angemeldet"
      ? anzeige.titel
      : `${anzeige.titel} Fehler: ${o.error}`
    : "Quelle: /api/objekte (Steinadel-Export, beim Laden der Seite)";

  return (
    <div className="card-ghost p-5 flex flex-col">
      <PanelHead index="▤" title="Steinadel" />
      {/* Nachprüfung im Browser 06.11.2026: Der Wert ragte bei 1024 px 21 px aus der Karte
          ("Zugang nicht konfiguriert", shrink-0). Jetzt rückt er bei Platzmangel in eine eigene
          Zeile und bricht um. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-3" style={{ borderBottom: "1px solid var(--gp-hairline)" }}>
        <div className="flex items-center gap-4 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: objektFarbe }} />
          <div className="min-w-0">
            <div className="font-[family-name:var(--font-cormorant)] font-semibold text-[19px] leading-none" style={{ color: "var(--gp-ink)" }}>
              Steinadel
            </div>
            <div className="mono-label mt-1">Backoffice · Export-API</div>
          </div>
        </div>
        <div
          className="ml-auto text-right min-w-0 max-w-full break-words font-[family-name:var(--font-jbmono)] text-[12px]"
          style={{ color: objektFarbe }}
          title={objektTitel}
        >
          {objektText}
        </div>
      </div>
      <KostenBlock lesung={lesung} />
    </div>
  );
}

/** Rückfall ohne Objekte-Prop: eigener Abruf von /api/objekte, Fehlertext bereinigt, 401 erkannt. */
function SteinadelMitObjektAbruf({ lesung }: { lesung: StatusLesung }) {
  const objekte = objekteLesungAus(useObjekte());
  return <SteinadelAnsicht lesung={lesung} objekte={objekte} />;
}

function SteinadelMitStatus({ objekte }: { objekte?: ObjekteLesung }) {
  const lesung = useSystemStatus();
  return objekte ? <SteinadelAnsicht lesung={lesung} objekte={objekte} /> : <SteinadelMitObjektAbruf lesung={lesung} />;
}

/**
 * Objekte und Kosten (geschätzt). Das Command Center reicht beides durch: dieselben Objekte wie
 * im Lagebild (ein Abruf von /api/objekte je Seite, R28) und dieselbe Status-Lesung wie die
 * TopBar. Ohne Props liest das Panel den Status der Shell und ruft die Objekte selbst ab.
 */
export function SteinadelPanel({ lesung, objekte }: { lesung?: StatusLesung; objekte?: ObjekteLesung }) {
  if (!lesung) return <SteinadelMitStatus objekte={objekte} />;
  return objekte ? <SteinadelAnsicht lesung={lesung} objekte={objekte} /> : <SteinadelMitObjektAbruf lesung={lesung} />;
}
