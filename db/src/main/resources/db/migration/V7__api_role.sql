-- Read-only login for the API, so a compromise of the web tier cannot modify data.
-- The password is a Flyway placeholder (spring.flyway.placeholders.api_db_password, fed from
-- API_DB_PASSWORD; dev default "f1api"). It must not contain a single quote.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'f1_api') THEN
        CREATE ROLE f1_api LOGIN PASSWORD '${api_db_password}';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO f1_api;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO f1_api;
-- Tables created by later migrations (run as the owner of this one) are readable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO f1_api;
