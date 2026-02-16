import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { teamMemberSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimitedGet = applyRateLimit(request, 'admin:team-members:get', RATE_LIMITS['admin:team-members:get'], authUser.clerkUserId)
    if (rateLimitedGet) return rateLimitedGet

    const supabase = await createServiceRoleClient()
    const isAdmin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!isAdmin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ success: false, error: 'team members の取得に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch {
    return NextResponse.json({ success: false, error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'admin:team-members:post', RATE_LIMITS['admin:team-members:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const isAdmin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!isAdmin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const body = await request.json()
    const validated = teamMemberSchema.parse(body)

    const { data, error } = await supabase
      .from('team_members')
      .upsert(
        {
          clerk_user_id: validated.clerk_user_id,
          email: validated.email ?? null,
          roles: validated.roles,
          active: validated.active,
          created_by_clerk_user_id: authUser.clerkUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'clerk_user_id' }
      )
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'team member 保存に失敗しました' }, { status: 500 })
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'team_member.upsert',
      resourceType: 'team_member',
      resourceId: data.id,
      payload: {
        clerkUserId: data.clerk_user_id,
        roles: data.roles,
        active: data.active,
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
