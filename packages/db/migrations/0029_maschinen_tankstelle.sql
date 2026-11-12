-- Fahrtenbuch for machines and a mobile fuel station (decided 12.11.2026, Polier):
-- * Machines (e.g. Radlader): only litres and Betriebsstunden, no km, often no price.
-- * Mobile Tankstelle: is filled (refill = tankvorgang on the station) and hands out diesel to machines/vehicles
--   (tankvorgang with quelle_id = station). Stock = refills − handed out.
ALTER TABLE fahrzeug ADD COLUMN art text NOT NULL DEFAULT 'fahrzeug' CHECK (art IN ('fahrzeug', 'maschine', 'tankstelle'));
ALTER TABLE fahrzeug ADD COLUMN kapazitaet_l numeric(7,0);
ALTER TABLE tankvorgang ALTER COLUMN km_stand DROP NOT NULL;
ALTER TABLE tankvorgang ALTER COLUMN betrag_brutto DROP NOT NULL;
ALTER TABLE tankvorgang ADD COLUMN betriebsstunden numeric(8,1) CHECK (betriebsstunden >= 0);
ALTER TABLE tankvorgang ADD COLUMN quelle_id uuid REFERENCES fahrzeug(id);
ALTER TABLE tankvorgang DROP CONSTRAINT IF EXISTS tankvorgang_liter_check;
ALTER TABLE tankvorgang ADD CONSTRAINT tankvorgang_liter_check CHECK (liter > 0 AND liter <= 10000);

-- Stock of a mobile station (SECURITY DEFINER: everybody with Fahrtenbuch sees the stock, not the other drivers' rows).
CREATE FUNCTION app.tankstelle_bestand(p uuid) RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT sum(liter) FROM tankvorgang WHERE fahrzeug_id = p), 0)
       - coalesce((SELECT sum(liter) FROM tankvorgang WHERE quelle_id = p), 0)
$$;
CREATE FUNCTION app.maschine_last_bh(p uuid) RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(betriebsstunden) FROM tankvorgang WHERE fahrzeug_id = p
$$;
