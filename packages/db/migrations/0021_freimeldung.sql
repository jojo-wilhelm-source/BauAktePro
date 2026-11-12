-- QR-Freimeldung (docs/fachkonzept/04, decided 12.11.2026): every sent Mangelanzeige gets a link/QR code.
-- Whoever has it (e.g. the fitter on site, no account) can report each position as fixed (photo required) or
-- raise a query. The link is valid without time limit; the Leitung can lock, unlock and regenerate it.
-- The Bauleitung then accepts or rejects as usual (Mangel status chain).

CREATE TABLE anzeige_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anzeige_id uuid NOT NULL UNIQUE REFERENCES mangelanzeige(id),
  project_id uuid NOT NULL REFERENCES project(id),
  -- Kept readable (not only hashed) so the Leitung can show/print the QR code again; random 32 bytes.
  token text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE anzeige_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY leitung ON anzeige_link FOR SELECT USING (app.is_leitung(project_id));
CREATE POLICY leitung_creates ON anzeige_link FOR INSERT WITH CHECK (app.is_leitung(project_id) AND created_by = app.current_user_id());
CREATE POLICY leitung_edits ON anzeige_link FOR UPDATE USING (app.is_leitung(project_id)) WITH CHECK (app.is_leitung(project_id));
GRANT SELECT, INSERT, UPDATE ON anzeige_link TO bap_app;

CREATE TABLE freimeldung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  anzeige_id uuid NOT NULL REFERENCES mangelanzeige(id),
  position_id uuid NOT NULL REFERENCES mangelanzeige_position(id),
  mangel_id uuid NOT NULL REFERENCES mangel(id),
  kind text NOT NULL CHECK (kind IN ('behoben', 'rueckfrage')),
  melder_name text NOT NULL,
  melder_firma text NOT NULL,
  kommentar text,
  foto_id uuid REFERENCES mangel_foto(id),
  -- Signed in NU users may use the link too; then we know who it was.
  user_id uuid REFERENCES app_user(id),
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX freimeldung_anzeige ON freimeldung (anzeige_id);
CREATE INDEX freimeldung_mangel ON freimeldung (mangel_id);
ALTER TABLE freimeldung ENABLE ROW LEVEL SECURITY;
-- Internal roles see all; the NU sees those of Anzeigen sent to its own company.
CREATE POLICY read ON freimeldung FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) = 'nu' AND EXISTS (SELECT 1 FROM mangelanzeige a WHERE a.id = anzeige_id AND a.company_id = app.user_company()))
);
GRANT SELECT ON freimeldung TO bap_app;

-- Reports via the link have no app user: audit entries and photos record the name the person typed instead.
ALTER TABLE audit_log ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE audit_log ADD COLUMN actor_label text;
ALTER TABLE audit_log ADD CONSTRAINT audit_actor CHECK (actor_id IS NOT NULL OR actor_label IS NOT NULL);
ALTER TABLE mangel_foto ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE mangel_foto ADD COLUMN created_by_label text;
ALTER TABLE mangel_foto ADD CONSTRAINT foto_creator CHECK (created_by IS NOT NULL OR created_by_label IS NOT NULL);
