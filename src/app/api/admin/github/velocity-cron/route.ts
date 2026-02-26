import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit/log'
import {
  runVelocityCronBatch,
  resolveVelocityCronLimit,
} from '@/lib/github/velocity-cron'
import {
  isValidCronToken,
  readCronTokenFromHeaders,
} from '@/lib/source-analysis/cron'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

const velocityCronRequestSchema = z.object({
  limit: z.number().int().min(1).max(10).optional(),
})

async function handleVelocityCronRequest(request: NextRequest) {
  const rateLimited = applyRateLimit(
    request,
    'admin:github:velocity-cron:post',
    RATE_LIMITS['admin:github:velocity-cron:post']
  )
  if (rateLimited) return rateLimited

  const providedToken = readCronTokenFromHeaders(request.headers)
  const expectedSecret = process.env.GITHUB_VELOCITY_CRON_SECRET
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

  const defaultLimit = resolveVelocityCronLimit(
    process.env.GITHUB_VELOCITY_CRON_DEFAULT_LIMIT
  )
  const validated = velocityCronRequestSchema
    .partial()
    .default({})
    .parse(rawBody)

  const supabase = await createServiceRoleClient()
  const actorClerkUserId =
    process.env.GITHUB_VELOCITY_CRON_ACTOR_CLERK_USER_ID ??
    'system:velocity-cron'

  const result = await runVelocityCronBatch(supabase, {
    actorClerkUserId,
    limit: validated.limit ?? defaultLimit,
  })

  try {
    await writeAuditLog(supabase, {
      actorClerkUserId,
      action: 'github_velocity.cron_run',
      resourceType: 'github_reference',
      resourceId: 'batch',
      payload: {
        limit: validated.limit ?? defaultLimit,
        ...result,
      },
    })
  } catch {
    // Audit log failure should not turn a completed batch into 500
  }

  return NextResponse.json({ success: true, data: result })
}

export async function POST(request: NextRequest) {
  try {
    return await handleVelocityCronRequest(request)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: '入力データが不正です' },
        { status: 400 }
      )
    }
    const message =
      error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// Vercel Cron sends GET requests with Authorization header
export async function GET(request: NextRequest) {
  try {
    return await handleVelocityCronRequest(request)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
