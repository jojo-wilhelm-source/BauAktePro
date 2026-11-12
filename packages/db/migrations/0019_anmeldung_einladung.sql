-- Real sign-in (docs/fachkonzept/01, docs/tech-stack.md): Better Auth keeps passwords and sessions in our Postgres.
-- Better Auth talks to these tables through the admin connection (it is the identity layer, below RLS);
-- the API itself keeps using asUser().

ALTER TABLE app_user ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE app_user ADD COLUMN image text;
ALTER TABLE app_user ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app_user ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
-- Locked accounts cannot sign in or refresh (e.g. person left the company).
ALTER TABLE app_user ADD COLUMN active boolean NOT NULL DEFAULT true;

CREATE TABLE auth_session (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_session_user ON auth_session (user_id);

CREATE TABLE auth_account (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_account_user ON auth_account (user_id);

CREATE TABLE auth_verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verification_identifier ON auth_verification (identifier);

-- No API access to credentials at all.
REVOKE ALL ON auth_session, auth_account, auth_verification FROM bap_app, powersync_role;

---------------------------------------------------------------------------
-- Einladungen: the Leitung invites people into a project with a role. The link carries a random token;
-- only its SHA-256 hash is stored. Valid 14 days, single use, revocable.
---------------------------------------------------------------------------
CREATE TABLE einladung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  email text NOT NULL,
  name text,
  role text NOT NULL CHECK (role IN ('bauleitung', 'projektleitung', 'polier', 'nu', 'bauherr', 'einkauf')),
  company_id uuid NOT NULL REFERENCES company(id),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES app_user(id),
  revoked_at timestamptz
);
ALTER TABLE einladung ENABLE ROW LEVEL SECURITY;
CREATE POLICY leitung_read ON einladung FOR SELECT USING (app.is_leitung(project_id));
CREATE POLICY leitung_invite ON einladung FOR INSERT WITH CHECK (app.is_leitung(project_id) AND invited_by = app.current_user_id());
CREATE POLICY leitung_revoke ON einladung FOR UPDATE USING (app.is_leitung(project_id)) WITH CHECK (app.is_leitung(project_id));
GRANT SELECT, INSERT, UPDATE ON einladung TO bap_app;

-- Leitung adds members of any company that belongs to the project (own staff, NU firm, Bauherr) and removes them.
DROP POLICY leitung_adds_staff ON project_member;
CREATE POLICY leitung_adds ON project_member FOR INSERT WITH CHECK (
  app.is_leitung(project_id)
  AND company_id = (SELECT u.company_id FROM app_user u WHERE u.id = user_id)
  AND (
    company_id IN (SELECT id FROM company WHERE kind = 'own' AND tenant_id = app.user_tenant())
    OR company_id IN (SELECT pc.company_id FROM project_company pc WHERE pc.project_id = project_member.project_id)
  )
);
-- Nobody removes himself (a project must never end up without Leitung by accident).
CREATE POLICY leitung_removes ON project_member FOR DELETE USING (app.is_leitung(project_id) AND user_id <> app.current_user_id());
CREATE POLICY leitung_changes_role ON project_member FOR UPDATE USING (app.is_leitung(project_id) AND user_id <> app.current_user_id())
  WITH CHECK (app.is_leitung(project_id));
GRANT UPDATE, DELETE ON project_member TO bap_app;
-- Bauherr companies can be created by the Leitung like NU firms (for inviting the Bauherr).
DROP POLICY add_nu ON company;
CREATE POLICY add_partner ON company FOR INSERT WITH CHECK (
  kind IN ('nu', 'bauherr') AND tenant_id = app.user_tenant() AND app.is_leitung_any()
);
