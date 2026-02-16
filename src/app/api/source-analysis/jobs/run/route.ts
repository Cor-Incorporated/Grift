import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { runQueuedSourceAnalysisJobs } from '@/lib/source-analysis/jobs'
import { getAuthenticatedUser, isAdminUser, canAccessProject } from '@/lib/auth/authorization'
import { sourceAnalysisRunRequestSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'source-analysis:jobs:run:post', RATE_LIMITS['source-analysis:jobs:run:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    let rawBody: unknown = {}
    try {
      rawBody = await request.json()
    } catch {
      rawBody = {}
    }

    const validated = sourceAnalysisRunRequestSchema.parse(rawBody)
    const supabase = await createServiceRoleClient()
    const isAdmin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)

    if (!isAdmin) {
      if (!validated.project_id) {
        return NextResponse.json(
          { success: false, error: '一般ユーザーは project_id の指定が必要です' },
          { status: 400 }
        )
      }

      const accessible = await canAccessProject(
        supabase,
        validated.project_id,
        authUser.clerkUserId,
        authUser.email
      )

      if (!accessible) {
        return NextResponse.json({ success: false, error: 'この案件にアクセスできません' }, { status: 403 })
      }
    }

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      projectId: isAdmin ? validated.project_id : validated.project_id,
      limit: validated.limit,
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
