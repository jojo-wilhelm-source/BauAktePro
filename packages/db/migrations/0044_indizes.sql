-- Performance with large data (code review 13.11.2026): indexes for the filters used by every rights check (RLS),
-- the start pages and the lists. All IF NOT EXISTS, safe to re-run.
CREATE INDEX IF NOT EXISTS project_member_user ON project_member (user_id, project_id);        -- app.project_role / is_member (every query)
CREATE INDEX IF NOT EXISTS mangel_firma ON mangel (assigned_company_id) WHERE deleted_at IS NULL; -- NU views
CREATE INDEX IF NOT EXISTS mangel_status ON mangel (project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS location_project ON location (project_id, parent_id);
CREATE INDEX IF NOT EXISTS plan_project ON plan (project_id);
CREATE INDEX IF NOT EXISTS folder_project ON folder (project_id, parent_id);
CREATE INDEX IF NOT EXISTS document_folder ON document (project_id, folder_id);
CREATE INDEX IF NOT EXISTS besprechung_project ON besprechung (project_id, held_at DESC);
CREATE INDEX IF NOT EXISTS besprechung_punkt_project ON besprechung_punkt (project_id, status);
CREATE INDEX IF NOT EXISTS besprechung_punkt_firma ON besprechung_punkt (responsible_company_id);
CREATE INDEX IF NOT EXISTS einkauf_project ON einkauf (project_id, status);
CREATE INDEX IF NOT EXISTS einreichung_project ON einreichung (project_id, status);
CREATE INDEX IF NOT EXISTS stundenzettel_project ON stundenzettel (project_id, status);
CREATE INDEX IF NOT EXISTS lv_project ON lv (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lv_anfrage_firma ON lv_anfrage (company_id, lv_id);
CREATE INDEX IF NOT EXISTS sync_conflict_actor ON sync_conflict (actor_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS audit_log_project ON audit_log (project_id, recorded_at DESC);
