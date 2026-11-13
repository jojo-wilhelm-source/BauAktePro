-- Settings per company (decided 13.11.2026: much should be configurable by the IT administrator instead of fixed
-- in code). One jsonb document per tenant; missing keys fall back to the defaults in packages/domain (einstellungen.ts).
CREATE TABLE tenant_einstellung (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id),
  werte jsonb NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_einstellung ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesen ON tenant_einstellung FOR SELECT USING (tenant_id = app.user_tenant());
CREATE POLICY admin ON tenant_einstellung FOR ALL USING (tenant_id = app.user_tenant() AND app.is_admin()) WITH CHECK (tenant_id = app.user_tenant() AND app.is_admin());
GRANT SELECT, INSERT, UPDATE ON tenant_einstellung TO bap_app;

-- Audit log: readable for the administrator (whole company) and – as before – the Leitung of the project.
CREATE POLICY admin_reads ON audit_log FOR SELECT USING (app.is_admin() AND tenant_id = app.user_tenant());
GRANT SELECT ON audit_log TO bap_app;
CREATE INDEX IF NOT EXISTS audit_log_tenant_time ON audit_log (tenant_id, recorded_at DESC);
