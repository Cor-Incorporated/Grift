import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  canResolveApprovalRequestByRole,
  getAuthenticatedUser,
  getInternalRoles,
} from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { refreshEstimateApprovalState } from '@/lib/approval/requests'
import { approvalRequestUpdateSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'admin:approval-requests:patch', RATE_LIMITS['admin:approval-requests:patch'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const internalRoles = await getInternalRoles(
      supabase,
      authUser.clerkUserId,
      authUser.email
    )
    if (internalRoles.size === 0) {
      return NextResponse.json(
        { success: false, error: '管理者・営業・開発ロールが必要です' },
        { status: 403 }
      )
    }

    const { id } = await context.params
    const body = await request.json()
    const validated = approvalRequestUpdateSchema.parse(body)

    const { data: existing, error: existingError } = await supabase
      .from('approval_requests')
      .select('id, required_role')
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      return NextResponse.json(
        { success: false, error: '承認リクエストが見つかりません' },
        { status: 404 }
      )
    }

    const requiredRole = existing.required_role as 'admin' | 'sales' | 'dev'
    if (
      !canResolveApprovalRequestByRole({
        internalRoles,
        requiredRole,
      })
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `この承認には ${requiredRole} ロールが必要です`,
        },
        { status: 403 }
      )
    }

    const updatePayload: Record<string, unknown> = {
      status: validated.status,
      assigned_to_role: validated.assigned_to_role,
      assigned_to_clerk_user_id: validated.assigned_to_clerk_user_id,
      updated_at: new Date().toISOString(),
    }

    if (validated.status === 'approved' || validated.status === 'rejected') {
      const resolvedByRole = internalRoles.has('admin') ? 'admin' : requiredRole
      updatePayload.resolved_by_clerk_user_id = authUser.clerkUserId
      updatePayload.resolved_by_role = resolvedByRole
      updatePayload.resolved_at = new Date().toISOString()
      updatePayload.resolution_comment = validated.resolution_comment ?? null
    }

    const { data, error } = await supabase
      .from('approval_requests')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ success: false, error: '承認リクエストの更新に失敗しました' }, { status: 500 })
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'approval_request.update',
      resourceType: 'approval_request',
      resourceId: data.id,
      projectId: data.project_id,
      payload: {
        status: data.status,
        requiredRole: data.required_role,
        resolvedByRole: data.resolved_by_role ?? null,
        resolutionComment: validated.resolution_comment ?? null,
      },
    })

    if (data.estimate_id) {
      const refreshed = await refreshEstimateApprovalState({
        supabase,
        estimateId: data.estimate_id,
      })

      await writeAuditLog(supabase, {
        actorClerkUserId: authUser.clerkUserId,
        action: 'estimate.approval_state_synced',
        resourceType: 'estimate',
        resourceId: data.estimate_id,
        projectId: data.project_id,
        payload: {
          approvalStatus: refreshed.approvalStatus,
          estimateStatus: refreshed.estimateStatus,
        },
      })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
