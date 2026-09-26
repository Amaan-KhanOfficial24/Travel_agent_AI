-- 002: user accounts, login sessions, and trip ownership.
-- A new migration (not an edit of 001): 001 is already merged and applied elsewhere.

CREATE TABLE users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text        NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  -- Only the argon2id HASH is stored: "$argon2id$v=19$m=...$<salt>$<hash>".
  -- The password itself never touches the database or the logs.
  password_hash  text        NOT NULL,
  role           text        NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the random token in the user's cookie. If this table leaks, the hashes
  -- cannot be turned back into working cookies.
  token_hash    bytea       NOT NULL UNIQUE,
  user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  user_agent    text
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);     -- "log out everywhere"
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at); -- cleanup of expired rows

-- Every trip now belongs to a user. Existing development rows have no owner, so the
-- column is nullable; the API always sets it, and ownerless trips are admin-only.
ALTER TABLE trips ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;
-- Replaces the created_at index: "my trips, newest first" is the query we now run.
DROP INDEX trips_created_at_idx;
CREATE INDEX trips_user_created_idx ON trips (user_id, created_at DESC);
