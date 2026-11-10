-- Fix: the folder read policy looked the folder up by id. During INSERT ... RETURNING the new row is not
-- visible to that lookup yet, so creating a folder always failed. Check the row's own columns instead.
DROP POLICY read ON folder;
CREATE POLICY read ON folder FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) = 'nu' AND visible_to_nu)
  OR (app.project_role(project_id) = 'bauherr' AND visible_to_bauherr)
);
