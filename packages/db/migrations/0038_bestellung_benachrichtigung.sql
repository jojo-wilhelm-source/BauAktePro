-- Bestellanforderungen and notifications (decided 12.11.2026, docs/fachkonzept/12 and 14).
-- Polier, Bauleitung and Projektleitung request material or services from the site (also offline in the app);
-- the Einkauf (project role 'einkauf', see all its projects in the Einkaufsportal) prepares an LV / request,
-- orders and marks the delivery. Everyone affected is notified in the app and by mail.

ALTER TABLE project_counter ADD COLUMN bestellanforderung int NOT NULL DEFAULT 0;

CREATE TABLE bestellanforderung (
  id uuid PRIMARY KEY,                       -- created on the device
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  number int,
  titel text NOT NULL,
  beschreibung text,
  positionen jsonb NOT NULL DEFAULT '[]',    -- [{ text, menge, einheit }]
  location_id uuid REFERENCES location(id),
  gewerk_id uuid REFERENCES gewerk(id),
  benoetigt_am date,
  dringend boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'in_bearbeitung', 'angefragt', 'bestellt', 'geliefert', 'abgelehnt', 'zurueckgezogen')),
  bearbeiter_id uuid REFERENCES app_user(id),
  lv_id uuid REFERENCES lv(id),
  lieferant text,
  bestell_nr text,
  liefertermin date,
  bemerkung_einkauf text,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON bestellanforderung (project_id, status);
CREATE INDEX ON bestellanforderung (tenant_id, status);

ALTER TABLE bestellanforderung ENABLE ROW LEVEL SECURITY;
-- Read: internal roles of the project and the Einkauf. NU and Bauherr never.
CREATE POLICY lesen ON bestellanforderung FOR SELECT USING (app.is_internal(project_id) OR app.project_role(project_id) = 'einkauf');
CREATE POLICY anlegen ON bestellanforderung FOR INSERT WITH CHECK ((app.is_internal(project_id) OR app.project_role(project_id) = 'einkauf') AND created_by = app.current_user_id());
-- Einkauf and Leitung work on every request; the requester only on his own while it is still open (edit, withdraw).
CREATE POLICY bearbeiten ON bestellanforderung FOR UPDATE
  USING (app.is_einkauf_or_leitung(project_id) OR (created_by = app.current_user_id() AND status = 'offen'))
  WITH CHECK (app.is_einkauf_or_leitung(project_id) OR (created_by = app.current_user_id() AND status IN ('offen', 'zurueckgezogen')));
GRANT SELECT, INSERT, UPDATE ON bestellanforderung TO bap_app;

-- Notifications: one row per recipient; read only by the recipient.
CREATE TABLE benachrichtigung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL REFERENCES app_user(id),
  project_id uuid REFERENCES project(id),
  art text NOT NULL,                         -- e.g. bestellanforderung, angebot
  titel text NOT NULL,
  text text,
  entity text,
  entity_id uuid,
  von_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX ON benachrichtigung (user_id, read_at, created_at DESC);
ALTER TABLE benachrichtigung ENABLE ROW LEVEL SECURITY;
CREATE POLICY eigene ON benachrichtigung FOR SELECT USING (user_id = app.current_user_id());
CREATE POLICY gelesen ON benachrichtigung FOR UPDATE USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
GRANT SELECT, UPDATE ON benachrichtigung TO bap_app;

-- Create a notification for another user. Only for users of the same tenant who are members of the project
-- (or administrators); the sender must be a member of that project himself. Returns false if not allowed.
CREATE FUNCTION app.benachrichtigen(p_user uuid, p_project uuid, p_art text, p_titel text, p_text text, p_entity text, p_entity_id uuid)
  RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  SELECT tenant_id INTO t FROM app_user WHERE id = p_user AND active;
  IF t IS NULL OR t <> app.user_tenant() THEN RETURN false; END IF;
  IF p_project IS NOT NULL THEN
    IF app.project_role(p_project) IS NULL THEN RETURN false; END IF;
    IF NOT EXISTS (SELECT 1 FROM project_member WHERE project_id = p_project AND user_id = p_user)
       AND NOT EXISTS (SELECT 1 FROM app_user WHERE id = p_user AND is_admin) THEN RETURN false; END IF;
  END IF;
  INSERT INTO benachrichtigung (tenant_id, user_id, project_id, art, titel, text, entity, entity_id, von_id)
  VALUES (t, p_user, p_project, p_art, p_titel, p_text, p_entity, p_entity_id, app.current_user_id());
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app.benachrichtigen(uuid, uuid, text, text, text, text, uuid) TO bap_app;
