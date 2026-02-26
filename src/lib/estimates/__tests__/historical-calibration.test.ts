import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SimilarProject } from '../similar-projects'
import type { HistoricalReference } from '../evidence-bundle'
import {
  enrichSimilarProjectsWithHistory,
  buildHistoricalCalibration,
} from '../historical-calibration'

function createMockSupabase(overrides?: { data?: unknown[]; error?: unknown }) {
  const inFn = vi.fn().mockResolvedValue({
    data: overrides?.data ?? [],
    error: overrides?.error ?? null,
  })
  const selectFn = vi.fn().mockReturnValue({ in: inFn })
  const fromFn = vi.fn().mockReturnValue({ select: selectFn })
  return { from: fromFn, _selectFn: selectFn, _inFn: inFn } as unknown as SupabaseClient
}

const sampleSimilarProjects: SimilarProject[] = [
  {
    githubReferenceId: 'ref-1',
    repoFullName: 'cor-inc/ecommerce-platform',
    matchScore: 0.8,
    matchReasons: ['技術スタック一致: next.js, typescript'],
    language: 'TypeScript',
    techStack: ['Next.js', 'TypeScript', 'PostgreSQL'],
    hoursSpent: 200,
    description: 'EC platform built with Next.js',
  },
  {
    githubReferenceId: 'ref-2',
    repoFullName: 'cor-inc/iot-dashboard',
    matchScore: 0.5,
    matchReasons: ['技術スタック一致: python'],
    language: 'Python',
    techStack: ['Python', 'FastAPI', 'React'],
    hoursSpent: 150,
    description: 'IoT sensor monitoring dashboard',
  },
  {
    githubReferenceId: 'ref-3',
    repoFullName: 'cor-inc/mobile-app',
    matchScore: 0.3,
    matchReasons: ['トピック一致: react'],
    language: 'TypeScript',
    techStack: ['React Native', 'TypeScript'],
    hoursSpent: null,
    description: 'Mobile app with no hours tracked',
  },
]

describe('buildHistoricalCalibration', () => {
  it('returns empty calibration for empty refs array', () => {
    const result = buildHistoricalCalibration([])

    expect(result.references).toEqual([])
    expect(result.avgActualHours).toBeNull()
    expect(result.minActualHours).toBeNull()
    expect(result.maxActualHours).toBeNull()
    expect(result.avgVelocityHours).toBeNull()
    expect(result.calibrationRatio).toBeNull()
    expect(result.citationText).toBe('')
    expect(result.hasReliableData).toBe(false)
  })

  it('computes correct avg/min/max when all refs have hours', () => {
    const refs: HistoricalReference[] = [
      {
        githubReferenceId: 'ref-1',
        repoFullName: 'org/repo-a',
        matchScore: 0.9,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 100,
        velocityEstimatedHours: null,
        velocityData: null,
        analysisResult: null,
        description: null,
      },
      {
        githubReferenceId: 'ref-2',
        repoFullName: 'org/repo-b',
        matchScore: 0.7,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 200,
        velocityEstimatedHours: null,
        velocityData: null,
        analysisResult: null,
        description: null,
      },
      {
        githubReferenceId: 'ref-3',
        repoFullName: 'org/repo-c',
        matchScore: 0.5,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 300,
        velocityEstimatedHours: null,
        velocityData: null,
        analysisResult: null,
        description: null,
      },
    ]

    const result = buildHistoricalCalibration(refs)

    expect(result.avgActualHours).toBe(200)
    expect(result.minActualHours).toBe(100)
    expect(result.maxActualHours).toBe(300)
    expect(result.hasReliableData).toBe(true)
  })

  it('computes correct avgActualHours with rounding', () => {
    const refs: HistoricalReference[] = [
      {
        githubReferenceId: 'ref-1',
        repoFullName: 'org/repo-a',
        matchScore: 0.9,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 10,
        velocityEstimatedHours: null,
        velocityData: null,
        analysisResult: null,
        description: null,
      },
      {
        githubReferenceId: 'ref-2',
        repoFullName: 'org/repo-b',
        matchScore: 0.7,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 20,
        velocityEstimatedHours: null,
        velocityData: null,
        analysisResult: null,
        description: null,
      },
    ]

    const result = buildHistoricalCalibration(refs)

    // avg = (10 + 20) / 2 = 15.0
    expect(result.avgActualHours).toBe(15)
  })

  it('returns hasReliableData false when no refs have hoursSpent', () => {
    const refs: HistoricalReference[] = [
      {
        githubReferenceId: 'ref-1',
        repoFullName: 'org/repo-no-hours',
        matchScore: 0.6,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: null,
        velocityEstimatedHours: 80,
        velocityData: { estimatedHours: 80 },
        analysisResult: null,
        description: null,
      },
    ]

    const result = buildHistoricalCalibration(refs)

    expect(result.hasReliableData).toBe(false)
    expect(result.avgActualHours).toBeNull()
    expect(result.minActualHours).toBeNull()
    expect(result.maxActualHours).toBeNull()
    // velocity hours still computed
    expect(result.avgVelocityHours).toBe(80)
  })

  it('computes avgVelocityHours from refs with velocityEstimatedHours', () => {
    const refs: HistoricalReference[] = [
      {
        githubReferenceId: 'ref-1',
        repoFullName: 'org/repo-a',
        matchScore: 0.9,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 100,
        velocityEstimatedHours: 90,
        velocityData: { estimatedHours: 90 },
        analysisResult: null,
        description: null,
      },
      {
        githubReferenceId: 'ref-2',
        repoFullName: 'org/repo-b',
        matchScore: 0.7,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 200,
        velocityEstimatedHours: 110,
        velocityData: { estimatedHours: 110 },
        analysisResult: null,
        description: null,
      },
    ]

    const result = buildHistoricalCalibration(refs)

    // avg velocity = (90 + 110) / 2 = 100
    expect(result.avgVelocityHours).toBe(100)
  })

  it('handles mixed refs where some have hours and some do not', () => {
    const refs: HistoricalReference[] = [
      {
        githubReferenceId: 'ref-1',
        repoFullName: 'org/with-hours',
        matchScore: 0.9,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 120,
        velocityEstimatedHours: 100,
        velocityData: { estimatedHours: 100 },
        analysisResult: null,
        description: null,
      },
      {
        githubReferenceId: 'ref-2',
        repoFullName: 'org/no-hours',
        matchScore: 0.6,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: null,
        velocityEstimatedHours: 80,
        velocityData: { estimatedHours: 80 },
        analysisResult: null,
        description: null,
      },
    ]

    const result = buildHistoricalCalibration(refs)

    expect(result.hasReliableData).toBe(true)
    expect(result.avgActualHours).toBe(120)
    expect(result.minActualHours).toBe(120)
    expect(result.maxActualHours).toBe(120)
    // Both refs contribute to velocity avg
    expect(result.avgVelocityHours).toBe(90)
    expect(result.references).toHaveLength(2)
  })

  it('formats citationText correctly from refs with hoursSpent', () => {
    const refs: HistoricalReference[] = [
      {
        githubReferenceId: 'ref-1',
        repoFullName: 'cor-inc/project-alpha',
        matchScore: 0.9,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 150,
        velocityEstimatedHours: null,
        velocityData: null,
        analysisResult: null,
        description: null,
      },
      {
        githubReferenceId: 'ref-2',
        repoFullName: 'cor-inc/project-beta',
        matchScore: 0.7,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 250,
        velocityEstimatedHours: null,
        velocityData: null,
        analysisResult: null,
        description: null,
      },
      {
        githubReferenceId: 'ref-3',
        repoFullName: 'cor-inc/project-gamma',
        matchScore: 0.5,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: null,
        velocityEstimatedHours: null,
        velocityData: null,
        analysisResult: null,
        description: null,
      },
    ]

    const result = buildHistoricalCalibration(refs)

    // Only refs with hoursSpent appear in citation
    expect(result.citationText).toBe(
      'cor-inc/project-alpha (150h実績), cor-inc/project-beta (250h実績)'
    )
  })

  it('returns calibrationRatio as null (computed later)', () => {
    const refs: HistoricalReference[] = [
      {
        githubReferenceId: 'ref-1',
        repoFullName: 'org/repo',
        matchScore: 0.8,
        matchStrategy: 'keyword',
        matchReasons: [],
        techStack: [],
        hoursSpent: 100,
        velocityEstimatedHours: 90,
        velocityData: { estimatedHours: 90 },
        analysisResult: null,
        description: null,
      },
    ]

    const result = buildHistoricalCalibration(refs)

    expect(result.calibrationRatio).toBeNull()
  })
})

describe('enrichSimilarProjectsWithHistory', () => {
  it('returns empty array when similarProjects is empty', async () => {
    const supabase = createMockSupabase()
    const result = await enrichSimilarProjectsWithHistory(supabase, [])
    expect(result).toEqual([])
  })

  it('returns empty array on DB error', async () => {
    const supabase = createMockSupabase({ error: { message: 'DB Error' } })
    const result = await enrichSimilarProjectsWithHistory(supabase, sampleSimilarProjects)
    expect(result).toEqual([])
  })

  it('returns empty array when DB returns no data', async () => {
    const supabase = createMockSupabase({ data: [] })
    const result = await enrichSimilarProjectsWithHistory(supabase, sampleSimilarProjects)
    expect(result).toEqual([])
  })

  it('maps DB rows to HistoricalReference correctly', async () => {
    const dbRows = [
      {
        id: 'ref-1',
        velocity_data: { estimatedHours: 180 },
        analysis_result: { complexity: 'high' },
        hours_spent: 200,
      },
      {
        id: 'ref-2',
        velocity_data: { estimatedHours: 140 },
        analysis_result: null,
        hours_spent: 150,
      },
      {
        id: 'ref-3',
        velocity_data: null,
        analysis_result: null,
        hours_spent: null,
      },
    ]

    const supabase = createMockSupabase({ data: dbRows })
    const result = await enrichSimilarProjectsWithHistory(supabase, sampleSimilarProjects)

    expect(result).toHaveLength(3)

    const ref1 = result.find((r) => r.githubReferenceId === 'ref-1')
    expect(ref1).toBeDefined()
    expect(ref1?.hoursSpent).toBe(200)
    expect(ref1?.velocityEstimatedHours).toBe(180)
    expect(ref1?.velocityData).toEqual({ estimatedHours: 180 })
    expect(ref1?.analysisResult).toEqual({ complexity: 'high' })
    expect(ref1?.matchStrategy).toBe('semantic')

    const ref2 = result.find((r) => r.githubReferenceId === 'ref-2')
    expect(ref2?.velocityEstimatedHours).toBe(140)
    expect(ref2?.analysisResult).toBeNull()

    const ref3 = result.find((r) => r.githubReferenceId === 'ref-3')
    expect(ref3?.velocityEstimatedHours).toBeNull()
    expect(ref3?.velocityData).toBeNull()
    // falls back to project.hoursSpent (null in this case)
    expect(ref3?.hoursSpent).toBeNull()
  })

  it('preserves SimilarProject fields in the result', async () => {
    const dbRows = [
      {
        id: 'ref-1',
        velocity_data: null,
        analysis_result: null,
        hours_spent: 200,
      },
    ]

    const supabase = createMockSupabase({ data: dbRows })
    const result = await enrichSimilarProjectsWithHistory(supabase, [sampleSimilarProjects[0]])

    expect(result).toHaveLength(1)
    const ref = result[0]
    expect(ref.repoFullName).toBe('cor-inc/ecommerce-platform')
    expect(ref.matchScore).toBe(0.8)
    expect(ref.matchReasons).toEqual(['技術スタック一致: next.js, typescript'])
    expect(ref.techStack).toEqual(['Next.js', 'TypeScript', 'PostgreSQL'])
    expect(ref.description).toBe('EC platform built with Next.js')
  })

  it('respects the limit parameter and queries only the top N projects', async () => {
    const dbRows = [
      {
        id: 'ref-1',
        velocity_data: null,
        analysis_result: null,
        hours_spent: 200,
      },
      {
        id: 'ref-2',
        velocity_data: null,
        analysis_result: null,
        hours_spent: 150,
      },
    ]

    const supabase = createMockSupabase({ data: dbRows })
    const result = await enrichSimilarProjectsWithHistory(supabase, sampleSimilarProjects, 2)

    // Result maps over topProjects (limit=2) but DB returned 2 rows
    expect(result).toHaveLength(2)
  })

  it('ignores non-numeric velocityData.estimatedHours', async () => {
    const dbRows = [
      {
        id: 'ref-1',
        velocity_data: { estimatedHours: 'not-a-number' },
        analysis_result: null,
        hours_spent: 200,
      },
    ]

    const supabase = createMockSupabase({ data: dbRows })
    const result = await enrichSimilarProjectsWithHistory(supabase, [sampleSimilarProjects[0]])

    expect(result).toHaveLength(1)
    expect(result[0].velocityEstimatedHours).toBeNull()
  })
})
