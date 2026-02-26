import type { SupabaseClient } from '@supabase/supabase-js'
import type { SimilarProject } from '@/lib/estimates/similar-projects'
import type { HistoricalReference, HistoricalCalibration } from '@/lib/estimates/evidence-bundle'
import { buildEmptyHistoricalCalibration } from '@/lib/estimates/evidence-bundle'
import { logger } from '@/lib/utils/logger'

export async function enrichSimilarProjectsWithHistory(
  supabase: SupabaseClient,
  similarProjects: SimilarProject[],
  limit = 5
): Promise<HistoricalReference[]> {
  if (similarProjects.length === 0) {
    return []
  }

  const topProjects = similarProjects.slice(0, limit)
  const ids = topProjects.map((p) => p.githubReferenceId)

  const { data, error } = await supabase
    .from('github_references')
    .select('id, velocity_data, analysis_result, hours_spent')
    .in('id', ids)

  if (error) {
    logger.error('Failed to fetch github_references for historical calibration', error)
    return []
  }

  if (!data || data.length === 0) {
    return []
  }

  const dbMap = new Map<string, { velocity_data: unknown; analysis_result: unknown; hours_spent: unknown }>()
  for (const row of data) {
    dbMap.set(row.id as string, row as { velocity_data: unknown; analysis_result: unknown; hours_spent: unknown })
  }

  return topProjects.map((project) => {
    const dbRow = dbMap.get(project.githubReferenceId)

    const velocityData =
      dbRow?.velocity_data != null && typeof dbRow.velocity_data === 'object'
        ? (dbRow.velocity_data as Record<string, unknown>)
        : null

    const analysisResult =
      dbRow?.analysis_result != null && typeof dbRow.analysis_result === 'object'
        ? (dbRow.analysis_result as Record<string, unknown>)
        : null

    const velocityEstimatedHours =
      velocityData != null && typeof velocityData['estimatedHours'] === 'number'
        ? velocityData['estimatedHours']
        : null

    const hoursSpent =
      dbRow != null && typeof dbRow.hours_spent === 'number' ? dbRow.hours_spent : project.hoursSpent

    return {
      githubReferenceId: project.githubReferenceId,
      repoFullName: project.repoFullName,
      matchScore: project.matchScore,
      matchStrategy: 'semantic' as const,
      matchReasons: project.matchReasons,
      techStack: project.techStack,
      hoursSpent,
      velocityEstimatedHours,
      velocityData,
      analysisResult,
      description: project.description,
    }
  })
}

export function buildHistoricalCalibration(refs: HistoricalReference[]): HistoricalCalibration {
  if (refs.length === 0) {
    return buildEmptyHistoricalCalibration()
  }

  const refsWithHours = refs.filter((r) => r.hoursSpent !== null) as (HistoricalReference & {
    hoursSpent: number
  })[]
  const refsWithVelocity = refs.filter((r) => r.velocityEstimatedHours !== null) as (HistoricalReference & {
    velocityEstimatedHours: number
  })[]

  const avgActualHours =
    refsWithHours.length > 0
      ? Math.round(
          (refsWithHours.reduce((sum, r) => sum + r.hoursSpent, 0) / refsWithHours.length) * 10
        ) / 10
      : null

  const minActualHours =
    refsWithHours.length > 0
      ? Math.round(Math.min(...refsWithHours.map((r) => r.hoursSpent)) * 10) / 10
      : null

  const maxActualHours =
    refsWithHours.length > 0
      ? Math.round(Math.max(...refsWithHours.map((r) => r.hoursSpent)) * 10) / 10
      : null

  const avgVelocityHours =
    refsWithVelocity.length > 0
      ? Math.round(
          (refsWithVelocity.reduce((sum, r) => sum + r.velocityEstimatedHours, 0) /
            refsWithVelocity.length) *
            10
        ) / 10
      : null

  const hasReliableData = refsWithHours.length > 0

  const citationText = refsWithHours
    .map((r) => `${r.repoFullName} (${r.hoursSpent}h実績)`)
    .join(', ')

  return {
    references: refs,
    avgActualHours,
    minActualHours,
    maxActualHours,
    avgVelocityHours,
    calibrationRatio: null,
    citationText,
    hasReliableData,
  }
}
