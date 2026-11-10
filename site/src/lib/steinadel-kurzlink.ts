// Steinadel-Kurzlink als CTA — Objekt-Studio Stufe 2, Schritt 4 (10.11.2026).
//
// Entscheidung E12 (Inhaber, 10.11.2026): Der CTA eines Objekt-Laufs ist der Kurzlink
// https://steinadel.de/k/<kampagne>/<präfix>-<slug>-<id> statt des Direktlinks mit sichtbaren UTMs.
// Er zählt Klicks und setzt die UTMs erst beim Weiterleiten. Das COUNSEL-Regelpaket kennt ihn noch
// nicht: Es erlaubt als Ziel nur /l/<kampagne> oder Objektseiten und verlangt UTMs an jedem
// ausgehenden Link (lib/steinadel-regelpaket.ts:82-96; die Datei bleibt unverändert). Bis die
// Kurzlink-Regel dort steht, gilt der Ersatzweg der Spezifikation (§6.3): GP prüft den Link
// deterministisch im Code und gibt COUNSEL die aufgelöste Ziel-URL mit UTMs mit.
//
// Die Auflösung bildet den Steinadel-Redirect Zeichen für Zeichen nach (nur gelesen, Steinadel-Repo
// Stand 0f3e82c; SR = Steinadel-Repo):
// - SR/apps/web/src/lib/kampagnen/kurzlink.ts:10-18 — Präfix → utm_source: x → x, li → linkedin,
//   ig → instagram, fb → facebook, tt → tiktok, yt → youtube, nl → newsletter.
// - SR/apps/web/src/lib/kampagnen/kurzlink.ts:32-38 — Kampagne und Content getrimmt und klein
//   geschrieben, gültig nur nach isValidUtmValue; :39-40 Präfix = Teil vor dem ersten "-",
//   unbekannter Präfix → utm_source "social"; :44-48 Ziel /l/<kampagne>, utm_medium "newsletter" nur
//   für die Quelle newsletter, sonst "social", utm_campaign = Kampagne, utm_content = Content.
// - SR/apps/web/src/lib/leads/validation.ts:34, 43, 54-56 — isValidUtmValue: nur [a-z0-9_-],
//   1 bis 80 Zeichen.
// - SR/apps/web/src/app/k/[kampagne]/[content]/route.ts:28, 36-40 — Weiterleitung (307) auf die
//   öffentliche Basis, Rückfall https://steinadel.de; Parameter in der Reihenfolge utm_source,
//   utm_medium, utm_campaign, utm_content. :30-33: ungültiger Pfad → Startseite ohne UTMs.
// - SR/apps/web/src/lib/objekte/export.ts:107-111 — lpUrl einer Kampagne im Export ist
//   <Basis>/l/<kampagne>, mit derselben Basis wie die Weiterleitung (SR/apps/web/src/app/api/objekte/
//   export/route.ts:37). Weicht die lpUrl des Exports vom errechneten Ziel ab, stimmt die Annahme über
//   die Basis nicht: dann kein Kurzlink (fail-closed).
//
// Strenger als Steinadel (fail-closed): GP baut und akzeptiert nur Kurzlinks, die schon klein
// geschrieben und gültig sind (Link und gespeicherte UTMs stimmen dann Zeichen für Zeichen überein),
// und nur Präfixe mit einer Quelle aus der Regelpaket-Liste — der Rückfall "social" steht nicht in
// der utm_source-Liste des Regelpakets (lib/steinadel-regelpaket.ts:88).
//
// Reine Funktionen ohne Laufzeit-Importe und ohne Netz; die Pipeline (api/content/pipeline) ruft sie
// auf, Tests prüfen sie direkt.

/** Basis der Kurzlinks und ihrer Ziele (Rückfall der Steinadel-Weiterleitung, route.ts:28). */
export const KURZLINK_BASIS = "https://steinadel.de";
const KURZLINK_HOST = "steinadel.de";

/** GP-Plattform → Präfix des Kurzlinks (E12: aus twitter wird x). */
export const KURZLINK_PRAEFIX: Readonly<Record<string, string>> = {
  x: "x",
  twitter: "x",
  linkedin: "li",
  instagram: "ig",
  tiktok: "tt",
  youtube: "yt",
  newsletter: "nl",
};

/** Präfix → utm_source, wörtlich wie Steinadel (SR/apps/web/src/lib/kampagnen/kurzlink.ts:10-18). */
const QUELLE_AUS_PRAEFIX: Readonly<Record<string, string>> = {
  x: "x",
  li: "linkedin",
  ig: "instagram",
  fb: "facebook",
  tt: "tiktok",
  yt: "youtube",
  nl: "newsletter",
};

const UTM_ZEICHEN = /^[a-z0-9_-]+$/;
const UTM_MAX_ZEICHEN = 80;

function hat(objekt: Readonly<Record<string, string>>, schluessel: string): boolean {
  return Object.prototype.hasOwnProperty.call(objekt, schluessel);
}

/** Gültiger UTM-Wert wie bei Steinadel (isValidUtmValue): [a-z0-9_-], 1 bis 80 Zeichen. */
export function istUtmWert(wert: string): boolean {
  return wert.length > 0 && wert.length <= UTM_MAX_ZEICHEN && UTM_ZEICHEN.test(wert);
}

/** Ziel eines Kurzlinks, wie die Steinadel-Weiterleitung es ansteuert. */
export interface KurzlinkZiel {
  /** Ziel-URL mit UTMs (Weiterleitung 307). */
  url: string;
  /** Pfad der Kampagnen-Landingpage, z. B. /l/afa-rechner-p1. */
  lp_pfad: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
}

/**
 * Ziel wie die Steinadel-Weiterleitung (parseKurzlink + Route), für schon getrimmte und klein
 * geschriebene Werte. null, wenn Steinadel den Pfad als ungültig behandelt (Startseite ohne UTMs).
 * Unbekannter Präfix → utm_source "social" wie bei Steinadel; GP lässt ihn in pruefeKurzlink nicht zu.
 */
export function zielWieSteinadel(kampagne: string, content: string): KurzlinkZiel | null {
  if (!istUtmWert(kampagne) || !istUtmWert(content)) return null;
  const praefix = content.split("-", 1)[0] ?? "";
  const quelle = hat(QUELLE_AUS_PRAEFIX, praefix) ? QUELLE_AUS_PRAEFIX[praefix] : "social";
  const lpPfad = `/l/${kampagne}`;
  const medium = quelle === "newsletter" ? "newsletter" : "social";
  const url = new URL(lpPfad, KURZLINK_BASIS);
  url.searchParams.set("utm_source", quelle);
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", kampagne);
  url.searchParams.set("utm_content", content);
  return { url: url.toString(), lp_pfad: lpPfad, utm_source: quelle, utm_medium: medium, utm_campaign: kampagne, utm_content: content };
}

export type KurzlinkPruefung =
  | { ok: true; link: string; kampagne: string; content: string; praefix: string; ziel: KurzlinkZiel }
  | { ok: false; grund: string };

const KURZLINK_PFAD = /^\/k\/([^/]+)\/([^/]+)$/;

/**
 * Einen Kurzlink deterministisch prüfen und auflösen: genau https://steinadel.de/k/<kampagne>/<content>
 * (ohne Port, Anmeldedaten, Query und Anker), Kampagne und Content gültig und klein, Präfix mit Quelle
 * aus der Regelpaket-Liste. Liefert das Ziel mit UTMs oder den Grund der Ablehnung.
 */
export function pruefeKurzlink(link: string): KurzlinkPruefung {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { ok: false, grund: "keine gültige URL" };
  }
  if (url.protocol !== "https:" || url.hostname !== KURZLINK_HOST || url.port !== "" || url.username !== "" || url.password !== "") {
    return { ok: false, grund: `nicht ${KURZLINK_BASIS}` };
  }
  if (url.search !== "" || url.hash !== "") return { ok: false, grund: "Kurzlink mit Query oder Anker" };
  const teile = KURZLINK_PFAD.exec(url.pathname);
  if (!teile) return { ok: false, grund: "Pfad nicht /k/<kampagne>/<content>" };
  const [, kampagne, content] = teile;
  if (!istUtmWert(kampagne)) return { ok: false, grund: "Kampagne nicht [a-z0-9_-] mit 1 bis 80 Zeichen" };
  if (!istUtmWert(content)) return { ok: false, grund: "Content nicht [a-z0-9_-] mit 1 bis 80 Zeichen" };
  const praefix = content.split("-", 1)[0] ?? "";
  if (!hat(QUELLE_AUS_PRAEFIX, praefix)) {
    return { ok: false, grund: `Präfix „${praefix}“ ohne Quelle (Steinadel zählte ihn als „social“, das Regelpaket kennt das nicht)` };
  }
  const ziel = zielWieSteinadel(kampagne, content);
  if (ziel === null) return { ok: false, grund: "Steinadel löst den Pfad nicht auf" };
  return { ok: true, link: `${KURZLINK_BASIS}/k/${kampagne}/${content}`, kampagne, content, praefix, ziel };
}

export type KurzlinkBau = { ok: true; pruefung: Extract<KurzlinkPruefung, { ok: true }> } | { ok: false; grund: string };

/**
 * CTA-Kurzlink eines Laufs bauen und prüfen: Präfix aus der Plattform, Content <präfix>-<slug>-<id>.
 * Gegenprobe: Die lpUrl der Kampagne im Export muss genau das Ziel ohne UTMs sein
 * (<Basis>/l/<kampagne>, SR/apps/web/src/lib/objekte/export.ts:109). Sonst kein Kurzlink.
 */
export function baueKurzlink(eingabe: { plattform: string; kampagne: string; lpUrl: string; slug: string; id: number }): KurzlinkBau {
  if (!hat(KURZLINK_PRAEFIX, eingabe.plattform)) {
    return { ok: false, grund: "Plattform ohne Kurzlink-Präfix" };
  }
  if (!Number.isSafeInteger(eingabe.id) || eingabe.id <= 0) return { ok: false, grund: "keine gültige Eintragsnummer" };
  const praefix = KURZLINK_PRAEFIX[eingabe.plattform];
  const kampagne = eingabe.kampagne.trim().toLowerCase();
  const content = `${praefix}-${eingabe.slug.trim().toLowerCase()}-${eingabe.id}`;
  const pruefung = pruefeKurzlink(`${KURZLINK_BASIS}/k/${kampagne}/${content}`);
  if (!pruefung.ok) return pruefung;
  let lp: URL;
  try {
    lp = new URL(eingabe.lpUrl);
  } catch {
    return { ok: false, grund: "lpUrl der Kampagne ist keine URL" };
  }
  if (lp.origin !== KURZLINK_BASIS || lp.pathname !== pruefung.ziel.lp_pfad || lp.search !== "" || lp.hash !== "") {
    return {
      ok: false,
      grund: `Landingpage laut Export ist nicht das Kurzlink-Ziel ${KURZLINK_BASIS}${pruefung.ziel.lp_pfad}`,
    };
  }
  return { ok: true, pruefung };
}

// ═══ Kurzlinks im Text (Schritt 4: SCRIBE-Text und Endfassung) ═══

/**
 * Adressen auf steinadel.de im Text, mit oder ohne Schema und Subdomain; Pfad, Query und Anker bis zum
 * ersten Leerraum oder Trennzeichen. Nicht davor: Buchstabe, Ziffer oder ein Zeichen, das die Adresse
 * zum Teil einer anderen macht ("evilsteinadel.de", ".../steinadel.de/…", "?r=steinadel.de/…", E-Mail).
 * Nicht danach: weitere Domain-Zeichen ("steinadel.dev").
 */
const STEINADEL_ADRESSE =
  /(?<![\p{L}\p{N}._\-/=&?#%@+~])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*steinadel\.de(?![a-z0-9-])(?::\d+)?(?:[/?#][^\s<>()[\]{}"'`|\\]*)?/giu;
/** Satzzeichen und Hervorhebung am Ende gehören nicht zur Adresse (wie bei der automatischen Verlinkung). */
const ENDE_OHNE_ADRESSE = /[.,;:!?…*_~'"’”»]+$/u;
const KURZ_MAX = 120;

function kurz(text: string): string {
  return text.length > KURZ_MAX ? `${text.slice(0, KURZ_MAX)}…` : text;
}

export interface KurzlinkImText {
  link: string;
  ziel: KurzlinkZiel;
  /** true: der CTA-Link des Laufs; false: ein Kurzlink desselben Laufs mit anderem Kanal-Präfix. */
  cta: boolean;
}

export interface KurzlinkTextPruefung {
  /** true nur, wenn der CTA-Link mindestens einmal unverändert dasteht und kein Befund vorliegt. */
  ok: boolean;
  /** Wie oft der CTA-Link unverändert im Text steht. */
  cta_treffer: number;
  /** Jeder Kurzlink dieses Laufs im Text, einmal je Link, aufgelöst. */
  kurzlinks: KurzlinkImText[];
  /** Abweichungen; leer, wenn ok. */
  befunde: string[];
}

/**
 * Kurzlinks im Text deterministisch prüfen (E12-Ersatzweg). Zulässig sind der CTA-Link des Laufs —
 * mit https:// oder ohne Schema, Domain in beliebiger Schreibweise — und Kurzlinks desselben Laufs
 * (gleiche Kampagne, gleicher Slug, gleiche Nummer) mit einem anderen Präfix aus der Steinadel-Liste,
 * etwa nl- für einen Newsletter-Teaser. Befund ist jeder andere /k/-Link, jeder Direktlink auf eine
 * Kampagnenseite (/l/…) und ein fehlender CTA-Link. Andere Adressen (Impressum, Startseite,
 * Objektseiten) prüft COUNSEL nach dem Regelpaket; sie zählen hier nicht.
 */
export function pruefeKurzlinksImText(
  text: string,
  erwartet: { link: string; kampagne: string; slug: string; id: number },
): KurzlinkTextPruefung {
  const befunde: string[] = [];
  const kurzlinks: KurzlinkImText[] = [];
  let ctaTreffer = 0;
  const slug = erwartet.slug.trim().toLowerCase();
  const kampagne = erwartet.kampagne.trim().toLowerCase();
  for (const treffer of text.matchAll(STEINADEL_ADRESSE)) {
    const roh = treffer[0].replace(ENDE_OHNE_ADRESSE, "");
    const mitSchema = /^https?:\/\//i.test(roh);
    let url: URL;
    try {
      url = new URL(mitSchema ? roh : `https://${roh}`);
    } catch {
      continue;
    }
    // Groß geschriebenes /K/ oder /L/ zählt mit: Es wäre ein kaputter Link und damit ein Befund.
    const pfad = url.pathname.toLowerCase();
    const istKurzlink = pfad.startsWith("/k/") || pfad === "/k";
    const istDirektlink = pfad.startsWith("/l/") || pfad === "/l";
    if (istDirektlink) {
      befunde.push(`Direktlink auf eine Kampagnenseite statt Kurzlink: ${kurz(roh)}`);
      continue;
    }
    if (!istKurzlink) continue;
    if (mitSchema && url.protocol !== "https:") {
      befunde.push(`Kurzlink ohne https: ${kurz(roh)}`);
      continue;
    }
    // Schema ergänzt bzw. Domain klein geschrieben: url.href ist die geprüfte Form.
    const pruefung = pruefeKurzlink(url.href);
    if (!pruefung.ok) {
      befunde.push(`ungültiger Kurzlink (${pruefung.grund}): ${kurz(roh)}`);
      continue;
    }
    const istCta = pruefung.link === erwartet.link;
    const desselbenLaufs = pruefung.kampagne === kampagne && pruefung.content === `${pruefung.praefix}-${slug}-${erwartet.id}`;
    if (!istCta && !desselbenLaufs) {
      befunde.push(`Kurzlink gehört nicht zu diesem Lauf: ${kurz(roh)}`);
      continue;
    }
    if (istCta) ctaTreffer += 1;
    if (!kurzlinks.some((k) => k.link === pruefung.link)) kurzlinks.push({ link: pruefung.link, ziel: pruefung.ziel, cta: istCta });
  }
  if (ctaTreffer === 0) befunde.unshift(`CTA-Link fehlt im Text: ${erwartet.link}`);
  return { ok: befunde.length === 0, cta_treffer: ctaTreffer, kurzlinks, befunde };
}
