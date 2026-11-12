// React #418 auf / ohne Sitzung (11.11.2026). Lauf: npm test.
// Ohne gültiges Cookie schreibt die Middleware jede Seite per Rewrite auf /login um, die URL bleibt.
// Ausgeliefert wird die vorgerenderte Login-Seite (HTML für den Pfad /login), im Browser liefert
// usePathname() aber die URL. Gemessen am Produktions-Build (next start, ohne Sitzung, je Laden):
// - Basis: #418 auf / und /agents (args HTML), nicht auf /login.
// - Gegenprobe ohne Aktivmarke der Sidebar: / ohne Fehler, /agents #418 (args text: Brotkrume).
// Seitdem wählen Sidebar und TopBar nach useAktivPfad() (components/layout/aktiv-pfad.ts).
// Hier: Server-HTML der Login-Seite und erster Client-Render unter jeder URL sind gleich (Hydrieren
// ohne Abweichung); angemeldet bleibt der Eintrag der URL aktiv, die Brotkrume folgt der URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { React, jsxRuntime, ladeTsx, renderToStaticMarkup } from "./harness/tsx.mjs";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const types = await import("../src/lib/types.ts");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const studioObjekte = await import("../src/lib/studio/objekte.ts");

const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const LESUNG = { status: null, fehler: null, loading: true, geladenAm: null, httpStatus: null, neuLaden: async () => {} };
const AKTIVMARKE = /class="absolute left-0 top-1\.5 bottom-1\.5 w-\[2px\] rounded-full"/;

// Was usePathname() und useSelectedLayoutSegment() (Wurzel-Layout) liefern.
// Server: die vorgerenderte Login-Seite. Browser unter Rewrite: die URL, aber der Routenbaum der
// Login-Seite (er kommt mit dem Server-HTML). Angemeldet: URL und Routenbaum derselben Seite.
const SERVER_LOGIN = { pfad: "/login", segment: "login" };
const unterRewrite = (url) => ({ pfad: url, segment: "login" });
const angemeldet = (url) => ({ pfad: url, segment: url === "/" ? null : url.split("/")[1] });

const navigation = (sicht) => ({ usePathname: () => sicht.pfad, useSelectedLayoutSegment: () => sicht.segment });
const aktivPfadModul = (sicht) => ladeTsx("components/layout/aktiv-pfad.ts", { "next/navigation": navigation(sicht) });

// next/navigation auch direkt: Liest eine Komponente wieder usePathname(), scheitert der Test am
// Inhalt (Abweichung), nicht an einem unerwarteten Import.
function sidebar(sicht) {
  const S = ladeTsx(
    "components/layout/Sidebar.tsx",
    {
      ...ECHT,
      "next/link": { __esModule: true, default: Link },
      "next/navigation": navigation(sicht),
      "@/components/layout/aktiv-pfad": aktivPfadModul(sicht),
      "@/lib/studio/objekte": studioObjekte,
    },
    ["NAV_GROUPS"],
  );
  return { html: renderToStaticMarkup(React.createElement(S.Sidebar, {})), navGruppen: S.__intern.NAV_GROUPS };
}

function topBar(sicht) {
  const T = ladeTsx(
    "components/layout/TopBar.tsx",
    {
      ...ECHT,
      "next/navigation": navigation(sicht),
      "@/components/layout/aktiv-pfad": aktivPfadModul(sicht),
      "@/lib/freigabe-regeln": regeln,
      "@/lib/hooks-status": { ...hooksStatus, useSystemStatus: () => LESUNG },
      "@/lib/types": types,
    },
    ["CRUMB"],
  );
  return { html: renderToStaticMarkup(React.createElement(T.TopBar, {})), crumbs: T.__intern.CRUMB };
}

const NAV_URLS = sidebar(SERVER_LOGIN).navGruppen.flatMap((g) => g.items.map((i) => i.href));
const CRUMB_URLS = Object.keys(topBar(SERVER_LOGIN).crumbs);
// Unter Rewrite zählt jede URL: auch Detailseiten und Pfade ohne Seite landen auf der Anmeldung.
const ALLE_URLS = [...new Set([...NAV_URLS, ...CRUMB_URLS, "/agents/oracle", "/gibt-es-nicht"])];
const brotkrume = (html) => {
  const m = /tracking-\[0\.12em\] truncate"[^>]*>([^<]*)</.exec(html);
  assert.ok(m, "Brotkrume gefunden");
  return m[1];
};

test("H0 Grundlage: alle Navigations- und Brotkrumen-URLs erfasst", () => {
  assert.deepEqual(NAV_URLS, ["/", "/agents", "/donna", "/messages", "/metrics", "/expose", "/studio/rittergut-seifersdorf", "/content", "/academy"]);
  assert.deepEqual(CRUMB_URLS, ["/", "/agents", "/messages", "/metrics", "/content", "/donna", "/expose", "/academy"]);
});

test("H1 Sidebar ohne Sitzung: Server-HTML der Login-Seite = erster Render im Browser unter jeder URL (kein #418)", () => {
  const server = sidebar(SERVER_LOGIN).html;
  assert.doesNotMatch(server, AKTIVMARKE, "Login-Seite: kein Eintrag aktiv");
  for (const url of ALLE_URLS) assert.equal(sidebar(unterRewrite(url)).html, server, url);
});

test("H2 TopBar ohne Sitzung: Server-HTML der Login-Seite = erster Render im Browser unter jeder URL (kein #418)", () => {
  const server = topBar(SERVER_LOGIN).html;
  assert.equal(brotkrume(server), "Command Center");
  for (const url of ALLE_URLS) assert.equal(topBar(unterRewrite(url)).html, server, url);
});

test("H3 Sidebar angemeldet unverändert: genau der Eintrag der URL ist aktiv (Marke und Goldton)", () => {
  for (const url of NAV_URLS) {
    const { html } = sidebar(angemeldet(url));
    const links = [...html.matchAll(/<a href="([^"]+)"([^>]*)>(.*?)<\/a>/g)];
    assert.equal(links.length, NAV_URLS.length, url);
    assert.deepEqual(links.filter(([, , , innen]) => AKTIVMARKE.test(innen)).map(([, href]) => href), [url], url);
    assert.deepEqual(links.filter(([, , attr]) => attr.includes("color:var(--gp-gold-hi)")).map(([, href]) => href), [url], url);
  }
  // Detailseite ohne eigenen Eintrag: wie bisher keiner aktiv.
  assert.doesNotMatch(sidebar(angemeldet("/agents/oracle")).html, AKTIVMARKE);
});

test("H4 TopBar angemeldet unverändert: Brotkrume nach URL, sonst 'Command Center'", () => {
  const { crumbs } = topBar(SERVER_LOGIN);
  for (const url of CRUMB_URLS) assert.equal(brotkrume(topBar(angemeldet(url)).html), crumbs[url], url);
  assert.equal(brotkrume(topBar(angemeldet("/agents")).html), "Agent-Flotte");
  assert.equal(brotkrume(topBar(angemeldet("/studio/rittergut-seifersdorf")).html), "Command Center");
});

test("H5 aktivPfad: /login nur, wenn die Seite die Anmeldung zeigt; sonst die URL", () => {
  const { aktivPfad } = aktivPfadModul(SERVER_LOGIN);
  assert.equal(aktivPfad("/", "login"), "/login");
  assert.equal(aktivPfad("/agents", "login"), "/login");
  assert.equal(aktivPfad("/login", "login"), "/login");
  assert.equal(aktivPfad("/", null), "/");
  assert.equal(aktivPfad("/agents", "agents"), "/agents");
  assert.equal(aktivPfad("/agents/oracle", "agents"), "/agents/oracle");
  assert.equal(aktivPfad("/studio/rittergut-seifersdorf", "studio"), "/studio/rittergut-seifersdorf");
});

test("H6 Annahme: Die Middleware schreibt ohne Sitzung auf /login um (URL bleibt), die Seite liegt unter app/login", () => {
  const mw = readFileSync(path.join(SITE, "src/middleware.ts"), "utf8");
  assert.match(mw, /loginUrl\.pathname = "\/login";\s*return NextResponse\.rewrite\(loginUrl\);/);
  assert.ok(existsSync(path.join(SITE, "src/app/login/page.tsx")));
});
