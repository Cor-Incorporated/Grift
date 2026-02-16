import { z } from 'zod'

// Server-side env schema (validated on server startup)
const serverEnvSchema = z.object({
  // Supabase (required)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('有効なSupabase URLを設定してください'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'Supabase Anon Keyを設定してください'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'Supabase Service Role Keyを設定してください'),

  // Anthropic Claude (required)
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEYを設定してください'),

  // Clerk (required)
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .startsWith('pk_', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEYが無効です（pk_で始まるべき）')
    .min(1),
  CLERK_SECRET_KEY: z
    .string()
    .startsWith('sk_', 'CLERK_SECRET_KEYが無効です（sk_で始まるべき）')
    .min(1),

  // Clerk URLs (optional, defaults provided by Clerk)
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().optional(),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().optional(),
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: z.string().optional(),
  NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: z.string().optional(),

  // xAI / Grok (optional)
  XAI_API_KEY: z.string().optional(),

  // GitHub App (optional)
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),

  // Linear (optional)
  LINEAR_API_KEY: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  LINEAR_DEFAULT_TEAM_ID: z.string().optional(),

  // RBAC (optional)
  ADMIN_EMAIL_ALLOWLIST: z.string().optional(),
  ADMIN_CLERK_USER_IDS: z.string().optional(),
  SALES_CLERK_USER_IDS: z.string().optional(),
  SALES_EMAIL_ALLOWLIST: z.string().optional(),
  DEV_CLERK_USER_IDS: z.string().optional(),
  DEV_EMAIL_ALLOWLIST: z.string().optional(),

  // App configuration (optional)
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // Source analysis cron (optional)
  SOURCE_ANALYSIS_CRON_SECRET: z.string().optional(),
  SOURCE_ANALYSIS_CRON_DEFAULT_LIMIT: z.string().optional(),
  SOURCE_ANALYSIS_CRON_ACTOR_CLERK_USER_ID: z.string().optional(),

  // AI Models (optional, defaults provided by ai clients)
  ANTHROPIC_MODEL: z.string().optional(),
  XAI_MODEL: z.string().optional(),
  XAI_SEARCH_MODEL: z.string().optional(),

  // Runtime (set by Next.js)
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

// Client-side env schema (NEXT_PUBLIC_ only, safe for browser)
const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('有効なSupabase URLを設定してください'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'Supabase Anon Keyを設定してください'),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .startsWith('pk_', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEYが無効です')
    .min(1),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().optional(),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().optional(),
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: z.string().optional(),
  NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
})

/**
 * Validate server environment variables at startup.
 * Call this in your app entry point (e.g., root layout) to catch missing vars early.
 * Throws with detailed error message if validation fails.
 */
export function validateServerEnv(): void {
  const result = serverEnvSchema.safeParse(process.env)

  if (!result.success) {
    const errors = result.error.flatten()
    const fieldErrors = Object.entries(errors.fieldErrors)
      .map(([key, msgs]) => `  • ${key}: ${msgs?.join(', ')}`)
      .join('\n')

    const message =
      '環境変数の検証に失敗しました。以下を確認してください:\n' + fieldErrors

    throw new Error(message)
  }
}

/**
 * Validate client environment variables.
 * Used internally by client components.
 */
export function validateClientEnv(): void {
  const clientOnly = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL,
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  }

  const result = clientEnvSchema.safeParse(clientOnly)

  if (!result.success) {
    const errors = result.error.flatten()
    const fieldErrors = Object.entries(errors.fieldErrors)
      .map(([key, msgs]) => `  • ${key}: ${msgs?.join(', ')}`)
      .join('\n')

    const message =
      'クライアント環境変数の検証に失敗しました。以下を確認してください:\n' + fieldErrors

    throw new Error(message)
  }
}

/**
 * Lazy-evaluated server environment variables.
 * Only call from server-side code (API routes, server components, lib/).
 * Client code must use NEXT_PUBLIC_* variables directly.
 */
export function getServerEnv() {
  const result = serverEnvSchema.safeParse(process.env)

  if (!result.success) {
    const errors = result.error.flatten()
    const fieldErrors = Object.entries(errors.fieldErrors)
      .map(([key, msgs]) => `  • ${key}: ${msgs?.join(', ')}`)
      .join('\n')

    const message =
      '環境変数の検証に失敗しました。以下を確認してください:\n' + fieldErrors

    throw new Error(message)
  }

  return result.data
}

/**
 * Get client environment variables safely.
 * Only use for NEXT_PUBLIC_* variables.
 */
export function getClientEnv() {
  const clientOnly = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL,
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  }

  const result = clientEnvSchema.safeParse(clientOnly)

  if (!result.success) {
    const errors = result.error.flatten()
    const fieldErrors = Object.entries(errors.fieldErrors)
      .map(([key, msgs]) => `  • ${key}: ${msgs?.join(', ')}`)
      .join('\n')

    const message =
      'クライアント環境変数の検証に失敗しました。以下を確認してください:\n' + fieldErrors

    throw new Error(message)
  }

  return result.data
}

// Type exports
export type ServerEnv = z.infer<typeof serverEnvSchema>
export type ClientEnv = z.infer<typeof clientEnvSchema>
