import { NextRequest, NextResponse } from "next/server";
import { ERLAUBTE_AGENTEN } from "@/lib/auftrag";
import { MAX_PLAN_SCHRITTE } from "@/lib/auftrag-types";
import {
  abschneideStatus,
  bereinigeFehler,
  istObjekt,
  leseProtokollEintraege,
  pruefeAnfrageHerkunft,
} from "@/lib/status-server";

// POST — Activate multiple agents in sequence
// Stufe 1 (05.11.2026): Im Repo gibt es keinen Aufrufer. Aktiviert werden nur Agenten aus
// ERLAUBTE_AGENTEN (lib/auftrag.ts), höchstens MAX_PLAN_SCHRITTE je Aufruf. Nicht erlaubte
// oder überzählige Einträge laufen nicht, sondern stehen mit Grund in results.
// Gesamtprüfung 06.11.2026 (activate-Vertrag, R16/R33):
// - success nur bei HTTP 2xx UND abgeschnitten === false; dafür müssen das Feld false und der
//   stop_reason end_turn/stop_sequence sein (fail-closed wie Pipeline und delegate). Jedes
//   Ergebnis trägt abgeschnitten und stop_reason.
// - Kosten auch aus Fehlläufen (HTTP 502 mit usage.cost_usd: bezahlt, ohne verwertbare Antwort).
//   Die Summe ist null, wenn kein Lauf eine Kostenangabe hat — nie 0 als Platzhalter.
// - Protokollfehler je Eintrag (protokoll_fehler_liste, sonst Text am "; " geteilt), bereinigt.
// - Cross-Site-POST → 403, ohne JSON-Content-Type → 415 (pruefeAnfrageHerkunft).

// Früher ["donna", "oracle", "operator"]; donna und operator stehen nicht in ERLAUBTE_AGENTEN.
const STANDARD_AGENTEN = ["oracle"];
const STANDARD_TASK =
  "Morning briefing: Report your current status and top priority for today. Be concise (max 3 bullet points).";

interface FleetErgebnis {
  agent_id: string;
  success: boolean;
  response?: string;
  error?: string;
  /** Geschätzte Kosten; null, wenn activate keine Kosten gemeldet hat. */
  cost_usd?: number | null;
  /** true = unvollständig, false = vollständig (end_turn/stop_sequence), null = nicht gemeldet. */
  abgeschnitten?: boolean | null;
  stop_reason?: string | null;
  protokoll_fehler?: string[];
}

/** Abschneide-Status fail-closed: true, wenn Feld oder stop_reason es sagen; false nur, wenn beide es bestätigen. */
function abschneideAusAntwort(gemeldet: unknown, stopReason: string | null): boolean | null {
  const ausStop = abschneideStatus(stopReason);
  if (gemeldet === true || ausStop === true) return true;
  if (gemeldet === false && ausStop === false) return false;
  return null;
}

export async function POST(request: NextRequest) {
  const sperre = pruefeAnfrageHerkunft(request.headers);
  if (sperre) return NextResponse.json({ fehler: sperre.fehler }, { status: sperre.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ fehler: "Ungültiger JSON-Body" }, { status: 400 });
  }
  const eingabe =
    typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const angefragt: unknown = eingabe.agents ?? STANDARD_AGENTEN;
  const task = typeof eingabe.task === "string" && eingabe.task.trim() ? eingabe.task : STANDARD_TASK;

  if (!Array.isArray(angefragt) || !angefragt.every((a): a is string => typeof a === "string")) {
    return NextResponse.json({ fehler: "agents muss eine Liste von Agenten-IDs sein" }, { status: 400 });
  }

  const results: FleetErgebnis[] = [];
  let totalCost = 0;
  let mitKosten = 0;
  let kostenUnbekannt = 0;
  let zugelassen = 0;

  // Caller ist bereits authentifiziert (Middleware) — dessen signiertes Cookie an
  // den internen activate-Call weiterreichen, damit dieser das Auth-Gate passiert.
  const cookie = request.headers.get("cookie") ?? "";
  const baseUrl = request.nextUrl.origin;

  for (const roh of angefragt) {
    const agentId = roh.trim().toLowerCase();
    if (!ERLAUBTE_AGENTEN.includes(agentId)) {
      results.push({ agent_id: agentId, success: false, error: "nicht erlaubt (nicht in ERLAUBTE_AGENTEN)" });
      continue;
    }
    if (zugelassen >= MAX_PLAN_SCHRITTE) {
      results.push({
        agent_id: agentId,
        success: false,
        error: `übersprungen: höchstens ${MAX_PLAN_SCHRITTE} Agenten je Aufruf`,
      });
      continue;
    }
    zugelassen++;

    try {
      const res = await fetch(`${baseUrl}/api/agents/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ agent_id: agentId, task }),
      });

      const roh: unknown = await res.json().catch(() => null);
      const data = istObjekt(roh) ? roh : {};
      const usage = istObjekt(data.usage) ? data.usage : {};
      // Auch ein Fehllauf (502) meldet usage: Die Tokens sind bezahlt und zählen mit.
      const cost =
        typeof usage.cost_usd === "number" && Number.isFinite(usage.cost_usd) && usage.cost_usd >= 0 ? usage.cost_usd : null;
      if (cost === null) kostenUnbekannt++;
      else {
        totalCost += cost;
        mitKosten++;
      }
      const stopReason = typeof data.stop_reason === "string" && data.stop_reason.trim() ? data.stop_reason : null;
      const protokoll = leseProtokollEintraege(data.protokoll_fehler_liste, data.protokoll_fehler);
      const protokollFehler = protokoll.eintraege.map((p) => bereinigeFehler(p));
      if (protokoll.unlesbar) protokollFehler.push("protokoll_fehler nicht lesbar (activate-Vertrag)");
      const gemeinsam = {
        agent_id: agentId,
        cost_usd: cost,
        stop_reason: stopReason,
        ...(protokollFehler.length > 0 ? { protokoll_fehler: protokollFehler } : {}),
      };
      if (res.ok) {
        const abgeschnitten = abschneideAusAntwort(data.abgeschnitten, stopReason);
        const text = typeof data.response === "string" ? data.response : "";
        results.push({
          ...gemeinsam,
          success: abgeschnitten === false && text.trim() !== "",
          response: text.slice(0, 200),
          abgeschnitten,
          ...(abgeschnitten === false
            ? {}
            : { error: abgeschnitten === true ? "Antwort unvollständig (abgeschnitten)" : "Vollständigkeit nicht gemeldet" }),
        });
      } else {
        const meldung =
          typeof data.fehler === "string" && data.fehler.trim()
            ? data.fehler
            : typeof data.error === "string" && data.error.trim()
              ? data.error
              : `HTTP ${res.status}`;
        results.push({ ...gemeinsam, success: false, abgeschnitten: null, error: bereinigeFehler(meldung) });
      }
    } catch (err) {
      results.push({
        agent_id: agentId,
        success: false,
        cost_usd: null,
        abgeschnitten: null,
        stop_reason: null,
        error: `Aufruf fehlgeschlagen: ${bereinigeFehler(err)}`,
      });
      kostenUnbekannt++;
    }
  }

  const successCount = results.filter((r) => r.success).length;

  return NextResponse.json({
    activated: successCount,
    total: angefragt.length,
    // Schätzung (Tokens × Preistabelle in lib/kosten.ts) über alle Läufe mit gemeldeten Kosten,
    // auch bezahlte Fehlläufe; null, wenn kein Lauf eine Kostenangabe hat.
    total_cost_usd_geschaetzt: mitKosten > 0 ? Math.round(totalCost * 100000) / 100000 : null,
    /** Gelaufene Aufrufe ohne Kostenangabe; sie fehlen in der Summe. */
    kosten_unbekannt: kostenUnbekannt,
    results,
  });
}
