"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import type { Agent, Message } from "./types";

// Fetch all agents from Supabase
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("agents")
      .select("*")
      .order("tier", { ascending: true })
      .order("name", { ascending: true });

    if (err) {
      setError(err.message);
    } else {
      setAgents(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAgents();

    // Realtime subscription for agent status changes
    const channel = supabase
      .channel("agents-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            setAgents((prev) =>
              prev.map((a) =>
                a.id === (payload.new as Agent).id ? (payload.new as Agent) : a
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAgents]);

  return { agents, loading, error, refetch: fetchAgents };
}

// Fetch recent messages with realtime updates
export function useMessages(limit = 50) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMessages() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      setMessages(data ?? []);
      setLoading(false);
    }

    fetchMessages();

    // Realtime subscription for new messages
    const channel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          setMessages((prev) => [payload.new as Message, ...prev].slice(0, limit));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return { messages, loading };
}
