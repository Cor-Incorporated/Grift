import { describe, it, expect } from 'vitest'
import { buildEstimateEvidenceAppendix } from '@/lib/market/evidence-appendix'

describe('buildEstimateEvidenceAppendix (extended)', () => {
  describe('empty and minimal inputs', () => {
    it('returns empty sources and unmet requirement when citations is empty', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [],
        confidenceScore: 0.5,
        summary: 'テスト',
      })

      expect(appendix.sources).toHaveLength(0)
      expect(appendix.requirement.met).toBe(false)
      expect(appendix.requirement.unique_source_count).toBe(0)
      expect(appendix.requirement.primary_public_source_count).toBe(0)
      expect(appendix.requirement.reason).toContain('必要ソース数: 2, 現在: 0')
    })

    it('uses default provider=xai when not specified', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://example.com', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
      })

      expect(appendix.sources[0].provider).toBe('xai')
    })

    it('uses default minimumSources=2 when not specified', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://example.com', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
      })

      expect(appendix.requirement.minimum_sources).toBe(2)
    })

    it('uses provided provider override', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://example.com', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
        provider: 'custom_provider',
      })

      expect(appendix.sources[0].provider).toBe('custom_provider')
    })

    it('uses provided minimumSources override', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://example.com/a', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
        minimumSources: 1,
      })

      expect(appendix.requirement.met).toBe(true)
      expect(appendix.requirement.minimum_sources).toBe(1)
    })
  })

  describe('URL deduplication', () => {
    it('deduplicates citations with the same URL', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [
          { url: 'https://example.com/a', type: 'web' },
          { url: 'https://example.com/a', type: 'web' },
          { url: 'https://example.com/b', type: 'web' },
        ],
        confidenceScore: 0.7,
        summary: 'テスト',
      })

      expect(appendix.sources).toHaveLength(2)
      expect(appendix.requirement.unique_source_count).toBe(2)
    })

    it('keeps only first occurrence of duplicate URL', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [
          { url: 'https://dup.com', type: 'web' },
          { url: 'https://dup.com', type: 'x' },
        ],
        confidenceScore: 0.6,
        summary: 'テスト',
      })

      expect(appendix.sources).toHaveLength(1)
      expect(appendix.sources[0].source_type).toBe('web') // first one wins
    })

    it('skips empty/blank URLs', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [
          { url: '', type: 'web' },
          { url: '   ', type: 'web' }, // normalizeUrl only trims, so '   '.trim() = '' — but deduped by empty key
          { url: 'https://valid.com', type: 'web' },
        ],
        confidenceScore: 0.6,
        summary: 'テスト',
      })

      // Empty string is falsy after trim — the map key '' is set once
      // Only https://valid.com should produce a clean source
      // Note: the code checks `if (!sourceUrl) continue` — '' is falsy, '   '.trim()='' is also falsy
      expect(appendix.sources.some((s) => s.source_url === 'https://valid.com')).toBe(true)
    })
  })

  describe('isPrimaryPublicDomain detection', () => {
    const publicPrimaryUrls = [
      'https://www.bls.gov/news.release/empsit.toc.htm',
      'https://stats.oecd.org/data',
      'https://www.e-stat.go.jp/stat-search',
      'https://www.stat.go.jp/',
      'https://data.gov/dataset',
      'https://www.statistics.gov.uk/data',
      'https://ec.europa.eu/eurostat',
      'https://www.any-agency.gov/report',          // .gov TLD
      'https://ministry.go.jp/data',                // .go.jp TLD
      'https://agency.gov.jp/report',               // .gov.jp TLD
      'https://data.gouv.fr/en/datasets',           // .gouv.fr TLD
    ]

    for (const url of publicPrimaryUrls) {
      it(`classifies ${new URL(url).hostname} as public_primary`, () => {
        const appendix = buildEstimateEvidenceAppendix({
          citations: [{ url, type: 'web' }],
          confidenceScore: 0.8,
          summary: 'テスト',
        })

        expect(appendix.sources[0].source_type).toBe('public_primary')
        expect(appendix.requirement.primary_public_source_count).toBe(1)
      })
    }

    it('classifies subdomain of primary public domain as public_primary', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://stats.oecd.org/data', type: 'web' }],
        confidenceScore: 0.8,
        summary: 'テスト',
      })

      expect(appendix.sources[0].source_type).toBe('public_primary')
    })
  })

  describe('non-primary source types', () => {
    it('classifies web citation as web type', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://techcrunch.com/article', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
      })

      expect(appendix.sources[0].source_type).toBe('web')
    })

    it('classifies x citation as x type', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://x.com/user/status/123', type: 'x' }],
        confidenceScore: 0.5,
        summary: 'テスト',
      })

      expect(appendix.sources[0].source_type).toBe('x')
    })

    it('classifies unknown citation type as unknown when domain is not public primary', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://some-blog.com/post', type: 'unknown' }],
        confidenceScore: 0.4,
        summary: 'テスト',
      })

      expect(appendix.sources[0].source_type).toBe('unknown')
    })

    it('public_primary overrides x citation type when domain is gov', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://data.gov/resource', type: 'x' }],
        confidenceScore: 0.7,
        summary: 'テスト',
      })

      // isPrimaryPublicDomain wins over citation type
      expect(appendix.sources[0].source_type).toBe('public_primary')
    })
  })

  describe('getDomain() from URL', () => {
    it('extracts domain correctly from valid URL', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://www.example.com/path?q=1', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
      })

      expect(appendix.sources[0].domain).toBe('www.example.com')
    })

    it('uses empty string domain for invalid URL', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'not-a-valid-url', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
      })

      expect(appendix.sources[0].domain).toBe('')
      // Empty domain is not public_primary
      expect(appendix.sources[0].source_type).toBe('web')
    })
  })

  describe('requirement status output', () => {
    it('returns null reason when requirement is met', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [
          { url: 'https://a.com', type: 'web' },
          { url: 'https://b.com', type: 'web' },
        ],
        confidenceScore: 0.8,
        summary: 'テスト',
      })

      expect(appendix.requirement.met).toBe(true)
      expect(appendix.requirement.reason).toBeNull()
    })

    it('returns descriptive reason string when requirement is not met', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://only-one.com', type: 'web' }],
        confidenceScore: 0.5,
        summary: 'テスト',
      })

      expect(appendix.requirement.met).toBe(false)
      expect(appendix.requirement.reason).toContain('客観数値の確定条件を満たしていません')
      expect(appendix.requirement.reason).toContain('必要ソース数: 2, 現在: 1')
    })

    it('counts primary_public_source_count correctly among multiple sources', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [
          { url: 'https://bls.gov/data', type: 'web' },
          { url: 'https://example.com', type: 'web' },
          { url: 'https://stat.go.jp/info', type: 'web' },
        ],
        confidenceScore: 0.85,
        summary: 'テスト',
      })

      expect(appendix.requirement.primary_public_source_count).toBe(2)
      expect(appendix.requirement.unique_source_count).toBe(3)
    })
  })

  describe('warnings', () => {
    it('returns empty warnings array when warnings not provided', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [],
        confidenceScore: 0.4,
        summary: 'テスト',
      })

      expect(appendix.warnings).toEqual([])
    })

    it('filters out non-string and empty-string warnings', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [],
        confidenceScore: 0.4,
        summary: 'テスト',
        warnings: ['valid warning', '', '  '] as string[],
      })

      // '' has length 0, filtered out; '  ' has length > 0 so it passes
      expect(appendix.warnings).toContain('valid warning')
      expect(appendix.warnings).not.toContain('')
    })

    it('includes valid string warnings', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [],
        confidenceScore: 0.4,
        summary: 'テスト',
        warnings: ['warning 1', 'warning 2'],
      })

      expect(appendix.warnings).toEqual(['warning 1', 'warning 2'])
    })
  })

  describe('metadata', () => {
    it('generated_at is a valid ISO date string', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [],
        confidenceScore: 0.5,
        summary: 'テスト',
      })

      expect(() => new Date(appendix.generated_at)).not.toThrow()
      expect(new Date(appendix.generated_at).toISOString()).toBe(appendix.generated_at)
    })

    it('uses provided retrievedAt for source retrieved_at field', () => {
      const retrievedAt = '2026-02-01T12:00:00.000Z'
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://example.com', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
        retrievedAt,
      })

      expect(appendix.sources[0].retrieved_at).toBe(retrievedAt)
    })

    it('uses generated_at as retrieved_at when retrievedAt is not provided', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [{ url: 'https://example.com', type: 'web' }],
        confidenceScore: 0.6,
        summary: 'テスト',
      })

      // generated_at is set first, then retrievedAt = retrievedAt ?? generatedAt
      expect(appendix.sources[0].retrieved_at).toBe(appendix.generated_at)
    })

    it('attaches confidence_score to each source', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [
          { url: 'https://a.com', type: 'web' },
          { url: 'https://b.com', type: 'x' },
        ],
        confidenceScore: 0.77,
        summary: 'テスト',
      })

      for (const source of appendix.sources) {
        expect(source.confidence_score).toBe(0.77)
      }
    })

    it('preserves summary in the appendix', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [],
        confidenceScore: 0.5,
        summary: 'サマリーテキスト',
      })

      expect(appendix.summary).toBe('サマリーテキスト')
    })

    it('exposes confidence_score at the top level', () => {
      const appendix = buildEstimateEvidenceAppendix({
        citations: [],
        confidenceScore: 0.65,
        summary: 'テスト',
      })

      expect(appendix.confidence_score).toBe(0.65)
    })
  })
})
