import { auth, currentUser } from '@clerk/nextjs/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppUserRole, InternalRole } from '@/types/database'

interface AuthUser {
  clerkUserId: string
  email: string | null
  fullName: string
}

const INTERNAL_ROLES: InternalRole[] = ['admin', 'sales', 'dev']

const ROLE_ENV_KEYS: Record<
  InternalRole,
  { userIds: string; emails: string }
> = {
  admin: {
    userIds: 'ADMIN_CLERK_USER_IDS',
    emails: 'ADMIN_EMAIL_ALLOWLIST',
  },
  sales: {
    userIds: 'SALES_CLERK_USER_IDS',
    emails: 'SALES_EMAIL_ALLOWLIST',
  },
  dev: {
    userIds: 'DEV_CLERK_USER_IDS',
    emails: 'DEV_EMAIL_ALLOWLIST',
  },
}

function parseCsvEnv(name: string): Set<string> {
  const raw = process.env[name]?.trim()
  if (!raw) {
    return new Set()
  }

  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

function isInternalRole(value: string): value is InternalRole {
  return INTERNAL_ROLES.includes(value as InternalRole)
}

function evaluateRoleFromAllowlist(
  role: InternalRole,
  clerkUserId: string,
  email?: string | null
): boolean | null {
  const envKeys = ROLE_ENV_KEYS[role]
  const userIds = parseCsvEnv(envKeys.userIds)
  if (userIds.size > 0) {
    return userIds.has(clerkUserId)
  }

  const emails = parseCsvEnv(envKeys.emails)
  if (emails.size > 0) {
    return Boolean(email && emails.has(email))
  }

  return null
}

export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  const { userId } = await auth()
  if (!userId) {
    return null
  }

  const user = await currentUser()

  return {
    clerkUserId: userId,
    email: user?.emailAddresses[0]?.emailAddress ?? null,
    fullName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Unknown',
  }
}

async function isAdminInLegacyTable(
  supabase: SupabaseClient,
  clerkUserId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('admins')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()

  if (error) {
    return false
  }

  return Boolean(data)
}

async function loadInternalRolesFromTeamMembers(
  supabase: SupabaseClient,
  clerkUserId: string,
  email?: string | null
): Promise<InternalRole[]> {
  const byUser = await supabase
    .from('team_members')
    .select('roles, active')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()

  if (!byUser.error && byUser.data?.active && Array.isArray(byUser.data.roles)) {
    return byUser.data.roles.filter(
      (role): role is InternalRole =>
        typeof role === 'string' && isInternalRole(role)
    )
  }

  if (!email) {
    return []
  }

  const byEmail = await supabase
    .from('team_members')
    .select('roles, active')
    .eq('email', email)
    .maybeSingle()

  if (byEmail.error || !byEmail.data?.active || !Array.isArray(byEmail.data.roles)) {
    return []
  }

  return byEmail.data.roles.filter(
    (role): role is InternalRole =>
      typeof role === 'string' && isInternalRole(role)
  )
}

export async function getInternalRoles(
  supabase: SupabaseClient,
  clerkUserId: string,
  email?: string | null
): Promise<Set<InternalRole>> {
  const resolved = new Set<InternalRole>()
  const strictRoles = new Set<InternalRole>()

  for (const role of INTERNAL_ROLES) {
    const allowlistResult = evaluateRoleFromAllowlist(role, clerkUserId, email)
    if (allowlistResult === true) {
      resolved.add(role)
      strictRoles.add(role)
      continue
    }

    if (allowlistResult === false) {
      strictRoles.add(role)
    }
  }

  const fromTeamMembers = await loadInternalRolesFromTeamMembers(
    supabase,
    clerkUserId,
    email
  )
  for (const role of fromTeamMembers) {
    if (!strictRoles.has(role)) {
      resolved.add(role)
    }
  }

  if (!strictRoles.has('admin') && !resolved.has('admin')) {
    const inLegacyAdmins = await isAdminInLegacyTable(supabase, clerkUserId)
    if (inLegacyAdmins) {
      resolved.add('admin')
    }
  }

  return resolved
}

export async function isAdminUser(
  supabase: SupabaseClient,
  clerkUserId: string,
  email?: string | null
): Promise<boolean> {
  const roles = await getInternalRoles(supabase, clerkUserId, email)
  return roles.has('admin')
}

export async function resolveCustomerIdForUser(
  supabase: SupabaseClient,
  clerkUserId: string,
  email?: string | null
): Promise<string | null> {
  const { data: byUser, error: byUserError } = await supabase
    .from('customers')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()

  if (!byUserError && byUser?.id) {
    return byUser.id
  }

  if (!email) {
    return null
  }

  const { data: byEmail, error: byEmailError } = await supabase
    .from('customers')
    .select('id, clerk_user_id')
    .eq('email', email)
    .maybeSingle()

  if (byEmailError || !byEmail) {
    return null
  }

  if (!byEmail.clerk_user_id) {
    await supabase
      .from('customers')
      .update({ clerk_user_id: clerkUserId })
      .eq('id', byEmail.id)
  }

  if (byEmail.clerk_user_id && byEmail.clerk_user_id !== clerkUserId) {
    return null
  }

  return byEmail.id
}

export async function getUserRoles(
  supabase: SupabaseClient,
  clerkUserId: string,
  email?: string | null
): Promise<Set<AppUserRole>> {
  const roles = new Set<AppUserRole>()
  const internalRoles = await getInternalRoles(supabase, clerkUserId, email)

  for (const role of internalRoles) {
    roles.add(role)
  }

  const customerId = await resolveCustomerIdForUser(supabase, clerkUserId, email)
  if (customerId) {
    roles.add('customer')
  }

  return roles
}

export async function canAccessAdminArea(
  supabase: SupabaseClient,
  clerkUserId: string,
  email?: string | null
): Promise<boolean> {
  const internalRoles = await getInternalRoles(supabase, clerkUserId, email)
  return internalRoles.has('admin')
}

export function canResolveApprovalRequestByRole(input: {
  internalRoles: Set<InternalRole>
  requiredRole: InternalRole
}): boolean {
  if (input.internalRoles.has('admin')) {
    return true
  }

  return input.internalRoles.has(input.requiredRole)
}

export async function canAccessProject(
  supabase: SupabaseClient,
  projectId: string,
  clerkUserId: string,
  email?: string | null
): Promise<boolean> {
  const internalRoles = await getInternalRoles(supabase, clerkUserId, email)
  if (internalRoles.size > 0) {
    return true
  }

  const customerId = await resolveCustomerIdForUser(supabase, clerkUserId, email)
  if (!customerId) {
    return false
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error) {
    return false
  }

  return Boolean(data)
}
