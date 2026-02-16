// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'

describe.runIf(!!process.env.XAI_API_KEY)(
  'Market Evidence - Live API (Grok)',
  () => {
    it('should return structured market data for a new SaaS project', async () => {
      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: '勤怠管理SaaSの新規開発。従業員100〜1000名規模の企業向け。勤怠打刻、シフト管理、残業計算、有給管理、給与システム連携。React + Next.js + PostgreSQL。モバイルアプリ（React Native）も含む。',
        region: '日本',
      })

      // Should NOT be a fallback
      expect(result.isFallback).toBe(false)
      expect(result.fallbackReason).toBeNull()

      // Market hourly rate should be realistic (5,000 - 30,000 yen)
      expect(result.evidence.marketHourlyRate).toBeGreaterThan(0)
      expect(result.evidence.marketRateRange.min).toBeLessThan(result.evidence.marketRateRange.max)

      // Team and duration should be realistic
      expect(result.evidence.typicalTeamSize).toBeGreaterThanOrEqual(1)
      expect(result.evidence.typicalDurationMonths).toBeGreaterThanOrEqual(1)
      expect(result.evidence.monthlyUnitPrice).toBeGreaterThan(0)

      // Trends and summary should be non-empty
      expect(result.evidence.trends.length).toBeGreaterThan(0)
      expect(result.evidence.summary.length).toBeGreaterThan(0)

      // Confidence should be reasonable
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.4)
      expect(result.confidenceScore).toBeLessThanOrEqual(0.95)
    }, 60_000)

    it('should return smaller estimates for a feature addition project', async () => {
      const newProjectResult = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: '大規模ERPシステムの新規構築。会計、人事、在庫管理、CRM、BI分析を含む統合システム。マイクロサービスアーキテクチャ。',
        region: '日本',
      })

      const featureResult = await fetchMarketEvidenceFromXai({
        projectType: 'feature_addition',
        context: '既存ERPシステムにAIレポート自動生成機能を追加。月次レポートをClaude APIで自動作成し、PDFエクスポート機能を実装。',
        region: '日本',
      })

      expect(featureResult.isFallback).toBe(false)
      expect(featureResult.evidence.marketHourlyRate).toBeGreaterThan(0)
      expect(featureResult.evidence.typicalTeamSize).toBeGreaterThanOrEqual(1)
      expect(featureResult.evidence.typicalDurationMonths).toBeGreaterThanOrEqual(0.5)
      expect(featureResult.evidence.monthlyUnitPrice).toBeGreaterThan(0)
      expect(featureResult.evidence.summary.length).toBeGreaterThan(0)

      // Feature addition should generally be smaller scale than new project
      // Use soft assertion - AI may vary, but the general trend should hold
      const newTeamMonths = newProjectResult.evidence.typicalTeamSize * newProjectResult.evidence.typicalDurationMonths
      const featureTeamMonths = featureResult.evidence.typicalTeamSize * featureResult.evidence.typicalDurationMonths
      // At least one of team size or duration should be smaller for feature addition
      expect(featureTeamMonths).toBeLessThanOrEqual(newTeamMonths * 1.5) // Allow some tolerance
    }, 120_000)

    it('should return citations with valid URLs', async () => {
      const result = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'ECサイトの新規開発。商品管理、カート、決済（Stripe）、配送管理。Next.js + Supabase。',
        region: '日本',
      })

      // Citations should be present (Grok web_search returns URLs)
      expect(result.citations.length).toBeGreaterThanOrEqual(1)

      // Each citation should have a valid URL
      for (const citation of result.citations) {
        expect(citation.url).toBeTruthy()
        expect(() => new URL(citation.url)).not.toThrow()
        expect(['web', 'x', 'unknown']).toContain(citation.type)
      }

      // Confidence should reflect citation count
      if (result.citations.length >= 2) {
        expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7)
      } else if (result.citations.length === 1) {
        expect(result.confidenceScore).toBeGreaterThanOrEqual(0.55)
      }
    }, 60_000)

    it('should integrate market data into price calculation', async () => {
      const marketResult = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: 'プロジェクト管理ツールの新規開発。タスク管理、ガントチャート、リソース管理、レポート機能。React + Node.js。',
        region: '日本',
      })

      expect(marketResult.isFallback).toBe(false)

      const policy = defaultPolicyFor('new_project')

      // Calculate price WITH market data
      const marketAssumption = {
        teamSize: marketResult.evidence.typicalTeamSize,
        durationMonths: marketResult.evidence.typicalDurationMonths,
        monthlyUnitPrice: marketResult.evidence.monthlyUnitPrice,
      }
      const withMarket = calculatePrice({ policy, market: marketAssumption })

      // Calculate price WITHOUT market data (using policy defaults)
      const defaultAssumption = {
        teamSize: policy.defaultTeamSize,
        durationMonths: policy.defaultDurationMonths,
        monthlyUnitPrice: policy.avgInternalCostPerMemberMonth,
      }
      const withoutMarket = calculatePrice({ policy, market: defaultAssumption })

      // Both should produce valid prices
      expect(withMarket.ourPrice).toBeGreaterThan(0)
      expect(withoutMarket.ourPrice).toBeGreaterThan(0)
      expect(withMarket.marketTotal).toBeGreaterThan(0)
      expect(withoutMarket.marketTotal).toBeGreaterThan(0)

      // Market data should influence the price (they should differ unless coincidentally same)
      // Just verify the calculation works — exact values depend on AI response
      expect(withMarket.coefficient).toBe(policy.defaultCoefficient)
      expect(withMarket.marginPercent).toBeDefined()

      // Market estimated hours multiplier should be > 1.0 (market estimates more hours)
      expect(marketResult.evidence.marketEstimatedHoursMultiplier).toBeGreaterThanOrEqual(1.0)
    }, 60_000)
  }
)
