import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { SESSION_COOKIE, getSessionSecret, signSession } from "@/lib/auth";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import { schreibeLaufNachweis } from "@/lib/lauf-nachweis";
import { ausnahmeNachweis, autoProduceNachweis, bereinigeFehler, starteLaufUhr } from "@/lib/status-server";
import { JOB_AUTO_PRODUCE, JOB_AUTO_PRODUCE_PROBE } from "@/lib/totmann";

// Fixrunde 06.11.2026:
// - R36: CONTENT_LAUNCH_DATE wird streng als JJJJ-MM-TT gelesen (sonst 500); eine im
//   Kalender fehlende Woche ist ein Fehler (500), nur ein Tag ohne Eintrag ist "skipped".
// - R6: Meldet die Pipeline Speicherfehler, heißt das Ergebnis "fehler", nicht "produced".
// - R2: Die Ausgabe ist die PUBLISHER-Fassung und heißt auch so; COUNSEL hat den SCRIBE-Text
//   geprüft, nicht diese Fassung (außer beide sind identisch).
// - Fehlertexte gehen nur bereinigt in die Antwort (bereinigeFehler, lib/status-server.ts).

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
// Kein schwacher Default mehr — ohne gesetztes CRON_SECRET ist der Endpunkt
// deaktiviert (fail-closed).
const CRON_SECRET = process.env.CRON_SECRET;

// Interner Server-zu-Server-Call: gültiges, signiertes Session-Cookie erzeugen
// (ersetzt das frühere statische "gp-auth=authenticated").
async function internalCookie(): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) return "";
  return `${SESSION_COOKIE}=${await signSession(secret)}`;
}

// Secret-Vergleich in konstanter Zeit; die Hashes gleichen unterschiedliche Längen an.
// Stufe 1 (05.11.2026).
function secretStimmt(geliefert: string | null): boolean {
  if (!CRON_SECRET || !geliefert) return false;
  const a = createHash("sha256").update(geliefert).digest();
  const b = createHash("sha256").update(CRON_SECRET).digest();
  return timingSafeEqual(a, b);
}

// Mapping: Wochentag (Mo-Fr) → Kalender-Key
const DAY_MAP: Record<number, string> = {
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
};

const LAUNCH_DATUM_STANDARD = "2026-04-07";
const LAUNCH_DATUM_MUSTER = /^(\d{4})-(\d{2})-(\d{2})$/;
const WOCHE_MS = 7 * 24 * 60 * 60 * 1000;

// Launch-Datum streng als JJJJ-MM-TT lesen (UTC-Mitternacht, wie new Date("JJJJ-MM-TT")).
// null bei allem anderen: "2026-13-01" ergäbe NaN, "2026-02-30" liest JavaScript still als
// 2. März, "07.04.2026" als 4. Juli — beides landete sonst in einer falschen Woche.
function leseLaunchDatum(wert: string): Date | null {
  const m = LAUNCH_DATUM_MUSTER.exec(wert);
  if (!m) return null;
  const [jahr, monat, tag] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const datum = new Date(Date.UTC(jahr, monat - 1, tag));
  return datum.getUTCFullYear() === jahr && datum.getUTCMonth() === monat - 1 && datum.getUTCDate() === tag
    ? datum
    : null;
}

// Woche berechnen (relativ zum Launch-Datum), zyklisch 1–4
function getCurrentWeek(launch: Date, now: Date): number {
  const diffWeeks = Math.floor((now.getTime() - launch.getTime()) / WOCHE_MS);
  return Math.max(1, Math.min(4, (diffWeeks % 4) + 1));
}

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

// Kategorie aus Topic erraten.
// Stufe 1 (05.11.2026): Trading-Wörter und "krypto_trading" entfernt — Ghost Protocol hat
// mit Trading nichts zu tun; die Pipeline weist die Kategorie inzwischen ab.
function guessCategory(topic: string): string {
  const lower = topic.toLowerCase();
  if (lower.includes("business") || lower.includes("automat") || lower.includes("workflow") || lower.includes("stack") || lower.includes("tool")) {
    return "business_automation";
  }
  if (lower.includes("ghost") || lower.includes("behind") || lower.includes("gelernt")) {
    return "ghost_protocol";
  }
  return "ki_automation";
}

interface KalenderEintrag {
  platform: string;
  format: string;
  topic: string;
}

function istKalenderEintrag(wert: unknown): wert is KalenderEintrag {
  if (typeof wert !== "object" || wert === null) return false;
  const e = wert as Record<string, unknown>;
  return typeof e.platform === "string" && typeof e.format === "string" && typeof e.topic === "string";
}

/** Ergebnis eines Laufs, bevor es zur Antwort wird: Der Totmann leitet daraus die Nachweis-Zeile ab. */
interface Lauf {
  status: number;
  body: Record<string, unknown>;
  /** steps der Pipeline-Antwort (Teilergebnisse je Agent); null, wenn die Pipeline nicht lief. */
  schritte: unknown;
}

function lauf(body: Record<string, unknown>, status = 200, schritte: unknown = null): Lauf {
  return { status, body, schritte };
}

// GET /api/content/auto-produce — Secret im Header x-cron-secret, optional ?dry=true
// Produziert automatisch das Content-Piece des Tages aus dem Launch-Kalender
// Stufe 2 (07.11.2026, Totmann): Jeder Lauf nach der Secret-Prüfung hängt genau eine Zeile an
// lauf_nachweis an (lib/lauf-nachweis.ts), per finally — Job content-auto-produce, mit ?dry=true
// content-auto-produce-probe (zählt für keinen Sollzeitpunkt). Ergebnis: produced → ok, skipped →
// uebersprungen, partial/abgelehnt → teilweise, status "fehler" → fehler auch bei HTTP 200, 5xx →
// fehler (autoProduceNachweis). Scheitert der Insert, kommt nur der Vermerk nachweis_fehler dazu.
export async function GET(request: NextRequest) {
  // Stufe 1 (05.11.2026): Secret nur noch im Header. Als Query-Parameter landet es in
  // Server-, Proxy- und Cron-Logs — deshalb abgewiesen, auch wenn es stimmt.
  if (request.nextUrl.searchParams.has("secret")) {
    return NextResponse.json({ fehler: "Secret nur im Header x-cron-secret" }, { status: 400 });
  }
  if (!secretStimmt(request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ fehler: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dry") === "true";
  const job = dryRun ? JOB_AUTO_PRODUCE_PROBE : JOB_AUTO_PRODUCE;
  const uhr = starteLaufUhr();
  let ergebnis: Lauf | null = null;
  let ausnahme: unknown = null;
  let nachweisFehler: string | null = null;
  try {
    ergebnis = await produziere(dryRun);
  } catch (e) {
    ausnahme = e;
    throw e;
  } finally {
    const fertig = ergebnis;
    nachweisFehler = await schreibeLaufNachweis(job, uhr.begonnen, uhr.beendet(), () =>
      fertig === null ? ausnahmeNachweis(ausnahme) : autoProduceNachweis(fertig.status, fertig.body, fertig.schritte)
    );
  }
  return NextResponse.json(
    nachweisFehler === null ? ergebnis.body : { ...ergebnis.body, nachweis_fehler: nachweisFehler },
    { status: ergebnis.status }
  );
}

async function produziere(dryRun: boolean): Promise<Lauf> {
  // Launch-Datum (konfigurierbar, default: nächster Montag als Referenz).
  // R36: vor allem anderen prüfen, auch am Wochenende und im Dry-Run — eine
  // Fehlkonfiguration soll auffallen, nicht als "skipped" durchrutschen. Der Wert selbst
  // wird nicht ausgegeben.
  const launch = leseLaunchDatum(process.env.CONTENT_LAUNCH_DATE || LAUNCH_DATUM_STANDARD);
  if (!launch) {
    return lauf({ status: "fehler", fehler: "CONTENT_LAUNCH_DATE ungültig (erwartet JJJJ-MM-TT, z. B. 2026-04-07)" }, 500);
  }

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=So, 1=Mo, ..., 5=Fr, 6=Sa

  // Nur Mo-Fr produzieren
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return lauf({
      status: "skipped",
      grund: "Wochenende — kein Content geplant",
      day: now.toLocaleDateString("de-DE", { weekday: "long" }),
    });
  }

  const dayKey = DAY_MAP[dayOfWeek];
  const weekNum = getCurrentWeek(launch, now);
  if (!Number.isInteger(weekNum)) {
    return lauf({ status: "fehler", fehler: "Kalenderwoche nicht berechenbar" }, 500);
  }
  const weekKey = `week${weekNum}`;

  // Kalender laden (interner Call → signiertes Cookie mitsenden)
  let calendarRes: Response;
  try {
    calendarRes = await fetch(`${BASE_URL}/api/content/pipeline`, {
      headers: { Cookie: await internalCookie() },
      cache: "no-store",
    });
  } catch (err) {
    return lauf({ status: "fehler", fehler: `Kalender nicht erreichbar: ${bereinigeFehler(err)}` }, 500);
  }
  if (!calendarRes.ok) {
    return lauf({ status: "fehler", fehler: `Kalender nicht erreichbar (HTTP ${calendarRes.status})` }, 500);
  }
  const calendarData: unknown = await calendarRes.json().catch(() => null);
  const kalender =
    typeof calendarData === "object" && calendarData !== null
      ? (calendarData as { launch_calendar?: unknown }).launch_calendar
      : undefined;
  if (typeof kalender !== "object" || kalender === null) {
    return lauf({ status: "fehler", fehler: "Kalender-Antwort ohne launch_calendar" }, 500);
  }
  const weekData: unknown = (kalender as Record<string, unknown>)[weekKey];
  // R36: Eine fehlende Woche ist ein Fehler im Kalender, kein Leertag.
  if (!istObjekt(weekData)) {
    return lauf({ status: "fehler", fehler: `Woche fehlt im Kalender (${weekKey})`, week: weekNum, day: dayKey }, 500);
  }
  const weekTheme = typeof weekData.theme === "string" ? weekData.theme : null;
  const todayEntry = weekData[dayKey];

  // Stufe 1 (05.11.2026): Ein Tag ohne Eintrag in einer vorhandenen Woche (z. B. die
  // geleerte Woche 2) ist kein Fehler, sondern nichts zu tun.
  if (todayEntry === undefined || todayEntry === null) {
    return lauf({
      status: "skipped",
      grund: "kein Kalendereintrag",
      date: now.toISOString(),
      week: weekNum,
      weekTheme,
      day: dayKey,
    });
  }
  if (!istKalenderEintrag(todayEntry)) {
    return lauf(
      { status: "fehler", fehler: `Kalendereintrag ${weekKey}/${dayKey} unvollständig (platform, format, topic)` },
      500
    );
  }

  const { platform, format, topic } = todayEntry;
  const category = guessCategory(topic);

  // Dry-Run: Nur zeigen was produziert würde
  if (dryRun) {
    return lauf({
      status: "dry_run",
      date: now.toISOString(),
      week: weekNum,
      weekTheme,
      day: dayKey,
      scheduled: { platform, format, topic, category },
      message: "Dry-Run — kein Content produziert. Ohne ?dry=true wird produziert.",
    });
  }

  // Content-Pipeline starten
  let pipelineRes: Response;
  try {
    pipelineRes = await fetch(`${BASE_URL}/api/content/pipeline`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await internalCookie(),
      },
      body: JSON.stringify({ topic, platform, format, category }),
    });
  } catch (err) {
    return lauf(
      {
        status: "fehler",
        scheduled: { platform, format, topic, category },
        fehler: `Pipeline nicht erreichbar: ${bereinigeFehler(err)}`,
      },
      500
    );
  }

  if (!pipelineRes.ok) {
    const err: unknown = await pipelineRes.json().catch(() => null);
    // Die Pipeline meldet Fehler als "fehler" (Text); ältere Antworten als "error".
    const meldung = istObjekt(err)
      ? typeof err.fehler === "string"
        ? err.fehler
        : typeof err.error === "string"
          ? err.error
          : undefined
      : undefined;
    const contentId = istObjekt(err) && (typeof err.contentId === "number" || typeof err.contentId === "string") ? err.contentId : null;
    return lauf(
      {
        status: "fehler",
        scheduled: { platform, format, topic, category },
        fehler: meldung !== undefined ? maskiereGeschuetzteNamen(bereinigeFehler(meldung)) : `Pipeline HTTP ${pipelineRes.status}`,
        pipeline_http: pipelineRes.status,
        contentId,
      },
      500,
      // Eine Fehlerantwort nach dem Insert trägt die Schritte (Prüflauf 06.11.2026).
      istObjekt(err) ? err.steps : null
    );
  }

  const result: unknown = await pipelineRes.json().catch(() => null);
  if (!istObjekt(result)) {
    return lauf(
      { status: "fehler", scheduled: { platform, format, topic, category }, fehler: "Pipeline-Antwort ist kein JSON" },
      500
    );
  }

  // Stufe 1 (05.11.2026): Abgelehnt und fehler heißen auch so — "partial" verschleierte,
  // dass COUNSEL abgelehnt hat oder eine Stufe gescheitert ist.
  // R6 (Fixrunde 06.11.2026): Konnte die Pipeline ihre Zeile nicht vollständig speichern,
  // ist das Ergebnis "fehler" — auch wenn alle Stufen liefen.
  const pipelineStatus: unknown = result.status;
  const speicherfehler = Array.isArray(result.speicherfehler)
    ? result.speicherfehler.filter((f): f is string => typeof f === "string")
    : [];
  const status =
    speicherfehler.length > 0
      ? "fehler"
      : pipelineStatus === "complete"
        ? "produced"
        : pipelineStatus === "abgelehnt" || pipelineStatus === "fehler"
          ? pipelineStatus
          : "partial";

  const summary = istObjekt(result.summary) ? result.summary : {};
  // R2: Ausgabe ist die PUBLISHER-Fassung (= body der Zeile). COUNSEL hat den SCRIBE-Text
  // geprüft; nur wenn beide identisch sind (freigabe_hinweis.identisch), gilt sie als geprüft.
  const publisherSchritt = Array.isArray(result.steps)
    ? result.steps.find((s: unknown) => istObjekt(s) && s.agent === "publisher")
    : undefined;
  const publisherText =
    istObjekt(publisherSchritt) && typeof publisherSchritt.output === "string" ? publisherSchritt.output : null;
  const identisch = istObjekt(result.freigabe_hinweis) && result.freigabe_hinweis.identisch === true;
  // Vorschau fürs Cron-Log: geschützter Name maskiert, höchstens 2000 Zeichen.
  const vorschau = publisherText === null ? null : Array.from(maskiereGeschuetzteNamen(publisherText));

  return lauf(
    {
      status,
      date: now.toISOString(),
      week: weekNum,
      weekTheme,
      day: dayKey,
      scheduled: { platform, format, topic, category },
      contentId: result.contentId ?? null,
      pipeline: {
        status: pipelineStatus ?? null,
        completed: summary.completed,
        // Schätzung aus Tokens × fester Preistabelle, keine Abrechnung. null = keine Stufe hat
        // Kosten gemeldet (oder der Lauf lieferte keine Zusammenfassung), nie 0 als Ersatz.
        kosten_usd_geschaetzt: typeof summary.total_cost_usd === "number" ? summary.total_cost_usd : null,
        kosten_unvollstaendig: summary.kosten_unvollstaendig,
        duration_ms: summary.total_duration_ms,
      },
      ...(result.fehler ? { fehler: result.fehler } : {}),
      ...(result.counsel ? { counsel: result.counsel } : {}),
      speicherfehler,
      publisher_fassung: vorschau === null ? null : vorschau.slice(0, 2000).join(""),
      publisher_fassung_gekuerzt: vorschau !== null && vorschau.length > 2000,
      // Ohne PUBLISHER-Text (z. B. COUNSEL hat abgelehnt) gibt es auch keine Fassung zu benennen.
      // Paket B (R2): Seit der COUNSEL-Endprüfung ist der geprüfte Text die PUBLISHER-Fassung selbst;
      // der Hinweis nennt deshalb nicht mehr "SCRIBE-Text", sondern den geprüften Text allgemein.
      publisher_fassung_hinweis:
        vorschau === null
          ? "keine PUBLISHER-Fassung im Ergebnis"
          : identisch
            ? "PUBLISHER-Fassung, identisch mit dem von COUNSEL geprüften Text"
            : "PUBLISHER-Fassung, von COUNSEL nicht geprüft",
    },
    200,
    result.steps
  );
}
