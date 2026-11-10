// Objekt-Studio Paket C, Schritt 9 (10.11.2026): Freigabe-Seite der Caption zu einem Video — die eine Funktion für
// Caption und Medium (pruefeVideoFreigabe in lib/freigabe-regeln.ts), die Pflichtzeile, die Beleg-Kette und das
// Medien-Badge im Freigabe-Stapel. Die Pipeline-Seite (medium_id, Pflichtzeile vor der Endprüfung) prüft
// tests/m-caption.test.mjs; Freigeben, Stapel und Studio-Karte gegeneinander tests/m-pruefung.test.mjs (MP-15 bis
// MP-17). Netzfrei. Lauf: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { React, jsxRuntime, ladeTsx, renderToStaticMarkup } from "./harness/tsx.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const regeln = await import("../src/lib/freigabe-regeln.ts");
const counsel = await import("../src/lib/counsel-urteil.ts");
const types = await import("../src/lib/types.ts");
const hooksStatus = await import("../src/lib/hooks-status.ts");
const { KI_PFLICHTZEILE_CAPTION } = await import("../src/lib/studio/ki-hinweis.ts");
const { ladeStudioBausteine } = await import("./harness/studio.mjs");

const ECHT = { react: React, "react/jsx-runtime": jsxRuntime };
const Link = ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children);
const ent = (html) => html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
const sichtbar = (html) => ent(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

const P = KI_PFLICHTZEILE_CAPTION;
const FREIGABE = counsel.werteCounselAus("Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG");
const TEXT = `Caption zum Video, lang genug für die Regel.\n\n${P}`;
const FREI = { freigebbar: true, gruende: [] };

test("MCF-1 Pflichtzeile: Wortlaut wie lib/studio/ki-hinweis.ts; nur als eigene Zeile und wörtlich; mitPflichtzeile hängt sie einmal an", () => {
  assert.equal(regeln.PFLICHTZEILE_VIDEO_CAPTION, KI_PFLICHTZEILE_CAPTION, "Kopie für den Browser gleich der Quelle");
  assert.equal(regeln.enthaeltPflichtzeile(TEXT, P), true);
  assert.equal(regeln.enthaeltPflichtzeile(`Text\r\n  ${P}  \r\n`, P), true, "Leerraum am Rand und CRLF zählen nicht");
  for (const falsch of [`Text: ${P}`, `Text\n${P}.`, `Text\n${P.replace("Bild-/Videomaterial", "Bildmaterial")}`, `Text\n${P.replace("–", "-").replace("KI-generierte", "KI generierte")}`, null, undefined, ""]) {
    assert.equal(regeln.enthaeltPflichtzeile(falsch, P), false, String(falsch));
  }
  assert.equal(regeln.mitPflichtzeile("Text  \n\n", P), `Text\n\n${P}`);
  assert.equal(regeln.mitPflichtzeile(TEXT, P), TEXT, "keine Verdopplung");
  assert.equal(regeln.mitPflichtzeile("", P), P);
});

test("MCF-2 pruefeVideoFreigabe: eine Funktion für Caption und Medium — Gründe in der Reihenfolge Caption, Pflichtzeile, Medien-Regel; der erste ist der Sperrgrund; ohne Medien-Urteil gesperrt", () => {
  const ok = regeln.pruefeVideoFreigabe(FREIGABE, TEXT, TEXT, FREI, P);
  assert.deepEqual([ok.freigebbar, ok.grund, ok.gruende, ok.urteil], [true, null, [], "FREIGABE"]);
  const medium = { freigebbar: false, gruende: ["Klausel „personen“ nicht bestanden", "Rechte laut Prüfprotokoll nicht geklärt"] };
  const nurMedium = regeln.pruefeVideoFreigabe(FREIGABE, TEXT, TEXT, medium, P);
  assert.deepEqual([nurMedium.freigebbar, nurMedium.grund, nurMedium.gruende], [false, medium.gruende[0], medium.gruende]);
  const ohne = "Caption zum Video, lang genug für die Regel, ohne Pflichtzeile.";
  const alle = regeln.pruefeVideoFreigabe(counsel.werteCounselAus("URTEIL: ABLEHNUNG"), ohne, ohne, medium, P);
  assert.equal(alle.gruende.length, 4);
  assert.match(alle.gruende[0], /^COUNSEL-Urteil ABLEHNUNG/);
  assert.equal(alle.gruende[1], regeln.pflichtzeileFehlt(P));
  assert.deepEqual(alle.gruende.slice(2), medium.gruende);
  assert.equal(alle.grund, alle.gruende[0]);
  const unbekannt = regeln.pruefeVideoFreigabe(FREIGABE, TEXT, TEXT, null, P);
  assert.deepEqual([unbekannt.freigebbar, unbekannt.grund], [false, "Urteil der Medien-Regel nicht ermittelt"]);
  // R2 gilt mit: anderer geprüfter Text sperrt zuerst.
  const r2 = regeln.pruefeVideoFreigabe(FREIGABE, TEXT, "anderer Text, den COUNSEL geprüft hat", FREI, P);
  assert.match(r2.grund, /\(R2\)$/);
  // Medien-Regel sperrt ohne Gründe: trotzdem gesperrt.
  assert.equal(regeln.pruefeVideoFreigabe(FREIGABE, TEXT, TEXT, { freigebbar: false, gruende: [] }, P).grund, "Medien-Regel sperrt");
});

function bausteine() {
  return ladeStudioBausteine({ ...ECHT, "@/lib/counsel-urteil": counsel, "@/lib/freigabe-regeln": regeln });
}

function eintrag(metadata) {
  return { id: 50, status: "zur_freigabe", body: TEXT, review_notes: "Befunde: keine.\nURTEIL: FREIGABE-EMPFEHLUNG", metadata: { steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: TEXT }], ...metadata } };
}

test("MCF-3 Beleg-Kette: Caption zu einem Video zeigt die Zeile „Video“ (Medium, nach der Freigabe Hash und Prüfprotokoll); die Prüfregel verlangt die Pflichtzeile; ohne Video keine Zeile", () => {
  const S = bausteine();
  const html = (item) => renderToStaticMarkup(React.createElement(S.kette.BelegKette, { item, kopiere: () => {}, kopierStatus: () => "Kopieren" }));
  const mit = sichtbar(html(eintrag({ medium_id: 3 })));
  assert.match(mit, /Video Medium #3/);
  assert.match(mit, /Die Medien-Regel prüft der Server beim Freigeben/);
  const frei = sichtbar(html(eintrag({ medium_id: 3, freigabe: { aktion: "freigeben", am: "2026-11-10T15:00:00Z", durch: "betreiber-session", medium_id: 3, medium_sha256: "a".repeat(64), pruefung_id: 7 } })));
  assert.match(frei, new RegExp(`Medium #3 · freigegeben mit SHA-256 ${"a".repeat(16)}… nach Prüfprotokoll #7`));
  assert.match(sichtbar(html(eintrag({ medium_id: "3" }))), /Medium der Zeile nicht lesbar \(metadata\.medium_id\)/);
  const ohneVideo = html(eintrag({}));
  assert.doesNotMatch(ohneVideo, /data-beleg-medium/);
  // Lage im Browser: Caption-Regel und Pflichtzeile; das Medien-Urteil fällt der Server.
  const lage = S.hilfen.freigabeLage(eintrag({ medium_id: 3, steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: "Caption zum Video, lang genug für die Regel." }] }));
  assert.equal(lage.medium.id, 3);
  const kurz = "Caption zum Video, lang genug für die Regel.";
  const lageOhne = S.hilfen.freigabeLage({ ...eintrag({ medium_id: 3, steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: kurz }] }), body: kurz });
  assert.equal(lageOhne.pruefung.freigebbar, false);
  assert.equal(lageOhne.pruefung.grund, regeln.pflichtzeileFehlt(P));
  assert.equal(S.hilfen.freigabeLage(eintrag({})).medium, undefined, "Zeilen ohne Video behalten die bisherige Lage");
});

test("MCF-4 Freigabe-Stapel: Medien-Badge mit Video, Fassung, Hash-Anfang und Urteil der Medien-Regel (Gründe im title); ohne medium kein Badge", () => {
  const basis = { title: "Caption", platform: "x", status: "zur_freigabe", created_at: "2026-11-10T14:00:00Z", updated_at: "2026-11-10T14:00:00Z", alter_stunden: 1, objekt_slug: "rittergut-seifersdorf", counsel: { urteil: "FREIGABE", zeile: "URTEIL: FREIGABE-EMPFEHLUNG", abgeleitet: true }, text_leer: false, text_zeichen: 120, geprueft_ungleich_freigabe: false };
  const freigaben = {
    erzeugt_am: "2026-11-10T15:00:00Z",
    wartend: [
      { ...basis, id: "50", freigabe_sperre: "Rechte laut Prüfprotokoll nicht geklärt", medium: { id: 3, art: "video", fassung: "export", sha256: "b".repeat(64), pruefung_id: 1, freigebbar: false, gruende: ["Rechte laut Prüfprotokoll nicht geklärt"] } },
      { ...basis, id: "51", freigabe_sperre: null, medium: { id: 4, art: "video", fassung: "export", sha256: "c".repeat(64), pruefung_id: 2, freigebbar: true, gruende: [] } },
      { ...basis, id: "52", freigabe_sperre: null, medium: null },
    ],
    wartend_gesamt: 3,
    haengend: [],
    haengend_gesamt: 0,
    quelle: "Test",
    fehler: null,
  };
  const Panels = ladeTsx("components/ui/CommandPanels.tsx", {
    ...ECHT,
    "next/link": { __esModule: true, default: Link },
    "@/lib/hooks": { useObjekte: () => ({ objekte: [], loading: false, error: null }) },
    "@/lib/freigabe-regeln": regeln,
    "@/lib/hooks-status": { ...hooksStatus, useFreigaben: () => ({ freigaben, fehler: null, loading: false, geladenAm: "2026-11-10T15:00:00Z", httpStatus: 200, neuLaden: async () => {} }) },
    "@/lib/types": types,
  });
  const html = ent(renderToStaticMarkup(React.createElement(Panels.FreigabePanel)));
  assert.match(html, new RegExp(`title="Medien-Regel: Rechte laut Prüfprotokoll nicht geklärt"[^>]*>Video #3 · export · ${"b".repeat(8)}… · Medien-Regel sperrt<`));
  assert.match(html, new RegExp(`>Video #4 · export · ${"c".repeat(8)}… · Medien-Regel erfüllt<`));
  assert.equal((html.match(/Medien-Regel (sperrt|erfüllt)</g) ?? []).length, 2, "kein Badge ohne medium");
});
