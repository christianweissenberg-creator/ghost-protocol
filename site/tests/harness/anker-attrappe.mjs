// Ersatz für src/lib/studio/anker.ts in den Medien-Tests (Objekt-Studio Schritt 7, 10.11.2026).
//
// Die Medien-Routen laden den Anker live und vergleichen seinen SHA-256 mit dem Manifest. Echte Anker-Dateien
// kommen nie ins Repo; ein synthetisches Bild kann den Hash des echten Manifests nicht treffen. Deshalb lenkt die
// Testdatei (registerHooks) jeden Import von src/lib/studio/anker.ts auf diese Datei um: Alles bleibt das echte
// Modul, nur ANKER_MANIFESTE und ankerManifest lesen ein Manifest, das der Test setzt (setzeTestManifest).
// Lädt diese Datei selbst anker.ts, wird nicht umgelenkt.

import * as echt from "../../src/lib/studio/anker.ts";

export * from "../../src/lib/studio/anker.ts";

export const ANKER_MANIFESTE = { ...echt.ANKER_MANIFESTE };

export function ankerManifest(slug) {
  return typeof slug === "string" && Object.hasOwn(ANKER_MANIFESTE, slug) ? ANKER_MANIFESTE[slug] : null;
}

export function setzeTestManifest(slug, manifest) {
  ANKER_MANIFESTE[slug] = manifest;
}

export function setzeEchtesManifest(slug) {
  ANKER_MANIFESTE[slug] = echt.ANKER_MANIFESTE[slug];
}
