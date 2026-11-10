// Objekt-Studio Schritt 6 (10.11.2026): Zwischenspeicher der Anker-Prüfung — wie PR #5–#7 sparsam.
//
// Eine volle Prüfung lädt die elf Manifest-Dateien (4.565.052 B) von steinadel.de und liest den Export. Ohne
// Speicher tat das jeder Seitenaufbau, jeder Tab und jede Navigation auf die Studio-Seite (Prüfung 10.11.2026,
// auch von einer fremden Seite aus). Deshalb gilt je Objekt:
// - Seitenaufbau (GET, art "anzeigen"): das letzte Ergebnis, solange es jünger als ANKER_GUELTIG_MS ist; sonst
//   wird einmal geprüft. Gibt es noch keines (neuer Prozess, etwa nach einem Deploy), prüft der erste Aufbau.
// - „Alle prüfen“ (POST, art "frisch"): eine neue Prüfung, frühestens ANKER_PAUSE_MS nach dem Ende der letzten;
//   davor kommt das letzte Ergebnis mit gedrosselt = true zurück.
// - Läuft schon eine Prüfung, schließt sich jede Anfrage ihr an (keine zweite Ladung).
// - Gespeichert wird nur ein vollständiges Ergebnis. Scheitert eine Prüfung (Programmfehler), bleibt der alte
//   Stand, und die nächste Anfrage prüft neu. Der Speicher lebt im Prozess; ein Neustart leert ihn.
// Werte (Setzung, begründet im PR):
// - 15 min Gültigkeit: Die Dateien ändern sich nur mit einem Deploy von steinadel.de. 15 min halten die
//   automatischen Prüfungen bei höchstens 4 je Stunde (≤ 18,3 MB/h), auch bei vielen Tabs oder Navigationen,
//   und die Anzeige nennt das Alter.
// - 60 s Mindestpause: Eine Prüfung dauert Sekunden; „Alle prüfen“ bleibt damit nutzbar, aber nicht als
//   Schleife (höchstens 60 je Stunde, nur von dieser Seite aus).

import "server-only";
import type { StudioObjekt } from "./objekte";
import type { AnkerAntwort, AnkerRoutenAntwort } from "./typen";

/** So lange zeigt der Seitenaufbau das letzte Ergebnis, ohne neu zu prüfen. */
export const ANKER_GUELTIG_MS = 15 * 60_000;
/** Mindestabstand zwischen dem Ende einer Prüfung und einer erzwungenen neuen („Alle prüfen“). */
export const ANKER_PAUSE_MS = 60_000;

interface Eintrag {
  antwort: AnkerAntwort;
  /** Ende der Prüfung (ms seit Epoche, Uhr des Servers). */
  fertigMs: number;
}

const letzte = new Map<StudioObjekt, Eintrag>();
const laufend = new Map<StudioObjekt, Promise<Eintrag>>();

/** Für Tests: Speicher und laufende Prüfungen vergessen. */
export function setzeAnkerSpeicherZurueck(): void {
  letzte.clear();
  laufend.clear();
}

function starte(slug: StudioObjekt, pruefen: () => Promise<AnkerAntwort>): Promise<Eintrag> {
  let lauf = laufend.get(slug);
  if (lauf === undefined) {
    lauf = pruefen()
      .then((antwort) => {
        const eintrag = { antwort, fertigMs: Date.now() };
        letzte.set(slug, eintrag);
        return eintrag;
      })
      .finally(() => laufend.delete(slug));
    laufend.set(slug, lauf);
  }
  return lauf;
}

function mitStand(e: Eintrag, frisch: boolean, gedrosselt: boolean): AnkerRoutenAntwort {
  return {
    ...e.antwort,
    stand: {
      frisch,
      gedrosselt,
      alter_s: Math.max(0, Math.floor((Date.now() - e.fertigMs) / 1000)),
      gueltig_bis: new Date(e.fertigMs + ANKER_GUELTIG_MS).toISOString(),
      naechste_frische_ab: new Date(e.fertigMs + ANKER_PAUSE_MS).toISOString(),
    },
  };
}

/**
 * Ergebnis der Anker-Prüfung für ein Objekt: "anzeigen" (Seitenaufbau) oder "frisch" („Alle prüfen“), siehe
 * Dateikopf. pruefen führt die Prüfung aus; es wird nur aufgerufen, wenn eine neue nötig und erlaubt ist.
 */
export async function ankerErgebnis(
  slug: StudioObjekt,
  art: "anzeigen" | "frisch",
  pruefen: () => Promise<AnkerAntwort>,
): Promise<AnkerRoutenAntwort> {
  const lauf = laufend.get(slug);
  if (lauf !== undefined) return mitStand(await lauf, true, false);
  const alt = letzte.get(slug);
  // Anzeigen: das letzte Ergebnis bis zur Gültigkeitsgrenze; frisch: erst nach der Mindestpause neu, davor
  // das letzte Ergebnis als "gedrosselt".
  const grenze = art === "anzeigen" ? ANKER_GUELTIG_MS : ANKER_PAUSE_MS;
  if (alt !== undefined && Date.now() - alt.fertigMs < grenze) return mitStand(alt, false, art === "frisch");
  return mitStand(await starte(slug, pruefen), true, false);
}
