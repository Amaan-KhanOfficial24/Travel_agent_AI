-- Runs once, the first time the container starts: a separate database for automated tests,
-- so tests can wipe their data without touching the development database.
CREATE DATABASE travel_test;
