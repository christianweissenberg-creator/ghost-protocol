"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { maskiereGeschuetzteNamen } from "./freigabe-regeln";
import { istSichtbarerAgent, leseRealtimeZustand, nachrichtVorne } from "./types";
import type { Agent, Message, RealtimeZustand } from "./types";

// Steinadel-Objekt (Teilmenge der Export-API-Felder, wie /api/objekte liefert)
export interface ObjektLite {
  slug: string;
  name: string;
  preis: string;
  statusBadge?: string;
}

/**
 * Fehlertext für die Anzeige — Stufe 1 (06.11.2026). Der geschützte Name (auch als Teil
 * technischer Bezeichner wie dem Env-Namen des Export-Tokens) wird ersetzt, bevor eine
 * Meldung Browser oder Nutzer erreicht.
 */
export function anzeigeFehler(e: unknown): string {
  const text =
    e instanceof Error ? e.message : typeof e === "string" ? e : e === null || e === undefined ? "" : String(e);
  return maskiereGeschuetzteNamen(text.trim() || "unbekannter Fehler");
}

// Jeder Effektlauf bekommt einen eigenen Kanalnamen. supabase.channel() gibt für einen schon
// bekannten Namen den alten Kanal zurück; nach removeChannel (asynchron) wäre das ein Kanal im
// Abbau, und subscribe() bliebe stumm (etwa beim doppelten Effektlauf im Entwicklungsmodus).
let kanalZaehler = 0;
function eindeutigerKanal(basis: string): string {
  kanalZaehler += 1;
  return `${basis}-${kanalZaehler}`;
}

// ── Gemeinsame Browseruhr für "vor X"-Angaben — Stufe 1 (06.11.2026, Befund R3) ──
// Ein Takt für alle Abonnenten; das Rendern bleibt rein (kein Date.now() im Render).
// Vor dem ersten Takt (und auf dem Server) ist der Wert null.
const UHR_TAKT_MS = 30_000;
let uhrIso: string | null = null;
let uhrIntervall: ReturnType<typeof setInterval> | null = null;
const uhrAbonnenten = new Set<() => void>();

function uhrTick() {
  uhrIso = new Date().toISOString();
  uhrAbonnenten.forEach((melde) => melde());
}

function abonniereUhr(melde: () => void): () => void {
  uhrAbonnenten.add(melde);
  if (uhrIntervall === null) {
    uhrTick();
    uhrIntervall = setInterval(uhrTick, UHR_TAKT_MS);
  }
  return () => {
    uhrAbonnenten.delete(melde);
    if (uhrAbonnenten.size === 0 && uhrIntervall !== null) {
      clearInterval(uhrIntervall);
      uhrIntervall = null;
    }
  };
}

function uhrStand(): string | null {
  return uhrIso;
}

function uhrServer(): string | null {
  return null;
}

/** Browserzeit als ISO-Text, alle 30 s neu; null vor dem ersten Takt. */
export function useJetztIso(): string | null {
  return useSyncExternalStore(abonniereUhr, uhrStand, uhrServer);
}

// Steinadel-Objekte über den Server-Proxy /api/objekte (Export-API, read-only).
// Fail-closed: bei Fehler leere Liste + error — NIEMALS Platzhalter-Objekte
// oder erfundene Preise (Betreiber-Auftrag 29.07.2026).
// Nachprüfung 06.11.2026: fehlerArt ist das Feld "fehler_art" der Route (konfiguration,
// nicht_erreichbar, quelle_fehler); null ohne Fehler oder wenn die Antwort keins trägt.
export function useObjekte() {
  const [objekte, setObjekte] = useState<ObjektLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fehlerArt, setFehlerArt] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      try {
        const res = await fetch("/api/objekte", { cache: "no-store" });
        const daten = await res.json().catch(() => ({}));
        if (!res.ok || daten.fehler || !Array.isArray(daten.objekte)) {
          if (!abgebrochen && typeof daten.fehler_art === "string") setFehlerArt(daten.fehler_art);
          throw new Error(typeof daten.fehler === "string" ? daten.fehler : `HTTP ${res.status}`);
        }
        if (!abgebrochen) setObjekte(daten.objekte);
      } catch (e) {
        if (!abgebrochen) setError(anzeigeFehler(e));
      } finally {
        if (!abgebrochen) setLoading(false);
      }
    })();
    return () => {
      abgebrochen = true;
    };
  }, []);

  return { objekte, loading, error, fehlerArt };
}

// ── Agenten-Register — Stufe 1 (06.11.2026, Befund R13) ──
// Der Filter auf AUSGEBLENDETE_AGENTEN sitzt hier, zentral: Command Center, Agentflotte,
// /metrics, /messages und das CommandPanel bekommen nur sichtbare Agenten. Wie viele Zeilen
// ausgeblendet wurden, steht in "ausgeblendet".

interface AgentenLesung {
  agents: Agent[];
  ausgeblendet: number;
  fehler: string | null;
}

async function leseAgenten(): Promise<AgentenLesung> {
  try {
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .order("tier", { ascending: true })
      .order("name", { ascending: true });
    if (error) return { agents: [], ausgeblendet: 0, fehler: anzeigeFehler(error.message) };
    const alle = (data ?? []) as Agent[];
    const sichtbar = alle.filter(istSichtbarerAgent);
    return { agents: sichtbar, ausgeblendet: alle.length - sichtbar.length, fehler: null };
  } catch (e) {
    return { agents: [], ausgeblendet: 0, fehler: anzeigeFehler(e) };
  }
}

// Gegencheck 06.11.2026 (B24): Das Register wird alle 60 s neu gelesen. Ein UPDATE-Ereignis für
// agents ist nicht belegt (scripts/setup_supabase_v2.sql nimmt agents nicht in die Publikation
// supabase_realtime auf, subscribe() hat keinen Status-Callback); ohne Neulesen veraltete
// "zuletzt aktiviert vor X" unbemerkt gegen die laufende Uhr. Derselbe Takt wie /api/status.
const AGENTEN_TAKT_MS = 60_000;

// Fetch all agents from Supabase (ohne ausgeblendete Agenten)
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ausgeblendet, setAusgeblendet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ein Lesefehler lässt die zuletzt gelesene Liste stehen und setzt error; die Seiten zeigen
  // dann den Fehler statt der Liste. Ein erfolgreicher Lauf löscht einen alten Fehler.
  const uebernehmen = useCallback((lesung: AgentenLesung) => {
    if (lesung.fehler !== null) {
      setError(lesung.fehler);
    } else {
      setAgents(lesung.agents);
      setAusgeblendet(lesung.ausgeblendet);
      setError(null);
    }
    setLoading(false);
  }, []);

  const fetchAgents = useCallback(async () => {
    uebernehmen(await leseAgenten());
  }, [uebernehmen]);

  useEffect(() => {
    let aktiv = true;
    const lesen = () =>
      leseAgenten().then((lesung) => {
        if (aktiv) uebernehmen(lesung);
      });
    lesen();
    const takt = setInterval(lesen, AGENTEN_TAKT_MS);

    // Realtime subscription for agent changes (nur sichtbare Agenten)
    const channel = supabase
      .channel(eindeutigerKanal("agents-realtime"))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents" },
        (payload) => {
          if (payload.eventType !== "UPDATE") return;
          const neu = payload.new as Agent;
          if (!istSichtbarerAgent(neu)) return;
          setAgents((prev) => prev.map((a) => (a.id === neu.id ? neu : a)));
        }
      )
      .subscribe();

    return () => {
      aktiv = false;
      clearInterval(takt);
      supabase.removeChannel(channel);
    };
  }, [uebernehmen]);

  return { agents, ausgeblendet, loading, error, refetch: fetchAgents };
}

// ── Nachrichten — Stufe 1 (06.11.2026, Befund R12) ──
// error: Lesefehler (dann ist die Liste nicht "leer", sondern "nicht lesbar").
// realtime: Zustand aus dem subscribe-Callback; "unbekannt", bis der erste Callback kommt.

export function useMessages(limit = 50) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Der Kanalzustand gehört zu dem Kanal, den der Effekt für dieses limit angelegt hat. Ändert
  // sich limit, entsteht ein neuer Kanal; bis zu dessen erstem Callback gilt "unbekannt".
  const [realtimeStand, setRealtimeStand] = useState<{
    limit: number;
    zustand: RealtimeZustand;
    fehler: string | null;
  }>({ limit, zustand: "unbekannt", fehler: null });

  useEffect(() => {
    let aktiv = true;

    async function fetchMessages() {
      try {
        const { data, error: err } = await supabase
          .from("messages")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (!aktiv) return;
        if (err) {
          setError(anzeigeFehler(err.message));
          setMessages([]);
        } else {
          setError(null);
          setMessages((data ?? []) as Message[]);
        }
      } catch (e) {
        if (aktiv) {
          setError(anzeigeFehler(e));
          setMessages([]);
        }
      } finally {
        if (aktiv) setLoading(false);
      }
    }

    fetchMessages();

    // Realtime subscription for new messages
    const channel = supabase
      .channel(eindeutigerKanal("messages-realtime"))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          // Ohne Dublette: Die Abfrage kann die Zeile schon gelesen haben (nachrichtVorne).
          setMessages((prev) => nachrichtVorne(prev, payload.new as Message, limit));
        }
      )
      .subscribe((status, err) => {
        // Callbacks eines abgebauten Kanals (removeChannel meldet CLOSED) zählen nicht.
        if (!aktiv) return;
        setRealtimeStand({ limit, zustand: leseRealtimeZustand(status), fehler: err ? anzeigeFehler(err) : null });
      });

    return () => {
      aktiv = false;
      supabase.removeChannel(channel);
    };
  }, [limit]);

  const kanalAktuell = realtimeStand.limit === limit;
  return {
    messages,
    loading,
    error,
    realtime: kanalAktuell ? realtimeStand.zustand : ("unbekannt" as RealtimeZustand),
    realtimeFehler: kanalAktuell ? realtimeStand.fehler : null,
  };
}

// ── Agent-Detail — Stufe 1 (06.11.2026, Befund R22) ──
// Lesefehler und "nicht gefunden" sind getrennt: maybeSingle() liefert bei keiner Zeile
// data = null ohne Fehler; ein Fehler heißt "nicht lesbar".

/** Nachrichten je Agent auf der Detailseite: die neuesten 20. */
export const DETAIL_NACHRICHTEN_GRENZE = 20;

// Nur einfache IDs gehen in den PostgREST-Filter (.or(...)); alles andere wird nicht abgefragt.
const AGENT_ID_MUSTER = /^[a-z0-9_-]{1,64}$/i;

export function istGueltigeAgentId(id: unknown): id is string {
  return typeof id === "string" && AGENT_ID_MUSTER.test(id);
}

export function useAgentDetail(agentId: string) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentFehler, setAgentFehler] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesFehler, setMessagesFehler] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ladeZaehler, setLadeZaehler] = useState(0);

  const abfragbar = istGueltigeAgentId(agentId) && istSichtbarerAgent({ id: agentId });

  useEffect(() => {
    if (!abfragbar) return;
    let aktiv = true;

    async function load() {
      try {
        const { data, error } = await supabase.from("agents").select("*").eq("id", agentId).maybeSingle();
        if (!aktiv) return;
        if (error) {
          setAgentFehler(anzeigeFehler(error.message));
        } else {
          setAgentFehler(null);
          setAgent((data ?? null) as Agent | null);
        }
      } catch (e) {
        if (aktiv) setAgentFehler(anzeigeFehler(e));
      }

      try {
        const { data, error } = await supabase
          .from("messages")
          .select("*")
          .or(`from_agent.eq.${agentId},to_agents.cs.{${agentId}}`)
          .order("created_at", { ascending: false })
          .limit(DETAIL_NACHRICHTEN_GRENZE);
        if (!aktiv) return;
        if (error) {
          setMessagesFehler(anzeigeFehler(error.message));
        } else {
          setMessagesFehler(null);
          setMessages((data ?? []) as Message[]);
        }
      } catch (e) {
        if (aktiv) setMessagesFehler(anzeigeFehler(e));
      } finally {
        if (aktiv) setLoading(false);
      }
    }
    load();

    return () => {
      aktiv = false;
    };
  }, [agentId, abfragbar, ladeZaehler]);

  useEffect(() => {
    if (!abfragbar) return;
    // Realtime for this agent
    const channel = supabase
      .channel(eindeutigerKanal(`agent-${agentId}`))
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agents", filter: `id=eq.${agentId}` },
        (payload) => setAgent(payload.new as Agent)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          if (msg.from_agent === agentId || msg.to_agents?.includes(agentId)) {
            // Ohne Dublette: neuLaden() nach einer Aktivierung kann die Zeile schon gelesen haben,
            // bevor das Realtime-Ereignis ankommt (nachrichtVorne).
            setMessages((prev) => nachrichtVorne(prev, msg, DETAIL_NACHRICHTEN_GRENZE));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [agentId, abfragbar]);

  // Gegencheck 06.11.2026 (B24): alle 60 s neu lesen — Aktivierungen von anderswo (Command
  // Center, Cron) erscheinen sonst nicht, ein UPDATE-Ereignis für agents ist nicht belegt.
  useEffect(() => {
    if (!abfragbar) return;
    const takt = setInterval(() => setLadeZaehler((n) => n + 1), AGENTEN_TAKT_MS);
    return () => clearInterval(takt);
  }, [abfragbar]);

  /** Agent und Nachrichten neu lesen, etwa nach einer Aktivierung (Realtime ist nicht belegt). */
  const neuLaden = useCallback(() => setLadeZaehler((n) => n + 1), []);

  return { agent, agentFehler, messages, messagesFehler, loading: abfragbar ? loading : false, abfragbar, neuLaden };
}
