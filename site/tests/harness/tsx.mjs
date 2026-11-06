// Lader für .tsx-Dateien aus site/src in Tests (Gesamtprüfung 06.11.2026, Fixrunde Z).
// Wie tests/e-content-*.test.mjs: Die ECHTE Datei wird mit dem TypeScript-Compiler aus
// node_modules nach CommonJS übersetzt; jeder Laufzeit-Import kommt aus den übergebenen
// Attrappen (sonst Fehler). intern: Namen aus dem Modul, die der Test zusätzlich braucht.
// Z_TSX_<NAME>=<pfad> lädt statt der Repo-Datei eine Kopie (Mutationstests im Scratchpad);
// NAME = Pfad unter src ohne Endung, Sonderzeichen als "_", in Großbuchstaben, z. B.
// Z_TSX_COMPONENTS_UI_COMMANDPANELS oder Z_TSX_APP_AGENTS_ID_PAGE.
// baumLaufzeit: kleine statische Hook-Laufzeit ohne DOM (useState mit Vorgabewerten, Effekte
// laufen nicht) für Seiten, deren Zustand erst ein Effekt setzen würde.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(SITE, "package.json"));
export const ts = req("typescript");
export const React = req("react");
export const jsxRuntime = req("react/jsx-runtime");
export const { renderToStaticMarkup } = req("react-dom/server");

export function ladeTsx(rel, attrappen, intern = []) {
  const name = `Z_TSX_${rel.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase()}`;
  const datei = process.env[name] ?? path.join(SITE, "src", rel);
  const { outputText } = ts.transpileModule(readFileSync(datei, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: path.basename(rel),
  });
  const modul = { exports: {} };
  const anfordern = (spez) => {
    if (!(spez in attrappen)) throw new Error(`unerwarteter Laufzeit-Import in ${rel}: ${spez}`);
    return attrappen[spez];
  };
  new Function("require", "module", "exports", `${outputText}\nmodule.exports.__intern = { ${intern.join(", ")} };`)(
    anfordern,
    modul,
    modul.exports,
  );
  return modul.exports;
}

/** Statische Hook-Laufzeit: useState nimmt der Reihe nach die Vorgabewerte (undefined = Startwert). */
export function baumLaufzeit() {
  let vorgaben = [];
  let index = 0;
  const Fragment = Symbol("Fragment");
  const jsx = (type, props, key) => ({ $el: true, type, props: props ?? {}, key });
  const react = {
    Fragment,
    Suspense: ({ children }) => children,
    useState(start) {
      const i = index++;
      const wert = i < vorgaben.length && vorgaben[i] !== undefined ? vorgaben[i] : typeof start === "function" ? start() : start;
      return [wert, () => {}];
    },
    useEffect() {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (start) => ({ current: start }),
  };
  function aufloesen(k) {
    if (k === null || k === undefined || typeof k === "boolean") return null;
    if (Array.isArray(k)) return k.map(aufloesen);
    if (typeof k !== "object" || !k.$el) return k;
    if (k.type === Fragment) return aufloesen(k.props.children);
    if (typeof k.type === "function") return aufloesen(k.type(k.props));
    return { type: k.type, props: k.props, kinder: aufloesen(k.props.children) };
  }
  return {
    attrappen: { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment } },
    rendere(Komponente, props = {}, zustaende = []) {
      vorgaben = zustaende;
      index = 0;
      return aufloesen(jsx(Komponente, props));
    },
  };
}

export function text(k) {
  if (k === null || k === undefined) return "";
  if (Array.isArray(k)) return k.map(text).join("");
  if (typeof k === "object") return text(k.kinder);
  return String(k);
}

export function finde(k, pred, aus = []) {
  if (Array.isArray(k)) {
    for (const c of k) finde(c, pred, aus);
    return aus;
  }
  if (k && typeof k === "object") {
    if (pred(k)) aus.push(k);
    finde(k.kinder, pred, aus);
  }
  return aus;
}
