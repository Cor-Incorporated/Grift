import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateGoNoGo } from '@/lib/approval/go-no-go'
import type { PriceCalculationResult } from '@/lib/pricing/engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSupabase(activeCount: number = 0, returnError = false) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue(
            returnError
              ? { count: null, error: new Error('DB failure') }
              : { count: activeCount, error: null }
          ),
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

// ---------------------------------------------------------------------------
// scoreProfitability() edge cases
// ---------------------------------------------------------------------------

describe('scoreProfitability (via evaluateGoNoGo)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns score=0 when ourPrice equals costFloor', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-1',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({
        ourPrice: 4_000_000,
        costFloor: 4_000_000,
        marginPercent: 0,
      }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(0)
    expect(result.scores.profitability.details).toContain('原価下限')
  })

  it('returns score=0 when ourPrice is below costFloor', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-2',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({
        ourPrice: 3_000_000,
        costFloor: 4_000_000,
        marginPercent: -33.3,
      }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(0)
    expect(result.scores.profitability.details).toContain('¥3,000,000')
    expect(result.scores.profitability.details).toContain('¥4,000,000')
  })

  it('caps profitability score at 100 for very high margin', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-3',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({
        ourPrice: 9_000_000,
        costFloor: 1_000_000,
        marginPercent: 80, // 80 * 5 = 400, capped at 100
      }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(100)
  })

  it('uses marginPercent * 5 formula correctly', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-4',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({
        ourPrice: 6_000_000,
        costFloor: 4_000_000,
        marginPercent: 15, // 15 * 5 = 75
      }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(75)
  })

  it('shows healthy message when marginPercent >= 20', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-5',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({ marginPercent: 25 }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.details).toContain('健全な収益性')
  })

  it('shows below-minimum message when marginPercent < 20', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-6',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({ marginPercent: 10 }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.details).toContain('最低基準(20%)を下回り')
  })

  it('profitability margin boundary: exactly 20% shows healthy', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-7',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({ marginPercent: 20 }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.details).toContain('健全な収益性')
  })
})

// ---------------------------------------------------------------------------
// scoreCapacity() with different active project counts
// ---------------------------------------------------------------------------

describe('scoreCapacity (via evaluateGoNoGo)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns score=100 when activeProjectCount=0', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-cap-0',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(100)
    expect(result.scores.capacity.activeProjectCount).toBe(0)
    expect(result.scores.capacity.details).toContain('十分なキャパシティあり')
  })

  it('returns score=100 when activeProjectCount=1', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(1),
      projectId: 'proj-cap-1',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(100)
    expect(result.scores.capacity.activeProjectCount).toBe(1)
  })

  it('returns score=100 when activeProjectCount=2 (boundary)', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(2),
      projectId: 'proj-cap-2',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(100)
    expect(result.scores.capacity.activeProjectCount).toBe(2)
  })

  it('returns score=75 when activeProjectCount=3 (in 3-4 range)', async () => {
    // Math.max(30, 100 - (3 - 2) * 25) = Math.max(30, 75) = 75
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(3),
      projectId: 'proj-cap-3',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(75)
    expect(result.scores.capacity.activeProjectCount).toBe(3)
    expect(result.scores.capacity.details).toContain('キャパシティ注意')
  })

  it('returns score=50 when activeProjectCount=4 (boundary of attention range)', async () => {
    // Math.max(30, 100 - (4 - 2) * 25) = Math.max(30, 50) = 50
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(4),
      projectId: 'proj-cap-4',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(50)
    expect(result.scores.capacity.activeProjectCount).toBe(4)
    expect(result.scores.capacity.details).toContain('キャパシティ注意')
  })

  it('returns score=Math.max(10, 100-5*15)=25 when activeProjectCount=5', async () => {
    // Math.max(10, 100 - 5 * 15) = Math.max(10, 25) = 25
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(5),
      projectId: 'proj-cap-5',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(25)
    expect(result.scores.capacity.activeProjectCount).toBe(5)
    expect(result.scores.capacity.details).toContain('キャパシティ逼迫')
  })

  it('clamps score to minimum of 10 when activeProjectCount is very high', async () => {
    // Math.max(10, 100 - 20 * 15) = Math.max(10, -200) = 10
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(20),
      projectId: 'proj-cap-20',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(10)
    expect(result.scores.capacity.details).toContain('キャパシティ逼迫')
  })

  it('returns score=50 and activeProjectCount=-1 on DB error', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0, true),
      projectId: 'proj-cap-err',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.capacity.score).toBe(50)
    expect(result.scores.capacity.activeProjectCount).toBe(-1)
    expect(result.scores.capacity.details).toContain('取得に失敗')
  })

  it('treats null count as 0 when DB returns null count without error', async () => {
    // Covers the `count ?? 0` null-coalescing branch in scoreCapacity
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue({ count: null, error: null }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof evaluateGoNoGo>[0]['supabase']

    const result = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'proj-cap-null',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    // null count → activeCount=0 → score=100
    expect(result.scores.capacity.score).toBe(100)
    expect(result.scores.capacity.activeProjectCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// scoreTechnicalRisk() edge cases
// ---------------------------------------------------------------------------

describe('scoreTechnicalRisk (via evaluateGoNoGo)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns score=100 with no risk flags and no uncertain terms', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-clean',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '明確な要件が定義されています。',
      riskFlags: [],
    })

    expect(result.scores.technicalRisk.score).toBe(100)
    expect(result.scores.technicalRisk.details).toContain('技術リスク低')
  })

  it('deducts 15 per risk flag', async () => {
    // 2 flags = -30, score = 70
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-flags',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '要件書',
      riskFlags: ['FLAG_A', 'FLAG_B'],
    })

    expect(result.scores.technicalRisk.score).toBe(70)
    expect(result.scores.technicalRisk.details).toContain('リスクフラグ2件')
  })

  it('deducts 5 per uncertain term occurrence in specMarkdown', async () => {
    // 未定 appears once = -5, score = 95
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-uncertain',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '詳細は未定です。',
      riskFlags: [],
    })

    expect(result.scores.technicalRisk.score).toBe(95)
    expect(result.scores.technicalRisk.details).toContain('未確定事項1件')
  })

  it('counts multiple uncertain terms: 未定, 要調査, 要確認, tbd, 検討中, 未決定', async () => {
    // Each term once = 6 occurrences * 5 = 30 deducted, score = 70
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-all-terms',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '未定、要調査、要確認、TBD、検討中、未決定。',
      riskFlags: [],
    })

    expect(result.scores.technicalRisk.score).toBe(70)
    expect(result.scores.technicalRisk.details).toContain('未確定事項6件')
  })

  it('matches uncertain terms case-insensitively (tbd vs TBD)', async () => {
    // TBD should be matched because specMarkdown is lowercased before counting
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-tbd',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: 'Status: TBD',
      riskFlags: [],
    })

    expect(result.scores.technicalRisk.score).toBe(95)
  })

  it('clamps score at 0 when combined risk is very high', async () => {
    // 7 flags = -105, already below 0, clamped to 0
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-clamped',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '未定、要調査、要確認、TBD、検討中、未決定。',
      riskFlags: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'],
    })

    expect(result.scores.technicalRisk.score).toBe(0)
  })

  it('shows medium risk label when score is in 40-69 range', async () => {
    // 3 flags * 15 = 45 points → score = 55
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-medium',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: ['F1', 'F2', 'F3'],
    })

    expect(result.scores.technicalRisk.score).toBe(55)
    expect(result.scores.technicalRisk.details).toContain('技術リスク中')
  })

  it('shows high risk label when score is below 40', async () => {
    // 5 flags * 15 = 75 points → score = 25
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-high',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: ['F1', 'F2', 'F3', 'F4', 'F5'],
    })

    expect(result.scores.technicalRisk.score).toBe(25)
    expect(result.scores.technicalRisk.details).toContain('技術リスク高')
  })

  it('counts repeated uncertain term occurrences within spec', async () => {
    // '未定' appears twice = 10 points deducted → score = 90
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-risk-repeat',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '詳細は未定、仕様も未定。',
      riskFlags: [],
    })

    expect(result.scores.technicalRisk.score).toBe(90)
    expect(result.scores.technicalRisk.details).toContain('未確定事項2件')
  })
})

// ---------------------------------------------------------------------------
// getWeights() for all project types
// ---------------------------------------------------------------------------

describe('getWeights (via evaluateGoNoGo scoring)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('bug_report: profitability weight=0 so pricingResult=null gives score=100 and is effectively ignored', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-w-bug',
      projectType: 'bug_report',
      businessLine: 'boltsite',
      pricingResult: null,
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(100)
    expect(result.scores.profitability.details).toContain('保証期間内')
    // For bug_report weights = {profitability:0, strategicAlignment:0.2, capacity:0.45, technicalRisk:0.35}
    // overallScore = 100*0 + alignScore*0.2 + 100*0.45 + 100*0.35 = 0 + alignScore*0.2 + 80
    expect(result.overallScore).toBeGreaterThanOrEqual(80)
  })

  it('fix_request: profitability weight=0, uses same weights as bug_report', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-w-fix',
      projectType: 'fix_request',
      businessLine: 'iotrealm',
      pricingResult: null,
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(100)
    expect(result.overallScore).toBeGreaterThanOrEqual(80)
  })

  it('new_project: profitability weight=0.35 so floor breach drastically reduces score', async () => {
    // pricingResult with price=costFloor → profitability score=0
    // weights = {profitability:0.35, strategicAlignment:0.25, capacity:0.2, technicalRisk:0.2}
    // overallScore ≈ 0*0.35 + alignScore*0.25 + 100*0.2 + 100*0.2
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-w-new',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({
        ourPrice: 3_000_000,
        costFloor: 4_000_000,
        marginPercent: -20,
      }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.profitability.score).toBe(0)
    // overallScore = 0 + 90*0.25 + 100*0.2 + 100*0.2 = 22.5 + 20 + 20 = 62.5 → 63
    // This is below 70, so not 'go'
    expect(result.decision).not.toBe('go')
  })

  it('feature_addition: uses standard weights (profitability=0.35)', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-w-feat',
      projectType: 'feature_addition',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult({ marginPercent: 30 }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    // overallScore = 100*0.35 + 85*0.25 + 100*0.2 + 100*0.2
    //             = 35 + 21.25 + 20 + 20 = 96.25 → 96
    expect(result.decision).toBe('go')
    expect(result.overallScore).toBeGreaterThanOrEqual(70)
  })
})

// ---------------------------------------------------------------------------
// Overall decision thresholds
// ---------------------------------------------------------------------------

describe('decision thresholds', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns "go" when overallScore >= 70', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-go',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult({ marginPercent: 40 }),
      specMarkdown: '明確な仕様',
      riskFlags: [],
    })

    expect(result.overallScore).toBeGreaterThanOrEqual(70)
    expect(result.decision).toBe('go')
  })

  it('returns "go_with_conditions" when overallScore is between 40 and 69', async () => {
    // Force go_with_conditions: marginPercent=10 (score=50), capacity=4 (score=50),
    // 2 risk flags (score=70), tapforge/fix_request (alignment=65)
    // weights for fix_request: {profitability:0, strategicAlignment:0.2, capacity:0.45, technicalRisk:0.35}
    // overallScore = 0 + 65*0.2 + 50*0.45 + 70*0.35 = 0 + 13 + 22.5 + 24.5 = 60
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(4),
      projectId: 'proj-gwc',
      projectType: 'fix_request',
      businessLine: 'tapforge',
      pricingResult: null,
      specMarkdown: '仕様書',
      riskFlags: ['F1', 'F2'],
    })

    expect(result.overallScore).toBeGreaterThanOrEqual(40)
    expect(result.overallScore).toBeLessThan(70)
    expect(result.decision).toBe('go_with_conditions')
  })

  it('returns "no_go" when overallScore < 40', async () => {
    // 7 risk flags → technicalRisk score=0
    // Price below floor → profitability score=0
    // activeCount=10 → capacity=Math.max(10, 100-10*15)=10
    // new_project/boltsite alignment=90
    // weights: {profitability:0.35, strategicAlignment:0.25, capacity:0.2, technicalRisk:0.2}
    // overallScore = 0*0.35 + 90*0.25 + 10*0.2 + 0*0.2 = 0 + 22.5 + 2 + 0 = 24.5 → 25
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(10),
      projectId: 'proj-nogo',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: createPricingResult({
        ourPrice: 1_000_000,
        costFloor: 4_000_000,
        marginPercent: -75,
      }),
      specMarkdown: '仕様書',
      riskFlags: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'],
    })

    expect(result.overallScore).toBeLessThan(40)
    expect(result.decision).toBe('no_go')
  })

  it('conditions list includes capacity message when capacity score < 50', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(10),
      projectId: 'proj-conditions',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult({ marginPercent: 40 }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.conditions).toContain(
      'チームキャパシティの確保が必要（既存案件の完了待ちまたはリソース追加）'
    )
  })

  it('conditions list includes technical risk message when technicalRisk score < 50', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-conditions-risk',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult({ marginPercent: 40 }),
      specMarkdown: '仕様書',
      riskFlags: ['F1', 'F2', 'F3', 'F4', 'F5'],
    })

    expect(result.conditions).toContain(
      '技術リスクの低減が必要（未確定事項の解消またはPoCの実施）'
    )
  })

  it('conditions list includes profitability message when profitability score < 50', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-conditions-profit',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult({ marginPercent: 5 }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    // marginPercent=5 → score=25 < 50
    expect(result.conditions).toContain('収益性の改善が必要（価格調整または工数削減）')
  })

  it('conditions list includes strategic alignment message when alignment score < 50', async () => {
    // tapforge/undetermined = 45
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-conditions-align',
      projectType: 'undetermined',
      businessLine: 'tapforge',
      pricingResult: createPricingResult({ marginPercent: 40 }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.conditions).toContain('事業戦略との整合性を再確認')
  })

  it('returns empty conditions array when all scores are >= 50', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-no-conditions',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult({ marginPercent: 40 }),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.conditions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// scoreStrategicAlignment() all business lines and project types
// ---------------------------------------------------------------------------

describe('scoreStrategicAlignment (via evaluateGoNoGo)', () => {
  beforeEach(() => vi.clearAllMocks())

  const alignmentMatrix: Array<{
    businessLine: 'boltsite' | 'iotrealm' | 'tapforge'
    projectType: 'new_project' | 'feature_addition' | 'fix_request' | 'bug_report' | 'undetermined'
    expectedScore: number
  }> = [
    { businessLine: 'boltsite', projectType: 'new_project', expectedScore: 90 },
    { businessLine: 'boltsite', projectType: 'feature_addition', expectedScore: 80 },
    { businessLine: 'boltsite', projectType: 'fix_request', expectedScore: 70 },
    { businessLine: 'boltsite', projectType: 'bug_report', expectedScore: 60 },
    { businessLine: 'boltsite', projectType: 'undetermined', expectedScore: 50 },
    { businessLine: 'iotrealm', projectType: 'new_project', expectedScore: 95 },
    { businessLine: 'iotrealm', projectType: 'feature_addition', expectedScore: 85 },
    { businessLine: 'iotrealm', projectType: 'fix_request', expectedScore: 75 },
    { businessLine: 'iotrealm', projectType: 'bug_report', expectedScore: 65 },
    { businessLine: 'iotrealm', projectType: 'undetermined', expectedScore: 60 },
    { businessLine: 'tapforge', projectType: 'new_project', expectedScore: 85 },
    { businessLine: 'tapforge', projectType: 'feature_addition', expectedScore: 75 },
    { businessLine: 'tapforge', projectType: 'fix_request', expectedScore: 65 },
    { businessLine: 'tapforge', projectType: 'bug_report', expectedScore: 55 },
    { businessLine: 'tapforge', projectType: 'undetermined', expectedScore: 45 },
  ]

  for (const { businessLine, projectType, expectedScore } of alignmentMatrix) {
    it(`${businessLine}/${projectType} → alignment score=${expectedScore}`, async () => {
      const result = await evaluateGoNoGo({
        supabase: createMockSupabase(0),
        projectId: `proj-align-${businessLine}-${projectType}`,
        projectType,
        businessLine,
        pricingResult: projectType === 'bug_report' || projectType === 'fix_request' ? null : createPricingResult(),
        specMarkdown: '仕様書',
        riskFlags: [],
      })

      expect(result.scores.strategicAlignment.score).toBe(expectedScore)
      expect(result.scores.strategicAlignment.businessLine).toBe(businessLine)
    })
  }

  it('falls back to score=50 for unknown businessLine', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-align-unknown',
      projectType: 'new_project',
      businessLine: 'unknown_line' as 'boltsite',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.strategicAlignment.score).toBe(50)
  })

  it('shows 高い適合性 when alignment score >= 70', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-align-high',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.strategicAlignment.details).toContain('高い適合性')
  })

  it('shows 中程度の適合性 when alignment score < 70', async () => {
    // tapforge/undetermined = 45
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(0),
      projectId: 'proj-align-medium',
      projectType: 'undetermined',
      businessLine: 'tapforge',
      pricingResult: createPricingResult(),
      specMarkdown: '仕様書',
      riskFlags: [],
    })

    expect(result.scores.strategicAlignment.details).toContain('中程度の適合性')
  })
})

// ---------------------------------------------------------------------------
// reasoning output
// ---------------------------------------------------------------------------

describe('reasoning output', () => {
  it('contains all score components in reasoning string', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(1),
      projectId: 'proj-reasoning',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult(),
      specMarkdown: '明確な仕様',
      riskFlags: [],
    })

    expect(result.reasoning).toContain('総合スコア:')
    expect(result.reasoning).toContain('収益性:')
    expect(result.reasoning).toContain('戦略適合性:')
    expect(result.reasoning).toContain('キャパシティ:')
    expect(result.reasoning).toContain('技術リスク:')
  })

  it('overallScore in reasoning matches the returned overallScore', async () => {
    const result = await evaluateGoNoGo({
      supabase: createMockSupabase(1),
      projectId: 'proj-reasoning-score',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: createPricingResult(),
      specMarkdown: '明確な仕様',
      riskFlags: [],
    })

    expect(result.reasoning).toContain(`総合スコア: ${result.overallScore}/100`)
  })
})
