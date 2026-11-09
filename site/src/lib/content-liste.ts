// Lesewege der Content-Seite über den Server (Objekt-Studio Schritt 3, 08.11.2026).
//
// /content liest die Tabelle content nicht mehr im Browser, sondern über zwei Server-Routen mit der
// Service-Rolle:
// - GET /api/content/liste: alle Spalten der neuesten CONTENT_LISTE_GRENZE Zeilen, nach created_at
//   absteigend, ohne Filter — dieselbe Abfrage, die die Seite bis Schritt 2 im Browser stellte. Seit
//   der Änderungsprobe (09.11.2026) fragt die Route vorher nur id und updated_at derselben Zeilen ab und
//   antwortet ohne volle Abfrage mit ihrem Zwischenstand, wenn sich nichts geändert hat (nur Server).
// - GET /api/content/eintrag/<id>: eine Zeile mit allen Spalten (Neuladen nach einer 409 oder wenn
//   die Antwort einer Aktion keine Zeile mitbringt).
// Statt eines Realtime-Kanals fragt die Seite alle CONTENT_TAKT_MS neu ab und zeigt den Zeitpunkt der
// letzten erfolgreichen Abfrage. Scheitert eine spätere Abfrage, bleibt die zuletzt gelesene Liste
// stehen und der Fehler steht darüber — nie eine leere Liste anstelle eines Fehlers.
//
// Diese Datei teilen Routen und Seite: Grenze, Takt, Pfade, Antwortformen und die reinen Leser der
// Antworten. Sie hat keine Laufzeit-Importe und läuft im Browser; Supabase-Client und
// Fehlerbereinigung bleiben in den Routen.

/** So viele Zeilen liest die Liste (wie vorher LISTE_LIMIT der Seite); die Kacheln außer "Zur Freigabe" zählen nur darin. */
export const CONTENT_LISTE_GRENZE = 50;

/**
 * Takt der Neuabfrage (Setzung für Schritt 3: 15 s). Im sichtbaren Tab erscheint eine neue Zeile mit der
 * ersten erfolgreichen, nicht verworfenen Abfrage, die nach ihrem Entstehen beginnt — ohne Fehler also
 * spätestens einen Takt danach plus die Laufzeit der Abfrage. Wird eine Abfrage verworfen, weil während
 * ihres Laufs eine Zeile lokal ersetzt wurde, folgt sofort die nächste.
 */
export const CONTENT_TAKT_MS = 15_000;

/**
 * Zeitlimit einer Abfrage im Browser. Über dem Zeitlimit einer Supabase-Abfrage der Route (8 s,
 * ABFRAGE_TIMEOUT_MS in lib/status-server.ts), damit deren eigene Fehlerantwort ankommt, und unter dem
 * Takt: Eine Abfrage ohne Antwort wird so als Fehler sichtbar, bevor die nächste startet. Braucht die
 * Listen-Route nach einer Änderung Probe und volle Abfrage (je bis 8 s) und zusammen länger als diese
 * Grenze, zeigt die Seite für diesen Takt ihren eigenen Zeitfehler (app/api/content/liste/route.ts).
 */
export const CONTENT_ABRUF_GRENZE_MS = 12_000;

export const CONTENT_LISTE_PFAD = "/api/content/liste";

export function contentEintragPfad(id: number): string {
  return `/api/content/eintrag/${id}`;
}

/** Quelle in den Antworten beider Routen. */
export const CONTENT_QUELLE = "Supabase · Tabelle content, gelesen über den Server (Service-Rolle)";

// ═══ Antwortformen ═══

/**
 * Ursache einer Fehlerantwort: eingabe (400), nicht_gefunden (404), konfiguration (500: Service-Schlüssel
 * fehlt oder ist unbrauchbar, Supabase wurde nicht abgefragt), supabase (502: Lesefehler oder Antwort
 * ohne Zeilen), programmfehler (500).
 */
export type ContentFehlerArt = "eingabe" | "nicht_gefunden" | "konfiguration" | "supabase" | "programmfehler";

export interface ContentFehlerAntwort {
  /** Bereinigter Grund (bereinigeFehler in lib/status-server.ts). */
  fehler: string;
  fehler_art: ContentFehlerArt;
}

export interface ContentListeAntwort {
  /** Zeilen mit allen Spalten, neueste zuerst. */
  zeilen: Record<string, unknown>[];
  /** CONTENT_LISTE_GRENZE */
  grenze: number;
  /** Die Abfrage lieferte so viele Zeilen wie die Grenze: ältere Zeilen fehlen in der Liste. */
  abgeschnitten: boolean;
  /** ISO-Zeitpunkt nach der letzten Supabase-Abfrage der Anfrage — volle Abfrage oder Änderungsprobe (Uhr des Servers). */
  gelesen_am: string;
  quelle: string;
}

export interface ContentEintragAntwort {
  eintrag: Record<string, unknown>;
  gelesen_am: string;
  quelle: string;
}

// ═══ Reine Leser (Browser) ═══

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

/**
 * Fehlertext einer Antwort: 401 heißt "Nicht angemeldet (HTTP 401)" (so antwortet die Middleware ohne
 * gültige Sitzung); sonst das Feld "fehler" der Route, ersatzweise "error", sonst "HTTP <Status>".
 * Nicht maskiert — das macht die Anzeige.
 */
export function antwortFehler(httpStatus: number, daten: unknown): string {
  if (httpStatus === 401) return "Nicht angemeldet (HTTP 401)";
  if (istObjekt(daten)) {
    for (const feld of ["fehler", "error"]) {
      const wert = daten[feld];
      if (typeof wert === "string" && wert.trim()) return wert.trim();
    }
  }
  return `HTTP ${httpStatus}`;
}

export type ListenLesung =
  | { ok: true; zeilen: Record<string, unknown>[]; abgeschnitten: boolean; gelesenAm: string }
  | { ok: false; fehler: string };

/** Antwort von GET /api/content/liste. Erfolg nur bei 2xx mit Zeilenliste, Abschneide-Angabe und lesbarem Zeitpunkt. */
export function leseListenAntwort(httpStatus: number, daten: unknown): ListenLesung {
  if (httpStatus < 200 || httpStatus > 299) return { ok: false, fehler: antwortFehler(httpStatus, daten) };
  if (!istObjekt(daten) || !Array.isArray(daten.zeilen) || !daten.zeilen.every(istObjekt)) {
    return { ok: false, fehler: `Antwort ohne lesbare Zeilenliste (HTTP ${httpStatus})` };
  }
  if (typeof daten.abgeschnitten !== "boolean") {
    return { ok: false, fehler: `Antwort ohne Angabe, ob die Liste abgeschnitten ist (HTTP ${httpStatus})` };
  }
  if (typeof daten.gelesen_am !== "string" || !Number.isFinite(Date.parse(daten.gelesen_am))) {
    return { ok: false, fehler: `Antwort ohne lesbaren Zeitpunkt der Abfrage (HTTP ${httpStatus})` };
  }
  return { ok: true, zeilen: daten.zeilen, abgeschnitten: daten.abgeschnitten, gelesenAm: daten.gelesen_am };
}

export type EintragLesung =
  | { art: "zeile"; zeile: Record<string, unknown> }
  | { art: "keine" }
  | { art: "fehler"; fehler: string };

/**
 * Antwort von GET /api/content/eintrag/<id>. "keine" nur, wenn die Route die Zeile nicht fand (404 mit
 * fehler_art nicht_gefunden) — ein 404 ohne diese Angabe (etwa eine fehlende Route) ist ein Fehler.
 */
export function leseEintragAntwort(httpStatus: number, daten: unknown, id: number): EintragLesung {
  if (httpStatus === 404 && istObjekt(daten) && daten.fehler_art === "nicht_gefunden") return { art: "keine" };
  if (httpStatus < 200 || httpStatus > 299) return { art: "fehler", fehler: antwortFehler(httpStatus, daten) };
  const eintrag = istObjekt(daten) ? daten.eintrag : undefined;
  if (!istObjekt(eintrag) || eintrag.id !== id) {
    return { art: "fehler", fehler: `Antwort ohne die Zeile #${id} (HTTP ${httpStatus})` };
  }
  return { art: "zeile", zeile: eintrag };
}

/** id aus dem Pfad: positive ganze Zahl ohne führende Null, als sichere JS-Zahl; sonst null. */
export function leseContentId(roh: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(roh)) return null;
  const id = Number(roh);
  return Number.isSafeInteger(id) ? id : null;
}

/** Zeitpunkt der Stand-Zeile: Datum und Uhrzeit mit Sekunden, in der Zeitzone des Browsers wie die übrigen Zeiten der Seite. */
export function standZeit(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Zeitpunkt unlesbar" : d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" });
}
