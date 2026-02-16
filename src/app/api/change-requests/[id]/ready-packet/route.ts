import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  canAccessProject,
  getAuthenticatedUser,
  getInternalRoles,
} from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { buildFollowUpQuestion } from '@/lib/intake/completeness'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import type { IntakeIntentType } from '@/types/database'

const INTAKE_INTENTS: IntakeIntentType[] = [
  'bug_report',
  'fix_request',
  'feature_addition',
  'scope_change',
  'account_task',
  'billing_risk',
  'other',
]

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function toIntakeIntent(value: unknown): IntakeIntentType {
  if (typeof value === 'string' && INTAKE_INTENTS.includes(value as IntakeIntentType)) {
    return value as IntakeIntentType
  }
  return 'other'
}

function resolveEstimateTotal(estimate: Record<string, unknown> | null): number | null {
  if (!estimate) return null

  if (typeof estimate.total_your_cost === 'number' && estimate.total_your_cost > 0) {
    return estimate.total_your_cost
  }

  const snapshot =
    estimate.pricing_snapshot && typeof estimate.pricing_snapshot === 'object'
      ? (estimate.pricing_snapshot as Record<string, unknown>)
      : null

  if (snapshot && typeof snapshot.recommended_total_cost === 'number') {
    return snapshot.recommended_total_cost
  }

  const pricing =
    snapshot?.pricing && typeof snapshot.pricing === 'object'
      ? (snapshot.pricing as Record<string, unknown>)
      : null
  if (pricing && typeof pricing.finalDeltaFee === 'number') {
    return pricing.finalDeltaFee
  }

  const hourlyRate = typeof estimate.your_hourly_rate === 'number' ? estimate.your_hourly_rate : null
  const hours = typeof estimate.your_estimated_hours === 'number' ? estimate.your_estimated_hours : null
  if (hourlyRate !== null && hours !== null) {
    return hourlyRate * hours
  }

  return null
}

function buildNextActions(input: {
  intakeStatus: string | null
  missingFields: string[]
  estimate: Record<string, unknown> | null
  executionTask: Record<string, unknown> | null
}): string[] {
  const actions: string[] = []

  if (input.intakeStatus !== 'ready_to_start') {
    actions.push('不足情報を回収して要件充足率を引き上げる')
  }

  if (input.missingFields.length > 0) {
    actions.push(`不足項目を埋める: ${input.missingFields.join(', ')}`)
  }

  if (!input.estimate) {
    actions.push('概算見積を生成する')
    return actions
  }

  const estimateStatus =
    typeof input.estimate.estimate_status === 'string'
      ? input.estimate.estimate_status
      : 'draft'
  if (estimateStatus !== 'ready') {
    actions.push('見積のブロッカー（根拠不足または承認待ち）を解消する')
  }

  const approvalRequired = input.estimate.approval_required === true
  const approvalStatus =
    typeof input.estimate.approval_status === 'string'
      ? input.estimate.approval_status
      : 'not_required'
  if (approvalRequired && approvalStatus !== 'approved') {
    actions.push('承認キューで承認処理を完了する')
  }

  if (!input.executionTask) {
    actions.push('着手パケットから実行タスクを起票する')
  } else {
    const taskStatus =
      typeof input.executionTask.status === 'string'
        ? input.executionTask.status
        : 'todo'
    if (taskStatus !== 'done') {
      actions.push(`実行タスクを進行する（status: ${taskStatus}）`)
    }
  }

  if (actions.length === 0) {
    actions.push('エンジニアへ着手依頼を発行する')
  }

  return actions
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimitedGet = applyRateLimit(_request, 'change-requests:ready-packet:get', RATE_LIMITS['change-requests:ready-packet:get'], authUser.clerkUserId)
    if (rateLimitedGet) return rateLimitedGet

    const supabase = await createServiceRoleClient()
    const internalRoles = await getInternalRoles(
      supabase,
      authUser.clerkUserId,
      authUser.email
    )
    if (internalRoles.size === 0) {
      return NextResponse.json(
        { success: false, error: 'この機能は管理者・営業・開発ロールのみ利用できます' },
        { status: 403 }
      )
    }

    const { id } = await context.params

    const { data: changeRequest, error: changeRequestError } = await supabase
      .from('change_requests')
      .select('*')
      .eq('id', id)
      .single()

    if (changeRequestError || !changeRequest) {
      return NextResponse.json({ success: false, error: '変更要求が見つかりません' }, { status: 404 })
    }

    const accessible = await canAccessProject(
      supabase,
      changeRequest.project_id,
      authUser.clerkUserId,
      authUser.email
    )
    if (!accessible) {
      return NextResponse.json(
        { success: false, error: 'この案件にアクセスできません' },
        { status: 403 }
      )
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, title, type, status')
      .eq('id', changeRequest.project_id)
      .maybeSingle()

    let estimate: Record<string, unknown> | null = null
    if (changeRequest.latest_estimate_id) {
      const { data: latest } = await supabase
        .from('estimates')
        .select('*')
        .eq('id', changeRequest.latest_estimate_id)
        .maybeSingle()
      estimate = (latest ?? null) as Record<string, unknown> | null
    }

    if (!estimate) {
      const { data: fallbackEstimate } = await supabase
        .from('estimates')
        .select('*')
        .eq('change_request_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      estimate = (fallbackEstimate ?? null) as Record<string, unknown> | null
    }

    let executionTask: Record<string, unknown> | null = null
    if (changeRequest.latest_execution_task_id) {
      const { data: linkedTask } = await supabase
        .from('execution_tasks')
        .select('*')
        .eq('id', changeRequest.latest_execution_task_id)
        .maybeSingle()
      executionTask = (linkedTask ?? null) as Record<string, unknown> | null
    }

    if (!executionTask) {
      const { data: activeTask } = await supabase
        .from('execution_tasks')
        .select('*')
        .eq('change_request_id', id)
        .in('status', ['todo', 'in_progress', 'blocked'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      executionTask = (activeTask ?? null) as Record<string, unknown> | null
    }

    const missingFields = normalizeStringArray(changeRequest.missing_fields)
    const intakeIntent = toIntakeIntent(changeRequest.intake_intent)
    const followUpQuestion = missingFields.length > 0
      ? buildFollowUpQuestion({
          intentType: intakeIntent,
          missingFields,
        })
      : null

    const nextActions = buildNextActions({
      intakeStatus: changeRequest.intake_status ?? null,
      missingFields,
      estimate,
      executionTask,
    })

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'change_request.ready_packet_view',
      resourceType: 'change_request',
      resourceId: changeRequest.id,
      projectId: changeRequest.project_id,
        payload: {
          intakeStatus: changeRequest.intake_status,
          completeness: changeRequest.requirement_completeness,
          hasEstimate: Boolean(estimate),
          hasExecutionTask: Boolean(executionTask),
        },
      })

    return NextResponse.json({
      success: true,
      data: {
        project: {
          id: project?.id ?? changeRequest.project_id,
          title: project?.title ?? '不明な案件',
          type: project?.type ?? null,
          status: project?.status ?? null,
        },
        change_request: {
          id: changeRequest.id,
          title: changeRequest.title,
          description: changeRequest.description,
          category: changeRequest.category,
          impact_level: changeRequest.impact_level,
          status: changeRequest.status,
          intake_status: changeRequest.intake_status,
          requirement_completeness: changeRequest.requirement_completeness,
          missing_fields: missingFields,
          source_channel: changeRequest.source_channel,
          source_actor_name: changeRequest.source_actor_name,
          source_actor_email: changeRequest.source_actor_email,
          source_event_at: changeRequest.source_event_at,
          requested_by_name: changeRequest.requested_by_name,
          requested_by_email: changeRequest.requested_by_email,
          requested_deadline: changeRequest.requested_deadline,
          requested_deadline_at: changeRequest.requested_deadline_at,
          intake_intent: intakeIntent,
          follow_up_question: followUpQuestion,
        },
        estimate: estimate
          ? {
              id: estimate.id ?? null,
              estimate_status: estimate.estimate_status ?? 'draft',
              approval_required: estimate.approval_required === true,
              approval_status: estimate.approval_status ?? 'not_required',
              evidence_requirement_met: estimate.evidence_requirement_met !== false,
              total_cost: resolveEstimateTotal(estimate),
              estimated_hours:
                typeof estimate.your_estimated_hours === 'number'
                  ? estimate.your_estimated_hours
                  : null,
              hourly_rate:
                typeof estimate.your_hourly_rate === 'number'
                  ? estimate.your_hourly_rate
                  : null,
              created_at:
                typeof estimate.created_at === 'string'
                  ? estimate.created_at
                  : null,
            }
          : null,
        execution_task: executionTask
          ? {
              id: typeof executionTask.id === 'string' ? executionTask.id : null,
              status: typeof executionTask.status === 'string' ? executionTask.status : 'todo',
              priority:
                typeof executionTask.priority === 'string'
                  ? executionTask.priority
                  : 'medium',
              due_at:
                typeof executionTask.due_at === 'string'
                  ? executionTask.due_at
                  : null,
              owner_role:
                typeof executionTask.owner_role === 'string'
                  ? executionTask.owner_role
                  : null,
              owner_clerk_user_id:
                typeof executionTask.owner_clerk_user_id === 'string'
                  ? executionTask.owner_clerk_user_id
                  : null,
              created_at:
                typeof executionTask.created_at === 'string'
                  ? executionTask.created_at
                  : null,
            }
          : null,
        next_actions: nextActions,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
