"use client";

// Medien-Panel des Objekt-Studios (Schritt 7, 10.11.2026): „Video einspielen“ mit Prüflauf, Vorschau und
// ausdrücklicher Bestätigung, die Medienliste je Video (Export → Original → Startbild) und der Startbild-Abgleich
// ohne Datenbank-Zeile (Toleranz-Messung).
//
// Hochgeladen wird direkt in den privaten Bucket: Der Server stellt je Datei eine signierte Upload-URL aus
// (POST …/medien/upload-url), der Browser schickt die Datei per PUT dorthin — das ist der einzige Storage-Zugriff
// des Browsers; Tabellen und Bucket liest nur der Server. Hash, Größe, Signatur und Abgleich misst der Server;
// das Panel zeigt seine Vorschau und schickt deren vorschau_sha256 mit „So einspielen“ zurück. Erst Häkchen,
// dann Knopf (Bestätigung des Inhabers). Nach jedem Fehler verwirft der Server die hochgeladenen Dateien; dann
// beginnt das Einspielen neu.
// Keine Zahl ohne Quelle: Was der Beleg der erzeugenden Sitzung nennt (ffprobe, Credits), steht als „laut Beleg“
// da; was der Server gemessen hat, als „gemessen“. Texte der Datenbank erscheinen maskiert. Zeiten in
// Europe/Berlin mit Zonenangabe, wie im übrigen Studio.

import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { ankerManifest, kurzHash } from "@/lib/studio/anker";
import type { AnkerManifest } from "@/lib/studio/anker";
import type {
  AbgleichErgebnis,
  MedienKette,
  MedienRolle,
  MediumMime,
  SpeicherMessung,
  StudioCredits,
  StudioMedienTeil,
  StudioMedium,
  StudioMesswert,
  UploadRolle,
} from "@/lib/studio/typen";
import { berlinDatumZeit } from "@/lib/types";
import { FARBE_BERNSTEIN, FARBE_GRUEN, FARBE_ROT, istObjekt, maskiert } from "@/components/studio/beleg-hilfen";

// ── Texte ──

function zeitBerlin(iso: unknown, ersatz: string): string {
  const t = typeof iso === "string" ? berlinDatumZeit(iso) : null;
  return t === null ? ersatz : `${t} (Europe/Berlin)`;
}

export function zahl(n: number, nachkomma = 4): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: nachkomma });
}

/** Byte-Zahl mit Einheit; die genaue Zahl steht im title. */
export function bytesText(b: number): string {
  if (b >= 1_000_000) return `${zahl(b / 1_000_000, 2)} MB`;
  if (b >= 1_000) return `${zahl(b / 1_000, 1)} kB`;
  return `${b} B`;
}

const ROLLEN_TEXT: Readonly<Record<MedienRolle, string>> = { startbild: "Startbild", original: "Original", export: "Export" };

/** Pfad der Datei-Route eines Mediums (302 auf eine signierte URL nach dem Nachhashen). */
export function dateiPfad(slug: string, id: number): string {
  return `/api/studio/${encodeURIComponent(slug)}/medien/${id}/datei`;
}

/** Credits als Text: Summe, Deckel und Rest — oder warum es keine Summe gibt. Nie mit USD gemischt. */
export function creditsText(m: StudioMesswert<StudioCredits>): { wert: string; unter: string } {
  const c = m.wert;
  if (m.status === "fehler" || c === null) return { wert: "nicht lesbar", unter: maskiert(m.hinweis ?? "Lesefehler") };
  const deckel = c.deckel === null ? "Deckel nicht entschieden (E18)" : `Deckel ${zahl(c.deckel)}`;
  if (c.summe === null) return { wert: c.originale === 0 ? "kein Video verbucht" : "keine Credit-Angabe", unter: `${deckel} · ${c.originale} Original(e)` };
  const rest = c.rest === null ? "" : ` · Rest ${zahl(c.rest)}`;
  const ohne = c.originale_ohne_angabe > 0 ? ` · ${c.originale_ohne_angabe} ohne Angabe` : "";
  return { wert: `${m.status === "ok" ? "" : "≥ "}${zahl(c.summe)} Credits`, unter: `${deckel}${rest} · ${c.originale} Original(e)${ohne}` };
}

// ── Abläufe (ohne React; holen = fetch, in Tests eine Attrappe) ──

export type Holen = (url: string, init?: RequestInit) => Promise<Response>;

export interface Abweisung {
  art: "abgewiesen";
  httpStatus: number | null;
  text: string;
  felder: string[];
  vorhanden: { startbild: number; original: number; export: number } | null;
}

function abweisungAus(httpStatus: number | null, daten: unknown, ersatz: string): Abweisung {
  const obj = istObjekt(daten) ? daten : null;
  const text = obj && typeof obj.fehler === "string" && obj.fehler.trim() ? obj.fehler : obj && typeof obj.error === "string" ? obj.error : ersatz;
  const felder = obj && Array.isArray(obj.felder) ? obj.felder.filter((f): f is string => typeof f === "string").map(maskiert) : [];
  const v = obj && istObjekt(obj.vorhanden) ? obj.vorhanden : null;
  const vorhanden =
    v && typeof v.startbild === "number" && typeof v.original === "number" && typeof v.export === "number"
      ? { startbild: v.startbild, original: v.original, export: v.export }
      : null;
  const status = httpStatus === null ? "Netz" : `HTTP ${httpStatus}`;
  return { art: "abgewiesen", httpStatus, text: maskiert(`${httpStatus === 401 ? "Nicht angemeldet — bitte neu anmelden" : text} (${status})`), felder, vorhanden };
}

async function postJson(holen: Holen, url: string, koerper: unknown): Promise<{ status: number | null; daten: unknown }> {
  try {
    const res = await holen(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(koerper), cache: "no-store" });
    return { status: res.status, daten: await res.json().catch(() => null) };
  } catch (e) {
    return { status: null, daten: { fehler: `Netzfehler: ${e instanceof Error ? e.message : "unbekannt"}` } };
  }
}

/** MIME einer gewählten Datei: der Typ des Browsers, sonst aus der Endung; null, wenn keiner der drei passt. */
export function mimeFuerDatei(d: { name: string; type: string }): MediumMime | null {
  const typ = d.type.toLowerCase();
  if (typ === "video/mp4" || typ === "image/jpeg" || typ === "image/png") return typ;
  const endung = /\.([a-z0-9]+)$/i.exec(d.name)?.[1]?.toLowerCase();
  return endung === "mp4" ? "video/mp4" : endung === "jpg" || endung === "jpeg" ? "image/jpeg" : endung === "png" ? "image/png" : null;
}

export interface Datei {
  name: string;
  type: string;
  size: number;
}

/**
 * Upload-URLs anfordern und jede Datei per PUT auf ihre signierte URL laden (nie mit upsert). Liefert je Rolle den
 * Eingangspfad des Servers oder die Abweisung des ersten gescheiterten Schritts.
 */
export async function ladeHoch(
  slug: string,
  dateien: ReadonlyArray<{ rolle: UploadRolle; datei: Datei & Blob; mime: MediumMime }>,
  holen: Holen,
  melde: (text: string) => void = () => {},
): Promise<{ art: "ok"; eingang: Partial<Record<UploadRolle, string>> } | Abweisung> {
  melde("Upload-URLs anfordern …");
  const u = await postJson(holen, `/api/studio/${encodeURIComponent(slug)}/medien/upload-url`, {
    dateien: dateien.map((d) => ({ rolle: d.rolle, bytes: d.datei.size, mime: d.mime })),
  });
  if (u.status !== 200 || !istObjekt(u.daten) || !Array.isArray(u.daten.dateien)) return abweisungAus(u.status, u.daten, "Upload-URLs nicht erhalten");
  const eingang: Partial<Record<UploadRolle, string>> = {};
  for (const d of dateien) {
    const ziel = (u.daten.dateien as unknown[]).find((x): x is Record<string, unknown> => istObjekt(x) && x.rolle === d.rolle);
    if (!ziel || typeof ziel.signedUrl !== "string" || typeof ziel.pfad !== "string") return abweisungAus(u.status, null, `Upload-URL für ${d.rolle} fehlt in der Antwort`);
    melde(`${d.rolle} hochladen (${bytesText(d.datei.size)}) …`);
    let status: number | null;
    try {
      const res = await holen(ziel.signedUrl, { method: "PUT", headers: { "content-type": d.mime, "x-upsert": "false", "cache-control": "max-age=3600" }, body: d.datei });
      status = res.status;
      if (!res.ok) return abweisungAus(status, await res.json().catch(() => null), `Upload von ${d.rolle} gescheitert`);
    } catch (e) {
      return abweisungAus(null, { fehler: `Upload von ${d.rolle} gescheitert: ${e instanceof Error ? e.message : "unbekannt"}` }, "Upload gescheitert");
    }
    eingang[d.rolle] = ziel.pfad;
  }
  return { art: "ok", eingang };
}

export interface VorschauZeileAnzeige {
  rolle: MedienRolle;
  felder: Record<string, unknown>;
}

export interface Vorschau {
  art: "vorschau";
  zeilen: VorschauZeileAnzeige[];
  vorschau_sha256: string;
  abgleich: AbgleichErgebnis;
  speicher: SpeicherMessung | null;
}

/** Antwort des Prüflaufs lesen; die Zeilen bleiben unverändert, damit sie genau so zurückgehen. */
export function leseVorschau(status: number | null, daten: unknown): Vorschau | Abweisung {
  if (status === 200 && istObjekt(daten) && daten.art === "vorschau" && Array.isArray(daten.vorschau) && typeof daten.vorschau_sha256 === "string" && istObjekt(daten.abgleich)) {
    const zeilen = (daten.vorschau as unknown[]).filter((z): z is VorschauZeileAnzeige => istObjekt(z) && typeof z.rolle === "string" && istObjekt(z.felder));
    if (zeilen.length === 3) {
      return { art: "vorschau", zeilen, vorschau_sha256: daten.vorschau_sha256, abgleich: daten.abgleich as unknown as AbgleichErgebnis, speicher: istObjekt(daten.speicher) ? (daten.speicher as unknown as SpeicherMessung) : null };
    }
  }
  return abweisungAus(status, daten, "Prüflauf ohne lesbare Vorschau");
}

export interface Eingespielt {
  art: "eingespielt";
  zeilen: Array<{ rolle: MedienRolle; id: number; wiederverwendet: boolean }>;
}

export function leseEingespielt(status: number | null, daten: unknown): Eingespielt | Abweisung {
  if (status === 200 && istObjekt(daten) && daten.art === "eingespielt" && Array.isArray(daten.zeilen)) {
    const zeilen = (daten.zeilen as unknown[]).filter(
      (z): z is { rolle: MedienRolle; id: number; wiederverwendet: boolean } => istObjekt(z) && typeof z.rolle === "string" && typeof z.id === "number" && typeof z.wiederverwendet === "boolean",
    );
    if (zeilen.length === 3) return { art: "eingespielt", zeilen };
  }
  return abweisungAus(status, daten, "Einspielen ohne lesbare Antwort");
}

export function pruefen(slug: string, eingang: Record<MedienRolle, string>, beleg: unknown, holen: Holen): Promise<Vorschau | Abweisung> {
  return postJson(holen, `/api/studio/${encodeURIComponent(slug)}/medien`, { eingang, beleg, nur_pruefen: true }).then((r) => leseVorschau(r.status, r.daten));
}

export function einspielen(slug: string, eingang: Record<MedienRolle, string>, beleg: unknown, vorschau: Vorschau, holen: Holen): Promise<Eingespielt | Abweisung> {
  return postJson(holen, `/api/studio/${encodeURIComponent(slug)}/medien`, { eingang, beleg, bestaetigt: vorschau.vorschau_sha256, vorschau: vorschau.zeilen }).then((r) =>
    leseEingespielt(r.status, r.daten),
  );
}

export function abgleichen(slug: string, eingang: string, ankerId: string, ausschnitt: Record<string, number>, holen: Holen): Promise<{ art: "abgleich"; abgleich: AbgleichErgebnis; speicher: SpeicherMessung | null } | Abweisung> {
  return postJson(holen, `/api/studio/${encodeURIComponent(slug)}/medien/abgleich`, { eingang, anker_id: ankerId, ausschnitt: { ...ausschnitt, skalierung: 1 } }).then((r) => {
    if (r.status === 200 && istObjekt(r.daten) && istObjekt(r.daten.abgleich)) {
      return { art: "abgleich" as const, abgleich: r.daten.abgleich as unknown as AbgleichErgebnis, speicher: istObjekt(r.daten.speicher) ? (r.daten.speicher as unknown as SpeicherMessung) : null };
    }
    return abweisungAus(r.status, r.daten, "Abgleich ohne lesbare Antwort");
  });
}

// ── Bausteine ──

export function abgleichText(a: Pick<AbgleichErgebnis, "urteil" | "abweichung_max" | "toleranz" | "grund">): string {
  const urteil = a.urteil === "bestanden" ? "bestanden" : "nicht bestanden";
  if (a.abweichung_max === null) return `${urteil} — ${a.grund ?? "nicht verglichen"}`;
  return `${urteil} — größte Abweichung ${a.abweichung_max} (Toleranz ${a.toleranz})`;
}

function speicherText(s: SpeicherMessung | null): string | null {
  if (s === null) return null;
  return `Speicher des Servers: RSS ${bytesText(s.rss_vorher_b)} → ${bytesText(s.rss_nachher_b)} · Spitze des Prozesses (maxRSS) ${bytesText(s.max_rss_kib * 1024)}`;
}

function Wert({ titel, children, ...daten }: { titel: string; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <div className="min-w-0">
      <dt className="mono-label">{titel}</dt>
      <dd className="break-words" {...daten}>
        {children}
      </dd>
    </div>
  );
}

function HashZeile({ m }: { m: StudioMedium }) {
  return (
    <span className="font-[family-name:var(--font-jbmono)] wrap-anywhere" title={`SHA-256 (vom Server beim Einspielen berechnet): ${m.sha256}\nBytes: ${m.bytes}`}>
      {kurzHash(m.sha256)} · {bytesText(m.bytes)}
    </span>
  );
}

function videoWerte(m: StudioMedium): string {
  const teile = [
    m.breite !== null && m.hoehe !== null ? `${m.breite}×${m.hoehe}` : null,
    m.fps !== null ? `${zahl(m.fps)} fps` : null,
    m.dauer_s !== null ? `${zahl(m.dauer_s)} s` : null,
    m.aigc_kennzeichen === null ? null : `AIGC-Kennzeichen ${m.aigc_kennzeichen ? "ja" : "nein"}`,
  ].filter(Boolean);
  return teile.length > 0 ? `${teile.join(" · ")} (laut Beleg, ffprobe)` : "keine Angaben im Beleg";
}

function KettenKarte({ k, slug, freigabe }: { k: MedienKette; slug: string; freigabe?: ReactNode }) {
  const ex = k.export;
  const og = k.original;
  const sb = k.startbild;
  return (
    <article className="card-ghost p-4 min-w-0" data-medium={ex.id} data-luecken={k.luecken.length}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="font-[family-name:var(--font-jbmono)] text-[10px] text-text-muted">Export #{ex.id}</span>
        <span className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider" style={{ background: "var(--gp-hairline)", color: "var(--gp-gold)" }}>
          Video
        </span>
        <span className="text-[11px] text-text-muted break-words">
          Anker {maskiert(ex.anker_id)} · eingespielt {zeitBerlin(ex.eingespielt_am, "ohne Zeitpunkt")}
        </span>
      </div>
      {k.luecken.length > 0 && (
        <p className="text-[11px] break-words" style={{ color: FARBE_ROT }} data-ketten-luecke>
          Kette unvollständig: {k.luecken.map(maskiert).join(" · ")}
        </p>
      )}
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-2 text-xs">
        <Wert titel="Export (Datei)" data-export-hash={ex.sha256}>
          <HashZeile m={ex} /> · <a href={dateiPfad(slug, ex.id)} target="_blank" rel="noopener" className="underline" data-datei-link={ex.id}>ansehen</a>
        </Wert>
        <Wert titel="Export (Video)">{videoWerte(ex)}</Wert>
        <Wert titel="Schnitt">
          {ex.schnitt_von_s !== null && ex.schnitt_bis_s !== null ? `${zahl(ex.schnitt_von_s)}–${zahl(ex.schnitt_bis_s)} s im Original (laut Beleg)` : "kein Schnittfenster"}
        </Wert>
        <Wert titel="KI-Hinweis im Bild (laut Beleg)" data-ki-hinweis="">
          {ex.ki_hinweis_text === null ? "nicht angegeben" : `„${maskiert(ex.ki_hinweis_text)}“`}
        </Wert>
        <Wert titel="Original">
          {og === null ? (
            <span style={{ color: FARBE_ROT }}>fehlt</span>
          ) : (
            <>
              #{og.id} · <HashZeile m={og} /> · <a href={dateiPfad(slug, og.id)} target="_blank" rel="noopener" className="underline" data-datei-link={og.id}>ansehen</a>
              <span className="block text-[10px] text-text-muted">nur auf Wunsch: Das Original ist groß (Egress)</span>
            </>
          )}
        </Wert>
        <Wert titel="Erzeugung (laut Beleg)">
          {og === null ? "—" : `${maskiert(og.erzeuger ?? "ohne Erzeuger")} · ${maskiert(og.modell ?? "ohne Modell")} · Job ${maskiert(og.job_id ?? "ohne id")} · ${videoWerte(og)}`}
        </Wert>
        <Wert titel="Credits (laut Beleg)" data-credits={og?.kosten_credits === null || og === null ? "keine" : String(og.kosten_credits)}>
          {og === null || og.kosten_credits === null ? "keine Angabe" : `${zahl(og.kosten_credits)} Credits${og.kosten_vorschau_credits !== null ? ` (Vorschau ${zahl(og.kosten_vorschau_credits)})` : ""}`}
          {og?.kosten_quelle ? <span className="block text-[10px] text-text-muted">Quelle: {maskiert(og.kosten_quelle)}</span> : null}
        </Wert>
        <Wert titel="Startbild-Abgleich (gemessen)" data-startbild-abgleich={sb?.startbild_abgleich ?? "fehlt"}>
          {sb === null ? (
            <span style={{ color: FARBE_ROT }}>Startbild fehlt</span>
          ) : (
            <>
              <span style={{ color: sb.startbild_abgleich === "bestanden" ? FARBE_GRUEN : FARBE_ROT }}>
                {sb.startbild_abgleich === "bestanden" ? "bestanden" : "nicht bestanden"}
                {sb.startbild_abweichung_max !== null ? ` — größte Abweichung ${sb.startbild_abweichung_max}` : " — nicht verglichen"}
              </span>
              <span className="block text-[10px] text-text-muted">
                #{sb.id} · <HashZeile m={sb} />
                {sb.ausschnitt ? ` · Ausschnitt ${sb.ausschnitt.breite}×${sb.ausschnitt.hoehe} bei (${sb.ausschnitt.x}, ${sb.ausschnitt.y})` : ""} ·{" "}
                <a href={dateiPfad(slug, sb.id)} target="_blank" rel="noopener" className="underline" data-datei-link={sb.id}>ansehen</a>
              </span>
            </>
          )}
        </Wert>
      </dl>
      {freigabe}
    </article>
  );
}

function Vorschautabelle({ v }: { v: Vorschau }) {
  const spalten = Array.from(new Set(v.zeilen.flatMap((z) => Object.keys(z.felder)))).sort();
  const anzeige = (x: unknown): string => (x === null ? "null" : typeof x === "string" ? maskiert(x) : maskiert(JSON.stringify(x)));
  return (
    <div className="overflow-x-auto mt-2" data-vorschau-tabelle>
      <table className="text-[10px] font-[family-name:var(--font-jbmono)] min-w-full">
        <thead>
          <tr>
            <th className="text-left pr-3">Spalte</th>
            {v.zeilen.map((z) => (
              <th key={z.rolle} className="text-left pr-3">
                {ROLLEN_TEXT[z.rolle] ?? maskiert(z.rolle)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spalten.map((s) => (
            <tr key={s} className="align-top">
              <td className="pr-3 text-text-muted">{s}</td>
              {v.zeilen.map((z) => (
                <td key={z.rolle} className="pr-3 max-w-[22rem] break-all">
                  {anzeige(z.felder[s])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type EinspielStand =
  | { art: "bereit" }
  | { art: "laeuft"; text: string }
  | { art: "vorschau"; eingang: Record<MedienRolle, string>; beleg: unknown; vorschau: Vorschau }
  | { art: "fertig"; ergebnis: Eingespielt }
  | { art: "fehler"; abweisung: Abweisung };

/** Gewählte Dateien und Beleg des Formulars. */
export interface Auswahl {
  startbild: (Datei & Blob) | null;
  original: (Datei & Blob) | null;
  export: (Datei & Blob) | null;
  beleg: (Datei & Blob) | null;
}

/** Was vor dem Hochladen fehlt oder nicht passt (im Browser geprüft; maßgeblich ist der Server). */
export function auswahlFehler(a: Auswahl): string[] {
  const fehler: string[] = [];
  const erlaubt: Record<MedienRolle, MediumMime[]> = { startbild: ["image/png", "image/jpeg"], original: ["video/mp4"], export: ["video/mp4"] };
  for (const rolle of ["startbild", "original", "export"] as const) {
    const d = a[rolle];
    if (d === null) fehler.push(`${ROLLEN_TEXT[rolle]} fehlt`);
    else if (!erlaubt[rolle].includes(mimeFuerDatei(d) as MediumMime)) fehler.push(`${ROLLEN_TEXT[rolle]}: Dateityp ${d.type || "unbekannt"} passt nicht`);
    else if (d.size > 50_000_000) fehler.push(`${ROLLEN_TEXT[rolle]}: größer als 50.000.000 B`);
  }
  if (a.beleg === null) fehler.push("Beleg (JSON) fehlt");
  return fehler;
}

function Dateiwahl({ titel, akzeptiert, datenFeld, wahl }: { titel: string; akzeptiert: string; datenFeld: string; wahl: (d: (Datei & Blob) | null) => void }) {
  return (
    <label className="block min-w-0 text-[11px]">
      <span className="mono-label block">{titel}</span>
      <input
        type="file"
        accept={akzeptiert}
        className="mt-1 block w-full min-w-0 text-[11px]"
        data-dateiwahl={datenFeld}
        onChange={(e) => wahl(e.currentTarget.files?.[0] ?? null)}
      />
    </label>
  );
}

function Abweisungsanzeige({ a }: { a: Abweisung }) {
  return (
    <div className="text-[11px] break-words mt-2" style={{ color: FARBE_ROT }} role="alert" data-medien-fehler={a.httpStatus ?? "netz"}>
      <p>{a.text}</p>
      {a.felder.length > 0 && <p className="mt-1">Abweichende Felder: {a.felder.join(", ")}</p>}
      {a.vorhanden && (
        <p className="mt-1" style={{ color: FARBE_BERNSTEIN }} data-vorhanden>
          Schon vorhanden: Startbild #{a.vorhanden.startbild}, Original #{a.vorhanden.original}, Export #{a.vorhanden.export}
        </p>
      )}
      <p className="mt-1 text-text-muted">Der Server hat die hochgeladenen Dateien verworfen, sofern er sie schon bearbeitet hatte; bitte neu beginnen.</p>
    </div>
  );
}

function Einspielen({ slug, holen, eingespielt }: { slug: string; holen: Holen; eingespielt: () => void }) {
  const [auswahl, setAuswahl] = useState<Auswahl>({ startbild: null, original: null, export: null, beleg: null });
  const [stand, setStand] = useState<EinspielStand>({ art: "bereit" });
  const [bestaetigt, setBestaetigt] = useState(false);
  const laeuft = stand.art === "laeuft";
  const fehlt = auswahlFehler(auswahl);

  const pruefeLauf = useCallback(async () => {
    if (auswahlFehler(auswahl).length > 0 || auswahl.beleg === null) return;
    setBestaetigt(false);
    setStand({ art: "laeuft", text: "Beleg lesen …" });
    let beleg: unknown;
    try {
      beleg = JSON.parse(await auswahl.beleg.text());
    } catch {
      setStand({ art: "fehler", abweisung: { art: "abgewiesen", httpStatus: null, text: "Beleg ist kein gültiges JSON", felder: [], vorhanden: null } });
      return;
    }
    const dateien = (["startbild", "original", "export"] as const).map((rolle) => {
      const datei = auswahl[rolle] as Datei & Blob;
      return { rolle, datei, mime: mimeFuerDatei(datei) as MediumMime };
    });
    const hoch = await ladeHoch(slug, dateien, holen, (text) => setStand({ art: "laeuft", text }));
    if (hoch.art !== "ok") {
      setStand({ art: "fehler", abweisung: hoch });
      return;
    }
    const eingang = { startbild: hoch.eingang.startbild as string, original: hoch.eingang.original as string, export: hoch.eingang.export as string };
    setStand({ art: "laeuft", text: "Prüflauf: Server liest die Dateien und gleicht das Startbild ab …" });
    const v = await pruefen(slug, eingang, beleg, holen);
    setStand(v.art === "vorschau" ? { art: "vorschau", eingang, beleg, vorschau: v } : { art: "fehler", abweisung: v });
  }, [auswahl, slug, holen]);

  const spieleEin = useCallback(async () => {
    if (stand.art !== "vorschau" || !bestaetigt) return;
    const { eingang, beleg, vorschau } = stand;
    setStand({ art: "laeuft", text: "Einspielen: verschieben, nachmessen, Zeilen anlegen …" });
    const r = await einspielen(slug, eingang, beleg, vorschau, holen);
    setBestaetigt(false);
    if (r.art === "eingespielt") {
      setStand({ art: "fertig", ergebnis: r });
      eingespielt();
    } else {
      setStand({ art: "fehler", abweisung: r });
    }
  }, [stand, bestaetigt, slug, holen, eingespielt]);

  const waehle = (feld: keyof Auswahl) => (d: (Datei & Blob) | null) => {
    setAuswahl((a) => ({ ...a, [feld]: d }));
    setStand({ art: "bereit" });
    setBestaetigt(false);
  };

  return (
    <details className="mt-4" data-einspielen={stand.art}>
      <summary className="cursor-pointer text-[12px]" style={{ color: "var(--gp-ink)" }}>
        Video einspielen
      </summary>
      <p className="text-[10px] text-text-muted mt-2 break-words">
        Startbild, Original und Export gehen über signierte Upload-URLs direkt in den privaten Speicher; der Beleg (JSON der erzeugenden
        Sitzung) im Körper der Anfrage. Der Prüflauf legt keine Zeile und keine Inhaltsdatei an (gelöscht werden nur Reste älter als 2 h und bei einem Fehler die eigenen Uploads). Eingefügt wird erst nach Häkchen und „So einspielen“; Zeilen sind
        danach unveränderlich.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <Dateiwahl titel="Startbild (PNG oder JPEG)" akzeptiert="image/png,image/jpeg" datenFeld="startbild" wahl={waehle("startbild")} />
        <Dateiwahl titel="Original (MP4)" akzeptiert="video/mp4" datenFeld="original" wahl={waehle("original")} />
        <Dateiwahl titel="Export (MP4)" akzeptiert="video/mp4" datenFeld="export" wahl={waehle("export")} />
        <Dateiwahl titel="Beleg (JSON)" akzeptiert="application/json,.json" datenFeld="beleg" wahl={waehle("beleg")} />
      </div>
      {fehlt.length > 0 && <p className="text-[10px] mt-2 break-words text-text-muted" data-auswahl-fehlt>Noch offen: {fehlt.join(" · ")}</p>}
      <button
        type="button"
        onClick={() => {
          if (!laeuft && fehlt.length === 0) void pruefeLauf();
        }}
        aria-disabled={laeuft || fehlt.length > 0}
        className="mt-3 min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
        data-pruefen-knopf
      >
        Hochladen und Prüflauf starten
      </button>
      <div aria-live="polite" className="mt-2">
        {stand.art === "laeuft" && (
          <p className="text-[11px]" style={{ color: "var(--gp-ink-3)" }} data-medien-laeuft>
            {stand.text}
          </p>
        )}
        {stand.art === "fehler" && <Abweisungsanzeige a={stand.abweisung} />}
        {stand.art === "fertig" && (
          <p className="text-[11px] break-words" style={{ color: FARBE_GRUEN }} data-eingespielt>
            Eingespielt:{" "}
            {stand.ergebnis.zeilen.map((z) => `${ROLLEN_TEXT[z.rolle] ?? z.rolle} #${z.id}${z.wiederverwendet ? " (bestand schon gleich)" : ""}`).join(" · ")}
          </p>
        )}
        {stand.art === "vorschau" && (
          <div className="mt-2 min-w-0" data-vorschau={stand.vorschau.vorschau_sha256}>
            <p className="text-[11px] break-words" style={{ color: "var(--gp-ink)" }}>
              Vorschau (nichts geschrieben) · Startbild-Abgleich:{" "}
              <span style={{ color: stand.vorschau.abgleich.urteil === "bestanden" ? FARBE_GRUEN : FARBE_ROT }} data-vorschau-abgleich={stand.vorschau.abgleich.urteil}>
                {abgleichText(stand.vorschau.abgleich)}
              </span>
            </p>
            <p className="text-[10px] text-text-muted break-words">
              vorschau_sha256 {kurzHash(stand.vorschau.vorschau_sha256)} · sharp {stand.vorschau.abgleich.versionen?.sharp ?? "?"}, libvips{" "}
              {stand.vorschau.abgleich.versionen?.vips ?? "?"}
              {speicherText(stand.vorschau.speicher) ? ` · ${speicherText(stand.vorschau.speicher)}` : ""}
            </p>
            <Vorschautabelle v={stand.vorschau} />
            <label className="flex items-start gap-2 mt-3 text-[11px]">
              <input type="checkbox" checked={bestaetigt} onChange={(e) => setBestaetigt(e.currentTarget.checked)} data-bestaetigen className="mt-0.5" />
              <span>Ich habe die drei Zeilen geprüft. So sollen sie unveränderlich angelegt werden.</span>
            </label>
            <button
              type="button"
              onClick={() => {
                if (bestaetigt) void spieleEin();
              }}
              aria-disabled={!bestaetigt}
              className="mt-2 min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
              data-einspielen-knopf
            >
              So einspielen
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

function Abgleich({ slug, manifest, holen }: { slug: string; manifest: AnkerManifest | null; holen: Holen }) {
  const anker = manifest?.eintraege.filter((e) => e.als_anker) ?? [];
  const [datei, setDatei] = useState<(Datei & Blob) | null>(null);
  const [ankerId, setAnkerId] = useState(anker[0]?.id ?? "");
  const [rezept, setRezept] = useState({ x: "", y: "", breite: "", hoehe: "" });
  const [stand, setStand] = useState<{ art: "bereit" } | { art: "laeuft"; text: string } | { art: "fehler"; abweisung: Abweisung } | { art: "fertig"; abgleich: AbgleichErgebnis; speicher: SpeicherMessung | null }>({ art: "bereit" });
  const werte = Object.fromEntries(Object.entries(rezept).map(([k, v]) => [k, /^\d{1,6}$/.test(v) ? Number(v) : Number.NaN]));
  const mime = datei === null ? null : mimeFuerDatei(datei);
  const bereit = datei !== null && (mime === "image/png" || mime === "image/jpeg") && ankerId !== "" && Object.values(werte).every((n) => Number.isInteger(n)) && stand.art !== "laeuft";

  const messen = useCallback(async () => {
    if (!bereit || datei === null || mime === null) return;
    const hoch = await ladeHoch(slug, [{ rolle: "abgleich", datei, mime }], holen, (text) => setStand({ art: "laeuft", text }));
    if (hoch.art !== "ok") {
      setStand({ art: "fehler", abweisung: hoch });
      return;
    }
    setStand({ art: "laeuft", text: "Abgleich läuft …" });
    const r = await abgleichen(slug, hoch.eingang.abgleich as string, ankerId, werte, holen);
    setStand(r.art === "abgleich" ? { art: "fertig", abgleich: r.abgleich, speicher: r.speicher } : { art: "fehler", abweisung: r });
  }, [bereit, datei, mime, slug, holen, ankerId, werte]);

  const feld = (k: keyof typeof rezept, titel: string) => (
    <label className="block text-[11px] min-w-0">
      <span className="mono-label block">{titel}</span>
      <input
        inputMode="numeric"
        value={rezept[k]}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setRezept((r) => ({ ...r, [k]: v }));
        }}
        className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1"
        data-rezept={k}
      />
    </label>
  );

  return (
    <details className="mt-3" data-abgleich={stand.art}>
      <summary className="cursor-pointer text-[12px]" style={{ color: "var(--gp-ink)" }}>
        Startbild-Abgleich messen (ohne Zeile)
      </summary>
      <p className="text-[10px] text-text-muted mt-2 break-words">
        Lädt ein Bild hoch, schneidet den Anker nach dem Rezept aus und vergleicht Pixel für Pixel; legt keine Zeile an und löscht das Bild
        danach. Dient der Toleranz-Messung im Container (Antwort mit den Versionen von sharp und libvips). Skalierung: 1.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-3">
        <div className="sm:col-span-4 min-w-0">
          <Dateiwahl titel="Bild (PNG oder JPEG)" akzeptiert="image/png,image/jpeg" datenFeld="abgleich" wahl={setDatei} />
        </div>
        <label className="sm:col-span-4 block text-[11px] min-w-0">
          <span className="mono-label block">Anker</span>
          <select value={ankerId} onChange={(e) => setAnkerId(e.currentTarget.value)} className="mt-1 w-full min-w-0 rounded bg-surface-elevated px-2 py-1" data-abgleich-anker>
            {anker.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id} ({e.breite}×{e.hoehe})
              </option>
            ))}
          </select>
        </label>
        {feld("x", "x")}
        {feld("y", "y")}
        {feld("breite", "Breite")}
        {feld("hoehe", "Höhe")}
      </div>
      <button
        type="button"
        onClick={() => {
          if (bereit) void messen();
        }}
        aria-disabled={!bereit}
        className="mt-3 min-h-11 px-4 py-2 rounded-lg text-xs font-medium bg-surface-elevated text-foreground hover:opacity-80 transition-opacity aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
        data-abgleich-knopf
      >
        Abgleich messen
      </button>
      <div aria-live="polite" className="mt-2">
        {stand.art === "laeuft" && <p className="text-[11px]" style={{ color: "var(--gp-ink-3)" }}>{stand.text}</p>}
        {stand.art === "fehler" && <Abweisungsanzeige a={stand.abweisung} />}
        {stand.art === "fertig" && (
          <div className="text-[11px] break-words" data-abgleich-ergebnis={stand.abgleich.urteil}>
            <p style={{ color: stand.abgleich.urteil === "bestanden" ? FARBE_GRUEN : FARBE_ROT }}>{abgleichText(stand.abgleich)}</p>
            <p className="text-[10px] text-text-muted">
              {stand.abgleich.mittel !== null ? `Mittel ${zahl(stand.abgleich.mittel)} · Anteil über der Toleranz ${zahl((stand.abgleich.anteil_ueber_toleranz ?? 0) * 100, 2)} % · ` : ""}
              sharp {stand.abgleich.versionen.sharp}, libvips {stand.abgleich.versionen.vips}
              {speicherText(stand.speicher) ? ` · ${speicherText(stand.speicher)}` : ""}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Medien-Panel: Liste der Videos des Objekts, „Video einspielen“ und der Abgleich. freigabe(kette) liefert je Video
 * die Anzeige der Freigabe (ab Schritt 8 die Medien-Regel); ohne sie steht „Medien-Regel kommt mit Schritt 8“ da.
 */
export function MedienPanel({
  slug,
  medien,
  credits,
  neuLaden,
  holen = fetch,
  freigabe,
}: {
  slug: string;
  medien: StudioMedienTeil;
  credits: StudioMesswert<StudioCredits>;
  neuLaden: () => void;
  holen?: Holen;
  freigabe?: (k: MedienKette) => ReactNode;
}) {
  const manifest = ankerManifest(slug);
  const c = creditsText(credits);
  const w = medien.wert;
  return (
    <section className="card-ghost p-5 mb-8 min-w-0" data-medien-panel data-status={medien.status}>
      <h2 className="text-[10px] text-text-muted uppercase tracking-widest">Video / Medien{w ? ` · ${w.ketten.length}` : ""}</h2>
      <p className="text-[12px] mt-1 break-words" style={{ color: "var(--gp-ink-2)" }} data-medien-credits title={maskiert(`Quelle: ${credits.quelle}${credits.hinweis ? `\nHinweis: ${credits.hinweis}` : ""}`)}>
        Higgsfield-Credits: {c.wert} · {c.unter}
      </p>
      {/* Nur der Hinweis auf den Erzeugungsweg: Das Studio ruft Higgsfield nie selbst auf. */}
      <p className="text-[11px] mt-1 break-words" style={{ color: "var(--gp-ink-2)" }} data-erzeugungsweg>
        Higgsfield im Studio: aktiver Erzeugungsweg ist die Connector-Sitzung (Higgsfield-Connector in einer Claude-Sitzung). Das Studio ruft
        Higgsfield nicht auf.
      </p>
      {medien.status === "fehler" || w === null ? (
        <p className="text-[11px] mt-3 break-words" style={{ color: FARBE_ROT }} role="alert" data-medien-stand="fehler">
          Medien nicht lesbar: {maskiert(medien.hinweis ?? "unbekannter Fehler")}
        </p>
      ) : (
        <>
          {medien.hinweis && (
            <p className="text-[11px] mt-2 break-words" style={{ color: FARBE_BERNSTEIN }} data-medien-hinweis>
              {maskiert(medien.hinweis)}
            </p>
          )}
          {w.ketten.length === 0 ? (
            <p className="text-[11px] mt-3 text-text-muted" data-medien-stand="leer">
              Noch kein Video eingespielt (gelesen {zeitBerlin(medien.gemessen_am, "ohne Zeitpunkt")}).
            </p>
          ) : (
            <div className="space-y-3 mt-3" data-medien-stand="daten">
              {w.ketten.map((k) => (
                <KettenKarte
                  key={k.export.id}
                  k={k}
                  slug={slug}
                  freigabe={
                    freigabe ? (
                      freigabe(k)
                    ) : (
                      <p className="text-[11px] mt-2" style={{ color: FARBE_BERNSTEIN }} data-medien-freigabe="ohne-regel">
                        Freigabe: gesperrt — die Medien-Regel kommt mit Schritt 8.
                      </p>
                    )
                  }
                />
              ))}
            </div>
          )}
          {w.einzeln.length > 0 && (
            <p className="text-[11px] mt-2 break-words" style={{ color: FARBE_BERNSTEIN }} data-medien-einzeln>
              Zeilen ohne Export: #{w.einzeln.join(", #")}
            </p>
          )}
        </>
      )}
      <Einspielen slug={slug} holen={holen} eingespielt={neuLaden} />
      <Abgleich slug={slug} manifest={manifest} holen={holen} />
    </section>
  );
}
