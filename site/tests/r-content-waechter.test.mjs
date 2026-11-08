// Wächter R5 (Objekt-Studio Schritt 3, 08.11.2026): Kein Client-Modul liest die Tabelle content oder
// abonniert Realtime auf content — /content liest seitdem nur über den Server (GET /api/content/liste,
// GET /api/content/eintrag/<id>). Lauf: npm test.
//
// Client-Module sind alle Dateien unter src mit der Direktive "use client" und alles, was sie zur
// Laufzeit importieren (import … from, export … from, import(), require; nicht import type) — so
// gelangt Code ins Browser-Bundle. Geprüft wird mit dem TypeScript-Parser aus node_modules:
// - .from(<Tabelle>) auf allem außer Array, Buffer und typisierten Arrays: Tabelle "content" ist ein
//   Befund; eine Tabelle, die sich nicht statisch bestimmen lässt (Parameter, Ausdruck, mehrdeutige
//   Konstante), ebenso.
// - .on("postgres_changes", <Filter>): table "content" oder "*", ein Filter ohne table (= alle
//   Tabellen) oder ein nicht statisch bestimmbarer Filter bzw. Ereignisname an einem Kanal ist ein
//   Befund.
// - Zeichenketten mit "/rest/v1/content" (REST-Aufruf am Supabase-Client vorbei).
// - Ein lokaler Import, der sich nicht auflösen lässt, oder ein import() ohne festen Pfad: Dann ist der
//   Graph unvollständig.
// Gegenproben: Jede Befundart wird in eine Kopie des Quellbaums (im Speicher) eingebaut, und der
// Wächter muss genau sie melden. Jede Gegenprobe setzt voraus, dass der echte Baum befundfrei ist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(SITE, "src");
const ts = createRequire(path.join(SITE, "package.json"))("typescript");

const CODE = /\.(?:[cm]?[jt]sx?)$/;
/** Empfänger von .from(), die keine Tabelle meinen. */
const EINGEBAUT = new Set([
  "Array",
  "Buffer",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Iterator",
  "ReadableStream",
]);
const REST_CONTENT = /\/rest\/v1\/content(?![A-Za-z0-9_])/;

/** Alle Dateien unter src: Pfad relativ zu src (mit "/") → Inhalt. */
function leseBaum(wurzel) {
  const aus = new Map();
  (function lauf(d) {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) lauf(p);
      else aus.set(path.relative(wurzel, p).split(path.sep).join("/"), CODE.test(n) ? readFileSync(p, "utf8") : "");
    }
  })(wurzel);
  return aus;
}

function entpacke(k) {
  while (
    ts.isParenthesizedExpression(k) ||
    ts.isAsExpression(k) ||
    ts.isTypeAssertionExpression(k) ||
    ts.isNonNullExpression(k) ||
    (ts.isSatisfiesExpression && ts.isSatisfiesExpression(k))
  ) {
    k = k.expression;
  }
  return k;
}

function istClient(sf) {
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break;
    if (s.expression.text === "use client") return true;
  }
  return false;
}

/** Laufzeit-Importe einer Datei mit Zeile; spez null = import() ohne festen Pfad. */
function laufzeitImporte(sf) {
  const aus = [];
  const zeile = (k) => sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1;
  (function besuche(k) {
    if (ts.isImportDeclaration(k) && ts.isStringLiteral(k.moduleSpecifier)) {
      const klausel = k.importClause;
      const benannt = klausel?.namedBindings;
      const nurTyp =
        klausel?.isTypeOnly ||
        (klausel && !klausel.name && benannt && ts.isNamedImports(benannt) && benannt.elements.length > 0 && benannt.elements.every((e) => e.isTypeOnly));
      if (!nurTyp) aus.push({ spez: k.moduleSpecifier.text, zeile: zeile(k) });
    } else if (ts.isExportDeclaration(k) && k.moduleSpecifier && ts.isStringLiteral(k.moduleSpecifier)) {
      const nurTyp = k.isTypeOnly || (k.exportClause && ts.isNamedExports(k.exportClause) && k.exportClause.elements.length > 0 && k.exportClause.elements.every((e) => e.isTypeOnly));
      if (!nurTyp) aus.push({ spez: k.moduleSpecifier.text, zeile: zeile(k) });
    } else if (ts.isImportEqualsDeclaration(k) && ts.isExternalModuleReference(k.moduleReference) && !k.isTypeOnly) {
      const e = k.moduleReference.expression;
      aus.push({ spez: ts.isStringLiteralLike(e) ? e.text : null, zeile: zeile(k) });
    } else if (ts.isCallExpression(k)) {
      const dynamisch = k.expression.kind === ts.SyntaxKind.ImportKeyword;
      const anfordern = ts.isIdentifier(k.expression) && k.expression.text === "require";
      if (dynamisch || anfordern) {
        const arg = k.arguments[0] ? entpacke(k.arguments[0]) : null;
        aus.push({ spez: arg && ts.isStringLiteralLike(arg) ? arg.text : null, zeile: zeile(k) });
      }
    }
    ts.forEachChild(k, besuche);
  })(sf);
  return aus;
}

/** "@/…" und relative Pfade → Datei im Baum; Pakete → { paket }; sonst { fehlt }. */
function aufloesen(von, spez, baum) {
  let basis;
  if (spez.startsWith("@/")) basis = spez.slice(2);
  else if (spez.startsWith("./") || spez.startsWith("../")) basis = path.posix.normalize(path.posix.join(path.posix.dirname(von), spez));
  else return { paket: spez };
  for (const k of [basis, `${basis}.ts`, `${basis}.tsx`, `${basis}.js`, `${basis}.jsx`, `${basis}.mjs`, `${basis}/index.ts`, `${basis}/index.tsx`, `${basis}/index.js`]) {
    if (baum.has(k)) return { datei: k };
  }
  return { fehlt: basis };
}

/** Name der aufgerufenen Methode: x.name(…), x["name"](…) oder name(…). */
function aufrufName(callee) {
  const c = entpacke(callee);
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  if (ts.isElementAccessExpression(c)) {
    const a = entpacke(c.argumentExpression);
    return ts.isStringLiteralLike(a) ? a.text : null;
  }
  if (ts.isIdentifier(c)) return c.text;
  return null;
}

function empfaenger(callee) {
  const c = entpacke(callee);
  return ts.isPropertyAccessExpression(c) || ts.isElementAccessExpression(c) ? entpacke(c.expression) : null;
}

function pruefeDatei(sf, rel, befunde, tabellen) {
  const zeile = (k) => sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1;
  const kurz = (k) => k.getText(sf).replace(/\s+/g, " ").slice(0, 100);
  // Bindungen per const und let: Name → Initialisierer (mehrere = mehrdeutig).
  const bindungen = new Map();
  (function sammle(k) {
    if (ts.isVariableDeclaration(k) && ts.isIdentifier(k.name) && k.initializer) {
      const liste = bindungen.get(k.name.text) ?? [];
      liste.push(k.initializer);
      bindungen.set(k.name.text, liste);
    }
    ts.forEachChild(k, sammle);
  })(sf);
  const gebunden = (k) => {
    const liste = bindungen.get(k.text) ?? [];
    return liste.length === 1 ? entpacke(liste[0]) : null;
  };
  const zeichenkette = (k, tiefe = 0) => {
    k = entpacke(k);
    if (ts.isStringLiteralLike(k)) return k.text;
    if (ts.isIdentifier(k) && tiefe < 5) {
      const init = gebunden(k);
      return init ? zeichenkette(init, tiefe + 1) : undefined;
    }
    return undefined;
  };
  const objekt = (k) => {
    k = entpacke(k);
    if (ts.isObjectLiteralExpression(k)) return k;
    if (ts.isIdentifier(k)) {
      const init = gebunden(k);
      return init && ts.isObjectLiteralExpression(init) ? init : null;
    }
    return null;
  };
  const imKanal = (callee, tiefe = 0) => {
    let e = empfaenger(callee);
    while (e && tiefe < 20) {
      tiefe += 1;
      if (ts.isCallExpression(e)) {
        if (aufrufName(e.expression) === "channel") return true;
        e = empfaenger(e.expression);
      } else if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
        e = entpacke(e.expression);
      } else if (ts.isIdentifier(e)) {
        const init = gebunden(e);
        e = init;
      } else {
        return false;
      }
    }
    return false;
  };
  const tabelleImFilter = (filter) => {
    let lage = { fehlt: true };
    for (const p of filter.properties) {
      if (ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name))) {
        lage = { unbestimmt: true };
        continue;
      }
      const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : null;
      if (name !== "table") continue;
      const w = ts.isPropertyAssignment(p) ? zeichenkette(p.initializer) : ts.isShorthandPropertyAssignment(p) ? zeichenkette(p.name) : undefined;
      lage = typeof w === "string" ? { wert: w } : { unbestimmt: true };
    }
    return lage;
  };
  const melde = (k, art) => befunde.push({ datei: rel, zeile: zeile(k), art, text: kurz(k) });

  (function besuche(k) {
    if (ts.isCallExpression(k) && k.expression.kind !== ts.SyntaxKind.ImportKeyword) {
      const name = aufrufName(k.expression);
      if (name === "from" && k.arguments.length > 0) {
        const e = empfaenger(k.expression);
        const eingebaut = e && ((ts.isIdentifier(e) && EINGEBAUT.has(e.text)) || (ts.isPropertyAccessExpression(e) && EINGEBAUT.has(e.name.text)));
        const ohneEmpfaenger = e === null;
        if (!eingebaut) {
          const tabelle = zeichenkette(k.arguments[0]);
          if (typeof tabelle === "string") {
            tabellen.push({ datei: rel, zeile: zeile(k), art: "from", tabelle });
            if (tabelle === "content") melde(k, "from_content");
          } else if (!ohneEmpfaenger) {
            melde(k, "tabelle_unbestimmt");
          }
        }
      }
      if (name === "on" && k.arguments.length >= 2) {
        const ereignis = zeichenkette(k.arguments[0]);
        if (ereignis === "postgres_changes") {
          const filter = objekt(k.arguments[1]);
          const lage = filter ? tabelleImFilter(filter) : { unbestimmt: true };
          if (lage.fehlt) melde(k, "realtime_alle_tabellen");
          else if (lage.unbestimmt) melde(k, "realtime_unbestimmt");
          else {
            tabellen.push({ datei: rel, zeile: zeile(k), art: "realtime", tabelle: lage.wert });
            if (lage.wert === "content" || lage.wert === "*") melde(k, "realtime_content");
          }
        } else if (typeof ereignis !== "string" && imKanal(k.expression)) {
          melde(k, "realtime_unbestimmt");
        }
      }
    }
    if ((ts.isStringLiteralLike(k) || ts.isTemplateHead(k) || ts.isTemplateMiddle(k) || ts.isTemplateTail(k)) && REST_CONTENT.test(k.text)) {
      melde(k, "rest_content");
    }
    ts.forEachChild(k, besuche);
  })(sf);
}

/** Client-Graph und Befunde für einen Quellbaum (Pfad relativ zu src → Inhalt). */
function analysiere(baum, { nurWurzeln } = {}) {
  const quellen = new Map();
  const parse = (rel) => {
    if (!quellen.has(rel)) {
      const art = /x$/.test(rel) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      quellen.set(rel, ts.createSourceFile(rel, baum.get(rel), ts.ScriptTarget.Latest, true, art));
    }
    return quellen.get(rel);
  };
  const wurzeln = nurWurzeln ?? [...baum.keys()].filter((rel) => CODE.test(rel) && istClient(parse(rel))).sort();
  const erreicht = new Map();
  const pakete = new Set();
  const befunde = [];
  const tabellen = [];
  const offen = wurzeln.map((w) => [w, [w]]);
  while (offen.length > 0) {
    const [rel, kette] = offen.shift();
    if (erreicht.has(rel)) continue;
    erreicht.set(rel, kette);
    const sf = parse(rel);
    for (const { spez, zeile } of laufzeitImporte(sf)) {
      if (spez === null) {
        befunde.push({ datei: rel, zeile, art: "import_unbestimmt", text: "import() ohne festen Pfad" });
        continue;
      }
      const ziel = aufloesen(rel, spez, baum);
      if (ziel.datei) {
        if (CODE.test(ziel.datei)) offen.push([ziel.datei, [...kette, ziel.datei]]);
      } else if (ziel.paket) {
        pakete.add(ziel.paket);
      } else {
        befunde.push({ datei: rel, zeile, art: "import_unaufloesbar", text: spez });
      }
    }
    pruefeDatei(sf, rel, befunde, tabellen);
  }
  return { wurzeln, erreicht, pakete, befunde, tabellen };
}

const QUELLBAUM = leseBaum(SRC);
const BASIS = analysiere(QUELLBAUM);
const zeigen = (befunde) => befunde.map((b) => `${b.datei}:${b.zeile} ${b.art} ${b.text}`).join("\n");

// ═══ Der echte Quellbaum ═══

test("R5-W1 Kein Client-Modul liest content oder abonniert Realtime auf content (Import-Graph ab allen \"use client\"-Dateien)", () => {
  assert.deepEqual(BASIS.befunde, [], zeigen(BASIS.befunde));
  // Umfang: alle Wurzeln, und der Graph reicht über sie hinaus (gemeinsame Hooks, Bausteine, Supabase-Client).
  for (const w of ["app/content/page.tsx", "app/studio/[objekt]/page.tsx", "lib/hooks.ts", "lib/hooks-metrics.ts", "lib/hooks-status.ts"]) {
    assert.ok(BASIS.wurzeln.includes(w), `Wurzel ${w}`);
  }
  assert.ok(BASIS.wurzeln.length >= 20, `Wurzeln: ${BASIS.wurzeln.length}`);
  for (const d of ["lib/supabase.ts", "lib/content-liste.ts", "components/studio/BelegKette.tsx", "lib/freigabe-regeln.ts"]) {
    assert.ok(BASIS.erreicht.has(d), `erreicht: ${d}`);
  }
  // Positivkontrolle: Der Wächter sieht die Browser-Zugriffe, die bleiben (agents, messages, metrics).
  const gelesen = [...new Set(BASIS.tabellen.filter((t) => t.art === "from").map((t) => t.tabelle))].sort();
  const realtime = [...new Set(BASIS.tabellen.filter((t) => t.art === "realtime").map((t) => t.tabelle))].sort();
  assert.deepEqual(gelesen, ["agents", "messages", "metrics"]);
  assert.deepEqual(realtime, ["agents", "messages"]);
});

test("R5-W2 /content erreicht den Supabase-Client des Browsers gar nicht mehr; Liste und Zeile kommen über die Server-Pfade", () => {
  const nurSeite = analysiere(QUELLBAUM, { nurWurzeln: ["app/content/page.tsx"] });
  assert.deepEqual(nurSeite.befunde, [], zeigen(nurSeite.befunde));
  assert.ok(!nurSeite.erreicht.has("lib/supabase.ts"), `Kette: ${nurSeite.erreicht.get("lib/supabase.ts")?.join(" → ")}`);
  assert.ok(!nurSeite.pakete.has("@supabase/supabase-js") && !nurSeite.pakete.has("@supabase/ssr"), [...nurSeite.pakete].join(", "));
  assert.ok(nurSeite.erreicht.has("lib/content-liste.ts"));
  const quelle = QUELLBAUM.get("lib/content-liste.ts");
  assert.match(quelle, /CONTENT_LISTE_PFAD = "\/api\/content\/liste"/);
  assert.match(quelle, /`\/api\/content\/eintrag\/\$\{id\}`/);
  // lib/content-liste.ts läuft im Browser und hat keine Laufzeit-Importe (kein Server-Modul im Bundle).
  const sf = ts.createSourceFile("content-liste.ts", quelle, ts.ScriptTarget.Latest, true);
  assert.deepEqual(laufzeitImporte(sf), []);
});

// ═══ Gegenproben ═══

/** Kopie des Baums mit Änderungen: { datei: { anhaengen | voran | neu } }. */
function mitAenderung(aenderungen) {
  const kopie = new Map(QUELLBAUM);
  for (const [datei, a] of Object.entries(aenderungen)) {
    if (a.neu !== undefined) {
      kopie.set(datei, a.neu);
      continue;
    }
    assert.ok(kopie.has(datei), `Zieldatei fehlt: ${datei}`);
    kopie.set(datei, `${a.voran ?? ""}${kopie.get(datei)}${a.anhaengen ?? ""}`);
  }
  return kopie;
}

const LESER = 'export async function liesAlles() {\n  return supabase.from("content").select("*");\n}\n';

const GEGENPROBEN = [
  { name: "gemeinsamer Hook liest content", aenderungen: { "lib/hooks.ts": { anhaengen: `\n${LESER}` } }, erwartet: [["lib/hooks.ts", "from_content"]] },
  { name: "Tabelle als Template-Literal", aenderungen: { "lib/hooks.ts": { anhaengen: "\nexport const q = () => supabase.from(`content`).select(\"id\");\n" } }, erwartet: [["lib/hooks.ts", "from_content"]] },
  {
    name: "Tabelle als Konstante",
    aenderungen: { "lib/hooks-metrics.ts": { anhaengen: '\nconst TABELLE = "content" as const;\nexport const q = () => supabase.from(TABELLE).select("*");\n' } },
    erwartet: [["lib/hooks-metrics.ts", "from_content"]],
  },
  {
    name: "Tabelle nicht statisch bestimmbar",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const q = (t: string) => supabase.from(t).select("*");\n' } },
    erwartet: [["lib/hooks.ts", "tabelle_unbestimmt"]],
  },
  { name: "Methode über Index", aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const q = () => supabase["from"]("content").select("*");\n' } }, erwartet: [["lib/hooks.ts", "from_content"]] },
  {
    name: "Realtime auf content",
    aenderungen: {
      "app/content/page.tsx": {
        anhaengen: '\nfunction k() {\n  return supabase.channel("x").on("postgres_changes", { event: "*", schema: "public", table: "content" }, () => {}).subscribe();\n}\nvoid k;\n',
      },
    },
    erwartet: [["app/content/page.tsx", "realtime_content"]],
  },
  {
    name: "Realtime ohne Tabellenfilter (alle Tabellen)",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const k = () => supabase.channel("y").on("postgres_changes", { event: "INSERT", schema: "public" }, () => {});\n' } },
    erwartet: [["lib/hooks.ts", "realtime_alle_tabellen"]],
  },
  {
    name: "Realtime-Filter als Konstante",
    aenderungen: {
      "lib/hooks.ts": { anhaengen: '\nconst FILTER = { event: "*", schema: "public", table: "content" };\nexport const k = () => supabase.channel("z").on("postgres_changes", FILTER, () => {});\n' },
    },
    erwartet: [["lib/hooks.ts", "realtime_content"]],
  },
  {
    name: "Realtime-Filter mit Spread",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const k = (f: object) => supabase.channel("s").on("postgres_changes", { ...f }, () => {});\n' } },
    erwartet: [["lib/hooks.ts", "realtime_unbestimmt"]],
  },
  {
    name: "Realtime-Ereignis als Variable am Kanal",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const k = (e: string) => supabase.channel("v").on(e, { table: "agents" }, () => {});\n' } },
    erwartet: [["lib/hooks.ts", "realtime_unbestimmt"]],
  },
  {
    name: "Realtime auf alle Tabellen per \"*\"",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const k = () => supabase.channel("w").on("postgres_changes", { event: "*", schema: "public", table: "*" }, () => {});\n' } },
    erwartet: [["lib/hooks.ts", "realtime_content"]],
  },
  {
    name: "REST am Client vorbei",
    aenderungen: { "app/content/page.tsx": { anhaengen: "\nexport const r = (u: string) => fetch(`${u}/rest/v1/content?select=*`);\n" } },
    erwartet: [["app/content/page.tsx", "rest_content"]],
  },
  {
    name: "Server-Modul ohne \"use client\", importiert von einem Client-Baustein",
    aenderungen: {
      "lib/neu-lesen.ts": { neu: `import { supabase } from "./supabase";\n${LESER}` },
      "components/ui/KPICard.tsx": { voran: 'import { liesAlles } from "@/lib/neu-lesen";\nvoid liesAlles;\n' },
    },
    erwartet: [["lib/neu-lesen.ts", "from_content"]],
  },
  {
    name: "dynamischer Import",
    aenderungen: {
      "lib/neu-lesen.ts": { neu: `import { supabase } from "./supabase";\n${LESER}` },
      "lib/types.ts": { anhaengen: '\nexport const spaeter = () => import("./neu-lesen");\n' },
    },
    erwartet: [["lib/neu-lesen.ts", "from_content"]],
  },
  {
    name: "Re-Export",
    aenderungen: {
      "lib/neu-lesen.ts": { neu: `import { supabase } from "./supabase";\n${LESER}` },
      "lib/freigabe-regeln.ts": { anhaengen: '\nexport { liesAlles } from "./neu-lesen";\n' },
    },
    erwartet: [["lib/neu-lesen.ts", "from_content"]],
  },
  {
    name: "neue \"use client\"-Datei ohne Importeur",
    aenderungen: { "components/neu/Leser.tsx": { neu: `"use client";\nimport { supabase } from "@/lib/supabase";\n${LESER}` } },
    erwartet: [["components/neu/Leser.tsx", "from_content"]],
  },
  {
    name: "lokaler Import, der sich nicht auflösen lässt",
    aenderungen: { "lib/hooks.ts": { voran: 'import "./gibt-es-nicht";\n' } },
    erwartet: [["lib/hooks.ts", "import_unaufloesbar"]],
  },
  {
    name: "import() ohne festen Pfad",
    aenderungen: { "lib/hooks.ts": { anhaengen: "\nexport const lade = (p: string) => import(p);\n" } },
    erwartet: [["lib/hooks.ts", "import_unbestimmt"]],
  },
];

for (const [i, probe] of GEGENPROBEN.entries()) {
  test(`R5-W3.${i + 1} Gegenprobe: ${probe.name} → Befund`, () => {
    assert.deepEqual(BASIS.befunde, [], `Basis nicht befundfrei:\n${zeigen(BASIS.befunde)}`);
    const e = analysiere(mitAenderung(probe.aenderungen));
    assert.deepEqual(
      e.befunde.map((b) => [b.datei, b.art]),
      probe.erwartet,
      zeigen(e.befunde),
    );
  });
}

test("R5-W4 Gegenkontrolle: Nur-Typ-Importe, Array.from und andere Tabellen sind keine Befunde", () => {
  assert.deepEqual(BASIS.befunde, [], `Basis nicht befundfrei:\n${zeigen(BASIS.befunde)}`);
  const e = analysiere(
    mitAenderung({
      "lib/neu-lesen.ts": { neu: `import { supabase } from "./supabase";\nexport type Zeile = { id: number };\n${LESER}` },
      "components/ui/KPICard.tsx": { voran: 'import type { Zeile } from "@/lib/neu-lesen";\nexport type Z = Zeile;\n' },
      "lib/hooks.ts": { anhaengen: '\nexport const a = () => Array.from("content");\nexport const b = () => supabase.from("messages").select("id");\n' },
    }),
  );
  assert.deepEqual(e.befunde, [], zeigen(e.befunde));
  assert.ok(!e.erreicht.has("lib/neu-lesen.ts"), "Nur-Typ-Import ist keine Laufzeit-Kante");
});
