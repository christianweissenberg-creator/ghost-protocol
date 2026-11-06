"use client";

import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";
import {
  alsJsonObjekt,
  formatiereUsd,
  istFehllaufNachricht,
  istSichtbarerAgent,
  leereAbfrageHinweis,
  nachrichtInhaltText,
  realtimeAnzeige,
} from "@/lib/types";
import type { Message, RealtimeZustand } from "@/lib/types";

// Fixrunde 06.11.2026: Fehlläufe (metadata.source "fehllauf": bezahlter Aufruf ohne
// verwertbare Antwort) sind als solche gekennzeichnet, mit geschätzten Kosten statt wie eine
// Agenten-Antwort. Nachrichten ausgeblendeter Agenten (lib/types.ts) erscheinen nicht. Texte
// aus dem Bus zeigen den geschützten Namen nicht.

// Nachprüfung im Browser 06.11.2026: Ein Lesefehler von useMessages kommt als "fehler" herein.
// Vorher stand bei ausgefallener Datenbank "Noch keine Nachrichten im Bus" — eine Aussage über
// den Bus, die gar nicht gelesen wurde.

// Gegencheck 06.11.2026: Eine leere Abfrage ohne Fehler hieß "Noch keine Nachrichten im Bus" —
// eine Aussage über die Tabelle, obwohl ein gesperrter Lesezugriff ebenfalls keine Zeile liefert.
// Jetzt sagt der Feed, was die Abfrage lieferte (leereAbfrageHinweis), mit der Zählung aus
// /api/status als Gegenprobe; ist der Realtime-Kanal nicht verbunden, kann die Liste auch
// veraltet sein, und das steht dabei.

interface MessageFeedProps {
  messages: Message[];
  /** Lesefehler von useMessages; gesetzt heißt: Die Liste ist nicht gelesen, "leer" ist nicht belegt. */
  fehler?: string | null;
  /** Gesamtzahl laut /api/status (Gegenprobe für eine leere Liste); null = nicht verfügbar. */
  serverAnzahl?: number | null;
  /** Zustand des Realtime-Kanals von useMessages. */
  realtime?: RealtimeZustand;
}

const TYPE_COLORS: Record<string, string> = {
  task: "#06b6d4",
  response: "#22c55e",
  broadcast: "#8b5cf6",
  alert: "#ff3366",
};

function alsListe(wert: unknown): string[] {
  return Array.isArray(wert) ? wert.map((x) => String(x)) : [];
}

/**
 * Sichtbar, wenn der Absender kein ausgeblendeter Agent ist und die Nachricht nicht nur an
 * ausgeblendete Agenten geht. Das Command Center zählt mit derselben Regel.
 */
export function istSichtbareNachricht(m: Pick<Message, "from_agent" | "to_agents" | "to_channels">): boolean {
  if (!istSichtbarerAgent({ id: String(m.from_agent ?? "") })) return false;
  const an = alsListe(m.to_agents);
  const kanaele = alsListe(m.to_channels);
  if (an.length > 0 && kanaele.length === 0 && an.every((a) => !istSichtbarerAgent({ id: a }))) return false;
  return true;
}

// Gegencheck 06.11.2026: dieselben Regeln wie /messages (lib/types.ts) — metadata und content
// dürfen auch JSON-Text sein (Python-Agenten bis 06.11.2026).
function metadatenVon(m: Message): Record<string, unknown> {
  return alsJsonObjekt(m.metadata) ?? {};
}

function istFehllauf(m: Message): boolean {
  return istFehllaufNachricht(m);
}

function textVon(m: Message): string {
  return nachrichtInhaltText(m.content);
}

function zeitVon(m: Message): string {
  const t = Date.parse(m.timestamp ?? m.created_at ?? "");
  if (!Number.isFinite(t)) return "Zeit unbekannt";
  return new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function zahlOderNull(wert: unknown): number | null {
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

/** Kennzeile eines Fehllaufs: was es war und was es (geschätzt) gekostet hat. */
function fehllaufAngaben(m: Message): { zeile: string; titel: string } {
  const meta = metadatenVon(m);
  const art = meta.art === "planung" ? "Planung" : meta.art === "aktivierung" ? "Aktivierung" : "Aufruf";
  const kosten = zahlOderNull(meta.cost_usd);
  const ein = zahlOderNull(meta.input_tokens);
  const aus = zahlOderNull(meta.output_tokens);
  const modell = typeof meta.model === "string" && meta.model ? meta.model : "nicht gemeldet";
  const stop = typeof meta.stop_reason === "string" && meta.stop_reason ? meta.stop_reason : "nicht gemeldet";
  return {
    zeile: `${art} · bezahlter Aufruf ohne verwertbare Antwort · Kosten ${
      kosten === null ? "nicht gemessen" : `${formatiereUsd(kosten, 4)} (geschätzt)`
    }`,
    titel: [
      "Fehllauf: Der Aufruf wurde bezahlt, die Antwort war nicht verwertbar.",
      `Modell: ${modell}`,
      `Tokens: ${ein ?? "?"} ein / ${aus ?? "?"} aus`,
      `stop_reason: ${stop}`,
      "Kosten: Schätzung aus Tokens × fester Preistabelle",
    ].join("\n"),
  };
}

export function MessageFeed({ messages, fehler = null, serverAnzahl = null, realtime }: MessageFeedProps) {
  const sichtbar = messages.filter(istSichtbareNachricht);
  const ausgeblendet = messages.length - sichtbar.length;

  const fehlerKarte = fehler ? (
    <div className="card-ghost p-6 text-center" role="status">
      <p className="text-sm" style={{ color: "var(--gp-rose)" }}>
        Nachrichten nicht lesbar: {maskiereGeschuetzteNamen(fehler)}
      </p>
      <p className="text-text-muted text-xs mt-2">Ohne Lesezugriff ist keine Aussage über den Bus möglich.</p>
    </div>
  ) : null;

  // Stufe 1 (05.11.2026): Leertext ohne Verbindungsbehauptung. "Supabase Realtime
  // verbindet automatisch" war ungeprüft; die erste Zeile hätte dasselbe doppelt gesagt.
  if (sichtbar.length === 0) {
    if (fehlerKarte) return fehlerKarte;
    if (ausgeblendet > 0) {
      return (
        <div className="card-ghost p-6 text-center">
          <p className="text-text-muted text-sm">
            {`Keine Nachrichten sichtbarer Agenten unter den geladenen — ${ausgeblendet} von ausgeblendeten Agenten nicht angezeigt.`}
          </p>
        </div>
      );
    }
    const leer = leereAbfrageHinweis("Nachrichten", serverAnzahl);
    const veraltet =
      leer.widerspruch && realtime !== undefined && realtime !== "SUBSCRIBED"
        ? ` Oder die Liste ist veraltet (${realtimeAnzeige(realtime).text}) — Seite neu laden.`
        : "";
    return (
      <div className="card-ghost p-6 text-center" role="status">
        <p className="text-sm" style={{ color: leer.widerspruch ? "var(--gp-amber)" : "var(--gp-ink-2)" }}>
          {leer.text}
        </p>
        {leer.zusatz && (
          <p className="text-text-muted text-xs mt-2">
            {leer.zusatz}
            {veraltet}
          </p>
        )}
      </div>
    );
  }

  const liste = (
    <div className="card-ghost divide-y divide-border-subtle max-h-[400px] overflow-y-auto">
      {sichtbar.map((msg) => {
        const fehllauf = istFehllauf(msg) ? fehllaufAngaben(msg) : null;
        const typFarbe = TYPE_COLORS[msg.message_type] ?? "#666";
        const empfaenger = alsListe(msg.to_agents).filter((a) => istSichtbarerAgent({ id: a }));
        const kanaele = alsListe(msg.to_channels);
        return (
          <div key={msg.id} className="p-3 hover:bg-surface-elevated/50 transition-colors animate-slide-up">
            <div className="flex items-center gap-2 mb-1">
              {fehllauf ? (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
                  style={{ border: "1px solid rgba(255, 77, 106, 0.4)", color: "var(--gp-rose)" }}
                  title={fehllauf.titel}
                >
                  Fehllauf
                </span>
              ) : (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
                  style={{ background: `${typFarbe}20`, color: typFarbe }}
                >
                  {msg.message_type}
                </span>
              )}
              <span className="text-xs font-semibold text-foreground">
                {msg.from_agent}
              </span>
              <span className="text-text-muted text-xs">→</span>
              <span className="text-xs text-text-secondary">
                {empfaenger.join(", ") || kanaele.join(", ") || "—"}
              </span>
              <span className="text-[10px] text-text-muted ml-auto font-mono">
                {zeitVon(msg)}
              </span>
            </div>
            {fehllauf && (
              <p className="text-[11px] leading-relaxed mb-1" style={{ color: "var(--gp-rose)" }} title={fehllauf.titel}>
                {fehllauf.zeile}
              </p>
            )}
            <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">
              {maskiereGeschuetzteNamen(textVon(msg))}
            </p>
          </div>
        );
      })}
      {ausgeblendet > 0 && (
        <p className="p-3 text-[10px] text-text-muted font-mono">
          {ausgeblendet} {ausgeblendet === 1 ? "Nachricht" : "Nachrichten"} ausgeblendeter Agenten nicht angezeigt.
        </p>
      )}
    </div>
  );

  // Liste trotz Lesefehler (etwa Nachrichten aus dem Realtime-Kanal): Fehler steht darüber.
  return fehlerKarte ? (
    <div className="space-y-3">
      {fehlerKarte}
      {liste}
    </div>
  ) : (
    liste
  );
}
