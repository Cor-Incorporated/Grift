import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveMarketEvidenceWithFallback } from '@/lib/market/evidence-fallback'
import type { MarketEvidenceResult } from '@/lib/market/evidence'

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

interface SupabaseMockOptions {
  ttlHours?: number | null
  latestEvidence?: {
    id: string
    data: Record<string, unknown>
    citations: unknown[]
    confidence_score: number | null
    summary: string
    retrieved_at: string
  } | null
}

function createSupabaseMock(opts: SupabaseMockOptions): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'data_sources') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data:
                    typeof opts.ttlHours === 'number'
                      ? { freshness_ttl_hours: opts.ttlHours }
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
                      data: opts.latestEvidence ?? null,
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
        select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }
    },
  } as unknown as SupabaseClient
}

function createFetched(overrides: Partial<MarketEvidenceResult> = {}): MarketEvidenceResult {
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
    ...overrides,
  }
}

function baseStoredEvidence(overrides: Partial<{
  id: string
  data: Record<string, unknown>
  citations: unknown[]
  confidence_score: number | null
  summary: string
  retrieved_at: string
}> = {}) {
  return {
    id: 'ev-001',
    data: {
      marketHourlyRate: 11000,
      marketRateRange: { min: 8000, max: 14000 },
      marketEstimatedHoursMultiplier: 1.7,
      typicalTeamSize: 4,
      typicalDurationMonths: 3,
      monthlyUnitPrice: 1100000,
      trends: ['stored trend'],
      risks: ['stored risk'],
      summary: 'stored summary',
    },
    citations: [{ url: 'https://stored.example.com', type: 'web' }],
    confidence_score: 0.72,
    summary: 'stored summary row',
    retrieved_at: '2026-02-13T12:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveMarketEvidenceWithFallback (extended)', () => {
  describe('fresh fetch path (no fallback needed)', () => {
    it('returns fetched result directly when not a fallback and has ≥2 citations', async () => {
      const fetched = createFetched()
      const now = new Date('2026-02-14T00:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({}),
        projectId: 'proj-1',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.reusedPrevious).toBe(false)
      expect(resolution.stale).toBe(false)
      expect(resolution.warning).toBeNull()
      expect(resolution.result).toBe(fetched)
      expect(resolution.sourceRetrievedAt).toBe(now.toISOString())
    })

    it('triggers fallback fetch when isFallback=false but only 1 citation (insufficient sources)', async () => {
      const fetched = createFetched({
        citations: [{ url: 'https://only-one.com', type: 'web' }],
        isFallback: false,
      })

      const stored = baseStoredEvidence({
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T06:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-1',
        projectType: 'new_project',
        fetched,
        now,
      })

      // Only 1 citation means fetchedHasMinimumSources=false, so it looks up stored
      expect(resolution.reusedPrevious).toBe(true)
    })
  })

  describe('fallback chain: fresh stored evidence (not stale)', () => {
    it('reuses stored evidence when within TTL and marks not stale', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        retrieved_at: '2026-02-14T00:00:00.000Z',
        confidence_score: 0.8,
      })

      // now = retrieved_at + 10h — within TTL=24h
      const now = new Date('2026-02-14T10:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-1',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.reusedPrevious).toBe(true)
      expect(resolution.stale).toBe(false)
      expect(resolution.warning).not.toContain('鮮度警告')
      expect(resolution.warning).toContain('鮮度: 10h / TTL 24h')
      expect(resolution.result.confidenceScore).toBe(0.8)
      expect(resolution.result.isFallback).toBe(true)
      expect(resolution.result.fallbackReason).toBe('upstream_error')
      expect(resolution.sourceRetrievedAt).toBe('2026-02-14T00:00:00.000Z')
    })

    it('includes quota_exceeded phrasing in warning when fallbackReason is quota_exceeded', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'quota_exceeded',
      })

      const stored = baseStoredEvidence({ retrieved_at: '2026-02-14T00:00:00.000Z' })
      const now = new Date('2026-02-14T05:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-2',
        projectType: 'feature_addition',
        fetched,
        now,
      })

      expect(resolution.warning).toContain('クォータ上限')
    })

    it('includes upstream_error phrasing when fallbackReason is upstream_error', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({ retrieved_at: '2026-02-14T00:00:00.000Z' })
      const now = new Date('2026-02-14T02:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-3',
        projectType: 'bug_report',
        fetched,
        now,
      })

      expect(resolution.warning).toContain('市場根拠取得に失敗したため')
    })
  })

  describe('fallback chain: stale stored evidence', () => {
    it('marks stale=true when age exceeds TTL', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      // retrieved_at is 48h ago, TTL=24h → stale
      const stored = baseStoredEvidence({ retrieved_at: '2026-02-12T00:00:00.000Z' })
      const now = new Date('2026-02-14T00:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-4',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.stale).toBe(true)
      expect(resolution.warning).toContain('鮮度警告')
      expect(resolution.warning).toContain('48h 経過 / TTL 24h')
    })

    it('uses DEFAULT_TTL_HOURS (24) when data_sources returns no row', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      // 30h ago — beyond default TTL of 24h
      const stored = baseStoredEvidence({ retrieved_at: '2026-02-12T18:00:00.000Z' })
      const now = new Date('2026-02-14T00:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: null, latestEvidence: stored }),
        projectId: 'proj-5',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.stale).toBe(true)
    })

    it('uses configurable ttlHours from data_sources table', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      // retrieved 10h ago, TTL=48h → not stale
      const stored = baseStoredEvidence({ retrieved_at: '2026-02-13T14:00:00.000Z' })
      const now = new Date('2026-02-14T00:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 48, latestEvidence: stored }),
        projectId: 'proj-6',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.stale).toBe(false)
    })
  })

  describe('fallback chain: no stored evidence available', () => {
    it('returns fetched result directly when market_evidence table is empty', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ latestEvidence: null }),
        projectId: 'proj-7',
        projectType: 'new_project',
        fetched,
        now: new Date('2026-02-14T00:00:00.000Z'),
      })

      expect(resolution.reusedPrevious).toBe(false)
      expect(resolution.stale).toBe(false)
      expect(resolution.warning).toBeNull()
      expect(resolution.result).toBe(fetched)
    })

    it('returns fetched result when stored data is null (invalid)', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const invalidStored = baseStoredEvidence({ data: null as unknown as Record<string, unknown> })

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ latestEvidence: invalidStored }),
        projectId: 'proj-8',
        projectType: 'new_project',
        fetched,
        now: new Date('2026-02-14T00:00:00.000Z'),
      })

      expect(resolution.reusedPrevious).toBe(false)
      expect(resolution.result).toBe(fetched)
    })

    it('returns fetched result when stored data is not an object', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const invalidStored = baseStoredEvidence({ data: 'not-an-object' as unknown as Record<string, unknown> })

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ latestEvidence: invalidStored }),
        projectId: 'proj-9',
        projectType: 'new_project',
        fetched,
        now: new Date('2026-02-14T00:00:00.000Z'),
      })

      expect(resolution.reusedPrevious).toBe(false)
    })
  })

  describe('normalizeEvidence() within resolveMarketEvidenceWithFallback', () => {
    it('handles snake_case keys in stored data', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        data: {
          market_hourly_rate: 9000,
          market_rate_range: { min: 6000, max: 12000 },
          market_estimated_hours_multiplier: 1.5,
          typical_team_size: 3,
          typical_duration_months: 2,
          monthly_unit_price: 900000,
          trends: ['snake_case trend'],
          risks: ['snake_case risk'],
          summary: 'snake_case summary',
        },
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-10',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.reusedPrevious).toBe(true)
      expect(resolution.result.evidence.marketHourlyRate).toBe(9000)
      expect(resolution.result.evidence.marketRateRange).toEqual({ min: 6000, max: 12000 })
    })

    it('applies Math.max constraints for typicalTeamSize and typicalDurationMonths', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        data: {
          marketHourlyRate: 10000,
          typicalTeamSize: 0,        // should become 1
          typicalDurationMonths: 0,  // should become 0.5
          summary: 'edge case',
        },
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-11',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.evidence.typicalTeamSize).toBe(1)
      expect(resolution.result.evidence.typicalDurationMonths).toBe(0.5)
    })

    it('uses fallback confidence from fetched when stored confidence_score is null', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
        confidenceScore: 0.3,
      })

      const stored = baseStoredEvidence({
        confidence_score: null,
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-12',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.confidenceScore).toBe(0.3)
    })
  })

  describe('normalizeCitations() within resolveMarketEvidenceWithFallback', () => {
    it('converts plain string citations to XaiCitation objects', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        citations: ['https://string-url.example.com'],
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-13',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.citations).toHaveLength(1)
      expect(resolution.result.citations[0].url).toBe('https://string-url.example.com')
      expect(resolution.result.citations[0].type).toBe('unknown')
    })

    it('normalizes citation with type=web correctly', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        citations: [
          { url: 'https://web.example.com', type: 'web', id: 'ref-1', startIndex: 0, endIndex: 5 },
        ],
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-14',
        projectType: 'new_project',
        fetched,
        now,
      })

      const citation = resolution.result.citations[0]
      expect(citation.url).toBe('https://web.example.com')
      expect(citation.type).toBe('web')
      expect(citation.id).toBe('ref-1')
      expect(citation.startIndex).toBe(0)
      expect(citation.endIndex).toBe(5)
    })

    it('normalizes citation with type=x correctly', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        citations: [{ url: 'https://x.example.com', type: 'x' }],
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-15',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.citations[0].type).toBe('x')
    })

    it('skips citation objects with no url', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        citations: [
          { type: 'web' },                       // no url
          { url: '', type: 'web' },              // empty url
          { url: 'https://valid.com', type: 'web' },
        ],
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-16',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.citations).toHaveLength(1)
      expect(resolution.result.citations[0].url).toBe('https://valid.com')
    })

    it('skips null/non-object non-string citation entries', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        citations: [null, 42, true, { url: 'https://valid2.com', type: 'web' }],
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-17',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.citations).toHaveLength(1)
      expect(resolution.result.citations[0].url).toBe('https://valid2.com')
    })

    it('returns empty citations when stored citations is not an array', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        citations: 'not-an-array' as unknown as unknown[],
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-18',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.citations).toHaveLength(0)
    })

    it('maps unknown citation type to unknown', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        citations: [{ url: 'https://blog.example.com', type: 'rss' }],
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-19',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.citations[0].type).toBe('unknown')
    })

    it('uses start_index/end_index snake_case when camelCase is absent', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        citations: [{ url: 'https://snake.example.com', type: 'web', start_index: 10, end_index: 20 }],
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-20',
        projectType: 'new_project',
        fetched,
        now,
      })

      const c = resolution.result.citations[0]
      expect(c.startIndex).toBe(10)
      expect(c.endIndex).toBe(20)
    })
  })

  describe('summary composition', () => {
    it('uses stored row summary when it is non-empty', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        summary: 'Row-level summary text',
        data: { marketHourlyRate: 10000, summary: 'Data-level summary' },
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-21',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.evidence.summary).toContain('Row-level summary text')
    })

    it('falls back to normalizedEvidence summary when stored row summary is blank', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        summary: '   ', // blank
        data: { marketHourlyRate: 10000, summary: 'Data-level summary' },
        retrieved_at: '2026-02-14T00:00:00.000Z',
      })

      const now = new Date('2026-02-14T01:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-22',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.result.evidence.summary).toContain('Data-level summary')
    })

    it('appends warning to summary with newlines separator', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'quota_exceeded',
      })

      const stored = baseStoredEvidence({ retrieved_at: '2026-02-14T00:00:00.000Z' })
      const now = new Date('2026-02-14T06:00:00.000Z')

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-23',
        projectType: 'new_project',
        fetched,
        now,
      })

      const summary = resolution.result.evidence.summary
      // should contain both the row summary and the warning separated by \n\n
      expect(summary).toContain('\n\n')
      expect(summary).toContain('クォータ上限')
    })
  })

  describe('getAgeHours() with invalid date', () => {
    it('handles POSITIVE_INFINITY age when retrieved_at is invalid date string', async () => {
      const fetched = createFetched({
        citations: [],
        isFallback: true,
        fallbackReason: 'upstream_error',
      })

      const stored = baseStoredEvidence({
        retrieved_at: 'not-a-valid-date',
      })

      const now = new Date('2026-02-14T00:00:00.000Z')

      // Infinity > any TTL → stale=true
      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({ ttlHours: 24, latestEvidence: stored }),
        projectId: 'proj-24',
        projectType: 'new_project',
        fetched,
        now,
      })

      expect(resolution.stale).toBe(true)
    })
  })

  describe('now parameter defaults', () => {
    it('uses current time when now is not provided', async () => {
      const fetched = createFetched()

      const resolution = await resolveMarketEvidenceWithFallback({
        supabase: createSupabaseMock({}),
        projectId: 'proj-25',
        projectType: 'new_project',
        fetched,
      })

      // Should succeed without error
      expect(resolution.reusedPrevious).toBe(false)
      // sourceRetrievedAt should be a valid ISO date close to now
      expect(() => new Date(resolution.sourceRetrievedAt)).not.toThrow()
    })
  })
})
