import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(request, 'projects:get', RATE_LIMITS['projects:get'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const { id } = await params

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '無効なプロジェクトIDです' },
        { status: 400 }
      )
    }

    const supabase = await createServiceRoleClient()

    const hasAccess = await canAccessProject(
      supabase,
      id,
      authUser.clerkUserId,
      authUser.email
    )
    if (!hasAccess) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'このプロジェクトへのアクセス権限がありません' },
        { status: 403 }
      )
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*, customer:customers(id, name, email)')
      .eq('id', id)
      .single()

    if (projectError || !project) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'プロジェクトが見つかりません' },
        { status: 404 }
      )
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: project,
    })
  } catch (error) {
    console.error('Unexpected error in GET /api/projects/[id]:', error)
    return NextResponse.json<ApiResponse>(
      { success: false, error: '予期しないエラーが発生しました' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(request, 'projects:delete', RATE_LIMITS['projects:delete'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const { id } = await params

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: '無効なプロジェクトIDです' },
        { status: 400 }
      )
    }

    const supabase = await createServiceRoleClient()

    // Check access
    const hasAccess = await canAccessProject(
      supabase,
      id,
      authUser.clerkUserId,
      authUser.email
    )
    if (!hasAccess) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'このプロジェクトへのアクセス権限がありません' },
        { status: 403 }
      )
    }

    // Delete project (CASCADE will handle related records)
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Project deletion error:', deleteError)
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'プロジェクトの削除に失敗しました' },
        { status: 500 }
      )
    }

    // Audit log
    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'project.delete',
      resourceType: 'project',
      resourceId: id,
      projectId: id,
      payload: {},
    })

    return NextResponse.json<ApiResponse>({ success: true })
  } catch (error) {
    console.error('Unexpected error in DELETE /api/projects/[id]:', error)
    return NextResponse.json<ApiResponse>(
      { success: false, error: '予期しないエラーが発生しました' },
      { status: 500 }
    )
  }
}
