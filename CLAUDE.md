# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Grift is a monorepo containing both v1 (Next.js) and v2 (React + Go + Python) implementations. v2 converts unstructured requests into structured requirements, estimates, and actionable work packets for contract development firms.

## Repository Structure

```
v1/                     # v1 Next.js app (reference implementation)
apps/web/               # v2 React frontend (Vite + React 19)
services/control-api/   # v2 Go API server (:8080)
services/intelligence-worker/  # v2 Python async worker
services/llm-gateway/   # v2 Python LLM router (:8081)
packages/contracts/     # OpenAPI spec + DDL schema
packages/config/        # Shared configuration
packages/domain-events/ # Event schema definitions
infra/terraform/        # GCP infrastructure
docs/v2/                # Architecture docs + ADRs
scripts/                # CI validation scripts
```

## Commands

### v2 (primary)
```bash
mise run dev             # Start infrastructure + print service start commands
mise run lint            # Lint all v2 services (Go + Python + React)
mise run test            # Test all v2 services
mise run build           # Build all v2 services
mise run fmt             # Format all v2 code
docker compose up -d     # Start PostgreSQL + Redis + Pub/Sub emulator

# CI guardrail checks (contract-first validation)
npm run ci:v2:openapi    # OpenAPI spec validation + tenant header checks
npm run ci:v2:schema     # SQL schema RLS + append-only + opt-in checks
npm run ci:v2:monorepo   # Monorepo scaffold validation
npm run ci:v2:adr        # ADR ↔ schema/OpenAPI consistency checks
npm run ci:v2:env        # Environment variable validation (local only)
```

### v1 (reference, runs from v1/)
```bash
cd v1 && npm run dev     # Dev server with Turbopack (http://localhost:3000)
cd v1 && npm run build   # Production build
cd v1 && npm run test    # Vitest (single run)
cd v1 && npm run lint    # ESLint
```

### CI validation (runs from root)
```bash
node scripts/check-v2-openapi.mjs   # Validate OpenAPI contract
node scripts/check-v2-schema.mjs    # Validate DDL schema
node scripts/check-v2-monorepo.mjs  # Validate monorepo scaffold
```

## Architecture

### Tech Stack
- **Framework**: Next.js 16 (App Router, React 19, RSC)
- **Auth**: Clerk (`@clerk/nextjs`) with Japanese locale, RBAC via env-based allowlists + `team_members` table
- **Database**: Supabase (PostgreSQL) via `@supabase/ssr`
- **AI**: Anthropic Claude SDK (`@anthropic-ai/sdk`) + xAI/Grok (raw fetch to `/v1/responses`)
- **Task Management**: Linear SDK (`@linear/sdk`) for issue/cycle/project sync
- **UI**: Tailwind CSS v4, shadcn/ui (new-york style), Radix UI, Lucide icons
- **State**: Zustand (client), Sonner (toasts)
- **Testing**: Vitest + Testing Library (unit), Playwright (e2e)
- **Validation**: Zod
- **Logging**: Structured JSON logger (`src/lib/utils/logger.ts`)

### Directory Layout
```
src/
├── app/                    # Next.js App Router pages & API routes
│   ├── api/                # Route handlers (POST/GET)
│   │   ├── admin/          # Admin API (github, linear, profile, etc.)
│   │   ├── health/         # Health check endpoint (no auth required)
│   │   ├── linear/         # Linear webhook receiver
│   │   └── ...             # conversations, estimates, projects, etc.
│   ├── admin/              # Admin area (protected by RBAC layout guard)
│   ├── dashboard/          # Customer dashboard
│   └── projects/           # Project creation flow
├── components/
│   ├── ui/                 # shadcn primitives (excluded from coverage)
│   ├── admin/              # Admin feature components
│   ├── chat/               # Conversation UI
│   ├── estimates/          # Estimation display + Linear sync widget
│   └── layout/             # Admin sidebar
├── lib/
│   ├── ai/                 # AI clients (anthropic.ts, xai.ts, grok.ts, system-prompts.ts)
│   ├── approval/           # Approval gate logic + Go/No-Go evaluation
│   ├── audit/              # Audit logging
│   ├── auth/               # RBAC: getInternalRoles(), isAdminUser(), canAccessProject()
│   ├── business-line/      # Business line classification
│   ├── change-requests/    # Change request operations
│   ├── estimates/          # Auto-generation, module decomposition, similar projects, speed advantage
│   ├── github/             # GitHub repo discovery, velocity analysis
│   ├── intake/             # Intake pipeline: parser, completeness, queue-order, demo-cases
│   ├── linear/             # Linear SDK client, sync logic, webhook verification
│   ├── market/             # Market evidence for estimates (Grok + fallback)
│   ├── pricing/            # Pricing policy engine + cost calculation
│   ├── source-analysis/    # File/repo/website analysis
│   ├── supabase/           # DB clients: server.ts (SSR + service-role), client.ts (browser)
│   ├── usage/              # API usage tracking/quota
│   └── utils/              # Shared utilities (rate-limit, logger, env validation)
├── hooks/                  # React hooks (e.g., use-realtime-conversations)
├── stores/                 # Zustand stores
├── types/                  # TypeScript types (database.ts is the canonical schema)
└── test/                   # Test setup (vitest + jest-dom)
```

### Key Architectural Patterns

**Auth & RBAC**: Clerk handles session auth. The admin layout (`src/app/admin/layout.tsx`) server-side checks `getInternalRoles()` and redirects non-admins. Roles (`admin`, `sales`, `dev`, `customer`) resolve from env allowlists → `team_members` table → legacy `admins` table (fallback chain). API routes use `createServiceRoleClient()` for privileged DB access.

**Two Supabase clients**: `createServerSupabaseClient()` uses cookie-based auth for SSR pages; `createServiceRoleClient()` bypasses RLS for API routes. Never use the service-role client on the browser side.

**AI dual-provider**: Claude handles conversation/analysis (via SDK). xAI/Grok handles market research with web search tools (via raw fetch) and website URL analysis for non-GitHub URLs. Both track usage in `api_usage_logs`.

**Intake pipeline**: Raw text → `parse` (AI intent decomposition) → `ingest` (creates change requests) → `follow-up` (generates missing-info questions) → completeness scoring → queue placement (`needs_info` / `ready_to_start`).

**Source analysis pipeline**: URLs submitted via `/api/source-analysis/repository` → enqueue job in `source_analysis_jobs` → `/api/source-analysis/jobs/run` processes queue. GitHub URLs use `analyzeRepositoryUrlWithClaude()` (downloads ZIP → analyzes with Claude). Non-GitHub URLs use `analyzeWebsiteUrlWithGrok()` (Grok web_search → extracts company/service/tech info). Results stored in `project_files.analysis_result`. Requires `GITHUB_TOKEN` for private repos.

**Auto-estimate generation**: When chat interview completes (`is_complete: true`), spec_markdown is generated, then `autoGenerateEstimate()` creates a draft estimate automatically. Events sent via SSE (`estimate_generated` / `estimate_error`). Bug reports and fix requests generate hours-only estimates (no pricing); new projects and feature additions include market comparison pricing.

**Estimate modes**: The system supports three estimate modes based on project type:
- `market_comparison` (new_project): Full market comparison with Grok evidence, pricing engine, value proposition
- `hours_only` (bug_report, fix_request): Hours breakdown only, no pricing/cost — these are warranty/contract scope
- `hybrid` (feature_addition): Hours-based with optional market comparison

**Go/No-Go evaluation**: Dynamic weight system for project approval. Bug/fix types skip profitability evaluation (weight=0) since they don't generate revenue. Weights: `{ profitability, strategicAlignment, capacity, technicalRisk }`.

**Linear integration**: Approved estimates can be synced to Linear via `syncEstimateToLinear()`. Creates Linear Project → Cycles (from implementation phases) → Issues (from modules). Webhook handler at `/api/linear/webhooks` receives status updates. Admin widget shows sync status and issue progress.

**SSE streaming**: `/api/conversations/stream` provides real-time chat responses via Server-Sent Events. The client connects per-message and receives `message_start`, `text_delta`, `message_complete`, `spec_generated`, and `estimate_generated` events.

**Rate limiting**: All 36 API endpoints have rate limiting via `applyRateLimit()` / `applyRateLimitRaw()`. Limits are centrally configured in `src/lib/utils/rate-limit-config.ts`. Returns 429 with `Retry-After` header.

**Security headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, and Permissions-Policy configured in `next.config.ts`.

**Structured logging**: `src/lib/utils/logger.ts` provides JSON-structured logging. Dev mode outputs human-readable format; production outputs single-line JSON. Controlled by `LOG_LEVEL` env var.

**Environment validation**: `src/lib/utils/env.ts` provides Zod-based validation for all env vars. Use `validateServerEnv()` at startup and `getServerEnv()` for lazy access.

**Health check**: `GET /api/health` returns system status (healthy/degraded/unhealthy) with database connectivity, service configuration checks, and uptime. No auth required.

**Project deletion**: Dashboard delete button uses Server Action (`deleteProjectAction`) with `useTransition` for pending state. FK constraints use `ON DELETE CASCADE` for `conversations`, `estimates`, `project_files`, and `source_analysis_jobs`.

**Migrations**: SQL files in `supabase/migrations/` with `YYYYMMDDNNNN_name.sql` naming. Applied via Supabase CLI (`supabase db push`) or SQL Editor. CI validates file ordering via `scripts/check-migrations.mjs`.

### Path Alias
- v2 React web: `@/*` maps to `apps/web/src/*`
- v1 reference app: `@/*` maps to `v1/src/*`

## Coding Conventions

- TypeScript + React function components, 2-space indentation, single quotes, no semicolons
- kebab-case filenames (`chat-input.tsx`, `rate-limit.ts`)
- Tests: `*.test.ts(x)` or `*.spec.ts(x)` in `__tests__/` directories alongside source
- E2E tests: `e2e/*.spec.ts`
- Domain types: `src/types/database.ts` is the single source of truth for DB entity shapes
- Use `logger` from `@/lib/utils/logger` instead of `console.error/log/warn` in `src/lib/`

## CI Pipeline

CI runs on every push to `main`/`develop` and all PRs. The `quality-gate` job requires both tracks:
- v1: `lint` → `type-check` → `unit-tests` (with coverage) → `migration-check` → `build` → `e2e-smoke`
- v2: `v2-openapi` → `v2-schema` → `v2-monorepo` → `v2-adr` → `v2-go-build` → `v2-python-lint` → `v2-web`

Build requires real Clerk keys (set as GitHub Secrets). Supabase keys can be dummies for CI.

## Environment Variables

Copy `.env.example` → `.env.local`. Required for local dev:
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (must be real, not dummy), `CLERK_SECRET_KEY`
- AI: `ANTHROPIC_API_KEY`, `XAI_API_KEY`
- GitHub: `GITHUB_TOKEN` (optional, for private repo analysis), `GITHUB_APP_*` (for GitHub App integration)
- Linear: `LINEAR_API_KEY`, `LINEAR_DEFAULT_TEAM_ID` (optional, for task management sync)
- RBAC: `ADMIN_EMAIL_ALLOWLIST` (comma-separated emails)
- Logging: `LOG_LEVEL` (optional, default: `info`; values: `debug`, `info`, `warn`, `error`)
