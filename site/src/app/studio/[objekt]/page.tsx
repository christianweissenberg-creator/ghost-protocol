"use client";

// Objekt-Studio /studio/[objekt] — Schritt 2 (08.11.2026), nur lesend.
// Client-Seite mit useParams wie app/agents/[id]/page.tsx: liest einmal GET /api/studio/<slug>
// (ohne Cache) und zeigt die Antwort mit components/studio/StudioAnsicht.tsx. Welche Objekte ein
// Studio haben, entscheidet die Route (Allow-List in lib/studio/objekte.ts: sonst 404 "Objekt
// nicht im Studio", 400 bei falscher Form) — die Seite zeigt deren Fehlertext. Den Export-Zugang
// und die Datenbank sieht der Browser nicht: beides liest nur der Server.
// Kein Knopf erzeugt oder gibt frei; die Beleg-Kette kopiert auf Wunsch den CTA-Link (wie /content).
// Seit Schritt 6 (10.11.2026) fragt das Anker-Panel in der Ansicht seine Prüfung selbst ab
// (GET /api/studio/<slug>/anker, beim Aufbau und mit „Alle prüfen“).
// Nachtrag Paket B (10.11.2026): Die Seite las nur beim Öffnen. Eine Zeile, die während eines Laufs angelegt wurde,
// stand bis zum Neuladen des Tabs als „Entwurf, gesperrt: UNKLAR (kein Text)“ da. Jetzt nennt die Ansicht den Stand
// (Zeitpunkt der Lesung) und hat einen Knopf „Neu laden“, der dieselbe Lesung noch einmal holt. Bewusst kein Takt:
// Jede Lesung ruft den Steinadel-Export ab (über /api/objekte) und liest alle Zeilen des Objekts mit Text, Review
// und metadata samt Stufen-Ausgaben (lib/studio/lesen.ts, ASSET_SPALTEN). Ein Takt, solange eine Zeile „entwurf“
// ist, wiederholte das während jedes Laufs — und ohne Ende bei einer Zeile, die nach einem Abbruch ohne Vermerk
// auf „entwurf“ stehen bleibt. Ein Klick kostet genau eine Lesung. Während des Neuladens bleibt der alte Stand
// stehen (der Knopf zeigt, dass geladen wird); danach gilt die neue Lesung, auch wenn sie ein Fehler ist.

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

  // Die Lesung gehört zu ihrem Slug und ihrem Ladevorgang: Wechselt der Slug, gilt bis zur neuen Antwort "lädt".
  // lauf zählt die Klicks auf „Neu laden“ (0 = Aufbau); jeder neue Wert löst genau eine Lesung aus.
  const [lauf, setLauf] = useState(0);
  const [stand, setStand] = useState<{ slug: string; lauf: number; lesung: StudioLesung } | null>(null);
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
      if (!steuerung.signal.aborted) setStand({ slug, lauf, lesung });
    }
    laden();
    return () => steuerung.abort();
  }, [slug, lauf]);

  // Neu laden: eine Lesung je Klick; die Ansicht ignoriert Klicks, solange eine läuft (laedtNeu).
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

  // Gleicher Slug, älterer Ladevorgang: der alte Stand bleibt sichtbar, bis die neue Lesung da ist.
  const gleicherSlug = stand !== null && stand.slug === slug;
  const lesung = gleicherSlug ? stand.lesung : LAEDT;
  const laedtNeu = gleicherSlug && stand.lauf !== lauf;
  return (
    <StudioAnsicht
      slug={slug}
      lesung={lesung}
      kopiere={kopiere}
      kopierStatus={kopierStatus}
      neuLaden={neuLaden}
      laedtNeu={laedtNeu}
    />
  );
}
