import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { resolveMarketEvidenceWithFallback } from '@/lib/market/evidence-fallback'
import {
  canAccessProject,
  getAuthenticatedUser,
  getInternalRoles,
} from '@/lib/auth/authorization'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import { buildProjectAttachmentContext } from '@/lib/source-analysis/project-context'
import { writeAuditLog } from '@/lib/audit/log'
import { changeRequestEstimateSchema } from '@/lib/utils/validation'
import { fetchActivePricingPolicy } from '@/lib/pricing/policies'
import { calculateChangeOrder } from '@/lib/pricing/engine'
import { buildEstimateEvidenceAppendix } from '@/lib/market/evidence-appendix'
import {
  buildApprovalTriggersFromRiskFlags,
  deriveApprovalStatus,
  resolveEstimateStatus,
} from '@/lib/approval/gate'
import { ensureApprovalRequests } from '@/lib/approval/requests'
import { isExternalApiQuotaError } from '@/lib/usage/api-usage'
import type { EstimateMode, ProjectType } from '@/types/database'

interface DeltaHours {
  investigation: number
  implementation: number
  testing: number
  buffer: number
  duration_months: number
  team_size: number
  rationale: string
}

async function estimateChangeHours(input: {
  projectType: ProjectType
  specMarkdown: string | null
  attachmentContext?: string
  title: string
  description: string
  category: string
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  }
}): Promise<DeltaHours> {
  const attachmentBlock = input.attachmentContext
    ? `\n\n添付資料解析の要約:\n${input.attachmentContext}`
    : ''
  const prompt = `あなたは受託開発の変更見積り責任者です。変更要求に対する追加工数をJSONで返してください。

案件タイプ: ${input.projectType}
変更カテゴリ: ${input.category}
変更タイトル: ${input.title}

変更詳細:
${input.description}

既存仕様（抜粋）:
${(input.specMarkdown ?? '').slice(0, 3000)}
${attachmentBlock}

出力形式:
\`\`\`json
{
  "investigation": 0,
  "implementation": 0,
  "testing": 0,
  "buffer": 0,
  "duration_months": 1,
  "team_size": 2,
  "rationale": "算出根拠"
}
\`\`\`

制約:
- 数値は0以上
- 合計工数が過小にならないように現実的に見積もる
- bug_reportは調査割合を高める`

  const response = await sendMessage(
    'あなたは変更見積りの専門家です。JSONのみ返答してください。',
    [{ role: 'user', content: prompt }],
    {
      temperature: 0.2,
      maxTokens: 1500,
      usageContext: input.usageContext,
    }
  )

  const parsed = parseJsonFromResponse<Partial<DeltaHours>>(response)

  return {
    investigation: Math.max(0, Number(parsed.investigation ?? 0)),
    implementation: Math.max(0, Number(parsed.implementation ?? 0)),
    testing: Math.max(0, Number(parsed.testing ?? 0)),
    buffer: Math.max(0, Number(parsed.buffer ?? 0)),
    duration_months: Math.max(0.5, Number(parsed.duration_months ?? 1)),
    team_size: Math.max(1, Math.round(Number(parsed.team_size ?? 2))),
    rationale:
      typeof parsed.rationale === 'string' && parsed.rationale.length > 0
        ? parsed.rationale
        : '変更差分に基づく標準見積り',
  }
}

function modeFromType(type: ProjectType): EstimateMode {
  if (type === 'new_project') return 'market_comparison'
  if (type === 'feature_addition') return 'hybrid'
  return 'hours_only'
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'change-requests:estimate:post', RATE_LIMITS['change-requests:estimate:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const internalRoles = await getInternalRoles(
      supabase,
      authUser.clerkUserId,
      authUser.email
    )
    if (internalRoles.size === 0) {
      return NextResponse.json(
        { success: false, error: '変更見積りは管理者・営業・開発ロールのみ実行できます' },
        { status: 403 }
      )
    }

    const { id } = await context.params
    const body = await request.json()
    const validated = changeRequestEstimateSchema.parse(body)

    const { data: changeRequest, error: changeRequestError } = await supabase
      .from('change_requests')
      .select('*')
      .eq('id', id)
      .single()

    if (changeRequestError || !changeRequest) {
      return NextResponse.json({ success: false, error: '変更要求が見つかりません' }, { status: 404 })
    }

    const accessible = await canAccessProject(
      supabase,
      changeRequest.project_id,
      authUser.clerkUserId,
      authUser.email
    )

    if (!accessible) {
      return NextResponse.json(
        { success: false, error: 'この案件にアクセスできません' },
        { status: 403 }
      )
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', changeRequest.project_id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ success: false, error: '案件が見つかりません' }, { status: 404 })
    }

    const projectType = project.type as ProjectType

    const [attachmentContext, policy] = await Promise.all([
      buildProjectAttachmentContext(supabase, project.id),
      fetchActivePricingPolicy(supabase, projectType),
    ])
    const deltaHours = await estimateChangeHours({
      projectType,
      specMarkdown: project.spec_markdown,
      attachmentContext: attachmentContext || undefined,
      title: changeRequest.title,
      description: changeRequest.description,
      category: changeRequest.category,
      usageContext: {
        projectId: project.id,
        actorClerkUserId: authUser.clerkUserId,
      },
    })

    let marketData: Record<string, unknown> | null = null
    let marketEvidenceId: string | null = null
    let evidenceAppendix: Record<string, unknown> | null = null
    let evidenceRequirementMet = true
    let evidenceSourceCount: number | null = null
    let evidenceBlockReason: string | null = null
    let evidenceWarnings: string[] = []

    if (validated.include_market_context) {
      const fetchedEvidence = await fetchMarketEvidenceFromXai({
        projectType,
        context: `${changeRequest.title}\n${changeRequest.description}${
          attachmentContext ? `\n\n${attachmentContext}` : ''
        }`,
        region: validated.region,
        usageContext: {
          projectId: project.id,
          actorClerkUserId: authUser.clerkUserId,
        },
      })
      const evidenceResolution = await resolveMarketEvidenceWithFallback({
        supabase,
        projectId: project.id,
        projectType,
        fetched: fetchedEvidence,
      })
      const evidence = evidenceResolution.result

      const { data: savedEvidence } = await supabase
        .from('market_evidence')
        .insert({
          project_id: project.id,
          project_type: projectType,
          source: 'xai',
          query: `${changeRequest.title}\n${changeRequest.description}`.slice(0, 4000),
          summary: evidence.evidence.summary,
          data: evidence.evidence,
          citations: evidence.citations,
          confidence_score: evidence.confidenceScore,
          usage: evidence.usage,
          created_by_clerk_user_id: authUser.clerkUserId,
          retrieved_at: evidenceResolution.sourceRetrievedAt,
        })
        .select('id, retrieved_at')
        .maybeSingle()

      marketEvidenceId = savedEvidence?.id ?? null
      const appendix = buildEstimateEvidenceAppendix({
        citations: evidence.citations,
        confidenceScore: evidence.confidenceScore,
        summary: evidence.evidence.summary,
        retrievedAt:
          savedEvidence?.retrieved_at
          ?? evidenceResolution.sourceRetrievedAt
          ?? new Date().toISOString(),
        warnings: evidenceResolution.warning ? [evidenceResolution.warning] : [],
      })

      evidenceAppendix = appendix as unknown as Record<string, unknown>
      evidenceRequirementMet = appendix.requirement.met
      evidenceSourceCount = appendix.requirement.unique_source_count
      evidenceBlockReason = appendix.requirement.reason
      evidenceWarnings = appendix.warnings
      marketData = {
        ...evidence.evidence,
        citations: evidence.citations,
        confidence_score: evidence.confidenceScore,
      }
    }

    const changePricing = calculateChangeOrder({
      hours: {
        investigation: deltaHours.investigation,
        implementation: deltaHours.implementation,
        testing: deltaHours.testing,
        buffer: deltaHours.buffer,
      },
      hourlyRate: validated.your_hourly_rate,
      policy,
      durationMonths: deltaHours.duration_months,
      teamSize: deltaHours.team_size,
    })
    const riskFlags = [...changePricing.riskFlags]
    if (!evidenceRequirementMet) {
      riskFlags.push('insufficient_evidence_sources')
    }
    if (evidenceWarnings.length > 0) {
      riskFlags.push('market_evidence_fallback_used')
    }

    const approvalTriggers = buildApprovalTriggersFromRiskFlags({
      riskFlags,
      projectType,
      pricingContext: {
        delta_hours: changePricing.deltaHours,
        hours_based_fee: changePricing.hoursBasedFee,
        floor_guard_fee: changePricing.floorGuardFee,
        final_delta_fee: changePricing.finalDeltaFee,
      },
    })
    const approvalRequired = approvalTriggers.length > 0
    const approvalStatus = approvalRequired
      ? deriveApprovalStatus(['pending'])
      : deriveApprovalStatus([])
    const statusDecision = resolveEstimateStatus({
      evidenceRequirementMet,
      evidenceReason: evidenceBlockReason,
      approvalStatus,
    })

    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .insert({
        project_id: project.id,
        change_request_id: changeRequest.id,
        estimate_mode: modeFromType(projectType),
        estimate_status: statusDecision.estimateStatus,
        approval_required: approvalRequired,
        approval_status: approvalStatus,
        approval_block_reason: statusDecision.approvalBlockReason,
        evidence_requirement_met: evidenceRequirementMet,
        evidence_source_count: evidenceSourceCount,
        evidence_appendix: evidenceAppendix,
        evidence_block_reason: evidenceBlockReason,
        your_hourly_rate: validated.your_hourly_rate,
        your_estimated_hours: changePricing.deltaHours,
        hours_investigation: deltaHours.investigation,
        hours_implementation: deltaHours.implementation,
        hours_testing: deltaHours.testing,
        hours_buffer: deltaHours.buffer,
        hours_breakdown_report: deltaHours.rationale,
        market_hourly_rate:
          typeof marketData?.marketHourlyRate === 'number'
            ? marketData.marketHourlyRate
            : null,
        market_estimated_hours: null,
        multiplier: 1,
        total_market_cost: null,
        comparison_report: null,
        grok_market_data: marketData,
        similar_projects: null,
        pricing_snapshot: {
          policy,
          change_delta_hours: changePricing.deltaHours,
          pricing: changePricing,
          duration_months: deltaHours.duration_months,
          team_size: deltaHours.team_size,
        },
        risk_flags: riskFlags,
        market_evidence_id: marketEvidenceId,
      })
      .select('*')
      .single()

    if (estimateError || !estimate) {
      return NextResponse.json(
        { success: false, error: '追加見積りの保存に失敗しました' },
        { status: 500 }
      )
    }

    if (approvalRequired) {
      const ensured = await ensureApprovalRequests({
        supabase,
        projectId: project.id,
        estimateId: estimate.id,
        changeRequestId: changeRequest.id,
        actorClerkUserId: authUser.clerkUserId,
        triggers: approvalTriggers,
      })

      await writeAuditLog(supabase, {
        actorClerkUserId: authUser.clerkUserId,
        action: 'change_request.approval_gate_enabled',
        resourceType: 'change_request',
        resourceId: changeRequest.id,
        projectId: project.id,
        payload: {
          estimateId: estimate.id,
          triggerCount: approvalTriggers.length,
          createdApprovalRequestCount: ensured.createdIds.length,
        },
      })
    }

    const { count } = await supabase
      .from('estimate_versions')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .eq('change_request_id', changeRequest.id)

    await supabase
      .from('estimate_versions')
      .insert({
        estimate_id: estimate.id,
        project_id: project.id,
        change_request_id: changeRequest.id,
        version: (count ?? 0) + 1,
        version_type: 'change_order',
        snapshot: estimate,
        created_by_clerk_user_id: authUser.clerkUserId,
      })

    await supabase
      .from('change_requests')
      .update({
        status: 'estimated',
        latest_estimate_id: estimate.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', changeRequest.id)

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'change_request.estimate',
      resourceType: 'change_request',
      resourceId: changeRequest.id,
      projectId: project.id,
      payload: {
        estimateId: estimate.id,
        finalDeltaFee: changePricing.finalDeltaFee,
        riskFlags,
        evidenceRequirementMet,
        evidenceSourceCount,
        approvalRequired,
        approvalStatus,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        estimate,
        change_pricing: changePricing,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }

    if (isExternalApiQuotaError(error)) {
      return NextResponse.json(
        { success: false, error: '外部APIのクォータ上限に達しました。管理者設定を確認してください。' },
        { status: 429 }
      )
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
