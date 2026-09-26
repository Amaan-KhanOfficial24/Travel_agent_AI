# Travel_agent_AI

An AI travel agent built as a hands-on learning project: flight search, booking and
fare-change recovery on the Duffel test API, with a TypeScript API (Express),
a React front end (Vite) and PostgreSQL.

## Status

Stage 1 — repository structure. No application code yet.

## Structure

```text
apps/api/   Express + TypeScript API (Stage 2)
apps/web/   Vite + React front end (Stage 5)
docs/       notes and diagrams
.devcontainer/  GitHub Codespaces setup (Node 22 + Docker)
```

## Run it

Open the repository in GitHub Codespaces (Code → Codespaces → Create codespace on main).
Node 22, Git and Docker are pre-installed by `.devcontainer/devcontainer.json`.

## Configuration

Copy `apps/api/.env.example` to `apps/api/.env` and fill in values locally.
`.env` files are git-ignored and must never be committed.
