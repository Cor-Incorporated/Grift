import { afterEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdminUser } from '@/lib/auth/authorization'

function createSupabaseMock(hasAdmin: boolean): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: hasAdmin ? { id: 'admin-id' } : null,
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

afterEach(() => {
  delete process.env.ADMIN_EMAIL_ALLOWLIST
  delete process.env.ADMIN_CLERK_USER_IDS
})

describe('isAdminUser', () => {
  it('uses email allowlist as strict gate when configured', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'company@cor-jp.com'

    const allowed = await isAdminUser(
      createSupabaseMock(true),
      'user_a',
      'company@cor-jp.com'
    )
    const denied = await isAdminUser(
      createSupabaseMock(true),
      'user_b',
      'other@example.com'
    )

    expect(allowed).toBe(true)
    expect(denied).toBe(false)
  })

  it('uses clerk user id allowlist before email allowlist', async () => {
    process.env.ADMIN_CLERK_USER_IDS = 'user_only'
    process.env.ADMIN_EMAIL_ALLOWLIST = 'company@cor-jp.com'

    const allowed = await isAdminUser(
      createSupabaseMock(false),
      'user_only',
      'other@example.com'
    )
    const denied = await isAdminUser(
      createSupabaseMock(true),
      'user_other',
      'company@cor-jp.com'
    )

    expect(allowed).toBe(true)
    expect(denied).toBe(false)
  })

  it('falls back to admins table when no allowlist configured', async () => {
    const allowed = await isAdminUser(createSupabaseMock(true), 'user_any', 'any@example.com')
    const denied = await isAdminUser(createSupabaseMock(false), 'user_any', 'any@example.com')

    expect(allowed).toBe(true)
    expect(denied).toBe(false)
  })
})
