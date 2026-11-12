-- Rights per person (decided 12.11.2026): the role sets what someone may do; in addition single areas can be
-- switched off per project member (Admin, Bau-/Projektleitung, NU firm admin for own staff).
-- ANNAHME: switches only take rights away, they never add more than the role allows.
-- Enforced with RESTRICTIVE policies (AND-ed with the existing ones) and mirrored in the sync rules.

ALTER TABLE project_member
  ADD COLUMN m_plaene boolean NOT NULL DEFAULT true,
  ADD COLUMN m_dokumente boolean NOT NULL DEFAULT true,
  ADD COLUMN m_besprechungen boolean NOT NULL DEFAULT true,
  ADD COLUMN m_bautagebuch boolean NOT NULL DEFAULT true,
  ADD COLUMN m_stunden boolean NOT NULL DEFAULT true,
  ADD COLUMN m_nachtraege boolean NOT NULL DEFAULT true,
  ADD COLUMN m_kosten boolean NOT NULL DEFAULT true;

-- Fahrtenbuch is assigned per person by the administrator (not every employee drives company vehicles).
ALTER TABLE app_user ADD COLUMN fahrtenbuch boolean NOT NULL DEFAULT false;

CREATE FUNCTION app.has_module(p uuid, m text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT CASE m WHEN 'plaene' THEN m_plaene WHEN 'dokumente' THEN m_dokumente WHEN 'besprechungen' THEN m_besprechungen
                  WHEN 'bautagebuch' THEN m_bautagebuch WHEN 'stunden' THEN m_stunden WHEN 'nachtraege' THEN m_nachtraege
                  WHEN 'kosten' THEN m_kosten ELSE true END
    FROM project_member WHERE project_id = p AND user_id = app.current_user_id()), true)  -- admins without membership: everything
$$;

CREATE FUNCTION app.has_fahrtenbuch() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_user WHERE id = app.current_user_id() AND (fahrtenbuch OR is_admin))
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('plan', 'plaene'), ('plan_revision', 'plaene'),
    ('folder', 'dokumente'), ('document', 'dokumente'), ('document_revision', 'dokumente'),
    ('besprechung', 'besprechungen'), ('besprechung_punkt', 'besprechungen'), ('besprechung_teilnehmer', 'besprechungen'), ('besprechung_eintrag', 'besprechungen'),
    ('tagesbericht', 'bautagebuch'), ('tagesbericht_nachtrag', 'bautagebuch'), ('tagesbericht_foto', 'bautagebuch'),
    ('stundenzettel', 'stunden'), ('stundenzettel_zeile', 'stunden'),
    ('einreichung', 'nachtraege')
  ) AS t(tbl, modul) LOOP
    EXECUTE format('CREATE POLICY modul ON %I AS RESTRICTIVE FOR ALL USING (app.has_module(project_id, %L)) WITH CHECK (app.has_module(project_id, %L))', r.tbl, r.modul, r.modul);
  END LOOP;
END $$;

CREATE POLICY fahrtenbuch ON fahrt AS RESTRICTIVE FOR INSERT WITH CHECK (app.has_fahrtenbuch());
CREATE POLICY fahrtenbuch ON tankvorgang AS RESTRICTIVE FOR INSERT WITH CHECK (app.has_fahrtenbuch());

-- Leitung changes roles and switches of members (incl. the own NU staff for the NU firm admin, checked in the API).
GRANT UPDATE (role, m_plaene, m_dokumente, m_besprechungen, m_bautagebuch, m_stunden, m_nachtraege, m_kosten) ON project_member TO bap_app;
GRANT UPDATE (fahrtenbuch) ON app_user TO bap_app;

-- Contacts of a firm on site (Vorarbeiter, Monteure): callable from the app. Maintained by the firm itself
-- (on sign-up / in the portal) and by the Leitung. Visible to the own staff of the tenant and to the firm itself.
CREATE TABLE company_kontakt (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  company_id uuid NOT NULL REFERENCES company(id),
  name text NOT NULL,
  funktion text,
  telefon text,
  email text,
  aktiv boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON company_kontakt (company_id);
ALTER TABLE company_kontakt ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesen ON company_kontakt FOR SELECT USING (
  tenant_id = app.user_tenant() AND (app.is_own_staff() OR company_id = (SELECT company_id FROM app_user WHERE id = app.current_user_id())));
CREATE POLICY schreiben ON company_kontakt FOR INSERT WITH CHECK (
  tenant_id = app.user_tenant() AND (app.is_leitung_any() OR company_id = (SELECT company_id FROM app_user WHERE id = app.current_user_id())));
CREATE POLICY aendern ON company_kontakt FOR UPDATE USING (
  tenant_id = app.user_tenant() AND (app.is_leitung_any() OR company_id = (SELECT company_id FROM app_user WHERE id = app.current_user_id())));
GRANT SELECT, INSERT, UPDATE ON company_kontakt TO bap_app;
GRANT SELECT ON company_kontakt TO powersync_role;
ALTER PUBLICATION powersync ADD TABLE company_kontakt;

-- NU firm admin switches areas of the own staff (role stays nu; checked again in the API).
CREATE POLICY firmenadmin_changes ON project_member FOR UPDATE
  USING (app.is_company_admin() AND app.project_role(project_id) = 'nu' AND role = 'nu' AND company_id = app.user_company())
  WITH CHECK (app.is_company_admin() AND role = 'nu' AND company_id = app.user_company());
