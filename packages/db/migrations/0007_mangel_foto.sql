-- Photos of a Mangel (docs/fachkonzept/04): "mangel" = what was found on site, "nachweis" = proof of the fix (NU).
-- Visibility follows the Mangel: whoever may see the Mangel sees its photos (RLS on mangel applies in the subquery).
CREATE TABLE mangel_foto (
  id uuid PRIMARY KEY,                       -- generated on the device (offline)
  mangel_id uuid NOT NULL REFERENCES mangel(id),
  project_id uuid NOT NULL REFERENCES project(id),
  kind text NOT NULL DEFAULT 'mangel' CHECK (kind IN ('mangel', 'nachweis')),
  file_key text NOT NULL,
  width int,
  height int,
  taken_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mangel_foto_mangel ON mangel_foto (mangel_id);
ALTER TABLE mangel_foto ENABLE ROW LEVEL SECURITY;

CREATE POLICY read ON mangel_foto FOR SELECT USING (EXISTS (SELECT 1 FROM mangel m WHERE m.id = mangel_id));
-- Anyone who sees the Mangel may add a photo (Polier on site, NU as proof, Bauherr to own reports). Never delete.
CREATE POLICY add ON mangel_foto FOR INSERT WITH CHECK (
  created_by = app.current_user_id() AND EXISTS (SELECT 1 FROM mangel m WHERE m.id = mangel_id AND m.project_id = project_id)
);

GRANT SELECT, INSERT ON mangel_foto TO bap_app;
GRANT SELECT ON mangel_foto TO powersync_role;
ALTER PUBLICATION powersync ADD TABLE mangel_foto;
