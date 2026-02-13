# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BenevolentDirector is a Next.js (App Router) application that converts unstructured requests (Slack-style messy instructions) into structured requirements, estimates, and actionable work packets. It operates as a dashboard-only MVP for project intake, estimation, and task execution management.

## Commands

```bash
npm run dev              # Dev server with Turbopack (http://localhost:3000)
npm run build            # Production build (uses webpack, NOT turbopack)
npm run lint             # ESLint
npm run type-check       # tsc --noEmit
npm run test             # Vitest (single run)
npm run test:watch       # Vitest (watch mode)
npm run test:coverage    # Vitest with V8 coverage
npm run test:e2e         # Playwright (chromium, requires dev server)
npm run ci:migrations    # Validate migration file ordering
```

Run a single test file: `npx vitest run src/lib/intake/__tests__/completeness.test.ts`

## Architecture

### Tech Stack
- **Framework**: Next.js 16 (App Router, React 19, RSC)
- **Auth**: Clerk (`@clerk/nextjs`) with Japanese locale, RBAC via env-based allowlists + `team_members` table
- **Database**: Supabase (PostgreSQL) via `@supabase/ssr`
- **AI**: Anthropic Claude SDK (`@anthropic-ai/sdk`) + xAI/Grok (raw fetch to `/v1/responses`)
- **UI**: Tailwind CSS v4, shadcn/ui (new-york style), Radix UI, Lucide icons
- **State**: Zustand (client), Sonner (toasts)
- **Testing**: Vitest + Testing Library (unit), Playwright (e2e)
- **Validation**: Zod

### Directory Layout
```
src/
├── app/                    # Next.js App Router pages & API routes
│   ├── api/                # Route handlers (POST/GET)
│   ├── admin/              # Admin area (protected by RBAC layout guard)
│   ├── dashboard/          # Customer dashboard
│   └── projects/           # Project creation flow
├── components/
│   ├── ui/                 # shadcn primitives (excluded from coverage)
│   ├── admin/              # Admin feature components
│   ├── chat/               # Conversation UI
│   ├── estimates/          # Estimation display
│   └── layout/             # Admin sidebar
├── lib/
│   ├── ai/                 # AI clients (anthropic.ts, xai.ts, grok.ts, system-prompts.ts)
│   ├── auth/               # RBAC: getInternalRoles(), isAdminUser(), canAccessProject()
│   ├── intake/             # Intake pipeline: parser, completeness, queue-order, demo-cases
│   ├── approval/           # Approval gate logic
│   ├── audit/              # Audit logging
│   ├── change-requests/    # Change request operations
│   ├── market/             # Market evidence for estimates
│   ├── pricing/            # Pricing policy engine
│   ├── source-analysis/    # File/repo analysis
│   ├── supabase/           # DB clients: server.ts (SSR + service-role), client.ts (browser)
│   ├── usage/              # API usage tracking/quota
│   └── utils/              # Shared utilities
├── hooks/                  # React hooks (e.g., use-realtime-conversations)
├── stores/                 # Zustand stores
├── types/                  # TypeScript types (database.ts is the canonical schema)
└── test/                   # Test setup (vitest + jest-dom)
```

### Key Architectural Patterns

**Auth & RBAC**: Clerk handles session auth. The admin layout (`src/app/admin/layout.tsx`) server-side checks `getInternalRoles()` and redirects non-admins. Roles (`admin`, `sales`, `dev`, `customer`) resolve from env allowlists → `team_members` table → legacy `admins` table (fallback chain). API routes use `createServiceRoleClient()` for privileged DB access.

**Two Supabase clients**: `createServerSupabaseClient()` uses cookie-based auth for SSR pages; `createServiceRoleClient()` bypasses RLS for API routes. Never use the service-role client on the browser side.

**AI dual-provider**: Claude handles conversation/analysis (via SDK). xAI/Grok handles market research with web search tools (via raw fetch). Both track usage in `api_usage_logs`.

**Intake pipeline**: Raw text → `parse` (AI intent decomposition) → `ingest` (creates change requests) → `follow-up` (generates missing-info questions) → completeness scoring → queue placement (`needs_info` / `ready_to_start`).

**Migrations**: SQL files in `supabase/migrations/` with `YYYYMMDDNNNN_name.sql` naming. Applied via Supabase CLI (`supabase db push`) or SQL Editor. CI validates file ordering via `scripts/check-migrations.mjs`.

### Path Alias
`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vitest.config.mts`).

## Coding Conventions

- TypeScript + React function components, 2-space indentation, single quotes, no semicolons
- kebab-case filenames (`chat-input.tsx`, `rate-limit.ts`)
- Tests: `*.test.ts(x)` or `*.spec.ts(x)` in `__tests__/` directories alongside source
- E2E tests: `e2e/*.spec.ts`
- Domain types: `src/types/database.ts` is the single source of truth for DB entity shapes

## CI Pipeline

CI runs on every push to `main`/`develop` and all PRs. The `quality-gate` job requires all of these to pass:
- `lint` → `type-check` → `unit-tests` (with coverage) → `migration-check` → `build` → `e2e-smoke`

Build requires real Clerk keys (set as GitHub Secrets). Supabase keys can be dummies for CI.

## Environment Variables

Copy `.env.example` → `.env.local`. Required for local dev:
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (must be real, not dummy), `CLERK_SECRET_KEY`
- AI: `ANTHROPIC_API_KEY`, `XAI_API_KEY`
- RBAC: `ADMIN_EMAIL_ALLOWLIST` (comma-separated emails)
