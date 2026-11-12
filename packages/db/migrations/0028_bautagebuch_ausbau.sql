-- Bautagebuch (decided 12.11.2026): templates, release to the Bauherr (chosen sections) with countersignature,
-- PDF filed automatically under Dokumente › Bautagebuch › Jahr › KW xx (one document per day, new version on change).

CREATE TABLE tagesbericht_vorlage (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid REFERENCES project(id),        -- NULL = for the whole company
  name text NOT NULL,
  inhalt jsonb NOT NULL DEFAULT '{}',             -- same fields as a draft (bereich, wetter, personal, geraete, leistungen, …)
  aktiv boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tagesbericht_vorlage ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesen ON tagesbericht_vorlage FOR SELECT USING (tenant_id = app.user_tenant() AND app.is_own_staff() AND (project_id IS NULL OR app.is_internal(project_id)));
CREATE POLICY anlegen ON tagesbericht_vorlage FOR INSERT WITH CHECK (tenant_id = app.user_tenant() AND app.is_own_staff() AND created_by = app.current_user_id()
  AND (project_id IS NULL AND app.is_leitung_any() OR project_id IS NOT NULL AND app.is_internal(project_id)));
CREATE POLICY aendern ON tagesbericht_vorlage FOR UPDATE USING (tenant_id = app.user_tenant() AND (created_by = app.current_user_id() OR app.is_leitung_any()));
GRANT SELECT, INSERT, UPDATE ON tagesbericht_vorlage TO bap_app;
GRANT SELECT ON tagesbericht_vorlage TO powersync_role;
ALTER PUBLICATION powersync ADD TABLE tagesbericht_vorlage;

ALTER TABLE tagesbericht
  ADD COLUMN bauherr_freigabe boolean NOT NULL DEFAULT false,
  ADD COLUMN bauherr_abschnitte text[] NOT NULL DEFAULT '{wetter,leistungen}',
  ADD COLUMN bauherr_signed_at timestamptz,
  ADD COLUMN bauherr_signed_by uuid REFERENCES app_user(id),
  ADD COLUMN bauherr_signature jsonb;

-- Bauherr: only released, signed reports (sections are filtered in the API).
CREATE POLICY bauherr ON tagesbericht FOR SELECT USING (app.project_role(project_id) = 'bauherr' AND bauherr_freigabe AND status = 'unterschrieben');
CREATE POLICY bauherr ON tagesbericht_nachtrag FOR SELECT USING (app.project_role(project_id) = 'bauherr'
  AND EXISTS (SELECT 1 FROM tagesbericht t WHERE t.id = bericht_id));

CREATE FUNCTION app.tagesbericht_freigabe(p_id uuid, p_freigabe boolean, p_abschnitte text[]) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE tagesbericht SET bauherr_freigabe = p_freigabe, bauherr_abschnitte = p_abschnitte
  WHERE id = p_id AND status = 'unterschrieben' AND app.is_leitung(project_id) AND (p_freigabe OR bauherr_signed_at IS NULL)
  RETURNING true
$$;
CREATE FUNCTION app.tagesbericht_bauherr_zeichnen(p_id uuid, p_signature jsonb) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE tagesbericht SET bauherr_signed_at = now(), bauherr_signed_by = app.current_user_id(), bauherr_signature = p_signature
  WHERE id = p_id AND bauherr_freigabe AND bauherr_signed_at IS NULL AND app.project_role(project_id) = 'bauherr'
  RETURNING true
$$;

-- Filing a generated PDF (internal roles): creates the folder path if needed and adds a released version.
-- Runs without the general folder rights (the Polier may file his report, not create arbitrary folders).
CREATE FUNCTION app.ablage_pdf(p_project uuid, p_path text[], p_name text, p_document uuid, p_revision uuid, p_file_key text, p_file_name text, p_size int)
  RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f uuid := NULL; nxt uuid; seg text; doc uuid := p_document; lbl text;
BEGIN
  IF NOT app.is_internal(p_project) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOREACH seg IN ARRAY p_path LOOP
    SELECT id INTO nxt FROM folder WHERE project_id = p_project AND name = seg AND parent_id IS NOT DISTINCT FROM f AND kind = 'dokumente';
    IF nxt IS NULL THEN
      INSERT INTO folder (project_id, parent_id, name, kind) VALUES (p_project, f, seg, 'dokumente') RETURNING id INTO nxt;
    END IF;
    f := nxt;
  END LOOP;
  IF doc IS NULL THEN SELECT id INTO doc FROM document WHERE folder_id = f AND name = p_name LIMIT 1; END IF;
  IF doc IS NULL OR NOT EXISTS (SELECT 1 FROM document WHERE id = doc) THEN
    INSERT INTO document (project_id, folder_id, name) VALUES (p_project, f, p_name) RETURNING id INTO doc;
  END IF;
  SELECT (count(*) + 1)::text INTO lbl FROM document_revision WHERE document_id = doc;
  UPDATE document_revision SET status = 'ersetzt', version = version + 1 WHERE document_id = doc AND status = 'freigegeben';
  INSERT INTO document_revision (id, document_id, project_id, version_label, file_key, file_name, mime, size_bytes, status, uploaded_by, uploaded_at, decided_by, decided_at)
    VALUES (p_revision, doc, p_project, lbl, p_file_key, p_file_name, 'application/pdf', p_size, 'freigegeben', app.current_user_id(), now(), app.current_user_id(), now());
  UPDATE document SET current_revision_id = p_revision WHERE id = doc;
  RETURN doc;
END $$;
