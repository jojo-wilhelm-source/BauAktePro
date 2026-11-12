-- Service packages in the library (decided 12.11.2026): a standard item can hold several positions with a quantity
-- per unit of the package, e.g. "Bodenplatte" per m²: Aushub 0,40 m³, Bewehrung 0,03 t, Schalung 0,20 m, Beton 0,25 m³.
-- When inserted into an LV the total quantity (e.g. 120 m²) is multiplied out.
ALTER TABLE lv_stammleistung ADD COLUMN paket jsonb NOT NULL DEFAULT '[]';
