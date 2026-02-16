import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateValueProposition } from '../value-proposition'
import type { PriceCalculationResult } from '@/lib/pricing/engine'
import type { SimilarProject } from '../similar-projects'
import type { GoNoGoResult } from '@/lib/approval/go-no-go'

vi.mock('@/lib/ai/anthropic', () => ({
  sendMessage: vi.fn().mockResolvedValue(JSON.stringify({
    narrative: '市場平均より30%低い価格で、同等以上の品質をご提供します。',
    additionalStrengths: ['CI/CD自動化による品質担保', 'アジャイル開発で柔軟に対応'],
    riskMitigations: ['PoCフェーズを設けて技術リスクを早期検証'],
    generatedMarkdown: '# バリュープロポジション\n\n当社の提案内容です。',
  })),
}))

vi.mock('@/lib/ai/xai', () => ({
  parseJsonFromResponse: vi.fn((text: string) => JSON.parse(text)),
}))

const basePricing: PriceCalculationResult = {
  marketTotal: 3_000_000,
  coefficient: 0.7,
  ourPrice: 2_100_000,
  costFloor: 1_500_000,
  marginPercent: 28.6,
  riskFlags: [],
}

const sampleSimilarProjects: SimilarProject[] = [
  {
    githubReferenceId: 'ref-1',
    repoFullName: 'cor-inc/ecommerce-platform',
    matchScore: 0.8,
    matchReasons: ['技術スタック一致: Next.js, TypeScript'],
    language: 'TypeScript',
    techStack: ['Next.js', 'TypeScript'],
    hoursSpent: 200,
    description: 'EC platform',
  },
  {
    githubReferenceId: 'ref-2',
    repoFullName: 'cor-inc/dashboard-app',
    matchScore: 0.5,
    matchReasons: ['技術スタック一致: React'],
    language: 'TypeScript',
    techStack: ['React', 'TypeScript'],
    hoursSpent: null,
    description: 'Dashboard',
  },
  {
    githubReferenceId: 'ref-3',
    repoFullName: 'cor-inc/iot-sensor',
    matchScore: 0.4,
    matchReasons: ['トピック一致: iot'],
    language: 'Python',
    techStack: ['Python', 'MQTT'],
    hoursSpent: 150,
    description: 'IoT sensor app',
  },
  {
    githubReferenceId: 'ref-4',
    repoFullName: 'cor-inc/mobile-app',
    matchScore: 0.3,
    matchReasons: ['技術スタック一致: React Native'],
    language: 'TypeScript',
    techStack: ['React Native'],
    hoursSpent: 100,
    description: 'Mobile app',
  },
]

const sampleGoNoGo: GoNoGoResult = {
  decision: 'go',
  scores: {
    profitability: { score: 80, details: '粗利率28.6%で健全な収益性' },
    strategicAlignment: {
      score: 90,
      businessLine: 'boltsite',
      details: 'boltsite事業のnew_project案件として高い適合性',
    },
    capacity: { score: 100, activeProjectCount: 1, details: 'アクティブ案件1件' },
    technicalRisk: { score: 85, details: '技術リスク低' },
  },
  overallScore: 87,
  conditions: [],
  reasoning: '総合スコア: 87/100',
}

const goNoGoWithConditions: GoNoGoResult = {
  decision: 'go_with_conditions',
  scores: {
    profitability: { score: 40, details: '粗利率低' },
    strategicAlignment: {
      score: 70,
      businessLine: 'boltsite',
      details: '中程度の適合性',
    },
    capacity: { score: 30, activeProjectCount: 5, details: 'キャパシティ逼迫' },
    technicalRisk: { score: 50, details: '技術リスク中' },
  },
  overallScore: 48,
  conditions: [
    '収益性の改善が必要',
    'チームキャパシティの確保が必要',
  ],
  reasoning: '総合スコア: 48/100',
}

describe('generateValueProposition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate portfolioHighlights from top 3 similar projects', async () => {
    const result = await generateValueProposition({
      specMarkdown: 'ECサイト構築',
      similarProjects: sampleSimilarProjects,
      goNoGoResult: sampleGoNoGo,
      pricingResult: basePricing,
      businessLine: 'boltsite',
    })

    expect(result.portfolioHighlights).toHaveLength(3)
    expect(result.portfolioHighlights[0].repoName).toBe('cor-inc/ecommerce-platform')
    expect(result.portfolioHighlights[0].techOverlap).toEqual(['Next.js', 'TypeScript'])
    expect(result.portfolioHighlights[2].repoName).toBe('cor-inc/iot-sensor')
  })

  it('should calculate marketComparison correctly', async () => {
    const result = await generateValueProposition({
      specMarkdown: 'テストプロジェクト',
      similarProjects: [],
      goNoGoResult: sampleGoNoGo,
      pricingResult: basePricing,
      businessLine: 'boltsite',
    })

    expect(result.marketComparison.marketPrice).toBe(3_000_000)
    expect(result.marketComparison.ourPrice).toBe(2_100_000)
    expect(result.marketComparison.savingsPercent).toBe(30)
    expect(result.marketComparison.narrative).toBeTruthy()
  })

  it('should handle zero market total gracefully', async () => {
    const zeroMarketPricing: PriceCalculationResult = {
      ...basePricing,
      marketTotal: 0,
    }

    const result = await generateValueProposition({
      specMarkdown: 'バグ修正',
      similarProjects: [],
      goNoGoResult: sampleGoNoGo,
      pricingResult: zeroMarketPricing,
      businessLine: 'boltsite',
    })

    expect(result.marketComparison.savingsPercent).toBe(0)
    expect(result.marketComparison.marketPrice).toBe(0)
  })

  it('should include base strengths for businessLine', async () => {
    const result = await generateValueProposition({
      specMarkdown: 'IoTプロジェクト',
      similarProjects: [],
      goNoGoResult: sampleGoNoGo,
      pricingResult: basePricing,
      businessLine: 'iotrealm',
    })

    expect(result.uniqueStrengths).toContain('「共創」の開発スタイル：お客様と一体となったプロジェクト推進')
    expect(result.uniqueStrengths).toContain('少人数精鋭チームによる機動力と意思決定の速さ')
    expect(result.uniqueStrengths.some((s) => s.includes('iotrealm'))).toBe(true)
    expect(result.uniqueStrengths.some((s) => s.includes('IoT'))).toBe(true)
  })

  it('should include AI-generated additional strengths', async () => {
    const result = await generateValueProposition({
      specMarkdown: 'テスト',
      similarProjects: [],
      goNoGoResult: sampleGoNoGo,
      pricingResult: basePricing,
      businessLine: 'boltsite',
    })

    expect(result.uniqueStrengths).toContain('CI/CD自動化による品質担保')
    expect(result.uniqueStrengths).toContain('アジャイル開発で柔軟に対応')
  })

  it('should generate riskMitigations from Claude API', async () => {
    const result = await generateValueProposition({
      specMarkdown: 'テスト',
      similarProjects: [],
      goNoGoResult: sampleGoNoGo,
      pricingResult: basePricing,
      businessLine: 'boltsite',
    })

    expect(result.riskMitigations).toContain('PoCフェーズを設けて技術リスクを早期検証')
  })

  it('should generate markdown output', async () => {
    const result = await generateValueProposition({
      specMarkdown: 'テスト',
      similarProjects: sampleSimilarProjects,
      goNoGoResult: sampleGoNoGo,
      pricingResult: basePricing,
      businessLine: 'boltsite',
    })

    expect(result.generatedMarkdown).toBeTruthy()
    expect(result.generatedMarkdown.length).toBeGreaterThan(0)
  })

  it('should handle empty similarProjects without error', async () => {
    const result = await generateValueProposition({
      specMarkdown: 'テスト',
      similarProjects: [],
      goNoGoResult: sampleGoNoGo,
      pricingResult: basePricing,
      businessLine: 'boltsite',
    })

    expect(result.portfolioHighlights).toEqual([])
    expect(result.marketComparison).toBeDefined()
    expect(result.uniqueStrengths.length).toBeGreaterThan(0)
  })

  it('should use fallback when Claude API fails', async () => {
    const { sendMessage } = await import('@/lib/ai/anthropic')
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('API Error'))

    const result = await generateValueProposition({
      specMarkdown: 'テスト',
      similarProjects: sampleSimilarProjects.slice(0, 2),
      goNoGoResult: goNoGoWithConditions,
      pricingResult: basePricing,
      businessLine: 'boltsite',
    })

    // Should still return valid structure with fallback content
    expect(result.portfolioHighlights).toHaveLength(2)
    expect(result.marketComparison.savingsPercent).toBe(30)
    expect(result.marketComparison.narrative).toContain('30%')
    expect(result.uniqueStrengths.length).toBeGreaterThan(0)
    expect(result.riskMitigations.length).toBeGreaterThan(0)
    expect(result.generatedMarkdown).toContain('バリュープロポジション')
  })

  it('should include tapforge-specific strengths', async () => {
    const result = await generateValueProposition({
      specMarkdown: 'NFC名刺アプリ',
      similarProjects: [],
      goNoGoResult: sampleGoNoGo,
      pricingResult: basePricing,
      businessLine: 'tapforge',
    })

    expect(result.uniqueStrengths.some((s) => s.includes('NFC'))).toBe(true)
    expect(result.uniqueStrengths.some((s) => s.includes('tapforge'))).toBe(true)
  })

  it('should pass conditions to riskMitigations fallback', async () => {
    const { sendMessage } = await import('@/lib/ai/anthropic')
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('API Error'))

    const result = await generateValueProposition({
      specMarkdown: 'テスト',
      similarProjects: [],
      goNoGoResult: goNoGoWithConditions,
      pricingResult: basePricing,
      businessLine: 'boltsite',
    })

    expect(result.riskMitigations.length).toBe(2)
    expect(result.riskMitigations[0]).toContain('収益性の改善が必要')
    expect(result.riskMitigations[1]).toContain('チームキャパシティの確保が必要')
  })
})
