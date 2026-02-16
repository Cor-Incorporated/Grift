import type { RateLimitConfig } from './rate-limit'

/**
 * Centralized rate limit configuration for all API endpoints.
 *
 * Categories:
 * - POST endpoints (mutations): stricter limits
 * - GET endpoints (reads): more lenient limits
 * - Admin endpoints: moderate limits
 * - AI/streaming endpoints: stricter due to resource cost
 * - Webhook endpoints: lenient since they come from external services
 * - Cron endpoints: lenient for automated jobs
 *
 * All values are per-client (user ID or IP address) within the window.
 * To swap to Redis later, only the checkRateLimit() implementation needs to change.
 */

const ONE_MINUTE = 60_000

// --- Customer-facing POST endpoints (AI-heavy, mutations) ---

export const RATE_LIMITS = {
  // Conversations (AI streaming - expensive)
  'conversations:stream:post': {
    maxRequests: 20,
    windowMs: ONE_MINUTE,
  },
  'conversations:post': {
    maxRequests: 20,
    windowMs: ONE_MINUTE,
  },
  'conversations:regenerate:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'conversations:get': {
    maxRequests: 60,
    windowMs: ONE_MINUTE,
  },
  'conversations:delete': {
    maxRequests: 20,
    windowMs: ONE_MINUTE,
  },

  // Projects
  'projects:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'projects:get': {
    maxRequests: 60,
    windowMs: ONE_MINUTE,
  },
  'projects:delete': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },

  // Customer profile
  'customers:profile:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'customers:profile:get': {
    maxRequests: 60,
    windowMs: ONE_MINUTE,
  },

  // File uploads
  'files:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'files:get': {
    maxRequests: 60,
    windowMs: ONE_MINUTE,
  },

  // Estimates (AI-heavy)
  'estimates:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'estimates:get': {
    maxRequests: 60,
    windowMs: ONE_MINUTE,
  },

  // Source analysis
  'source-analysis:repository:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'source-analysis:jobs:run:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },

  // Change requests
  'change-requests:post': {
    maxRequests: 20,
    windowMs: ONE_MINUTE,
  },
  'change-requests:get': {
    maxRequests: 60,
    windowMs: ONE_MINUTE,
  },
  'change-requests:estimate:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'change-requests:estimate-batch-runs:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'change-requests:ready-packet:get': {
    maxRequests: 60,
    windowMs: ONE_MINUTE,
  },
  'change-requests:taskize:post': {
    maxRequests: 20,
    windowMs: ONE_MINUTE,
  },

  // Execution tasks
  'execution-tasks:patch': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },

  // Intake pipeline (AI-heavy)
  'intake:parse:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'intake:ingest:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'intake:demo-run:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'intake:follow-up:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },

  // --- Admin endpoints (moderate limits) ---

  'admin:profile:get': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
  'admin:profile:put': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'admin:pricing-policies:get': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
  'admin:pricing-policies:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'admin:data-sources:get': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
  'admin:data-sources:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'admin:team-members:get': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
  'admin:team-members:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'admin:approval-requests:get': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
  'admin:approval-requests:post': {
    maxRequests: 20,
    windowMs: ONE_MINUTE,
  },
  'admin:approval-requests:patch': {
    maxRequests: 20,
    windowMs: ONE_MINUTE,
  },
  'admin:change-request-billable-rules:get': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
  'admin:change-request-billable-rules:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'admin:github:repos:get': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
  'admin:github:repos:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'admin:github:repos:patch': {
    maxRequests: 20,
    windowMs: ONE_MINUTE,
  },
  'admin:github:repos:analyze:post': {
    maxRequests: 5,
    windowMs: ONE_MINUTE,
  },
  'admin:github:repos:velocity:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'admin:linear:sync:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },
  'admin:linear:teams:get': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
  'admin:market:evidence:post': {
    maxRequests: 10,
    windowMs: ONE_MINUTE,
  },

  // --- Webhook endpoints (lenient - external services) ---

  'linear:webhooks:post': {
    maxRequests: 100,
    windowMs: ONE_MINUTE,
  },

  // --- Cron endpoints (lenient - automated jobs) ---

  'source-analysis:cron:post': {
    maxRequests: 30,
    windowMs: ONE_MINUTE,
  },
} as const satisfies Record<string, RateLimitConfig>
