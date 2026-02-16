import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessLine, ProjectType } from '@/types/database'
import type { PriceCalculationResult } from '@/lib/pricing/engine'

export type GoNoGoDecision = 'go' | 'go_with_conditions' | 'no_go'

export interface GoNoGoScore {
  profitability: { score: number; details: string }
  strategicAlignment: { score: number; businessLine: BusinessLine; details: string }
  capacity: { score: number; activeProjectCount: number; details: string }
  technicalRisk: { score: number; details: string }
}

export interface GoNoGoResult {
  decision: GoNoGoDecision
  scores: GoNoGoScore
  overallScore: number
  conditions: string[]
  reasoning: string
}

interface EvaluateGoNoGoInput {
  supabase: SupabaseClient
  projectId: string
  projectType: ProjectType
  businessLine: BusinessLine
  pricingResult: PriceCalculationResult | null
  specMarkdown: string
  riskFlags: string[]
}

function scoreProfitability(pricingResult: PriceCalculationResult): {
  score: number
  details: string
} {
  const { marginPercent, ourPrice, costFloor } = pricingResult

  if (ourPrice <= costFloor) {
    return {
      score: 0,
      details: `見積価格(¥${ourPrice.toLocaleString()})が原価下限(¥${costFloor.toLocaleString()})を下回っています`,
    }
  }

  const score = Math.min(100, marginPercent * 5)
  const details = marginPercent >= 20
    ? `粗利率${marginPercent.toFixed(1)}%で健全な収益性`
    : `粗利率${marginPercent.toFixed(1)}%で最低基準(20%)を下回り`

  return { score, details }
}

function scoreStrategicAlignment(
  businessLine: BusinessLine,
  projectType: ProjectType
): { score: number; businessLine: BusinessLine; details: string } {
  const coreAlignmentMap: Record<BusinessLine, Record<string, number>> = {
    boltsite: {
      new_project: 90,
      feature_addition: 80,
      fix_request: 70,
      bug_report: 60,
      undetermined: 50,
    },
    iotrealm: {
      new_project: 95,
      feature_addition: 85,
      fix_request: 75,
      bug_report: 65,
      undetermined: 60,
    },
    tapforge: {
      new_project: 85,
      feature_addition: 75,
      fix_request: 65,
      bug_report: 55,
      undetermined: 45,
    },
  }

  const score = coreAlignmentMap[businessLine]?.[projectType] ?? 50
  const details = score >= 70
    ? `${businessLine}事業の${projectType}案件として高い適合性`
    : `${businessLine}事業の${projectType}案件として中程度の適合性`

  return { score, businessLine, details }
}

async function scoreCapacity(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ score: number; activeProjectCount: number; details: string }> {
  const { count, error } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .in('status', ['interviewing', 'analyzing', 'estimating'])
    .neq('id', projectId)

  if (error) {
    return {
      score: 50,
      activeProjectCount: -1,
      details: 'キャパシティ情報の取得に失敗しました',
    }
  }

  const activeCount = count ?? 0

  if (activeCount <= 2) {
    return {
      score: 100,
      activeProjectCount: activeCount,
      details: `アクティブ案件${activeCount}件：十分なキャパシティあり`,
    }
  }

  if (activeCount <= 4) {
    return {
      score: Math.max(30, 100 - (activeCount - 2) * 25),
      activeProjectCount: activeCount,
      details: `アクティブ案件${activeCount}件：キャパシティ注意`,
    }
  }

  return {
    score: Math.max(10, 100 - activeCount * 15),
    activeProjectCount: activeCount,
    details: `アクティブ案件${activeCount}件：キャパシティ逼迫`,
  }
}

function scoreTechnicalRisk(
  specMarkdown: string,
  riskFlags: string[]
): { score: number; details: string } {
  let riskPoints = 0

  riskPoints += riskFlags.length * 15

  const uncertainTerms = ['未定', '要調査', '要確認', 'tbd', '検討中', '未決定']
  const specLower = specMarkdown.toLowerCase()
  const uncertainCount = uncertainTerms.reduce(
    (count, term) => count + (specLower.split(term).length - 1),
    0
  )
  riskPoints += uncertainCount * 5

  const score = Math.max(0, 100 - riskPoints)
  const details = score >= 70
    ? `技術リスク低（リスクフラグ${riskFlags.length}件、未確定事項${uncertainCount}件）`
    : score >= 40
      ? `技術リスク中（リスクフラグ${riskFlags.length}件、未確定事項${uncertainCount}件）`
      : `技術リスク高（リスクフラグ${riskFlags.length}件、未確定事項${uncertainCount}件）`

  return { score, details }
}

function getWeights(projectType: ProjectType) {
  if (projectType === 'bug_report' || projectType === 'fix_request') {
    return { profitability: 0, strategicAlignment: 0.2, capacity: 0.45, technicalRisk: 0.35 }
  }
  return { profitability: 0.35, strategicAlignment: 0.25, capacity: 0.2, technicalRisk: 0.2 }
}

export async function evaluateGoNoGo(
  input: EvaluateGoNoGoInput
): Promise<GoNoGoResult> {
  const profitability = input.pricingResult
    ? scoreProfitability(input.pricingResult)
    : { score: 100, details: 'バグ修正：保証期間内のため収益性評価はスキップ' }
  const strategicAlignment = scoreStrategicAlignment(
    input.businessLine,
    input.projectType
  )
  const capacity = await scoreCapacity(input.supabase, input.projectId)
  const technicalRisk = scoreTechnicalRisk(input.specMarkdown, input.riskFlags)

  const weights = getWeights(input.projectType)

  const overallScore = Math.round(
    profitability.score * weights.profitability +
    strategicAlignment.score * weights.strategicAlignment +
    capacity.score * weights.capacity +
    technicalRisk.score * weights.technicalRisk
  )

  const conditions: string[] = []

  if (profitability.score < 50) {
    conditions.push('収益性の改善が必要（価格調整または工数削減）')
  }
  if (capacity.score < 50) {
    conditions.push('チームキャパシティの確保が必要（既存案件の完了待ちまたはリソース追加）')
  }
  if (technicalRisk.score < 50) {
    conditions.push('技術リスクの低減が必要（未確定事項の解消またはPoCの実施）')
  }
  if (strategicAlignment.score < 50) {
    conditions.push('事業戦略との整合性を再確認')
  }

  let decision: GoNoGoDecision
  if (overallScore >= 70) {
    decision = 'go'
  } else if (overallScore >= 40) {
    decision = 'go_with_conditions'
  } else {
    decision = 'no_go'
  }

  const reasoning = [
    `総合スコア: ${overallScore}/100`,
    `収益性: ${profitability.score}/100 - ${profitability.details}`,
    `戦略適合性: ${strategicAlignment.score}/100 - ${strategicAlignment.details}`,
    `キャパシティ: ${capacity.score}/100 - ${capacity.details}`,
    `技術リスク: ${technicalRisk.score}/100 - ${technicalRisk.details}`,
  ].join('\n')

  return {
    decision,
    scores: {
      profitability,
      strategicAlignment,
      capacity,
      technicalRisk,
    },
    overallScore,
    conditions,
    reasoning,
  }
}
