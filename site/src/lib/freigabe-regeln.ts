// Gemeinsame Freigabe-Regeln — Objekt-Studio Stufe 1 (06.11.2026).
//
// Reine Funktionen ohne Server-Abhängigkeit und ohne Laufzeit-Importe: Sie laufen in den
// API-Routen (Pipeline, Übergang "freigeben", Freigabe-Stapel) und im Browser (Sperre des
// Freigeben-Knopfs). Maßgeblich ist die Prüfung auf dem Server; die Sperre im Browser ist
// nur Bedienhilfe. Das COUNSEL-Urteil kommt als Ergebnis von werteCounselAus() herein.

import type { CounselAuswertung } from "./counsel-urteil";
import type { CounselUrteil } from "./status-types";

/** Mindestlänge des Freigabetexts nach Trimmen. */
export const MIN_FREIGABE_ZEICHEN = 20;

// Geschützter Name (Inhaber-Regel vom 05.11.2026): Er darf in keinem sichtbaren Text stehen.
// Technische Bezeichner im Code (Pfade, Env-Namen) sind davon nicht betroffen.
//
// Gesamtprüfung 06.11.2026 (gemessen, 7 von 10 Schreibweisen gingen durch): Das frühere Muster
// /imm[ou][\s._-]*nexus/i übersah Halbgeviertstrich (U+2013), geschützten Bindestrich (U+2011),
// weiches Trennzeichen (U+00AD), Nullbreite (U+200B), "/", Mittelpunkt (U+00B7) und das
// kyrillische о. Seither wird auf einer gefalteten Fassung des Texts geprüft, Zeichen für
// Zeichen: Kompatibilitätszerlegung (NFKD; Vollbreite, mathematische Buchstaben, NBSP),
// Kleinschreibung, ohne Akzente (\p{M}) und ohne unsichtbare Formatzeichen (\p{Cf}); gängige
// kyrillische und griechische Doppelgänger werden auf die lateinischen Buchstaben abgebildet.
// Zwischen den beiden Namensteilen sind Leerraum, Satz- und Sonderzeichen in beliebiger Zahl
// erlaubt. Die Maskierung ersetzt die zugehörige Stelle im Originaltext. Im Zweifel wird eher zu
// viel als zu wenig erkannt (fail-closed); Ziffern als Buchstabenersatz ("0" für "o") deckt die
// Regel nicht ab.
export const NAMENS_ERSATZ = "[geschützter Name]";

/** Kyrillische und griechische Doppelgänger (Kleinbuchstaben) der Buchstaben des Namens. */
const DOPPELGAENGER: Readonly<Record<string, string>> = {
  "і": "i", // і kyrillisch
  "ı": "i", // ı punktlos
  "ι": "i", // ι griechisch
  "м": "m", // м kyrillisch
  "о": "o", // о kyrillisch
  "ο": "o", // ο griechisch
  "υ": "u", // υ griechisch
  "е": "e", // е kyrillisch
  "х": "x", // х kyrillisch
  "χ": "x", // χ griechisch
  "ѕ": "s", // ѕ kyrillisch
};

const AKZENT_ODER_UNSICHTBAR = /[\p{M}\p{Cf}]/gu;
/** Muster auf dem gefalteten Text (klein, ohne Akzente und Formatzeichen). */
const NAME_GEFALTET = /imm[ou][\s\p{P}\p{S}]*nexus/u;
const NAME_GEFALTET_ALLE = /imm[ou][\s\p{P}\p{S}]*nexus/gu;

interface Faltung {
  text: string;
  /** Je Zeichen (UTF-16-Einheit) des gefalteten Texts: Beginn und Ende des Originalzeichens. */
  von: number[];
  bis: number[];
}

/** Ein Originalzeichen (Codepoint) gefaltet; ASCII nur klein geschrieben. */
function falteZeichen(zeichen: string): string {
  if (zeichen.length === 1 && zeichen.charCodeAt(0) < 0x80) return zeichen.toLowerCase();
  const zerlegt = zeichen.normalize("NFKD").toLowerCase().replace(AKZENT_ODER_UNSICHTBAR, "");
  let aus = "";
  for (const c of zerlegt) aus += DOPPELGAENGER[c] ?? c;
  return aus;
}

function falte(text: string): Faltung {
  let aus = "";
  const von: number[] = [];
  const bis: number[] = [];
  let i = 0;
  for (const zeichen of text) {
    const ende = i + zeichen.length;
    const f = falteZeichen(zeichen);
    for (let k = 0; k < f.length; k++) {
      von.push(i);
      bis.push(ende);
    }
    aus += f;
    i = ende;
  }
  return { text: aus, von, bis };
}

export function enthaeltGeschuetztenNamen(text: string | null | undefined): boolean {
  return typeof text === "string" && NAME_GEFALTET.test(falte(text).text);
}

/** Ersetzt den geschützten Namen für die Anzeige. Für Freigabetexte NICHT verwenden: die werden gesperrt. */
export function maskiereGeschuetzteNamen(text: string): string {
  const f = falte(text);
  let aus = "";
  let pos = 0;
  for (const treffer of f.text.matchAll(NAME_GEFALTET_ALLE)) {
    const start = treffer.index ?? 0;
    const von = f.von[start];
    const bis = f.bis[start + treffer[0].length - 1];
    if (von < pos) continue;
    aus += text.slice(pos, von) + NAMENS_ERSATZ;
    pos = bis;
  }
  return pos === 0 ? text : aus + text.slice(pos);
}

export interface FreigabePruefung {
  /** true = darf auf "freigegeben" gesetzt werden. */
  freigebbar: boolean;
  /** Sperrgrund für Menschen; null, wenn freigebbar. */
  grund: string | null;
  urteil: CounselUrteil;
  /** Maßgebliche URTEIL-Zeile mit maskiertem Namen; null, wenn keine. */
  zeile: string | null;
}

// ═══ R2: nur wörtlich geprüfter Text (Objekt-Studio Stufe 2, Schritt 5, 10.11.2026) ═══
//
// Entscheidung E13 (Inhaber, 10.11.2026): Freigegeben wird nur Text, den COUNSEL wörtlich geprüft
// hat. Dafür prüft COUNSEL in der Pipeline (api/content/pipeline) ein zweites Mal, und zwar die
// PUBLISHER-Endfassung, die als body zur Freigabe geht: Stufe "counsel_endfassung" in
// metadata.steps, ihre Antwort steht in review_notes. Läufe davor haben diese Stufe nicht; dort hat
// COUNSEL den SCRIBE-Text (steps[1]) geprüft, und review_notes ist diese Prüfung.

/** Stufe der Pipeline, in der COUNSEL die Endfassung (PUBLISHER-Text = body) wörtlich prüft. */
export const STUFE_ENDPRUEFUNG = "counsel_endfassung";

const SPERRE_WORTLAUT_UNBEKANNT = "Freigabetext nicht wörtlich geprüft: geprüfter Text nicht gespeichert oder nicht dem COUNSEL-Urteil zuzuordnen (R2)";
const SPERRE_WORTLAUT_ANDERS = "Freigabetext nicht wörtlich geprüft: COUNSEL prüfte eine andere Fassung (R2)";

function istEintrag(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

/**
 * Text, dem das gespeicherte COUNSEL-Urteil (review_notes) gilt; null, wenn er nicht feststeht.
 * - Mit Stufe counsel_endfassung (Läufe ab Schritt 5): die Ausgabe der Stufe publisher — nur wenn die
 *   Endprüfung fertig ("done") ist und review_notes genau ihre Antwort ist. Sonst null (fail-closed):
 *   Ein Urteil, das nicht zur Endprüfung gehört, belegt die Endfassung nicht.
 * - Ohne diese Stufe (Läufe davor): die SCRIBE-Ausgabe in steps[1], wie bisher.
 * steps ist metadata.steps, ungeprüft aus der Datenbank.
 */
export function geprueftenTextAusSchritten(steps: unknown, reviewNotes: string | null | undefined): string | null {
  if (!Array.isArray(steps)) return null;
  const endpruefung: unknown = steps.find((s) => istEintrag(s) && s.agent === STUFE_ENDPRUEFUNG);
  if (endpruefung !== undefined) {
    if (!istEintrag(endpruefung) || endpruefung.status !== "done" || typeof endpruefung.output !== "string") return null;
    if (typeof reviewNotes !== "string" || reviewNotes !== endpruefung.output) return null;
    const publisher: unknown = steps.find((s) => istEintrag(s) && s.agent === "publisher");
    return istEintrag(publisher) && typeof publisher.output === "string" ? publisher.output : null;
  }
  const schritt: unknown = steps[1];
  if (!istEintrag(schritt) || typeof schritt.output !== "string") return null;
  if (typeof schritt.agent === "string" && schritt.agent.toLowerCase() !== "scribe") return null;
  return schritt.output;
}

/**
 * Darf dieser Text freigegeben werden? Nur bei COUNSEL-Urteil FREIGABE, einem Text ab
 * MIN_FREIGABE_ZEICHEN Zeichen, ohne geschützten Namen und (R2) nur, wenn der Text genau der von
 * COUNSEL geprüfte ist (nach Trimmen). Alles andere sperrt.
 *
 * geprueft: Ergebnis von geprueftenTextAusSchritten (null = nicht feststellbar → sperrt). Ohne
 * Argument entfällt nur die R2-Prüfung — für Aufrufer, die noch nicht umgestellt sind; das
 * Freigeben (api/content/status), der Stapel (api/freigaben) und die Beleg-Kette übergeben es immer.
 */
export function pruefeFreigabe(
  counsel: CounselAuswertung,
  body: string | null | undefined,
  geprueft?: string | null,
): FreigabePruefung {
  const zeile = counsel.zeile === null ? null : maskiereGeschuetzteNamen(counsel.zeile);
  const basis = { urteil: counsel.urteil, zeile };
  if (counsel.urteil !== "FREIGABE") {
    return { freigebbar: false, grund: `COUNSEL-Urteil ${counsel.urteil} (${counsel.grund})`, ...basis };
  }
  const text = typeof body === "string" ? body.trim() : "";
  if (text.length === 0) {
    return { freigebbar: false, grund: "Freigabetext leer", ...basis };
  }
  if (text.length < MIN_FREIGABE_ZEICHEN) {
    return {
      freigebbar: false,
      grund: `Freigabetext zu kurz (${text.length} Zeichen, Mindestlänge ${MIN_FREIGABE_ZEICHEN})`,
      ...basis,
    };
  }
  if (enthaeltGeschuetztenNamen(text)) {
    return { freigebbar: false, grund: "Freigabetext enthält einen geschützten Namen", ...basis };
  }
  if (geprueft !== undefined) {
    if (geprueft === null) return { freigebbar: false, grund: SPERRE_WORTLAUT_UNBEKANNT, ...basis };
    if (geprueft.trim() !== text) return { freigebbar: false, grund: SPERRE_WORTLAUT_ANDERS, ...basis };
  }
  return { freigebbar: true, grund: null, ...basis };
}

// ═══ Caption zu einem Video (Objekt-Studio Stufe 2, Schritt 9, 10.11.2026) ═══
//
// Eine content-Zeile mit metadata.medium_id ist die Caption zu einem Video. Für sie gilt die Caption-Regel oben,
// dazu die Pflichtzeile zum KI-Hinweis als eigene Zeile im Freigabetext und die Medien-Regel (lib/medien-freigabe.ts,
// pruefeMedienFreigabe) für das Video. Eine Funktion für beides, an allen vier Stellen: Freigeben
// (api/content/status), Stapel (api/freigaben), Studio-Karte (lib/studio/lesen.ts) und Beleg-Kette. Der Sperrgrund ist
// der erste Grund (Spez. §8.6). Der Wortlaut der Pflichtzeile kommt vom Aufrufer (lib/studio/ki-hinweis.ts,
// KI_PFLICHTZEILE_CAPTION), weil diese Datei ohne Laufzeit-Importe bleibt.

/** Urteil der Medien-Regel für ein Video, wie pruefeMedienFreigabe es liefert (freigebbar, alle Gründe). */
export interface MedienSperre {
  freigebbar: boolean;
  gruende: readonly string[];
}

export interface VideoFreigabePruefung extends FreigabePruefung {
  /** Alle Gründe: Caption-Regel, dann Pflichtzeile, dann Medien-Regel; grund ist der erste. */
  gruende: string[];
}

/**
 * Wortlaut der Pflichtzeile, wie lib/studio/ki-hinweis.ts (KI_PFLICHTZEILE_CAPTION) — dort ist die Quelle; diese Kopie
 * braucht der Browser-Code der Beleg-Kette, der ki-hinweis.ts nicht lädt. Ein Test hält beide gleich (m-caption-freigabe).
 */
export const PFLICHTZEILE_VIDEO_CAPTION = "Bild-/Videomaterial: KI-generierte Visualisierung, kein Foto der Bestandsimmobilie";

/** Steht die Pflichtzeile als eigene Zeile im Text — wörtlich, nur Leerraum am Rand der Zeile zählt nicht? */
export function enthaeltPflichtzeile(text: string | null | undefined, pflichtzeile: string): boolean {
  const soll = pflichtzeile.trim();
  if (typeof text !== "string" || soll === "") return false;
  return text.split(/\r?\n/).some((zeile) => zeile.trim() === soll);
}

/**
 * Vergleichsform für nahe Varianten der Pflichtzeile (Nachbesserung caption9-4): NFKC, Bindestriche und Leerraum
 * vereinheitlicht, ohne Markdown-Zeichen, ohne Symbole am Anfang (etwa ein Emoji) und ohne Schlusspunkt, klein.
 * Nur zum Ersetzen in der Pipeline — vorhanden ist die Zeile weiter nur wörtlich (enthaeltPflichtzeile).
 */
function nahForm(zeile: string): string {
  return zeile
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\s\u00a0\u2028\u2029]+/gu, " ")
    .replace(/[*_`~]/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[\s.!…]+$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * Zeilenanfang ohne Markdown-, Listen- und Nummernzeichen, klein — zum Erkennen der Abschnitte einer PUBLISHER-Antwort
 * („## Finaler Content“, „**Publishing-Zeitpunkt:**“, „5. Cross-Promotion: …“).
 */
function abschnittsKopf(zeile: string): string {
  return zeile
    .trim()
    .replace(/^(?:[#>*_~`\-•–—]+\s*|\d+[.)]\s+)+/u, "")
    .toLowerCase();
}
const KOPF_FINAL = /^finaler content\b/;
const KOPF_DANACH = /^(?:publishing-zeitpunkt|cross-promotion|qualitätsprüfung|metadaten)/;

/**
 * Bereich des Abschnitts „Finaler Content“ in teile (gerade Indizes sind Zeilen; Prüfung f-caption-1): von seiner
 * Überschrift bis vor die nächste Zeile „Publishing-Zeitpunkt“, „Cross-Promotion“, „Qualitätsprüfung“ oder „Metadaten“.
 * Ohne diese Überschrift: der ganze Text (kopf false).
 */
function finalerAbschnitt(teile: readonly string[]): { von: number; bis: number; kopf: boolean } {
  const von = teile.findIndex((t, i) => i % 2 === 0 && KOPF_FINAL.test(abschnittsKopf(t)));
  if (von < 0) return { von: 0, bis: teile.length, kopf: false };
  const bis = teile.findIndex((t, i) => i > von && i % 2 === 0 && KOPF_DANACH.test(abschnittsKopf(t)));
  return { von, bis: bis < 0 ? teile.length : bis, kopf: true };
}

/**
 * Nummer einer Postmarke am Zeilenanfang: „1/3“, „**2/3**“, „(1/3)“, „🧵 1/3“, „Post 1/3:“, „Tweet 2/3“ (Prüfung
 * f-caption-1); sonst null.
 */
function postNummer(zeile: string): number | null {
  const m = /^[^\p{L}\p{N}]*?(?:(?:post|tweet)\s*)?\(?\s*(\d+)\s*\/\s*\d*\s*\)?/iu.exec(zeile.trim());
  return m ? Number(m[1]) : null;
}

/** Zeilen von Post 1 eines X-Threads im Bereich [von, bis): ab der Marke „1/…“ bis vor „2/…“; null ohne Marke „1/…“. */
function ersterPostBereich(teile: readonly string[], von: number, bis: number): { eins: number; zwei: number } | null {
  let eins = -1;
  for (let i = von; i < bis; i += 2) {
    const n = postNummer(teile[i]);
    if (eins < 0) {
      if (n === 1) eins = i;
    } else if (n === 2) {
      return { eins, zwei: i };
    }
  }
  return eins < 0 ? null : { eins, zwei: bis };
}

/** Wo pflichtzeileEinsetzen die Zeile gesetzt hat (für die Warnung der Pipeline); null, wenn sie schon da war. */
export type PflichtzeilenLage = "erster_post" | "abschnitt" | "ende" | "ersetzt";

/**
 * Pflichtzeile einsetzen: vorhanden (wörtlich als eigene Zeile) → unverändert; eine nahe Variante (Schlusspunkt,
 * anderer Bindestrich, geschütztes Leerzeichen, Fettdruck, Emoji davor, Großschrift) → durch die wörtliche Zeile
 * ersetzt, an ihrer Stelle, statt eine zweite Hinweiszeile anzuhängen. Fehlt sie, wird sie nach einer Leerzeile
 * eingesetzt, und zwar nur im Abschnitt „Finaler Content“ (Prüfung f-caption-1): bei einem X-Thread (ort "erster_post")
 * als letzte Zeile von Post 1 vor die Marke „2/…“, sonst ans Ende des Abschnitts, vor Publishing-Zeitpunkt,
 * Cross-Promotion und Qualitätsprüfung. Ohne diese Überschrift (und ohne folgenden Abschnitt) wie bisher ans Ende des Texts.
 */
export function pflichtzeileEinsetzen(
  text: string,
  pflichtzeile: string,
  ort: "ende" | "erster_post" = "ende"
): { text: string; art: "vorhanden" | "ersetzt" | "angehaengt"; ersetzt: string | null; lage: PflichtzeilenLage | null } {
  const soll = pflichtzeile.trim();
  if (enthaeltPflichtzeile(text, soll)) return { text, art: "vorhanden", ersetzt: null, lage: null };
  const teile = text.split(/(\r?\n)/);
  const ziel = nahForm(soll);
  for (let i = 0; i < teile.length; i += 2) {
    if (teile[i].trim() !== "" && nahForm(teile[i]) === ziel) {
      const alt = teile[i];
      teile[i] = soll;
      return { text: teile.join(""), art: "ersetzt", ersetzt: alt, lage: "ersetzt" };
    }
  }
  const { von, bis, kopf } = finalerAbschnitt(teile);
  const post = ort === "erster_post" ? ersterPostBereich(teile, von, bis) : null;
  // Einsetzen hinter der letzten nicht leeren Zeile vor grenze (frühestens hinter unten), mit dem Zeilenumbruch des Texts.
  const hinterLetzter = (unten: number, grenze: number, lage: PflichtzeilenLage) => {
    let letzte = grenze - 2;
    while (letzte > unten && teile[letzte].trim() === "") letzte -= 2;
    const nl = teile[letzte + 1] ?? "\n";
    teile.splice(letzte + 1, 0, nl, "", nl, soll);
    return { text: teile.join(""), art: "angehaengt" as const, ersetzt: null, lage };
  };
  if (post !== null && post.zwei < bis) return hinterLetzter(post.eins, post.zwei, "erster_post");
  if (kopf && bis < teile.length) return hinterLetzter(von, bis, "abschnitt");
  const rumpf = text.replace(/\s+$/u, "");
  return { text: rumpf === "" ? soll : `${rumpf}\n\n${soll}`, art: "angehaengt", ersetzt: null, lage: "ende" };
}

/** Höchstlänge eines Posts auf X, wie die Thread-Vorschau auf /content (TWEET_MAX). */
export const X_POST_HOECHSTENS = 280;

/**
 * Länge von Post 1 eines X-Texts (Prüfung f-caption-2), gezählt wie die Thread-Vorschau auf /content: ohne „**“, ohne
 * Leerraum am Rand, jedes Zeichen (UTF-16) einzeln, URLs voll. Post 1 ist im Abschnitt „Finaler Content“ der Block ab der
 * Marke „1/…“ bis vor „2/…“; ohne Marken der ganze Abschnitt ohne seine Überschrift. null, wenn weder Überschrift noch
 * Marke den Post abgrenzen.
 */
export function xPostEinsLaenge(text: string): number | null {
  const teile = text.split(/(\r?\n)/);
  const { von, bis, kopf } = finalerAbschnitt(teile);
  const post = ersterPostBereich(teile, von, bis);
  let zeilen: string[];
  if (post !== null) {
    zeilen = [];
    for (let i = post.eins; i < post.zwei; i += 2) zeilen.push(teile[i]);
  } else if (kopf) {
    const k = teile[von];
    const rest = k.includes(":") ? k.slice(k.indexOf(":") + 1) : "";
    zeilen = [rest];
    for (let i = von + 2; i < bis; i += 2) zeilen.push(teile[i]);
  } else {
    return null;
  }
  return zeilen.join("\n").replace(/\*\*/g, "").trim().length;
}

/** Text mit Pflichtzeile (pflichtzeileEinsetzen): vorhanden, ersetzt oder angehängt. */
export function mitPflichtzeile(text: string, pflichtzeile: string): string {
  return pflichtzeileEinsetzen(text, pflichtzeile).text;
}

/**
 * Caption zu einem Video? An allen vier Stellen dieselbe Regel (Freigeben, Stapel, Studio-Karte, Beleg-Kette;
 * Nachbesserung caption9-2): metadata.medium_id gesetzt heißt Video — fehlend und null heißen „ohne Video“. Der Stapel
 * liest metadata->medium_id und sieht für einen fehlenden Schlüssel und null dasselbe (PostgREST-JSON-Pfad); vorher
 * behandelte nur der Server null als Video. Eine null schreibt keine Pipeline (sie lässt den Schlüssel weg), nur ein
 * Schreiben an ihr vorbei — das den Schlüssel ebenso entfernen könnte. id null = gesetzt, aber unlesbar (gesperrt).
 */
export function mediumIdAus(roh: unknown): { video: false } | { video: true; id: number | null } {
  if (roh === undefined || roh === null) return { video: false };
  return { video: true, id: typeof roh === "number" && Number.isSafeInteger(roh) && roh > 0 ? roh : null };
}

/** Sperrgrund, wenn medium_id gesetzt, aber unlesbar ist (Freigeben, Stapel, Studio-Karte). */
export const MEDIUM_ID_UNLESBAR = "Medium der Zeile nicht lesbar (metadata.medium_id)";

/** Sperrgrund, wenn medium_id auf kein Export zeigt (Freigeben, Stapel, Studio-Karte; vor jedem Nachhashen). */
export const MEDIUM_KEIN_EXPORT = "Medium ist kein Export";

/** Sperrgrund, wenn die Pflichtzeile fehlt. */
export function pflichtzeileFehlt(pflichtzeile: string): string {
  return `Pflichtzeile zum KI-Hinweis fehlt im Freigabetext („${pflichtzeile.trim()}“ als eigene Zeile)`;
}

/**
 * Darf die Caption zu einem Video freigegeben werden? Caption-Regel (pruefeFreigabe, mit R2), Pflichtzeile und
 * Medien-Regel zusammen; medium null = Urteil der Medien-Regel nicht ermittelt → gesperrt (fail-closed).
 */
export function pruefeVideoFreigabe(
  counsel: CounselAuswertung,
  body: string | null | undefined,
  geprueft: string | null,
  medium: MedienSperre | null,
  pflichtzeile: string,
): VideoFreigabePruefung {
  const caption = pruefeFreigabe(counsel, body, geprueft);
  const gruende: string[] = [];
  if (!caption.freigebbar) gruende.push(caption.grund ?? "Caption-Regel sperrt");
  if (!enthaeltPflichtzeile(body, pflichtzeile)) gruende.push(pflichtzeileFehlt(pflichtzeile));
  if (medium === null) gruende.push("Urteil der Medien-Regel nicht ermittelt");
  else if (!medium.freigebbar) gruende.push(...(medium.gruende.length > 0 ? medium.gruende : ["Medien-Regel sperrt"]));
  return { ...caption, freigebbar: gruende.length === 0, grund: gruende[0] ?? null, gruende };
}
