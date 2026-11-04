-- Roles for local development. Passwords are dev-only.
-- bap_app: used by the API. NOT superuser, NOT bypassrls → Row Level Security applies.
CREATE ROLE bap_app LOGIN PASSWORD 'bap_app';
-- powersync_role: logical replication for the PowerSync service (reads everything; filtering happens in sync streams).
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'powersync';
GRANT CONNECT ON DATABASE bap TO bap_app, powersync_role;
