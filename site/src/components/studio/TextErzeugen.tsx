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
//   bezahlten Lauf zu starten. Nach einem bekannten Ausgang gilt die ID als verbraucht.
// - Nach einem Ausgang mit Zeile lädt das Studio neu (fertig), die Caption erscheint als Asset-Karte.
// Keine Zahl ohne Quelle: Gemessene Kosten je Lauf gibt es vorab nicht; die Antwort nennt die geschätzten Kosten des Laufs.

import { useRef, useState } from "react";
import { FARBE_BERNSTEIN, FARBE_GRUEN, FARBE_ROT, istObjekt, maskiert } from "@/components/studio/beleg-hilfen";

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
  | { art: "existiert"; contentId: number | null; text: string }
  | { art: "abgewiesen"; text: string }
  | { art: "abgebrochen"; contentId: number | null; text: string }
  | { art: "nicht_gestartet"; text: string }
  | { art: "unbekannt"; contentId: number | null; text: string };

const AUSGANG_UNBEKANNT = "Ausgang unbekannt — der Lauf kann noch laufen; „Erneut senden“ schickt dieselbe Lauf-ID (kein zweiter bezahlter Lauf)";

function eintragsNummer(d: Record<string, unknown> | null): number | null {
  if (!d) return null;
  for (const w of [d.content_id, d.contentId]) {
    if (typeof w === "number" && Number.isInteger(w) && w > 0) return w;
    if (typeof w === "string" && /^[1-9]\d*$/.test(w)) return Number(w);
  }
  return null;
}

function kostenText(d: Record<string, unknown>): string {
  const s = istObjekt(d.summary) ? d.summary : null;
  const usd = s && typeof s.total_cost_usd === "number" ? s.total_cost_usd : null;
  return usd === null ? "Kosten nicht gemeldet" : `geschätzt $${usd.toFixed(4)}${s && s.kosten_unvollstaendig ? " (mindestens; unvollständig)" : ""}`;
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
  const fehler = d && typeof d.fehler === "string" && d.fehler.trim() ? d.fehler : null;
  if (d && status === 409) {
    return { art: "existiert", contentId: nummer, text: maskiert(`Lauf existiert bereits${nummer === null ? "" : ` (#${nummer})`} — kein zweiter Lauf gestartet${fehler ? ` · ${fehler}` : ""}`) };
  }
  if (d && status >= 400 && status < 500) return { art: "abgewiesen", text: maskiert(`Lauf abgewiesen (HTTP ${status}): ${fehler ?? "ohne Fehlertext"}`) };
  if (d && fehler !== null) {
    if (nummer !== null || d.status === "fehler") return { art: "abgebrochen", contentId: nummer, text: maskiert(`Lauf abgebrochen (HTTP ${status}${nummer === null ? "" : `, Caption #${nummer}`}): ${fehler}`) };
    return { art: "nicht_gestartet", text: maskiert(`Lauf nicht gestartet (HTTP ${status}): ${fehler}`) };
  }
  return { art: "unbekannt", contentId: nummer, text: `${AUSGANG_UNBEKANNT} · HTTP ${status} ohne lesbare Antwort` };
}

type Stand = { art: "zu" } | { art: "bestaetigen"; laufId: string } | { art: "laeuft"; laufId: string } | { art: "ausgang"; ausgang: LaufAusgang };

/** Ein Lauf über holen (fetch). Wirft nie — jeder Fehler wird zum Ausgang. */
export async function sendeCaptionLauf(holen: Holen, koerper: ReturnType<typeof laufKoerper>): Promise<LaufAusgang> {
  try {
    const res = await holen("/api/content/pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(koerper), cache: "no-store" });
    return laufAusgang(res.status, await res.json().catch(() => null));
  } catch (e) {
    return laufAusgang(null, { fehler: `Netzfehler: ${e instanceof Error ? e.message : "unbekannt"}` });
  }
}

export function TextErzeugen({
  slug,
  medium,
  holen,
  fertig,
}: {
  slug: string;
  medium: { id: number; sha256: string };
  holen: Holen;
  fertig: () => void;
}) {
  const [wahl, setWahl] = useState<string>(CAPTION_WAHL[0].wert);
  const [kategorie, setKategorie] = useState<string>(KATEGORIEN[0].wert);
  const [stand, setStand] = useState<Stand>({ art: "zu" });
  // R10: Lauf-ID eines Versuchs mit unbekanntem Ausgang — der nächste Versuch sendet genau sie.
  const [offeneLaufId, setOffeneLaufId] = useState<string | null>(null);
  // Ein Klick, ein Lauf: Ein zweiter Klick, bevor die Ansicht neu gezeichnet ist, sendet nichts.
  const sendet = useRef(false);
  const gesperrt = stand.art === "bestaetigen" || stand.art === "laeuft";
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
    try {
      setStand({ art: "laeuft", laufId });
      setOffeneLaufId(laufId);
      const ausgang = await sendeCaptionLauf(holen, laufKoerper(slug, medium.id, wahl, kategorie, laufId));
      setStand({ art: "ausgang", ausgang });
      // Nach einem bekannten Ausgang ist die ID verbraucht; nach einem unbekannten bleibt sie für den nächsten Versuch.
      setOffeneLaufId(ausgang.art === "unbekannt" ? laufId : null);
      if ("contentId" in ausgang && ausgang.contentId !== null) fertig();
    } finally {
      sendet.current = false;
    }
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
      {stand.art !== "bestaetigen" && stand.art !== "laeuft" && (
        <button
          type="button"
          onClick={zeigen}
          className="mt-2 min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity"
          data-text-erzeugen-knopf
        >
          {offeneLaufId === null ? "Text erzeugen …" : "Erneut senden …"}
        </button>
      )}
      {stand.art === "bestaetigen" && (
        <div className="mt-2 rounded-lg p-3 break-words" style={{ border: `1px solid ${FARBE_BERNSTEIN}` }} role="group" aria-label="Bezahlten Lauf bestätigen" data-text-erzeugen-bestaetigung>
          <p className="font-semibold" style={{ color: FARBE_BERNSTEIN }}>
            Bezahlter Lauf (Claude): bis zu 6 Stufen — RESEARCHER, SCRIBE, COUNSEL, PUBLISHER, COUNSEL 2, AMPLIFIER.
          </p>
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
