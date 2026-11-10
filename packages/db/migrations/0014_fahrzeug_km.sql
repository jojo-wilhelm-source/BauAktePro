-- Last known odometer of a vehicle (also from other drivers' trips, which RLS hides): only the number,
-- used to prefill "km-Stand Start" and to warn about gaps (docs/fachkonzept/14).
CREATE FUNCTION app.fahrzeug_last_km(fz uuid) RETURNS int
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(km) FROM (
    SELECT km_ende AS km FROM fahrt WHERE fahrzeug_id = fz AND tenant_id = app.user_tenant()
    UNION ALL SELECT km_stand FROM tankvorgang WHERE fahrzeug_id = fz AND tenant_id = app.user_tenant()
  ) x
$$;
GRANT EXECUTE ON FUNCTION app.fahrzeug_last_km(uuid) TO bap_app;
-- Beleg of a Tankvorgang may be attached later (photo upload after an offline entry).
CREATE POLICY own_beleg ON tankvorgang FOR UPDATE USING (fahrer_id = app.current_user_id()) WITH CHECK (fahrer_id = app.current_user_id());
CREATE POLICY own_beleg ON einkauf FOR UPDATE USING (created_by = app.current_user_id() AND status = 'eingereicht') WITH CHECK (created_by = app.current_user_id());
GRANT UPDATE ON tankvorgang TO bap_app;
