-- Einkauf (decided 12.11.2026): Leistungsverzeichnis (LV) → Anfrage an Nachunternehmer (Link/QR ohne Konto oder
-- im Portal) → Angebot mit Einheitspreisen oder als PDF (Notfall) → Preisspiegel für Bau-/Projektleitung → Vergabe.
-- Rights: LV and offers are seen by Bau-/Projektleitung and Einkauf; the Polier does not see prices (ANNAHME);
-- a NU only sees the LVs sent to his firm and only his own offer. Never other bidders' prices.

CREATE TABLE lv (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  gewerk_id uuid REFERENCES gewerk(id),
  nummer int,
  titel text NOT NULL,
  beschreibung text,
  angebotsfrist date,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'angefragt', 'vergeben')),
  vergeben_an uuid REFERENCES company(id),
  vergeben_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lv_position (
  id uuid PRIMARY KEY,
  lv_id uuid NOT NULL REFERENCES lv(id),
  project_id uuid NOT NULL REFERENCES project(id),
  oz text NOT NULL,               -- Ordnungszahl, e.g. 01.02.0010
  kurztext text NOT NULL,
  langtext text,
  menge numeric(12,3) NOT NULL CHECK (menge >= 0),
  einheit text NOT NULL,
  sort int NOT NULL DEFAULT 0
);
CREATE INDEX ON lv_position (lv_id);
CREATE TABLE lv_anfrage (
  id uuid PRIMARY KEY,
  lv_id uuid NOT NULL REFERENCES lv(id),
  project_id uuid NOT NULL REFERENCES project(id),
  company_id uuid NOT NULL REFERENCES company(id),
  email text,
  token text NOT NULL UNIQUE,      -- link without account; random, revocable
  aktiv boolean NOT NULL DEFAULT true,
  sent_at timestamptz,
  sent_by uuid REFERENCES app_user(id),
  UNIQUE (lv_id, company_id)
);
CREATE TABLE angebot (
  id uuid PRIMARY KEY,
  anfrage_id uuid NOT NULL REFERENCES lv_anfrage(id),
  lv_id uuid NOT NULL REFERENCES lv(id),
  project_id uuid NOT NULL REFERENCES project(id),
  company_id uuid NOT NULL REFERENCES company(id),
  summe_netto numeric(14,2),
  nachlass_prozent numeric(5,2) NOT NULL DEFAULT 0,
  bemerkung text,
  pdf_key text,
  abgegeben_von text NOT NULL,     -- name (also without account)
  abgegeben_by uuid REFERENCES app_user(id),
  abgegeben_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON angebot (lv_id);
CREATE TABLE angebot_preis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  angebot_id uuid NOT NULL REFERENCES angebot(id),
  position_id uuid NOT NULL REFERENCES lv_position(id),
  einheitspreis numeric(12,2) NOT NULL CHECK (einheitspreis >= 0),
  UNIQUE (angebot_id, position_id)
);

CREATE FUNCTION app.is_einkauf_or_leitung(p uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app.project_role(p) IN ('bauleitung', 'einkauf') $$;

ALTER TABLE lv ENABLE ROW LEVEL SECURITY;
ALTER TABLE lv_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE lv_anfrage ENABLE ROW LEVEL SECURITY;
ALTER TABLE angebot ENABLE ROW LEVEL SECURITY;
ALTER TABLE angebot_preis ENABLE ROW LEVEL SECURITY;

-- Helper without RLS: has the user's NU firm received this LV?
CREATE FUNCTION app.lv_angefragt_bei_mir(p_lv uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM lv_anfrage a WHERE a.lv_id = p_lv AND a.aktiv AND a.sent_at IS NOT NULL AND a.company_id = app.user_company())
$$;

CREATE POLICY lesen ON lv FOR SELECT USING (app.is_einkauf_or_leitung(project_id) OR (app.project_role(project_id) = 'nu' AND app.lv_angefragt_bei_mir(id)));
CREATE POLICY anlegen ON lv FOR INSERT WITH CHECK (app.is_einkauf_or_leitung(project_id) AND created_by = app.current_user_id());
CREATE POLICY aendern ON lv FOR UPDATE USING (app.is_einkauf_or_leitung(project_id)) WITH CHECK (app.is_einkauf_or_leitung(project_id));
CREATE POLICY lesen ON lv_position FOR SELECT USING (app.is_einkauf_or_leitung(project_id) OR (app.project_role(project_id) = 'nu' AND app.lv_angefragt_bei_mir(lv_id)));
-- Positions are only changed while the LV is a draft (after sending, bidders price exactly these).
CREATE POLICY schreiben ON lv_position FOR ALL
  USING (app.is_einkauf_or_leitung(project_id) AND EXISTS (SELECT 1 FROM lv WHERE lv.id = lv_id AND lv.status = 'entwurf'))
  WITH CHECK (app.is_einkauf_or_leitung(project_id) AND EXISTS (SELECT 1 FROM lv WHERE lv.id = lv_id AND lv.status = 'entwurf'));
CREATE POLICY lesen ON lv_anfrage FOR SELECT USING (app.is_einkauf_or_leitung(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company() AND sent_at IS NOT NULL));
CREATE POLICY schreiben ON lv_anfrage FOR ALL USING (app.is_einkauf_or_leitung(project_id)) WITH CHECK (app.is_einkauf_or_leitung(project_id));
CREATE POLICY lesen ON angebot FOR SELECT USING (app.is_einkauf_or_leitung(project_id) OR (app.project_role(project_id) = 'nu' AND company_id = app.user_company()));
CREATE POLICY nu_abgeben ON angebot FOR INSERT WITH CHECK (app.project_role(project_id) = 'nu' AND company_id = app.user_company() AND abgegeben_by = app.current_user_id()
  AND EXISTS (SELECT 1 FROM lv WHERE lv.id = lv_id AND lv.status = 'angefragt'));
CREATE POLICY erfassen ON angebot FOR INSERT WITH CHECK (app.is_einkauf_or_leitung(project_id)); -- e.g. offer received by mail, entered by Einkauf
CREATE POLICY lesen ON angebot_preis FOR SELECT USING (EXISTS (SELECT 1 FROM angebot a WHERE a.id = angebot_id)); -- RLS on angebot applies
CREATE POLICY schreiben ON angebot_preis FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM angebot a WHERE a.id = angebot_id));

GRANT SELECT, INSERT, UPDATE ON lv, lv_anfrage TO bap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lv_position TO bap_app;
GRANT SELECT, INSERT ON angebot, angebot_preis TO bap_app;

-- Public offer via link (no account): token-bound, SECURITY DEFINER, only while the LV is open for offers.
CREATE FUNCTION app.anfrage_by_token(p_token text) RETURNS TABLE (anfrage_id uuid, lv_id uuid, project_id uuid, company_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.lv_id, a.project_id, a.company_id, l.tenant_id FROM lv_anfrage a JOIN lv l ON l.id = a.lv_id
  WHERE a.token = p_token AND a.aktiv AND a.sent_at IS NOT NULL
$$;
