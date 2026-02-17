import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { estimateHoursWithClaude } from '@/lib/estimates/hours-estimator'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { resolveMarketEvidenceWithFallback } from '@/lib/market/evidence-fallback'
import { estimateParamsSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import {
  canAccessProject,
  getAuthenticatedUser,
  getInternalRoles,
} from '@/lib/auth/authorization'
import { buildProjectAttachmentContext } from '@/lib/source-analysis/project-context'
import { fetchActivePricingPolicy } from '@/lib/pricing/policies'
import { calculatePrice, type MarketAssumption } from '@/lib/pricing/engine'
import { buildEstimateEvidenceAppendix } from '@/lib/market/evidence-appendix'
import {
  buildApprovalTriggersFromRiskFlags,
  deriveApprovalStatus,
  resolveEstimateStatus,
} from '@/lib/approval/gate'
import { ensureApprovalRequests } from '@/lib/approval/requests'
import { writeAuditLog } from '@/lib/audit/log'
import { isExternalApiQuotaError } from '@/lib/usage/api-usage'
import { findSimilarProjects } from '@/lib/estimates/similar-projects'
import { calculateSpeedAdvantage } from '@/lib/estimates/speed-advantage'
import type { EstimateMode, ProjectType } from '@/types/database'

function isHoursOnlyType(projectType: ProjectType): boolean {
  return projectType === 'bug_report' || projectType === 'fix_request'
}

function getEstimateMode(projectType: ProjectType): EstimateMode {
  switch (projectType) {
    case 'new_project':
    case 'undetermined':
      return 'market_comparison'
    case 'bug_report':
    case 'fix_request':
      return 'hours_only'
    case 'feature_addition':
      return 'hybrid'
  }
}

function buildComparisonReport(params: {
  hourlyRate: number
  hoursTotal: number
  totalMarketCost: number | null
  marketHours: number | null
  marketHourlyRate: number | null
  summary: string
  citations: { url: string }[]
}): string | null {
  if (!params.totalMarketCost || !params.marketHours || !params.marketHourlyRate) {
    return null
  }

  const yourTotalCost = params.hourlyRate * params.hoursTotal
  const diff = params.totalMarketCost - yourTotalCost
  const reduction = params.totalMarketCost > 0
    ? Math.round((diff / params.totalMarketCost) * 100)
    : 0

  const citationLines = params.citations.length > 0
    ? params.citations.slice(0, 5).map((citation, index) => `${index + 1}. ${citation.url}`).join('\n')
    : '引用URLは取得できませんでした。'

  return `# 市場比較レポート

## あなたの見積り
- 時給: ¥${params.hourlyRate.toLocaleString()}
- 推定工数: ${params.hoursTotal}時間
- **合計: ¥${yourTotalCost.toLocaleString()}**

## 市場平均の見積り
- 市場平均時給: ¥${params.marketHourlyRate.toLocaleString()}
- 市場推定工数: ${params.marketHours.toFixed(1)}時間
- **合計: ¥${params.totalMarketCost.toLocaleString()}**

## コスト比較
- **差額: ¥${diff.toLocaleString()}**
- **削減率: ${reduction}%**

## 市場概況
${params.summary}

## 引用ソース
${citationLines}
`
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(request, 'estimates:get', RATE_LIMITS['estimates:get'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const projectId = request.nextUrl.searchParams.get('project_id')
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'project_id は必須です' },
        { status: 400 }
      )
    }

    const supabase = await createServiceRoleClient()

    const hasAccess = await canAccessProject(
      supabase,
      projectId,
      authUser.clerkUserId,
      authUser.email
    )
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'このプロジェクトにアクセスできません' },
        { status: 403 }
      )
    }

    const internalRoles = await getInternalRoles(
      supabase,
      authUser.clerkUserId,
      authUser.email
    )

    const { data: estimates, error: fetchError } = await supabase
      .from('estimates')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (fetchError) {
      return NextResponse.json(
        { success: false, error: '見積りの取得に失敗しました' },
        { status: 500 }
      )
    }

    const isInternal = internalRoles.size > 0
    const sanitizedEstimates = isInternal
      ? estimates
      : (estimates ?? []).map((estimate) => ({
          ...estimate,
          pricing_snapshot: null,
          risk_flags: null,
          grok_market_data: null,
        }))

    return NextResponse.json({
      success: true,
      data: sanitizedEstimates,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'サーバーエラー'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(request, 'estimates:post', RATE_LIMITS['estimates:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validated = estimateParamsSchema.parse(body)

    const supabase = await createServiceRoleClient()

    const internalRoles = await getInternalRoles(
      supabase,
      authUser.clerkUserId,
      authUser.email
    )
    if (!internalRoles.has('admin') && !internalRoles.has('sales')) {
      return NextResponse.json(
        { success: false, error: '見積り生成は管理者または営業ロールのみ実行できます' },
        { status: 403 }
      )
    }

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

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', validated.project_id)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: '案件が見つかりません' },
        { status: 404 }
      )
    }

    if (!project.spec_markdown) {
      return NextResponse.json(
        { success: false, error: '仕様書が生成されていません' },
        { status: 400 }
      )
    }

    const projectType = project.type as ProjectType
    const estimateMode = getEstimateMode(projectType)

    const [attachmentContext, policy] = await Promise.all([
      buildProjectAttachmentContext(supabase, project.id),
      fetchActivePricingPolicy(supabase, projectType),
    ])
    const hours = await estimateHoursWithClaude(
      project.spec_markdown,
      projectType,
      attachmentContext || undefined,
      {
        projectId: project.id,
        actorClerkUserId: authUser.clerkUserId,
      }
    )

    let marketEvidenceRecordId: string | null = null
    let marketData: {
      market_hourly_rate: number
      market_rate_range: { min: number; max: number }
      market_estimated_hours_multiplier: number
      trends: string[]
      risks: string[]
      summary: string
      typical_team_size: number
      typical_duration_months: number
      monthly_unit_price: number
      confidence_score: number
      citations: Array<{ url: string; type: string }>
    } | null = null

    let marketAssumption: MarketAssumption = {
      teamSize: policy.defaultTeamSize,
      durationMonths: policy.defaultDurationMonths,
      monthlyUnitPrice: policy.avgInternalCostPerMemberMonth,
    }
    let evidenceAppendix: Record<string, unknown> | null = null
    let evidenceRequirementMet = true
    let evidenceSourceCount: number | null = null
    let evidenceBlockReason: string | null = null
    let evidenceWarnings: string[] = []

    if (estimateMode === 'market_comparison' || estimateMode === 'hybrid') {
      const fetchedMarketEvidence = await fetchMarketEvidenceFromXai({
        projectType,
        context: attachmentContext
          ? `${project.spec_markdown}\n\n${attachmentContext}`
          : project.spec_markdown,
        region: validated.region,
        usageContext: {
          projectId: project.id,
          actorClerkUserId: authUser.clerkUserId,
        },
      })
      const marketEvidenceResolution = await resolveMarketEvidenceWithFallback({
        supabase,
        projectId: project.id,
        projectType,
        fetched: fetchedMarketEvidence,
      })
      const marketEvidence = marketEvidenceResolution.result

      marketAssumption = {
        teamSize: marketEvidence.evidence.typicalTeamSize,
        durationMonths: marketEvidence.evidence.typicalDurationMonths,
        monthlyUnitPrice: marketEvidence.evidence.monthlyUnitPrice,
      }

      const { data: savedEvidence } = await supabase
        .from('market_evidence')
        .insert({
          project_id: project.id,
          project_type: projectType,
          source: 'xai',
          query: project.spec_markdown.slice(0, 4000),
          summary: marketEvidence.evidence.summary,
          data: marketEvidence.evidence,
          citations: marketEvidence.citations,
          confidence_score: marketEvidence.confidenceScore,
          usage: marketEvidence.usage,
          created_by_clerk_user_id: authUser.clerkUserId,
          retrieved_at: marketEvidenceResolution.sourceRetrievedAt,
        })
        .select('id, retrieved_at')
        .maybeSingle()

      marketEvidenceRecordId = savedEvidence?.id ?? null
      const appendix = buildEstimateEvidenceAppendix({
        citations: marketEvidence.citations,
        confidenceScore: marketEvidence.confidenceScore,
        summary: marketEvidence.evidence.summary,
        retrievedAt:
          savedEvidence?.retrieved_at
          ?? marketEvidenceResolution.sourceRetrievedAt
          ?? new Date().toISOString(),
        warnings: marketEvidenceResolution.warning ? [marketEvidenceResolution.warning] : [],
      })

      evidenceAppendix = appendix as unknown as Record<string, unknown>
      evidenceRequirementMet = appendix.requirement.met
      evidenceSourceCount = appendix.requirement.unique_source_count
      evidenceBlockReason = appendix.requirement.reason
      evidenceWarnings = appendix.warnings

      marketData = {
        market_hourly_rate: marketEvidence.evidence.marketHourlyRate,
        market_rate_range: marketEvidence.evidence.marketRateRange,
        market_estimated_hours_multiplier:
          marketEvidence.evidence.marketEstimatedHoursMultiplier,
        trends: marketEvidence.evidence.trends,
        risks: marketEvidence.evidence.risks,
        summary: marketEvidence.evidence.summary,
        typical_team_size: marketEvidence.evidence.typicalTeamSize,
        typical_duration_months: marketEvidence.evidence.typicalDurationMonths,
        monthly_unit_price: marketEvidence.evidence.monthlyUnitPrice,
        confidence_score: marketEvidence.confidenceScore,
        citations: marketEvidence.citations.map((citation) => ({
          url: citation.url,
          type: citation.type,
        })),
      }
    }

    // Calculate hourly-based market total first (for accurate pricing)
    const marketHours = marketData
      ? hours.total * (marketData.market_estimated_hours_multiplier ?? 1.8)
      : null
    const totalMarketCost = marketData
      ? marketData.market_hourly_rate * (marketHours ?? 0)
      : null

    const pricing = isHoursOnlyType(projectType) ? null : calculatePrice({
      policy,
      market: marketAssumption,
      selectedCoefficient: validated.coefficient,
      hourlyMarketTotal: totalMarketCost ?? undefined,
    })
    const riskFlags = [...(pricing?.riskFlags ?? [])]
    if (!evidenceRequirementMet) {
      riskFlags.push('insufficient_evidence_sources')
    }
    if (evidenceWarnings.length > 0) {
      riskFlags.push('market_evidence_fallback_used')
    }

    // Find similar projects
    const similarProjects = await findSimilarProjects({
      supabase,
      specMarkdown: project.spec_markdown,
      projectType,
      attachmentContext: attachmentContext || undefined,
    })

    // Speed advantage calculation
    const speedAdvantage = !isHoursOnlyType(projectType) ? calculateSpeedAdvantage({
      similarProjects,
      velocityData: null,
      marketTeamSize: marketAssumption.teamSize,
      marketDurationMonths: marketAssumption.durationMonths,
      ourHoursEstimate: hours.total,
      policy,
    }) : null

    const approvalTriggers = buildApprovalTriggersFromRiskFlags({
      riskFlags,
      projectType,
      pricingContext: pricing ? {
        market_total: pricing.marketTotal,
        our_price: pricing.ourPrice,
        cost_floor: pricing.costFloor,
        margin_percent: pricing.marginPercent,
      } : undefined,
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

    const hoursBasedCost = isHoursOnlyType(projectType) ? null : validated.your_hourly_rate * hours.total
    const recommendedTotalCost = isHoursOnlyType(projectType) ? null : Math.max(
      pricing!.ourPrice,
      hoursBasedCost!,
      policy.minimumProjectFee
    )

    const comparisonReport = buildComparisonReport({
      hourlyRate: validated.your_hourly_rate,
      hoursTotal: hours.total,
      totalMarketCost,
      marketHours,
      marketHourlyRate: marketData?.market_hourly_rate ?? null,
      summary: marketData?.summary ?? '',
      citations:
        marketData?.citations?.map((citation) => ({ url: citation.url })) ?? [],
    })

    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .insert({
        project_id: validated.project_id,
        estimate_mode: estimateMode,
        estimate_status: statusDecision.estimateStatus,
        approval_required: approvalRequired,
        approval_status: approvalStatus,
        approval_block_reason: statusDecision.approvalBlockReason,
        evidence_requirement_met: evidenceRequirementMet,
        evidence_source_count: evidenceSourceCount,
        evidence_appendix: evidenceAppendix,
        evidence_block_reason: evidenceBlockReason,
        your_hourly_rate: validated.your_hourly_rate,
        your_estimated_hours: hours.total,
        hours_investigation: hours.investigation,
        hours_implementation: hours.implementation,
        hours_testing: hours.testing,
        hours_buffer: hours.buffer,
        hours_breakdown_report: hours.breakdown,
        market_hourly_rate: marketData?.market_hourly_rate ?? null,
        market_estimated_hours: marketHours,
        multiplier: validated.multiplier,
        total_market_cost: totalMarketCost,
        comparison_report: comparisonReport,
        grok_market_data: marketData,
        similar_projects: similarProjects.length > 0 ? similarProjects : null,
        go_no_go_result: null,
        value_proposition: null,
        pricing_snapshot: isHoursOnlyType(projectType)
          ? { hours_only: true, hourly_rate: validated.your_hourly_rate, total_hours: hours.total }
          : {
              policy,
              market_assumption: marketAssumption,
              calculated: pricing,
              recommended_total_cost: recommendedTotalCost,
              hours_based_cost: hoursBasedCost,
              speed_advantage: speedAdvantage,
            },
        risk_flags: riskFlags,
        market_evidence_id: marketEvidenceRecordId,
      })
      .select()
      .single()

    if (estimateError || !estimate) {
      return NextResponse.json(
        { success: false, error: '見積りの保存に失敗しました' },
        { status: 500 }
      )
    }

    if (approvalRequired) {
      const ensured = await ensureApprovalRequests({
        supabase,
        projectId: estimate.project_id,
        estimateId: estimate.id,
        actorClerkUserId: authUser.clerkUserId,
        triggers: approvalTriggers,
      })

      await writeAuditLog(supabase, {
        actorClerkUserId: authUser.clerkUserId,
        action: 'estimate.approval_gate_enabled',
        resourceType: 'estimate',
        resourceId: estimate.id,
        projectId: estimate.project_id,
        payload: {
          triggerCount: approvalTriggers.length,
          createdApprovalRequestCount: ensured.createdIds.length,
        },
      })
    }

    await supabase
      .from('estimate_versions')
      .insert({
        estimate_id: estimate.id,
        project_id: estimate.project_id,
        change_request_id: null,
        version: 1,
        version_type: 'initial',
        snapshot: estimate,
        created_by_clerk_user_id: authUser.clerkUserId,
      })

    await supabase
      .from('projects')
      .update({ status: 'estimating' })
      .eq('id', validated.project_id)

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'estimate.create',
      resourceType: 'estimate',
      resourceId: estimate.id,
      projectId: estimate.project_id,
      payload: {
        estimateMode,
        riskFlags,
        recommendedTotalCost,
        evidenceRequirementMet,
        evidenceSourceCount,
        approvalRequired,
        approvalStatus,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        ...estimate,
        recommended_total_cost: recommendedTotalCost,
        blocked_by_evidence: !evidenceRequirementMet,
        blocked_by_approval: approvalRequired,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        { success: false, error: '入力データが不正です' },
        { status: 400 }
      )
    }

    if (isExternalApiQuotaError(error)) {
      return NextResponse.json(
        { success: false, error: '外部APIのクォータ上限に達しました。設定をご確認ください。' },
        { status: 429 }
      )
    }

    const message = error instanceof Error ? error.message : 'サーバーエラー'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
