import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { resolveMarketEvidenceWithFallback } from '@/lib/market/evidence-fallback'
import { fetchActivePricingPolicy } from '@/lib/pricing/policies'
import { calculatePrice, type MarketAssumption } from '@/lib/pricing/engine'
import { buildEstimateEvidenceAppendix } from '@/lib/market/evidence-appendix'
import {
  buildApprovalTriggersFromRiskFlags,
  deriveApprovalStatus,
  resolveEstimateStatus,
} from '@/lib/approval/gate'
import { writeAuditLog } from '@/lib/audit/log'
import { findSimilarProjects } from '@/lib/estimates/similar-projects'
import { evaluateGoNoGo, type GoNoGoResult } from '@/lib/approval/go-no-go'
import { generateImplementationPlan, type ImplementationPlan } from '@/lib/estimates/module-decomposition'
import { analyzeCodeImpact, type CodeImpactAnalysis } from '@/lib/estimates/code-impact-analysis'
import { calculateSpeedAdvantage } from '@/lib/estimates/speed-advantage'
import { estimateHoursWithClaude } from '@/lib/estimates/hours-estimator'
import type { EstimateMode, ProjectType, BusinessLine } from '@/types/database'

const DEFAULT_HOURLY_RATE = 15000

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

interface AutoGenerateEstimateInput {
  supabase: SupabaseClient
  projectId: string
  projectType: ProjectType
  specMarkdown: string
  attachmentContext?: string | null
  businessLine?: BusinessLine | null
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  }
}

interface AutoGenerateEstimateResult {
  estimateId: string
  totalHours: number
  hourlyRate: number
  estimateMode: EstimateMode
  goNoGoDecision?: string
}

export async function autoGenerateEstimate(
  input: AutoGenerateEstimateInput
): Promise<AutoGenerateEstimateResult> {
  const { supabase, projectId, projectType, specMarkdown, attachmentContext, usageContext } = input

  const estimateMode = getEstimateMode(projectType)
  const policy = await fetchActivePricingPolicy(supabase, projectType)

  const hours = await estimateHoursWithClaude(
    specMarkdown,
    projectType,
    attachmentContext || undefined,
    usageContext
  )

  const hourlyRate = DEFAULT_HOURLY_RATE

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
    try {
      const fetchedMarketEvidence = await fetchMarketEvidenceFromXai({
        projectType,
        context: attachmentContext
          ? `${specMarkdown}\n\n${attachmentContext}`
          : specMarkdown,
        usageContext,
      })
      const marketEvidenceResolution = await resolveMarketEvidenceWithFallback({
        supabase,
        projectId,
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
          project_id: projectId,
          project_type: projectType,
          source: 'xai',
          query: specMarkdown.slice(0, 4000),
          summary: marketEvidence.evidence.summary,
          data: marketEvidence.evidence,
          citations: marketEvidence.citations,
          confidence_score: marketEvidence.confidenceScore,
          usage: marketEvidence.usage,
          created_by_clerk_user_id: usageContext?.actorClerkUserId ?? null,
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
    } catch {
      // Market evidence fetch failed — proceed with hours-only estimate
    }
  }

  const pricing = isHoursOnlyType(projectType) ? null : calculatePrice({
    policy,
    market: marketAssumption,
    selectedCoefficient: undefined,
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
    specMarkdown,
    projectType,
    businessLine: input.businessLine ?? undefined,
    attachmentContext: attachmentContext || undefined,
  })

  // Fetch velocity data for best matching similar project
  let velocityData: Record<string, unknown> | null = null
  if (similarProjects.length > 0) {
    const { data: velocityRef } = await supabase
      .from('github_references')
      .select('velocity_data')
      .eq('id', similarProjects[0].githubReferenceId)
      .maybeSingle()
    velocityData = velocityRef?.velocity_data ?? null
  }

  // Module decomposition (for new_project / feature_addition)
  let implementationPlan: ImplementationPlan | null = null
  if (projectType === 'new_project' || projectType === 'feature_addition') {
    try {
      implementationPlan = await generateImplementationPlan({
        specMarkdown,
        projectType,
        attachmentContext: attachmentContext || undefined,
        usageContext,
      })
    } catch {
      // Module decomposition failed — continue without it
    }
  }

  // Code impact analysis (if attachment context available)
  let codeImpact: CodeImpactAnalysis | null = null
  if (attachmentContext) {
    try {
      codeImpact = await analyzeCodeImpact({
        repoAnalysis: attachmentContext,
        specMarkdown,
        projectType,
        usageContext,
      })
    } catch {
      // Code impact analysis failed — continue without it
    }
  }

  // Speed advantage calculation
  const speedAdvantage = calculateSpeedAdvantage({
    similarProjects,
    velocityData,
    marketTeamSize: marketAssumption.teamSize,
    marketDurationMonths: marketAssumption.durationMonths,
    ourHoursEstimate: hours.total,
    policy,
  })

  // Evaluate Go/No-Go
  let goNoGoResult: GoNoGoResult | null = null
  if (input.businessLine && pricing) {
    goNoGoResult = await evaluateGoNoGo({
      supabase,
      projectId,
      projectType,
      businessLine: input.businessLine,
      pricingResult: pricing,
      specMarkdown,
      riskFlags,
    })
  }

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

  const hoursBasedCost = isHoursOnlyType(projectType) ? null : hourlyRate * hours.total
  const recommendedTotalCost = isHoursOnlyType(projectType) ? null : Math.max(
    pricing!.ourPrice,
    hoursBasedCost!,
    policy.minimumProjectFee
  )

  const marketHours = marketData
    ? hours.total * (marketData.market_estimated_hours_multiplier ?? 1.8)
    : null
  const totalMarketCost = marketData
    ? marketData.market_hourly_rate * (marketHours ?? 0)
    : null

  const { data: estimate, error: estimateError } = await supabase
    .from('estimates')
    .insert({
      project_id: projectId,
      estimate_mode: estimateMode,
      estimate_status: statusDecision.estimateStatus === 'ready' ? 'draft' : statusDecision.estimateStatus,
      approval_required: approvalRequired,
      approval_status: approvalStatus,
      approval_block_reason: statusDecision.approvalBlockReason,
      evidence_requirement_met: evidenceRequirementMet,
      evidence_source_count: evidenceSourceCount,
      evidence_appendix: evidenceAppendix,
      evidence_block_reason: evidenceBlockReason,
      your_hourly_rate: hourlyRate,
      your_estimated_hours: hours.total,
      hours_investigation: hours.investigation,
      hours_implementation: hours.implementation,
      hours_testing: hours.testing,
      hours_buffer: hours.buffer,
      hours_breakdown_report: hours.breakdown,
      market_hourly_rate: marketData?.market_hourly_rate ?? null,
      market_estimated_hours: marketHours,
      multiplier: 1.5,
      total_market_cost: totalMarketCost,
      comparison_report: null,
      grok_market_data: marketData,
      similar_projects: similarProjects.length > 0 ? similarProjects : null,
      go_no_go_result: goNoGoResult,
      value_proposition: null,
      pricing_snapshot: isHoursOnlyType(projectType)
        ? { hours_only: true, hourly_rate: hourlyRate, total_hours: hours.total }
        : {
            policy,
            market_assumption: marketAssumption,
            calculated: pricing,
            recommended_total_cost: recommendedTotalCost,
            hours_based_cost: hoursBasedCost,
            implementation_plan: implementationPlan,
            code_impact: codeImpact,
            speed_advantage: speedAdvantage,
          },
      risk_flags: riskFlags,
      market_evidence_id: marketEvidenceRecordId,
    })
    .select()
    .single()

  if (estimateError || !estimate) {
    throw new Error('見積りの自動保存に失敗しました')
  }

  await supabase
    .from('estimate_versions')
    .insert({
      estimate_id: estimate.id,
      project_id: projectId,
      change_request_id: null,
      version: 1,
      version_type: 'initial',
      snapshot: estimate,
      created_by_clerk_user_id: usageContext?.actorClerkUserId ?? null,
    })

  if (usageContext?.actorClerkUserId) {
    await writeAuditLog(supabase, {
      actorClerkUserId: usageContext.actorClerkUserId,
      action: 'estimate.auto_generate',
      resourceType: 'estimate',
      resourceId: estimate.id,
      projectId,
      payload: {
        estimateMode,
        riskFlags,
        recommendedTotalCost,
        evidenceRequirementMet,
        approvalRequired,
        totalHours: hours.total,
        hourlyRate,
      },
    })
  }

  return {
    estimateId: estimate.id,
    totalHours: hours.total,
    hourlyRate,
    estimateMode,
    goNoGoDecision: goNoGoResult?.decision,
  }
}
