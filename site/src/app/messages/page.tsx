"use client";

// Message Bus — Stufe 1 (06.11.2026, Befunde R12, R13).
// Der Verbindungstext kommt allein aus dem subscribe-Callback des Realtime-Kanals (useMessages);
// ohne Callback steht "Realtime: unbekannt". Ein Lesefehler heißt "nicht lesbar" — nie 0 und
// nie "keine Nachrichten". Zähler gelten für die neuesten 100 Nachrichten. Agentenliste und
// CommandPanel bekommen nur sichtbare Agenten (Filter in useAgents).
// Nachbesserung 06.11.2026: Nachrichten ausgeblendeter Agenten werden weder gelistet noch
// gezählt (istSichtbareNachricht, dieselbe Regel wie im Command Center). Eine leere Liste ist
// eine Aussage über die Abfrage im Browser, nicht über die Tabelle; Gegenprobe ist die Zählung
// über /api/status. Farben nur über eigene Schlüssel ("__proto__" aus den Daten trifft nichts).
// Tor-Prüfung 07.11.2026: Jede Nachricht zählt in genau einem Zähler (busZaehlerVon) — vorher
// fehlten plan und plan_run, die Zähler ergaben 46 neben "48 Nachrichten" (F5). cost_usd
// einheitlich formatiert, mit der Preistabelle, wenn es nicht die aktuelle ist (F6).

import { useMessages, useAgents } from "@/lib/hooks";
import { useSystemStatus } from "@/lib/hooks-status";
import { CommandPanel } from "@/components/ui/CommandPanel";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import { PREIS_STAND_AB } from "@/lib/kosten";
import {
  BUS_ZAEHLER,
  busZaehlerVon,
  busZaehlung,
  eigenerEintrag,
  formatiereZahl,
  istFehllaufNachricht,
  istSichtbareNachricht,
  metadatenEintraege,
  metaWertText,
  nachrichtenLeerHinweis,
  nachrichtInhaltText,
  nachrichtKanaele,
  realtimeAnzeige,
  sichtbareEmpfaenger,
} from "@/lib/types";
import type { BusZaehler, Message } from "@/lib/types";
import { useState } from "react";

const NACHRICHTEN_GRENZE = 100;

/** Immer gezeigte Zähler; "fehllauf" und "andere" nur, wenn belegt oder als Filter gewählt. */
const IMMER_GEZEIGT: readonly BusZaehler[] = ["task", "response", "broadcast", "alert", "plan", "plan_run"];

const TYPE_COLORS: Record<string, string> = {
  task: "#06b6d4",
  response: "#22c55e",
  broadcast: "#8b5cf6",
  alert: "#ff3366",
  plan: "#f59e0b",
  plan_run: "#c9a86a",
};

const ZAEHLER_FARBE: Record<BusZaehler, string> = {
  task: "#06b6d4",
  response: "#22c55e",
  broadcast: "#8b5cf6",
  alert: "#ff3366",
  plan: "#f59e0b",
  plan_run: "#c9a86a",
  fehllauf: "#ff4d6a",
  andere: "#8a8994",
};

const ZAEHLER_LABEL: Record<BusZaehler, string> = {
  task: "Aufgabe",
  response: "Antwort",
  broadcast: "Broadcast",
  alert: "Alarm",
  plan: "Plan",
  plan_run: "Planlauf",
  fehllauf: "Fehllauf",
  andere: "Andere Typen",
};

// Gegencheck 06.11.2026: Inhalt und Metadaten dürfen JSON-Text sein (Python-Agenten bis
// 06.11.2026, agents/base_agent.py); vorher wurde metadata dann in Chips aus einzelnen Zeichen
// zerlegt. Fehlläufe (bezahlte Aufrufe ohne verwertbare Antwort, metadata.source "fehllauf")
// zählen nicht als Antwort und tragen ein eigenes Etikett — wie im Command Center.
function nachrichtText(msg: Message): string {
  return nachrichtInhaltText(msg.content);
}

function nachrichtenWort(n: number): string {
  return n === 1 ? "Nachricht" : "Nachrichten";
}

export default function MessagesPage() {
  const { messages, loading, error, realtime, realtimeFehler } = useMessages(NACHRICHTEN_GRENZE);
  // Nur sichtbare Agenten (Filter in useAgents, Befund R13).
  const { agents, error: agentsError } = useAgents();
  // Gegenprobe zur Liste im Browser: Gesamtzahl laut /api/status (geteilter Abruf der Shell).
  const sys = useSystemStatus();
  const [filter, setFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  // Dieselbe Regel wie im Command Center: Nachrichten ausgeblendeter Agenten zählen nicht mit.
  const sichtbar = messages.filter(istSichtbareNachricht);
  const ausgeblendet = messages.length - sichtbar.length;
  const filterAktiv = filter !== "all" || agentFilter !== "all";

  const filtered = sichtbar.filter((msg) => {
    if (filter !== "all" && busZaehlerVon(msg) !== filter) return false;
    if (
      agentFilter !== "all" &&
      msg.from_agent !== agentFilter &&
      !sichtbareEmpfaenger(msg).includes(agentFilter)
    )
      return false;
    return true;
  });

  // Jede Nachricht in genau einem Zähler (busZaehlerVon); die Summe ist sichtbar.length.
  const typeCounts = Object.fromEntries(
    BUS_ZAEHLER.map((z) => [z, sichtbar.filter((m) => busZaehlerVon(m) === z).length]),
  ) as Record<BusZaehler, number>;
  const gezeigteZaehler = BUS_ZAEHLER.filter(
    (z) => IMMER_GEZEIGT.includes(z) || (!loading && !error && typeCounts[z] > 0) || filter === z,
  );
  const fehllaeufe = typeCounts.fehllauf;
  const andereTypen = [...new Set(sichtbar.filter((m) => busZaehlerVon(m) === "andere").map((m) => String(m.message_type ?? "")))];

  const server = busZaehlung(sys.status, sys.fehler);

  const verbindung = realtimeAnzeige(realtime);
  const verbindungTitel = [
    "Zustand aus dem subscribe-Callback des Supabase-Realtime-Kanals.",
    realtimeFehler ? `Meldung: ${realtimeFehler}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let zaehlerText: string;
  if (loading) zaehlerText = "Nachrichten werden gelesen …";
  else if (error) zaehlerText = "Nachrichten nicht lesbar";
  else if (filterAktiv)
    zaehlerText = `${filtered.length} von ${sichtbar.length} ${nachrichtenWort(sichtbar.length)} (Filter) in den neuesten ${NACHRICHTEN_GRENZE}, im Browser gelesen`;
  else
    zaehlerText = `${sichtbar.length} ${nachrichtenWort(sichtbar.length)} in den neuesten ${NACHRICHTEN_GRENZE}, im Browser gelesen`;

  const leer = nachrichtenLeerHinweis({
    gelesen: messages.length,
    ausgeblendet,
    grenze: NACHRICHTEN_GRENZE,
    serverAnzahl: server.anzahl,
  });

  return (
    <div className="boot p-4 sm:p-6 lg:p-10 max-w-[1200px]">
      {/* Header */}
      <div className="gp-masthead">
        <div className="gp-index-row"><span className="gp-index">03 / SIGNALE</span><span className="gp-index-rule" /></div>
        <p className="gp-kicker">Agent-Kommunikation · die neuesten {NACHRICHTEN_GRENZE} Nachrichten</p>
        <h1 className="gp-wordmark">Message <em>Bus</em></h1>
      </div>

      {/* Stats Row — Zähler in den neuesten 100 */}
      <div className="flex flex-wrap gap-3 mb-2">
        {gezeigteZaehler.map((type) => (
          <button
            key={type}
            onClick={() => setFilter(filter === type ? "all" : type)}
            className={`card-ghost px-4 py-2.5 flex items-center gap-2 transition-all cursor-pointer ${
              filter === type ? "ring-1" : ""
            }`}
            style={{
              borderColor: filter === type ? ZAEHLER_FARBE[type] : undefined,
              boxShadow: filter === type ? `0 0 0 1px ${ZAEHLER_FARBE[type]}` : undefined,
            }}
            title={
              error
                ? `Nachrichten nicht lesbar: ${error}`
                : `Anzahl unter den im Browser gelesenen neuesten ${NACHRICHTEN_GRENZE} Nachrichten, ohne ausgeblendete Agenten${
                    type === "andere" && andereTypen.length > 0 ? ` · Typen: ${maskiereGeschuetzteNamen(andereTypen.join(", "))}` : ""
                  }${type === "fehllauf" ? " · bezahlt, ohne verwertbare Antwort (metadata.source fehllauf), gleich welcher Typ" : ""}`
            }
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: ZAEHLER_FARBE[type] }}
            />
            <span className="text-xs text-text-secondary">{ZAEHLER_LABEL[type]}</span>
            <span
              className={`font-bold font-[family-name:var(--font-outfit)] ${error ? "text-[10px]" : "text-sm"}`}
              style={{ color: ZAEHLER_FARBE[type] }}
            >
              {loading ? "…" : error ? "nicht lesbar" : typeCounts[type]}
            </span>
          </button>
        ))}

        {/* Agent Filter */}
        <div className="ml-auto">
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-xs text-text-secondary focus:outline-none focus:border-accent-violet"
            title={agentsError ? `Agenten-Register nicht lesbar: ${agentsError}` : "Agenten aus dem Register, ohne ausgeblendete"}
          >
            <option value="all">Alle Agenten</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {/* Gegencheck 06.11.2026: der Lesefehler sichtbar, nicht nur im title */}
          {agentsError && (
            <p className="text-[10px] mt-1 text-right" style={{ color: "var(--gp-rose)" }} title={`Agenten-Register nicht lesbar: ${agentsError}`}>
              Agenten nicht lesbar
            </p>
          )}
        </div>
      </div>
      <p className="text-[10px] text-text-muted mb-6">
        Zähler: in den neuesten {NACHRICHTEN_GRENZE} Nachrichten der Tabelle messages, im Browser gelesen, ohne
        ausgeblendete Agenten
        {!loading && !error
          ? ` · jede Nachricht in genau einem Zähler, Summe ${formatiereZahl(sichtbar.length)}`
          : ""}
        {!loading && !error && fehllaeufe > 0
          ? ` · ${formatiereZahl(fehllaeufe)} ${fehllaeufe === 1 ? "Fehllauf" : "Fehlläufe"} (bezahlt, ohne verwertbare Antwort) nicht als Antwort gezählt`
          : ""}
      </p>

      {/* Connection Status — nur aus dem subscribe-Callback; Zähler mit Gegenprobe des Servers */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-4">
        <div className={`status-dot ${verbindung.klasse}`} title={verbindungTitel} />
        <span className="text-[10px] text-text-muted uppercase tracking-widest" title={verbindungTitel}>
          {verbindung.text} —
        </span>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">{zaehlerText}</span>
        {!loading && !error && ausgeblendet > 0 && (
          <span className="text-[10px] text-text-muted uppercase tracking-widest">
            · {formatiereZahl(ausgeblendet)} von ausgeblendeten Agenten nicht angezeigt
          </span>
        )}
        {!loading && !error && server.anzahl !== null && (
          <span className="text-[10px] text-text-muted uppercase tracking-widest" title={server.titel}>
            · Server zählt {formatiereZahl(server.anzahl)} insgesamt
          </span>
        )}
        {filter !== "all" && (
          <button
            onClick={() => setFilter("all")}
            className="text-[10px] text-accent-violet hover:underline ml-2"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Message List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card-ghost p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="card-ghost p-8 text-center">
          <p className="text-sm break-words" style={{ color: "var(--gp-rose)" }}>
            Nachrichten nicht lesbar: {error}
          </p>
          <p className="text-text-muted text-xs mt-2">Ohne Lesezugriff ist keine Aussage über den Bus möglich.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-ghost p-12 text-center" title={messages.length === 0 ? server.titel : undefined}>
          <div className="text-4xl mb-3 opacity-20">⇋</div>
          <p
            className={leer.widerspruch ? "text-sm" : "text-text-secondary text-sm"}
            style={leer.widerspruch ? { color: "var(--gp-amber)" } : undefined}
          >
            {leer.text}
          </p>
          {leer.zusatz && <p className="text-text-muted text-xs mt-2">{leer.zusatz}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((msg, i) => (
            <div
              key={msg.id}
              className="card-ghost p-4 hover:border-border transition-all animate-slide-up"
              style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
            >
              <div className="flex items-center gap-3 mb-2">
                {/* Type Badge — ein Fehllauf mit eigenem Etikett statt grünem "response" */}
                {istFehllaufNachricht(msg) ? (
                  <span
                    className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider font-medium"
                    style={{ border: "1px solid rgba(255, 77, 106, 0.4)", color: "var(--gp-rose)" }}
                    title="Fehllauf: bezahlter Aufruf ohne verwertbare Antwort (metadata.source fehllauf)"
                  >
                    Fehllauf
                  </span>
                ) : (
                  <span
                    className="text-[9px] px-2 py-0.5 rounded font-mono uppercase tracking-wider font-medium"
                    style={{
                      background: `${eigenerEintrag(TYPE_COLORS, msg.message_type) ?? "#666"}20`,
                      color: eigenerEintrag(TYPE_COLORS, msg.message_type) ?? "#666",
                    }}
                  >
                    {String(msg.message_type ?? "")}
                  </span>
                )}

                {/* Priority */}
                {(msg.priority === "urgent" || msg.priority === "critical") && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-rose/10 text-accent-rose font-mono">
                    {msg.priority.toUpperCase()}
                  </span>
                )}

                {/* Route */}
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground font-[family-name:var(--font-outfit)]">
                    {String(msg.from_agent ?? "")}
                  </span>
                  <span className="text-text-muted">→</span>
                  <span className="text-sm text-text-secondary">
                    {sichtbareEmpfaenger(msg).join(", ") || nachrichtKanaele(msg).join(", ") || "—"}
                  </span>
                </div>

                {/* Timestamp */}
                <span className="text-[10px] text-text-muted ml-auto font-mono">
                  {new Date(msg.created_at).toLocaleString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>

              {/* Content */}
              <p className="text-sm text-text-secondary leading-relaxed break-words">
                {maskiereGeschuetzteNamen(nachrichtText(msg))}
              </p>

              {/* Metadata (Objekt oder JSON-Text) */}
              {metadatenEintraege(msg.metadata).length > 0 && (
                <div className="mt-2 pt-2 border-t border-border-subtle flex gap-2 flex-wrap">
                  {metadatenEintraege(msg.metadata).map(([key, val]) => (
                    <span
                      key={key}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted font-mono break-all"
                    >
                      {maskiereGeschuetzteNamen(metaWertText(key, val, { meta: msg.metadata, preisStandAb: PREIS_STAND_AB }))}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Command Panel */}
      <div className="mt-6">
        <CommandPanel agents={agents} agentsFehler={agentsError} />
      </div>
    </div>
  );
}
