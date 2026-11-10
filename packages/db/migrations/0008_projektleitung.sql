-- Projektleitung: own project role with the SAME rights as the Bauleitung (docs/fachkonzept/01).
-- Single point of truth: app.project_role() returns the effective role, so every existing policy
-- that checks for 'bauleitung' applies to the Projektleitung too. The real role stays in project_member.
ALTER TABLE project_member DROP CONSTRAINT project_member_role_check;
ALTER TABLE project_member ADD CONSTRAINT project_member_role_check CHECK (role IN ('bauleitung', 'projektleitung', 'polier', 'nu', 'bauherr', 'einkauf'));

CREATE OR REPLACE FUNCTION app.project_role(p uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE role WHEN 'projektleitung' THEN 'bauleitung' ELSE role END
  FROM project_member WHERE project_id = p AND user_id = app.current_user_id()
$$;
