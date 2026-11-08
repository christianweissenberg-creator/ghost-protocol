// Tests der Tor-Prüfung vom 07.11.2026 (Anzeige ehrlich: keine unmarkierten Fakten-Literale,
// gemessene Werte nicht irreführend). Lauf: npm test. Je Befund ein Test, im Namen genannt:
// - TOR-T1 /academy: Einwohnerzahlen ohne Quelle gestrichen, Kopf zählt Agenten mit Modul.
// - TOR-T2 Systemzustand, Zeile „Crons": "laut Plan" und Umfang VPS-Crontab sichtbar, GitHub-
//   Zeitpläne im title als nicht gemessen; Lage und Farbe unverändert.
// - TOR-F1 Message Bus im Command Center: Datum, wenn nicht vom Tag der Messung (Europe/Berlin).
// - TOR-F2 Modell je Agent aus der Dashboard-Konfiguration (lib/agent-modelle.ts), Register-
//   Abweichung sichtbar; SENTINEL "kein Dashboard-Prompt"; /metrics zählt danach.
// - TOR-F3/F4 /agents/[id]: Kosten aus Tokens × aktueller Tabelle, nicht aus total_cost_usd.
// - TOR-F5/F6 /messages: Zähler summieren sich zur Liste; cost_usd einheitlich, Preistabelle sichtbar.
// - TOR-F7 /agents/[id]: "Modell letzter Lauf" zählt Planungen (delegate-plan) mit.
// F8 (Kachel "Freigegeben") steht in tests/e-content-komponenten.test.mjs (Hook-Laufzeit der Seite).
// Nachprüfung 07.11.2026 (Befunde der drei Prüfer): Regel-5-Wächter mit TypeScript-Parser und Riegel
// "server-only" (sicherheit-1/-2), Kosten mit Modell je Lauf (ehrlichkeit-2), Wortlaut /metrics und
// /messages (ehrlichkeit-1/-3), Vorjahr (K2), fremde Antwort an donna (K3); Zeitzone UTC (K1) steht
// in tests/u-tor-zeitzone.test.mjs.
// Nachprüfung Mutation 07.11.2026: Tests gegen 13 Mutanten, die die Suite überlebten (Namen mit
// "Mutation Mxx"): M02, M05 (T1), M19, M21 (F1), M36, M42 (F2/Regel 5), M51, M60 (F3/F4), M65–M67
// (F5), M80, M90 (F7). Testdaten dort sind Testannahmen, wo nicht "gemessen" dabeisteht.
// Die ECHTEN .tsx-Dateien werden übersetzt und mit Attrappen geladen (tests/harness/tsx.mjs).
// Testdaten mit "gemessen" stammen aus SELECTs auf agents und messages vom 07.11.2026.
// Kein Netz: Es gibt keinen Abruf; fetch wird nicht gebraucht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { React, baumLaufzeit, finde, jsxRuntime, ladeTsx, renderToStaticMarkup, text, ts } from "./harness/tsx.mjs";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Riegel in lib/agent-prompts.ts: Next.js nimmt im Server-Bundle die leere Fassung, Node kennt
    // das Paket nicht (es liegt nur in next/dist/compiled).
    if (specifier === "server-only") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/dist/compiled/server-only/empty.js")).href, context);
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const types = await import("../src/lib/types.ts");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const kosten = await import("../src/lib/kosten.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const statusServer = await import("../src/lib/status-server.ts");
const totmann = await import("../src/lib/totmann.ts");
const auftragTypes = await import("../src/lib/auftrag-types.ts");
// Fehlt das Modul (Rückprobe gegen den Stand vor der Tor-Prüfung), scheitern die Tests an der
// Anzeige, nicht schon beim Laden.
const modelle = await import("../src/lib/agent-modelle.ts").catch(() => ({ AGENT_MODELLE: {}, dashboardModellFuer: () => null }));

const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
const leer = () => null;

/** Messzeitpunkt der Live-Abzüge: Sa 07.11.2026 12:28:23 Europe/Berlin. */
const MESSUNG = "2026-11-07T11:28:23.000Z";

// ═══ TOR-T1 /academy ═══

function academy(lz) {
  return ladeTsx("app/academy/page.tsx", { ...lz.attrappen }, ["TRAINING_DATA"]);
}

test("TOR-T1 /academy: keine Einwohner- bzw. Marktgrößen-Zahlen ohne Quelle in den Kernkompetenzen (LOCALIZER gerendert)", () => {
  const lz = baumLaufzeit();
  const A = academy(lz);
  // useState: selectedAgent, activeTab
  const t = text(lz.rendere(A.default, {}, ["localizer", "overview"]));
  assert.ok(t.includes("DACH-Marktintelligenz"), "LOCALIZER-Tab gerendert");
  assert.doesNotMatch(t, /\b\d+(?:[.,]\d+)?\s?(?:M|Mio\.?|Mrd\.?|Millionen)\b/, t.slice(0, 400));
  // Alle Module: keine Mengenangabe in Millionen ohne Quelle
  const millionen = /\b\d+(?:[.,]\d+)?\s?(?:M|Mio\.?|Mrd\.?|Millionen)\b/;
  const treffer = A.__intern.TRAINING_DATA.flatMap((m) => m.kernkompetenzen.filter((k) => millionen.test(k)).map((k) => `${m.agentId}: ${k}`));
  assert.deepEqual(treffer, []);
});

test("TOR-T1 /academy: Kopf zählt den Lehrplan (Agenten mit Modul), nicht die Flotte — Etikett ohne 'Agents'", () => {
  const lz = baumLaufzeit();
  const A = academy(lz);
  const baum = lz.rendere(A.default, {}, [null, "overview"]);
  const kopf = finde(baum, (k) => k.type === "p" && String(k.props.className ?? "") === "gp-kicker")[0];
  assert.ok(kopf, "Kopfzeile");
  const agenten = new Set(A.__intern.TRAINING_DATA.map((m) => m.agentId)).size;
  assert.match(text(kopf), new RegExp(`^Internes Weiterbildungsmodul — Lehrplan für ${agenten} Agenten, \\d+ Pflichtlektueren, \\d+ Pruefungsfragen$`));
  assert.match(String(kopf.props.title ?? ""), /nicht aus dem Agenten-Register/);
});

// Nachprüfung Mutation 07.11.2026 (M02): Der Regex oben kennt nur M, Mio., Mrd. und Millionen —
// "Einwohner DE 84.000.000, AT 9.100.000, CH 8.800.000" blieb grün. Jetzt erkennt mengenAngabe
// Tausendergruppen, lange Ziffernfolgen, Größenwörter und Bevölkerungswörter neben Ziffern; dazu
// eine Inventur: Jede Kernkompetenz mit Ziffern ist einzeln eingestuft (Name, Norm, Parameter).

/** Mengen- bzw. Bevölkerungsangabe (Weltdaten, Tor-Klasse D ohne Quelle) in üblicher Schreibweise. */
const MENGEN_MUSTER = [
  /\d{1,3}(?:[.,'\u2019\u00a0\u202f ]\d{3})+(?!\d)/, // 84.000.000 · 9,100,000 · 8'800'000 · 84 000 000
  /\d{5,}/, // 84000000
  /\d(?:[.,]\d+)?\s?(?:M|Mio\.?|Mrd\.?|Mn|Bn|bn|Tsd\.?|Tausend|Million|Millionen|Milliarde|Milliarden|million|billion|k)(?![A-Za-zÄÖÜäöüß])/, // 84M · 9 Mio. · 8,8 Millionen
  /(?:Einwohner|Bevölkerung|Bevoelkerung|Einw\.|Marktgr(?:ö|oe)(?:ß|ss)e|Marktvolumen)[^.;]*\d|\d[^.;]*(?:Einwohner|Bevölkerung|Bevoelkerung|Einw\.)/i,
];
const mengenAngabe = (s) => MENGEN_MUSTER.some((m) => m.test(s));

/** Alle Texte eines Lehrplan-Moduls, die die Seite zeigt: [Feld, Text]. */
const lehrplanTexte = (m) => [
  ...m.kernkompetenzen.map((t) => ["kernkompetenzen", t]),
  ...m.pruefungsfragen.map((t) => ["pruefungsfragen", t]),
  ...m.pflichtlektuere.flatMap((b) => [["pflichtlektuere", b.titel], ["pflichtlektuere", b.autor], ["pflichtlektuere", b.relevanz]]),
  ...m.crossTraining.flatMap((c) => [["crossTraining", c.partner], ["crossTraining", c.thema]]),
  ...m.lernpfad.flatMap((l) => [["lernpfad", l.stufe], ...l.kriterien.map((k) => ["lernpfad", k])]),
  ["role", m.role],
  ["agentName", m.agentName],
];

test("TOR-T1 /academy (Mutation M02): Einwohner- und Marktgrößen in jeder Schreibweise erkannt — keine im Lehrplan, keine im LOCALIZER-Tab", () => {
  // Der Erkenner selbst: die Form vor dem Fix, die Form des Mutanten M02 und weitere Schreibweisen.
  for (const s of ["DE 84M, AT 9M, CH 8.8M", "Einwohner DE 84.000.000, AT 9.100.000, CH 8.800.000", "DE 84000000", "CH 8'800'000", "CH 8\u2019800\u2019000", "DE 84\u202f000\u202f000", "AT 9\u00a0100\u00a0000", "AT 9 100 000", "DE 84 Mio.", "8,8 Millionen", "DE: 84 (Bevölkerung)"]) {
    assert.ok(mengenAngabe(s), `nicht erkannt: ${s}`);
  }
  // Namen, Normen und Aufgabenparameter des Lehrplans sind keine Mengenangaben.
  for (const s of ["OWASP Top 10", "EU AI Act (2024/1689) — 4 Risikoklassen", "AGB-Recht (§§305-310 BGB)", "3-2-1 Backup-Regel", "Rule of 40 — Growth% + Margin% >= 40%", "Definiere 3 OKRs fuer Q2 2026", "GILT-Framework — Globalization, I18n, L10n", "Headlines mit 4U's", "SaaS Metrics 2.0"]) {
    assert.ok(!mengenAngabe(s), `fälschlich erkannt: ${s}`);
  }
  const lz = baumLaufzeit();
  const A = academy(lz);
  const treffer = A.__intern.TRAINING_DATA.flatMap((m) => lehrplanTexte(m).filter(([, t]) => mengenAngabe(String(t))).map(([feld, t]) => `${m.agentId}.${feld}: ${t}`));
  assert.deepEqual(treffer, []);
  // Gerendert: jede Kernkompetenz im LOCALIZER-Tab einzeln.
  const kompetenzen = finde(lz.rendere(A.default, {}, ["localizer", "overview"]), (k) => k.type === "p" && k.props.className === "text-sm text-text-secondary").map(text);
  assert.ok(kompetenzen.some((k) => k.startsWith("DACH-Marktintelligenz")), kompetenzen.join(" | "));
  assert.deepEqual(kompetenzen.filter(mengenAngabe), []);
});

/** Kernkompetenzen mit Ziffern, je eingestuft (Gegenprüfer der Tor-Prüfung: Frameworknamen,
 *  Paragraphen, Aufgabenparameter — keine zeitabhängigen Weltdaten). */
const KERNKOMPETENZEN_MIT_ZIFFERN = {
  "oracle: Scenario Planning (Shell-Methode) — 2x2 Unsicherheitsmatrix": "Methodenname",
  "architect: 12-Factor App (Heroku) — Cloud-native Prinzipien": "Methodenname",
  "architect: OWASP Top 10 — Web-Sicherheitsrisiken": "Name einer Liste",
  "architect: C4-Modell (Simon Brown) — Context, Container, Component, Code": "Methodenname",
  "treasurer: Rule of 40 — Growth% + Margin% >= 40%": "Faustregel (Definition)",
  "publisher: Cialdini's 6 Principles of Persuasion": "Modellname",
  "publisher: Eugene Schwartz 5 Awareness Levels": "Modellname",
  "counsel: DSGVO Art. 5-83 — Datenschutz-Grundverordnung": "Normzitat",
  "counsel: EU AI Act (2024/1689) — 4 Risikoklassen, Transparenzpflichten": "Normzitat",
  "counsel: AGB-Recht (§§305-310 BGB) — Vertragsgestaltung": "Normzitat",
  "merchant: Product-Market Fit (Sean Ellis 40% Test)": "Name eines Tests",
  "guardian: 3-2-1 Backup-Regel — RPO/RTO Management": "Name einer Regel",
  "concierge: SPACES Model (CMX) — 6 Community-Wertquellen": "Modellname",
  "localizer: GILT-Framework — Globalization, I18n, L10n, Translation": "Abkürzungen",
  "localizer: Du/Sie-Konventionen — B2C vs. B2B Tonalitaet": "Abkürzungen",
};

test("TOR-T1 /academy (Mutation M02): Inventur — jede Kernkompetenz mit Ziffern ist eingestuft, keine neue Zahl ohne Einstufung", () => {
  const lz = baumLaufzeit();
  const mitZiffern = academy(lz).__intern.TRAINING_DATA.flatMap((m) => m.kernkompetenzen.filter((k) => /\d/.test(k)).map((k) => `${m.agentId}: ${k}`));
  // Neue oder geänderte Zeile mit Ziffern: Name, Norm oder Parameter → hier einstufen; Weltdaten →
  // mit Quelle und Stand zeigen oder streichen (Tor-Klasse D).
  assert.deepEqual(mitZiffern.sort(), Object.keys(KERNKOMPETENZEN_MIT_ZIFFERN).sort());
});

// Nachprüfung Mutation 07.11.2026 (M05): "Lehrplan für 14 Agenten" als Literal rendert heute dasselbe
// wie die Zählung — nur der Quelltext unterscheidet beide. Der TypeScript-Parser prüft den Kopf.

// ts.forEachChild bricht ab, sobald der Rückruf etwas Wahres liefert: Die Rückrufe unten liefern nichts.

/** Bezeichner in einem Teilbaum. */
function bezeichnerIn(k, aus = new Set()) {
  if (ts.isIdentifier(k)) aus.add(k.text);
  ts.forEachChild(k, (c) => void bezeichnerIn(c, aus));
  return aus;
}

/** Literale mit Ziffern in einem Teilbaum (Zahl, Text, Vorlage). */
function ziffernLiterale(k, sf, aus = []) {
  if ((ts.isNumericLiteral(k) || ts.isStringLiteralLike(k) || ts.isTemplateHead(k) || ts.isTemplateMiddle(k) || ts.isTemplateTail(k)) && /\d/.test(k.text)) aus.push(k.getText(sf));
  ts.forEachChild(k, (c) => void ziffernLiterale(c, sf, aus));
  return aus;
}

test("TOR-T1 /academy (Mutation M05): Kopfzahlen im Quelltext aus TRAINING_DATA gezählt — kein Ziffern-Literal im Kopf, JSX-Texte mit Ziffern eingestuft", () => {
  const sf = ts.createSourceFile("page.tsx", readFileSync(path.join(SITE, "src/app/academy/page.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const konstanten = new Map();
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) konstanten.set(d.name.text, d.initializer);
  }
  const ausDaten = (name, gesehen = new Set()) => {
    if (name === "TRAINING_DATA") return true;
    if (gesehen.has(name) || !konstanten.has(name)) return false;
    gesehen.add(name);
    return [...bezeichnerIn(konstanten.get(name))].some((n) => ausDaten(n, gesehen));
  };
  const kopf = [];
  const jsxTexte = [];
  const besuche = (k) => {
    if (ts.isJsxText(k)) {
      const t = k.text.replace(/&#x?[0-9a-f]+;/gi, "").replace(/\s+/g, " ").trim();
      if (/\d/.test(t)) jsxTexte.push(t);
    }
    if (ts.isJsxElement(k)) {
      const klasse = k.openingElement.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "className");
      if (klasse?.initializer && ts.isStringLiteral(klasse.initializer) && klasse.initializer.text === "gp-kicker") kopf.push(k);
    }
    ts.forEachChild(k, besuche);
  };
  besuche(sf);
  assert.equal(kopf.length, 1, "genau ein Kopf (gp-kicker)");
  const ausdruecke = [];
  for (const kind of kopf[0].children) {
    if (ts.isJsxText(kind)) assert.doesNotMatch(kind.text, /\d/, `Ziffer als Text im Kopf: ${JSON.stringify(kind.text.trim())}`);
    else if (ts.isJsxExpression(kind) && kind.expression) {
      const quelle = kind.expression.getText(sf);
      ausdruecke.push(quelle);
      assert.deepEqual(ziffernLiterale(kind.expression, sf), [], `Literal im Kopf: {${quelle}}`);
      assert.ok([...bezeichnerIn(kind.expression)].some((n) => ausDaten(n)), `{${quelle}} nicht aus TRAINING_DATA gezählt`);
    } else assert.fail(`unerwartetes Kind im Kopf: ${ts.SyntaxKind[kind.kind]}`);
  }
  assert.equal(ausdruecke.length, 3, `Kopf mit drei gezählten Werten: ${ausdruecke.join(", ")}`);
  // Übrige JSX-Texte mit Ziffern: Gliederung und Etiketten des Lehrplans (Klasse E), keine Messwerte.
  assert.deepEqual(jsxTexte, ["07 / AUSBILDUNG", "Q2 2026 Curriculum", "Q2 2026 Zertifizierungsplan"]);
});

// ═══ TOR-T2 Systemzustand, Zeile „Crons" ═══

const P = ladeTsx("components/ui/CommandPanels.tsx", {
  ...ECHT,
  "next/link": { __esModule: true, default: Link },
  "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }) },
  "@/lib/freigabe-regeln": regeln,
  "@/lib/hooks-status": hooksStatus,
  "@/lib/types": types,
});

function cronsZeile(status) {
  const lesung = { status, fehler: null, loading: false, geladenAm: status.erzeugt_am, httpStatus: 200, neuLaden: async () => {} };
  const roh = renderToStaticMarkup(React.createElement(P.SystemzustandPanel, { lesung }));
  const teil = roh.split('<div class="flex items-center gap-2.5"').find((t) => t.includes(">Crons</span>"));
  assert.ok(teil, "Zeile Crons fehlt");
  const title = ent(/^ title="([^"]*)"/.exec(teil)?.[1] ?? "");
  const wert = /<span class="ml-auto[^"]*" style="color:([^"]*)">([^<]*)<\/span>/.exec(teil);
  return { title, farbe: wert?.[1], text: ent(wert?.[2] ?? "") };
}

function cronsMesswert(plan, jetzt) {
  const b = statusServer.bewerteTotmann(plan, [], new Date(jetzt), null, null);
  return { wert: b.wert, status: b.status, quelle: "Plan site/src/lib/totmann.ts · Supabase · lauf_nachweis", gemessen_am: jetzt, ...(b.hinweis ? { hinweis: b.hinweis } : {}) };
}

test("TOR-T2 Crons: Zeilentext nennt Planwert und Umfang ('laut Plan aus seit 30.07.2026 · VPS-Crontab'), Farbe bernstein wie bisher", () => {
  const m = cronsMesswert(totmann.TOTMANN_PLAN, MESSUNG);
  assert.equal(m.status, "warnung", "Totmann-Semantik unverändert: alle aus → bernstein");
  assert.deepEqual(m.wert.jobs.map((j) => j.lage), ["aus", "aus", "aus"]);
  const z = cronsZeile({ erzeugt_am: MESSUNG, crons: m });
  assert.equal(z.text, "laut Plan aus seit 30.07.2026 · VPS-Crontab");
  assert.equal(z.farbe, "var(--gp-amber)");
});

test("TOR-T2 Crons: title sagt, dass die Zeitpläne der GitHub-Workflows nicht gemessen sind; jeder Job 'laut Plan aus'", () => {
  const z = cronsZeile({ erzeugt_am: MESSUNG, crons: cronsMesswert(totmann.TOTMANN_PLAN, MESSUNG) });
  assert.ok(z.title.includes("Zeitpläne der GitHub-Workflows (.github/workflows) sind nicht gemessen"), z.title);
  assert.ok(z.title.includes("nur für den VPS-Crontab"), z.title);
  assert.equal((z.title.match(/: laut Plan aus seit 30\.07\.2026 — Crons abgeschaltet/g) ?? []).length, 3, z.title);
  // Auch ein einzelner abgeschalteter Job neben aktiven trägt Planwert und Umfang sichtbar.
  const [MORGEN, ABEND, AUTO] = totmann.TOTMANN_PLAN;
  const aktiv = (j) => ({ ...j, aktiv: true, aktiv_seit: "2026-11-07T00:00:00+01:00", zeitzone_beleg: "Testannahme", aus_seit: null, grund: null });
  const einer = cronsZeile({ erzeugt_am: MESSUNG, crons: cronsMesswert([MORGEN, aktiv(ABEND), aktiv(AUTO)], MESSUNG) });
  assert.equal(einer.text, "Briefing morgens: laut Plan aus seit 30.07.2026 · VPS-Crontab");
  assert.ok(einer.title.endsWith(types.CRONS_UMFANG), einer.title.slice(-200));
});

// ═══ TOR-F1 Message Bus im Command Center ═══

const F = ladeTsx("components/ui/MessageFeed.tsx", { ...ECHT, "@/lib/freigabe-regeln": regeln, "@/lib/types": types });

const nachricht = (id, zeit, teil = {}) => ({
  id,
  from_agent: "counsel",
  to_agents: ["donna"],
  to_channels: [],
  message_type: "response",
  priority: "normal",
  content: { text: `Antwort ${id}` },
  metadata: { source: "activation-api" },
  created_at: zeit,
  timestamp: zeit,
  ...teil,
});

/** Zeitangaben des Feeds: [{ text, title }] in Listenfolge. */
function feedZeiten(messages, bezugIso) {
  const html = ent(renderToStaticMarkup(React.createElement(F.MessageFeed, { messages, bezugIso })));
  return [...html.matchAll(/<span class="text-\[10px\] text-text-muted ml-auto font-mono[^"]*"(?: title="([^"]*)")?>([^<]*)<\/span>/g)].map((m) => ({
    title: m[1] ?? "",
    text: m[2],
  }));
}

test("TOR-F1 Bus: Nachricht vom 30.07. zeigt das Datum ('30.07., 00:19:54'), eine vom Tag der Messung nur die Uhrzeit", () => {
  // gemessen: neueste Bus-Zeile 07.11.2026 11:24:39 UTC, Juli-Läufe bis 29.07.2026 22:19:54 UTC
  const zeiten = feedZeiten([nachricht("neu", "2026-11-07T11:24:39.821Z"), nachricht("alt", "2026-07-29T22:19:54.000Z")], MESSUNG);
  assert.deepEqual(
    zeiten.map((z) => z.text),
    ["12:24:39", "30.07., 00:19:54"],
  );
  assert.match(zeiten[1].title, /^30\.07\.2026 00:19:54 \(Europe\/Berlin\) · Feld messages\.timestamp$/);
  assert.match(zeiten[0].title, /^07\.11\.2026 12:24:39 \(Europe\/Berlin\) · Feld messages\.timestamp · ohne Datum: Tag der Messung des Systemzustands$/);
});

test("TOR-F1 Bus: 'heute' ist der Kalendertag in Europe/Berlin; anderes Jahr mit Jahr; ohne Messzeit immer mit Datum", () => {
  // 07.11. 23:00 Berlin gegen Messung 08.11. 00:30 Berlin: anderer Tag, obwohl in UTC derselbe.
  const nachMitternacht = feedZeiten([nachricht("a", "2026-11-07T22:00:00.000Z")], "2026-11-07T23:30:00.000Z");
  assert.equal(nachMitternacht[0].text, "07.11., 23:00:00");
  assert.equal(feedZeiten([nachricht("b", "2025-12-31T22:30:00.000Z")], MESSUNG)[0].text, "31.12.2025, 23:30:00");
  // Nachprüfung K2: derselbe Kalendertag ein Jahr früher ist nicht "heute" — mit Datum und Jahr.
  assert.equal(feedZeiten([nachricht("v", "2025-11-07T11:00:00.000Z")], MESSUNG)[0].text, "07.11.2025, 12:00:00");
  const ohneBezug = feedZeiten([nachricht("c", "2026-11-07T11:24:39.000Z")], null);
  assert.equal(ohneBezug[0].text, "07.11.2026, 12:24:39");
  assert.match(ohneBezug[0].title, /Datum immer gezeigt/);
  // Ohne timestamp zählt created_at, wie bisher; unlesbar bleibt "Zeit unbekannt".
  assert.equal(feedZeiten([nachricht("d", "2026-07-28T06:46:42.000Z", { timestamp: null })], MESSUNG)[0].text, "28.07., 08:46:42");
  assert.equal(feedZeiten([nachricht("e", "kaputt")], MESSUNG)[0].text, "Zeit unbekannt");
});

// Nachprüfung Mutation 07.11.2026 (M21): Alle Tests hatten timestamp = created_at oder timestamp null;
// "created_at vor timestamp" blieb grün und hätte unter dem title "Feld messages.timestamp" die Zeit
// aus created_at gezeigt. Testannahme (live gemessen 0 von 48 Zeilen mit timestamp ≠ created_at):
// timestamp 29.07.2026, created_at 07.11.2026 am Tag der Messung.
test("TOR-F1 Bus (Mutation M21): gezeigt wird das Feld, das der title nennt — timestamp vor created_at", () => {
  const [z] = feedZeiten([nachricht("t", "2026-11-07T11:00:00.000Z", { timestamp: "2026-07-29T22:19:54.000Z" })], MESSUNG);
  assert.deepEqual(z, { text: "30.07., 00:19:54", title: "30.07.2026 00:19:54 (Europe/Berlin) · Feld messages.timestamp" });
  // Ohne timestamp: created_at, und der title nennt dieses Feld.
  const [c] = feedZeiten([nachricht("c", "2026-07-28T06:46:42.000Z", { timestamp: null })], MESSUNG);
  assert.deepEqual(c, { text: "28.07., 08:46:42", title: "28.07.2026 08:46:42 (Europe/Berlin) · Feld messages.created_at" });
  // Unlesbarer timestamp neben lesbarem created_at: keine Zeit aus dem anderen Feld.
  const [u] = feedZeiten([nachricht("u", "2026-11-07T11:00:00.000Z", { timestamp: "kaputt" })], MESSUNG);
  assert.deepEqual(u, { text: "Zeit unbekannt", title: "Zeitpunkt fehlt oder ist unlesbar (messages.timestamp)" });
});

/** Command Center mit der gegebenen Lesung des Systemzustands; liefert die Props an den MessageFeed. */
function commandCenterFeed(lesung) {
  const lz = baumLaufzeit();
  const gefangen = [];
  const C = ladeTsx("app/page.tsx", {
    ...lz.attrappen,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks": {
      useAgents: () => ({ agents: [], ausgeblendet: 0, loading: false, error: null, refetch: async () => {} }),
      useMessages: () => ({ messages: [nachricht("n", "2026-07-29T22:19:54.000Z")], loading: false, error: null, realtime: "SUBSCRIBED", realtimeFehler: null }),
      useObjekte: () => ({ objekte: [], loading: false, error: null, fehlerArt: null }),
    },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": { ...hooksStatus, useSystemStatus: () => lesung },
    "@/lib/types": types,
    "@/lib/auftrag-types": auftragTypes,
    "@/components/agents/AgentCard": { AgentCard: leer },
    "@/components/ui/MessageFeed": {
      MessageFeed: (p) => {
        gefangen.push(p);
        return null;
      },
      istSichtbareNachricht: () => true,
    },
    "@/components/ui/Masthead": { Masthead: leer },
    "@/components/ui/SituationTable": { SituationTable: leer },
    "@/components/ui/CommandPanels": { FreigabePanel: leer, SteinadelPanel: leer, SystemzustandPanel: leer },
  });
  lz.rendere(C.default, {}, []);
  assert.equal(gefangen.length, 1, "Feed gerendert");
  return gefangen[0];
}

test("TOR-F1 Command Center: reicht den Messzeitpunkt des Systemzustands (erzeugt_am) als Bezug an den Feed", () => {
  const p = commandCenterFeed({ status: { erzeugt_am: MESSUNG }, fehler: null, loading: false, geladenAm: MESSUNG, httpStatus: 200, neuLaden: async () => {} });
  assert.equal(p.bezugIso, MESSUNG);
});

// Nachprüfung Mutation 07.11.2026 (M19): Der Test oben setzt geladenAm = erzeugt_am und keinen Fehler;
// "Bezug = geladenAm" (Browseruhr beim Laden, bleibt bei Abruffehler stehen) blieb grün.
test("TOR-F1 Command Center (Mutation M19): Bezug ist erzeugt_am des Servers, nicht die Ladezeit im Browser; bei Abruffehler keiner", () => {
  // Testannahme: Der Server misst am 08.11.2026 00:30 Berlin, die Browseruhr geht nach (Laden um
  // 07.11. 23:50 Berlin). Eine Nachricht vom 07.11. 23:00 Berlin ist nicht vom Tag der Messung.
  const spaet = [nachricht("spaet", "2026-11-07T22:00:00.000Z")];
  const ok = commandCenterFeed({ status: { erzeugt_am: "2026-11-07T23:30:00.000Z" }, fehler: null, loading: false, geladenAm: "2026-11-07T22:50:00.000Z", httpStatus: 200, neuLaden: async () => {} });
  assert.equal(ok.bezugIso, "2026-11-07T23:30:00.000Z");
  assert.equal(feedZeiten(spaet, ok.bezugIso)[0].text, "07.11., 23:00:00");
  // Abruffehler: Die alte Messung und die alte Ladezeit stehen noch in der Lesung, gelten aber nicht
  // als aktuell — kein Bezug, der Feed zeigt immer das Datum.
  const fehler = commandCenterFeed({ status: { erzeugt_am: "2026-11-07T23:30:00.000Z" }, fehler: "HTTP 503", loading: false, geladenAm: "2026-11-07T23:30:05.000Z", httpStatus: 503, neuLaden: async () => {} });
  assert.equal(fehler.bezugIso, null);
  assert.equal(feedZeiten(spaet, fehler.bezugIso)[0].text, "07.11.2026, 23:00:00");
});

// ═══ TOR-F2 Modell je Agent ═══

// Register agents.llm_model, gemessen per SELECT am 07.11.2026 (ohne trader, ausgeblendet).
const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5-20251001";
const REGISTER = [
  ["strategist", "STRATEGIST", 0, SONNET],
  ["donna", "L.I.S.A.", 0, SONNET],
  ["oracle", "ORACLE", 1, SONNET],
  ["operator", "OPERATOR", 1, SONNET],
  ["architect", "ARCHITECT", 1, SONNET],
  ["treasurer", "TREASURER", 1, HAIKU],
  ["publisher", "PUBLISHER", 1, SONNET],
  ["counsel", "COUNSEL", 1, HAIKU],
  ["amplifier", "AMPLIFIER", 2, SONNET],
  ["merchant", "MERCHANT", 2, SONNET],
  ["researcher", "RESEARCHER", 2, SONNET],
  ["scribe", "SCRIBE", 3, SONNET],
  ["guardian", "GUARDIAN", 3, HAIKU],
  ["concierge", "CONCIERGE", 3, HAIKU],
  ["localizer", "LOCALIZER", 3, HAIKU],
  ["sentinel", "SENTINEL", 3, HAIKU],
];
const agent = ([id, name, tier, llm_model], teil = {}) => ({
  id,
  name,
  role: `Rolle ${name}`,
  tier,
  llm_model,
  status: "online",
  channels: [],
  last_heartbeat: null,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cost_usd: 0,
  config: {},
  ...teil,
});
const AGENTEN = REGISTER.map((z) => agent(z));
const nach = (id) => AGENTEN.find((a) => a.id === id);

function karte(a) {
  const K = ladeTsx("components/agents/AgentCard.tsx", {
    ...ECHT,
    "next/link": { __esModule: true, default: Link },
    "@/lib/types": types,
    "@/lib/hooks": { useJetztIso: () => MESSUNG },
    "@/lib/agent-modelle": modelle,
  });
  return ent(renderToStaticMarkup(React.createElement(K.AgentCard, { agent: a })));
}

test("TOR-F2 Agentenkarte: Modell des Dashboard-Aufrufs vorn, abweichendes Register sichtbar markiert (AMPLIFIER, MERCHANT, SCRIBE)", () => {
  for (const id of ["amplifier", "merchant", "scribe"]) {
    const html = karte(nach(id));
    assert.ok(html.includes(`>Dashboard: ${HAIKU}<`), `${id}: ${html.slice(-700)}`);
    assert.ok(html.includes(`>Register: ${SONNET} — weicht ab<`), id);
    assert.match(html, /style="color:var\(--gp-amber\)" data-modell="register"/);
  }
  // Register = Dashboard: keine zweite Zeile, kein "weicht ab".
  const counsel = karte(nach("counsel"));
  assert.ok(counsel.includes(`>Dashboard: ${HAIKU}<`));
  assert.ok(!counsel.includes("data-modell=\"register\"") && !counsel.includes("weicht ab"));
});

test("TOR-F2 Agentenkarte: SENTINEL ohne Prompt heißt 'kein Dashboard-Prompt', das Register steht als solches daneben", () => {
  const html = karte(nach("sentinel"));
  assert.ok(html.includes(">kein Dashboard-Prompt<"), html.slice(-700));
  assert.ok(html.includes(`>Register: ${HAIKU}<`));
  assert.match(html, /nicht aktivierbar/);
});

/** /agents mit den echten Agentenkarten (Register wie gemessen). */
function agentsSeite(agents) {
  const K = ladeTsx("components/agents/AgentCard.tsx", {
    ...ECHT,
    "next/link": { __esModule: true, default: Link },
    "@/lib/types": types,
    "@/lib/hooks": { useJetztIso: () => MESSUNG },
    "@/lib/agent-modelle": modelle,
  });
  const S = ladeTsx("app/agents/page.tsx", {
    ...ECHT,
    "@/lib/hooks": { useAgents: () => ({ agents, ausgeblendet: 1, loading: false, error: null }) },
    "@/lib/hooks-status": { useSystemStatus: () => ({ status: null, fehler: null, loading: false, geladenAm: null, httpStatus: null, neuLaden: async () => {} }) },
    "@/components/agents/AgentCard": { AgentCard: K.AgentCard },
    "@/lib/types": types,
  });
  return ent(renderToStaticMarkup(React.createElement(S.default)));
}

// Nachprüfung Mutation 07.11.2026 (M36): app/agents/page.tsx lud kein Test; die Unterzeile durfte
// wieder "Modell … direkt aus dem Agenten-Register" behaupten, während die Karten darunter das
// Dashboard-Modell zeigen.
test("TOR-F2 /agents (Mutation M36): Unterzeile nennt dieselbe Modellquelle wie die Karten — Dashboard-Konfiguration, nicht das Register", () => {
  const html = agentsSeite(AGENTEN);
  const unterzeile = /<p class="gp-sub">([^<]*)<\/p>/.exec(html)?.[1] ?? "";
  assert.ok(unterzeile.includes("Modell laut Dashboard-Konfiguration"), unterzeile);
  assert.doesNotMatch(unterzeile, /Modell(?:(?!Dashboard-Konfiguration).)*Agenten-Register/, unterzeile);
  // Die Karten darunter: 16 Einheiten, Modell aus der Dashboard-Konfiguration, Register nur markiert.
  assert.equal((html.match(/data-modell="dashboard"/g) ?? []).length, 16);
  assert.equal((html.match(new RegExp(`>Register: ${SONNET} — weicht ab<`, "g")) ?? []).length, 3, "AMPLIFIER, MERCHANT, SCRIBE");
  assert.ok(html.includes(">16 Einheiten · 4 Tiers<"), html.slice(0, 600));
});

test("TOR-F2 Konfiguration: lib/agent-modelle.ts ist die Quelle von lib/agent-prompts.ts (gleiche Schlüssel, gleiche Modelle)", async () => {
  const { AGENT_PROMPTS } = await import("../src/lib/agent-prompts.ts");
  assert.deepEqual(Object.keys(modelle.AGENT_MODELLE).sort(), Object.keys(AGENT_PROMPTS).sort());
  for (const [id, p] of Object.entries(AGENT_PROMPTS)) assert.equal(p.model, modelle.AGENT_MODELLE[id], id);
  // gezählt: 7 Sonnet, 8 Haiku; sentinel hat keinen Prompt
  const werte = Object.values(modelle.AGENT_MODELLE);
  assert.deepEqual([werte.filter((m) => m === SONNET).length, werte.filter((m) => m === HAIKU).length], [7, 8]);
  assert.equal(modelle.dashboardModellFuer("sentinel"), null);
  assert.equal(modelle.dashboardModellFuer("constructor"), null);
});

// ── Regel 5: keine System-Prompts im Browser ──
// Nachprüfung 07.11.2026 (Befunde sicherheit-1, sicherheit-2): Der Wächter las Importe per Regex
// und sah nur "import … from". Gemessen in einer Kopie blieben grün: import("@/lib/agent-prompts")
// in einer Client-Komponente, ein Seiteneffekt-Import, require(…), ein Kommentar vor "use client"
// und ein direkter Import des Regelpakets (lib/steinadel-regelpaket.ts, Teil des COUNSEL-Prompts).
// Jetzt liest der TypeScript-Parser die Importe; Prompt-Module sind agent-prompts.ts und alles, was
// es zur Laufzeit importiert, außer der Positivliste (lib/agent-modelle.ts: nur Agent → Modell).
// Harter Riegel daneben: lib/agent-prompts.ts importiert "server-only" (next build bricht ab).

const SRC = path.join(SITE, "src");
const PROMPTS = path.join(SRC, "lib/agent-prompts.ts");
/** Darf in den Browser: nur die Zuordnung Agent → Modell, ohne Import (eigener Test unten). */
const PROMPT_IMPORT_ERLAUBT = new Set([path.join(SRC, "lib/agent-modelle.ts")]);

/** Laufzeit-Importe einer Quelle laut TypeScript-Parser: import/export … from (ohne "type"),
 *  Seiteneffekt-Importe, import x = require(…), import(…) und require(…). Nicht literale
 *  Ziele von import()/require() stehen in unpruefbar. */
function laufzeitImporte(quelle, name) {
  const sf = ts.createSourceFile(name, quelle, ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ziele = [];
  const unpruefbar = [];
  const besuche = (k) => {
    if (ts.isImportDeclaration(k)) {
      if (!k.importClause?.isTypeOnly) ziele.push(k.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(k)) {
      if (k.moduleSpecifier && !k.isTypeOnly) ziele.push(k.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(k)) {
      if (!k.isTypeOnly && ts.isExternalModuleReference(k.moduleReference)) ziele.push(k.moduleReference.expression.text);
    } else if (ts.isCallExpression(k) && (k.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(k.expression) && k.expression.text === "require"))) {
      const arg = k.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) ziele.push(arg.text);
      else unpruefbar.push(`${name}:${sf.getLineAndCharacterOfPosition(k.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(k, besuche);
  };
  besuche(sf);
  // "use client" zählt nur im Direktiven-Prolog; Kommentare davor sind keine Anweisungen.
  let client = false;
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break;
    if (s.expression.text === "use client") client = true;
  }
  return { ziele, unpruefbar, client };
}

function srcDateien() {
  const alle = [];
  const lauf = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) lauf(p);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(n)) alle.push(p);
    }
  };
  lauf(SRC);
  return alle;
}

// Nachprüfung Mutation 07.11.2026 (M42): import … from "@/lib/agent-prompts.js" (Endung .js) fiel
// still aus dem Graphen — aufloesen kannte die Endungs-Ersetzung nicht; tsc --noEmit und eslint
// ließen den Import durch (gemessen in einer Kopie). Jetzt löst der Wächter zuerst wie tsc auf
// (tsconfig.json: paths "@/*", moduleResolution bundler, .js → .ts), danach über die Kandidaten
// unten; ein lokaler Import, den keiner von beiden auflöst, ist im Client-Graph ein Fehler.
// Nur die Compiler-Optionen werden gelesen (readDirectory leer: keine Dateisuche).
const TS_OPTIONEN = ts.parseJsonConfigFileContent(
  ts.readConfigFile(path.join(SITE, "tsconfig.json"), ts.sys.readFile).config,
  { ...ts.sys, readDirectory: () => [] },
  SITE,
  undefined,
  path.join(SITE, "tsconfig.json"),
).options;
const TS_AUFLOESUNG = ts.createModuleResolutionCache(SITE, (x) => x, TS_OPTIONEN);

/** Lokal = Datei im Projekt (Alias "@/…" oder relativ), kein Paket. */
const istLokalerImport = (spez) => spez.startsWith("@/") || spez === "." || spez === ".." || spez.startsWith("./") || spez.startsWith("../");

function aufloesen(von, spez) {
  const wieTsc = ts.resolveModuleName(spez, von, TS_OPTIONEN, ts.sys, TS_AUFLOESUNG).resolvedModule;
  if (wieTsc && !wieTsc.isExternalLibraryImport) return path.resolve(wieTsc.resolvedFileName);
  const basis = spez.startsWith("@/") ? path.join(SRC, spez.slice(2)) : spez.startsWith(".") ? path.resolve(path.dirname(von), spez) : null;
  if (basis === null) return null;
  // Endungs-Ersetzung wie TypeScript und Bundler: "./x.js" darf "./x.ts" meinen.
  const ohneJs = basis.replace(/\.(?:[cm]?js|jsx)$/, "");
  const kandidaten = [
    basis,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((e) => basis + e),
    ...(ohneJs === basis ? [] : [".ts", ".tsx", ".mts", ".cts"].map((e) => ohneJs + e)),
    ...["index.ts", "index.tsx"].map((i) => path.join(basis, i)),
  ];
  for (const k of kandidaten) {
    if (existsSync(k) && statSync(k).isFile()) return k;
  }
  return null;
}

/** Laufzeit-Importe einer Quelle, die unter dem Pfad von liegt: Ziele, Dateien und offene lokale Importe. */
function importeAus(quelle, name, von) {
  const i = laufzeitImporte(quelle, name);
  const aufgeloest = i.ziele.map((z) => [z, aufloesen(von, z)]);
  return {
    ...i,
    dateien: aufgeloest.map(([, d]) => d).filter(Boolean),
    // Lokale Importe ohne Datei: weder tsc noch die Kandidaten finden sie — der Wächter sähe nicht, wohin sie führen.
    offen: aufgeloest.filter(([z, d]) => d === null && istLokalerImport(z)).map(([z]) => z),
  };
}

const importCache = new Map();
function importeVon(datei) {
  if (!importCache.has(datei)) importCache.set(datei, importeAus(readFileSync(datei, "utf8"), path.relative(SITE, datei), datei));
  return importCache.get(datei);
}

/** Alle src-Dateien, die von start aus zur Laufzeit erreichbar sind (start eingeschlossen). */
function erreichbar(start, ohne = new Set()) {
  const gesehen = new Set([start]);
  const offen = [start];
  while (offen.length) {
    for (const ziel of importeVon(offen.pop()).dateien) {
      if (gesehen.has(ziel) || ohne.has(ziel)) continue;
      gesehen.add(ziel);
      offen.push(ziel);
    }
  }
  return gesehen;
}

test("TOR-F2 Regel 5 (Wächter): Parser erkennt jede Importform und 'use client' hinter Kommentaren", () => {
  const probe = [
    "// Kommentar vor der Direktive",
    "/* Block */ \"use client\";",
    'import a from "./a";',
    'import type { B } from "./b";',
    'import "./c";',
    'export * from "./d";',
    'export type { E } from "./e";',
    'import { type F, g } from "./fg";',
    "const h = await import(\"./h\");",
    "const i = require(\"./i\");",
    'import j = require("./j");',
    "const k = import(`./k`);",
    "const l = import(variable);",
    "// import x from \"./kommentar\"",
    'const s = "import y from \\"./text\\"";',
  ].join("\n");
  const r = laufzeitImporte(probe, "probe.tsx");
  assert.equal(r.client, true, "Direktive nach Kommentaren erkannt");
  assert.deepEqual(r.ziele, ["./a", "./c", "./d", "./fg", "./h", "./i", "./j", "./k"]);
  assert.deepEqual(r.unpruefbar, ["probe.tsx:13"]);
  assert.equal(laufzeitImporte('const x = 1;\n"use client";', "spaet.ts").client, false, "Direktive nur im Prolog");
});

test("TOR-F2 Regel 5: lib/agent-modelle.ts importiert nichts; keine Client-Datei erreicht ein Prompt-Modul; agent-prompts.ts trägt den Riegel 'server-only'", () => {
  const modellQuelle = readFileSync(path.join(SRC, "lib/agent-modelle.ts"), "utf8");
  assert.deepEqual(laufzeitImporte(modellQuelle, "agent-modelle.ts").ziele, [], "agent-modelle.ts ohne Import");
  assert.doesNotMatch(modellQuelle, /systemPrompt|COMPANY_CONTEXT/);
  // Riegel: Seiteneffekt-Import "server-only" in agent-prompts.ts (next build bricht im Client-Graph ab).
  const promptSf = ts.createSourceFile("agent-prompts.ts", readFileSync(PROMPTS, "utf8"), ts.ScriptTarget.Latest, true);
  assert.ok(
    promptSf.statements.some((s) => ts.isImportDeclaration(s) && !s.importClause && s.moduleSpecifier.text === "server-only"),
    "lib/agent-prompts.ts ohne import \"server-only\"",
  );
  // Prompt-Module: agent-prompts.ts und seine Laufzeit-Importe außer der Positivliste.
  const promptModule = erreichbar(PROMPTS, PROMPT_IMPORT_ERLAUBT);
  assert.ok(promptModule.has(path.join(SRC, "lib/steinadel-regelpaket.ts")), "Regelpaket (Teil des COUNSEL-Prompts) zählt als Prompt-Modul");
  const client = srcDateien().filter((d) => importeVon(d).client);
  assert.ok(client.length > 10, `Client-Dateien gefunden: ${client.length}`);
  assert.ok(client.includes(path.join(SRC, "components/agents/AgentCard.tsx")));
  for (const start of client) {
    const graph = erreichbar(start);
    for (const d of graph) {
      assert.ok(!promptModule.has(d), `${path.relative(SITE, start)} erreicht ${path.relative(SITE, d)} (Prompt-Modul)`);
      assert.deepEqual(importeVon(d).unpruefbar, [], `${path.relative(SITE, start)}: nicht prüfbarer Import im Client-Graph`);
      assert.deepEqual(importeVon(d).offen, [], `${path.relative(SITE, start)}: lokaler Import in ${path.relative(SITE, d)} nicht auflösbar`);
    }
  }
  // Gegenprobe: Die Karte erreicht die Modell-Zuordnung (der Graph folgt Importen wirklich).
  assert.ok(erreichbar(path.join(SRC, "components/agents/AgentCard.tsx")).has(path.join(SRC, "lib/agent-modelle.ts")));
});

test("TOR-F2 Regel 5 (Wächter, Mutation M42): Auflösung wie tsc — Endung .js trifft die .ts-Datei; ein lokaler Import ohne Datei ist offen", () => {
  const sidebar = path.join(SRC, "components/layout/Sidebar.tsx");
  for (const spez of ["@/lib/agent-prompts", "@/lib/agent-prompts.js", "../../lib/agent-prompts.js", "../../lib/agent-prompts"]) {
    assert.equal(aufloesen(sidebar, spez), PROMPTS, spez);
  }
  assert.equal(aufloesen(sidebar, "./Sidebar.jsx"), sidebar);
  assert.equal(aufloesen(sidebar, "@/lib/gibt-es-nicht"), null);
  assert.equal(aufloesen(sidebar, "react"), null, "Pakete gehören nicht zum Graphen");
  // Am Graphen: Eine Client-Datei neben der Sidebar mit genau dem Import des Mutanten erreicht ein
  // Prompt-Modul; ein lokaler Import ohne Datei steht in offen (im Client-Graph ein Fehler).
  const probe = importeAus(
    '"use client";\nimport { AGENT_PROMPTS } from "@/lib/agent-prompts.js";\nimport "@/lib/gibt-es-nicht";\nimport Link from "next/link";',
    "probe.tsx",
    path.join(SRC, "components/layout/Probe.tsx"),
  );
  assert.equal(probe.client, true);
  const promptModule = erreichbar(PROMPTS, PROMPT_IMPORT_ERLAUBT);
  assert.ok(
    probe.dateien.some((d) => [...erreichbar(d)].some((x) => promptModule.has(x))),
    `Probe erreicht kein Prompt-Modul: ${probe.dateien.map((d) => path.relative(SITE, d)).join(", ")}`,
  );
  assert.deepEqual(probe.offen, ["@/lib/gibt-es-nicht"]);
});

function metricsSeite(agents) {
  const lz = baumLaufzeit();
  const M = ladeTsx("app/metrics/page.tsx", {
    ...lz.attrappen,
    "@/lib/hooks-metrics": { useMetrics: () => ({ metrics: [], loading: false, error: null, aggregated: {}, abgeschnitten: false, grenze: 200 }) },
    "@/lib/hooks": { useAgents: () => ({ agents, ausgeblendet: 1, loading: false, error: null }), useJetztIso: () => MESSUNG },
    "@/lib/hooks-status": {
      ...hooksStatus,
      useSystemStatus: () => ({ status: null, fehler: null, loading: false, geladenAm: null, httpStatus: null, neuLaden: async () => {} }),
    },
    "@/components/ui/KPICard": {
      KPICard: ({ label, value, subtitle }) => lz.attrappen["react/jsx-runtime"].jsx("div", { "data-kpi": label, children: `${label}: ${value} · ${subtitle ?? ""}` }),
    },
    "@/components/ui/AttributionPanel": { AttributionPanel: () => null },
    "@/lib/kosten": kosten,
    "@/lib/agent-modelle": modelle,
    "@/lib/types": types,
  });
  return lz.rendere(M.default, {}, []);
}

test("TOR-F2 /metrics: Klassen nach Dashboard-Modell (Sonnet 7 · Haiku 8 · ohne Prompt 1), Register-Abweichung genannt", () => {
  const baum = metricsSeite(AGENTEN);
  const kpi = text(finde(baum, (k) => k.props?.["data-kpi"] === "Agenten (Register, gelesen)")[0]);
  assert.equal(kpi, "Agenten (Register, gelesen): 16 · Dashboard-Modell: Sonnet 7 · Haiku 8 · ohne Prompt 1 · Register weicht bei 3 ab");
  const t = text(baum);
  assert.ok(t.includes("Modelle laut Dashboard-Konfiguration"));
  assert.ok(!t.includes("Modelle laut Register"));
  assert.ok(t.includes(`Register (agents.llm_model) weicht bei 3 Agenten ab: AMPLIFIER (Register ${SONNET}, Dashboard ${HAIKU}), MERCHANT (Register ${SONNET}, Dashboard ${HAIKU}), SCRIBE (Register ${SONNET}, Dashboard ${HAIKU})`), t);
  assert.ok(t.includes(`kein Dashboard-Prompt: 1 Agent`) && t.includes(`SENTINEL (Register: ${HAIKU})`));
  // Nachprüfung ehrlichkeit-1: Der Satz nennt seinen Umfang. Der Python-Pfad (execution/agent_runner.py)
  // ruft AMPLIFIER, MERCHANT, SCRIBE und COUNSEL mit claude-sonnet-5 auf.
  const satz = text(finde(baum, (k) => k.props?.["data-modell"] === "abweichung")[0]).replace(/\s+/g, " ");
  assert.ok(satz.endsWith("— Seed, Python-Pfad oder älterer Lauf; Aufrufe über das Dashboard nutzen das Dashboard-Modell."), satz);
  assert.ok(!t.includes("aufgerufen wird das Dashboard-Modell"));
});

test("TOR-F2 /metrics: Tabelle zeigt je Agent Dashboard-Modell und dessen Preisbasis, das Register daneben", () => {
  const baum = metricsSeite(AGENTEN);
  const zeilen = finde(baum, (k) => k.type === "tr").map((tr) => finde(tr, (k) => k.type === "td").map(text));
  const zeile = (name) => zeilen.find((z) => z[0] === name);
  assert.deepEqual(zeile("AMPLIFIER").slice(2, 5), [`Haiku${HAIKU}`, "Input $1,00 · Output $5,00 je Mio. Tokens", `${SONNET} — weicht ab`]);
  assert.deepEqual(zeile("PUBLISHER").slice(2, 5), [`Sonnet${SONNET}`, "Input $2,00 · Output $10,00 je Mio. Tokens", SONNET]);
  assert.deepEqual(zeile("SENTINEL").slice(2, 5), ["ohne Promptkein Dashboard-Prompt", "kein Dashboard-Aufruf", HAIKU]);
});

// ═══ TOR-F3/F4/F7 Agent-Detail ═══

function detail(id, detailDaten, modellAttrappe = modelle) {
  return ent(
    renderToStaticMarkup(
      React.createElement(
        ladeTsx("app/agents/[id]/page.tsx", {
          ...ECHT,
          "next/navigation": { useParams: () => ({ id }) },
          "next/link": { __esModule: true, default: Link },
          "@/lib/hooks": {
            DETAIL_NACHRICHTEN_GRENZE: 20,
            anzeigeFehler: (t) => String(t),
            istGueltigeAgentId: (x) => typeof x === "string" && /^[a-z0-9_-]+$/.test(x),
            useAgentDetail: () => ({ loading: false, neuLaden: () => {}, agentFehler: null, messagesFehler: null, messages: [], ...detailDaten }),
            useJetztIso: () => MESSUNG,
          },
          "@/lib/freigabe-regeln": regeln,
          "@/lib/kosten": kosten,
          "@/lib/agent-modelle": modellAttrappe,
          "@/lib/types": types,
        }).default,
      ),
    ),
  );
}

/** Wert der Zeile "Kosten (geschätzt)", das Etikett darunter und der title des Blocks. */
function kostenZeile(html) {
  const m = /<span class="text-xs text-text-secondary">Kosten \(geschätzt\)<\/span><span[^>]*>([^<]*)<\/span>/.exec(html);
  const e = /<p class="[^"]*" data-kosten-etikett="[^"]*">([^<]*)<\/p>/.exec(html);
  return { wert: m?.[1] ?? null, etikett: e?.[1] ?? null };
}
function kostenTitel(html) {
  return /<div title="([^"]*)"><div class="flex items-center justify-between"><span class="text-xs text-text-secondary">Kosten \(geschätzt\)/.exec(html)?.[1] ?? null;
}

// Token- und Kostensummen in agents, gemessen per SELECT am 07.11.2026.
const VERBRAUCH = {
  publisher: { total_input_tokens: 26247, total_output_tokens: 24356, total_cost_usd: 0.4441 },
  researcher: { total_input_tokens: 36321, total_output_tokens: 37741, total_cost_usd: 0.6751 },
  counsel: { total_input_tokens: 82462, total_output_tokens: 13444, total_cost_usd: 0.1218 },
  scribe: { total_input_tokens: 47571, total_output_tokens: 17172, total_cost_usd: 0.1068 },
};
// Läufe (source activation-api) je Agent, neueste zuerst, [Input, Output] — gemessen per SELECT am
// 07.11.2026. Ihre Summen sind die Spalten oben; publisher und researcher liefen auf Sonnet,
// counsel und scribe auf Haiku (metadata.model), alle unter den neuesten 20 Nachrichten.
const LAEUFE = {
  publisher: [[6428, 3226], [5931, 2325], [4824, 4884], [3230, 7921], [5834, 6000]],
  researcher: [[4175, 3451], [3957, 4908], [3788, 4173], [3782, 4094], [2996, 3787], [2990, 3001], [2996, 4244], [2990, 2811], [2990, 3244], [2990, 3321], [2667, 707]],
  counsel: [[5202, 914], [8352, 1171], [7944, 855], [7816, 911], [8196, 861], [6984, 929], [7584, 1109], [6408, 841], [6780, 1078], [5805, 712], [6028, 2048], [5363, 2015]],
  scribe: [[5166, 1920], [4932, 1672], [4956, 1672], [5110, 2048], [4276, 1388], [3681, 1987], [3901, 1577], [3629, 1949], [3650, 974], [4151, 1262], [2633, 590], [1486, 133]],
};
const LAUF_MODELL = { publisher: SONNET, researcher: SONNET, counsel: HAIKU, scribe: HAIKU };
/** Bus-Zeilen der Läufe, wie api/agents/activate sie schreibt. */
const laufNachrichten = (id, laeufe = LAEUFE[id], modell = LAUF_MODELL[id]) =>
  laeufe.map(([ein, aus], i) => ({
    id: `${id}-${i}`,
    from_agent: id,
    to_agents: ["donna"],
    to_channels: [],
    message_type: "response",
    content: { text: `Lauf ${i}` },
    metadata: { source: "activation-api", model: modell, input_tokens: ein, output_tokens: aus },
    created_at: new Date(Date.parse("2026-07-29T22:00:00.000Z") - i * 60_000).toISOString(),
  }));

test("TOR-F3 /agents/[id]: Kosten aus Tokens × aktueller Tabelle — publisher ≥ $0,2960, researcher ≥ $0,4500 (nicht ≥ $0,4441 / ≥ $0,6751)", () => {
  // 26.247 × 2 + 24.356 × 10 = 296.054 → 0,296054 USD; 36.321 × 2 + 37.741 × 10 = 450.052 → 0,450052 USD
  const pubHtml = detail("publisher", { agent: agent(REGISTER[6], VERBRAUCH.publisher), messages: laufNachrichten("publisher") });
  assert.deepEqual(kostenZeile(pubHtml), { wert: "≥ $0,2960", etikett: `Tokens × aktuelle Preistabelle (${SONNET})` });
  assert.match(kostenTitel(pubHtml), /Modell je Lauf geprüft: 5 Läufe \(source activation-api\) in den neuesten 20 Nachrichten, alle auf claude-sonnet-5/);
  const res = kostenZeile(detail("researcher", { agent: agent(REGISTER[10], VERBRAUCH.researcher), messages: laufNachrichten("researcher") }));
  assert.deepEqual(res, { wert: "≥ $0,4500", etikett: `Tokens × aktuelle Preistabelle (${SONNET})` });
});

test("TOR-F3 /agents/[id]: Haiku-Agenten nach Dashboard-Modell (counsel ≥ $0,1496, scribe ≥ $0,1334 — scribe trotz Register Sonnet)", () => {
  // 82.462 × 1 + 13.444 × 5 = 149.682; 47.571 × 1 + 17.172 × 5 = 133.431 (je 1e-6 USD)
  assert.deepEqual(kostenZeile(detail("counsel", { agent: agent(REGISTER[7], VERBRAUCH.counsel), messages: laufNachrichten("counsel") })), {
    wert: "≥ $0,1496",
    etikett: `Tokens × aktuelle Preistabelle (${HAIKU})`,
  });
  assert.deepEqual(kostenZeile(detail("scribe", { agent: agent(REGISTER[11], VERBRAUCH.scribe), messages: laufNachrichten("scribe") })), {
    wert: "≥ $0,1334",
    etikett: `Tokens × aktuelle Preistabelle (${HAIKU})`,
  });
});

// Nachprüfung 07.11.2026 (ehrlichkeit-2): "≥" nur mit geprüftem Modell je Lauf. Angenommen wird ein
// späterer Wechsel des Dashboard-Modells von scribe auf Sonnet (nur in diesem Test); die Läufe
// bleiben, wie gemessen, auf Haiku. Vorher: "≥ $0,2668" mit Sonnet im Etikett.
const SCRIBE_AUF_SONNET = { ...modelle, dashboardModellFuer: (id) => (id === "scribe" ? SONNET : modelle.dashboardModellFuer(id)) };

test("TOR-F3 /agents/[id] (Nachprüfung ehrlichkeit-2): Läufe auf anderem Modell — je Lauf gerechnet, nie Dashboard-Preis × alle Tokens", () => {
  const html = detail("scribe", { agent: agent(REGISTER[11], VERBRAUCH.scribe), messages: laufNachrichten("scribe") }, SCRIBE_AUF_SONNET);
  // 12 Läufe auf Haiku, Summen = agents: 47.571 × 1 + 17.172 × 5 = 133.431 (je 1e-6 USD)
  assert.deepEqual(kostenZeile(html), { wert: "≥ $0,1334", etikett: "Tokens je Lauf × aktuelle Preistabelle (Modell je Lauf)" });
  assert.ok(!html.includes("≥ $0,2668"));
  const titel = kostenTitel(html);
  assert.ok(titel.includes(`  ${HAIKU}: 12 Läufe, 47.571 ein / 17.172 aus × Input $1,00 · Output $5,00 je Mio. Tokens`), titel);
  assert.ok(titel.includes(`Dashboard-Modell heute: ${SONNET} — nicht jeder Lauf lief darauf.`), titel);
  // Läufe anderer Agenten, Fehlläufe und Planungen zählen nicht: Sie schreiben die Summen nicht fort.
  const fremd = [
    { ...laufNachrichten("counsel")[0], id: "fremd" },
    { ...laufNachrichten("publisher")[0], id: "fehl", from_agent: "publisher", metadata: { source: "fehllauf", art: "aktivierung", model: HAIKU, input_tokens: 10, output_tokens: 10 } },
  ];
  const pub = detail("publisher", { agent: agent(REGISTER[6], VERBRAUCH.publisher), messages: [...fremd, ...laufNachrichten("publisher")] });
  assert.deepEqual(kostenZeile(pub), { wert: "≥ $0,2960", etikett: `Tokens × aktuelle Preistabelle (${SONNET})` });
});

test("TOR-F3 /agents/[id] (Nachprüfung ehrlichkeit-2): nicht jeder Lauf geladen oder lesbar — '≈' mit Begründung, kein '≥'", () => {
  // Nur die neuesten 8 der 12 scribe-Läufe geladen (Haiku: 35.651 ein / 14.213 aus), Rest der Summen
  // (11.920 ein / 2.959 aus) mit dem Dashboard-Modell Sonnet: 35.651 + 71.065 + 23.840 + 29.590 = 160.146 → 0,160146 USD
  const teil = detail("scribe", { agent: agent(REGISTER[11], VERBRAUCH.scribe), messages: laufNachrichten("scribe").slice(0, 8) }, SCRIBE_AUF_SONNET);
  assert.deepEqual(kostenZeile(teil), { wert: "≈ $0,1601", etikett: "Tokens × aktuelle Preistabelle · nicht jeder Lauf geprüft" });
  const titel = kostenTitel(teil);
  assert.ok(titel.startsWith("Geprüft: 8 Läufe (source activation-api) in den neuesten 20 Nachrichten mit 35.651 ein / 14.213 aus; für den Rest der Summen in agents (11.920 ein / 2.959 aus) ist kein Lauf geladen."), titel);
  assert.match(titel, /≈ statt ≥: Liefen diese Läufe auf einem günstigeren Modell, läge der Betrag darunter\./);
  // Keine Läufe geladen: Dashboard-Modell angenommen, "≈" (0,296054 kaufmännisch gerundet).
  assert.deepEqual(kostenZeile(detail("publisher", { agent: agent(REGISTER[6], VERBRAUCH.publisher), messages: [] })), {
    wert: "≈ $0,2961",
    etikett: "Tokens × aktuelle Preistabelle · nicht jeder Lauf geprüft",
  });
  // Nachrichten nicht lesbar: kein Lauf geprüft, auch wenn eine alte Liste da ist.
  const fehler = detail("publisher", { agent: agent(REGISTER[6], VERBRAUCH.publisher), messages: laufNachrichten("publisher"), messagesFehler: "HTTP 500" });
  assert.equal(kostenZeile(fehler).wert, "≈ $0,2961");
  assert.ok(kostenTitel(fehler).startsWith("Nachrichten nicht lesbar (HTTP 500): Modell je Lauf nicht geprüft."));
  // Mehr Tokens in den Läufen als in agents (Summen nicht fortgeschrieben): kein "≥".
  const mehr = detail("publisher", { agent: agent(REGISTER[6], { ...VERBRAUCH.publisher, total_input_tokens: 20000 }), messages: laufNachrichten("publisher") });
  assert.match(kostenZeile(mehr).wert, /^≈ /);
  assert.ok(kostenTitel(mehr).startsWith("Die geladenen Läufe (26.247 ein / 24.356 aus) passen nicht zu den Summen in agents (20.000 ein / 24.356 aus)."));
});

test("TOR-F3 /agents/[id] (Nachprüfung ehrlichkeit-2): Lauf-Modell ohne Tabellenpreis — kein Betrag aus Tokens", () => {
  const unbekannt = laufNachrichten("publisher").map((m) => ({ ...m, metadata: { ...m.metadata, model: "__proto__" } }));
  const html = detail("publisher", { agent: agent(REGISTER[6], VERBRAUCH.publisher), messages: unbekannt });
  assert.deepEqual(kostenZeile(html), { wert: "≈ $0,4441", etikett: "gespeicherte Summe, Preistabelle je Lauf" });
  assert.ok(kostenTitel(html).startsWith("Kein Tabellenpreis für __proto__ (Modell eines geladenen Laufs): nicht umrechenbar."));
  const ohneSumme = detail("publisher", { agent: agent(REGISTER[6], { ...VERBRAUCH.publisher, total_cost_usd: 0 }), messages: unbekannt });
  assert.deepEqual(kostenZeile(ohneSumme), { wert: "nicht schätzbar", etikett: "kein Tabellenpreis für __proto__" });
});

// Nachprüfung Mutation 07.11.2026 (M51): Der Fall "mehr Tokens in den Läufen als in agents" prüfte nur
// /^≈ /; ohne Math.max(0, …) zog der negative Rest Kosten ab (Sonde: "≈ $0,2836" statt "≈ $0,2961").
test("TOR-F3 /agents/[id] (Mutation M51): Läufe über den Summen in agents — der Rest zählt 0, nie negativ; nie unter den Kosten der Läufe", () => {
  // Läufe wie gemessen (publisher, Sonnet): 26.247 × 2 + 24.356 × 10 = 296.054 → 0,296054 USD.
  const laeufe = laufNachrichten("publisher");
  // Testannahme: Input-Summe in agents 20.000 (Rest −6.247), mit negativem Rest wären es 283.560 → "≈ $0,2836".
  const ein = detail("publisher", { agent: agent(REGISTER[6], { ...VERBRAUCH.publisher, total_input_tokens: 20000 }), messages: laeufe });
  assert.deepEqual(kostenZeile(ein), { wert: "≈ $0,2961", etikett: "Tokens × aktuelle Preistabelle · nicht jeder Lauf geprüft" });
  // Testannahme: Output-Summe in agents 20.000 (Rest −4.356), mit negativem Rest wären es 252.494 → "≈ $0,2525".
  const aus = detail("publisher", { agent: agent(REGISTER[6], { ...VERBRAUCH.publisher, total_output_tokens: 20000 }), messages: laeufe });
  assert.deepEqual(kostenZeile(aus), { wert: "≈ $0,2961", etikett: "Tokens × aktuelle Preistabelle · nicht jeder Lauf geprüft" });
  assert.ok(kostenTitel(aus).startsWith("Die geladenen Läufe (26.247 ein / 24.356 aus) passen nicht zu den Summen in agents (26.247 ein / 20.000 aus)."));
  // Der Betrag liegt nie unter den Kosten der geladenen Läufe selbst (0,296054 USD, auf 4 Stellen abgerundet 0,2960).
  const betrag = (w) => Number(w.replace(/^[≈≥] \$/, "").replace(",", "."));
  for (const html of [ein, aus]) assert.ok(betrag(kostenZeile(html).wert) >= 0.296, kostenZeile(html).wert);
});

test("TOR-F4 /agents/[id]: gespeicherte, je Lauf gerundete Summe ist keine Untergrenze — Rückfall nur mit '≈' und Etikett", () => {
  // Ohne Tokens (oder ohne Dashboard-Modell) bleibt nur total_cost_usd: numeric(10,4), je Lauf gerundet.
  const ohneTokens = kostenZeile(detail("counsel", { agent: agent(REGISTER[7], { total_cost_usd: 0.1218 }) }));
  assert.deepEqual(ohneTokens, { wert: "≈ $0,1218", etikett: "gespeicherte Summe, Preistabelle je Lauf" });
  const sentinel = kostenZeile(detail("sentinel", { agent: agent(REGISTER[15], { total_input_tokens: 1000, total_output_tokens: 100, total_cost_usd: 0.0012 }) }));
  assert.equal(sentinel.wert, "≈ $0,0012");
  // Das Etikett passt zur Zahl: nie "≥" aus der gespeicherten Summe.
  const html = detail("counsel", { agent: agent(REGISTER[7], VERBRAUCH.counsel), messages: laufNachrichten("counsel") });
  assert.ok(!html.includes("≥ $0,1218"));
  assert.match(html, /Gespeicherte Summe agents\.total_cost_usd: \$0,1218 — je Lauf mit der damals gültigen Preistabelle geschätzt/);
});

// Nachprüfung Mutation 07.11.2026 (M60): Kein Test las die Begründung des "≈" im title des Rückfalls.
test("TOR-F4 /agents/[id] (Mutation M60): jeder Rückfall auf die gespeicherte Summe begründet das '≈' im title", () => {
  const RUNDUNG = "≈ statt ≥: Die Rundung je Lauf kann die Summe um bis zu 0,00005 USD je Lauf über die Einzelschätzungen heben.";
  const faelle = {
    "Tokens fehlen": detail("counsel", { agent: agent(REGISTER[7], { total_cost_usd: 0.1218 }) }),
    "kein Dashboard-Modell": detail("sentinel", { agent: agent(REGISTER[15], { total_input_tokens: 1000, total_output_tokens: 100, total_cost_usd: 0.0012 }) }),
    "kein Tabellenpreis": detail("publisher", {
      agent: agent(REGISTER[6], VERBRAUCH.publisher),
      messages: laufNachrichten("publisher").map((m) => ({ ...m, metadata: { ...m.metadata, model: "__proto__" } })),
    }),
  };
  for (const [fall, html] of Object.entries(faelle)) {
    assert.deepEqual(kostenZeile(html).etikett, "gespeicherte Summe, Preistabelle je Lauf", fall);
    assert.match(kostenZeile(html).wert, /^≈ \$0,\d{4}$/, fall);
    const zeilen = kostenTitel(html).split("\n");
    assert.equal(zeilen.length, 3, `${fall}: ${zeilen.join(" ⏎ ")}`);
    assert.match(zeilen[1], /^Gespeicherte Summe agents\.total_cost_usd: \$0,\d{4} — /, fall);
    assert.equal(zeilen[2], RUNDUNG, fall);
  }
});

test("TOR-F7 /agents/donna: 'Modell letzter Lauf' zählt den Planungslauf (delegate-plan) mit Art und Quelle", () => {
  // gemessen: donna, message_type plan, source delegate-plan, claude-sonnet-5, 07.11.2026 11:23:51 UTC
  const plan = {
    id: "msg-plan",
    from_agent: "donna",
    to_agents: [],
    to_channels: [],
    message_type: "plan",
    content: { text: "Plan" },
    metadata: { source: "delegate-plan", model: SONNET, input_tokens: 1232, output_tokens: 645, cost_usd: 0.008914, preis_stand: "2026-11-06" },
    created_at: "2026-11-07T11:23:51.296Z",
  };
  const lauf = { ...plan, id: "msg-run", message_type: "plan_run", metadata: { source: "delegate-run" }, created_at: "2026-11-07T11:24:29.166Z" };
  const html = detail("donna", { agent: agent(REGISTER[1]), messages: [lauf, plan] });
  assert.ok(html.includes(`<p class="text-sm font-medium break-words">${SONNET} · Planung</p>`), html.slice(0, 2000));
  assert.match(html, /source delegate-plan/);
  assert.ok(!html.includes("nicht in den neuesten 20 Nachrichten"));
  // Nachprüfung K3: Die Liste auf /agents/donna besteht live überwiegend aus Antworten ANDERER Agenten
  // an donna; die jüngste ist die von counsel (gemessen: 11:24:39 UTC, activation-api, Haiku). Sie
  // ist kein Lauf von donna.
  const antwortCounsel = {
    id: "msg-counsel",
    from_agent: "counsel",
    to_agents: ["donna"],
    to_channels: [],
    message_type: "response",
    content: { text: "Antwort" },
    metadata: { source: "activation-api", model: HAIKU, input_tokens: 5202, output_tokens: 914 },
    created_at: "2026-11-07T11:24:39.821Z",
  };
  const live = detail("donna", { agent: agent(REGISTER[1]), messages: [antwortCounsel, lauf, plan] });
  assert.ok(live.includes(`<p class="text-sm font-medium break-words">${SONNET} · Planung</p>`), live.slice(0, 2000));
  assert.ok(!live.includes(`${HAIKU} · Aktivierung`));
  // Ohne Lauf: ehrlich "kein Lauf …"; Fehllauf mit Art.
  assert.ok(detail("donna", { agent: agent(REGISTER[1]), messages: [lauf] }).includes("kein Lauf in den neuesten 20 Nachrichten"));
  const fehl = { ...plan, id: "f", metadata: { source: "fehllauf", art: "planung", model: SONNET } };
  assert.ok(detail("donna", { agent: agent(REGISTER[1]), messages: [fehl] }).includes(`${SONNET} · Fehllauf der Planung`));
});

/** Block "Modell letzter Lauf" auf /agents/[id]: sichtbarer Wert und title. */
function letzterLaufBlock(html) {
  const m = /<div class="flex-1 min-w-\[140px\]" title="([^"]*)"><p class="[^"]*">Modell letzter Lauf<\/p><p class="text-sm font-medium break-words"[^>]*>([^<]*)<\/p>/.exec(html);
  return { wert: m?.[2] ?? null, title: m?.[1] ?? null };
}

// Nachprüfung Mutation 07.11.2026 (M80): Kein Test hatte eine Lauf-Zeile ohne metadata.model (live 0
// solcher Zeilen); ohne die Prüfung stand " · Planung" ohne Modell da.
test("TOR-F7 /agents/[id] (Mutation M80): jüngste Lauf-Nachricht ohne Modell zählt nicht — das Modell kommt vom letzten Lauf mit Modell", () => {
  // Testannahme: zwei jüngere Planungszeilen ohne bzw. mit leerem metadata.model, eine ältere mit Sonnet.
  const zeile = (id, created_at, metadata) => ({ id, from_agent: "donna", to_agents: [], to_channels: [], message_type: "plan", content: { text: "Plan" }, metadata, created_at });
  const leeresModell = zeile("p3", "2026-11-07T11:30:00.000Z", { source: "delegate-plan", model: "   " });
  const ohneModell = zeile("p2", "2026-11-07T11:23:51.296Z", { source: "delegate-plan" });
  const mitModell = zeile("p1", "2026-11-06T10:00:00.000Z", { source: "delegate-plan", model: SONNET });
  const l = letzterLaufBlock(detail("donna", { agent: agent(REGISTER[1]), messages: [leeresModell, ohneModell, mitModell] }));
  assert.equal(l.wert, `${SONNET} · Planung`);
  assert.match(l.title, /^Quelle: metadata\.model der jüngsten Lauf-Nachricht dieses Agenten \(source delegate-plan\), /);
  // Nur Zeilen ohne Modell: "kein Lauf …", kein Text ohne Modell.
  assert.equal(letzterLaufBlock(detail("donna", { agent: agent(REGISTER[1]), messages: [leeresModell, ohneModell] })).wert, "kein Lauf in den neuesten 20 Nachrichten");
});

// Nachprüfung Mutation 07.11.2026 (M90): Der Lesefehler-Test prüfte nur die Kosten; reichte die Seite
// den Fehler nicht an letzterLaufAnzeige, galt die alte Liste ("claude-opus-4-1 · Aktivierung" in der Sonde).
test("TOR-F7 /agents/[id] (Mutation M90): Nachrichten nicht lesbar — 'Modell letzter Lauf' heißt 'nicht lesbar', auch neben einer alten Liste", () => {
  const html = detail("publisher", { agent: agent(REGISTER[6], VERBRAUCH.publisher), messages: laufNachrichten("publisher"), messagesFehler: "HTTP 500" });
  assert.deepEqual(letzterLaufBlock(html), { wert: "nicht lesbar", title: "Nachrichten nicht lesbar: HTTP 500" });
  // Gegenprobe ohne Fehler: dieselbe Liste ergibt das Modell des jüngsten Laufs.
  const ok = letzterLaufBlock(detail("publisher", { agent: agent(REGISTER[6], VERBRAUCH.publisher), messages: laufNachrichten("publisher") }));
  assert.equal(ok.wert, `${SONNET} · Aktivierung`);
});

test("TOR-F2 /agents/[id]: Modell (Dashboard) neben dem Register, Abweichung markiert", () => {
  const html = detail("amplifier", { agent: agent(REGISTER[8]) });
  assert.ok(html.includes(`>Modell (Dashboard)</p><p class="text-sm font-medium break-words">${HAIKU}</p>`), html.slice(0, 2500));
  assert.ok(html.includes(`>Modell (Register)</p><p class="text-sm font-medium break-words" style="color:var(--gp-amber)">${SONNET} — weicht ab</p>`));
  const sentinel = detail("sentinel", { agent: agent(REGISTER[15]) });
  assert.ok(sentinel.includes(">kein Dashboard-Prompt</p>"));
});

// ═══ TOR-F5/F6 /messages ═══

/** /messages mit den gegebenen Nachrichten; zustaende = Vorgaben für useState (filter, agentFilter). */
function messagesSeite(messages, zustaende = []) {
  const lz = baumLaufzeit();
  const M = ladeTsx("app/messages/page.tsx", {
    ...lz.attrappen,
    "@/lib/hooks": {
      useMessages: () => ({ messages, loading: false, error: null, realtime: "SUBSCRIBED", realtimeFehler: null }),
      useAgents: () => ({ agents: [], ausgeblendet: 0, loading: false, error: null }),
    },
    "@/lib/hooks-status": {
      useSystemStatus: () => ({ status: { erzeugt_am: MESSUNG, bus: { wert: { anzahl: messages.length }, status: "ok", quelle: "q", gemessen_am: MESSUNG } }, fehler: null, loading: false, geladenAm: MESSUNG, httpStatus: 200, neuLaden: async () => {} }),
    },
    "@/components/ui/CommandPanel": { CommandPanel: () => null },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/kosten": kosten,
    "@/lib/types": types,
  });
  return lz.rendere(M.default, {}, zustaende);
}

/** Inhalte der gelisteten Nachrichten in Listenfolge. */
const listenInhalte = (baum) => finde(baum, (k) => k.type === "p" && /leading-relaxed break-words/.test(String(k.props.className ?? ""))).map(text);

/** Zähler-Knöpfe: Bezeichnung → Zahl. */
function zaehler(baum) {
  return Object.fromEntries(
    finde(baum, (k) => k.type === "button" && /card-ghost px-4/.test(String(k.props.className ?? ""))).map((k) => {
      const spans = finde(k, (s) => s.type === "span");
      return [text(spans[0]), Number(text(spans[1]))];
    }),
  );
}

// gemessen: 48 Nachrichten = 46 response (activation-api) + 1 plan (delegate-plan) + 1 plan_run (delegate-run)
const BUS = [
  ...Array.from({ length: 46 }, (_, i) => nachricht(`r${i}`, "2026-07-29T22:19:54.000Z", { metadata: { source: "activation-api", model: HAIKU, cost_usd: 0.0015 } })),
  nachricht("plan", "2026-11-07T11:23:51.296Z", { from_agent: "donna", to_agents: [], message_type: "plan", metadata: { source: "delegate-plan", model: SONNET, cost_usd: 0.008914, preis_stand: "2026-11-06" } }),
  nachricht("run", "2026-11-07T11:24:29.166Z", { from_agent: "donna", to_agents: [], message_type: "plan_run", metadata: { source: "delegate-run" } }),
];

test("TOR-F5 /messages: Zähler decken jede Nachricht genau einmal ab — 46 + 1 + 1 = 48", () => {
  const baum = messagesSeite(BUS);
  const z = zaehler(baum);
  assert.deepEqual(z, { Aufgabe: 0, Antwort: 46, Broadcast: 0, Alarm: 0, Plan: 1, Planlauf: 1 });
  assert.equal(Object.values(z).reduce((a, b) => a + b, 0), 48);
  const t = text(baum);
  assert.ok(t.includes("48 Nachrichten in den neuesten 100, im Browser gelesen"));
  assert.ok(t.includes("jede Nachricht in genau einem Zähler, Summe 48"), t.slice(0, 800));
});

test("TOR-F5 /messages: Fehllauf und unbekannter Typ haben eigene Zähler, die Summe bleibt die Liste", () => {
  const baum = messagesSeite([
    nachricht("a", MESSUNG),
    nachricht("f", MESSUNG, { metadata: { source: "fehllauf", art: "aktivierung", cost_usd: 0.01, preis_stand: "2026-11-06" } }),
    nachricht("p", MESSUNG, { message_type: "plan", metadata: { source: "fehllauf", art: "planung", cost_usd: 0.02, preis_stand: "2026-11-06" } }),
    nachricht("x", MESSUNG, { message_type: "heartbeat" }),
  ]);
  const z = zaehler(baum);
  assert.equal(z.Antwort, 1);
  assert.equal(z.Plan, 0, "ein Fehllauf der Planung ist kein Plan");
  assert.equal(z.Fehllauf, 2);
  assert.equal(z["Andere Typen"], 1);
  assert.equal(Object.values(z).reduce((a, b) => a + b, 0), 4);
  const andere = finde(baum, (k) => k.type === "button" && text(k).startsWith("Andere Typen"))[0];
  assert.match(String(andere.props.title), /Typen: heartbeat/);
  // Nachprüfung ehrlichkeit-3: Die Hinweiszeile sagt, wo die Fehlläufe zählen — der Fehllauf der
  // Planung (message_type plan) wäre ohne die Regel ein Plan, keine Antwort.
  const t = text(baum);
  assert.ok(t.includes("· 2 Fehlläufe (bezahlt, ohne verwertbare Antwort) im Zähler Fehllauf, nicht als Antwort oder Plan gezählt"), t.slice(0, 900));
  assert.ok(!t.includes("nicht als Antwort gezählt"));
});

// Nachprüfung Mutation 07.11.2026 (M65, M66): Kein Test enthielt Nachrichten ausgeblendeter Agenten
// (live 0 trader-Nachrichten); Zähler oder Summe über alle geladenen Nachrichten blieben grün.
test("TOR-F5 /messages (Mutation M65/M66): Nachrichten ausgeblendeter Agenten zählen weder im Zähler noch in der Summe", () => {
  // Testannahme: trader ist ausgeblendet (AUSGEBLENDETE_AGENTEN) — eine Nachricht von trader, eine nur an trader.
  const baum = messagesSeite([
    nachricht("n1", MESSUNG),
    nachricht("n2", MESSUNG),
    nachricht("t1", MESSUNG, { from_agent: "trader" }),
    nachricht("t2", MESSUNG, { to_agents: ["trader"] }),
  ]);
  const z = zaehler(baum);
  assert.deepEqual(z, { Aufgabe: 0, Antwort: 2, Broadcast: 0, Alarm: 0, Plan: 0, Planlauf: 0 });
  assert.deepEqual(listenInhalte(baum), ["Antwort n1", "Antwort n2"]);
  const t = text(baum);
  assert.ok(t.includes("jede Nachricht in genau einem Zähler, Summe 2"), t.slice(0, 900));
  assert.ok(t.includes("2 Nachrichten in den neuesten 100, im Browser gelesen"));
  assert.ok(t.includes("· 2 von ausgeblendeten Agenten nicht angezeigt"));
});

// Nachprüfung Mutation 07.11.2026 (M67): Alle Tests renderten nur den Filter "all"; ein Filter nach
// message_type statt nach Zähler blieb grün (Sonde: Fehllauf zeigte 0 statt 1 Nachricht).
test("TOR-F5 /messages (Mutation M67): ein Zähler als Filter zeigt genau die Nachrichten, die er zählt", () => {
  const liste = [
    nachricht("a", MESSUNG),
    nachricht("f", MESSUNG, { metadata: { source: "fehllauf", art: "aktivierung", cost_usd: 0.01, preis_stand: "2026-11-06" } }),
    nachricht("p", MESSUNG, { message_type: "plan", metadata: { source: "delegate-plan" } }),
    nachricht("pf", MESSUNG, { message_type: "plan", metadata: { source: "fehllauf", art: "planung", cost_usd: 0.02, preis_stand: "2026-11-06" } }),
    nachricht("x", MESSUNG, { message_type: "heartbeat" }),
  ];
  const erwartet = {
    response: ["Antwort", ["Antwort a"]],
    fehllauf: ["Fehllauf", ["Antwort f", "Antwort pf"]],
    plan: ["Plan", ["Antwort p"]],
    andere: ["Andere Typen", ["Antwort x"]],
  };
  for (const [filter, [label, inhalte]] of Object.entries(erwartet)) {
    const baum = messagesSeite(liste, [filter]);
    assert.deepEqual(listenInhalte(baum), inhalte, `Filter ${filter}`);
    assert.equal(zaehler(baum)[label], inhalte.length, `Zähler ${label}`);
    assert.ok(text(baum).includes(`${inhalte.length} von 5 Nachrichten (Filter) in den neuesten 100, im Browser gelesen`), `Filter ${filter}`);
  }
  // Ohne Filter: alle fünf, jede in genau einem Zähler.
  assert.equal(listenInhalte(messagesSeite(liste)).length, 5);
});

/** Metadaten-Chips (break-all) einer Seite. */
const chips = (baum) => finde(baum, (k) => k.type === "span" && /break-all/.test(String(k.props.className ?? ""))).map(text);

test("TOR-F6 /messages: cost_usd einheitlich ($0,0015 statt 0.0015056000000000002), alte Preistabelle sichtbar", () => {
  const baum = messagesSeite([
    // gemessen: guardian 29.07.2026, ohne preis_stand, cost_usd 0.0015056000000000002
    nachricht("alt", "2026-07-29T19:24:29.335Z", { from_agent: "guardian", metadata: { source: "activation-api", model: HAIKU, cost_usd: 0.0015056000000000002 } }),
    nachricht("neu", MESSUNG, { metadata: { source: "activation-api", model: HAIKU, cost_usd: 0.009797, preis_stand: "2026-11-06" } }),
    nachricht("py", MESSUNG, { metadata: { source: "base_agent", cost_usd: 0.01 } }),
  ]);
  const c = chips(baum);
  assert.ok(c.includes("cost_usd (geschätzt, alte Preistabelle vor 06.11.2026): $0,0015"), c.join(" | "));
  assert.ok(c.includes("cost_usd (geschätzt): $0,0098"), c.join(" | "));
  assert.ok(c.includes("cost_usd (geschätzt, Preistabelle unbekannt): $0,0100"), c.join(" | "));
  assert.ok(!c.some((x) => x.includes("0000000")), "kein Gleitkomma-Rest");
});

test("TOR-F6/F7 Quellen der Lauf-Kosten: LAUF_QUELLEN (Anzeige) = KOSTEN_QUELLEN (Server)", () => {
  assert.deepEqual(Object.keys(types.LAUF_QUELLEN).sort(), [...statusServer.KOSTEN_QUELLEN].sort());
  assert.equal(types.preisTabelleHinweis({ source: "activation-api", preis_stand: "2026-10-01" }, "2026-11-06"), "Preistabelle 01.10.2026, nicht die aktuelle");
  assert.equal(types.preisTabelleHinweis('{"source":"fehllauf"}', "2026-11-06"), "alte Preistabelle vor 06.11.2026");
});

test("TOR-F2 modellKern = basisModell (lib/kosten.ts) für die Abweichungs-Prüfung", () => {
  for (const m of [HAIKU, SONNET, " Claude-Haiku-4-5 ", "claude-opus-5-20260101", "", "x-12345678"]) {
    assert.equal(types.modellKern(m), kosten.basisModell(m), JSON.stringify(m));
  }
});
