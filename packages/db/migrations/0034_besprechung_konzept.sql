-- NU-Besprechung according to the user's concept (NU-Besprechung_Konzept_5, 12.11.2026).
-- Statuses BLOCKIERT / WICHTIG / IN ARBEIT / ERLEDIGT / NICHT FÄLLIG (old: offen → in_arbeit, info → nicht_faellig).
ALTER TABLE besprechung_punkt DROP CONSTRAINT besprechung_punkt_status_check;
UPDATE besprechung_punkt SET status = CASE status WHEN 'offen' THEN 'in_arbeit' WHEN 'info' THEN 'nicht_faellig' ELSE status END;
UPDATE besprechung_eintrag SET status_snapshot = CASE status_snapshot WHEN 'offen' THEN 'in_arbeit' WHEN 'info' THEN 'nicht_faellig' ELSE status_snapshot END;
ALTER TABLE besprechung_punkt ALTER COLUMN status SET DEFAULT 'in_arbeit';
ALTER TABLE besprechung_punkt ADD CONSTRAINT besprechung_punkt_status_check CHECK (status IN ('blockiert', 'wichtig', 'in_arbeit', 'erledigt', 'nicht_faellig'));

-- Point fields of the concept: contact of the firm, note/dependency, share and check of the own firm ("WHB").
ALTER TABLE besprechung_punkt ADD COLUMN kontakt text, ADD COLUMN notiz text, ADD COLUMN eigen_anteil text, ADD COLUMN kontrolle text;

-- Sub-tasks of supporting firms (or the own firm: company_id NULL) with their own status and due date.
-- support_company_ids of the Punkt is kept in sync by the API (NU visibility relies on it).
CREATE TABLE besprechung_teilaufgabe (
  id uuid PRIMARY KEY,
  punkt_id uuid NOT NULL REFERENCES besprechung_punkt(id),
  project_id uuid NOT NULL REFERENCES project(id),
  company_id uuid REFERENCES company(id),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'in_arbeit' CHECK (status IN ('blockiert', 'wichtig', 'in_arbeit', 'erledigt', 'nicht_faellig')),
  due_date date,
  sort int NOT NULL DEFAULT 0
);
CREATE INDEX ON besprechung_teilaufgabe (punkt_id);
ALTER TABLE besprechung_teilaufgabe ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON besprechung_teilaufgabe FOR SELECT USING (EXISTS (SELECT 1 FROM besprechung_punkt p WHERE p.id = punkt_id)); -- RLS on punkt applies
CREATE POLICY write ON besprechung_teilaufgabe FOR ALL USING (app.is_internal(project_id)) WITH CHECK (app.is_internal(project_id));
CREATE POLICY modul ON besprechung_teilaufgabe AS RESTRICTIVE FOR ALL USING (app.has_module(project_id, 'besprechungen')) WITH CHECK (app.has_module(project_id, 'besprechungen'));
GRANT SELECT, INSERT, UPDATE, DELETE ON besprechung_teilaufgabe TO bap_app;
GRANT SELECT ON besprechung_teilaufgabe TO powersync_role;
ALTER PUBLICATION powersync ADD TABLE besprechung_teilaufgabe;

-- Protokollkopf, general information, manual participants and recipients of a meeting.
ALTER TABLE besprechung ADD COLUMN protokollfuehrung text, ADD COLUMN dokumentenstand text,
  ADD COLUMN allgemein jsonb NOT NULL DEFAULT '[]', ADD COLUMN extra_teilnehmer jsonb NOT NULL DEFAULT '[]', ADD COLUMN cc text;

-- Fixed distribution list of the project (Projektleiter, Bauleiter, Poliere, sonstige Beteiligte) and the mail template.
CREATE TABLE besprechung_verteiler (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project(id),
  name text NOT NULL,
  email text NOT NULL,
  kategorie text NOT NULL DEFAULT 'sonstige' CHECK (kategorie IN ('projektleiter', 'bauleiter', 'poliere', 'sonstige')),
  aktiv boolean NOT NULL DEFAULT true
);
ALTER TABLE besprechung_verteiler ENABLE ROW LEVEL SECURITY;
CREATE POLICY intern ON besprechung_verteiler FOR SELECT USING (app.is_internal(project_id));
CREATE POLICY leitung ON besprechung_verteiler FOR ALL USING (app.is_leitung(project_id)) WITH CHECK (app.is_leitung(project_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON besprechung_verteiler TO bap_app;
ALTER TABLE project ADD COLUMN mail_vorlage jsonb;
GRANT UPDATE (mail_vorlage) ON project TO bap_app;
