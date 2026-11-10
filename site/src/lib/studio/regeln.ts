// Objekt-Studio: "Regeln, die mitlaufen" (Schritt 2, 08.11.2026) — statische Liste für die
// Studio-Seite. Jede Regel nennt, wo sie steht (Datei im Repo oder Commit) und wie sie durchgesetzt
// wird. Nur öffentlich zitierbare Fundstellen; wo es keine gibt, steht das dabei. Regeln, deren
// Prüfung erst ein späterer Bauschritt bringt, stehen mit "noch nicht gebaut (Schritt N)" da — nie
// als laufende Prüfung. Die Anker-Regel prüft seit Schritt 6 (10.11.2026) der Server, den
// Startbild-Abgleich seit Schritt 7 und die Medien-Regel seit Schritt 8 (beide 10.11.2026).

import { MIN_FREIGABE_ZEICHEN } from "@/lib/freigabe-regeln";

export interface StudioRegel {
  regel: string;
  /** Datei im Repo oder Commit, wo die Regel steht. */
  fundstelle: string;
  /** Wie die Regel durchgesetzt wird — oder dass sie es nicht automatisch wird. */
  pruefung: string;
}

const PIPELINE = "site/src/app/api/content/pipeline/route.ts (buildObjektBlock)";

export const STUDIO_REGELN: readonly StudioRegel[] = [
  {
    regel: "Nur das COUNSEL-Urteil FREIGABE lässt durch; UNKLAR und jeder Zusatz sperren.",
    fundstelle: "site/src/lib/counsel-urteil.ts (werteCounselAus)",
    pruefung: "Code, bei jedem Lauf und jeder Anzeige",
  },
  {
    regel: `Freigeben nur mit COUNSEL-Urteil FREIGABE, Text ab ${MIN_FREIGABE_ZEICHEN} Zeichen und ohne geschützten Namen.`,
    fundstelle: "site/src/lib/freigabe-regeln.ts (pruefeFreigabe)",
    pruefung: "Code, serverseitig beim Freigeben",
  },
  {
    regel: "Der geschützte Name erscheint in keiner Anzeige, nur maskiert.",
    fundstelle: "site/src/lib/freigabe-regeln.ts (maskiereGeschuetzteNamen)",
    pruefung: "Code, in jeder Anzeige des Studios",
  },
  {
    // 0f553a9 verlangte die Kennzeichnung "im Bild UND in der Caption"; den ausgeschriebenen,
    // sichtbaren Text (eine Anweisung an den Designer genügt nicht) brachte erst 77229ef.
    regel: "KI-Hinweis als sichtbarer Text im Content, nie nur als Design-Notiz.",
    fundstelle: `Commits 0f553a9 und 77229ef; ${PIPELINE}, Pflicht-Element 2`,
    pruefung: "COUNSEL prüft den Text",
  },
  {
    regel: "Disclaimer „Modellrechnung“ auf jedem Kanal, nicht nur auf X.",
    fundstelle: `Commit 0f553a9; ${PIPELINE}, Pflicht-Element 1`,
    pruefung: "COUNSEL prüft den Text",
  },
  {
    regel: "AfA im Hook qualifizieren: „Denkmal-AfA bis …“, nie als Abschreibung oder Ersparnis.",
    fundstelle: `Commit f8dd6c6; ${PIPELINE}, Pflicht-Element 0`,
    pruefung: "COUNSEL prüft den Text",
  },
  {
    regel: "Keine erfundenen Handles, Geschäftszahlen oder Interna.",
    fundstelle: `Commit 0f553a9; ${PIPELINE}, Pflicht-Elemente 3 und 4`,
    pruefung: "COUNSEL prüft den Text",
  },
  {
    regel: "Kein automatisches Posten; veröffentlicht wird von Hand.",
    fundstelle: "Commit 8a7baeb; tools/posting_guard.py (Posting-Riegel)",
    pruefung: "Riegel im Agenten-Container, vom Dashboard nicht messbar",
  },
  {
    regel: "Keine Zahl ohne Quelle, nie 0 als Platzhalter.",
    fundstelle: "site/src/lib/status-types.ts (Messwert); site/src/lib/studio/typen.ts",
    pruefung: "Code, in jeder Antwort und Anzeige des Studios",
  },
  {
    // Seit Schritt 6 (10.11.2026) gebaut: Manifest als Code-Konstante, Prüfung auf dem Server; seit der Gegenprüfung
    // von PR #8 (10.11.2026) mit Zwischenspeicher (lib/studio/anker-speicher.ts: 15 min, „Alle prüfen“ ab 60 s).
    regel: "Anker-Bilder nur aus dem Anker-Manifest und mit unverändertem Datei-Hash; ein Anker heißt Visualisierung, nie Foto.",
    fundstelle:
      "site/src/lib/studio/anker.ts (ANKER_MANIFESTE); site/src/lib/studio/anker-pruefung.ts (pruefeAnker); site/src/lib/studio/anker-speicher.ts (ankerErgebnis)",
    pruefung:
      "Code, serverseitig: SHA-256 jeder Live-Datei gegen das Manifest und urls.cover im Export — beim Laden des Studios (Ergebnis höchstens 15 min alt, das Alter steht dabei) und mit „Alle prüfen“ (höchstens einmal je 60 s)",
  },
  {
    // Seit Schritt 7 (10.11.2026): Abgleich auf dem Server beim Einspielen; ein nicht bestandener Abgleich wird mit
    // Messwert gespeichert und sperrt über die Medien-Regel (Schritt 8), er weist das Einspielen nicht ab.
    regel: "Ein Video startet nur aus einem Ausschnitt eines Ankers; das Startbild wird gegen diesen Ausschnitt abgeglichen.",
    fundstelle: "site/src/lib/studio/startbild.ts (gleicheStartbildAb, STARTBILD_TOLERANZ); site/src/app/api/studio/[objekt]/medien/route.ts",
    pruefung:
      "Code, serverseitig beim Einspielen: Anker live geladen und gegen das Manifest gehasht, Ausschnitt nach Rezept, Pixelvergleich je Kanal mit Toleranz 2; Ergebnis mit größter Abweichung in der Startbild-Zeile",
  },
  {
    // Seit Schritt 8 (10.11.2026): Bedingung 9 der Medien-Regel; der Nachweis-Verweis steht im Prüfprotokoll, nie im Code.
    regel: "Medien erst freigebbar, wenn die Nutzungsrechte geklärt und mit Nachweis vermerkt sind; bis dahin keine Veröffentlichung.",
    fundstelle: "site/src/lib/medien-freigabe.ts (pruefeMedienFreigabe, Bedingung 9); Prüfprotokoll studio_pruefung",
    pruefung: "Code, serverseitig beim Freigeben und in der Studio-Ansicht (Medien-Regel mit allen Gründen)",
  },
  {
    // Seit Schritt 8 (10.11.2026).
    regel:
      "Ein Video ist erst freigebbar, wenn jede Bedingung der Medien-Regel gilt: Kette mit gleicher job_id, jüngstes Prüfprotokoll zur Datei, jede Prompt-Klausel bestanden, Anker-Abgleich bestanden, KI-Hinweis eingebrannt und im festgelegten Wortlaut, Durchsicht in voller Bildrate, Schnittfenster im Original, Anker und Startbild-Abgleich.",
    fundstelle: "site/src/lib/medien-freigabe.ts (pruefeMedienFreigabe); site/src/lib/studio/ki-hinweis.ts (KI_HINWEIS_BILD)",
    pruefung: "Code, serverseitig beim Freigeben (409 mit Grund, Export-Datei vorher nachgehasht); Prüfprotokoll mit vom Server berechnetem Urteil",
  },
  {
    regel: "Bauträger öffentlich nicht namentlich nennen.",
    fundstelle: "Vorgabe des Inhabers; im Repo ohne eigene Fundstelle",
    pruefung: "nicht automatisch geprüft — es gibt keinen Namensfilter dafür",
  },
];
