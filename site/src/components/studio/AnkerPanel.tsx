"use client";

// Anker-Panel des Objekt-Studios (Schritt 6, 10.11.2026). Client-Baustein mit eigenem Zustand; die Grenze
// steht hier, nicht nur auf der Seite, damit das Panel auch in einer Server-Komponente eingebettet laufen kann.
//
// Zeigt das Anker-Manifest (lib/studio/anker.ts) je Bild mit Art, Maßen, Exposé-Seite, Personen und
// Herkunft, dazu den Hash-Status aus /api/studio/[objekt]/anker — „unverändert“, „geändert“ oder
// „nicht erreichbar“, jeweils mit Messzeitpunkt — und den Abgleich von urls.cover im Steinadel-Export.
// Beim Aufbau liest das Panel per GET das letzte Ergebnis des Servers (Zwischenspeicher bis 15 min, das Alter
// steht dabei); „Alle prüfen“ verlangt per POST eine frische Prüfung (höchstens eine je 60 s, sonst das letzte
// Ergebnis mit Hinweis). Es gibt keinen Takt, also auch nichts, das im verborgenen Tab pausieren müsste. Die
// Prüfung lädt auf dem Server nur die Dateien des Manifests und kostet keinen bezahlten Aufruf.
// Maße und Größe stammen aus der Messung des Manifests, Status und Zeitpunkte aus der Prüfung; ohne
// Prüfergebnis steht „wird geprüft …“ bzw. „nicht geprüft“ da, nie eine Zahl als Platzhalter. Texte des
// Servers erscheinen maskiert. Zeiten in Europe/Berlin mit Zonenangabe, wie im übrigen Studio.

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  COVER_STATUS_TEXT,
  HASH_STATUS_TEXT,
  ankerManifest,
  artText,
  dateiPfad,
  kurzHash,
  personenText,
} from "@/lib/studio/anker";
import type { AnkerEintrag, AnkerManifest } from "@/lib/studio/anker";
import type { AnkerAntwort, AnkerHashErgebnis, AnkerStand, CoverErgebnis } from "@/lib/studio/typen";
import { berlinDatumZeit } from "@/lib/types";
import { FARBE_BERNSTEIN, FARBE_GRUEN, FARBE_ROT, istObjekt, maskiert } from "@/components/studio/beleg-hilfen";

/** Prüfergebnis der Route; stand (Zwischenspeicher) fehlt bei einer Antwort, die ihn nicht kennt. */
export type AnkerDaten = AnkerAntwort & { stand?: unknown };

/** Stand der Prüfung: läuft, abgewiesen (HTTP-Fehler oder Netz) oder Ergebnis. */
export type AnkerLesung =
  | { art: "laedt" }
  | { art: "abgewiesen"; httpStatus: number | null; text: string }
  | { art: "daten"; antwort: AnkerDaten };

const LAEDT: AnkerLesung = { art: "laedt" };

/** Antwort von /api/studio/[objekt]/anker (GET oder POST) einordnen; der Fehlertext der Route steht sichtbar da. */
export function leseAnkerAntwort(httpStatus: number, daten: unknown): AnkerLesung {
  const obj = istObjekt(daten) ? daten : null;
  if (httpStatus >= 200 && httpStatus < 300) {
    const lesbar =
      obj !== null &&
      Array.isArray(obj.anker) &&
      obj.anker.every((a) => istObjekt(a) && typeof a.id === "string" && typeof a.status === "string") &&
      istObjekt(obj.export_cover) &&
      typeof obj.export_cover.status === "string";
    return lesbar
      ? { art: "daten", antwort: obj as unknown as AnkerDaten }
      : { art: "abgewiesen", httpStatus, text: "Antwort ohne lesbares Prüfergebnis" };
  }
  if (httpStatus === 401) return { art: "abgewiesen", httpStatus, text: "Nicht angemeldet (HTTP 401) — bitte neu anmelden." };
  const feld = obj ? (typeof obj.fehler === "string" && obj.fehler.trim() ? obj.fehler : typeof obj.error === "string" ? obj.error : null) : null;
  return { art: "abgewiesen", httpStatus, text: maskiert(`${feld ?? "ohne Fehlertext"} (HTTP ${httpStatus})`) };
}

// ── Texte ──

/** Zeitpunkt in Europe/Berlin mit Zonenangabe; sonst der Ersatztext. */
function zeitBerlin(iso: unknown, ersatz: string): string {
  const t = typeof iso === "string" ? berlinDatumZeit(iso) : null;
  return t === null ? ersatz : `${t} (Europe/Berlin)`;
}

function zahl(n: number): string {
  return n.toLocaleString("de-DE");
}

/** stand der Antwort, wenn vollständig lesbar; sonst null (dann ohne Alter und Grenzen angezeigt). */
export function leseStand(wert: unknown): AnkerStand | null {
  if (!istObjekt(wert)) return null;
  const { frisch, gedrosselt, alter_s, gueltig_bis, naechste_frische_ab } = wert;
  if (typeof frisch !== "boolean" || typeof gedrosselt !== "boolean") return null;
  if (typeof alter_s !== "number" || !Number.isFinite(alter_s) || alter_s < 0) return null;
  if (typeof gueltig_bis !== "string" || typeof naechste_frische_ab !== "string") return null;
  return { frisch, gedrosselt, alter_s, gueltig_bis, naechste_frische_ab };
}

/** Alter für die Anzeige: „weniger als 1 min“, „1 min“, „7 min“ … */
function alterText(sekunden: number): string {
  return sekunden < 60 ? "weniger als 1 min" : `${Math.floor(sekunden / 60)} min`;
}

/** Wann geprüft wurde und woher das Ergebnis kommt — frisch oder aus dem Zwischenspeicher, mit Alter. */
export function pruefStandText(antwort: AnkerDaten): string {
  const zeit = zeitBerlin(antwort.erzeugt_am, "ohne Zeitpunkt");
  const stand = leseStand(antwort.stand);
  if (stand === null) return `geprüft ${zeit}`;
  if (stand.frisch) return `frisch geprüft ${zeit}`;
  return `geprüft ${zeit}, vor ${alterText(stand.alter_s)} · aus dem Zwischenspeicher, gültig bis ${zeitBerlin(stand.gueltig_bis, "ohne Zeitpunkt")}`;
}

function istHashStatus(s: unknown): s is keyof typeof HASH_STATUS_TEXT {
  return typeof s === "string" && Object.hasOwn(HASH_STATUS_TEXT, s);
}

function istCoverStatus(s: unknown): s is keyof typeof COVER_STATUS_TEXT {
  return typeof s === "string" && Object.hasOwn(COVER_STATUS_TEXT, s);
}

const STATUS_FARBE = { unveraendert: FARBE_GRUEN, geaendert: FARBE_ROT, nicht_erreichbar: FARBE_BERNSTEIN, nicht_lesbar: FARBE_BERNSTEIN };

/** Bestand des Manifests in einem Satz, aus den Einträgen gezählt. */
export function bestandText(m: AnkerManifest): string {
  const anker = m.eintraege.filter((e) => e.als_anker);
  const ohne = m.eintraege.length - anker.length;
  const alleVisualisierung = anker.every((e) => e.art === "visualisierung");
  return [
    `${m.eintraege.length} Bilder im Manifest`,
    `${anker.length} als Anker zulässig${alleVisualisierung ? ", alle Visualisierungen (Renderings), keine Fotos" : ""}`,
    ohne > 0 ? `${ohne} ohne Ankerfunktion` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function exposeText(e: AnkerEintrag): string {
  if (e.art === "ki_stimmungsbild") return "entfällt (KI-Bild, nicht aus dem Exposé)";
  return e.herkunft.expose_seite === null ? "nicht belegt" : `S. ${e.herkunft.expose_seite}`;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Ein SHA-256 des Servers nur als 64 Hex-Zeichen; alles andere gilt als nicht lesbar (und erscheint nie roh). */
function hex(wert: unknown): string | null {
  return typeof wert === "string" && HEX64.test(wert) ? wert : null;
}

/**
 * Prüft der Server gegen einen anderen Manifest-Stand als diese Seite (etwa ein alter Tab nach einem Deploy)?
 * Liefert die Gründe oder null. Verglichen werden Messzeitpunkt, Einträge, Hashes und der Cover-Anker.
 */
export function standAbweichung(m: AnkerManifest, antwort: AnkerAntwort): string | null {
  const je = new Map(m.eintraege.map((e) => [e.id, e]));
  const unbekannt = antwort.anker.filter((a) => !je.has(a.id)).length;
  const hashAnders = antwort.anker.some((a) => {
    const e = je.get(a.id);
    return e !== undefined && hex(a.sha256_soll) !== e.sha256;
  });
  const cover = je.get(m.cover_anker);
  const c = antwort.export_cover;
  const gruende = [
    antwort.manifest_gemessen_am !== m.gemessen_am ? "anderer Messzeitpunkt" : null,
    unbekannt > 0 ? (unbekannt === 1 ? "1 Ergebnis ohne Eintrag auf dieser Seite" : `${unbekannt} Ergebnisse ohne Eintrag auf dieser Seite`) : null,
    hashAnders ? "andere Soll-Hashes" : null,
    c.anker_id !== m.cover_anker || cover === undefined || c.soll !== cover.url ? "anderer Cover-Anker" : null,
  ].filter((g): g is string => g !== null);
  return gruende.length > 0 ? gruende.join(", ") : null;
}

/** Zusammenfassung der Hash-Status über alle Manifest-Einträge; Einträge ohne Ergebnis zählen eigens. */
export function zusammenfassung(m: AnkerManifest, antwort: AnkerAntwort): { text: string; farbe: string } {
  const jeId = new Map(antwort.anker.map((a) => [a.id, a]));
  const zaehlung = { unveraendert: 0, geaendert: 0, nicht_erreichbar: 0 };
  let ohne = 0;
  for (const e of m.eintraege) {
    const r = jeId.get(e.id);
    if (r !== undefined && istHashStatus(r.status)) zaehlung[r.status] += 1;
    else ohne += 1;
  }
  const teile = (["unveraendert", "geaendert", "nicht_erreichbar"] as const)
    .filter((s) => zaehlung[s] > 0)
    .map((s) => `${zaehlung[s]} ${HASH_STATUS_TEXT[s]}`);
  if (ohne > 0) teile.push(`${ohne} ohne Ergebnis`);
  const abweichung = standAbweichung(m, antwort) !== null;
  const farbe = zaehlung.geaendert > 0 ? FARBE_ROT : zaehlung.nicht_erreichbar > 0 || ohne > 0 || abweichung ? FARBE_BERNSTEIN : FARBE_GRUEN;
  return { text: `Hash-Status: ${teile.join(" · ")}`, farbe };
}

// ── Bausteine ──

function Feld({ titel, breit, children, ...daten }: { titel: string; breit?: boolean; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <div className={breit ? "min-w-0 @sm:col-span-2" : "min-w-0"}>
      <dt className="mono-label">{titel}</dt>
      <dd className="break-words" {...daten}>
        {children}
      </dd>
    </div>
  );
}

function HashStatus({ e, r, lesung }: { e: AnkerEintrag; r: AnkerHashErgebnis | undefined; lesung: AnkerLesung }) {
  if (lesung.art === "laedt") {
    return (
      <span style={{ color: "var(--gp-ink-3)" }} data-hash="laedt">
        wird geprüft …
      </span>
    );
  }
  if (lesung.art === "abgewiesen") {
    return (
      <span style={{ color: "var(--gp-ink-3)" }} data-hash="nicht_geprueft">
        nicht geprüft — Prüfung nicht lesbar
      </span>
    );
  }
  if (r === undefined || !istHashStatus(r.status)) {
    return (
      <span style={{ color: FARBE_BERNSTEIN }} data-hash="ohne_ergebnis">
        kein Ergebnis für diese Datei
      </span>
    );
  }
  const sollServer = hex(r.sha256_soll);
  const soll = sollServer ?? e.sha256;
  const live = hex(r.sha256_live);
  const hash =
    r.status === "unveraendert" ? kurzHash(live ?? soll) : r.status === "geaendert" && live !== null ? `live ${kurzHash(live)} statt ${kurzHash(soll)}` : `Soll ${kurzHash(soll)}`;
  const titel = [
    `SHA-256 laut Manifest: ${soll}`,
    `SHA-256 live: ${live ?? "nicht gelesen"}`,
    `Bytes live: ${typeof r.bytes_live === "number" ? zahl(r.bytes_live) : "nicht gelesen"}`,
    `HTTP: ${typeof r.http_status === "number" ? r.http_status : "keine Antwort"}`,
  ].join("\n");
  // Prüft der Server gegen einen anderen Soll-Hash, ist auch „unverändert“ nicht grün (Gegenprüfung PR #8).
  const anderesSoll = sollServer !== e.sha256;
  return (
    <span title={titel} data-hash={r.status}>
      <span className="font-semibold" style={{ color: anderesSoll ? FARBE_BERNSTEIN : STATUS_FARBE[r.status] }} data-hash-farbe={anderesSoll ? "abweichend" : r.status}>
        {HASH_STATUS_TEXT[r.status]}
      </span>
      {/* wrap-anywhere statt break-all: Wörter wie „statt“ bleiben ganz, ein langer Hash bricht nur, wenn er nicht passt. */}
      <span className="font-[family-name:var(--font-jbmono)] wrap-anywhere"> · {hash}</span>
      <span className="text-text-muted"> · gemessen {zeitBerlin(r.gemessen_am, "ohne Zeitpunkt")}</span>
      {typeof r.hinweis === "string" && r.hinweis !== "" && (
        <span className="block text-[11px] break-words" style={{ color: "var(--gp-ink-2)" }} data-hash-hinweis>
          {maskiert(r.hinweis)}
        </span>
      )}
      {anderesSoll && (
        <span className="block text-[11px] break-words" style={{ color: FARBE_BERNSTEIN }} data-manifest-abweichung>
          Der Server prüft gegen einen anderen Manifest-Stand als diese Seite — bitte die Seite neu laden.
        </span>
      )}
    </span>
  );
}

function AnkerKarte({ e, r, lesung, manifest }: { e: AnkerEintrag; r: AnkerHashErgebnis | undefined; lesung: AnkerLesung; manifest: AnkerManifest }) {
  const artFarbe = e.als_anker ? "var(--gp-gold)" : "var(--gp-ink-3)";
  // Die Felder richten sich nach der Kartenbreite (Container-Query), nicht nach dem Fenster: Ab lg stehen die
  // Karten zweispaltig neben der Seitenleiste und sind schmaler als auf dem Tablet.
  return (
    <article className="card-ghost p-4 min-w-0 @container" data-anker={e.id} data-hash-status={lesung.art === "daten" ? (r?.status ?? "ohne_ergebnis") : lesung.art}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="font-[family-name:var(--font-jbmono)] text-[11px]" style={{ color: "var(--gp-ink)" }}>
          {e.id}
        </span>
        {/* Ohne Großschreibung per CSS: Der Seitentext trägt den Wortlaut, etwa „KI-Stimmungsbild, kein Anker“. */}
        <span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ background: "var(--gp-hairline)", color: artFarbe }} data-anker-art>
          {artText(e)}
        </span>
      </div>
      <p className="text-[11px] wrap-anywhere">
        <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-foreground transition-colors" data-anker-datei>
          {dateiPfad(e.url)}
        </a>
      </p>
      <dl className="grid grid-cols-1 @sm:grid-cols-2 gap-x-4 gap-y-2 mt-3 text-xs">
        <Feld titel="Maße" data-anker-masse={`${e.breite}x${e.hoehe}`}>
          {/* Geschützte Leerzeichen: Zahl und Einheit bleiben zusammen, umbrochen wird nur am „·“. */}
          <span title={`an der Live-Datei gemessen ${zeitBerlin(manifest.gemessen_am, "ohne Zeitpunkt")}`}>
            {`${e.breite}\u00a0×\u00a0${e.hoehe}\u00a0px · ${zahl(e.bytes)}\u00a0B`}
          </span>
        </Feld>
        <Feld titel="Exposé-Seite" data-expose-seite={e.herkunft.expose_seite === null ? "keine" : String(e.herkunft.expose_seite)}>
          {exposeText(e)}
        </Feld>
        <Feld titel="Personen" data-personen={e.personen.stand}>
          {personenText(e.personen)}
        </Feld>
        <Feld titel="Als Anker" data-als-anker={e.als_anker ? "ja" : "nein"}>
          {e.als_anker ? "ja" : "nein"}
        </Feld>
        <Feld titel="Herkunft" breit data-herkunft="">
          {e.herkunft.text}
        </Feld>
        <Feld titel="Hash-Status" breit data-hash-feld="">
          <HashStatus e={e} r={r} lesung={lesung} />
        </Feld>
      </dl>
      {e.hinweis && (
        <p className="text-[11px] mt-2 break-words" style={{ color: "var(--gp-ink-2)" }} data-anker-hinweis>
          {e.hinweis}
        </p>
      )}
    </article>
  );
}

function CoverZeile({ lesung, manifest }: { lesung: AnkerLesung; manifest: AnkerManifest }) {
  const ziel = manifest.eintraege.find((e) => e.id === manifest.cover_anker);
  // Soll als volle Adresse (Gegenprüfung PR #8: der Dateiname allein verbarg Abweichungen in Host oder Protokoll).
  const soll = (
    <span className="wrap-anywhere" data-cover-soll>
      {ziel ? ziel.url : "nicht im Manifest"} (Anker {manifest.cover_anker})
    </span>
  );
  if (lesung.art !== "daten") {
    return (
      <p className="text-[11px] mt-1 break-words" style={{ color: "var(--gp-ink-3)" }} data-export-cover={lesung.art === "laedt" ? "laedt" : "nicht_geprueft"}>
        Export-Cover (urls.cover): {lesung.art === "laedt" ? "wird geprüft …" : "nicht geprüft"} · Soll: {soll}
      </p>
    );
  }
  const c: CoverErgebnis = lesung.antwort.export_cover;
  const status = istCoverStatus(c.status) ? c.status : null;
  return (
    <p className="text-[11px] mt-1 break-words" style={{ color: "var(--gp-ink-2)" }} data-export-cover={status ?? "unbekannt"} title={maskiert(`Quelle: ${c.quelle}`)}>
      Export-Cover (urls.cover):{" "}
      <span className="font-semibold" style={{ color: status === null ? FARBE_BERNSTEIN : STATUS_FARBE[status] }}>
        {status === null ? "unbekannter Status" : COVER_STATUS_TEXT[status]}
      </span>
      {typeof c.ist === "string" && <span className="wrap-anywhere"> · zeigt auf {maskiert(c.ist)}</span>} · Soll: {soll} · geprüft{" "}
      {zeitBerlin(c.gemessen_am, "ohne Zeitpunkt")}
      {typeof c.hinweis === "string" && c.hinweis !== "" && <span className="block">{maskiert(c.hinweis)}</span>}
    </p>
  );
}

/** Ansicht des Panels ohne eigenen Zustand: Manifest, Stand der Prüfung und der Auslöser für „Alle prüfen“. */
export function AnkerAnsicht({ manifest, lesung, pruefen }: { manifest: AnkerManifest; lesung: AnkerLesung; pruefen: () => void }) {
  const laeuft = lesung.art === "laedt";
  const jeId = new Map<string, AnkerHashErgebnis>(lesung.art === "daten" ? lesung.antwort.anker.map((a) => [a.id, a]) : []);
  const summe = lesung.art === "daten" ? zusammenfassung(manifest, lesung.antwort) : null;
  const abweichung = lesung.art === "daten" ? standAbweichung(manifest, lesung.antwort) : null;
  const stand = lesung.art === "daten" ? leseStand(lesung.antwort.stand) : null;
  return (
    <section className="card-ghost p-5 mb-6 min-w-0" data-anker-panel data-pruefung={lesung.art} aria-busy={laeuft}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[10px] text-text-muted uppercase tracking-widest">Anker-Material · {manifest.eintraege.length}</h2>
          <p className="text-[12px] mt-1 break-words" style={{ color: "var(--gp-ink-2)" }} data-anker-bestand>
            {bestandText(manifest)}
          </p>
        </div>
        {/* aria-disabled statt disabled (Gegenprüfung PR #8): Ein gesperrter Knopf verlöre den Tastaturfokus; der
            Klick während einer Prüfung wird hier ignoriert. */}
        <button
          type="button"
          onClick={() => {
            if (!laeuft) pruefen();
          }}
          aria-disabled={laeuft}
          className="shrink-0 min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
          data-alle-pruefen
        >
          Alle prüfen
        </button>
      </div>
      <p className="text-[10px] text-text-muted mt-2 break-words">
        „Alle prüfen“ lädt die {manifest.eintraege.length} Dateien des Manifests neu von steinadel.de, vergleicht ihren SHA-256 mit dem
        Manifest und prüft urls.cover im Export — ohne bezahlte Aufrufe, höchstens einmal je 60 s. Beim Laden der Seite steht das letzte
        Ergebnis des Servers, wenn es jünger als 15 min ist; läuft gerade eine Prüfung, gilt deren Ergebnis. Manifest-Werte gemessen{" "}
        {zeitBerlin(manifest.gemessen_am, "ohne Zeitpunkt")} an den ausgelieferten Dateien.
      </p>
      <div className="mt-3 space-y-1" aria-live="polite">
        {lesung.art === "laedt" && (
          <p className="text-[11px]" style={{ color: "var(--gp-ink-3)" }} data-anker-stand="laedt">
            Prüfung läuft …
          </p>
        )}
        {lesung.art === "abgewiesen" && (
          <p className="text-[11px] break-words" style={{ color: FARBE_ROT }} role="alert" data-anker-stand="abgewiesen">
            Hash-Prüfung nicht lesbar: {maskiert(lesung.text)}
          </p>
        )}
        {lesung.art === "daten" && summe !== null && (
          <p className="text-[11px] break-words" style={{ color: summe.farbe }} data-anker-stand="daten" data-frisch={stand === null ? "unbekannt" : String(stand.frisch)}>
            {summe.text} · {pruefStandText(lesung.antwort)}
          </p>
        )}
        {stand !== null && stand.gedrosselt && (
          <p className="text-[11px] break-words" style={{ color: FARBE_BERNSTEIN }} data-anker-pause>
            Mindestpause: Frisch geprüft wird wieder ab {zeitBerlin(stand.naechste_frische_ab, "ohne Zeitpunkt")}; angezeigt ist das letzte
            Ergebnis.
          </p>
        )}
        {abweichung !== null && (
          <p className="text-[11px] break-words" style={{ color: FARBE_BERNSTEIN }} role="alert" data-manifest-stand="abweichend">
            Der Server prüft gegen einen anderen Manifest-Stand als diese Seite ({abweichung}) — bitte die Seite neu laden.
          </p>
        )}
        <CoverZeile lesung={lesung} manifest={manifest} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {manifest.eintraege.map((e) => (
          <AnkerKarte key={e.id} e={e} r={jeId.get(e.id)} lesung={lesung} manifest={manifest} />
        ))}
      </div>
    </section>
  );
}

/**
 * Anker-Panel mit Prüfung: beim Aufbau GET (letztes Ergebnis des Servers oder eine erste Prüfung), danach je
 * Klick auf „Alle prüfen“ ein POST (frische Prüfung; JSON-Kopf, damit die Herkunftsprüfung der Route greift).
 * Das Ergebnis gehört zu Kennung und Lauf, für die es abgefragt wurde; bis die Antwort zum aktuellen Lauf da
 * ist, steht „wird geprüft …“ (wie die Studio-Seite beim Slug-Wechsel). Abbau oder neuer Lauf brechen die alte
 * Abfrage ab.
 */
export function AnkerPanel({ slug }: { slug: string }) {
  const manifest = ankerManifest(slug);
  const pruefbar = manifest !== null;
  const [lauf, setLauf] = useState(0);
  const [stand, setStand] = useState<{ slug: string; lauf: number; lesung: AnkerLesung } | null>(null);

  useEffect(() => {
    if (!pruefbar) return;
    const steuerung = new AbortController();
    async function pruefen() {
      let lesung: AnkerLesung;
      try {
        const adresse = `/api/studio/${encodeURIComponent(slug)}/anker`;
        const res =
          lauf === 0
            ? await fetch(adresse, { cache: "no-store", signal: steuerung.signal })
            : await fetch(adresse, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
                cache: "no-store",
                signal: steuerung.signal,
              });
        // Ohne lesbares JSON (etwa HTML eines Reverse-Proxys) zählt nur der Status.
        const daten: unknown = await res.json().catch(() => null);
        lesung = leseAnkerAntwort(res.status, daten);
      } catch (e) {
        lesung = { art: "abgewiesen", httpStatus: null, text: `Netzfehler: ${maskiert(e instanceof Error ? e.message : "unbekannter Fehler")}` };
      }
      if (!steuerung.signal.aborted) setStand({ slug, lauf, lesung });
    }
    void pruefen();
    return () => steuerung.abort();
  }, [slug, lauf, pruefbar]);

  const neuPruefen = useCallback(() => setLauf((n) => n + 1), []);

  if (manifest === null) {
    return (
      <section className="card-ghost p-5 mb-6 min-w-0" data-anker-panel data-pruefung="ohne_manifest">
        <h2 className="text-[10px] text-text-muted uppercase tracking-widest">Anker-Material</h2>
        <p className="text-[12px] mt-1 break-words" style={{ color: "var(--gp-ink-3)" }}>
          Für dieses Objekt gibt es kein Anker-Manifest.
        </p>
      </section>
    );
  }
  const lesung = stand !== null && stand.slug === slug && stand.lauf === lauf ? stand.lesung : LAEDT;
  return <AnkerAnsicht manifest={manifest} lesung={lesung} pruefen={neuPruefen} />;
}
