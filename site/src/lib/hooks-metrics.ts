"use client";

// Metrik-Zeilen aus der Tabelle metrics — Stufe 1 (06.11.2026, Befund R14).
// Gelesen werden die neuesten METRIK_ABFRAGE_GRENZE Zeilen über alle Typen; alle Zahlen gelten
// "in den neuesten 200 Zeilen". Ein Lesefehler wird zurückgegeben (error), nicht als leere
// Liste verschluckt: Die Seite muss "nicht lesbar" von "keine Zeilen" unterscheiden können.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { anzeigeFehler } from "./hooks";
import { METRIK_ABFRAGE_GRENZE, aggregiereMetriken } from "./types";
import type { Metric } from "./types";

export function useMetrics(agentId?: string) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;

    async function fetchMetrics() {
      try {
        let query = supabase
          .from("metrics")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(METRIK_ABFRAGE_GRENZE);

        if (agentId) {
          query = query.eq("agent_id", agentId);
        }

        const { data, error: err } = await query;
        if (!aktiv) return;
        if (err) {
          setError(anzeigeFehler(err.message));
          setMetrics([]);
        } else {
          setError(null);
          setMetrics((data ?? []) as Metric[]);
        }
      } catch (e) {
        if (aktiv) {
          setError(anzeigeFehler(e));
          setMetrics([]);
        }
      } finally {
        if (aktiv) setLoading(false);
      }
    }

    fetchMetrics();
    return () => {
      aktiv = false;
    };
  }, [agentId]);

  // Je Typ: Summe, Anzahl und der JÜNGSTE Wert (nicht das Maximum).
  const aggregated = aggregiereMetriken(metrics);
  /** Abfragegrenze erreicht: ältere Zeilen fehlen in allen Zahlen. */
  const abgeschnitten = metrics.length >= METRIK_ABFRAGE_GRENZE;

  return { metrics, aggregated, loading, error, grenze: METRIK_ABFRAGE_GRENZE, abgeschnitten };
}
