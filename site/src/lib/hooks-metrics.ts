"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Metric } from "./types";

export function useMetrics(agentId?: string) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMetrics() {
      let query = supabase
        .from("metrics")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (agentId) {
        query = query.eq("agent_id", agentId);
      }

      const { data } = await query;
      setMetrics(data ?? []);
      setLoading(false);
    }

    fetchMetrics();
  }, [agentId]);

  // Aggregate by metric type
  const aggregated = metrics.reduce(
    (acc, m) => {
      if (!acc[m.metric_type]) {
        acc[m.metric_type] = { sum: 0, count: 0, latest: 0 };
      }
      acc[m.metric_type].sum += m.value;
      acc[m.metric_type].count += 1;
      acc[m.metric_type].latest = Math.max(acc[m.metric_type].latest, m.value);
      return acc;
    },
    {} as Record<string, { sum: number; count: number; latest: number }>
  );

  return { metrics, aggregated, loading };
}
