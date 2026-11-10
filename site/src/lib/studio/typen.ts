// Objekt-Studio: Vertrag von GET /api/studio/[objekt] (Schritt 2, 08.11.2026), seit Schritt 7 (10.11.2026)
// auch der Medien-Routen unter /api/studio/[objekt]/medien. Nur Typen — Routen und Studio-Seite teilen sie,
// im Browser entsteht daraus kein Code.
//
// Grundregel wie lib/status-types.ts: Jede Zahl ist ein Messwert mit wert, status, quelle und
// gemessen_am. Jeder Teil der Antwort hat einen eigenen Status; ein Lesefehler (Supabase oder
// Export) macht nur den betroffenen Teil zu "fehler" (502-Art, mit fehler_art), nie zu einer
// leeren Liste. Was noch nicht gebaut ist, heißt "noch_nicht_gebaut" und nennt den Bauschritt —
// ohne Zahl, nie 0 als Platzhalter.

import type { BelegEintrag } from "@/components/studio/beleg-hilfen";
import type { AnkerHashStatus, CoverStatus } from "@/lib/studio/anker";
import type { MessplanStand } from "@/lib/studio/messplan";
import type { CounselUrteil, MessStatus } from "@/lib/status-types";

export type StudioStatus = MessStatus | "noch_nicht_gebaut";

/**
 * Ursache eines Lesefehlers in einem Teil. Für den Export dieselben Arten wie /api/objekte und
 * die Anzeige in lib/hooks-status.ts (objekteFehlerArt); dazu "nicht_im_export" (Export gelesen,
 * Objekt fehlt) und "supabase" (Lesefehler der Datenbank).
 */
export type StudioFehlerArt =
  | "nicht_angemeldet"
  | "konfiguration"
  | "nicht_erreichbar"
  | "quelle_fehler"
  | "nicht_im_export"
  | "supabase"
  | "unbekannt";

export interface StudioMesswert<T> {
  /** Gemessener Wert; null, wenn nicht gemessen, nicht gebaut oder die Messung fehlschlug. */
  wert: T | null;
  status: StudioStatus;
  /** Woher der Wert stammt, für Menschen lesbar. */
  quelle: string;
  /** ISO-Zeitpunkt der Messung bzw. des Leseversuchs; null, wenn nicht gemessen oder nicht gebaut. */
  gemessen_am: string | null;
  /** Einschränkung, Grund für "nicht_gemessen" oder bereinigter Fehlertext. */
  hinweis?: string;
  /** Nur bei status "fehler". */
  fehler_art?: StudioFehlerArt;
  /** Nur bei status "noch_nicht_gebaut": Bauschritt, ab dem der Teil kommt. */
  schritt?: number;
}

export interface ObjektDatierung {
  /** "Baujahr" wie das Exportfeld, oder die Objekt-Ausnahme (lib/studio/objekte.ts), z. B. "Ersterwähnung". */
  bezeichnung: string;
  /** Wert des Exportfelds baujahr. */
  jahr: number;
  /** Quellkommentar der Objekt-Ausnahme bzw. warum sie nicht greift; null ohne Ausnahme. */
  ausnahme: string | null;
}

/** Objektkopf aus dem Steinadel-Export; Texte mit maskiertem geschütztem Namen, null = nicht im Export. */
export interface ObjektKopf {
  slug: string;
  name: string | null;
  ort: string | null;
  datierung: ObjektDatierung | null;
  /** statusBadge des Exports. */
  status: string | null;
  /** Wörtlich aus dem Export. */
  preis: string | null;
  /** afaProzent und istDenkmal des Exports; denkmal null = nicht im Export. */
  afa: { prozent: number; denkmal: boolean | null } | null;
  /** Kopf der Export-Antwort; quelle maskiert. */
  export: { version: string | null; quelle: string | null; generiert_am: string | null };
  /** Felder, die der Export für dieses Objekt nicht oder nicht lesbar liefert. */
  fehlende_felder: string[];
}

/** Kosten eines Laufs (einer content-Zeile) aus metadata.steps[].cost, geschätzt in USD. */
export interface AssetKosten {
  /** Summe der Stufen mit Kostenangabe; null, wenn keine Stufe eine Angabe trägt. */
  summe_usd: number | null;
  stufen_gelaufen: number;
  stufen_mit_angabe: number;
  stufen_ohne_angabe: number;
}

export interface StudioAsset {
  id: number;
  /** title, maskiert. */
  titel: string | null;
  /** Text-Asset (content-Zeile). Medien kommen erst mit späteren Bauschritten. */
  art: "text";
  /** platform */
  kanal: string | null;
  /** content_type */
  format: string | null;
  status: string;
  erstellt_am: string;
  geaendert_am: string | null;
  /** Aus review_notes mit werteCounselAus() abgeleitet — kein gespeichertes Feld; zeile maskiert. */
  counsel: { urteil: CounselUrteil; zeile: string | null; grund: string; abgeleitet: true };
  /** Sperrgrund nach pruefeFreigabe() wie GET /api/freigaben; null = serverseitig freigebbar. */
  freigabe_sperre: string | null;
  kosten_usd: StudioMesswert<AssetKosten>;
  /** Daten der Beleg-Kette (components/studio/BelegKette.tsx), wie /content sie liest. */
  beleg: BelegEintrag;
}

export interface StudioAssetsTeil extends StudioMesswert<StudioAsset[]> {
  /** Exakte Zahl der content-Zeilen dieses Objekts (Zählung der Abfrage); null bei Lesefehler oder ohne Zählung. */
  gesamt: number | null;
}

/** Kosten je Objekt: Summe der Läufe, geschätzt in USD. */
export interface StudioKosten {
  /** Summe der Läufe mit Kostenangabe; null, wenn keiner eine Angabe trägt. */
  summe: number | null;
  laeufe: number;
  laeufe_mit_angabe: number;
  /** Läufe, deren gelaufene Stufen keine einzige Kostenangabe tragen — sie fehlen in der Summe. */
  laeufe_ohne_angabe: number;
  /** Läufe mit Kostenangabe, bei denen einzelne gelaufene Stufen keine tragen (Summe ist Untergrenze). */
  laeufe_unvollstaendig: number;
  /** Läufe mit Kostenangabe vor PREIS_STAND_AB (lib/kosten.ts): mit der alten Preistabelle geschätzt. */
  laeufe_alte_preistabelle: number;
}

export interface StudioAntwort {
  objekt_slug: string;
  erzeugt_am: string;
  objekt: StudioMesswert<ObjektKopf>;
  assets: StudioAssetsTeil;
  kosten_usd: StudioMesswert<StudioKosten>;
  /** Seit Schritt 7: Higgsfield-Credits aus studio_medium, getrennt von USD. */
  kosten_credits: StudioMesswert<StudioCredits>;
  /** Seit Schritt 7: Messplan aus studio_messplan (Einträge erst ab Schritt 11). */
  messung: StudioMesswert<MessplanStand>;
  /** Seit Schritt 7: Medien-Zeilen (studio_medium) des Objekts, je Video als Kette. */
  medien: StudioMedienTeil;
}

// ── Medien (Schritt 7, 10.11.2026) ────────────────────────────────────────────────────────────────
// Zeilen aus studio_medium (nur anhängbar; Ändern und Löschen sperrt die Datenbank) und die Ketten
// Export → Original → Startbild. Hash und Größe misst der Server selbst, ebenso Maße und Abgleich des
// Startbilds; Maße, Bildrate und Dauer der Videos stammen aus dem Beleg der erzeugenden Sitzung (ffprobe).

export type MedienRolle = "startbild" | "original" | "export";
/** Rollen der Upload-URLs: die drei Dateien eines Videos und ein Bild nur für den Abgleich (ohne Zeile). */
export type UploadRolle = MedienRolle | "abgleich";
export type MediumArt = "video" | "bild";
export type MediumMime = "video/mp4" | "image/jpeg" | "image/png";
export type AbgleichUrteil = "bestanden" | "nicht_bestanden";

/** Ausschnitt-Rezept: Rechteck in Pixeln der Anker-Datei; skalierung in Paket C nur 1. */
export interface Ausschnitt {
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  skalierung: 1;
}

export interface PromptKlausel {
  id: string;
  text: string;
}

/** Eine Zeile aus studio_medium, wie GET /api/studio/[objekt] sie liest. */
export interface StudioMedium {
  id: number;
  objekt_slug: string;
  art: MediumArt;
  fassung: MedienRolle;
  startbild_id: number | null;
  abgeleitet_von: number | null;
  speicher_pfad: string;
  sha256: string;
  bytes: number;
  mime: MediumMime;
  breite: number | null;
  hoehe: number | null;
  fps: number | null;
  dauer_s: number | null;
  aigc_kennzeichen: boolean | null;
  schnitt_von_s: number | null;
  schnitt_bis_s: number | null;
  anker_id: string;
  anker_sha256: string;
  ausschnitt: Ausschnitt | null;
  startbild_abgleich: AbgleichUrteil | null;
  startbild_abweichung_max: number | null;
  erzeuger: string | null;
  modell: string | null;
  job_id: string | null;
  parameter: Record<string, unknown>;
  prompt: string | null;
  prompt_klauseln: PromptKlausel[];
  ki_hinweis_text: string | null;
  kosten_vorschau_credits: number | null;
  kosten_credits: number | null;
  kosten_usd: number | null;
  kosten_quelle: string | null;
  /** DB-Uhr beim Einfügen (Trigger), ISO. */
  eingespielt_am: string;
}

/** Eine Zeile aus studio_pruefung (Schritt 8): Prüfprotokoll zum Export eines Videos, nur anhängbar. */
export interface StudioPruefung {
  id: number;
  medium_id: number;
  medium_sha256: string;
  /** Konstante "betreiber-session": Die Sitzung belegt keinen Namen. */
  durch: string;
  /** Angabe des Prüfers, keine Authentisierung. */
  pruefer_kuerzel: string;
  /** Je Prompt-Klausel des Originals: bestanden oder nicht. */
  klauseln: Array<{ id: string; bestanden: boolean }>;
  anker_abgleich: AbgleichUrteil;
  ki_hinweis_eingebrannt: boolean;
  durchsicht_volle_bildrate: boolean;
  rechte_status: "offen" | "geklaert";
  rechte_nachweis: string | null;
  notiz: string | null;
  /** Vom Server mit der Medien-Regel berechnet, nie vom Browser. */
  urteil: AbgleichUrteil;
  /** DB-Uhr (Trigger), ISO. */
  geprueft_am: string;
}

/** Urteil der Medien-Regel (lib/medien-freigabe.ts) für ein Video, vom Server berechnet. */
export interface MedienUrteil {
  freigebbar: boolean;
  /** Alle Gründe in der Reihenfolge der Bedingungen; leer = freigebbar. */
  gruende: string[];
  /** Maßgebliches (jüngstes, zur Datei passendes) Prüfprotokoll; null ohne. */
  pruefung_id: number | null;
}

/** Ein Video: der Export mit seinem Original und dessen Startbild; fehlende Glieder stehen in luecken. */
export interface MedienKette {
  export: StudioMedium;
  original: StudioMedium | null;
  startbild: StudioMedium | null;
  /** Was an der Kette fehlt oder nicht passt; leer = vollständig. */
  luecken: string[];
  /** Seit Schritt 8: Prüfprotokolle zum Export, jüngstes zuerst; null, wenn sie nicht lesbar waren. */
  pruefungen: StudioPruefung[] | null;
  /** Seit Schritt 8: Urteil der Medien-Regel (Server). */
  urteil: MedienUrteil;
}

export interface StudioMedienWert {
  /** Alle Zeilen des Objekts, nach id. */
  zeilen: StudioMedium[];
  /** Je Export eine Kette, neueste zuerst. */
  ketten: MedienKette[];
  /** ids der Zeilen, die in keiner Kette stehen (etwa ein Original ohne Export nach einem Teilstand). */
  einzeln: number[];
  /** Medienliste beim Lesen gekappt: zeilen ist unvollständig (die Credit-Summe ist dann eine Untergrenze). */
  abgeschnitten: boolean;
}

export type StudioMedienTeil = StudioMesswert<StudioMedienWert>;

/** Higgsfield-Credits je Objekt: Summe der Originale, Deckel (E18) und Rest — nie mit USD gemischt. */
export interface StudioCredits {
  /** Summe kosten_credits der Originale; null, wenn kein Original eine Angabe trägt. */
  summe: number | null;
  /** Deckel für Stufe 2; null, solange nicht entschieden. */
  deckel: number | null;
  /** deckel − summe; null ohne Summe oder ohne Deckel. Angezeigt, nicht erzwungen. */
  rest: number | null;
  originale: number;
  originale_ohne_angabe: number;
}

/** Speicher des Server-Prozesses um einen sharp- bzw. Hash-Job (Node: rss in Byte, maxRSS in KiB). */
export interface SpeicherMessung {
  rss_vorher_b: number;
  rss_nachher_b: number;
  /** process.resourceUsage().maxRSS: Spitze des ganzen Prozesses seit dem Start, in KiB. */
  max_rss_kib: number;
}

/** Ergebnis des Startbild-Abgleichs (lib/studio/startbild.ts). */
export interface AbgleichErgebnis {
  urteil: AbgleichUrteil;
  /** Größte Abweichung je Kanal (0–255); null, wenn nicht verglichen (Maße passen nicht). */
  abweichung_max: number | null;
  /** Mittlere Abweichung über alle Kanalwerte; null wie abweichung_max. */
  mittel: number | null;
  /** Anteil der Kanalwerte über der Toleranz (0–1); null wie abweichung_max. */
  anteil_ueber_toleranz: number | null;
  toleranz: number;
  /** Grund für "nicht_bestanden" ohne Vergleich; sonst null. */
  grund: string | null;
  startbild: { breite: number; hoehe: number };
  ausschnitt: Ausschnitt;
  anker: { id: string; sha256: string; breite: number; hoehe: number };
  /** nativ: false, wenn sharp auf WebAssembly ausgewichen ist (siehe lib/studio/startbild.ts, sharpNativ). */
  versionen: { sharp: string; vips: string; nativ: boolean };
}

// ── GET /api/studio/[objekt]/anker (Schritt 6, 10.11.2026) ──────────────────────────────────────
// Hash-Prüfung der Manifest-Dateien (lib/studio/anker.ts) gegen die live ausgelieferten Dateien und
// Abgleich von urls.cover im Steinadel-Export. Jedes Ergebnis trägt seinen Zeitpunkt; ein Fehler bei einer
// Datei steht als deren Status da, nie als 0 oder als fehlende Zeile.

/** Ergebnis der Hash-Prüfung einer Manifest-Datei. */
export interface AnkerHashErgebnis {
  id: string;
  status: AnkerHashStatus;
  /** SHA-256 laut Manifest. */
  sha256_soll: string;
  /** SHA-256 der vollständig gelesenen Live-Datei; null, wenn nicht gelesen oder am Größenlimit abgebrochen. */
  sha256_live: string | null;
  /** Byte-Zahl laut Manifest (zugleich Leselimit). */
  bytes_soll: number;
  /** Byte-Zahl der vollständig gelesenen Live-Datei; null wie sha256_live. */
  bytes_live: number | null;
  /** HTTP-Status der Live-Adresse; null ohne Antwort (Netzfehler, Zeitlimit, nicht abgerufen). */
  http_status: number | null;
  /** Zeitpunkt des Ergebnisses (ISO). */
  gemessen_am: string;
  /** Grund bei "geaendert" und "nicht_erreichbar", Zusatz bei "unveraendert"; null = keiner. */
  hinweis: string | null;
}

/** Abgleich von urls.cover im Export mit der Adresse des Cover-Ankers. */
export interface CoverErgebnis {
  status: CoverStatus;
  /** id des Cover-Ankers laut Manifest. */
  anker_id: string;
  /** Adresse des Cover-Ankers laut Manifest. */
  soll: string;
  /** urls.cover als Ursprung und Pfad, maskiert und gekürzt; null, wenn leer, kein Text oder keine Web-Adresse. */
  ist: string | null;
  quelle: string;
  /** Zeitpunkt des Export-Abrufs bzw. seines Versuchs (ISO). */
  gemessen_am: string;
  hinweis: string | null;
  /** Nur bei "nicht_lesbar": Ursache wie beim Objektkopf. */
  fehler_art?: StudioFehlerArt;
}

export interface AnkerAntwort {
  objekt_slug: string;
  erzeugt_am: string;
  /** Messzeitpunkt der Manifest-Hashes. */
  manifest_gemessen_am: string;
  /** Je Manifest-Eintrag genau ein Ergebnis, in der Reihenfolge des Manifests. */
  anker: AnkerHashErgebnis[];
  export_cover: CoverErgebnis;
}

/** Wie alt das ausgelieferte Ergebnis ist und wann wieder geprüft wird (lib/studio/anker-speicher.ts). */
export interface AnkerStand {
  /** true: für diese Anfrage geprüft oder einer laufenden Prüfung angeschlossen; false: aus dem Zwischenspeicher. */
  frisch: boolean;
  /** Nur nach „Alle prüfen“: wegen der Mindestpause nicht neu geprüft, ausgeliefert ist das letzte Ergebnis. */
  gedrosselt: boolean;
  /** Alter des Ergebnisses beim Ausliefern, in ganzen Sekunden. */
  alter_s: number;
  /** Bis dahin zeigt der Seitenaufbau dieses Ergebnis, ohne neu zu prüfen (ISO). */
  gueltig_bis: string;
  /** Ab dann prüft „Alle prüfen“ wieder frisch (ISO). */
  naechste_frische_ab: string;
}

/** Antwort von GET und POST /api/studio/[objekt]/anker: das Prüfergebnis und sein Stand. */
export interface AnkerRoutenAntwort extends AnkerAntwort {
  stand: AnkerStand;
}

/**
 * Abweisung der ganzen Anfrage: 400 eingabe, 403/415 herkunft, 404 nicht_im_studio, 500 programmfehler.
 * Seit Schritt 7 (Medien-Routen) dazu: 404 nicht_gefunden (Datei oder Zeile), 409 zustand (Hash, Vorschau,
 * Sperre, vorhandene Zeile), 413 zu_gross, 415 dateityp (Signatur oder MIME passt nicht), 500 schreibfehler,
 * 502 quelle (Storage, Supabase oder Anker nicht lesbar).
 */
export type StudioAbweisungsArt =
  | "eingabe"
  | "herkunft"
  | "nicht_im_studio"
  | "programmfehler"
  | "nicht_gefunden"
  | "zustand"
  | "zu_gross"
  | "dateityp"
  | "schreibfehler"
  | "quelle";

export interface StudioFehlerAntwort {
  fehler: string;
  fehler_art: StudioAbweisungsArt;
  /** 409 bei abweichender Zeile oder veralteter Vorschau: die abweichenden Felder. */
  felder?: string[];
  /** 409 „vorhanden“: die ids der drei bestehenden Zeilen. */
  vorhanden?: { startbild: number; original: number; export: number };
  /** 409 bei belegter Sperre: Art und Beginn des laufenden Jobs (ISO). */
  laeuft?: { art: string; seit: string };
}
