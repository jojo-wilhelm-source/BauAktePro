-- Projects and their structure (docs/fachkonzept/01, 02): create projects, take over the structure of an
-- earlier project (Orte, Gewerke, Ordner, Nachunternehmer, own team) and edit it afterwards.
-- ANNAHME (offene-punkte D8): Bau- und Projektleitung of the own company may create projects; the
-- creator becomes Bauleitung (or Projektleitung, if that is his role elsewhere).

ALTER TABLE project ADD COLUMN created_by uuid REFERENCES app_user(id);
ALTER TABLE project ADD COLUMN address text;

-- Creating a project needs two rows in one step (project + creator membership); RLS on project would hide
-- the new row before the membership exists, so this one step is a checked SECURITY DEFINER function.
CREATE FUNCTION app.create_project(p_id uuid, p_name text, p_address text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := app.current_user_id();
BEGIN
  IF me IS NULL OR NOT app.is_own_staff() OR NOT app.is_leitung_any() THEN
    RAISE EXCEPTION 'Projekte legen Bau- und Projektleitung an' USING ERRCODE = '42501';
  END IF;
  IF length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'Name fehlt' USING ERRCODE = '22023'; END IF;
  INSERT INTO project (id, tenant_id, name, address, created_by) VALUES (p_id, app.user_tenant(), trim(p_name), p_address, me);
  INSERT INTO project_member (project_id, user_id, company_id, role)
  SELECT p_id, u.id, u.company_id,
         CASE WHEN EXISTS (SELECT 1 FROM project_member pm WHERE pm.user_id = me AND pm.role = 'projektleitung') THEN 'projektleitung' ELSE 'bauleitung' END
  FROM app_user u WHERE u.id = me;
END $$;

-- Structure: Leitung edits Orte and Gewerke; deleting is refused by the foreign keys while something uses them.
CREATE POLICY leitung_write ON location FOR INSERT WITH CHECK (app.is_leitung(project_id));
CREATE POLICY leitung_edit ON location FOR UPDATE USING (app.is_leitung(project_id)) WITH CHECK (app.is_leitung(project_id));
CREATE POLICY leitung_delete ON location FOR DELETE USING (app.is_leitung(project_id));
CREATE POLICY leitung_write ON gewerk FOR INSERT WITH CHECK (app.is_leitung(project_id));
CREATE POLICY leitung_delete ON gewerk FOR DELETE USING (app.is_leitung(project_id));
CREATE POLICY leitung_unassign ON gewerk_company FOR DELETE USING (EXISTS (SELECT 1 FROM gewerk g WHERE g.id = gewerk_id AND app.is_leitung(g.project_id)));
CREATE POLICY leitung_rename ON project FOR UPDATE USING (app.is_leitung(id)) WITH CHECK (app.is_leitung(id));
-- Team: the Leitung adds people of the OWN company (other companies get access via their own flow later).
CREATE POLICY leitung_adds_staff ON project_member FOR INSERT WITH CHECK (
  app.is_leitung(project_id)
  AND company_id IN (SELECT id FROM company WHERE kind = 'own' AND tenant_id = app.user_tenant())
  AND company_id = (SELECT u.company_id FROM app_user u WHERE u.id = user_id)
);

GRANT EXECUTE ON FUNCTION app.create_project(uuid, text, text) TO bap_app;
GRANT INSERT, UPDATE, DELETE ON location, gewerk TO bap_app;
GRANT DELETE ON gewerk_company TO bap_app;
GRANT UPDATE ON project TO bap_app;
GRANT INSERT ON project_member TO bap_app;
GRANT UPDATE ON folder TO bap_app;
