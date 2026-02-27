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
import { estimateHours } from '@/lib/estimates/hours-estimator'
import { enrichSimilarProjectsWithHistory, buildHistoricalCalibration } from '@/lib/estimates/historical-calibration'
import { buildEvidenceContextBlock } from '@/lib/estimates/evidence-context-builder'
import { crossValidateEstimate } from '@/lib/estimates/cross-validate'
import { buildEmptyHistoricalCalibration } from '@/lib/estimates/evidence-bundle'
import { generateValueProposition, type ValueProposition } from '@/lib/estimates/value-proposition'
import { logger } from '@/lib/utils/logger'
import type { EstimateMode, ProjectType, BusinessLine } from '@/types/database'

const FALLBACK_HOURLY_RATE = 15000

function averageVelocityData(
  historicalRefs: Array<{ velocityData: Record<string, unknown> | null }>
): Record<string, unknown> | null {
  const refs = historicalRefs.filter((r) => r.velocityData !== null)
  if (refs.length === 0) return null
  if (refs.length === 1) return refs[0].velocityData

  const numericKeys = [
    'totalDevelopmentDays', 'totalCommits', 'commitsPerWeek',
    'contributorCount', 'coreContributors', 'estimatedHours',
    'velocityScore', 'totalAdditions', 'totalDeletions',
  ]

  const averaged: Record<string, unknown> = {}
  for (const key of numericKeys) {
    const values = refs
      .map((r) => r.velocityData?.[key])
      .filter((v): v is number => typeof v === 'number')

    if (values.length > 0) {
      averaged[key] = Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
    }
  }

  return averaged
}

function deriveHourlyRate(policy: { avgInternalCostPerMemberMonth: number }): number {
  // Derive hourly rate from policy's monthly internal cost
  // (monthly cost / 160 hours per month)
  const derived = Math.round(policy.avgInternalCostPerMemberMonth / 160)
  return derived > 0 ? derived : FALLBACK_HOURLY_RATE
}

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
  const hourlyRate = deriveHourlyRate(policy)

  // ═══════════════════════════════════════════════════════════
  // Phase 1: Evidence Gathering (parallel where possible)
  // ═══════════════════════════════════════════════════════════

  // 1a. Find similar projects (semantic) — uses Grok for profile extraction
  let similarProjects = await findSimilarProjects({
    supabase,
    specMarkdown,
    projectType,
    businessLine: input.businessLine ?? undefined,
    attachmentContext: attachmentContext || undefined,
    strategy: 'semantic',
    usageContext,
  })

  // Fallback: if semantic returned nothing, try keyword
  if (similarProjects.length === 0) {
    try {
      similarProjects = await findSimilarProjects({
        supabase,
        specMarkdown,
        projectType,
        businessLine: input.businessLine ?? undefined,
        attachmentContext: attachmentContext || undefined,
        strategy: 'keyword',
      })
    } catch {
      // Keyword fallback also failed — proceed with empty
    }
  }

  // 1b. Enrich similar projects with historical data (velocity, analysis_result, hours)
  let historicalCalibration = buildEmptyHistoricalCalibration()
  let historicalRefs: Awaited<ReturnType<typeof enrichSimilarProjectsWithHistory>> = []
  if (similarProjects.length > 0) {
    try {
      historicalRefs = await enrichSimilarProjectsWithHistory(supabase, similarProjects)
      historicalCalibration = buildHistoricalCalibration(historicalRefs)
    } catch (error) {
      logger.warn('Historical calibration failed', {
        error: error instanceof Error ? error.message : String(error),
        projectId,
      })
    }
  }

  // 1c. Code impact analysis BEFORE implementation plan (order fix)
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

  // 1d. Build evidence context block for AI prompts
  const evidenceContextBlock = buildEvidenceContextBlock({
    historicalCalibration,
    codeImpact,
  })

  // ═══════════════════════════════════════════════════════════
  // Phase 2: Evidence-Informed Estimation (parallel)
  // ═══════════════════════════════════════════════════════════

  // Market evidence vars
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

  // 2a + 2b: Hours estimation (Grok + evidence) and market evidence in parallel
  const needsMarketEvidence = estimateMode === 'market_comparison' || estimateMode === 'hybrid'

  const [hours, marketResult] = await Promise.all([
    // 2a. Hours estimation with evidence context (Grok)
    estimateHours(
      specMarkdown,
      projectType,
      attachmentContext || undefined,
      usageContext,
      evidenceContextBlock || undefined
    ),
    // 2b. Market evidence (Grok with web search) — conditional
    needsMarketEvidence
      ? fetchMarketEvidenceFromXai({
          projectType,
          context: attachmentContext
            ? `${specMarkdown}\n\n${attachmentContext}`
            : specMarkdown,
          usageContext,
        }).catch(() => null)
      : Promise.resolve(null),
  ])

  // Process market evidence result
  if (marketResult) {
    try {
      const marketEvidenceResolution = await resolveMarketEvidenceWithFallback({
        supabase,
        projectId,
        projectType,
        fetched: marketResult,
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
      // Market evidence processing failed — proceed without it
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Synthesis (cross-validation + planning)
  // ═══════════════════════════════════════════════════════════

  // 3a. Cross-validate estimate against historical data
  // Average velocity across all historical references instead of using only the first
  const velocityData = averageVelocityData(historicalRefs)

  const crossValidation = crossValidateEstimate({
    claudeHours: hours.total,
    historicalCalibration,
    velocityData,
  })

  // Use reconciled hours for pricing and downstream calculations
  const reconciledHours = crossValidation.reconciledHours

  // 3b. Pricing calculation (uses reconciled hours)
  const marketHours = marketData
    ? reconciledHours * (marketData.market_estimated_hours_multiplier ?? 1.8)
    : null
  const totalMarketCost = marketData
    ? marketData.market_hourly_rate * (marketHours ?? 0)
    : null

  const pricing = isHoursOnlyType(projectType) ? null : calculatePrice({
    policy,
    market: marketAssumption,
    selectedCoefficient: undefined,
    hourlyMarketTotal: totalMarketCost ?? undefined,
  })

  const riskFlags = [...(pricing?.riskFlags ?? [])]
  if (!evidenceRequirementMet) {
    riskFlags.push('insufficient_evidence_sources')
  }
  if (evidenceWarnings.length > 0) {
    riskFlags.push('market_evidence_fallback_used')
  }
  if (crossValidation.calibrationWarning) {
    riskFlags.push('estimate_calibration_warning')
  }

  // 3c. Implementation plan + speed advantage (parallel)
  let implementationPlan: ImplementationPlan | null = null
  if (projectType === 'new_project' || projectType === 'feature_addition') {
    try {
      implementationPlan = await generateImplementationPlan({
        specMarkdown,
        projectType,
        attachmentContext: attachmentContext || undefined,
        existingCodeAnalysis: codeImpact?.narrative,
        usageContext,
      })
    } catch {
      // Module decomposition failed — continue without it
    }
  }

  const speedAdvantage = calculateSpeedAdvantage({
    similarProjects,
    velocityData,
    marketTeamSize: marketAssumption.teamSize,
    marketDurationMonths: marketAssumption.durationMonths,
    ourHoursEstimate: reconciledHours,
    policy,
    historicalHours: historicalCalibration.avgActualHours ?? undefined,
  })

  // 3d. Go/No-Go evaluation (runs for hours_only too — profitability weight=0 via getWeights)
  let goNoGoResult: GoNoGoResult | null = null
  if (input.businessLine) {
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

  // 3e. Approval status
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

  const hoursBasedCost = isHoursOnlyType(projectType) ? null : hourlyRate * reconciledHours
  const recommendedTotalCost = isHoursOnlyType(projectType) || !pricing ? null : Math.max(
    pricing.ourPrice,
    hoursBasedCost ?? 0,
    policy.minimumProjectFee
  )

  // ═══════════════════════════════════════════════════════════
  // Phase 4: Value Proposition & Comparison Report
  // ═══════════════════════════════════════════════════════════

  let valueProp: ValueProposition | null = null
  let comparisonReport: string | null = null

  if (needsMarketEvidence && input.businessLine && pricing && goNoGoResult) {
    try {
      valueProp = await generateValueProposition({
        specMarkdown,
        similarProjects,
        goNoGoResult,
        pricingResult: pricing,
        businessLine: input.businessLine,
        implementationPlan,
        speedAdvantage,
        usageContext,
      })

      // Build comparison report from market data and pricing
      const marketTotal = pricing.marketTotal
      comparisonReport = [
        `## 市場比較レポート`,
        `- 市場平均価格: ¥${marketTotal.toLocaleString()}`,
        `- 当社見積価格: ¥${pricing.ourPrice.toLocaleString()}`,
        `- 削減率: ${marketTotal > 0 ? Math.round((1 - pricing.ourPrice / marketTotal) * 100) : 0}%`,
        `- 粗利率: ${pricing.marginPercent.toFixed(1)}%`,
        marketData ? `- 市場時間単価: ¥${marketData.market_hourly_rate.toLocaleString()}` : '',
        marketData ? `- 市場チーム規模: ${marketData.typical_team_size}名` : '',
        marketData ? `- 市場開発期間: ${marketData.typical_duration_months}ヶ月` : '',
      ].filter(Boolean).join('\n')
    } catch (error) {
      logger.warn('Value proposition generation failed', {
        error: error instanceof Error ? error.message : String(error),
        projectId,
      })
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DB Insert
  // ═══════════════════════════════════════════════════════════

  const evidenceBundleData = {
    historicalCalibration,
    codeImpact: codeImpact ? { narrative: codeImpact.narrative, impactScope: codeImpact.impactScope } : null,
    evidenceContextBlock,
    similarProjectCount: similarProjects.length,
    enrichedReferenceCount: historicalRefs.length,
  }

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
      your_estimated_hours: reconciledHours,
      hours_investigation: hours.investigation,
      hours_implementation: hours.implementation,
      hours_testing: hours.testing,
      hours_buffer: hours.buffer,
      hours_breakdown_report: hours.breakdown,
      market_hourly_rate: marketData?.market_hourly_rate ?? null,
      market_estimated_hours: marketHours,
      multiplier: marketData?.market_estimated_hours_multiplier ?? 1.5,
      total_market_cost: totalMarketCost,
      comparison_report: comparisonReport,
      grok_market_data: marketData,
      similar_projects: similarProjects.length > 0 ? similarProjects : null,
      go_no_go_result: goNoGoResult,
      value_proposition: valueProp as unknown as Record<string, unknown> | null,
      pricing_snapshot: isHoursOnlyType(projectType)
        ? { hours_only: true, hourly_rate: hourlyRate, total_hours: reconciledHours }
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
      evidence_bundle: evidenceBundleData,
      calibration_ratio: crossValidation.calibrationRatio,
      historical_citations: historicalCalibration.citationText
        ? { text: historicalCalibration.citationText, references: historicalCalibration.references.map((r) => ({ repo: r.repoFullName, hours: r.hoursSpent, score: r.matchScore })) }
        : null,
      cross_validation: crossValidation,
    })
    .select()
    .single()

  if (estimateError || !estimate) {
    throw new Error('見積りの自動保存に失敗しました')
  }

  const { error: versionError } = await supabase
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

  if (versionError) {
    logger.warn('estimate_versions insert failed', {
      estimateId: estimate.id,
      projectId,
      error: versionError.message,
    })
  }

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
        totalHours: reconciledHours,
        rawClaudeHours: hours.total,
        calibrationRatio: crossValidation.calibrationRatio,
        historicalDataUsed: historicalCalibration.hasReliableData,
        hourlyRate,
      },
    })
  }

  return {
    estimateId: estimate.id,
    totalHours: reconciledHours,
    hourlyRate,
    estimateMode,
    goNoGoDecision: goNoGoResult?.decision,
  }
}
