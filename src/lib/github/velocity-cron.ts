import type { SupabaseClient } from '@supabase/supabase-js'
import { analyzeAndSaveVelocity } from './discover'
import { logger } from '@/lib/utils/logger'

const DEFAULT_BATCH_SIZE = 3

interface VelocityPendingRepo {
  id: string
  org_name: string
  repo_name: string
  is_showcase: boolean
  hours_spent: number | null
}

export interface RunVelocityCronResult {
  scanned: number
  processed: number
  succeeded: number
  failed: number
  details: Array<{
    fullName: string
    success: boolean
    estimatedHours: number | null
    error?: string
  }>
}

export function resolveVelocityCronLimit(value: string | undefined): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_BATCH_SIZE
  return Math.min(10, Math.floor(num))
}

export async function runVelocityCronBatch(
  supabase: SupabaseClient,
  input: {
    actorClerkUserId: string
    limit: number
  }
): Promise<RunVelocityCronResult> {
  const { data, error } = await supabase
    .from('github_references')
    .select('id, org_name, repo_name, is_showcase, hours_spent')
    .is('velocity_data', null)
    .order('is_showcase', { ascending: false })
    .order('stars', { ascending: false })
    .limit(input.limit)

  if (error || !data) {
    logger.error('velocity-cron: failed to fetch pending repos', {
      error: error?.message,
    })
    return { scanned: 0, processed: 0, succeeded: 0, failed: 0, details: [] }
  }

  const repos = data as VelocityPendingRepo[]
  const result: RunVelocityCronResult = {
    scanned: repos.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    details: [],
  }

  for (const repo of repos) {
    const fullName = `${repo.org_name}/${repo.repo_name}`
    try {
      const velocity = await analyzeAndSaveVelocity({
        supabase,
        repoId: repo.id,
        orgName: repo.org_name,
        repoName: repo.repo_name,
      })

      result.processed += 1

      if (velocity === null) {
        result.failed += 1
        result.details.push({
          fullName,
          success: false,
          estimatedHours: null,
          error: 'velocity analysis returned null',
        })
        continue
      }

      // Backfill hours_spent from velocity estimate only if not already set
      // Use .is('hours_spent', null) in SQL to prevent TOCTOU overwrite
      if (repo.hours_spent === null && velocity.estimatedHours > 0) {
        const { error: backfillError } = await supabase
          .from('github_references')
          .update({
            hours_spent: Math.round(velocity.estimatedHours),
            updated_at: new Date().toISOString(),
          })
          .eq('id', repo.id)
          .is('hours_spent', null)

        if (backfillError) {
          logger.warn('velocity-cron: hours_spent backfill failed', {
            repoId: repo.id,
            fullName,
            error: backfillError.message,
          })
        }
      }

      result.succeeded += 1
      result.details.push({
        fullName,
        success: true,
        estimatedHours: velocity.estimatedHours,
      })
    } catch (err) {
      result.processed += 1
      result.failed += 1
      result.details.push({
        fullName,
        success: false,
        estimatedHours: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('velocity-cron batch complete', {
    scanned: result.scanned,
    succeeded: result.succeeded,
    failed: result.failed,
  })

  return result
}
