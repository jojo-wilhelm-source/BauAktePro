-- Nachunternehmer-Verzeichnis mit Verträgen, Budget je Gewerk (Kosten), Baustellen-Einkäufe und Fahrtenbuch
-- (docs/fachkonzept/11, 14). Leitung = Bau- oder Projektleitung (app.project_role maps both to 'bauleitung').

---------------------------------------------------------------------------
-- Nachunternehmer: companies can belong to a project without having a user yet.
---------------------------------------------------------------------------
ALTER TABLE company ADD COLUMN contact_person text;
ALTER TABLE company ADD COLUMN phone text;
ALTER TABLE company ADD COLUMN address text;

CREATE TABLE project_company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  company_id uuid NOT NULL REFERENCES company(id),
  UNIQUE (project_id, company_id)
);
ALTER TABLE project_company ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON project_company FOR SELECT USING (app.is_member(project_id));
CREATE POLICY write ON project_company FOR INSERT WITH CHECK (app.is_leitung(project_id));

-- Companies of the project are visible to its members (also those added without a user).
DROP POLICY visible_companies ON company;
CREATE POLICY visible_companies ON company FOR SELECT USING (
  id = app.user_company()
  OR EXISTS (SELECT 1 FROM project_member pm WHERE pm.company_id = company.id AND app.is_member(pm.project_id))
  OR EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = company.id AND app.is_member(pc.project_id))
);
CREATE POLICY add_nu ON company FOR INSERT WITH CHECK (
  kind = 'nu' AND tenant_id = (SELECT tenant_id FROM app_user WHERE id = app.current_user_id())
  AND EXISTS (SELECT 1 FROM project_member pm WHERE pm.user_id = app.current_user_id() AND app.project_role(pm.project_id) = 'bauleitung')
);
CREATE POLICY edit_nu ON company FOR UPDATE USING (
  kind = 'nu' AND EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = company.id AND app.is_leitung(pc.project_id))
);
CREATE POLICY leitung_assigns ON gewerk_company FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM gewerk g WHERE g.id = gewerk_id AND app.is_leitung(g.project_id)));

-- Contract (Auftrag) per NU and Gewerk: basis for the cost overview. Prices: Leitung only.
CREATE TABLE vertrag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  company_id uuid NOT NULL REFERENCES company(id),
  gewerk_id uuid REFERENCES gewerk(id),
  title text NOT NULL,
  amount_net numeric(12,2) NOT NULL CHECK (amount_net >= 0),
  signed_on date,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vertrag ENABLE ROW LEVEL SECURITY;
CREATE POLICY leitung ON vertrag FOR ALL USING (app.is_leitung(project_id)) WITH CHECK (app.is_leitung(project_id));
-- The NU sees its own contracts (its own prices).
CREATE POLICY nu_own ON vertrag FOR SELECT USING (app.project_role(project_id) = 'nu' AND company_id = app.user_company());

ALTER TABLE gewerk ADD COLUMN budget_net numeric(12,2);
-- gewerk budget is a price: the API only returns it to the Leitung (gewerk rows themselves are visible to all members).

---------------------------------------------------------------------------
-- Baustellen-Einkäufe (Auslagen), docs/fachkonzept/14. Recorded on site, also offline.
---------------------------------------------------------------------------
CREATE TABLE einkauf (
  id uuid PRIMARY KEY,                         -- client-generated (offline)
  project_id uuid NOT NULL REFERENCES project(id),
  number int,
  gekauft_von text NOT NULL,                   -- who bought it (may differ from who records it)
  datum date NOT NULL,
  haendler text NOT NULL,
  betrag_brutto numeric(10,2) NOT NULL CHECK (betrag_brutto >= 0),
  mwst_satz numeric(4,1) NOT NULL DEFAULT 19 CHECK (mwst_satz IN (0, 7, 19)),
  gewerk_id uuid REFERENCES gewerk(id),
  zweck text NOT NULL,
  zahlungsart text NOT NULL DEFAULT 'firmenkarte' CHECK (zahlungsart IN ('firmenkarte', 'bar', 'privat')),
  beleg_key text,
  status text NOT NULL DEFAULT 'eingereicht' CHECK (status IN ('eingereicht', 'freigegeben', 'abgelehnt')),
  erstattet boolean NOT NULL DEFAULT false,    -- privately paid and handed to accounting for reimbursement
  decision_reason text,
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);
ALTER TABLE einkauf ENABLE ROW LEVEL SECURITY;
-- Own company's people record and see their own; Leitung and Einkauf see all of the project; NU/Bauherr none.
CREATE POLICY read ON einkauf FOR SELECT USING (
  app.is_leitung(project_id) OR app.project_role(project_id) = 'einkauf'
  OR (app.is_internal(project_id) AND created_by = app.current_user_id())
);
CREATE POLICY record ON einkauf FOR INSERT WITH CHECK (
  created_by = app.current_user_id() AND (app.is_internal(project_id) OR app.project_role(project_id) = 'einkauf') AND status = 'eingereicht'
);
CREATE POLICY decide ON einkauf FOR UPDATE USING (app.is_leitung(project_id)) WITH CHECK (app.is_leitung(project_id));

---------------------------------------------------------------------------
-- Fahrtenbuch (company level, not per project): vehicles, trips, refuelling. Simple, not a tax logbook.
-- ANNAHME (offene-punkte D2): the driver sees own entries; Bau-/Projektleitung of the company see all.
---------------------------------------------------------------------------
CREATE FUNCTION app.is_leitung_any() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM project_member WHERE user_id = app.current_user_id() AND role IN ('bauleitung', 'projektleitung'))
$$;
CREATE FUNCTION app.user_tenant() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT tenant_id FROM app_user WHERE id = app.current_user_id() $$;
CREATE FUNCTION app.is_own_staff() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = app.current_user_id() AND c.kind = 'own')
$$;

CREATE TABLE fahrzeug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  kennzeichen text NOT NULL,
  bezeichnung text NOT NULL,
  kraftstoff text NOT NULL DEFAULT 'diesel' CHECK (kraftstoff IN ('diesel', 'benzin', 'elektro', 'hybrid')),
  fahrer_id uuid REFERENCES app_user(id),      -- usual driver (optional)
  aktiv boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, kennzeichen)
);
CREATE TABLE fahrt (
  id uuid PRIMARY KEY,                         -- client-generated (offline)
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  fahrzeug_id uuid NOT NULL REFERENCES fahrzeug(id),
  fahrer_id uuid NOT NULL REFERENCES app_user(id),
  datum date NOT NULL,
  km_start int NOT NULL CHECK (km_start >= 0),
  km_ende int NOT NULL,
  project_id uuid REFERENCES project(id),
  zweck text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (km_ende >= km_start)
);
CREATE TABLE tankvorgang (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  fahrzeug_id uuid NOT NULL REFERENCES fahrzeug(id),
  fahrer_id uuid NOT NULL REFERENCES app_user(id),
  datum date NOT NULL,
  liter numeric(7,2) NOT NULL CHECK (liter > 0),
  betrag_brutto numeric(9,2) NOT NULL CHECK (betrag_brutto >= 0),
  km_stand int NOT NULL CHECK (km_stand >= 0),
  tankstelle text,
  project_id uuid REFERENCES project(id),
  beleg_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fahrzeug ENABLE ROW LEVEL SECURITY;
ALTER TABLE fahrt ENABLE ROW LEVEL SECURITY;
ALTER TABLE tankvorgang ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff ON fahrzeug FOR SELECT USING (tenant_id = app.user_tenant() AND app.is_own_staff());
CREATE POLICY leitung ON fahrzeug FOR INSERT WITH CHECK (tenant_id = app.user_tenant() AND app.is_leitung_any());
CREATE POLICY leitung_edit ON fahrzeug FOR UPDATE USING (tenant_id = app.user_tenant() AND app.is_leitung_any());
CREATE POLICY own_or_leitung ON fahrt FOR SELECT USING (tenant_id = app.user_tenant() AND (fahrer_id = app.current_user_id() OR app.is_leitung_any()));
CREATE POLICY own ON fahrt FOR INSERT WITH CHECK (tenant_id = app.user_tenant() AND fahrer_id = app.current_user_id() AND app.is_own_staff());
CREATE POLICY own_or_leitung ON tankvorgang FOR SELECT USING (tenant_id = app.user_tenant() AND (fahrer_id = app.current_user_id() OR app.is_leitung_any()));
CREATE POLICY own ON tankvorgang FOR INSERT WITH CHECK (tenant_id = app.user_tenant() AND fahrer_id = app.current_user_id() AND app.is_own_staff());

---------------------------------------------------------------------------
-- Besprechung: attendance, next date.
---------------------------------------------------------------------------
ALTER TABLE besprechung_teilnehmer ADD COLUMN anwesend boolean;    -- NULL = not recorded yet
ALTER TABLE besprechung ADD COLUMN next_at timestamptz;

ALTER TABLE project_counter ADD COLUMN einkauf int NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION app.next_counter(p uuid, what text) RETURNS int
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO project_counter (project_id) VALUES (p) ON CONFLICT (project_id) DO NOTHING;
  EXECUTE format('UPDATE project_counter SET %1$I = %1$I + 1 WHERE project_id = $1 RETURNING %1$I', what) INTO n USING p;
  IF n IS NULL THEN RAISE EXCEPTION 'unknown counter %', what; END IF;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION app.is_leitung_any(), app.user_tenant(), app.is_own_staff() TO bap_app;
GRANT SELECT, INSERT, UPDATE ON company, vertrag, einkauf, fahrzeug, fahrt, tankvorgang, project_company TO bap_app;
GRANT INSERT ON gewerk_company TO bap_app;
GRANT UPDATE ON gewerk TO bap_app;
GRANT SELECT ON project_company, einkauf, fahrzeug, fahrt, tankvorgang TO powersync_role;
ALTER PUBLICATION powersync ADD TABLE project_company, einkauf, fahrzeug, fahrt, tankvorgang;
