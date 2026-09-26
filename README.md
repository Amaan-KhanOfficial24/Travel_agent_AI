# Travel_agent_AI

An AI travel agent built as a hands-on learning project: flight search, booking and
fare-change recovery on the Duffel test API, with a TypeScript API (Express),
a React front end (Vite) and PostgreSQL.

## Status

| Stage | What | State |
| --- | --- | --- |
| 1 | Repository structure, config contract, Codespaces | Done |
| 2 | API skeleton: layers, validation, errors, request IDs, logs, tests | Done |
| 3 | PostgreSQL | Next |

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
    trips/           routes → controller → service → repository (+ schema)
apps/web/        Vite + React front end (Stage 5)
docs/            notes and diagrams
.devcontainer/   GitHub Codespaces setup (Node 22 + Docker)
.github/         CI: type-check and tests on every push / pull request
```

## Run it

Open the repository in GitHub Codespaces (Code → Codespaces → Create codespace on main), then:

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:api          # API on http://localhost:3000
npm test                 # run the test suite
```

## API (Stage 2)

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| GET | `/health` | 200 | — |
| GET | `/trips` | 200 | — |
| POST | `/trips` | 201 + `Location` header | 400 `VALIDATION_FAILED`, 400 `MALFORMED_JSON` |
| GET | `/trips/:id` | 200 | 400 (id not a UUID), 404 `NOT_FOUND` |

Every response carries an `X-Request-Id` header; every error body includes the same
`requestId`, which matches the `req.id` field in the server logs.

Example:

```bash
curl -s -X POST localhost:3000/trips -H 'Content-Type: application/json' \
  -d '{"origin":"DXB","destination":"LHR","departureDate":"2026-12-15","adults":2,"children":1}'
```

## Configuration

Copy `apps/api/.env.example` to `apps/api/.env`. `.env` files are git-ignored and must never be committed.
The API refuses to start if a variable is invalid (e.g. `PORT=abc`).

## Known limitations (Stage 2)

- Trips are stored in memory and disappear on restart (PostgreSQL arrives in Stage 3).
- No authentication yet (Stage 4): anyone can read any trip.
