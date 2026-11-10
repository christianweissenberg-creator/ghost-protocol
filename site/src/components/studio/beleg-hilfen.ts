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
import {
  STUFE_ENDPRUEFUNG,
  enthaeltGeschuetztenNamen,
  geprueftenTextAusSchritten,
  maskiereGeschuetzteNamen,
  pruefeFreigabe,
} from "@/lib/freigabe-regeln";
import type { FreigabePruefung } from "@/lib/freigabe-regeln";
import type { CounselUrteil } from "@/lib/status-types";

// ═══ TYPEN ═══

/** Vermerk mit Stufe und Grund, wie die Pipeline ihn in metadata schreibt (seit Stufe 1). */
export interface Vermerk {
  stufe?: string;
  grund?: string;
  detail?: string;
  /** Nachtrag Paket B (10.11.2026): Befunde einer Textprüfung einzeln, je höchstens 160 Zeichen. */
  befunde?: string[];
  am?: string;
}

/** Prüfanweisungen an COUNSEL (metadata.pruefauftrag, Nachtrag Paket B): Kennung und Umfang. */
export interface PruefauftragVermerk {
  kennung?: string;
  datierung_pruefpunkt?: boolean;
  umfang?: string;
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
  /** Paket B (10.11.2026): Bezeichnung der Datierungszeile im Prompt, z. B. "Ersterwähnung" (Exportfeld baujahr). */
  datierung?: { feld?: string; bezeichnung?: string; ausnahme_greift?: boolean; quelle?: string; fundstelle?: string | null } | null;
}

export interface StepEintrag {
  agent: string;
  status?: string;
  output?: string;
  fehler?: string;
  cost?: number | null;
  duration_ms?: number;
}

/** Kurzlink-Beleg der Pipeline (Paket B, Schritt 4, E12): Link, aufgelöstes Ziel, Textprüfungen. */
export interface KurzlinkVermerk {
  link?: string;
  ziel_url?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  regel?: string;
  pruefung_scribe?: { ok?: boolean; befunde?: string[] };
  pruefung_endfassung?: { ok?: boolean; befunde?: string[] };
}

export interface ContentMetadata {
  thema?: string;
  objekt_slug?: string | null;
  utm_content?: string | null;
  kampagne?: string | null;
  cta_link?: string | null;
  /** Paket B (10.11.2026): Kurzlink-Beleg; fehlt bei Läufen davor. */
  kurzlink?: KurzlinkVermerk;
  amplifier_empfehlung?: string;
  /** Vor Stufe 1 ein Text, seit Stufe 1 ein Vermerk mit Stufe und Grund. */
  fehler?: string | Vermerk;
  warnungen?: Vermerk[];
  steps?: StepEintrag[];
  /** Maßgebliches Urteil (zu review_notes): seit Paket B das der Endprüfung, sonst das der Vorprüfung. */
  counsel?: CounselVermerk;
  /** Paket B (R2): Urteil der ersten Prüfung (SCRIBE-Text), wenn die Endprüfung gelaufen ist. */
  counsel_vorpruefung?: CounselVermerk;
  regelpaket?: { version?: string | null; stand?: string | null };
  /** Nachtrag Paket B (10.11.2026): Kennung der Prüfanweisungen an COUNSEL; fehlt bei Läufen davor. */
  pruefauftrag?: PruefauftragVermerk;
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
  /**
   * Von COUNSEL geprüfter Text (geprueftenTextAusSchritten): seit Paket B die PUBLISHER-Fassung der
   * Endprüfung, bei Läufen davor metadata.steps[1].output (SCRIBE); null = nicht feststellbar.
   */
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

// ═══ PAKET B (Objekt-Studio Stufe 2, Schritte 4 und 5, 10.11.2026) ═══
// Nur Läufe ab Paket B tragen die Felder; ältere Zeilen rendern unverändert.

/**
 * Etikett einer Snapshot-Zeile: für baujahr die Bezeichnung im Prompt (z. B. "Ersterwähnung") — nur, wenn
 * der Beleg ausdrücklich sagt, dass die Objekt-Ausnahme gegriffen hat; sonst das übliche (fail-closed).
 */
export function snapshotEtikett(snapshot: ObjektSnapshot | null, feld: string, etikett: string): string {
  if (feld !== "baujahr" || !snapshot) return etikett;
  const d = alsObjekt(snapshot.datierung ?? null);
  if (!d || d.ausnahme_greift !== true) return etikett;
  return typeof d.bezeichnung === "string" && d.bezeichnung.trim() !== "" ? maskiert(d.bezeichnung) : etikett;
}

/** Hinweis zur Datierungszeile: Exportfeld und Objekt-Ausnahme; null ohne Beleg (Läufe vor Paket B). */
export function datierungsHinweis(snapshot: ObjektSnapshot | null): string | null {
  const d = snapshot ? alsObjekt(snapshot.datierung ?? null) : null;
  if (!d) return null;
  if (d.ausnahme_greift === true) {
    return `Exportfeld baujahr · Objekt-Ausnahme${typeof d.quelle === "string" && d.quelle ? `: ${maskiert(d.quelle)}` : ""}`;
  }
  return "Exportfeld baujahr · Objekt-Ausnahme greift nicht (der Export nennt ein anderes Jahr)";
}

/** Eine COUNSEL-Prüfung eines Laufs (R2): was geprüft wurde, Ergebnis, geschätzte Kosten. */
export interface CounselPruefungZeile {
  art: "vor" | "end";
  titel: string;
  ergebnis: string;
  kosten: string;
}

function pruefungsZeile(art: CounselPruefungZeile["art"], titel: string, stufe: unknown): CounselPruefungZeile {
  const s = istObjekt(stufe) ? stufe : null;
  if (!s || s.status === undefined || s.status === "pending") {
    return { art, titel, ergebnis: "nicht ausgeführt", kosten: "keine Kosten" };
  }
  const kosten =
    typeof s.cost === "number" && Number.isFinite(s.cost) && s.cost >= 0 ? `$${s.cost.toFixed(4)} gesch.` : "Kosten nicht gemeldet";
  let ergebnis: string;
  if (s.status === "done") ergebnis = `Urteil ${werteCounselAus(typeof s.output === "string" ? s.output : null).urteil}`;
  else if (s.status === "error") ergebnis = `Fehler${typeof s.fehler === "string" && s.fehler ? `: ${maskiert(s.fehler)}` : ""}`;
  else ergebnis = `nicht abgeschlossen (${maskiertWert(s.status)})`;
  return { art, titel, ergebnis, kosten };
}

/**
 * Beide COUNSEL-Prüfungen eines Laufs mit Endprüfung (R2): Vorprüfung des SCRIBE-Texts und Endprüfung
 * des Freigabetexts, je mit Ergebnis und geschätzten Kosten. null bei Läufen ohne Endprüfung.
 */
export function counselPruefungen(meta: ContentMetadata): CounselPruefungZeile[] | null {
  const steps: unknown[] = Array.isArray(meta.steps) ? meta.steps : [];
  const end = steps.find((s) => istObjekt(s) && s.agent === STUFE_ENDPRUEFUNG);
  if (end === undefined) return null;
  const vor = steps.find((s) => istObjekt(s) && s.agent === "counsel");
  return [
    pruefungsZeile("vor", "Vorprüfung · SCRIBE-Text", vor),
    pruefungsZeile("end", "Endprüfung · Freigabetext, wörtlich", end),
  ];
}

/** Ziel-URL des Kurzlinks (E12) und Ergebnis der Textprüfungen; null ohne Kurzlink-Beleg. */
export function kurzlinkAnzeige(meta: ContentMetadata): { ziel: string | null; pruefungen: string | null } | null {
  const k = alsObjekt(meta.kurzlink ?? null);
  if (!k) return null;
  const ziel = typeof k.ziel_url === "string" && k.ziel_url ? maskiert(k.ziel_url) : null;
  const teil = (name: string, p: unknown): string | null => {
    const e = istObjekt(p) ? p : null;
    if (!e) return null;
    if (e.ok === true) return `${name} bestanden`;
    const befunde = Array.isArray(e.befunde) ? e.befunde.filter((b): b is string => typeof b === "string") : [];
    return `${name} nicht bestanden${befunde.length ? ` (${maskiert(befunde.join("; "))})` : ""}`;
  };
  const teile = [teil("SCRIBE-Text", k.pruefung_scribe), teil("Endfassung", k.pruefung_endfassung)].filter((t): t is string => t !== null);
  return { ziel, pruefungen: teile.length ? `Kurzlink im Text geprüft: ${teile.join(" · ")}` : null };
}

/**
 * Kennung der COUNSEL-Prüfanweisungen für die Kette (Nachtrag Paket B, 10.11.2026): „Prüfauftrag COUNSEL <16 Hex>“,
 * mit Prüfpunkt Datierung, wenn der Lauf ihn trug. null bei Läufen davor oder ohne lesbare Kennung (metadata
 * kommt ungeprüft aus der DB: nur genau 16 Hex-Zeichen gelten).
 */
export function pruefauftragAnzeige(meta: ContentMetadata): { text: string; umfang: string | null } | null {
  const p = alsObjekt(meta.pruefauftrag ?? null);
  if (!p || typeof p.kennung !== "string" || !/^[0-9a-f]{16}$/.test(p.kennung)) return null;
  return {
    text: `Prüfauftrag COUNSEL ${p.kennung}${p.datierung_pruefpunkt === true ? " · mit Prüfpunkt Datierung" : ""}`,
    umfang: typeof p.umfang === "string" && p.umfang ? maskiert(p.umfang) : null,
  };
}

/**
 * Detail eines Fehler- oder Warnvermerks für die Anzeige (Nachtrag Paket B, 10.11.2026): Trägt er die Befunde einer
 * Textprüfung einzeln (befunde), stehen alle da — das Feld detail ist auf 160 Zeichen gekürzt und verlor bei drei
 * und mehr Befunden den letzten. Sonst detail; null ohne beides. Nicht maskiert (das tut der Aufrufer).
 */
export function vermerkDetail(v: { detail?: unknown; befunde?: unknown }): string | null {
  const befunde = Array.isArray(v.befunde) ? v.befunde.filter((b): b is string => typeof b === "string" && b.trim() !== "") : [];
  if (befunde.length > 0) return befunde.join("; ");
  return typeof v.detail === "string" && v.detail ? v.detail : null;
}

// ═══ FREIGABE-LAGE (R2, R4, R24) ═══

/**
 * Von COUNSEL geprüfter Text — dieselbe Regel wie Server und Stapel (geprueftenTextAusSchritten,
 * lib/freigabe-regeln.ts; Paket B, R2): mit Endprüfung die PUBLISHER-Fassung, deren Urteil in
 * review_notes steht; bei Läufen davor metadata.steps[1].output (SCRIBE). null, wenn nicht feststellbar.
 */
export function geprueftenText(meta: ContentMetadata, reviewNotes: string | null): string | null {
  return geprueftenTextAusSchritten(meta.steps, reviewNotes);
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
  const geprueftText = geprueftenText(meta, item.review_notes);
  return {
    counsel,
    // Paket B (R2): mit dem geprüften Text — dieselbe Sperre wie beim Freigeben auf dem Server.
    pruefung: pruefeFreigabe(counsel, item.body, geprueftText),
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
