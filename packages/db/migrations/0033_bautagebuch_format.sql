-- Bautagebuch in the company format (template "Vorlage_Bautagesbericht", 12.11.2026):
-- header with logo, Blatt-Nr., Baumaßnahme, Bauort, Baustellen-Nr., Bauherr; Arbeitseinsatz (Uhrzeit, Aufsicht,
-- Arbeiter); several weather readings; NU table (Firma, Gewerk, Anzahl); Besuche and Anordnungen.
ALTER TABLE project ADD COLUMN bauort text, ADD COLUMN baustellen_nr text, ADD COLUMN bauherr_name text;
GRANT UPDATE (bauort, baustellen_nr, bauherr_name) ON project TO bap_app;
ALTER TABLE company ADD COLUMN logo_key text, ADD COLUMN kurzname text;
GRANT UPDATE (logo_key, kurzname) ON company TO bap_app;
ALTER TABLE tagesbericht
  ADD COLUMN blatt_nr int,
  ADD COLUMN einsatz jsonb NOT NULL DEFAULT '{}',   -- {von, bis, aufsicht, arbeiter}
  ADD COLUMN besuche text,
  ADD COLUMN anordnungen text;
UPDATE tagesbericht t SET blatt_nr = x.n FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY datum) AS n FROM tagesbericht) x WHERE x.id = t.id;
-- The administrator maintains the own company (logo for reports, short name e.g. "WHB").
CREATE POLICY admin_own ON company FOR UPDATE USING (app.is_admin() AND tenant_id = app.user_tenant() AND kind = 'own')
  WITH CHECK (app.is_admin() AND tenant_id = app.user_tenant() AND kind = 'own');
