-- Admin access and NU firm admins (decided 12.11.2026).
-- * Administrator (app_user.is_admin): sees and manages everything of the own company (tenant): all projects
--   with Bauleitung rights, all users (lock/unlock, admin rights). Implemented in app.project_role(), so every
--   existing policy applies unchanged.
-- * Firmen-Admin (app_user.company_admin): a NU firm's admin invites further people of his own firm (or helpers
--   working for it) into the projects his firm belongs to – always with the role Nachunternehmer of his firm.

ALTER TABLE app_user ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE app_user ADD COLUMN company_admin boolean NOT NULL DEFAULT false;

CREATE FUNCTION app.is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_admin AND active FROM app_user WHERE id = app.current_user_id()), false)
$$;

CREATE OR REPLACE FUNCTION app.project_role(p uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT CASE role WHEN 'projektleitung' THEN 'bauleitung' ELSE role END
       FROM project_member WHERE project_id = p AND user_id = app.current_user_id()),
    (SELECT 'bauleitung' FROM project pr JOIN app_user u ON u.id = app.current_user_id()
      WHERE pr.id = p AND pr.tenant_id = u.tenant_id AND u.is_admin AND u.active)
  )
$$;

CREATE OR REPLACE FUNCTION app.is_leitung_any() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.is_admin() OR EXISTS (SELECT 1 FROM project_member WHERE user_id = app.current_user_id() AND role IN ('bauleitung', 'projektleitung'))
$$;

-- Admin sees all users and companies of the tenant and changes users (lock, admin flags).
CREATE POLICY admin_reads ON app_user FOR SELECT USING (app.is_admin() AND tenant_id = app.user_tenant());
CREATE POLICY admin_edits ON app_user FOR UPDATE USING (app.is_admin() AND tenant_id = app.user_tenant()) WITH CHECK (tenant_id = app.user_tenant());
CREATE POLICY admin_reads ON company FOR SELECT USING (app.is_admin() AND tenant_id = app.user_tenant());
GRANT UPDATE (active, is_admin, company_admin, name) ON app_user TO bap_app;

-- Firm admin of a NU: invitations and direct adds for the own firm, role nu only, in projects of the firm.
CREATE FUNCTION app.is_company_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT company_admin AND active FROM app_user WHERE id = app.current_user_id()), false)
$$;
CREATE POLICY firmenadmin_invites ON einladung FOR INSERT WITH CHECK (
  app.is_company_admin() AND app.project_role(project_id) = 'nu' AND role = 'nu'
  AND company_id = app.user_company() AND invited_by = app.current_user_id()
);
CREATE POLICY firmenadmin_reads ON einladung FOR SELECT USING (app.is_company_admin() AND company_id = app.user_company());
CREATE POLICY firmenadmin_revokes ON einladung FOR UPDATE USING (app.is_company_admin() AND company_id = app.user_company())
  WITH CHECK (company_id = app.user_company());
CREATE POLICY firmenadmin_adds ON project_member FOR INSERT WITH CHECK (
  app.is_company_admin() AND app.project_role(project_id) = 'nu' AND role = 'nu'
  AND company_id = app.user_company() AND company_id = (SELECT u.company_id FROM app_user u WHERE u.id = user_id)
);
CREATE POLICY firmenadmin_removes ON project_member FOR DELETE USING (
  app.is_company_admin() AND company_id = app.user_company() AND role = 'nu' AND user_id <> app.current_user_id()
);

GRANT EXECUTE ON FUNCTION app.is_admin(), app.is_company_admin() TO bap_app;
