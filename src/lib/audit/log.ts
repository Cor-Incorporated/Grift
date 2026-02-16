import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'

interface AuditLogInput {
  actorClerkUserId: string
  action: string
  resourceType: string
  resourceId: string
  projectId?: string | null
  payload?: Record<string, unknown>
}

export async function writeAuditLog(
  supabase: SupabaseClient,
  input: AuditLogInput
): Promise<void> {
  const { error } = await supabase
    .from('audit_logs')
    .insert({
      actor_clerk_user_id: input.actorClerkUserId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      project_id: input.projectId ?? null,
      payload: input.payload ?? {},
    })

  if (error) {
    // Avoid breaking request flow if audit table is not yet migrated.
    logger.warn('Failed to write audit log', {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      code: error.code,
      message: error.message,
    })
  }
}
