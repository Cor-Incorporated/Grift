import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { intakeParseRequestSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import {
  calculateCompleteness,
  toIntakeStatus,
  buildFollowUpQuestion,
} from '@/lib/intake/completeness'
import { parseIntakeMessage } from '@/lib/intake/parser'
import { isExternalApiQuotaError } from '@/lib/usage/api-usage'

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'intake:parse:post', RATE_LIMITS['intake:parse:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validated = intakeParseRequestSchema.parse(body)

    const supabase = await createServiceRoleClient()
    const accessible = await canAccessProject(
      supabase,
      validated.project_id,
      authUser.clerkUserId,
      authUser.email
    )

    if (!accessible) {
      return NextResponse.json(
        { success: false, error: 'この案件にアクセスできません' },
        { status: 403 }
      )
    }

    const parsed = await parseIntakeMessage(validated.message, {
      mode: validated.parser_mode,
    })
    const intents = parsed.intents.map((intent) => {
      const completeness = calculateCompleteness({
        intentType: intent.intentType,
        details: intent.details,
        summary: intent.summary,
      })
      const intakeStatus = toIntakeStatus({ score: completeness.score })
      return {
        ...intent,
        requirement_completeness: completeness.score,
        intake_status: intakeStatus,
        missing_fields: completeness.missingFields,
        follow_up_question: buildFollowUpQuestion({
          intentType: intent.intentType,
          missingFields: completeness.missingFields,
        }),
      }
    })

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'intake.parse',
      resourceType: 'project',
      resourceId: validated.project_id,
      projectId: validated.project_id,
      payload: {
        parser: parsed.parser,
        intentCount: intents.length,
        parserMode: validated.parser_mode ?? 'auto',
        sourceChannel: validated.source?.channel ?? 'web_app',
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        parser: parsed.parser,
        message_summary: parsed.messageSummary,
        intents,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: '入力データが不正です' },
        { status: 400 }
      )
    }

    if (isExternalApiQuotaError(error)) {
      return NextResponse.json(
        { success: false, error: '外部APIのクォータ上限に達しました。しばらくしてから再試行してください。' },
        { status: 429 }
      )
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
