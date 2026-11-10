-- Plan folders: PDFs uploaded into a folder of kind 'plaene' become plans (with pins) and show up under "Pläne"
-- (docs/fachkonzept/03). location_id: optional default Ort for plans in this folder (e.g. folder "EG").
ALTER TABLE folder ADD COLUMN kind text NOT NULL DEFAULT 'dokumente' CHECK (kind IN ('plaene', 'dokumente'));
ALTER TABLE folder ADD COLUMN location_id uuid REFERENCES location(id);
