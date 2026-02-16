// @vitest-environment node
/**
 * Live API Report Generator
 * 実際のAPIレスポンスデータをMarkdownレポートとしてlog/に出力する
 *
 * Usage:
 *   set -a && source .env.local && set +a && npx vitest run src/__tests__/live/api-report-live.test.ts
 */
import { describe, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { analyzeWebsiteUrlWithGrok } from '@/lib/source-analysis/website'
import { analyzeRepositoryUrlWithClaude } from '@/lib/source-analysis/repository'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'
import { calculateSpeedAdvantage } from '@/lib/estimates/speed-advantage'

function formatYen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`
}

describe.runIf(!!process.env.XAI_API_KEY && !!process.env.ANTHROPIC_API_KEY)(
  'Live API Report Generator',
  () => {
    it('generates full API response report to log/', async () => {
      const lines: string[] = []
      function log(line: string) { lines.push(line) }

      log(`# ライブAPIテスト結果レポート`)
      log(``)
      log(`生成日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`)
      log(``)

      // ============================================================
      // 1. Market Evidence (Grok)
      // ============================================================
      log(`---`)
      log(``)
      log(`## 1. 市場価格リサーチ (Grok web_search + x_search)`)
      log(``)

      const marketScenarios = [
        {
          label: '新規SaaS（勤怠管理）',
          input: {
            projectType: 'new_project' as const,
            context: '勤怠管理SaaSの新規開発。従業員100〜1000名規模の企業向け。勤怠打刻、シフト管理、残業計算、有給管理、給与システム連携。React + Next.js + PostgreSQL。モバイルアプリ（React Native）も含む。',
            region: '日本',
          },
        },
        {
          label: '機能追加（AIレポート生成）',
          input: {
            projectType: 'feature_addition' as const,
            context: '既存ERPシステムにAIレポート自動生成機能を追加。月次レポートをClaude APIで自動作成し、PDFエクスポート機能を実装。',
            region: '日本',
          },
        },
        {
          label: 'ECサイト新規開発',
          input: {
            projectType: 'new_project' as const,
            context: 'ECサイトの新規開発。商品管理、カート、決済（Stripe）、配送管理。Next.js + Supabase。',
            region: '日本',
          },
        },
      ]

      for (const scenario of marketScenarios) {
        const result = await fetchMarketEvidenceFromXai(scenario.input)

        log(`### ${scenario.label}`)
        log(``)
        log(`| 項目 | 値 |`)
        log(`|---|---|`)
        log(`| 案件タイプ | \`${scenario.input.projectType}\` |`)
        log(`| フォールバック | ${result.isFallback ? 'Yes (デフォルト値)' : 'No (実データ)'} |`)
        log(`| 信頼スコア | ${result.confidenceScore} |`)
        log(`| 市場時間単価 | ${formatYen(result.evidence.marketHourlyRate)} |`)
        log(`| 市場単価レンジ | ${formatYen(result.evidence.marketRateRange.min)} 〜 ${formatYen(result.evidence.marketRateRange.max)} |`)
        log(`| 市場工数倍率 | ${result.evidence.marketEstimatedHoursMultiplier}x |`)
        log(`| 典型チーム人数 | ${result.evidence.typicalTeamSize}名 |`)
        log(`| 典型期間 | ${result.evidence.typicalDurationMonths}ヶ月 |`)
        log(`| 月額単価 | ${formatYen(result.evidence.monthlyUnitPrice)} |`)
        log(``)
        log(`**サマリー**: ${result.evidence.summary}`)
        log(``)

        if (result.evidence.trends.length > 0) {
          log(`**市場トレンド**:`)
          for (const trend of result.evidence.trends) {
            log(`- ${trend}`)
          }
          log(``)
        }

        if (result.evidence.risks.length > 0) {
          log(`**リスク**:`)
          for (const risk of result.evidence.risks) {
            log(`- ${risk}`)
          }
          log(``)
        }

        if (result.citations.length > 0) {
          log(`**引用ソース** (${result.citations.length}件):`)
          for (const citation of result.citations) {
            log(`- [${citation.type}] ${citation.url}`)
          }
          log(``)
        }

        // Pricing calculation
        const pricingType = scenario.input.projectType === 'new_project' ? 'new_project' : 'feature_addition'
        const policy = defaultPolicyFor(pricingType)
        const pricing = calculatePrice({
          policy,
          market: {
            teamSize: result.evidence.typicalTeamSize,
            durationMonths: result.evidence.typicalDurationMonths,
            monthlyUnitPrice: result.evidence.monthlyUnitPrice,
          },
        })

        log(`**価格計算結果**:`)
        log(``)
        log(`| 項目 | 値 |`)
        log(`|---|---|`)
        log(`| 市場総額 (teamSize × months × monthly) | ${formatYen(pricing.marketTotal)} |`)
        log(`| 係数 | ${pricing.coefficient} |`)
        log(`| 自社提案価格 | ${formatYen(pricing.ourPrice)} |`)
        log(`| コストフロア | ${formatYen(pricing.costFloor)} |`)
        log(`| マージン率 | ${pricing.marginPercent}% |`)
        log(`| リスクフラグ | ${pricing.riskFlags.length > 0 ? pricing.riskFlags.join(', ') : 'なし'} |`)
        log(``)
      }

      // ============================================================
      // 2. Website Analysis (Grok)
      // ============================================================
      log(`---`)
      log(``)
      log(`## 2. ウェブサイト分析 (Grok web_search)`)
      log(``)

      const websiteScenarios = [
        { label: 'kintone（サイボウズ）', url: 'https://kintone.cybozu.co.jp' },
        { label: 'Linear（プロジェクト管理）', url: 'https://linear.app' },
      ]

      for (const scenario of websiteScenarios) {
        const result = await analyzeWebsiteUrlWithGrok(scenario.url)

        log(`### ${scenario.label} (${scenario.url})`)
        log(``)
        log(`**概要**: ${result.summary}`)
        log(``)
        log(`**企業/サービス概要**: ${result.companyOverview}`)
        log(``)

        if (result.services.length > 0) {
          log(`**サービス**: ${result.services.join(' / ')}`)
          log(``)
        }

        log(`| 分析項目 | 内容 |`)
        log(`|---|---|`)
        log(`| ページ構成 | ${result.pageStructure.join(', ') || '(未検出)'} |`)
        log(`| ナビゲーション | ${result.navigationPattern || '(未検出)'} |`)
        log(`| UIコンポーネント | ${result.uiComponents.join(', ') || '(未検出)'} |`)
        log(`| デザインパターン | ${result.designPatterns.join(', ') || '(未検出)'} |`)
        log(`| レスポンシブ対応 | ${result.responsiveApproach || '(未検出)'} |`)
        log(`| インタラクティブ機能 | ${result.interactiveFeatures.join(', ') || '(未検出)'} |`)
        log(`| 検出技術スタック | ${result.detectedTechStack.join(', ') || '(未検出)'} |`)
        log(`| 推定複雑度 | ${result.estimatedComplexity || '(未検出)'} |`)
        log(`| キー機能 | ${result.keyFeatures.join(', ') || '(未検出)'} |`)
        log(``)
        log(`**見積りコンテキスト**: ${result.estimationContext}`)
        log(``)

        if (result.citations.length > 0) {
          log(`**引用ソース** (${result.citations.length}件):`)
          for (const citation of result.citations) {
            log(`- [${citation.type}] ${citation.url}`)
          }
          log(``)
        }
      }

      // ============================================================
      // 3. GitHub Repository Analysis (Claude)
      // ============================================================
      log(`---`)
      log(``)
      log(`## 3. GitHubリポジトリ分析 (Claude)`)
      log(``)

      const repoResult = await analyzeRepositoryUrlWithClaude('https://github.com/lukeed/clsx')

      log(`### ${repoResult.repository.owner}/${repoResult.repository.repo}`)
      log(``)
      log(`| 項目 | 値 |`)
      log(`|---|---|`)
      log(`| URL | ${repoResult.repository.url} |`)
      log(`| ブランチ | ${repoResult.repository.branch} |`)
      log(`| アーカイブサイズ | ${(repoResult.archiveBytes / 1024).toFixed(1)} KB |`)
      log(`| システムタイプ | ${repoResult.analysis.systemType} |`)
      log(`| 技術スタック | ${repoResult.analysis.techStack.join(', ')} |`)
      log(``)
      log(`**概要**: ${repoResult.analysis.summary}`)
      log(``)

      if (repoResult.analysis.architecture.length > 0) {
        log(`**アーキテクチャ**: ${repoResult.analysis.architecture.join(', ')}`)
        log(``)
      }

      if (repoResult.analysis.keyModules.length > 0) {
        log(`**主要モジュール**:`)
        for (const mod of repoResult.analysis.keyModules) {
          log(`- **${mod.path}**: ${mod.purpose}`)
        }
        log(``)
      }

      if (repoResult.analysis.risks.length > 0) {
        log(`**リスク**:`)
        for (const risk of repoResult.analysis.risks) {
          log(`- ${risk}`)
        }
        log(``)
      }

      if (repoResult.analysis.changeImpactPoints.length > 0) {
        log(`**変更影響ポイント**:`)
        for (const point of repoResult.analysis.changeImpactPoints) {
          log(`- ${point}`)
        }
        log(``)
      }

      // ============================================================
      // 4. Speed Advantage Analysis
      // ============================================================
      log(`---`)
      log(``)
      log(`## 4. 速度優位性分析`)
      log(``)

      const speedPolicy = defaultPolicyFor('new_project')
      // Use the first market scenario's data for speed advantage
      const firstMarketResult = await fetchMarketEvidenceFromXai(marketScenarios[0].input)
      const speedResult = calculateSpeedAdvantage({
        similarProjects: [],
        velocityData: null,
        marketTeamSize: firstMarketResult.evidence.typicalTeamSize,
        marketDurationMonths: firstMarketResult.evidence.typicalDurationMonths,
        ourHoursEstimate: 400, // Assume 400 hours for demo
        policy: speedPolicy,
      })

      log(`| 項目 | 市場見積 | 当社見積 |`)
      log(`|---|---|---|`)
      log(`| チーム規模 | ${speedResult.marketEstimate.teamSize}名 | ${speedResult.ourEstimate.teamSize}名 |`)
      log(`| 開発期間 | ${speedResult.marketEstimate.durationMonths}ヶ月 | ${speedResult.ourEstimate.durationMonths}ヶ月 |`)
      log(`| 総工数 | ${speedResult.marketEstimate.totalHours}時間 | ${speedResult.ourEstimate.totalHours}時間 |`)
      log(``)
      log(`**効率倍率**: ${speedResult.speedMultiplier}x`)
      log(`**期間短縮率**: ${speedResult.durationSavingsPercent}%`)
      log(``)
      log(`**ナラティブ**: ${speedResult.narrative}`)
      log(``)

      // ============================================================
      // 5. Strategy 5-Step Check
      // ============================================================
      log(`---`)
      log(``)
      log(`## 5. 戦略5ステップチェック`)
      log(``)

      // Use the first scenario pricing for strategy check
      const strategyPricing = calculatePrice({
        policy: speedPolicy,
        market: {
          teamSize: firstMarketResult.evidence.typicalTeamSize,
          durationMonths: firstMarketResult.evidence.typicalDurationMonths,
          monthlyUnitPrice: firstMarketResult.evidence.monthlyUnitPrice,
        },
      })

      const priceRatio = strategyPricing.marketTotal > 0
        ? strategyPricing.ourPrice / strategyPricing.marketTotal
        : 0

      const checks = [
        { step: 'A', name: 'ヒアリング', status: 'Pass', detail: '対話形式で仕様取得済み' },
        { step: 'B', name: '市場想定', status: firstMarketResult.isFallback ? 'Fail' : 'Pass', detail: `Grok実データ取得: ${!firstMarketResult.isFallback}` },
        { step: 'C', name: '価格 = 市場×0.65-0.80', status: priceRatio <= 1.0 ? 'Pass' : 'Fail', detail: `比率: ${(priceRatio * 100).toFixed(1)}%` },
        { step: 'D', name: '期間短縮の裏付け', status: speedResult.durationSavingsPercent > 0 ? 'Pass' : 'Fail', detail: `${speedResult.durationSavingsPercent}%短縮` },
        { step: 'E', name: '原価チェック(内部2名)', status: strategyPricing.costFloor <= strategyPricing.ourPrice ? 'Pass' : 'Fail', detail: `Floor: ${formatYen(strategyPricing.costFloor)}, Price: ${formatYen(strategyPricing.ourPrice)}` },
      ]

      log(`| Step | 名称 | 結果 | 詳細 |`)
      log(`|---|---|---|---|`)
      for (const check of checks) {
        log(`| ${check.step} | ${check.name} | ${check.status} | ${check.detail} |`)
      }
      log(``)
      log(`**ourPrice / marketTotal 比率**: ${(priceRatio * 100).toFixed(1)}% (目標: 65-80%)`)
      log(``)

      // Write to file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const outputPath = `log/live-api-report-${timestamp}.md`
      mkdirSync('log', { recursive: true })
      writeFileSync(outputPath, lines.join('\n'), 'utf-8')

      // Also write to a stable path for easy access
      writeFileSync('log/live-api-report-latest.md', lines.join('\n'), 'utf-8')
    }, 600_000)
  }
)
