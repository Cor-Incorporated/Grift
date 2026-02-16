import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, getInternalRoles } from '@/lib/auth/authorization'
import { getLinearTeams } from '@/lib/linear/client'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(request, 'admin:linear:teams:get', RATE_LIMITS['admin:linear:teams:get'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()

    const internalRoles = await getInternalRoles(
      supabase,
      authUser.clerkUserId,
      authUser.email
    )
    if (!internalRoles.has('admin') && !internalRoles.has('sales')) {
      return NextResponse.json(
        { success: false, error: '管理者または営業ロールが必要です' },
        { status: 403 }
      )
    }

    const teams = await getLinearTeams()

    return NextResponse.json({
      success: true,
      data: teams,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Linearチーム取得に失敗しました'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
