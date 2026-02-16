import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateGoNoGo } from '../go-no-go'
import type { PriceCalculationResult } from '@/lib/pricing/engine'

function createMockSupabase(activeCount: number = 0) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue({
            count: activeCount,
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof evaluateGoNoGo>[0]['supabase']
}

function createPricingResult(overrides: Partial<PriceCalculationResult> = {}): PriceCalculationResult {
  return {
    marketTotal: 10_000_000,
    coefficient: 0.7,
    ourPrice: 7_000_000,
    costFloor: 4_000_000,
    marginPercent: 42.86,
    riskFlags: [],
    ...overrides,
  }
}

describe('evaluateGoNoGo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return "go" for healthy project', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(1),
      projectId: 'test-project-id',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult(),
      specMarkdown: '## 要件定義書\n明確な仕様が記載されています。',
      riskFlags: [],
    })

    expect(result.decision).toBe('go')
    expect(result.overallScore).toBeGreaterThanOrEqual(70)
    expect(result.conditions).toHaveLength(0)
  })

  it('should return "no_go" when price is below cost floor', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(6),
      projectId: 'test-project-id',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult({
        ourPrice: 3_000_000,
        costFloor: 4_000_000,
        marginPercent: -33.3,
        riskFlags: ['FLOOR_BREACH', 'LOW_MARGIN'],
      }),
      specMarkdown: '## 要件定義書\n未定の項目が多い。要調査。要確認。TBD。検討中。',
      riskFlags: ['FLOOR_BREACH', 'LOW_MARGIN'],
    })

    expect(result.decision).toBe('no_go')
    expect(result.overallScore).toBeLessThan(40)
    expect(result.conditions.length).toBeGreaterThan(0)
  })

  it('should return "go_with_conditions" for borderline cases', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(4),
      projectId: 'test-project-id',
      projectType: 'fix_request',
      businessLine: 'tapforge',
      pricingResult: createPricingResult({
        marginPercent: 10,
      }),
      specMarkdown: '## 要件定義書\n未定の項目が複数。要調査。要確認。検討中。',
      riskFlags: ['LOW_MARGIN', 'LOW_COEFFICIENT'],
    })

    expect(result.decision).toBe('go_with_conditions')
    expect(result.overallScore).toBeGreaterThanOrEqual(40)
    expect(result.overallScore).toBeLessThan(70)
  })

  it('should include reasoning in result', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'test-project-id',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult(),
      specMarkdown: '明確な仕様',
      riskFlags: [],
    })

    expect(result.reasoning).toContain('総合スコア')
    expect(result.reasoning).toContain('収益性')
    expect(result.reasoning).toContain('戦略適合性')
    expect(result.reasoning).toContain('キャパシティ')
    expect(result.reasoning).toContain('技術リスク')
  })

  it('should handle supabase error gracefully', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue({
              count: null,
              error: new Error('DB Error'),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof evaluateGoNoGo>[0]['supabase']

    const result = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-project-id',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書テスト',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(50)
    expect(result.scores.capacity.activeProjectCount).toBe(-1)
  })

  it('bug_report: profitability weight is 0, overall score ignores profitability', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(1),
      projectId: 'test-project-id',
      projectType: 'bug_report',
      businessLine: 'boltsite',
      pricingResult: null,
      specMarkdown: '## バグ報告\n再現手順あり。',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(100)
    expect(result.scores.profitability.details).toContain('保証期間内')
  })

  it('fix_request: profitability weight is 0', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'test-project-id',
      projectType: 'fix_request',
      businessLine: 'iotrealm',
      pricingResult: null,
      specMarkdown: '## 修正依頼',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(100)
    expect(result.decision).toBe('go')
  })
})
