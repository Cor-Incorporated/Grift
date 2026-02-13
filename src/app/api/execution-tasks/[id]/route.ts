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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

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

    const { data: updatedTask, error: updateError } = await supabase
      .from('execution_tasks')
      .update({
        status: validated.status,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(existingTask.metadata ?? {}),
          last_status_note: validated.note ?? null,
          last_status_updated_by: authUser.clerkUserId,
          last_status_updated_at: new Date().toISOString(),
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

    if (validated.status === 'done') {
      await supabase
        .from('change_requests')
        .update({
          status: 'implemented',
        })
        .eq('id', existingTask.change_request_id)
        .eq('latest_execution_task_id', updatedTask.id)
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'execution_task.update_status',
      resourceType: 'execution_task',
      resourceId: updatedTask.id,
      projectId: updatedTask.project_id,
      payload: {
        from_status: existingTask.status,
        to_status: validated.status,
        note: validated.note ?? null,
        change_request_id: updatedTask.change_request_id,
      },
    })

    return NextResponse.json({
      success: true,
      data: updatedTask,
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

