// Ansicht des Objekt-Studios (Schritt 2, 08.11.2026).
//
// Zeigt die Antwort von GET /api/studio/[objekt]: Objektkopf aus dem Steinadel-Export, Kennzahlen
// (Assets, Claude-Kosten in USD), die Asset-Liste mit derselben Beleg-Kette wie /content und die
// Regeln, die mitlaufen. Seit Schritt 6 (10.11.2026) dazu das Anker-Panel (components/studio/
// AnkerPanel.tsx) mit eigener Prüfung über GET /api/studio/[objekt]/anker. Seit Schritt 7 (10.11.2026)
// Kacheln für Higgsfield-Credits (getrennt von USD) und Messplan sowie das Medien-Panel
// (components/studio/MedienPanel.tsx): Videos je Kette und „Video einspielen“ mit Prüflauf und Bestätigung.
// Kein Knopf postet oder gibt frei: Freigegeben wird im Content-Tab; die Beleg-Kette kopiert auf Wunsch den
// CTA-Link (wie auf /content), „Alle prüfen“ im Anker-Panel prüft die Anker neu (ohne bezahlte Aufrufe). Einen
// bezahlten Lauf startet nur „Text erzeugen“ im Medien-Panel, nach Bestätigung (Caption zu einem Video, Pipeline mit
// Claude; Nachtrag d2-text-erzeugen-6). Die Stand-Zeile nennt, wann die Daten geladen wurden; „neu laden“ liest sie
// einmal neu (kein Takt, siehe app/studio/[objekt]/page.tsx).
// Jeder Text aus Export und Datenbank erscheint maskiert (der Server maskiert schon, die Ansicht
// noch einmal). Jede Zahl trägt im title Quelle und Messzeitpunkt.
// Zeitangaben des Studios stehen in Europe/Berlin mit Zonenangabe (wie die Zählung des Servers in
// lib/studio/lesen.ts), unabhängig von der Zeitzone des Browsers. Die Beleg-Kette ist mit /content
// geteilt und bleibt unverändert; sie zeigt Zeiten in der Zeitzone des Browsers (Vermerk an der Liste).

import Link from "next/link";
import type { ReactNode } from "react";
import { objekteFehlerAnzeige, objektFehlerText } from "@/lib/hooks-status";
import type { ObjekteFehlerArt } from "@/lib/hooks-status";
import { berlinDatumZeit, formatiereUsd4, formatiereUsdUntergrenze } from "@/lib/types";
import { nochNichtGebautText } from "@/lib/studio/objekte";
import { STUDIO_REGELN } from "@/lib/studio/regeln";
import type { MessplanStand } from "@/lib/studio/messplan";
import type {
  AssetKosten,
  ObjektKopf,
  StudioAntwort,
  StudioAsset,
  StudioAssetsTeil,
  StudioKosten,
  StudioMedienWert,
  StudioMesswert,
  StudioStatus,
} from "@/lib/studio/typen";
import { AnkerPanel } from "@/components/studio/AnkerPanel";
import { BelegKette } from "@/components/studio/BelegKette";
import { MedienPanel, creditsText } from "@/components/studio/MedienPanel";
import {
  FARBE_BERNSTEIN,
  FARBE_GRUEN,
  FARBE_ROT,
  bezugHinweis,
  freigabeLageGemerkt,
  istObjekt,
  maskiert,
  urteilAnzeige,
} from "@/components/studio/beleg-hilfen";

/** Was die Seite gerade zeigen kann: lädt, abgewiesen (400/401/404/500 oder Netz), Daten. */
export type StudioLesung =
  | { art: "laedt" }
  | { art: "abgewiesen"; httpStatus: number | null; text: string }
  | { art: "daten"; antwort: StudioAntwort };

const TEILE = ["objekt", "assets", "kosten_usd", "kosten_credits", "messung", "medien"] as const;

/** Stand der angezeigten Daten (Seite): wann geladen, ob gerade neu geladen wird, ob das letzte Neuladen scheiterte. */
export interface StudioStand {
  geladenAm: string | null;
  laedt: boolean;
  fehler: string | null;
}

/** Hat jeder Teil die Form eines Messwerts (Objekt mit status als Text)? */
function istStudioAntwort(daten: Record<string, unknown>): boolean {
  return TEILE.every((teil) => istObjekt(daten[teil]) && typeof (daten[teil] as Record<string, unknown>).status === "string");
}

/** Antwort von GET /api/studio/[objekt] einordnen; der Fehlertext der Route steht sichtbar da. */
export function leseStudioAntwort(httpStatus: number, daten: unknown): StudioLesung {
  const obj = istObjekt(daten) ? daten : null;
  if (httpStatus >= 200 && httpStatus < 300) {
    if (obj && istStudioAntwort(obj)) return { art: "daten", antwort: obj as unknown as StudioAntwort };
    return { art: "abgewiesen", httpStatus, text: "Antwort ohne lesbare Studio-Teile" };
  }
  if (httpStatus === 401) return { art: "abgewiesen", httpStatus, text: "Nicht angemeldet (HTTP 401) — bitte neu anmelden." };
  const feld = obj ? (typeof obj.fehler === "string" && obj.fehler.trim() ? obj.fehler : typeof obj.error === "string" ? obj.error : null) : null;
  return { art: "abgewiesen", httpStatus, text: maskiert(`${feld ?? "ohne Fehlertext"} (HTTP ${httpStatus})`) };
}

// ── Farben und Texte ──

const STATUS_FARBE: Record<StudioStatus, string> = {
  ok: FARBE_GRUEN,
  warnung: FARBE_BERNSTEIN,
  fehler: FARBE_ROT,
  nicht_gemessen: "var(--gp-ink-3)",
  noch_nicht_gebaut: "var(--gp-ink-3)",
};

function statusFarbe(status: string): string {
  return Object.hasOwn(STATUS_FARBE, status) ? STATUS_FARBE[status as StudioStatus] : "var(--gp-ink-3)";
}

const ASSET_STATUS: Record<string, { label: string; farbe: string }> = {
  entwurf: { label: "Entwurf", farbe: "#6b6b7b" },
  counsel_geprueft: { label: "Counsel geprüft", farbe: "#38bdf8" },
  zur_freigabe: { label: "Zur Freigabe", farbe: "#f59e0b" },
  fehler: { label: "Fehler", farbe: "#ff4d6a" },
  abgelehnt: { label: "Abgelehnt", farbe: "#ff4d6a" },
  freigegeben: { label: "Freigegeben", farbe: "#22c55e" },
  gepostet: { label: "Gepostet", farbe: "#8b5cf6" },
};

function assetStatus(status: string): { label: string; farbe: string } {
  return Object.hasOwn(ASSET_STATUS, status) ? ASSET_STATUS[status] : { label: maskiert(status), farbe: "#6b6b7b" };
}

function laeufeText(n: number): string {
  return n === 1 ? "1 Lauf" : `${n} Läufe`;
}

/** Zeitpunkt in Europe/Berlin mit Zonenangabe, z. B. "08.11.2026 08:30:00 (Europe/Berlin)"; sonst der Ersatztext. */
function zeitBerlin(iso: string | null | undefined, ersatz: string): string {
  const t = berlinDatumZeit(iso);
  return t === null ? ersatz : `${t} (Europe/Berlin)`;
}

/** title-Text eines Teils: Quelle, Hinweis, Messzeitpunkt. */
function teilTitel(m: StudioMesswert<unknown>): string {
  return [
    `Quelle: ${maskiert(m.quelle)}`,
    m.hinweis ? `Hinweis: ${maskiert(m.hinweis)}` : null,
    `gemessen: ${zeitBerlin(m.gemessen_am, "nicht gemessen")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function prozentText(prozent: number): string {
  return prozent.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

/** "Denkmal-AfA bis 100 %" wie im Export; ohne Denkmal-Angabe nur der Satz, mit Hinweis. */
export function afaText(afa: ObjektKopf["afa"]): string {
  if (afa === null) return "AfA nicht im Export";
  const satz = `${prozentText(afa.prozent)} %`;
  if (afa.denkmal === true) return `Denkmal-AfA bis ${satz}`;
  if (afa.denkmal === false) return `AfA ${satz} (laut Export kein Denkmal)`;
  return `AfA ${satz} (Denkmal-Angabe nicht im Export)`;
}

/** Kosten je Objekt als Text: Summe (≥ bei Lücken) oder, ohne Summe, warum keine da ist. */
export function kostenWertText(k: StudioKosten, status: StudioStatus): string {
  if (k.summe === null) return k.laeufe === 0 ? "keine Läufe" : "keine Kostenangabe";
  return status === "ok" ? formatiereUsd4(k.summe) : formatiereUsdUntergrenze(k.summe, 4);
}

function assetKostenText(m: StudioMesswert<AssetKosten>): string {
  const k = m.wert;
  if (k === null || k.summe_usd === null) return maskiert(m.hinweis ?? "keine Kostenangabe");
  const betrag = m.status === "ok" ? formatiereUsd4(k.summe_usd) : formatiereUsdUntergrenze(k.summe_usd, 4);
  return `${betrag} geschätzt · ${k.stufen_mit_angabe} von ${k.stufen_gelaufen} gelaufenen Stufen mit Angabe`;
}

// ── Bausteine ──

function Kachel({
  teil,
  titel,
  wert,
  unterzeile,
  status,
  title,
}: {
  teil: string;
  titel: string;
  wert: string;
  unterzeile: ReactNode;
  status: StudioStatus;
  title: string;
}) {
  return (
    <div className="card-ghost p-4 min-w-0" data-teil={teil} data-status={status} title={title}>
      <p className="text-[10px] text-text-muted uppercase tracking-widest mb-2">{titel}</p>
      <p
        className="text-xl sm:text-2xl font-bold font-[family-name:var(--font-outfit)] tracking-tight break-words"
        style={{ color: statusFarbe(status) }}
      >
        {wert}
      </p>
      <div className="text-xs text-text-muted mt-1 break-words">{unterzeile}</div>
    </div>
  );
}

function exportFehlerKopf(m: StudioMesswert<ObjektKopf>): { kopf: string; titel: string; farbe: string } {
  if (m.fehler_art === "nicht_im_export") {
    return { kopf: "OBJEKT NICHT IM EXPORT", titel: "Der Steinadel-Export wurde gelesen, enthält dieses Objekt aber nicht.", farbe: FARBE_ROT };
  }
  const art = (["nicht_angemeldet", "konfiguration", "nicht_erreichbar", "quelle_fehler"] as const).find((a) => a === m.fehler_art);
  const anzeige = objekteFehlerAnzeige((art ?? "unbekannt") as ObjekteFehlerArt);
  return { kopf: anzeige.kopf, titel: anzeige.titel, farbe: anzeige.farbe === "amber" ? FARBE_BERNSTEIN : FARBE_ROT };
}

function ObjektKopfKarte({ m, slug }: { m: StudioMesswert<ObjektKopf>; slug: string }) {
  if (m.status === "fehler" || m.wert === null) {
    const f = exportFehlerKopf(m);
    return (
      <section className="card-ghost p-5 mb-6 space-y-1" data-teil="objekt" data-status={m.status} title={teilTitel(m)}>
        <p className="mono-label" style={{ color: f.farbe }}>
          {f.kopf} — Steinadel-Export · Objektkopf nicht lesbar
        </p>
        <p className="text-[12px] break-words" style={{ color: "var(--gp-ink-2)" }}>
          {f.titel} Fehler: {objektFehlerText(m.hinweis ?? "unbekannter Fehler")}
        </p>
        <p className="text-[10px] text-text-muted">Objekt-Kennung: {maskiert(slug)} · Leseversuch {zeitBerlin(m.gemessen_am, "ohne Zeitpunkt")}</p>
      </section>
    );
  }
  const k = m.wert;
  const nicht = "nicht im Export";
  const datierung = k.datierung ? `${k.datierung.bezeichnung} ${k.datierung.jahr}` : `Baujahr ${nicht}`;
  return (
    <section className="card-ghost p-5 mb-6 min-w-0" data-teil="objekt" data-status={m.status} title={teilTitel(m)}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="mono-label" style={{ color: "var(--gp-gold)" }}>
          Objekt · {maskiert(k.slug)}
        </span>
        {m.status !== "ok" && (
          <span className="mono-label" style={{ color: FARBE_BERNSTEIN }}>
            unvollständig
          </span>
        )}
      </div>
      <h2
        className="font-[family-name:var(--font-cormorant)] font-semibold text-[26px] sm:text-[30px] leading-tight break-words"
        style={{ color: "var(--gp-ink)" }}
      >
        {maskiert(k.name ?? `Name ${nicht}`)}
      </h2>
      <p className="text-[13px] mt-1.5 break-words" style={{ color: "var(--gp-ink-2)" }} data-kopfzeile>
        {maskiert(k.ort ?? `Ort ${nicht}`)} · <span data-datierung>{datierung}</span> · Status {maskiert(k.status ?? nicht)}
      </p>
      {k.datierung?.ausnahme && (
        <p className="text-[10px] mt-1 break-words" style={{ color: "var(--gp-ink-3)" }} data-datierung-quelle>
          {maskiert(k.datierung.ausnahme)}
        </p>
      )}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mt-4">
        <div className="min-w-0">
          <dt className="mono-label">Preis (wörtlich aus dem Export)</dt>
          <dd className="font-[family-name:var(--font-cormorant)] text-[22px] break-words" style={{ color: "var(--gp-gold-hi)" }} data-preis>
            {maskiert(k.preis ?? nicht)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mono-label">AfA</dt>
          <dd className="font-[family-name:var(--font-jbmono)] text-[13px] mt-1 break-words" style={{ color: "var(--gp-ink)" }} data-afa>
            {afaText(k.afa)}
          </dd>
        </div>
      </dl>
      <p className="mono-label mt-4 break-words" style={{ color: "var(--gp-ink-3)" }} data-quelle>
        Quelle: Steinadel-Export · erzeugt {zeitBerlin(k.export.generiert_am, "ohne Zeitpunkt")} · abgerufen {zeitBerlin(m.gemessen_am, "ohne Zeitpunkt")}
        {k.export.quelle ? ` · Export-Kopf „${maskiert(k.export.quelle)}“` : ""}
        {k.export.version ? ` · Version ${maskiert(k.export.version)}` : ""}
      </p>
      {m.hinweis && (
        <p className="text-[11px] mt-1 break-words" style={{ color: FARBE_BERNSTEIN }}>
          {maskiert(m.hinweis)}
        </p>
      )}
    </section>
  );
}

/**
 * Hinweis an einer Entwurf-Zeile: Ein Lauf legt die Zeile als Entwurf an und füllt sie erst später; die Karte zeigt
 * den Stand beim Laden, nicht den laufenden. Ohne diesen Hinweis sah „gesperrt: … (kein Text)“ wie ein Befund aus.
 */
export function entwurfHinweis(geladenAm: string | null | undefined): string {
  const zeit = geladenAm ? ` von ${zeitBerlin(geladenAm, "ohne Zeitpunkt")}` : " beim Laden der Seite";
  return `Entwurf: Ein Lauf kann diese Zeile noch füllen — angezeigt ist der Stand${zeit}; „neu laden“ zeigt den aktuellen.`;
}

/** Medium einer Caption zu einem Video auf der Karte: Export, Hash und das Urteil der Medien-Regel (Server). */
/**
 * Was die Karte über die Videos dieses Objekts weiß (Nachtrag d2-oberflaeche-1): null, wenn die Medienliste nicht lesbar
 * oder gekappt ist; sonst Ketten und Zeilen. So nennt die Zeile „Video“ nie „nicht unter den Videos dieses Objekts“, nur
 * weil die Liste fehlt, und eine eigene Zeile, die kein Export ist, heißt „kein Export“ wie in der Freigabe-Zeile.
 */
export type KartenMedien = Pick<StudioMedienWert, "ketten" | "zeilen"> | null;

/** Medienteil der Antwort → KartenMedien: null bei Lesefehler, ohne Wert oder gekappter Liste. */
export function kartenMedien(teil: StudioMesswert<StudioMedienWert>): KartenMedien {
  return teil.status === "fehler" || teil.wert === null || teil.wert.abgeschnitten ? null : { ketten: teil.wert.ketten, zeilen: teil.wert.zeilen };
}

function MediumZeile({ id, medien }: { id: number | null; medien: KartenMedien }) {
  if (id === null) {
    return (
      <dd className="break-words" style={{ color: FARBE_ROT }} data-karten-medium="unlesbar">
        Video — Medium der Zeile nicht lesbar (metadata.medium_id)
      </dd>
    );
  }
  if (medien === null) {
    return (
      <dd className="break-words" style={{ color: FARBE_BERNSTEIN }} data-karten-medium="nicht_ermittelt">
        Video #{id} — Urteil nicht ermittelt (Medienliste nicht lesbar)
      </dd>
    );
  }
  const k = medien.ketten.find((x) => x.export.id === id);
  if (k === undefined) {
    const eigene = medien.zeilen.some((z) => z.id === id);
    return (
      <dd className="break-words" style={{ color: FARBE_BERNSTEIN }} data-karten-medium={eigene ? "kein_export" : "fremd"}>
        Video #{id} — {eigene ? "kein Export dieses Objekts" : "nicht unter den Videos dieses Objekts"} (Grund unter „Freigabe“)
      </dd>
    );
  }
  return (
    <dd className="break-words" data-karten-medium={k.urteil.freigebbar ? "frei" : "gesperrt"} title={k.urteil.gruende.map(maskiert).join("\n") || undefined}>
      Video · Export #{k.export.id} ·{" "}
      <span className="font-[family-name:var(--font-jbmono)]">{k.export.sha256.slice(0, 8)}…</span> · Medien-Regel:{" "}
      <span style={{ color: k.urteil.freigebbar ? FARBE_GRUEN : FARBE_ROT }}>
        {k.urteil.freigebbar ? "erfüllt" : `sperrt — ${maskiert(k.urteil.gruende[0] ?? "ohne Grund")}${k.urteil.gruende.length > 1 ? ` (+${k.urteil.gruende.length - 1})` : ""}`}
      </span>
    </dd>
  );
}

function AssetKarte({
  a,
  kopiere,
  kopierStatus,
  geladenAm,
  medien = null,
}: {
  a: StudioAsset;
  kopiere: (key: string, text: string) => void;
  kopierStatus: (key: string) => string;
  geladenAm?: string | null;
  medien?: KartenMedien;
}) {
  const status = assetStatus(a.status);
  const kanal = [a.kanal, a.format].filter((t): t is string => typeof t === "string" && t.trim() !== "").map(maskiert);
  // Anzeigeregel R2 wie in der Beleg-Kette und auf /content: grünes FREIGABE nur, wenn COUNSEL genau
  // den Freigabetext geprüft hat. Dieselbe gemerkte Freigabe-Lage, die die Beleg-Kette dieser Karte
  // zeigt — beim COUNSEL-Urteil (R2) können sich Karte und Kette nicht widersprechen. Bei einer Caption zu
  // einem Video prüft die Lage im Browser nur den Caption-Teil; das sagen Kette („Caption-Teil erfüllt …“) und
  // Karte („Medium“ mit dem Urteil der Medien-Regel), die Freigabe-Zeile zeigt die Sperre des Servers mit
  // Medien-Regel (Nachbesserung oberflaeche-3, caption9-3; vorher „Medium: keines (Text-Asset)“).
  const lage = freigabeLageGemerkt(a.beleg);
  const urteil = urteilAnzeige(a.counsel.urteil, lage.bezug);
  // Wie der Hinweis am Freigeben-Knopf auf /content: freigebbar, aber nicht genau dieser Text geprüft.
  const bezug = a.freigabe_sperre ? null : bezugHinweis(lage.bezug);
  return (
    <article className="card-ghost p-4 min-w-0" data-asset={a.id}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="font-[family-name:var(--font-jbmono)] text-[10px] text-text-muted">#{a.id}</span>
        <span
          className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider"
          style={{ background: `${status.farbe}20`, color: status.farbe }}
        >
          {status.label}
        </span>
        <span className="text-[11px] text-text-muted break-words">
          {lage.medium ? `Caption zu Video${lage.medium.id === null ? "" : ` #${lage.medium.id}`}` : "Text"}
          {kanal.length > 0 ? ` · ${kanal.join(" · ")}` : " · Kanal und Format nicht gespeichert"}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-foreground break-words">{maskiert(a.titel ?? "ohne Titel")}</h3>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-xs">
        <div className="min-w-0">
          <dt className="mono-label">COUNSEL-Urteil (abgeleitet)</dt>
          <dd className="break-words">
            <span
              className="font-semibold font-[family-name:var(--font-jbmono)]"
              style={{ color: urteil.farbe }}
              data-karten-urteil={lage.bezug}
            >
              {urteil.text}
            </span>
            <span className="text-text-muted"> · {maskiert(a.counsel.grund)}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mono-label">Freigabe</dt>
          <dd className="break-words" style={{ color: a.freigabe_sperre ? FARBE_ROT : FARBE_GRUEN }} data-sperre={a.freigabe_sperre ? "ja" : "nein"}>
            {a.freigabe_sperre ? `gesperrt: ${maskiert(a.freigabe_sperre)}` : "freigebbar laut Server-Regel"}
          </dd>
          {bezug && (
            <dd className="text-[10px] break-words" style={{ color: FARBE_BERNSTEIN }} data-bezug-hinweis>
              {bezug}
            </dd>
          )}
          {a.beleg.status === "entwurf" && (
            <dd className="text-[10px] break-words" style={{ color: FARBE_BERNSTEIN }} data-entwurf-hinweis>
              {entwurfHinweis(geladenAm)}
            </dd>
          )}
        </div>
        <div className="min-w-0" title={teilTitel(a.kosten_usd)}>
          <dt className="mono-label">Kosten (Claude, USD)</dt>
          <dd className="break-words" data-asset-kosten={a.kosten_usd.status}>
            {assetKostenText(a.kosten_usd)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mono-label">Medium</dt>
          {lage.medium ? <MediumZeile id={lage.medium.id} medien={medien} /> : <dd className="text-text-muted">keines (Text-Asset)</dd>}
        </div>
        <div className="min-w-0">
          <dt className="mono-label">Erstellt</dt>
          <dd className="text-text-muted">{zeitBerlin(a.erstellt_am, "ohne Zeitpunkt")}</dd>
        </div>
      </dl>
      <details className="mt-3" id={`beleg-${a.id}`}>
        <summary className="cursor-pointer text-[11px] text-text-muted hover:text-foreground">Beleg-Kette anzeigen</summary>
        <div className="mt-2 min-w-0">
          <BelegKette item={a.beleg} kopiere={kopiere} kopierStatus={kopierStatus} />
        </div>
      </details>
    </article>
  );
}

function AssetListe({
  m,
  slug,
  kopiere,
  kopierStatus,
  stand,
  medien = null,
}: {
  m: StudioAssetsTeil;
  slug: string;
  kopiere: (key: string, text: string) => void;
  kopierStatus: (key: string) => string;
  stand?: StudioStand;
  medien?: KartenMedien;
}) {
  return (
    <section className="mb-8 min-w-0" data-teil="assets" data-status={m.status}>
      <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-3" title={teilTitel(m)}>
        Assets · Text{m.status === "fehler" ? " · nicht lesbar" : ""}
      </h2>
      {m.status === "fehler" || m.wert === null ? (
        <p className="card-ghost p-4 text-xs break-words" style={{ color: FARBE_ROT }} role="alert">
          Assets nicht lesbar: {maskiert(m.hinweis ?? "unbekannter Fehler")}
        </p>
      ) : m.wert.length === 0 ? (
        <p className="card-ghost p-4 text-xs text-text-muted">
          Die Abfrage lieferte keine content-Zeile mit metadata.objekt_slug = {maskiert(slug)} (gelesen {zeitBerlin(m.gemessen_am, "ohne Zeitpunkt")}).
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[10px] text-text-muted break-words" data-zeitzonen-vermerk>
            Zeiten des Studios in Europe/Berlin; die Beleg-Kette zeigt ihre Zeiten wie /content in der Zeitzone dieses Browsers.
          </p>
          {m.hinweis && (
            <p className="text-[11px] break-words" style={{ color: FARBE_BERNSTEIN }}>
              {maskiert(m.hinweis)}
            </p>
          )}
          {m.wert.map((a) => (
            <AssetKarte key={a.id} a={a} kopiere={kopiere} kopierStatus={kopierStatus} geladenAm={stand?.geladenAm} medien={medien} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Unterzeile der Kosten-Kachel. Sind nicht alle Läufe geladen (abgeschnitten) oder fehlt die Zählung,
 * gilt "ohne Kostenangabe" nur für die geladenen Läufe; die Gesamtzahl kommt dann aus der Zählung der
 * Abfrage (wie die Assets-Kachel) — nie die geladenen Läufe als "gesamt".
 */
export function kostenUnterzeile(k: StudioKosten, gesamt: number | null): string {
  if (gesamt === null) return `${k.laeufe_ohne_angabe} von ${k.laeufe} geladenen Läufen ohne Kostenangabe · ohne Zählung`;
  if (gesamt > k.laeufe) {
    return `${k.laeufe_ohne_angabe} von ${k.laeufe} geladenen Läufen ohne Kostenangabe · ${laeufeText(gesamt)} laut Zählung`;
  }
  return `${laeufeText(k.laeufe_ohne_angabe)} ohne Kostenangabe · ${laeufeText(k.laeufe)} gesamt`;
}

function Kennzahlen({ antwort }: { antwort: StudioAntwort }) {
  const assets = antwort.assets;
  const kosten = antwort.kosten_usd;
  const credits = antwort.kosten_credits;
  const messung = antwort.messung;
  const anzahl =
    assets.status === "fehler" || assets.wert === null ? "nicht lesbar" : String(assets.gesamt ?? assets.wert.length);
  // Ohne Zählung (gesamt null) ist die Zahl nur die Menge der geladenen Zeilen — so steht es auch da.
  const anzahlUnter =
    assets.status === "fehler" || assets.wert === null
      ? maskiert(assets.hinweis ?? "Lesefehler")
      : assets.gesamt === null
        ? "geladene Zeilen, ohne Zählung · Supabase · content"
        : `Zählung der Abfrage · Supabase · content${assets.gesamt !== assets.wert.length ? ` · ${assets.wert.length} geladen` : ""}`;
  const k = kosten.wert;
  const kostenLesbar = kosten.status !== "fehler" && k !== null;
  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kachel teil="assets" titel="Assets (Text)" wert={anzahl} unterzeile={anzahlUnter} status={assets.status} title={teilTitel(assets)} />
        <Kachel
          teil="kosten_usd"
          titel="Claude-Kosten (USD, geschätzt)"
          wert={kostenLesbar ? kostenWertText(k, kosten.status) : "nicht lesbar"}
          unterzeile={
            kostenLesbar ? (
              <span data-ohne-angabe={k.laeufe_ohne_angabe}>{kostenUnterzeile(k, assets.gesamt)}</span>
            ) : (
              maskiert(kosten.hinweis ?? "Lesefehler")
            )
          }
          status={kosten.status}
          title={teilTitel(kosten)}
        />
        <Kachel
          teil="kosten_credits"
          titel="Higgsfield-Credits"
          wert={creditsText(credits).wert}
          unterzeile={<span data-credits-unter>{creditsText(credits).unter}</span>}
          status={credits.status}
          title={teilTitel(credits)}
        />
        <Kachel
          teil="messung"
          titel="Messplan"
          wert={messplanText(messung).wert}
          unterzeile={<span data-messplan-unter>{messplanText(messung).unter}</span>}
          status={messung.status}
          title={teilTitel(messung)}
        />
      </div>
      <MessplanListe m={messung} />
      {/* Vorbehalte der Kostenschätzung sichtbar (Schätzung, alte Preistabelle, Untergrenze), nicht nur im title — wie unter der Kosten-Kachel des Dashboards. */}
      {kostenLesbar && kosten.hinweis && (
        <p
          className="font-[family-name:var(--font-jbmono)] text-[10px] leading-relaxed break-words mt-2"
          style={{ color: kosten.status === "ok" ? "var(--gp-ink-3)" : FARBE_BERNSTEIN }}
          data-kosten-hinweis
        >
          Claude-Kosten: {maskiert(kosten.hinweis)}
        </p>
      )}
    </div>
  );
}

/**
 * Messplan als Kachel-Text: „nicht angelegt“ (Tabelle fehlt), „noch kein Eintrag“ (Schritt 11), sonst die Zahl der
 * Einträge — nie 0 als Platzhalter und eine fehlende Tabelle nie als Fehler.
 */
export function messplanText(m: StudioMesswert<MessplanStand>): { wert: string; unter: string } {
  const w = m.wert;
  if (m.status === "noch_nicht_gebaut") return { wert: nochNichtGebautText(m.schritt ?? 11), unter: maskiert(m.quelle) };
  if (m.status === "fehler" || w === null) return { wert: "nicht lesbar", unter: maskiert(m.hinweis ?? "Lesefehler") };
  if (w.art === "nicht_angelegt") return { wert: "nicht angelegt", unter: `Tabelle studio_messplan fehlt (${maskiert(w.code)})` };
  if (w.art === "leer") return { wert: "noch kein Eintrag", unter: "Einträge kommen mit Schritt 11" };
  const start = w.fensterstart === null ? "Fensterstart offen" : `Fensterstart ${zeitBerlin(w.fensterstart, "unlesbar")}`;
  return { wert: `${w.zeilen.length} Einträge`, unter: `${start}${w.abweichungen > 0 ? ` · ${w.abweichungen} Abweichung(en)` : ""}` };
}

const MESSPLAN_LAGE: Record<string, { text: string; farbe: string }> = {
  gilt: { text: "gilt", farbe: FARBE_GRUEN },
  abgeloest: { text: "abgelöst", farbe: "var(--gp-ink-3)" },
  abweichung: { text: "Abweichung — nach dem Fensterstart festgeschrieben, gilt nicht", farbe: FARBE_ROT },
};

/** Einträge des Messplans mit ihrer Lage; Abweichungen rot. Nur, wenn es Einträge gibt. */
function MessplanListe({ m }: { m: StudioMesswert<MessplanStand> }) {
  const w = m.wert;
  if (w === null || w.art !== "eintraege") return null;
  return (
    <details className="card-ghost p-4 mt-3 min-w-0" data-messplan-liste>
      <summary className="cursor-pointer text-[11px] text-text-muted">Messplan-Einträge ({w.zeilen.length})</summary>
      <ul className="space-y-2 mt-2">
        {w.zeilen.map((z) => {
          const lage = MESSPLAN_LAGE[z.lage] ?? { text: maskiert(z.lage), farbe: FARBE_BERNSTEIN };
          const werte = maskiert(JSON.stringify(z.werte));
          return (
            <li key={z.id} className="text-[11px] min-w-0 break-words" data-messplan-zeile={z.id} data-lage={z.lage}>
              <span className="font-[family-name:var(--font-jbmono)]">{maskiert(z.eintrag)}</span> ·{" "}
              <span style={{ color: lage.farbe }}>{lage.text}</span> · festgeschrieben {zeitBerlin(z.festgeschrieben_am, "ohne Zeitpunkt")}
              {z.von || z.bis ? ` · ${zeitBerlin(z.von, "offen")} – ${zeitBerlin(z.bis, "offen")}` : ""}
              <span className="block text-[10px] text-text-muted">
                Quelle: {maskiert(z.quelle)}
                {z.gemessen_am ? ` · gemessen ${zeitBerlin(z.gemessen_am, "")}` : ""} · Werte: {werte.length > 300 ? `${werte.slice(0, 299)}…` : werte}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** „neu laden“: eine Lesung je Klick; während einer Lesung aria-disabled (Klick ignoriert, Fokus bleibt). */
function NeuLadenKnopf({ laedt, neuLaden }: { laedt: boolean; neuLaden: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!laedt) neuLaden();
      }}
      aria-disabled={laedt}
      className="min-h-11 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
      data-neu-laden
    >
      neu laden
    </button>
  );
}

/** Stand-Zeile: wann die angezeigten Daten geladen wurden, „neu laden“ und ein gescheitertes Neuladen. */
function StandZeile({ stand, neuLaden }: { stand: StudioStand; neuLaden?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-6 text-[11px] min-w-0" data-stand-zeile data-laedt={stand.laedt ? "ja" : "nein"} aria-live="polite">
      <span className="break-words" style={{ color: "var(--gp-ink-2)" }}>
        {stand.laedt ? "Lädt neu … angezeigt ist der Stand von " : "Stand: geladen "}
        <span data-geladen-am>{zeitBerlin(stand.geladenAm, "ohne Zeitpunkt")}</span>
        {" "}· Daten werden nicht von selbst aktualisiert
      </span>
      {neuLaden && <NeuLadenKnopf laedt={stand.laedt} neuLaden={neuLaden} />}
      {stand.fehler && (
        <span className="basis-full break-words" style={{ color: FARBE_ROT }} role="alert" data-neu-laden-fehler>
          Neu laden gescheitert: {maskiert(stand.fehler)} — angezeigt ist der Stand von {zeitBerlin(stand.geladenAm, "ohne Zeitpunkt")}.
        </span>
      )}
    </div>
  );
}

function RegelListe() {
  return (
    <section className="card-ghost p-5 min-w-0" data-regeln>
      <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-3">Regeln, die mitlaufen</h2>
      <ul className="space-y-3">
        {STUDIO_REGELN.map((r) => (
          <li key={r.regel} className="min-w-0">
            <p className="text-[13px] break-words" style={{ color: "var(--gp-ink)" }}>
              {r.regel}
            </p>
            <p className="text-[10px] text-text-muted break-words">
              Fundstelle: {r.fundstelle} · Prüfung: {r.pruefung}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const OHNE_NEULADEN = () => {};

export function StudioAnsicht({
  slug,
  lesung,
  kopiere,
  kopierStatus,
  stand,
  neuLaden,
}: {
  slug: string;
  lesung: StudioLesung;
  kopiere: (key: string, text: string) => void;
  kopierStatus: (key: string) => string;
  /** Stand der angezeigten Daten; ohne Angabe keine Stand-Zeile. */
  stand?: StudioStand;
  /** Eine neue Lesung anstoßen (Seite); ohne Angabe (statische Ansicht) kein Knopf „neu laden“. */
  neuLaden?: () => void;
}) {
  return (
    <div className="boot p-4 sm:p-6 lg:p-10 max-w-[1280px] min-w-0">
      <div className="gp-masthead">
        <div className="gp-index-row">
          <span className="gp-index">05 / OBJEKT-STUDIO</span>
          <span className="gp-index-rule" />
        </div>
        <p className="gp-kicker">Steinadel · ein Objekt · liest und verbucht Medien</p>
        <h1 className="gp-wordmark">
          Objekt-<em>Studio</em>
        </h1>
        <p className="gp-sub">
          Liest den Steinadel-Export, die Content-Läufe, die Anker-Dateien und die Medien zu diesem Objekt. Das Studio
          postet nichts; es prüft die Anker gegen ihr Manifest und spielt Videos mit Beleg ein. „Text erzeugen“ startet
          nach Bestätigung einen bezahlten Pipeline-Lauf (Claude) für die Caption zu einem Video. Freigegeben wird im
          Content-Tab.
        </p>
      </div>

      <nav className="mb-6 text-xs break-words" aria-label="Pfad">
        <Link href="/expose" className="text-text-muted hover:text-foreground transition-colors">
          Exposé-Engine
        </Link>
        <span className="text-text-muted mx-2">/</span>
        <span className="text-foreground">Objekt-Studio · {maskiert(slug || "ohne Kennung")}</span>
        <span className="text-text-muted mx-2">·</span>
        <Link href="/content?tab=content" className="text-text-muted hover:text-foreground transition-colors">
          Freigabe im Content-Tab
        </Link>
      </nav>

      {lesung.art === "laedt" && (
        <div className="card-ghost p-5 mb-6" role="status">
          <p className="mono-label" style={{ color: "var(--gp-ink-3)" }}>
            Studio lädt …
          </p>
        </div>
      )}

      {lesung.art === "abgewiesen" && (
        <div className="card-ghost p-5 mb-6 space-y-1" role="alert" data-abgewiesen={lesung.httpStatus ?? "netz"}>
          <p className="mono-label" style={{ color: FARBE_ROT }}>
            Studio nicht lesbar
          </p>
          <p className="text-[12px] break-words" style={{ color: "var(--gp-ink-2)" }}>
            {maskiert(lesung.text)}
          </p>
          {/* Scheitert schon die erste Lesung, gibt es keinen alten Stand: Der Knopf liest einmal neu, ohne den Tab
              neu zu laden. */}
          {neuLaden && (
            <div className="pt-2">
              <NeuLadenKnopf laedt={false} neuLaden={neuLaden} />
            </div>
          )}
        </div>
      )}

      {lesung.art === "daten" && (
        <>
          {stand && <StandZeile stand={stand} neuLaden={neuLaden} />}
          <ObjektKopfKarte m={lesung.antwort.objekt} slug={lesung.antwort.objekt_slug} />
          <Kennzahlen antwort={lesung.antwort} />
          <AnkerPanel slug={lesung.antwort.objekt_slug} />
          <MedienPanel slug={lesung.antwort.objekt_slug} medien={lesung.antwort.medien} credits={lesung.antwort.kosten_credits} neuLaden={neuLaden ?? OHNE_NEULADEN} />
          <AssetListe
            m={lesung.antwort.assets}
            slug={lesung.antwort.objekt_slug}
            kopiere={kopiere}
            kopierStatus={kopierStatus}
            stand={stand}
            medien={kartenMedien(lesung.antwort.medien)}
          />
        </>
      )}

      <RegelListe />
    </div>
  );
}
