import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { enthaeltUrteil, ohneUrteilZeilen, werteCounselAus } from "@/lib/counsel-urteil";
import {
  MIN_FREIGABE_ZEICHEN,
  STUFE_ENDPRUEFUNG,
  enthaeltGeschuetztenNamen,
  geprueftenTextAusSchritten,
  maskiereGeschuetzteNamen,
  pflichtzeileEinsetzen,
} from "@/lib/freigabe-regeln";
import { ABFRAGE_TIMEOUT_MS, bereinigeFehler, leseProtokollEintraege, pruefeAnfrageHerkunft } from "@/lib/status-server";
import { STEINADEL_REGELPAKET } from "@/lib/steinadel-regelpaket";
import { baueKurzlink, maskiereKampagnenseiten, pruefeKurzlinksImText } from "@/lib/steinadel-kurzlink";
import type { KurzlinkPruefung, KurzlinkTextPruefung } from "@/lib/steinadel-kurzlink";
import { KI_PFLICHTZEILE_CAPTION } from "@/lib/studio/ki-hinweis";
import { DATIERUNG_AUSNAHMEN, istStudioObjekt } from "@/lib/studio/objekte";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Content-First Pipeline: RESEARCHER → SCRIBE → COUNSEL → PUBLISHER → COUNSEL (Endfassung) → AMPLIFIER
// COUNSEL ist Pflicht-Schritt (fail-closed): ohne eindeutige Freigabe-Empfehlung
// stoppt die Pipeline, PUBLISHER/AMPLIFIER laufen NICHT.
//
// Objekt-Studio Stufe 2, Paket B, Schritte 4 und 5 (10.11.2026; Spezifikation §6.3, §8.1, §9;
// Entscheidungen E10–E13 des Inhabers vom 10.11.2026):
// - Datierung im Objektblock: Hat das Objekt eine Datierungs-Ausnahme (lib/studio/objekte.ts,
//   DATIERUNG_AUSNAHMEN) und nennt der Export genau dieses Jahr, heißt die Zeile wie die Ausnahme,
//   beim RitterGut "Ersterwähnung: 1335" statt "Baujahr: 1335". Fundstelle siehe DATIERUNG_FUNDSTELLE.
//   Das Exportfeld baujahr bleibt unverändert (es gehört Steinadel); der Objekt-Snapshot belegt die
//   Bezeichnung (objekt_snapshot.datierung).
// - CTA als Kurzlink https://steinadel.de/k/<kampagne>/<präfix>-<slug>-<id> statt Direktlink (E12,
//   lib/steinadel-kurzlink.ts). Ersatzweg §6.3: Der Code prüft den Link deterministisch — beim Bauen
//   (Form, Auflösung, Gegenprobe mit der lpUrl des Exports) und in SCRIBE-Text und Endfassung (CTA-Link
//   unverändert da, keine fremden /k/- und keine /l/-Links). COUNSEL bekommt die aufgelöste Ziel-URL mit
//   UTMs. Besteht ein Text die Prüfung nicht, endet der Lauf vor dem nächsten bezahlten Aufruf.
// - R39 (E10, E11): LinkedIn ist Plattform der Pipeline (Format linkedin_post, Präfix li). Die
//   Pflichtzeilen (Modellrechnung-Disclaimer, KI-Kennzeichnung, Impressum) kommen wie bei allen
//   Plattformen aus buildObjektBlock (seit 0f553a9).
// - R2 (E13): Eine sechste Stufe counsel_endfassung (STUFE_ENDPRUEFUNG) prüft die PUBLISHER-Fassung
//   wörtlich, bevor AMPLIFIER läuft. Ihre Antwort ist review_notes und metadata.counsel; die erste
//   Prüfung (SCRIBE-Text) steht als metadata.counsel_vorpruefung. Freigegeben wird nur, was COUNSEL
//   wörtlich geprüft hat (pruefeFreigabe mit geprueftenTextAusSchritten, lib/freigabe-regeln.ts). Die
//   Kosten der Endprüfung stehen in steps[4].cost und in der Summe.
// - Gegenprüfung (10.11.2026, drei unabhängige Prüfungen): Objektblock ohne lpUrl der Kampagnen; nur
//   der exakte CTA-Link ist im Text erlaubt (keine Präfix-Varianten), /k/- und /l/-Adressen werden in
//   jeder Schreibweise erkannt; COUNSEL erfährt den Umfang der Code-Prüfung (nur steinadel.de) und die
//   Zählweise ohne Personenbezug; kein Content mit URTEIL-Zeile geht an COUNSEL, PUBLISHER bekommt das
//   Review ohne URTEIL-Zeile; Textregel §8.1 (Datierung) im Code.
// - Abnahmelauf 10.11.2026 (abgelehnt): Beide COUNSEL-Aufträge enden mit der wörtlichen Form
//   der URTEIL-Zeile (URTEIL_SCHLUSS); werteCounselAus bleibt streng. Datierung: Die Datierungszeile
//   verbietet, aus dem Jahr der Ersterwähnung ein Alter oder eine Bauzeit abzuleiten; COUNSEL bekommt dieselbe
//   Regel als Prüfpunkt im Auftrag (datierungsPruefpunkt, nicht im Regelpaket); der Code erkennt „N Jahre“
//   mit N = aktuelles Jahr − Jahr der Ausnahme ± 1 (altersBefund).
// - Gegenprüfung PR #10 (10.11.2026): Die verbotenen Formen nennen keine Rechenformel mehr, dazu „vor N Jahren …“
//   und „N Jahre her/zurück“; abgeleitete Alter im Review an PUBLISHER maskiert (maskiereAlter); PUBLISHER nennt
//   in Qualitätsprüfung und Fakten-Check kein abgeleitetes Alter und zitiert keine Regeln; Eskalationen stehen
//   über der URTEIL-Zeile; zwischen Zahl und „Jahre“ zählen auch Gedankenstriche (U+2010 bis U+2014).
// - Gegenprüfung des Nachtrags (10.11.2026, neun niedrige Punkte): maskiereAlter läuft im Review an PUBLISHER als
//   äußerste Maske und auch auf dem RESEARCHER-Text an SCRIBE; „seit N Jahren …“ unter den verbotenen Formen; der
//   PUBLISHER-Satz nimmt die Pflichtzeilen vom Zitierverbot aus; Textregel-Befunde einzeln in metadata.fehler.befunde;
//   Auftragskennung der COUNSEL-Prüfanweisungen in metadata.pruefauftrag; AMPLIFIER mit Umfangsrahmen (maxTokens 4096
//   in lib/agent-prompts.ts).
//
// Objekt-Studio Stufe 2, Paket C, Schritt 9 (10.11.2026; Spezifikation §6.3, Bauplan §4.3) — Caption zu einem Video:
// - Optionales Feld medium_id: eine positive ganze Zahl, nur mit objekt_slug (sonst 400). Die Zeile in studio_medium muss
//   existieren (sonst 404), zum Objekt des Laufs gehören und die Fassung "export" haben (sonst 400); ein Lesefehler gibt 502.
//   Geprüft vor dem Insert und damit vor jedem bezahlten Aufruf (leseMedium). Ohne medium_id läuft alles wie bisher:
//   keine Abfrage auf studio_medium, keine Pflichtzeile, metadata ohne medium_id.
// - metadata.medium_id ist die Zahl. Der SCRIBE-Auftrag nennt die Auftragsart „Caption zu einem Video, Pflichtzeile
//   KI-Hinweis“ und die Pflichtzeile (KI_PFLICHTZEILE_CAPTION, lib/studio/ki-hinweis.ts) als eigene Zeile (CAPTION_AUFTRAG).
// - Fehlt die Pflichtzeile in der PUBLISHER-Fassung, ergänzt die Pipeline sie im PUBLISHER-Text selbst (steps[3].output,
//   pflichtzeileEinsetzen aus lib/freigabe-regeln.ts; eine nahe Variante wird ersetzt) — nach der Mindestlänge (die Zeile allein ist kein Content), vor Namensschutz,
//   Textregeln und Endprüfung. Grund: R2 gibt nur den wörtlich geprüften PUBLISHER-Text frei (geprueftenTextAusSchritten);
//   eine erst an body angehängte Zeile sperrte die Freigabe. So prüft COUNSEL genau den Text mit Pflichtzeile, und body ist
//   dieser Text. metadata.pflichtzeile belegt den Wortlaut und ob die Pipeline ergänzt hat.
// - Gegenprüfung PR #13: Im Review an PUBLISHER läuft die Namensmaske vor der Kampagnenmaske (X01), und Textregel-Befunde
//   werden vor dem Kürzen maskiert (X02, textregelVermerk).
//
// Stufe 1 (05.11.2026) — Freigabe und Beleg-Kette:
// - Das COUNSEL-Urteil wertet werteCounselAus() aus (lib/counsel-urteil.ts); die frühere
//   Regex ließ zitierte Optionen und verneinte Freigaben durch. Nur FREIGABE geht weiter.
// - Jeder activate-Aufruf wird auf HTTP-Fehler UND "abgeschnitten" geprüft. Bei SCRIBE,
//   COUNSEL und PUBLISHER ist eine abgeschnittene Antwort ein Fehler: sonst prüft COUNSEL
//   einen halben Text oder ein halbes Urteil zählt.
// - Jede Zeile trägt ihre Belege in metadata (Regelpaket-Version, Objekt-Snapshot,
//   Herkunft der RESEARCHER-Quellen), damit die Freigabe-Ansicht zeigen kann, worauf das
//   Urteil beruht.
// - Jedes Schreiben der content-Zeile wird geprüft; Fehler gehen nach console.error und
//   als speicherfehler in die Antwort, statt still verloren zu gehen.
//
// Fixrunde 06.11.2026:
// - R10: Optionale Lauf-ID (Idempotenzschlüssel, metadata.lauf_id; der Browser schickt sie
//   nach unbekanntem Ausgang erneut mit). Ist sie schon vergeben, antwortet die Route
//   409 { fehler, content_id, status } ohne bezahlten Aufruf. Direkt nach dem Insert und vor
//   dem ersten bezahlten Aufruf liest sie die Zeilen mit dieser Lauf-ID: Weiter läuft nur,
//   wer die eigene Zeile als EINZIGE sieht; wer eine fremde sieht, endet als "fehler" + 409.
//   Nachbesserung: Die frühere Regel "kleinste id gewinnt" ließ zwei Läufe zu, wenn die
//   kleinere id erst nach der Lesung der größeren sichtbar wurde (Commit- ≠ id-Reihenfolge).
//   Jetzt gilt höchstens ein Lauf je Lauf-ID; sehen sich zwei gleichzeitige Anfragen
//   gegenseitig, brechen beide ohne bezahlten Aufruf ab (fail-closed). "Genau einer" ginge
//   nur mit einem eindeutigen Index auf metadata->>lauf_id (Schema-Änderung, Inhaber/DB).
// - R21: Das Export-Objekt wird vor Snapshot, Prompt und Insert geprüft (502 "Export-Objekt
//   unvollständig: <Feld>"); fehlende optionale Felder stehen im Prompt als "nicht im
//   Export", nie als "undefined".
// - R6: Scheitert das Speichern des COUNSEL-Ergebnisses, endet der Lauf mit status "fehler";
//   der Abbruch versucht, Review und Urteil erneut zu speichern. Bei FREIGABE laufen PUBLISHER
//   und AMPLIFIER nicht mehr; bei ABLEHNUNG/UNKLAR gibt es keine Antwort "abgelehnt" über einer
//   Zeile, die als "entwurf" ohne Review hängen bliebe (Nachbesserung). Scheitert das
//   Speichern von "zur_freigabe", antwortet die Route 500 mit status "fehler" statt "complete".
// - R17: Fehlertexte werden vor jedem Speichern und jeder Antwort bereinigt (fehlerText).
// - activate-Vertrag (Gesamtprüfung 06.11.2026): Protokollfehler kommen als Liste
//   (protokoll_fehler_liste); fehlt sie, wird der Text protokoll_fehler am Trenner "; " geteilt
//   (leseProtokollEintraege, lib/status-server.ts); die Liste aus der Zeit vor der Fixrunde wird
//   weiter gelesen. Jeder Eintrag wird einzeln bereinigt und auf höchstens 160 Zeichen gekürzt,
//   steht in steps[n].protokoll_fehler und als eigene Warnung im Lauf, auch aus einer
//   Fehlerantwort (z. B. Fehllauf-Zeile fehlt). Vorher wurde der ganze Text als EIN Eintrag
//   gekürzt; spätere Vermerke wie "metrics-Insert" fielen weg.
// - Fehllauf-Kosten (Gesamtprüfung 06.11.2026): Meldet activate in einer Fehlerantwort
//   usage.cost_usd (bezahlter Aufruf ohne verwertbare Antwort, HTTP 502), übernimmt die Stufe
//   diese Kosten statt null — wie delegate und /api/status.
// - platform und format nur aus FORMATE_JE_PLATTFORM, sonst 400 vor jedem Aufruf (vorher lief
//   eine unbekannte Plattform mit den X-Anweisungen als Rückfall). LinkedIn stand damals nicht darin
//   (R39 offen); seit Paket B (E11, 10.11.2026) steht es darin.
// - Ein CTA-Link mit geschütztem Namen wird weder in den SCRIBE-Auftrag geschrieben noch als
//   metadata.cta_link gespeichert (Warnung mit Stufe "objekt").
// - pruefeAnfrageHerkunft (lib/status-server.ts): Cross-Site-POST → 403, ohne JSON-Content-Type
//   → 415, vor jedem Abruf.
// - R24: Die statischen Auftragstexte der fünf Stufen nennen bei Objekt-Läufen (Steinadel-
//   Content) keinen Projektnamen: Pflicht- und Stilregel sind ohne Namen formuliert, die
//   Kategorie "ghost_protocol" heißt dort wie in der Oberfläche "Behind the Scenes"
//   (Nachbesserung: vorher "Ghost Protocol NICHT erwähnen" und "Ghost Protocol
//   Behind-the-Scenes"). Läufe ohne Objekt (eigener Content) behalten Stilregel und Kategorie.
//   Nicht davon erfasst (Gesamtprüfung 06.11.2026): (a) Jeder Systemprompt der fünf Agenten
//   beginnt mit COMPANY_CONTEXT (lib/agent-prompts.ts) und nennt "Ghost Protocol"; activate
//   sendet ihn bei jedem Aufruf mit. (b) COUNSELs Regelpaket nennt die Namen weiter, und das
//   COUNSEL-Review geht an PUBLISHER nur mit maskiertem GESCHÜTZTEM Namen — andere Projekt- und
//   Markennamen (etwa "Ghost Protocol") gehen unmaskiert durch. Ob auch sie maskiert werden,
//   entscheidet der Inhaber (R24). Ein Freigabetext mit geschütztem Namen geht nicht auf
//   "zur_freigabe" (Namensschutz).
// - Die Mindestlänge des Freigabetexts kommt aus lib/freigabe-regeln.ts — eine Regel für
//   Pipeline, Freigeben (api/content/status) und Freigabe-Stapel (api/freigaben).
// - body bleibt die PUBLISHER-Fassung (R2): Welcher Text freigegeben wird, entscheidet der
//   Inhaber; metadata.freigabe_hinweis hält fest, ob sie dem geprüften SCRIBE-Text gleicht.
//   (Entschieden am 10.11.2026, E13: nur wörtlich geprüfter Text — siehe Paket B oben.)

// Stufe 1 (05.11.2026): "krypto_trading" entfernt — Ghost Protocol hat mit Trading
// nichts zu tun. Unbekannte Kategorien werden abgewiesen statt still umgedeutet.
type Kategorie = "ki_automation" | "business_automation" | "ghost_protocol";

const KATEGORIE_LABEL: Record<Kategorie, string> = {
  ki_automation: "KI & Automation",
  business_automation: "Business-Automation",
  ghost_protocol: "Ghost Protocol Behind-the-Scenes",
};

// R24 (Nachbesserung 06.11.2026): Objekt-Läufe (Steinadel-Content) bekommen keinen
// Projektnamen in den Prompt; "ghost_protocol" heißt dort wie in der Oberfläche
// (app/content/page.tsx, CATEGORIES) "Behind the Scenes". Ob die Kategorie für
// Steinadel-Objekte zulässig sein soll, ist eine Produktentscheidung und bleibt offen.
const KATEGORIE_LABEL_OBJEKT: Record<Kategorie, string> = {
  ...KATEGORIE_LABEL,
  ghost_protocol: "Behind the Scenes",
};

function istKategorie(wert: unknown): wert is Kategorie {
  return typeof wert === "string" && Object.prototype.hasOwnProperty.call(KATEGORIE_LABEL, wert);
}

// Gesamtprüfung 06.11.2026: zulässige Plattformen und Formate (auch für GET). Jede hat
// Anweisungen in platformInstructions und Beschriftungen in platformLabel/formatLabel.
// Paket B (10.11.2026, R39, E11): linkedin mit dem Format linkedin_post.
const FORMATE_JE_PLATTFORM: Readonly<Record<string, readonly string[]>> = {
  youtube: ["longform", "short", "deep_dive"],
  twitter: ["thread"],
  x: ["thread"],
  linkedin: ["linkedin_post"],
  newsletter: ["newsletter_issue"],
  tiktok: ["tiktok_short"],
  instagram: ["carousel", "reel", "story"],
};

function istPlattform(wert: unknown): wert is string {
  return typeof wert === "string" && Object.prototype.hasOwnProperty.call(FORMATE_JE_PLATTFORM, wert);
}

/** Eingabewert für eine Meldung: kurz und maskiert (er kommt aus der Anfrage). */
function eingabeText(wert: unknown): string {
  return maskiereGeschuetzteNamen(String(wert)).slice(0, 40);
}

// Paket B (10.11.2026, R2/E13): counsel_endfassung ist COUNSEL auf der PUBLISHER-Fassung. Der Name
// der Stufe steht in steps[].agent (wie bisher der Agentenname); welchen Agenten sie aufruft, sagt
// AGENT_JE_STUFE.
type Stufe = "researcher" | "scribe" | "counsel" | "publisher" | typeof STUFE_ENDPRUEFUNG | "amplifier";

const AGENT_JE_STUFE: Readonly<Record<Stufe, string>> = {
  researcher: "researcher",
  scribe: "scribe",
  counsel: "counsel",
  publisher: "publisher",
  [STUFE_ENDPRUEFUNG]: "counsel",
  amplifier: "amplifier",
};

interface PipelineRequest {
  topic?: string;
  platform: "youtube" | "twitter" | "x" | "linkedin" | "newsletter" | "tiktok" | "instagram";
  format:
    | "longform"
    | "short"
    | "thread"
    | "deep_dive"
    | "linkedin_post"
    | "newsletter_issue"
    | "tiktok_short"
    | "reel"
    | "carousel"
    | "story";
  category?: Kategorie;
  repurpose_from?: string; // Original-Content für Repurposing
  objekt_slug?: string; // Steinadel-Objekt (optional) — bindet Objektdaten in RESEARCHER/SCRIBE ein
  lauf_id?: string; // Idempotenzschlüssel (optional, Fixrunde 06.11.2026, R10)
  medium_id?: number; // Caption zu einem Video: id des Exports in studio_medium (optional, Paket C Schritt 9)
}

interface PipelineStep {
  agent: Stufe;
  status: "pending" | "running" | "done" | "error";
  output?: string;
  /** Stufe 1 (05.11.2026): Fehlergrund getrennt vom Output (früher stand die Meldung in output). */
  fehler?: string;
  /** Geschätzte Kosten laut activate (usage.cost_usd); null = nicht gemeldet, nie 0 als Ersatz. */
  cost?: number | null;
  duration_ms?: number;
  model?: string | null;
  stop_reason?: string | null;
  /** true = abgeschnitten, false = vollständig, null = vom activate-Vertrag nicht gemeldet. */
  abgeschnitten?: boolean | null;
  /** Von activate gemeldete Protokollfehler (bereinigt); fehlt, wenn keine gemeldet sind. */
  protokoll_fehler?: string[];
}

// Fehler- und Warnvermerk mit Stufe und Grund (Stufe 1, 05.11.2026). Steht als
// metadata.fehler (ein Vermerk) bzw. metadata.warnungen (Liste) in der content-Zeile.
interface Vermerk {
  stufe: Stufe | "objekt" | "pipeline";
  grund: string;
  detail?: string;
  /** Befunde einer Textprüfung einzeln (je bereinigt, höchstens 160 Zeichen); nur bei Abbruch an einer Textregel. */
  befunde?: string[];
  am: string;
}

// Grund und Detail landen in metadata (angezeigt in /content und im Objekt-Studio) und in der
// Antwort: deshalb immer bereinigt (R17). Für feste Texte ändert fehlerText nichts.
function vermerk(stufe: Vermerk["stufe"], grund: string, detail?: string): Vermerk {
  const am = new Date().toISOString();
  return detail ? { stufe, grund: fehlerText(grund), detail: fehlerText(detail), am } : { stufe, grund: fehlerText(grund), am };
}

/**
 * Vermerk für einen Abbruch an einer Textregel (Kurzlink, URTEIL-Zeile, Datierung, Alter). Gegenprüfung PR #10
 * (DAT-4/B2): Das Detail ist die Summe der Befunde und wird auf 160 Zeichen gekürzt (bereinigeFehler,
 * lib/status-server.ts). Bei drei und mehr Befunden fiel der Altersbefund dabei weg, und die URL-Bereinigung
 * verschluckte den Trenner hinter einer Adresse („[URL] Alter …“). Jetzt wird jeder Befund einzeln bereinigt
 * und steht vollständig in befunde; das Detail entsteht aus den bereinigten Befunden (Trenner bleiben) und
 * bleibt gekürzt wie bisher.
 * Gegenprüfung PR #13 (X02): Der geschützte Name wird VOR dem Kürzen maskiert. fehlerText maskiert erst nach
 * bereinigeFehler, also nach dem Schnitt bei 160 Zeichen: Stand der Name an der Schnittgrenze, blieb ein unmaskiertes
 * Bruchstück stehen, und ein Name kurz davor machte den Eintrag mit dem längeren Platzhalter länger als 160 Zeichen.
 */
function textregelVermerk(stufe: Stufe, grund: string, befunde: string[]): Vermerk {
  const einzeln = befunde.map((b) => fehlerText(maskiereGeschuetzteNamen(b)));
  return { ...vermerk(stufe, grund, einzeln.join("; ")), befunde: einzeln };
}

// Fehlertext für Speicher und Antwort (Fixrunde 06.11.2026, R17): bereinigeFehler
// (lib/status-server.ts) entfernt Schlüsselwerte, Tokens und URLs und kürzt; dazu wird der
// geschützte Name maskiert. Abbruch und Zeitüberschreitung meldet bereinigeFehler mit dem
// Zeitlimit der Status-Abfragen (8 s); hier gelten andere Limits, deshalb eigener Text mit
// dem tatsächlichen Limit bzw. ohne Zahl.
const ABBRUCH = /TimeoutError|AbortError|aborted|timed out/i;

function fehlerText(e: unknown, zeitlimitMs?: number): string {
  const roh =
    e instanceof Error
      ? `${e.name}: ${e.message}`
      : typeof e === "string"
        ? e
        : istObjekt(e) && typeof e.message === "string"
          ? e.message
          : "";
  if (ABBRUCH.test(roh)) {
    return zeitlimitMs !== undefined
      ? `Zeitüberschreitung oder Abbruch (Zeitlimit ${zeitlimitMs / 1000} s)`
      : "Abbruch oder Zeitüberschreitung";
  }
  return maskiereGeschuetzteNamen(bereinigeFehler(e));
}

// Antwort ohne Pipeline-Ergebnis (4xx/5xx): Fehler heißen "fehler" (Stufe-1-Vertrag).
function fehlerAntwort(status: number, text: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ...extra, fehler: text }, { status });
}

// Steinadel-Objekt, wie von /api/objekte geliefert (Export-API, read-only).
// Fixrunde 06.11.2026 (R21): Das Objekt wird zur Laufzeit geprüft (pruefeExportObjekt) und
// nur aus geprüften Feldern gebaut. Optionale Felder sind null, wenn der Export sie nicht
// liefert — im Prompt steht dann "nicht im Export".
interface Kennzahl {
  label: string;
  wert: string | number;
}
interface Kampagne {
  kampagne: string;
  lpUrl: string;
  lpVariant: string | null;
}
const NICHT_IM_EXPORT = "nicht im Export";
const OPTIONALE_FELDER = ["untertitel", "tagline", "ort", "baujahr", "kurzbeschreibung", "statusBadge"] as const;
type OptionalesFeld = (typeof OPTIONALE_FELDER)[number];

interface ObjektApi extends Record<OptionalesFeld, string | number | null> {
  slug: string;
  name: string;
  preis: string;
  afaProzent: number;
  istDenkmal: boolean;
  kennzahlen: Kennzahl[];
  kampagnen: Kampagne[];
}

type ExportPruefung = { ok: true; objekt: ObjektApi } | { ok: false; feld: string };

function istText(wert: unknown): wert is string {
  return typeof wert === "string" && wert.trim() !== "";
}

function istZahl(wert: unknown): wert is number {
  return typeof wert === "number" && Number.isFinite(wert);
}

function istHttpUrl(wert: string): boolean {
  try {
    const url = new URL(wert);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Pflichtfelder des Export-Objekts prüfen (R21), bevor Snapshot, Prompt oder Insert sie
 * benutzen. Pflicht: name, preis (Text, wird wörtlich übernommen), afaProzent (Zahl),
 * istDenkmal (Boolean), kennzahlen und kampagnen (Listen; je Kennzahl label und wert, je
 * Kampagne kampagne und eine http(s)-lpUrl). Liefert das erste fehlende oder unbrauchbare Feld.
 */
function pruefeExportObjekt(o: Record<string, unknown>, slug: string): ExportPruefung {
  const luecke = (feld: string): ExportPruefung => ({ ok: false, feld });
  if (!istText(o.name)) return luecke("name");
  if (!istText(o.preis)) return luecke("preis");
  if (!istZahl(o.afaProzent)) return luecke("afaProzent");
  if (typeof o.istDenkmal !== "boolean") return luecke("istDenkmal");
  if (!Array.isArray(o.kennzahlen)) return luecke("kennzahlen");
  if (!Array.isArray(o.kampagnen)) return luecke("kampagnen");

  const kennzahlen: Kennzahl[] = [];
  for (const [i, k] of o.kennzahlen.entries()) {
    if (!istObjekt(k) || !istText(k.label)) return luecke(`kennzahlen[${i}].label`);
    if (!istText(k.wert) && !istZahl(k.wert)) return luecke(`kennzahlen[${i}].wert`);
    kennzahlen.push({ label: k.label, wert: k.wert });
  }

  const kampagnen: Kampagne[] = [];
  for (const [i, k] of o.kampagnen.entries()) {
    if (!istObjekt(k) || !istText(k.kampagne)) return luecke(`kampagnen[${i}].kampagne`);
    if (!istText(k.lpUrl) || !istHttpUrl(k.lpUrl)) return luecke(`kampagnen[${i}].lpUrl`);
    if (k.lpVariant !== undefined && k.lpVariant !== null && typeof k.lpVariant !== "string") {
      return luecke(`kampagnen[${i}].lpVariant`);
    }
    kampagnen.push({ kampagne: k.kampagne, lpUrl: k.lpUrl, lpVariant: istText(k.lpVariant) ? k.lpVariant : null });
  }

  // Optionale Felder: fehlt der Wert (undefined, null, leerer Text) → null; Text oder Zahl
  // wird übernommen; alles andere (Objekt, Liste, Boolean) ist unbrauchbar.
  const optional = {} as Record<OptionalesFeld, string | number | null>;
  for (const feld of OPTIONALE_FELDER) {
    const wert = o[feld];
    if (wert === undefined || wert === null || (typeof wert === "string" && wert.trim() === "")) {
      optional[feld] = null;
    } else if (typeof wert === "string" || istZahl(wert)) {
      optional[feld] = wert;
    } else {
      return luecke(feld);
    }
  }

  return {
    ok: true,
    objekt: {
      ...optional,
      slug,
      name: o.name,
      preis: o.preis,
      afaProzent: o.afaProzent,
      istDenkmal: o.istDenkmal,
      kennzahlen,
      kampagnen,
    },
  };
}

/** Optionales Objektfeld für den Prompt: fehlt es, steht "nicht im Export" statt "undefined". */
function anzeige(wert: string | number | null): string {
  return wert === null ? NICHT_IM_EXPORT : String(wert);
}

// Kopf-Felder der Export-Antwort (wie expose/page.tsx sie liest); null = nicht geliefert.
interface ExportKopf {
  version: string | null;
  quelle: string | null;
  generiert_am: string | null;
}

// Beleg-Snapshot (Stufe 1, 05.11.2026): genau die Felder, die buildObjektBlock in die
// Prompts schreibt. Wer buildObjektBlock ein Feld hinzufügt, muss es hier ergänzen —
// sonst belegt der Snapshot nicht mehr, was die Agenten gesehen haben.
const SNAPSHOT_FELDER = [
  "name",
  "untertitel",
  "tagline",
  "ort",
  "baujahr",
  "preis",
  "kurzbeschreibung",
  "statusBadge",
  "afaProzent",
  "istDenkmal",
  "kennzahlen",
  "kampagnen",
] as const satisfies readonly (keyof ObjektApi)[];

interface ObjektSnapshot {
  abgerufen_am: string;
  export: ExportKopf;
  objekt: Record<(typeof SNAPSHOT_FELDER)[number], unknown>;
  /** Paket B: Bezeichnung der Datierungszeile im Prompt, nur bei Objekten mit Datierungs-Ausnahme. */
  datierung?: DatierungsBeleg;
}

function baueSnapshot(o: ObjektApi, kopf: ExportKopf, abgerufenAm: string, datierung: DatierungsBeleg | null): ObjektSnapshot {
  const objekt = {} as ObjektSnapshot["objekt"];
  for (const feld of SNAPSHOT_FELDER) {
    // Fehlt ein Feld im Export, steht null im Beleg — kein Ersatzwert.
    objekt[feld] = o[feld] ?? null;
  }
  return { abgerufen_am: abgerufenAm, export: kopf, objekt, ...(datierung ? { datierung } : {}) };
}

// ═══ Datierung (Paket B, Schritt 4, 10.11.2026) ═══
// Die Ausnahmen kommen aus lib/studio/objekte.ts (DATIERUNG_AUSNAHMEN) — dieselbe Regel wie der
// Studio-Kopf (lib/studio/lesen.ts, kopfAusExport): Nennt der Export genau das Jahr der Ausnahme, heißt
// die Zeile wie die Ausnahme; nennt er ein anderes, heißt sie "Baujahr" wie das Exportfeld, und der
// Lauf trägt eine Warnung. Fundstelle der Ausnahme je Objekt (Steinadel-Repo, nur gelesen, 0f3e82c):
const DATIERUNG_FUNDSTELLE: Readonly<Record<string, string>> = {
  "rittergut-seifersdorf":
    "SR/docs/import/extraktion-rohdaten.json:552 (Feld Baujahr: historische Gründung „Est. 1335“, Stallungen um 1750 bzw. Ende 19. Jh.); " +
    "SR/apps/web/src/app/(public)/dossier/[slug]/dossier-content.ts:51 („1335 · gegr. · Ersterwähnung“)",
};

/** Beleg der Datierungszeile im Objekt-Snapshot (nur bei Objekten mit Datierungs-Ausnahme). */
interface DatierungsBeleg {
  feld: "baujahr";
  /** Bezeichnung der Zeile im Prompt: die der Ausnahme oder "Baujahr". */
  bezeichnung: string;
  /** Exportwert, unverändert. */
  wert: string | number | null;
  ausnahme_greift: boolean;
  /** Jahr, für das die Ausnahme gilt. */
  ausnahme_jahr: number;
  quelle: string;
  fundstelle: string | null;
}

interface Datierung {
  /** Zeile im Objektblock. */
  zeile: string;
  beleg: DatierungsBeleg | null;
  /** Warnung, wenn die Ausnahme nicht greift; sonst null. */
  warnung: string | null;
}

/** Ganze Zahl aus dem Export (Zahl oder Ziffernfolge), wie im Studio-Kopf; sonst null. */
function ganzeZahl(wert: string | number | null): number | null {
  if (typeof wert === "number") return Number.isInteger(wert) ? wert : null;
  if (typeof wert === "string" && /^\d{1,6}$/.test(wert.trim())) return Number(wert.trim());
  return null;
}

/**
 * Verbotene Formen der Datierungsregel (Abnahmelauf 10.11.2026), für die Datierungszeile und den
 * COUNSEL-Prüfpunkt. Die Beispiele nennen „N“ statt der Zahl (2026: 691): Zitiert PUBLISHER die Regel in
 * seinem Fakten-Check oder COUNSEL sie im Review, das an PUBLISHER geht, träfe die Zahl sonst altersBefund,
 * und der Lauf bräche nach bezahlten Aufrufen ab, obwohl der Text die Regel einhält.
 * Gegenprüfung PR #10: Auch keine Rechenformel („N = Jahre seit …“) — sie lädt zum Ausrechnen ein, und
 * „keine Altersableitung (wären 691 Jahre) ✓“ im Fakten-Check bricht nach vier bezahlten Aufrufen ab. „vor N
 * Jahren …“ und „N Jahre her/zurück“ stehen dabei, weil der Code auch sie abbricht („Vor 691 Jahren erstmals
 * urkundlich erwähnt“). Ebenso „seit N Jahren …“ (Gegenprüfung des Nachtrags, NP-3): die naheliegende Umformung
 * des erlaubten „seit 1335 urkundlich belegt“ zu „Seit 691 Jahren urkundlich belegt“, auf die der Code abbricht.
 */
function abgeleiteteAlter(jahr: number): string {
  return `„N Jahre Bausubstanz“, „N Jahre Geschichte“, „N Jahre alt“, „seit N Jahren …“, „vor N Jahren …“, „N Jahre her/zurück“, „seit ${jahr} steht …“, „Substanz/Mauern aus ${jahr}“`;
}

function datierungFuer(o: ObjektApi): Datierung {
  const ausnahme = istStudioObjekt(o.slug) ? (DATIERUNG_AUSNAHMEN[o.slug] ?? null) : null;
  const baujahrZeile = `Baujahr: ${anzeige(o.baujahr)}`;
  if (ausnahme === null) return { zeile: baujahrZeile, beleg: null, warnung: null };
  const greift = ganzeZahl(o.baujahr) === ausnahme.jahr;
  const beleg: DatierungsBeleg = {
    feld: "baujahr",
    bezeichnung: greift ? ausnahme.bezeichnung : "Baujahr",
    wert: o.baujahr,
    ausnahme_greift: greift,
    ausnahme_jahr: ausnahme.jahr,
    quelle: ausnahme.quelle,
    fundstelle: DATIERUNG_FUNDSTELLE[o.slug] ?? null,
  };
  if (!greift) {
    return {
      zeile: baujahrZeile,
      beleg,
      warnung: `Objekt-Ausnahme „${ausnahme.bezeichnung}“ gilt nur für den Exportwert ${ausnahme.jahr}; der Export nennt ${
        o.baujahr === null ? "kein Jahr" : anzeige(o.baujahr)
      }, im Prompt als Baujahr`,
    };
  }
  const wert = anzeige(o.baujahr);
  const jahr = ausnahme.jahr;
  return {
    // Gegenprüfung 10.11.2026: Die Zeile nennt das verbotene Wortpaar nicht (ein Verbot, das es nennt,
    // bringt es erst bei, siehe buildObjektBlock); die Code-Prüfung datierungsBefund fängt es ab.
    // Abnahmelauf 10.11.2026: SCRIBE schrieb trotz „nicht das Errichtungsjahr“ „Seit 1335 steht
    // das RitterGut … 691 Jahre Bausubstanz“, PUBLISHER übernahm es. Die zweite Zeile verbietet deshalb
    // ausdrücklich, aus dem Jahr ein Alter oder eine Bauzeit abzuleiten, mit den Formen aus dem Lauf
    // (abgeleiteteAlter). Eine Bauzeit nennt sie nicht: Die Quelle (DATIERUNG_FUNDSTELLE,
    // extraktion-rohdaten.json:552) datiert nur die Stallungen, je Wohneinheit (WE 1 ca. 1750, WE 4 Ende
    // 19. Jh.), nicht das ganze Gut, und der Export trägt sie nicht.
    zeile:
      `${ausnahme.bezeichnung}: ${wert} (Exportfeld baujahr; gemeint ist die erste urkundliche Erwähnung, nicht das Errichtungsjahr — im Text immer „${ausnahme.bezeichnung} ${wert}“)\n` +
      `  Aus ${jahr} kein Alter und keine Bauzeit ableiten — das Jahr sagt nichts darüber, wann die heutigen Gebäude entstanden. ` +
      `Nicht: ${abgeleiteteAlter(jahr)}. Erlaubt: „${ausnahme.bezeichnung} ${jahr}“, „${jahr} urkundlich erstmals erwähnt“.`,
    beleg,
    warnung: null,
  };
}

// Regelpaket-Version aus der Kopfzeile lesen, z. B. "— v1.1 (Stand 29.07.2026)".
// Die Datei selbst bleibt unverändert (wortgetreue Übernahme). Stufe 1 (05.11.2026).
const REGELPAKET_KOPF = /—\s*(v\d+(?:\.\d+)*)\s*\(Stand\s+(\d{1,2}\.\d{1,2}\.\d{4})\)/;

function leseRegelpaketKopf(): { version: string | null; stand: string | null } {
  const kopfzeile = STEINADEL_REGELPAKET.split("\n", 1)[0] ?? "";
  const treffer = REGELPAKET_KOPF.exec(kopfzeile);
  return treffer ? { version: treffer[1], stand: treffer[2] } : { version: null, stand: null };
}

// Dasselbe Regelpaket steckt im COUNSEL-Systemprompt (lib/agent-prompts.ts) — die
// gespeicherte Version ist also die, gegen die COUNSEL in diesem Build geprüft hat.
const REGELPAKET = leseRegelpaketKopf();

// RESEARCHER hat kein Recherche-Werkzeug; seine "Quellen" sind Modellangaben.
const RESEARCHER_QUELLEN_HINWEIS = "Modellangabe, ungeprüft (kein Recherche-Werkzeug)";

const KOSTEN_HINWEIS =
  "geschätzt (Tokens × feste Preistabelle der activate-Route); Stufen ohne Kostenangabe fehlen in der Summe";

// Stufe 1 (05.11.2026): Ohne Zeitlimit hing ein hängender Export die ganze Pipeline auf.
const OBJEKT_TIMEOUT_MS = 20_000;

// Text unter MIN_FREIGABE_ZEICHEN (lib/freigabe-regeln.ts, nach Trimmen) gilt vor
// "zur_freigabe" als leer.

// Lauf-ID (R10): vom Browser erzeugt (crypto.randomUUID()), Vertrag mit der Content-Seite.
const LAUF_ID_MUSTER = /^[A-Za-z0-9:_-]{8,80}$/;

/** medium_id (Paket C, Schritt 9): positive ganze Zahl im sicheren Bereich, wie die ids in studio_medium. */
function istMediumId(wert: unknown): wert is number {
  return typeof wert === "number" && Number.isSafeInteger(wert) && wert > 0;
}

/**
 * Auftragsart im SCRIBE-Auftrag für die Caption zu einem Video (Paket C, Schritt 9; Spezifikation §6.3 und Z. 1262).
 * Die Pflichtzeile steht allein in ihrer Zeile, damit SCRIBE sie Zeichen für Zeichen übernehmen kann. Fehlt sie in der
 * PUBLISHER-Fassung, ergänzt die Pipeline sie vor der Endprüfung (pflichtzeileEinsetzen; eine nahe Variante wird ersetzt).
 */
const CAPTION_AUFTRAG =
  "AUFTRAGSART: Caption zu einem Video, Pflichtzeile KI-Hinweis\n" +
  "- Der Content ist die Caption zu einem KI-generierten Video dieses Objekts.\n" +
  "- Die Caption enthält diese Pflichtzeile wörtlich als eigene Zeile, Zeichen für Zeichen, ohne Formatierung und ohne Zusatz in derselben Zeile:\n" +
  KI_PFLICHTZEILE_CAPTION;

// Namensschutz (R24): Grund, mit dem ein Freigabetext mit geschütztem Namen endet.
const NAMENSSCHUTZ_GRUND = "Namensschutz: Freigabetext enthält einen geschützten Namen";

// Vollständig ist eine Antwort nur mit diesen stop_reason-Werten (activate-Vertrag,
// Fixrunde 06.11.2026); jeder andere gemeldete Wert heißt abgeschnitten.
const STOP_VOLLSTAENDIG: ReadonlySet<string> = new Set(["end_turn", "stop_sequence"]);

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function textOderNull(wert: unknown): string | null {
  if (typeof wert === "number" && Number.isFinite(wert)) return String(wert);
  return typeof wert === "string" && wert.trim() !== "" ? wert : null;
}

interface Aktivierung {
  response: string;
  cost: number | null;
  model: string | null;
  stop_reason: string | null;
  abgeschnitten: boolean | null;
  protokoll_fehler: string[];
}

/**
 * Fehlerantwort der activate-Route; trägt deren Protokollfehler weiter (Nachbesserung) und die
 * gemeldeten Kosten eines bezahlten Fehllaufs (Gesamtprüfung 06.11.2026; null = nicht gemeldet).
 */
class AktivierungsFehler extends Error {
  readonly protokollFehler: string[];
  readonly kosten: number | null;
  readonly modell: string | null;
  readonly stopReason: string | null;
  constructor(
    meldung: string,
    protokollFehler: string[],
    kosten: number | null = null,
    modell: string | null = null,
    stopReason: string | null = null
  ) {
    super(meldung);
    this.protokollFehler = protokollFehler;
    this.kosten = kosten;
    this.modell = modell;
    this.stopReason = stopReason;
  }
}

const PROTOKOLL_UNLESBAR = "protokoll_fehler nicht lesbar (activate-Vertrag)";

/**
 * Protokollfehler der activate-Antwort lesen (Gesamtprüfung 06.11.2026): vorrangig die Liste
 * protokoll_fehler_liste, sonst der Text protokoll_fehler, am Trenner "; " geteilt
 * (leseProtokollEintraege). Jede andere Form ist ein Vertragsbruch und wird als Protokollfehler
 * vermerkt statt still verworfen (fail-closed). Die Einträge sind Fehlertexte (Supabase) und
 * werden in steps gespeichert: deshalb je Eintrag bereinigt (höchstens 160 Zeichen je Eintrag).
 */
function leseProtokollFehler(liste: unknown, text: unknown): string[] {
  const gelesen = leseProtokollEintraege(liste, text);
  const texte = gelesen.eintraege.map((e) => fehlerText(e));
  return gelesen.unlesbar ? [...texte, PROTOKOLL_UNLESBAR] : texte;
}

/** usage.cost_usd einer activate-Antwort (Erfolg oder Fehllauf); null = nicht gemeldet. */
function leseKosten(obj: Record<string, unknown>): number | null {
  const usage: Record<string, unknown> = istObjekt(obj.usage) ? obj.usage : {};
  return typeof usage.cost_usd === "number" && Number.isFinite(usage.cost_usd) && usage.cost_usd >= 0 ? usage.cost_usd : null;
}

// Agent über die interne activate-Route aufrufen. Vertrag (Fixrunde 06.11.2026): 200
// { agent_id, model, response, usage{…cost_usd…}, stop_reason: string|null,
// abgeschnitten: boolean|null, protokoll_fehler?: string|null, protokoll_fehler_liste?: string[] };
// leere Antwort → 502 { fehler: "leere Antwort", agent_id, model, stop_reason, usage,
// protokoll_fehler, protokoll_fehler_liste }. Fehler werfen (AktivierungsFehler mit den
// Protokollfehlern und den gemeldeten Kosten der Fehlerantwort).
async function activateAgent(agentId: string, task: string, cookie: string): Promise<Aktivierung> {
  const res = await fetch(`${BASE_URL}/api/agents/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ agent_id: agentId, task }),
  });

  const daten: unknown = await res.json().catch(() => null);
  const obj: Record<string, unknown> = istObjekt(daten) ? daten : {};
  const stopReason = textOderNull(obj.stop_reason);
  const protokollFehler = leseProtokollFehler(obj.protokoll_fehler_liste, obj.protokoll_fehler);
  // Auch ein Fehllauf (502) meldet seine Kosten: Die Tokens sind bezahlt.
  const kosten = leseKosten(obj);

  if (!res.ok) {
    // R17: Der Fehlertext der activate-Route kann Schlüsselwerte enthalten — nur bereinigt
    // weitergeben (er landet in steps[].fehler und in der Antwort). Der eigene Präfix
    // "HTTP <status>" bleibt dabei erhalten.
    const roh = textOderNull(obj.fehler) ?? textOderNull(obj.error);
    const meldung = roh === null ? "ohne Fehlertext" : fehlerText(roh);
    throw new AktivierungsFehler(
      `HTTP ${res.status}: ${meldung}${stopReason ? ` (stop_reason: ${stopReason})` : ""}`,
      protokollFehler,
      kosten,
      textOderNull(obj.model),
      stopReason
    );
  }
  if (!istObjekt(daten)) {
    throw new Error(`HTTP ${res.status}: Antwort ist kein JSON-Objekt`);
  }

  // Fail-closed und deckungsgleich mit dem activate-Vertrag: abgeschnitten, sobald das Feld es
  // sagt oder ein gemeldeter stop_reason weder end_turn noch stop_sequence ist; vollständig
  // nur, wenn das Feld false sagt UND stop_reason end_turn/stop_sequence ist; sonst null.
  const abgeschnitten =
    obj.abgeschnitten === true || (stopReason !== null && !STOP_VOLLSTAENDIG.has(stopReason))
      ? true
      : obj.abgeschnitten === false && stopReason !== null
        ? false
        : null;

  return {
    response: typeof obj.response === "string" ? obj.response : "",
    cost: kosten,
    model: textOderNull(obj.model),
    stop_reason: stopReason,
    abgeschnitten,
    protokoll_fehler: protokollFehler,
  };
}

// Gemeldete Protokollfehler an der Stufe und als Warnung festhalten (Erfolgs- und Fehlerweg).
// Gesamtprüfung 06.11.2026: je Eintrag eine eigene Warnung — ein zusammengefügtes Detail würde
// wieder auf 160 Zeichen gekürzt, und spätere Einträge fielen weg.
function vermerkeProtokoll(step: PipelineStep, protokollFehler: string[], warnungen: Vermerk[]): void {
  if (protokollFehler.length === 0) return;
  step.protokoll_fehler = protokollFehler;
  protokollFehler.forEach((eintrag, i) => {
    warnungen.push(
      vermerk(step.agent, `Protokoll der Aktivierung unvollständig (${i + 1}/${protokollFehler.length})`, eintrag)
    );
  });
}

// Eine Stufe ausführen und ihr Ergebnis in step eintragen. gateStufe = SCRIBE, COUNSEL,
// PUBLISHER: dort sind abgeschnitten, ungemeldeter Abschneide-Status und leere Antwort
// Fehler; bei RESEARCHER/AMPLIFIER nur Warnungen. Stufe 1 (05.11.2026).
async function fuehreStufeAus(
  step: PipelineStep,
  task: string,
  cookie: string,
  gateStufe: boolean,
  warnungen: Vermerk[]
): Promise<void> {
  step.status = "running";
  const start = Date.now();
  try {
    // Paket B: Die Stufe counsel_endfassung ruft COUNSEL auf (AGENT_JE_STUFE).
    const r = await activateAgent(AGENT_JE_STUFE[step.agent], task, cookie);
    step.output = r.response;
    step.cost = r.cost;
    step.model = r.model;
    step.stop_reason = r.stop_reason;
    step.abgeschnitten = r.abgeschnitten;
    vermerkeProtokoll(step, r.protokoll_fehler, warnungen);

    let problem: string | null = null;
    if (r.abgeschnitten === true) problem = "Antwort abgeschnitten";
    else if (r.abgeschnitten === null) problem = "Abschneide-Status nicht gemeldet (activate-Vertrag)";
    else if (!r.response.trim()) problem = "leere Antwort";

    if (problem && gateStufe) {
      step.status = "error";
      step.fehler = problem;
    } else {
      if (problem) warnungen.push(vermerk(step.agent, problem));
      step.status = "done";
    }
  } catch (err) {
    step.status = "error";
    // R17: bereinigt, bevor er in metadata.steps gespeichert und zurückgegeben wird.
    step.fehler = fehlerText(err);
    // Kosten: die von activate gemeldeten eines bezahlten Fehllaufs; sonst unbekannt (null) —
    // ein fehlgeschlagener Aufruf kann trotzdem Tokens verbraucht haben.
    step.cost = err instanceof AktivierungsFehler ? err.kosten : null;
    if (err instanceof AktivierungsFehler) {
      if (err.modell !== null) step.model = err.modell;
      if (err.stopReason !== null) step.stop_reason = err.stopReason;
      // Auch eine Fehlerantwort kann Protokollfehler melden (z. B. Fehllauf-Zeile nicht geschrieben).
      vermerkeProtokoll(step, err.protokollFehler, warnungen);
    }
  } finally {
    step.duration_ms = Date.now() - start;
  }
}

// Gegencheck 06.11.2026: Meldet keine gelaufene Stufe Kosten, ist die Summe null ("nicht
// gemeldet"), nicht 0 — auto-produce gab die 0 sonst als geschätzte Kosten weiter. Gleiche
// Regel wie fasseLaeufeZusammen (lib/status-server.ts) und fleet/activate.
function kostenZusammenfassung(steps: PipelineStep[]) {
  let summe = 0;
  let mitKosten = 0;
  let unvollstaendig = false;
  for (const s of steps) {
    if (s.status === "pending") continue; // nicht gelaufen → keine Kosten
    if (typeof s.cost === "number") {
      summe += s.cost;
      mitKosten += 1;
    } else unvollstaendig = true;
  }
  return {
    total_cost_usd: mitKosten > 0 ? Math.round(summe * 100000) / 100000 : null,
    kosten_unvollstaendig: unvollstaendig,
    kosten_hinweis: KOSTEN_HINWEIS,
  };
}

function zusammenfassung(steps: PipelineStep[]) {
  return {
    ...kostenZusammenfassung(steps),
    total_duration_ms: steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
    // Paket B: sechs Stufen (mit der COUNSEL-Endprüfung); gezählt wird die Länge, nicht eine feste Zahl.
    completed: `${steps.filter((s) => s.status === "done").length}/${steps.length}`,
  };
}

type ObjektAbruf =
  | { art: "ok"; objekt: ObjektApi; kopf: ExportKopf; abgerufen_am: string }
  | { art: "nicht_gefunden" }
  | { art: "unvollstaendig"; feld: string }
  | { art: "export_fehler"; meldung: string };

// Meldung des Export-Proxys (/api/objekte) für Antwort und Speicher.
// Nachprüfung 06.11.2026: Der Proxy unterscheidet seither Fehlerantwort ("quelle_http_<Status>")
// und unlesbares JSON ("quelle_antwort_unlesbar") von "nicht erreichbar"; ein fehlendes Token
// meldet er im Klartext ("Export-Token (Server-Umgebung) nicht gesetzt").
// Gegencheck 06.11.2026: Der Zweig für die Altform mit Variablennamen (vor R23) ist entfernt —
// der Proxy im selben Build nennt ihn nicht mehr. Ein geschützter Name in einem künftigen Text
// wird weiterhin von fehlerText maskiert.
function exportMeldung(roh: string | null, status: number): string {
  if (roh === null) return `HTTP ${status}`;
  if (roh === "quelle_nicht_erreichbar") return `Quelle nicht erreichbar (HTTP ${status})`;
  const quelleStatus = /^quelle_http_(\d{3})$/.exec(roh);
  if (quelleStatus) return `Quelle antwortete mit HTTP ${quelleStatus[1]} (HTTP ${status})`;
  if (roh === "quelle_antwort_unlesbar") return `Antwort der Quelle nicht lesbar (HTTP ${status})`;
  return `${fehlerText(roh)} (HTTP ${status})`;
}

// Objektdaten per Slug aus der Steinadel-Export-API laden (Cookie-Weiterreichung
// wie bei activateAgent, da /api/objekte hinter der Auth-Middleware liegt).
// Stufe 1 (05.11.2026): liefert auch die Kopf-Felder für den Beleg-Snapshot und
// unterscheidet "Export nicht lesbar" von "Objekt nicht gefunden".
// Fixrunde 06.11.2026 (R21): "unvollständig" = Objekt gefunden, aber Pflichtfeld fehlt.
async function fetchObjekt(slug: string, cookie: string): Promise<ObjektAbruf> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/objekte`, {
      headers: { Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(OBJEKT_TIMEOUT_MS),
    });
  } catch (err) {
    return { art: "export_fehler", meldung: fehlerText(err, OBJEKT_TIMEOUT_MS) };
  }
  const abgerufenAm = new Date().toISOString();
  const daten: unknown = await res.json().catch(() => null);
  if (!res.ok || !istObjekt(daten)) {
    return { art: "export_fehler", meldung: exportMeldung(istObjekt(daten) ? textOderNull(daten.fehler) : null, res.status) };
  }
  if (!Array.isArray(daten.objekte)) {
    return { art: "export_fehler", meldung: "Antwort ohne Objektliste" };
  }
  const roh = (daten.objekte as unknown[]).find(
    (o): o is Record<string, unknown> => istObjekt(o) && o.slug === slug
  );
  if (!roh) return { art: "nicht_gefunden" };
  const pruefung = pruefeExportObjekt(roh, slug);
  if (!pruefung.ok) return { art: "unvollstaendig", feld: pruefung.feld };
  return {
    art: "ok",
    objekt: pruefung.objekt,
    kopf: {
      version: textOderNull(daten.version),
      quelle: textOderNull(daten.quelle),
      generiert_am: textOderNull(daten.generiert_am),
    },
    abgerufen_am: abgerufenAm,
  };
}

// OBJEKTDATEN-Block für RESEARCHER/SCRIBE/COUNSEL (seit Paket B auch PUBLISHER) — inkl. Zahlen-Regel.
// Paket B (10.11.2026): Datierungszeile aus datierungFuer (Ersterwähnung statt Baujahr), und der CTA
// verweist auf den Kurzlink (Abschnitt CTA-LINK, ctaBlock) statt auf die Kampagnen-URL; ohne Kurzlink
// gibt es einen allgemeinen CTA ohne Link.
// Gegenprüfung Paket B (10.11.2026): Die Kampagnen stehen ohne ihre lpUrl im Block. Vorher lag dort
// die Adresse jeder Kampagnenseite (/l/…); übernahm SCRIBE oder PUBLISHER sie (etwa im
// Newsletter-Teaser), endete der Lauf an der Kurzlink-Prüfung — nach bezahlten Aufrufen. Die lpUrl
// bleibt im Objekt-Snapshot (Beleg); COUNSEL bekommt das Ziel im Kurzlink-Block.
function buildObjektBlock(o: ObjektApi, datierung: Datierung, mitKurzlink: boolean): string {
  // Fixrunde 06.11.2026 (R21): Felder sind geprüft (pruefeExportObjekt); fehlende optionale
  // stehen als "nicht im Export" da, nie als "undefined".
  const kennzahlenText = o.kennzahlen.length
    ? o.kennzahlen.map((k) => `- ${k.label}: ${k.wert}`).join("\n")
    : "- (keine Kennzahlen im Export)";
  const kampagnenText = o.kampagnen.length
    ? `${o.kampagnen.map((k) => `- ${k.kampagne}${k.lpVariant ? ` (${k.lpVariant})` : ""}`).join("\n")}\n` +
      (mitKurzlink
        ? "(Kampagnenseiten nie direkt verlinken — verlinkt wird nur über den CTA-Link.)"
        : "(Kampagnenseiten nicht verlinken — es gibt keinen CTA-Link.)")
    : "- (keine Kampagne hinterlegt)";
  // Stufe 1 (05.11.2026): Der interne Codename wird hier nicht mehr ausgeschrieben —
  // ein Verbot, das das Wort nennt, bringt es SCRIBE erst bei. Die Prüfung auf den
  // Codenamen leistet COUNSEL mit dem Regelpaket (Block 6).
  return `OBJEKTDATEN (Steinadel-Export, read-only):
Name: ${o.name}
Untertitel: ${anzeige(o.untertitel)}
Tagline: ${anzeige(o.tagline)}
Ort: ${anzeige(o.ort)}
${datierung.zeile}
Preis: ${o.preis}
Kurzbeschreibung: ${anzeige(o.kurzbeschreibung)}
Status: ${anzeige(o.statusBadge)}
AfA-Satz: ${o.afaProzent} %
Denkmalobjekt: ${o.istDenkmal ? "ja" : "nein"}
Kennzahlen:
${kennzahlenText}
Kampagnen:
${kampagnenText}

REGEL: JEDE Zahl im Content muss aus diesen Objektdaten stammen — keine erfundenen
oder aus dem Gedächtnis ergänzten Zahlen. "${o.preis}" (preis) ist ein String und
wird WÖRTLICH übernommen, nicht gerundet oder umgerechnet. Interne Codenamen von
Systemen oder Projekten dürfen NIEMALS im Content vorkommen — öffentliche Marke ist
ausschließlich "Steinadel".

PFLICHT-ELEMENTE (COUNSEL lehnt ohne diese ab — plattform-unabhängig, sie standen
früher nur in der X-Anweisung, weshalb Instagram-/Newsletter-Läufe systematisch
scheiterten):
0. AfA-QUOTE IMMER QUALIFIZIEREN: "${o.afaProzent} %" ist die Denkmal-AfA-QUOTE,
   keine garantierte persönliche Abschreibung. Schreibe deshalb NIE
   "${o.afaProzent} % Abschreibung" oder "${o.afaProzent} % Steuerersparnis",
   sondern immer qualifiziert: "Denkmal-AfA bis ${o.afaProzent} %". Das gilt auch
   und besonders in Hook, Headline, Betreffzeile und Slide 1 — ein Disclaimer am
   Ende heilt eine irreführende Überschrift NICHT (UWG §5).
1. MODELLRECHNUNG-DISCLAIMER: Sobald AfA, Steuer, Abschreibung oder Ersparnis
   vorkommt, MUSS dieser Satz wörtlich im Content stehen (Caption, Slide-Subtext
   oder Fußzeile — sichtbar, nicht versteckt): "Modellrechnung — individuelle
   steuerliche Wirkung abhängig von persönlicher Situation und
   Behördenbescheinigung; keine Steuerberatung."
2. KI-KENNZEICHNUNG: Die Objektvisualisierungen sind KI-generiert. Das Label
   "KI-generiert" muss deshalb als AUSGESCHRIEBENER, sichtbarer Text im Content
   selbst stehen — in der Caption bzw. im Slide-/Fußzeilen-Text (EU AI Act
   Art. 50, ab 02.08.2026 ausnahmslos). Eine Anweisung an den Designer
   ("[DESIGN] KI-Label einblenden") genügt NICHT und wird abgelehnt: schreibe den
   Hinweis wörtlich in den Text, den der Leser sieht, z. B. "Visualisierung:
   KI-generiert".
2b. ANBIETERKENNZEICHNUNG: Jede Caption/Fußzeile nennt den Impressums-Verweis
   "Impressum: steinadel.de/impressum" (§5 TMG).
3. KEINE SOCIAL-HANDLES: Stand heute existieren KEINE bestätigten Steinadel-Konten.
   Erfinde niemals ein Handle (kein "@steinadel", kein "@steinadel_immobilien").
   ${
     mitKurzlink
       ? "Der CTA verweist auf den Kurzlink (Abschnitt CTA-LINK bzw. KURZLINK), nicht auf ein Profil\n   und nicht direkt auf die Kampagnenseite."
       : "Es gibt keinen CTA-Link: allgemeiner CTA ohne Link, keine steinadel.de-Adresse außer\n   dem Impressums-Verweis."
   }
4. KEINE GESCHÄFTS-/ERFOLGSZAHLEN: kein Umsatz, MRR, Kunden-, Abonnenten- oder
   Followerzahlen, kein "ausgebucht"/"Warteliste" — auch nicht aus anderen
   Projekten (Interna anderer Projekte und Marken gehören NIE in Steinadel-Content).
5. KEINE POSTING-BEHAUPTUNGEN: Der Content wird NICHT automatisch veröffentlicht.
   Schreibe nichts, was ein Posting, Scheduling oder eine erledigte Freigabe
   behauptet.`;
}

// ═══ CTA-Kurzlink (Paket B, Schritt 4, 10.11.2026; E12-Ersatzweg, lib/steinadel-kurzlink.ts) ═══
// Vorher: Direktlink lpUrl?utm_source=<plattform>&utm_medium=social&… mit utm_content aus sanitizeUtm.

type Kurzlink = Extract<KurzlinkPruefung, { ok: true }>;

const KURZLINK_REGEL =
  "E12-Ersatzweg (Spezifikation §6.3): im Code geprüft, Auflösung wie die Steinadel-Weiterleitung (lib/steinadel-kurzlink.ts)";

/** Grund, mit dem ein Lauf endet, wenn ein Text die Kurzlink-Prüfung nicht besteht. */
const KURZLINK_GRUND = "Kurzlink-Prüfung nicht bestanden (E12)";
/** Grund, wenn ein Text eine andere Textregel des Codes verletzt (URTEIL-Zeile, Datierung). */
const TEXTREGEL_GRUND = "Textregel nicht erfüllt";

/**
 * CTA-Regel für SCRIBE und PUBLISHER: der Kurzlink wörtlich, kein anderer steinadel.de-Link.
 * Gegenprüfung 10.11.2026: Profil-CTAs der Plattform-Anweisungen (YouTube, TikTok, Instagram)
 * ersetzen den Link nicht, und Cross-Promotion-Texte tragen keinen eigenen Link.
 * Nachbesserung PR #9: Cross-Promotion-Texte (Tweet, Newsletter-Teaser) tragen gar keinen Link mehr.
 * Vorher war dort der CTA-Link erlaubt; er trägt die utm_source des Hauptkanals, ein Klick aus dem
 * Teaser zählte also für die falsche Quelle. Prüfen kann das der Code nicht: Er weiß nicht, in welchem
 * Teil des Texts ein Link steht (lib/steinadel-kurzlink.ts, pruefeKurzlinksImText).
 */
function ctaBlock(k: Kurzlink): string {
  return `CTA-LINK (Pflicht, Zeichen für Zeichen übernehmen): ${k.link}
- Genau dieser Link steht im CTA: bei X im letzten Tweet, bei YouTube und TikTok in der Beschreibung,
  bei Instagram in der Caption. Ein Verweis auf ein Profil, „Link in Bio“ oder „Folgen“ ersetzt ihn nicht.
- Nicht kürzen, nichts anhängen, keine UTM-Parameter ergänzen, kein Schrägstrich am Ende — die UTMs
  setzt der Steinadel-Server beim Weiterleiten.
- Sonst kein Link auf steinadel.de: keine Kampagnenseite /l/…, keine Objektseite, keine Kurzlink-Variante
  mit anderem Kürzel. Erlaubt ist daneben nur der Impressums-Verweis "Impressum: steinadel.de/impressum".
- Cross-Promotion-Posts und Teaser (Tweet, Newsletter-Teaser) tragen keinen Link, auch nicht diesen
  CTA-Link: Er zählt Klicks nur für diesen Kanal. Sie verweisen stattdessen auf den Hauptpost.`;
}

/**
 * Für COUNSEL: was der Code geprüft hat und was nicht — der CTA-Link mit aufgelöster Ziel-URL und UTMs.
 * Gegenprüfung 10.11.2026: Der Umfang der Code-Prüfung steht ausdrücklich da (nur Adressen auf
 * steinadel.de), damit COUNSEL Links auf andere Domains weiter selbst prüft (Regelpaket §2). Dazu die
 * Zählweise der Weiterleitung ohne Personenbezug, laut Steinadel-Code (SR/apps/web/src/app/k/[kampagne]/
 * [content]/route.ts:1-7, 42-47: kein Cookie, kein Fingerprint, Zähler ohne IP und User-Agent).
 */
function kurzlinkBlock(k: Kurzlink): string {
  return `KURZLINK — vom Code deterministisch geprüft (Ersatzweg nach Entscheidung des Betreibers vom 10.11.2026):
Der CTA ist der Steinadel-Kurzlink ${k.link}
- Er leitet weiter auf ${k.ziel.url} (Weiterleitung 307; die UTM-Parameter setzt der Steinadel-Server).
- Ziel: Kampagnenseite ${k.ziel.lp_pfad} auf steinadel.de; utm_source ${k.ziel.utm_source}, utm_medium ${k.ziel.utm_medium}, utm_campaign ${k.ziel.utm_campaign} (= Slug der Kampagnenseite), utm_content ${k.ziel.utm_content}.
- Den Klick zählt der Steinadel-Server ohne Cookie und ohne Speicherung von IP-Adresse oder User-Agent.
Geprüft hat der Code nur die Adressen auf steinadel.de: Der CTA-Link steht unverändert im Content, und dort gibt es keinen anderen Kurzlink und keinen Direktlink auf eine Kampagnenseite. Links auf andere Domains — auch Kurzlink-Dienste — hat der Code nicht geprüft.
Prüfe den Kurzlink anhand dieser aufgelösten Ziel-URL (Regelpaket §2 Ziel-Links, §3 UTM-Konvention). Alle übrigen Inhalte und Links prüfst du wie immer nach dem Regelpaket.`;
}

/**
 * Schluss beider COUNSEL-Aufträge (Abnahmelauf 10.11.2026): Die Endprüfung schrieb ihre Checkliste
 * mit ✓ und hängte den Haken auch an die Urteilszeile („**URTEIL: FREIGABE-EMPFEHLUNG** ✓“). werteCounselAus
 * wertet das als UNKLAR (lib/counsel-urteil.ts, Regel 5: jeder Zusatz macht die Zeile UNKLAR), der Lauf endete
 * „abgelehnt“. Der Parser bleibt streng. Stattdessen sagt der Auftrag wörtlich, wie die letzte Zeile aussieht,
 * und zwar ganz am Ende, direkt vor der Antwort (activate schickt den Auftrag unverändert als Nachricht).
 * Gegenprüfung PR #10: Das Regelpaket (§6) verlangt bei Preis, AfA und dem ersten Post auf einem Kanal eine
 * Eskalation; „URTEIL: FREIGABE-EMPFEHLUNG (Eskalation …)“ wäre UNKLAR. Der Schluss sagt deshalb, wohin sie gehört.
 */
const URTEIL_SCHLUSS =
  "LETZTE ZEILE: Deine Antwort endet mit einer Zeile, die wörtlich nur 'URTEIL: FREIGABE-EMPFEHLUNG' oder 'URTEIL: ABLEHNUNG' lautet. " +
  "Sie steht allein in ihrer Zeile, ohne Anführungszeichen und ohne Formatierung; dahinter steht nichts — kein ✓, kein Emoji, " +
  "keine Klammer, kein Kommentar. Eskalationen und Hinweise an den Betreiber stehen in den Befunden darüber, nie in oder " +
  "hinter der Urteilszeile. 'URTEIL:' steht nur in dieser Zeile.";

/** Anfang des Auftrags der COUNSEL-Vorprüfung (SCRIBE-Text); danach folgen Prüfpunkt, Content, Objektdaten und der Schluss. */
const VORPRUEFUNG_KOPF =
  "Pruefe den folgenden Content STRIKT gegen dein STEINADEL-REGELPAKET (fail-closed). Zahlen NUR gegen die mitgelieferten " +
  "Objektdaten abgleichen. Zitiere Verstoesse. HALTE das Review KOMPAKT (max. ~300 Woerter — nur Befunde, keine langen " +
  "Tabellen) und schliesse ZWINGEND mit der URTEIL:-Zeile ab (Form: LETZTE ZEILE am Ende dieses Auftrags).";

/** Anfang des Auftrags der COUNSEL-Endprüfung (Paket B, R2/E13); Aufbau wie bei der Vorprüfung. */
const ENDPRUEFUNG_KOPF =
  "ENDPRUEFUNG (R2): Pruefe die folgende ENDFASSUNG WOERTLICH und STRIKT gegen dein STEINADEL-REGELPAKET (fail-closed). " +
  "Genau dieser Text geht unveraendert zur Freigabe — geprueft wird ALLES darin, auch Metadaten, Hashtags, " +
  "Zeitpunkt-Empfehlung und Cross-Promotion-Texte. Zahlen NUR gegen die mitgelieferten Objektdaten abgleichen. Zitiere " +
  "Verstoesse. HALTE das Review KOMPAKT (max. ~300 Woerter — nur Befunde, keine langen Tabellen) und schliesse ZWINGEND " +
  "mit der URTEIL:-Zeile ab (Form: LETZTE ZEILE am Ende dieses Auftrags).";

/**
 * Prüfpunkt beider COUNSEL-Aufträge bei greifender Datierungs-Ausnahme (Abnahmelauf 10.11.2026):
 * „Seit 1335 steht … 691 Jahre Bausubstanz“ kam durch beide Prüfungen („Seit 1335 ✓“), denn das Regelpaket
 * kennt die Regel nicht. Es bleibt unverändert; die Regel steht deshalb im Auftrag, wie in der Datierungszeile.
 * Leer ohne greifende Ausnahme.
 */
function datierungsPruefpunkt(datierung: Datierung | null): string {
  const beleg = datierung?.beleg;
  if (!beleg || !beleg.ausnahme_greift) return "";
  const jahr = beleg.ausnahme_jahr;
  return (
    `\n\nPRÜFPUNKT DATIERUNG (Auftrag, zusätzlich zum Regelpaket): ${jahr} ist bei diesem Objekt nur die ${beleg.bezeichnung}, ` +
    `die erste urkundliche Erwähnung — kein Bau- oder Errichtungsjahr. Eine Alters- oder Bauangabe aus diesem Jahr ist ein Verstoß ` +
    `und führt zu ABLEHNUNG, etwa ${abgeleiteteAlter(jahr)}. Erlaubt sind „${beleg.bezeichnung} ${jahr}“ und ` +
    `„${jahr} urkundlich erstmals erwähnt“.`
  );
}

/** Beleg der Prüfanweisungen an COUNSEL (metadata.pruefauftrag). */
interface PruefauftragBeleg {
  /** Erste 16 Hex-Zeichen von SHA-256 über die Prüfanweisungen beider COUNSEL-Aufträge. */
  kennung: string;
  /** true, wenn die Aufträge den PRÜFPUNKT DATIERUNG trugen (greifende Datierungs-Ausnahme). */
  datierung_pruefpunkt: boolean;
  /** Was die Kennung abdeckt und was nicht. */
  umfang: string;
}

const PRUEFAUFTRAG_UMFANG =
  "SHA-256, erste 16 Hex-Zeichen, über Kopf von Vor- und Endprüfung, PRÜFPUNKT DATIERUNG und Urteilsform (LETZTE ZEILE); " +
  "nicht darin: geprüfter Text, Objektdaten und Kurzlink-Block (Belege: objekt_snapshot, kurzlink) und der Systemprompt " +
  "(Regelpaket: regelpaket)";

/**
 * Auftragskennung (Gegenprüfung PR #10, B3): Die Zeile belegte nur die Regelpaket-Version. Seit dem Abnahmelauf vom
 * 10.11.2026 stehen aber Prüfanweisungen im Auftrag, die nicht im Regelpaket stehen — die Urteilsform und der
 * Datierungs-Prüfpunkt, der zu ABLEHNUNG führt. Läufe mit verschiedenen Anweisungen sahen im Beleg gleich aus. Die
 * Kennung ist ein Hash über genau die Teile beider COUNSEL-Aufträge, die Anweisung sind (Kopf, Prüfpunkt, Schluss), in
 * dieser Reihenfolge als JSON-Liste. Ändert sich einer davon, ändert sich die Kennung; Läufe mit Prüfpunkt (Objekt mit
 * greifender Ausnahme) haben eine andere Kennung als Läufe ohne.
 */
function pruefauftragBeleg(datierung: Datierung | null): PruefauftragBeleg {
  const pruefpunkt = datierungsPruefpunkt(datierung);
  const kennung = createHash("sha256")
    .update(JSON.stringify([VORPRUEFUNG_KOPF, ENDPRUEFUNG_KOPF, pruefpunkt, URTEIL_SCHLUSS]), "utf8")
    .digest("hex")
    .slice(0, 16);
  return { kennung, datierung_pruefpunkt: pruefpunkt !== "", umfang: PRUEFAUFTRAG_UMFANG };
}

/**
 * Satz im PUBLISHER-Auftrag bei greifender Datierungs-Ausnahme (Gegenprüfung PR #10): PUBLISHERs ganze Antwort ist
 * der Freigabetext, auch Qualitätsprüfung und Fakten-Check. Ein dort ausgerechnetes Alter („wären 691 Jahre“)
 * bricht den Lauf nach vier bezahlten Aufrufen ab (altersBefund), ein wörtliches Regelzitat steht im Freigabetext.
 * Leer ohne greifende Ausnahme.
 * Gegenprüfung des Nachtrags (NP-1): Das Verbot, Regeln wörtlich zu zitieren, stand direkt neben „Pflichtzeilen …
 * unverändert“ und „Disclaimer wörtlich“, und die Pflichttexte stehen im Auftrag nur als Teil von Regeln. Der Satz
 * gilt deshalb ausdrücklich nur für Qualitätsprüfung und Fakten-Check und nimmt die Pflichtzeilen aus — sie
 * bleiben im finalen Content und in jedem Teil, der sie braucht, wörtlich.
 */
function datierungsHinweisPublisher(datierung: Datierung | null): string {
  const beleg = datierung?.beleg;
  if (!beleg || !beleg.ausnahme_greift) return "";
  return (
    ` Auch Qualitätsprüfung und Fakten-Check gehen mit zur Freigabe: Nenne darin keine Zahl von Jahren, die aus der ` +
    `${beleg.bezeichnung} ${beleg.ausnahme_jahr} gerechnet ist, und gib darin keine Regeltexte wörtlich wieder. ` +
    `Ausgenommen sind die Pflichtzeilen (Modellrechnung-Disclaimer, KI-Kennzeichnung, Impressum): Sie stehen ` +
    `im finalen Content und in jedem Teil, der sie braucht, weiter wörtlich.`
  );
}

/** Ergebnis einer Kurzlink-Prüfung für metadata.kurzlink; Befunde mit maskiertem Namen (sie zitieren den Text). */
function textPruefungBeleg(p: KurzlinkTextPruefung) {
  return {
    ok: p.ok,
    cta_treffer: p.cta_treffer,
    befunde: p.befunde.map(maskiereGeschuetzteNamen),
    am: new Date().toISOString(),
  };
}

// URTEIL im Content (Gegenprüfung 10.11.2026; Nachbesserung PR #9): Ein Content mit einer Zeile, die
// werteCounselAus als Urteil lesen könnte, geht nie an COUNSEL (enthaeltUrteil), und PUBLISHER bekommt
// das Review ohne solche Zeilen (ohneUrteilZeilen). Beide Regeln stehen in lib/counsel-urteil.ts, mit
// genau der Bereinigung von werteCounselAus; das eigene Muster URTEIL_IM_TEXT ist entfallen.

/** Markdown wie in lib/counsel-urteil.ts; vor der Datierungsprüfung entfernt, auch mitten im Wort ("Bau*jahr*"). */
const DATIERUNG_MARKDOWN = /[*_#`>]/g;
/**
 * Zwischen den Wörtern: bis zu 4 Zeichen ohne Buchstabe und Ziffer — Leerraum, Satzzeichen, Klammern,
 * Anführungszeichen, Pfeile, "~" und jede Art Gedankenstrich; der Unterstrich ist dann schon entfernt.
 */
const DATIERUNG_TRENNER = "[^\\p{L}\\p{N}]{0,4}";
/** Füllwörter vor dem Jahr; ein Buchstabe direkt dahinter macht ein anderes Wort daraus ("warum", "etwas"). */
const DATIERUNG_FUELLWOERTER = "um|ca|circa|zirka|etwa|ungefähr|rund|anno|ist|war";

/**
 * Textregel der Spezifikation §8.1 für Objekte mit greifender Datierungs-Ausnahme: Der Text nennt das
 * Jahr nie als Baujahr (etwa "Baujahr 1335", "Baujahr: 1335", "Baujahr (1335)"). Das Regelpaket kennt
 * die Regel nicht, deshalb prüft sie der Code (Gegenprüfung 10.11.2026).
 * Nachbesserung PR #9: Vorher rutschten "**Baujahr:** **1335**", "__Baujahr:__ 1335", "Baujahr: um 1335"
 * und "Baujahr – um 1335" durch (Muster Baujahr\W{0,4}1335 auf dem Rohtext; "_" ist dort Wortzeichen).
 * Jetzt wird erst Markdown entfernt. Dann zählen "Baujahr" (auch "Baujahres", "Baujahrs", "Baujahre")
 * und die Abkürzung "Bj" vor dem Jahr, dazwischen nur Trenner und Füllwörter ("um", "ca.", "circa",
 * "zirka", "etwa", "ungefähr", "rund", "anno", "ist", "war"). Andere Wörter dazwischen ("Baujahr
 * unbekannt, 1335 …", "Baujahr ist nicht 1335") sind kein Befund, ebenso andere Jahre ("Baujahr um 1750").
 * null, wenn nichts auffällt.
 */
function datierungsBefund(text: string, datierung: Datierung | null): string | null {
  const beleg = datierung?.beleg;
  if (!beleg || !beleg.ausnahme_greift) return null;
  const muster = new RegExp(
    `(?:Baujahr(?:es|s|e)?|(?<!\\p{L})Bj)${DATIERUNG_TRENNER}` +
      `(?:(?:${DATIERUNG_FUELLWOERTER})(?!\\p{L})${DATIERUNG_TRENNER})*${beleg.ausnahme_jahr}(?!\\d)`,
    "iu",
  );
  return muster.test(text.replace(DATIERUNG_MARKDOWN, ""))
    ? `Jahr ${beleg.ausnahme_jahr} als Baujahr bezeichnet statt „${beleg.bezeichnung} ${beleg.ausnahme_jahr}“ (Objekt-Ausnahme)`
    : null;
}

/**
 * Zwischen Zahl und „Jahre“: nur Leerraum, Bindestriche und Gedankenstriche U+2010 bis U+2014 („691 Jahre“,
 * „691-jährig“, „691–jährig“, „691—jährig“; Gegenprüfung PR #10: vorher nur U+2010/U+2011).
 */
const ALTER_TRENNER = "[\\s\\u2010-\\u2014-]*";

/**
 * Muster für ein Alter, das aus dem Jahr der Datierungs-Ausnahme abgeleitet ist (altersBefund, maskiereAlter):
 * eine Zahl N direkt vor „Jahre“/„Jahren“ (auch „N-jährig…“) mit N = aktuelles Jahr − Jahr der Ausnahme ± 1.
 * Gruppe 1 ist die Zahl. Angewandt auf den Text ohne Markdown (DATIERUNG_MARKDOWN). null ohne greifende Ausnahme.
 */
function altersMuster(datierung: Datierung | null): { muster: RegExp; beleg: DatierungsBeleg } | null {
  const beleg = datierung?.beleg;
  if (!beleg || !beleg.ausnahme_greift) return null;
  const alter = new Date().getFullYear() - beleg.ausnahme_jahr;
  // Eine Ziffer direkt hinter der Zahl ("6910 Jahre") scheitert ohne eigene Regel: Der Trenner nimmt keine
  // Ziffer auf, und danach muss „Jahre“ oder „jährig“ folgen.
  const muster = new RegExp(
    `(?<!\\p{N}[.,]?)(${alter - 1}|${alter}|${alter + 1})${ALTER_TRENNER}(?:Jahren?(?!\\p{L})|jährig)`,
    "giu",
  );
  return { muster, beleg };
}

/**
 * Abnahmelauf 10.11.2026: „Seit 1335 steht das RitterGut … 691 Jahre Bausubstanz“ kam durch Code-
 * und beide COUNSEL-Prüfungen. Für Objekte mit greifender Datierungs-Ausnahme erkennt der Code deshalb ein Alter,
 * das aus dem Jahr abgeleitet ist. Eng, denn ein Fehlalarm bricht einen bezahlten Lauf ab: eine Zahl N direkt
 * vor „Jahre“/„Jahren“ (auch „N-jährig…“) mit N = aktuelles Jahr − Jahr der Ausnahme ± 1 (Jahreswechsel,
 * „über 690 Jahre“). Keine Nähe-Heuristik für Bauwörter: „Ersterwähnung 1335. Das Gutshaus wurde um 1750
 * errichtet“ und „seit 1335 urkundlich belegt“ sind kein Befund, ebenso andere Zahlen („fast 700 Jahre“) und
 * „seit 1335 steht“ — das prüft nur COUNSEL (datierungsPruefpunkt). Markdown wird vorher entfernt wie bei
 * datierungsBefund. null, wenn nichts auffällt.
 */
function altersBefund(text: string, datierung: Datierung | null): string | null {
  const a = altersMuster(datierung);
  if (!a) return null;
  const treffer = a.muster.exec(text.replace(DATIERUNG_MARKDOWN, ""));
  const jahr = a.beleg.ausnahme_jahr;
  // Kurz gehalten: Der Vermerk fasst Leerraum zusammen und kürzt das Detail auf 160 Zeichen (bereinigeFehler,
  // lib/status-server.ts), und neben diesem Befund kann der Baujahr-Befund stehen.
  return treffer ? `Alter „${treffer[0]}“ aus ${jahr} abgeleitet (${jahr} ist nur die ${a.beleg.bezeichnung})` : null;
}

/** Ein Markdown-Zeichen wie DATIERUNG_MARKDOWN, ohne g (test() ohne lastIndex). */
const MARKDOWN_ZEICHEN = new RegExp(DATIERUNG_MARKDOWN.source);

/**
 * Gegenprüfung PR #10: Das Review der Vorprüfung geht an PUBLISHER, und dessen ganze Antwort ist die Endfassung.
 * Nennt COUNSEL ein abgeleitetes Alter („keine Ableitung wie 691 Jahre ✓“) und übernimmt PUBLISHER das, bricht
 * altersBefund den Lauf nach vier bezahlten Aufrufen ab. maskiereAlter ersetzt deshalb jede Zahl, die altersBefund
 * träfe, durch „N“ wie in der Datierungsregel. Gesucht wird wie dort im Text ohne Markdown; die Fundstellen werden
 * auf den Originaltext zurückgerechnet (wie maskiereGeschuetzteNamen). Die Formatierung außerhalb der Zahl bleibt
 * („**691** Jahre“ → „**N** Jahre“); Markdown zwischen den Ziffern entfällt mit der Zahl („6**9**1 Jahre“ →
 * „N Jahre“, „**69**1 Jahre“ → „**N Jahre“). Ohne greifende Ausnahme bleibt der Text unverändert.
 * Seit dem Nachtrag zur Gegenprüfung auch auf dem RESEARCHER-Text im SCRIBE-Auftrag.
 */
function maskiereAlter(text: string, datierung: Datierung | null): string {
  const a = altersMuster(datierung);
  if (!a) return text;
  const stelle: number[] = []; // Index im Originaltext je Zeichen des Textes ohne Markdown
  let ohne = "";
  for (let i = 0; i < text.length; i++) {
    if (MARKDOWN_ZEICHEN.test(text[i])) continue;
    stelle.push(i);
    ohne += text[i];
  }
  let aus = "";
  let pos = 0;
  for (const treffer of ohne.matchAll(a.muster)) {
    const start = treffer.index ?? 0;
    aus += `${text.slice(pos, stelle[start])}N`;
    pos = stelle[start + treffer[1].length - 1] + 1;
  }
  return aus + text.slice(pos);
}

type Dienst = ReturnType<typeof createServiceClient>;

interface LaufZeile {
  id: number;
  status: string;
}

type LaufLesung = { art: "ok"; zeilen: LaufZeile[] } | { art: "fehler"; meldung: string };

// Zeilen mit dieser Lauf-ID, nach id aufsteigend, höchstens `hoechstens` (R10). Eine
// unlesbare Zeile macht die ganze Lesung unbrauchbar (fail-closed).
async function zeilenZuLauf(supabase: Dienst, laufId: string, hoechstens: number): Promise<LaufLesung> {
  const { data, error } = await supabase
    .from("content")
    .select("id, status")
    .eq("metadata->>lauf_id", laufId)
    .order("id", { ascending: true })
    .limit(hoechstens);
  if (error) return { art: "fehler", meldung: fehlerText(error) };
  if (!Array.isArray(data)) return { art: "fehler", meldung: "Antwort ohne Zeilenliste" };
  const zeilen: LaufZeile[] = [];
  for (const zeile of data as unknown[]) {
    if (!istObjekt(zeile)) return { art: "fehler", meldung: "unerwartete Zeilenform" };
    const id = typeof zeile.id === "number" || typeof zeile.id === "string" ? Number(zeile.id) : Number.NaN;
    if (!Number.isSafeInteger(id) || id <= 0) return { art: "fehler", meldung: "Zeile ohne lesbare id" };
    zeilen.push({ id, status: typeof zeile.status === "string" ? zeile.status : "unbekannt" });
  }
  return { art: "ok", zeilen };
}

type MediumLesung = { art: "ok"; objekt_slug: string; fassung: string } | { art: "fehlt" } | { art: "fehler"; meldung: string };

/**
 * Paket C, Schritt 9: Objekt und Fassung des Mediums zu medium_id aus studio_medium, mit dem Service-Client und dem
 * Zeitlimit der Medien-Routen (ABFRAGE_TIMEOUT_MS). "fehlt", wenn es die Zeile nicht gibt; "fehler" bei Lesefehler,
 * Zeitüberschreitung oder unerwarteter Form (fail-closed: dann startet kein Lauf).
 */
async function leseMedium(supabase: Dienst, id: number): Promise<MediumLesung> {
  try {
    const { data, error } = await supabase
      .from("studio_medium")
      .select("id, objekt_slug, fassung")
      .eq("id", id)
      .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS))
      .maybeSingle();
    if (error) return { art: "fehler", meldung: fehlerText(error, ABFRAGE_TIMEOUT_MS) };
    if (data === null || data === undefined) return { art: "fehlt" };
    if (!istObjekt(data) || typeof data.objekt_slug !== "string" || typeof data.fassung !== "string") {
      return { art: "fehler", meldung: "unerwartete Zeilenform" };
    }
    return { art: "ok", objekt_slug: data.objekt_slug, fassung: data.fassung };
  } catch (err) {
    return { art: "fehler", meldung: fehlerText(err, ABFRAGE_TIMEOUT_MS) };
  }
}

// POST — Run full content pipeline for a topic (optional: an ein Steinadel-Objekt gebunden)
export async function POST(request: NextRequest) {
  let supabase: Dienst | null = null;
  let contentId: number | null = null;
  // Stufe 1 (05.11.2026): Schreibfehler der content-Zeile sammeln statt verschlucken.
  const speicherfehler: string[] = [];
  const warnungen: Vermerk[] = [];
  let basisMetadata: Record<string, unknown> = {};

  // Paket B (R2): steps[4] ist die COUNSEL-Endprüfung, AMPLIFIER rückt auf steps[5].
  const steps: PipelineStep[] = [
    { agent: "researcher", status: "pending" },
    { agent: "scribe", status: "pending" },
    { agent: "counsel", status: "pending" },
    { agent: "publisher", status: "pending" },
    { agent: STUFE_ENDPRUEFUNG, status: "pending" },
    { agent: "amplifier", status: "pending" },
  ];

  // Gesamtprüfung 06.11.2026: fremde Herkunft oder kein JSON → abgelehnt, vor jedem Abruf.
  const sperre = pruefeAnfrageHerkunft(request.headers);
  if (sperre) return fehlerAntwort(sperre.status, sperre.fehler);

  // Felder der content-Zeile schreiben; jeder Fehler landet bereinigt in console.error und
  // speicherfehler. true nur, wenn genau die eigene Zeile geschrieben wurde (Fixrunde
  // 06.11.2026: der Aufrufer bricht bei false ab, wo ein Weiterlaufen ein Gate umginge).
  // updated_at wird mitgeschrieben: scripts/setup_supabase_v2.sql:339-342 pflegt es per
  // Trigger, scripts/setup_supabase.sql:221-236 nicht; welche Fassung live gilt, ist nicht
  // gemessen. Ein vorhandener Trigger überschreibt den Wert.
  async function speichere(felder: Record<string, unknown>, anlass: string): Promise<boolean> {
    if (!supabase || contentId === null) return false;
    const { data, error } = await supabase
      .from("content")
      .update({ ...felder, updated_at: new Date().toISOString() })
      .eq("id", contentId)
      .select("id");
    let meldung: string | null = null;
    if (error) meldung = `${anlass}: ${fehlerText(error)}`;
    else if (!Array.isArray(data) || data.length !== 1) meldung = `${anlass}: Zeile ${contentId} nicht gefunden`;
    if (meldung === null) return true;
    console.error(`[content/pipeline] Speichern fehlgeschlagen (content ${contentId}) — ${meldung}`);
    speicherfehler.push(meldung);
    return false;
  }

  const letzterSpeicherfehler = (): string | undefined => speicherfehler[speicherfehler.length - 1];

  function metadataMit(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...basisMetadata, steps, warnungen, ...extra };
  }

  // Prüflauf 06.11.2026: Eine Fehlerantwort NACH dem Insert trägt die Schritte und die
  // Kostenzusammenfassung. Vorher fehlten sie (Ausnahme, Doppellauf-Prüfung): /content zeigte
  // dann alle Stufen wie "kein Lauf", obwohl Stufen gelaufen und bezahlt sein konnten.
  function fehlerNachInsert(status: number, text: string) {
    return fehlerAntwort(status, text, {
      pipeline: "content-first",
      contentId,
      status: "fehler",
      steps,
      summary: zusammenfassung(steps),
      speicherfehler,
    });
  }

  try {
    supabase = createServiceClient();

    let roh: unknown;
    try {
      roh = await request.json();
    } catch {
      return fehlerAntwort(400, "Anfrage ist kein gültiges JSON");
    }
    if (!istObjekt(roh)) {
      return fehlerAntwort(400, "Anfrage muss ein JSON-Objekt sein");
    }
    const body = roh as unknown as PipelineRequest;
    const { topic, platform, format, category, objekt_slug } = body;
    const laufId: unknown = roh.lauf_id;

    if (!platform || !format || (!topic && !objekt_slug)) {
      return fehlerAntwort(400, "platform, format und (topic oder objekt_slug) sind erforderlich");
    }
    if ((topic !== undefined && typeof topic !== "string") || (objekt_slug !== undefined && typeof objekt_slug !== "string")) {
      return fehlerAntwort(400, "topic und objekt_slug müssen Text sein");
    }
    // Gesamtprüfung 06.11.2026: nur bekannte Plattformen und deren Formate (vor jedem Aufruf).
    if (!istPlattform(platform)) {
      return fehlerAntwort(
        400,
        `Plattform "${eingabeText(platform)}" nicht unterstützt — erlaubt: ${Object.keys(FORMATE_JE_PLATTFORM).join(", ")}`
      );
    }
    if (typeof format !== "string" || !FORMATE_JE_PLATTFORM[platform].includes(format)) {
      return fehlerAntwort(
        400,
        `Format "${eingabeText(format)}" für ${platform} nicht unterstützt — erlaubt: ${FORMATE_JE_PLATTFORM[platform].join(", ")}`
      );
    }
    if (category !== undefined && !istKategorie(category)) {
      return fehlerAntwort(
        400,
        `Unbekannte Kategorie "${maskiereGeschuetzteNamen(String(category))}" — erlaubt: ${Object.keys(KATEGORIE_LABEL).join(", ")}`
      );
    }
    // R10: Lauf-ID ist optional; wenn gesetzt, dann nach Vertrag, sonst 400.
    if (laufId !== undefined && (typeof laufId !== "string" || !LAUF_ID_MUSTER.test(laufId))) {
      return fehlerAntwort(400, "lauf_id ungültig (8 bis 80 Zeichen: Buchstaben, Ziffern, Doppelpunkt, _ oder -)");
    }
    // Paket C, Schritt 9: medium_id ist optional; wenn gesetzt, eine positive ganze Zahl und nur mit Objekt.
    const mediumRoh: unknown = roh.medium_id;
    if (mediumRoh !== undefined && !istMediumId(mediumRoh)) {
      return fehlerAntwort(400, "medium_id ungültig (positive ganze Zahl)");
    }
    const mediumId: number | null = istMediumId(mediumRoh) ? mediumRoh : null;
    if (mediumId !== null && !objekt_slug) {
      return fehlerAntwort(400, "medium_id nur mit objekt_slug: Die Caption gehört zum Video eines Objekts");
    }
    if (laufId !== undefined) {
      const vorher = await zeilenZuLauf(supabase, laufId, 1);
      if (vorher.art === "fehler") {
        return fehlerAntwort(500, `Lauf-ID nicht prüfbar: ${vorher.meldung} — Lauf nicht gestartet`);
      }
      const erste = vorher.zeilen[0];
      if (erste) {
        return fehlerAntwort(
          409,
          `Lauf-ID schon vergeben (#${erste.id}, Status ${erste.status}) — kein neuer Lauf gestartet`,
          { content_id: erste.id, status: erste.status }
        );
      }
    }

    // ═══ Paket C, Schritt 9: Medium der Caption (falls medium_id gesetzt) — vor dem Insert, kein bezahlter Aufruf ═══
    if (mediumId !== null) {
      const medium = await leseMedium(supabase, mediumId);
      if (medium.art === "fehler") {
        return fehlerAntwort(502, `Medium ${mediumId} nicht lesbar: ${medium.meldung} — Lauf nicht gestartet`);
      }
      if (medium.art === "fehlt") {
        return fehlerAntwort(404, `Medium ${mediumId} nicht gefunden — Lauf nicht gestartet`);
      }
      if (medium.objekt_slug !== objekt_slug) {
        return fehlerAntwort(400, `Medium ${mediumId} gehört nicht zum Objekt dieses Laufs — Lauf nicht gestartet`);
      }
      if (medium.fassung !== "export") {
        return fehlerAntwort(
          400,
          `Medium ${mediumId} ist keine Export-Fassung (Fassung "${eingabeText(medium.fassung)}") — eine Caption gehört zum Export eines Videos`
        );
      }
    }

    const cookie = request.headers.get("cookie") ?? "";

    // ═══ Objektdaten laden (falls objekt_slug gesetzt) ═══
    let objekt: ObjektApi | null = null;
    let objektSnapshot: ObjektSnapshot | null = null;
    let datierung: Datierung | null = null;
    if (objekt_slug) {
      const abruf = await fetchObjekt(objekt_slug, cookie);
      if (abruf.art === "export_fehler") {
        return fehlerAntwort(502, `Steinadel-Export nicht lesbar: ${abruf.meldung}`);
      }
      if (abruf.art === "nicht_gefunden") {
        return fehlerAntwort(
          404,
          `Objekt "${maskiereGeschuetzteNamen(objekt_slug)}" nicht in der Steinadel-Export-API gefunden`
        );
      }
      // R21: vor Snapshot, Prompt und Insert.
      if (abruf.art === "unvollstaendig") {
        return fehlerAntwort(502, `Export-Objekt unvollständig: ${abruf.feld}`);
      }
      objekt = abruf.objekt;
      // Paket B: Datierungszeile (Ersterwähnung statt Baujahr) — im Snapshot belegt, damit der Beleg
      // zeigt, wie die Zeile im Prompt hieß.
      datierung = datierungFuer(abruf.objekt);
      if (datierung.warnung) warnungen.push(vermerk("objekt", datierung.warnung));
      objektSnapshot = baueSnapshot(abruf.objekt, abruf.kopf, abruf.abgerufen_am, datierung.beleg);
    }

    const thema = objekt ? objekt.name : (topic as string);

    // LinkedIn = Qualitätskanal laut Steinadel-Funnel-Plan (P2/P4): Fachton,
    // belegte Marktdaten mit Quelle, keine Reel-Ästhetik.
    const platformLabel: Record<string, string> = { youtube: "YouTube-Video", twitter: "X/Twitter-Thread", x: "X/Twitter-Thread", newsletter: "Newsletter-Ausgabe", tiktok: "TikTok-Video", instagram: "Instagram-Post", linkedin: "LinkedIn-Post (Fachton, keine Reel-Ästhetik)" };
    const formatLabel: Record<string, string> = { longform: "Longform (8-12 Min)", short: "Short (60 Sek)", thread: "Thread (5-8 Posts)", deep_dive: "Deep Dive (15+ Min)", linkedin_post: "Fachbeitrag, 1.200-2.000 Zeichen", newsletter_issue: "Newsletter-Ausgabe", tiktok_short: "TikTok Short (30-60 Sek)", reel: "Reel (30-90 Sek)", carousel: "Carousel (5-10 Slides)", story: "Story (15 Sek Clips)" };
    const categoryKey: Kategorie = category ?? "ghost_protocol";
    // R24: Objekt-Läufe ohne Projektnamen in der Kategorie (KATEGORIE_LABEL_OBJEKT).
    const kategorieLabel = (objekt ? KATEGORIE_LABEL_OBJEKT : KATEGORIE_LABEL)[categoryKey];

    // Belege, die ab dem ersten Schreiben in jeder Fassung der Zeile stehen (Stufe 1).
    // lauf_id nur, wenn mitgeschickt (auto-produce schickt keine; dessen Zeilen bleiben gleich).
    basisMetadata = {
      thema,
      objekt_slug: objekt_slug ?? null,
      // Paket C, Schritt 9: nur bei einer Caption zu einem Video (sonst fehlt das Feld, wie bisher).
      ...(mediumId !== null ? { medium_id: mediumId } : {}),
      ...(laufId !== undefined ? { lauf_id: laufId } : {}),
      ...(objektSnapshot ? { objekt_snapshot: objektSnapshot } : {}),
      regelpaket: REGELPAKET,
      // Gegenprüfung PR #10 (B3): welche Prüfanweisungen COUNSEL im Auftrag bekam (pruefauftragBeleg).
      pruefauftrag: pruefauftragBeleg(datierung),
      researcher_quellen: RESEARCHER_QUELLEN_HINWEIS,
    };

    // ═══ Content-Zeile anlegen (Persistenz ab Start des Laufs) ═══
    const { data: inserted, error: insertErr } = await supabase
      .from("content")
      .insert({
        title: thema,
        content_type: format,
        status: "entwurf",
        platform,
        language: "de",
        created_by: "scribe",
        metadata: basisMetadata,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return fehlerAntwort(
        500,
        `Content-Eintrag konnte nicht angelegt werden: ${insertErr ? fehlerText(insertErr) : "keine Zeile zurück"}`
      );
    }
    const neueId = Number(inserted.id);
    if (!Number.isSafeInteger(neueId) || neueId <= 0) {
      return fehlerAntwort(500, "Content-Eintrag ohne lesbare id angelegt — Lauf nicht gestartet");
    }
    contentId = neueId;

    // ═══ R10: Doppellauf-Prüfung direkt nach dem Insert, vor dem ersten bezahlten Aufruf ═══
    // Zwei gleichzeitige Anfragen mit derselben Lauf-ID bestehen beide die Prüfung oben und
    // legen beide eine Zeile an. Weiter läuft nur, wer die eigene Zeile als EINZIGE mit dieser
    // Lauf-ID sieht (zwei Zeilen genügen dafür). Das hält unabhängig von der Reihenfolge, in
    // der die Zeilen sichtbar werden: Liefen A und B, hätte keine die andere gesehen, also
    // Commit B nach Lesung A und Commit A nach Lesung B; mit Commit vor eigener Lesung ergäbe
    // das den Kreis Commit B > Lesung A > Commit A > Lesung B > Commit B. Das setzt voraus, dass
    // PostgREST einen Insert erst nach dem Commit bestätigt (Annahme, nicht gemessen). Sehen
    // sich beide, brechen beide ohne bezahlten Aufruf ab (fail-closed).
    if (laufId !== undefined) {
      const nachher = await zeilenZuLauf(supabase, laufId, 2);
      const fremd = nachher.art === "ok" ? nachher.zeilen.find((z) => z.id !== contentId) : undefined;
      if (fremd) {
        const grund = `Doppellauf: Lauf-ID schon vergeben (#${fremd.id})`;
        await speichere({ status: "fehler", metadata: metadataMit({ fehler: vermerk("pipeline", grund) }) }, "Status fehler (Doppellauf)");
        return fehlerAntwort(409, `${grund} — kein zweiter Lauf gestartet`, {
          content_id: fremd.id,
          status: fremd.status,
          verworfen_content_id: contentId,
          speicherfehler,
        });
      }
      if (nachher.art === "fehler" || !nachher.zeilen.some((z) => z.id === contentId)) {
        // Fail-closed: ohne Gewissheit, der einzige Lauf zu sein, kein bezahlter Aufruf.
        const detail = nachher.art === "fehler" ? nachher.meldung : "eigene Zeile nicht gefunden";
        await speichere(
          { status: "fehler", metadata: metadataMit({ fehler: vermerk("pipeline", "Doppellauf-Prüfung fehlgeschlagen", detail) }) },
          "Status fehler (Doppellauf-Prüfung)"
        );
        return fehlerNachInsert(500, `Doppellauf-Prüfung fehlgeschlagen: ${detail} — Lauf nicht gestartet`);
      }
    }

    // ═══ CTA-Kurzlink (Paket B, Schritt 4, E12; nur bei Objekt + vorhandener Kampagne) ═══
    // Kampagne bleibt die erste des Objekts (beim RitterGut afa-rechner-p1), Präfix aus der Plattform
    // (twitter → x), Content <präfix>-<slug>-<id> (lib/steinadel-kurzlink.ts). Lässt sich der Kurzlink
    // nicht bauen oder nicht prüfen, gibt es keinen CTA-Link (Warnung) — kein Rückfall auf den Direktlink.
    let utmContent: string | null = null;
    let ctaLink: string | null = null;
    let kampagneSlug: string | null = null;
    let kurzlink: Kurzlink | null = null;
    if (objekt && objekt.kampagnen.length > 0) {
      const kampagne = objekt.kampagnen[0];
      kampagneSlug = kampagne.kampagne;
      const bau = baueKurzlink({ plattform: platform, kampagne: kampagne.kampagne, lpUrl: kampagne.lpUrl, slug: objekt.slug, id: contentId });
      if (bau.ok) {
        kurzlink = bau.pruefung;
        ctaLink = bau.pruefung.link;
        utmContent = bau.pruefung.content;
      } else {
        warnungen.push(vermerk("objekt", "Kurzlink nicht baubar — kein CTA-Link", bau.grund));
      }
    }
    // Gesamtprüfung 06.11.2026: Ein CTA-Link mit geschütztem Namen geht weder in den
    // SCRIBE-Auftrag (dort "EXAKT diesen Link") noch in metadata.cta_link (Kopieren-Knopf).
    // Paket B: dann auch kein Kurzlink-Beleg und kein utm_content (beide tragen den Namen).
    if (ctaLink !== null && enthaeltGeschuetztenNamen(ctaLink)) {
      ctaLink = null;
      utmContent = null;
      kurzlink = null;
      warnungen.push(vermerk("objekt", "CTA-Link enthält einen geschützten Namen — nicht verwendet und nicht gespeichert"));
    }
    basisMetadata = {
      ...basisMetadata,
      utm_content: utmContent,
      kampagne: kampagneSlug,
      cta_link: ctaLink,
      ...(kurzlink
        ? {
            kurzlink: {
              link: kurzlink.link,
              ziel_url: kurzlink.ziel.url,
              utm_source: kurzlink.ziel.utm_source,
              utm_medium: kurzlink.ziel.utm_medium,
              utm_campaign: kurzlink.ziel.utm_campaign,
              utm_content: kurzlink.ziel.utm_content,
              regel: KURZLINK_REGEL,
            },
          }
        : {}),
    };

    // Objektblock erst jetzt: Er nennt den Kurzlink als CTA (oder den allgemeinen CTA ohne Link).
    const objektBlock = objekt && datierung ? buildObjektBlock(objekt, datierung, kurzlink !== null) : null;
    const cta = kurzlink ? `\n\n${ctaBlock(kurzlink)}` : "";

    /**
     * Deterministische Textprüfung vor dem nächsten bezahlten Aufruf (SCRIBE-Text vor COUNSEL,
     * Endfassung vor der Endprüfung): Kurzlinks (E12-Ersatzweg; Ergebnis belegt unter
     * metadata.kurzlink[feld], nur mit Kurzlink), keine URTEIL-Zeile, Datierungs-Ausnahme (§8.1).
     * Liefert Grund und Befunde, oder null, wenn der Text besteht.
     */
    const pruefeText = (text: string, feld: "pruefung_scribe" | "pruefung_endfassung"): { grund: string; befunde: string[] } | null => {
      const befunde: string[] = [];
      let grund = TEXTREGEL_GRUND;
      if (kurzlink) {
        const pruefung: KurzlinkTextPruefung = pruefeKurzlinksImText(text, kurzlink.link);
        const bisher = istObjekt(basisMetadata.kurzlink) ? basisMetadata.kurzlink : {};
        basisMetadata = { ...basisMetadata, kurzlink: { ...bisher, [feld]: textPruefungBeleg(pruefung) } };
        if (!pruefung.ok) {
          grund = KURZLINK_GRUND;
          befunde.push(...pruefung.befunde);
        }
      }
      if (enthaeltUrteil(text)) befunde.push("URTEIL-Zeile im Content (ein COUNSEL-Urteil gehört nicht in den Text)");
      const datierungFalsch = datierungsBefund(text, datierung);
      if (datierungFalsch) befunde.push(datierungFalsch);
      const alterFalsch = altersBefund(text, datierung);
      if (alterFalsch) befunde.push(alterFalsch);
      return befunde.length > 0 ? { grund, befunde } : null;
    };

    // Abbruch mit status "fehler": Vermerk speichern und einheitlich antworten. Liegt schon
    // ein COUNSEL-Urteil vor (basisMetadata.counsel), bleibt es in metadata und Antwort.
    const brichAb = async (fehler: Vermerk, extraFelder: Record<string, unknown> = {}) => {
      await speichere(
        { status: "fehler", ...extraFelder, metadata: metadataMit({ fehler }) },
        `Status fehler (${fehler.stufe})`
      );
      return NextResponse.json({
        pipeline: "content-first",
        contentId,
        thema,
        platform,
        format,
        status: "fehler",
        fehler,
        ...(basisMetadata.counsel ? { counsel: basisMetadata.counsel } : {}),
        warnungen,
        steps,
        summary: zusammenfassung(steps),
        speicherfehler,
      });
    };

    // ═══ STEP 1: RESEARCHER — Recherche & Fakten ═══
    await fuehreStufeAus(
      steps[0],
      `RESEARCH-AUFTRAG: Recherchiere das Thema "${thema}" für ein ${platformLabel[platform]} im Format ${formatLabel[format]}, Kategorie: ${kategorieLabel}.

Liefere:
1. 5 Kernfakten mit Quellen (Studien, Statistiken, Experten-Zitate)
2. 3 kontroverse oder überraschende Perspektiven (Hook-Material)
3. Aktuelle Entwicklungen der letzten 30 Tage
4. 3 konkrete Beispiele oder Case Studies
5. SEO-Keywords (5 Stück) für ${platform}

Format: Strukturierte Bullet-Points, deutsch. Keine Floskeln, nur Fakten.${objektBlock ? `\n\n${objektBlock}` : ""}`,
      cookie,
      false,
      warnungen
    );
    if (steps[0].status !== "done") {
      return brichAb(vermerk("researcher", steps[0].fehler ?? "unbekannter Fehler"));
    }

    // ═══ STEP 2: SCRIBE — Content schreiben ═══
    const platformInstructions: Record<string, string> = {
      youtube: `Schreibe ein YouTube-Skript (${formatLabel[format]}):
- Hook (erste 5 Sekunden, pattern interrupt)
- Intro (Problem + Versprechen, 30 Sek)
- 3-5 Hauptpunkte mit Übergängen
- CTA (Subscribe, Kommentar-Frage)
- Outro mit Teaser für nächstes Video
- [B-ROLL] und [GRAFIK] Markierungen für Schnitt
- Thumbnail-Titel-Vorschlag (max 60 Zeichen, neugierig machend)`,
      twitter: `Schreibe einen X/Twitter-Thread (${formatLabel[format]}):
- Tweet 1: Hook mit Zahl oder provokanter These (max 280 Zeichen)
- Tweet 2-6: Hauptpunkte, jeder Tweet eigenständig lesbar
- Vorletzter Tweet: Zusammenfassung + Key Takeaway
- Letzter Tweet: CTA (Follow + Retweet-Bitte)
- Jeder Tweet: Max 280 Zeichen, Emoji sparsam (max 1 pro Tweet)
- Verwende Thread-Nummering: 1/ 2/ 3/ etc.`,
      x: `Schreibe einen X-Thread im Steinadel-Ton (premium, editorial, ruhig, max 1 Emoji):
- 6-7 Tweets, je maximal 270 Zeichen
- Nummerierung im Stil "1/7", "2/7", ...
- Tweet 1: Hook (Zahl, Frage oder These aus den Objektdaten — NICHT erfunden)
- Tweet 2-5/6: Hauptpunkte zum Objekt, jeder Tweet eigenständig lesbar
- Falls AfA/Steuerzahlen erwähnt werden: Modellrechnung-Disclaimer-Satz PFLICHT
  ("Modellrechnung — individuelle steuerliche Wirkung abhängig von persönlicher
  Situation und Behördenbescheinigung; keine Steuerberatung.")
- Letzter Tweet: CTA mit EXAKT diesem Link${ctaLink ? `: ${ctaLink}` : " (kein Kampagnen-Link hinterlegt — allgemeiner CTA)"}
- Keine Superlativ-Ketten, keine Caps-Lock-Dringlichkeit`,
      // Paket B (10.11.2026, R39/E11): LinkedIn als Qualitätskanal — Regelpaket §4 (Fachton, belegte
      // Marktdaten mit Quelle, keine Reel-Ästhetik) und Steinadel-Starterpaket. Die Pflichtzeilen
      // (Disclaimer, KI-Kennzeichnung, Impressum) stehen bei Objekt-Läufen im Objektblock.
      linkedin: `Schreibe einen LinkedIn-Post (${formatLabel[format]})${
        objekt ? " im Steinadel-Ton (Qualitätskanal: Fachton, premium, editorial, ruhig)" : " (Fachton, sachlich)"
      }:
- Zeile 1-2: Hook mit einer belegten Zahl oder einer sachlichen These${objekt ? " aus den Objektdaten — NICHT erfunden" : ""} (sichtbar vor "…mehr anzeigen")
- 3-5 kurze Absätze mit je 1-3 Sätzen, keine Reel-Ästhetik, keine Superlativ-Ketten, höchstens 1 Emoji
- ${objekt ? "Zahlen NUR aus den Objektdaten (siehe REGEL); keine Marktdaten aus dem Gedächtnis" : "Marktdaten nur mit Quelle (z. B. Destatis), sonst weglassen"}
- Schluss: CTA${ctaLink ? ` mit EXAKT diesem Link: ${ctaLink}` : objekt ? " ohne Link (kein Kampagnen-Link hinterlegt)" : ""}
- Höchstens 3 fachliche Hashtags am Ende, kein Hashtag-Block
- Länge: 1.200 bis 2.000 Zeichen`,
      newsletter: `Schreibe eine Newsletter-Ausgabe (${formatLabel[format]}):
- Betreffzeile (max 50 Zeichen, Öffnungsrate-optimiert)
- Preview-Text (max 90 Zeichen)
- Begrüßung (persönlich, kurz)
- 1 Hauptthema (3-4 Absätze, storytelling)
- 3 Quick-Links/News (je 2 Sätze)
- 1 Tool/Ressource der Woche
- CTA (Antworten, Weiterleiten, Upgrade)
- P.S. mit persönlicher Note`,
      tiktok: `Schreibe ein TikTok-Skript (${formatLabel[format]}):
- Hook (erste 1-2 Sekunden, provokant oder überraschend — "Das hat mir niemand gesagt über...")
- Problem/Trigger (3-5 Sek, relateable Pain Point)
- 3 Quick-Punkte (je 5-8 Sek, schnell geschnitten)
- Twist/Überraschung (unerwartete Perspektive)
- CTA (Follow + Kommentar-Frage, "Speichern wenn hilfreich")
- [TEXTOVERLAY] Markierungen für On-Screen-Text
- [TRANSITION] Markierungen für Schnitt-Effekte
- Trending Sounds Vorschlag (Kategorie: educational/tech)
- Hashtags: 3-5 Stück (#KI #Automation #TechTok #LernenMitTikTok)
- Max 60 Sekunden Gesamtlänge, schnelles Pacing
- Tonalität: Energisch, direkt, Gen-Z-kompatibel aber nicht cringe`,
      instagram: `Schreibe einen Instagram-Post (${formatLabel[format]}):
${format === "carousel" ? `CAROUSEL (5-10 Slides):
- Slide 1: Hook-Titel (max 8 Wörter, groß, bold — macht neugierig)
- Slide 2: Problem/Kontext (1 Satz + Icon/Grafik-Anweisung)
- Slide 3-8: Hauptpunkte (1 Punkt pro Slide, kurz, visuell)
- Slide 9: Zusammenfassung/Key Takeaway
- Slide 10: CTA ("Speichern ❤️ Teilen" + Profil-Verweis)
- Jede Slide: [DESIGN] Anweisung für Farben/Layout
- Design-Stil: Clean, modern, 2-3 Farben, große Schrift` :
format === "reel" ? `REEL (30-90 Sek):
- Hook (erste 1-3 Sek, visueller Pattern-Interrupt)
- 3-5 Punkte mit [B-ROLL] oder [SCREEN-RECORDING] Markierungen
- Text-Overlays für jeden Punkt (max 10 Wörter)
- Trending Audio Vorschlag
- CTA im letzten Frame ("Folgen für mehr")
- Caption: 2-3 Sätze + Hashtags (max 30)` :
`STORY-SERIE (3-5 Stories à 15 Sek):
- Story 1: Hook/Frage (Poll oder Quiz Sticker)
- Story 2-4: Hauptcontent (kurze Text-Slides oder Quick-Video)
- Story 5: CTA (Link-Sticker, "DM für mehr")
- Jede Story: [STICKER] Anweisungen (Poll, Quiz, Emoji Slider)`}
- Caption: Storytelling-Einstieg (2-3 Sätze) + Micro-CTA + Hashtags (20-30)
- Tonalität: Professionell-inspirierend, visual-first`,
    };

    // Gegenprüfung des Nachtrags (NP-2): Der RESEARCHER-Text geht mit maskierten abgeleiteten Altern an SCRIBE
    // (maskiereAlter, wie das Review an PUBLISHER). Übernahm SCRIBE ein „691 Jahre“ daraus, auch verneint oder in
    // einer Notiz, brach altersBefund den Lauf nach zwei bezahlten Aufrufen ab. Der Beleg (steps[0].output) bleibt
    // ungekürzt.
    // Paket C, Schritt 9: Bei einer Caption zu einem Video (medium_id) steht die Auftragsart mit der Pflichtzeile
    // direkt unter Plattform und Kategorie (CAPTION_AUFTRAG); sonst ist der Auftrag unverändert.
    await fuehreStufeAus(
      steps[1],
      `CONTENT-PRODUKTION: Schreibe Content zum Thema "${thema}".

PLATTFORM: ${platformLabel[platform]}
KATEGORIE: ${kategorieLabel}${mediumId !== null ? `\n\n${CAPTION_AUFTRAG}` : ""}

RECHERCHE-ERGEBNISSE (von RESEARCHER):
${maskiereAlter(steps[0].output ?? "", datierung)}

ANWEISUNGEN:
${platformInstructions[platform] ?? platformInstructions.twitter}

STILREGELN:
- Tonalität: ${objekt ? "Steinadel — premium, editorial, ruhig" : "Professionell aber zugänglich, keine Corporate-Sprache"}
- Zielgruppe: ${objekt ? "Vermögende Kapitalanleger, Spitzensteuersatz, DACH-Raum" : "Tech-affine Professionals, 25-45 Jahre, DACH-Raum"}
- Sprache: Deutsch, Anglizismen erlaubt bei Fachbegriffen
- ${objekt ? "Interne System-, Projekt- und Agentennamen NICHT erwähnen" : "Ghost Protocol NICHT erwähnen"} (Agenten sind unsichtbar)
${objekt ? "" : `- Brandname für extern: "AI Insider" (Arbeitstitel)`}

Liefere den fertigen Content, sofort publishbar.${objektBlock ? `\n\n${objektBlock}` : ""}${cta}`,
      cookie,
      true,
      warnungen
    );
    // Technischer Fehler oder abgeschnittener Text in SCRIBE → Abbruch, kein COUNSEL
    if (steps[1].status !== "done") {
      return brichAb(vermerk("scribe", steps[1].fehler ?? "unbekannter Fehler"));
    }

    // Paket B: SCRIBE-Text deterministisch prüfen (Kurzlink E12, URTEIL-Zeile, Datierung), vor dem
    // bezahlten COUNSEL-Aufruf. Jeder Befund beendet den Lauf.
    const textScribe = pruefeText(steps[1].output ?? "", "pruefung_scribe");
    if (textScribe) {
      steps[1].status = "error";
      steps[1].fehler = textScribe.grund;
      return brichAb(textregelVermerk("scribe", textScribe.grund, textScribe.befunde));
    }

    // ═══ STEP 3: COUNSEL — Pflicht-Review, fail-closed ═══
    await fuehreStufeAus(
      steps[2],
      `${VORPRUEFUNG_KOPF}${datierungsPruefpunkt(datierung)}

CONTENT:
${steps[1].output}

${objektBlock ?? "OBJEKTDATEN: keine (Freitext-Content ohne Steinadel-Objektbezug)"}${kurzlink ? `\n\n${kurzlinkBlock(kurzlink)}` : ""}

${URTEIL_SCHLUSS}`,
      cookie,
      true,
      warnungen
    );

    // Technischer Fehler ist KEINE fachliche Ablehnung — 'fehler' statt 'abgelehnt',
    // damit die Freigabe-Ansicht nicht faelschlich "COUNSEL lehnt ab" anzeigt.
    if (steps[2].status !== "done") {
      // Abgeschnittener Text ist COUNSELs echte (unvollständige) Antwort und wird als
      // review_notes gespeichert; eine HTTP-Fehlermeldung gehört nicht dorthin (Stufe 1).
      const teilReview = steps[2].output;
      return brichAb(
        vermerk("counsel", steps[2].fehler ?? "unbekannter Fehler"),
        teilReview ? { reviewed_by: "counsel", review_notes: teilReview } : {}
      );
    }

    const counselOutput = steps[2].output ?? "";
    // Fail-closed (Stufe 1, 05.11.2026): NUR FREIGABE laesst die Pipeline weiter;
    // ABLEHNUNG und UNKLAR stoppen sie. Regeln in lib/counsel-urteil.ts.
    const auswertung = werteCounselAus(counselOutput);
    const counsel = {
      urteil: auswertung.urteil,
      // Anzeige-Feld: URTEIL-Zeile mit maskiertem geschütztem Namen (R24). Der volle Text
      // bleibt unverändert als review_notes gespeichert (Beleg).
      zeile: auswertung.zeile === null ? null : maskiereGeschuetzteNamen(auswertung.zeile),
      grund: auswertung.grund,
      geprueft: "SCRIBE-Text (steps[1])",
      am: new Date().toISOString(),
    };
    const rejected = auswertung.urteil !== "FREIGABE";
    // Ab hier steht das Urteil in jeder Fassung der Zeile, auch wenn ein späterer Schritt
    // abbricht (vorher überschrieb brichAb metadata ohne counsel).
    basisMetadata = { ...basisMetadata, counsel };

    // COUNSEL-Ergebnis immer persistieren (auch bei Ablehnung) — inkl. steps,
    // sonst zeigt die Freigabe-Ansicht abgelehnte Laeufe ohne Kontext.
    const counselGespeichert = await speichere(
      {
        reviewed_by: "counsel",
        review_notes: counselOutput,
        status: rejected ? "abgelehnt" : "counsel_geprueft",
        metadata: metadataMit(),
      },
      rejected ? "Status abgelehnt" : "Status counsel_geprueft"
    );

    // R6: Ohne gespeichertes COUNSEL-Ergebnis endet der Lauf mit status "fehler". Der Abbruch
    // versucht, Review und Urteil (metadata.counsel) doch noch zu speichern; die Antwort trägt
    // das Urteil weiter. Bei FREIGABE laufen PUBLISHER und AMPLIFIER nicht (sonst entstünde eine
    // Zeile ohne review_notes); bei ABLEHNUNG/UNKLAR bliebe die Zeile sonst als "entwurf" ohne
    // Review hängen, und das Urteil stünde nur in der Antwort (Nachbesserung).
    if (!counselGespeichert) {
      return brichAb(
        vermerk(
          "pipeline",
          rejected ? "COUNSEL-Ergebnis nicht gespeichert" : "COUNSEL-Ergebnis nicht gespeichert — PUBLISHER nicht gestartet",
          letzterSpeicherfehler()
        ),
        { reviewed_by: "counsel", review_notes: counselOutput }
      );
    }

    if (rejected) {
      return NextResponse.json({
        pipeline: "content-first",
        contentId,
        thema,
        platform,
        format,
        status: "abgelehnt",
        counsel,
        warnungen,
        steps,
        summary: zusammenfassung(steps),
        speicherfehler,
      });
    }

    // ═══ STEP 4: PUBLISHER — Formatierung & Scheduling ═══
    // Das Review der Vorprüfung geht aufbereitet an PUBLISHER: ohne Zeilen, die ein Urteil tragen
    // (lib/counsel-urteil.ts), Kampagnenseiten /l/… maskiert (Nachbesserung PR #9: sonst übernimmt
    // PUBLISHER die aufgelöste Ziel-URL aus dem Review, lib/steinadel-kurzlink.ts), geschützter Name
    // maskiert, abgeleitete Alter maskiert (Gegenprüfung PR #10, maskiereAlter).
    // maskiereAlter läuft zuletzt (Gegenprüfung des Nachtrags, B1): Steht „691 Jahre“ ohne Trenner vor dem
    // geschützten Namen, verhindert dessen erster Buchstabe den Treffer ((?!\p{L}) in altersMuster); erst der
    // Platzhalter „[…]“ der Namensmaske macht daraus ein Alter, das altersBefund trifft. Die Platzhalter
    // beider Masken enthalten keine Ziffer, maskiereAlter ändert sie also nicht.
    // Die Namensmaske läuft vor der Kampagnenmaske (Gegenprüfung PR #13, X01): Steht der geschützte Name ohne Trenner
    // direkt vor „steinadel.de/l/…“, verhindert sein letzter Buchstabe den Treffer (Lookbehind in STEINADEL_ADRESSE,
    // lib/steinadel-kurzlink.ts), und die Kampagnenseite blieb unmaskiert; erst der Platzhalter „[…]“ gibt sie frei.
    await fuehreStufeAus(
      steps[3],
      `PUBLISHING-AUFTRAG: Bereite diesen Content für die Veröffentlichung vor.

PLATTFORM: ${platform}
FORMAT: ${format}

CONTENT (von SCRIBE, COUNSEL-geprüft):
${steps[1].output}

COUNSEL-REVIEW:
${maskiereAlter(maskiereKampagnenseiten(maskiereGeschuetzteNamen(ohneUrteilZeilen(counselOutput))), datierung)}

AUFGABEN:
1. Qualitätsprüfung: Fakten-Check, Ton, Länge
2. SEO-Optimierung: Title Tags, Description, Hashtags
3. Scheduling-Empfehlung: Bester Zeitpunkt für ${platform} (DACH-Zielgruppe)
4. Thumbnail/Preview: Beschreibung für visuelles Asset
5. Cross-Promotion: Wie kann dieser Content auf den anderen Plattformen angeteasert werden?

Liefere:
- Finaler Content (mit deinen Korrekturen)${mediumId !== null ? `; als letzte Zeile des finalen Contents diese Pflichtzeile wörtlich, als eigene Zeile, ohne Formatierung:\n  ${KI_PFLICHTZEILE_CAPTION}` : ""}
- Metadaten (Title, Description, Tags, Hashtags)
- Publishing-Zeitpunkt (Tag + Uhrzeit, DACH-optimiert)
- Cross-Promotion-Posts (1 Tweet, 1 Newsletter-Teaser)${kurzlink ? " — ohne Link, mit Verweis auf den Hauptpost" : ""}

ENDFASSUNG (R2): Deine gesamte Antwort geht wörtlich an COUNSEL und danach unverändert zur
Freigabe. Übernimm Pflichtzeilen (Modellrechnung-Disclaimer, KI-Kennzeichnung, Impressum)
unverändert, ergänze keine neuen Zahlen, Handles, Siegel oder Erfolgsbehauptungen, und nenne
Zeitpunkte nur als Empfehlung. Jeder Teil erfüllt die Pflicht-Elemente für sich, auch
Cross-Promotion-Posts und Teaser: Wer AfA, Steuer oder Abschreibung erwähnt, trägt den
Modellrechnung-Disclaimer wörtlich.${datierungsHinweisPublisher(datierung)}${objektBlock ? `\n\n${objektBlock}` : ""}${cta}`,
      cookie,
      true,
      warnungen
    );
    if (steps[3].status !== "done") {
      return brichAb(vermerk("publisher", steps[3].fehler ?? "unbekannter Fehler"));
    }

    // Vor "zur_freigabe" (Stufe 1, 05.11.2026): Ein leerer oder fast leerer Text darf nicht
    // in den Freigabe-Stapel. Geprüft direkt nach PUBLISHER, damit AMPLIFIER nicht auf
    // einem leeren Text läuft.
    let freigabeText = steps[3].output ?? "";
    const freigabeZeichen = freigabeText.trim().length;
    if (freigabeZeichen < MIN_FREIGABE_ZEICHEN) {
      steps[3].status = "error";
      steps[3].fehler = "Text zur Freigabe leer";
      return brichAb(
        vermerk(
          "publisher",
          "Text zur Freigabe leer",
          `${freigabeZeichen} Zeichen nach Trimmen (Mindestlänge ${MIN_FREIGABE_ZEICHEN})`
        )
      );
    }

    // Paket C, Schritt 9: Caption zu einem Video — fehlt die Pflichtzeile, ergänzt die Pipeline sie im PUBLISHER-Text
    // selbst (steps[3].output) als letzte Zeile (pflichtzeileEinsetzen). Erst nach der Mindestlänge, denn die Zeile allein ist
    // kein Content; vor Namensschutz, Textregeln und Endprüfung, damit COUNSEL genau den Text mit Pflichtzeile prüft und
    // body dieser Text ist. R2 (geprueftenTextAusSchritten) gibt nur den wörtlich geprüften PUBLISHER-Text frei; eine
    // erst an body angehängte Zeile sperrte die Freigabe. Steht die Zeile schon da, bleibt der Text, wie er ist.
    // Nachbesserung caption9-4: Eine nahe Variante (Schlusspunkt, anderer Bindestrich, Fettdruck …) wird durch die
    // wörtliche Zeile ersetzt statt verdoppelt; ersetzt hält die ersetzte Zeile fest (der Text war PUBLISHERs).
    if (mediumId !== null) {
      const p = pflichtzeileEinsetzen(freigabeText, KI_PFLICHTZEILE_CAPTION);
      const ergaenzt = p.art !== "vorhanden";
      if (ergaenzt) {
        steps[3].output = p.text;
        freigabeText = p.text;
      }
      basisMetadata = { ...basisMetadata, pflichtzeile: { wortlaut: KI_PFLICHTZEILE_CAPTION, von_pipeline_ergaenzt: ergaenzt, ersetzt: p.ersetzt } };
    }

    // R24 Namensschutz: Ein Freigabetext mit geschütztem Namen geht nie auf "zur_freigabe".
    // Geprüft vor AMPLIFIER, damit dafür kein weiterer bezahlter Aufruf läuft; der Text
    // bleibt nur als steps[3].output (Beleg) gespeichert, nicht als body.
    if (enthaeltGeschuetztenNamen(freigabeText)) {
      steps[3].status = "error";
      steps[3].fehler = NAMENSSCHUTZ_GRUND;
      return brichAb(vermerk("publisher", NAMENSSCHUTZ_GRUND));
    }

    // Paket B: Endfassung deterministisch prüfen (Kurzlink E12, URTEIL-Zeile, Datierung), vor der
    // bezahlten Endprüfung.
    const textEndfassung = pruefeText(freigabeText, "pruefung_endfassung");
    if (textEndfassung) {
      steps[3].status = "error";
      steps[3].fehler = textEndfassung.grund;
      return brichAb(textregelVermerk("publisher", textEndfassung.grund, textEndfassung.befunde));
    }

    // ═══ STEP 5: COUNSEL — Endprüfung der PUBLISHER-Fassung, wörtlich (Paket B, R2/E13) ═══
    // Geprüft wird genau der Text, der als body zur Freigabe geht. Ohne Urteil FREIGABE läuft
    // AMPLIFIER nicht; das spart dessen Aufruf und hält die Zeile bei "abgelehnt".
    await fuehreStufeAus(
      steps[4],
      `${ENDPRUEFUNG_KOPF}${datierungsPruefpunkt(datierung)}

ENDFASSUNG (PUBLISHER):
${freigabeText}

${objektBlock ?? "OBJEKTDATEN: keine (Freitext-Content ohne Steinadel-Objektbezug)"}${kurzlink ? `\n\n${kurzlinkBlock(kurzlink)}` : ""}

${URTEIL_SCHLUSS}`,
      cookie,
      true,
      warnungen
    );
    // Technischer Fehler: kein fachliches Urteil. review_notes bleibt die Vorprüfung (passend zu
    // metadata.counsel); die Teilantwort steht als Beleg in steps[4].output.
    if (steps[4].status !== "done") {
      return brichAb(vermerk(STUFE_ENDPRUEFUNG, steps[4].fehler ?? "unbekannter Fehler"));
    }

    const endpruefungOutput = steps[4].output ?? "";
    const endAuswertung = werteCounselAus(endpruefungOutput);
    const endpruefung = {
      urteil: endAuswertung.urteil,
      zeile: endAuswertung.zeile === null ? null : maskiereGeschuetzteNamen(endAuswertung.zeile),
      grund: endAuswertung.grund,
      geprueft: "PUBLISHER-Text (steps[3]), wörtlich = Freigabetext (body)",
      am: new Date().toISOString(),
    };
    const endAbgelehnt = endAuswertung.urteil !== "FREIGABE";
    // Ab hier ist das maßgebliche Urteil die Endprüfung (passend zu review_notes); die Vorprüfung
    // des SCRIBE-Texts bleibt als counsel_vorpruefung im Beleg.
    basisMetadata = { ...basisMetadata, counsel: endpruefung, counsel_vorpruefung: counsel };

    const endGespeichert = await speichere(
      {
        reviewed_by: "counsel",
        review_notes: endpruefungOutput,
        status: endAbgelehnt ? "abgelehnt" : "counsel_geprueft",
        metadata: metadataMit(),
      },
      endAbgelehnt ? "Status abgelehnt (Endprüfung)" : "Status counsel_geprueft (Endprüfung)"
    );
    // R6 wie bei der Vorprüfung: ohne gespeichertes Urteil kein weiterer Aufruf, Lauf "fehler".
    if (!endGespeichert) {
      return brichAb(
        vermerk(
          "pipeline",
          endAbgelehnt ? "COUNSEL-Endprüfung nicht gespeichert" : "COUNSEL-Endprüfung nicht gespeichert — AMPLIFIER nicht gestartet",
          letzterSpeicherfehler()
        ),
        { reviewed_by: "counsel", review_notes: endpruefungOutput }
      );
    }

    if (endAbgelehnt) {
      return NextResponse.json({
        pipeline: "content-first",
        contentId,
        thema,
        platform,
        format,
        status: "abgelehnt",
        counsel: endpruefung,
        counsel_vorpruefung: counsel,
        warnungen,
        steps,
        summary: zusammenfassung(steps),
        speicherfehler,
      });
    }

    // ═══ STEP 6: AMPLIFIER — Distribution-Plan ═══
    // Nachtrag Paket B: Im Abnahmelauf vom 10.11.2026 endete AMPLIFIER mit stop_reason max_tokens („Antwort
    // abgeschnitten“, 4949 Zeichen bei maxTokens 2048). maxTokens gilt je Agent (lib/agent-prompts.ts, jetzt 4096;
    // activate übernimmt ihn als max_tokens), die Pipeline kann ihn nicht je Stufe setzen. Dazu begrenzt der
    // Auftrag den Umfang (UMFANG), damit der Plan mit Spielraum unter dem Limit vollständig bleibt.
    await fuehreStufeAus(
      steps[5],
      `AMPLIFICATION-AUFTRAG: Erstelle den Distribution- und Repurposing-Plan für diesen Content.

ORIGINAL-PLATTFORM: ${platform}
THEMA: ${thema}

PUBLISHER-OUTPUT:
${steps[3].output}

ALLE 6 PLATTFORMEN: YouTube, X/Twitter, LinkedIn, TikTok, Instagram, Newsletter

AUFGABEN:
1. Distribution-Timeline: 7-Tage-Plan über ALLE 6 Plattformen
2. Repurposing-Matrix (1→6 Strategie) passend zur Original-Plattform
3. Für JEDEN Repurpose-Piece: Konkreten Content-Entwurf liefern (nicht nur Beschreibung!)
4. Hashtag-Strategie pro Plattform
5. KPI-Ziele pro Plattform (Views, Engagement-Rate, Follower-Growth, 7-Tage-Ziel)

Liefere einen konkreten Aktionsplan mit fertigen Repurpose-Entwürfen.
UMFANG: HALTE den Plan KOMPAKT (max. ~900 Wörter — je Repurpose-Entwurf höchstens 3 Sätze, keine langen Tabellen). Lieber jeden Teil kurz als einen Teil unvollständig.`,
      cookie,
      false,
      warnungen
    );
    // Technischer Fehler in AMPLIFIER → status 'fehler' (wie bisher)
    if (steps[5].status !== "done") {
      return brichAb(vermerk("amplifier", steps[5].fehler ?? "unbekannter Fehler"));
    }

    // ═══ Erfolgreicher Durchlauf: zur menschlichen Freigabe ═══
    // body ist die PUBLISHER-Fassung, und genau sie hat COUNSEL in der Endprüfung wörtlich geprüft
    // (R2/E13). Der Hinweis entsteht mit derselben Regel, mit der das Freigeben prüft
    // (geprueftenTextAusSchritten, lib/freigabe-regeln.ts).
    const wortlautGeprueft = geprueftenTextAusSchritten(steps, endpruefungOutput);
    const freigabeHinweis = {
      geprueft: "PUBLISHER-Text (steps[3]), wörtlich geprüft in der COUNSEL-Endprüfung (steps[4])",
      zur_freigabe: "PUBLISHER-Text (body)",
      identisch: wortlautGeprueft !== null && wortlautGeprueft.trim() === freigabeText.trim(),
    };

    const zurFreigabeGespeichert = await speichere(
      {
        body: freigabeText,
        // R6: Review und Urteil stehen auch in dieser Fassung — eine zur_freigabe-Zeile
        // ohne review_notes kann es so nicht geben. Paket B: das Urteil der Endprüfung.
        reviewed_by: "counsel",
        review_notes: endpruefungOutput,
        status: "zur_freigabe",
        metadata: metadataMit({
          freigabe_hinweis: freigabeHinweis,
          amplifier_empfehlung: steps[5].output,
        }),
      },
      "Status zur_freigabe"
    );

    // R6: Nicht gespeichert heißt nicht "complete". Die Zeile wird (wenn möglich) auf
    // "fehler" gesetzt, damit sie nicht als hängender Zwischenstand liegen bleibt.
    if (!zurFreigabeGespeichert) {
      const fehler = vermerk("pipeline", "Status zur_freigabe nicht gespeichert", letzterSpeicherfehler());
      await speichere(
        {
          status: "fehler",
          metadata: metadataMit({ freigabe_hinweis: freigabeHinweis, amplifier_empfehlung: steps[5].output, fehler }),
        },
        "Status fehler (zur_freigabe nicht gespeichert)"
      );
      return fehlerAntwort(500, `Status zur_freigabe nicht gespeichert (Content #${contentId}) — Eintrag prüfen`, {
        pipeline: "content-first",
        contentId,
        thema,
        platform,
        format,
        status: "fehler",
        fehler_vermerk: fehler,
        counsel: endpruefung,
        counsel_vorpruefung: counsel,
        freigabe_hinweis: freigabeHinweis,
        warnungen,
        steps,
        summary: zusammenfassung(steps),
        speicherfehler,
      });
    }

    // Paket B: "complete" nur, wenn alle sechs Stufen fertig sind (vorher fest 5).
    const completedSteps = steps.filter((s) => s.status === "done").length;
    return NextResponse.json({
      pipeline: "content-first",
      contentId,
      thema,
      platform,
      format,
      category: categoryKey,
      status: completedSteps === steps.length ? "complete" : "partial",
      counsel: endpruefung,
      counsel_vorpruefung: counsel,
      freigabe_hinweis: freigabeHinweis,
      warnungen,
      steps,
      summary: zusammenfassung(steps),
      speicherfehler,
    });
  } catch (err) {
    // R17: bereinigt, bevor der Text gespeichert oder zurückgegeben wird.
    const meldung = fehlerText(err);
    if (contentId !== null) {
      // Stufe 1: Belege und Schritte behalten statt metadata mit { fehler } zu überschreiben.
      await speichere(
        { status: "fehler", metadata: metadataMit({ fehler: vermerk("pipeline", meldung) }) },
        "Status fehler (Ausnahme)"
      );
    }
    if (contentId !== null) return fehlerNachInsert(500, meldung);
    return fehlerAntwort(500, meldung, { contentId: null, status: null, speicherfehler });
  }
}

// GET — Pipeline status and available options
export async function GET() {
  return NextResponse.json({
    pipeline: "content-first",
    description:
      "RESEARCHER → SCRIBE → COUNSEL → PUBLISHER → COUNSEL (Endfassung, wörtlich) → AMPLIFIER (6 Plattformen, COUNSEL fail-closed, optional an Steinadel-Objekt gebunden; CTA als Steinadel-Kurzlink)",
    platforms: Object.keys(FORMATE_JE_PLATTFORM),
    formats: FORMATE_JE_PLATTFORM,
    categories: Object.keys(KATEGORIE_LABEL),
    // Stufe 1 (05.11.2026): Die festen Kostenangaben je Piece ("$0.04-0.08" …) sind
    // entfernt — sie waren nie gemessen. Die geschätzten Kosten eines Laufs stehen in
    // dessen Antwort (summary.total_cost_usd, summary.kosten_hinweis).
    repurposing_strategy: {
      description: "1→6: Jedes Anchor-Piece (YouTube) wird zu 6+ Derivaten auf allen Plattformen",
      hinweis: "Ziel, nicht gemessen",
      weekly_output: {
        anchor: "2 YouTube Videos/Woche",
        derivatives: "4 X-Threads + 4 Instagram Carousels + 2 Instagram Reels + 10 TikTok Shorts + 1 Newsletter = 21 Pieces",
        total: "~23 Content-Pieces/Woche",
      },
    },
    launch_calendar: getLaunchCalendar(),
  });
}

// 4-Wochen Launch-Kalender — 5 Plattformen, 1→6 Repurposing
// Strategie: 2 YouTube/Woche als Anchor → Repurposing auf alle Plattformen
// Mo: TikTok + Instagram | Di: YouTube (Anchor) + Newsletter | Mi: X-Thread + TikTok
// Do: YouTube (Anchor) + Instagram | Fr: X-Thread + TikTok
function getLaunchCalendar() {
  return {
    week1: {
      theme: "Launch & Grundlagen",
      monday: { platform: "tiktok", format: "tiktok_short", topic: "Was ist KI-Automation wirklich? Die Wahrheit in 60 Sekunden" },
      tuesday: { platform: "youtube", format: "longform", topic: "KI-Agenten erklärt: So automatisierst du dein Business in 2026" },
      wednesday: { platform: "twitter", format: "thread", topic: "Was ist eine Autonome KI-Corporation? 5 Dinge die du wissen musst" },
      thursday: { platform: "instagram", format: "carousel", topic: "Die 3 größten Fehler beim Einsatz von KI im Business" },
      friday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #1 — Warum KI-Agenten die nächste Revolution sind" },
    },
    // Stufe 1 (05.11.2026): Woche 2 ("Krypto & Trading") gestrichen — Ghost Protocol hat
    // mit Trading nichts zu tun. Bewusst kein Ersatzthema: Die Woche bleibt leer, und
    // auto-produce meldet an ihren Tagen "kein Kalendereintrag".
    week2: {
      theme: null,
    },
    week3: {
      theme: "Business Automation",
      monday: { platform: "tiktok", format: "tiktok_short", topic: "Claude vs GPT-4: Welche KI wofür? 45-Sekunden-Vergleich" },
      tuesday: { platform: "youtube", format: "longform", topic: "Von 0 auf automatisiert: KI-Workflows die wirklich funktionieren" },
      wednesday: { platform: "twitter", format: "thread", topic: "Ich habe 17 KI-Agenten gebaut — das passiert wenn sie zusammenarbeiten" },
      thursday: { platform: "instagram", format: "carousel", topic: "Der 50€/Monat KI-Stack: 8 Tools die jedes Business braucht" },
      friday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #3 — Der 50€/Monat Autopilot: Realistischer KI-Stack" },
    },
    week4: {
      theme: "Deep Dives & Community",
      monday: { platform: "tiktok", format: "tiktok_short", topic: "3 KI-Automatisierungen die du HEUTE starten kannst" },
      // Stufe 1 (05.11.2026): Dienstag (Trading-Deep-Dive) gestrichen, kein Ersatzthema.
      wednesday: { platform: "twitter", format: "thread", topic: "Open Source KI: Die besten Self-Hosted Alternativen 2026" },
      thursday: { platform: "instagram", format: "carousel", topic: "Was ich in 4 Wochen KI-Content gelernt habe — Zahlen & Learnings" },
      friday: { platform: "newsletter", format: "newsletter_issue", topic: "AI Insider #4 — Premium Launch: Was kommt als Nächstes" },
    },
  };
}
