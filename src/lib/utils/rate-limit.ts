import { NextResponse } from 'next/server'

const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetIn: number
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig = { maxRequests: 10, windowMs: 60000 }
): RateLimitResult {
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + config.windowMs })
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetIn: config.windowMs,
    }
  }

  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: entry.resetTime - now,
    }
  }

  rateLimitMap.set(key, { ...entry, count: entry.count + 1 })
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count - 1,
    resetIn: entry.resetTime - now,
  }
}

/**
 * Extract client identifier from request for rate limiting.
 * Uses authenticated user ID when available, falls back to IP address.
 */
export function getClientIdentifier(request: Request, userId?: string | null): string {
  if (userId) {
    return userId
  }

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp
  }

  return 'unknown'
}

/**
 * Apply rate limiting and return a 429 response if the limit is exceeded.
 * Returns null if the request is allowed to proceed.
 */
export function applyRateLimit(
  request: Request,
  endpoint: string,
  config: RateLimitConfig,
  userId?: string | null
): NextResponse | null {
  const clientId = getClientIdentifier(request, userId)
  const key = `${endpoint}:${clientId}`
  const result = checkRateLimit(key, config)

  if (!result.allowed) {
    const retryAfterSeconds = Math.ceil(result.resetIn / 1000)
    return NextResponse.json(
      { success: false, error: 'リクエスト制限を超えました。しばらくお待ちください。' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Limit': String(config.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil((Date.now() + result.resetIn) / 1000)),
        },
      }
    )
  }

  return null
}

/**
 * Apply rate limiting for SSE/streaming endpoints.
 * Returns a plain Response (not NextResponse) for compatibility with SSE streams.
 */
export function applyRateLimitRaw(
  request: Request,
  endpoint: string,
  config: RateLimitConfig,
  userId?: string | null
): Response | null {
  const clientId = getClientIdentifier(request, userId)
  const key = `${endpoint}:${clientId}`
  const result = checkRateLimit(key, config)

  if (!result.allowed) {
    const retryAfterSeconds = Math.ceil(result.resetIn / 1000)
    return new Response(
      JSON.stringify({ success: false, error: 'リクエスト制限を超えました。しばらくお待ちください。' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Limit': String(config.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil((Date.now() + result.resetIn) / 1000)),
        },
      }
    )
  }

  return null
}
