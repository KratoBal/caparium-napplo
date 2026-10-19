-- K6 / R-12 (review of PR #1, point C): the application does not connect as the owner of the
-- tables. An owner could switch the audit triggers off (ALTER TABLE ... DISABLE TRIGGER);
-- caparium_app cannot, and it has no UPDATE, DELETE or TRUNCATE on the audit table at all.
-- Migrations and the seed run as the owner; the server runs as caparium_app.
-- The role is created without LOGIN; the container start (scripts/start.sh) gives it its
-- password from the app's DATABASE_URL, so no password lives in a migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'caparium_app') THEN
    CREATE ROLE caparium_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO caparium_app;
-- K5: no physical delete of journal data, so no DELETE except on login sessions
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO caparium_app;
GRANT DELETE ON "session" TO caparium_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_entry" FROM caparium_app;
-- the migration history is the owner's; it is missing in Prisma's shadow database, hence the check
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "_prisma_migrations" FROM caparium_app;
  END IF;
END
$$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO caparium_app;

-- tables of later migrations (created by the owner) get the same default
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO caparium_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO caparium_app;
