import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { dataSourceSchema } from '@/lib/utils/validation'
import { writeAuditLog } from '@/lib/audit/log'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimitedGet = applyRateLimit(request, 'admin:data-sources:get', RATE_LIMITS['admin:data-sources:get'], authUser.clerkUserId)
    if (rateLimitedGet) return rateLimitedGet

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') === 'true'

    let query = supabase.from('data_sources').select('*').order('provider').order('source_key')
    if (activeOnly) {
      query = query.eq('active', true)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { success: false, error: 'データソース一覧の取得に失敗しました' },
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

    const rateLimited = applyRateLimit(request, 'admin:data-sources:post', RATE_LIMITS['admin:data-sources:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const body = await request.json()
    const validated = dataSourceSchema.parse(body)

    const { data, error } = await supabase
      .from('data_sources')
      .upsert(
        {
          ...validated,
          created_by_clerk_user_id: authUser.clerkUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'source_key' }
      )
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'データソースの保存に失敗しました' },
        { status: 500 }
      )
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'data_source.upsert',
      resourceType: 'data_source',
      resourceId: data.id,
      payload: {
        sourceKey: data.source_key,
        provider: data.provider,
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
