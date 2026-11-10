// Bausteine aus components/studio/ für Tests (Objekt-Studio Schritt 2, 08.11.2026).
// Seit Schritt 2 importiert app/content/page.tsx Freigeben-Knopf, Beleg-Kette und deren Hilfen aus
// components/studio/. Die Tests laden die ECHTEN Dateien mit denselben Attrappen wie die Seite
// (React, jsx-runtime, lib/counsel-urteil, lib/freigabe-regeln) und reichen sie der Seite als
// Laufzeit-Importe weiter — so laufen Seite und Bausteine im Test wie im Build zusammen.
// Kopien für Mutationstests: Z_TSX_COMPONENTS_STUDIO_BELEG_HILFEN, Z_TSX_COMPONENTS_STUDIO_BELEGKETTE,
// Z_TSX_COMPONENTS_STUDIO_FREIGABEKNOPF (siehe tests/harness/tsx.mjs).
//
// Dazu eine Hook-Laufzeit mit Effekten (wie Teil B in tests/e-content-komponenten.test.mjs) und
// alsMarkup: Der aufgelöste Baum wird mit echtem React (renderToStaticMarkup) zu Markup — damit
// lassen sich Zustände vergleichen, die erst Effekte und Klicks herstellen.
import { React, ladeTsx, renderToStaticMarkup } from "./tsx.mjs";

export const HILFEN = "@/components/studio/beleg-hilfen";
export const KETTE = "@/components/studio/BelegKette";
export const KNOPF = "@/components/studio/FreigabeKnopf";

export const ANKER_PANEL = "@/components/studio/AnkerPanel";
export const MEDIEN_PANEL = "@/components/studio/MedienPanel";
export const PRUEF_ANSICHT = "@/components/studio/PruefAnsicht";

/**
 * Lädt beleg-hilfen.ts, BelegKette.tsx und FreigabeKnopf.tsx mit den Attrappen der Seite, seit Schritt 6
 * (10.11.2026) auch AnkerPanel.tsx und seit Schritt 7 (10.11.2026) MedienPanel.tsx — StudioAnsicht importiert
 * beide. lib/studio/anker.ts und lib/types.ts haben keine Laufzeit-Importe und werden hier selbst geladen.
 */
export function ladeStudioBausteine(attrappen) {
  const hilfen = ladeTsx("components/studio/beleg-hilfen.ts", attrappen);
  const mitHilfen = { ...attrappen, [HILFEN]: hilfen };
  const kette = ladeTsx("components/studio/BelegKette.tsx", mitHilfen);
  const knopf = ladeTsx("components/studio/FreigabeKnopf.tsx", mitHilfen);
  const anker = ladeTsx("lib/studio/anker.ts", {});
  const types = ladeTsx("lib/types.ts", {});
  const panel = ladeAnkerPanel(attrappen, { anker, types, hilfen });
  const pruef = ladePruefAnsicht(attrappen, { hilfen });
  const medien = ladeMedienPanel(attrappen, { anker, types, hilfen, pruef });
  return {
    hilfen,
    kette,
    knopf,
    panel,
    medien,
    pruef,
    module: { [HILFEN]: hilfen, [KETTE]: kette, [KNOPF]: knopf, [ANKER_PANEL]: panel, [MEDIEN_PANEL]: medien },
  };
}

/**
 * Lädt components/studio/PruefAnsicht.tsx (Objekt-Studio Schritt 8, 10.11.2026) mit den Attrappen der Seite (React),
 * lib/studio/ki-hinweis.ts (ohne Imports) und den Beleg-Hilfen. Kopie für Mutationstests:
 * Z_TSX_COMPONENTS_STUDIO_PRUEFANSICHT.
 */
export function ladePruefAnsicht(attrappen, { hilfen }) {
  return ladeTsx("components/studio/PruefAnsicht.tsx", {
    ...attrappen,
    "@/lib/studio/ki-hinweis": ladeTsx("lib/studio/ki-hinweis.ts", {}),
    [HILFEN]: hilfen,
  });
}

/**
 * Lädt components/studio/MedienPanel.tsx (Objekt-Studio Schritt 7, 10.11.2026) mit den Attrappen der Seite (React)
 * und den echten Modulen anker, types, hilfen und (seit Schritt 8) der Prüfansicht. Kopie für Mutationstests:
 * Z_TSX_COMPONENTS_STUDIO_MEDIENPANEL.
 */
export function ladeMedienPanel(attrappen, { anker, types, hilfen, pruef }) {
  return ladeTsx("components/studio/MedienPanel.tsx", {
    ...attrappen,
    "@/lib/studio/anker": anker,
    "@/lib/types": types,
    [HILFEN]: hilfen,
    [PRUEF_ANSICHT]: pruef ?? ladePruefAnsicht(attrappen, { hilfen }),
  });
}

/**
 * Lädt components/studio/AnkerPanel.tsx (Objekt-Studio Schritt 6, 10.11.2026) mit den Attrappen der Seite
 * (React) und den echten Modulen: anker = lib/studio/anker.ts, types = lib/types.ts, hilfen = die
 * Beleg-Hilfen aus ladeStudioBausteine. Kopie für Mutationstests: Z_TSX_COMPONENTS_STUDIO_ANKERPANEL.
 */
export function ladeAnkerPanel(attrappen, { anker, types, hilfen }) {
  return ladeTsx("components/studio/AnkerPanel.tsx", {
    ...attrappen,
    "@/lib/studio/anker": anker,
    "@/lib/types": types,
    [HILFEN]: hilfen,
  });
}

/** Hook-Laufzeit: Zustand je Aufrufreihenfolge, Callbacks, Memos und Effekte mit Abhängigkeiten. */
export function hookLaufzeit() {
  const z = { hooks: [], index: 0, effekte: [], geaendert: false };
  const Fragment = Symbol("Fragment");
  const jsx = (type, props, key) => ({ $el: true, type, props: props ?? {}, key });
  const gleich = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
  const react = {
    Fragment,
    Suspense: ({ children }) => children,
    useState(start) {
      const i = z.index++;
      if (!(i in z.hooks)) {
        const slot = { wert: typeof start === "function" ? start() : start };
        slot.setze = (v) => {
          const neu = typeof v === "function" ? v(slot.wert) : v;
          if (!Object.is(neu, slot.wert)) {
            slot.wert = neu;
            z.geaendert = true;
          }
        };
        z.hooks[i] = slot;
      }
      return [z.hooks[i].wert, z.hooks[i].setze];
    },
    useRef(start) {
      const i = z.index++;
      if (!(i in z.hooks)) z.hooks[i] = { current: start };
      return z.hooks[i];
    },
    useCallback(fn, deps) {
      const i = z.index++;
      const alt = z.hooks[i];
      if (alt && gleich(alt.deps, deps)) return alt.fn;
      z.hooks[i] = { fn, deps };
      return fn;
    },
    useMemo(fn, deps) {
      const i = z.index++;
      const alt = z.hooks[i];
      if (alt && gleich(alt.deps, deps)) return alt.wert;
      z.hooks[i] = { wert: fn(), deps };
      return z.hooks[i].wert;
    },
    useEffect(fn, deps) {
      const i = z.index++;
      const alt = z.hooks[i];
      if (alt && gleich(alt.deps, deps)) return;
      const slot = { deps, aufraeumen: alt?.aufraeumen, effekt: fn };
      z.hooks[i] = slot;
      z.effekte.push(() => {
        if (typeof slot.aufraeumen === "function") slot.aufraeumen();
        const r = fn();
        slot.aufraeumen = typeof r === "function" ? r : undefined;
      });
    },
  };
  function aufloesen(k) {
    if (k === null || k === undefined || typeof k === "boolean") return null;
    if (Array.isArray(k)) return k.map(aufloesen);
    if (typeof k !== "object" || !k.$el) return k;
    if (k.type === Fragment) return aufloesen(k.props.children);
    if (typeof k.type === "function") return aufloesen(k.type(k.props));
    return { type: k.type, props: k.props, kinder: aufloesen(k.props.children) };
  }
  let wurzel = null;
  let wurzelProps = {};
  let baum = null;
  function rendere() {
    for (let runde = 0; runde < 50; runde += 1) {
      z.index = 0;
      z.geaendert = false;
      z.effekte = [];
      baum = aufloesen(jsx(wurzel, wurzelProps));
      const effekte = z.effekte;
      z.effekte = [];
      for (const e of effekte) e();
      if (!z.geaendert) return baum;
    }
    throw new Error("Render-Schleife ohne Ende");
  }
  async function ruhe(runden = 20) {
    for (let i = 0; i < runden; i += 1) {
      await new Promise((fertig) => setImmediate(fertig));
      if (z.geaendert) rendere();
    }
    return baum;
  }
  /** Seite verlassen (Objekt-Studio Schritt 3): die Aufräumfunktion jedes Effekts läuft einmal, wie beim Unmount. */
  function abbauen() {
    for (const slot of z.hooks) {
      if (slot && typeof slot.aufraeumen === "function") {
        const aufraeumen = slot.aufraeumen;
        slot.aufraeumen = undefined;
        aufraeumen();
      }
    }
  }
  /**
   * Nach abbauen() wieder aufbauen, wie React im Strict Mode (Entwicklungsmodus) eine Komponente ab- und
   * wieder aufbaut: Zustand und Refs bleiben, jeder Effekt läuft erneut (Prüfung Schritt 3, 09.11.2026).
   */
  function wiederAufbauen() {
    for (const slot of z.hooks) {
      if (slot && typeof slot.effekt === "function") {
        const r = slot.effekt();
        slot.aufraeumen = typeof r === "function" ? r : undefined;
      }
    }
  }
  return {
    attrappen: { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment } },
    jsx,
    setzeWurzel(w, props = {}) {
      wurzel = w;
      wurzelProps = props;
    },
    rendere,
    ruhe,
    abbauen,
    wiederAufbauen,
  };
}

/** Kinder flach: verschachtelte Listen (aus .map) werden zu einer Folge, wie React sie rendert. */
function flach(k) {
  if (Array.isArray(k)) return k.flatMap(flach);
  return k === null || k === undefined ? [] : [k];
}

/** Aufgelöster Baum der Hook-Laufzeit → HTML mit echtem React (renderToStaticMarkup). */
export function alsMarkup(baum) {
  const element = (k) => {
    if (typeof k !== "object") return k;
    const props = { ...k.props };
    delete props.children;
    return React.createElement(k.type, props, ...flach(k.kinder).map(element));
  };
  return renderToStaticMarkup(React.createElement(React.Fragment, null, ...flach(baum).map(element)));
}
