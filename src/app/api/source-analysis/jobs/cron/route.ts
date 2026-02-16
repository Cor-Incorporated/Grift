import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit/log'
import { runQueuedSourceAnalysisJobs } from '@/lib/source-analysis/jobs'
import {
  isValidCronToken,
  readCronTokenFromHeaders,
} from '@/lib/source-analysis/cron'
import { sourceAnalysisRunRequestSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

const DEFAULT_CRON_LIMIT = 5

function resolveCronLimit(value: string | undefined): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return DEFAULT_CRON_LIMIT
  }
  return Math.min(20, Math.floor(num))
}

export async function POST(request: NextRequest) {
  try {
    const rateLimited = applyRateLimit(request, 'source-analysis:cron:post', RATE_LIMITS['source-analysis:cron:post'])
    if (rateLimited) return rateLimited

    const providedToken = readCronTokenFromHeaders(request.headers)
    const expectedSecret = process.env.SOURCE_ANALYSIS_CRON_SECRET
    if (!isValidCronToken({ expectedSecret, providedToken })) {
      return NextResponse.json(
        { success: false, error: 'cron secret が不正です' },
        { status: 401 }
      )
    }

    let rawBody: unknown = {}
    try {
      rawBody = await request.json()
    } catch {
      rawBody = {}
    }

    const defaultLimit = resolveCronLimit(process.env.SOURCE_ANALYSIS_CRON_DEFAULT_LIMIT)
    const validated = sourceAnalysisRunRequestSchema
      .partial()
      .default({})
      .parse(rawBody)

    const supabase = await createServiceRoleClient()
    const actorClerkUserId =
      process.env.SOURCE_ANALYSIS_CRON_ACTOR_CLERK_USER_ID ??
      'system:source-analysis-cron'

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId,
      projectId: validated.project_id,
      limit: validated.limit ?? defaultLimit,
    })

    await writeAuditLog(supabase, {
      actorClerkUserId,
      action: 'source_analysis.cron_run',
      resourceType: 'source_analysis_job',
      resourceId: validated.project_id ?? 'global',
      projectId: validated.project_id ?? null,
      payload: {
        mode: validated.project_id ? 'project' : 'global',
        limit: validated.limit ?? defaultLimit,
        result,
      },
    })

    return NextResponse.json({ success: true, data: result })
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
