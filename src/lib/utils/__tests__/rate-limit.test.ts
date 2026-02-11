import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkRateLimit } from '../rate-limit'

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
})
