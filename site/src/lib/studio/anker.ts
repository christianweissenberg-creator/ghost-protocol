// Objekt-Studio Schritt 6 (10.11.2026): Anker-Manifest — welche öffentlich ausgelieferten Bilder eines
// Objekts als Vorlage für Startbilder dienen dürfen, mit dem SHA-256 der Datei, die steinadel.de ausliefert.
//
// Nur öffentliche Fakten: Adresse, Hash, Größe und Maße der ausgelieferten Datei, Art (Visualisierung oder
// KI-Stimmungsbild), Herkunft, Personen im Bild und die Eignung als Anker. Kein Rechtestatus: Das Repo ist
// öffentlich; über Rechte entscheidet das Prüfprotokoll je Medium (Bauschritt 8), nicht dieser Code.
// Ein Anker heißt immer „Visualisierung“, nie „Foto“: Keines dieser Bilder ist eine Aufnahme des Objekts.
//
// Reine Daten und Funktionen ohne Laufzeit-Importe (wie lib/studio/objekte.ts): Die Hash-Prüfung des
// Servers (lib/studio/anker-pruefung.ts, GET /api/studio/[objekt]/anker) und das Anker-Panel im Browser
// (components/studio/AnkerPanel.tsx) lesen dasselbe Manifest.
//
// Messung der Live-Dateien am 10.11.2026, 07:59:15–07:59:17Z: je Datei genau ein HTTPS-Abruf (curl, ohne
// Weiterleitung), SHA-256, Byte-Zahl und Maße aus dem JPEG-Kopf (SOF0) im Speicher berechnet, nichts
// abgelegt. Alle elf Dateien antworteten mit HTTP 200 und image/jpeg. Die Hashes sind gleich denen der
// Bilddateien im Steinadel-Repo (Stand 0f3e82c); die Maße sind dieselben wie in der Bestandsaufnahme vom
// 06.11.2026.
// Exposé-Seite: Zuordnung aus Steinadels Bildauswertung des Exposés vom 09.07.2026. Die dort je Seite
// exportierten Bilddateien sind byte-gleich mit vier Manifest-Dateien (SHA-256 verglichen am 10.11.2026):
// S. 18 = hof-nacht, S. 4 = terrasse-pergola, S. 45 = lofts-balkone, S. 37 = fassade-abend. Für die übrigen
// ist keine Seite belegt.
// Personen: Bestandsaufnahme vom 06.11.2026, nicht erneut gesichtet; „nicht geprüft“ heißt: niemand hat
// nachgesehen. Vor der Wahl als Vorlage wird ein Anker angesehen (Personen waren der Hauptmangel der Probe
// vom 05.11.2026).
// Nicht im Manifest: Standort- und Lagebild sowie die OG-Karte (ohne Objektbezug bzw. mit eingebranntem
// Text und Preis) und die übrigen Bilder des Objektordners, die die Bestandsaufnahme nicht als Anker führt.

import type { StudioObjekt } from "./objekte";

export type AnkerArt = "visualisierung" | "ki_stimmungsbild";
export type PersonenStand = "ja" | "nein" | "nicht_geprueft";

export interface AnkerEintrag {
  /** Kennung im Studio (Ausschnitt-Rezepte und Beleg verweisen darauf). */
  id: string;
  /** Live-Adresse auf steinadel.de. Nur diese Adressen ruft die Hash-Prüfung ab (istManifestUrl). */
  url: string;
  /** SHA-256 der live ausgelieferten Datei, 64 Hex-Zeichen. */
  sha256: string;
  /** Byte-Zahl derselben Datei — zugleich die Obergrenze, bis zu der die Hash-Prüfung liest. */
  bytes: number;
  breite: number;
  hoehe: number;
  art: AnkerArt;
  /** Woher das Bild stammt; expose_seite null = keine Seite belegt. */
  herkunft: { text: string; expose_seite: number | null };
  /** Personen im Bild; text ergänzt, z. B. eine Anzahl. */
  personen: { stand: PersonenStand; text: string | null };
  /** Darf Vorlage für ein Startbild sein. */
  als_anker: boolean;
  /** Einschränkung oder Erklärung, sichtbar im Panel; null = keine. */
  hinweis: string | null;
}

export interface AnkerManifest {
  /** Zeitpunkt der Messung der Live-Dateien (ISO, UTC). */
  gemessen_am: string;
  /** Wie gemessen wurde, für Menschen lesbar. */
  messweg: string;
  /** id des Ankers, auf den urls.cover im Steinadel-Export zeigen muss. */
  cover_anker: string;
  eintraege: readonly AnkerEintrag[];
}

/** Ursprung aller Manifest-Dateien. */
export const ANKER_URSPRUNG = "https://steinadel.de";

/** Pfadform der Manifest-Dateien: unter /objekte/, Kleinbuchstaben, Ziffern und Bindestriche, Endung .jpg. */
const ANKER_PFAD = /^\/objekte\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*\.jpg$/;

const AUSSEN = "nur mit Vorsicht: schmaler als 1920 px — für 1080p müsste hochskaliert werden, und Hochskalieren erfindet Details.";
const EXPOSE = "Visualisierung aus dem Objekt-Exposé";
const OHNE_SEITE = "Visualisierung auf steinadel.de; aus welcher Exposé-Seite, ist nicht belegt";
const GEBAEUDE = "Gebäude-Visualisierung auf steinadel.de; aus welcher Exposé-Seite, ist nicht belegt";
const NICHT_GEPRUEFT = { stand: "nicht_geprueft", text: null } as const;

function eintrag(e: AnkerEintrag): AnkerEintrag {
  return Object.freeze({ ...e, herkunft: Object.freeze({ ...e.herkunft }), personen: Object.freeze({ ...e.personen }) });
}

export const ANKER_MANIFESTE: Readonly<Record<StudioObjekt, AnkerManifest>> = Object.freeze({
  "rittergut-seifersdorf": Object.freeze({
    gemessen_am: "2026-11-10T07:59:15Z",
    messweg:
      "je Datei ein HTTPS-Abruf ohne Weiterleitung; SHA-256, Byte-Zahl und Maße (JPEG-Kopf) im Speicher berechnet, nichts abgelegt",
    cover_anker: "hof-nacht",
    eintraege: Object.freeze([
      eintrag({
        id: "hof-nacht",
        url: "https://steinadel.de/objekte/rittergut/hero-hof-nacht.jpg",
        sha256: "4ea1631f9799b83c808db4facffeebcfb2c31ff05ef5edb0fd79445a42a19a0e",
        bytes: 667_131,
        breite: 3000,
        hoehe: 2018,
        art: "visualisierung",
        herkunft: { text: EXPOSE, expose_seite: 18 },
        personen: { stand: "ja", text: "ca. 8" },
        als_anker: true,
        hinweis: "Vorlage der Probe vom 05.11.2026 (dieselbe Datei, SHA-256 gleich); der Steinadel-Export führt sie als urls.cover.",
      }),
      eintrag({
        id: "terrasse-pergola",
        url: "https://steinadel.de/objekte/rittergut/wintergarten.jpg",
        sha256: "594f8cd87280648a631829fa7407df0cb9aef2dab960251c1d9601eef7b3d9b4",
        bytes: 370_164,
        breite: 2000,
        hoehe: 1042,
        art: "visualisierung",
        herkunft: { text: EXPOSE, expose_seite: 4 },
        personen: { stand: "ja", text: null },
        als_anker: true,
        hinweis: "Dateiname und Alt-Text nennen einen Wintergarten; ob das zum Motiv passt, ist fraglich (Bestandsaufnahme vom 06.11.2026).",
      }),
      eintrag({
        id: "lofts-balkone",
        url: "https://steinadel.de/objekte/rittergut/lofts-balkone.jpg",
        sha256: "c950ee134a837b8c87a05a6ca17f8ec4bf842bdfd2707554c8cd7729b9f9433d",
        bytes: 368_317,
        breite: 2000,
        hoehe: 1042,
        art: "visualisierung",
        herkunft: { text: EXPOSE, expose_seite: 45 },
        personen: NICHT_GEPRUEFT,
        als_anker: true,
        hinweis: null,
      }),
      eintrag({
        id: "jagdhaus",
        url: "https://steinadel.de/objekte/rittergut-seifersdorf/gebaeude/jagdhaus.jpg",
        sha256: "f2bd5d2cd0d9659cb329d81a0a4a15752d11fd8a1c82e69037d7370ff894dfb0",
        bytes: 745_788,
        breite: 2000,
        hoehe: 1200,
        art: "visualisierung",
        herkunft: { text: GEBAEUDE, expose_seite: null },
        personen: NICHT_GEPRUEFT,
        als_anker: true,
        hinweis: null,
      }),
      eintrag({
        id: "gutshaus",
        url: "https://steinadel.de/objekte/rittergut-seifersdorf/gebaeude/gutshaus.jpg",
        sha256: "06f1a59be2cc446f21fa195cc15fc180e7fe52b82cd05e1dccbbc1a63962b0f9",
        bytes: 840_213,
        breite: 2000,
        hoehe: 1200,
        art: "visualisierung",
        herkunft: { text: GEBAEUDE, expose_seite: null },
        personen: NICHT_GEPRUEFT,
        als_anker: true,
        hinweis: null,
      }),
      eintrag({
        id: "schwerthof",
        url: "https://steinadel.de/objekte/rittergut-seifersdorf/gebaeude/schwerthof.jpg",
        sha256: "24827bfc84648532bd4e672033f8af6b5948d16aa7325eb68655a160c08ce30e",
        bytes: 589_852,
        breite: 2000,
        hoehe: 1042,
        art: "visualisierung",
        herkunft: { text: GEBAEUDE, expose_seite: null },
        personen: NICHT_GEPRUEFT,
        als_anker: true,
        hinweis: null,
      }),
      eintrag({
        id: "fassade-golden",
        url: "https://steinadel.de/objekte/rittergut/fassade-golden.jpg",
        sha256: "ca6e7f1b14de8156a68a8b8da1ff6f1be3f95b905eb4cff6ab667e62cd876637",
        bytes: 212_685,
        breite: 1500,
        hoehe: 900,
        art: "visualisierung",
        herkunft: { text: OHNE_SEITE, expose_seite: null },
        personen: { stand: "ja", text: null },
        als_anker: true,
        hinweis: AUSSEN,
      }),
      eintrag({
        id: "burghof",
        url: "https://steinadel.de/objekte/rittergut-seifersdorf/gebaeude/burghof.jpg",
        sha256: "1a26001503abba004cd59259606a3c961e51bf5e723db8267d9007ab79baf6e5",
        bytes: 332_579,
        breite: 1500,
        hoehe: 900,
        art: "visualisierung",
        herkunft: { text: GEBAEUDE, expose_seite: null },
        personen: { stand: "ja", text: null },
        als_anker: true,
        hinweis: AUSSEN,
      }),
      eintrag({
        id: "fassade-abend",
        url: "https://steinadel.de/objekte/rittergut/fassade-sonnenuntergang.jpg",
        sha256: "43813810938a8dec70601379efea1d4df925ad96dbbfae5cee8d41b84d9e2cce",
        bytes: 153_814,
        breite: 1484,
        hoehe: 890,
        art: "visualisierung",
        herkunft: { text: EXPOSE, expose_seite: 37 },
        personen: NICHT_GEPRUEFT,
        als_anker: true,
        hinweis: AUSSEN,
      }),
      eintrag({
        id: "wintergarten-2",
        url: "https://steinadel.de/objekte/rittergut/wintergarten-2.jpg",
        sha256: "09e6eb04fda56932dfad394a78fad976f703d3bf1522a6ef5dc2c7bbd27f1c08",
        bytes: 160_267,
        breite: 1285,
        hoehe: 643,
        art: "visualisierung",
        herkunft: { text: OHNE_SEITE, expose_seite: null },
        personen: NICHT_GEPRUEFT,
        als_anker: true,
        hinweis: AUSSEN,
      }),
      eintrag({
        id: "loft-stimmung",
        url: "https://steinadel.de/objekte/rittergut/interieur-loft.jpg",
        sha256: "4e34bb945af0e74b93ee773aed6dd2b0e9e31d8b933c24ba7d966902d5f77664",
        bytes: 124_242,
        breite: 686,
        hoehe: 858,
        art: "ki_stimmungsbild",
        herkunft: {
          text: "KI-generiert aus einem allgemeinen Prompt, ohne Vorlage aus dem Objekt (Bild-Metadaten: Modell „sana“)",
          expose_seite: null,
        },
        personen: NICHT_GEPRUEFT,
        als_anker: false,
        hinweis: "Kein Anker: Das Bild zeigt nicht das geplante Objekt, sondern ein allgemeines KI-Interieur.",
      }),
    ]),
  }),
});

/** Manifest eines Objekts der Allow-List; sonst null (auch für Schlüssel wie "constructor"). */
export function ankerManifest(slug: unknown): AnkerManifest | null {
  if (typeof slug !== "string" || !Object.hasOwn(ANKER_MANIFESTE, slug)) return null;
  return ANKER_MANIFESTE[slug as StudioObjekt];
}

/**
 * Ist das eine zulässige Manifest-Adresse? Nur https://steinadel.de/objekte/….jpg in bereits normalisierter
 * Schreibweise: ohne Zugangsdaten, Port, Abfrage oder Fragment, ohne "..", Großbuchstaben oder Kodierung.
 * Die Hash-Prüfung ruft nichts anderes ab — auch dann nicht, wenn jemand das Manifest falsch ändert.
 */
export function istManifestUrl(url: unknown): url is string {
  // "?" und "#" auch leer nicht: new URL("…jpg?") hat search "" und sähe sonst normalisiert aus.
  if (typeof url !== "string" || url.length > 300 || /[?#]/.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.href === url &&
    u.origin === ANKER_URSPRUNG &&
    u.username === "" &&
    u.password === "" &&
    u.search === "" &&
    u.hash === "" &&
    ANKER_PFAD.test(u.pathname)
  );
}

/** Dateiname einer Manifest-Adresse, z. B. "hero-hof-nacht.jpg". */
export function dateiName(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

/** Pfad einer Manifest-Adresse ohne Ursprung, z. B. "/objekte/rittergut/hero-hof-nacht.jpg". */
export function dateiPfad(url: string): string {
  return url.startsWith(ANKER_URSPRUNG) ? url.slice(ANKER_URSPRUNG.length) : url;
}

/** Anfang eines SHA-256 für die Anzeige: 16 Hex-Zeichen und "…"; der volle Wert steht im title. */
export function kurzHash(sha256: string): string {
  return sha256.length > 16 ? `${sha256.slice(0, 16)}…` : sha256;
}

// ── Ergebnis der Hash-Prüfung und des Cover-Abgleichs ────────────────────────────────────────────

/** Live-Datei gegen Manifest: gleicher Hash, anderer Inhalt oder nicht gelesen. */
export type AnkerHashStatus = "unveraendert" | "geaendert" | "nicht_erreichbar";
/** urls.cover im Export: zeigt weiter auf den Cover-Anker, zeigt woanders hin, oder der Export war nicht lesbar. */
export type CoverStatus = "unveraendert" | "geaendert" | "nicht_lesbar";

export const HASH_STATUS_TEXT: Readonly<Record<AnkerHashStatus, string>> = Object.freeze({
  unveraendert: "unverändert",
  geaendert: "geändert",
  nicht_erreichbar: "nicht erreichbar",
});

export const COVER_STATUS_TEXT: Readonly<Record<CoverStatus, string>> = Object.freeze({
  unveraendert: "unverändert",
  geaendert: "geändert",
  nicht_lesbar: "nicht lesbar",
});

/** Art eines Bildes für die Anzeige; ein Nicht-Anker sagt es gleich mit. */
export function artText(e: Pick<AnkerEintrag, "art" | "als_anker">): string {
  const art = e.art === "ki_stimmungsbild" ? "KI-Stimmungsbild" : "Visualisierung";
  return e.als_anker ? art : `${art}, kein Anker`;
}

/** Personen im Bild für die Anzeige, z. B. "ja, ca. 8" oder "nicht geprüft". */
export function personenText(p: AnkerEintrag["personen"]): string {
  const stand = p.stand === "nicht_geprueft" ? "nicht geprüft" : p.stand;
  return p.text ? `${stand}, ${p.text}` : stand;
}

/** Was in urls.cover steht, verglichen mit der Adresse des Cover-Ankers. */
export type CoverVergleich =
  | { art: "fehlt" }
  | { art: "kein_text" }
  /** Keine lesbare Web-Adresse (nicht zu parsen oder weder http noch https). */
  | { art: "unlesbar" }
  /**
   * adresse: Ursprung und Pfad (ohne Zugangsdaten, Abfrage, Fragment); pfad_gleich: derselbe Ursprung und
   * Pfad wie der Cover-Anker; zugang, abfrage, fragment: davon stand etwas in der Adresse.
   */
  | { art: "adresse"; adresse: string; pfad_gleich: boolean; zugang: boolean; abfrage: boolean; fragment: boolean };

/**
 * Was steht in urls.cover, gemessen an der Datei des Cover-Ankers? Eine relative Angabe gilt wie im
 * Steinadel-Export ab der Wurzel von steinadel.de. Die Adresse wird nie abgerufen. Ob sie als "unverändert"
 * zählt, entscheidet lib/studio/anker-pruefung.ts (coverAusExport): nur bei gleichem Ursprung und Pfad, ohne
 * Zugangsdaten und ohne Abfrage — eine Abfrage könnte eine andere Auslieferung bedeuten, die der Hash der
 * Manifest-Adresse nicht belegt. Ein Fragment geht nie an den Server.
 */
export function vergleicheCover(cover: unknown, soll: string): CoverVergleich {
  if (cover === null || cover === undefined) return { art: "fehlt" };
  if (typeof cover !== "string") return { art: "kein_text" };
  const text = cover.trim();
  if (text === "") return { art: "fehlt" };
  let u: URL;
  let s: URL;
  try {
    u = new URL(text, `${ANKER_URSPRUNG}/`);
    s = new URL(soll);
  } catch {
    return { art: "unlesbar" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { art: "unlesbar" };
  return {
    art: "adresse",
    adresse: `${u.origin}${u.pathname}`,
    pfad_gleich: u.origin === s.origin && u.pathname === s.pathname,
    zugang: u.username !== "" || u.password !== "",
    abfrage: u.search !== "",
    fragment: u.hash !== "",
  };
}
