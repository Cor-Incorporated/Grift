import { describe, expect, it } from 'vitest'
import { buildEstimateEvidenceAppendix } from '@/lib/market/evidence-appendix'

describe('buildEstimateEvidenceAppendix', () => {
  it('marks requirement met when two or more unique sources exist', () => {
    const appendix = buildEstimateEvidenceAppendix({
      citations: [
        { url: 'https://example.com/a', type: 'web' },
        { url: 'https://example.com/b', type: 'web' },
      ],
      confidenceScore: 0.8,
      summary: 'summary',
      retrievedAt: '2026-02-12T00:00:00.000Z',
    })

    expect(appendix.sources).toHaveLength(2)
    expect(appendix.requirement.met).toBe(true)
    expect(appendix.requirement.unique_source_count).toBe(2)
  })

  it('detects public primary sources and blocks when source count is insufficient', () => {
    const appendix = buildEstimateEvidenceAppendix({
      citations: [
        { url: 'https://www.bls.gov/news.release/empsit.toc.htm', type: 'web' },
      ],
      confidenceScore: 0.72,
      summary: 'summary',
      retrievedAt: '2026-02-12T00:00:00.000Z',
    })

    expect(appendix.sources).toHaveLength(1)
    expect(appendix.sources[0].source_type).toBe('public_primary')
    expect(appendix.requirement.primary_public_source_count).toBe(1)
    expect(appendix.requirement.met).toBe(false)
    expect(appendix.requirement.reason).toContain('必要ソース数')
  })
})
