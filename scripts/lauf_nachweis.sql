-- ============================================
-- GHOST PROTOCOL — Totmann: Tabelle lauf_nachweis
-- ============================================
-- AUSGEFÜHRT am 07.11.2026 nach Inhaberentscheid (Supabase-Migration create_lauf_nachweis_totmann,
-- Version 20261107094750, Zeilen ab CREATE TABLE wortgleich). Jede spätere Änderung nur als neue
-- Migration nach Inhaberentscheid, nicht durch erneutes Ausführen einer geänderten Fassung.
-- Die Rollenzeilen sind Supabase-spezifisch.
--
-- Quelle: docs/intern/objekt-studio-stufe-2.md §5.5 (b) (Entwurf E-totmann, Uhren korrigiert)
-- und §2.2 Punkt 1. Gelesen von GET /api/status (site/src/app/api/status/route.ts, messeCrons),
-- geschrieben von /api/cron/briefing und /api/content/auto-produce (site/src/lib/lauf-nachweis.ts).
-- Solange die Tabelle fehlt, zeigt das Dashboard „Crons" mit Lesefehler: bernstein, solange
-- alle Jobs laut Plan (site/src/lib/totmann.ts) aus sind; rot, sobald einer aktiv ist.
--
-- Uhren: begonnen_am und beendet_am stammen beide aus der App-Uhr, die DB setzt nur
-- eingetragen_am. Kein CHECK vergleicht App-Uhr mit DB-Uhr (now() oder die Spalte
-- eingetragen_am): Liefe die VPS-Uhr der DB-Uhr voraus, hätte ein solcher CHECK den Insert
-- abgelehnt und der Totmann zu Unrecht „überfällig" gezeigt (§2.2 Punkt 2). Geprüft in
-- site/tests/t-totmann.test.mjs (T-S1; T-R13 wertet genau diese CHECKs mit verschobener DB-Uhr aus).
-- Den Abgleich der Uhren macht der Leser: GET /api/status liest eingetragen_am mit und wertet eine
-- Zeile mit mehr als 10 min Abweichung als unplausibel (site/src/lib/status-server.ts).
--
-- Abweichungen von §5.5 (b) nach der zweiten Prüfung des Branches:
-- - Index auf (job, eingetragen_am DESC) statt (job, begonnen_am DESC): GET /api/status liest je
--   Job die zuletzt eingetragenen Zeilen (DB-Uhr, Gleichstand nach id; Prüfbefunde D1, r3-logik-1).
-- - service_role: erst alle Rechte auf Tabelle und Sequenz entziehen, dann genau SELECT, INSERT
--   und USAGE vergeben (Prüfbefund oeffentlich-3).
-- Alle Anweisungen, CREATE TABLE eingeschlossen, prüft T-S1 als exakte, geordnete Liste.
--
-- Nach der Ausführung messen (§2.5 Live-Abnahme): anonymes Lesen per REST scheitert; die
-- Rechte mit den Abfragen aus §5.5 (a), dort auch für grantee service_role (erwartet: genau
-- INSERT und SELECT auf der Tabelle).
-- ============================================

CREATE TABLE IF NOT EXISTS public.lauf_nachweis (
  id             BIGSERIAL PRIMARY KEY,
  job            TEXT        NOT NULL CHECK (job ~ '^[a-z0-9-]{1,40}$'),
  begonnen_am    TIMESTAMPTZ NOT NULL,                 -- App-Uhr
  beendet_am     TIMESTAMPTZ NOT NULL,                 -- App-Uhr, dieselbe Uhr wie begonnen_am
  eingetragen_am TIMESTAMPTZ NOT NULL DEFAULT now(),   -- DB-Uhr; ordnet die Zeilen beim Lesen
  ergebnis       TEXT        NOT NULL CHECK (ergebnis IN ('ok','teilweise','fehler','uebersprungen')),
  http_status    SMALLINT    CHECK (http_status BETWEEN 100 AND 599),
  teilergebnisse JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(teilergebnisse) = 'array'),
  hinweis        TEXT        CHECK (char_length(hinweis) <= 300),
  CHECK (beendet_am >= begonnen_am)                   -- vergleicht nur Werte derselben Uhr
);
CREATE INDEX IF NOT EXISTS idx_lauf_nachweis_job_eingetragen ON public.lauf_nachweis (job, eingetragen_am DESC);
ALTER TABLE public.lauf_nachweis ENABLE ROW LEVEL SECURITY;
-- absichtlich KEINE Policy: anon und authenticated bekommen nichts
REVOKE ALL ON TABLE public.lauf_nachweis FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.lauf_nachweis_id_seq FROM PUBLIC, anon, authenticated;
-- service_role umgeht RLS: erst alle Rechte entziehen, dann genau lesen und anhängen
-- (auf der Sequenz reicht USAGE für nextval beim Insert)
REVOKE ALL ON TABLE public.lauf_nachweis FROM service_role;
REVOKE ALL ON SEQUENCE public.lauf_nachweis_id_seq FROM service_role;
GRANT SELECT, INSERT ON TABLE public.lauf_nachweis TO service_role;
GRANT USAGE ON SEQUENCE public.lauf_nachweis_id_seq TO service_role;
-- bewusst NICHT: ALTER PUBLICATION supabase_realtime ADD TABLE lauf_nachweis;
