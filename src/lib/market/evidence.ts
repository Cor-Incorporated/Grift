import type { ProjectType } from '@/types/database'
import {
  parseJsonFromResponse,
  requestXaiResponse,
  type XaiCitation,
  type XaiUsage,
} from '@/lib/ai/xai'
import { isExternalApiQuotaError, type UsageCallContext } from '@/lib/usage/api-usage'
import { logger } from '@/lib/utils/logger'

export interface MarketEvidence {
  marketHourlyRate: number
  marketRateRange: { min: number; max: number }
  marketEstimatedHoursMultiplier: number
  typicalTeamSize: number
  typicalDurationMonths: number
  monthlyUnitPrice: number
  trends: string[]
  risks: string[]
  summary: string
}

export interface MarketEvidenceResult {
  evidence: MarketEvidence
  citations: XaiCitation[]
  raw: unknown
  confidenceScore: number
  usage: XaiUsage
  isFallback: boolean
  fallbackReason: 'quota_exceeded' | 'upstream_error' | null
}

interface RawMarketEvidence {
  market_hourly_rate: number
  market_rate_range: {
    min: number
    max: number
  }
  market_estimated_hours_multiplier: number
  typical_team_size: number
  typical_duration_months: number
  monthly_unit_price: number
  trends: string[]
  risks: string[]
  summary: string
}

const defaultEvidence: MarketEvidence = {
  marketHourlyRate: 10_000,
  marketRateRange: { min: 7_000, max: 15_000 },
  marketEstimatedHoursMultiplier: 1.8,
  typicalTeamSize: 4,
  typicalDurationMonths: 4,
  monthlyUnitPrice: 1_100_000,
  trends: [],
  risks: [],
  summary: 'xAI から市場データを取得できなかったため、デフォルト値を使用しています。',
}

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return value
}

function normalize(raw: Partial<RawMarketEvidence>): MarketEvidence {
  return {
    marketHourlyRate: safeNumber(raw.market_hourly_rate, defaultEvidence.marketHourlyRate),
    marketRateRange: {
      min: safeNumber(raw.market_rate_range?.min, defaultEvidence.marketRateRange.min),
      max: safeNumber(raw.market_rate_range?.max, defaultEvidence.marketRateRange.max),
    },
    marketEstimatedHoursMultiplier: safeNumber(
      raw.market_estimated_hours_multiplier,
      defaultEvidence.marketEstimatedHoursMultiplier
    ),
    typicalTeamSize: Math.max(1, Math.round(safeNumber(raw.typical_team_size, defaultEvidence.typicalTeamSize))),
    typicalDurationMonths: Math.max(
      0.5,
      safeNumber(raw.typical_duration_months, defaultEvidence.typicalDurationMonths)
    ),
    monthlyUnitPrice: safeNumber(raw.monthly_unit_price, defaultEvidence.monthlyUnitPrice),
    trends: Array.isArray(raw.trends)
      ? raw.trends.filter((item): item is string => typeof item === 'string')
      : [],
    risks: Array.isArray(raw.risks)
      ? raw.risks.filter((item): item is string => typeof item === 'string')
      : [],
    summary:
      typeof raw.summary === 'string' && raw.summary.length > 0
        ? raw.summary
        : defaultEvidence.summary,
  }
}

const HIGH_QUALITY_DOMAINS = [
  'nikkei.com', 'itmedia.co.jp', 'impress.co.jp', 'zdnet.com',
  'gartner.com', 'forrester.com', 'statista.com', 'idc.com',
  'meti.go.jp', 'ipa.go.jp',
]

const MEDIUM_QUALITY_DOMAINS = [
  'qiita.com', 'zenn.dev', 'note.com', 'techcrunch.com',
  'wired.jp', 'gigazine.net', 'publickey1.jp',
]

function scoreSourceQuality(citations: Array<{ url: string; type: string }>): number {
  if (citations.length === 0) return 0

  let bonus = 0
  for (const citation of citations) {
    try {
      const hostname = new URL(citation.url).hostname
      if (HIGH_QUALITY_DOMAINS.some((d) => hostname.endsWith(d))) {
        bonus += 0.1
      } else if (MEDIUM_QUALITY_DOMAINS.some((d) => hostname.endsWith(d))) {
        bonus += 0.05
      }
    } catch {
      // Invalid URL — skip
    }
  }

  return Math.min(bonus, 0.15)
}

function calculateConfidence(
  citationsCount: number,
  trendCount: number,
  citations: Array<{ url: string; type: string }> = []
): number {
  const base = citationsCount >= 2 ? 0.7 : citationsCount === 1 ? 0.55 : 0.4
  const trendBonus = Math.min(trendCount * 0.03, 0.2)
  const sourceQualityBonus = scoreSourceQuality(citations)
  return Math.min(0.95, Math.round((base + trendBonus + sourceQualityBonus) * 100) / 100)
}

export async function fetchMarketEvidenceFromXai(input: {
  projectType: ProjectType
  context: string
  region?: string
  usageContext?: UsageCallContext
}): Promise<MarketEvidenceResult> {
  try {
    const systemPrompt =
      'あなたはB2B受託開発の市場調査アナリストです。必ず客観データとURL付き根拠を優先し、JSONのみで回答してください。'

    const userPrompt = `次の案件の見積りに使う市場データを調査してください。

案件タイプ: ${input.projectType}
地域: ${input.region ?? '日本'}
要件抜粋:
${input.context.slice(0, 3000)}

チーム規模・期間の目安（案件タイプ別）:
- new_project（新規開発）: チーム3-8名、期間3-12ヶ月が一般的
- feature_addition（機能追加）: チーム1-4名、期間1-4ヶ月が一般的
- bug_report / fix_request（修正）: チーム1-2名、期間0.5-2ヶ月が一般的
案件の規模と複雑さに応じて、上記レンジ内で適切な値を選んでください。

以下のJSON形式で返してください:
\`\`\`json
{
  "market_hourly_rate": "<市場の平均時間単価（円）>",
  "market_rate_range": { "min": "<最低時間単価>", "max": "<最高時間単価>" },
  "market_estimated_hours_multiplier": "<市場の一般的な工数倍率（1.0-3.0）>",
  "typical_team_size": "<このタイプの案件に必要な典型的チーム人数>",
  "typical_duration_months": "<このタイプの案件の典型的な開発期間（月）>",
  "monthly_unit_price": "<エンジニア1名あたりの月額単価（円）>",
  "trends": ["市場トレンド1", "市場トレンド2"],
  "risks": ["リスク要因1", "リスク要因2"],
  "summary": "調査結果の要約"
}
\`\`\`

制約:
- 数値は実務で使える現実的な値にする
- 複数ソースを検索し、引用URLはレスポンスのcitationで返す`

    const response = await requestXaiResponse(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        model: process.env.XAI_SEARCH_MODEL ?? 'grok-4-1-fast',
        tools: ['web_search', 'x_search'],
        reasoningEffort: 'medium',
        temperature: 0.2,
        usageContext: input.usageContext,
      }
    )

    const parsed = parseJsonFromResponse<Partial<RawMarketEvidence>>(response.text)
    const normalized = normalize(parsed)

    return {
      evidence: normalized,
      citations: response.citations,
      raw: response.raw,
      confidenceScore: calculateConfidence(response.citations.length, normalized.trends.length, response.citations),
      usage: response.usage,
      isFallback: false,
      fallbackReason: null,
    }
  } catch (error) {
    const quotaNote = isExternalApiQuotaError(error)
      ? 'xAI API クォータ上限のため、前回確認済みのデフォルト値にフォールバックしました。'
      : null

    logger.warn('Failed to fetch market evidence from xAI', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      evidence: {
        ...defaultEvidence,
        summary: quotaNote ?? defaultEvidence.summary,
      },
      citations: [],
      raw: null,
      confidenceScore: 0.3,
      usage: {},
      isFallback: true,
      fallbackReason: isExternalApiQuotaError(error) ? 'quota_exceeded' : 'upstream_error',
    }
  }
}
