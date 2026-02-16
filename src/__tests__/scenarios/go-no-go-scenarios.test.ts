import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateGoNoGo } from '@/lib/approval/go-no-go'
import type { GoNoGoResult } from '@/lib/approval/go-no-go'
import type { PriceCalculationResult } from '@/lib/pricing/engine'
import type { BusinessLine, ProjectType } from '@/types/database'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function createMockSupabase(activeCount: number = 0, shouldError = false) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue(
            shouldError
              ? { count: null, error: new Error('DB Connection Error') }
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

interface ScenarioInput {
  activeCount?: number
  dbError?: boolean
  projectType?: ProjectType
  businessLine?: BusinessLine
  pricing?: Partial<PriceCalculationResult>
  specMarkdown?: string
  riskFlags?: string[]
}

async function runScenario(input: ScenarioInput = {}): Promise<GoNoGoResult> {
  return evaluateGoNoGo({
    supabase: createMockSupabase(input.activeCount ?? 0, input.dbError ?? false),
    projectId: 'test-project-id',
    projectType: input.projectType ?? 'new_project',
    businessLine: input.businessLine ?? 'iotrealm',
    pricingResult: createPricingResult(input.pricing),
    specMarkdown: input.specMarkdown ?? '明確な仕様書。リスクなし。',
    riskFlags: input.riskFlags ?? [],
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Go/No-Go Decision Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Scenario 1: 理想案件 → go
  // -------------------------------------------------------------------------
  it('Scenario 1: 理想案件 → go (高粗利率, 低アクティブ, リスクなし)', async () => {
    const result = await runScenario({
      businessLine: 'iotrealm',
      projectType: 'new_project',
      activeCount: 0,
      pricing: { marginPercent: 30, ourPrice: 8_000_000, costFloor: 5_600_000 },
      riskFlags: [],
      specMarkdown: '完全な要件定義書。すべての仕様が確定済み。',
    })

    expect(result.decision).toBe('go')
    expect(result.overallScore).toBeGreaterThanOrEqual(70)
    expect(result.conditions).toHaveLength(0)
    expect(result.scores.profitability.score).toBeGreaterThan(0)
    expect(result.scores.strategicAlignment.score).toBe(95) // iotrealm + new_project
    expect(result.scores.capacity.score).toBe(100) // 0 active
    expect(result.scores.technicalRisk.score).toBe(100) // no risks
  })

  // -------------------------------------------------------------------------
  // Scenario 2: 高リスク案件 → no_go
  // -------------------------------------------------------------------------
  it('Scenario 2: 高リスク案件 → no_go (低粗利, 高アクティブ, 多リスク, 未定多数)', async () => {
    const result = await runScenario({
      activeCount: 5,
      pricing: {
        ourPrice: 4_500_000,
        costFloor: 4_000_000,
        marginPercent: 5,
      },
      riskFlags: ['RISK_1', 'RISK_2', 'RISK_3', 'RISK_4'],
      specMarkdown: '未定が多い仕様書。未定。未定。要調査。要確認。TBD。検討中。未決定。',
    })

    expect(result.decision).toBe('no_go')
    expect(result.overallScore).toBeLessThan(40)
    expect(result.conditions.length).toBeGreaterThan(0)
    expect(result.scores.profitability.score).toBeLessThan(50)
    expect(result.scores.technicalRisk.score).toBeLessThan(50)
  })

  // -------------------------------------------------------------------------
  // Scenario 3: 条件付き Go → go_with_conditions
  // -------------------------------------------------------------------------
  it('Scenario 3: 条件付きGo → go_with_conditions (中粗利, 高アクティブ, リスク中)', async () => {
    // Need overallScore in [40, 70) range
    // marginPercent 8 → score = min(100, 8*5) = 40
    // iotrealm + new_project → strategic = 95
    // activeCount 5 → capacity = max(10, 100-75) = 25
    // 2 riskFlags (30pts) + 2 uncertain (10pts) → score = max(0, 100-40) = 60
    // Weighted: 40*0.35 + 95*0.25 + 25*0.2 + 60*0.2 = 14 + 23.75 + 5 + 12 = 54.75 → rounds to 55
    const result = await runScenario({
      activeCount: 5,
      pricing: { marginPercent: 8 },
      riskFlags: ['RISK_1', 'RISK_2'],
      specMarkdown: '概要はあるが未定の項目あり。要確認事項もある。',
    })

    expect(result.decision).toBe('go_with_conditions')
    expect(result.overallScore).toBeGreaterThanOrEqual(40)
    expect(result.overallScore).toBeLessThan(70)
  })

  // -------------------------------------------------------------------------
  // Scenario 4: 収益性のみ低 → conditions include 価格調整
  // -------------------------------------------------------------------------
  it('Scenario 4: 収益性のみ低 → conditions に「価格調整」を含む', async () => {
    const result = await runScenario({
      activeCount: 0,
      pricing: { marginPercent: 10, ourPrice: 5_000_000, costFloor: 4_500_000 },
      riskFlags: [],
      specMarkdown: '明確な仕様書。リスクなし。',
    })

    // marginPercent 10% → score = min(100, 10*5) = 50
    // profitability.score = 50 → no condition (threshold is < 50)
    // Actually 50 is exactly at the boundary: < 50 is false
    // So let's verify the exact score
    expect(result.scores.profitability.score).toBe(50)
    // Score of 50 is NOT < 50, so profitability condition is NOT added
    // Let's also test with marginPercent 9.9 to trigger the condition
    const result2 = await runScenario({
      activeCount: 0,
      pricing: { marginPercent: 9, ourPrice: 4_800_000, costFloor: 4_368_000 },
      riskFlags: [],
      specMarkdown: '明確な仕様書。リスクなし。',
    })

    expect(result2.scores.profitability.score).toBe(45)
    expect(result2.conditions).toContain('収益性の改善が必要（価格調整または工数削減）')
  })

  // -------------------------------------------------------------------------
  // Scenario 5: キャパ逼迫 → conditions include リソース追加
  // -------------------------------------------------------------------------
  it('Scenario 5: キャパシティ逼迫 → conditions に「リソース追加」を含む', async () => {
    const result = await runScenario({
      activeCount: 5,
      pricing: { marginPercent: 30 },
      riskFlags: [],
      specMarkdown: '明確な仕様書。',
    })

    // active 5: score = max(10, 100 - 5*15) = max(10, 25) = 25
    expect(result.scores.capacity.score).toBe(25)
    expect(result.scores.capacity.activeProjectCount).toBe(5)
    expect(result.conditions).toContain('チームキャパシティの確保が必要（既存案件の完了待ちまたはリソース追加）')
  })

  // -------------------------------------------------------------------------
  // Scenario 6: 技術リスク高 → conditions include PoC
  // -------------------------------------------------------------------------
  it('Scenario 6: 技術リスク高 → conditions に「PoC」を含む', async () => {
    const result = await runScenario({
      activeCount: 0,
      pricing: { marginPercent: 30 },
      riskFlags: ['COMPLEX_ARCH', 'UNKNOWN_TECH', 'INTEGRATION_RISK'],
      specMarkdown: '未定の項目が多い。未定。未定。未定。未定。未定。',
    })

    // risk: 3 flags * 15 = 45, 5 uncertain * 5 = 25, total 70
    // score = max(0, 100 - 70) = 30
    expect(result.scores.technicalRisk.score).toBeLessThan(50)
    expect(result.conditions).toContain('技術リスクの低減が必要（未確定事項の解消またはPoCの実施）')
  })

  // -------------------------------------------------------------------------
  // Scenario 7: 戦略不適合 → conditions include 再確認
  // -------------------------------------------------------------------------
  it('Scenario 7: 戦略不適合 → conditions に「再確認」を含む', async () => {
    const result = await runScenario({
      businessLine: 'tapforge',
      projectType: 'undetermined',
      activeCount: 0,
      pricing: { marginPercent: 25 },
      riskFlags: [],
      specMarkdown: '明確な仕様書。',
    })

    // tapforge + undetermined = 45
    expect(result.scores.strategicAlignment.score).toBe(45)
    expect(result.conditions).toContain('事業戦略との整合性を再確認')
  })

  // -------------------------------------------------------------------------
  // Scenario 8: 各事業ライン×各案件タイプのスコア表
  // -------------------------------------------------------------------------
  describe('Scenario 8: 事業ライン×案件タイプ スコアマトリクス', () => {
    const expectedScores: Record<BusinessLine, Record<string, number>> = {
      boltsite: {
        new_project: 90,
        feature_addition: 80,
        fix_request: 70,
        bug_report: 60,
        undetermined: 50,
      },
      iotrealm: {
        new_project: 95,
        feature_addition: 85,
        fix_request: 75,
        bug_report: 65,
        undetermined: 60,
      },
      tapforge: {
        new_project: 85,
        feature_addition: 75,
        fix_request: 65,
        bug_report: 55,
        undetermined: 45,
      },
    }

    const businessLines: BusinessLine[] = ['boltsite', 'iotrealm', 'tapforge']
    const projectTypes: ProjectType[] = ['new_project', 'bug_report', 'fix_request', 'feature_addition', 'undetermined']

    for (const bl of businessLines) {
      for (const pt of projectTypes) {
        it(`${bl} × ${pt} → score ${expectedScores[bl][pt]}`, async () => {
          const result = await runScenario({
            businessLine: bl,
            projectType: pt,
            activeCount: 0,
            pricing: { marginPercent: 30 },
            riskFlags: [],
            specMarkdown: '明確な仕様。',
          })

          expect(result.scores.strategicAlignment.score).toBe(expectedScores[bl][pt])
          expect(result.scores.strategicAlignment.businessLine).toBe(bl)
        })
      }
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 9: ボーダーライン70点 → go
  // -------------------------------------------------------------------------
  it('Scenario 9: ボーダーライン 70点 → go', async () => {
    // We need overallScore = 70 exactly
    // Weights: profitability=0.35, strategic=0.25, capacity=0.2, risk=0.2
    // Let's target: profit=100, strategic=60(iotrealm+undetermined), capacity=30, risk=50
    // 100*0.35 + 60*0.25 + 30*0.2 + 50*0.2 = 35 + 15 + 6 + 10 = 66 — too low
    // Try: profit=100, strategic=60, capacity=50, risk=75
    // 35 + 15 + 10 + 15 = 75 — too high
    // profit=80, strategic=60, capacity=50, risk=70
    // 28 + 15 + 10 + 14 = 67 — close
    // profit=100, strategic=60, capacity=50, risk=50
    // 35 + 15 + 10 + 10 = 70 — exact!

    // profit=100: marginPercent >= 20 (score = min(100, mp*5)), mp=20 → score=100
    // strategic=60: iotrealm+undetermined=60 ✓
    // capacity=50: DB error → score=50 ✓
    // risk=50: 100 - riskPoints = 50 → riskPoints=50 → e.g. 3 flags (45) + 1 uncertain (5) = 50

    const result = await runScenario({
      businessLine: 'iotrealm',
      projectType: 'undetermined',
      dbError: true,
      pricing: { marginPercent: 20 },
      riskFlags: ['R1', 'R2', 'R3'],
      specMarkdown: '仕様書に未定が1箇所。',
    })

    expect(result.overallScore).toBe(70)
    expect(result.decision).toBe('go')
  })

  // -------------------------------------------------------------------------
  // Scenario 10: ボーダーライン39点 → no_go
  // -------------------------------------------------------------------------
  it('Scenario 10: ボーダーライン 39点 → no_go', async () => {
    // Weights: profitability=0.35, strategic=0.25, capacity=0.2, risk=0.2
    // Target: overallScore = 39
    // profit=0: ourPrice <= costFloor
    // strategic=45: tapforge+undetermined
    // capacity=50: DB error
    // risk=70: riskPoints=30 → e.g. 2 flags (30)
    // 0*0.35 + 45*0.25 + 50*0.2 + 70*0.2 = 0 + 11.25 + 10 + 14 = 35.25 → rounds to 35

    // Try: profit=0, strategic=60(iotrealm+undetermined), capacity=50, risk=55
    // 0 + 15 + 10 + 11 = 36

    // profit=20, strategic=45, capacity=50, risk=50
    // 7 + 11.25 + 10 + 10 = 38.25 → rounds to 38

    // profit=25, strategic=45, capacity=50, risk=50
    // 8.75 + 11.25 + 10 + 10 = 40 → rounds to 40 → go_with_conditions

    // profit=20, strategic=45, capacity=50, risk=55
    // 7 + 11.25 + 10 + 11 = 39.25 → rounds to 39

    // marginPercent 4 → score=20, tapforge+undetermined=45, DB error=50, riskPoints=45 → score=55
    const result = await runScenario({
      businessLine: 'tapforge',
      projectType: 'undetermined',
      dbError: true,
      pricing: { marginPercent: 4 },
      riskFlags: ['R1', 'R2', 'R3'],
      specMarkdown: '仕様書。',
    })

    expect(result.overallScore).toBe(39)
    expect(result.decision).toBe('no_go')
  })

  // -------------------------------------------------------------------------
  // Scenario 11: Supabase エラー時のキャパシティ → score 50
  // -------------------------------------------------------------------------
  it('Scenario 11: Supabase エラー時 → capacity score 50, activeCount -1', async () => {
    const result = await runScenario({
      dbError: true,
      pricing: { marginPercent: 30 },
      riskFlags: [],
      specMarkdown: '明確な仕様。',
    })

    expect(result.scores.capacity.score).toBe(50)
    expect(result.scores.capacity.activeProjectCount).toBe(-1)
    expect(result.scores.capacity.details).toContain('失敗')
  })

  // -------------------------------------------------------------------------
  // Scenario 12: 条件文の内容確認
  // -------------------------------------------------------------------------
  describe('Scenario 12: 条件文の内容が日本語で適切', () => {
    it('収益性の条件文には「価格調整」「工数削減」を含む', async () => {
      const result = await runScenario({
        pricing: { marginPercent: 5 },
      })

      const profitCondition = result.conditions.find((c) => c.includes('収益性'))
      expect(profitCondition).toBeDefined()
      expect(profitCondition).toContain('価格調整')
      expect(profitCondition).toContain('工数削減')
    })

    it('キャパシティの条件文には「完了待ち」「リソース追加」を含む', async () => {
      const result = await runScenario({
        activeCount: 7,
      })

      const capCondition = result.conditions.find((c) => c.includes('キャパシティ'))
      expect(capCondition).toBeDefined()
      expect(capCondition).toContain('完了待ち')
      expect(capCondition).toContain('リソース追加')
    })

    it('技術リスクの条件文には「未確定事項」「PoC」を含む', async () => {
      const result = await runScenario({
        riskFlags: ['R1', 'R2', 'R3', 'R4'],
        specMarkdown: '未定。未定。未定。未定。未定。未定。未定。',
      })

      const riskCondition = result.conditions.find((c) => c.includes('技術リスク'))
      expect(riskCondition).toBeDefined()
      expect(riskCondition).toContain('未確定事項')
      expect(riskCondition).toContain('PoC')
    })

    it('戦略不適合の条件文には「再確認」を含む', async () => {
      const result = await runScenario({
        businessLine: 'tapforge',
        projectType: 'undetermined',
      })

      const strategyCondition = result.conditions.find((c) => c.includes('事業戦略'))
      expect(strategyCondition).toBeDefined()
      expect(strategyCondition).toContain('再確認')
    })
  })

  // -------------------------------------------------------------------------
  // Additional scoring edge cases
  // -------------------------------------------------------------------------
  describe('スコアリング境界値', () => {
    it('ourPrice が costFloor 以下 → profitability score 0', async () => {
      const result = await runScenario({
        pricing: {
          ourPrice: 3_000_000,
          costFloor: 4_000_000,
          marginPercent: -33,
        },
      })

      expect(result.scores.profitability.score).toBe(0)
    })

    it('activeCount 2以下 → capacity score 100', async () => {
      const result = await runScenario({ activeCount: 2 })
      expect(result.scores.capacity.score).toBe(100)
    })

    it('activeCount 3 → capacity score = max(30, 100 - 25) = 75', async () => {
      const result = await runScenario({ activeCount: 3 })
      expect(result.scores.capacity.score).toBe(75)
    })

    it('activeCount 4 → capacity score = max(30, 100 - 50) = 50', async () => {
      const result = await runScenario({ activeCount: 4 })
      expect(result.scores.capacity.score).toBe(50)
    })

    it('riskFlags なし + 未定用語なし → risk score 100', async () => {
      const result = await runScenario({
        riskFlags: [],
        specMarkdown: '完全に確定した仕様書。',
      })

      expect(result.scores.technicalRisk.score).toBe(100)
    })

    it('reasoning に全4スコアの詳細を含む', async () => {
      const result = await runScenario()

      expect(result.reasoning).toContain('総合スコア')
      expect(result.reasoning).toContain('収益性')
      expect(result.reasoning).toContain('戦略適合性')
      expect(result.reasoning).toContain('キャパシティ')
      expect(result.reasoning).toContain('技術リスク')
    })
  })
})
