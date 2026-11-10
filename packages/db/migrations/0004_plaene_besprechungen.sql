-- Plan revisions with approval (docs/fachkonzept/03) and NU-Besprechungen (docs/fachkonzept/09).

---------------------------------------------------------------------------
-- Plan revisions. plan.plan_index / plan.file_key always point to the CURRENT RELEASED revision,
-- so devices and pins keep working with "the plan"; the history lives here.
---------------------------------------------------------------------------
ALTER TABLE plan ADD COLUMN released_at timestamptz;
ALTER TABLE plan ADD COLUMN current_revision_id uuid;

CREATE TABLE plan_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plan(id),
  project_id uuid NOT NULL REFERENCES project(id),
  plan_index text NOT NULL,
  file_key text NOT NULL,
  page_count int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'zur_pruefung' CHECK (status IN ('zur_pruefung', 'freigegeben', 'abgelehnt', 'ersetzt')),
  comment text,
  uploaded_by uuid NOT NULL REFERENCES app_user(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  version int NOT NULL DEFAULT 1,
  UNIQUE (plan_id, plan_index)
);
ALTER TABLE plan ADD CONSTRAINT plan_current_revision_fk FOREIGN KEY (current_revision_id) REFERENCES plan_revision(id);
ALTER TABLE plan_revision ENABLE ROW LEVEL SECURITY;

-- Internal roles see every revision (incl. Eingang/Zur Prüfung and Alt). NU/Bauherr only the current released one,
-- and only if they may see the plan at all (same rule as plan.by_role).
CREATE POLICY read ON plan_revision FOR SELECT USING (
  app.is_internal(project_id)
  OR (status = 'freigegeben' AND EXISTS (SELECT 1 FROM plan p WHERE p.id = plan_id
        AND ((app.project_role(p.project_id) = 'nu' AND p.visible_to_nu) OR (app.project_role(p.project_id) = 'bauherr' AND p.visible_to_bauherr))))
);
-- Upload: Bauleitung and Polier (into "Zur Prüfung"). Decision (release/reject): Bauleitung only.
CREATE POLICY upload ON plan_revision FOR INSERT WITH CHECK (app.is_internal(project_id) AND uploaded_by = app.current_user_id() AND status = 'zur_pruefung');
CREATE POLICY decide ON plan_revision FOR UPDATE USING (app.project_role(project_id) = 'bauleitung');
CREATE POLICY create_plan ON plan FOR INSERT WITH CHECK (app.is_internal(project_id));
CREATE POLICY release ON plan FOR UPDATE USING (app.project_role(project_id) = 'bauleitung');

---------------------------------------------------------------------------
-- Besprechungen
---------------------------------------------------------------------------
CREATE TABLE besprechung (
  id uuid PRIMARY KEY,                         -- client-generated
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_id uuid NOT NULL REFERENCES project(id),
  number int,                                  -- server-assigned
  kind text NOT NULL DEFAULT 'nu' CHECK (kind IN ('nu', 'bau')),
  title text NOT NULL,
  held_at timestamptz NOT NULL,
  place text,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'versendet')),
  previous_id uuid REFERENCES besprechung(id),
  sent_at timestamptz,
  sent_by uuid REFERENCES app_user(id),
  file_key text,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE besprechung_teilnehmer (
  besprechung_id uuid NOT NULL REFERENCES besprechung(id),
  project_id uuid NOT NULL REFERENCES project(id),
  company_id uuid NOT NULL REFERENCES company(id),
  PRIMARY KEY (besprechung_id, company_id)
);

-- A Punkt lives across meetings (carried over while open).
CREATE TABLE besprechung_punkt (
  id uuid PRIMARY KEY,                         -- client-generated (offline)
  project_id uuid NOT NULL REFERENCES project(id),
  number int,                                  -- P-014, server-assigned
  first_besprechung_id uuid NOT NULL REFERENCES besprechung(id),
  location_id uuid REFERENCES location(id),    -- Geschoss/Bauteil; NULL = Allgemein
  gewerk_id uuid REFERENCES gewerk(id),
  text text NOT NULL,
  responsible_company_id uuid REFERENCES company(id),
  support_company_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'in_arbeit', 'erledigt', 'info')),
  due_date date,
  internal boolean NOT NULL DEFAULT false,     -- "nur intern": never shown to NU, not in the sent protocol
  published boolean NOT NULL DEFAULT false,    -- true once it was part of a sent protocol (then NU may see it)
  plan_id uuid REFERENCES plan(id),
  pin_page int, pin_x real, pin_y real,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Which Punkte belong to which meeting; status_snapshot/text_snapshot are frozen when the protocol is sent.
CREATE TABLE besprechung_eintrag (
  besprechung_id uuid NOT NULL REFERENCES besprechung(id),
  punkt_id uuid NOT NULL REFERENCES besprechung_punkt(id),
  project_id uuid NOT NULL REFERENCES project(id),
  carried boolean NOT NULL DEFAULT false,      -- came from the previous meeting ("Wiederholt")
  status_snapshot text,
  text_snapshot text,
  PRIMARY KEY (besprechung_id, punkt_id)
);

ALTER TABLE besprechung ENABLE ROW LEVEL SECURITY;
ALTER TABLE besprechung_teilnehmer ENABLE ROW LEVEL SECURITY;
ALTER TABLE besprechung_punkt ENABLE ROW LEVEL SECURITY;
ALTER TABLE besprechung_eintrag ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app.is_teilnehmer(b uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM besprechung_teilnehmer t WHERE t.besprechung_id = b AND t.company_id = app.user_company())
$$;

CREATE POLICY read ON besprechung FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) IN ('nu', 'bauherr') AND status = 'versendet' AND app.is_teilnehmer(id))
);
CREATE POLICY write ON besprechung FOR INSERT WITH CHECK (app.is_internal(project_id) AND created_by = app.current_user_id());
-- Sent protocols are locked: USING checks the old row.
CREATE POLICY edit_draft ON besprechung FOR UPDATE USING (app.is_internal(project_id) AND status = 'entwurf');

CREATE POLICY read ON besprechung_teilnehmer FOR SELECT USING (app.is_internal(project_id) OR app.is_teilnehmer(besprechung_id));
CREATE POLICY edit ON besprechung_teilnehmer FOR ALL
  USING (app.is_internal(project_id) AND EXISTS (SELECT 1 FROM besprechung b WHERE b.id = besprechung_id AND b.status = 'entwurf'))
  WITH CHECK (app.is_internal(project_id) AND EXISTS (SELECT 1 FROM besprechung b WHERE b.id = besprechung_id AND b.status = 'entwurf'));

-- NU: only published, non-internal Punkte where the own company is responsible or supports.
CREATE POLICY read ON besprechung_punkt FOR SELECT USING (
  app.is_internal(project_id)
  OR (app.project_role(project_id) = 'nu' AND published AND NOT internal
      AND (responsible_company_id = app.user_company() OR app.user_company() = ANY (support_company_ids)))
);
CREATE POLICY write ON besprechung_punkt FOR INSERT WITH CHECK (app.is_internal(project_id) AND created_by = app.current_user_id());
CREATE POLICY edit ON besprechung_punkt FOR UPDATE USING (app.is_internal(project_id));

CREATE POLICY read ON besprechung_eintrag FOR SELECT USING (
  app.is_internal(project_id)
  OR EXISTS (SELECT 1 FROM besprechung_punkt p WHERE p.id = punkt_id)   -- RLS on punkt applies
     AND EXISTS (SELECT 1 FROM besprechung b WHERE b.id = besprechung_id) -- RLS on besprechung applies
);
CREATE POLICY edit ON besprechung_eintrag FOR ALL
  USING (app.is_internal(project_id) AND EXISTS (SELECT 1 FROM besprechung b WHERE b.id = besprechung_id AND b.status = 'entwurf'))
  WITH CHECK (app.is_internal(project_id) AND EXISTS (SELECT 1 FROM besprechung b WHERE b.id = besprechung_id AND b.status = 'entwurf'));

ALTER TABLE project_counter ADD COLUMN besprechung int NOT NULL DEFAULT 0;
ALTER TABLE project_counter ADD COLUMN punkt int NOT NULL DEFAULT 0;
CREATE FUNCTION app.next_counter(p uuid, what text) RETURNS int
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO project_counter (project_id) VALUES (p) ON CONFLICT (project_id) DO NOTHING;
  IF what = 'besprechung' THEN UPDATE project_counter SET besprechung = besprechung + 1 WHERE project_id = p RETURNING besprechung INTO n;
  ELSIF what = 'punkt' THEN UPDATE project_counter SET punkt = punkt + 1 WHERE project_id = p RETURNING punkt INTO n;
  ELSE RAISE EXCEPTION 'unknown counter %', what;
  END IF;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION app.next_counter(uuid, text), app.is_teilnehmer(uuid) TO bap_app;
GRANT SELECT ON plan_revision, besprechung, besprechung_teilnehmer, besprechung_punkt, besprechung_eintrag TO bap_app;
GRANT INSERT, UPDATE ON plan, plan_revision, besprechung, besprechung_punkt TO bap_app;
-- DELETE only for draft membership rows (RLS above).
GRANT INSERT, UPDATE, DELETE ON besprechung_teilnehmer, besprechung_eintrag TO bap_app;
GRANT SELECT ON plan_revision, besprechung, besprechung_teilnehmer, besprechung_punkt, besprechung_eintrag TO powersync_role;

ALTER PUBLICATION powersync ADD TABLE besprechung, besprechung_teilnehmer, besprechung_punkt, besprechung_eintrag;

-- Existing plans get their first revision as "freigegeben".
INSERT INTO plan_revision (plan_id, project_id, plan_index, file_key, page_count, status, uploaded_by, uploaded_at, decided_by, decided_at)
SELECT p.id, p.project_id, p.plan_index, p.file_key, p.page_count, 'freigegeben',
       (SELECT pm.user_id FROM project_member pm WHERE pm.project_id = p.project_id AND pm.role = 'bauleitung' LIMIT 1), now(),
       (SELECT pm.user_id FROM project_member pm WHERE pm.project_id = p.project_id AND pm.role = 'bauleitung' LIMIT 1), now()
FROM plan p WHERE EXISTS (SELECT 1 FROM project_member pm WHERE pm.project_id = p.project_id AND pm.role = 'bauleitung');
UPDATE plan p SET current_revision_id = r.id, released_at = r.decided_at FROM plan_revision r WHERE r.plan_id = p.id;
