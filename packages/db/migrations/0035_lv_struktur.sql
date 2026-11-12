-- LV in the usual AVA structure (decided 12.11.2026): folders per project (freely named), inside an LV
-- Titel › Untertitel › Position (plus Hinweistexte), OZ numbered automatically; a company-wide library of
-- standard items (Stammleistungen) to assemble LVs quickly.
CREATE TABLE lv_ordner (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project(id),
  parent_id uuid REFERENCES lv_ordner(id),
  name text NOT NULL,
  sort int NOT NULL DEFAULT 0
);
ALTER TABLE lv_ordner ENABLE ROW LEVEL SECURITY;
CREATE POLICY einkauf ON lv_ordner FOR ALL USING (app.is_einkauf_or_leitung(project_id)) WITH CHECK (app.is_einkauf_or_leitung(project_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON lv_ordner TO bap_app;
ALTER TABLE lv ADD COLUMN ordner_id uuid REFERENCES lv_ordner(id);

ALTER TABLE lv_position ADD COLUMN art text NOT NULL DEFAULT 'position' CHECK (art IN ('titel', 'untertitel', 'position', 'text'));
ALTER TABLE lv_position ALTER COLUMN einheit DROP NOT NULL;
ALTER TABLE lv_position ALTER COLUMN menge SET DEFAULT 0;

-- Who works with LVs anywhere in the company (Einkauf, Bau-/Projektleitung, Admin).
CREATE FUNCTION app.is_einkauf_any() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.is_admin() OR EXISTS (SELECT 1 FROM project_member WHERE user_id = app.current_user_id() AND role IN ('bauleitung', 'projektleitung', 'einkauf'))
$$;
CREATE TABLE lv_stammleistung (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kategorie text NOT NULL DEFAULT 'Allgemein',
  kurztext text NOT NULL,
  langtext text,
  einheit text NOT NULL,
  aktiv boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lv_stammleistung ENABLE ROW LEVEL SECURITY;
CREATE POLICY einkauf ON lv_stammleistung FOR ALL USING (tenant_id = app.user_tenant() AND app.is_einkauf_any()) WITH CHECK (tenant_id = app.user_tenant() AND app.is_einkauf_any());
GRANT SELECT, INSERT, UPDATE ON lv_stammleistung TO bap_app;
