// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { generateValueProposition } from '@/lib/estimates/value-proposition'
import type { PriceCalculationResult } from '@/lib/pricing/engine'
import type { GoNoGoResult } from '@/lib/approval/go-no-go'
import type { SimilarProject } from '@/lib/estimates/similar-projects'

const mockPricingResult: PriceCalculationResult = {
  marketTotal: 50_400_000,
  coefficient: 0.7,
  ourPrice: 35_280_000,
  costFloor: 14_400_000,
  marginPercent: 59.18,
  riskFlags: [],
}

const mockGoNoGoResult: GoNoGoResult = {
  decision: 'go',
  scores: {
    profitability: { score: 90, details: '粗利率59.18%で健全な収益性' },
    strategicAlignment: {
      score: 95,
      businessLine: 'iotrealm',
      details: 'iotrealm事業のnew_project案件として高い適合性',
    },
    capacity: { score: 100, activeProjectCount: 1, details: 'アクティブ案件1件：十分なキャパシティあり' },
    technicalRisk: { score: 85, details: '技術リスク低（リスクフラグ0件、未確定事項0件）' },
  },
  overallScore: 85,
  conditions: [],
  reasoning: '総合スコア: 85/100',
}

const mockSimilarProjects: SimilarProject[] = [
  {
    githubReferenceId: 'ref-1',
    repoFullName: 'cor-inc/saas-platform',
    matchScore: 0.85,
    matchReasons: ['技術スタック一致: Next.js, TypeScript', 'プロジェクトタイプ一致: new_project'],
    language: 'TypeScript',
    techStack: ['Next.js', 'TypeScript', 'PostgreSQL', 'Tailwind'],
    hoursSpent: 480,
    description: 'BtoB SaaS management platform',
  },
  {
    githubReferenceId: 'ref-2',
    repoFullName: 'cor-inc/dashboard-analytics',
    matchScore: 0.6,
    matchReasons: ['技術スタック一致: React, TypeScript'],
    language: 'TypeScript',
    techStack: ['React', 'TypeScript', 'D3.js'],
    hoursSpent: 200,
    description: 'Analytics dashboard',
  },
]

const specMarkdown = `# BtoB SaaS プラットフォーム新規開発

## 概要
Next.jsを使ったBtoB SaaSプラットフォームの新規開発。
企業向けのプロジェクト管理・タスク管理ツール。

## 要件
- ユーザー認証（SSO対応）
- ダッシュボード
- リアルタイム通知
- チーム管理
- 請求・課金システム

## 技術スタック
- Next.js 15 (App Router)
- TypeScript
- PostgreSQL
- Tailwind CSS
- Stripe（決済）`

describe.runIf(!!process.env.ANTHROPIC_API_KEY)('Value Proposition Generator - Live API', () => {
  it('should generate a full value proposition with real AI', async () => {
    const result = await generateValueProposition({
      specMarkdown,
      similarProjects: mockSimilarProjects,
      goNoGoResult: mockGoNoGoResult,
      pricingResult: mockPricingResult,
      businessLine: 'iotrealm',
    })

    // Verify structure completeness
    expect(result.portfolioHighlights).toHaveLength(2)
    expect(result.portfolioHighlights[0].repoName).toBe('cor-inc/saas-platform')

    // Market comparison should be correctly calculated
    expect(result.marketComparison.marketPrice).toBe(50_400_000)
    expect(result.marketComparison.ourPrice).toBe(35_280_000)
    expect(result.marketComparison.savingsPercent).toBe(30)
    expect(result.marketComparison.narrative.length).toBeGreaterThan(10)

    // AI-generated content
    expect(result.uniqueStrengths.length).toBeGreaterThan(3)
    expect(result.uniqueStrengths).toContain('「共創」の開発スタイル：お客様と一体となったプロジェクト推進')
    expect(result.riskMitigations.length).toBeGreaterThan(0)
    expect(result.generatedMarkdown.length).toBeGreaterThan(50)
  }, 120_000)

  it('should generate valid content with no similar projects', async () => {
    const result = await generateValueProposition({
      specMarkdown,
      similarProjects: [],
      goNoGoResult: mockGoNoGoResult,
      pricingResult: mockPricingResult,
      businessLine: 'iotrealm',
    })

    // Empty portfolioHighlights when no similar projects
    expect(result.portfolioHighlights).toEqual([])

    // Should still generate all other fields
    expect(result.marketComparison.narrative.length).toBeGreaterThan(0)
    expect(result.uniqueStrengths.length).toBeGreaterThan(0)
    expect(result.riskMitigations.length).toBeGreaterThan(0)
    expect(result.generatedMarkdown.length).toBeGreaterThan(0)
  }, 120_000)

  it('should generate risk mitigations addressing no_go conditions', async () => {
    const noGoResult: GoNoGoResult = {
      decision: 'no_go',
      scores: {
        profitability: { score: 20, details: '粗利率低' },
        strategicAlignment: {
          score: 40,
          businessLine: 'tapforge',
          details: 'tapforge事業の適合性が低い',
        },
        capacity: { score: 15, activeProjectCount: 8, details: 'キャパシティ逼迫' },
        technicalRisk: { score: 30, details: '技術リスク高' },
      },
      overallScore: 25,
      conditions: [
        '収益性の改善が必要（価格調整または工数削減）',
        'チームキャパシティの確保が必要（既存案件の完了待ちまたはリソース追加）',
        '技術リスクの低減が必要（未確定事項の解消またはPoCの実施）',
        '事業戦略との整合性を再確認',
      ],
      reasoning: '総合スコア: 25/100',
    }

    const result = await generateValueProposition({
      specMarkdown: 'NFC対応のデジタル名刺アプリの新規開発。要調査事項が多数あり、未定の技術要件あり。',
      similarProjects: [],
      goNoGoResult: noGoResult,
      pricingResult: {
        ...mockPricingResult,
        marginPercent: 5,
        riskFlags: ['LOW_MARGIN', 'LOW_COEFFICIENT'],
      },
      businessLine: 'tapforge',
    })

    // Risk mitigations should address the conditions
    expect(result.riskMitigations.length).toBeGreaterThan(0)
    expect(result.generatedMarkdown.length).toBeGreaterThan(0)

    // Should still have tapforge-specific strengths
    expect(result.uniqueStrengths.some((s) => s.includes('NFC') || s.includes('tapforge'))).toBe(true)
  }, 120_000)
})
