"use client";

// Prüfansicht eines Videos im Objekt-Studio (Schritt 8, 10.11.2026).
//
// - Video in voller Bildrate über die Datei-Route (302 auf eine signierte URL nach dem Nachhashen); abgespielt wird
//   zuerst der Export, das Original nur auf Wunsch (es ist groß). Einzelbild-Schritt ± 1 Bild (auf die Mitte des
//   Nachbarbilds, siehe schrittZiel), Zeitlupe.
// - Bildzähler: requestVideoFrameCallback sammelt die distinkten Bildnummern round(mediaTime × fps) und zeigt
//   „Einzelbilder gesehen: n von N“ mit N = round(dauer_s × fps) aus dem Beleg. Bietet der Browser die Funktion nicht,
//   steht das da. Der Zähler ist eine Hilfe; die Durchsicht in voller Bildrate erklärt der Prüfer.
// - Daneben der Ausschnitt des Ankers (öffentliche Datei auf steinadel.de, nach dem Rezept des Startbilds).
// - Checkliste: jede Prompt-Klausel, Anker-Abgleich (Architektur, Personen, Wasser), KI-Hinweis vom ersten bis zum
//   letzten Bild, Durchsicht in voller Bildrate, Rechte und Kürzel. Das Rechtefeld steht anfangs auf „offen“; die
//   Anker-ID steht daneben. Den Nachweis-Verweis tippt der Prüfer — im Code steht keiner.
// - Gespeichert wird über POST …/medien/[id]/pruefung; das Urteil berechnet der Server mit der Medien-Regel.

import { useEffect, useRef, useState } from "react";
import { KI_HINWEIS_BILD } from "@/lib/studio/ki-hinweis";
import type { AnkerEintrag } from "@/lib/studio/anker";
import type { Ausschnitt, MedienKette } from "@/lib/studio/typen";
import { FARBE_BERNSTEIN, FARBE_GRUEN, FARBE_ROT, istObjekt, maskiert } from "@/components/studio/beleg-hilfen";

export type Holen = (url: string, init?: RequestInit) => Promise<Response>;

// ── Reine Helfer (getestet in tests/m-pruefung.test.mjs) ──

/** Einzelbild-Schritt in Sekunden: genau 1/fps; null ohne lesbare Bildrate. */
export function bildSchritt(fps: number | null): number | null {
  return fps !== null && Number.isFinite(fps) && fps > 0 ? 1 / fps : null;
}

/** Zahl der Einzelbilder laut Beleg: round(dauer_s × fps); null ohne Angaben. */
export function bilderGesamt(dauer: number | null, fps: number | null): number | null {
  if (dauer === null || fps === null || !Number.isFinite(dauer) || !Number.isFinite(fps) || dauer <= 0 || fps <= 0) return null;
  return Math.round(dauer * fps);
}

/** Bildnummer eines Zeitpunkts: round(mediaTime × fps). */
export function bildNummer(mediaTime: number, fps: number): number {
  return Math.round(mediaTime * fps);
}

/**
 * Ziel des Einzelbild-Schritts (Nachbesserung regel8-1): die MITTE des Nachbarbilds, (n + richtung + 0,5)/fps, mit
 * n = Bild unter der aktuellen Zeit. Chrome speichert currentTime auf ganze µs abgeschnitten (1/24 → 0,041666), die
 * Bilder liegen aber auf gerundeten Zeitstempeln (Bild 1 bei 0,041667): Ein Sprung genau auf die Bildgrenze zeigte
 * das vorige Bild — der erste Druck wirkte nicht, rückwärts fehlte ein Bild. Die Mitte liegt eine halbe Bilddauer
 * von jeder Grenze entfernt. n wird auf das letzte Bild gekappt (am Ende steht die Zeit auf der Dauer, hinter dem
 * letzten Bild); das Ziel bleibt zwischen dem ersten und dem letzten Bild.
 */
export function schrittZiel(aktuell: number, richtung: 1 | -1, fps: number, gesamt: number | null): number {
  const letztes = gesamt !== null && gesamt > 0 ? gesamt - 1 : Number.POSITIVE_INFINITY;
  const n = Math.min(Math.max(Math.floor(aktuell * fps + 1e-6), 0), letztes);
  const ziel = Math.min(Math.max(n + richtung, 0), letztes);
  return (ziel + 0.5) / fps;
}

/** Zähler der distinkten Einzelbilder: dasselbe Bild zählt einmal, egal wie oft es gezeigt wird. */
export function bildZaehler(fps: number) {
  const gesehen = new Set<number>();
  return {
    sieh(mediaTime: number): number {
      gesehen.add(bildNummer(mediaTime, fps));
      return gesehen.size;
    },
    get anzahl(): number {
      return gesehen.size;
    },
  };
}

export type Wahl = "bestanden" | "nicht_bestanden" | null;

export interface PruefEingaben {
  klauseln: Record<string, Wahl>;
  architektur: Wahl;
  personen: Wahl;
  wasser: Wahl;
  hinweis: Wahl;
  durchsicht: boolean;
  rechte: "offen" | "geklaert";
  nachweis: string;
  kuerzel: string;
  notiz: string;
}

export function leereEingaben(klauseln: ReadonlyArray<{ id: string }>): PruefEingaben {
  return {
    klauseln: Object.fromEntries(klauseln.map((k) => [k.id, null])),
    architektur: null,
    personen: null,
    wasser: null,
    hinweis: null,
    durchsicht: false,
    rechte: "offen",
    nachweis: "",
    kuerzel: "",
    notiz: "",
  };
}

/** Was vor dem Speichern fehlt: Kürzel, jede Klausel, jeder Anker-Punkt, der KI-Hinweis, bei „geklärt“ der Verweis. */
export function eingabenFehler(e: PruefEingaben, klauseln: ReadonlyArray<{ id: string }>): string[] {
  const f: string[] = [];
  if (!/^[A-Za-z]{2,6}$/.test(e.kuerzel.trim())) f.push("Kürzel (2–6 Buchstaben)");
  for (const k of klauseln) if (e.klauseln[k.id] === null || e.klauseln[k.id] === undefined) f.push(`Klausel „${k.id}“`);
  if (klauseln.length === 0) f.push("Prompt-Klauseln des Originals fehlen");
  for (const [feld, name] of [["architektur", "Architektur"], ["personen", "Personen"], ["wasser", "Wasser"], ["hinweis", "KI-Hinweis"]] as const) {
    if (e[feld] === null) f.push(name);
  }
  if (e.rechte === "geklaert" && e.nachweis.trim() === "") f.push("Nachweis-Verweis zu den Rechten");
  return f;
}

/** Körper für POST …/pruefung: Anker-Abgleich bestanden nur, wenn Architektur, Personen und Wasser bestanden sind. */
export function alsAnfrage(e: PruefEingaben, mediumSha256: string, klauseln: ReadonlyArray<{ id: string }>) {
  return {
    medium_sha256: mediumSha256,
    pruefer_kuerzel: e.kuerzel.trim(),
    klauseln: klauseln.map((k) => ({ id: k.id, bestanden: e.klauseln[k.id] === "bestanden" })),
    anker_abgleich: e.architektur === "bestanden" && e.personen === "bestanden" && e.wasser === "bestanden" ? "bestanden" : "nicht_bestanden",
    ki_hinweis_eingebrannt: e.hinweis === "bestanden",
    durchsicht_volle_bildrate: e.durchsicht,
    rechte_status: e.rechte,
    rechte_nachweis: e.rechte === "geklaert" ? e.nachweis.trim() : null,
    notiz: e.notiz.trim() === "" ? null : e.notiz.trim(),
  };
}

/** CSS für den Ausschnitt des Ankers: Bild so skaliert und verschoben, dass genau das Rezept-Rechteck sichtbar ist. */
export function ausschnittStil(a: Ausschnitt, anker: Pick<AnkerEintrag, "breite" | "hoehe">) {
  const prozent = (x: number) => `${Math.round(x * 1e6) / 1e4}%`;
  return {
    rahmen: { aspectRatio: `${a.breite} / ${a.hoehe}` },
    bild: { width: prozent(anker.breite / a.breite), left: prozent(-a.x / a.breite), top: prozent(-a.y / a.hoehe) },
  };
}

// ── Ansicht ──

function Auswahl({ name, wert, setze, titel, daten }: { name: string; wert: Wahl; setze: (w: Wahl) => void; titel: string; daten: string }) {
  return (
    <fieldset className="min-w-0" data-pruefpunkt={daten}>
      <legend className="text-[11px] break-words" style={{ color: "var(--gp-ink)" }}>
        {titel}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[11px]">
        {(["bestanden", "nicht_bestanden"] as const).map((w) => (
          <label key={w} className="inline-flex items-center gap-1.5 min-h-8">
            <input type="radio" name={name} checked={wert === w} onChange={() => setze(w)} />
            {w === "bestanden" ? "bestanden" : "nicht bestanden"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type SpeicherStand = { art: "bereit" } | { art: "laeuft" } | { art: "fehler"; text: string } | { art: "fertig"; urteil: string; gruende: string[]; id: number | null };

export function PruefAnsicht({
  slug,
  kette,
  anker,
  dateiAdresse,
  holen,
  gespeichert,
}: {
  slug: string;
  kette: MedienKette;
  anker: AnkerEintrag | null;
  dateiAdresse: (id: number) => string;
  holen: Holen;
  gespeichert: () => void;
}) {
  const ex = kette.export;
  const og = kette.original;
  const klauseln = og?.prompt_klauseln ?? [];
  const [quelle, setQuelle] = useState<"export" | "original">("export");
  const video = quelle === "original" && og !== null ? og : ex;
  const fps = video.fps;
  const schritt = bildSchritt(fps);
  const gesamt = bilderGesamt(video.dauer_s, fps);
  // Zählung je Video-Quelle; beim Wechsel der Quelle beginnt sie bei 0 (ohne setState im Effekt).
  const [zaehlung, setZaehlung] = useState<{ quelle: string; n: number }>({ quelle: "", n: 0 });
  const [tempo, setTempo] = useState(1);
  const ref = useRef<HTMLVideoElement | null>(null);
  const [eingaben, setEingaben] = useState<PruefEingaben>(() => leereEingaben(klauseln));
  const [stand, setStand] = useState<SpeicherStand>({ art: "bereit" });
  const fehlt = eingabenFehler(eingaben, klauseln);
  const quelleAdresse = dateiAdresse(video.id);
  const gesehen = zaehlung.quelle === quelleAdresse ? zaehlung.n : 0;
  const zaehlerFehlt = typeof HTMLVideoElement !== "undefined" && typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function";

  // Bildzähler je Video-Quelle; requestVideoFrameCallback meldet jedes dargestellte Bild mit seiner mediaTime.
  useEffect(() => {
    const v = ref.current;
    if (v === null || fps === null || typeof v.requestVideoFrameCallback !== "function") return;
    const zaehler = bildZaehler(fps);
    let griff = 0;
    const melde: VideoFrameRequestCallback = (_jetzt, meta) => {
      setZaehlung({ quelle: quelleAdresse, n: zaehler.sieh(meta.mediaTime) });
      griff = v.requestVideoFrameCallback(melde);
    };
    griff = v.requestVideoFrameCallback(melde);
    return () => v.cancelVideoFrameCallback(griff);
  }, [quelleAdresse, fps]);

  function springe(richtung: 1 | -1) {
    const v = ref.current;
    if (v === null || schritt === null || fps === null) return;
    v.pause();
    // Bildzahl aus der Dauer des geladenen Videos; ohne lesbare Dauer die aus dem Beleg.
    const dauer = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : video.dauer_s;
    v.currentTime = schrittZiel(v.currentTime, richtung, fps, bilderGesamt(dauer, fps));
  }

  const setzeTempo = (t: number) => {
    setTempo(t);
    if (ref.current) ref.current.playbackRate = t;
  };

  const setze = <K extends keyof PruefEingaben>(feld: K) => (wert: PruefEingaben[K]) => {
    setEingaben((e) => ({ ...e, [feld]: wert }));
    setStand({ art: "bereit" });
  };

  async function speichern() {
    if (eingabenFehler(eingaben, klauseln).length > 0) return;
    setStand({ art: "laeuft" });
    let status: number | null = null;
    let daten: unknown = null;
    try {
      const res = await holen(`/api/studio/${encodeURIComponent(slug)}/medien/${ex.id}/pruefung`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alsAnfrage(eingaben, ex.sha256, klauseln)),
        cache: "no-store",
      });
      status = res.status;
      daten = await res.json().catch(() => null);
    } catch (e) {
      setStand({ art: "fehler", text: `Netzfehler: ${maskiert(e instanceof Error ? e.message : "unbekannt")}` });
      return;
    }
    const obj = istObjekt(daten) ? daten : null;
    if (status === 200 && obj && typeof obj.urteil === "string" && Array.isArray(obj.gruende)) {
      setStand({ art: "fertig", urteil: obj.urteil, gruende: obj.gruende.filter((g): g is string => typeof g === "string"), id: typeof obj.pruefung_id === "number" ? obj.pruefung_id : null });
      gespeichert();
      return;
    }
    const text = obj && typeof obj.fehler === "string" ? obj.fehler : "ohne Fehlertext";
    setStand({ art: "fehler", text: maskiert(`${text} (HTTP ${status})`) });
  }

  const sb = kette.startbild;
  const stil = sb?.ausschnitt && anker ? ausschnittStil(sb.ausschnitt, anker) : null;
  const hinweisPasst = ex.ki_hinweis_text === KI_HINWEIS_BILD;

  return (
    <div className="mt-3 min-w-0" data-pruefansicht={ex.id}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="min-w-0">
          <video
            key={quelleAdresse}
            ref={ref}
            src={quelleAdresse}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded bg-black"
            data-pruef-video={quelle}
            onLoadedMetadata={(e) => {
              e.currentTarget.playbackRate = tempo;
            }}
            onError={() => setStand({ art: "fehler", text: "Video nicht ladbar — die signierte URL gilt 10 min; bitte die Ansicht neu öffnen." })}
          />
          <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
            <button type="button" onClick={() => springe(-1)} aria-disabled={schritt === null} className="min-h-11 px-3 rounded-lg bg-surface-elevated aria-disabled:opacity-40" data-bild-zurueck>
              − 1 Bild
            </button>
            <button type="button" onClick={() => springe(1)} aria-disabled={schritt === null} className="min-h-11 px-3 rounded-lg bg-surface-elevated aria-disabled:opacity-40" data-bild-vor>
              + 1 Bild
            </button>
            <label className="inline-flex items-center gap-1.5">
              Tempo
              <select value={tempo} onChange={(e) => setzeTempo(Number(e.currentTarget.value))} className="rounded bg-surface-elevated px-2 py-1" data-tempo>
                <option value={0.25}>0,25×</option>
                <option value={0.5}>0,5×</option>
                <option value={1}>1×</option>
              </select>
            </label>
            {og !== null && (
              <button
                type="button"
                onClick={() => setQuelle((q) => (q === "export" ? "original" : "export"))}
                className="min-h-11 px-3 rounded-lg bg-surface-elevated"
                data-quelle-wechsel
              >
                {quelle === "export" ? "Original abspielen (groß)" : "Export abspielen"}
              </button>
            )}
          </div>
          <p className="text-[11px] mt-1 break-words" style={{ color: gesamt !== null && gesehen >= gesamt ? FARBE_GRUEN : "var(--gp-ink-2)" }} data-bildzaehler={`${gesehen}/${gesamt ?? "?"}`}>
            {zaehlerFehlt
              ? "Bildzähler: Dieser Browser meldet keine Einzelbilder (requestVideoFrameCallback fehlt)."
              : `Einzelbilder gesehen: ${gesehen} von ${gesamt ?? "unbekannt (Bildrate oder Dauer fehlt im Beleg)"}`}
            {schritt !== null ? ` · Einzelbild-Schritt ${(schritt * 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} ms (1/${fps} s)` : ""}
          </p>
        </div>
        <div className="min-w-0" data-anker-ausschnitt={anker?.id ?? "fehlt"}>
          {anker && stil ? (
            <>
              <div className="relative overflow-hidden rounded w-full" style={stil.rahmen}>
                {/* Öffentliche Anker-Datei auf steinadel.de; kein next/image (keine Optimierung, keine Kopie). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={anker.url} alt={`Anker ${anker.id}, Ausschnitt des Startbilds (Visualisierung)`} className="absolute max-w-none" style={stil.bild} loading="lazy" />
              </div>
              <p className="text-[10px] text-text-muted mt-1 break-words">
                Anker {anker.id} (Visualisierung) · Ausschnitt {sb?.ausschnitt?.breite}×{sb?.ausschnitt?.hoehe} bei ({sb?.ausschnitt?.x}, {sb?.ausschnitt?.y})
              </p>
            </>
          ) : (
            <p className="text-[11px]" style={{ color: FARBE_BERNSTEIN }}>
              Anker oder Ausschnitt nicht verfügbar — Vergleich nur mit der Anker-Datei selbst.
            </p>
          )}
        </div>
      </div>

      <form
        className="mt-4 space-y-3 min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          if (fehlt.length === 0 && stand.art !== "laeuft") void speichern();
        }}
      >
        <p className="mono-label">Prompt-Klauseln (jede einzeln)</p>
        {klauseln.length === 0 && <p className="text-[11px]" style={{ color: FARBE_ROT }}>Das Original nennt keine Prompt-Klauseln.</p>}
        {klauseln.map((k) => (
          <Auswahl
            key={k.id}
            name={`klausel-${ex.id}-${k.id}`}
            wert={eingaben.klauseln[k.id] ?? null}
            setze={(w) => setEingaben((e) => ({ ...e, klauseln: { ...e.klauseln, [k.id]: w } }))}
            titel={`${k.id}: ${maskiert(k.text)}`}
            daten={`klausel-${k.id}`}
          />
        ))}
        <p className="mono-label">Abgleich mit dem Anker</p>
        <Auswahl name={`architektur-${ex.id}`} wert={eingaben.architektur} setze={setze("architektur")} titel="Architektur wie im Anker (Gebäude, Fenster, Dach, Treppen)" daten="architektur" />
        <Auswahl name={`personen-${ex.id}`} wert={eingaben.personen} setze={setze("personen")} titel="Personen wie im Anker, keine erfundenen" daten="personen" />
        <Auswahl name={`wasser-${ex.id}`} wert={eingaben.wasser} setze={setze("wasser")} titel="Wasser und Brunnen wie im Anker" daten="wasser" />
        <p className="mono-label">KI-Hinweis</p>
        <p className="text-[10px] break-words" style={{ color: hinweisPasst ? "var(--gp-ink-3)" : FARBE_ROT }} data-hinweis-wortlaut={hinweisPasst ? "passt" : "weicht-ab"}>
          Festgelegt: „{KI_HINWEIS_BILD}“ · im Export laut Beleg: „{maskiert(ex.ki_hinweis_text ?? "nicht angegeben")}“
        </p>
        <Auswahl name={`hinweis-${ex.id}`} wert={eingaben.hinweis} setze={setze("hinweis")} titel="Hinweis vom ersten bis zum letzten Bild eingebrannt" daten="hinweis" />
        <label className="flex items-start gap-2 text-[11px]">
          <input type="checkbox" checked={eingaben.durchsicht} onChange={(e) => setze("durchsicht")(e.currentTarget.checked)} className="mt-0.5" data-durchsicht />
          <span>Ich habe das Video in voller Bildrate durchgesehen (Erklärung des Prüfers; der Bildzähler ist eine Hilfe).</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-[11px] min-w-0">
            <span className="mono-label block">Rechte · Anker {anker?.id ?? ex.anker_id}</span>
            <select value={eingaben.rechte} onChange={(e) => setze("rechte")(e.currentTarget.value === "geklaert" ? "geklaert" : "offen")} className="mt-1 w-full rounded bg-surface-elevated px-2 py-1" data-rechte>
              <option value="offen">offen</option>
              <option value="geklaert">geklärt (mit Nachweis-Verweis)</option>
            </select>
          </label>
          <label className="block text-[11px] min-w-0">
            <span className="mono-label block">Nachweis-Verweis</span>
            <input
              value={eingaben.nachweis}
              onChange={(e) => setze("nachweis")(e.currentTarget.value)}
              maxLength={300}
              disabled={eingaben.rechte !== "geklaert"}
              className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1 disabled:opacity-40"
              data-nachweis
            />
          </label>
          <label className="block text-[11px] min-w-0">
            <span className="mono-label block">Kürzel des Prüfers</span>
            <input value={eingaben.kuerzel} onChange={(e) => setze("kuerzel")(e.currentTarget.value)} maxLength={6} className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1" data-kuerzel />
          </label>
          <label className="block text-[11px] min-w-0">
            <span className="mono-label block">Notiz</span>
            <input value={eingaben.notiz} onChange={(e) => setze("notiz")(e.currentTarget.value)} maxLength={1000} className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1" data-notiz />
          </label>
        </div>
        {fehlt.length > 0 && (
          <p className="text-[10px] text-text-muted break-words" data-pruef-fehlt>
            Noch offen: {fehlt.join(" · ")}
          </p>
        )}
        <button
          type="submit"
          aria-disabled={fehlt.length > 0 || stand.art === "laeuft"}
          className="min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
          data-protokoll-speichern
        >
          Prüfprotokoll speichern
        </button>
        <div aria-live="polite">
          {stand.art === "laeuft" && <p className="text-[11px]" style={{ color: "var(--gp-ink-3)" }}>Speichert … (Server hasht die Datei nach)</p>}
          {stand.art === "fehler" && (
            <p className="text-[11px] break-words" style={{ color: FARBE_ROT }} role="alert" data-pruef-fehler>
              {stand.text}
            </p>
          )}
          {stand.art === "fertig" && (
            <div className="text-[11px] break-words" data-pruef-ergebnis={stand.urteil}>
              <p style={{ color: stand.urteil === "bestanden" ? FARBE_GRUEN : FARBE_ROT }}>
                Protokoll {stand.id === null ? "" : `#${stand.id} `}gespeichert · Urteil der Medien-Regel: {stand.urteil === "bestanden" ? "freigebbar" : "gesperrt"}
              </p>
              {stand.gruende.length > 0 && (
                <ul className="list-disc pl-5 mt-1">
                  {stand.gruende.map((g) => (
                    <li key={g}>{maskiert(g)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
