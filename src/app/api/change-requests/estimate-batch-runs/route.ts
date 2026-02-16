import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  canAccessProject,
  getAuthenticatedUser,
  getInternalRoles,
} from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

const requestSchema = z.object({
  scope: z.enum(['intake_queue', 'manual_selection']).default('intake_queue'),
  request_params: z.record(z.string(), z.unknown()).default({}),
  target_change_request_ids: z.array(z.string().uuid()).min(1).max(50),
  succeeded_change_request_ids: z.array(z.string().uuid()).max(50).default([]),
  failed_items: z.array(
    z.object({
      change_request_id: z.string().uuid(),
      error: z.string().min(1).max(500),
    })
  ).max(50).default([]),
})

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

export async function POST(request: Request) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'change-requests:estimate-batch-runs:post', RATE_LIMITS['change-requests:estimate-batch-runs:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const rawBody = await request.json()
    const validated = requestSchema.parse(rawBody)

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

    const targetIds = dedupe(validated.target_change_request_ids)
    const succeededIds = dedupe(validated.succeeded_change_request_ids)
    const failedItems = validated.failed_items.filter((item) => targetIds.includes(item.change_request_id))

    const { data: changeRequests, error: changeRequestError } = await supabase
      .from('change_requests')
      .select('id, project_id')
      .in('id', targetIds)

    if (changeRequestError) {
      return NextResponse.json(
        { success: false, error: '変更要求情報の取得に失敗しました' },
        { status: 500 }
      )
    }

    if (!changeRequests || changeRequests.length !== targetIds.length) {
      return NextResponse.json(
        { success: false, error: '対象変更要求に存在しないIDが含まれています' },
        { status: 400 }
      )
    }

    const uniqueProjectIds = [...new Set(changeRequests.map((row) => row.project_id))]
    for (const projectId of uniqueProjectIds) {
      const accessible = await canAccessProject(
        supabase,
        projectId,
        authUser.clerkUserId,
        authUser.email
      )
      if (!accessible) {
        return NextResponse.json(
          { success: false, error: '対象案件にアクセスできません' },
          { status: 403 }
        )
      }
    }

    const safeSucceededIds = succeededIds.filter((id) => targetIds.includes(id))
    const failedCount = failedItems.length
    const succeededCount = safeSucceededIds.length
    const requestedCount = targetIds.length

    const { data: run, error: insertError } = await supabase
      .from('estimate_batch_runs')
      .insert({
        actor_clerk_user_id: authUser.clerkUserId,
        scope: validated.scope,
        request_params: validated.request_params,
        target_change_request_ids: targetIds,
        succeeded_change_request_ids: safeSucceededIds,
        failed_items: failedItems,
        requested_count: requestedCount,
        succeeded_count: succeededCount,
        failed_count: failedCount,
      })
      .select('id, requested_count, succeeded_count, failed_count, created_at')
      .single()

    if (insertError || !run) {
      return NextResponse.json(
        { success: false, error: '一括概算ログの保存に失敗しました' },
        { status: 500 }
      )
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'change_request.estimate_batch_run_log',
      resourceType: 'estimate_batch_run',
      resourceId: run.id,
      projectId: uniqueProjectIds[0] ?? null,
      payload: {
        scope: validated.scope,
        requested_count: requestedCount,
        succeeded_count: succeededCount,
        failed_count: failedCount,
      },
    })

    return NextResponse.json({
      success: true,
      data: run,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: '入力データが不正です' },
        { status: 400 }
      )
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

