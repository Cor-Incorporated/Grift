import { afterEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canAccessAdminArea,
  canResolveApprovalRequestByRole,
  getInternalRoles,
  isAdminUser,
} from '@/lib/auth/authorization'

interface SupabaseMockInput {
  admins?: boolean
  teamMemberRoles?: string[]
  teamMemberActive?: boolean
}

function createSupabaseMock(input: SupabaseMockInput): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'admins') {
              return {
                data: input.admins ? { id: 'admin-id' } : null,
                error: null,
              }
            }

            if (table === 'team_members') {
              if (!input.teamMemberRoles) {
                return { data: null, error: null }
              }

              return {
                data: {
                  roles: input.teamMemberRoles,
                  active: input.teamMemberActive ?? true,
                },
                error: null,
              }
            }

            return { data: null, error: null }
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

afterEach(() => {
  delete process.env.ADMIN_EMAIL_ALLOWLIST
  delete process.env.ADMIN_CLERK_USER_IDS
  delete process.env.SALES_EMAIL_ALLOWLIST
  delete process.env.SALES_CLERK_USER_IDS
  delete process.env.DEV_EMAIL_ALLOWLIST
  delete process.env.DEV_CLERK_USER_IDS
})

describe('isAdminUser', () => {
  it('uses email allowlist as strict gate when configured', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'company@cor-jp.com'

    const allowed = await isAdminUser(
      createSupabaseMock({ admins: true }),
      'user_a',
      'company@cor-jp.com'
    )
    const denied = await isAdminUser(
      createSupabaseMock({ admins: true }),
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
      createSupabaseMock({ admins: false }),
      'user_only',
      'other@example.com'
    )
    const denied = await isAdminUser(
      createSupabaseMock({ admins: true }),
      'user_other',
      'company@cor-jp.com'
    )

    expect(allowed).toBe(true)
    expect(denied).toBe(false)
  })

  it('falls back to admins table when no allowlist configured', async () => {
    const allowed = await isAdminUser(
      createSupabaseMock({ admins: true }),
      'user_any',
      'any@example.com'
    )
    const denied = await isAdminUser(
      createSupabaseMock({ admins: false }),
      'user_any',
      'any@example.com'
    )

    expect(allowed).toBe(true)
    expect(denied).toBe(false)
  })
})

describe('getInternalRoles', () => {
  it('resolves sales role from env allowlist', async () => {
    process.env.SALES_EMAIL_ALLOWLIST = 'sales@example.com'

    const roles = await getInternalRoles(
      createSupabaseMock({ admins: false }),
      'user_sales',
      'sales@example.com'
    )

    expect(roles.has('sales')).toBe(true)
    expect(roles.has('admin')).toBe(false)
  })

  it('resolves dev role from team_members table', async () => {
    const roles = await getInternalRoles(
      createSupabaseMock({ admins: false, teamMemberRoles: ['dev'] }),
      'user_dev',
      'dev@example.com'
    )

    expect(roles.has('dev')).toBe(true)
  })
})

describe('canResolveApprovalRequestByRole', () => {
  it('allows admin for any required role', () => {
    const roles = new Set(['admin'] as const)
    const allowed = canResolveApprovalRequestByRole({
      internalRoles: roles,
      requiredRole: 'dev',
    })

    expect(allowed).toBe(true)
  })

  it('denies when required role does not match', () => {
    const roles = new Set(['sales'] as const)
    const allowed = canResolveApprovalRequestByRole({
      internalRoles: roles,
      requiredRole: 'dev',
    })

    expect(allowed).toBe(false)
  })
})

describe('canAccessAdminArea', () => {
  it('allows only admin role', async () => {
    const adminAllowed = await canAccessAdminArea(
      createSupabaseMock({ admins: true }),
      'user_admin',
      'admin@example.com'
    )

    const salesDenied = await canAccessAdminArea(
      createSupabaseMock({ admins: false, teamMemberRoles: ['sales'] }),
      'user_sales',
      'sales@example.com'
    )

    expect(adminAllowed).toBe(true)
    expect(salesDenied).toBe(false)
  })
})
