# Travel_agent_AI

**To run it: follow [SETUP.md](SETUP.md)** (two free keys, then `npm run check` and `npm run dev` in Codespaces).

An AI travel agent built as a hands-on learning project: flight search, booking and
fare-change recovery on the Duffel test API, with a TypeScript API (Express),
a React front end (Vite) and PostgreSQL.

## Status

| Stage | What | State |
| --- | --- | --- |
| 1 | Repository structure, config contract, Codespaces | Done |
| 2 | API skeleton: layers, validation, errors, request IDs, logs, tests | Done |
| 3 | PostgreSQL: migrations, SQL repositories, transactions, row locks, DB error handling | Done |
| 4 | Accounts, sessions, roles, CORS, CSRF, rate limiting, security headers | Done |
| 5 | React frontend: login, trips, passengers; loading and error states; browser tests | Done |
| 6 | Duffel flight search, price check, booking with fare-change recovery | Done |
| 7 | AI assistant (Gemini tool calling) with grounding guard | Done |

## Structure

```text
apps/api/        Express + TypeScript API
  src/
    server.ts        starts the HTTP server, graceful shutdown
    app.ts           builds the app: middleware order, routes, error handling
    config.ts        reads and validates environment variables at startup
    logger.ts        structured JSON logging (pretty in development)
    errors.ts        AppError: expected errors with status + code
    middleware/      requestId, validate, errorHandler, auth, csrf
    auth/            register / login / logout, argon2id passwords, server-side sessions
    admin/           admin-only routes; make-admin command
    db/              connection pool, transactions, migration runner, DB error mapping
    trips/           routes → controller → service → repository (+ schema)
    flights/         search, offers, "check price" quotes
    bookings/        booking state machine, fare-change recovery, matching rules
    agent/           Gemini client, tools, agent loop
    providers/duffel Duffel HTTP client, error classification, offer normalizer
    fakes/           stand-in Duffel and Gemini servers (tests, offline mode)
  db/migrations/     numbered SQL files, applied in order, each once
apps/web/        Vite + React front end
  src/
    api/             client.ts: the only place that calls the API (cookies, timeout, errors)
    auth/            AuthContext: who is logged in, reacts to 401
    components/      ErrorBanner, Field
    pages/           Auth, Trips, TripDetail, Flights, Book, Booking(s), Assistant
  e2e/               Playwright browser tests
docs/            notes and diagrams
.devcontainer/   GitHub Codespaces setup (Node 22 + Docker)
.github/         CI: type-check and tests on every push / pull request
```

## Run it

Open the repository in GitHub Codespaces (Code → Codespaces → Create codespace on main), then:

Codespaces installs dependencies and starts PostgreSQL (Docker) automatically. Then:

```bash
cp apps/api/.env.example apps/api/.env
# set DATABASE_URL in apps/api/.env to the local Docker database, e.g.
#   postgres://app@localhost:5432/travel
npm run dev:api          # terminal 1: applies migrations, then serves http://localhost:3000
npm run dev:web          # terminal 2: the app on http://localhost:5173 (Codespaces opens it for you)
npm test                 # API tests, against the separate travel_test database
npx playwright install chromium   # once, then:
npm run e2e              # browser tests: starts both servers and clicks through the app
```

Useful: `docker compose ps` (is the DB up?), `docker compose exec db psql -U app -d travel` (SQL shell).

## API

Everything except `/health` and `/auth/register|login` needs a logged-in session (cookie `sid`).

| Area | Endpoints |
| --- | --- |
| Health | `GET /health` (database + which integrations are configured) |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Trips | `GET/POST /trips`, `GET/DELETE /trips/:id`, `GET/POST /trips/:id/passengers` |
| Flights | `POST /flights/search` (`{tripId}` or `{criteria}`), `GET /flights/offers/:id`, `POST /flights/offers/:id/quote`, `GET /flights/quotes/:id` |
| Bookings | `GET/POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/approve`, `/decline`, `/refresh` |
| Assistant | `POST /agent/chat`, `GET /agent/conversations/:id` |
| Admin | `GET /admin/trips`, `GET /admin/users` |

### Booking states

`REPRICING → ORDERING → TICKETED`; a changed or vanished fare goes `RECOVERY → AWAITING_APPROVAL` (customer approves the new price, or declines → `CANCELLED`);
an uncertain order goes `CONFIRMING` (looked up, never re-sent); limits reached → `FAILED`; unexpected supplier errors → `NEEDS_ATTENTION`.
Every step is recorded in `booking_events`.

Every response carries an `X-Request-Id` header; every error body includes the same
`requestId`, which matches the `req.id` field in the server logs.

Example:

```bash
curl -s -X POST localhost:3000/trips -H 'Content-Type: application/json' \
  -d '{"origin":"DXB","destination":"LHR","departureDate":"2026-12-15","adults":2,"children":1}'
```

## Configuration

Copy `apps/api/.env.example` to `apps/api/.env`. `.env` files are git-ignored and must never be committed.

**Secrets policy:** this repository is public, so no API key, token or password is ever committed.
Real values live only in `.env` (ignored), GitHub Codespaces secrets, or the hosting platform's
environment settings. A gitleaks scan runs on every push and pull request and fails if a secret appears.
The API refuses to start if a variable is invalid (e.g. `PORT=abc`).

## Known limitations

- Duffel test mode only: bookings are real API orders against Duffel's test airline, not valid tickets.
- Payment is Duffel test balance; no customer card payment (Stripe) yet.
- Rate-limit counters live in memory, per API instance (production: Redis, shared by all instances).
- No email verification, password reset or multi-factor login yet.
- Passports and other travel documents are not stored yet; they arrive with file storage (Stage 7) and will be encrypted.
- Migrations run automatically when the API starts. Larger systems run them as a separate deploy step.
