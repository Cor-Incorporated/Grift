import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkRateLimit, getClientIdentifier, applyRateLimit, applyRateLimitRaw } from '../rate-limit'

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------
describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow requests within the limit', () => {
    const result = checkRateLimit('test-key', {
      maxRequests: 5,
      windowMs: 60000,
    })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('should block requests exceeding the limit', () => {
    const config = { maxRequests: 3, windowMs: 60000 }

    checkRateLimit('block-test', config)
    checkRateLimit('block-test', config)
    checkRateLimit('block-test', config)

    const result = checkRateLimit('block-test', config)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('should reset after the window expires', () => {
    const config = { maxRequests: 2, windowMs: 60000 }

    checkRateLimit('reset-test', config)
    checkRateLimit('reset-test', config)

    const blocked = checkRateLimit('reset-test', config)
    expect(blocked.allowed).toBe(false)

    vi.advanceTimersByTime(61000)

    const afterReset = checkRateLimit('reset-test', config)
    expect(afterReset.allowed).toBe(true)
    expect(afterReset.remaining).toBe(1)
  })

  it('should track different keys independently', () => {
    const config = { maxRequests: 1, windowMs: 60000 }

    checkRateLimit('key-a', config)
    const resultA = checkRateLimit('key-a', config)
    expect(resultA.allowed).toBe(false)

    const resultB = checkRateLimit('key-b', config)
    expect(resultB.allowed).toBe(true)
  })

  it('returns remaining count that decrements with each allowed request', () => {
    const config = { maxRequests: 3, windowMs: 60000 }
    const key = 'decrement-test'

    const r1 = checkRateLimit(key, config)
    expect(r1.remaining).toBe(2)

    const r2 = checkRateLimit(key, config)
    expect(r2.remaining).toBe(1)

    const r3 = checkRateLimit(key, config)
    expect(r3.remaining).toBe(0)
  })

  it('returns positive resetIn for blocked requests', () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const key = 'reset-in-test'

    checkRateLimit(key, config)
    const blocked = checkRateLimit(key, config)
    expect(blocked.resetIn).toBeGreaterThan(0)
    expect(blocked.resetIn).toBeLessThanOrEqual(60000)
  })

  it('uses default config (10 requests / 60s) when none provided', () => {
    const result = checkRateLimit('default-config-key')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// getClientIdentifier
// ---------------------------------------------------------------------------
describe('getClientIdentifier', () => {
  it('returns userId when provided', () => {
    const req = new Request('https://example.com')
    expect(getClientIdentifier(req, 'user_abc')).toBe('user_abc')
  })

  it('returns first IP from x-forwarded-for when no userId', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3' },
    })
    expect(getClientIdentifier(req)).toBe('10.0.0.1')
  })

  it('trims whitespace from x-forwarded-for first IP', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '  192.168.1.1  , 192.168.1.2' },
    })
    expect(getClientIdentifier(req)).toBe('192.168.1.1')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-real-ip': '203.0.113.5' },
    })
    expect(getClientIdentifier(req)).toBe('203.0.113.5')
  })

  it('returns "unknown" when no IP headers and no userId', () => {
    const req = new Request('https://example.com')
    expect(getClientIdentifier(req)).toBe('unknown')
  })

  it('prefers userId over IP headers', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '10.0.0.2' },
    })
    expect(getClientIdentifier(req, 'user_priority')).toBe('user_priority')
  })

  it('returns "unknown" when userId is null', () => {
    const req = new Request('https://example.com')
    expect(getClientIdentifier(req, null)).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// applyRateLimit
// ---------------------------------------------------------------------------
describe('applyRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when request is within limit', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    const config = { maxRequests: 10, windowMs: 60000 }
    const result = applyRateLimit(req, '/api/apply-test-allow', config)
    expect(result).toBeNull()
  })

  it('returns 429 NextResponse when rate limit is exceeded', async () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const endpoint = '/api/apply-test-block'
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '5.5.5.5' },
    })

    // First request: allowed
    applyRateLimit(req, endpoint, config)

    // Second request: blocked
    const response = applyRateLimit(req, endpoint, config)
    expect(response).not.toBeNull()
    expect(response?.status).toBe(429)
  })

  it('blocked response includes Retry-After header', async () => {
    const config = { maxRequests: 1, windowMs: 30000 }
    const endpoint = '/api/apply-retry-after'
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '6.6.6.6' },
    })

    applyRateLimit(req, endpoint, config)
    const response = applyRateLimit(req, endpoint, config)

    const retryAfter = response?.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  it('blocked response includes X-RateLimit-Limit header', () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const endpoint = '/api/apply-limit-header'
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '7.7.7.7' },
    })

    applyRateLimit(req, endpoint, config)
    const response = applyRateLimit(req, endpoint, config)

    expect(response?.headers.get('X-RateLimit-Limit')).toBe('1')
    expect(response?.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  it('blocked response body contains success: false and error message', async () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const endpoint = '/api/apply-body-check'
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '8.8.8.8' },
    })

    applyRateLimit(req, endpoint, config)
    const response = applyRateLimit(req, endpoint, config)
    const body = await response?.json()
    expect(body.success).toBe(false)
    expect(typeof body.error).toBe('string')
  })

  it('uses userId to build the rate limit key (different users tracked separately)', () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const endpoint = '/api/apply-user-key'
    const req = new Request('https://example.com')

    // User A gets blocked after 1 request
    applyRateLimit(req, endpoint, config, 'user_A')
    const blockedA = applyRateLimit(req, endpoint, config, 'user_A')
    expect(blockedA?.status).toBe(429)

    // User B is independent and not blocked
    const allowedB = applyRateLimit(req, endpoint, config, 'user_B')
    expect(allowedB).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// applyRateLimitRaw
// ---------------------------------------------------------------------------
describe('applyRateLimitRaw', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when request is within limit', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '9.9.9.9' },
    })
    const config = { maxRequests: 10, windowMs: 60000 }
    const result = applyRateLimitRaw(req, '/api/raw-allow', config)
    expect(result).toBeNull()
  })

  it('returns plain Response (not NextResponse) when blocked', () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const endpoint = '/api/raw-block'
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '11.11.11.11' },
    })

    applyRateLimitRaw(req, endpoint, config)
    const response = applyRateLimitRaw(req, endpoint, config)

    expect(response).not.toBeNull()
    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(429)
  })

  it('blocked raw response has Content-Type application/json', () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const endpoint = '/api/raw-content-type'
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '12.12.12.12' },
    })

    applyRateLimitRaw(req, endpoint, config)
    const response = applyRateLimitRaw(req, endpoint, config)

    expect(response?.headers.get('Content-Type')).toContain('application/json')
  })

  it('blocked raw response includes Retry-After header', () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const endpoint = '/api/raw-retry-after'
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '13.13.13.13' },
    })

    applyRateLimitRaw(req, endpoint, config)
    const response = applyRateLimitRaw(req, endpoint, config)

    const retryAfter = response?.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  it('blocked raw response body contains success: false', async () => {
    const config = { maxRequests: 1, windowMs: 60000 }
    const endpoint = '/api/raw-body'
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '14.14.14.14' },
    })

    applyRateLimitRaw(req, endpoint, config)
    const response = applyRateLimitRaw(req, endpoint, config)
    const body = JSON.parse(await response!.text())
    expect(body.success).toBe(false)
    expect(typeof body.error).toBe('string')
  })
})
