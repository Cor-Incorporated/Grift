// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { classifyBusinessLine } from '@/lib/business-line/classifier'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'
import { evaluateGoNoGo } from '@/lib/approval/go-no-go'
import { generateValueProposition } from '@/lib/estimates/value-proposition'
import type { BusinessLine } from '@/types/database'

// Mock only the Supabase client used in evaluateGoNoGo for capacity check
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

describe.runIf(!!process.env.ANTHROPIC_API_KEY)('Full Sales Pipeline - Live API', () => {
  it('classifier -> pricing -> go-no-go -> value-proposition chain works end-to-end', async () => {
    // 1. Classify business line (real API call)
    const classification = await classifyBusinessLine({
      specMarkdown: 'Next.jsを使ったBtoB SaaSプラットフォームの新規開発。ユーザー認証、ダッシュボード、リアルタイム通知、チーム管理、請求・課金システムを含む。TypeScript、PostgreSQL、Tailwind CSS、Stripe決済。',
      projectType: 'new_project',
    })

    const validLines: BusinessLine[] = ['boltsite', 'iotrealm', 'tapforge']
    expect(validLines).toContain(classification.businessLine)
    expect(classification.confidence).toBeGreaterThan(0)
    expect(classification.confidence).toBeLessThanOrEqual(1)

    // 2. Calculate pricing (pure function, no API call)
    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 4, durationMonths: 6, monthlyUnitPrice: 2_500_000 },
    })

    expect(pricing.ourPrice).toBeGreaterThan(0)
    expect(pricing.marketTotal).toBe(60_000_000)
    expect(pricing.coefficient).toBe(0.7)
    expect(pricing.marginPercent).toBeGreaterThan(0)

    // 3. Evaluate go/no-go (mocked Supabase for capacity check only)
    const mockSupabase = createMockSupabase(2)
    const goNoGo = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-pipeline-proj',
      projectType: 'new_project',
      businessLine: classification.businessLine,
      pricingResult: pricing,
      specMarkdown: 'Next.jsを使ったBtoB SaaSプラットフォーム。',
      riskFlags: pricing.riskFlags,
    })

    expect(['go', 'go_with_conditions', 'no_go']).toContain(goNoGo.decision)
    expect(goNoGo.overallScore).toBeGreaterThanOrEqual(0)
    expect(goNoGo.overallScore).toBeLessThanOrEqual(100)
    expect(goNoGo.scores.profitability.score).toBeGreaterThanOrEqual(0)
    expect(goNoGo.scores.strategicAlignment.score).toBeGreaterThanOrEqual(0)
    expect(goNoGo.scores.capacity.score).toBeGreaterThanOrEqual(0)
    expect(goNoGo.scores.technicalRisk.score).toBeGreaterThanOrEqual(0)

    // 4. Generate value proposition (real API call)
    const valueProp = await generateValueProposition({
      specMarkdown: 'Next.jsを使ったBtoB SaaSプラットフォームの新規開発。ユーザー認証、ダッシュボード、リアルタイム通知、チーム管理。',
      similarProjects: [],
      goNoGoResult: goNoGo,
      pricingResult: pricing,
      businessLine: classification.businessLine,
    })

    expect(valueProp.generatedMarkdown.length).toBeGreaterThan(0)
    expect(valueProp.uniqueStrengths.length).toBeGreaterThan(0)
    expect(valueProp.marketComparison.marketPrice).toBe(pricing.marketTotal)
    expect(valueProp.marketComparison.ourPrice).toBe(pricing.ourPrice)
    expect(valueProp.riskMitigations.length).toBeGreaterThan(0)
  }, 120_000)

  it('pipeline handles high-risk scenario with conditions', async () => {
    // Use keyword-based classification to save API cost
    const classification = await classifyBusinessLine({
      specMarkdown: 'IoTセンサーとAI機械学習を使ったカスタム開発。要調査事項が多い。',
      projectType: 'new_project',
    })

    expect(classification.businessLine).toBe('iotrealm')

    // Calculate pricing with low coefficient to trigger risk flags
    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 2, durationMonths: 2, monthlyUnitPrice: 800_000 },
    })

    // With low market total, the minimum project fee or cost floor should kick in
    expect(pricing.ourPrice).toBeGreaterThanOrEqual(policy.minimumProjectFee)

    // Simulate high-capacity scenario
    const mockSupabase = createMockSupabase(6)
    const goNoGo = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-risky-proj',
      projectType: 'new_project',
      businessLine: classification.businessLine,
      pricingResult: pricing,
      specMarkdown: '要調査事項が多い。未定の技術要件あり。検討中の仕様多数。',
      riskFlags: pricing.riskFlags,
    })

    // With high capacity usage and uncertain spec, expect conditions
    expect(goNoGo.conditions.length).toBeGreaterThan(0)
    expect(['go_with_conditions', 'no_go']).toContain(goNoGo.decision)

    // Generate value proposition even for risky projects (real API call)
    const valueProp = await generateValueProposition({
      specMarkdown: 'IoTセンサーとAI機械学習を使ったカスタム開発。',
      similarProjects: [],
      goNoGoResult: goNoGo,
      pricingResult: pricing,
      businessLine: classification.businessLine,
    })

    expect(valueProp.riskMitigations.length).toBeGreaterThan(0)
    expect(valueProp.generatedMarkdown.length).toBeGreaterThan(0)
    expect(valueProp.uniqueStrengths.length).toBeGreaterThan(0)
  }, 120_000)
})
