// Objekt-Studio Schritt 7 (10.11.2026): Messplan — nur Typen und Lesen.
//
// Messplan und Basislinie stehen als Zeilen in studio_messplan (nur anhängbar, die DB-Uhr setzt
// festgeschrieben_am), nicht im Code: Das Repo ist öffentlich. Einträge kommen erst mit Schritt 11; dieser Code
// liest nur und schreibt nie.
// Regel der Anzeige: Je Eintrag gilt die jüngste Zeile, die vor dem Fensterstart
// festgeschrieben wurde. Spätere Zeilen der Arten regel, basislinie und luecke gelten nicht und stehen rot als
// Abweichung da — sonst ließe sich das Tor nach dem Start still verschieben. Für regel war das gesetzt;
// basislinie und luecke verschieben das Tor genauso (Setzung dieses Codes). Fensterstart ist von der ersten Zeile „fensterstart“
// mit gesetztem von; eine spätere fensterstart-Zeile ist ebenfalls eine Abweichung. zwischenstand, urteil1 und
// urteil2 entstehen erst nach dem Start: Je Art gilt die jüngste.
// Fehlt die Tabelle (PostgREST PGRST205, Postgres 42P01), heißt der Teil „nicht angelegt“ — nie 0, nie Fehler.

import "server-only";
import { ABFRAGE_TIMEOUT_MS, bereinigeFehler, isoOderNull, istObjekt } from "../status-server";
import type { createServiceClient } from "../supabase";
import type { StudioMesswert } from "./typen";

export const MESSPLAN_TABELLE = "studio_messplan";
export const QUELLE_MESSPLAN = "Supabase · studio_messplan";
export const MESSPLAN_SPALTEN = "id, objekt_slug, eintrag, von, bis, werte, abfrage, gemessen_am, quelle, festgeschrieben_am";

export const MESSPLAN_ARTEN = ["regel", "basislinie", "luecke", "fensterstart", "zwischenstand", "urteil1", "urteil2"] as const;
export type MessplanArt = (typeof MESSPLAN_ARTEN)[number];

/** Arten, die vor dem Fensterstart feststehen müssen; danach festgeschrieben sind sie eine Abweichung. */
const VOR_DEM_FENSTER: readonly MessplanArt[] = ["regel", "basislinie", "luecke"];

export interface MessplanZeile {
  id: number;
  eintrag: MessplanArt;
  von: string | null;
  bis: string | null;
  /** Nur Aggregate und Regeln (keine Lead-IDs, keine Personenadressen). */
  werte: Record<string, unknown>;
  abfrage: string | null;
  gemessen_am: string | null;
  quelle: string;
  festgeschrieben_am: string;
  /** gilt, abgeloest (eine jüngere gilt) oder abweichung (nach dem Fensterstart festgeschrieben). */
  lage: "gilt" | "abgeloest" | "abweichung";
}

export type MessplanStand =
  | { art: "nicht_angelegt"; code: string }
  | { art: "leer" }
  | { art: "eintraege"; fensterstart: string | null; zeilen: MessplanZeile[]; abweichungen: number };

/** Fehlercode einer fehlenden Tabelle: PGRST205 (Schema-Cache von PostgREST) oder 42P01 (Postgres). */
export function tabelleFehltCode(fehler: unknown): string | null {
  if (typeof fehler !== "object" || fehler === null) return null;
  const code = (fehler as { code?: unknown }).code;
  return code === "PGRST205" || code === "42P01" ? code : null;
}

class MessplanLeseFehler extends Error {}

function leseZeile(z: unknown): Omit<MessplanZeile, "lage"> {
  if (!istObjekt(z)) throw new MessplanLeseFehler("unerwartete Zeilenform");
  const id = typeof z.id === "number" ? z.id : typeof z.id === "string" && /^\d{1,15}$/.test(z.id) ? Number(z.id) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new MessplanLeseFehler("Eintrag ohne lesbare id");
  if (typeof z.eintrag !== "string" || !(MESSPLAN_ARTEN as readonly string[]).includes(z.eintrag)) throw new MessplanLeseFehler(`Eintrag ${id}: Art unlesbar`);
  if (!istObjekt(z.werte)) throw new MessplanLeseFehler(`Eintrag ${id}: werte unlesbar`);
  if (typeof z.quelle !== "string") throw new MessplanLeseFehler(`Eintrag ${id}: quelle unlesbar`);
  const fest = isoOderNull(z.festgeschrieben_am);
  if (fest === null) throw new MessplanLeseFehler(`Eintrag ${id}: festgeschrieben_am unlesbar`);
  const zeit = (feld: string): string | null => {
    const roh = z[feld];
    if (roh === null || roh === undefined) return null;
    const iso = isoOderNull(roh);
    if (iso === null) throw new MessplanLeseFehler(`Eintrag ${id}: ${feld} unlesbar`);
    return iso;
  };
  return {
    id,
    eintrag: z.eintrag as MessplanArt,
    von: zeit("von"),
    bis: zeit("bis"),
    werte: z.werte,
    abfrage: typeof z.abfrage === "string" ? z.abfrage : null,
    gemessen_am: zeit("gemessen_am"),
    quelle: z.quelle,
    festgeschrieben_am: fest,
  };
}

/** Stand des Messplans aus den gelesenen Zeilen (rein); wirft bei einer unlesbaren Zeile. */
export function messplanAusZeilen(roh: readonly unknown[]): MessplanStand {
  if (roh.length === 0) return { art: "leer" };
  const zeilen = roh.map(leseZeile).sort((a, b) => Date.parse(a.festgeschrieben_am) - Date.parse(b.festgeschrieben_am) || a.id - b.id);
  const start = zeilen.find((z) => z.eintrag === "fensterstart" && z.von !== null) ?? null;
  const fensterstart = start?.von ?? null;
  const nachStart = (z: (typeof zeilen)[number]) => fensterstart !== null && Date.parse(z.festgeschrieben_am) >= Date.parse(fensterstart);
  const lage = new Map<number, MessplanZeile["lage"]>();
  for (const z of zeilen) {
    // Nur die erste fensterstart-Zeile mit von gilt; jede weitere (oder eine ohne von) verschöbe das Fenster.
    if (z.eintrag === "fensterstart") lage.set(z.id, start !== null && z.id === start.id ? "gilt" : "abweichung");
    else if (VOR_DEM_FENSTER.includes(z.eintrag) && nachStart(z)) lage.set(z.id, "abweichung");
  }
  // Je Art die jüngste noch nicht eingeordnete Zeile gilt, ältere sind abgelöst.
  for (const art of MESSPLAN_ARTEN) {
    if (art === "fensterstart") continue;
    const offen = zeilen.filter((z) => z.eintrag === art && !lage.has(z.id));
    offen.forEach((z, i) => lage.set(z.id, i === offen.length - 1 ? "gilt" : "abgeloest"));
  }
  const mitLage = zeilen.map((z) => ({ ...z, lage: lage.get(z.id) ?? "abgeloest" }));
  return { art: "eintraege", fensterstart, zeilen: mitLage, abweichungen: mitLage.filter((z) => z.lage === "abweichung").length };
}

/**
 * Höchstzahl gelesener Messplan-Zeilen je Objekt. Gelesen wird aufsteigend (die Regel braucht den Fensterstart vor den
 * späteren Zeilen); gekappt würden also die jüngsten Zeilen — mögliche Abweichungen. Erreicht die Liste das Limit, gilt
 * der Teil als „fehler“ statt als vollständig (Review-Befund 2d, 10.11.2026). Unter dem Supabase-Standard von 1000
 * Zeilen (max-rows), damit auch eine Kappung durch die Datenbank auffällt.
 */
export const MESSPLAN_HOECHSTENS = 500;

/** Messplan eines Objekts lesen; jede Störung wird zum Teil "fehler", eine fehlende Tabelle zu „nicht angelegt“. */
export async function leseMessplan(client: ReturnType<typeof createServiceClient>, slug: string): Promise<StudioMesswert<MessplanStand>> {
  const versuchAm = new Date().toISOString();
  let antwort: { data: unknown; error: unknown };
  try {
    antwort = await client
      .from(MESSPLAN_TABELLE)
      .select(MESSPLAN_SPALTEN)
      .eq("objekt_slug", slug)
      .order("festgeschrieben_am", { ascending: true })
      .order("id", { ascending: true })
      .limit(MESSPLAN_HOECHSTENS)
      .abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
  } catch (e) {
    return { wert: null, status: "fehler", quelle: QUELLE_MESSPLAN, gemessen_am: versuchAm, hinweis: bereinigeFehler(e), fehler_art: "supabase" };
  }
  const gemessenAm = new Date().toISOString();
  if (antwort.error) {
    const code = tabelleFehltCode(antwort.error);
    if (code !== null) {
      return {
        wert: { art: "nicht_angelegt", code },
        status: "nicht_gemessen",
        quelle: QUELLE_MESSPLAN,
        gemessen_am: gemessenAm,
        hinweis: `Tabelle studio_messplan nicht angelegt (${code})`,
      };
    }
    return { wert: null, status: "fehler", quelle: QUELLE_MESSPLAN, gemessen_am: gemessenAm, hinweis: bereinigeFehler(antwort.error), fehler_art: "supabase" };
  }
  const zeilen: unknown[] = Array.isArray(antwort.data) ? antwort.data : [];
  if (zeilen.length >= MESSPLAN_HOECHSTENS) {
    return {
      wert: null,
      status: "fehler",
      quelle: QUELLE_MESSPLAN,
      gemessen_am: gemessenAm,
      hinweis: `${zeilen.length} oder mehr Einträge — nicht vollständig gelesen, Abweichungen nach dem Fensterstart nicht geprüft`,
      fehler_art: "supabase",
    };
  }
  let stand: MessplanStand;
  try {
    stand = messplanAusZeilen(zeilen);
  } catch (e) {
    if (!(e instanceof MessplanLeseFehler)) throw e;
    return { wert: null, status: "fehler", quelle: QUELLE_MESSPLAN, gemessen_am: gemessenAm, hinweis: `Zeile nicht lesbar: ${e.message}`, fehler_art: "supabase" };
  }
  if (stand.art === "leer") {
    return { wert: stand, status: "nicht_gemessen", quelle: QUELLE_MESSPLAN, gemessen_am: gemessenAm, hinweis: "noch kein Eintrag (Schritt 11)" };
  }
  return {
    wert: stand,
    status: stand.art === "eintraege" && stand.abweichungen > 0 ? "warnung" : "ok",
    quelle: QUELLE_MESSPLAN,
    gemessen_am: gemessenAm,
    ...(stand.art === "eintraege" && stand.abweichungen > 0 ? { hinweis: `${stand.abweichungen} Abweichung(en): nach dem Fensterstart festgeschrieben, gelten nicht` } : {}),
  };
}
