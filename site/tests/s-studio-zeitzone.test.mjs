// Objekt-Studio Schritt 2, Nachbesserung 08.11.2026 (Prüfbefund K1). Lauf: npm test.
// Die Zeitangaben des Studios stehen in Europe/Berlin mit Zonenangabe, gleich in welcher Zeitzone
// Browser oder Testprozess laufen — wie die Zählung des Servers (lib/studio/lesen.ts: Preiswechsel um
// Mitternacht Europe/Berlin). Vorher zeigte das Studio Zeiten in der Zone des Browsers ohne
// Zonenangabe; unter TZ=UTC stand ein Lauf vom 06.11. 00:30 (Berlin) als "5.11.2026, 23:30:00" da,
// während der Kosten-Hinweis ihn schon zur neuen Preistabelle zählte.
// Eigene Datei, weil node --test je Datei einen eigenen Prozess startet: Alle Module laden hier unter
// TZ=UTC (Muster wie tests/u-tor-zeitzone.test.mjs). Route und Ansicht laufen wie in
// tests/s-studio.test.mjs gegen die Attrappen aus tests/harness/fake.mjs — kein Netz.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.TZ = "UTC";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wie tests/s-studio.test.mjs: "@/…" → src/….ts, "next/server" → node_modules, "server-only" → leere Fassung.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/server.js")).href, context);
    if (specifier === "server-only") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/dist/compiled/server-only/empty.js")).href, context);
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

// Test-Werte dieses Prozesses, keine echten Schlüssel.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key-0000000000",
  SUPABASE_SERVICE_KEY: "service-test-key-1234567890abcdef",
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
});

const fake = await import("./harness/fake.mjs");
const { welt, legeAn, zuruecksetzen } = fake;
fake.installiere();
const { React, jsxRuntime, renderToStaticMarkup, ladeTsx } = await import("./harness/tsx.mjs");
const { ladeStudioBausteine } = await import("./harness/studio.mjs");
const { NextRequest } = await import("next/server");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const counsel = await import("../src/lib/counsel-urteil.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const types = await import("../src/lib/types.ts");
const objekte = await import("../src/lib/studio/objekte.ts");
const studioRegeln = await import("../src/lib/studio/regeln.ts");
const { GET } = await import(pathToFileURL(path.join(SITE, "src/app/api/studio/[objekt]/route.ts")).href);

const SLUG = "rittergut-seifersdorf";
const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const RITTERGUT = { slug: SLUG, name: "RitterGut Seifersdorf", ort: "Testort", baujahr: 1335, preis: "ab 1 € (Testwert)", statusBadge: "Vermarktung", afaProzent: 100, istDenkmal: true };
const exportAntwort = () => ({ status: 200, body: { version: "1", quelle: "Testquelle", generiert_am: "2026-11-08T07:30:00Z", objekte: [RITTERGUT] } });
const STEPS = [
  { agent: "researcher", cost: 0.01, duration_ms: 1, output: "r" },
  { agent: "scribe", cost: 0.01, duration_ms: 1, output: "s" },
  { agent: "counsel", cost: 0.01, duration_ms: 1, output: "c" },
  { agent: "publisher" },
  { agent: "amplifier" },
];

function lauf(id, am) {
  return legeAn({ id, title: `Lauf ${id}`, content_type: "thread", platform: "x", status: "abgelehnt", body: null, review_notes: "URTEIL: ABLEHNUNG", created_at: am, updated_at: am, metadata: { objekt_slug: SLUG, steps: STEPS } });
}

async function hole() {
  const req = new NextRequest(`http://harness.local/api/studio/${SLUG}`, { headers: { cookie: "gp-auth=test" } });
  const res = await GET(req, { params: Promise.resolve({ objekt: SLUG }) });
  return res.json();
}

function studioHtml(antwort) {
  const studio = ladeStudioBausteine({ ...ECHT, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln });
  const V = ladeTsx("components/studio/StudioAnsicht.tsx", {
    ...ECHT,
    ...studio.module,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks-status": hooksStatus,
    "@/lib/types": types,
    "@/lib/studio/objekte": objekte,
    "@/lib/studio/regeln": studioRegeln,
  });
  return renderToStaticMarkup(React.createElement(V.StudioAnsicht, { slug: SLUG, lesung: { art: "daten", antwort }, kopiere: () => {}, kopierStatus: () => "Kopieren" }));
}

const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
const sichtbar = (html) => ent(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

/** Erwartete Zeit in Europe/Berlin, unabhängig von lib/types.ts gerechnet. */
const BERLIN = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function berlin(iso) {
  const t = Object.fromEntries(BERLIN.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${t.day}.${t.month}.${t.year} ${t.hour}:${t.minute}:${t.second} (Europe/Berlin)`;
}

beforeEach(() => zuruecksetzen());

test("S-Z1 (K1) Studio unter TZ=UTC: Kopf, Karten und title-Angaben in Europe/Berlin mit Zonenangabe, passend zur Zählung des Servers", async () => {
  assert.equal(new Date("2026-11-08T07:30:00Z").getHours(), 7, "Voraussetzung: der Prozess rechnet in UTC");
  welt.objekteAntwort = exportAntwort();
  // 05.11. 23:30 UTC = 06.11. 00:30 Berlin (nach dem Preiswechsel); 29.07. 22:18:36 UTC = 30.07. 00:18:36 Berlin.
  lauf(1, "2026-11-05T23:30:00Z");
  lauf(2, "2026-07-29T22:18:36.740272Z");
  const body = await hole();
  assert.equal(body.kosten_usd.wert.laeufe_alte_preistabelle, 1, "der Server zählt nach Europe/Berlin");
  const html = studioHtml(body);
  const t = sichtbar(html);
  assert.ok(t.includes(`Quelle: Steinadel-Export · erzeugt 08.11.2026 08:30:00 (Europe/Berlin) · abgerufen ${berlin(body.objekt.gemessen_am)}`), t.slice(0, 1500));
  assert.ok(t.includes("Erstellt 06.11.2026 00:30:00 (Europe/Berlin)"), t);
  assert.ok(t.includes("Erstellt 30.07.2026 00:18:36 (Europe/Berlin)"), t);
  for (const utc of ["erzeugt 8.11.2026, 07:30:00", "erzeugt 08.11.2026 07:30:00", "Erstellt 5.11.2026", "Erstellt 05.11.2026", "Erstellt 29.7.2026", "Erstellt 29.07.2026"]) {
    assert.ok(!t.includes(utc), utc);
  }
  // title-Angaben ebenso: "gemessen: … (Europe/Berlin)", kein Format der Browser-Zone ("8.11.2026, 21:40:00").
  assert.ok(html.includes(`gemessen: ${berlin(body.assets.gemessen_am)}`));
  assert.doesNotMatch(html, /gemessen: \d{1,2}\.\d{1,2}\.\d{4}, /);
  // Die Beleg-Kette ist mit /content geteilt und bleibt unverändert; das steht sichtbar an der Liste.
  assert.ok(t.includes("Zeiten des Studios in Europe/Berlin; die Beleg-Kette zeigt ihre Zeiten wie /content in der Zeitzone dieses Browsers."));
});

test("S-Z2 (K1) Studio unter TZ=UTC: Leseversuch im Kopf und Leermeldung der Liste in Europe/Berlin", async () => {
  welt.objekteAntwort = { status: 502, body: { fehler: "quelle_nicht_erreichbar", fehler_art: "nicht_erreichbar", objekte: [] } };
  const body = await hole();
  assert.equal(body.objekt.status, "fehler");
  assert.deepEqual(body.assets.wert, []);
  const t = sichtbar(studioHtml(body));
  assert.ok(t.includes(`Leseversuch ${berlin(body.objekt.gemessen_am)}`), t.slice(0, 1500));
  assert.ok(t.includes(`(gelesen ${berlin(body.assets.gemessen_am)})`), t);
});
