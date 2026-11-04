-- Durchstich: tenant, users, companies, projects, locations, gewerke, plans, Mängel, audit log, conflicts.
-- Visibility rules: docs/fachkonzept/01-rollen-rechte.md, 04-maengel.md.
-- The API connects as bap_app and sets app.user_id per transaction; RLS enforces visibility.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

-- Companies: NU firms, the Bauherr organisation, and the own company.
CREATE TABLE company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('own', 'nu', 'bauherr'))
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  company_id uuid NOT NULL REFERENCES company(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Role per project. company_id is denormalised from app_user so sync streams can filter without joins.
CREATE TABLE project_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  company_id uuid NOT NULL REFERENCES company(id),
  role text NOT NULL CHECK (role IN ('bauleitung', 'polier', 'nu', 'bauherr', 'einkauf')),
  UNIQUE (project_id, user_id)
);

-- Ort: Gebäude → Geschoss → Abschnitt → Raum (recursive).
CREATE TABLE location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  parent_id uuid REFERENCES location(id),
  kind text NOT NULL CHECK (kind IN ('gebaeude', 'geschoss', 'abschnitt', 'raum')),
  name text NOT NULL,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE gewerk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  name text NOT NULL
);

CREATE TABLE gewerk_company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gewerk_id uuid NOT NULL REFERENCES gewerk(id),
  company_id uuid NOT NULL REFERENCES company(id),
  UNIQUE (gewerk_id, company_id)
);

-- Plan: only the released index is relevant in the Durchstich (full Dateiablage comes later).
CREATE TABLE plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  location_id uuid NOT NULL REFERENCES location(id),
  name text NOT NULL,
  plan_index text NOT NULL DEFAULT 'A',
  file_key text NOT NULL,
  page_count int NOT NULL DEFAULT 1,
  visible_to_nu boolean NOT NULL DEFAULT true,
  visible_to_bauherr boolean NOT NULL DEFAULT false
);

CREATE TABLE mangel (
  id uuid PRIMARY KEY,                       -- generated on the device (offline)
  project_id uuid NOT NULL REFERENCES project(id),
  location_id uuid NOT NULL REFERENCES location(id),
  gewerk_id uuid NOT NULL REFERENCES gewerk(id),
  number int NOT NULL,                       -- running number per project (M-001)
  description text NOT NULL CHECK (length(trim(description)) > 0),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('kritisch', 'normal', 'gering')),
  status text NOT NULL DEFAULT 'neu'
    CHECK (status IN ('neu', 'zugewiesen', 'in_bearbeitung', 'behoben_gemeldet', 'nicht_behoben', 'abgenommen', 'strittig')),
  due_date date,
  nachfrist_date date,                       -- 2. Nachfrist (docs 04)
  plan_id uuid REFERENCES plan(id),
  pin_page int,
  pin_x double precision CHECK (pin_x BETWEEN 0 AND 1),
  pin_y double precision CHECK (pin_y BETWEEN 0 AND 1),
  assigned_company_id uuid REFERENCES company(id),
  assignment_confirmed boolean NOT NULL DEFAULT false,  -- B1: effective only after Bauleitung confirms
  reporter_company_id uuid NOT NULL REFERENCES company(id),
  visible_to_bauherr boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES app_user(id),
  creator_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,            -- optimistic concurrency / conflict detection
  deleted_at timestamptz,                    -- Papierkorb
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,  -- eigene Felder
  UNIQUE (project_id, number)
);
CREATE INDEX mangel_project_idx ON mangel (project_id) WHERE deleted_at IS NULL;

-- Internal notes live in their own table so Bauherr/NU never receive them (row-level, not column-level).
CREATE TABLE mangel_note (
  id uuid PRIMARY KEY,
  mangel_id uuid NOT NULL REFERENCES mangel(id),
  project_id uuid NOT NULL REFERENCES project(id),
  text text NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit log.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid REFERENCES project(id),
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_user(id),
  device_id text,
  occurred_at timestamptz NOT NULL,          -- when it happened on the device (may be offline)
  recorded_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Offline conflicts: never overwrite silently; keep both and show for resolution.
CREATE TABLE sync_conflict (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_user(id),
  base_version int NOT NULL,
  server_version int NOT NULL,
  client_change jsonb NOT NULL,
  server_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_user(id)
);

---------------------------------------------------------------------------
-- Row Level Security
---------------------------------------------------------------------------

CREATE SCHEMA app;

CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- SECURITY DEFINER helpers so policies can read project_member without recursive RLS.
CREATE FUNCTION app.project_role(p uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM project_member WHERE project_id = p AND user_id = app.current_user_id()
$$;

CREATE FUNCTION app.user_company() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM app_user WHERE id = app.current_user_id()
$$;

CREATE FUNCTION app.is_member(p uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app.project_role(p) IS NOT NULL $$;

CREATE FUNCTION app.is_internal(p uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app.project_role(p) IN ('bauleitung', 'polier') $$;

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE company ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE location ENABLE ROW LEVEL SECURITY;
ALTER TABLE gewerk ENABLE ROW LEVEL SECURITY;
ALTER TABLE gewerk_company ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE mangel ENABLE ROW LEVEL SECURITY;
ALTER TABLE mangel_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflict ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_tenant ON tenant FOR SELECT
  USING (id = (SELECT tenant_id FROM app_user WHERE id = app.current_user_id()));
CREATE POLICY self ON app_user FOR SELECT USING (id = app.current_user_id());
-- Members of a shared project may see each other's names.
CREATE POLICY co_members ON app_user FOR SELECT
  USING (EXISTS (SELECT 1 FROM project_member pm WHERE pm.user_id = app_user.id AND app.is_member(pm.project_id)));
CREATE POLICY visible_companies ON company FOR SELECT
  USING (id = app.user_company()
      OR EXISTS (SELECT 1 FROM project_member pm WHERE pm.company_id = company.id AND app.is_member(pm.project_id)));

CREATE POLICY member ON project FOR SELECT USING (app.is_member(id));
CREATE POLICY member ON project_member FOR SELECT USING (app.is_member(project_id));
CREATE POLICY member ON location FOR SELECT USING (app.is_member(project_id));
CREATE POLICY member ON gewerk FOR SELECT USING (app.is_member(project_id));
CREATE POLICY member ON gewerk_company FOR SELECT
  USING (EXISTS (SELECT 1 FROM gewerk g WHERE g.id = gewerk_id AND app.is_member(g.project_id)));

CREATE POLICY by_role ON plan FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) = 'nu' AND visible_to_nu)
  OR (app.project_role(project_id) = 'bauherr' AND visible_to_bauherr)
);

-- Mängel visibility:
--  internal (Bauleitung, Polier): everything in the project
--  NU: confirmed assignments to the own company, plus Mängel the own company reported
--  Bauherr: released for Bauherr, plus own reports
CREATE POLICY read ON mangel FOR SELECT USING (
  deleted_at IS NULL AND (
    app.is_internal(project_id)
    OR (app.project_role(project_id) = 'nu'
        AND ((assigned_company_id = app.user_company() AND assignment_confirmed) OR reporter_company_id = app.user_company()))
    OR (app.project_role(project_id) = 'bauherr'
        AND (visible_to_bauherr OR reporter_company_id = app.user_company()))
  )
);
-- Bauleitung sees the Papierkorb.
CREATE POLICY trash ON mangel FOR SELECT USING (deleted_at IS NOT NULL AND app.project_role(project_id) = 'bauleitung');
-- Every member may report (NU and Bauherr too); reporter must be the own company.
CREATE POLICY report ON mangel FOR INSERT WITH CHECK (
  app.is_member(project_id) AND created_by = app.current_user_id() AND reporter_company_id = app.user_company()
);
-- Updates: field/transition rules are checked in the API (packages/domain); RLS limits WHICH rows.
CREATE POLICY edit ON mangel FOR UPDATE USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) = 'nu' AND assigned_company_id = app.user_company() AND assignment_confirmed)
  OR (app.project_role(project_id) = 'bauherr' AND created_by = app.current_user_id())
);

CREATE POLICY internal ON mangel_note FOR ALL USING (app.is_internal(project_id)) WITH CHECK (app.is_internal(project_id));

CREATE POLICY bauleitung_reads ON audit_log FOR SELECT USING (app.project_role(project_id) = 'bauleitung');
CREATE POLICY append ON audit_log FOR INSERT WITH CHECK (actor_id = app.current_user_id());

CREATE POLICY involved ON sync_conflict FOR SELECT
  USING (actor_id = app.current_user_id() OR app.project_role(project_id) = 'bauleitung');
CREATE POLICY create_own ON sync_conflict FOR INSERT WITH CHECK (actor_id = app.current_user_id());
CREATE POLICY resolve ON sync_conflict FOR UPDATE USING (app.project_role(project_id) = 'bauleitung');

-- Running number per project, assigned by the server (devices cannot know it offline).
CREATE TABLE project_counter (project_id uuid PRIMARY KEY REFERENCES project(id), mangel int NOT NULL DEFAULT 0);
ALTER TABLE project_counter ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION app.next_mangel_number(p uuid) RETURNS int
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO project_counter (project_id, mangel) VALUES (p, 1)
  ON CONFLICT (project_id) DO UPDATE SET mangel = project_counter.mangel + 1
  RETURNING mangel
$$;

---------------------------------------------------------------------------
-- Grants
---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA app TO bap_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO bap_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bap_app;
GRANT INSERT, UPDATE ON mangel, mangel_note, sync_conflict TO bap_app;
GRANT INSERT ON audit_log TO bap_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO bap_app;
-- No DELETE anywhere: Papierkorb via deleted_at, audit log is append-only.

GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;

-- Publication for PowerSync (name must be "powersync"). Only tables that are synced to devices.
CREATE PUBLICATION powersync FOR TABLE
  project, project_member, company, app_user, location, gewerk, gewerk_company, plan, mangel, mangel_note, sync_conflict;
