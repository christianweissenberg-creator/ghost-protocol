// Objekt-Studio: Ableitungen für GET /api/studio/[objekt] (Schritt 2, 08.11.2026).
//
// Reine Funktionen ohne Netz und ohne Datenbank-Zugriff: Objektkopf aus der Antwort von
// /api/objekte, Assets aus content-Zeilen, Kosten aus metadata.steps[].cost. Abgerufen wird in der
// Route. Nur die Route importiert diese Datei ("server-only"): Sie nutzt lib/status-server.ts,
// dessen Fehler-Bereiniger die Server-Umgebung liest.
//
// Regeln (wie Stufe 1): Jede Zahl ist ein Messwert mit Quelle und Zeitpunkt, nie 0 als Platzhalter.
// Eine unlesbare Zeile macht den ganzen Teil zu "fehler" — nie eine halbe Liste, die wie "nichts
// da" aussieht. Anzeigetexte gehen nur mit maskiertem geschütztem Namen hinaus.

import "server-only";
import { werteCounselAus } from "../counsel-urteil";
import {
  MEDIUM_ID_UNLESBAR,
  MEDIUM_KEIN_EXPORT,
  geprueftenTextAusSchritten,
  maskiereGeschuetzteNamen,
  mediumIdAus,
  pruefeFreigabe,
  pruefeVideoFreigabe,
} from "../freigabe-regeln";
import type { MedienSperre } from "../freigabe-regeln";
import { PREIS_STAND_AB } from "../kosten";
import { STATUS_WARTEND, bereinigeFehler, isoOderNull, istObjekt, mitternachtBerlin, textOderNull, verbinde } from "../status-server";
import type { Seitenergebnis } from "../status-server";
import { pruefeMedienFreigabe } from "../medien-freigabe";
import type { MedienRegelVorgaben } from "../medien-freigabe";
import { ankerManifest } from "./anker";
import { KI_HINWEIS_BILD, KI_PFLICHTZEILE_CAPTION } from "./ki-hinweis";
import { pruefeAusschnitt } from "./medien";
import { DATIERUNG_AUSNAHMEN, nochNichtGebautText } from "./objekte";
import type { StudioObjekt } from "./objekte";
import type {
  AbgleichUrteil,
  AssetKosten,
  MedienKette,
  MedienRolle,
  MediumArt,
  MediumMime,
  ObjektDatierung,
  ObjektKopf,
  PromptKlausel,
  StudioAsset,
  StudioAssetsTeil,
  StudioCredits,
  StudioFehlerArt,
  StudioKosten,
  StudioMedienTeil,
  StudioMedium,
  StudioMesswert,
  StudioPruefung,
} from "./typen";
import type { ContentMetadata } from "@/components/studio/beleg-hilfen";

export const QUELLE_EXPORT = "Steinadel-Export über /api/objekte";
export const QUELLE_KOSTEN =
  "content.metadata.steps[].cost — je Stufe gespeicherte Schätzung der activate-Route (Tokens × Preistabelle zum Laufzeitpunkt)";
export const QUELLE_CREDITS = "Supabase · studio_medium.kosten_credits der Originale (Beleg der erzeugenden Sitzung)";

/**
 * Deckel für Higgsfield-Credits in Stufe 2 (Entscheidung E18 des Inhabers, 10.11.2026): 100 Credits, jedes
 * eingespielte Original zählt mit. Angezeigt, nicht erzwungen — in Weg 2a erzeugt eine Claude-Sitzung, nicht dieser Server.
 */
export const CREDIT_DECKEL: number | null = 100;

/** Spalten der Asset-Abfrage: was Karte und Beleg-Kette lesen (metadata ganz, wie /content). */
export const ASSET_SPALTEN = "id, title, platform, content_type, status, created_at, updated_at, body, review_notes, metadata";

export function quelleAssets(slug: string): string {
  return `Supabase · content (metadata.objekt_slug = ${slug})`;
}

/** Unlesbare Zeile oder Antwort: macht den Teil zu "fehler". Jede andere Ausnahme ist ein Programmfehler (500). */
export class StudioLeseFehler extends Error {}

function maskiertOderNull(text: string | null): string | null {
  return text === null ? null : maskiereGeschuetzteNamen(text);
}

/** Gescheiterter Teil: kein Wert, Zeitpunkt des Versuchs, bereinigter Grund, Ursache. */
export function teilFehler<T>(quelle: string, versuchAm: string, art: StudioFehlerArt, grund: string): StudioMesswert<T> {
  return { wert: null, status: "fehler", quelle, gemessen_am: versuchAm, hinweis: bereinigeFehler(grund), fehler_art: art };
}

/** Noch nicht gebauter Teil: ohne Zahl und ohne Messzeitpunkt, mit dem Bauschritt. */
export function nochNichtGebaut(quelle: string, schritt: number): StudioMesswert<null> {
  return { wert: null, status: "noch_nicht_gebaut", quelle, gemessen_am: null, hinweis: nochNichtGebautText(schritt), schritt };
}

// ── Objektkopf aus dem Steinadel-Export ─────────────────────────────────────────────────────────

const EXPORT_ARTEN: readonly StudioFehlerArt[] = ["konfiguration", "nicht_erreichbar", "quelle_fehler"];

/**
 * Ursache einer Fehlerantwort von /api/objekte — dieselbe Regel wie objekteFehlerArt in
 * lib/hooks-status.ts (Anzeige von Lagebild und /expose): 401 der Middleware, sonst das Feld
 * fehler_art der Route, sonst aus dem Code abgeleitet.
 */
export function exportFehlerArt(httpStatus: number, fehler: string | null, fehlerArt: unknown): StudioFehlerArt {
  if (httpStatus === 401) return "nicht_angemeldet";
  if (typeof fehlerArt === "string" && (EXPORT_ARTEN as readonly string[]).includes(fehlerArt)) return fehlerArt as StudioFehlerArt;
  const t = (fehler ?? "").trim();
  if (t === "quelle_nicht_erreichbar") return "nicht_erreichbar";
  if (/^quelle_http_\d{3}$/.test(t) || t === "quelle_antwort_unlesbar") return "quelle_fehler";
  return "unbekannt";
}

/**
 * Fehlerantwort von /api/objekte als Teil "fehler". Der Hinweis ist der Code der Route bzw. "HTTP <Status>".
 * Generisch seit Schritt 6 (10.11.2026): Auch der Cover-Abgleich der Anker-Prüfung liest den Export.
 */
export function exportFehlerAusAntwort<T = ObjektKopf>(httpStatus: number, daten: unknown, versuchAm: string): StudioMesswert<T> {
  const obj = istObjekt(daten) ? daten : null;
  const feld = obj ? (textOderNull(obj.fehler) ?? textOderNull(obj.error)) : null;
  const fehler = feld !== null && feld.trim() !== "" ? feld.trim() : null;
  const grund = httpStatus === 401 ? "HTTP 401" : (fehler ?? `HTTP ${httpStatus}`);
  return teilFehler<T>(QUELLE_EXPORT, versuchAm, exportFehlerArt(httpStatus, fehler, obj?.fehler_art), grund);
}

/** Ganze Zahl aus dem Export (Zahl oder Ziffernfolge); sonst null. */
function ganzeZahl(wert: unknown): number | null {
  if (typeof wert === "number") return Number.isInteger(wert) ? wert : null;
  if (typeof wert === "string" && /^\d{1,6}$/.test(wert.trim())) return Number(wert.trim());
  return null;
}

/**
 * Objektkopf aus der Antwort von /api/objekte (Status 2xx). Texte maskiert, Preis wörtlich, die
 * Datierung mit der Objekt-Ausnahme aus lib/studio/objekte.ts. Fehlende Felder heißen "nicht im
 * Export" (Teil "warnung"), nie ein Ersatzwert.
 */
export function kopfAusExport(daten: unknown, slug: StudioObjekt, abgerufenAm: string): StudioMesswert<ObjektKopf> {
  if (!istObjekt(daten) || !Array.isArray(daten.objekte)) {
    return teilFehler(QUELLE_EXPORT, abgerufenAm, "quelle_fehler", "Antwort ohne Objektliste");
  }
  const roh = (daten.objekte as unknown[]).find((o): o is Record<string, unknown> => istObjekt(o) && o.slug === slug);
  if (!roh) return teilFehler(QUELLE_EXPORT, abgerufenAm, "nicht_im_export", `Objekt „${slug}“ nicht im Steinadel-Export`);

  const fehlend: string[] = [];
  const text = (feld: string): string | null => {
    const wert = roh[feld];
    if (typeof wert === "string" && wert.trim() !== "") return maskiereGeschuetzteNamen(wert);
    fehlend.push(feld);
    return null;
  };
  const name = text("name");
  const ort = text("ort");
  const status = text("statusBadge");
  const preis = text("preis");

  const baujahr = ganzeZahl(roh.baujahr);
  if (baujahr === null) fehlend.push("baujahr");
  const ausnahme = DATIERUNG_AUSNAHMEN[slug] ?? null;
  let ausnahmeGreiftNicht: string | null = null;
  let datierung: ObjektDatierung | null = null;
  if (baujahr !== null) {
    if (ausnahme !== null && baujahr === ausnahme.jahr) {
      datierung = { bezeichnung: ausnahme.bezeichnung, jahr: baujahr, ausnahme: ausnahme.quelle };
    } else {
      if (ausnahme !== null) {
        ausnahmeGreiftNicht = `Objekt-Ausnahme „${ausnahme.bezeichnung}“ gilt nur für den Exportwert ${ausnahme.jahr}; der Export nennt ${baujahr}, angezeigt als Baujahr.`;
      }
      datierung = { bezeichnung: "Baujahr", jahr: baujahr, ausnahme: ausnahmeGreiftNicht };
    }
  }

  const prozent = typeof roh.afaProzent === "number" && Number.isFinite(roh.afaProzent) ? roh.afaProzent : null;
  if (prozent === null) fehlend.push("afaProzent");
  const denkmal = typeof roh.istDenkmal === "boolean" ? roh.istDenkmal : null;
  if (denkmal === null) fehlend.push("istDenkmal");

  const generiertRoh = textOderNull(daten.generiert_am);
  const generiertAm = isoOderNull(generiertRoh);
  if (generiertAm === null) fehlend.push(generiertRoh === null ? "generiert_am" : "generiert_am (unlesbar)");

  const kopf: ObjektKopf = {
    slug,
    name,
    ort,
    datierung,
    status,
    preis,
    afa: prozent === null ? null : { prozent, denkmal },
    export: {
      version: maskiertOderNull(textOderNull(daten.version)),
      quelle: maskiertOderNull(textOderNull(daten.quelle)),
      generiert_am: generiertAm,
    },
    fehlende_felder: fehlend,
  };
  const hinweis = verbinde(fehlend.length > 0 ? `nicht im Export: ${fehlend.join(", ")}` : null, ausnahmeGreiftNicht);
  return {
    wert: kopf,
    status: hinweis ? "warnung" : "ok",
    quelle: `Steinadel-Export · ${generiertAm ? `generiert_am ${generiertAm}` : "ohne generiert_am"}`,
    gemessen_am: abgerufenAm,
    ...(hinweis ? { hinweis } : {}),
  };
}

// ── Assets und Kosten aus content ──────────────────────────────────────────────────────────────

/** Gerundet auf 1e-9 USD: entfernt Gleitkomma-Reste, behält jede gespeicherte Stelle. */
function runde(usd: number): number {
  return Math.round(usd * 1e9) / 1e9;
}

/**
 * Ist die Stufe gelaufen? Seit Stufe 1 trägt jede Stufe status ("pending" = nicht gelaufen). Läufe
 * davor (in content vom 27. bis 29.07.2026, gemessen per SQL am 08.11.2026) haben keinen status;
 * dort trägt eine gelaufene Stufe cost, output oder duration_ms, eine nicht gelaufene nur agent.
 */
function stufeGelaufen(stufe: Record<string, unknown>): boolean {
  if (typeof stufe.status === "string") return stufe.status !== "pending";
  return "cost" in stufe || "output" in stufe || "duration_ms" in stufe;
}

/** Kosten der gelaufenen Stufen; null, wenn metadata.steps fehlt. Unlesbare Stufen zählen als gelaufen ohne Angabe. */
export function stufenKosten(steps: unknown): AssetKosten | null {
  if (!Array.isArray(steps)) return null;
  let gelaufen = 0;
  let mitAngabe = 0;
  let summe = 0;
  for (const stufe of steps) {
    if (istObjekt(stufe) && !stufeGelaufen(stufe)) continue;
    gelaufen++;
    const kosten = istObjekt(stufe) ? stufe.cost : undefined;
    if (typeof kosten === "number" && Number.isFinite(kosten) && kosten >= 0) {
      mitAngabe++;
      summe += kosten;
    }
  }
  return {
    summe_usd: mitAngabe > 0 ? runde(summe) : null,
    stufen_gelaufen: gelaufen,
    stufen_mit_angabe: mitAngabe,
    stufen_ohne_angabe: gelaufen - mitAngabe,
  };
}

function stufenText(n: number): string {
  return n === 1 ? "1 Stufe" : `${n} Stufen`;
}

function laeufeText(n: number): string {
  return n === 1 ? "1 Lauf" : `${n} Läufe`;
}

/** Kosten eines Laufs als Messwert: ohne jede Angabe "nicht_gemessen" (wert null), mit Lücken "warnung". */
export function assetKosten(metadata: ContentMetadata | null, gemessenAm: string): StudioMesswert<AssetKosten> {
  const k = stufenKosten(metadata?.steps);
  if (k === null) {
    return { wert: null, status: "nicht_gemessen", quelle: QUELLE_KOSTEN, gemessen_am: null, hinweis: "keine Stufen gespeichert (metadata.steps fehlt)" };
  }
  if (k.summe_usd === null) {
    const hinweis =
      k.stufen_gelaufen === 0 ? "keine gelaufene Stufe gespeichert" : `${stufenText(k.stufen_gelaufen)} gelaufen, keine mit Kostenangabe`;
    return { wert: null, status: "nicht_gemessen", quelle: QUELLE_KOSTEN, gemessen_am: null, hinweis };
  }
  if (k.stufen_ohne_angabe > 0) {
    return {
      wert: k,
      status: "warnung",
      quelle: QUELLE_KOSTEN,
      gemessen_am: gemessenAm,
      hinweis: `Untergrenze: ${stufenText(k.stufen_ohne_angabe)} von ${k.stufen_gelaufen} gelaufenen ohne Kostenangabe`,
    };
  }
  return { wert: k, status: "ok", quelle: QUELLE_KOSTEN, gemessen_am: gemessenAm };
}

/**
 * Medien außerhalb der Zeilen dieses Objekts, auf die eine Caption zeigt (GET /api/studio liest sie nach; Nachbesserung
 * caption9-2): je id Objekt und Fassung, null = keine Zeile mit dieser id. "nicht_gelesen" = Abfrage gescheitert.
 */
export type FremdeMedien =
  | { art: "gelesen"; slug: string; zeilen: ReadonlyMap<number, { objekt_slug: unknown; fassung: unknown } | null> }
  | { art: "nicht_gelesen" };

/** Höchstzahl nachgelesener Medien außerhalb des Objekts je Anfrage (wie der Stapel, FREIGABEN_MEDIEN_HOECHSTENS). */
export const FREMDE_MEDIEN_HOECHSTENS = 25;

/** ids aus metadata.medium_id der Karten, die nicht unter den Zeilen dieses Objekts stehen (höchstens FREMDE_MEDIEN_HOECHSTENS). */
export function fremdeMedienIds(assets: StudioAssetsTeil, medien: StudioMedienTeil): number[] {
  if (assets.wert === null || medien.wert === null || medien.status === "fehler" || medien.wert.abgeschnitten) return [];
  const eigene = new Set(medien.wert.zeilen.map((z) => z.id));
  const ids = new Set<number>();
  for (const a of assets.wert) {
    const m = mediumIdAus((a.beleg.metadata as Record<string, unknown> | null)?.medium_id);
    if (m.video && m.id !== null && !eigene.has(m.id)) ids.add(m.id);
  }
  return [...ids].sort((x, y) => x - y).slice(0, FREMDE_MEDIEN_HOECHSTENS);
}

/**
 * Schritt 9 (10.11.2026): Captions zu einem Video (metadata.medium_id) sperren auf der Karte mit derselben Funktion wie
 * Freigeben und Stapel (pruefeVideoFreigabe): Caption-Regel, Pflichtzeile und das Urteil der Medien-Regel aus dem Teil
 * medien (Kette des Exports). Ist der Teil nicht lesbar (oder gekappt), gilt das Urteil als nicht ermittelt. Seit der
 * Nachbesserung caption9-2 mit denselben Gründen wie Freigeben und Stapel: kein Export (Zeile dieses Objekts), fremdes
 * Objekt oder nicht gefunden (aus fremde, von der Route nachgelesen; ohne Lesung: nicht ermittelt). Ob eine Karte ein
 * Video hat, entscheidet mediumIdAus (null wie fehlend). Karten ohne Video bleiben unverändert.
 *
 * Bewusste Ausnahmen vom gleichen ersten Grund (Nachtrag d2-stapel-4, gemessen in der Delta-Prüfung; alle fail-closed):
 * (b) Eine unlesbare Medien-Zeile irgendwo im Objekt macht den Teil medien zu „fehler“, die Karte sagt dann für jedes
 *     Video „nicht ermittelt“, Stapel und Freigeben urteilen je Kette. (c) Fremde Medien liest die Route nur mit id,
 *     Objekt und Fassung nach; ist eine fremde Zeile sonst unlesbar, sagt die Karte „gehört nicht zum Objekt“, der Stapel
 *     „nicht lesbar“, das Freigeben 502. (d) Die Kappen auf 25 wählen verschiedene ids: der Stapel aus allen Video-Captions
 *     des Stapels, die Karte nur aus den fremden ids dieses Objekts. (b) und (c) entstehen nur durch Schreiben an Pipeline
 *     und App vorbei oder durch einen Datenbankfehler, (d) erst ab mehr als 25 Video-Captions.
 */
export function mitMedienUrteil(assets: StudioAssetsTeil, medien: StudioMedienTeil, fremde: FremdeMedien = { art: "nicht_gelesen" }): StudioAssetsTeil {
  if (assets.wert === null) return assets;
  const lesbar = medien.status !== "fehler" && medien.wert !== null;
  const urteile = new Map<number, MedienSperre>();
  if (lesbar && medien.wert !== null) for (const k of medien.wert.ketten) urteile.set(k.export.id, { freigebbar: k.urteil.freigebbar, gruende: k.urteil.gruende });
  const gesperrt = (grund: string): MedienSperre => ({ freigebbar: false, gruende: [grund] });
  /** Urteil für eine id ohne Kette dieses Objekts: dieselben Gründe in derselben Reihenfolge wie mediumZurFreigabe. */
  const ohneKette = (id: number): MedienSperre | null => {
    if (medien.wert === null) return null;
    const eigene = medien.wert.zeilen.find((z) => z.id === id);
    if (eigene !== undefined) return eigene.fassung === "export" ? null : gesperrt(MEDIUM_KEIN_EXPORT);
    if (medien.wert.abgeschnitten || fremde.art !== "gelesen" || !fremde.zeilen.has(id)) return null;
    const f = fremde.zeilen.get(id) ?? null;
    if (f === null) return gesperrt(`Medium ${id} nicht gefunden`);
    // Vorhanden, aber nicht unter den (vollständig gelesenen) Zeilen dieses Objekts: ein anderes Objekt. Trägt die
    // Zeile doch dieses Objekt, ist sie seit dem Lesen neu — dann nicht ermittelt.
    return f.objekt_slug === fremde.slug ? null : gesperrt(`Medium ${id} gehört nicht zum Objekt dieser Zeile`);
  };
  const wert = assets.wert.map((a) => {
    const meta = a.beleg.metadata as Record<string, unknown> | null;
    const m = mediumIdAus(meta?.medium_id);
    if (!m.video) return a;
    const id = m.id;
    const sperre: MedienSperre | null =
      id === null ? gesperrt(MEDIUM_ID_UNLESBAR) : !lesbar ? null : (urteile.get(id) ?? ohneKette(id));
    const p = pruefeVideoFreigabe(
      werteCounselAus(a.beleg.review_notes),
      a.beleg.body,
      geprueftenTextAusSchritten(a.beleg.metadata?.steps, a.beleg.review_notes),
      sperre,
      KI_PFLICHTZEILE_CAPTION,
    );
    const grund = p.grund ?? (a.beleg.status === STATUS_WARTEND ? null : `Status "${a.beleg.status}" — freigebbar ist nur "${STATUS_WARTEND}"`);
    return { ...a, freigabe_sperre: grund === null ? null : maskiereGeschuetzteNamen(grund) };
  });
  return { ...assets, wert };
}

/** Eine content-Zeile als Asset; wirft StudioLeseFehler, wenn Pflichtfelder unlesbar sind. */
export function zuAsset(z: unknown, gemessenAm: string): StudioAsset {
  if (!istObjekt(z)) throw new StudioLeseFehler("unerwartete Zeilenform");
  const id = typeof z.id === "number" ? z.id : typeof z.id === "string" && /^\d{1,15}$/.test(z.id) ? Number(z.id) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new StudioLeseFehler("Eintrag ohne lesbare id");
  // created_at ist DEFAULT NOW(); fehlt es, wird nicht geraten — die Liste gilt als nicht lesbar.
  const erstellt = isoOderNull(z.created_at);
  if (!erstellt) throw new StudioLeseFehler(`Eintrag ${id} ohne lesbares created_at`);
  if (typeof z.status !== "string") throw new StudioLeseFehler(`Eintrag ${id} ohne lesbaren Status`);
  const status = z.status;
  const body = textOderNull(z.body);
  const reviewNotes = textOderNull(z.review_notes);
  // metadata kommt ungeprüft aus der DB, wie auf /content; die Beleg-Kette liest sie defensiv.
  const metadata = istObjekt(z.metadata) ? (z.metadata as ContentMetadata) : null;

  // Urteil und Sperre mit derselben Regel wie GET /api/freigaben und das Freigeben (content/status).
  const counsel = werteCounselAus(reviewNotes);
  const pruefung = pruefeFreigabe(counsel, body, geprueftenTextAusSchritten(metadata?.steps, reviewNotes));
  const sperre = pruefung.grund ?? (status === STATUS_WARTEND ? null : `Status "${status}" — freigebbar ist nur "${STATUS_WARTEND}"`);

  return {
    id,
    titel: maskiertOderNull(textOderNull(z.title)),
    art: "text",
    kanal: maskiertOderNull(textOderNull(z.platform)),
    format: maskiertOderNull(textOderNull(z.content_type)),
    // Anzeigefeld maskiert; die Beleg-Kette rechnet mit dem gespeicherten Status (beleg.status).
    status: maskiereGeschuetzteNamen(status),
    erstellt_am: erstellt,
    geaendert_am: isoOderNull(z.updated_at),
    counsel: { urteil: pruefung.urteil, zeile: pruefung.zeile, grund: counsel.grund, abgeleitet: true },
    freigabe_sperre: sperre === null ? null : maskiereGeschuetzteNamen(sperre),
    kosten_usd: assetKosten(metadata, gemessenAm),
    beleg: { id, status, body, review_notes: reviewNotes, metadata },
  };
}

/** Assets-Teil bei Lesefehler: wert null (keine Liste), Ursache und Grund. */
export function assetsFehler(slug: string, versuchAm: string, art: StudioFehlerArt, grund: string): StudioAssetsTeil {
  return { ...teilFehler<StudioAsset[]>(quelleAssets(slug), versuchAm, art, grund), gesamt: null };
}

/** Assets-Teil aus der seitenweisen Lesung; eine unlesbare Zeile macht den ganzen Teil zu "fehler". */
export function assetsAusLesung(lesung: Seitenergebnis, slug: string, gemessenAm: string): StudioAssetsTeil {
  let liste: StudioAsset[];
  try {
    liste = lesung.zeilen.map((z) => zuAsset(z, gemessenAm));
  } catch (e) {
    if (e instanceof StudioLeseFehler) return assetsFehler(slug, gemessenAm, "supabase", `Zeile nicht lesbar: ${e.message}`);
    throw e;
  }
  const hinweis = verbinde(
    lesung.abgeschnitten ? `nur ${liste.length} von ${lesung.gesamt ?? "unbekannt vielen"} Zeilen geladen` : null,
    lesung.gesamt === null ? "Supabase lieferte keine Zählung; gezählt sind die geladenen Zeilen" : null,
  );
  return {
    wert: liste,
    status: hinweis ? "warnung" : "ok",
    quelle: quelleAssets(slug),
    gemessen_am: gemessenAm,
    ...(hinweis ? { hinweis } : {}),
    gesamt: lesung.gesamt,
  };
}

/** Tag im deutschen Format aus JJJJ-MM-TT, z. B. "06.11.2026". */
function tagText(datum: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : datum;
}

/**
 * Kosten je Objekt: Summe über die Läufe (content-Zeilen) mit Kostenangabe, geschätzt in USD.
 * Läufe ohne jede Angabe fehlen in der Summe und werden gezählt ("n Läufe ohne Kostenangabe").
 */
export function kostenAusAssets(assets: StudioAssetsTeil): StudioMesswert<StudioKosten> {
  if (assets.status === "fehler" || assets.wert === null) {
    return {
      wert: null,
      status: "fehler",
      quelle: QUELLE_KOSTEN,
      gemessen_am: assets.gemessen_am,
      hinweis: `Läufe nicht lesbar: ${assets.hinweis ?? "ohne Grund"}`,
      fehler_art: assets.fehler_art ?? "unbekannt",
    };
  }
  // Ab diesem Zeitpunkt (Mitternacht Europe/Berlin) gilt die Preistabelle von PREIS_STAND_AB.
  const preisWechselMs = mitternachtBerlin(new Date(`${PREIS_STAND_AB}T12:00:00Z`)).getTime();
  let summe = 0;
  let mitAngabe = 0;
  let ohneAngabe = 0;
  let unvollstaendig = 0;
  let altePreistabelle = 0;
  for (const a of assets.wert) {
    const k = a.kosten_usd.wert;
    if (k === null || k.summe_usd === null) {
      ohneAngabe++;
      continue;
    }
    mitAngabe++;
    summe += k.summe_usd;
    if (k.stufen_ohne_angabe > 0) unvollstaendig++;
    if (Date.parse(a.erstellt_am) < preisWechselMs) altePreistabelle++;
  }
  const laeufe = assets.wert.length;
  const wert: StudioKosten = {
    summe: mitAngabe > 0 ? runde(summe) : null,
    laeufe,
    laeufe_mit_angabe: mitAngabe,
    laeufe_ohne_angabe: ohneAngabe,
    laeufe_unvollstaendig: unvollstaendig,
    laeufe_alte_preistabelle: altePreistabelle,
  };
  const abgeschnitten = assets.gesamt !== null && laeufe < assets.gesamt;
  const ohneZaehlung = assets.gesamt === null;
  const luecke = ohneAngabe > 0 || unvollstaendig > 0 || abgeschnitten || ohneZaehlung;
  const hinweis = verbinde(
    "Schätzung, keine Abrechnung; maßgeblich ist die Anthropic-Rechnung",
    laeufe === 0 ? "keine Läufe zu diesem Objekt in content" : null,
    laeufe > 0 && mitAngabe === 0 ? `keiner der ${laeufe} Läufe trägt eine Kostenangabe` : null,
    ohneAngabe > 0 && mitAngabe > 0 ? `${laeufeText(ohneAngabe)} ohne Kostenangabe nicht summiert` : null,
    unvollstaendig > 0 ? `${laeufeText(unvollstaendig)} mit Stufen ohne Kostenangabe (Untergrenze)` : null,
    abgeschnitten ? `Untergrenze: nur ${laeufe} von ${assets.gesamt} Läufen geladen` : null,
    ohneZaehlung ? "Vollständigkeit nicht prüfbar: Supabase lieferte keine Zählung" : null,
    altePreistabelle > 0
      ? `${altePreistabelle} von ${mitAngabe} summierten Läufen vor dem ${tagText(PREIS_STAND_AB)}: mit der alten Preistabelle geschätzt und nicht umgerechnet (laut lib/kosten.ts Sonnet zu hoch, Haiku zu niedrig); für spätere Läufe speichert die Pipeline keine Preis-Kennung`
      : null,
  );
  return {
    wert,
    status: luecke ? "warnung" : "ok",
    quelle: QUELLE_KOSTEN,
    gemessen_am: assets.gemessen_am,
    ...(hinweis ? { hinweis } : {}),
  };
}

// ── Medien und Credits aus studio_medium (Schritt 7, 10.11.2026) ─────────────────────────────────

export const QUELLE_MEDIEN = "Supabase · studio_medium";

/** Alle Spalten von studio_medium außer den beiden berechneten Ziel-Spalten der Fremdschlüssel. */
export const MEDIUM_SPALTEN =
  "id, objekt_slug, art, fassung, startbild_id, abgeleitet_von, speicher_pfad, sha256, bytes, mime, breite, hoehe, fps, dauer_s, aigc_kennzeichen, schnitt_von_s, schnitt_bis_s, anker_id, anker_sha256, ausschnitt, startbild_abgleich, startbild_abweichung_max, erzeuger, modell, job_id, parameter, prompt, prompt_klauseln, ki_hinweis_text, kosten_vorschau_credits, kosten_credits, kosten_usd, kosten_quelle, eingespielt_am";

const ROLLEN: readonly MedienRolle[] = ["startbild", "original", "export"];
const MIMES: readonly MediumMime[] = ["video/mp4", "image/jpeg", "image/png"];

function idOderNull(x: unknown, feld: string, id: number): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : typeof x === "string" && /^\d{1,15}$/.test(x) ? Number(x) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new StudioLeseFehler(`Medium ${id}: ${feld} unlesbar`);
  return n;
}

function zahlFeld(x: unknown, feld: string, id: number): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : Number.NaN;
  if (!Number.isFinite(n)) throw new StudioLeseFehler(`Medium ${id}: ${feld} unlesbar`);
  return n;
}

function textFeld(x: unknown, feld: string, id: number): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== "string") throw new StudioLeseFehler(`Medium ${id}: ${feld} unlesbar`);
  return x;
}

/** Eine Zeile aus studio_medium; wirft StudioLeseFehler, wenn ein Feld nicht die Form der Tabelle hat. */
export function leseMediumZeile(z: unknown): StudioMedium {
  if (!istObjekt(z)) throw new StudioLeseFehler("unerwartete Zeilenform");
  const id = idOderNull(z.id, "id", 0);
  if (id === null) throw new StudioLeseFehler("Medium ohne lesbare id");
  const pflicht = (feld: string): string => {
    const t = textFeld(z[feld], feld, id);
    if (t === null) throw new StudioLeseFehler(`Medium ${id}: ${feld} fehlt`);
    return t;
  };
  const art = pflicht("art");
  const fassung = pflicht("fassung");
  const mime = pflicht("mime");
  if (art !== "video" && art !== "bild") throw new StudioLeseFehler(`Medium ${id}: art unlesbar`);
  if (!(ROLLEN as readonly string[]).includes(fassung)) throw new StudioLeseFehler(`Medium ${id}: fassung unlesbar`);
  if (!(MIMES as readonly string[]).includes(mime)) throw new StudioLeseFehler(`Medium ${id}: mime unlesbar`);
  const bytes = zahlFeld(z.bytes, "bytes", id);
  if (bytes === null || !Number.isSafeInteger(bytes) || bytes <= 0) throw new StudioLeseFehler(`Medium ${id}: bytes unlesbar`);
  const sha256 = pflicht("sha256");
  const ankerSha = pflicht("anker_sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256) || !/^[0-9a-f]{64}$/.test(ankerSha)) throw new StudioLeseFehler(`Medium ${id}: SHA-256 unlesbar`);
  const eingespielt = isoOderNull(z.eingespielt_am);
  if (eingespielt === null) throw new StudioLeseFehler(`Medium ${id}: eingespielt_am unlesbar`);
  let ausschnitt: StudioMedium["ausschnitt"] = null;
  if (z.ausschnitt !== null && z.ausschnitt !== undefined) {
    const a = pruefeAusschnitt(z.ausschnitt);
    if (!a.ok) throw new StudioLeseFehler(`Medium ${id}: ausschnitt unlesbar`);
    ausschnitt = a.wert;
  }
  const abgleich = textFeld(z.startbild_abgleich, "startbild_abgleich", id);
  if (abgleich !== null && abgleich !== "bestanden" && abgleich !== "nicht_bestanden") throw new StudioLeseFehler(`Medium ${id}: startbild_abgleich unlesbar`);
  if (!istObjekt(z.parameter)) throw new StudioLeseFehler(`Medium ${id}: parameter unlesbar`);
  if (!Array.isArray(z.prompt_klauseln)) throw new StudioLeseFehler(`Medium ${id}: prompt_klauseln unlesbar`);
  const klauseln: PromptKlausel[] = (z.prompt_klauseln as unknown[]).map((k) => {
    if (!istObjekt(k) || typeof k.id !== "string" || typeof k.text !== "string") throw new StudioLeseFehler(`Medium ${id}: prompt_klauseln unlesbar`);
    return { id: k.id, text: k.text };
  });
  const aigc = z.aigc_kennzeichen;
  if (aigc !== null && aigc !== undefined && typeof aigc !== "boolean") throw new StudioLeseFehler(`Medium ${id}: aigc_kennzeichen unlesbar`);
  return {
    id,
    objekt_slug: pflicht("objekt_slug"),
    art: art as MediumArt,
    fassung: fassung as MedienRolle,
    startbild_id: idOderNull(z.startbild_id, "startbild_id", id),
    abgeleitet_von: idOderNull(z.abgeleitet_von, "abgeleitet_von", id),
    speicher_pfad: pflicht("speicher_pfad"),
    sha256,
    bytes,
    mime: mime as MediumMime,
    breite: zahlFeld(z.breite, "breite", id),
    hoehe: zahlFeld(z.hoehe, "hoehe", id),
    fps: zahlFeld(z.fps, "fps", id),
    dauer_s: zahlFeld(z.dauer_s, "dauer_s", id),
    aigc_kennzeichen: typeof aigc === "boolean" ? aigc : null,
    schnitt_von_s: zahlFeld(z.schnitt_von_s, "schnitt_von_s", id),
    schnitt_bis_s: zahlFeld(z.schnitt_bis_s, "schnitt_bis_s", id),
    anker_id: pflicht("anker_id"),
    anker_sha256: ankerSha,
    ausschnitt,
    startbild_abgleich: abgleich as AbgleichUrteil | null,
    startbild_abweichung_max: zahlFeld(z.startbild_abweichung_max, "startbild_abweichung_max", id),
    erzeuger: textFeld(z.erzeuger, "erzeuger", id),
    modell: textFeld(z.modell, "modell", id),
    job_id: textFeld(z.job_id, "job_id", id),
    parameter: z.parameter,
    prompt: textFeld(z.prompt, "prompt", id),
    prompt_klauseln: klauseln,
    ki_hinweis_text: textFeld(z.ki_hinweis_text, "ki_hinweis_text", id),
    kosten_vorschau_credits: zahlFeld(z.kosten_vorschau_credits, "kosten_vorschau_credits", id),
    kosten_credits: zahlFeld(z.kosten_credits, "kosten_credits", id),
    kosten_usd: zahlFeld(z.kosten_usd, "kosten_usd", id),
    kosten_quelle: textFeld(z.kosten_quelle, "kosten_quelle", id),
    eingespielt_am: eingespielt,
  };
}

/**
 * Je Export eine Kette Export → Original → Startbild (neueste zuerst); was fehlt, steht in luecken. Seit Schritt 8 mit
 * den Prüfprotokollen des Exports (jüngstes zuerst; null = nicht lesbar) und dem Urteil der Medien-Regel.
 */
export function medienKetten(
  zeilen: readonly StudioMedium[],
  pruefungen: readonly StudioPruefung[] | null = [],
  vorgaben: MedienRegelVorgaben = { anker: null, ki_hinweis_bild: KI_HINWEIS_BILD },
): { ketten: MedienKette[]; einzeln: number[] } {
  const jeId = new Map(zeilen.map((z) => [z.id, z]));
  const inKette = new Set<number>();
  const ketten: MedienKette[] = [];
  for (const ex of [...zeilen].filter((z) => z.fassung === "export").sort((a, b) => b.id - a.id)) {
    const luecken: string[] = [];
    inKette.add(ex.id);
    const og = ex.abgeleitet_von === null ? null : (jeId.get(ex.abgeleitet_von) ?? null);
    const original = og !== null && og.fassung === "original" && og.objekt_slug === ex.objekt_slug ? og : null;
    if (original === null) luecken.push(ex.abgeleitet_von === null ? "Export ohne Verweis auf ein Original" : `Original ${ex.abgeleitet_von} nicht gefunden`);
    let startbild: StudioMedium | null = null;
    if (original !== null) {
      inKette.add(original.id);
      const sb = original.startbild_id === null ? null : (jeId.get(original.startbild_id) ?? null);
      startbild = sb !== null && sb.fassung === "startbild" && sb.objekt_slug === original.objekt_slug ? sb : null;
      if (startbild === null) luecken.push(original.startbild_id === null ? "Original ohne Verweis auf ein Startbild" : `Startbild ${original.startbild_id} nicht gefunden`);
      else inKette.add(startbild.id);
    }
    const eigene = pruefungen === null ? null : jungeZuerst(pruefungen.filter((p) => p.medium_id === ex.id));
    const r = pruefeMedienFreigabe({ export: ex, original, startbild }, eigene, vorgaben);
    ketten.push({ export: ex, original, startbild, luecken, pruefungen: eigene, urteil: { freigebbar: r.freigebbar, gruende: r.gruende, pruefung_id: r.pruefung_id } });
  }
  return { ketten, einzeln: zeilen.filter((z) => !inKette.has(z.id)).map((z) => z.id) };
}

export function medienFehler(versuchAm: string, art: StudioFehlerArt, grund: string): StudioMedienTeil {
  return teilFehler(QUELLE_MEDIEN, versuchAm, art, grund);
}

/**
 * Medien-Teil aus den gelesenen Zeilen; eine unlesbare Medien-Zeile macht den ganzen Teil zu "fehler". Prüfprotokolle
 * (Schritt 8): pruefungenRoh null = nicht gelesen bzw. Lesefehler (pruefungenGrund); eine unlesbare Protokoll-Zeile
 * ebenso. Dann sperrt die Regel jedes Video mit „Prüfprotokolle nicht lesbar“, und der Teil warnt.
 */
export function medienAusZeilen(
  roh: readonly unknown[],
  gemessenAm: string,
  abgeschnitten = false,
  pruefungenRoh: readonly unknown[] | null = [],
  slug: string | null = null,
  pruefungenGrund: string | null = null,
  protokolleAbgeschnitten = false,
): StudioMedienTeil {
  let zeilen: StudioMedium[];
  try {
    zeilen = roh.map(leseMediumZeile).sort((a, b) => a.id - b.id);
  } catch (e) {
    if (e instanceof StudioLeseFehler) return medienFehler(gemessenAm, "supabase", `Zeile nicht lesbar: ${e.message}`);
    throw e;
  }
  let pruefungen: StudioPruefung[] | null = null;
  let protokollGrund = pruefungenGrund;
  if (pruefungenRoh !== null) {
    try {
      pruefungen = pruefungenRoh.map(leseProtokollZeile);
    } catch (e) {
      if (!(e instanceof StudioLeseFehler)) throw e;
      protokollGrund = e.message;
    }
  }
  const { ketten, einzeln } = medienKetten(zeilen, pruefungen, slug === null ? undefined : medienVorgaben(slug));
  const hinweis = verbinde(
    pruefungen === null && ketten.length > 0 ? `Prüfprotokolle nicht lesbar${protokollGrund ? `: ${protokollGrund}` : ""} — jedes Video gilt als gesperrt` : null,
    abgeschnitten ? `nur ${zeilen.length} Zeilen geladen` : null,
    protokolleAbgeschnitten && pruefungen !== null
      ? `nur die jüngsten ${pruefungen.length} Prüfprotokolle gelesen — ein Video ohne gelesenes Protokoll bleibt gesperrt`
      : null,
    einzeln.length > 0 ? `${einzeln.length} Zeile(n) in keiner vollständigen Kette (Teilstand eines Einspielens?)` : null,
    ketten.some((k) => k.luecken.length > 0) ? "Kette mit Lücken" : null,
  );
  return {
    wert: { zeilen, ketten, einzeln, abgeschnitten },
    status: hinweis ? "warnung" : "ok",
    quelle: QUELLE_MEDIEN,
    gemessen_am: gemessenAm,
    ...(hinweis ? { hinweis } : {}),
  };
}

function creditText(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 4 });
}

/**
 * Higgsfield-Credits je Objekt: Summe kosten_credits über die Originale — nur Originale tragen Kosten (CHECK
 * studio_medium_kosten_nur_original). Trägt eine andere Zeile doch Kosten, zählt sie nicht und der Teil warnt.
 * USD (Weg 2b) erscheinen hier nie. Ohne Original keine Summe: „0 Credits“ wäre ein Platzhalter.
 */
export function creditsAusMedien(medien: StudioMedienTeil, deckel: number | null = CREDIT_DECKEL): StudioMesswert<StudioCredits> {
  if (medien.status === "fehler" || medien.wert === null) {
    return {
      wert: null,
      status: "fehler",
      quelle: QUELLE_CREDITS,
      gemessen_am: medien.gemessen_am,
      hinweis: `Medien nicht lesbar: ${medien.hinweis ?? "ohne Grund"}`,
      fehler_art: medien.fehler_art ?? "unbekannt",
    };
  }
  const originale = medien.wert.zeilen.filter((z) => z.fassung === "original");
  const mit = originale.filter((z) => z.kosten_credits !== null);
  const fremd = medien.wert.zeilen.filter((z) => z.fassung !== "original" && (z.kosten_credits !== null || z.kosten_vorschau_credits !== null));
  const mitUsd = originale.filter((z) => z.kosten_usd !== null).length;
  const summe = mit.length > 0 ? Math.round(mit.reduce((s, z) => s + (z.kosten_credits as number), 0) * 1e6) / 1e6 : null;
  const rest = summe !== null && deckel !== null ? Math.round((deckel - summe) * 1e6) / 1e6 : null;
  const ohne = originale.length - mit.length;
  // Gekappte Medienliste (Review-Befund 2c): Originale können fehlen, die Summe ist dann eine Untergrenze.
  const gekappt = medien.wert.abgeschnitten === true;
  const hinweis = verbinde(
    gekappt ? "Medienliste gekappt — Summe ist Untergrenze, Rest Obergrenze" : null,
    originale.length === 0 && !gekappt ? "noch kein Video eingespielt" : null,
    ohne > 0 ? `${ohne} Original(e) ohne Credit-Angabe (Summe ist Untergrenze)` : null,
    fremd.length > 0 ? `${fremd.length} Zeile(n) außer Originalen mit Credits — nicht summiert` : null,
    mitUsd > 0 ? `${mitUsd} Original(e) mit USD-Kosten (Weg 2b) — nicht in den Credits` : null,
    deckel === null ? "Deckel nicht entschieden (E18)" : `Deckel ${creditText(deckel)} Credits für Stufe 2 (E18), angezeigt, nicht erzwungen`,
  );
  const luecke = ohne > 0 || fremd.length > 0 || mitUsd > 0 || gekappt;
  return {
    wert: { summe, deckel, rest, originale: originale.length, originale_ohne_angabe: ohne },
    status: summe === null ? "nicht_gemessen" : luecke ? "warnung" : "ok",
    quelle: QUELLE_CREDITS,
    gemessen_am: summe === null ? null : medien.gemessen_am,
    ...(hinweis ? { hinweis } : {}),
  };
}

// ── Prüfprotokolle und Medien-Regel (Schritt 8, 10.11.2026) ─────────────────────────────────────

export const PRUEFUNG_SPALTEN =
  "id, medium_id, medium_sha256, durch, pruefer_kuerzel, klauseln, anker_abgleich, ki_hinweis_eingebrannt, durchsicht_volle_bildrate, rechte_status, rechte_nachweis, notiz, urteil, geprueft_am";

/** Manifest des Objekts und Wortlaut des KI-Hinweises als Vorgaben der Regel. */
export function medienVorgaben(slug: string): MedienRegelVorgaben {
  const m = ankerManifest(slug);
  return { anker: m === null ? null : m.eintraege, ki_hinweis_bild: KI_HINWEIS_BILD };
}

/** Eine Zeile aus studio_pruefung; wirft StudioLeseFehler, wenn ein Feld nicht die Form der Tabelle hat. */
export function leseProtokollZeile(z: unknown): StudioPruefung {
  if (!istObjekt(z)) throw new StudioLeseFehler("Prüfprotokoll: unerwartete Zeilenform");
  const id = typeof z.id === "number" && Number.isSafeInteger(z.id) && z.id > 0 ? z.id : null;
  if (id === null) throw new StudioLeseFehler("Prüfprotokoll ohne lesbare id");
  const fehler = (feld: string) => new StudioLeseFehler(`Prüfprotokoll ${id}: ${feld} unlesbar`);
  if (typeof z.medium_id !== "number" || !Number.isSafeInteger(z.medium_id)) throw fehler("medium_id");
  for (const feld of ["medium_sha256", "durch", "pruefer_kuerzel"]) if (typeof z[feld] !== "string") throw fehler(feld);
  if (!Array.isArray(z.klauseln)) throw fehler("klauseln");
  const klauseln = (z.klauseln as unknown[]).map((k) => {
    if (!istObjekt(k) || typeof k.id !== "string" || typeof k.bestanden !== "boolean") throw fehler("klauseln");
    return { id: k.id, bestanden: k.bestanden };
  });
  const urteil = (feld: string) => {
    if (z[feld] !== "bestanden" && z[feld] !== "nicht_bestanden") throw fehler(feld);
    return z[feld] as "bestanden" | "nicht_bestanden";
  };
  for (const feld of ["ki_hinweis_eingebrannt", "durchsicht_volle_bildrate"]) if (typeof z[feld] !== "boolean") throw fehler(feld);
  if (z.rechte_status !== "offen" && z.rechte_status !== "geklaert") throw fehler("rechte_status");
  const geprueft = isoOderNull(z.geprueft_am);
  if (geprueft === null) throw fehler("geprueft_am");
  return {
    id,
    medium_id: z.medium_id,
    medium_sha256: z.medium_sha256 as string,
    durch: z.durch as string,
    pruefer_kuerzel: z.pruefer_kuerzel as string,
    klauseln,
    anker_abgleich: urteil("anker_abgleich"),
    ki_hinweis_eingebrannt: z.ki_hinweis_eingebrannt as boolean,
    durchsicht_volle_bildrate: z.durchsicht_volle_bildrate as boolean,
    rechte_status: z.rechte_status,
    rechte_nachweis: typeof z.rechte_nachweis === "string" ? z.rechte_nachweis : null,
    notiz: typeof z.notiz === "string" ? z.notiz : null,
    urteil: urteil("urteil"),
    geprueft_am: geprueft,
  };
}

/** Protokolle nach Zeitpunkt (DB-Uhr) und id, jüngstes zuerst — dieselbe Ordnung, nach der die Regel das jüngste wählt. */
export function jungeZuerst(liste: readonly StudioPruefung[]): StudioPruefung[] {
  return [...liste].sort((a, b) => Date.parse(b.geprueft_am) - Date.parse(a.geprueft_am) || b.id - a.id);
}
