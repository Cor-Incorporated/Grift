'use server'

import { revalidatePath } from 'next/cache'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function deleteProjectAction(
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  const authUser = await getAuthenticatedUser()
  if (!authUser) {
    return { success: false, error: '認証が必要です' }
  }

  if (!UUID_REGEX.test(projectId)) {
    return { success: false, error: '無効なプロジェクトIDです' }
  }

  const supabase = await createServiceRoleClient()

  const hasAccess = await canAccessProject(
    supabase,
    projectId,
    authUser.clerkUserId,
    authUser.email
  )
  if (!hasAccess) {
    return { success: false, error: 'このプロジェクトへのアクセス権限がありません' }
  }

  const { error: deleteError } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (deleteError) {
    return { success: false, error: 'プロジェクトの削除に失敗しました' }
  }

  await writeAuditLog(supabase, {
    actorClerkUserId: authUser.clerkUserId,
    action: 'project.delete',
    resourceType: 'project',
    resourceId: projectId,
    projectId,
  })

  revalidatePath('/dashboard')
  return { success: true }
}
