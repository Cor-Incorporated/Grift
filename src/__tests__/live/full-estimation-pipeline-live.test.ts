// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { sendMessage } from '@/lib/ai/anthropic'
import { getSpecGenerationPrompt } from '@/lib/ai/system-prompts'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { analyzeWebsiteUrlWithGrok } from '@/lib/source-analysis/website'
import { analyzeRepositoryUrlWithClaude } from '@/lib/source-analysis/repository'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'
import { parseJsonFromResponse } from '@/lib/ai/xai'

const HOURS_ESTIMATE_PROMPT = `あなたはシニアソフトウェアエンジニアです。以下の仕様書を読み、工数を見積もってください。

各フェーズの時間（時間単位）をJSON形式で返してください：
\`\`\`json
{
  "investigation": 調査・分析時間,
  "implementation": 実装時間,
  "testing": テスト時間,
  "buffer": バッファ時間,
  "total": 合計時間,
  "breakdown": "工数内訳の簡潔な説明"
}
\`\`\`

制約:
- 回答は必ずJSONのみで返す
- total は各項目の合計と一致させる`

interface HoursEstimate {
  investigation: number
  implementation: number
  testing: number
  buffer: number
  total: number
  breakdown: string
}

function parseHoursEstimate(response: string): HoursEstimate {
  const parsed = parseJsonFromResponse<Partial<HoursEstimate>>(response)
  const investigation = Math.max(0, Number(parsed.investigation ?? 0))
  const implementation = Math.max(0, Number(parsed.implementation ?? 0))
  const testing = Math.max(0, Number(parsed.testing ?? 0))
  const buffer = Math.max(0, Number(parsed.buffer ?? 0))
  const total = Number(parsed.total ?? investigation + implementation + testing + buffer)
  return {
    investigation,
    implementation,
    testing,
    buffer,
    total,
    breakdown: typeof parsed.breakdown === 'string' ? parsed.breakdown : '',
  }
}

describe.runIf(!!process.env.ANTHROPIC_API_KEY && !!process.env.XAI_API_KEY)(
  'Full Estimation Pipeline - Live API (Claude + Grok)',
  () => {
    it('new SaaS: spec → hours → market → pricing end-to-end', async () => {
      // Step 1: Generate spec with Claude
      const specPrompt = getSpecGenerationPrompt('new_project')
      const specResponse = await sendMessage(specPrompt, [
        {
          role: 'user',
          content: `以下の対話履歴を基に仕様書を生成してください。

ユーザー: 勤怠管理SaaSを開発したい。従業員100〜500名の中小企業向け。
AI: 承知しました。主要機能を教えてください。
ユーザー: 勤怠打刻（GPS付き）、シフト管理、残業計算、有給申請・承認、給与システムCSV連携。
AI: 技術要件はありますか？
ユーザー: React + Next.js + PostgreSQL。スマホ対応必須。Slackとの連携も欲しい。納期は6ヶ月。予算は3000万円前後。`,
        },
      ], { temperature: 0.3, maxTokens: 3000 })

      expect(specResponse.length).toBeGreaterThan(100)

      // Step 2: Estimate hours with Claude
      const hoursResponse = await sendMessage(HOURS_ESTIMATE_PROMPT, [
        { role: 'user', content: `案件タイプ: new_project\n\n${specResponse}` },
      ], { temperature: 0.2, maxTokens: 2048 })

      const hours = parseHoursEstimate(hoursResponse)
      expect(hours.total).toBeGreaterThan(0)
      expect(hours.investigation).toBeGreaterThan(0)
      expect(hours.implementation).toBeGreaterThan(0)
      expect(hours.testing).toBeGreaterThan(0)
      expect(hours.buffer).toBeGreaterThan(0)

      // Step 3: Fetch market evidence with Grok
      const marketResult = await fetchMarketEvidenceFromXai({
        projectType: 'new_project',
        context: specResponse.slice(0, 3000),
        region: '日本',
      })

      expect(marketResult.isFallback).toBe(false)
      expect(marketResult.evidence.marketHourlyRate).toBeGreaterThan(0)

      // Step 4: Calculate pricing
      const policy = defaultPolicyFor('new_project')
      const marketAssumption = {
        teamSize: marketResult.evidence.typicalTeamSize,
        durationMonths: marketResult.evidence.typicalDurationMonths,
        monthlyUnitPrice: marketResult.evidence.monthlyUnitPrice,
      }
      const pricing = calculatePrice({ policy, market: marketAssumption })

      expect(pricing.ourPrice).toBeGreaterThan(0)
      expect(pricing.marketTotal).toBeGreaterThan(0)
      expect(pricing.ourPrice).toBeGreaterThanOrEqual(policy.minimumProjectFee)

      // Step 5: Cross-validate
      // Market hours = our hours * multiplier (market estimates more)
      const marketHours = hours.total * marketResult.evidence.marketEstimatedHoursMultiplier
      expect(marketHours).toBeGreaterThanOrEqual(hours.total)

      // Total market cost based on market rate
      const totalMarketCost = marketResult.evidence.marketHourlyRate * marketHours
      expect(totalMarketCost).toBeGreaterThan(0)

      // ourPrice = max(basePrice, minimumProjectFee, costFloor)
      // When internal cost floor exceeds market total, ourPrice can be > marketTotal
      // This is expected — it means the market rate is low but our costs are fixed
      // Just verify the coefficient was applied and the relationship is coherent
      const basePrice = pricing.marketTotal * pricing.coefficient
      expect(pricing.ourPrice).toBeGreaterThanOrEqual(basePrice)
      expect(pricing.ourPrice).toBeGreaterThanOrEqual(policy.minimumProjectFee)
    }, 180_000)

    it('website analysis enriches estimation context', async () => {
      // Step 1: Analyze reference website
      const siteAnalysis = await analyzeWebsiteUrlWithGrok('https://linear.app')
      expect(siteAnalysis.type).toBe('website_url')
      expect(siteAnalysis.summary.length).toBeGreaterThan(0)

      // Step 2: Build attachment context from site analysis
      const attachmentContext = [
        `## 参考サイト分析: ${siteAnalysis.url}`,
        '',
        `概要: ${siteAnalysis.summary}`,
        '',
        siteAnalysis.uiComponents.length > 0
          ? `UIコンポーネント: ${siteAnalysis.uiComponents.join(', ')}`
          : '',
        siteAnalysis.designPatterns.length > 0
          ? `デザインパターン: ${siteAnalysis.designPatterns.join(', ')}`
          : '',
        siteAnalysis.interactiveFeatures.length > 0
          ? `インタラクティブ機能: ${siteAnalysis.interactiveFeatures.join(', ')}`
          : '',
        siteAnalysis.detectedTechStack.length > 0
          ? `検出された技術スタック: ${siteAnalysis.detectedTechStack.join(', ')}`
          : '',
        '',
        `推定複雑度: ${siteAnalysis.estimatedComplexity}`,
        '',
        `見積りコンテキスト: ${siteAnalysis.estimationContext}`,
      ].filter(Boolean).join('\n')

      expect(attachmentContext.length).toBeGreaterThan(50)

      // Step 3: Estimate with attachment context
      const specWithAttachment = `Linearのようなプロジェクト管理ツールを新規開発したい。
タスク管理、カンバンボード、リアルタイム同期、キーボードショートカット。
React + Next.js + PostgreSQL。

添付資料解析の要約:
${attachmentContext}`

      const hoursResponse = await sendMessage(HOURS_ESTIMATE_PROMPT, [
        { role: 'user', content: `案件タイプ: new_project\n\n${specWithAttachment}` },
      ], { temperature: 0.2, maxTokens: 2048 })

      const hours = parseHoursEstimate(hoursResponse)
      expect(hours.total).toBeGreaterThan(0)
      expect(hours.breakdown.length).toBeGreaterThan(0)
    }, 180_000)
  }
)

describe.runIf(!!process.env.ANTHROPIC_API_KEY)(
  'GitHub Analysis → Estimation - Live API (Claude)',
  () => {
    it('repository analysis provides tech stack context for estimation', async () => {
      // Step 1: Analyze GitHub repository
      const repoAnalysis = await analyzeRepositoryUrlWithClaude('https://github.com/lukeed/clsx')

      expect(repoAnalysis.repository.owner).toBe('lukeed')
      expect(repoAnalysis.analysis.techStack.length).toBeGreaterThanOrEqual(1)
      expect(repoAnalysis.analysis.summary.length).toBeGreaterThan(0)

      // Step 2: Build attachment context from repo analysis
      const attachmentContext = [
        `## GitHubリポジトリ分析: ${repoAnalysis.repository.url}`,
        '',
        `概要: ${repoAnalysis.analysis.summary}`,
        `システムタイプ: ${repoAnalysis.analysis.systemType}`,
        `技術スタック: ${repoAnalysis.analysis.techStack.join(', ')}`,
        `アーカイブサイズ: ${(repoAnalysis.archiveBytes / 1024).toFixed(1)} KB`,
      ].join('\n')

      expect(attachmentContext.length).toBeGreaterThan(50)

      // Step 3: Use context for estimation
      const specWithRepo = `既存のclsxライブラリにパフォーマンス改善とTypeScript型定義の強化を行う。
バンドルサイズの最小化、ESM/CJS両対応、テスト拡充。

添付資料解析の要約:
${attachmentContext}`

      const hoursResponse = await sendMessage(HOURS_ESTIMATE_PROMPT, [
        { role: 'user', content: `案件タイプ: feature_addition\n\n${specWithRepo}` },
      ], { temperature: 0.2, maxTokens: 2048 })

      const hours = parseHoursEstimate(hoursResponse)
      expect(hours.total).toBeGreaterThan(0)
      expect(hours.investigation).toBeGreaterThan(0)
      expect(hours.implementation).toBeGreaterThan(0)
      expect(hours.testing).toBeGreaterThan(0)
    }, 180_000)
  }
)
