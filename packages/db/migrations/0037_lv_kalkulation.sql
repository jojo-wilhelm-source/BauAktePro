-- Own calculation per LV (decided 12.11.2026): unit prices of the own estimate, shown left in the Preisspiegel.
-- Separate table so bidders (NU with the LV sent to them) can never read it; editable also after sending.
CREATE TABLE lv_kalkulation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lv_id uuid NOT NULL UNIQUE REFERENCES lv(id),
  project_id uuid NOT NULL REFERENCES project(id),
  preise jsonb NOT NULL DEFAULT '{}',   -- position_id -> Einheitspreis (netto)
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lv_kalkulation ENABLE ROW LEVEL SECURITY;
CREATE POLICY intern ON lv_kalkulation FOR ALL USING (app.is_einkauf_or_leitung(project_id)) WITH CHECK (app.is_einkauf_or_leitung(project_id));
GRANT SELECT, INSERT, UPDATE ON lv_kalkulation TO bap_app;
