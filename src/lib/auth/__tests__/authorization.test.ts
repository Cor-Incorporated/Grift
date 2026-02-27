import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canAccessAdminArea,
  canAccessProject,
  canResolveApprovalRequestByRole,
  getAuthenticatedUser,
  getInternalRoles,
  getUserRoles,
  isAdminUser,
  resolveCustomerIdForUser,
} from '@/lib/auth/authorization'

// ---------------------------------------------------------------------------
// Mock Clerk
// ---------------------------------------------------------------------------
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
}))

import { auth, currentUser } from '@clerk/nextjs/server'

// ---------------------------------------------------------------------------
// Supabase mock helpers
// ---------------------------------------------------------------------------

interface TeamMemberRow {
  roles: string[]
  active: boolean
}

interface SupabaseMockOptions {
  admins?: boolean
  adminsError?: boolean
  teamMemberByUserId?: TeamMemberRow | null
  teamMemberByUserIdError?: boolean
  teamMemberByEmail?: TeamMemberRow | null
  teamMemberByEmailError?: boolean
  customerByUserId?: { id: string } | null
  customerByUserIdError?: boolean
  customerByEmail?: { id: string; clerk_user_id: string | null } | null
  customerByEmailError?: boolean
  projectRow?: { id: string } | null
  projectError?: boolean
  updateError?: boolean
}

function createFlexSupabaseMock(opts: SupabaseMockOptions): SupabaseClient {
  const callCounts: Record<string, number> = {}

  return {
    from: (table: string) => {
      callCounts[table] = (callCounts[table] ?? 0) + 1

      return {
        select: () => ({
          eq: (col: string) => ({
            eq: () => ({
              maybeSingle: async () => {
                // projects table (double eq: id + customer_id)
                if (table === 'projects') {
                  if (opts.projectError) return { data: null, error: { message: 'db error' } }
                  return { data: opts.projectRow ?? null, error: null }
                }
                return { data: null, error: null }
              },
            }),
            maybeSingle: async () => {
              if (table === 'admins') {
                if (opts.adminsError) return { data: null, error: { message: 'db error' } }
                return { data: opts.admins ? { id: 'admin-id' } : null, error: null }
              }

              if (table === 'team_members') {
                if (col === 'clerk_user_id') {
                  if (opts.teamMemberByUserIdError) {
                    return { data: null, error: { message: 'db error' } }
                  }
                  return { data: opts.teamMemberByUserId ?? null, error: null }
                }
                // by email
                if (opts.teamMemberByEmailError) {
                  return { data: null, error: { message: 'db error' } }
                }
                return { data: opts.teamMemberByEmail ?? null, error: null }
              }

              if (table === 'customers') {
                if (col === 'clerk_user_id') {
                  if (opts.customerByUserIdError) {
                    return { data: null, error: { message: 'db error' } }
                  }
                  return { data: opts.customerByUserId ?? null, error: null }
                }
                // by email
                if (opts.customerByEmailError) {
                  return { data: null, error: { message: 'db error' } }
                }
                return { data: opts.customerByEmail ?? null, error: null }
              }

              return { data: null, error: null }
            },
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ error: opts.updateError ? { message: 'err' } : null }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

// Simplified mock used in original tests (retained for backwards compat)
function createSupabaseMock(input: {
  admins?: boolean
  teamMemberRoles?: string[]
  teamMemberActive?: boolean
}): SupabaseClient {
  return createFlexSupabaseMock({
    admins: input.admins ?? false,
    teamMemberByUserId: input.teamMemberRoles
      ? { roles: input.teamMemberRoles, active: input.teamMemberActive ?? true }
      : null,
  })
}

// ---------------------------------------------------------------------------
// Env cleanup
// ---------------------------------------------------------------------------
afterEach(() => {
  delete process.env.ADMIN_EMAIL_ALLOWLIST
  delete process.env.ADMIN_CLERK_USER_IDS
  delete process.env.SALES_EMAIL_ALLOWLIST
  delete process.env.SALES_CLERK_USER_IDS
  delete process.env.DEV_EMAIL_ALLOWLIST
  delete process.env.DEV_CLERK_USER_IDS
  vi.clearAllMocks()
})

// ===========================================================================
// getAuthenticatedUser
// ===========================================================================
describe('getAuthenticatedUser', () => {
  it('returns null when auth() returns no userId', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never)

    const result = await getAuthenticatedUser()

    expect(result).toBeNull()
  })

  it('returns user with email and full name when auth succeeds', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_123' } as never)
    vi.mocked(currentUser).mockResolvedValue({
      emailAddresses: [{ emailAddress: 'alice@example.com' }],
      firstName: 'Alice',
      lastName: 'Smith',
    } as never)

    const result = await getAuthenticatedUser()

    expect(result).toEqual({
      clerkUserId: 'user_123',
      email: 'alice@example.com',
      fullName: 'Alice Smith',
    })
  })

  it('returns Unknown as fullName when first/last name are absent', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_456' } as never)
    vi.mocked(currentUser).mockResolvedValue({
      emailAddresses: [{ emailAddress: 'no-name@example.com' }],
      firstName: null,
      lastName: null,
    } as never)

    const result = await getAuthenticatedUser()

    expect(result?.fullName).toBe('Unknown')
  })

  it('returns null email when emailAddresses is empty', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_789' } as never)
    vi.mocked(currentUser).mockResolvedValue({
      emailAddresses: [],
      firstName: 'Bob',
      lastName: null,
    } as never)

    const result = await getAuthenticatedUser()

    expect(result?.email).toBeNull()
    expect(result?.fullName).toBe('Bob')
  })

  it('returns null email when currentUser() returns null', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_999' } as never)
    vi.mocked(currentUser).mockResolvedValue(null)

    const result = await getAuthenticatedUser()

    expect(result?.email).toBeNull()
    expect(result?.fullName).toBe('Unknown')
  })

  it('builds fullName from only firstName when lastName is absent', async () => {
    vi.mocked(auth).mockResolvedValue({ userId: 'user_fn' } as never)
    vi.mocked(currentUser).mockResolvedValue({
      emailAddresses: [{ emailAddress: 'fn@example.com' }],
      firstName: 'OnlyFirst',
      lastName: null,
    } as never)

    const result = await getAuthenticatedUser()

    expect(result?.fullName).toBe('OnlyFirst')
  })
})

// ===========================================================================
// isAdminUser  (original tests preserved + extended)
// ===========================================================================
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

  it('returns false when admins table query errors', async () => {
    const result = await isAdminUser(
      createFlexSupabaseMock({ adminsError: true }),
      'user_x',
      'x@example.com'
    )

    expect(result).toBe(false)
  })

  it('returns false when user is not in allowlist and not in admins table', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com'

    const result = await isAdminUser(
      createFlexSupabaseMock({ admins: false }),
      'user_nobody',
      'nobody@example.com'
    )

    expect(result).toBe(false)
  })

  it('handles missing email (null) with email allowlist configured', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com'

    const result = await isAdminUser(
      createSupabaseMock({ admins: false }),
      'user_no_email',
      null
    )

    expect(result).toBe(false)
  })

  it('handles missing email (undefined) with email allowlist configured', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'admin@example.com'

    const result = await isAdminUser(
      createSupabaseMock({ admins: false }),
      'user_no_email'
    )

    expect(result).toBe(false)
  })
})

// ===========================================================================
// getInternalRoles  (original tests preserved + extended)
// ===========================================================================
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

  it('resolves multiple roles from team_members table', async () => {
    const roles = await getInternalRoles(
      createFlexSupabaseMock({
        admins: false,
        teamMemberByUserId: { roles: ['admin', 'dev'], active: true },
      }),
      'user_multi',
      'multi@example.com'
    )

    expect(roles.has('admin')).toBe(true)
    expect(roles.has('dev')).toBe(true)
    expect(roles.has('sales')).toBe(false)
  })

  it('ignores team_members roles when userId allowlist strictly denies', async () => {
    process.env.ADMIN_CLERK_USER_IDS = 'strict_admin_only'

    const roles = await getInternalRoles(
      createFlexSupabaseMock({
        admins: false,
        teamMemberByUserId: { roles: ['admin'], active: true },
      }),
      'other_user',
      'other@example.com'
    )

    // userId allowlist returns false for 'other_user', so admin is in strictRoles
    // team_members admin is blocked by strictRoles
    expect(roles.has('admin')).toBe(false)
  })

  it('returns empty set when team_members row has active=false', async () => {
    const roles = await getInternalRoles(
      createFlexSupabaseMock({
        admins: false,
        teamMemberByUserId: { roles: ['dev', 'sales'], active: false },
      }),
      'inactive_user',
      'inactive@example.com'
    )

    expect(roles.size).toBe(0)
  })

  it('falls back to admins legacy table and adds admin role', async () => {
    const roles = await getInternalRoles(
      createFlexSupabaseMock({ admins: true }),
      'legacy_admin',
      'legacy@example.com'
    )

    expect(roles.has('admin')).toBe(true)
  })

  it('does not query legacy admins table when admin is already in strictRoles', async () => {
    process.env.ADMIN_EMAIL_ALLOWLIST = 'strict@example.com'

    // admin allowlist is configured → admin goes into strictRoles
    // non-match → evaluateRoleFromAllowlist returns false → strictRoles.has('admin') is true
    // legacy admins table should NOT add admin
    const roles = await getInternalRoles(
      createFlexSupabaseMock({ admins: true }),
      'non_strict_user',
      'other@example.com'
    )

    expect(roles.has('admin')).toBe(false)
  })

  it('resolves roles from team_members by email fallback when no userId match', async () => {
    const roles = await getInternalRoles(
      createFlexSupabaseMock({
        admins: false,
        teamMemberByUserId: null,
        teamMemberByEmail: { roles: ['sales'], active: true },
      }),
      'user_no_userid_match',
      'sales@example.com'
    )

    expect(roles.has('sales')).toBe(true)
  })

  it('returns empty set when no email provided and no userId match in team_members', async () => {
    const roles = await getInternalRoles(
      createFlexSupabaseMock({ admins: false, teamMemberByUserId: null }),
      'user_no_email'
    )

    expect(roles.size).toBe(0)
  })

  it('ignores unknown roles in team_members', async () => {
    const roles = await getInternalRoles(
      createFlexSupabaseMock({
        admins: false,
        teamMemberByUserId: { roles: ['superuser', 'dev'] as unknown as string[], active: true },
      }),
      'user_mixed',
      'mixed@example.com'
    )

    expect(roles.has('dev')).toBe(true)
    expect(roles.size).toBe(1)
  })

  it('resolves dev role allowlist from env', async () => {
    process.env.DEV_CLERK_USER_IDS = 'user_dev_clerk'

    const roles = await getInternalRoles(
      createFlexSupabaseMock({ admins: false }),
      'user_dev_clerk',
      'dev@example.com'
    )

    expect(roles.has('dev')).toBe(true)
  })

  it('resolves sales role from userId allowlist', async () => {
    process.env.SALES_CLERK_USER_IDS = 'user_sales_clerk'

    const roles = await getInternalRoles(
      createFlexSupabaseMock({ admins: false }),
      'user_sales_clerk',
      'sales@example.com'
    )

    expect(roles.has('sales')).toBe(true)
  })
})

// ===========================================================================
// canResolveApprovalRequestByRole  (original tests preserved + extended)
// ===========================================================================
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

  it('allows when user has the exact required role', () => {
    const roles = new Set(['dev'] as const)
    const allowed = canResolveApprovalRequestByRole({
      internalRoles: roles,
      requiredRole: 'dev',
    })

    expect(allowed).toBe(true)
  })

  it('allows sales role to resolve sales-required approval', () => {
    const roles = new Set(['sales'] as const)
    const allowed = canResolveApprovalRequestByRole({
      internalRoles: roles,
      requiredRole: 'sales',
    })

    expect(allowed).toBe(true)
  })

  it('denies empty roles set', () => {
    const roles = new Set<'admin' | 'sales' | 'dev'>()
    const allowed = canResolveApprovalRequestByRole({
      internalRoles: roles,
      requiredRole: 'admin',
    })

    expect(allowed).toBe(false)
  })
})

// ===========================================================================
// canAccessAdminArea  (original tests preserved + extended)
// ===========================================================================
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

  it('denies dev-only user', async () => {
    const result = await canAccessAdminArea(
      createFlexSupabaseMock({
        admins: false,
        teamMemberByUserId: { roles: ['dev'], active: true },
      }),
      'user_dev',
      'dev@example.com'
    )

    expect(result).toBe(false)
  })

  it('allows user with both admin and dev roles', async () => {
    process.env.ADMIN_CLERK_USER_IDS = 'user_both'

    const result = await canAccessAdminArea(
      createFlexSupabaseMock({ admins: false }),
      'user_both',
      'both@example.com'
    )

    expect(result).toBe(true)
  })
})

// ===========================================================================
// resolveCustomerIdForUser
// ===========================================================================
describe('resolveCustomerIdForUser', () => {
  it('returns customer id when found by clerk user id', async () => {
    const supabase = createFlexSupabaseMock({
      customerByUserId: { id: 'cust_123' },
    })

    const id = await resolveCustomerIdForUser(supabase, 'user_clerk', 'user@example.com')

    expect(id).toBe('cust_123')
  })

  it('falls back to email lookup when clerk user id not found', async () => {
    const supabase = createFlexSupabaseMock({
      customerByUserId: null,
      customerByEmail: { id: 'cust_456', clerk_user_id: null },
    })

    const id = await resolveCustomerIdForUser(supabase, 'user_clerk', 'user@example.com')

    expect(id).toBe('cust_456')
  })

  it('returns null when no email provided and userId lookup fails', async () => {
    const supabase = createFlexSupabaseMock({ customerByUserId: null })

    const id = await resolveCustomerIdForUser(supabase, 'user_clerk')

    expect(id).toBeNull()
  })

  it('returns null when email lookup also fails', async () => {
    const supabase = createFlexSupabaseMock({
      customerByUserId: null,
      customerByEmailError: true,
    })

    const id = await resolveCustomerIdForUser(supabase, 'user_clerk', 'user@example.com')

    expect(id).toBeNull()
  })

  it('returns null when email lookup returns no data', async () => {
    const supabase = createFlexSupabaseMock({
      customerByUserId: null,
      customerByEmail: null,
    })

    const id = await resolveCustomerIdForUser(supabase, 'user_clerk', 'user@example.com')

    expect(id).toBeNull()
  })

  it('returns null when email customer is claimed by a different clerk user', async () => {
    const supabase = createFlexSupabaseMock({
      customerByUserId: null,
      customerByEmail: { id: 'cust_789', clerk_user_id: 'different_clerk_id' },
    })

    const id = await resolveCustomerIdForUser(supabase, 'user_clerk', 'user@example.com')

    expect(id).toBeNull()
  })

  it('returns customer id when email customer clerk_user_id matches', async () => {
    const supabase = createFlexSupabaseMock({
      customerByUserId: null,
      customerByEmail: { id: 'cust_abc', clerk_user_id: 'user_clerk' },
    })

    const id = await resolveCustomerIdForUser(supabase, 'user_clerk', 'user@example.com')

    expect(id).toBe('cust_abc')
  })
})

// ===========================================================================
// getUserRoles
// ===========================================================================
describe('getUserRoles', () => {
  it('includes customer role when customer exists', async () => {
    const supabase = createFlexSupabaseMock({
      admins: false,
      customerByUserId: { id: 'cust_123' },
    })

    const roles = await getUserRoles(supabase, 'user_clerk', 'user@example.com')

    expect(roles.has('customer')).toBe(true)
  })

  it('does not include customer role when customer not found', async () => {
    const supabase = createFlexSupabaseMock({
      admins: false,
      customerByUserId: null,
      customerByEmail: null,
    })

    const roles = await getUserRoles(supabase, 'user_clerk', 'user@example.com')

    expect(roles.has('customer')).toBe(false)
  })

  it('includes both internal and customer roles', async () => {
    process.env.ADMIN_CLERK_USER_IDS = 'admin_customer_user'

    const supabase = createFlexSupabaseMock({
      customerByUserId: { id: 'cust_xyz' },
    })

    const roles = await getUserRoles(supabase, 'admin_customer_user', 'ac@example.com')

    expect(roles.has('admin')).toBe(true)
    expect(roles.has('customer')).toBe(true)
  })

  it('returns empty set when neither internal roles nor customer found', async () => {
    const supabase = createFlexSupabaseMock({
      admins: false,
      customerByUserId: null,
      customerByEmail: null,
    })

    const roles = await getUserRoles(supabase, 'nobody', 'nobody@example.com')

    expect(roles.size).toBe(0)
  })
})

// ===========================================================================
// canAccessProject
// ===========================================================================
describe('canAccessProject', () => {
  it('grants access to internal users regardless of project ownership', async () => {
    process.env.ADMIN_CLERK_USER_IDS = 'internal_user'

    const supabase = createFlexSupabaseMock({ projectRow: null })

    const result = await canAccessProject(
      supabase,
      'project_xyz',
      'internal_user',
      'admin@example.com'
    )

    expect(result).toBe(true)
  })

  it('grants access to project owner (customer)', async () => {
    const supabase = createFlexSupabaseMock({
      admins: false,
      customerByUserId: { id: 'cust_owner' },
      projectRow: { id: 'project_abc' },
    })

    const result = await canAccessProject(
      supabase,
      'project_abc',
      'user_owner',
      'owner@example.com'
    )

    expect(result).toBe(true)
  })

  it('denies access when customer does not own the project', async () => {
    const supabase = createFlexSupabaseMock({
      admins: false,
      customerByUserId: { id: 'cust_other' },
      projectRow: null,
    })

    const result = await canAccessProject(
      supabase,
      'project_secret',
      'user_other',
      'other@example.com'
    )

    expect(result).toBe(false)
  })

  it('denies access when user is not customer and not internal', async () => {
    const supabase = createFlexSupabaseMock({
      admins: false,
      customerByUserId: null,
      customerByEmail: null,
    })

    const result = await canAccessProject(
      supabase,
      'project_xyz',
      'user_stranger',
      'stranger@example.com'
    )

    expect(result).toBe(false)
  })

  it('denies access when project query returns an error', async () => {
    const supabase = createFlexSupabaseMock({
      admins: false,
      customerByUserId: { id: 'cust_err' },
      projectError: true,
    })

    const result = await canAccessProject(
      supabase,
      'project_xyz',
      'user_cust',
      'cust@example.com'
    )

    expect(result).toBe(false)
  })

  it('denies when customerId resolves but customer lookup has no email fallback needed', async () => {
    const supabase = createFlexSupabaseMock({
      admins: false,
      customerByUserId: null,
      customerByEmail: null,
    })

    const result = await canAccessProject(
      supabase,
      'project_xyz',
      'user_no_customer'
    )

    expect(result).toBe(false)
  })
})
