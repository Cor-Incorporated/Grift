import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit/log'
import {
  deriveApprovalStatus,
  resolveEstimateStatus,
  type ApprovalTrigger,
  type EstimateApprovalStatus,
} from '@/lib/approval/gate'
import type { ApprovalRequestType, InternalRole } from '@/types/database'

interface EnsureApprovalRequestsInput {
  supabase: SupabaseClient
  projectId: string
  estimateId: string
  changeRequestId?: string | null
  actorClerkUserId: string
  triggers: ApprovalTrigger[]
}

export function resolveRequiredRoleForTrigger(
  requestType: ApprovalRequestType
): InternalRole {
  if (requestType === 'floor_breach' || requestType === 'low_margin') {
    return 'sales'
  }

  if (requestType === 'high_risk_change') {
    return 'dev'
  }

  return 'admin'
}

export async function ensureApprovalRequests(input: EnsureApprovalRequestsInput): Promise<{
  createdIds: string[]
  allRelevantStatuses: string[]
}> {
  const createdIds: string[] = []

  for (const trigger of input.triggers) {
    const existing = await input.supabase
      .from('approval_requests')
      .select('id, status')
      .eq('project_id', input.projectId)
      .eq('estimate_id', input.estimateId)
      .eq('request_type', trigger.requestType)
      .in('status', ['pending', 'approved'])
      .limit(1)
      .maybeSingle()

    if (existing.data?.id) {
      continue
    }

    const { data, error } = await input.supabase
      .from('approval_requests')
      .insert({
        project_id: input.projectId,
        estimate_id: input.estimateId,
        change_request_id: input.changeRequestId ?? null,
        request_type: trigger.requestType,
        required_role: resolveRequiredRoleForTrigger(trigger.requestType),
        assigned_to_role: resolveRequiredRoleForTrigger(trigger.requestType),
        status: 'pending',
        severity: trigger.severity,
        reason: trigger.reason,
        context: trigger.context,
        requested_by_clerk_user_id: input.actorClerkUserId,
      })
      .select('id')
      .single()

    if (error || !data) {
      throw new Error('承認リクエストの自動起票に失敗しました')
    }

    createdIds.push(data.id)

    await writeAuditLog(input.supabase, {
      actorClerkUserId: input.actorClerkUserId,
      action: 'approval_request.auto_create',
      resourceType: 'approval_request',
      resourceId: data.id,
      projectId: input.projectId,
      payload: {
        estimateId: input.estimateId,
        changeRequestId: input.changeRequestId ?? null,
        requestType: trigger.requestType,
        requiredRole: resolveRequiredRoleForTrigger(trigger.requestType),
        severity: trigger.severity,
      },
    })
  }

  const { data: statuses } = await input.supabase
    .from('approval_requests')
    .select('status')
    .eq('estimate_id', input.estimateId)

  return {
    createdIds,
    allRelevantStatuses: (statuses ?? []).map((row) => row.status as string),
  }
}

export async function refreshEstimateApprovalState(input: {
  supabase: SupabaseClient
  estimateId: string
}): Promise<{
  approvalStatus: EstimateApprovalStatus
  estimateStatus: 'draft' | 'ready'
}> {
  const { data: estimate, error: estimateError } = await input.supabase
    .from('estimates')
    .select('id, evidence_requirement_met, approval_status')
    .eq('id', input.estimateId)
    .single()

  if (estimateError || !estimate) {
    throw new Error('承認状態更新対象の見積りが見つかりません')
  }

  const { data: approvalRows } = await input.supabase
    .from('approval_requests')
    .select('status')
    .eq('estimate_id', input.estimateId)

  const approvalStatus = deriveApprovalStatus(
    (approvalRows ?? []).map((row) => row.status as string)
  )

  const resolved = resolveEstimateStatus({
    evidenceRequirementMet: Boolean(estimate.evidence_requirement_met),
    approvalStatus,
  })

  await input.supabase
    .from('estimates')
    .update({
      approval_required: approvalStatus !== 'not_required',
      approval_status: approvalStatus,
      approval_block_reason: resolved.approvalBlockReason,
      estimate_status: resolved.estimateStatus,
    })
    .eq('id', input.estimateId)

  return {
    approvalStatus,
    estimateStatus: resolved.estimateStatus,
  }
}
