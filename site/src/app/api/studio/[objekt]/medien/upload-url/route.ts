import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { KEIN_CACHE, bereinigeFehler, pruefeAnfrageHerkunft } from "@/lib/status-server";
import { DATEI_MAX_BYTES, MIME_JE_ROLLE, eingangPfad, istMime, istObjekt, istUploadRolle } from "@/lib/studio/medien";
import { ablage, medienClient, raeumeAuf, sperreBelegt } from "@/lib/studio/medien-ablage";
import type { Aufraeumung } from "@/lib/studio/medien-ablage";
import { MedienAbbruch, abweisung, alsAbweisung, studioSlug } from "@/lib/studio/medien-ablauf";
import { leseJsonKoerper } from "@/lib/studio/medien-ablage";
import type { MediumMime, UploadRolle } from "@/lib/studio/typen";

// POST /api/studio/[objekt]/medien/upload-url — signierte Upload-URLs für den privaten Bucket „studio“
// (Objekt-Studio Schritt 7, 10.11.2026).
//
// Der Browser lädt jede Datei direkt in den Storage (PUT auf die signierte URL), nicht durch Next: Mit Middleware
// puffert Next den Körper nur bis 10.485.760 B und schneidet darüber still ab; das Original der Probe hat
// 15.199.760 B. Eingabe {dateien: [{rolle, bytes, mime}]} mit rolle startbild, original, export oder abgleich
// (je höchstens einmal). Antwort je Datei pfad (eingang/<uuid>.<endung>), token und signedUrl aus
// createSignedUploadUrl — ohne upsert: Der Token darf nichts überschreiben. Der Server erzeugt den Pfad; der Browser
// wählt keinen. Vor dem Ausstellen räumt die Route Reste unter eingang/ und arbeit/ auf, die älter als 2 h sind —
// nur, wenn gerade kein Prüf- oder Einspiel-Job läuft.
// Fehler: 403/415 fremde Herkunft (vor dem Lesen des Körpers), 400 Eingabe, 404 Objekt nicht im Studio, 413 über
// 50.000.000 B angekündigt oder JSON über 1 MB, 415 MIME passt nicht zur Rolle, 502 Storage.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Wunsch {
  rolle: UploadRolle;
  bytes: number;
  mime: MediumMime;
}

function leseWuensche(roh: unknown): Wunsch[] {
  if (!istObjekt(roh) || Object.keys(roh).some((k) => k !== "dateien")) throw new MedienAbbruch(400, "eingabe", "Anfrage: {dateien: [{rolle, bytes, mime}]}");
  const dateien = roh.dateien;
  if (!Array.isArray(dateien) || dateien.length === 0 || dateien.length > 4) throw new MedienAbbruch(400, "eingabe", "dateien: Liste mit 1 bis 4 Einträgen");
  const aus: Wunsch[] = [];
  for (const d of dateien as unknown[]) {
    if (!istObjekt(d) || Object.keys(d).some((k) => !["rolle", "bytes", "mime"].includes(k))) throw new MedienAbbruch(400, "eingabe", "dateien: je Eintrag {rolle, bytes, mime}");
    if (!istUploadRolle(d.rolle)) throw new MedienAbbruch(400, "eingabe", "rolle: startbild, original, export oder abgleich");
    const rolle = d.rolle;
    if (aus.some((w) => w.rolle === rolle)) throw new MedienAbbruch(400, "eingabe", `rolle ${rolle} doppelt`);
    if (typeof d.bytes !== "number" || !Number.isSafeInteger(d.bytes) || d.bytes < 1) throw new MedienAbbruch(400, "eingabe", `${rolle}: bytes als ganze Zahl ≥ 1`);
    if (d.bytes > DATEI_MAX_BYTES) throw new MedienAbbruch(413, "zu_gross", `${rolle}: ${d.bytes.toLocaleString("de-DE")} B angekündigt, höchstens ${DATEI_MAX_BYTES.toLocaleString("de-DE")} B`);
    if (!istMime(d.mime) || !MIME_JE_ROLLE[rolle].includes(d.mime)) {
      throw new MedienAbbruch(415, "dateityp", `${rolle}: MIME ${typeof d.mime === "string" ? d.mime : "fehlt"} passt nicht (erlaubt: ${MIME_JE_ROLLE[rolle].join(", ")})`);
    }
    aus.push({ rolle, bytes: d.bytes, mime: d.mime });
  }
  return aus;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ objekt: string }> }) {
  try {
    const herkunft = pruefeAnfrageHerkunft(request.headers);
    if (herkunft) return abweisung(herkunft.status, herkunft.fehler, "herkunft");
    const slug = studioSlug((await params).objekt);
    const koerper = await leseJsonKoerper(request);
    if (koerper.art === "zu_gross") throw new MedienAbbruch(413, "zu_gross", "Anfrage größer als 1 MB");
    if (koerper.art === "ungueltig") throw new MedienAbbruch(400, "eingabe", "Anfrage ist kein gültiges JSON");
    const wuensche = leseWuensche(koerper.wert);

    let client: ReturnType<typeof createServiceClient>;
    try {
      client = medienClient();
    } catch (e) {
      throw new MedienAbbruch(502, "quelle", `Supabase nicht nutzbar: ${bereinigeFehler(e)}`);
    }
    const a = ablage(client);
    const aufgeraeumt: Aufraeumung | null = sperreBelegt() ? null : await raeumeAuf(a);

    const dateien: Array<Wunsch & { pfad: string; token: string; signedUrl: string }> = [];
    for (const w of wuensche) {
      const pfad = eingangPfad(randomUUID(), w.mime);
      let antwort: Awaited<ReturnType<typeof a.createSignedUploadUrl>>;
      try {
        antwort = await a.createSignedUploadUrl(pfad);
      } catch (e) {
        throw new MedienAbbruch(502, "quelle", `Upload-URL für ${w.rolle} nicht ausgestellt: ${bereinigeFehler(e)}`);
      }
      if (antwort.error || !antwort.data) {
        throw new MedienAbbruch(502, "quelle", `Upload-URL für ${w.rolle} nicht ausgestellt: ${bereinigeFehler(antwort.error ?? "ohne Antwort")}`);
      }
      dateien.push({ ...w, pfad, token: antwort.data.token, signedUrl: antwort.data.signedUrl });
    }
    return NextResponse.json(
      {
        objekt_slug: slug,
        erzeugt_am: new Date().toISOString(),
        dateien,
        aufgeraeumt: aufgeraeumt === null ? null : { geloescht: aufgeraeumt.geloescht, fehler: aufgeraeumt.fehler === null ? null : bereinigeFehler(aufgeraeumt.fehler) },
      },
      { headers: KEIN_CACHE },
    );
  } catch (e) {
    return alsAbweisung(e, "Upload-URL nicht ausstellbar");
  }
}
