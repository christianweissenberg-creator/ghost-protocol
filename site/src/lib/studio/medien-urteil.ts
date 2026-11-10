// Objekt-Studio Schritt 8 (10.11.2026): Kette und Prüfprotokolle eines Videos lesen und die Medien-Regel anwenden —
// nur auf dem Server. Genutzt von der Prüfroute (POST …/medien/[id]/pruefung), vom Freigeben (POST /api/content/status
// für Zeilen mit metadata.medium_id) und von GET /api/studio/[objekt].
//
// Vor dem Freigeben wird die Export-Datei gestreamt nachgehasht (die Datenbank schützt die Zeilen, nicht die Dateien).
// Die Regel selbst ist rein (lib/medien-freigabe.ts); hier entstehen ihre Eingaben: die Zeilen aus studio_medium und
// studio_pruefung, das Anker-Manifest des Objekts und der festgelegte Wortlaut des KI-Hinweises.

import "server-only";
import { MEDIUM_ID_UNLESBAR, MEDIUM_KEIN_EXPORT, mediumIdAus } from "../freigabe-regeln";
import { pruefeMedienFreigabe } from "../medien-freigabe";
import type { MedienFreigabePruefung } from "../medien-freigabe";
import { ABFRAGE_TIMEOUT_MS, bereinigeFehler } from "../status-server";
import type { createServiceClient } from "../supabase";
import { MEDIUM_SPALTEN, PRUEFUNG_SPALTEN, StudioLeseFehler, jungeZuerst, leseMediumZeile, leseProtokollZeile, medienVorgaben } from "./lesen";
import { ablage, leseDatei } from "./medien-ablage";
import type { StudioMedium, StudioPruefung } from "./typen";

/** Wer ein Protokoll anlegt: Die Middleware kennt nur eine gültige Betreiber-Sitzung, keinen Namen (wie /api/content/status). */
export const DURCH = "betreiber-session";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type KettenLesung =
  | { art: "ok"; export: StudioMedium; original: StudioMedium | null; startbild: StudioMedium | null }
  | { art: "fehlt" }
  | { art: "fehler"; grund: string };

/**
 * Höchstzahl gelesener Prüfprotokolle je Medium. Gelesen wird jüngstes zuerst (geprueft_am, dann id, wie die Regel
 * wählt): Kappt die Datenbank die Liste (PostgREST max-rows) oder greift dieses Limit, fehlen nur ältere Protokolle —
 * das maßgebliche jüngste nie (Review-Befund 2a, 10.11.2026; vorher ohne Reihenfolge und Limit).
 */
export const PROTOKOLLE_JE_MEDIUM = 100;

export type ProtokollLesung = { art: "ok"; pruefungen: StudioPruefung[] } | { art: "fehler"; grund: string };

/**
 * Prüfprotokolle eines Mediums, jüngstes zuerst (höchstens PROTOKOLLE_JE_MEDIUM). signal: gemeinsames Zeitlimit des
 * Aufrufers (Stapel, Nachbesserung caption9-6); ohne eines ABFRAGE_TIMEOUT_MS für diese Abfrage.
 */
export async function leseProtokolle(client: ServiceClient, id: number, signal?: AbortSignal): Promise<ProtokollLesung> {
  try {
    const p = await client
      .from("studio_pruefung")
      .select(PRUEFUNG_SPALTEN)
      .eq("medium_id", id)
      .order("geprueft_am", { ascending: false })
      .order("id", { ascending: false })
      .limit(PROTOKOLLE_JE_MEDIUM)
      .abortSignal(signal ?? AbortSignal.timeout(ABFRAGE_TIMEOUT_MS));
    if (p.error) return { art: "fehler", grund: bereinigeFehler(p.error) };
    return { art: "ok", pruefungen: jungeZuerst((Array.isArray(p.data) ? (p.data as unknown[]) : []).map(leseProtokollZeile)) };
  } catch (e) {
    return { art: "fehler", grund: e instanceof StudioLeseFehler ? `Protokoll nicht lesbar: ${e.message}` : bereinigeFehler(e) };
  }
}

async function zeileNachId(client: ServiceClient, id: number, signal?: AbortSignal): Promise<StudioMedium | null> {
  const r = await client.from("studio_medium").select(MEDIUM_SPALTEN).eq("id", id).abortSignal(signal ?? AbortSignal.timeout(ABFRAGE_TIMEOUT_MS)).maybeSingle();
  if (r.error) throw new Error(bereinigeFehler(r.error));
  return r.data === null ? null : leseMediumZeile(r.data);
}

/**
 * Kette eines Mediums lesen: das Medium (für das Freigeben der Export), sein Original und dessen Startbild.
 * slug: nur Medien dieses Objekts (sonst "fehlt"); null = ohne Objektfilter. Die Prüfprotokolle liest leseProtokolle.
 * signal: gemeinsames Zeitlimit aller drei Abfragen (Stapel); ohne eines je Abfrage ABFRAGE_TIMEOUT_MS.
 */
export async function leseKette(client: ServiceClient, id: number, slug: string | null, signal?: AbortSignal): Promise<KettenLesung> {
  try {
    const ex = await zeileNachId(client, id, signal);
    if (ex === null || (slug !== null && ex.objekt_slug !== slug)) return { art: "fehlt" };
    const og = ex.abgeleitet_von === null ? null : await zeileNachId(client, ex.abgeleitet_von, signal);
    const original = og !== null && og.fassung === "original" && og.objekt_slug === ex.objekt_slug ? og : null;
    const sb = original === null || original.startbild_id === null ? null : await zeileNachId(client, original.startbild_id, signal);
    const startbild = sb !== null && sb.fassung === "startbild" && sb.objekt_slug === ex.objekt_slug ? sb : null;
    return { art: "ok", export: ex, original, startbild };
  } catch (e) {
    return { art: "fehler", grund: e instanceof StudioLeseFehler ? `Zeile nicht lesbar: ${e.message}` : bereinigeFehler(e) };
  }
}

export type DateiNachpruefung = { art: "gleich"; sha256: string } | { art: "abweichend"; grund: string } | { art: "fehler"; grund: string };

/** Datei eines Mediums gestreamt nachhashen: gleich SHA-256 und Größe der Zeile? */
export async function dateiNachpruefen(client: ServiceClient, m: StudioMedium): Promise<DateiNachpruefung> {
  const l = await leseDatei(ablage(client), m.speicher_pfad, { maxBytes: m.bytes });
  if (l.art === "fehler") return { art: "fehler", grund: `Datei nicht lesbar: ${bereinigeFehler(l.grund)}` };
  if (l.art === "fehlt") return { art: "abweichend", grund: `Datei von Medium ${m.id} fehlt im Speicher` };
  if (l.art === "zu_gross" || l.sha256 !== m.sha256 || l.bytes !== m.bytes) {
    return { art: "abweichend", grund: `Datei von Medium ${m.id} weicht vom gespeicherten SHA-256 ab` };
  }
  return { art: "gleich", sha256: l.sha256 };
}

export type MedienFreigabeLage =
  | { art: "frei"; beleg: { medium_id: number; medium_sha256: string; pruefung_id: number }; pruefung: MedienFreigabePruefung }
  | { art: "gesperrt"; grund: string; gruende: string[] }
  | { art: "lesefehler"; grund: string };

/**
 * Freigeben einer content-Zeile mit metadata.medium_id (POST /api/content/status): Medium lesen (gleiches Objekt wie die
 * Zeile), Export-Datei nachhashen, dann erst die Prüfprotokolle lesen und die Medien-Regel anwenden. Nur "frei" erlaubt
 * den Übergang; der Beleg nennt medium_id, den nachgemessenen SHA-256 und das maßgebliche Prüfprotokoll.
 * Die Protokolle kommen nach dem Nachhashen (bis zu DATEI_TIMEOUT_MS), damit ein in dieser Zeit gespeichertes Protokoll
 * zählt (Review-Befund 3, 10.11.2026; vorher davor gelesen). Ein Medium, das kein Export ist, sperrt vor dem Nachhashen
 * (Nachbesserung caption9-2: sonst hasht der Server etwa ein 15-MB-Original, ehe die Regel es abweist).
 */
export async function mediumZurFreigabe(client: ServiceClient, metadata: Record<string, unknown>): Promise<MedienFreigabeLage> {
  const m = mediumIdAus(metadata.medium_id);
  const id = m.video ? m.id : null;
  if (id === null) return { art: "gesperrt", grund: MEDIUM_ID_UNLESBAR, gruende: [MEDIUM_ID_UNLESBAR] };
  const slug = typeof metadata.objekt_slug === "string" ? metadata.objekt_slug : null;
  const k = await leseKette(client, id, null);
  if (k.art === "fehler") return { art: "lesefehler", grund: k.grund };
  if (k.art === "fehlt") return { art: "gesperrt", grund: `Medium ${id} nicht gefunden`, gruende: [`Medium ${id} nicht gefunden`] };
  if (slug === null || k.export.objekt_slug !== slug) {
    const grund = `Medium ${id} gehört nicht zum Objekt dieser Zeile`;
    return { art: "gesperrt", grund, gruende: [grund] };
  }
  if (k.export.fassung !== "export") return { art: "gesperrt", grund: MEDIUM_KEIN_EXPORT, gruende: [MEDIUM_KEIN_EXPORT] };
  const datei = await dateiNachpruefen(client, k.export);
  if (datei.art === "fehler") return { art: "lesefehler", grund: datei.grund };
  if (datei.art === "abweichend") return { art: "gesperrt", grund: datei.grund, gruende: [datei.grund] };
  const p = await leseProtokolle(client, id);
  if (p.art === "fehler") return { art: "lesefehler", grund: p.grund };
  const r = pruefeMedienFreigabe({ export: k.export, original: k.original, startbild: k.startbild }, p.pruefungen, medienVorgaben(k.export.objekt_slug));
  if (!r.freigebbar || r.pruefung_id === null) return { art: "gesperrt", grund: r.grund ?? "Medien-Regel sperrt", gruende: r.gruende };
  return { art: "frei", beleg: { medium_id: id, medium_sha256: datei.sha256, pruefung_id: r.pruefung_id }, pruefung: r };
}
