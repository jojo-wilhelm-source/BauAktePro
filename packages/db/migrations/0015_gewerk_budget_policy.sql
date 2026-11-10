-- Budget per Gewerk is set by the Leitung (no UPDATE policy existed on gewerk).
CREATE POLICY leitung_budget ON gewerk FOR UPDATE USING (app.is_leitung(project_id)) WITH CHECK (app.is_leitung(project_id));
-- Attendance and next date of a meeting can be recorded while it is a draft (teilnehmer policy allows drafts).
