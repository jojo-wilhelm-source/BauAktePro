-- Invitations need to know whether an e-mail already has an account (RLS hides users outside one's projects).
-- Narrow answer: only id, company and tenant, only for the Leitung, only for an exact address.
CREATE FUNCTION app.find_user_by_email(p_email text) RETURNS TABLE (id uuid, company_id uuid, tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.company_id, u.tenant_id FROM app_user u
  WHERE lower(u.email) = lower(trim(p_email)) AND app.is_leitung_any()
$$;
GRANT EXECUTE ON FUNCTION app.find_user_by_email(text) TO bap_app;
