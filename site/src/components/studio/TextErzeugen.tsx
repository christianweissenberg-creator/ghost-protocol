"use client";

// „Text erzeugen“ zu einem Video im Objekt-Studio (Nachbesserung Paket C, Auftrag C nach der Gegenprüfung von f5ba8eb):
// startet die Pipeline mit objekt_slug und medium_id — die Caption zu diesem Video (Stufe 2: „Neues Asset → Text
// erzeugen“; Ablauf Video-Asset, Schritt 5 „Caption“).
//
// - Erst zeigen, dann genau das senden (Muster der Auftragszeile): „Text erzeugen …“ zeigt Objekt, Video, Kanal, Format,
//   Kategorie und Lauf-ID mit dem Hinweis „bezahlter Lauf (Claude)“ (Ablauf Text-Asset, Nr. 2); gesendet wird erst mit „Ja, bezahlten
//   Lauf starten“. Während der Bestätigung und des Laufs sind die Felder gesperrt.
// - Lauf-ID wie auf /content (R10): Ist der Ausgang unbekannt (Netz, Antwort nicht lesbar, Antwort ohne Fehlertext der
//   Route), sendet der nächste Versuch dieselbe ID — läuft der Lauf schon, antwortet der Server 409 statt einen zweiten
//   bezahlten Lauf zu starten. Nach einem bekannten Ausgang gilt die ID als verbraucht — außer bei einer Wiederholung
//   (ausgangBeiWiederholung, wie auf /content, Nachtrag d2-text-erzeugen-1): Scheitert der erneute Versuch mit der offenen
//   ID selbst (nicht gestartet, abgewiesen, abgebrochen), sagt das nichts über den früheren Versuch; die ID bleibt.
// - Nach einem Ausgang mit Zeile lädt das Studio neu (fertig), die Caption erscheint als Asset-Karte.
// - Sperrt die Medien-Regel das Video, nennt die Bestätigung die Gründe (Nachtrag d2-text-erzeugen-3): Die Caption ist dann
//   nicht freigebbar, solange das gilt. Der Knopf bleibt, weil die Abnahme genau diesen Fall braucht.
// - Die offene Lauf-ID je Video steht in sessionStorage (Nachtrag d2-text-erzeugen-4): Nach Neuladen oder Zurück im selben
//   Tab sendet „Erneut senden …“ dieselbe ID (der Server antwortet 409, wenn der Lauf schon läuft), und die Karte nennt
//   den Lauf ohne bekannten Ausgang. Gelesen wird erst nach dem Einhängen (sonst wiche das erste Bild vom Server-HTML ab).
//   Ein zweiter Tab hat einen eigenen sessionStorage; dort hilft nur der Stapel.
// - Abgleich mit den geladenen Captions (Schlussprüfung d3-kosten-knopf-3, Prüfung f-knopf-pruefung-1): Trägt eine Caption
//   dieses Videos die offene Lauf-ID und steht sie in einem Endzustand (LAUF_VORBEI), ist der Ausgang bekannt. Der Eintrag
//   geht weg, die Karte nennt „Caption #N (Status …) zu diesem Lauf“, und „Text erzeugen …“ gilt wieder mit neuer ID. In
//   „entwurf“ und „counsel_geprueft“ (oder einem unbekannten Status) läuft der Lauf noch oder hängt: Die ID bleibt, die
//   Karte nennt die Caption als nicht fertig, und „Erneut senden …“ bekommt 409.
// - Dieselbe Regel gilt für die Antwort des Servers (Delta-Prüfung f2-endzustand-1): Ein 409 mit Zeile und einem Status
//   außerhalb LAUF_VORBEI (oder ohne Status) verbraucht die ID nicht. Die Karte behält sie und nennt die Zeile als nicht
//   fertig; „Erneut senden …“ fragt den Stand erneut ab. Erst ein Endzustand (im 409 oder in den geladenen Captions) gibt
//   sie frei. Hängt eine Zeile wirklich, gibt „Lauf-ID verwerfen …“ sie nach einer Bestätigung bewusst frei; läuft der
//   Lauf doch noch, startet „Text erzeugen …“ danach einen zweiten bezahlten Lauf, und die Bestätigung sagt das.
// - Eine Doppelsperre am Server (409 bei einer
//   Zeile zu medium_id, Kanal und Format in entwurf/counsel_geprueft) gibt es bewusst nicht: Ein abgebrochener Lauf ließe
//   seine Zeile dort stehen und hielte jede weitere Caption zu diesem Video und Kanal fest, bis jemand sie umstellt.
// Keine Zahl ohne Quelle: Gemessene Kosten je Lauf gibt es vorab nicht; die Antwort nennt die geschätzten Kosten des Laufs.

import { useEffect, useRef, useState } from "react";
import { FARBE_BERNSTEIN, FARBE_GRUEN, FARBE_ROT, istObjekt, maskiert } from "@/components/studio/beleg-hilfen";
import { berlinDatumZeit } from "@/lib/types";
import type { StudioAsset } from "@/lib/studio/typen";

export type Holen = (url: string, init?: RequestInit) => Promise<Response>;

/** Kanal und Format für eine Caption zu einem Video — Formate wie FORMATE_JE_PLATTFORM in api/content/pipeline. */
export const CAPTION_WAHL = [
  { wert: "instagram|reel", plattform: "instagram", format: "reel", text: "Instagram · Reel" },
  { wert: "tiktok|tiktok_short", plattform: "tiktok", format: "tiktok_short", text: "TikTok · Short" },
  { wert: "youtube|short", plattform: "youtube", format: "short", text: "YouTube · Short" },
  { wert: "x|thread", plattform: "x", format: "thread", text: "X · Thread" },
  { wert: "linkedin|linkedin_post", plattform: "linkedin", format: "linkedin_post", text: "LinkedIn · Post" },
] as const;

/** Kategorien wie KATEGORIE_LABEL in api/content/pipeline. */
export const KATEGORIEN = [
  { wert: "ki_automation", text: "KI & Automation" },
  { wert: "business_automation", text: "Business-Automation" },
  { wert: "ghost_protocol", text: "Behind the Scenes" },
] as const;

/** Format der lauf_id laut Vertrag mit POST /api/content/pipeline (sonst 400). */
const LAUF_ID_MUSTER = /^[A-Za-z0-9:_-]{8,80}$/;

/** Neue Lauf-ID (crypto.randomUUID); null ohne Zufallsquelle — dann startet kein Lauf. */
export function neueLaufId(zufall: { randomUUID?: () => string } | undefined = globalThis.crypto): string | null {
  const id = typeof zufall?.randomUUID === "function" ? zufall.randomUUID() : null;
  return id !== null && LAUF_ID_MUSTER.test(id) ? id : null;
}

/** Körper für POST /api/content/pipeline: Caption zu genau diesem Video. */
export function laufKoerper(slug: string, mediumId: number, wahl: string, kategorie: string, laufId: string) {
  const w = CAPTION_WAHL.find((x) => x.wert === wahl) ?? CAPTION_WAHL[0];
  return { platform: w.plattform, format: w.format, category: kategorie, objekt_slug: slug, medium_id: mediumId, lauf_id: laufId };
}

export type LaufAusgang =
  | { art: "ergebnis"; status: string; contentId: number | null; text: string }
  | { art: "existiert"; contentId: number | null; status: string | null; text: string }
  | { art: "abgewiesen"; text: string }
  | { art: "abgebrochen"; contentId: number | null; text: string }
  | { art: "nicht_gestartet"; text: string }
  | { art: "unbekannt"; contentId: number | null; text: string };

const AUSGANG_UNBEKANNT = "Ausgang unbekannt — der Lauf kann noch laufen; „Erneut senden“ schickt dieselbe Lauf-ID (kein zweiter bezahlter Lauf)";
const AUSGANG_UNBEKANNT_FRUEHER =
  "Ausgang unbekannt (früherer Versuch mit dieser Lauf-ID) — der Lauf kann noch laufen; „Erneut senden“ schickt dieselbe Lauf-ID (kein zweiter bezahlter Lauf)";

function eintragsNummer(d: Record<string, unknown> | null): number | null {
  if (!d) return null;
  for (const w of [d.content_id, d.contentId]) {
    if (typeof w === "number" && Number.isInteger(w) && w > 0) return w;
    if (typeof w === "string" && /^[1-9]\d*$/.test(w)) return Number(w);
  }
  return null;
}

/**
 * Untergrenze wie mindestensText auf /content (Nachtrag d2-text-erzeugen-7): abgerundet statt gerundet, damit „mindestens“
 * nie über der gemeldeten Summe liegt; unter $0.0001 „mehr als $0“.
 */
export function mindestensText(summe: number): string {
  if (summe > 0 && summe < 0.0001) return "mehr als $0 (gemeldet unter $0.0001)";
  return `mindestens $${(Math.floor(summe * 10_000 + 1e-6) / 10_000).toFixed(4)}`;
}

/**
 * Geschätzte Kosten aus der Antwort (summary.total_cost_usd, sonst Summe der Stufen); wie laufKostenText auf /content eine
 * Untergrenze, wenn eine gelaufene Stufe ohne Angabe ist oder die Route die Kosten unvollständig nennt.
 */
function kostenText(d: Record<string, unknown>): string {
  const s = istObjekt(d.summary) ? d.summary : null;
  const stufen = (Array.isArray(d.steps) ? d.steps : []).filter(istObjekt).filter((x) => x.status !== "pending");
  const mitKosten = stufen.filter((x) => typeof x.cost === "number");
  const gemeldet = s && typeof s.total_cost_usd === "number" ? s.total_cost_usd : null;
  if (gemeldet === null && mitKosten.length === 0) return "Kosten nicht gemeldet";
  const summe = gemeldet ?? mitKosten.reduce((a, x) => a + (x.cost as number), 0);
  const ohne = stufen.length - mitKosten.length;
  if (ohne > 0) return `geschätzt ${mindestensText(summe)} · ${ohne} ${ohne === 1 ? "Stufe" : "Stufen"} ohne Angabe`;
  if (s?.kosten_unvollstaendig) return `geschätzt ${mindestensText(summe)} · unvollständig`;
  return `geschätzt $${summe.toFixed(4)}`;
}

/** Fehlertext einer Antwort: fehler (Route), sonst error (Middleware, etwa 401); null ohne Text. Wie serverText auf /content. */
function serverText(d: Record<string, unknown> | null): string | null {
  if (!d) return null;
  if (typeof d.fehler === "string" && d.fehler.trim()) return d.fehler;
  if (typeof d.error === "string" && d.error.trim()) return d.error;
  return null;
}

/** Eine Lauf-Antwort mit Schritten (wie istLaufErgebnis auf /content). */
function istLaufErgebnis(d: Record<string, unknown>): boolean {
  return typeof d.status === "string" && Array.isArray(d.steps) && d.steps.every((x) => istObjekt(x) && typeof x.agent === "string" && typeof x.status === "string");
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
  complete: "zur Freigabe im Stapel",
  partial: "zur Freigabe im Stapel (AMPLIFIER ohne Ergebnis)",
  abgelehnt: "COUNSEL lehnt ab — nicht im Stapel",
  fehler: "abgebrochen",
};

/** Antwort der Pipeline einordnen (wie werteLaufAntwortAus auf /content, für einen Lauf mit Zeile je Video). */
export function laufAusgang(status: number | null, daten: unknown): LaufAusgang {
  const d = istObjekt(daten) ? daten : null;
  const nummer = eintragsNummer(d);
  if (status === null) return { art: "unbekannt", contentId: null, text: `${AUSGANG_UNBEKANNT} · ${maskiert(d && typeof d.fehler === "string" ? d.fehler : "Netzfehler")}` };
  if (status >= 200 && status < 300) {
    if (d && typeof d.status === "string" && Array.isArray(d.steps)) {
      const was = STATUS_TEXT[d.status] ?? `Status „${maskiert(d.status)}“`;
      return { art: "ergebnis", status: d.status, contentId: nummer, text: `Lauf beendet: Caption${nummer === null ? "" : ` #${nummer}`} — ${was} · ${kostenText(d)}` };
    }
    return { art: "unbekannt", contentId: nummer, text: `${AUSGANG_UNBEKANNT} · Antwort (HTTP ${status}) nicht lesbar` };
  }
  const fehler = serverText(d);
  if (d && status === 409) {
    return {
      art: "existiert",
      contentId: nummer,
      status: typeof d.status === "string" ? d.status : null,
      text: maskiert(`Lauf existiert bereits${nummer === null ? "" : ` (#${nummer})`} — kein zweiter Lauf gestartet${fehler ? ` · ${fehler}` : ""}`),
    };
  }
  if (d && status >= 400 && status < 500) return { art: "abgewiesen", text: maskiert(`Lauf abgewiesen (HTTP ${status}): ${fehler ?? "ohne Fehlertext"}`) };
  if (d && fehler !== null) {
    // Eine 5xx mit lesbaren Schritten (etwa „Status zur_freigabe nicht gespeichert“ nach allen bezahlten Stufen) ist ein
    // Ergebnis mit Kosten, wie auf /content (Nachtrag d2-text-erzeugen-7) — nicht nur „abgebrochen“.
    if (istLaufErgebnis(d)) return { art: "ergebnis", status: "fehler", contentId: nummer, text: maskiert(`Lauf mit Fehler beendet (HTTP ${status}${nummer === null ? "" : `, Caption #${nummer}`}): ${fehler} · ${kostenText(d)}`) };
    if (nummer !== null || d.status === "fehler") return { art: "abgebrochen", contentId: nummer, text: maskiert(`Lauf abgebrochen (HTTP ${status}${nummer === null ? "" : `, Caption #${nummer}`}): ${fehler}`) };
    return { art: "nicht_gestartet", text: maskiert(`Lauf nicht gestartet (HTTP ${status}): ${fehler}`) };
  }
  return { art: "unbekannt", contentId: nummer, text: `${AUSGANG_UNBEKANNT} · HTTP ${status} ohne lesbare Antwort` };
}

/**
 * R10 bei Wiederholung (wie ausgangBeiWiederholung auf /content, Prüflauf 06.11.2026; Nachtrag d2-text-erzeugen-1):
 * Sendet ein Versuch die offene Lauf-ID eines unbekannten Ausgangs erneut, belegt eine Antwort ohne Ergebnis (nicht
 * gestartet, abgewiesen, abgebrochen) nur den Ausgang DIESES Versuchs. Der frühere Versuch kann gelaufen und bezahlt
 * sein; er bleibt „unbekannt“, und die Lauf-ID bleibt, damit der Server einen zweiten Lauf weiter mit 409 abweist.
 * Bekannt wird er nur durch ein Ergebnis oder 409. Vorher verwarf eine solche Antwort die ID, und der nächste
 * bestätigte Klick startete einen zweiten bezahlten Lauf.
 */
export function ausgangBeiWiederholung(ausgang: LaufAusgang, wiederholung: boolean): LaufAusgang {
  if (!wiederholung || ausgang.art === "ergebnis" || ausgang.art === "existiert" || ausgang.art === "unbekannt") return ausgang;
  return { art: "unbekannt", contentId: null, text: `${AUSGANG_UNBEKANNT_FRUEHER} · Dieser Versuch: ${ausgang.text}` };
}

type Stand =
  | { art: "zu" }
  | { art: "bestaetigen"; laufId: string }
  | { art: "laeuft"; laufId: string }
  | { art: "verwerfen" }
  | { art: "ausgang"; ausgang: LaufAusgang };

/** Ein Lauf über holen (fetch). Wirft nie — jeder Fehler wird zum Ausgang. */
export async function sendeCaptionLauf(holen: Holen, koerper: ReturnType<typeof laufKoerper>): Promise<LaufAusgang> {
  try {
    const res = await holen("/api/content/pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(koerper), cache: "no-store" });
    return laufAusgang(res.status, await res.json().catch(() => null));
  } catch (e) {
    return laufAusgang(null, { fehler: `Netzfehler: ${e instanceof Error ? e.message : "unbekannt"}` });
  }
}

/** Was sessionStorage hier braucht; in Tests eine Attrappe. */
export type Speicher = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Offener Lauf je Video im Speicher: Lauf-ID, ob er gerade gesendet wird oder sein Ausgang unbekannt ist, und seit wann. */
export type OffenerLauf = { laufId: string; art: "laeuft" | "unbekannt"; seit: string };

/** Schlüssel des offenen Laufs je Objekt und Video. */
export function speicherSchluessel(slug: string, mediumId: number): string {
  return `gp-text-erzeugen:${slug}:${mediumId}`;
}

/** sessionStorage des Browsers; null ohne (Server, gesperrte Website-Daten). */
function browserSpeicher(): Speicher | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Offenen Lauf lesen; null, wenn keiner da oder der Eintrag unlesbar ist. Wirft nie. */
export function leseOffenenLauf(speicher: Speicher | null, schluessel: string): OffenerLauf | null {
  try {
    const roh: unknown = JSON.parse(speicher?.getItem(schluessel) ?? "null");
    if (!istObjekt(roh) || typeof roh.laufId !== "string" || !LAUF_ID_MUSTER.test(roh.laufId)) return null;
    if (roh.art !== "laeuft" && roh.art !== "unbekannt") return null;
    return { laufId: roh.laufId, art: roh.art, seit: typeof roh.seit === "string" ? roh.seit : "" };
  } catch {
    return null;
  }
}

/** Caption zu einem Video aus der Lesung des Studios: content-Zeile, ihr Status und die Lauf-ID aus metadata.lauf_id. */
export type CaptionZumLauf = { contentId: number; status: string; laufId: string };

const KEINE_CAPTIONS: readonly CaptionZumLauf[] = [];

/**
 * Status, mit denen ein Caption-Lauf vorbei ist — Positivliste (Prüfung f-knopf-pruefung-1): Die Pipeline endet mit
 * zur_freigabe, abgelehnt oder fehler; danach setzt nur der Betreiber freigegeben oder gepostet. „entwurf“ (RESEARCHER bis
 * COUNSEL-Vorprüfung) und „counsel_geprueft“ (PUBLISHER, Endprüfung, AMPLIFIER) heißen: Der Lauf kann noch laufen. Ein
 * unbekannter Status zählt ebenso; dann bleibt die ID, und der Server antwortet 409 statt eines zweiten Laufs.
 */
export const LAUF_VORBEI: ReadonlySet<string> = new Set(["zur_freigabe", "abgelehnt", "fehler", "freigegeben", "gepostet"]);

/**
 * Bleibt die Lauf-ID nach diesem Ausgang offen? Ja bei unbekanntem Ausgang und bei einem 409 mit Zeile, deren Status kein
 * Endzustand ist oder fehlt (Delta-Prüfung f2-endzustand-1): Dann läuft der Lauf mit dieser ID noch oder hängt, und ein
 * neuer Lauf darf nicht ohne bewusste Entscheidung starten.
 */
export function laufNochOffen(ausgang: LaufAusgang): boolean {
  if (ausgang.art === "unbekannt") return true;
  return ausgang.art === "existiert" && ausgang.contentId !== null && (ausgang.status === null || !LAUF_VORBEI.has(ausgang.status));
}

/**
 * Captions zu einem Video aus den geladenen Assets (Schlussprüfung d3-kosten-knopf-3): Zeilen mit metadata.medium_id gleich
 * dem Video und einer Lauf-ID nach Vertrag. Ohne lesbare Assets keine; dann bleibt es beim 409 des Servers.
 */
export function captionsZumVideo(assets: readonly Pick<StudioAsset, "beleg">[] | null | undefined, mediumId: number): CaptionZumLauf[] {
  const aus: CaptionZumLauf[] = [];
  for (const a of assets ?? []) {
    const m: unknown = a.beleg.metadata;
    if (!istObjekt(m) || m.medium_id !== mediumId || typeof m.lauf_id !== "string" || !LAUF_ID_MUSTER.test(m.lauf_id)) continue;
    aus.push({ contentId: a.beleg.id, status: a.beleg.status, laufId: m.lauf_id });
  }
  return aus;
}

/** Offenen Lauf schreiben (null: entfernen). Scheitert der Speicher, bleibt es beim Zustand der Karte. */
function merkeOffenenLauf(speicher: Speicher | null, schluessel: string, lauf: OffenerLauf | null): void {
  try {
    if (lauf === null) speicher?.removeItem(schluessel);
    else speicher?.setItem(schluessel, JSON.stringify(lauf));
  } catch {
    // Speicher voll oder gesperrt: Die Karte hält die ID trotzdem bis zum Neuladen.
  }
}

export function TextErzeugen({
  slug,
  medium,
  holen,
  fertig,
  sperre = null,
  speicher,
  captions = KEINE_CAPTIONS,
}: {
  slug: string;
  medium: { id: number; sha256: string };
  holen: Holen;
  fertig: () => void;
  /** Urteil der Medien-Regel zu diesem Video (Server); gesperrt → Gründe in der Bestätigung. */
  sperre?: { freigebbar: boolean; gruende: readonly string[] } | null;
  /** Speicher der offenen Lauf-ID (Standard: sessionStorage; Tests: Attrappe). */
  speicher?: Speicher | null;
  /** Geladene Captions zu diesem Video (captionsZumVideo), für den Abgleich mit der offenen Lauf-ID. */
  captions?: readonly CaptionZumLauf[];
}) {
  const [wahl, setWahl] = useState<string>(CAPTION_WAHL[0].wert);
  const [kategorie, setKategorie] = useState<string>(KATEGORIEN[0].wert);
  const [stand, setStand] = useState<Stand>({ art: "zu" });
  // R10: Lauf-ID eines Versuchs mit unbekanntem Ausgang — der nächste Versuch sendet genau sie.
  const [offeneLaufId, setOffeneLaufId] = useState<string | null>(null);
  // Ein Klick, ein Lauf: Ein zweiter Klick, bevor die Ansicht neu gezeichnet ist, sendet nichts.
  const sendet = useRef(false);
  // Offener Lauf aus dem Speicher dieses Tabs (Neuladen, Zurück): erst nach dem Einhängen gelesen.
  const [gemerkt, setGemerkt] = useState<OffenerLauf | null>(null);
  // Caption mit bekanntem Ausgang zur zuletzt offenen Lauf-ID (Abgleich mit den geladenen Captions).
  const [bekannt, setBekannt] = useState<{ caption: CaptionZumLauf; laufId: string } | null>(null);
  // Zeile zur offenen Lauf-ID laut dem letzten 409 (f2-endzustand-1), bis die geladenen Captions sie zeigen.
  const [laut409, setLaut409] = useState<{ laufId: string; contentId: number; status: string | null } | null>(null);
  const schluessel = speicherSchluessel(slug, medium.id);
  const ablage = speicher === undefined ? browserSpeicher() : speicher;
  useEffect(() => {
    const o = leseOffenenLauf(ablage, schluessel);
    if (o === null) return;
    setGemerkt(o);
    setOffeneLaufId((jetzt) => jetzt ?? o.laufId);
  }, [ablage, schluessel]);
  const gesperrt = stand.art === "bestaetigen" || stand.art === "laeuft" || stand.art === "verwerfen";
  // Schlussprüfung d3-kosten-knopf-3, Prüfung f-knopf-pruefung-1: Steht die offene Lauf-ID an einer geladenen Caption in einem
  // Endzustand, ist ihr Ausgang bekannt — nur, solange kein Versuch gezeigt wird oder läuft. Eine Caption mit der ID in einem
  // anderen Status gehört zu einem Lauf, der noch laufen kann: Die ID bleibt, die Karte nennt die Caption.
  const zuDieserId = offeneLaufId === null || gesperrt ? null : (captions.find((c) => c.laufId === offeneLaufId) ?? null);
  const zumLauf = zuDieserId !== null && LAUF_VORBEI.has(zuDieserId.status) ? zuDieserId : null;
  // Noch nicht fertig: laut den geladenen Captions, sonst laut dem letzten 409 zu dieser ID.
  const inCaptions = offeneLaufId === null ? null : (captions.find((c) => c.laufId === offeneLaufId) ?? null);
  const laufend: { contentId: number; status: string | null } | null =
    inCaptions !== null
      ? LAUF_VORBEI.has(inCaptions.status)
        ? null
        : inCaptions
      : laut409 !== null && laut409.laufId === offeneLaufId
        ? laut409
        : null;
  const ruhig = stand.art === "zu" || stand.art === "ausgang";
  useEffect(() => {
    if (zumLauf === null) return;
    merkeOffenenLauf(ablage, schluessel, null);
    setOffeneLaufId(null);
    setGemerkt(null);
    setLaut409(null);
    setBekannt({ caption: zumLauf, laufId: zumLauf.laufId });
    setStand({ art: "zu" });
  }, [zumLauf, ablage, schluessel]);
  const w = CAPTION_WAHL.find((x) => x.wert === wahl) ?? CAPTION_WAHL[0];
  const k = KATEGORIEN.find((x) => x.wert === kategorie) ?? KATEGORIEN[0];

  const zeigen = () => {
    if (gesperrt) return;
    const laufId = offeneLaufId ?? neueLaufId();
    if (laufId === null) {
      setStand({ art: "ausgang", ausgang: { art: "nicht_gestartet", text: "Lauf nicht gestartet — der Browser liefert keine Zufallszahlen für die Lauf-ID." } });
      return;
    }
    setStand({ art: "bestaetigen", laufId });
  };

  const starten = async () => {
    if (stand.art !== "bestaetigen" || sendet.current) return;
    sendet.current = true;
    const laufId = stand.laufId;
    // Wiederholung: Dieser Versuch sendet die offene ID eines Versuchs mit unbekanntem Ausgang (vor dem Senden bestimmt).
    const wiederholung = offeneLaufId === laufId;
    try {
      setBekannt(null);
      setStand({ art: "laeuft", laufId });
      setOffeneLaufId(laufId);
      const seit = new Date().toISOString();
      merkeOffenenLauf(ablage, schluessel, { laufId, art: "laeuft", seit });
      const ausgang = ausgangBeiWiederholung(await sendeCaptionLauf(holen, laufKoerper(slug, medium.id, wahl, kategorie, laufId)), wiederholung);
      setStand({ art: "ausgang", ausgang });
      // Nach einem bekannten Ausgang ist die ID verbraucht; nach einem unbekannten und nach einem 409 mit nicht fertiger
      // Zeile bleibt sie für den nächsten Versuch (laufNochOffen, f2-endzustand-1).
      const offen = laufNochOffen(ausgang);
      setOffeneLaufId(offen ? laufId : null);
      merkeOffenenLauf(ablage, schluessel, offen ? { laufId, art: "unbekannt", seit } : null);
      setLaut409(offen && ausgang.art === "existiert" && ausgang.contentId !== null ? { laufId, contentId: ausgang.contentId, status: ausgang.status } : null);
      setGemerkt(null);
      if ("contentId" in ausgang && ausgang.contentId !== null) fertig();
    } finally {
      sendet.current = false;
    }
  };

  /** Bewusst verwerfen (f2-endzustand-1): Eintrag weg, die nächste Bestätigung nennt eine neue Lauf-ID. */
  const verwerfen = () => {
    merkeOffenenLauf(ablage, schluessel, null);
    setOffeneLaufId(null);
    setGemerkt(null);
    setLaut409(null);
    setBekannt(null);
    setStand({ art: "zu" });
  };

  const farbe = (a: LaufAusgang) => (a.art === "ergebnis" && (a.status === "complete" || a.status === "partial") ? FARBE_GRUEN : a.art === "unbekannt" || a.art === "existiert" ? FARBE_BERNSTEIN : FARBE_ROT);

  return (
    <div className="mt-3 min-w-0 text-[11px]" data-text-erzeugen={medium.id}>
      <p className="mono-label">Caption zu diesem Video (Text erzeugen, bezahlter Lauf)</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
        <label className="block min-w-0">
          <span className="mono-label block">Kanal und Format</span>
          <select value={wahl} disabled={gesperrt} onChange={(e) => setWahl(e.currentTarget.value)} className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1 disabled:opacity-40" data-caption-kanal>
            {CAPTION_WAHL.map((x) => (
              <option key={x.wert} value={x.wert}>
                {x.text}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mono-label block">Kategorie</span>
          <select value={kategorie} disabled={gesperrt} onChange={(e) => setKategorie(e.currentTarget.value)} className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1 disabled:opacity-40" data-caption-kategorie>
            {KATEGORIEN.map((x) => (
              <option key={x.wert} value={x.wert}>
                {x.text}
              </option>
            ))}
          </select>
        </label>
      </div>
      {gemerkt !== null && stand.art === "zu" && offeneLaufId === gemerkt.laufId && (
        <p className="mt-2 break-words" style={{ color: FARBE_BERNSTEIN }} data-text-erzeugen-gemerkt={gemerkt.art}>
          Caption-Lauf zu diesem Video ohne bekannten Ausgang (in diesem Tab gestartet
          {berlinDatumZeit(gemerkt.seit) === null ? "" : ` am ${berlinDatumZeit(gemerkt.seit)} (Europe/Berlin)`}, Lauf-ID {gemerkt.laufId.slice(0, 8)}…) — er kann noch laufen.
          „Erneut senden …“ schickt dieselbe Lauf-ID; läuft er schon, antwortet der Server 409 statt einen zweiten Lauf zu starten.
        </p>
      )}
      {laufend !== null && ruhig && (
        <p className="mt-2 break-words" style={{ color: FARBE_BERNSTEIN }} data-text-erzeugen-laufend={laufend.contentId}>
          Caption #{laufend.contentId} (Status {laufend.status === null ? "nicht gemeldet" : maskiert(laufend.status)}) gehört zu diesem Lauf und ist noch nicht fertig.
        </p>
      )}
      {bekannt !== null && stand.art === "zu" && offeneLaufId === null && (
        <p className="mt-2 break-words" style={{ color: "var(--gp-ink-2)" }} data-text-erzeugen-bekannt={bekannt.caption.contentId}>
          Caption #{bekannt.caption.contentId} (Status {maskiert(bekannt.caption.status)}) zu diesem Lauf (Lauf-ID {bekannt.laufId.slice(0, 8)}…) — der Ausgang
          ist bekannt. „Text erzeugen …“ startet einen neuen Lauf mit neuer Lauf-ID.
        </p>
      )}
      {stand.art === "verwerfen" && offeneLaufId !== null && (
        <div className="mt-2 rounded-lg p-3 break-words" style={{ border: `1px solid ${FARBE_ROT}` }} role="group" aria-label="Lauf-ID verwerfen" data-text-erzeugen-verwerfen-bestaetigung>
          <p>
            Lauf-ID {offeneLaufId.slice(0, 8)}… verwerfen?{laufend === null ? "" : ` Caption #${laufend.contentId} steht noch auf „${laufend.status === null ? "nicht gemeldet" : maskiert(laufend.status)}“.`} Läuft
            der Lauf noch, startet „Text erzeugen …“ danach einen zweiten bezahlten Lauf. Nur verwerfen, wenn die Zeile hängt.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" onClick={verwerfen} className="min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity" data-text-erzeugen-verwerfen-ja>
              Ja, Lauf-ID verwerfen
            </button>
            <button type="button" onClick={() => setStand({ art: "zu" })} className="min-h-11 px-4 py-2 rounded-lg text-xs bg-surface-elevated text-foreground hover:opacity-80 transition-opacity" data-text-erzeugen-verwerfen-zurueck>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {stand.art !== "bestaetigen" && stand.art !== "laeuft" && stand.art !== "verwerfen" && (
        <button
          type="button"
          onClick={zeigen}
          className="mt-2 min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity"
          data-text-erzeugen-knopf
        >
          {offeneLaufId === null ? "Text erzeugen …" : "Erneut senden …"}
        </button>
      )}
      {laufend !== null && ruhig && offeneLaufId !== null && (
        <button
          type="button"
          onClick={() => setStand({ art: "verwerfen" })}
          className="mt-2 ml-2 min-h-11 px-4 py-2 rounded-lg text-xs bg-surface-elevated text-foreground hover:opacity-80 transition-opacity"
          data-text-erzeugen-verwerfen
        >
          Lauf-ID verwerfen …
        </button>
      )}
      {stand.art === "bestaetigen" && (
        <div className="mt-2 rounded-lg p-3 break-words" style={{ border: `1px solid ${FARBE_BERNSTEIN}` }} role="group" aria-label="Bezahlten Lauf bestätigen" data-text-erzeugen-bestaetigung>
          <p className="font-semibold" style={{ color: FARBE_BERNSTEIN }}>
            Bezahlter Lauf (Claude): bis zu 6 Stufen — RESEARCHER, SCRIBE, COUNSEL, PUBLISHER, COUNSEL 2, AMPLIFIER.
          </p>
          {sperre !== null && !sperre.freigebbar && (
            <p className="mt-1" style={{ color: FARBE_ROT }} data-text-erzeugen-sperre>
              Video gesperrt: {sperre.gruende.length > 0 ? sperre.gruende.map((g) => maskiert(g)).join(" · ") : "Medien-Regel sperrt"} — Caption nicht freigebbar, solange das gilt.
            </p>
          )}
          <p className="mt-1 text-text-muted">
            Gemessene Kosten je Lauf gibt es vorab nicht (die Antwort nennt die geschätzten Kosten des Laufs). Gesendet wird genau:
          </p>
          <p className="mt-1 font-[family-name:var(--font-jbmono)] text-[10px]" data-text-erzeugen-was>
            Objekt {maskiert(slug)} · Video #{medium.id} (Export, SHA-256 {medium.sha256.slice(0, 8)}…) · {w.text} ({w.plattform}/{w.format}) · Kategorie {k.text} · Lauf-ID{" "}
            {stand.laufId.slice(0, 8)}…{offeneLaufId === stand.laufId ? " (dieselbe wie beim Versuch mit unbekanntem Ausgang)" : " (neu)"}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              onClick={() => void starten()}
              className="min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity"
              data-text-erzeugen-start
            >
              Ja, bezahlten Lauf starten
            </button>
            <button type="button" onClick={() => setStand({ art: "zu" })} className="min-h-11 px-4 py-2 rounded-lg text-xs bg-surface-elevated text-foreground hover:opacity-80 transition-opacity" data-text-erzeugen-zurueck>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      <div aria-live="polite">
        {stand.art === "laeuft" && (
          <p className="mt-2" style={{ color: "var(--gp-ink-3)" }} data-text-erzeugen-laeuft>
            Pipeline läuft … (bis zu 6 Stufen; kann einige Minuten dauern) · Lauf-ID {stand.laufId.slice(0, 8)}…
          </p>
        )}
        {stand.art === "ausgang" && (
          <p className="mt-2 break-words" style={{ color: farbe(stand.ausgang) }} data-text-erzeugen-ausgang={stand.ausgang.art}>
            {stand.ausgang.text}
          </p>
        )}
      </div>
    </div>
  );
}
