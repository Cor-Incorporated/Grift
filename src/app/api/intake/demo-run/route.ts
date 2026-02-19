import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import {
  calculateCompleteness,
  toIntakeStatus,
  buildFollowUpQuestion,
} from '@/lib/intake/completeness'
import { getIntakeDemoCaseById } from '@/lib/intake/demo-cases'
import { parseIntakeMessage } from '@/lib/intake/parser'
import { resolveRequestedDeadline } from '@/lib/intake/deadline'
import {
  evaluateBillableDecision,
  loadActiveBillableRules,
} from '@/lib/change-requests/billable-rules'

const requestSchema = z.object({
  project_id: z.string().uuid(),
  demo_case_id: z.string().min(1).max(120),
  parser_mode: z.enum(['auto', 'heuristic']).optional(),
  requested_by_name: z.string().min(1).max(120).optional(),
  requested_by_email: z.string().email().optional(),
})

function buildDescription(input: {
  summary: string
  details: Record<string, unknown>
  missingFields: string[]
  followUpQuestion: string
}): string {
  const detailLines = Object.entries(input.details)
    .filter(([, value]) => value !== null && value !== undefined && `${value}`.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .slice(0, 20)

  const missingLines = input.missingFields.map((field) => `- ${field}`).join('\n')
  const detailBlock = detailLines.length > 0 ? detailLines.join('\n') : '- (詳細未入力)'
  const missingBlock = input.missingFields.length > 0 ? missingLines : '- なし'

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
    'source_channel: demo_fixture',
  ].join('\n')
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'intake:demo-run:post', RATE_LIMITS['intake:demo-run:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const rawBody = await request.json()
    const validated = requestSchema.parse(rawBody)
    const demoCase = getIntakeDemoCaseById(validated.demo_case_id)
    if (!demoCase) {
      return NextResponse.json({ success: false, error: 'デモケースが見つかりません' }, { status: 404 })
    }

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

    const parserMode = validated.parser_mode ?? 'heuristic'
    const [{ data: project }, rules, parsed] = await Promise.all([
      supabase
        .from('projects')
        .select('id, created_at')
        .eq('id', validated.project_id)
        .maybeSingle(),
      loadActiveBillableRules(supabase),
      parseIntakeMessage(demoCase.message, { mode: parserMode }),
    ])

    const projectCreatedAt = project?.created_at ?? new Date().toISOString()
    const intakeGroupId = crypto.randomUUID()

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
        }).slice(0, 10000),
        category: intent.category,
        impact_level: intent.priorityHint,
        responsibility_type: 'unknown',
        reproducibility: 'unknown',
        status: 'triaged',
        intake_status: intakeStatus,
        requirement_completeness: completeness.score,
        missing_fields: completeness.missingFields,
        source_channel: 'demo_fixture',
        source_message_id: validated.demo_case_id,
        source_thread_id: validated.demo_case_id,
        source_actor_name: 'PO Demo User',
        source_actor_email: validated.requested_by_email ?? authUser.email,
        source_event_at: new Date().toISOString(),
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
          demo_case_id: demoCase.id,
        },
        requested_by_name: validated.requested_by_name ?? authUser.fullName,
        requested_by_email: validated.requested_by_email ?? authUser.email,
        created_by_clerk_user_id: authUser.clerkUserId,
      }
    })

    const { data: created, error: insertError } = await supabase
      .from('change_requests')
      .insert(rows)
      .select('id, title, intake_status, requirement_completeness')

    if (insertError || !created) {
      const failedRun = await supabase
        .from('intake_demo_runs')
        .insert({
          project_id: validated.project_id,
          demo_case_id: demoCase.id,
          parser: parsed.parser,
          intake_group_id: intakeGroupId,
          created_count: 0,
          created_change_request_ids: [],
          actor_clerk_user_id: authUser.clerkUserId,
          payload: {
            status: 'failed',
            parser_mode: parserMode,
            expected_intent_types: demoCase.expectedIntentTypes,
            detected_intent_types: parsed.intents.map((intent) => intent.intentType),
            error: insertError?.message ?? 'change_requests insert failed',
          },
        })
        .select('id')
        .maybeSingle()

      await writeAuditLog(supabase, {
        actorClerkUserId: authUser.clerkUserId,
        action: 'intake.demo_run',
        resourceType: 'project',
        resourceId: validated.project_id,
        projectId: validated.project_id,
        payload: {
          demoCaseId: demoCase.id,
          parser: parsed.parser,
          parserMode,
          intentCount: rows.length,
          createdCount: 0,
          intakeGroupId,
          runId: failedRun.data?.id ?? null,
          outcome: 'failed',
          error: insertError?.message ?? null,
        },
      })

      const detailMessage = insertError?.message
        ? `デモケース起票に失敗しました: ${insertError.message}`
        : 'デモケース起票に失敗しました: change_requests insert returned null'

      return NextResponse.json(
        { success: false, error: detailMessage },
        { status: 500 }
      )
    }

    const createdIds = created.map((item) => item.id)
    const { data: demoRunLog } = await supabase
      .from('intake_demo_runs')
      .insert({
        project_id: validated.project_id,
        demo_case_id: demoCase.id,
        parser: parsed.parser,
        intake_group_id: intakeGroupId,
        created_count: created.length,
        created_change_request_ids: createdIds,
        actor_clerk_user_id: authUser.clerkUserId,
        payload: {
          status: 'succeeded',
          parser_mode: parserMode,
          expected_intent_types: demoCase.expectedIntentTypes,
          detected_intent_types: parsed.intents.map((intent) => intent.intentType),
          intent_count: parsed.intents.length,
          created_titles: created.map((item) => item.title),
        },
      })
      .select('id, created_at')
      .maybeSingle()

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'intake.demo_run',
      resourceType: 'project',
      resourceId: validated.project_id,
      projectId: validated.project_id,
      payload: {
        demoCaseId: demoCase.id,
        parser: parsed.parser,
        parserMode,
        intentCount: rows.length,
        createdCount: created.length,
        intakeGroupId,
        runId: demoRunLog?.id ?? null,
        outcome: 'succeeded',
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        run_id: demoRunLog?.id ?? null,
        demo_case_id: demoCase.id,
        parser: parsed.parser,
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

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
