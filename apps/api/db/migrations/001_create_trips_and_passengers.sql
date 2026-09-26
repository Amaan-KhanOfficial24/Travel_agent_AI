-- 001: trips and their passengers.
-- Rules live in the database as well as in the API: the API gives friendly errors,
-- the database guarantees the data can never be wrong, whoever writes to it.

CREATE TABLE trips (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  origin          char(3)     NOT NULL CHECK (origin ~ '^[A-Z]{3}$'),
  destination     char(3)     NOT NULL CHECK (destination ~ '^[A-Z]{3}$'),
  departure_date  date        NOT NULL,
  return_date     date,
  adults          smallint    NOT NULL CHECK (adults BETWEEN 1 AND 9),
  children        smallint    NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 8),
  cabin           text        NOT NULL DEFAULT 'economy'
                              CHECK (cabin IN ('economy', 'premium_economy', 'business', 'first')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_origin_differs  CHECK (origin <> destination),
  CONSTRAINT trips_return_after    CHECK (return_date IS NULL OR return_date >= departure_date)
);

-- The trips list is sorted newest first; this index lets Postgres read it in order
-- instead of sorting the whole table every time.
CREATE INDEX trips_created_at_idx ON trips (created_at DESC);

CREATE TABLE passengers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Foreign key: a passenger must belong to an existing trip.
  -- ON DELETE CASCADE: deleting a trip deletes its passengers too.
  trip_id       uuid        NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  pax_type      text        NOT NULL CHECK (pax_type IN ('adult', 'child', 'infant')),
  title         text        CHECK (title IN ('mr', 'ms', 'mrs', 'miss', 'dr')),
  given_name    text        NOT NULL CHECK (length(given_name) BETWEEN 1 AND 60),
  family_name   text        NOT NULL CHECK (length(family_name) BETWEEN 1 AND 60),
  born_on       date        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- The same person cannot be added to the same trip twice.
  CONSTRAINT passengers_unique_person UNIQUE (trip_id, given_name, family_name, born_on)
);

-- Postgres does NOT index foreign keys automatically, and "passengers of trip X" is our
-- most common query. We need no separate index for it: the UNIQUE constraint above
-- creates an index on (trip_id, given_name, family_name, born_on), and an index can
-- serve lookups on its FIRST column alone. A second index on (trip_id) would only
-- cost disk space and slow down every insert.
