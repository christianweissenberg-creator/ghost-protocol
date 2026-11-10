// Objekt-Studio Schritt 7 (10.11.2026): Startbild-Abgleich (lib/studio/startbild.ts) und Rezept-Regeln
// (lib/studio/medien.ts). Lauf: npm test.
//
// Nur synthetische Bilder, die sharp hier erzeugt (Rauschen, damit jede Verschiebung auffällt); keine Anker- oder
// Probe-Dateien. Kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return nextResolve(pathToFileURL(path.join(SITE, "node_modules/next/dist/compiled/server-only/empty.js")).href, context);
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith(".ts")) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const sharp = createRequire(path.join(SITE, "package.json"))("sharp");
const startbild = await import("../src/lib/studio/startbild.ts");
const medien = await import("../src/lib/studio/medien.ts");

const { gleicheStartbildAb, STARTBILD_TOLERANZ, ladeSharp } = startbild;

/** Rauschbild breite × hoehe als JPEG (Qualität 90): jede Verschiebung um 1 px ändert fast jeden Wert. */
async function rauschAnker(breite, hoehe, saat = 12345) {
  const roh = Buffer.alloc(breite * hoehe * 3);
  let s = saat;
  for (let i = 0; i < roh.length; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    roh[i] = s & 0xff;
  }
  return sharp(roh, { raw: { width: breite, height: hoehe, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

const ANKER = await rauschAnker(320, 200);
const REZEPT = { x: 9, y: 23, breite: 160, hoehe: 90, skalierung: 1 };
const ausschnitt = (r = REZEPT) => sharp(ANKER).extract({ left: r.x, top: r.y, width: r.breite, height: r.hoehe });
const anker = { id: "test-anker", sha256: "a".repeat(64), bytes: ANKER };

test("M-S1 PNG-Ausschnitt aus dem Anker → größte Abweichung 0, bestanden; Versionen von sharp und libvips stehen dabei", async () => {
  const png = await ausschnitt().png().toBuffer();
  const e = await gleicheStartbildAb({ anker, startbild: png, ausschnitt: REZEPT });
  assert.equal(e.urteil, "bestanden");
  assert.equal(e.abweichung_max, 0);
  assert.equal(e.mittel, 0);
  assert.equal(e.anteil_ueber_toleranz, 0);
  assert.equal(e.toleranz, 2);
  assert.equal(e.grund, null);
  assert.deepEqual(e.startbild, { breite: 160, hoehe: 90 });
  assert.deepEqual(e.anker, { id: "test-anker", sha256: "a".repeat(64), breite: 320, hoehe: 200 });
  const { versionen } = await ladeSharp();
  assert.deepEqual(e.versionen, versionen);
  assert.match(e.versionen.sharp, /^\d+\.\d+\.\d+/);
  assert.match(e.versionen.vips, /^\d+\.\d+\.\d+/);
});

test("M-S2 JPEG neu kodiert → über der Toleranz, nicht bestanden, mit Messwerten", async () => {
  const jpg = await ausschnitt().jpeg({ quality: 92 }).toBuffer();
  const e = await gleicheStartbildAb({ anker, startbild: jpg, ausschnitt: REZEPT });
  assert.equal(e.urteil, "nicht_bestanden");
  assert.ok(e.abweichung_max > STARTBILD_TOLERANZ, String(e.abweichung_max));
  assert.ok(e.mittel > 0 && e.anteil_ueber_toleranz > 0);
});

test("M-S3 Rezept um 1 px verschoben (x und y je einzeln) → große Abweichung; x und y vertauscht → nicht bestanden", async () => {
  for (const verschoben of [{ ...REZEPT, x: REZEPT.x + 1 }, { ...REZEPT, y: REZEPT.y + 1 }]) {
    const png = await ausschnitt(verschoben).png().toBuffer();
    const e = await gleicheStartbildAb({ anker, startbild: png, ausschnitt: REZEPT });
    assert.equal(e.urteil, "nicht_bestanden");
    assert.ok(e.abweichung_max > 100, String(e.abweichung_max));
  }
  // Ein Startbild, das genau nach dem Rezept geschnitten ist, besteht nur mit x = links, y = oben.
  const png = await ausschnitt().png().toBuffer();
  const vertauscht = await gleicheStartbildAb({ anker, startbild: png, ausschnitt: { ...REZEPT, x: REZEPT.y, y: REZEPT.x } });
  assert.equal(vertauscht.urteil, "nicht_bestanden");
});

test("M-S4 Toleranzgrenze: Abweichung genau 2 besteht, 3 nicht (größte Abweichung ≤ Toleranz)", async () => {
  const { data, info } = await ausschnitt().raw().toBuffer({ resolveWithObject: true });
  for (const [delta, urteil] of [[2, "bestanden"], [3, "nicht_bestanden"]]) {
    const kopie = Buffer.from(data);
    // ein Kanalwert verändert, in die Richtung, die nicht über 255 bzw. unter 0 läuft
    kopie[100] = kopie[100] >= 128 ? kopie[100] - delta : kopie[100] + delta;
    const png = await sharp(kopie, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
    const e = await gleicheStartbildAb({ anker, startbild: png, ausschnitt: REZEPT });
    assert.equal(e.abweichung_max, delta);
    assert.equal(e.urteil, urteil, `Abweichung ${delta}`);
  }
});

test("M-S5 Maße passen nicht → nicht bestanden mit Grund, ohne Vergleich (keine Zahl als Platzhalter)", async () => {
  const zuGross = await sharp(ANKER).extract({ left: 0, top: 0, width: 161, height: 90 }).png().toBuffer();
  const e = await gleicheStartbildAb({ anker, startbild: zuGross, ausschnitt: REZEPT });
  assert.equal(e.urteil, "nicht_bestanden");
  assert.equal(e.abweichung_max, null);
  assert.equal(e.mittel, null);
  assert.equal(e.anteil_ueber_toleranz, null);
  assert.match(e.grund, /Maße passen nicht: Startbild 161×90, Ausschnitt 160×90/);
});

test("M-S6 EXIF-Drehung → nicht bestanden mit Grund (Pixelvergleich nicht eindeutig)", async () => {
  const gedreht = await ausschnitt().jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer();
  const e = await gleicheStartbildAb({ anker, startbild: gedreht, ausschnitt: REZEPT });
  assert.equal(e.urteil, "nicht_bestanden");
  assert.match(e.grund, /EXIF-Drehung \(Orientierung 6\)/);
});

test("M-S7 Rezept-Regeln: skalierung nur 1, ganze Zahlen, Rechteck im Anker (sonst Grund für 400)", () => {
  const { pruefeAusschnitt, rezeptImAnker } = medien;
  assert.deepEqual(pruefeAusschnitt({ x: 0, y: 264, breite: 3000, hoehe: 1687, skalierung: 1 }), { ok: true, wert: { x: 0, y: 264, breite: 3000, hoehe: 1687, skalierung: 1 } });
  assert.match(pruefeAusschnitt({ x: 0, y: 0, breite: 10, hoehe: 10, skalierung: 2 }).grund, /skalierung muss 1 sein/);
  assert.match(pruefeAusschnitt({ x: 0.5, y: 0, breite: 10, hoehe: 10, skalierung: 1 }).grund, /ausschnitt\.x: ganze Zahl/);
  assert.match(pruefeAusschnitt({ x: 0, y: 0, breite: 0, hoehe: 10, skalierung: 1 }).grund, /ausschnitt\.breite/);
  assert.match(pruefeAusschnitt({ x: 0, y: 0, breite: 10, hoehe: 10, skalierung: 1, drehung: 0 }).grund, /unbekanntes Feld drehung/);
  const a = { id: "hof", breite: 3000, hoehe: 2018 };
  assert.equal(rezeptImAnker({ x: 0, y: 264, breite: 3000, hoehe: 1687, skalierung: 1 }, a), null);
  assert.equal(rezeptImAnker({ x: 0, y: 331, breite: 3000, hoehe: 1687, skalierung: 1 }, a), null, "bündig mit dem unteren Rand");
  assert.match(rezeptImAnker({ x: 0, y: 332, breite: 3000, hoehe: 1687, skalierung: 1 }, a), /außerhalb des Ankers hof \(3000×2018\)/);
  assert.match(rezeptImAnker({ x: 1, y: 0, breite: 3000, hoehe: 10, skalierung: 1 }, a), /außerhalb/);
});
