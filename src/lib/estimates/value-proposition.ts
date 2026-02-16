import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import type { BusinessLine } from '@/types/database'
import type { GoNoGoResult } from '@/lib/approval/go-no-go'
import type { PriceCalculationResult } from '@/lib/pricing/engine'
import type { SimilarProject } from '@/lib/estimates/similar-projects'
import type { ImplementationPlan } from '@/lib/estimates/module-decomposition'
import type { SpeedAdvantage } from '@/lib/estimates/speed-advantage'

export interface ValueProposition {
  portfolioHighlights: Array<{
    repoName: string
    relevance: string
    techOverlap: string[]
  }>
  marketComparison: {
    marketPrice: number
    ourPrice: number
    savingsPercent: number
    narrative: string
  }
  uniqueStrengths: string[]
  riskMitigations: string[]
  generatedMarkdown: string
}

interface GenerateValuePropositionInput {
  specMarkdown: string
  similarProjects: SimilarProject[]
  goNoGoResult: GoNoGoResult
  pricingResult: PriceCalculationResult
  businessLine: BusinessLine
  implementationPlan?: ImplementationPlan | null
  speedAdvantage?: SpeedAdvantage | null
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  }
}

const BUSINESS_LINE_STRENGTHS: Record<BusinessLine, string[]> = {
  boltsite: [
    'Webアプリ・サイト構築の豊富な実績',
    'Next.js/React専門チームによる高速開発',
    'レスポンシブ・アクセシビリティ対応標準装備',
  ],
  iotrealm: [
    'IoT/組込みシステムの専門知識',
    'センサー連携・リアルタイムデータ処理の実績',
    'ハードウェア・ソフトウェア一体型開発対応',
  ],
  tapforge: [
    'NFC/モバイル決済の専門開発チーム',
    'デジタル名刺・タッチポイントソリューション',
    'BLE/NFC技術の先進的な活用実績',
  ],
}

function buildPortfolioHighlights(
  similarProjects: SimilarProject[]
): ValueProposition['portfolioHighlights'] {
  return similarProjects.slice(0, 3).map((project) => ({
    repoName: project.repoFullName,
    relevance: project.matchReasons.join('、') || '技術的類似性あり',
    techOverlap: project.techStack,
  }))
}

function buildMarketComparisonBase(
  pricingResult: PriceCalculationResult
): Omit<ValueProposition['marketComparison'], 'narrative'> {
  const { marketTotal, ourPrice } = pricingResult
  const savingsPercent = marketTotal > 0
    ? Math.round((1 - ourPrice / marketTotal) * 100)
    : 0

  return {
    marketPrice: marketTotal,
    ourPrice,
    savingsPercent,
  }
}

function buildBaseStrengths(businessLine: BusinessLine): string[] {
  const lineStrengths = BUSINESS_LINE_STRENGTHS[businessLine] ?? []
  return [
    '「共創」の開発スタイル：お客様と一体となったプロジェクト推進',
    '少人数精鋭チームによる機動力と意思決定の速さ',
    `${businessLine}事業に特化した専門チーム体制`,
    ...lineStrengths,
  ]
}

async function generateAiContent(
  input: GenerateValuePropositionInput,
  portfolioHighlights: ValueProposition['portfolioHighlights'],
  marketBase: Omit<ValueProposition['marketComparison'], 'narrative'>,
  baseStrengths: string[]
): Promise<{
  narrative: string
  additionalStrengths: string[]
  riskMitigations: string[]
  generatedMarkdown: string
}> {
  const portfolioSection = portfolioHighlights.length > 0
    ? portfolioHighlights.map((h) =>
        `- ${h.repoName}: ${h.relevance}（技術: ${h.techOverlap.join(', ')}）`
      ).join('\n')
    : 'ポートフォリオの直接一致なし'

  const conditionsSection = input.goNoGoResult.conditions.length > 0
    ? input.goNoGoResult.conditions.map((c) => `- ${c}`).join('\n')
    : '特になし'

  const implementationPlanSection = input.implementationPlan
    ? `\n## 実装計画
- 全体週数: ${input.implementationPlan.totalWeeks}週間
- モジュール数: ${input.implementationPlan.modules.length}
- フェーズ:
${input.implementationPlan.phases.map((p) => `  - ${p.name}（第${p.weekStart}-${p.weekEnd}週、並列${p.parallelStreams}ストリーム）: ${p.modules.join(', ')}`).join('\n')}
- MVP必須モジュール: ${input.implementationPlan.mvpModules.join(', ')}
- 推奨チーム: ${input.implementationPlan.teamRecommendation.optimalSize}名（${input.implementationPlan.teamRecommendation.roles.join(', ')}）`
    : ''

  const speedAdvantageSection = input.speedAdvantage
    ? `\n## スピード優位性
- 効率倍率: ${input.speedAdvantage.speedMultiplier}x
- 期間短縮: ${Math.round(input.speedAdvantage.durationSavingsPercent)}%
- 市場見積: ${input.speedAdvantage.marketEstimate.teamSize}名 x ${input.speedAdvantage.marketEstimate.durationMonths}ヶ月
- 当社見積: ${input.speedAdvantage.ourEstimate.teamSize}名 x ${input.speedAdvantage.ourEstimate.durationMonths}ヶ月
${input.speedAdvantage.hasHistoricalData ? `- 実績データあり: ${input.speedAdvantage.similarProject?.name ?? '類似PJ'}` : ''}
- 概要: ${input.speedAdvantage.narrative}`
    : ''

  const prompt = `あなたはCor.株式会社の提案書作成アシスタントです。以下の情報から、顧客向けバリュープロポジションを生成してください。

## Cor.株式会社のMVV
- Mission: 共創で社会にインパクトを
- 少人数精鋭の機動力で、お客様と一体となった開発
- 事業ライン: ${input.businessLine}

## 案件仕様
${input.specMarkdown.slice(0, 2000)}

## ポートフォリオ（類似案件）
${portfolioSection}

## 価格比較
- 市場平均: ¥${marketBase.marketPrice.toLocaleString()}
- 当社見積: ¥${marketBase.ourPrice.toLocaleString()}
- 削減率: ${marketBase.savingsPercent}%

## Go/No-Go評価
- 判定: ${input.goNoGoResult.decision}
- 総合スコア: ${input.goNoGoResult.overallScore}/100
- 条件:
${conditionsSection}
${implementationPlanSection}
${speedAdvantageSection}

## 当社の強み（ベース）
${baseStrengths.map((s) => `- ${s}`).join('\n')}

以下のJSON形式で回答してください:
\`\`\`json
{
  "narrative": "市場比較の説明文（2-3文。価格優位性とその理由を顧客向けに説明）",
  "additionalStrengths": ["AI分析による追加の強み1", "追加の強み2"],
  "riskMitigations": ["リスク条件に対する具体的な低減策1", "低減策2"],
  "generatedMarkdown": "提案書のMarkdown全文（ポートフォリオ、価格比較、強み、リスク低減策を含む）"
}
\`\`\`

制約:
- 回答はJSON形式のみ
- generatedMarkdownは見出し付きの構造化されたMarkdown
- riskMitigationsはgoNoGoの各conditionに対応する具体的な対策
- 日本語で記述`

  const response = await sendMessage(
    prompt,
    [{ role: 'user', content: '提案書を生成してください。' }],
    {
      temperature: 0.4,
      maxTokens: 4096,
      usageContext: input.usageContext,
    }
  )

  const parsed = parseJsonFromResponse<{
    narrative?: string
    additionalStrengths?: string[]
    riskMitigations?: string[]
    generatedMarkdown?: string
  }>(response)

  return {
    narrative: typeof parsed.narrative === 'string' && parsed.narrative.length > 0
      ? parsed.narrative
      : buildFallbackNarrative(marketBase),
    additionalStrengths: Array.isArray(parsed.additionalStrengths)
      ? parsed.additionalStrengths.filter((s): s is string => typeof s === 'string')
      : [],
    riskMitigations: Array.isArray(parsed.riskMitigations)
      ? parsed.riskMitigations.filter((s): s is string => typeof s === 'string')
      : buildFallbackRiskMitigations(input.goNoGoResult.conditions),
    generatedMarkdown: typeof parsed.generatedMarkdown === 'string' && parsed.generatedMarkdown.length > 0
      ? parsed.generatedMarkdown
      : buildFallbackMarkdown(portfolioHighlights, marketBase, baseStrengths),
  }
}

function buildFallbackNarrative(
  marketBase: Omit<ValueProposition['marketComparison'], 'narrative'>
): string {
  if (marketBase.savingsPercent > 0) {
    return `市場平均価格¥${marketBase.marketPrice.toLocaleString()}に対し、当社は¥${marketBase.ourPrice.toLocaleString()}（${marketBase.savingsPercent}%削減）でご提供いたします。少人数精鋭チームによる効率的な開発プロセスにより、品質を維持しながらコスト最適化を実現します。`
  }
  return '当社の専門チームによる確実な開発体制で、お客様の要件を最適なコストで実現いたします。'
}

function buildFallbackRiskMitigations(conditions: string[]): string[] {
  if (conditions.length === 0) {
    return ['現時点で特筆すべきリスクは検出されていません。']
  }
  return conditions.map((condition) => `${condition}に対し、プロジェクト開始前に対策を講じます。`)
}

function buildFallbackMarkdown(
  portfolioHighlights: ValueProposition['portfolioHighlights'],
  marketBase: Omit<ValueProposition['marketComparison'], 'narrative'>,
  baseStrengths: string[]
): string {
  const sections: string[] = ['# バリュープロポジション']

  if (portfolioHighlights.length > 0) {
    sections.push(
      '\n## ポートフォリオ実績',
      ...portfolioHighlights.map((h) =>
        `- **${h.repoName}**: ${h.relevance}`
      )
    )
  }

  if (marketBase.marketPrice > 0) {
    sections.push(
      '\n## コスト比較',
      `- 市場平均: ¥${marketBase.marketPrice.toLocaleString()}`,
      `- 当社見積: ¥${marketBase.ourPrice.toLocaleString()}`,
      `- **削減率: ${marketBase.savingsPercent}%**`
    )
  }

  sections.push(
    '\n## 当社の強み',
    ...baseStrengths.map((s) => `- ${s}`)
  )

  return sections.join('\n')
}

export async function generateValueProposition(
  input: GenerateValuePropositionInput
): Promise<ValueProposition> {
  const portfolioHighlights = buildPortfolioHighlights(input.similarProjects)
  const marketBase = buildMarketComparisonBase(input.pricingResult)
  const baseStrengths = buildBaseStrengths(input.businessLine)

  let aiContent: {
    narrative: string
    additionalStrengths: string[]
    riskMitigations: string[]
    generatedMarkdown: string
  }

  try {
    aiContent = await generateAiContent(input, portfolioHighlights, marketBase, baseStrengths)
  } catch {
    // AI generation failed — use fallback content
    aiContent = {
      narrative: buildFallbackNarrative(marketBase),
      additionalStrengths: [],
      riskMitigations: buildFallbackRiskMitigations(input.goNoGoResult.conditions),
      generatedMarkdown: buildFallbackMarkdown(portfolioHighlights, marketBase, baseStrengths),
    }
  }

  return {
    portfolioHighlights,
    marketComparison: {
      ...marketBase,
      narrative: aiContent.narrative,
    },
    uniqueStrengths: [...baseStrengths, ...aiContent.additionalStrengths],
    riskMitigations: aiContent.riskMitigations,
    generatedMarkdown: aiContent.generatedMarkdown,
  }
}
