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
  pageStructure: string[]
  navigationPattern: string
  uiComponents: string[]
  designPatterns: string[]
  responsiveApproach: string
  interactiveFeatures: string[]
  estimatedComplexity: string
}

const SYSTEM_PROMPT = `あなたはソフトウェア受託開発の見積もり・要件定義を支援するAIです。

指定されたURLのウェブサイトを調査し、**UIの構造・デザインパターン・技術的な設計**に焦点を当てて分析してください。
顧客はこのウェブサイトを「参考にしたい」「このようなものを作りたい」という意図で提供しています。

以下の観点で分析してください：

### UI・構造分析（最重要）
- ページ構成（トップページ、LP、管理画面、一覧/詳細の構造など）
- ナビゲーションパターン（ヘッダーナビ、サイドバー、ブレッドクラム、タブ等）
- 主要UIコンポーネント（フォーム、テーブル、カード、モーダル、カルーセル等）
- デザインパターン（SPA/MPA、カード型レイアウト、マスター/ディテール等）
- レスポンシブ対応（モバイルファースト、アダプティブ、デスクトップ専用等）
- インタラクティブ機能（リアルタイム更新、フィルタ、チャット、通知等）

### 技術分析
- 使用している技術スタック（検出可能な場合: フレームワーク、UIライブラリ等）
- 推定される複雑度とその根拠

### 補足情報
- 企業・組織の概要（事業内容、業界）
- 提供しているサービスや製品
- ソフトウェア開発見積もりに関連するコンテキスト

回答は必ず以下のJSON形式で返してください：
\`\`\`json
{
  "summary": "ウェブサイトの簡潔な要約（日本語、200文字以内）",
  "companyOverview": "企業・組織の概要",
  "services": ["サービス1", "サービス2"],
  "detectedTechStack": ["技術1", "技術2"],
  "scaleIndicators": ["規模指標1", "規模指標2"],
  "keyFeatures": ["機能1", "機能2"],
  "estimationContext": "見積もりに関連するコンテキスト",
  "pageStructure": ["トップページ: ヒーロー+特徴紹介", "料金ページ: プラン比較表"],
  "navigationPattern": "ヘッダー固定ナビ + ハンバーガーメニュー（モバイル）",
  "uiComponents": ["検索フォーム", "データテーブル", "モーダルダイアログ"],
  "designPatterns": ["カード型レイアウト", "SPA"],
  "responsiveApproach": "モバイルファースト、ブレークポイント3段階",
  "interactiveFeatures": ["リアルタイム検索", "ドラッグ&ドロップ"],
  "estimatedComplexity": "高 - ダッシュボード型で多数のインタラクティブ要素あり"
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
    pageStructure: [],
    navigationPattern: '',
    uiComponents: [],
    designPatterns: [],
    responsiveApproach: '',
    interactiveFeatures: [],
    estimatedComplexity: '',
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
  pageStructure?: unknown
  navigationPattern?: unknown
  uiComponents?: unknown
  designPatterns?: unknown
  responsiveApproach?: unknown
  interactiveFeatures?: unknown
  estimatedComplexity?: unknown
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
    pageStructure: toStringArray(parsed.pageStructure),
    navigationPattern: typeof parsed.navigationPattern === 'string'
      ? parsed.navigationPattern.trim()
      : '',
    uiComponents: toStringArray(parsed.uiComponents),
    designPatterns: toStringArray(parsed.designPatterns),
    responsiveApproach: typeof parsed.responsiveApproach === 'string'
      ? parsed.responsiveApproach.trim()
      : '',
    interactiveFeatures: toStringArray(parsed.interactiveFeatures),
    estimatedComplexity: typeof parsed.estimatedComplexity === 'string'
      ? parsed.estimatedComplexity.trim()
      : '',
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
