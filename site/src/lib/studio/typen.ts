// Objekt-Studio: Vertrag von GET /api/studio/[objekt] (Schritt 2, 08.11.2026). Nur Typen —
// Route und Studio-Seite teilen sie, im Browser entsteht daraus kein Code.
//
// Grundregel wie lib/status-types.ts: Jede Zahl ist ein Messwert mit wert, status, quelle und
// gemessen_am. Jeder Teil der Antwort hat einen eigenen Status; ein Lesefehler (Supabase oder
// Export) macht nur den betroffenen Teil zu "fehler" (502-Art, mit fehler_art), nie zu einer
// leeren Liste. Was noch nicht gebaut ist, heißt "noch_nicht_gebaut" und nennt den Bauschritt —
// ohne Zahl, nie 0 als Platzhalter.

import type { BelegEintrag } from "@/components/studio/beleg-hilfen";
import type { AnkerHashStatus, CoverStatus } from "@/lib/studio/anker";
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
  kosten_credits: StudioMesswert<null>;
  messung: StudioMesswert<null>;
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

/** Abweisung der ganzen Anfrage: 400 eingabe, 403/415 herkunft (nur die Anker-Route), 404 nicht_im_studio, 500 programmfehler. */
export type StudioAbweisungsArt = "eingabe" | "herkunft" | "nicht_im_studio" | "programmfehler";

export interface StudioFehlerAntwort {
  fehler: string;
  fehler_art: StudioAbweisungsArt;
}
