import type { SimilarProject } from '@/lib/estimates/similar-projects'
import type { PricingPolicy } from '@/lib/pricing/engine'

export interface SpeedAdvantage {
  hasHistoricalData: boolean
  similarProject?: {
    name: string
    totalDevelopmentWeeks: number
    teamSize: number
    commitsPerWeek: number
    techStackOverlap: string[]
  }
  marketEstimate: {
    durationMonths: number
    teamSize: number
    totalHours: number
  }
  ourEstimate: {
    durationMonths: number
    teamSize: number
    totalHours: number
  }
  speedMultiplier: number
  durationSavingsPercent: number
  narrative: string
  evidencePoints: string[]
}

interface VelocityDataShape {
  totalDevelopmentDays?: number
  totalCommits?: number
  commitsPerWeek?: number
  contributorCount?: number
  coreContributors?: number
  estimatedHours?: number
  velocityScore?: number
  totalAdditions?: number
  totalDeletions?: number
}

interface CalculateSpeedAdvantageInput {
  similarProjects: SimilarProject[]
  velocityData?: Record<string, unknown> | null
  marketTeamSize: number
  marketDurationMonths: number
  ourHoursEstimate: number
  policy: PricingPolicy
}

const HOURS_PER_MEMBER_MONTH = 160

function extractVelocityData(
  raw: Record<string, unknown> | null | undefined
): VelocityDataShape | null {
  if (!raw) return null
  return {
    totalDevelopmentDays: typeof raw.totalDevelopmentDays === 'number'
      ? raw.totalDevelopmentDays
      : undefined,
    totalCommits: typeof raw.totalCommits === 'number'
      ? raw.totalCommits
      : undefined,
    commitsPerWeek: typeof raw.commitsPerWeek === 'number'
      ? raw.commitsPerWeek
      : undefined,
    contributorCount: typeof raw.contributorCount === 'number'
      ? raw.contributorCount
      : undefined,
    coreContributors: typeof raw.coreContributors === 'number'
      ? raw.coreContributors
      : undefined,
    estimatedHours: typeof raw.estimatedHours === 'number'
      ? raw.estimatedHours
      : undefined,
    velocityScore: typeof raw.velocityScore === 'number'
      ? raw.velocityScore
      : undefined,
    totalAdditions: typeof raw.totalAdditions === 'number'
      ? raw.totalAdditions
      : undefined,
    totalDeletions: typeof raw.totalDeletions === 'number'
      ? raw.totalDeletions
      : undefined,
  }
}

function buildSimilarProjectField(
  project: SimilarProject,
  velocity: VelocityDataShape | null
): SpeedAdvantage['similarProject'] | undefined {
  if (!velocity) return undefined

  const totalDevelopmentWeeks = velocity.totalDevelopmentDays
    ? Math.round((velocity.totalDevelopmentDays / 7) * 10) / 10
    : 0

  return {
    name: project.repoFullName,
    totalDevelopmentWeeks,
    teamSize: velocity.contributorCount ?? 1,
    commitsPerWeek: velocity.commitsPerWeek ?? 0,
    techStackOverlap: project.techStack,
  }
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100
}

function buildNarrative(input: {
  ourDurationMonths: number
  marketDurationMonths: number
  ourTeamSize: number
  marketTeamSize: number
  speedMultiplier: number
  durationSavingsPercent: number
  hasHistoricalData: boolean
  similarProjectName?: string
}): string {
  const parts: string[] = []

  if (input.speedMultiplier > 1) {
    parts.push(
      `当社は市場平均と比較して約${roundTwo(input.speedMultiplier)}倍の効率で開発を完了できます。`
    )
  }

  parts.push(
    `市場では${input.marketTeamSize}名体制で${input.marketDurationMonths}ヶ月を要する見込みですが、` +
    `当社では${input.ourTeamSize}名の精鋭チームで${roundTwo(input.ourDurationMonths)}ヶ月での完了を目指します。`
  )

  if (input.durationSavingsPercent > 0) {
    parts.push(
      `期間ベースで約${Math.round(input.durationSavingsPercent)}%の短縮が見込まれます。`
    )
  }

  if (input.hasHistoricalData && input.similarProjectName) {
    parts.push(
      `この見積もりは、類似プロジェクト「${input.similarProjectName}」の実績データに基づいています。`
    )
  }

  return parts.join('')
}

function buildEvidencePoints(input: {
  velocity: VelocityDataShape | null
  similarProject: SimilarProject | null
  speedMultiplier: number
  ourDurationMonths: number
  marketDurationMonths: number
  ourTeamSize: number
  marketTeamSize: number
}): string[] {
  const points: string[] = []

  points.push(
    `市場見積: ${input.marketTeamSize}名 x ${input.marketDurationMonths}ヶ月 = ${input.marketTeamSize * input.marketDurationMonths * HOURS_PER_MEMBER_MONTH}時間`
  )
  points.push(
    `当社見積: ${input.ourTeamSize}名 x ${roundTwo(input.ourDurationMonths)}ヶ月`
  )

  if (input.speedMultiplier > 1) {
    points.push(`効率倍率: ${roundTwo(input.speedMultiplier)}x`)
  }

  if (input.velocity) {
    if (input.velocity.commitsPerWeek) {
      points.push(`類似PJの開発速度: ${input.velocity.commitsPerWeek} commits/week`)
    }
    if (input.velocity.velocityScore) {
      points.push(`Velocityスコア: ${input.velocity.velocityScore}/100`)
    }
    if (input.velocity.coreContributors) {
      points.push(`コアコントリビュータ: ${input.velocity.coreContributors}名`)
    }
  }

  if (input.similarProject) {
    points.push(
      `ポートフォリオ一致: ${input.similarProject.repoFullName}（スコア: ${input.similarProject.matchScore}）`
    )
    if (input.similarProject.techStack.length > 0) {
      points.push(`技術スタック重複: ${input.similarProject.techStack.join(', ')}`)
    }
  }

  return points
}

export function calculateSpeedAdvantage(
  input: CalculateSpeedAdvantageInput
): SpeedAdvantage {
  const { similarProjects, velocityData, marketTeamSize, marketDurationMonths, ourHoursEstimate, policy } = input

  const bestMatch = similarProjects.length > 0 ? similarProjects[0] : null
  const velocity = extractVelocityData(velocityData)
  const hasHistoricalData = velocity !== null

  const similarProjectField = bestMatch
    ? buildSimilarProjectField(bestMatch, velocity)
    : undefined

  const marketTotalHours = marketTeamSize * marketDurationMonths * HOURS_PER_MEMBER_MONTH
  const ourTeamSize = policy.internalTeamSize
  const ourDurationMonths = ourTeamSize > 0
    ? ourHoursEstimate / (ourTeamSize * HOURS_PER_MEMBER_MONTH)
    : ourHoursEstimate / HOURS_PER_MEMBER_MONTH

  const speedMultiplier = ourHoursEstimate > 0
    ? roundTwo(marketTotalHours / ourHoursEstimate)
    : 1

  const durationSavingsPercent = marketDurationMonths > 0
    ? roundTwo((1 - ourDurationMonths / marketDurationMonths) * 100)
    : 0

  const narrative = buildNarrative({
    ourDurationMonths,
    marketDurationMonths,
    ourTeamSize,
    marketTeamSize,
    speedMultiplier,
    durationSavingsPercent,
    hasHistoricalData,
    similarProjectName: bestMatch?.repoFullName,
  })

  const evidencePoints = buildEvidencePoints({
    velocity,
    similarProject: bestMatch,
    speedMultiplier,
    ourDurationMonths,
    marketDurationMonths,
    ourTeamSize,
    marketTeamSize,
  })

  return {
    hasHistoricalData,
    similarProject: similarProjectField,
    marketEstimate: {
      durationMonths: marketDurationMonths,
      teamSize: marketTeamSize,
      totalHours: marketTotalHours,
    },
    ourEstimate: {
      durationMonths: roundTwo(ourDurationMonths),
      teamSize: ourTeamSize,
      totalHours: ourHoursEstimate,
    },
    speedMultiplier,
    durationSavingsPercent,
    narrative,
    evidencePoints,
  }
}
