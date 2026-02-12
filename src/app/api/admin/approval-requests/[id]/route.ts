import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { approvalRequestUpdateSchema } from '@/lib/utils/validation'

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
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json()
    const validated = approvalRequestUpdateSchema.parse(body)

    const updatePayload: Record<string, unknown> = {
      status: validated.status,
      assigned_to_clerk_user_id: validated.assigned_to_clerk_user_id,
      updated_at: new Date().toISOString(),
    }

    if (validated.status === 'approved' || validated.status === 'rejected') {
      updatePayload.resolved_by_clerk_user_id = authUser.clerkUserId
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
        resolutionComment: validated.resolution_comment ?? null,
      },
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
