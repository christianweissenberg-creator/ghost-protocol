// „Text erzeugen“: offener Lauf aus dem Tab-Speicher (components/studio/TextErzeugen.tsx, 11.11.2026). Lauf: npm test.
//
// Hält fest, was bis 11.11.2026 ein Effekt nach dem Einhängen tat und seitdem useSyncExternalStore plus Übernahme beim
// Rendern tut (Lint-Regel react-hooks/set-state-in-effect ab eslint-plugin-react-hooks 7.1.1):
// - M-TS1: Auf dem Server liest die Karte den Speicher nicht; das Server-HTML zeigt „Text erzeugen …“ ohne gemerkten Lauf.
// - M-TS2: Beim Hydrieren gleicht das erste Bild dem Server-HTML; danach nennt die Karte den gemerkten Lauf.
// - M-TS3: Beim Einhängen im Browser (so kommt die Karte auf die Studio-Seite, die ihre Daten erst im Browser lädt) liest
//   sie genau einmal; weitere Bilder und Klicks lesen nicht neu; Ab- und Wiederaufbau (Strict Mode) ändert nichts.
// - M-TS4: Was die Karte selbst in den Speicher schreibt (starten), holt sie nicht als gemerkten Lauf zurück.
// - M-TS5: Wechseln Schlüssel oder Speicher, liest sie für den neuen einmal; eine offene Lauf-ID der Karte bleibt
//   (jetzt ?? gemerkt), und genannt wird nur ein Lauf, dessen ID sie auch sendet.
// Ohne Netz und ohne bezahlte Aufrufe: holen und Speicher sind Attrappen, die Lauf-IDs Testwerte.
// Z_TSX_COMPONENTS_STUDIO_TEXTERZEUGEN=<pfad> prüft eine Kopie (Gegenprobe an der Fassung mit Effekt, Mutanten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Wie tests/s-anker.test.mjs: "@/…" → src/….ts, relative Importe ohne Endung aus .ts → ".ts".
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.join(SITE, "src", `${specifier.slice(2)}.ts`)).href, context);
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { React, jsxRuntime, renderToStaticMarkup, ladeTsx } = await import("./harness/tsx.mjs");
const { hookLaufzeit, ladeTextErzeugen, alsMarkup } = await import("./harness/studio.mjs");
const regeln = await import("../src/lib/freigabe-regeln.ts");
const counsel = await import("../src/lib/counsel-urteil.ts");

const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const hilfen = ladeTsx("components/studio/beleg-hilfen.ts", { "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln });
const SLUG = "rittergut-seifersdorf";
const VIDEO = { id: 3, sha256: "3".repeat(64) };
const VIDEO_4 = { id: 4, sha256: "4".repeat(64) };
const ID_A = "a1a1a1a1-0000-4000-8000-000000000001";
const ID_B = "b2b2b2b2-0000-4000-8000-000000000002";
const SEIT = "2026-11-11T09:00:00.000Z";

/** Schlüssel je Video, hier unabhängig von speicherSchluessel gebildet (M-C13 prüft dieselbe Form). */
const schluessel = (id) => `gp-text-erzeugen:${SLUG}:${id}`;

/** Eintrag eines Laufs ohne bekannten Ausgang, wie die Karte ihn schreibt. */
const offen = (laufId) => JSON.stringify({ laufId, art: "unbekannt", seit: SEIT });

/** Speicher wie sessionStorage (getItem, setItem, removeItem), der jedes Lesen mitschreibt. */
function zaehlSpeicher(eintraege = {}) {
  const m = new Map(Object.entries(eintraege));
  const gelesen = [];
  return {
    m,
    gelesen,
    getItem: (k) => {
      gelesen.push(k);
      return m.has(k) ? m.get(k) : null;
    },
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/** holen, das nur mitschreibt und nie etwas sendet: jeder Aufruf scheitert wie ohne Verbindung. */
function holenAttrappe() {
  const aufrufe = [];
  const holen = async (url, init) => {
    aufrufe.push({ url, koerper: JSON.parse(init.body) });
    throw new TypeError("Verbindung abgebrochen (Attrappe)");
  };
  return { holen, aufrufe };
}

const alle = (k, pred, aus = []) => {
  if (Array.isArray(k)) for (const c of k) alle(c, pred, aus);
  else if (k && typeof k === "object") {
    if (pred(k)) aus.push(k);
    alle(k.kinder, pred, aus);
  }
  return aus;
};
const text = (k) => (Array.isArray(k) ? k.map(text).join("") : k && typeof k === "object" ? text(k.kinder) : k === null || k === undefined || typeof k === "boolean" ? "" : String(k));
const element = (baum, attr) => alle(baum, (n) => n.props?.[attr] !== undefined)[0] ?? null;
const lauf = (id) => new RegExp(`Lauf-ID ${id.slice(0, 8)}…`);
const dieselbe = (id) => new RegExp(`Lauf-ID ${id.slice(0, 8)}… \\(dieselbe wie beim Versuch mit unbekanntem Ausgang\\)`);

/** Karte in der Hook-Laufzeit (Browser); hydrieren spielt das Hydrieren nach. el() rendert und sucht ein Element. */
function karte({ speicher, hydrieren = false, holen = holenAttrappe().holen } = {}) {
  const lz = hookLaufzeit({ hydrieren });
  const T = ladeTextErzeugen(lz.attrappen, { hilfen });
  const props = { slug: SLUG, medium: VIDEO, holen, fertig: () => {}, speicher };
  lz.setzeWurzel(T.TextErzeugen, props);
  return { lz, T, props, el: (attr) => element(lz.rendere(), attr) };
}

/** Server-HTML der Karte mit echtem React (renderToStaticMarkup). */
function serverHtml(speicher) {
  const T = ladeTextErzeugen(ECHT, { hilfen });
  return renderToStaticMarkup(React.createElement(T.TextErzeugen, { slug: SLUG, medium: VIDEO, holen: holenAttrappe().holen, fertig: () => {}, speicher }));
}

test("M-TS1 Server-HTML: Die Karte liest den Tab-Speicher nicht; „Text erzeugen …“ ohne gemerkten Lauf", () => {
  const speicher = zaehlSpeicher({ [schluessel(VIDEO.id)]: offen(ID_A) });
  const html = serverHtml(speicher);
  assert.deepEqual(speicher.gelesen, [], "kein Lesen auf dem Server");
  assert.match(html, /<button[^>]*data-text-erzeugen-knopf[^>]*>Text erzeugen …<\/button>/);
  assert.ok(!html.includes("data-text-erzeugen-gemerkt"), html);
  assert.ok(!html.includes(ID_A.slice(0, 8)), "die gemerkte Lauf-ID steht nicht im Server-HTML");
});

test("M-TS2 Hydrieren: Das erste Bild gleicht dem Server-HTML; danach nennt die Karte den gemerkten Lauf und „Erneut senden …“, gelesen genau einmal", () => {
  const server = serverHtml(zaehlSpeicher({ [schluessel(VIDEO.id)]: offen(ID_A) }));
  const speicher = zaehlSpeicher({ [schluessel(VIDEO.id)]: offen(ID_A) });
  const k = karte({ speicher, hydrieren: true });
  const baum = k.lz.rendere();
  const bilder = k.lz.bilder();
  assert.ok(bilder.length >= 2, "nach dem ersten Bild rendert die Karte neu");
  assert.equal(alsMarkup(bilder[0]), server, "erstes Bild = Server-HTML");
  assert.equal(element(baum, "data-text-erzeugen-gemerkt")?.props["data-text-erzeugen-gemerkt"], "unbekannt");
  assert.match(text(element(baum, "data-text-erzeugen-gemerkt")), lauf(ID_A));
  assert.equal(text(element(baum, "data-text-erzeugen-knopf")), "Erneut senden …");
  assert.deepEqual(speicher.gelesen, [schluessel(VIDEO.id)], "genau ein Lesen");
});

test("M-TS3 Einhängen im Browser (wie auf der Studio-Seite): gemerkter Lauf nach dem Einhängen, genau ein Lesen; weitere Bilder, „Erneut senden …“ (nur die Bestätigung) und Abbrechen lesen nicht neu; Ab- und Wiederaufbau (Strict Mode) ändert nichts", () => {
  const speicher = zaehlSpeicher({ [schluessel(VIDEO.id)]: offen(ID_A) });
  const h = holenAttrappe();
  const k = karte({ speicher, holen: h.holen });
  assert.equal(k.el("data-text-erzeugen-gemerkt")?.props["data-text-erzeugen-gemerkt"], "unbekannt");
  assert.match(text(k.el("data-text-erzeugen-gemerkt")), lauf(ID_A));
  assert.equal(text(k.el("data-text-erzeugen-knopf")), "Erneut senden …");
  k.el("data-text-erzeugen-knopf").props.onClick();
  assert.match(text(k.el("data-text-erzeugen-was")), dieselbe(ID_A));
  k.el("data-text-erzeugen-zurueck").props.onClick();
  assert.match(text(k.el("data-text-erzeugen-gemerkt")), lauf(ID_A), "nach Abbrechen wieder genannt");
  k.lz.rendere();
  assert.deepEqual(speicher.gelesen, [schluessel(VIDEO.id)], "genau ein Lesen");
  assert.equal(h.aufrufe.length, 0, "nichts gesendet");
  k.lz.abbauen();
  k.lz.wiederAufbauen();
  assert.equal(text(k.el("data-text-erzeugen-knopf")), "Erneut senden …");
  assert.match(text(k.el("data-text-erzeugen-gemerkt")), lauf(ID_A));
});

test("M-TS4 Eigenes Schreiben kommt nicht zurück: Nach einem Lauf mit unbekanntem Ausgang steht die ID im Speicher, die Karte nennt sie aber nicht als gemerkt, auch nach „Erneut senden …“ und Abbrechen nicht; gelesen nur beim Einhängen", async () => {
  const speicher = zaehlSpeicher();
  const h = holenAttrappe();
  const k = karte({ speicher, holen: h.holen });
  assert.equal(text(k.el("data-text-erzeugen-knopf")), "Text erzeugen …");
  k.el("data-text-erzeugen-knopf").props.onClick();
  k.el("data-text-erzeugen-start").props.onClick();
  await k.lz.ruhe(20);
  assert.equal(h.aufrufe.length, 1, "ein Versuch, gegen die Attrappe");
  assert.equal(k.el("data-text-erzeugen-ausgang")?.props["data-text-erzeugen-ausgang"], "unbekannt");
  const eintrag = JSON.parse(speicher.m.get(schluessel(VIDEO.id)));
  assert.deepEqual([eintrag.laufId, eintrag.art], [h.aufrufe[0].koerper.lauf_id, "unbekannt"]);
  k.el("data-text-erzeugen-knopf").props.onClick();
  assert.match(text(k.el("data-text-erzeugen-was")), dieselbe(eintrag.laufId));
  k.el("data-text-erzeugen-zurueck").props.onClick();
  assert.equal(k.el("data-text-erzeugen-gemerkt"), null, "nicht aus dem eigenen Schreiben übernommen");
  assert.equal(text(k.el("data-text-erzeugen-knopf")), "Erneut senden …", "die ID bleibt offen");
  assert.deepEqual(speicher.gelesen, [schluessel(VIDEO.id)], "gelesen nur beim Einhängen");
});

test("M-TS5 Schlüssel oder Speicher wechseln: Die Karte liest für den neuen einmal; eine offene Lauf-ID der Karte bleibt (jetzt ?? gemerkt), genannt wird nur ein Lauf, dessen ID sie auch sendet", () => {
  // a) Video 3 ohne Eintrag, dann Video 4 mit Eintrag B: übernommen wird B.
  const s1 = zaehlSpeicher({ [schluessel(4)]: offen(ID_B) });
  const k = karte({ speicher: s1 });
  assert.equal(text(k.el("data-text-erzeugen-knopf")), "Text erzeugen …");
  k.lz.setzeWurzel(k.T.TextErzeugen, { ...k.props, medium: VIDEO_4 });
  assert.match(text(k.el("data-text-erzeugen-gemerkt")), lauf(ID_B));
  assert.equal(text(k.el("data-text-erzeugen-knopf")), "Erneut senden …");
  assert.deepEqual(s1.gelesen, [schluessel(3), schluessel(4)]);
  // b) Anderer Speicher mit Eintrag A zu Video 4: einmal gelesen; die offene ID B bleibt und wird gesendet, A nicht genannt.
  const s2 = zaehlSpeicher({ [schluessel(4)]: offen(ID_A) });
  k.lz.setzeWurzel(k.T.TextErzeugen, { ...k.props, medium: VIDEO_4, speicher: s2 });
  assert.equal(k.el("data-text-erzeugen-gemerkt"), null);
  assert.equal(text(k.el("data-text-erzeugen-knopf")), "Erneut senden …");
  k.el("data-text-erzeugen-knopf").props.onClick();
  assert.match(text(k.el("data-text-erzeugen-was")), dieselbe(ID_B));
  assert.deepEqual(s2.gelesen, [schluessel(4)]);
  assert.deepEqual(s1.gelesen, [schluessel(3), schluessel(4)], "den alten Speicher liest sie nicht mehr");
});
