import { describe, expect, it } from 'vitest'
import {
  isValidCronToken,
  readCronTokenFromHeaders,
} from '@/lib/source-analysis/cron'

describe('source analysis cron auth', () => {
  it('reads bearer token from authorization header', () => {
    const headers = new Headers({
      authorization: 'Bearer secret-token',
    })
    expect(readCronTokenFromHeaders(headers)).toBe('secret-token')
  })

  it('falls back to x-cron-secret header', () => {
    const headers = new Headers({
      'x-cron-secret': 'secret-token',
    })
    expect(readCronTokenFromHeaders(headers)).toBe('secret-token')
  })

  it('validates token against expected secret', () => {
    expect(
      isValidCronToken({
        expectedSecret: 'secret-token',
        providedToken: 'secret-token',
      })
    ).toBe(true)
    expect(
      isValidCronToken({
        expectedSecret: 'secret-token',
        providedToken: 'wrong-token',
      })
    ).toBe(false)
  })
})
