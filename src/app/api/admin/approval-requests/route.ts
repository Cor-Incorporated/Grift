import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { approvalRequestCreateSchema } from '@/lib/utils/validation'

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const projectId = searchParams.get('project_id')

    let query = supabase
      .from('approval_requests')
      .select('*')
      .order('requested_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    if (projectId) {
      query = query.eq('project_id', projectId)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { success: false, error: '承認リクエストの取得に失敗しました' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch {
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const validated = approvalRequestCreateSchema.parse(body)

    const accessible = await canAccessProject(
      supabase,
      validated.project_id,
      authUser.clerkUserId,
      authUser.email
    )

    if (!accessible) {
      return NextResponse.json({ success: false, error: 'この案件にアクセスできません' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('approval_requests')
      .insert({
        ...validated,
        status: 'pending',
        requested_by_clerk_user_id: authUser.clerkUserId,
      })
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ success: false, error: '承認リクエストの作成に失敗しました' }, { status: 500 })
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'approval_request.create',
      resourceType: 'approval_request',
      resourceId: data.id,
      projectId: data.project_id,
      payload: {
        requestType: data.request_type,
        severity: data.severity,
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
