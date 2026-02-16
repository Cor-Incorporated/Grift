import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  canAccessProject,
  getAuthenticatedUser,
  getInternalRoles,
} from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

interface EstimateRow {
  id: string
  estimate_status: string
  approval_status: string
  approval_required: boolean
  evidence_requirement_met: boolean
  created_at: string
}

function toEstimateSummary(estimate: EstimateRow | null): string {
  if (!estimate) return '見積未生成'
  return [
    `estimate_id: ${estimate.id}`,
    `estimate_status: ${estimate.estimate_status}`,
    `approval_status: ${estimate.approval_status}`,
    `approval_required: ${estimate.approval_required ? 'yes' : 'no'}`,
    `evidence_requirement_met: ${estimate.evidence_requirement_met ? 'yes' : 'no'}`,
    `estimate_created_at: ${estimate.created_at}`,
  ].join('\n')
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(_request, 'change-requests:taskize:post', RATE_LIMITS['change-requests:taskize:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

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

    if (changeRequest.intake_status !== 'ready_to_start') {
      return NextResponse.json(
        { success: false, error: '情報不足のためタスク化できません。先に不足項目を解消してください。' },
        { status: 409 }
      )
    }

    const { data: existingTask } = await supabase
      .from('execution_tasks')
      .select('*')
      .eq('change_request_id', id)
      .in('status', ['todo', 'in_progress', 'blocked'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingTask) {
      return NextResponse.json({
        success: true,
        data: {
          created: false,
          task: existingTask,
        },
      })
    }

    let estimate: EstimateRow | null = null
    if (changeRequest.latest_estimate_id) {
      const { data: latestEstimate } = await supabase
        .from('estimates')
        .select('id, estimate_status, approval_status, approval_required, evidence_requirement_met, created_at')
        .eq('id', changeRequest.latest_estimate_id)
        .maybeSingle()
      estimate = (latestEstimate ?? null) as EstimateRow | null
    } else {
      const { data: fallbackEstimate } = await supabase
        .from('estimates')
        .select('id, estimate_status, approval_status, approval_required, evidence_requirement_met, created_at')
        .eq('change_request_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      estimate = (fallbackEstimate ?? null) as EstimateRow | null
    }

    if (!estimate) {
      return NextResponse.json(
        { success: false, error: '先に概算見積りを生成してください。' },
        { status: 409 }
      )
    }

    if (estimate.estimate_status !== 'ready') {
      return NextResponse.json(
        { success: false, error: '見積がready状態ではありません。ブロッカーを解消してください。' },
        { status: 409 }
      )
    }

    const summaryLines = [
      changeRequest.description,
      '',
      '## 見積メモ',
      toEstimateSummary(estimate),
    ]
    const ownerRole = internalRoles.has('dev')
      ? 'dev'
      : internalRoles.has('sales')
        ? 'sales'
        : 'admin'

    const { data: createdTask, error: taskInsertError } = await supabase
      .from('execution_tasks')
      .insert({
        project_id: changeRequest.project_id,
        change_request_id: changeRequest.id,
        title: changeRequest.title,
        summary: summaryLines.join('\n').slice(0, 10000),
        status: 'todo',
        priority: changeRequest.impact_level,
        due_at: changeRequest.requested_deadline_at ?? null,
        owner_clerk_user_id: authUser.clerkUserId,
        owner_role: ownerRole,
        created_by_clerk_user_id: authUser.clerkUserId,
        metadata: {
          source: 'ready_packet',
          estimate_id: estimate.id,
          intake_status: changeRequest.intake_status,
          requirement_completeness: changeRequest.requirement_completeness,
        },
      })
      .select('*')
      .single()

    if (taskInsertError || !createdTask) {
      return NextResponse.json(
        { success: false, error: 'タスク化に失敗しました' },
        { status: 500 }
      )
    }

    await supabase
      .from('change_requests')
      .update({
        latest_execution_task_id: createdTask.id,
        status: changeRequest.status === 'triaged' ? 'estimated' : changeRequest.status,
      })
      .eq('id', changeRequest.id)

    await supabase
      .from('execution_task_events')
      .insert({
        task_id: createdTask.id,
        project_id: createdTask.project_id,
        change_request_id: createdTask.change_request_id,
        event_type: 'created',
        actor_clerk_user_id: authUser.clerkUserId,
        from_status: null,
        to_status: createdTask.status,
        owner_clerk_user_id: createdTask.owner_clerk_user_id ?? authUser.clerkUserId,
        owner_role: createdTask.owner_role ?? ownerRole,
        note: 'ready_packet から初回タスク化',
        payload: {
          estimate_id: estimate.id,
        },
      })

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'change_request.taskize',
      resourceType: 'change_request',
      resourceId: changeRequest.id,
      projectId: changeRequest.project_id,
      payload: {
        task_id: createdTask.id,
        estimate_id: estimate.id,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        created: true,
        task: createdTask,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
