import { auth, currentUser } from '@clerk/nextjs/server'
import type { SupabaseClient } from '@supabase/supabase-js'

interface AuthUser {
  clerkUserId: string
  email: string | null
  fullName: string
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

async function isAdminInTable(
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

export async function isAdminUser(
  supabase: SupabaseClient,
  clerkUserId: string,
  email?: string | null
): Promise<boolean> {
  const adminUserIds = parseCsvEnv('ADMIN_CLERK_USER_IDS')
  if (adminUserIds.size > 0) {
    return adminUserIds.has(clerkUserId)
  }

  const adminEmails = parseCsvEnv('ADMIN_EMAIL_ALLOWLIST')
  if (adminEmails.size > 0) {
    return Boolean(email && adminEmails.has(email))
  }

  const inTable = await isAdminInTable(supabase, clerkUserId)
  return inTable
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

export async function canAccessProject(
  supabase: SupabaseClient,
  projectId: string,
  clerkUserId: string,
  email?: string | null
): Promise<boolean> {
  if (await isAdminUser(supabase, clerkUserId, email)) {
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
