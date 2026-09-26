# Travel_agent_AI

An AI travel agent built as a hands-on learning project: flight search, booking and
fare-change recovery on the Duffel test API, with a TypeScript API (Express),
a React front end (Vite) and PostgreSQL.

## Status

| Stage | What | State |
| --- | --- | --- |
| 1 | Repository structure, config contract, Codespaces | Done |
| 2 | API skeleton: layers, validation, errors, request IDs, logs, tests | Done |
| 3 | PostgreSQL: migrations, SQL repositories, transactions, row locks, DB error handling | Done |
| 4 | Authentication and security | Next |

## Structure

```text
apps/api/        Express + TypeScript API
  src/
    server.ts        starts the HTTP server, graceful shutdown
    app.ts           builds the app: middleware order, routes, error handling
    config.ts        reads and validates environment variables at startup
    logger.ts        structured JSON logging (pretty in development)
    errors.ts        AppError: expected errors with status + code
    middleware/      requestId, validate, errorHandler
    db/              connection pool, transactions, migration runner, DB error mapping
    trips/           routes → controller → service → repository (+ schema)
  db/migrations/     numbered SQL files, applied in order, each once
apps/web/        Vite + React front end (Stage 5)
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
npm run dev:api          # applies migrations, then serves http://localhost:3000
npm test                 # runs against the separate travel_test database
```

Useful: `docker compose ps` (is the DB up?), `docker compose exec db psql -U app -d travel` (SQL shell).

## API

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| GET | `/health` | 200 (includes `database: up`) | 503 when the database is unreachable |
| GET | `/trips` | 200 (newest 50) | 503 `DATABASE_UNAVAILABLE` |
| POST | `/trips` | 201 + `Location`; optional `passengers` saved in the same transaction | 400 `VALIDATION_FAILED` / `MALFORMED_JSON`, 409 `CONFLICT` |
| GET | `/trips/:id` | 200, with passengers | 400 (id not a UUID), 404 `NOT_FOUND` |
| DELETE | `/trips/:id` | 204 (passengers deleted too) | 404 |
| GET | `/trips/:id/passengers` | 200 | 404 |
| POST | `/trips/:id/passengers` | 201 | 400 (more passengers than the trip allows), 404, 409 (same person twice) |

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

- No authentication yet (Stage 4): anyone can read or delete any trip.
- Passports and other travel documents are not stored yet; they arrive with file storage (Stage 7) and will be encrypted.
- Migrations run automatically when the API starts. Larger systems run them as a separate deploy step.
