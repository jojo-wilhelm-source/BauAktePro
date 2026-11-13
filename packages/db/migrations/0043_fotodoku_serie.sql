-- 360° series (decided 13.11.2026): several photos at the same spot from different days form a series; on the plan
-- one pin per spot, in the viewer the photos of the series sorted by date. serie_id = id of the first photo of the
-- series (null = the photo starts its own series).
ALTER TABLE foto_doku ADD COLUMN serie_id uuid REFERENCES foto_doku(id);
CREATE INDEX ON foto_doku (serie_id) WHERE serie_id IS NOT NULL;
