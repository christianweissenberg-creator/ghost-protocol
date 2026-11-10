// Medien-Freigaberegel — Objekt-Studio Stufe 2, Schritt 8 (10.11.2026).
//
// Reine Funktion ohne Laufzeit-Importe (wie lib/freigabe-regeln.ts): Sie läuft auf dem Server (Freigeben in
// /api/content/status, Prüfprotokoll, Studio-Route) und könnte im Browser laufen. Maßgeblich ist der Server.
// Fail-closed: Jeder unlesbare Wert sperrt. Sie liefert ALLE Gründe in der Reihenfolge der Bedingungen; der erste
// ist der Sperrgrund für Stapel und Freigeben.
//
// Freigebbar ist ein Video nur, wenn jede Bedingung gilt:
// 1. Das Medium ist ein Export, verweist auf sein Original, und beide tragen dieselbe job_id.
// 2. Es gibt ein Prüfprotokoll zu diesem Export; das jüngste zählt (DB-Uhr, bei Gleichstand die höhere id), und sein
//    medium_sha256 ist gleich dem SHA-256 des Exports.
// 3. Jede Prompt-Klausel des Originals steht genau einmal im Protokoll und ist bestanden; keine fehlt.
// 4. Anker-Abgleich (Architektur, Personen, Wasser) bestanden.
// 5. KI-Hinweis laut Protokoll vom ersten bis zum letzten Bild eingebrannt, und der Hinweis im Export hat genau den
//    festgelegten Wortlaut (vorgaben.ki_hinweis_bild).
// 6. Durchsicht in voller Bildrate erklärt — eine Erklärung des Prüfers; belegt ist nur, dass sie aus einer
//    Betreiber-Sitzung kam und welches Kürzel angegeben wurde.
// 7. Schnittfenster gesetzt mit 0 ≤ von < bis ≤ Dauer des Originals.
// 8. Der Anker steht im Manifest als zulässiger Anker, sein Hash ist gleich dem Manifest, und das Original verweist
//    auf ein Startbild mit bestandenem Startbild-Abgleich.
// 9. Rechte laut Protokoll geklärt, mit Nachweis-Verweis.
// Die Bedingungen 3–6 und 9 lesen das maßgebliche Protokoll. Fehlt es oder gilt es einer anderen Datei, steht nur der
// Grund aus Bedingung 2 da (ein Protokoll zu einer anderen Datei sagt über diese nichts).

import type { AnkerEintrag } from "./studio/anker";

export interface MedienRegelVorgaben {
  /** Einträge des Anker-Manifests des Objekts; null = kein Manifest (Bedingung 8 sperrt). */
  anker: ReadonlyArray<Pick<AnkerEintrag, "id" | "sha256" | "als_anker">> | null;
  /** Festgelegter Wortlaut des eingebrannten Hinweises (lib/studio/ki-hinweis.ts, KI_HINWEIS_BILD). */
  ki_hinweis_bild: string;
}

export interface MedienFreigabePruefung {
  freigebbar: boolean;
  /** Alle Gründe in der Reihenfolge der Bedingungen 1–9; leer = freigebbar. */
  gruende: string[];
  /** Erster Grund (Sperrgrund); null = freigebbar. */
  grund: string | null;
  /** id des maßgeblichen Prüfprotokolls (jüngstes, zur Datei passend); null ohne. */
  pruefung_id: number | null;
  /** id und SHA-256 des Exports, wie gelesen; null, wenn nicht lesbar. */
  medium_id: number | null;
  medium_sha256: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;

function istEintrag(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Positive ganze Zahl (auch als Ziffernfolge); sonst null. */
function ganz(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && /^\d{1,15}$/.test(x) ? Number(x) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Endliche Zahl (auch als Dezimal-Text, wie NUMERIC); sonst null. */
function zahl(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function text(x: unknown): string | null {
  return typeof x === "string" && x.trim() !== "" ? x : null;
}

interface Protokoll {
  id: number;
  zeit: number;
  eintrag: Record<string, unknown>;
}

/**
 * Das jüngste lesbare Protokoll zu diesem Export. unlesbar = true, wenn ein Eintrag der Liste nicht zuzuordnen ist
 * oder ein Protokoll dieses Exports keine lesbare id bzw. Zeit trägt — dann ist „das jüngste“ nicht sicher bestimmbar.
 */
function juengstes(pruefungen: unknown, exportId: number | null): { protokoll: Protokoll | null; unlesbar: boolean } {
  if (!Array.isArray(pruefungen)) return { protokoll: null, unlesbar: true };
  let best: Protokoll | null = null;
  for (const p of pruefungen as unknown[]) {
    if (!istEintrag(p) || ganz(p.medium_id) === null) return { protokoll: null, unlesbar: true };
    if (exportId === null || ganz(p.medium_id) !== exportId) continue;
    const id = ganz(p.id);
    const zeit = typeof p.geprueft_am === "string" ? Date.parse(p.geprueft_am) : Number.NaN;
    if (id === null || !Number.isFinite(zeit)) return { protokoll: null, unlesbar: true };
    if (best === null || zeit > best.zeit || (zeit === best.zeit && id > best.id)) best = { id, zeit, eintrag: p };
  }
  return { protokoll: best, unlesbar: false };
}

/**
 * Darf dieses Video freigegeben werden? kette = { export, original, startbild } (Zeilen aus studio_medium, ungeprüft),
 * pruefungen = Zeilen aus studio_pruefung (ungeprüft; nur die des Exports zählen), vorgaben = Manifest und Wortlaut.
 */
export function pruefeMedienFreigabe(kette: unknown, pruefungen: unknown, vorgaben: MedienRegelVorgaben): MedienFreigabePruefung {
  const g: string[] = [];
  const k = istEintrag(kette) ? kette : {};
  const ex = istEintrag(k.export) ? k.export : null;
  const og = istEintrag(k.original) ? k.original : null;
  const sb = istEintrag(k.startbild) ? k.startbild : null;
  const exId = ex ? ganz(ex.id) : null;
  const exSha = ex && typeof ex.sha256 === "string" && HEX64.test(ex.sha256) ? ex.sha256 : null;

  // 1. Export mit Original derselben job_id
  if (ex === null || exId === null || exSha === null) g.push("Export nicht lesbar (id oder SHA-256 fehlt)");
  else if (ex.fassung !== "export") g.push("Medium ist kein Export");
  else if (ganz(ex.abgeleitet_von) === null) g.push("Export ohne Verweis auf sein Original");
  else if (og === null || ganz(og.id) !== ganz(ex.abgeleitet_von) || og.fassung !== "original") g.push("Original des Exports fehlt");
  else if (text(og.job_id) === null || og.job_id !== ex.job_id) g.push("Original und Export tragen nicht dieselbe job_id");

  // 2. Jüngstes Protokoll mit passendem Hash
  const { protokoll, unlesbar } = juengstes(pruefungen, exId);
  let p: Record<string, unknown> | null = null;
  if (unlesbar) g.push("Prüfprotokolle nicht lesbar");
  else if (protokoll === null) g.push("Prüfprotokoll fehlt");
  else if (exSha === null || protokoll.eintrag.medium_sha256 !== exSha) g.push("Jüngstes Prüfprotokoll gilt einer anderen Datei (SHA-256 weicht ab)");
  else p = protokoll.eintrag;

  // 3. Jede Klausel des Originals bestanden
  if (p !== null) {
    const soll = og !== null && Array.isArray(og.prompt_klauseln) ? (og.prompt_klauseln as unknown[]) : null;
    const ist = Array.isArray(p.klauseln) ? (p.klauseln as unknown[]) : null;
    if (soll === null || soll.length === 0 || !soll.every((s) => istEintrag(s) && text(s.id) !== null)) g.push("Prompt-Klauseln des Originals fehlen oder sind nicht lesbar");
    else if (ist === null) g.push("Klauseln im Prüfprotokoll nicht lesbar");
    else {
      for (const s of soll as Record<string, unknown>[]) {
        const treffer = ist.filter((e) => istEintrag(e) && e.id === s.id) as Record<string, unknown>[];
        if (treffer.length === 0) g.push(`Klausel „${s.id}“ fehlt im Prüfprotokoll`);
        else if (treffer.length > 1) g.push(`Klausel „${s.id}“ steht mehrfach im Prüfprotokoll`);
        else if (treffer[0].bestanden !== true) g.push(`Klausel „${s.id}“ nicht bestanden`);
      }
    }
  }

  // 4. Anker-Abgleich
  if (p !== null && p.anker_abgleich !== "bestanden") g.push("Anker-Abgleich nicht bestanden (Architektur, Personen, Wasser)");

  // 5. KI-Hinweis eingebrannt und im festgelegten Wortlaut
  if (p !== null && p.ki_hinweis_eingebrannt !== true) g.push("KI-Hinweis nicht vom ersten bis zum letzten Bild eingebrannt (laut Prüfprotokoll)");
  if (ex === null || ex.ki_hinweis_text !== vorgaben.ki_hinweis_bild) g.push("KI-Hinweis im Bild hat nicht den festgelegten Wortlaut");

  // 6. Durchsicht in voller Bildrate
  if (p !== null && p.durchsicht_volle_bildrate !== true) g.push("Durchsicht in voller Bildrate nicht erklärt");

  // 7. Schnittfenster im Original
  const von = ex ? zahl(ex.schnitt_von_s) : null;
  const bis = ex ? zahl(ex.schnitt_bis_s) : null;
  const dauer = og ? zahl(og.dauer_s) : null;
  if (von === null || bis === null || dauer === null || !(von >= 0 && von < bis && bis <= dauer)) {
    g.push("Schnittfenster fehlt oder liegt nicht im Original (0 ≤ von < bis ≤ Dauer)");
  }

  // 8. Anker im Manifest, Hash gleich, Startbild-Abgleich bestanden
  const ankerId = ex ? text(ex.anker_id) : null;
  const anker = ankerId === null || vorgaben.anker === null ? undefined : vorgaben.anker.find((e) => e.id === ankerId);
  if (anker === undefined || !anker.als_anker) g.push(`Anker „${ankerId ?? "ohne Kennung"}“ steht nicht als zulässiger Anker im Manifest`);
  else if (ex === null || ex.anker_sha256 !== anker.sha256) g.push("Anker-Hash des Exports weicht vom Manifest ab");
  if (og !== null && (og.anker_id !== ankerId || (sb !== null && sb.anker_id !== ankerId))) g.push("Export, Original und Startbild nennen verschiedene Anker");
  if (og === null || ganz(og.startbild_id) === null || sb === null || ganz(sb.id) !== ganz(og.startbild_id) || sb.fassung !== "startbild") {
    g.push("Startbild des Originals fehlt");
  } else if (sb.startbild_abgleich !== "bestanden") {
    const max = zahl(sb.startbild_abweichung_max);
    g.push(`Startbild-Abgleich nicht bestanden${max === null ? "" : ` (größte Abweichung ${max})`}`);
  }

  // 9. Rechte geklärt mit Nachweis
  if (p !== null) {
    if (p.rechte_status !== "geklaert") g.push("Rechte laut Prüfprotokoll nicht geklärt");
    else if (text(p.rechte_nachweis) === null) g.push("Rechte als geklärt vermerkt, aber ohne Nachweis-Verweis");
  }

  return {
    freigebbar: g.length === 0,
    gruende: g,
    grund: g[0] ?? null,
    pruefung_id: p !== null && protokoll !== null ? protokoll.id : null,
    medium_id: exId,
    medium_sha256: exSha,
  };
}
