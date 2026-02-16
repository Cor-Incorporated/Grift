import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import type { ProjectType } from '@/types/database'

export type BusinessLine = 'boltsite' | 'iotrealm' | 'tapforge'

export interface BusinessLineClassification {
  businessLine: BusinessLine
  confidence: number
  reasoning: string
}

interface ClassifyBusinessLineInput {
  specMarkdown: string
  projectType: ProjectType
  techStack?: string[]
  attachmentContext?: string
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  }
}

const KEYWORD_RULES: Array<{ keywords: string[]; line: BusinessLine }> = [
  { keywords: ['nfc', '名刺', 'tapforge', 'タップフォージ', 'ビジネスカード', 'デジタル名刺'], line: 'tapforge' },
  { keywords: ['ホスティング', 'cms', 'lp', 'ランディングページ', 'boltsite', 'ボルトサイト', 'wordpress', 'コーポレートサイト', '静的サイト'], line: 'boltsite' },
  { keywords: ['ai', 'ml', '機械学習', 'iot', 'iotrealm', 'ディープラーニング', 'カスタム開発', 'saas', 'スクラッチ開発'], line: 'iotrealm' },
]

function preScreenByKeywords(text: string): { line: BusinessLine; score: number } | null {
  const lower = text.toLowerCase()
  let bestMatch: { line: BusinessLine; score: number } | null = null

  for (const rule of KEYWORD_RULES) {
    const matchCount = rule.keywords.filter((kw) => lower.includes(kw)).length
    if (matchCount > 0) {
      const score = matchCount / rule.keywords.length
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { line: rule.line, score }
      }
    }
  }

  return bestMatch
}

export async function classifyBusinessLine(
  input: ClassifyBusinessLineInput
): Promise<BusinessLineClassification> {
  const combinedText = [
    input.specMarkdown,
    input.attachmentContext ?? '',
    (input.techStack ?? []).join(', '),
  ].join('\n')

  // 1. キーワード事前スクリーニング
  const keywordResult = preScreenByKeywords(combinedText)
  if (keywordResult && keywordResult.score >= 0.5) {
    return {
      businessLine: keywordResult.line,
      confidence: Math.min(0.9, keywordResult.score + 0.3),
      reasoning: `キーワードベースの事前スクリーニングにより ${keywordResult.line} と判定`,
    }
  }

  // 2. Claude API で最終判定
  const prompt = `あなたはCor.株式会社のセールスエンジニアです。以下の仕様書を読み、最も適切な事業ラインを判定してください。

## 事業ライン定義

1. **boltsite** — BoltSite事業: ウェブサイト制作、LP、コーポレートサイト、CMS、ホスティング関連。比較的シンプルなWeb制作案件。
2. **iotrealm** — IoTRealm事業: カスタムソフトウェア開発、SaaS、AI/ML、IoT、モバイルアプリ、複雑なシステム開発。高度な技術力が必要な案件。
3. **tapforge** — TapForge事業: NFC関連、デジタル名刺、タップ系デバイス連携、物理デバイスとデジタルの融合。

## 判定ルール
- 案件タイプが bug_report/fix_request の場合、既存システムの技術スタックから判断
- 明確に1つの事業ラインに分類できない場合、iotrealm（最も広範な事業ライン）をデフォルトとする
- confidence は 0.0〜1.0 で、確信度を表す

## 回答形式（JSON のみ）
\`\`\`json
{
  "businessLine": "boltsite" | "iotrealm" | "tapforge",
  "confidence": 0.0-1.0,
  "reasoning": "判定理由の説明"
}
\`\`\`

案件タイプ: ${input.projectType}`

  try {
    const response = await sendMessage(prompt, [
      { role: 'user', content: combinedText.slice(0, 6000) },
    ], {
      temperature: 0.1,
      maxTokens: 512,
      usageContext: input.usageContext,
    })

    const parsed = parseJsonFromResponse<{
      businessLine?: string
      confidence?: number
      reasoning?: string
    }>(response)

    const validLines: BusinessLine[] = ['boltsite', 'iotrealm', 'tapforge']
    const businessLine = validLines.includes(parsed.businessLine as BusinessLine)
      ? (parsed.businessLine as BusinessLine)
      : 'iotrealm'

    return {
      businessLine,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '判定理由不明',
    }
  } catch {
    // AI判定失敗時のフォールバック
    return {
      businessLine: keywordResult?.line ?? 'iotrealm',
      confidence: keywordResult ? 0.4 : 0.3,
      reasoning: 'AI判定に失敗したため、キーワードベースまたはデフォルト値を使用',
    }
  }
}
