import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { adminProfileSchema } from '@/lib/utils/validation'

const DEFAULT_ADMIN_HOURLY_RATE = 15000

function resolveDisplayName(input: {
  displayName: string | null
  fallbackFullName: string
  fallbackEmail: string | null
}): string {
  if (input.displayName?.trim()) {
    return input.displayName
  }

  if (input.fallbackFullName && input.fallbackFullName !== 'Unknown') {
    return input.fallbackFullName
  }

  if (input.fallbackEmail?.trim()) {
    return input.fallbackEmail.split('@')[0] ?? ''
  }

  return ''
}

export async function GET() {
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

    const { data, error } = await supabase
      .from('admins')
      .select('id, clerk_user_id, display_name, default_hourly_rate, github_orgs')
      .eq('clerk_user_id', authUser.clerkUserId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ success: false, error: '設定情報の取得に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: {
        id: data?.id ?? null,
        display_name: resolveDisplayName({
          displayName: data?.display_name ?? null,
          fallbackFullName: authUser.fullName,
          fallbackEmail: authUser.email,
        }),
        default_hourly_rate: Number(data?.default_hourly_rate ?? DEFAULT_ADMIN_HOURLY_RATE),
        github_orgs: Array.isArray(data?.github_orgs) ? data.github_orgs : [],
      },
    })
  } catch {
    return NextResponse.json({ success: false, error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
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
    const validated = adminProfileSchema.parse(body)

    const { data, error } = await supabase
      .from('admins')
      .upsert(
        {
          clerk_user_id: authUser.clerkUserId,
          display_name: validated.display_name,
          default_hourly_rate: validated.default_hourly_rate,
        },
        { onConflict: 'clerk_user_id' }
      )
      .select('id, clerk_user_id, display_name, default_hourly_rate, github_orgs')
      .single()

    if (error || !data) {
      return NextResponse.json({ success: false, error: '設定情報の保存に失敗しました' }, { status: 500 })
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'admin_profile.upsert',
      resourceType: 'admin_profile',
      resourceId: data.id,
      payload: {
        displayName: data.display_name,
        defaultHourlyRate: Number(data.default_hourly_rate ?? DEFAULT_ADMIN_HOURLY_RATE),
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        id: data.id,
        display_name: data.display_name,
        default_hourly_rate: Number(data.default_hourly_rate ?? DEFAULT_ADMIN_HOURLY_RATE),
        github_orgs: Array.isArray(data.github_orgs) ? data.github_orgs : [],
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
