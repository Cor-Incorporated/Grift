import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { intakeFollowUpRequestSchema } from '@/lib/utils/validation'
import { buildFollowUpQuestion } from '@/lib/intake/completeness'
import { applyRateLimit, getClientIdentifier } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

const CHOICE_HINTS: Record<string, string[]> = {
  urgency: ['critical', 'high', 'medium', 'low'],
  reproducibility: ['confirmed', 'not_confirmed', 'unknown'],
}

export async function POST(request: NextRequest) {
  try {
    const clientId = getClientIdentifier(request)
    const rateLimited = applyRateLimit(request, 'intake:follow-up:post', RATE_LIMITS['intake:follow-up:post'], clientId)
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validated = intakeFollowUpRequestSchema.parse(body)

    const question = buildFollowUpQuestion({
      intentType: validated.intent_type,
      missingFields: validated.missing_fields,
    })

    const firstMissingField = validated.missing_fields[0]
    return NextResponse.json({
      success: true,
      data: {
        question,
        field: firstMissingField,
        choices: firstMissingField ? (CHOICE_HINTS[firstMissingField] ?? []) : [],
      },
    })
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
