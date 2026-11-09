// Wächter R5 (Objekt-Studio Schritt 3, 08.11.2026; erweitert nach der Prüfung vom 09.11.2026): Kein
// Client-Modul liest die Tabelle content oder abonniert Realtime auf content — /content liest seitdem nur
// über den Server (GET /api/content/liste, GET /api/content/eintrag/<id>). Lauf: npm test.
//
// Client-Module sind alle Dateien unter src mit der Direktive "use client", die Einstiegsdateien des
// Browsers ohne Direktive (instrumentation-client.*, pages/** außer pages/api/**) und alles, was sie zur
// Laufzeit importieren (import … from, export … from, import(), require; nicht import type) — so gelangt
// Code ins Browser-Bundle. Ein app- oder pages-Ordner oder eine instrumentation-client-Datei neben src
// wäre für den Wächter unsichtbar und ist deshalb selbst ein Befund (R5-W5).
// Geprüft wird mit dem TypeScript-Parser aus node_modules; im Zweifel ist es ein Befund:
// - .from(<Tabelle>) auf allem außer Array, Buffer und typisierten Arrays: Tabelle "content" ist ein
//   Befund; eine Tabelle, die sich nicht statisch bestimmen lässt, ebenso. Der Methodenname darf über
//   einen Index kommen (x["from"], x[KONSTANTE]); ein Index, der sich nicht bestimmen lässt, ist ein
//   Befund (methode_unbestimmt), ebenso .from ohne direkten Aufruf — call, apply, bind, als Wert
//   weitergereicht oder destrukturiert (from_indirekt).
// - .select(<Spalten>): eine eingebettete Ressource content — auch mit Alias, !-Hinweis oder als Spread —
//   ist ein Befund (select_content); jede andere Einbettung auch, denn welche Tabelle sie liest, sieht der
//   Wächter nicht (select_einbettung); eine nicht statisch bestimmbare Spaltenliste ebenso.
// - .on(<Ereignis>, <Filter>): Ereignis "postgres_changes" (auch als Konstante oder
//   REALTIME_LISTEN_TYPES.POSTGRES_CHANGES) mit table "content" oder "*", ohne table (= alle Tabellen)
//   oder mit nicht statisch bestimmbarem Filter ist ein Befund; ein nicht statisch bestimmbares Ereignis
//   an jedem Empfänger ebenso.
// - .rpc(…): Was die Funktion liest, sieht der Wächter nicht — jeder Aufruf ist ein Befund.
// - Zeichenketten und Template-Teile mit "rest/v1", "realtime/v1" oder "graphql/v1" (Aufruf am
//   Supabase-Client vorbei) — auch ohne Tabellennamen, denn Pfade lassen sich zusammensetzen.
// - Ein lokaler Import, der sich nicht auflösen lässt, oder ein import() ohne festen Pfad: Dann ist der
//   Graph unvollständig.
// Ein Name gilt nur als Konstante, wenn die Datei ihn genau einmal mit Initialisierer deklariert und nie
// neu zuweist; Parameter, Destrukturierung, Importe und gleichnamige Deklarationen machen ihn mehrdeutig.
// Gegenproben: Jede Befundart wird in eine Kopie des Quellbaums (im Speicher) eingebaut, und der
// Wächter muss genau sie melden. Jede Gegenprobe setzt voraus, dass der echte Baum befundfrei ist.
// Grenzen: Die Prüfung ist statisch. Zur Laufzeit erzeugter Code (eval, new Function), Worker-Dateien
// ohne Import-Kante und Code in Paketen aus node_modules liegen außerhalb.
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
/** Pfade der Supabase-Dienste, die Tabellen lesen oder Änderungen melden (REST, Realtime, GraphQL). */
const SUPABASE_PFAD = /(?:rest|realtime|graphql)\/v1/i;
/** Werte von REALTIME_LISTEN_TYPES (@supabase/realtime-js, RealtimeChannel) nach dem Namen des Mitglieds. */
const REALTIME_ARTEN = new Map([
  ["POSTGRES_CHANGES", "postgres_changes"],
  ["BROADCAST", "broadcast"],
  ["PRESENCE", "presence"],
  ["SYSTEM", "system"],
]);
/** Einstiegsdateien des Browsers ohne "use client" (Next.js): instrumentation-client.* und pages/** außer pages/api/**. */
const BROWSER_EINSTIEG = /^(?:instrumentation-client\.[cm]?[jt]sx?|pages\/(?!api\/).+\.[cm]?[jt]sx?)$/;

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

/** Einträge neben src, die Next.js als Browser-Einstieg nähme, die der Wächter aber nicht liest. */
function einstiegNebenSrc(eintraege) {
  return eintraege.filter((n) => n === "app" || n === "pages" || /^instrumentation-client\.[cm]?[jt]sx?$/.test(n)).sort();
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

function empfaenger(callee) {
  const c = entpacke(callee);
  return ts.isPropertyAccessExpression(c) || ts.isElementAccessExpression(c) ? entpacke(c.expression) : null;
}

/** Eingebauter Empfänger von .from() (Array, Buffer …): keine Tabelle. */
function istEingebaut(e) {
  return !!e && ((ts.isIdentifier(e) && EINGEBAUT.has(e.text)) || (ts.isPropertyAccessExpression(e) && EINGEBAUT.has(e.name.text)));
}

/** Einbettung in einer PostgREST-Spaltenliste: "select_content", "select_einbettung" oder null. */
function einbettung(spalten) {
  // Wie bei supabase-js zählt Leerraum nicht; Anführungszeichen um Namen auch nicht.
  const s = spalten.replace(/[\s"]/g, "");
  // content(…), alias:content(…), content!hinweis(…), ...content(…), auch verschachtelt.
  if (/(?:^|[,(:.])content(?=[!(])/i.test(s)) return "select_content";
  return /[(!]/.test(s) ? "select_einbettung" : null;
}

function pruefeDatei(sf, rel, befunde, tabellen) {
  const zeile = (k) => sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1;
  const kurz = (k) => k.getText(sf).replace(/\s+/g, " ").slice(0, 100);
  // Bindungen: Name → Werte. Ein Wert ist der Initialisierer einer Variablen-Deklaration; null steht für
  // jede andere Bindung (Parameter, Destrukturierung, Import, Funktion, Klasse, catch) und für jede
  // Neuzuweisung. Eindeutig ist ein Name nur mit genau einem Eintrag, und der ist ein Initialisierer.
  const bindungen = new Map();
  const binde = (name, wert) => bindungen.set(name, [...(bindungen.get(name) ?? []), wert]);
  const alleMehrdeutig = (k) => {
    if (ts.isIdentifier(k)) binde(k.text, null);
    ts.forEachChild(k, alleMehrdeutig);
  };
  const istZuweisung = (op) => op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment;
  (function sammle(k) {
    if (ts.isVariableDeclaration(k) && ts.isIdentifier(k.name)) {
      binde(k.name.text, k.initializer ?? null);
    } else if ((ts.isBindingElement(k) || ts.isParameter(k)) && ts.isIdentifier(k.name)) {
      binde(k.name.text, null);
    } else if (
      (ts.isImportClause(k) || ts.isImportSpecifier(k) || ts.isNamespaceImport(k) || ts.isImportEqualsDeclaration(k) ||
        ts.isFunctionDeclaration(k) || ts.isFunctionExpression(k) || ts.isClassDeclaration(k) || ts.isClassExpression(k) ||
        ts.isEnumDeclaration(k)) &&
      k.name &&
      ts.isIdentifier(k.name)
    ) {
      binde(k.name.text, null);
    } else if (ts.isBinaryExpression(k) && istZuweisung(k.operatorToken.kind)) {
      // Neuzuweisung, auch destrukturierend: Jeder Name links ist danach mehrdeutig.
      alleMehrdeutig(k.left);
    } else if ((ts.isPrefixUnaryExpression(k) || ts.isPostfixUnaryExpression(k)) && (k.operator === ts.SyntaxKind.PlusPlusToken || k.operator === ts.SyntaxKind.MinusMinusToken)) {
      alleMehrdeutig(k.operand);
    } else if ((ts.isForInStatement(k) || ts.isForOfStatement(k)) && !ts.isVariableDeclarationList(k.initializer)) {
      alleMehrdeutig(k.initializer);
    }
    ts.forEachChild(k, sammle);
  })(sf);
  const gebunden = (k) => {
    const liste = bindungen.get(k.text) ?? [];
    return liste.length === 1 && liste[0] ? entpacke(liste[0]) : null;
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
  // Name der aufgerufenen Methode: x.name(…), x["name"](…), x[KONSTANTE](…) oder name(…). undefined: ein
  // Index, der sich nicht statisch bestimmen lässt; null: kein benannter Aufruf (etwa f()(…)).
  const methodenName = (callee) => {
    const c = entpacke(callee);
    if (ts.isPropertyAccessExpression(c)) return c.name.text;
    if (ts.isElementAccessExpression(c)) return zeichenkette(c.argumentExpression);
    if (ts.isIdentifier(c)) return c.text;
    return null;
  };
  // Ereignis von .on(): Zeichenkette, Konstante oder ein Mitglied von REALTIME_LISTEN_TYPES; sonst undefined.
  const ereignisName = (k, tiefe = 0) => {
    const w = zeichenkette(k);
    if (typeof w === "string") return w;
    k = entpacke(k);
    if (ts.isPropertyAccessExpression(k)) return REALTIME_ARTEN.get(k.name.text);
    if (ts.isElementAccessExpression(k)) {
      const mitglied = zeichenkette(k.argumentExpression);
      return typeof mitglied === "string" ? REALTIME_ARTEN.get(mitglied) : undefined;
    }
    if (ts.isIdentifier(k) && tiefe < 5) {
      const init = gebunden(k);
      return init ? ereignisName(init, tiefe + 1) : undefined;
    }
    return undefined;
  };
  // Steht der Ausdruck direkt als aufgerufene Funktion da (auch in Klammern oder mit as)?
  const direktAufgerufen = (k) => {
    let kind = k;
    let p = k.parent;
    while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isTypeAssertionExpression(p) || ts.isNonNullExpression(p) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(p)))) {
      kind = p;
      p = p.parent;
    }
    return !!p && ts.isCallExpression(p) && p.expression === kind;
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
      const name = methodenName(k.expression);
      const e = empfaenger(k.expression);
      if (name === undefined) melde(k, "methode_unbestimmt");
      if (name === "from" && k.arguments.length > 0 && !istEingebaut(e)) {
        const tabelle = zeichenkette(k.arguments[0]);
        if (typeof tabelle === "string") {
          tabellen.push({ datei: rel, zeile: zeile(k), art: "from", tabelle });
          if (tabelle === "content") melde(k, "from_content");
        } else if (e !== null) {
          melde(k, "tabelle_unbestimmt");
        }
      }
      if (name === "select" && e !== null && k.arguments.length > 0) {
        const spalten = zeichenkette(k.arguments[0]);
        const art = typeof spalten === "string" ? einbettung(spalten) : "select_unbestimmt";
        if (art) melde(k, art);
      }
      if (name === "rpc" && e !== null) melde(k, "rpc_aufruf");
      if (name === "on" && k.arguments.length >= 2) {
        const ereignis = ereignisName(k.arguments[0]);
        if (ereignis === "postgres_changes") {
          const filter = objekt(k.arguments[1]);
          const lage = filter ? tabelleImFilter(filter) : { unbestimmt: true };
          if (lage.fehlt) melde(k, "realtime_alle_tabellen");
          else if (lage.unbestimmt) melde(k, "realtime_unbestimmt");
          else {
            tabellen.push({ datei: rel, zeile: zeile(k), art: "realtime", tabelle: lage.wert });
            if (lage.wert === "content" || lage.wert === "*") melde(k, "realtime_content");
          }
        } else if (typeof ereignis !== "string") {
          melde(k, "realtime_unbestimmt");
        }
      }
    }
    // .from ohne direkten Aufruf: call, apply, bind oder als Wert weitergereicht.
    const fromZugriff =
      (ts.isPropertyAccessExpression(k) && k.name.text === "from") || (ts.isElementAccessExpression(k) && zeichenkette(k.argumentExpression) === "from");
    if (fromZugriff && !istEingebaut(entpacke(k.expression)) && !direktAufgerufen(k)) melde(k, "from_indirekt");
    // .from destrukturiert: { from } oder { from: f } aus einem Objekt.
    if (ts.isBindingElement(k) && ts.isObjectBindingPattern(k.parent)) {
      const schluessel = k.propertyName ?? k.name;
      if ((ts.isIdentifier(schluessel) || ts.isStringLiteralLike(schluessel)) && schluessel.text === "from") melde(k, "from_indirekt");
    }
    if ((ts.isStringLiteralLike(k) || ts.isTemplateHead(k) || ts.isTemplateMiddle(k) || ts.isTemplateTail(k)) && SUPABASE_PFAD.test(k.text)) {
      melde(k, "supabase_pfad");
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
  const wurzeln = nurWurzeln ?? [...baum.keys()].filter((rel) => CODE.test(rel) && (BROWSER_EINSTIEG.test(rel) || istClient(parse(rel)))).sort();
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

test("R5-W1 Kein Client-Modul liest content oder abonniert Realtime auf content (Import-Graph ab allen \"use client\"-Dateien und Browser-Einstiegen)", () => {
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

test("R5-W5 Neben src liegt kein app- oder pages-Ordner und keine instrumentation-client-Datei — der Wächter liest nur src", () => {
  assert.deepEqual(einstiegNebenSrc(readdirSync(SITE)), []);
  // Gegenprobe: Solche Einträge neben src wären Befunde; andere nicht.
  assert.deepEqual(
    einstiegNebenSrc(["src", "app", "pages", "instrumentation-client.ts", "instrumentation-client.js", "instrumentation.ts", "public", "tests", "next.config.ts"]),
    ["app", "instrumentation-client.js", "instrumentation-client.ts", "pages"],
  );
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
/** Typ eines Objekts mit beliebigen Methoden (für Gegenproben mit Index-Zugriff). */
const BELIEBIG = "Record<string, (...a: unknown[]) => unknown>";

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
    erwartet: [["app/content/page.tsx", "supabase_pfad"]],
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
  // Prüfung 09.11.2026: Formen, die der Wächter vorher übersah.
  {
    name: "content eingebettet über eine andere Tabelle (!-Hinweis)",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const q = () => supabase.from("agents").select("*, content!created_by(id, title)");\n' } },
    erwartet: [["lib/hooks.ts", "select_content"]],
  },
  {
    name: "content eingebettet mit Alias und als Spread",
    aenderungen: {
      "lib/hooks.ts": { anhaengen: '\nexport const q = () => supabase.from("agents").select("id, beitraege:content(*)");\nexport const r = () => supabase.from("agents").select(`id, ...content(title)`);\n' },
    },
    erwartet: [
      ["lib/hooks.ts", "select_content"],
      ["lib/hooks.ts", "select_content"],
    ],
  },
  {
    name: "Einbettung einer anderen Relation (Ziel nicht prüfbar)",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const q = () => supabase.from("messages").select("*, agents(name)");\n' } },
    erwartet: [["lib/hooks.ts", "select_einbettung"]],
  },
  {
    name: "Spaltenliste nicht statisch bestimmbar",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const q = (spalten: string) => supabase.from("agents").select(spalten);\n' } },
    erwartet: [["lib/hooks.ts", "select_unbestimmt"]],
  },
  {
    name: "REST-Pfad ohne führenden Schrägstrich",
    aenderungen: { "app/content/page.tsx": { anhaengen: '\nexport const r = (basis: string) => fetch(new URL("rest/v1/content?select=*", basis));\n' } },
    erwartet: [["app/content/page.tsx", "supabase_pfad"]],
  },
  {
    name: "REST-Pfad zusammengesetzt, Tabelle als Konstante",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nconst PFAD_TABELLE = "content";\nexport const r = (basis: string) => fetch(basis + "/rest/v1/" + PFAD_TABELLE + "?select=*");\n' } },
    erwartet: [["lib/hooks.ts", "supabase_pfad"]],
  },
  {
    name: "Realtime-Pfad am Client vorbei",
    aenderungen: { "lib/hooks.ts": { anhaengen: "\nexport const w = (u: string) => new WebSocket(`${u}/realtime/v1/websocket`);\n" } },
    erwartet: [["lib/hooks.ts", "supabase_pfad"]],
  },
  {
    name: "Methodenname über eine Konstante",
    aenderungen: { "lib/hooks.ts": { anhaengen: `\nconst METHODE = "from";\nexport const q = () => (supabase as unknown as ${BELIEBIG})[METHODE]("content");\n` } },
    erwartet: [["lib/hooks.ts", "from_content"]],
  },
  {
    name: "Methodenname nicht statisch bestimmbar",
    aenderungen: { "lib/hooks.ts": { anhaengen: `\nexport const q = (m: string) => (supabase as unknown as ${BELIEBIG})[m]("content");\n` } },
    erwartet: [["lib/hooks.ts", "methode_unbestimmt"]],
  },
  {
    name: "from über call",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const q = () => supabase.from.call(supabase, "content");\n' } },
    erwartet: [["lib/hooks.ts", "from_indirekt"]],
  },
  {
    name: "from destrukturiert und umbenannt",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nconst { from: tabelleLesen } = supabase;\nexport const q = () => tabelleLesen("content");\n' } },
    erwartet: [["lib/hooks.ts", "from_indirekt"]],
  },
  {
    name: "Realtime-Ereignis als REALTIME_LISTEN_TYPES an einem Kanal-Parameter",
    aenderungen: {
      "lib/hooks.ts": {
        anhaengen:
          '\nimport { REALTIME_LISTEN_TYPES } from "@supabase/supabase-js";\nexport function k(kanal: { on: (...a: unknown[]) => unknown }) {\n  return kanal.on(REALTIME_LISTEN_TYPES.POSTGRES_CHANGES, { event: "*", schema: "public", table: "content" }, () => {});\n}\n',
      },
    },
    erwartet: [["lib/hooks.ts", "realtime_content"]],
  },
  {
    name: "Realtime-Ereignis nicht bestimmbar an einem Parameter (kein Kanal erkennbar)",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport function k(kanal: { on: (...a: unknown[]) => unknown }, e: string) {\n  return kanal.on(e, { table: "agents" }, () => {});\n}\n' } },
    erwartet: [["lib/hooks.ts", "realtime_unbestimmt"]],
  },
  {
    name: "Tabellenname mit späterer Zuweisung (let)",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport function q() {\n  let tabelle = "agents";\n  tabelle = "content";\n  return supabase.from(tabelle).select("*");\n}\n' } },
    erwartet: [["lib/hooks.ts", "tabelle_unbestimmt"]],
  },
  {
    name: "Konstante durch einen Parameter verschattet",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nconst SCHATTEN = "agents";\nexport const q = (SCHATTEN: string) => supabase.from(SCHATTEN).select("*");\n' } },
    erwartet: [["lib/hooks.ts", "tabelle_unbestimmt"]],
  },
  {
    name: "rpc-Aufruf",
    aenderungen: { "lib/hooks.ts": { anhaengen: '\nexport const q = () => supabase.rpc("liste_lesen");\n' } },
    erwartet: [["lib/hooks.ts", "rpc_aufruf"]],
  },
  {
    name: "instrumentation-client.ts ohne \"use client\"",
    aenderungen: { "instrumentation-client.ts": { neu: 'import { supabase } from "@/lib/supabase";\nvoid supabase.from("content").select("*");\n' } },
    erwartet: [["instrumentation-client.ts", "from_content"]],
  },
  {
    name: "Seite unter pages/ ohne \"use client\"",
    aenderungen: {
      "pages/alt.tsx": { neu: 'import { supabase } from "@/lib/supabase";\nexport default function Alt() {\n  void supabase.from("content").select("*");\n  return null;\n}\n' },
    },
    erwartet: [["pages/alt.tsx", "from_content"]],
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

test("R5-W4 Gegenkontrolle: Nur-Typ-Importe, Array.from (auch als Wert), andere Tabellen, Spalten ohne Einbettung, andere Realtime-Ereignisse, nie neu zugewiesene Namen und Server-Routen unter pages/api sind keine Befunde", () => {
  assert.deepEqual(BASIS.befunde, [], `Basis nicht befundfrei:\n${zeigen(BASIS.befunde)}`);
  const e = analysiere(
    mitAenderung({
      "lib/neu-lesen.ts": { neu: `import { supabase } from "./supabase";\nexport type Zeile = { id: number };\n${LESER}` },
      "components/ui/KPICard.tsx": { voran: 'import type { Zeile } from "@/lib/neu-lesen";\nexport type Z = Zeile;\n' },
      "lib/hooks.ts": {
        anhaengen: [
          "",
          'export const a = () => Array.from("content");',
          'export const b = () => supabase.from("messages").select("id");',
          "export const c = (xs: string[]) => xs.map(Array.from);",
          'export const d = () => supabase.from("agents").select("id, name, content, metadata->steps, created_at::text");',
          'export const f = () => supabase.channel("b").on("broadcast", { event: "x" }, () => {});',
          'let nieNeu = "metrics";',
          'export const g = () => supabase.from(nieNeu).select("*");',
          "",
        ].join("\n"),
      },
      "pages/api/alt.ts": { neu: `import { supabase } from "@/lib/supabase";\n${LESER}` },
    }),
  );
  assert.deepEqual(e.befunde, [], zeigen(e.befunde));
  assert.ok(!e.erreicht.has("lib/neu-lesen.ts"), "Nur-Typ-Import ist keine Laufzeit-Kante");
  assert.ok(!e.wurzeln.includes("pages/api/alt.ts") && !e.erreicht.has("pages/api/alt.ts"), "Server-Route unter pages/api ist kein Browser-Einstieg");
  assert.deepEqual([...new Set(e.tabellen.filter((t) => t.art === "from").map((t) => t.tabelle))].sort(), ["agents", "messages", "metrics"]);
});
