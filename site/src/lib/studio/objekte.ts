// Objekt-Studio: Allow-List, Kennungsprüfung und Objekt-Ausnahmen (Schritt 2, 08.11.2026).
//
// Ein Studio gibt es nur für die Objekte dieser Liste (/studio/<slug>, GET /api/studio/<slug>).
// Jeder andere Slug ergibt 404 "Objekt nicht im Studio"; eine Kennung, die kein Slug sein kann,
// ergibt 400. Reine Daten und Funktionen ohne Imports: Route, Studio-Seite, Sidebar und /expose
// lesen dieselbe Liste, im Server wie im Browser.

export const STUDIO_OBJEKTE = ["rittergut-seifersdorf"] as const;

export type StudioObjekt = (typeof STUDIO_OBJEKTE)[number];

/** Slug-Form der Steinadel-Objekte: Kleinbuchstaben und Ziffern, durch einzelne Bindestriche getrennt. */
const SLUG_MUSTER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Längste zulässige Kennung; längere werden ohne Abfrage abgewiesen. */
export const SLUG_MAX_ZEICHEN = 80;

export type SlugPruefung = { art: "ok"; slug: StudioObjekt } | { art: "form" } | { art: "nicht_im_studio" };

/** Erst die Form (sonst 400), dann die Allow-List (sonst 404). Nur ein Treffer der Liste ist "ok". */
export function pruefeStudioSlug(roh: unknown): SlugPruefung {
  if (typeof roh !== "string" || roh.length === 0 || roh.length > SLUG_MAX_ZEICHEN || !SLUG_MUSTER.test(roh)) {
    return { art: "form" };
  }
  const treffer = STUDIO_OBJEKTE.find((slug) => slug === roh);
  return treffer === undefined ? { art: "nicht_im_studio" } : { art: "ok", slug: treffer };
}

export function istStudioObjekt(slug: unknown): slug is StudioObjekt {
  return pruefeStudioSlug(slug).art === "ok";
}

/** Pfad der Studio-Seite eines Objekts der Allow-List. */
export function studioPfad(slug: StudioObjekt): string {
  return `/studio/${slug}`;
}

/** Einstieg aus der Sidebar: das erste (in Schritt 2 einzige) Objekt der Liste. */
export const STUDIO_EINSTIEG = studioPfad(STUDIO_OBJEKTE[0]);

/**
 * Bauschritte des Studios, ab denen ein Bereich bzw. eine Prüfung kommt. Bis dahin steht dort
 * "noch nicht gebaut (Schritt N)" — ohne Zahl, nie 0 als Platzhalter.
 */
export const STUDIO_BAUSCHRITTE = { anker: 6, medien: 7, credits: 7, medienregel: 8, messplan: 11 } as const;

export function nochNichtGebautText(schritt: number): string {
  return `noch nicht gebaut (Schritt ${schritt})`;
}

/**
 * Objekt-Ausnahme für die Datierung im Studio-Kopf. Das Exportfeld heißt baujahr; beim RitterGut
 * steht dort das Jahr der Ersterwähnung. Das Exportfeld selbst bleibt unverändert (es gehört
 * Steinadel); das Studio ändert nur die Bezeichnung, und nur solange der Export genau diesen Wert
 * liefert. Liefert er einen anderen, heißt die Angabe wieder "Baujahr" und der Kopf trägt eine
 * Warnung.
 */
export interface DatierungsAusnahme {
  /** Wert des Exportfelds baujahr, für den die Ausnahme gilt. */
  jahr: number;
  /** Bezeichnung im Studio-Kopf statt "Baujahr". */
  bezeichnung: string;
  /** Neutraler Quellkommentar, sichtbar am Kopf. */
  quelle: string;
}

export const DATIERUNG_AUSNAHMEN: Readonly<Partial<Record<StudioObjekt, DatierungsAusnahme>>> = {
  "rittergut-seifersdorf": {
    jahr: 1335,
    bezeichnung: "Ersterwähnung",
    quelle:
      "Laut Steinadel-Objektdaten ist 1335 das Jahr der Ersterwähnung, nicht das Baujahr. Das Exportfeld baujahr bleibt unverändert.",
  },
};
