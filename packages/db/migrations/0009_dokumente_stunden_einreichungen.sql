-- Dokumente with folders and "Alt" (docs/fachkonzept/03), Stundenzettel (08), NU-Einreichungen (11).
-- "Leitung" = Bau- or Projektleitung: app.project_role() already returns 'bauleitung' for both (0008).

CREATE FUNCTION app.is_leitung(p uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app.project_role(p) = 'bauleitung' $$;

---------------------------------------------------------------------------
-- Folders. "Alt" is not a stored folder: every folder shows its replaced versions under "Alt".
---------------------------------------------------------------------------
CREATE TABLE folder (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  parent_id uuid REFERENCES folder(id),
  name text NOT NULL,
  sort int NOT NULL DEFAULT 0,
  visible_to_nu boolean NOT NULL DEFAULT false,
  visible_to_bauherr boolean NOT NULL DEFAULT false
);
ALTER TABLE plan ADD COLUMN folder_id uuid REFERENCES folder(id);

CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  folder_id uuid NOT NULL REFERENCES folder(id),
  name text NOT NULL,
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES document(id),
  project_id uuid NOT NULL REFERENCES project(id),
  version_label text NOT NULL,                 -- Index/Version, e.g. "A" or "2"
  file_key text NOT NULL,
  file_name text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  status text NOT NULL DEFAULT 'zur_pruefung' CHECK (status IN ('zur_pruefung', 'freigegeben', 'abgelehnt', 'ersetzt')),
  comment text,
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  version int NOT NULL DEFAULT 1,
  UNIQUE (document_id, version_label)
);
ALTER TABLE document ADD CONSTRAINT document_current_fk FOREIGN KEY (current_revision_id) REFERENCES document_revision(id);

ALTER TABLE folder ENABLE ROW LEVEL SECURITY;
ALTER TABLE document ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_revision ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app.folder_visible(f uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.is_internal(fo.project_id)
      OR (app.project_role(fo.project_id) = 'nu' AND fo.visible_to_nu)
      OR (app.project_role(fo.project_id) = 'bauherr' AND fo.visible_to_bauherr)
  FROM folder fo WHERE fo.id = f
$$;

CREATE POLICY read ON folder FOR SELECT USING (app.folder_visible(id));
CREATE POLICY write ON folder FOR INSERT WITH CHECK (app.is_leitung(project_id));
CREATE POLICY edit ON folder FOR UPDATE USING (app.is_leitung(project_id));

CREATE POLICY read ON document FOR SELECT USING (app.folder_visible(folder_id));
CREATE POLICY write ON document FOR INSERT WITH CHECK (app.is_internal(project_id));
CREATE POLICY edit ON document FOR UPDATE USING (app.is_leitung(project_id));

-- External roles only ever see released versions; "Zur Prüfung", rejected and "Alt" stay internal.
CREATE POLICY read ON document_revision FOR SELECT USING (
  app.is_internal(project_id)
  OR (status = 'freigegeben' AND EXISTS (SELECT 1 FROM document d WHERE d.id = document_id))
);
CREATE POLICY upload ON document_revision FOR INSERT WITH CHECK (app.is_internal(project_id) AND uploaded_by = app.current_user_id() AND status = 'zur_pruefung');
CREATE POLICY decide ON document_revision FOR UPDATE USING (app.is_leitung(project_id));

---------------------------------------------------------------------------
-- Stundenzettel: NU via portal, Polier for own people/helpers. No payroll, no time clock.
---------------------------------------------------------------------------
CREATE TABLE stundenzettel (
  id uuid PRIMARY KEY,                         -- client-generated (offline-ready)
  project_id uuid NOT NULL REFERENCES project(id),
  number int,
  company_id uuid NOT NULL REFERENCES company(id),
  period_from date NOT NULL,
  period_to date NOT NULL,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'eingereicht', 'bestaetigt', 'gekuerzt', 'abgelehnt')),
  note text,
  attachment_key text,                         -- photo/PDF of a paper timesheet
  hours_total numeric(8,2) NOT NULL DEFAULT 0,
  hours_approved numeric(8,2),
  decision_reason text,
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  submitted_by uuid REFERENCES app_user(id),
  submitted_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CHECK (period_from <= period_to)
);
CREATE TABLE stundenzettel_zeile (
  id uuid PRIMARY KEY,
  zettel_id uuid NOT NULL REFERENCES stundenzettel(id),
  project_id uuid NOT NULL REFERENCES project(id),
  company_id uuid NOT NULL REFERENCES company(id),
  datum date NOT NULL,
  person text NOT NULL,
  von time,
  bis time,
  pause_min int NOT NULL DEFAULT 0 CHECK (pause_min >= 0),
  stunden numeric(5,2) NOT NULL CHECK (stunden >= 0 AND stunden <= 24),
  stunden_anerkannt numeric(5,2),              -- set when the Leitung cuts hours
  taetigkeit text NOT NULL,
  location_id uuid REFERENCES location(id),
  bezug text NOT NULL DEFAULT 'hauptauftrag' CHECK (bezug IN ('hauptauftrag', 'nachtrag', 'regie')),
  sort int NOT NULL DEFAULT 0
);
ALTER TABLE stundenzettel ENABLE ROW LEVEL SECURITY;
ALTER TABLE stundenzettel_zeile ENABLE ROW LEVEL SECURITY;

-- Internal (Leitung, Polier) see all; NU only the own company; Bauherr/Einkauf none (B6).
CREATE POLICY read ON stundenzettel FOR SELECT USING (
  app.is_internal(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company())
);
CREATE POLICY author ON stundenzettel FOR INSERT WITH CHECK (
  created_by = app.current_user_id()
  AND (app.is_internal(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company()))
);
-- Drafts: the submitting side edits. Submitted: only the Leitung (decision). Decided: locked.
CREATE POLICY edit ON stundenzettel FOR UPDATE
  USING ((status = 'entwurf' AND (app.is_internal(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company())))
         OR (status = 'eingereicht' AND app.is_leitung(project_id)))
  WITH CHECK (app.is_internal(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company()));

CREATE POLICY read ON stundenzettel_zeile FOR SELECT USING (
  app.is_internal(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company())
);
CREATE POLICY edit ON stundenzettel_zeile FOR ALL
  USING (EXISTS (SELECT 1 FROM stundenzettel z WHERE z.id = zettel_id AND (z.status = 'entwurf' OR (z.status = 'eingereicht' AND app.is_leitung(z.project_id)))))
  WITH CHECK (EXISTS (SELECT 1 FROM stundenzettel z WHERE z.id = zettel_id AND (z.status = 'entwurf' OR (z.status = 'eingereicht' AND app.is_leitung(z.project_id)))));

---------------------------------------------------------------------------
-- NU-Einreichungen: Nachträge (offers) and Rechnungen uploaded by the NU, decided by the Leitung.
---------------------------------------------------------------------------
CREATE TABLE einreichung (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project(id),
  number int,
  company_id uuid NOT NULL REFERENCES company(id),
  kind text NOT NULL CHECK (kind IN ('nachtrag', 'rechnung')),
  rechnung_art text CHECK (rechnung_art IN ('abschlag', 'teil', 'schluss', 'regie')),
  title text NOT NULL,
  amount_net numeric(12,2) NOT NULL CHECK (amount_net >= 0),
  file_key text NOT NULL,
  file_name text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'eingereicht' CHECK (status IN ('eingereicht', 'in_pruefung', 'freigegeben', 'gf_erforderlich', 'abgelehnt')),
  decision_reason text,
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  submitted_by uuid NOT NULL REFERENCES app_user(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  CHECK ((kind = 'rechnung') = (rechnung_art IS NOT NULL))
);
ALTER TABLE einreichung ENABLE ROW LEVEL SECURITY;
-- Leitung sees all (prices!); NU only own; Polier, Bauherr, Einkauf none (ANNAHME, docs/fachkonzept/11).
CREATE POLICY read ON einreichung FOR SELECT USING (
  app.is_leitung(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company())
);
CREATE POLICY submit ON einreichung FOR INSERT WITH CHECK (
  submitted_by = app.current_user_id() AND status = 'eingereicht'
  AND ((app.project_role(project_id) = 'nu' AND company_id = app.user_company()) OR app.is_leitung(project_id))
);
CREATE POLICY decide ON einreichung FOR UPDATE USING (app.is_leitung(project_id));

ALTER TABLE project_counter ADD COLUMN stundenzettel int NOT NULL DEFAULT 0;
ALTER TABLE project_counter ADD COLUMN einreichung int NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION app.next_counter(p uuid, what text) RETURNS int
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO project_counter (project_id) VALUES (p) ON CONFLICT (project_id) DO NOTHING;
  IF what = 'besprechung' THEN UPDATE project_counter SET besprechung = besprechung + 1 WHERE project_id = p RETURNING besprechung INTO n;
  ELSIF what = 'punkt' THEN UPDATE project_counter SET punkt = punkt + 1 WHERE project_id = p RETURNING punkt INTO n;
  ELSIF what = 'stundenzettel' THEN UPDATE project_counter SET stundenzettel = stundenzettel + 1 WHERE project_id = p RETURNING stundenzettel INTO n;
  ELSIF what = 'einreichung' THEN UPDATE project_counter SET einreichung = einreichung + 1 WHERE project_id = p RETURNING einreichung INTO n;
  ELSE RAISE EXCEPTION 'unknown counter %', what;
  END IF;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION app.is_leitung(uuid), app.folder_visible(uuid) TO bap_app;
GRANT SELECT, INSERT, UPDATE ON folder, document, document_revision, stundenzettel, einreichung TO bap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON stundenzettel_zeile TO bap_app;
GRANT UPDATE ON plan TO bap_app;
GRANT SELECT ON folder, document, document_revision, stundenzettel, stundenzettel_zeile TO powersync_role;
ALTER PUBLICATION powersync ADD TABLE folder, stundenzettel, stundenzettel_zeile;
