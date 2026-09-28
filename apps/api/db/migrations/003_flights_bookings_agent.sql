-- 003: flight searches, offers, quotes, bookings with an audit trail, and AI conversations.

-- Duffel needs title and gender to create an order.
ALTER TABLE passengers ADD COLUMN gender char(1) CHECK (gender IN ('m', 'f'));

CREATE TABLE flight_searches (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trip_id             uuid        REFERENCES trips (id) ON DELETE SET NULL,
  criteria            jsonb       NOT NULL,  -- what was searched, reused to re-shop during recovery
  provider            text        NOT NULL DEFAULT 'duffel',
  provider_request_id text,
  offer_count         int         NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX flight_searches_user_idx ON flight_searches (user_id, created_at DESC);

CREATE TABLE offers (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id         uuid          NOT NULL REFERENCES flight_searches (id) ON DELETE CASCADE,
  user_id           uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider          text          NOT NULL DEFAULT 'duffel',
  provider_offer_id text          NOT NULL,
  itinerary_key     text          NOT NULL,
  total_amount      numeric(12,2) NOT NULL,
  currency          char(3)       NOT NULL,
  expires_at        timestamptz   NOT NULL,
  summary           jsonb         NOT NULL,  -- normalized FlightOffer
  raw               jsonb         NOT NULL,  -- exactly what Duffel sent, for debugging and audit
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT offers_provider_unique UNIQUE (provider, provider_offer_id)
);
CREATE INDEX offers_search_idx ON offers (search_id);

CREATE TABLE bookings (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trip_id           uuid          NOT NULL REFERENCES trips (id) ON DELETE RESTRICT,
  search_id         uuid          NOT NULL REFERENCES flight_searches (id),
  state             text          NOT NULL,
  version           int           NOT NULL DEFAULT 0,
  attempt_count     int           NOT NULL DEFAULT 0,
  original_amount   numeric(12,2) NOT NULL,  -- the first price the customer agreed to
  currency          char(3)       NOT NULL,
  contact_email     text          NOT NULL,
  contact_phone     text          NOT NULL,
  provider_order_id text,
  pnr               text,
  tickets           jsonb         NOT NULL DEFAULT '[]',
  paid_amount       numeric(12,2),
  failure_reason    text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT bookings_state_valid CHECK (state IN (
    'REPRICING', 'ORDERING', 'CONFIRMING', 'TICKETED', 'RECOVERY', 'AWAITING_APPROVAL',
    'CANCELLED', 'FAILED', 'NEEDS_ATTENTION'))
);
CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC);
-- One unfinished booking per trip: a double-click cannot start two bookings.
CREATE UNIQUE INDEX bookings_one_active_per_trip ON bookings (trip_id)
  WHERE state NOT IN ('TICKETED', 'CANCELLED', 'FAILED');

CREATE TABLE quotes (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  offer_id          uuid          NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  booking_id        uuid          REFERENCES bookings (id) ON DELETE CASCADE,
  status            text          NOT NULL CHECK (status IN ('SAME_PRICE', 'PRICE_CHANGED', 'ALTERNATIVE')),
  match_tier        text          NOT NULL DEFAULT 'EXACT'
                                  CHECK (match_tier IN ('EXACT', 'SAME_FLIGHTS_NEW_FARE', 'EQUIVALENT')),
  reference_amount  numeric(12,2) NOT NULL,  -- price we compare against (search price, or original booking price)
  total_amount      numeric(12,2) NOT NULL,  -- current bookable price
  currency          char(3)       NOT NULL,
  expires_at        timestamptz   NOT NULL,
  created_at        timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX quotes_booking_idx ON quotes (booking_id);

CREATE TABLE booking_attempts (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid          NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  attempt_no       int           NOT NULL,
  quote_id         uuid          NOT NULL REFERENCES quotes (id),
  consented_amount numeric(12,2) NOT NULL,  -- exactly what the customer clicked "agree" on
  consented_at     timestamptz   NOT NULL DEFAULT now(),
  outcome          text,
  error_code       text,
  CONSTRAINT booking_attempts_unique UNIQUE (booking_id, attempt_no)
);

-- Append-only audit trail: every state change and every supplier call result.
CREATE TABLE booking_events (
  id          bigserial   PRIMARY KEY,
  booking_id  uuid        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  from_state  text,
  to_state    text,
  event       text        NOT NULL,
  detail      jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, id);

CREATE TABLE agent_conversations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_messages (
  id               bigserial   PRIMARY KEY,
  conversation_id  uuid        NOT NULL REFERENCES agent_conversations (id) ON DELETE CASCADE,
  role             text        NOT NULL CHECK (role IN ('user', 'model')),
  parts            jsonb       NOT NULL,  -- Gemini "parts": text, functionCall, functionResponse
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_messages_conv_idx ON agent_messages (conversation_id, id);
