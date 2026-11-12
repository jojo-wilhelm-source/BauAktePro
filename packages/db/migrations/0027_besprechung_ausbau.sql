-- Besprechungen (decided 12.11.2026):
-- * Photos on Punkte.
-- * NU sees all non-internal Punkte of the sent meetings he takes part in (own ones highlighted in the UI),
--   not only his own (before: only own). Internal Punkte stay invisible.
-- * Manual release to the Bauherr; the Bauherr can countersign the released protocol.

ALTER TABLE besprechung
  ADD COLUMN bauherr_freigabe boolean NOT NULL DEFAULT false,
  ADD COLUMN bauherr_freigabe_at timestamptz,
  ADD COLUMN bauherr_freigabe_by uuid REFERENCES app_user(id),
  ADD COLUMN bauherr_signed_at timestamptz,
  ADD COLUMN bauherr_signed_by uuid REFERENCES app_user(id),
  ADD COLUMN bauherr_signature jsonb;

-- Helper without RLS (avoids policy recursion punkt ↔ eintrag): is the Punkt part of a sent meeting the user may see?
CREATE FUNCTION app.punkt_sichtbar_extern(p_punkt uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM besprechung_eintrag e JOIN besprechung b ON b.id = e.besprechung_id
    WHERE e.punkt_id = p_punkt AND b.status = 'versendet'
      AND ((app.project_role(b.project_id) = 'nu' AND EXISTS (SELECT 1 FROM besprechung_teilnehmer t WHERE t.besprechung_id = b.id AND t.company_id = app.user_company()))
        OR (app.project_role(b.project_id) = 'bauherr' AND b.bauherr_freigabe))
  )
$$;

DROP POLICY read ON besprechung;
CREATE POLICY read ON besprechung FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) = 'nu' AND status = 'versendet' AND app.is_teilnehmer(id))
  OR (app.project_role(project_id) = 'bauherr' AND status = 'versendet' AND bauherr_freigabe)
);
-- Release to the Bauherr after sending (Leitung) only through this function: a sent protocol stays locked otherwise.
CREATE FUNCTION app.besprechung_freigabe(p_id uuid, p_freigabe boolean) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE besprechung SET bauherr_freigabe = p_freigabe,
         bauherr_freigabe_at = CASE WHEN p_freigabe THEN now() END, bauherr_freigabe_by = CASE WHEN p_freigabe THEN app.current_user_id() END
  WHERE id = p_id AND status = 'versendet' AND app.is_leitung(project_id) AND (p_freigabe OR bauherr_signed_at IS NULL)
  RETURNING true
$$;

DROP POLICY read ON besprechung_punkt;
CREATE POLICY read ON besprechung_punkt FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) IN ('nu', 'bauherr') AND published AND NOT internal
      AND ((app.project_role(project_id) = 'nu' AND (responsible_company_id = app.user_company() OR app.user_company() = ANY (support_company_ids)))
           OR app.punkt_sichtbar_extern(id)))
);

DROP POLICY read ON besprechung_teilnehmer;
CREATE POLICY read ON besprechung_teilnehmer FOR SELECT USING (
  app.is_internal(project_id) OR app.is_teilnehmer(besprechung_id)
  OR (app.project_role(project_id) = 'bauherr' AND EXISTS (SELECT 1 FROM besprechung b WHERE b.id = besprechung_id))
);

CREATE FUNCTION app.besprechung_gegenzeichnen(p_id uuid, p_signature jsonb) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE besprechung SET bauherr_signed_at = now(), bauherr_signed_by = app.current_user_id(), bauherr_signature = p_signature
  WHERE id = p_id AND status = 'versendet' AND bauherr_freigabe AND bauherr_signed_at IS NULL
    AND app.project_role(project_id) = 'bauherr'
  RETURNING true
$$;

CREATE TABLE besprechung_punkt_foto (
  id uuid PRIMARY KEY,
  punkt_id uuid NOT NULL REFERENCES besprechung_punkt(id),
  project_id uuid NOT NULL REFERENCES project(id),
  file_key text NOT NULL,
  caption text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON besprechung_punkt_foto (punkt_id);
ALTER TABLE besprechung_punkt_foto ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON besprechung_punkt_foto FOR SELECT USING (EXISTS (SELECT 1 FROM besprechung_punkt p WHERE p.id = punkt_id)); -- RLS on punkt applies
CREATE POLICY write ON besprechung_punkt_foto FOR INSERT WITH CHECK (app.is_internal(project_id) AND created_by = app.current_user_id());
CREATE POLICY modul ON besprechung_punkt_foto AS RESTRICTIVE FOR ALL USING (app.has_module(project_id, 'besprechungen')) WITH CHECK (app.has_module(project_id, 'besprechungen'));
GRANT SELECT, INSERT ON besprechung_punkt_foto TO bap_app;
GRANT SELECT ON besprechung_punkt_foto TO powersync_role;
ALTER PUBLICATION powersync ADD TABLE besprechung_punkt_foto;
