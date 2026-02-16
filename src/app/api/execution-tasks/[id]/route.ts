import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  canAccessProject,
  getAuthenticatedUser,
  getInternalRoles,
} from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { executionTaskUpdateSchema } from '@/lib/utils/validation'
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

    const rateLimited = applyRateLimit(request, 'execution-tasks:patch', RATE_LIMITS['execution-tasks:patch'], authUser.clerkUserId)
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
    const body = await request.json()
    const validated = executionTaskUpdateSchema.parse(body)

    const { data: existingTask, error: existingTaskError } = await supabase
      .from('execution_tasks')
      .select('*')
      .eq('id', id)
      .single()

    if (existingTaskError || !existingTask) {
      return NextResponse.json(
        { success: false, error: '実行タスクが見つかりません' },
        { status: 404 }
      )
    }

    const accessible = await canAccessProject(
      supabase,
      existingTask.project_id,
      authUser.clerkUserId,
      authUser.email
    )
    if (!accessible) {
      return NextResponse.json(
        { success: false, error: 'この案件にアクセスできません' },
        { status: 403 }
      )
    }

    const nextStatus = validated.status ?? existingTask.status
    const nextOwnerRole = validated.owner_role ?? existingTask.owner_role ?? null
    const nextOwnerClerkUserId = validated.owner_clerk_user_id ?? existingTask.owner_clerk_user_id ?? null
    const statusChanged = nextStatus !== existingTask.status
    const ownerChanged =
      nextOwnerRole !== (existingTask.owner_role ?? null)
      || nextOwnerClerkUserId !== (existingTask.owner_clerk_user_id ?? null)
    const noteChanged = typeof validated.note === 'string' && validated.note.trim().length > 0

    if (!statusChanged && !ownerChanged && !noteChanged) {
      return NextResponse.json({
        success: true,
        data: existingTask,
      })
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from('execution_tasks')
      .update({
        status: nextStatus,
        owner_role: nextOwnerRole,
        owner_clerk_user_id: nextOwnerClerkUserId,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(existingTask.metadata ?? {}),
          last_status_note: noteChanged ? validated.note ?? null : existingTask.metadata?.last_status_note ?? null,
          last_status_updated_by: statusChanged ? authUser.clerkUserId : existingTask.metadata?.last_status_updated_by ?? null,
          last_status_updated_at: statusChanged ? new Date().toISOString() : existingTask.metadata?.last_status_updated_at ?? null,
          last_owner_updated_by: ownerChanged ? authUser.clerkUserId : existingTask.metadata?.last_owner_updated_by ?? null,
          last_owner_updated_at: ownerChanged ? new Date().toISOString() : existingTask.metadata?.last_owner_updated_at ?? null,
        },
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updateError || !updatedTask) {
      return NextResponse.json(
        { success: false, error: '実行タスクの更新に失敗しました' },
        { status: 500 }
      )
    }

    const events: Record<string, unknown>[] = []
    if (statusChanged) {
      events.push({
        task_id: updatedTask.id,
        project_id: updatedTask.project_id,
        change_request_id: updatedTask.change_request_id,
        event_type: 'status_changed',
        actor_clerk_user_id: authUser.clerkUserId,
        from_status: existingTask.status,
        to_status: nextStatus,
        owner_clerk_user_id: nextOwnerClerkUserId,
        owner_role: nextOwnerRole,
        note: validated.note ?? null,
        payload: {
          note: validated.note ?? null,
        },
      })
    }

    if (ownerChanged) {
      events.push({
        task_id: updatedTask.id,
        project_id: updatedTask.project_id,
        change_request_id: updatedTask.change_request_id,
        event_type: 'owner_assigned',
        actor_clerk_user_id: authUser.clerkUserId,
        from_status: existingTask.status,
        to_status: nextStatus,
        owner_clerk_user_id: nextOwnerClerkUserId,
        owner_role: nextOwnerRole,
        note: validated.note ?? null,
        payload: {
          previous_owner_role: existingTask.owner_role ?? null,
          previous_owner_clerk_user_id: existingTask.owner_clerk_user_id ?? null,
        },
      })
    }

    if (noteChanged && !statusChanged && !ownerChanged) {
      events.push({
        task_id: updatedTask.id,
        project_id: updatedTask.project_id,
        change_request_id: updatedTask.change_request_id,
        event_type: 'note_added',
        actor_clerk_user_id: authUser.clerkUserId,
        from_status: existingTask.status,
        to_status: nextStatus,
        owner_clerk_user_id: nextOwnerClerkUserId,
        owner_role: nextOwnerRole,
        note: validated.note ?? null,
        payload: {},
      })
    }

    if (events.length > 0) {
      await supabase
        .from('execution_task_events')
        .insert(events)
    }

    if (nextStatus === 'done') {
      await supabase
        .from('change_requests')
        .update({
          status: 'implemented',
        })
        .eq('id', existingTask.change_request_id)
        .eq('latest_execution_task_id', updatedTask.id)
    }

    if (statusChanged || noteChanged) {
      await writeAuditLog(supabase, {
        actorClerkUserId: authUser.clerkUserId,
        action: 'execution_task.update_status',
        resourceType: 'execution_task',
        resourceId: updatedTask.id,
        projectId: updatedTask.project_id,
        payload: {
          from_status: existingTask.status,
          to_status: nextStatus,
          note: validated.note ?? null,
          change_request_id: updatedTask.change_request_id,
        },
      })
    }

    if (ownerChanged) {
      await writeAuditLog(supabase, {
        actorClerkUserId: authUser.clerkUserId,
        action: 'execution_task.assign_owner',
        resourceType: 'execution_task',
        resourceId: updatedTask.id,
        projectId: updatedTask.project_id,
        payload: {
          previous_owner_role: existingTask.owner_role ?? null,
          previous_owner_clerk_user_id: existingTask.owner_clerk_user_id ?? null,
          owner_role: nextOwnerRole,
          owner_clerk_user_id: nextOwnerClerkUserId,
        },
      })
    }

    const { data: latestEvents } = await supabase
      .from('execution_task_events')
      .select('id, event_type, actor_clerk_user_id, from_status, to_status, owner_role, owner_clerk_user_id, note, created_at')
      .eq('task_id', updatedTask.id)
      .order('created_at', { ascending: false })
      .limit(10)

    return NextResponse.json({
      success: true,
      data: {
        ...updatedTask,
        events: latestEvents ?? [],
      },
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
