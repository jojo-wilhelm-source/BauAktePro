-- Correct entries afterwards (decided 12.11.2026: "fast alles bearbeiten"). Every correction is audited.
-- Fahrten/Tanken: the driver corrects his own entries, Bau-/Projektleitung all. Einkäufe: the author while still
-- "eingereicht" (after the decision the Leitung takes it back first).
CREATE POLICY korrektur ON fahrt FOR UPDATE
  USING (tenant_id = app.user_tenant() AND (fahrer_id = app.current_user_id() OR app.is_leitung_any()))
  WITH CHECK (tenant_id = app.user_tenant());
CREATE POLICY korrektur ON tankvorgang FOR UPDATE
  USING (tenant_id = app.user_tenant() AND (fahrer_id = app.current_user_id() OR app.is_leitung_any()))
  WITH CHECK (tenant_id = app.user_tenant());
CREATE POLICY own_edit ON einkauf FOR UPDATE
  USING (created_by = app.current_user_id() AND status = 'eingereicht')
  WITH CHECK (created_by = app.current_user_id() AND status = 'eingereicht');
