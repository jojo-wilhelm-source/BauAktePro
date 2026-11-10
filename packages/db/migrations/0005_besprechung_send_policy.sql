-- Fix: without WITH CHECK, Postgres checks the NEW row against USING (status = 'entwurf'),
-- so a draft could never be set to 'versendet'. USING keeps sent protocols locked (old row);
-- WITH CHECK only requires an internal role for the new row.
DROP POLICY edit_draft ON besprechung;
CREATE POLICY edit_draft ON besprechung FOR UPDATE
  USING (app.is_internal(project_id) AND status = 'entwurf')
  WITH CHECK (app.is_internal(project_id));
