-- Nachträge and Rechnungen: separate numbering (NT-001 / RE-001), decisions can be taken back,
-- the NU can withdraw a submission that nobody has looked at yet (docs/fachkonzept/11).
ALTER TABLE einreichung DROP CONSTRAINT einreichung_status_check;
ALTER TABLE einreichung ADD CONSTRAINT einreichung_status_check
  CHECK (status IN ('eingereicht', 'in_pruefung', 'freigegeben', 'gf_erforderlich', 'abgelehnt', 'zurueckgezogen'));
-- The NU may update its own submission (only to withdraw it; the API checks the transition).
DROP POLICY decide ON einreichung;
CREATE POLICY decide ON einreichung FOR UPDATE
  USING (app.is_leitung(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company() AND status = 'eingereicht'))
  WITH CHECK (app.is_leitung(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company()));

ALTER TABLE project_counter ADD COLUMN nachtrag int NOT NULL DEFAULT 0;
ALTER TABLE project_counter ADD COLUMN rechnung int NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION app.next_counter(p uuid, what text) RETURNS int
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO project_counter (project_id) VALUES (p) ON CONFLICT (project_id) DO NOTHING;
  IF what = 'besprechung' THEN UPDATE project_counter SET besprechung = besprechung + 1 WHERE project_id = p RETURNING besprechung INTO n;
  ELSIF what = 'punkt' THEN UPDATE project_counter SET punkt = punkt + 1 WHERE project_id = p RETURNING punkt INTO n;
  ELSIF what = 'stundenzettel' THEN UPDATE project_counter SET stundenzettel = stundenzettel + 1 WHERE project_id = p RETURNING stundenzettel INTO n;
  ELSIF what = 'einreichung' THEN UPDATE project_counter SET einreichung = einreichung + 1 WHERE project_id = p RETURNING einreichung INTO n;
  ELSIF what = 'nachtrag' THEN UPDATE project_counter SET nachtrag = nachtrag + 1 WHERE project_id = p RETURNING nachtrag INTO n;
  ELSIF what = 'rechnung' THEN UPDATE project_counter SET rechnung = rechnung + 1 WHERE project_id = p RETURNING rechnung INTO n;
  ELSE RAISE EXCEPTION 'unknown counter %', what;
  END IF;
  RETURN n;
END $$;
