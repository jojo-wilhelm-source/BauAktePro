-- Bautagebuch (docs/fachkonzept/07): one Tagesbericht per project and day, written by the Polier (also offline),
-- signed with a finger signature, then locked; additions only as Nachtrag with note. Countersigned by the
-- Bauleitung. Lists (personnel, equipment, work) are JSON so the offline device can edit them as one row.
-- Signatures are stored as strokes ({w,h,strokes:[[[x,y],...]]}, coordinates 0..1) and drawn into the PDF.
-- ANNAHME (offene-punkte C1): signatures document, they are not legally binding until clarified.

CREATE TABLE tagesbericht (
  id uuid PRIMARY KEY,                               -- generated on the device (offline)
  project_id uuid NOT NULL REFERENCES project(id),
  datum date NOT NULL,
  bereich text,
  wetter jsonb NOT NULL DEFAULT '{}',                -- {text, temp_min, temp_max, niederschlag, wind}
  personal jsonb NOT NULL DEFAULT '[]',              -- [{firma, company_id?, anzahl, taetigkeit?}]
  geraete jsonb NOT NULL DEFAULT '[]',               -- [{name, anzahl}]
  leistungen jsonb NOT NULL DEFAULT '[]',            -- [{text, ort?, gewerk?}]
  lieferungen text,
  behinderungen text,
  besonderheiten text,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'unterschrieben')),
  signed_by uuid REFERENCES app_user(id),
  signed_at timestamptz,
  signature jsonb,
  countersigned_by uuid REFERENCES app_user(id),
  countersigned_at timestamptz,
  countersignature jsonb,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, datum)
);
CREATE TABLE tagesbericht_nachtrag (
  id uuid PRIMARY KEY,
  bericht_id uuid NOT NULL REFERENCES tagesbericht(id),
  project_id uuid NOT NULL REFERENCES project(id),
  text text NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tagesbericht_foto (
  id uuid PRIMARY KEY,
  bericht_id uuid NOT NULL REFERENCES tagesbericht(id),
  project_id uuid NOT NULL REFERENCES project(id),
  file_key text NOT NULL,
  caption text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Upload queue of the device (save draft / sign / countersign / Nachtrag), applied only if the report is unchanged.
-- The server keeps each applied action id here, so an action sent twice takes effect once.
CREATE TABLE tagesbericht_action (
  id uuid PRIMARY KEY,
  bericht_id uuid NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  base_version int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tagesbericht ENABLE ROW LEVEL SECURITY;
ALTER TABLE tagesbericht_nachtrag ENABLE ROW LEVEL SECURITY;
ALTER TABLE tagesbericht_foto ENABLE ROW LEVEL SECURITY;
-- Internal roles (Bauleitung, Projektleitung, Polier) read and write; NU and Bauherr do not see it (ANNAHME, offene-punkte D10).
CREATE POLICY intern ON tagesbericht FOR SELECT USING (app.is_internal(project_id));
CREATE POLICY schreiben ON tagesbericht FOR INSERT WITH CHECK (app.is_internal(project_id) AND created_by = app.current_user_id() AND status = 'entwurf');
-- Drafts are edited; a signed report is only countersigned (USING checks the old row).
CREATE POLICY bearbeiten ON tagesbericht FOR UPDATE
  USING (app.is_internal(project_id) AND (status = 'entwurf' OR (countersigned_at IS NULL AND app.is_leitung(project_id))))
  WITH CHECK (app.is_internal(project_id));
CREATE POLICY intern ON tagesbericht_nachtrag FOR SELECT USING (app.is_internal(project_id));
CREATE POLICY schreiben ON tagesbericht_nachtrag FOR INSERT WITH CHECK (app.is_internal(project_id) AND created_by = app.current_user_id());
CREATE POLICY intern ON tagesbericht_foto FOR SELECT USING (app.is_internal(project_id));
CREATE POLICY schreiben ON tagesbericht_foto FOR INSERT WITH CHECK (app.is_internal(project_id) AND created_by = app.current_user_id());

GRANT SELECT, INSERT, UPDATE ON tagesbericht TO bap_app;
GRANT SELECT, INSERT ON tagesbericht_nachtrag, tagesbericht_foto, tagesbericht_action TO bap_app;
GRANT SELECT ON tagesbericht, tagesbericht_nachtrag, tagesbericht_foto TO powersync_role;
ALTER PUBLICATION powersync ADD TABLE tagesbericht, tagesbericht_nachtrag, tagesbericht_foto;
