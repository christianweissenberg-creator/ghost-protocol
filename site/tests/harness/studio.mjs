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

/** Lädt beleg-hilfen.ts, BelegKette.tsx und FreigabeKnopf.tsx mit den Attrappen der Seite. */
export function ladeStudioBausteine(attrappen) {
  const hilfen = ladeTsx("components/studio/beleg-hilfen.ts", attrappen);
  const mitHilfen = { ...attrappen, [HILFEN]: hilfen };
  const kette = ladeTsx("components/studio/BelegKette.tsx", mitHilfen);
  const knopf = ladeTsx("components/studio/FreigabeKnopf.tsx", mitHilfen);
  return { hilfen, kette, knopf, module: { [HILFEN]: hilfen, [KETTE]: kette, [KNOPF]: knopf } };
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
      const slot = { deps, aufraeumen: alt?.aufraeumen };
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
  return {
    attrappen: { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment } },
    jsx,
    setzeWurzel(w, props = {}) {
      wurzel = w;
      wurzelProps = props;
    },
    rendere,
    ruhe,
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
