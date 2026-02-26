import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveVelocityCronLimit,
  runVelocityCronBatch,
} from '@/lib/github/velocity-cron'
import type { RepoVelocity } from '@/lib/github/velocity'

// Mock dependencies
vi.mock('@/lib/github/discover', () => ({
  analyzeAndSaveVelocity: vi.fn(),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { analyzeAndSaveVelocity } from '@/lib/github/discover'

const mockAnalyzeAndSaveVelocity = vi.mocked(analyzeAndSaveVelocity)

function createMockVelocity(overrides: Partial<RepoVelocity> = {}): RepoVelocity {
  return {
    firstCommitDate: '2024-01-01T00:00:00Z',
    lastCommitDate: '2025-01-01T00:00:00Z',
    totalDevelopmentDays: 365,
    activeDevelopmentDays: 200,
    totalCommits: 300,
    commitsPerWeek: 5.77,
    commitsPerActiveDay: 1.5,
    contributorCount: 3,
    coreContributors: 2,
    totalAdditions: 50000,
    totalDeletions: 15000,
    churnRate: 0.3,
    releases: [],
    estimatedHours: 660,
    velocityScore: 45,
    ...overrides,
  }
}

function createMockSupabase(options: {
  selectData?: Array<{
    id: string
    org_name: string
    repo_name: string
    is_showcase: boolean
    hours_spent: number | null
  }>
  selectError?: { message: string } | null
  updateError?: { message: string } | null
}) {
  const updateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      is: vi.fn().mockResolvedValue({ error: options.updateError ?? null }),
    }),
  })

  const limitFn = vi.fn().mockResolvedValue({
    data: options.selectData ?? [],
    error: options.selectError ?? null,
  })

  const orderFn2 = vi.fn().mockReturnValue({
    limit: limitFn,
  })

  const orderFn1 = vi.fn().mockReturnValue({
    order: orderFn2,
  })

  const isFn = vi.fn().mockReturnValue({
    order: orderFn1,
  })

  const selectFn = vi.fn().mockReturnValue({
    is: isFn,
  })

  return {
    from: vi.fn().mockReturnValue({
      select: selectFn,
      update: updateFn,
    }),
    _mocks: { selectFn, isFn, orderFn1, orderFn2, limitFn, updateFn },
  }
}

describe('resolveVelocityCronLimit', () => {
  it('returns default (3) for undefined', () => {
    expect(resolveVelocityCronLimit(undefined)).toBe(3)
  })

  it('returns default for empty string', () => {
    expect(resolveVelocityCronLimit('')).toBe(3)
  })

  it('returns default for non-numeric string', () => {
    expect(resolveVelocityCronLimit('abc')).toBe(3)
  })

  it('returns default for zero', () => {
    expect(resolveVelocityCronLimit('0')).toBe(3)
  })

  it('returns default for negative value', () => {
    expect(resolveVelocityCronLimit('-5')).toBe(3)
  })

  it('parses valid integer', () => {
    expect(resolveVelocityCronLimit('5')).toBe(5)
  })

  it('floors decimal values', () => {
    expect(resolveVelocityCronLimit('7.9')).toBe(7)
  })

  it('caps at max 10', () => {
    expect(resolveVelocityCronLimit('15')).toBe(10)
    expect(resolveVelocityCronLimit('100')).toBe(10)
  })

  it('returns 1 for minimum valid value', () => {
    expect(resolveVelocityCronLimit('1')).toBe(1)
  })

  it('returns 10 for max valid value', () => {
    expect(resolveVelocityCronLimit('10')).toBe(10)
  })
})

describe('runVelocityCronBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty result when DB query fails', async () => {
    const supabase = createMockSupabase({
      selectError: { message: 'connection failed' },
      selectData: undefined,
    })

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(result).toEqual({
      scanned: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      details: [],
    })
  })

  it('returns empty result when no pending repos', async () => {
    const supabase = createMockSupabase({ selectData: [] })

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(result).toEqual({
      scanned: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      details: [],
    })
    expect(mockAnalyzeAndSaveVelocity).not.toHaveBeenCalled()
  })

  it('processes repos and returns success details', async () => {
    const velocity = createMockVelocity({ estimatedHours: 120 })
    mockAnalyzeAndSaveVelocity.mockResolvedValue(velocity)

    const supabase = createMockSupabase({
      selectData: [
        { id: 'r1', org_name: 'Cor', repo_name: 'app1', is_showcase: true, hours_spent: null },
        { id: 'r2', org_name: 'Cor', repo_name: 'app2', is_showcase: false, hours_spent: null },
      ],
    })

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 5 }
    )

    expect(result.scanned).toBe(2)
    expect(result.processed).toBe(2)
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.details).toHaveLength(2)
    expect(result.details[0]).toEqual({
      fullName: 'Cor/app1',
      success: true,
      estimatedHours: 120,
    })
    expect(result.details[1]).toEqual({
      fullName: 'Cor/app2',
      success: true,
      estimatedHours: 120,
    })
    expect(mockAnalyzeAndSaveVelocity).toHaveBeenCalledTimes(2)
  })

  it('handles velocity analysis returning null', async () => {
    mockAnalyzeAndSaveVelocity.mockResolvedValue(null)

    const supabase = createMockSupabase({
      selectData: [
        { id: 'r1', org_name: 'Cor', repo_name: 'empty-repo', is_showcase: false, hours_spent: null },
      ],
    })

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(result.scanned).toBe(1)
    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.details[0]).toEqual({
      fullName: 'Cor/empty-repo',
      success: false,
      estimatedHours: null,
      error: 'velocity analysis returned null',
    })
  })

  it('handles velocity analysis throwing error', async () => {
    mockAnalyzeAndSaveVelocity.mockRejectedValue(new Error('GitHub API rate limited'))

    const supabase = createMockSupabase({
      selectData: [
        { id: 'r1', org_name: 'Cor', repo_name: 'broken', is_showcase: false, hours_spent: null },
      ],
    })

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(result.scanned).toBe(1)
    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.details[0]).toEqual({
      fullName: 'Cor/broken',
      success: false,
      estimatedHours: null,
      error: 'GitHub API rate limited',
    })
  })

  it('backfills hours_spent when null and velocity has estimatedHours', async () => {
    const velocity = createMockVelocity({ estimatedHours: 200 })
    mockAnalyzeAndSaveVelocity.mockResolvedValue(velocity)

    const updateIsMock = vi.fn().mockResolvedValue({ error: null })
    const updateEqMock = vi.fn().mockReturnValue({ is: updateIsMock })
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })

    // Build a more explicit mock for the update path
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'github_references') {
          return {
            select: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [
                        { id: 'r1', org_name: 'Cor', repo_name: 'app1', is_showcase: true, hours_spent: null },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: updateMock,
          }
        }
        return {}
      }),
    }

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(result.succeeded).toBe(1)
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hours_spent: 200,
      })
    )
    expect(updateEqMock).toHaveBeenCalledWith('id', 'r1')
    expect(updateIsMock).toHaveBeenCalledWith('hours_spent', null)
  })

  it('does NOT overwrite existing hours_spent', async () => {
    const velocity = createMockVelocity({ estimatedHours: 200 })
    mockAnalyzeAndSaveVelocity.mockResolvedValue(velocity)

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    const supabase = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'r1', org_name: 'Cor', repo_name: 'app1', is_showcase: true, hours_spent: 500 },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
        update: updateMock,
      })),
    }

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(result.succeeded).toBe(1)
    // update should NOT be called since hours_spent is already set
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('does NOT backfill when estimatedHours is 0', async () => {
    const velocity = createMockVelocity({ estimatedHours: 0 })
    mockAnalyzeAndSaveVelocity.mockResolvedValue(velocity)

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    const supabase = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'r1', org_name: 'Cor', repo_name: 'app1', is_showcase: false, hours_spent: null },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
        update: updateMock,
      })),
    }

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(result.succeeded).toBe(1)
    // estimatedHours is 0, so no backfill
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('handles mixed success and failure in a batch', async () => {
    const velocity = createMockVelocity({ estimatedHours: 100 })

    mockAnalyzeAndSaveVelocity
      .mockResolvedValueOnce(velocity)      // r1 succeeds
      .mockRejectedValueOnce(new Error('timeout'))  // r2 fails
      .mockResolvedValueOnce(null)           // r3 returns null

    const supabase = createMockSupabase({
      selectData: [
        { id: 'r1', org_name: 'Cor', repo_name: 'good', is_showcase: true, hours_spent: 50 },
        { id: 'r2', org_name: 'Cor', repo_name: 'broken', is_showcase: false, hours_spent: null },
        { id: 'r3', org_name: 'Cor', repo_name: 'empty', is_showcase: false, hours_spent: null },
      ],
    })

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 5 }
    )

    expect(result.scanned).toBe(3)
    expect(result.processed).toBe(3)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(2)
    expect(result.details[0].success).toBe(true)
    expect(result.details[1].success).toBe(false)
    expect(result.details[1].error).toBe('timeout')
    expect(result.details[2].success).toBe(false)
    expect(result.details[2].error).toBe('velocity analysis returned null')
  })

  it('handles non-Error thrown values gracefully', async () => {
    mockAnalyzeAndSaveVelocity.mockRejectedValue('string error')

    const supabase = createMockSupabase({
      selectData: [
        { id: 'r1', org_name: 'Cor', repo_name: 'weird', is_showcase: false, hours_spent: null },
      ],
    })

    const result = await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(result.failed).toBe(1)
    expect(result.details[0].error).toBe('string error')
  })

  it('passes correct parameters to analyzeAndSaveVelocity', async () => {
    mockAnalyzeAndSaveVelocity.mockResolvedValue(createMockVelocity())

    const supabase = createMockSupabase({
      selectData: [
        { id: 'uuid-123', org_name: 'EngineerCafeJP', repo_name: 'navigator', is_showcase: true, hours_spent: null },
      ],
    })

    await runVelocityCronBatch(
      supabase as never,
      { actorClerkUserId: 'system:cron', limit: 3 }
    )

    expect(mockAnalyzeAndSaveVelocity).toHaveBeenCalledWith({
      supabase,
      repoId: 'uuid-123',
      orgName: 'EngineerCafeJP',
      repoName: 'navigator',
    })
  })
})
