import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveMarketEvidenceWithFallback } from '@/lib/market/evidence-fallback'
import type { MarketEvidenceResult } from '@/lib/market/evidence'

interface SupabaseFallbackMockInput {
  ttlHours?: number
  latestEvidence?: {
    id: string
    data: Record<string, unknown>
    citations: unknown[]
    confidence_score: number | null
    summary: string
    retrieved_at: string
  } | null
}

function createSupabaseMock(input: SupabaseFallbackMockInput): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'data_sources') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data:
                    typeof input.ttlHours === 'number'
                      ? { freshness_ttl_hours: input.ttlHours }
                      : null,
                  error: null,
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'market_evidence') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: input.latestEvidence ?? null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }

      return {
        select: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

function createFetched(input?: Partial<MarketEvidenceResult>): MarketEvidenceResult {
  return {
    evidence: {
      marketHourlyRate: 12000,
      marketRateRange: { min: 9000, max: 15000 },
      marketEstimatedHoursMultiplier: 1.6,
      typicalTeamSize: 5,
      typicalDurationMonths: 4,
      monthlyUnitPrice: 1400000,
      trends: ['trend'],
      risks: ['risk'],
      summary: 'fresh summary',
    },
    citations: [
      { url: 'https://example.com/a', type: 'web' },
      { url: 'https://example.com/b', type: 'web' },
    ],
    raw: { ok: true },
    confidenceScore: 0.75,
    usage: {},
    isFallback: false,
    fallbackReason: null,
    ...input,
  }
}

describe('resolveMarketEvidenceWithFallback', () => {
  it('keeps fetched evidence when citations are sufficient', async () => {
    const fetched = createFetched()
    const result = await resolveMarketEvidenceWithFallback({
      supabase: createSupabaseMock({}),
      projectId: 'project-1',
      projectType: 'new_project',
      fetched,
      now: new Date('2026-02-13T00:00:00.000Z'),
    })

    expect(result.reusedPrevious).toBe(false)
    expect(result.result.evidence.summary).toBe('fresh summary')
    expect(result.warning).toBeNull()
  })

  it('reuses latest evidence with stale warning when fallback happens', async () => {
    const fetched = createFetched({
      citations: [],
      isFallback: true,
      fallbackReason: 'quota_exceeded',
    })

    const result = await resolveMarketEvidenceWithFallback({
      supabase: createSupabaseMock({
        ttlHours: 24,
        latestEvidence: {
          id: 'evidence-1',
          data: {
            marketHourlyRate: 11000,
            marketRateRange: { min: 8000, max: 14000 },
            marketEstimatedHoursMultiplier: 1.7,
            typicalTeamSize: 6,
            typicalDurationMonths: 5,
            monthlyUnitPrice: 1300000,
            trends: ['cached trend'],
            risks: ['cached risk'],
            summary: 'cached summary',
          },
          citations: [{ url: 'https://cached.example.com', type: 'web' }],
          confidence_score: 0.66,
          summary: 'cached summary',
          retrieved_at: '2026-02-10T00:00:00.000Z',
        },
      }),
      projectId: 'project-1',
      projectType: 'new_project',
      fetched,
      now: new Date('2026-02-13T00:00:00.000Z'),
    })

    expect(result.reusedPrevious).toBe(true)
    expect(result.stale).toBe(true)
    expect(result.warning).toContain('鮮度警告')
    expect(result.result.citations).toHaveLength(1)
    expect(result.result.evidence.summary).toContain('cached summary')
  })

  it('returns fetched evidence when no reusable historical row exists', async () => {
    const fetched = createFetched({
      citations: [],
      isFallback: true,
      fallbackReason: 'upstream_error',
    })

    const result = await resolveMarketEvidenceWithFallback({
      supabase: createSupabaseMock({ latestEvidence: null }),
      projectId: 'project-1',
      projectType: 'new_project',
      fetched,
      now: new Date('2026-02-13T00:00:00.000Z'),
    })

    expect(result.reusedPrevious).toBe(false)
    expect(result.result.isFallback).toBe(true)
    expect(result.result.citations).toHaveLength(0)
  })
})
