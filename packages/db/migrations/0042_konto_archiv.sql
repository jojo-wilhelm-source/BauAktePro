-- Own account and project archive (decided 13.11.2026: "vieles soll bearbeitet werden können").
-- Everyone edits his own name, phone and personal settings (e.g. which e-mails he wants); finished projects can be
-- archived by the Leitung – they vanish from sidebars and overviews but stay complete and readable.
ALTER TABLE app_user ADD COLUMN telefon text;
ALTER TABLE app_user ADD COLUMN einstellungen jsonb NOT NULL DEFAULT '{}';
CREATE POLICY self_update ON app_user FOR UPDATE USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());
GRANT UPDATE (name, telefon, einstellungen) ON app_user TO bap_app;

ALTER TABLE project ADD COLUMN archiviert_at timestamptz;
