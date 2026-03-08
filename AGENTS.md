# Repository Guidelines

## Project Structure

This repository is a monorepo with two tracks.

- `v1/`: Next.js reference implementation. Run all legacy app commands from here.
- `apps/web/`: v2 React web client.
- `services/control-api/`: v2 Go control plane.
- `services/intelligence-worker/`: v2 Python async worker.
- `services/llm-gateway/`: v2 Python LLM routing layer.
- `packages/contracts/`: OpenAPI and DDL SSOT.
- `docs/v2/`: ADRs, architecture, roadmap, and testing guardrails.
- `infra/terraform/`: GCP infrastructure.

Do not assume root is a Next.js app. The active v2 entrypoints are `apps/`, `services/`, `packages/`, and `docs/v2/`.

## Commands

### v2

- `mise run dev`: start local infrastructure and print per-service start commands
- `mise run lint`: lint v2 services
- `mise run test`: run v2 tests
- `mise run build`: build v2 services
- `npm run ci:v2:openapi`: OpenAPI guardrails
- `npm run ci:v2:schema`: schema / RLS guardrails
- `npm run ci:v2:monorepo`: monorepo scaffold + hygiene guardrails
- `npm run ci:v2:adr`: ADR consistency guardrails
- `npm run ci:v2:env`: local env readiness check

### v1

- `cd v1 && npm run dev`
- `cd v1 && npm run build`
- `cd v1 && npm run lint`
- `cd v1 && npm run test`

## Environment

- Keep `.env.local` at repo root.
- Do not archive or move `.env.local` into `v1/`.
- v2 bootstrap expectations are defined in `docs/v2/platform-bootstrap.md`.

## Working Rules

- Treat `packages/contracts/openapi.yaml` and `packages/contracts/initial-schema.sql` as contract-first SSOT.
- Update `docs/v2` ADRs when changing architectural constraints.
- Prefer touching v2 code unless the task is explicitly about legacy v1 behavior.
