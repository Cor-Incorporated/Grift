# Repository Guidelines

## Project Structure & Module Organization
This repository is a single Next.js App Router project.
- `src/app`: routes, layouts, and API handlers (`src/app/api/*/route.ts`).
- `src/components`: reusable UI (`src/components/ui`) and feature components (`chat`, `estimates`, `layout`).
- `src/lib`: integrations and utilities (`ai`, `supabase`, `utils`).
- `src/hooks`, `src/stores`, `src/types`: shared hooks, state, and type definitions.
- `src/test`: test setup; utility tests also live in `src/lib/utils/__tests__`.
- `e2e`: Playwright end-to-end specs.
- `public`: static assets.

Use the TypeScript path alias `@/*` (for example, `@/components/ui/button`).

## Build, Test, and Development Commands
- `npm run dev`: start local development server at `http://localhost:3000`.
- `npm run build`: create a production build.
- `npm run start`: serve the production build.
- `npm run lint`: run ESLint checks.
- `npm run type-check`: run strict TypeScript checks without emitting files.
- `npm run test`: run Vitest once.
- `npm run test:watch`: run Vitest in watch mode.
- `npm run test:coverage`: generate coverage reports (text/json/html).
- `npm run test:e2e`: run Playwright tests in `e2e/`.

## Coding Style & Naming Conventions
- Language: TypeScript + React function components.
- Follow existing formatting: 2-space indentation, single quotes, no semicolons.
- Use kebab-case filenames (`chat-input.tsx`, `rate-limit.ts`).
- Name test files with `.test.ts(x)` or `.spec.ts(x)`.
- Keep shared primitives in `src/components/ui`; keep feature-specific code close to its route/feature folder.

## Testing Guidelines
- Unit/integration tests use Vitest + Testing Library (`jsdom`), configured in `vitest.config.ts` and `src/test/setup.ts`.
- Match Vitest include pattern: `src/**/*.{test,spec}.{ts,tsx}`.
- E2E tests use Playwright (`e2e/*.spec.ts`).
- Before opening a PR, run at minimum: `npm run lint`, `npm run test`, and `npm run type-check`.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style used in history: `feat: ...`, `chore: ...`, `fix: ...`.
- Keep commits small and focused by concern.
- PRs should include:
  - concise summary of user-visible and technical changes,
  - linked issue/task when applicable,
  - verification steps and command output summary,
  - screenshots for UI changes.

## Security & Configuration Tips
- Copy `.env.example` to `.env.local` for local setup.
- Never commit API keys or secrets.
- If environment variables change, document them clearly in the PR description.
