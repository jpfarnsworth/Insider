-- One-time, idempotent provisioning for Insider Signals on the shared AWS Postgres.
-- Run as an admin role (CREATEDB + CREATEROLE), connected to the `postgres` database:
--
--   psql "$ADMIN_DATABASE_URL" \
--     -v app_pw="$INSIDER_APP_PASSWORD" \
--     -v migrator_pw="$INSIDER_MIGRATOR_PASSWORD" \
--     -f db/setup-roles.sql
--
-- Passwords come in as psql variables and never appear in this file.
-- Roles (spec §6.0):
--   insider_migrator  owns the databases, runs DDL via `npm run db:migrate`
--   insider_app       DML only; used by the web app and workers

\set ON_ERROR_STOP on

-- Roles are cluster-wide. CREATE ROLE can't take a bind parameter inside DO,
-- so build the statements with format(%L) and run them with \gexec.
SELECT format('CREATE ROLE insider_migrator LOGIN PASSWORD %L', :'migrator_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'insider_migrator') \gexec

SELECT format('CREATE ROLE insider_app LOGIN PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'insider_app') \gexec

-- Re-running rotates passwords to the values supplied.
SELECT format('ALTER ROLE insider_migrator PASSWORD %L', :'migrator_pw') \gexec
SELECT format('ALTER ROLE insider_app PASSWORD %L', :'app_pw') \gexec

-- Neither role is a superuser and neither can create roles or databases.
ALTER ROLE insider_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE insider_app NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- The admin role must be a member of insider_migrator to create databases it owns.
SELECT format('GRANT insider_migrator TO %I', current_user)
WHERE NOT pg_has_role(current_user, 'insider_migrator', 'MEMBER') \gexec

SELECT 'CREATE DATABASE insider_signals OWNER insider_migrator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'insider_signals') \gexec

SELECT 'CREATE DATABASE insider_signals_dev OWNER insider_migrator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'insider_signals_dev') \gexec

-- Per-database grants ---------------------------------------------------------

\connect insider_signals_dev
REVOKE ALL ON DATABASE insider_signals_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE insider_signals_dev TO insider_app;
GRANT USAGE ON SCHEMA public TO insider_app;
GRANT ALL ON SCHEMA public TO insider_migrator;
-- Tables the migrator creates later are automatically usable by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE insider_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO insider_app;
ALTER DEFAULT PRIVILEGES FOR ROLE insider_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO insider_app;

\connect insider_signals
REVOKE ALL ON DATABASE insider_signals FROM PUBLIC;
GRANT CONNECT ON DATABASE insider_signals TO insider_app;
GRANT USAGE ON SCHEMA public TO insider_app;
GRANT ALL ON SCHEMA public TO insider_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE insider_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO insider_app;
ALTER DEFAULT PRIVILEGES FOR ROLE insider_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO insider_app;
