import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { intakeIngestRequestSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import {
  calculateCompleteness,
  toIntakeStatus,
  buildFollowUpQuestion,
} from '@/lib/intake/completeness'
import { parseIntakeMessage } from '@/lib/intake/parser'
import { resolveRequestedDeadline } from '@/lib/intake/deadline'
import {
  evaluateBillableDecision,
  loadActiveBillableRules,
} from '@/lib/change-requests/billable-rules'
import { isExternalApiQuotaError } from '@/lib/usage/api-usage'

function buildDescription(input: {
  summary: string
  details: Record<string, unknown>
  missingFields: string[]
  followUpQuestion: string
  sourceChannel: string
}): string {
  const detailLines = Object.entries(input.details)
    .filter(([, value]) => value !== null && value !== undefined && `${value}`.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .slice(0, 20)

  const missingLines = input.missingFields.map((field) => `- ${field}`).join('\n')
  const detailBlock = detailLines.length > 0
    ? detailLines.join('\n')
    : '- (詳細未入力)'
  const missingBlock = input.missingFields.length > 0
    ? missingLines
    : '- なし'

  return [
    input.summary,
    '',
    '## 抽出詳細',
    detailBlock,
    '',
    '## 不足情報',
    missingBlock,
    '',
    '## 次に確認する質問',
    `- ${input.followUpQuestion}`,
    '',
    `source_channel: ${input.sourceChannel}`,
  ].join('\n')
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'intake:ingest:post', RATE_LIMITS['intake:ingest:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validated = intakeIngestRequestSchema.parse(body)
    const source = validated.source
    const sourceChannel = source?.channel ?? 'web_app'

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

    const [{ data: project }, rules, parsed] = await Promise.all([
      supabase
        .from('projects')
        .select('id, created_at')
        .eq('id', validated.project_id)
        .maybeSingle(),
      loadActiveBillableRules(supabase),
      parseIntakeMessage(validated.message, {
        mode: validated.parser_mode,
      }),
    ])

    const projectCreatedAt = project?.created_at ?? new Date().toISOString()
    const intakeGroupId = crypto.randomUUID()
    const minimumCompleteness = validated.minimum_completeness

    const rows = parsed.intents.map((intent) => {
      const deadline = resolveRequestedDeadline({
        dueDate: intent.dueDate,
        details: intent.details,
      })
      const completeness = calculateCompleteness({
        intentType: intent.intentType,
        details: intent.details,
        summary: intent.summary,
      })
      const intakeStatus = toIntakeStatus({
        score: completeness.score,
        minimumCompleteness,
      })
      const followUpQuestion = buildFollowUpQuestion({
        intentType: intent.intentType,
        missingFields: completeness.missingFields,
      })

      const billable = evaluateBillableDecision({
        rules,
        request: {
          category: intent.category,
          projectCreatedAt,
          responsibilityType: 'unknown',
          reproducibility: 'unknown',
        },
      })

      return {
        project_id: validated.project_id,
        title: intent.title.slice(0, 200),
        description: buildDescription({
          summary: intent.summary.slice(0, 5000),
          details: intent.details,
          missingFields: completeness.missingFields,
          followUpQuestion,
          sourceChannel,
        }).slice(0, 10000),
        category: intent.category,
        impact_level: intent.priorityHint,
        responsibility_type: 'unknown',
        reproducibility: 'unknown',
        status: 'triaged',
        intake_status: intakeStatus,
        requirement_completeness: completeness.score,
        missing_fields: completeness.missingFields,
        source_channel: sourceChannel,
        source_message_id: source?.message_id ?? null,
        source_thread_id: source?.thread_id ?? null,
        source_actor_name: source?.actor_name ?? null,
        source_actor_email: source?.actor_email ?? null,
        source_event_at: source?.event_at ?? null,
        requested_deadline: deadline.raw,
        requested_deadline_at: deadline.dueAt,
        intake_group_id: intakeGroupId,
        intake_intent: intent.intentType,
        is_billable: billable.isBillable,
        billable_reason: billable.reason,
        billable_rule_id: billable.matchedRuleId,
        billable_evaluation: {
          ...billable.evaluation,
          parser: parsed.parser,
          parser_confidence: intent.confidence,
          follow_up_question: followUpQuestion,
        },
        requested_by_name: validated.requested_by_name ?? authUser.fullName,
        requested_by_email: validated.requested_by_email ?? authUser.email,
        created_by_clerk_user_id: authUser.clerkUserId,
      }
    })

    const { data: created, error: insertError } = await supabase
      .from('change_requests')
      .insert(rows)
      .select('*')

    if (insertError || !created) {
      return NextResponse.json(
        { success: false, error: '変更要求の自動起票に失敗しました' },
        { status: 500 }
      )
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'intake.ingest_change_requests',
      resourceType: 'project',
      resourceId: validated.project_id,
      projectId: validated.project_id,
      payload: {
        parser: parsed.parser,
        parserMode: validated.parser_mode ?? 'auto',
        intentCount: rows.length,
        createdCount: created.length,
        intakeGroupId,
        sourceChannel,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        parser: parsed.parser,
        message_summary: parsed.messageSummary,
        intake_group_id: intakeGroupId,
        created,
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
