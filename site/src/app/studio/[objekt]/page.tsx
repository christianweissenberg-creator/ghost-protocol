"use client";

// Objekt-Studio /studio/[objekt] — Schritt 2 (08.11.2026).
// Client-Seite mit useParams wie app/agents/[id]/page.tsx: liest GET /api/studio/<slug>
// (ohne Cache) und zeigt die Antwort mit components/studio/StudioAnsicht.tsx. Welche Objekte ein
// Studio haben, entscheidet die Route (Allow-List in lib/studio/objekte.ts: sonst 404 "Objekt
// nicht im Studio", 400 bei falscher Form) — die Seite zeigt deren Fehlertext. Den Export-Zugang
// und die Datenbank sieht der Browser nicht: beides liest nur der Server.
// Kein Knopf postet oder gibt frei; die Beleg-Kette kopiert auf Wunsch den CTA-Link (wie /content). Einen bezahlten Lauf
// startet nur „Text erzeugen“ im Medien-Panel, nach Bestätigung (Nachtrag d2-text-erzeugen-6).
// Seit Schritt 6 (10.11.2026) fragt das Anker-Panel in der Ansicht seine Prüfung selbst ab
// (GET /api/studio/<slug>/anker, beim Aufbau und mit „Alle prüfen“).
//
// Stand und „neu laden“ (Schritt 7, 10.11.2026): Die Seite liest beim Öffnen und auf „neu laden“, nie im Takt.
// Grund: GET /api/studio liest bei jedem Aufruf den Steinadel-Export (/api/objekte) und vier Tabellen; ein Takt
// während eines Laufs (etwa 1–2 min) hieße bei 15 s rund acht volle Lesungen, und eine hängende Entwurf-Zeile hielte
// ihn offen. Stattdessen nennt die Stand-Zeile die Ladezeit, Entwurf-Karten sagen, dass sie einen Zwischenstand
// zeigen, und „neu laden“ liest einmal. Beim Neuladen bleibt der alte Stand sichtbar, bis der neue da ist; scheitert
// es, bleibt er mit dem Grund stehen. Nach „So einspielen“ lädt das Medien-Panel die Seite selbst neu.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StudioAnsicht, leseStudioAntwort } from "@/components/studio/StudioAnsicht";
import type { StudioLesung } from "@/components/studio/StudioAnsicht";
import { maskiert } from "@/components/studio/beleg-hilfen";
import type { StudioAntwort } from "@/lib/studio/typen";

const LAEDT: StudioLesung = { art: "laedt" };

export default function StudioSeite() {
  const params = useParams();
  const roh = params?.objekt;
  const slug = typeof roh === "string" ? roh : Array.isArray(roh) ? String(roh[0] ?? "") : "";

  // Die Lesung gehört zu Slug und Lauf: Wechselt der Slug, gilt bis zur neuen Antwort "lädt"; beim Neuladen
  // (neuer Lauf) bleiben die letzten Daten desselben Slugs sichtbar.
  const [lauf, setLauf] = useState(0);
  const [stand, setStand] = useState<{ slug: string; lauf: number; lesung: StudioLesung } | null>(null);
  const [daten, setDaten] = useState<{ slug: string; antwort: StudioAntwort; geladenAm: string } | null>(null);
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
      if (steuerung.signal.aborted) return;
      setStand({ slug, lauf, lesung });
      if (lesung.art === "daten") setDaten({ slug, antwort: lesung.antwort, geladenAm: new Date().toISOString() });
    }
    laden();
    return () => steuerung.abort();
  }, [slug, lauf]);

  const neuLaden = useCallback(() => setLauf((n) => n + 1), []);

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

  const aktuell = stand !== null && stand.slug === slug && stand.lauf === lauf ? stand.lesung : LAEDT;
  const letzte = daten !== null && daten.slug === slug ? daten : null;
  // Gibt es Daten zu diesem Slug, bleiben sie beim Neuladen und nach einem gescheiterten Neuladen stehen.
  if (letzte !== null && aktuell.art !== "daten") {
    return (
      <StudioAnsicht
        slug={slug}
        lesung={{ art: "daten", antwort: letzte.antwort }}
        kopiere={kopiere}
        kopierStatus={kopierStatus}
        stand={{ geladenAm: letzte.geladenAm, laedt: aktuell.art === "laedt", fehler: aktuell.art === "abgewiesen" ? aktuell.text : null }}
        neuLaden={neuLaden}
      />
    );
  }
  return (
    <StudioAnsicht
      slug={slug}
      lesung={aktuell}
      kopiere={kopiere}
      kopierStatus={kopierStatus}
      stand={letzte !== null ? { geladenAm: letzte.geladenAm, laedt: false, fehler: null } : undefined}
      neuLaden={neuLaden}
    />
  );
}
