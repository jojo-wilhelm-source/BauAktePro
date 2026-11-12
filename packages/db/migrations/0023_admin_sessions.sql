-- Administration helpers: the API has no access to auth tables, these two narrow functions answer for the admin.
CREATE FUNCTION app.user_last_seen(u uuid) RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(s.updated_at) FROM auth_session s JOIN app_user x ON x.id = s.user_id
  WHERE s.user_id = u AND app.is_admin() AND x.tenant_id = app.user_tenant()
$$;
CREATE FUNCTION app.end_sessions(u uuid) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM auth_session s USING app_user x
  WHERE s.user_id = u AND x.id = u AND app.is_admin() AND x.tenant_id = app.user_tenant()
$$;
GRANT EXECUTE ON FUNCTION app.user_last_seen(uuid), app.end_sessions(uuid) TO bap_app;
