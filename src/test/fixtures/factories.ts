import type {
  ProjectType,
  BusinessLine,
  EstimateMode,
  ConcreteProjectType,
} from '@/types/database'
import type { PricingPolicy } from '@/lib/pricing/engine'
import { defaultPolicyFor } from '@/lib/pricing/engine'
import type { HistoricalCalibration } from '@/lib/estimates/evidence-bundle'
import { buildEmptyHistoricalCalibration } from '@/lib/estimates/evidence-bundle'
import type { SimilarProject } from '@/lib/estimates/similar-projects'

// ═══════════════════════════════════════
// Project Factories
// ═══════════════════════════════════════

let projectSeq = 0

export function createProject(overrides?: Partial<{
  id: string
  title: string
  type: ProjectType
  status: string
  businessLine: BusinessLine | null
  specMarkdown: string | null
}>) {
  projectSeq++
  return {
    id: overrides?.id ?? `proj-test-${projectSeq}`,
    customer_id: `cust-test-${projectSeq}`,
    title: overrides?.title ?? `テストプロジェクト ${projectSeq}`,
    type: overrides?.type ?? ('new_project' as ProjectType),
    status: overrides?.status ?? 'interviewing',
    priority: 'medium' as const,
    existing_system_url: null,
    spec_markdown: overrides?.specMarkdown ?? '# テスト仕様書\n\nテスト用の仕様書です。',
    business_line: overrides?.businessLine ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ═══════════════════════════════════════
// Estimate Factories
// ═══════════════════════════════════════

let estimateSeq = 0

export function createEstimate(overrides?: Partial<{
  id: string
  projectId: string
  estimateMode: EstimateMode
  totalHours: number
  hourlyRate: number
  linearSyncStatus: string | null
  linearProjectId: string | null
}>) {
  estimateSeq++
  return {
    id: overrides?.id ?? `est-test-${estimateSeq}`,
    project_id: overrides?.projectId ?? `proj-test-${estimateSeq}`,
    estimate_mode: overrides?.estimateMode ?? ('market_comparison' as EstimateMode),
    estimate_status: 'draft' as const,
    approval_required: false,
    approval_status: 'not_required' as const,
    your_hourly_rate: overrides?.hourlyRate ?? 15000,
    your_estimated_hours: overrides?.totalHours ?? 75,
    hours_investigation: 10,
    hours_implementation: 40,
    hours_testing: 15,
    hours_buffer: 10,
    linear_sync_status: overrides?.linearSyncStatus ?? null,
    linear_project_id: overrides?.linearProjectId ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ═══════════════════════════════════════
// Pricing Policy Factories
// ═══════════════════════════════════════

export function createPricingPolicy(
  projectType: ConcreteProjectType = 'new_project',
  overrides?: Partial<PricingPolicy>
): PricingPolicy {
  const base = defaultPolicyFor(projectType)
  return { ...base, ...overrides }
}

// ═══════════════════════════════════════
// Velocity Data Factories
// ═══════════════════════════════════════

export function createVelocityData(overrides?: Partial<{
  totalDevelopmentDays: number
  totalCommits: number
  commitsPerWeek: number
  contributorCount: number
  coreContributors: number
  estimatedHours: number
  velocityScore: number
  totalAdditions: number
  totalDeletions: number
}>): Record<string, unknown> {
  return {
    totalDevelopmentDays: overrides?.totalDevelopmentDays ?? 90,
    totalCommits: overrides?.totalCommits ?? 450,
    commitsPerWeek: overrides?.commitsPerWeek ?? 35,
    contributorCount: overrides?.contributorCount ?? 3,
    coreContributors: overrides?.coreContributors ?? 2,
    estimatedHours: overrides?.estimatedHours ?? 720,
    velocityScore: overrides?.velocityScore ?? 75,
    totalAdditions: overrides?.totalAdditions ?? 50000,
    totalDeletions: overrides?.totalDeletions ?? 15000,
  }
}

// ═══════════════════════════════════════
// Similar Project Factories
// ═══════════════════════════════════════

let similarProjectSeq = 0

export function createSimilarProject(overrides?: Partial<SimilarProject>): SimilarProject {
  similarProjectSeq++
  return {
    githubReferenceId: overrides?.githubReferenceId ?? `gh-ref-${similarProjectSeq}`,
    repoFullName: overrides?.repoFullName ?? `org/repo-${similarProjectSeq}`,
    matchScore: overrides?.matchScore ?? 0.8,
    matchReasons: overrides?.matchReasons ?? ['技術スタック一致'],
    language: overrides?.language ?? 'TypeScript',
    techStack: overrides?.techStack ?? ['React', 'Next.js', 'TypeScript'],
    hoursSpent: overrides?.hoursSpent ?? 200,
    description: overrides?.description ?? 'テスト用類似プロジェクト',
  }
}

// ═══════════════════════════════════════
// Historical Calibration Factories
// ═══════════════════════════════════════

export function createHistoricalCalibration(overrides?: Partial<HistoricalCalibration>): HistoricalCalibration {
  if (!overrides) return buildEmptyHistoricalCalibration()

  return {
    references: overrides.references ?? [],
    avgActualHours: overrides.avgActualHours ?? null,
    minActualHours: overrides.minActualHours ?? null,
    maxActualHours: overrides.maxActualHours ?? null,
    avgVelocityHours: overrides.avgVelocityHours ?? null,
    calibrationRatio: overrides.calibrationRatio ?? null,
    citationText: overrides.citationText ?? '',
    hasReliableData: overrides.hasReliableData ?? false,
  }
}

export function createReliableHistoricalCalibration(avgHours: number): HistoricalCalibration {
  return {
    references: [
      {
        githubReferenceId: 'gh-ref-hist-1',
        repoFullName: 'org/historical-project',
        matchScore: 0.85,
        matchStrategy: 'semantic',
        matchReasons: ['技術スタック一致', 'ドメイン類似'],
        techStack: ['React', 'Next.js'],
        hoursSpent: avgHours,
        velocityEstimatedHours: avgHours * 1.1,
        velocityData: createVelocityData({ estimatedHours: avgHours * 1.1 }),
        analysisResult: null,
        description: 'テスト用実績プロジェクト',
      },
    ],
    avgActualHours: avgHours,
    minActualHours: avgHours * 0.8,
    maxActualHours: avgHours * 1.2,
    avgVelocityHours: avgHours * 1.1,
    calibrationRatio: 1.0,
    citationText: `類似プロジェクト「org/historical-project」の実績 ${avgHours} 時間に基づく`,
    hasReliableData: true,
  }
}

// ═══════════════════════════════════════
// Market Evidence Fallback Resolution
// ═══════════════════════════════════════

export function createFallbackResolution(overrides?: Partial<{
  warning: string | null
  reusedPrevious: boolean
  stale: boolean
}>) {
  return {
    result: {
      evidence: {
        marketHourlyRate: 12000,
        marketRateRange: { min: 8000, max: 16000 },
        marketEstimatedHoursMultiplier: 1.8,
        typicalTeamSize: 5,
        typicalDurationMonths: 4,
        monthlyUnitPrice: 1200000,
        trends: ['クラウド移行が加速'],
        risks: ['人材不足'],
        summary: '市場相場の要約',
      },
      citations: [
        { url: 'https://example.com/1', type: 'web' as const },
        { url: 'https://example.com/2', type: 'web' as const },
      ],
      raw: {},
      confidenceScore: 0.75,
      usage: {},
      isFallback: false,
      fallbackReason: null,
    },
    reusedPrevious: overrides?.reusedPrevious ?? false,
    stale: overrides?.stale ?? false,
    warning: overrides?.warning ?? null,
    sourceRetrievedAt: '2025-01-01T00:00:00.000Z',
  }
}
