// Gemeinsame Bausteine der Beleg-Kette und des Freigeben-Knopfs (Objekt-Studio Schritt 2, 08.11.2026).
//
// Ausgelagert aus app/content/page.tsx, Code unverändert übernommen: Typen der content-Metadaten,
// Freigabe-Lage (R2, R4, R24), Anzeige des COUNSEL-Urteils, Zeit- und Maskierungshilfen und die
// Farben. /content und das Objekt-Studio (/studio/[objekt]) nutzen dieselben Regeln; /content
// rendert danach byte-gleich (tests/s-content-unveraendert.test.mjs).
//
// Reine Funktionen ohne Server-Abhängigkeit; sie laufen im Browser. Maßgeblich bleibt die Prüfung auf
// dem Server (api/content/status beim Freigeben, api/freigaben, api/studio/[objekt]).

import { werteCounselAus } from "@/lib/counsel-urteil";
import type { CounselAuswertung } from "@/lib/counsel-urteil";
import { enthaeltGeschuetztenNamen, maskiereGeschuetzteNamen, pruefeFreigabe } from "@/lib/freigabe-regeln";
import type { FreigabePruefung } from "@/lib/freigabe-regeln";
import type { CounselUrteil } from "@/lib/status-types";

// ═══ TYPEN ═══

/** Vermerk mit Stufe und Grund, wie die Pipeline ihn in metadata schreibt (seit Stufe 1). */
export interface Vermerk {
  stufe?: string;
  grund?: string;
  detail?: string;
  am?: string;
}

export interface CounselVermerk {
  urteil?: string;
  zeile?: string | null;
  grund?: string;
  geprueft?: string;
  am?: string;
}

/** Betreiber-Entscheidung aus /api/content/status (metadata.freigabe, metadata.gepostet). */
export interface AktionsVermerk {
  aktion?: string;
  am?: string;
  durch?: string;
  grund?: string;
  published_url?: string;
}

export interface ObjektSnapshot {
  abgerufen_am?: string;
  export?: { version?: string | null; quelle?: string | null; generiert_am?: string | null } | null;
  objekt?: Record<string, unknown> | null;
}

export interface StepEintrag {
  agent: string;
  status?: string;
  output?: string;
  fehler?: string;
  cost?: number | null;
  duration_ms?: number;
}

export interface ContentMetadata {
  thema?: string;
  objekt_slug?: string | null;
  utm_content?: string | null;
  kampagne?: string | null;
  cta_link?: string | null;
  amplifier_empfehlung?: string;
  /** Vor Stufe 1 ein Text, seit Stufe 1 ein Vermerk mit Stufe und Grund. */
  fehler?: string | Vermerk;
  warnungen?: Vermerk[];
  steps?: StepEintrag[];
  counsel?: CounselVermerk;
  regelpaket?: { version?: string | null; stand?: string | null };
  objekt_snapshot?: ObjektSnapshot | null;
  researcher_quellen?: string;
  freigabe_hinweis?: { geprueft?: string; zur_freigabe?: string; identisch?: boolean };
  freigabe?: AktionsVermerk;
  gepostet?: AktionsVermerk;
  abgelehnt_durch?: string;
  metriken_verlauf?: unknown[];
}

/** Felder einer content-Zeile, die Beleg-Kette und Freigabe-Lage lesen. */
export interface BelegEintrag {
  id: number;
  status: string;
  body: string | null;
  review_notes: string | null;
  metadata: ContentMetadata | null;
}

/** Bezug des COUNSEL-Urteils zum Freigabetext (body). */
export type FassungsBezug = "identisch" | "abweichend" | "nicht_pruefbar" | "kein_text";

export interface FreigabeLage {
  counsel: CounselAuswertung;
  pruefung: FreigabePruefung;
  bezug: FassungsBezug;
  /** Von COUNSEL geprüfter Text (metadata.steps[1].output, SCRIBE); null = nicht gespeichert. */
  geprueftText: string | null;
  /** Der Freigabetext enthält den geschützten Namen. */
  nameImText: boolean;
}

// ═══ KONSTANTEN ═══

/** Status, in denen ein Text zur Freigabe (body) erwartet wird. */
export const STATUS_MIT_TEXT = ["zur_freigabe", "freigegeben", "gepostet"];

/** Felder des Objekt-Snapshots in der Reihenfolge, wie buildObjektBlock sie nutzt. */
export const SNAPSHOT_ZEILEN: [string, string][] = [
  ["name", "Name"],
  ["untertitel", "Untertitel"],
  ["tagline", "Tagline"],
  ["ort", "Ort"],
  ["baujahr", "Baujahr"],
  ["preis", "Preis"],
  ["kurzbeschreibung", "Kurzbeschreibung"],
  ["statusBadge", "Status"],
  ["afaProzent", "AfA-Satz"],
  ["istDenkmal", "Denkmal"],
  ["kennzahlen", "Kennzahlen"],
  ["kampagnen", "Kampagnen"],
];

export const FARBE_GRUEN = "var(--gp-emerald)";
export const FARBE_ROT = "var(--gp-rose)";
export const FARBE_BERNSTEIN = "var(--gp-amber)";

// ═══ HILFSFUNKTIONEN (Stufe 1, 05.11.2026) ═══

export function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

/** Wie istObjekt, behält aber den deklarierten Typ (metadata kommt ungeprüft aus der DB). */
export function alsObjekt<T extends object>(wert: T | string | null | undefined): T | null {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert) ? wert : null;
}

export function zeitText(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "nicht gespeichert";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? maskiert(iso) : d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

/** Für die Anzeige: geschützten Namen ersetzen. Gilt für alle Texte außer dem Freigabetext (body). */
export function maskiert(text: string): string {
  return maskiereGeschuetzteNamen(text);
}

/** Wert aus DB oder Server für die Anzeige: maskiert; null/undefined ergeben einen leeren Text. */
export function maskiertWert(wert: unknown): string {
  if (wert === null || wert === undefined) return "";
  return maskiert(typeof wert === "string" ? wert : String(wert));
}

/** Ein Snapshot-Feld als Textzeilen; Fehlendes heißt "nicht im Export", nie ein Ersatzwert. */
export function snapshotWert(feld: string, wert: unknown): string[] {
  if (wert === null || wert === undefined || wert === "") return ["nicht im Export"];
  if (typeof wert === "boolean") return [wert ? "ja" : "nein"];
  if (feld === "afaProzent" && typeof wert === "number") return [`${wert} %`];
  if (Array.isArray(wert)) {
    if (wert.length === 0) return ["keine"];
    return wert.map((e) => {
      if (!istObjekt(e)) return String(e);
      const teil = (k: string) => (e[k] === undefined || e[k] === null || e[k] === "" ? "fehlt" : String(e[k]));
      if (feld === "kennzahlen") return `${teil("label")}: ${teil("wert")}`;
      if (feld === "kampagnen") return `${teil("kampagne")} (${teil("lpVariant")}): ${teil("lpUrl")}`;
      return JSON.stringify(e);
    });
  }
  if (typeof wert === "object") return [JSON.stringify(wert)];
  return [String(wert)];
}

// ═══ FREIGABE-LAGE (R2, R4, R24) ═══

/** Von COUNSEL geprüfter Text: metadata.steps[1].output (SCRIBE); null, wenn nicht gespeichert. */
export function geprueftenText(meta: ContentMetadata): string | null {
  const schritt: unknown = Array.isArray(meta.steps) ? meta.steps[1] : undefined;
  if (!istObjekt(schritt) || typeof schritt.output !== "string") return null;
  if (typeof schritt.agent === "string" && schritt.agent.toLowerCase() !== "scribe") return null;
  return schritt.output;
}

/**
 * Hat COUNSEL genau den Freigabetext geprüft? Gleichheit nur durch direkten Vergleich mit dem
 * gespeicherten geprüften Text; der Hinweis aus der Pipeline kann nur eine Abweichung belegen.
 */
export function fassungsBezug(
  body: string | null | undefined,
  geprueft: string | null,
  hinweis: { identisch?: boolean } | null | undefined
): FassungsBezug {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return "kein_text";
  if (geprueft !== null) return geprueft.trim() === text ? "identisch" : "abweichend";
  return istObjekt(hinweis) && hinweis.identisch === false ? "abweichend" : "nicht_pruefbar";
}

export function freigabeLage(item: Pick<BelegEintrag, "body" | "review_notes" | "metadata">): FreigabeLage {
  const meta = alsObjekt(item.metadata) ?? {};
  const counsel = werteCounselAus(item.review_notes);
  const geprueftText = geprueftenText(meta);
  return {
    counsel,
    pruefung: pruefeFreigabe(counsel, item.body),
    bezug: fassungsBezug(item.body, geprueftText, alsObjekt(meta.freigabe_hinweis)),
    geprueftText,
    nameImText: enthaeltGeschuetztenNamen(item.body),
  };
}

// Nachprüfung 06.11.2026: Die Namensprüfung faltet den Text Zeichen für Zeichen; die Liste rief
// freigabeLage bei jedem Render für jede Zeile auf, auch bei jedem Tastendruck in einem Feld der
// Seite (laut Gesamtprüfung rund 23 ms je Render bei 50 Zeilen à 8.000 Zeichen, im Browser nicht
// gemessen). Die Lage hängt nur am Eintrag, und Einträge werden nie verändert, sondern ersetzt
// (setContent mit neuen Objekten) — ein Merker je Objekt reicht.
const LAGE_JE_EINTRAG = new WeakMap<object, FreigabeLage>();

export function freigabeLageGemerkt(item: Pick<BelegEintrag, "body" | "review_notes" | "metadata">): FreigabeLage {
  const gemerkt = LAGE_JE_EINTRAG.get(item);
  if (gemerkt) return gemerkt;
  const lage = freigabeLage(item);
  LAGE_JE_EINTRAG.set(item, lage);
  return lage;
}

/**
 * COUNSEL-Urteil bezogen auf den Freigabetext (R2): grünes FREIGABE nur, wenn COUNSEL genau
 * diesen Text geprüft hat. Welche Fassung freigegeben wird, entscheidet der Inhaber.
 */
export function urteilAnzeige(urteil: CounselUrteil, bezug: FassungsBezug): { text: string; farbe: string; erklaerung: string | null } {
  if (urteil === "ABLEHNUNG") return { text: "ABLEHNUNG", farbe: FARBE_ROT, erklaerung: null };
  if (urteil !== "FREIGABE") return { text: urteil, farbe: FARBE_BERNSTEIN, erklaerung: null };
  switch (bezug) {
    case "identisch":
      return { text: "FREIGABE", farbe: FARBE_GRUEN, erklaerung: "COUNSEL hat genau den Freigabetext geprüft." };
    case "abweichend":
      return {
        text: "COUNSEL prüfte die Vorfassung · Freigabetext ungeprüft",
        farbe: FARBE_BERNSTEIN,
        erklaerung: "Das Urteil FREIGABE gilt der Vorfassung (SCRIBE), nicht dem Freigabetext.",
      };
    case "kein_text":
      return {
        text: "FREIGABE der geprüften Fassung · kein Freigabetext",
        farbe: FARBE_BERNSTEIN,
        erklaerung: "Es gibt keinen Freigabetext, für den das Urteil gelten könnte.",
      };
    default:
      return {
        text: "FREIGABE der geprüften Fassung · Bezug zum Freigabetext nicht prüfbar",
        farbe: FARBE_BERNSTEIN,
        erklaerung: "Der geprüfte Text ist nicht gespeichert; ob er dem Freigabetext entspricht, ist nicht prüfbar.",
      };
  }
}

/** Hinweis am Freigeben-Knopf, wenn freigebbar, aber COUNSEL nicht genau diesen Text geprüft hat. */
export function bezugHinweis(bezug: FassungsBezug): string | null {
  if (bezug === "abweichend") return "Freigabetext ungeprüft — COUNSEL prüfte die Vorfassung";
  if (bezug === "nicht_pruefbar") return "Bezug zur geprüften Fassung nicht prüfbar";
  return null;
}
