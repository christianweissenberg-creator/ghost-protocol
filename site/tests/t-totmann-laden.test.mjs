// Totmann, Prüfbefund SR-7 (Nachbesserung 07.11.2026). Lauf: npm test.
// lib/lauf-nachweis.ts lud lib/supabase.ts statisch; die Datei legt beim Laden den Anon-Client an
// und wirft ohne NEXT_PUBLIC_SUPABASE_URL ("supabaseUrl is required."). Damit lud keine der beiden
// Cron-Routen mehr — auch 400 und 401 endeten in einer Ausnahme, obwohl die Routen vorher nicht von
// der Variable abhingen. Eigene Datei, weil node --test je Datei einen eigenen Prozess startet:
// lib/supabase.ts lädt hier zum ersten Mal, und zwar ohne die Variable. Kein Netz — fetch kommt aus
// tests/harness/fake.mjs, jeder fremde Abruf wirft. Die Umgebungswerte sind Test-Werte dieses
// Prozesses, keine echten Schlüssel. Z_ROUTE_<NAME>=<pfad> prüft statt der Repo-Route eine Kopie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wie tests/t-totmann.test.mjs: "@/…" → site/src/….ts, "next/server" → node_modules, relative
// Importe ohne Endung aus .ts-Dateien → ".ts" (auch der dynamische Import in lib/lauf-nachweis.ts).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/server.js")).href, context);
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.CONTENT_LAUNCH_DATE;
Object.assign(process.env, {
  SUPABASE_SERVICE_KEY: "service-test-key-1234567890abcdef",
  ANTHROPIC_API_KEY: "sk-ant-harness-TESTWERT-0123456789abcdef",
  NEXT_PUBLIC_SITE_URL: "http://harness.local",
  CRON_SECRET: "cron-test-secret-0123456789",
  GP_SESSION_SECRET: "session-test-secret-0123456789",
});

const fake = await import("./harness/fake.mjs");
fake.installiere();
const route = (name, rel) => import(pathToFileURL(process.env[`Z_ROUTE_${name}`] ?? path.join(SITE, "src/app/api", rel)).href);

test("T-L0 Cron-Routen laden ohne NEXT_PUBLIC_SUPABASE_URL (Prüfbefund SR-7): 400/401 wie vorher, ein Lauf antwortet mit Vermerk", async () => {
  const [briefing, auto, { NextRequest }] = await Promise.all([
    route("BRIEFING", "cron/briefing/route.ts"),
    route("AUTO", "content/auto-produce/route.ts"),
    import("next/server"),
  ]);
  const anfrage = (pfad, kopf = { "x-cron-secret": process.env.CRON_SECRET }) => new NextRequest(`http://harness.local${pfad}`, { headers: kopf });
  assert.equal((await briefing.GET(anfrage("/api/cron/briefing?type=morning", {}))).status, 401);
  assert.equal((await briefing.GET(anfrage("/api/cron/briefing?type=morning&secret=x"))).status, 400);
  assert.equal((await auto.GET(anfrage("/api/content/auto-produce", {}))).status, 401);
  assert.equal((await auto.GET(anfrage("/api/content/auto-produce?secret=x"))).status, 400);

  const fehlerLog = [];
  const alt = console.error;
  console.error = (...a) => fehlerLog.push(a.join(" "));
  let res;
  try {
    res = await briefing.GET(anfrage("/api/cron/briefing?type=morning"));
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 200, "der Lauf selbst antwortet wie immer");
  const body = await res.json();
  assert.equal(body.type, "morning");
  assert.equal(fake.welt.aktivierungen.length, 2);
  assert.match(body.nachweis_fehler, /^Lauf-Nachweis nicht geschrieben: /);
  assert.ok(fehlerLog.some((z) => z.startsWith("[totmann] briefing-morgen:")), fehlerLog.join("\n"));
  assert.equal(fake.welt.log.length, 0, "ohne Supabase-URL kein Abruf");
});
