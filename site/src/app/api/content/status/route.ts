import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { werteCounselAus } from "@/lib/counsel-urteil";
import { geprueftenTextAusSchritten, pruefeFreigabe } from "@/lib/freigabe-regeln";
import { bereinigeFehler, pruefeAnfrageHerkunft } from "@/lib/status-server";

// Content-Freigabe-Aktionen: Übergänge zwischen den Status der content-Tabelle.
// Auth über die bestehende Middleware (Session-Cookie) — hier keine Zusatzprüfung.
//
// Stufe 1 (05.11.2026):
// - Übergang atomar: update(...).eq("id").eq("status", <erwarteter Ausgangsstatus>) mit
//   select. Ändert sich der Status zwischen Lesen und Schreiben (zweiter Tab, Doppelklick),
//   trifft das Update 0 Zeilen → 409, statt eine fremde Entscheidung zu überschreiben.
// - Die Betreiber-Entscheidung steht als Beleg in metadata (vorher gelesen, zusammengeführt,
//   im selben bedingten Update geschrieben).
// - Fehler heißen "fehler" (wie die übrigen Stufe-1-Verträge) und werden von der
//   Content-Ansicht sichtbar gemacht.
//
// Fixrunde 06.11.2026:
// - R4: "freigeben" prüft serverseitig mit pruefeFreigabe() (lib/freigabe-regeln.ts) das aus
//   review_notes abgeleitete COUNSEL-Urteil und den Freigabetext (body). Sperrt die Prüfung,
//   antwortet die Route 409 { fehler: <Sperrgrund> } und schreibt nichts. Der Beleg
//   metadata.freigabe hält Urteil, URTEIL-Zeile, SHA-256 und Länge des freigegebenen Texts
//   fest. Einen Override für Altzeilen gibt es nicht (Entscheidung des Inhabers steht aus).
// - R18: Jedes Update ist zusätzlich an updated_at der gelesenen Fassung gebunden. Zwei
//   gleichzeitige Erfassungen ("metriken" bleibt auf "gepostet") überschreiben sich damit
//   nicht mehr still: die zweite trifft 0 Zeilen → 409. updated_at pflegt laut
//   scripts/setup_supabase_v2.sql:339-342 ein BEFORE-UPDATE-Trigger, laut
//   scripts/setup_supabase.sql:221-236 keiner; welche Fassung in der Live-DB gilt, ist nicht
//   gemessen. Deshalb setzt die Route updated_at zusätzlich selbst (ein Trigger überschreibt
//   den Wert, ohne Trigger trägt der Vergleich trotzdem).
// - R19: Der Metriken-Verlauf sichert nur die frühere performance, nicht die Spalten
//   views/engagement (DB-Default 0 bzw. Wert einer älteren Erfassung, keine Messung).
// - R17: Fehlertexte gehen nur bereinigt (bereinigeFehler, lib/status-server.ts) an den Browser.
//
// Gesamtprüfung 06.11.2026: Cross-Site-POST → 403, ohne JSON-Content-Type → 415
// (pruefeAnfrageHerkunft), bevor gelesen oder geschrieben wird. Vorher konnte im Dev-Modus jede
// fremde Seite im selben Browser "freigeben" für beliebige IDs senden.
//
// Objekt-Studio Stufe 2, Schritt 5 (10.11.2026, R2/E13): "freigeben" verlangt zusätzlich, dass
// COUNSEL genau den Freigabetext geprüft hat (geprueftenTextAusSchritten aus metadata.steps und
// review_notes, lib/freigabe-regeln.ts). Sonst 409 mit Sperrgrund "… (R2)" — auch für Altzeilen, deren
// body die ungeprüfte PUBLISHER-Fassung ist.

type Aktion = "freigeben" | "ablehnen" | "gepostet" | "metriken";

// Erwarteter Ausgangsstatus je Aktion (fail-closed: alles andere → 409)
const ERWARTETER_STATUS: Record<Aktion, string> = {
  freigeben: "zur_freigabe",
  ablehnen: "zur_freigabe",
  gepostet: "freigegeben",
  metriken: "gepostet",
};

const ZIEL_STATUS: Record<Aktion, string> = {
  freigeben: "freigegeben",
  ablehnen: "abgelehnt",
  gepostet: "gepostet",
  metriken: "gepostet",
};

// Wer entschieden hat: Die Middleware kennt nur eine gültige Betreiber-Session, keinen Namen.
const DURCH = "betreiber-session";
const GRUND_MAX_ZEICHEN = 500;
const URL_MAX_ZEICHEN = 2048;

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

function istAktion(wert: unknown): wert is Aktion {
  return typeof wert === "string" && Object.prototype.hasOwnProperty.call(ERWARTETER_STATUS, wert);
}

function fehler(status: number, text: string) {
  return NextResponse.json({ fehler: text }, { status });
}

function istHttpUrl(wert: string): boolean {
  try {
    const url = new URL(wert);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Zähler (Impressions, Likes): nicht übergeben → undefined; sonst ganze Zahl ≥ 0.
// Liefert eine Fehlermeldung als string, wenn der Wert ungültig ist.
function leseZaehler(wert: unknown, name: string): number | undefined | string {
  if (wert === undefined || wert === null) return undefined;
  if (typeof wert !== "number" || !Number.isInteger(wert) || wert < 0) {
    return `${name} muss eine ganze Zahl ≥ 0 sein`;
  }
  return wert;
}

export async function POST(request: NextRequest) {
  const sperre = pruefeAnfrageHerkunft(request.headers);
  if (sperre) return fehler(sperre.status, sperre.fehler);

  let roh: unknown;
  try {
    roh = await request.json();
  } catch {
    return fehler(400, "Anfrage ist kein gültiges JSON");
  }
  if (!istObjekt(roh)) return fehler(400, "Anfrage muss ein JSON-Objekt sein");

  const { id, aktion } = roh;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return fehler(400, "id muss eine positive ganze Zahl sein");
  }
  if (!istAktion(aktion)) {
    return fehler(400, "aktion muss freigeben, ablehnen, gepostet oder metriken sein");
  }

  // ═══ Eingaben je Aktion prüfen, bevor gelesen wird ═══
  let grund: string | undefined;
  let publishedUrl: string | undefined;
  let impressions: number | undefined;
  let likes: number | undefined;

  if (aktion === "ablehnen" && roh.grund !== undefined && roh.grund !== null) {
    if (typeof roh.grund !== "string") return fehler(400, "grund muss Text sein");
    const getrimmt = roh.grund.trim();
    if (getrimmt.length > GRUND_MAX_ZEICHEN) {
      return fehler(400, `grund ist zu lang (${getrimmt.length} Zeichen, höchstens ${GRUND_MAX_ZEICHEN})`);
    }
    grund = getrimmt || undefined;
  }

  if (aktion === "gepostet") {
    const url = typeof roh.published_url === "string" ? roh.published_url.trim() : "";
    if (!url) return fehler(400, "published_url ist Pflicht");
    if (url.length > URL_MAX_ZEICHEN) return fehler(400, `published_url ist zu lang (höchstens ${URL_MAX_ZEICHEN} Zeichen)`);
    if (!istHttpUrl(url)) return fehler(400, "published_url muss eine http(s)-URL sein");
    publishedUrl = url;
  }

  if (aktion === "metriken") {
    const imp = leseZaehler(roh.impressions, "impressions");
    if (typeof imp === "string") return fehler(400, imp);
    const lik = leseZaehler(roh.likes, "likes");
    if (typeof lik === "string") return fehler(400, lik);
    // Nur übergebene Zahlen werden geschrieben — keine 0 für Fehlendes.
    if (imp === undefined && lik === undefined) {
      return fehler(400, "keine Metrik übergeben (impressions und/oder likes)");
    }
    impressions = imp;
    likes = lik;
  }

  try {
    const supabase = createServiceClient();

    // body und review_notes für das Freigabe-Gate (R4), updated_at für den Vergleich (R18).
    const { data: eintrag, error: leseFehler } = await supabase
      .from("content")
      .select("id, status, body, review_notes, metadata, performance, updated_at")
      .eq("id", id)
      .maybeSingle();

    // Stufe 1: Lesefehler (500) nicht mehr als "nicht gefunden" (404) ausgeben.
    if (leseFehler) return fehler(500, `Lesen fehlgeschlagen: ${bereinigeFehler(leseFehler)}`);
    if (!eintrag) return fehler(404, `Content-Eintrag ${id} nicht gefunden`);

    const erwartet = ERWARTETER_STATUS[aktion];
    if (eintrag.status !== erwartet) {
      return fehler(409, `Übergang "${aktion}" ist aus Status "${eintrag.status}" nicht erlaubt`);
    }

    // Fail-closed: Ohne lesbare Fassung (updated_at) kein Schreiben, sonst greift der
    // Vergleich in R18 nicht. null ist lesbar (Vergleich per IS NULL).
    const gelesenAm: unknown = eintrag.updated_at;
    if (gelesenAm !== null && typeof gelesenAm !== "string") {
      return fehler(500, "updated_at nicht lesbar — Übergang nicht geschrieben");
    }

    const jetzt = new Date().toISOString();
    const alteMetadata = istObjekt(eintrag.metadata) ? eintrag.metadata : {};
    const metadata: Record<string, unknown> = { ...alteMetadata };
    const update: Record<string, unknown> = { updated_at: jetzt };

    switch (aktion) {
      case "freigeben": {
        // R4: dieselbe Regel wie Freigabe-Stapel und Knopf — nur COUNSEL-Urteil FREIGABE,
        // ein Text ab Mindestlänge und ohne geschützten Namen; R2 (Paket B): nur der Text, den
        // COUNSEL wörtlich geprüft hat.
        const body = typeof eintrag.body === "string" ? eintrag.body : null;
        const reviewNotes = typeof eintrag.review_notes === "string" ? eintrag.review_notes : null;
        const geprueft = geprueftenTextAusSchritten(alteMetadata.steps, reviewNotes);
        const pruefung = pruefeFreigabe(werteCounselAus(reviewNotes), body, geprueft);
        if (!pruefung.freigebbar || body === null) {
          return fehler(409, pruefung.grund ?? "Freigabetext nicht lesbar");
        }
        const text = body.trim();
        update.status = ZIEL_STATUS.freigeben;
        metadata.freigabe = {
          aktion,
          am: jetzt,
          durch: DURCH,
          counsel_urteil: pruefung.urteil,
          // URTEIL-Zeile mit maskiertem geschütztem Namen (pruefeFreigabe).
          counsel_zeile: pruefung.zeile,
          // Beleg, welcher Text freigegeben wurde: SHA-256 (UTF-8) und Länge in Unicode-Zeichen
          // des getrimmten body (gleiche Zählung wie text_zeichen in /api/freigaben).
          text_sha256: createHash("sha256").update(text, "utf8").digest("hex"),
          text_zeichen: Array.from(text).length,
        };
        break;
      }
      case "ablehnen":
        update.status = ZIEL_STATUS.ablehnen;
        metadata.freigabe = grund ? { aktion, am: jetzt, durch: DURCH, grund } : { aktion, am: jetzt, durch: DURCH };
        // Unterscheidet die Betreiber-Ablehnung von einer COUNSEL-Ablehnung (metadata.counsel).
        metadata.abgelehnt_durch = "betreiber";
        break;
      case "gepostet":
        update.status = ZIEL_STATUS.gepostet;
        update.published_at = jetzt;
        update.published_url = publishedUrl;
        // Eigener Vermerk statt metadata.freigabe zu überschreiben: Der Freigabe-Beleg
        // (wer hat wann freigegeben) muss nach dem Posten erhalten bleiben.
        metadata.gepostet = { aktion, am: jetzt, durch: DURCH, published_url: publishedUrl };
        break;
      case "metriken": {
        // Bisherige Erfassung an den Verlauf anhängen — nur, wenn es eine gab
        // (performance.erfasst_am). R19: gesichert wird nur die performance selbst. Die
        // Spalten views/engagement sind DB-Default 0 oder Wert einer älteren Erfassung und
        // gehören nicht unter den Zeitstempel dieser Erfassung. Eine performance ohne
        // "durch" stammt aus der Zeit vor Stufe 1 (0 kann dort Platzhalter sein); sie wird
        // unverändert übernommen, damit die Anzeige das erkennen kann.
        const altePerformance = istObjekt(eintrag.performance) ? eintrag.performance : null;
        const verlauf = Array.isArray(alteMetadata.metriken_verlauf) ? [...alteMetadata.metriken_verlauf] : [];
        if (altePerformance && typeof altePerformance.erfasst_am === "string") {
          verlauf.push({ ...altePerformance, abgeloest_am: jetzt });
        }
        metadata.metriken_verlauf = verlauf;

        const performance: Record<string, unknown> = { erfasst_am: jetzt, durch: DURCH };
        if (impressions !== undefined) {
          update.views = impressions;
          performance.impressions = impressions;
        }
        if (likes !== undefined) {
          update.engagement = likes;
          performance.likes = likes;
        }
        update.performance = performance;
        break;
      }
    }
    update.metadata = metadata;

    // Bedingtes Update: trifft nur, solange Status UND gelesene Fassung (updated_at) noch
    // gelten. Damit schreibt auch "freigeben" nur über genau den geprüften Text.
    const basis = supabase.from("content").update(update).eq("id", id).eq("status", erwartet);
    const bedingt = gelesenAm === null ? basis.is("updated_at", null) : basis.eq("updated_at", gelesenAm);
    const { data: geaendert, error: schreibFehler } = await bedingt.select("*");

    if (schreibFehler) return fehler(500, `Update fehlgeschlagen: ${bereinigeFehler(schreibFehler)}`);
    if (!geaendert || geaendert.length === 0) {
      return fehler(409, "Eintrag hat sich zwischenzeitlich geändert (Status oder Inhalt) — neu laden");
    }

    return NextResponse.json({ id, aktion, status: ZIEL_STATUS[aktion], eintrag: geaendert[0] });
  } catch (err) {
    return fehler(500, bereinigeFehler(err));
  }
}
