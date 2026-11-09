// Beleg-Kette einer content-Zeile — ausgelagert aus app/content/page.tsx (Objekt-Studio Schritt 2,
// 08.11.2026), Code unverändert übernommen. /content und das Objekt-Studio zeigen damit dieselbe Kette:
// COUNSEL-Urteil (abgeleitet), Prüfregel, Regelpaket, Objekt-Snapshot, RESEARCHER-Quellen, CTA-Link
// und Betreiber-Vermerk. Alle Texte erscheinen maskiert; den Freigabetext (body) zeigt die Kette nicht.

import type { ReactNode } from "react";
import { MIN_FREIGABE_ZEICHEN, enthaeltGeschuetztenNamen } from "@/lib/freigabe-regeln";
import {
  FARBE_GRUEN,
  FARBE_ROT,
  SNAPSHOT_ZEILEN,
  STATUS_MIT_TEXT,
  alsObjekt,
  freigabeLageGemerkt,
  istObjekt,
  maskiert,
  maskiertWert,
  snapshotWert,
  urteilAnzeige,
  zeitText,
} from "@/components/studio/beleg-hilfen";
import type { BelegEintrag } from "@/components/studio/beleg-hilfen";

export function BelegZeile({ titel, vermerk, children }: { titel: string; vermerk?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-3 py-2 border-t" style={{ borderColor: "var(--gp-hairline)" }}>
      <div className="mono-label pt-0.5">{titel}</div>
      <div className="min-w-0 text-xs text-text-secondary space-y-1">
        {children}
        {vermerk && <p className="text-[10px] text-text-muted">{vermerk}</p>}
      </div>
    </div>
  );
}

export function BelegKette({
  item,
  kopiere,
  kopierStatus,
}: {
  item: BelegEintrag;
  kopiere: (key: string, text: string) => void;
  kopierStatus: (key: string) => string;
}) {
  const meta = alsObjekt(item.metadata) ?? {};
  // Urteil aus dem gespeicherten COUNSEL-Text abgeleitet — dieselbe Auswertung wie in der
  // Pipeline (lib/counsel-urteil.ts), kein eigenes Feld. Grün nur, wenn COUNSEL genau den
  // Freigabetext geprüft hat (R2).
  const lage = freigabeLageGemerkt(item);
  const counsel = lage.counsel;
  const anzeige = urteilAnzeige(counsel.urteil, lage.bezug);
  const counselUnvollstaendig = alsObjekt(meta.fehler)?.stufe === "counsel";
  const regel = alsObjekt(meta.regelpaket);
  const snapshot = alsObjekt(meta.objekt_snapshot);
  const snapshotObjekt = alsObjekt(snapshot?.objekt);
  const exportKopf = alsObjekt(snapshot?.export);
  const researcherSchritt: unknown = Array.isArray(meta.steps) ? meta.steps[0] : undefined;
  const researcherText =
    istObjekt(researcherSchritt) && typeof researcherSchritt.output === "string" ? researcherSchritt.output : null;
  const ctaLink = typeof meta.cta_link === "string" && meta.cta_link ? meta.cta_link : null;
  // Gesamtprüfung 06.11.2026: Ein CTA-Link mit geschütztem Namen wird nie kopiert (fail-closed).
  const ctaMitNamen = ctaLink !== null && enthaeltGeschuetztenNamen(ctaLink);
  const ctaKey = `${item.id}-cta`;
  const freigabe = alsObjekt(meta.freigabe);
  const gepostet = alsObjekt(meta.gepostet);
  const mitText = STATUS_MIT_TEXT.includes(item.status);

  const kopfZeilen: [string, string][] = [
    ["Export-Version", exportKopf?.version ?? "nicht im Export-Kopf"],
    ["Export-Quelle", exportKopf?.quelle ?? "nicht im Export-Kopf"],
    ["Export erzeugt", exportKopf?.generiert_am ? zeitText(exportKopf.generiert_am) : "nicht im Export-Kopf"],
    ["Abgerufen", zeitText(snapshot?.abgerufen_am)],
  ];

  return (
    <div className="rounded-lg px-3 pt-3 pb-1" style={{ border: "1px solid var(--gp-hairline)", background: "rgba(11, 12, 16, 0.4)" }}>
      <h4 className="mono-label mb-1" style={{ color: "var(--gp-gold)" }}>
        Beleg-Kette
      </h4>

      <BelegZeile titel="COUNSEL-Urteil" vermerk="abgeleitet aus dem COUNSEL-Text">
        <p>
          <span
            className="font-semibold font-[family-name:var(--font-jbmono)]"
            style={{ color: anzeige.farbe }}
            data-urteil-anzeige={lage.bezug}
          >
            {anzeige.text}
          </span>
          <span className="text-text-muted"> · {counsel.grund}</span>
        </p>
        {anzeige.erklaerung && <p className="text-[10px] text-text-muted">{anzeige.erklaerung}</p>}
        {counsel.zeile && (
          <p className="font-[family-name:var(--font-jbmono)] text-[11px] break-words">{maskiert(counsel.zeile)}</p>
        )}
        {meta.counsel?.geprueft && (
          <p className="text-[10px] text-text-muted">
            geprüft: {maskiert(String(meta.counsel.geprueft))}
            {meta.counsel.am ? ` · ${zeitText(meta.counsel.am)}` : ""}
          </p>
        )}
        {counselUnvollstaendig && (
          <p className="text-[10px]" style={{ color: "var(--gp-amber)" }}>
            COUNSEL-Antwort unvollständig (siehe Fehler) — das Urteil ist nicht maßgeblich.
          </p>
        )}
      </BelegZeile>

      {mitText && (
        <BelegZeile
          titel="Prüfregel"
          vermerk={`Für Freigeben: COUNSEL-Urteil FREIGABE, Text ab ${MIN_FREIGABE_ZEICHEN} Zeichen, kein geschützter Name.`}
        >
          {lage.pruefung.freigebbar ? (
            <p style={{ color: FARBE_GRUEN }}>erfüllt</p>
          ) : (
            <p style={{ color: FARBE_ROT }}>nicht erfüllt: {maskiert(lage.pruefung.grund ?? "ohne Grund")}</p>
          )}
        </BelegZeile>
      )}

      <BelegZeile titel="Regelpaket">
        {regel ? (
          <p className="font-[family-name:var(--font-jbmono)]">
            {maskiertWert(regel.version ?? "Version nicht lesbar")} · Stand {maskiertWert(regel.stand ?? "nicht lesbar")}
          </p>
        ) : (
          <p>nicht gespeichert (Lauf vor Stufe 1)</p>
        )}
      </BelegZeile>

      <BelegZeile titel="Objekt-Snapshot">
        {snapshot ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {kopfZeilen.map(([label, wert]) => (
                  <tr key={label} className="align-top">
                    <th scope="row" className="text-left font-normal text-text-muted pr-3 py-0.5 whitespace-nowrap">
                      {label}
                    </th>
                    <td className="py-0.5 font-[family-name:var(--font-jbmono)] break-words">{maskiert(wert)}</td>
                  </tr>
                ))}
                {snapshotObjekt ? (
                  SNAPSHOT_ZEILEN.map(([feld, label]) => (
                    <tr key={feld} className="align-top border-t" style={{ borderColor: "var(--gp-hairline)" }}>
                      <th scope="row" className="text-left font-normal text-text-muted pr-3 py-0.5 whitespace-nowrap">
                        {label}
                      </th>
                      <td className="py-0.5 font-[family-name:var(--font-jbmono)] break-words">
                        {snapshotWert(feld, snapshotObjekt[feld]).map((zeile, i) => (
                          <div key={i}>{maskiert(zeile)}</div>
                        ))}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="py-0.5">Snapshot ohne Objektfelder</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{meta.objekt_slug ? "kein Snapshot gespeichert" : "kein Snapshot gespeichert (Lauf ohne Objekt)"}</p>
        )}
      </BelegZeile>

      <BelegZeile titel="RESEARCHER-Quellen" vermerk="Modellangabe, ungeprüft">
        <p>{typeof meta.researcher_quellen === "string" ? maskiert(meta.researcher_quellen) : "kein Vermerk gespeichert (Lauf vor Stufe 1)"}</p>
        {researcherText ? (
          <details>
            <summary className="cursor-pointer text-[10px] text-text-muted hover:text-foreground">
              RESEARCHER-Text anzeigen
            </summary>
            <pre className="mt-2 text-xs whitespace-pre-wrap bg-surface-elevated rounded-lg p-3 max-h-[260px] overflow-y-auto font-mono leading-relaxed">
              {maskiert(researcherText)}
            </pre>
          </details>
        ) : (
          <p className="text-[10px] text-text-muted">RESEARCHER-Text nicht gespeichert</p>
        )}
      </BelegZeile>

      <BelegZeile titel="CTA-Link" vermerk="Nur als Text: Prüf-Klicks würden die Steinadel-Zählung verfälschen.">
        {ctaLink ? (
          <>
            {ctaMitNamen && (
              <p role="alert" data-cta-sperre="name" style={{ color: FARBE_ROT }}>
                CTA-Link enthält einen geschützten Namen — nicht verwenden. Kopieren gesperrt.
              </p>
            )}
            <div className="flex items-start gap-2">
              <code
                className={`break-all font-[family-name:var(--font-jbmono)] text-[11px]${ctaMitNamen ? "" : " select-all"}`}
                style={{ color: "var(--gp-gold-hi)" }}
              >
                {maskiert(ctaLink)}
              </code>
              <button
                onClick={() => {
                  if (!ctaMitNamen) kopiere(ctaKey, ctaLink);
                }}
                disabled={ctaMitNamen}
                title={ctaMitNamen ? "CTA-Link enthält einen geschützten Namen — Kopieren gesperrt" : undefined}
                className="shrink-0 text-[10px] px-2 py-1 rounded bg-surface-elevated text-text-muted hover:text-foreground transition-colors disabled:opacity-40"
              >
                {kopierStatus(ctaKey)}
              </button>
            </div>
          </>
        ) : (
          <p>kein CTA-Link gespeichert</p>
        )}
        {meta.utm_content && (
          <p>
            <span className="text-text-muted">utm_content: </span>
            <span className="font-mono">{maskiertWert(meta.utm_content)}</span>
          </p>
        )}
      </BelegZeile>

      {/* Betreibertexte (Grund, URL) wie alle übrigen Texte maskiert — wie in ablehnungText (R24) */}
      <BelegZeile titel="Betreiber">
        {freigabe ? (
          <p>
            {freigabe.aktion === "ablehnen"
              ? "abgelehnt"
              : freigabe.aktion === "freigeben"
                ? "freigegeben"
                : maskiertWert(freigabe.aktion ?? "Aktion")}
            {" · "}
            {zeitText(freigabe.am)} · {maskiertWert(freigabe.durch ?? "unbekannt")}
            {freigabe.grund ? ` · Grund: ${maskiertWert(freigabe.grund)}` : ""}
          </p>
        ) : (
          <p>keine Entscheidung gespeichert</p>
        )}
        {gepostet && (
          <p>
            gepostet · {zeitText(gepostet.am)}
            {gepostet.published_url ? (
              <span className="font-[family-name:var(--font-jbmono)] break-all"> · {maskiertWert(gepostet.published_url)}</span>
            ) : null}
          </p>
        )}
      </BelegZeile>
    </div>
  );
}
