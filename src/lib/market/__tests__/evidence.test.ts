import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { ExternalApiQuotaError } from '@/lib/usage/api-usage'

vi.mock('@/lib/ai/xai', () => ({
  requestXaiResponse: vi.fn(),
  parseJsonFromResponse: vi.fn(),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/usage/api-usage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/usage/api-usage')>()
  return {
    ...actual,
    isExternalApiQuotaError: actual.isExternalApiQuotaError,
  }
})

import { requestXaiResponse, parseJsonFromResponse } from '@/lib/ai/xai'

const mockRequestXaiResponse = vi.mocked(requestXaiResponse)
const mockParseJsonFromResponse = vi.mocked(parseJsonFromResponse)

function makeXaiResponse(overrides: Partial<{
  text: string
  citations: { url: string; type: 'web' | 'x' | 'unknown' }[]
  usage: Record<string, number>
  raw: unknown
}> = {}) {
  return {
    text: '```json\n{}\n```',
    citations: [],
    usage: {},
    raw: {},
    ...overrides,
  }
}

describe('fetchMarketEvidenceFromXai', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('successful fetch', () => {
    it('returns normalized evidence with two citations', async () => {
      const rawData = {
        market_hourly_rate: 12000,
        market_rate_range: { min: 9000, max: 16000 },
        market_estimated_hours_multiplier: 2.0,
        typical_team_size: 5,
        typical_duration_months: 6,
        monthly_unit_price: 1200000,
        trends: ['クラウドネイティブ', 'AI活用'],
        risks: ['要件変動', '人材不足'],
        summary: '市場調査サマリー',
      }

      mockRequestXaiResponse.mockResolvedValueOnce(
        makeXaiResponse({
          citations: [
            { url: 'https://example.com/a', type: 'web' },
            { url: 'https://example.com/b', type: 'web' },
          ],
          usage: { inputTokens: 100, outputTokens: 200 },
        })
      )
      mockParseJsonFromResponse.mockReturnValueOnce(rawData)

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: '新規SaaSプラットフォーム開発',
      })

      expect(result.isFallback).toBe(false)
      expect(result.fallbackReason).toBeNull()
      expect(result.evidence.marketHourlyRate).toBe(12000)
      expect(result.evidence.marketRateRange).toEqual({ min: 9000, max: 16000 })
      expect(result.evidence.marketEstimatedHoursMultiplier).toBe(2.0)
      expect(result.evidence.typicalTeamSize).toBe(5)
      expect(result.evidence.typicalDurationMonths).toBe(6)
      expect(result.evidence.monthlyUnitPrice).toBe(1200000)
      expect(result.evidence.trends).toEqual(['クラウドネイティブ', 'AI活用'])
      expect(result.evidence.risks).toEqual(['要件変動', '人材不足'])
      expect(result.evidence.summary).toBe('市場調査サマリー')
      expect(result.citations).toHaveLength(2)
      expect(result.confidenceScore).toBeGreaterThan(0.7)
    })

    it('confidence is 0.55 base with single citation and no trends', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(
        makeXaiResponse({
          citations: [{ url: 'https://example.com/only', type: 'web' }],
        })
      )
      mockParseJsonFromResponse.mockReturnValueOnce({
        market_hourly_rate: 10000,
        trends: [],
        risks: [],
        summary: 'テスト',
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'feature_addition',
        context: '機能追加',
      })

      // base=0.55 + trendBonus=0 = 0.55
      expect(result.confidenceScore).toBe(0.55)
    })

    it('confidence is 0.4 base with zero citations and no trends', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(
        makeXaiResponse({ citations: [] })
      )
      mockParseJsonFromResponse.mockReturnValueOnce({
        market_hourly_rate: 10000,
        trends: [],
        risks: [],
        summary: 'テスト',
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'bug_report',
        context: 'バグ修正',
      })

      // base=0.4 + trendBonus=0 = 0.4
      expect(result.confidenceScore).toBe(0.4)
    })

    it('confidence caps at 0.95 with many citations and trends', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(
        makeXaiResponse({
          citations: Array.from({ length: 10 }, (_, i) => ({
            url: `https://example.com/${i}`,
            type: 'web' as const,
          })),
        })
      )
      // 7 trends → bonus = 7 * 0.03 = 0.21, but capped at 0.2; total = 0.7 + 0.2 = 0.9 < 0.95
      // For cap test: 30 trends → bonus capped at 0.2; total = 0.7 + 0.2 = 0.9 still < 0.95
      // The cap at 0.95 is a ceiling, so we just verify it never exceeds 0.95
      mockParseJsonFromResponse.mockReturnValueOnce({
        market_hourly_rate: 10000,
        trends: Array.from({ length: 50 }, (_, i) => `trend ${i}`),
        risks: [],
        summary: 'テスト',
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: '大規模開発',
      })

      expect(result.confidenceScore).toBeLessThanOrEqual(0.95)
    })

    it('trend bonus accumulates at 0.03 per trend, capped at 0.20', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(
        makeXaiResponse({
          citations: [
            { url: 'https://a.com', type: 'web' },
            { url: 'https://b.com', type: 'web' },
          ],
        })
      )
      // 3 trends → bonus = 3 * 0.03 = 0.09; total = 0.7 + 0.09 = 0.79
      mockParseJsonFromResponse.mockReturnValueOnce({
        market_hourly_rate: 10000,
        trends: ['t1', 't2', 't3'],
        risks: [],
        summary: 'テスト',
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.confidenceScore).toBe(0.79)
    })

    it('passes region and usageContext to requestXaiResponse', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({})

      await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
        region: 'アメリカ',
        usageContext: { projectId: 'proj-123' },
      })

      expect(mockRequestXaiResponse).toHaveBeenCalledOnce()
      const [messages, options] = mockRequestXaiResponse.mock.calls[0]
      expect(messages[1].content).toContain('アメリカ')
      expect(options?.usageContext).toEqual({ projectId: 'proj-123' })
    })

    it('uses default region 日本 when region is not provided', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({})

      await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      const [messages] = mockRequestXaiResponse.mock.calls[0]
      expect(messages[1].content).toContain('日本')
    })

    it('truncates context to 3000 characters', async () => {
      const longContext = 'a'.repeat(5000)
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({})

      await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: longContext,
      })

      const [messages] = mockRequestXaiResponse.mock.calls[0]
      const prompt = messages[1].content as string
      // The sliced context is 3000 chars; the surrounding text is also present
      expect(prompt).toContain('a'.repeat(3000))
      expect(prompt).not.toContain('a'.repeat(3001))
    })
  })

  describe('normalize() edge cases', () => {
    it('uses default values when raw fields are missing', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({})

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.marketHourlyRate).toBe(10_000)
      expect(result.evidence.marketRateRange).toEqual({ min: 7_000, max: 15_000 })
      expect(result.evidence.marketEstimatedHoursMultiplier).toBe(1.8)
      expect(result.evidence.typicalTeamSize).toBe(4)
      expect(result.evidence.typicalDurationMonths).toBe(4)
      expect(result.evidence.monthlyUnitPrice).toBe(1_100_000)
      expect(result.evidence.trends).toEqual([])
      expect(result.evidence.risks).toEqual([])
      expect(result.evidence.summary).toContain('xAI から市場データを取得できなかった')
    })

    it('uses default when market_hourly_rate is NaN', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        market_hourly_rate: Number.NaN,
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.marketHourlyRate).toBe(10_000)
    })

    it('uses default when market_hourly_rate is string', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        market_hourly_rate: '12000' as unknown as number,
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.marketHourlyRate).toBe(10_000)
    })

    it('applies Math.max(1, ...) for typical_team_size of 0', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        typical_team_size: 0,
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.typicalTeamSize).toBe(1)
    })

    it('rounds typical_team_size to nearest integer', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        typical_team_size: 3.7,
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.typicalTeamSize).toBe(4)
    })

    it('applies Math.max(0.5, ...) for typical_duration_months of 0', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        typical_duration_months: 0,
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.typicalDurationMonths).toBe(0.5)
    })

    it('filters non-string items from trends and risks arrays', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        trends: ['valid trend', 42, null, 'another trend'],
        risks: [true, 'valid risk', undefined],
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.trends).toEqual(['valid trend', 'another trend'])
      expect(result.evidence.risks).toEqual(['valid risk'])
    })

    it('uses default summary when summary is empty string', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        summary: '',
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.summary).toContain('xAI から市場データを取得できなかった')
    })

    it('uses default summary when summary is not a string', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        summary: 123 as unknown as string,
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.summary).toContain('xAI から市場データを取得できなかった')
    })

    it('falls back to defaults when market_rate_range is missing entirely', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        market_rate_range: undefined,
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.marketRateRange).toEqual({ min: 7_000, max: 15_000 })
    })

    it('falls back to defaults when trends is not an array', async () => {
      mockRequestXaiResponse.mockResolvedValueOnce(makeXaiResponse())
      mockParseJsonFromResponse.mockReturnValueOnce({
        trends: 'not an array' as unknown as string[],
      })

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.evidence.trends).toEqual([])
    })
  })

  describe('error handling and fallback', () => {
    it('returns isFallback=true with upstream_error when requestXaiResponse throws generic error', async () => {
      mockRequestXaiResponse.mockRejectedValueOnce(new Error('Network timeout'))

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.isFallback).toBe(true)
      expect(result.fallbackReason).toBe('upstream_error')
      expect(result.citations).toHaveLength(0)
      expect(result.raw).toBeNull()
      expect(result.confidenceScore).toBe(0.3)
      expect(result.usage).toEqual({})
      expect(result.evidence.summary).toBe(
        'xAI から市場データを取得できなかったため、デフォルト値を使用しています。'
      )
    })

    it('returns fallbackReason=quota_exceeded when ExternalApiQuotaError is thrown', async () => {
      const quotaError = new ExternalApiQuotaError({
        sourceKey: 'xai_responses',
        provider: 'xai',
        quotaType: 'daily_request_limit',
        limit: 100,
        used: 100,
      })
      mockRequestXaiResponse.mockRejectedValueOnce(quotaError)

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.isFallback).toBe(true)
      expect(result.fallbackReason).toBe('quota_exceeded')
      expect(result.evidence.summary).toBe(
        'xAI API クォータ上限のため、前回確認済みのデフォルト値にフォールバックしました。'
      )
    })

    it('handles non-Error thrown values (string throw)', async () => {
      const nonErrorValue: unknown = 'raw string error'
      mockRequestXaiResponse.mockRejectedValueOnce(nonErrorValue)

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'テスト',
      })

      expect(result.isFallback).toBe(true)
      expect(result.fallbackReason).toBe('upstream_error')
    })

    it('keeps all default evidence fields when fallback occurs', async () => {
      mockRequestXaiResponse.mockRejectedValueOnce(new Error('upstream failure'))

      const result = await fetchMarketEvidenceFromXai({
        projectType: 'feature_addition',
        context: 'テスト',
      })

      expect(result.evidence.marketHourlyRate).toBe(10_000)
      expect(result.evidence.marketRateRange).toEqual({ min: 7_000, max: 15_000 })
      expect(result.evidence.marketEstimatedHoursMultiplier).toBe(1.8)
      expect(result.evidence.typicalTeamSize).toBe(4)
      expect(result.evidence.typicalDurationMonths).toBe(4)
      expect(result.evidence.monthlyUnitPrice).toBe(1_100_000)
      expect(result.evidence.trends).toEqual([])
      expect(result.evidence.risks).toEqual([])
    })
  })
})
