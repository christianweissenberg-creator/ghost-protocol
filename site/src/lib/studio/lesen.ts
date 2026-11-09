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
import { maskiereGeschuetzteNamen, pruefeFreigabe } from "../freigabe-regeln";
import { PREIS_STAND_AB } from "../kosten";
import { STATUS_WARTEND, bereinigeFehler, isoOderNull, istObjekt, mitternachtBerlin, textOderNull, verbinde } from "../status-server";
import type { Seitenergebnis } from "../status-server";
import { DATIERUNG_AUSNAHMEN, STUDIO_BAUSCHRITTE, nochNichtGebautText } from "./objekte";
import type { StudioObjekt } from "./objekte";
import type {
  AssetKosten,
  ObjektDatierung,
  ObjektKopf,
  StudioAsset,
  StudioAssetsTeil,
  StudioFehlerArt,
  StudioKosten,
  StudioMesswert,
} from "./typen";
import type { ContentMetadata } from "@/components/studio/beleg-hilfen";

export const QUELLE_EXPORT = "Steinadel-Export über /api/objekte";
export const QUELLE_KOSTEN =
  "content.metadata.steps[].cost — je Stufe gespeicherte Schätzung der activate-Route (Tokens × Preistabelle zum Laufzeitpunkt)";
export const QUELLE_CREDITS = "Higgsfield-Credits je Medium";
export const QUELLE_MESSPLAN = "Messplan des Studios";

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

export function creditsTeil(): StudioMesswert<null> {
  return nochNichtGebaut(QUELLE_CREDITS, STUDIO_BAUSCHRITTE.credits);
}

export function messungTeil(): StudioMesswert<null> {
  return nochNichtGebaut(QUELLE_MESSPLAN, STUDIO_BAUSCHRITTE.messplan);
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

/** Fehlerantwort von /api/objekte als Teil "fehler". Der Hinweis ist der Code der Route bzw. "HTTP <Status>". */
export function exportFehlerAusAntwort(httpStatus: number, daten: unknown, versuchAm: string): StudioMesswert<ObjektKopf> {
  const obj = istObjekt(daten) ? daten : null;
  const feld = obj ? (textOderNull(obj.fehler) ?? textOderNull(obj.error)) : null;
  const fehler = feld !== null && feld.trim() !== "" ? feld.trim() : null;
  const grund = httpStatus === 401 ? "HTTP 401" : (fehler ?? `HTTP ${httpStatus}`);
  return teilFehler(QUELLE_EXPORT, versuchAm, exportFehlerArt(httpStatus, fehler, obj?.fehler_art), grund);
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
  const pruefung = pruefeFreigabe(counsel, body);
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
