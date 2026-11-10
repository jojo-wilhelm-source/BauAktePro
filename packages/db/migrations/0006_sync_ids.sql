-- PowerSync needs a single "id" column on every synced table. The link tables had composite keys only.
ALTER TABLE besprechung_eintrag ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE besprechung_eintrag ADD CONSTRAINT besprechung_eintrag_id_key UNIQUE (id);
ALTER TABLE besprechung_teilnehmer ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE besprechung_teilnehmer ADD CONSTRAINT besprechung_teilnehmer_id_key UNIQUE (id);
