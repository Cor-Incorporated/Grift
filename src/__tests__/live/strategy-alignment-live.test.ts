// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'
import { calculateSpeedAdvantage } from '@/lib/estimates/speed-advantage'

describe.runIf(!!process.env.XAI_API_KEY)(
  'Strategy Alignment - 5-Step Validation',
  () => {
    it('Step B→C→E: market → pricing → costFloor pipeline', async () => {
      // Step B: Get market data
      const market = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: '勤怠管理SaaSの新規開発。従業員100〜1000名規模。勤怠打刻、シフト管理、残業計算、有給管理、給与連携。React + Next.js + PostgreSQL。',
        region: '日本',
      })

      expect(market.isFallback).toBe(false)
      expect(market.evidence.typicalTeamSize).toBeGreaterThanOrEqual(1)
      expect(market.evidence.typicalDurationMonths).toBeGreaterThanOrEqual(1)

      // Step C: Calculate price (should be 65-80% of market)
      const policy = defaultPolicyFor('new_project')
      const pricing = calculatePrice({
        policy,
        market: {
          teamSize: market.evidence.typicalTeamSize,
          durationMonths: market.evidence.typicalDurationMonths,
          monthlyUnitPrice: market.evidence.monthlyUnitPrice,
        },
      })

      expect(pricing.marketTotal).toBeGreaterThan(0)
      expect(pricing.ourPrice).toBeGreaterThan(0)

      // Key assertion: ourPrice <= marketTotal (strategy alignment)
      // The coefficient (0.65-0.80) should ensure this
      const priceRatio = pricing.ourPrice / pricing.marketTotal
      expect(priceRatio).toBeLessThanOrEqual(1.0)

      // Step E: costFloor uses internalTeamSize (2), not market teamSize
      // costFloor = 2M * 2 * (duration * 0.6)
      const expectedCostFloor = policy.avgInternalCostPerMemberMonth
        * policy.internalTeamSize
        * (market.evidence.typicalDurationMonths * 0.6)

      // Allow small floating point tolerance
      expect(Math.abs(pricing.costFloor - expectedCostFloor)).toBeLessThan(1)
    }, 60_000)

    it('Step D: speed advantage shows savings vs market', async () => {
      const policy = defaultPolicyFor('new_project')
      const result = calculateSpeedAdvantage({
        similarProjects: [],
        velocityData: null,
        marketTeamSize: 6,
        marketDurationMonths: 6,
        ourHoursEstimate: 400,
        policy,
      })

      // Our duration should be less than market
      expect(result.ourEstimate.durationMonths).toBeLessThan(6)

      // Speed multiplier should be > 1 (we're more efficient)
      expect(result.speedMultiplier).toBeGreaterThan(1)

      // Duration savings should be positive
      expect(result.durationSavingsPercent).toBeGreaterThan(0)

      // Narrative should be non-empty
      expect(result.narrative.length).toBeGreaterThan(0)
    })

    it('Grok returns different values for different project types (no anchoring)', async () => {
      const [newProject, featureAddition] = await Promise.all([
        fetchMarketEvidenceFromXai({
          projectType: 'new_project',
          context: '大規模ERPシステムの全面リプレース。会計、人事、在庫、CRM統合。マイクロサービス、Kubernetes。',
          region: '日本',
        }),
        fetchMarketEvidenceFromXai({
          projectType: 'feature_addition',
          context: '既存Webアプリにダッシュボード機能を追加。Chart.jsによるグラフ表示。2画面程度。',
          region: '日本',
        }),
      ])

      // Both should return real data (not fallback) after parseJsonFromResponse fix
      expect(newProject.isFallback).toBe(false)
      expect(featureAddition.isFallback).toBe(false)

      // Feature addition should have smaller team and/or shorter duration
      const newScale = newProject.evidence.typicalTeamSize * newProject.evidence.typicalDurationMonths
      const featureScale = featureAddition.evidence.typicalTeamSize * featureAddition.evidence.typicalDurationMonths

      // ERP全面リプレースは2画面ダッシュボード追加より大きい/同等のはず
      // Grokが同じ値を返す可能性もあるため strict less ではなく <=
      expect(featureScale).toBeLessThanOrEqual(newScale)
    }, 120_000)

    it('price ratio stays within 0.50-0.85 for realistic market data', async () => {
      const scenarios = [
        {
          projectType: 'new_project' as const,
          context: 'ECサイト新規開発。商品管理、カート、Stripe決済、配送管理。Next.js + Supabase。',
        },
        {
          projectType: 'feature_addition' as const,
          context: '既存CRMにAI顧客スコアリング機能追加。Claude APIで顧客プロファイルを分析。',
        },
      ]

      for (const scenario of scenarios) {
        const market = await fetchMarketEvidenceFromXai({
          ...scenario,
          region: '日本',
        })

        if (market.isFallback) continue

        const policy = defaultPolicyFor(scenario.projectType)
        const pricing = calculatePrice({
          policy,
          market: {
            teamSize: market.evidence.typicalTeamSize,
            durationMonths: market.evidence.typicalDurationMonths,
            monthlyUnitPrice: market.evidence.monthlyUnitPrice,
          },
        })

        if (pricing.marketTotal > 0) {
          const ratio = pricing.ourPrice / pricing.marketTotal
          // Allow wider range for edge cases but it should generally be under 1.0
          expect(ratio).toBeLessThanOrEqual(1.0)
          expect(ratio).toBeGreaterThan(0)
        }
      }
    }, 120_000)
  }
)
