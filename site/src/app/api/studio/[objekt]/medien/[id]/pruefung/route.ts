import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ABFRAGE_TIMEOUT_MS, KEIN_CACHE, bereinigeFehler, istZeitueberschreitung, pruefeAnfrageHerkunft } from "@/lib/status-server";
import { pruefeMedienFreigabe } from "@/lib/medien-freigabe";
import { medienVorgaben } from "@/lib/studio/lesen";
import { istObjekt } from "@/lib/studio/medien";
import { leseJsonKoerper, medienClient } from "@/lib/studio/medien-ablage";
import { MedienAbbruch, abweisung, alsAbweisung, studioSlug } from "@/lib/studio/medien-ablauf";
import { DURCH, dateiNachpruefen, leseKette } from "@/lib/studio/medien-urteil";

// POST /api/studio/[objekt]/medien/[id]/pruefung — Prüfprotokoll zum Export eines Videos (Objekt-Studio Schritt 8,
// 10.11.2026). Das Protokoll ist nur anhängbar; das jüngste zählt.
//
// Eingabe (JSON bis 1 MB): medium_sha256, pruefer_kuerzel (2–6 Buchstaben, Angabe, keine Authentisierung), klauseln
// [{id, bestanden}] — jede Prompt-Klausel des Originals genau einmal —, anker_abgleich (bestanden/nicht_bestanden aus
// Architektur, Personen und Wasser), ki_hinweis_eingebrannt, durchsicht_volle_bildrate, rechte_status (offen/geklaert),
// rechte_nachweis (Verweis, Pflicht bei geklaert; der Prüfer tippt ihn ein), notiz.
// - Das Medium muss ein Export dieses Objekts sein (404 bzw. 400).
// - medium_sha256 muss gleich dem gespeicherten Hash sein (409), und die Datei wird vorher gestreamt nachgehasht (409,
//   wenn sie abweicht oder fehlt): geprüft ist nur, was gerade im Speicher liegt.
// - urteil berechnet der Server mit der Medien-Regel (bestanden = freigebbar mit diesem Protokoll); der Browser sendet
//   kein urteil und kein durch (400). durch ist die Konstante „betreiber-session“.
// - id und geprueft_am setzt die Datenbank.
// Antwort: pruefung_id, urteil, gruende (alle Gründe der Regel), geprueft_am.
// Fehler: 403/415 Herkunft, 400 Eingabe, 404 unbekannt, 409 Hash, 413 zu groß, 500 Schreibfehler, 502 Supabase/Storage.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FELDER = [
  "medium_sha256",
  "pruefer_kuerzel",
  "klauseln",
  "anker_abgleich",
  "ki_hinweis_eingebrannt",
  "durchsicht_volle_bildrate",
  "rechte_status",
  "rechte_nachweis",
  "notiz",
] as const;

interface Eingabe {
  medium_sha256: string;
  pruefer_kuerzel: string;
  klauseln: Array<{ id: string; bestanden: boolean }>;
  anker_abgleich: "bestanden" | "nicht_bestanden";
  ki_hinweis_eingebrannt: boolean;
  durchsicht_volle_bildrate: boolean;
  rechte_status: "offen" | "geklaert";
  rechte_nachweis: string | null;
  notiz: string | null;
}

function zeichen(t: string): number {
  return Array.from(t).length;
}

function leseEingabe(roh: unknown): Eingabe {
  if (!istObjekt(roh)) throw new MedienAbbruch(400, "eingabe", "Anfrage muss ein JSON-Objekt sein");
  const fremd = Object.keys(roh).find((k) => !(FELDER as readonly string[]).includes(k));
  if (fremd !== undefined) {
    const grund = fremd === "urteil" || fremd === "durch" ? `${fremd} setzt der Server, nicht der Browser` : `unbekanntes Feld ${fremd}`;
    throw new MedienAbbruch(400, "eingabe", grund);
  }
  if (typeof roh.medium_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(roh.medium_sha256)) throw new MedienAbbruch(400, "eingabe", "medium_sha256: 64 Hex-Zeichen");
  if (typeof roh.pruefer_kuerzel !== "string" || !/^[A-Za-z]{2,6}$/.test(roh.pruefer_kuerzel)) throw new MedienAbbruch(400, "eingabe", "pruefer_kuerzel: 2 bis 6 Buchstaben");
  if (!Array.isArray(roh.klauseln) || roh.klauseln.length === 0 || roh.klauseln.length > 50) throw new MedienAbbruch(400, "eingabe", "klauseln: Liste mit 1 bis 50 Einträgen");
  const klauseln = (roh.klauseln as unknown[]).map((k) => {
    if (!istObjekt(k) || Object.keys(k).some((s) => s !== "id" && s !== "bestanden") || typeof k.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(k.id) || typeof k.bestanden !== "boolean") {
      throw new MedienAbbruch(400, "eingabe", "klauseln: je Eintrag {id, bestanden}");
    }
    return { id: k.id, bestanden: k.bestanden };
  });
  if (roh.anker_abgleich !== "bestanden" && roh.anker_abgleich !== "nicht_bestanden") throw new MedienAbbruch(400, "eingabe", "anker_abgleich: bestanden oder nicht_bestanden");
  if (typeof roh.ki_hinweis_eingebrannt !== "boolean") throw new MedienAbbruch(400, "eingabe", "ki_hinweis_eingebrannt: true oder false");
  if (typeof roh.durchsicht_volle_bildrate !== "boolean") throw new MedienAbbruch(400, "eingabe", "durchsicht_volle_bildrate: true oder false");
  if (roh.rechte_status !== "offen" && roh.rechte_status !== "geklaert") throw new MedienAbbruch(400, "eingabe", "rechte_status: offen oder geklaert");
  const nachweis = roh.rechte_nachweis === undefined || roh.rechte_nachweis === null ? null : roh.rechte_nachweis;
  if (nachweis !== null && (typeof nachweis !== "string" || zeichen(nachweis) > 300)) throw new MedienAbbruch(400, "eingabe", "rechte_nachweis: Text bis 300 Zeichen");
  if (roh.rechte_status === "geklaert" && (nachweis === null || nachweis.trim() === "")) {
    throw new MedienAbbruch(400, "eingabe", "rechte_status geklaert nur mit Nachweis-Verweis");
  }
  const notiz = roh.notiz === undefined || roh.notiz === null ? null : roh.notiz;
  if (notiz !== null && (typeof notiz !== "string" || zeichen(notiz) > 1000)) throw new MedienAbbruch(400, "eingabe", "notiz: Text bis 1000 Zeichen");
  return {
    medium_sha256: roh.medium_sha256,
    pruefer_kuerzel: roh.pruefer_kuerzel,
    klauseln,
    anker_abgleich: roh.anker_abgleich,
    ki_hinweis_eingebrannt: roh.ki_hinweis_eingebrannt,
    durchsicht_volle_bildrate: roh.durchsicht_volle_bildrate,
    rechte_status: roh.rechte_status,
    rechte_nachweis: nachweis === null || nachweis.trim() === "" ? null : nachweis,
    notiz: notiz === null || notiz.trim() === "" ? null : notiz,
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ objekt: string; id: string }> }) {
  try {
    const herkunft = pruefeAnfrageHerkunft(request.headers);
    if (herkunft) return abweisung(herkunft.status, herkunft.fehler, "herkunft");
    const { objekt, id: idRoh } = await params;
    const slug = studioSlug(objekt);
    if (!/^[1-9]\d{0,14}$/.test(idRoh)) throw new MedienAbbruch(400, "eingabe", "Medium-Kennung: positive ganze Zahl");
    const id = Number(idRoh);
    const koerper = await leseJsonKoerper(request);
    if (koerper.art === "zu_gross") throw new MedienAbbruch(413, "zu_gross", "Anfrage größer als 1 MB");
    if (koerper.art === "ungueltig") throw new MedienAbbruch(400, "eingabe", "Anfrage ist kein gültiges JSON");
    const e = leseEingabe(koerper.wert);

    let client: ReturnType<typeof createServiceClient>;
    try {
      client = medienClient();
    } catch (err) {
      throw new MedienAbbruch(502, "quelle", `Supabase nicht nutzbar: ${bereinigeFehler(err)}`);
    }
    const k = await leseKette(client, id, slug);
    if (k.art === "fehlt") throw new MedienAbbruch(404, "nicht_gefunden", `Medium ${id} gehört nicht zu diesem Objekt oder besteht nicht`);
    if (k.art === "fehler") throw new MedienAbbruch(502, "quelle", `Medium nicht lesbar: ${k.grund}`);
    if (k.export.fassung !== "export") throw new MedienAbbruch(400, "eingabe", "Ein Prüfprotokoll gilt dem Export eines Videos");
    if (e.medium_sha256 !== k.export.sha256) throw new MedienAbbruch(409, "zustand", "medium_sha256 passt nicht zur gespeicherten Datei");
    const datei = await dateiNachpruefen(client, k.export);
    if (datei.art === "fehler") throw new MedienAbbruch(502, "quelle", datei.grund);
    if (datei.art === "abweichend") throw new MedienAbbruch(409, "zustand", `${datei.grund} — nicht geprüft`);
    if (k.original === null) throw new MedienAbbruch(409, "zustand", "Original des Exports fehlt — Klauseln nicht prüfbar");
    const soll = k.original.prompt_klauseln.map((x) => x.id);
    const ist = e.klauseln.map((x) => x.id);
    const fehlend = soll.filter((s) => !ist.includes(s));
    const fremd = ist.filter((s, i) => !soll.includes(s) || ist.indexOf(s) !== i);
    if (soll.length === 0 || fehlend.length > 0 || fremd.length > 0) {
      throw new MedienAbbruch(400, "eingabe", `klauseln: jede Prompt-Klausel genau einmal (fehlt: ${fehlend.join(", ") || "—"}; fremd oder doppelt: ${fremd.join(", ") || "—"})`);
    }

    // Urteil vom Server: die Regel mit diesem Protokoll als jüngstem.
    const kandidat = { id: 1, medium_id: id, geprueft_am: new Date().toISOString(), ...e };
    const r = pruefeMedienFreigabe({ export: k.export, original: k.original, startbild: k.startbild }, [kandidat], medienVorgaben(slug));
    const zeile = { medium_id: id, durch: DURCH, ...e, urteil: r.freigebbar ? "bestanden" : "nicht_bestanden" };
    const res = await client.from("studio_pruefung").insert(zeile).select("id, geprueft_am").abortSignal(AbortSignal.timeout(ABFRAGE_TIMEOUT_MS)).single();
    if (res.error) {
      if (res.error.code === "23503") throw new MedienAbbruch(409, "zustand", `Medium ${id}: Hash passt nicht zur Zeile (Fremdschlüssel)`);
      // postgrest-js liefert einen Abbruch als error (Review-Befund 5): Das Protokoll kann trotzdem gespeichert sein.
      if (istZeitueberschreitung(res.error)) {
        throw new MedienAbbruch(500, "schreibfehler", `Prüfprotokoll: ${bereinigeFehler(res.error)} — Ausgang unbekannt; erst neu laden, ein zweites Protokoll schadet nicht (das jüngste zählt)`);
      }
      throw new MedienAbbruch(500, "schreibfehler", `Prüfprotokoll nicht gespeichert: ${bereinigeFehler(res.error)}`);
    }
    const daten: Record<string, unknown> = istObjekt(res.data) ? res.data : {};
    return NextResponse.json(
      { pruefung_id: daten.id ?? null, urteil: zeile.urteil, gruende: r.gruende, geprueft_am: daten.geprueft_am ?? null },
      { headers: KEIN_CACHE },
    );
  } catch (err) {
    return alsAbweisung(err, "Prüfprotokoll nicht möglich");
  }
}
