import { requestXaiResponse, parseJsonFromResponse } from '@/lib/ai/xai'
import type { XaiCitation } from '@/lib/ai/xai'
import type { UsageCallContext } from '@/lib/usage/api-usage'

export interface WebsiteAnalysisResult {
  type: 'website_url'
  summary: string
  url: string
  companyOverview: string
  services: string[]
  detectedTechStack: string[]
  scaleIndicators: string[]
  keyFeatures: string[]
  estimationContext: string
  citations: Array<{ url: string; type: string }>
}

const SYSTEM_PROMPT = `あなたはソフトウェア受託開発の見積もり・要件定義を支援するAIです。

指定されたURLのウェブサイトを調査し、ソフトウェア開発プロジェクトのスコーピングと見積もりに役立つ情報を抽出してください。

以下の観点で分析してください：
- 企業・組織の概要（事業内容、業界、規模感）
- 提供しているサービスや製品
- 使用している技術スタック（検出可能な場合）
- 規模の指標（従業員数、ユーザー数、拠点数など）
- ウェブサイトの主要機能と特徴
- ソフトウェア開発見積もりに関連するコンテキスト

回答は必ず以下のJSON形式で返してください：
\`\`\`json
{
  "companyOverview": "企業・組織の概要（日本語）",
  "services": ["サービス1", "サービス2"],
  "detectedTechStack": ["技術1", "技術2"],
  "scaleIndicators": ["規模指標1", "規模指標2"],
  "keyFeatures": ["機能1", "機能2"],
  "estimationContext": "見積もりに関連するコンテキスト（日本語）",
  "summary": "ウェブサイトの簡潔な要約（日本語、200文字以内）"
}
\`\`\``

function buildEmptyResult(url: string, note: string): WebsiteAnalysisResult {
  return {
    type: 'website_url',
    summary: note,
    url,
    companyOverview: '',
    services: [],
    detectedTechStack: [],
    scaleIndicators: [],
    keyFeatures: [],
    estimationContext: note,
    citations: [],
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function formatCitations(xaiCitations: XaiCitation[]): Array<{ url: string; type: string }> {
  return xaiCitations.map((c) => ({
    url: c.url,
    type: c.type,
  }))
}

interface ParsedAnalysis {
  companyOverview?: unknown
  services?: unknown
  detectedTechStack?: unknown
  scaleIndicators?: unknown
  keyFeatures?: unknown
  estimationContext?: unknown
  summary?: unknown
}

function parseAnalysisResponse(
  text: string,
  url: string,
  citations: XaiCitation[]
): WebsiteAnalysisResult {
  let parsed: ParsedAnalysis
  try {
    parsed = parseJsonFromResponse<ParsedAnalysis>(text)
  } catch {
    return {
      ...buildEmptyResult(url, text.slice(0, 500)),
      citations: formatCitations(citations),
    }
  }

  const summary = typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
    ? parsed.summary.trim()
    : 'ウェブサイトの解析を完了しました。'

  return {
    type: 'website_url',
    summary,
    url,
    companyOverview: typeof parsed.companyOverview === 'string'
      ? parsed.companyOverview.trim()
      : '',
    services: toStringArray(parsed.services),
    detectedTechStack: toStringArray(parsed.detectedTechStack),
    scaleIndicators: toStringArray(parsed.scaleIndicators),
    keyFeatures: toStringArray(parsed.keyFeatures),
    estimationContext: typeof parsed.estimationContext === 'string'
      ? parsed.estimationContext.trim()
      : '',
    citations: formatCitations(citations),
  }
}

export async function analyzeWebsiteUrlWithGrok(
  url: string,
  usageContext?: UsageCallContext
): Promise<WebsiteAnalysisResult> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    throw new Error('XAI_API_KEY が設定されていません。ウェブサイト解析には xAI API キーが必要です。')
  }

  const response = await requestXaiResponse(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `以下のURLのウェブサイトを調査し、ソフトウェア開発見積もりに必要な情報を抽出してください。\n\nURL: ${url}`,
      },
    ],
    {
      tools: ['web_search'],
      temperature: 0.2,
      maxOutputTokens: 4000,
      timeoutMs: 90000,
      usageContext,
    }
  )

  if (!response.text || response.text.trim().length === 0) {
    return buildEmptyResult(
      url,
      'Grok からの応答が空でした。ウェブサイトにアクセスできない可能性があります。'
    )
  }

  return parseAnalysisResponse(response.text, url, response.citations)
}
