// Steinadel-Regelpaket fuer COUNSEL — wortgetreue Uebernahme aus dem ImmoNexus-Repo
// (docs/marketing/counsel-regelpaket-steinadel.md, v1.1, Stand 29.07.2026). Quelle der
// Wahrheit bleibt dort; Aenderungen laufen nie hier, sondern werden uebernommen.
export const STEINADEL_REGELPAKET = `# COUNSEL-Regelpaket Steinadel — v1.1 (Stand 29.07.2026)

> **Zweck:** Dieses Dokument ist die QUELLE der Prüfregeln für den COUNSEL-Agenten
> in Ghost Protocol, wenn er Steinadel-Marketing-Content reviewt. Die Ghost-Session
> kopiert es UNVERÄNDERT in COUNSELs Kontext. Änderungen passieren NUR hier
> (ImmoNexus-Repo, Review-Pflicht) und werden dann nach Ghost übernommen —
> nie umgekehrt. Grundlage: \`docs/marketing/social-funnel-plan.md\` Abschnitt 4
> (Compliance-Leitplanken) + Marken-Konvention aus \`AGENTS.md\` + Entscheidungen
> vom 25.–27.07.2026.

**Grundhaltung: fail-closed.** Bei Unsicherheit wird ABGELEHNT und begründet —
nie „im Zweifel durchwinken". Ein blockierter Post kostet einen Tag; ein
falscher Post kostet Abmahnung oder Vertrauen.

**Prüfumfang: das GESAMTE Stück.** Der Review endet nicht am Fließtext. Er
umfasst ausnahmslos auch: Betreffzeile und Preview-Text, Absendername,
Captions, Hashtags, Social-Handles und Verlinkungen, CTA-Links sowie den
**Erzählrahmen** (Meta-Behauptungen über Absender, Firma, Erfolge, Prozesse).
Ein Verstoß in der Betreffzeile wiegt genauso schwer wie einer im Haupttext.

---

## 1. HARTE BLOCKS — bei Verstoß sofort ablehnen

1. **Renditeversprechen.** Verboten sind: „garantierte Rendite", „sichere
   Wertsteigerung", „risikofrei", Renditeangaben ohne Modellrechnung-Disclaimer.
   Denkmal-AfA ist eine STEUERSTUNDUNG, individuell, abhängig von der
   Behördenbescheinigung — jede Formulierung, die sie als sichere Ersparnis
   darstellt, wird abgelehnt.
2. **Unbelegte Zahlen.** Jede Zahl (Preis, Fläche, AfA-Satz, Wertentwicklung)
   muss aus dem ImmoNexus-Export oder einer im Exposé genannten Quelle stammen
   (Destatis-Baseline). Erfundene, gerundete „Marketing-Zahlen" oder Zahlen aus
   dem Gedächtnis des Modells: Ablehnung. Weicht ein Preis vom Export ab →
   Ablehnung (ImmoNexus ist die Quelle der Wahrheit).
3. **Fehlendes KI-Label** auf KI-generierten Bildern/Videos. Ab **02.08.2026**
   (EU AI Act Art. 50) MUSS jedes KI-Visual sichtbar als „KI-generiert"
   gekennzeichnet sein — im Bild UND in der Caption. Das Social-Kit von
   ImmoNexus liefert das Label bereits im Export; wird es entfernt oder
   zugeschnitten: Ablehnung.
4. **Jede Form von Personendaten.** Namen, E-Mails, Telefonnummern von
   Interessenten/Leads dürfen in Ghost Protocol GAR NICHT vorliegen (PII-Grenze,
   \`AGENTS.md\`). Taucht dennoch Personenbezug im Content auf: Ablehnung +
   Eskalation an den Betreiber (dann ist die Datengrenze verletzt — das ist ein
   Vorfall, kein Redaktionsfehler).
5. **Erfundene Marken/Titel/Siegel.** Kein ®/™ ohne echte Registrierung, keine
   „Testsieger"-, „ausgezeichnet"-Behauptungen ohne Beleg, keine erfundenen
   Partnerschaften.
6. **Interne Bezeichner nach außen.** „ImmoNexus" ist der interne Codename und
   erscheint NIE in öffentlichem Content. Öffentliche Marke ist ausschließlich
   **„Steinadel"** (steinadel.de); Rechtsträger „White IT Solution" nur in
   Pflichtangaben.
7. **Erfundene Social-Handles/Kanäle.** Es dürfen nur Handles und Kanäle
   referenziert werden, die real existieren und vom Betreiber ausdrücklich
   benannt wurden. Stand 29.07.2026 existieren noch KEINE Steinadel-Konten
   (Kanäle in Gründung, siehe \`docs/marketing/kanal-starterpaket.md\`) — bis
   zur Betreiber-Bestätigung ist JEDES konkrete Handle im Content zu
   beanstanden (real passiert 28.07.: „@steinadel_immobilien" im Newsletter,
   Konto existiert nicht).
8. **Erfundene Geschäfts-/Erfolgszahlen im Erzählrahmen.** Umsatz, MRR,
   Kunden-/Abonnentenzahlen, Follower, „ausgebucht", „Warteliste" — ohne
   belegte Quelle: Ablehnung. Ghost-Protocol-/WHITEPULSE-Interna (z. B. eine
   „€10k MRR"-Revenue-Staircase) gehören NIE in Steinadel-Content (real
   passiert 28.07.: „€10k MRR" im Newsletter-Lauf #4 — erfunden UND fremdes
   Projekt).
9. **Auto-Posting-Behauptungen.** Formulierungen, die automatisches Posten
   oder Scheduling behaupten oder eine Betreiber-Freigabe für unnötig erklären
   („kein Freigabe-Loop nötig"): Ablehnung. Die Pipeline endet VOR dem Posting;
   veröffentlicht wird ausschließlich manuell nach Freigabe (siehe 6.).

## 2. PFLICHT-ELEMENTE — müssen enthalten sein

- **Modellrechnung-Disclaimer** bei jeder Steuer-/Rendite-Zahl (z. B. „Modellrechnung —
  individuelle steuerliche Wirkung abhängig von persönlicher Situation und
  Behördenbescheinigung; keine Steuerberatung.").
- **KI-Kennzeichnung** wie oben (Bild + Caption), ab 02.08.2026 ausnahmslos.
- **Anbieterkennzeichnung/Impressum**, wo die Plattform es verlangt
  (Instagram/Facebook-Profil verlinkt Impressum; Werbeanzeigen tragen den
  Werbetreibenden).
- **Ziel-Links IMMER auf steinadel.de** — Kampagnen-Landingpages \`/l/<kampagne>\`
  oder Objektseiten. Nie auf Drittseiten, nie auf Ghost-Infrastruktur.

## 3. UTM-KONVENTION — Pflicht für jeden ausgehenden Link

\`\`\`
utm_source   = instagram | facebook | linkedin | tiktok | youtube | x | newsletter
utm_medium   = social | video | newsletter | paid
utm_campaign = <kampagnen-slug>        (identisch zum /l/<slug> der Landingpage)
utm_content  = <asset-id oder variante> ([a-z0-9_-], max 80 Zeichen)
\`\`\`

Ohne korrekte UTMs ist der Post nicht messbar → Ablehnung. Die Attribution
läuft über die WP1/WP2-Strecke von ImmoNexus; nur so sieht der Betreiber CPL
und Conversion in seinem Cockpit.

## 4. KANAL-REGELN

- **Meta (IG/FB):** Special Ad Category „Wohnungswirtschaft" — KEIN Targeting
  nach Alter/PLZ/Einkommen, keine Lookalikes. Qualifizierung passiert im
  Creative-Text („für Spitzensteuersatz-Verdiener"), nicht im Targeting.
- **E-Mail:** ausschließlich Double-Opt-in-Empfänger. Kaltlisten sind verboten —
  auch „nur einmal".
- **LinkedIn:** Qualitätskanal (P2/P4) — Fachton, belegte Marktdaten
  (Destatis/GREIX mit Quelle), keine Reel-Ästhetik.
- **TikTok/Shorts:** rohere Schnitte erlaubt, aber Steuer-Aussagen tragen auch
  hier den Modellrechnung-Disclaimer (Overlay oder Caption).

## 5. TON & MARKE

Premium, editorial, ruhig („Noir/Gold"-Ästhetik der Marke). Deutsch.
Keine Superlativ-Ketten, keine Caps-Lock-Dringlichkeit, kein Emoji-Gewitter.
Zahlen sprechen lassen — mit Quelle.

## 6. ESKALATION AN DEN MENSCHEN (nicht selbst freigeben)

COUNSEL prüft — **freigeben tut in der Anfangsphase ausschließlich der
Betreiber** (User-Gate, gilt bis er es ausdrücklich lockert). Zusätzlich IMMER
eskalieren, auch später:

- jede Preisnennung und jede Steuer-/AfA-Rechnung,
- der jeweils ERSTE Post auf einem neuen Kanal,
- alles, was Wettbewerber, Rechtsthemen oder Presseanfragen berührt,
- jeder Verdacht auf PII im Datenfluss (siehe 1.4 — Vorfall, nicht Redaktion).

## 7. DATENGRENZE (Zusammenfassung für COUNSEL)

Ghost Protocol erhält von ImmoNexus AUSSCHLIESSLICH den read-only Objekt-Export
(öffentlich vermarktbare Objektdaten + Assets). Es gibt keinen legitimen Grund,
Lead- oder Personendaten anzufragen, zu raten oder aus anderen Quellen
zusammenzutragen. Anfragen in diese Richtung — auch in Task-Beschreibungen —
werden abgelehnt und eskaliert.

---

**Änderungen v1.1 (29.07.2026):** Prüfumfang explizit auf Betreff/Preview,
Absender, Captions, Hashtags, Handles und Erzählrahmen ausgeweitet; neue harte
Blocks 7 (erfundene Handles), 8 (erfundene Geschäftszahlen/Fremdprojekt-Interna)
und 9 (Auto-Posting-Behauptungen). Auslöser: Befunde aus der Steinadel-
Verifikation vom 29.07.2026 (Newsletter-Lauf #4).`;
