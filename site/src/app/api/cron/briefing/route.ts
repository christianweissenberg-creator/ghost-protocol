import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { SESSION_COOKIE, getSessionSecret, signSession } from "@/lib/auth";
import { schreibeLaufNachweis } from "@/lib/lauf-nachweis";
import {
  abschneideStatus,
  ausnahmeNachweis,
  bereinigeFehler,
  briefingNachweis,
  briefingTeilergebnisse,
  istObjekt,
  leseProtokollEintraege,
  starteLaufUhr,
} from "@/lib/status-server";
import { JOB_BRIEFING_ABEND, JOB_BRIEFING_MORGEN } from "@/lib/totmann";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
// Kein schwacher Default mehr — ohne gesetztes CRON_SECRET ist der Endpunkt
// deaktiviert (fail-closed).
const CRON_SECRET = process.env.CRON_SECRET;

// Interner Server-zu-Server-Call: gültiges, signiertes Session-Cookie erzeugen
// (ersetzt das frühere statische "gp-auth=authenticated"). Host-unabhängig gültig;
// bei localhost greift zusätzlich der Middleware-Bypass.
async function internalCookie(): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) return "";
  return `${SESSION_COOKIE}=${await signSession(secret)}`;
}

/**
 * Ergebnis eines Briefing-Laufs (Gesamtprüfung 06.11.2026, activate-Vertrag R16): Ein
 * abgeschnittenes Briefing sah vorher vollständig aus, weil nur der Text zurückkam.
 */
interface BriefingErgebnis {
  /** Antworttext; null bei Fehler. */
  text: string | null;
  /** true = unvollständig, false = vollständig (end_turn/stop_sequence), null = nicht gemeldet. */
  abgeschnitten: boolean | null;
  stop_reason: string | null;
  /** Schätzung laut activate; auch bei einem bezahlten Fehllauf (HTTP 502). null = nicht gemeldet. */
  kosten_usd_geschaetzt: number | null;
  fehler: string | null;
  protokoll_fehler: string[];
}

async function activateAgent(agentId: string, task: string): Promise<BriefingErgebnis> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/agents/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await internalCookie(),
      },
      body: JSON.stringify({ agent_id: agentId, task }),
    });
  } catch (e) {
    return {
      text: null,
      abgeschnitten: null,
      stop_reason: null,
      kosten_usd_geschaetzt: null,
      fehler: `Aufruf fehlgeschlagen: ${bereinigeFehler(e)}`,
      protokoll_fehler: [],
    };
  }
  const roh: unknown = await res.json().catch(() => null);
  const d = istObjekt(roh) ? roh : {};
  const usage = istObjekt(d.usage) ? d.usage : {};
  const kosten =
    typeof usage.cost_usd === "number" && Number.isFinite(usage.cost_usd) && usage.cost_usd >= 0 ? usage.cost_usd : null;
  const stopReason = typeof d.stop_reason === "string" && d.stop_reason.trim() ? d.stop_reason : null;
  const protokoll = leseProtokollEintraege(d.protokoll_fehler_liste, d.protokoll_fehler);
  const protokollFehler = protokoll.eintraege.map((p) => bereinigeFehler(p));
  if (protokoll.unlesbar) protokollFehler.push("protokoll_fehler nicht lesbar (activate-Vertrag)");
  if (!res.ok) {
    const meldung = typeof d.fehler === "string" ? d.fehler : typeof d.error === "string" ? d.error : "";
    return {
      text: null,
      abgeschnitten: null,
      stop_reason: stopReason,
      kosten_usd_geschaetzt: kosten,
      fehler: `HTTP ${res.status}${meldung.trim() ? `: ${bereinigeFehler(meldung)}` : ""}`,
      protokoll_fehler: protokollFehler,
    };
  }
  // Fail-closed: vollständig nur, wenn activate false meldet und der stop_reason es bestätigt.
  const ausStop = abschneideStatus(stopReason);
  const abgeschnitten =
    d.abgeschnitten === true || ausStop === true ? true : d.abgeschnitten === false && ausStop === false ? false : null;
  return {
    text: typeof d.response === "string" ? d.response : "",
    abgeschnitten,
    stop_reason: stopReason,
    kosten_usd_geschaetzt: kosten,
    fehler: null,
    protokoll_fehler: protokollFehler,
  };
}

// Vergleich in konstanter Zeit, damit die Antwortzeit nichts über das Secret verrät.
function secretPasst(geliefert: string, erwartet: string): boolean {
  const a = Buffer.from(geliefert);
  const b = Buffer.from(erwartet);
  return a.length === b.length && timingSafeEqual(a, b);
}

// GET /api/cron/briefing?type=morning|evening — Secret im Header x-cron-secret.
// Called by external cron (Coolify/systemd timer) or manual trigger.
// Stufe 1 (05.11.2026): Secret nur noch im Header. Ein Secret in der URL landet in
// Server-, Proxy- und Shell-Logs; ein secret-Query-Parameter wird deshalb abgewiesen.
// Stufe 2 (07.11.2026, Totmann): Jeder Lauf nach der Secret-Prüfung hängt genau eine Zeile an
// lauf_nachweis an (Job briefing-morgen bzw. briefing-abend; lib/lauf-nachweis.ts). Ergebnis:
// alle Agenten vollständig → ok, einige → teilweise, keiner → fehler (briefingNachweis).
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has("secret")) {
    return NextResponse.json({ fehler: "Secret nur im Header x-cron-secret" }, { status: 400 });
  }
  const secret = request.headers.get("x-cron-secret");
  if (!CRON_SECRET || !secret || !secretPasst(secret, CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get("type") ?? "morning";
  // Totmann (Stufe 2, §2.2): Ein unbekannter type gehört zu keinem Job des Plans und schreibt wie
  // 400 und 401 keinen Nachweis. Dieselbe 400 wie vorher, nur vor dem Lauf statt am Ende der
  // Verzweigung (auch vorher startete sie keinen Agenten).
  const job = type === "morning" ? JOB_BRIEFING_MORGEN : type === "evening" ? JOB_BRIEFING_ABEND : null;
  if (job === null) {
    return NextResponse.json({ error: "type must be 'morning' or 'evening'" }, { status: 400 });
  }

  const uhr = starteLaufUhr();
  const results: Record<string, BriefingErgebnis> = {};
  let antwort: Record<string, unknown> | null = null;
  let ausnahme: unknown = null;
  let nachweisFehler: string | null = null;
  // Totmann: nach bestandener Secret-Prüfung genau eine Zeile in lauf_nachweis — im finally, also
  // auch wenn der Lauf wirft (dann "fehler" mit den Teilergebnissen bis dahin). Scheitert der
  // Insert, kommt nur der Vermerk nachweis_fehler in die Antwort.
  try {
    if (type === "morning") {
      // ═══ MORNING BRIEFING (08:00 CET, Mo-Fr) ═══
      // Stufe 1 (05.11.2026): Krypto-Entwicklungen und Marktsentiment gestrichen.
      results.oracle = await activateAgent(
        "oracle",
        `MORNING BRIEFING ${new Date().toLocaleDateString("de-DE")}:
Scanne die wichtigsten KI-Entwicklungen.
Liefere in maximal 200 Wörtern:
1. Top-3 relevante News für Ghost Protocol (KI-Automation, Business)
2. 2 Content-Ideen die sich aus den News ergeben (mit Plattform-Empfehlung)
Keine Floskeln. Fakten zuerst.`
      );

      results.donna = await activateAgent(
        "donna",
        `MORNING BRIEFING ${new Date().toLocaleDateString("de-DE")}:
Tagesplanung für Ghost Protocol. Erstelle eine priorisierte Liste:
1. Welcher Content ist heute laut Redaktionsplan fällig? (Wochentag beachten)
2. Welche Agents müssen dafür aktiviert werden?
3. Gibt es offene Tasks oder Blocker?
Maximal 5 Punkte, sortiert nach Priorität. Jeder Punkt mit klarer Aktion.`
      );
    } else {
      // ═══ EVENING SUMMARY (18:00 CET, Mo-Fr) ═══
      // Stufe 1 (05.11.2026): Fragen gestrichen, die Zahlen ohne mitgelieferte Daten
      // verlangten (API-Kosten, produzierte Pieces, Break-Even, €10k MRR, Wochenziel in
      // Prozent). Der TREASURER-Auftrag bestand nur aus solchen Fragen und entfällt.
      results.strategist = await activateAgent(
        "strategist",
        `EVENING SUMMARY ${new Date().toLocaleDateString("de-DE")}:
Strategischer Tagesabschluss:
1. Was wurde heute erreicht? (Content, Growth, Infrastruktur)
2. Eine strategische Entscheidung für morgen
Nenne nur Zahlen, die dir als Daten vorliegen; sonst schreibe 'nicht gemessen'.
Maximal 100 Wörter. Entscheidung statt Analyse.`
      );
    }

    const ergebnisse = Object.values(results);
    antwort = {
      type,
      timestamp: new Date().toISOString(),
      agents: Object.keys(results),
      // Vollständig nur Läufe ohne Fehler mit abgeschnitten === false (activate-Vertrag).
      vollstaendig: ergebnisse.filter((r) => r.fehler === null && r.abgeschnitten === false).length,
      results,
    };
  } catch (e) {
    ausnahme = e;
    throw e;
  } finally {
    const fertig = antwort !== null;
    nachweisFehler = await schreibeLaufNachweis(job, uhr.begonnen, uhr.beendet(), () =>
      fertig ? briefingNachweis(200, results) : ausnahmeNachweis(ausnahme, briefingTeilergebnisse(results))
    );
  }
  return NextResponse.json(nachweisFehler === null ? antwort : { ...antwort, nachweis_fehler: nachweisFehler });
}
