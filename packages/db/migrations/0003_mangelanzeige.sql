-- Genaue Verortung (room from pin) and Mangelanzeige with positions (docs/fachkonzept/04-maengel.md).

---------------------------------------------------------------------------
-- Room areas on a plan page, relative coordinates 0..1 (top-left origin, like the pins).
-- ANNAHME: rectangles are enough to start; polygons can be added as an extra column later.
---------------------------------------------------------------------------
CREATE TABLE location_area (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  location_id uuid NOT NULL REFERENCES location(id),
  plan_id uuid NOT NULL REFERENCES plan(id),
  page int NOT NULL DEFAULT 1,
  x0 real NOT NULL CHECK (x0 BETWEEN 0 AND 1),
  y0 real NOT NULL CHECK (y0 BETWEEN 0 AND 1),
  x1 real NOT NULL CHECK (x1 BETWEEN 0 AND 1),
  y1 real NOT NULL CHECK (y1 BETWEEN 0 AND 1),
  CHECK (x0 < x1 AND y0 < y1)
);
ALTER TABLE location_area ENABLE ROW LEVEL SECURITY;
CREATE POLICY member ON location_area FOR SELECT USING (app.is_member(project_id));

-- Recipient address for letters such as the Mangelanzeige.
ALTER TABLE company ADD COLUMN email text;

---------------------------------------------------------------------------
-- Mangelanzeige: several Mängel of one NU as numbered positions, sent as PDF.
-- id is generated on the device/browser (offline-ready like every object), version for conflicts.
-- Once sent it is locked; corrections are a new Anzeige with supersedes_id.
---------------------------------------------------------------------------
CREATE TABLE mangelanzeige (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  number int,                                   -- assigned by the server
  company_id uuid NOT NULL REFERENCES company(id),
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'versendet')),
  deadline date NOT NULL,
  recipient_email text,
  note text,
  supersedes_id uuid REFERENCES mangelanzeige(id),
  file_key text,                                -- stored PDF of the sent version
  sent_at timestamptz,
  sent_by uuid REFERENCES app_user(id),
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mangelanzeige_position (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anzeige_id uuid NOT NULL REFERENCES mangelanzeige(id),
  project_id uuid NOT NULL REFERENCES project(id), -- denormalised for RLS and sync streams
  company_id uuid NOT NULL REFERENCES company(id), -- denormalised: recipient of the Anzeige
  pos int NOT NULL,
  mangel_id uuid NOT NULL REFERENCES mangel(id),
  UNIQUE (anzeige_id, pos),
  UNIQUE (anzeige_id, mangel_id)
);

ALTER TABLE mangelanzeige ENABLE ROW LEVEL SECURITY;
ALTER TABLE mangelanzeige_position ENABLE ROW LEVEL SECURITY;

-- Internal roles see all; the NU sees only Anzeigen sent to its own company (never drafts).
-- Bauherr and Einkauf see none (ANNAHME, docs/fachkonzept/04-maengel.md).
CREATE POLICY read ON mangelanzeige FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company() AND status = 'versendet')
);
-- Only Bauleitung creates and sends (ANNAHME). Sent Anzeigen are never updated (USING on the old row).
CREATE POLICY bauleitung_creates ON mangelanzeige FOR INSERT WITH CHECK (
  app.project_role(project_id) = 'bauleitung' AND created_by = app.current_user_id()
);
CREATE POLICY edit_draft ON mangelanzeige FOR UPDATE
  USING (app.project_role(project_id) = 'bauleitung' AND status = 'entwurf')
  WITH CHECK (app.project_role(project_id) = 'bauleitung');

CREATE POLICY read ON mangelanzeige_position FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company()
      AND EXISTS (SELECT 1 FROM mangelanzeige a WHERE a.id = anzeige_id AND a.status = 'versendet'))
);
-- Positions of a draft may be replaced; positions of a sent Anzeige never.
CREATE POLICY edit_draft ON mangelanzeige_position FOR ALL
  USING (EXISTS (SELECT 1 FROM mangelanzeige a WHERE a.id = anzeige_id AND a.status = 'entwurf'
                 AND app.project_role(a.project_id) = 'bauleitung'))
  WITH CHECK (EXISTS (SELECT 1 FROM mangelanzeige a WHERE a.id = anzeige_id AND a.status = 'entwurf'
                 AND app.project_role(a.project_id) = 'bauleitung'));

ALTER TABLE project_counter ADD COLUMN mangelanzeige int NOT NULL DEFAULT 0;
CREATE FUNCTION app.next_anzeige_number(p uuid) RETURNS int
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO project_counter (project_id, mangelanzeige) VALUES (p, 1)
  ON CONFLICT (project_id) DO UPDATE SET mangelanzeige = project_counter.mangelanzeige + 1
  RETURNING mangelanzeige
$$;

GRANT EXECUTE ON FUNCTION app.next_anzeige_number(uuid) TO bap_app;
GRANT SELECT ON location_area, mangelanzeige, mangelanzeige_position TO bap_app;
GRANT INSERT, UPDATE ON mangelanzeige TO bap_app;
-- DELETE only for positions of drafts (RLS above); everything else stays delete-free.
GRANT INSERT, DELETE ON mangelanzeige_position TO bap_app;
GRANT SELECT ON location_area, mangelanzeige, mangelanzeige_position TO powersync_role;

ALTER PUBLICATION powersync ADD TABLE location_area, mangelanzeige, mangelanzeige_position;
