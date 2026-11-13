-- Fotodokumentation on plans (decided 12.11.2026, docs/fachkonzept/16): photos of things that will be closed later
-- (walls, shafts, raised floors, cavity ceilings, installations) with a pin on the plan, category and room.
-- 360° photos (e.g. Insta360 export, equirectangular 2:1) are marked and shown in a panorama viewer.
-- Internal only (Bau-/Projektleitung, Polier). ANNAHME: Bauherr and NU do not see the Fotodoku (offene-punkte D13).
CREATE TABLE foto_doku (
  id uuid PRIMARY KEY,                       -- created on the device (offline)
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  plan_id uuid REFERENCES plan(id),
  pin_page int,
  pin_x double precision CHECK (pin_x BETWEEN 0 AND 1),
  pin_y double precision CHECK (pin_y BETWEEN 0 AND 1),
  location_id uuid REFERENCES location(id),
  gewerk_id uuid REFERENCES gewerk(id),
  kategorie text NOT NULL DEFAULT 'sonstiges',
  titel text,
  notiz text,
  ist_360 boolean NOT NULL DEFAULT false,
  file_key text,                             -- null until the file is uploaded
  width int,
  height int,
  taken_at timestamptz NOT NULL DEFAULT now(),
  mangel_id uuid REFERENCES mangel(id),      -- Mangel made from this photo
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app_user(id)
);
CREATE INDEX ON foto_doku (project_id, plan_id) WHERE deleted_at IS NULL;
CREATE INDEX ON foto_doku (project_id, taken_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE foto_doku ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesen ON foto_doku FOR SELECT USING (app.is_internal(project_id));
CREATE POLICY anlegen ON foto_doku FOR INSERT WITH CHECK (app.is_internal(project_id) AND created_by = app.current_user_id());
CREATE POLICY bearbeiten ON foto_doku FOR UPDATE USING (app.is_internal(project_id)) WITH CHECK (app.is_internal(project_id));
GRANT SELECT, INSERT, UPDATE ON foto_doku TO bap_app;

ALTER PUBLICATION powersync ADD TABLE foto_doku;
