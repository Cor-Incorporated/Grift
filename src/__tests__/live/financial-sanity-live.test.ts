// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { sendMessage } from '@/lib/ai/anthropic'
import { getSpecGenerationPrompt } from '@/lib/ai/system-prompts'
import { classifyBusinessLine } from '@/lib/business-line/classifier'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'
import { evaluateGoNoGo } from '@/lib/approval/go-no-go'
import { generateValueProposition } from '@/lib/estimates/value-proposition'

function createMockSupabase(activeProjectCount: number) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue({
            count: activeProjectCount,
            error: null,
          }),
        }),
      }),
    }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// ---------------------------------------------------------------------------
// Group 1: Pricing Hierarchy Sanity (no API calls needed, fast)
// ---------------------------------------------------------------------------

describe('Pricing Hierarchy Sanity', () => {
  it('pricing order: new_project > feature_addition > bug_report', () => {
    const newProjectPrice = calculatePrice({
      policy: defaultPolicyFor('new_project'),
      market: { teamSize: 6, durationMonths: 6, monthlyUnitPrice: 2_500_000 },
    })
    const featurePrice = calculatePrice({
      policy: defaultPolicyFor('feature_addition'),
      market: { teamSize: 4, durationMonths: 2, monthlyUnitPrice: 2_500_000 },
    })
    const bugPrice = calculatePrice({
      policy: defaultPolicyFor('bug_report'),
      market: { teamSize: 2, durationMonths: 1, monthlyUnitPrice: 2_500_000 },
    })

    expect(newProjectPrice.ourPrice).toBeGreaterThan(featurePrice.ourPrice)
    expect(featurePrice.ourPrice).toBeGreaterThan(bugPrice.ourPrice)

    expect(newProjectPrice.marketTotal).toBeGreaterThan(featurePrice.marketTotal)
    expect(featurePrice.marketTotal).toBeGreaterThan(bugPrice.marketTotal)
  })

  it('minimum project fees enforce pricing floor', () => {
    const tinyMarket = { teamSize: 1, durationMonths: 1, monthlyUnitPrice: 100_000 }

    const newProjectPrice = calculatePrice({
      policy: defaultPolicyFor('new_project'),
      market: tinyMarket,
    })
    const featurePrice = calculatePrice({
      policy: defaultPolicyFor('feature_addition'),
      market: tinyMarket,
    })
    const bugPrice = calculatePrice({
      policy: defaultPolicyFor('bug_report'),
      market: tinyMarket,
    })

    expect(newProjectPrice.ourPrice).toBeGreaterThanOrEqual(2_000_000)
    expect(featurePrice.ourPrice).toBeGreaterThanOrEqual(1_000_000)
    expect(bugPrice.ourPrice).toBeGreaterThanOrEqual(300_000)
  })

  it('cost floor prevents selling below cost', () => {
    const policy = defaultPolicyFor('new_project')
    const result = calculatePrice({
      policy,
      market: { teamSize: 10, durationMonths: 12, monthlyUnitPrice: 500_000 },
    })

    const costFloor = result.costFloor
    expect(result.ourPrice).toBeGreaterThanOrEqual(costFloor)

    if (result.ourPrice === costFloor) {
      expect(result.riskFlags).toContain('FLOOR_BREACH')
    }
  })
})

// ---------------------------------------------------------------------------
// Group 2: Red-Ink Project Detection -- Live API
// ---------------------------------------------------------------------------

describe.runIf(!!process.env.ANTHROPIC_API_KEY)('Red-Ink Project Detection -- Live API', () => {
  it('large ambiguous project with high risk should be flagged', async () => {
    const specPrompt = getSpecGenerationPrompt('new_project')
    const specMarkdown = await sendMessage(
      specPrompt,
      [
        {
          role: 'user',
          content: 'AIとブロックチェーンとIoTを組み合わせた革新的なプラットフォームを作りたい。詳細は未定だが、世界を変えるサービスにしたい。技術要件は要調査。予算は100万円で。',
        },
      ],
      { maxTokens: 2048, temperature: 0.3 }
    )

    expect(specMarkdown.length).toBeGreaterThan(0)

    const classification = await classifyBusinessLine({
      specMarkdown,
      projectType: 'new_project',
    })

    expect(classification.businessLine).toBe('iotrealm')

    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 6, durationMonths: 6, monthlyUnitPrice: 500_000 },
    })

    // Low monthlyUnitPrice → basePrice < costFloor → FLOOR_BREACH → profitability score = 0
    // 8 active projects → capacity score = 10
    // Combined: overall score reliably < 70
    const mockSupabase = createMockSupabase(8)
    const goNoGoResult = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-ambiguous-project',
      projectType: 'new_project',
      businessLine: classification.businessLine,
      pricingResult: pricing,
      specMarkdown,
      riskFlags: pricing.riskFlags,
    })

    expect(['go_with_conditions', 'no_go']).toContain(goNoGoResult.decision)
    expect(goNoGoResult.conditions.length).toBeGreaterThan(0)
    expect(goNoGoResult.reasoning).toMatch(/技術リスク/)
  }, 120_000)

  it('unprofitable project with low market price', async () => {
    const specPrompt = getSpecGenerationPrompt('new_project')
    const specMarkdown = await sendMessage(
      specPrompt,
      [
        {
          role: 'user',
          content: 'シンプルなランディングページを1ページ作ってください。テキストと画像を配置するだけです。',
        },
      ],
      { maxTokens: 2048, temperature: 0.3 }
    )

    expect(specMarkdown.length).toBeGreaterThan(0)

    const classification = await classifyBusinessLine({
      specMarkdown,
      projectType: 'new_project',
    })

    expect(classification.businessLine).toBe('boltsite')

    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 2, durationMonths: 1, monthlyUnitPrice: 800_000 },
    })

    const minimumProjectFee = policy.minimumProjectFee
    const costFloor = pricing.costFloor

    expect(
      pricing.ourPrice >= minimumProjectFee || pricing.ourPrice >= costFloor
    ).toBe(true)

    if (pricing.marginPercent < policy.minimumMarginPercent) {
      expect(pricing.riskFlags).toContain('LOW_MARGIN')
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------
// Group 3: Financial Coherence Across the Pipeline -- Live API
// ---------------------------------------------------------------------------

describe.runIf(!!process.env.ANTHROPIC_API_KEY)('Financial Coherence Across the Pipeline -- Live API', () => {
  it('enterprise SaaS project -- full pipeline coherence', async () => {
    const specPrompt = getSpecGenerationPrompt('new_project')
    const specMarkdown = await sendMessage(
      specPrompt,
      [
        {
          role: 'user',
          content: 'エンタープライズ向けのプロジェクト管理SaaS。Next.js、PostgreSQL、AWS。100社以上の導入を目指す。セキュリティはSOC2準拠。予算3000万円、1年計画。',
        },
      ],
      { maxTokens: 2048, temperature: 0.3 }
    )

    expect(specMarkdown.length).toBeGreaterThan(0)

    const classification = await classifyBusinessLine({
      specMarkdown,
      projectType: 'new_project',
    })

    expect(classification.businessLine).toBe('iotrealm')

    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 6, durationMonths: 12, monthlyUnitPrice: 2_500_000 },
    })

    const mockSupabase = createMockSupabase(1)
    const goNoGoResult = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-enterprise-saas',
      projectType: 'new_project',
      businessLine: classification.businessLine,
      pricingResult: pricing,
      specMarkdown,
      riskFlags: pricing.riskFlags,
    })

    expect(goNoGoResult.decision).toBe('go')

    const valueProp = await generateValueProposition({
      specMarkdown,
      similarProjects: [],
      goNoGoResult,
      pricingResult: pricing,
      businessLine: classification.businessLine,
    })

    expect(valueProp.marketComparison.marketPrice).toBe(pricing.marketTotal)
    expect(valueProp.marketComparison.ourPrice).toBe(pricing.ourPrice)
    expect(valueProp.marketComparison.savingsPercent).toBeGreaterThan(0)
    expect(valueProp.generatedMarkdown.length).toBeGreaterThan(0)
    expect(valueProp.uniqueStrengths.length).toBeGreaterThanOrEqual(3)
  }, 120_000)

  it('value proposition reflects go/no-go conditions', async () => {
    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 2, durationMonths: 1, monthlyUnitPrice: 800_000 },
    })

    const specMarkdown = '要調査事項多数。未定の技術要件あり。検討中の仕様多数。予算は未確定。'

    const mockSupabase = createMockSupabase(6)
    const goNoGoResult = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-risky-value-prop',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: pricing,
      specMarkdown,
      riskFlags: pricing.riskFlags,
    })

    expect(goNoGoResult.conditions.length).toBeGreaterThan(0)

    const valueProp = await generateValueProposition({
      specMarkdown,
      similarProjects: [],
      goNoGoResult,
      pricingResult: pricing,
      businessLine: 'iotrealm',
    })

    expect(valueProp.riskMitigations.length).toBeGreaterThan(0)
  }, 120_000)
})

// ---------------------------------------------------------------------------
// Group 4: Misclassification Financial Impact Calculator
// ---------------------------------------------------------------------------

describe('Misclassification Financial Impact Calculator', () => {
  it('quantify the cost of bug_report vs feature_addition misclassification', () => {
    const scenarios = [
      { label: 'small', teamSize: 2, months: 1 },
      { label: 'medium', teamSize: 4, months: 3 },
      { label: 'large', teamSize: 6, months: 6 },
    ]

    let cumulativeMisclassificationRisk = 0

    for (const scenario of scenarios) {
      const market = {
        teamSize: scenario.teamSize,
        durationMonths: scenario.months,
        monthlyUnitPrice: 2_000_000,
      }

      const bugPrice = calculatePrice({
        policy: defaultPolicyFor('bug_report'),
        market,
      })
      const featurePrice = calculatePrice({
        policy: defaultPolicyFor('feature_addition'),
        market,
      })
      const newProjectPrice = calculatePrice({
        policy: defaultPolicyFor('new_project'),
        market,
      })

      expect(featurePrice.ourPrice).toBeGreaterThan(bugPrice.ourPrice)
      expect(newProjectPrice.ourPrice).toBeGreaterThanOrEqual(featurePrice.ourPrice)

      cumulativeMisclassificationRisk += featurePrice.ourPrice - bugPrice.ourPrice
    }

    expect(cumulativeMisclassificationRisk).toBeGreaterThan(3_000_000)
  })
})
