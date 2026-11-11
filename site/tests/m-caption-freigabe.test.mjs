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

test("MCF-5 pflichtzeileEinsetzen beim X-Thread (Schlussprüfung d3-caption-auftrag-1): die fehlende Zeile kommt in den ersten Post, an dem das Video hängt — als dessen letzte Zeile vor der Marke „2/…“; ohne Marken „1/…“ und „2/…“ ans Ende; vorhanden und nahe Variante wie bisher; ohne ort wie bisher am Ende", () => {
  const ein = (text, ort) => regeln.pflichtzeileEinsetzen(text, P, ort);
  // Thread mit Leerzeilen zwischen den Posts: hinter die letzte nicht leere Zeile von 1/3, nach einer Leerzeile.
  assert.deepEqual(ein("1/3 Das Video zeigt den Hof.\n#Denkmal\n\n2/3 Zweiter Post.\n\n3/3 Mehr: https://example.test/x", "erster_post"), {
    text: `1/3 Das Video zeigt den Hof.\n#Denkmal\n\n${P}\n\n2/3 Zweiter Post.\n\n3/3 Mehr: https://example.test/x`,
    art: "angehaengt",
    ersetzt: null,
    lage: "erster_post",
    hinter: "#Denkmal",
  });
  // Fette Marken auf eigener Zeile, Kopfzeile davor; CRLF bleibt CRLF.
  assert.equal(ein("Finaler Content:\n**1/2**\nDas Video zeigt den Hof.\n**2/2**\nMehr im Profil.", "erster_post").text, `Finaler Content:\n**1/2**\nDas Video zeigt den Hof.\n\n${P}\n**2/2**\nMehr im Profil.`);
  assert.equal(ein("1/2 Das Video zeigt den Hof.\r\n2/2 Mehr im Profil.", "erster_post").text, `1/2 Das Video zeigt den Hof.\r\n\r\n${P}\r\n2/2 Mehr im Profil.`);
  // Erster Post nur aus der Marke: die Zeile direkt dahinter.
  assert.equal(ein("1/2\n\n2/2 Mehr im Profil.", "erster_post").text, `1/2\n\n${P}\n\n2/2 Mehr im Profil.`);
  // Thread-Vorschau auf /content (splitTweets: Marke am Zeilenanfang): die Zeile steht im Block 1/3.
  const bloecke = (text) => text.split("\n").reduce((b, z) => (/^\*{0,2}\d+\/\d*\*{0,2}/.test(z.trim()) ? [...b, [z]] : (b.at(-1).push(z), b)), [[]]).map((b) => b.join("\n"));
  const mitZeile = ein("1/3 A.\n2/3 B.\n3/3 C.", "erster_post").text;
  assert.deepEqual(bloecke(mitZeile).map((b) => regeln.enthaeltPflichtzeile(b, P)), [false, true, false, false]);
  // Ohne Thread-Marken (ein Post), nur „2/…“ ohne „1/…“ davor oder „2/…“ vor „1/…“: ans Ende.
  for (const text of ["Ein Post zum Video.\n#Denkmal", "Ein Post.\n2/3 der Fläche sind Park.", "2/2 Mehr.\n1/2 Das Video."]) {
    assert.equal(ein(text, "erster_post").text, `${text}\n\n${P}`, text);
  }
  // Vorhanden (auch im letzten Post) bleibt, nahe Variante wird an ihrer Stelle ersetzt — wie ohne ort.
  const vorhanden = `1/2 A.\n2/2 B.\n${P}`;
  assert.deepEqual(ein(vorhanden, "erster_post"), { text: vorhanden, art: "vorhanden", ersetzt: null, lage: null, hinter: null });
  assert.deepEqual(ein(`1/2 A.\n2/2 B.\n${P}.`, "erster_post"), { text: `1/2 A.\n2/2 B.\n${P}`, art: "ersetzt", ersetzt: `${P}.`, lage: "ersetzt", hinter: null });
  // Ohne ort (und mit "ende"): am Ende, auch bei Marken — wie vor der Schlussprüfung.
  for (const ort of [undefined, "ende"]) assert.equal(ein("1/2 A.\n2/2 B.\n", ort).text, `1/2 A.\n2/2 B.\n\n${P}`, String(ort));
});

test("MCF-6 pflichtzeileEinsetzen im Abschnitt „Finaler Content“ und Länge von Post 1 (Prüfung f-caption-1, f-caption-2): Marken und Einsetzort nur im Abschnitt, bis Publishing-Zeitpunkt, Cross-Promotion, Qualitätsprüfung oder Metadaten; Postmarken auch mit Emoji, in Klammern und als „Post/Tweet 1/3“; xPostEinsLaenge zählt wie die Thread-Vorschau", () => {
  const ein = (text, ort) => regeln.pflichtzeileEinsetzen(text, P, ort);
  const FOLGE = "\n\nPublishing-Zeitpunkt: Dienstag, 18:00\n\nCross-Promotion-Posts:\n- Tweet: mehr im Hauptpost.";
  // Ende des Abschnitts, vor dem folgenden Abschnitt — mit und ohne ort, bei jeder Überschriftsform.
  for (const kopf of ["Finaler Content:", "## Finaler Content", "**Finaler Content:**", "1. Finaler Content (mit Korrekturen):", "- Finaler Content:"]) {
    for (const ort of [undefined, "ende", "erster_post"]) {
      const r = ein(`${kopf}\nDas Video zeigt den Hof.\n#Denkmal${FOLGE}`, ort);
      assert.equal(r.text, `${kopf}\nDas Video zeigt den Hof.\n#Denkmal\n\n${P}${FOLGE}`, `${kopf} ${ort}`);
      assert.equal(r.lage, "abschnitt");
    }
  }
  for (const folge of ["## Publishing-Zeitpunkt", "**Cross-Promotion-Posts:**", "3. Qualitätsprüfung", "Metadaten: Titel"]) {
    assert.equal(ein(`Finaler Content:\nText.\n${folge}\nmehr`).text, `Finaler Content:\nText.\n\n${P}\n${folge}\nmehr`, folge);
  }
  // X: Marken nur im Abschnitt; eine Längenliste davor zählt nicht.
  const liste = "Qualitätsprüfung:\n1/3: 84 Zeichen\n2/3: 90 Zeichen\n\nFinaler Content:\n";
  assert.equal(ein(`${liste}1/3 A.\n2/3 B.${FOLGE}`, "erster_post").text, `${liste}1/3 A.\n\n${P}\n2/3 B.${FOLGE}`);
  // Markenformen: Emoji davor, Klammern, „Post“ und „Tweet“, fett.
  for (const [eins, zwei] of [["🧵 1/3 A.", "🧵 2/3 B."], ["(1/3) A.", "(2/3) B."], ["Post 1/3: A.", "Post 2/3: B."], ["Tweet 1/2 A.", "Tweet 2/2 B."], ["**1/3** A.", "**2/3** B."], ["1 / 3 A.", "2 / 3 B."]]) {
    const r = ein(`Finaler Content:\n${eins}\n${zwei}${FOLGE}`, "erster_post");
    assert.equal(r.text, `Finaler Content:\n${eins}\n\n${P}\n${zwei}${FOLGE}`, eins);
    assert.equal(r.lage, "erster_post", eins);
  }
  // „2/…“ erst hinter dem Abschnitt: kein Thread im Abschnitt → Ende des Abschnitts.
  assert.equal(ein(`Finaler Content:\n1/2 A.${FOLGE}\n2/2 Teaser`, "erster_post").lage, "abschnitt");
  // Ohne Überschrift wie bisher: X-Marken im ganzen Text, sonst ans Ende.
  assert.equal(ein("Ein Post.\n#Denkmal", "erster_post").lage, "ende");
  assert.equal(ein("1/2 A.\n2/2 B.", "erster_post").text, `1/2 A.\n\n${P}\n2/2 B.`);
  // Abschnitt bis zum Ende des Texts: ans Ende, wie bisher.
  assert.deepEqual(ein("Finaler Content:\nText.\n"), { text: `Finaler Content:\nText.\n\n${P}`, art: "angehaengt", ersetzt: null, lage: "ende", hinter: "Text." });

  // xPostEinsLaenge: Block ab „1/…“ bis vor „2/…“ im Abschnitt, ohne „**“ und Leerraum am Rand.
  assert.equal(regeln.X_POST_HOECHSTENS, 280);
  assert.equal(regeln.xPostEinsLaenge(`Finaler Content:\n**1/2** ${"a".repeat(10)}\n\n${P}\n2/2 B.${FOLGE}`), "1/2 ".length + 10 + 2 + P.length);
  // Ohne Marken: der Abschnitt ohne seine Überschrift (Inhalt hinter dem Doppelpunkt zählt mit).
  assert.equal(regeln.xPostEinsLaenge(`Finaler Content:\nEin Post.${FOLGE}`), "Ein Post.".length);
  assert.equal(regeln.xPostEinsLaenge(`**Finaler Content:** Ein Post.\n#Denkmal${FOLGE}`), "Ein Post.\n#Denkmal".length);
  // Ohne Überschrift: mit Marken der Block, ohne Marken nicht messbar.
  assert.equal(regeln.xPostEinsLaenge("1/2 A.\n2/2 B."), "1/2 A.".length);
  assert.equal(regeln.xPostEinsLaenge("Ein Post.\nPublishing-Zeitpunkt: Dienstag"), null);
});

test("MCF-7 Delta-Prüfung f2-pflichtzeile-1 bis -3: Überschrift „Finaler Content“ auch mit Emoji, folgender Abschnitt auch „Empfohlener Publishing-Zeitpunkt“ oder „Scheduling-Empfehlung“; ohne Überschrift keine Marken in anderen Abschnitten (keine Ergänzung in einer Längenliste, sondern Textende mit der echten Nachbarzeile); „1/3“ in der Überschriftszeile ist Post 1; „Thread“ und „Teil“ als Marken; die Längenmessung bleibt im Abschnitt", () => {
  const ein = (text, ort) => regeln.pflichtzeileEinsetzen(text, P, ort);
  const LISTE = "## ✅ Qualitätsprüfung\n- 1/2: 41 Zeichen ✓\n- 2/2: 30 Zeichen ✓\n\n";
  const FOLGE = "\n\n## ⏰ Publishing-Zeitpunkt\nDienstag, 18:00";
  // Emoji-Überschrift mit Längenliste davor: Post 1 des finalen Contents, nicht die Liste.
  const mitEmoji = `${LISTE}## 📝 Finaler Content\n1/2 Das Video zeigt den Hof.\n2/2 Mehr im Profil.${FOLGE}`;
  const r1 = ein(mitEmoji, "erster_post");
  assert.equal(r1.text, mitEmoji.replace("\n2/2 Mehr", `\n\n${P}\n2/2 Mehr`));
  assert.deepEqual([r1.lage, r1.hinter], ["erster_post", "1/2 Das Video zeigt den Hof."]);
  // Folgeabschnitt mit „Empfohlener“ oder als „Scheduling-Empfehlung“: Ende des Abschnitts, vor ihm.
  for (const folge of ["**Empfohlener Publishing-Zeitpunkt:** Dienstag", "Scheduling-Empfehlung: Dienstag", "⏰ Publishing-Zeitpunkt: Dienstag"]) {
    const t = `Finaler Content:\nDas Video zeigt den Hof.\n\n${folge}`;
    const r = ein(t);
    assert.equal(r.text, `Finaler Content:\nDas Video zeigt den Hof.\n\n${P}\n\n${folge}`, folge);
    assert.deepEqual([r.lage, r.hinter], ["abschnitt", "Das Video zeigt den Hof."], folge);
  }
  // Ohne erkannte Überschrift: keine Marken in der Qualitätsprüfung — Textende, mit der echten Nachbarzeile.
  const unbenannt = `${LISTE}## Finaler X-Thread\n1/2 Das Video zeigt den Hof.\n2/2 Mehr im Profil.`;
  const r2 = ein(unbenannt, "erster_post");
  assert.equal(r2.text, `${unbenannt}\n\n${P}`);
  assert.deepEqual([r2.lage, r2.hinter], ["ende", "2/2 Mehr im Profil."]);
  assert.ok(!r2.text.includes(`41 Zeichen ✓\n\n${P}`), "nicht in der Längenliste");
  // Ohne Überschrift, Thread vor dem ersten anderen Abschnitt: weiter Post 1.
  const vorn = `1/2 Das Video zeigt den Hof.\n2/2 Mehr im Profil.${FOLGE}`;
  assert.equal(ein(vorn, "erster_post").text, vorn.replace("\n2/2 Mehr", `\n\n${P}\n2/2 Mehr`));
  // „1/3“ in der Überschriftszeile ist Post 1 — Einsetzort und Länge.
  const inKopf = `**Finaler Content:** 1/3 Das Video zeigt den Hof.\n2/3 Denkmal-AfA.\n3/3 Mehr im Profil.${FOLGE}`;
  const r3 = ein(inKopf, "erster_post");
  assert.equal(r3.text, inKopf.replace("\n2/3 Denkmal", `\n\n${P}\n2/3 Denkmal`));
  assert.deepEqual([r3.lage, r3.hinter], ["erster_post", "**Finaler Content:** 1/3 Das Video zeigt den Hof."]);
  assert.equal(regeln.xPostEinsLaenge(inKopf), "1/3 Das Video zeigt den Hof.".length);
  assert.equal(regeln.xPostEinsLaenge(r3.text), "1/3 Das Video zeigt den Hof.".length + 2 + P.length);
  // „Thread 1/2“ und „Teil 1/2“ als Marken.
  for (const [eins, zwei] of [["Thread 1/2: A.", "Thread 2/2: B."], ["Teil 1/2 A.", "Teil 2/2 B."]]) {
    assert.equal(ein(`Finaler Content:\n${eins}\n${zwei}${FOLGE}`, "erster_post").lage, "erster_post", eins);
  }
  // Längenmessung im Abschnitt (f2-pflichtzeile-3): Längenliste davor und „2/…“ dahinter zählen nicht.
  const lang = `Qualitätsprüfung:\n1/2: 84 Zeichen\n2/2: 90 Zeichen\n\nFinaler Content:\n1/2 ${"x".repeat(280)}\n\nCross-Promotion-Posts:\n2/2 Teaser`;
  assert.equal(regeln.xPostEinsLaenge(lang), 4 + 280, "Post 1 des finalen Contents bis zum Abschnittsende");
});

test("MCF-2 pruefeVideoFreigabe: eine Funktion für Caption und Medium — Gründe in der Reihenfolge Caption, Pflichtzeile, Medien-Regel; der erste ist der Sperrgrund; ohne Medien-Urteil gesperrt", () => {
  const ok = regeln.pruefeVideoFreigabe(FREIGABE, TEXT, TEXT, FREI, P);
  assert.deepEqual([ok.freigebbar, ok.grund, ok.gruende, ok.urteil], [true, null, [], "FREIGABE"]);
  const medium = { freigebbar: false, gruende: ["Klausel „rahmen“ nicht bestanden", "Rechte laut Prüfprotokoll nicht geklärt"] };
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
  // null wie ein fehlender Schlüssel: kein Video, wie an den anderen drei Stellen (Nachtrag d1-nachweis-3) — ohne medium
  // in der Lage, ohne Pflichtzeilen-Grund und ohne Zeile „Video“ in der Beleg-Kette.
  const ohneSchluessel = S.hilfen.freigabeLage({ ...eintrag({ steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: kurz }] }), body: kurz });
  const mitNull = S.hilfen.freigabeLage({ ...eintrag({ medium_id: null, steps: [{ agent: "researcher", output: "r" }, { agent: "scribe", output: kurz }] }), body: kurz });
  assert.equal(mitNull.medium, undefined);
  assert.deepEqual(mitNull.pruefung, ohneSchluessel.pruefung);
  assert.notEqual(mitNull.pruefung.grund, regeln.pflichtzeileFehlt(P));
  assert.doesNotMatch(html(eintrag({ medium_id: null })), /data-beleg-medium/);
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
  // Auch kein leeres Badge (Mutant X66): Jede Plakette trägt Text.
  assert.doesNotMatch(html, /uppercase"[^>]*><\/span>/, "kein leeres Badge");
});
