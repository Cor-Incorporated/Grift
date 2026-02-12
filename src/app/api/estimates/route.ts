import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { estimateParamsSchema } from '@/lib/utils/validation'
import { getAuthenticatedUser, isAdminUser, canAccessProject } from '@/lib/auth/authorization'
import { buildProjectAttachmentContext } from '@/lib/source-analysis/project-context'
import { fetchActivePricingPolicy } from '@/lib/pricing/policies'
import { calculatePrice, type MarketAssumption } from '@/lib/pricing/engine'
import { buildEstimateEvidenceAppendix } from '@/lib/market/evidence-appendix'
import { writeAuditLog } from '@/lib/audit/log'
import { isExternalApiQuotaError } from '@/lib/usage/api-usage'
import type { EstimateMode, ProjectType } from '@/types/database'

function getEstimateMode(projectType: ProjectType): EstimateMode {
  switch (projectType) {
    case 'new_project':
      return 'market_comparison'
    case 'bug_report':
    case 'fix_request':
      return 'hours_only'
    case 'feature_addition':
      return 'hybrid'
  }
}

interface HoursEstimate {
  investigation: number
  implementation: number
  testing: number
  buffer: number
  total: number
  breakdown: string
}

async function estimateHoursWithClaude(
  specMarkdown: string,
  projectType: ProjectType,
  attachmentContext?: string,
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  }
): Promise<HoursEstimate> {
  const attachmentBlock = attachmentContext
    ? `\n\n添付資料解析の要約:\n${attachmentContext}`
    : ''
  const prompt = `あなたはシニアソフトウェアエンジニアです。以下の仕様書を読み、工数を見積もってください。

案件タイプ: ${projectType}

各フェーズの時間（時間単位）をJSON形式で返してください：
\`\`\`json
{
  "investigation": 調査・分析時間,
  "implementation": 実装時間,
  "testing": テスト時間,
  "buffer": バッファ時間,
  "total": 合計時間,
  "breakdown": "Markdown形式の工数内訳説明"
}
\`\`\`

バッファ率の目安:
- bug_report: 20-30%
- fix_request: 10-20%
- feature_addition: 15-25%
- new_project: 15-25%

制約:
- 回答は必ずJSONのみで返す
- total は各項目の合計と一致させる`

  const response = await sendMessage(prompt, [{ role: 'user', content: `${specMarkdown}${attachmentBlock}` }], {
    temperature: 0.2,
    maxTokens: 2048,
    usageContext,
  })

  const parsed = parseJsonFromResponse<Partial<HoursEstimate>>(response)

  const investigation = Math.max(0, Number(parsed.investigation ?? 0))
  const implementation = Math.max(0, Number(parsed.implementation ?? 0))
  const testing = Math.max(0, Number(parsed.testing ?? 0))
  const buffer = Math.max(0, Number(parsed.buffer ?? 0))
  const total = Number(parsed.total ?? investigation + implementation + testing + buffer)

  return {
    investigation,
    implementation,
    testing,
    buffer,
    total,
    breakdown:
      typeof parsed.breakdown === 'string' && parsed.breakdown.length > 0
        ? parsed.breakdown
        : '工数内訳の詳細は生成できませんでした。',
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

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validated = estimateParamsSchema.parse(body)

    const supabase = await createServiceRoleClient()

    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json(
        { success: false, error: '見積り生成は管理者のみ実行できます' },
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

    if (estimateMode === 'market_comparison' || estimateMode === 'hybrid') {
      const marketEvidence = await fetchMarketEvidenceFromXai({
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
        })
        .select('id, retrieved_at')
        .maybeSingle()

      marketEvidenceRecordId = savedEvidence?.id ?? null
      const appendix = buildEstimateEvidenceAppendix({
        citations: marketEvidence.citations,
        confidenceScore: marketEvidence.confidenceScore,
        summary: marketEvidence.evidence.summary,
        retrievedAt: savedEvidence?.retrieved_at ?? new Date().toISOString(),
      })

      evidenceAppendix = appendix as unknown as Record<string, unknown>
      evidenceRequirementMet = appendix.requirement.met
      evidenceSourceCount = appendix.requirement.unique_source_count
      evidenceBlockReason = appendix.requirement.reason

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

    const pricing = calculatePrice({
      policy,
      market: marketAssumption,
      selectedCoefficient: validated.coefficient,
    })
    const riskFlags = [...pricing.riskFlags]
    if (!evidenceRequirementMet) {
      riskFlags.push('insufficient_evidence_sources')
    }

    const hoursBasedCost = validated.your_hourly_rate * hours.total
    const recommendedTotalCost = Math.max(
      pricing.ourPrice,
      hoursBasedCost,
      policy.minimumProjectFee
    )

    const marketHours = marketData
      ? hours.total * (marketData.market_estimated_hours_multiplier ?? 1.8)
      : null
    const totalMarketCost = marketData
      ? marketData.market_hourly_rate * (marketHours ?? 0)
      : null

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
        similar_projects: null,
        pricing_snapshot: {
          policy,
          market_assumption: marketAssumption,
          calculated: pricing,
          recommended_total_cost: recommendedTotalCost,
          hours_based_cost: hoursBasedCost,
        },
        risk_flags: riskFlags,
        market_evidence_id: marketEvidenceRecordId,
        estimate_status: evidenceRequirementMet ? 'ready' : 'draft',
        evidence_requirement_met: evidenceRequirementMet,
        evidence_source_count: evidenceSourceCount,
        evidence_appendix: evidenceAppendix,
        evidence_block_reason: evidenceBlockReason,
      })
      .select()
      .single()

    if (estimateError || !estimate) {
      return NextResponse.json(
        { success: false, error: '見積りの保存に失敗しました' },
        { status: 500 }
      )
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
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        ...estimate,
        recommended_total_cost: recommendedTotalCost,
        blocked_by_evidence: !evidenceRequirementMet,
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
