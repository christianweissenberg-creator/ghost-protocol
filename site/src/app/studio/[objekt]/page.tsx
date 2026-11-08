"use client";

// Objekt-Studio /studio/[objekt] — Schritt 2 (08.11.2026), nur lesend.
// Client-Seite mit useParams wie app/agents/[id]/page.tsx: liest einmal GET /api/studio/<slug>
// (ohne Cache) und zeigt die Antwort mit components/studio/StudioAnsicht.tsx. Welche Objekte ein
// Studio haben, entscheidet die Route (Allow-List in lib/studio/objekte.ts: sonst 404 "Objekt
// nicht im Studio", 400 bei falscher Form) — die Seite zeigt deren Fehlertext. Den Export-Zugang
// und die Datenbank sieht der Browser nicht: beides liest nur der Server.
// Kein Knopf löst etwas aus; einzig die Beleg-Kette kopiert auf Wunsch den CTA-Link (wie /content).

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StudioAnsicht, leseStudioAntwort } from "@/components/studio/StudioAnsicht";
import type { StudioLesung } from "@/components/studio/StudioAnsicht";
import { maskiert } from "@/components/studio/beleg-hilfen";

const LAEDT: StudioLesung = { art: "laedt" };

export default function StudioSeite() {
  const params = useParams();
  const roh = params?.objekt;
  const slug = typeof roh === "string" ? roh : Array.isArray(roh) ? String(roh[0] ?? "") : "";

  // Die Lesung gehört zu ihrem Slug: Wechselt der Slug, gilt bis zur neuen Antwort "lädt".
  const [stand, setStand] = useState<{ slug: string; lesung: StudioLesung } | null>(null);
  const [kopiert, setKopiert] = useState<string | null>(null);

  useEffect(() => {
    const steuerung = new AbortController();
    async function laden() {
      let lesung: StudioLesung;
      try {
        const res = await fetch(`/api/studio/${encodeURIComponent(slug)}`, { cache: "no-store", signal: steuerung.signal });
        // Ohne lesbares JSON (etwa HTML eines Reverse-Proxys) zählt nur der Status.
        const daten: unknown = await res.json().catch(() => null);
        lesung = leseStudioAntwort(res.status, daten);
      } catch (e) {
        lesung = {
          art: "abgewiesen",
          httpStatus: null,
          text: `Netzfehler: ${maskiert(e instanceof Error ? e.message : "unbekannter Fehler")}`,
        };
      }
      if (!steuerung.signal.aborted) setStand({ slug, lesung });
    }
    laden();
    return () => steuerung.abort();
  }, [slug]);

  const kopiere = useCallback((key: string, text: string) => {
    const merke = (wert: string) => {
      setKopiert(wert);
      setTimeout(() => setKopiert((k) => (k === wert ? null : k)), 2000);
    };
    // navigator.clipboard fehlt ohne sicheren Kontext; dann sichtbar scheitern (wie /content).
    if (!navigator.clipboard) {
      merke(`${key}:fehler`);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => merke(key),
      () => merke(`${key}:fehler`)
    );
  }, []);

  const kopierStatus = useCallback(
    (key: string) => (kopiert === key ? "Kopiert ✓" : kopiert === `${key}:fehler` ? "Kopieren fehlgeschlagen" : "Kopieren"),
    [kopiert]
  );

  const lesung = stand !== null && stand.slug === slug ? stand.lesung : LAEDT;
  return <StudioAnsicht slug={slug} lesung={lesung} kopiere={kopiere} kopierStatus={kopierStatus} />;
}
