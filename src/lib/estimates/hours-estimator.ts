import { requestXaiResponse, parseJsonFromResponse } from '@/lib/ai/xai'
import { logger } from '@/lib/utils/logger'
import type { ProjectType } from '@/types/database'

const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1000

export interface HoursEstimate {
  investigation: number
  implementation: number
  testing: number
  buffer: number
  total: number
  breakdown: string
}

export async function estimateHours(
  specMarkdown: string,
  projectType: ProjectType,
  attachmentContext?: string,
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  },
  evidenceContext?: string
): Promise<HoursEstimate> {
  const attachmentBlock = attachmentContext
    ? `\n\n添付資料解析の要約:\n${attachmentContext}`
    : ''

  const evidenceBlock = evidenceContext
    ? `## 証拠データ（類似プロジェクト実績）\n${evidenceContext}\n\n重要: 上記の類似プロジェクト実績データがある場合、それを根拠として工数を校正してください。\n単純な感覚値ではなく、実績データとの乖離理由を工数内訳に明記してください。\n例: 「類似プロジェクト X の実績 200 時間を参照し、本案件は Y の追加要件があるため 280 時間と見積もりました」\n\n`
    : ''

  const systemPrompt = `${evidenceBlock}あなたはシニアソフトウェアエンジニアです。以下の仕様書を読み、工数を見積もってください。

案件タイプ: ${projectType}

以下の2パートで回答してください：

パート1: JSON（数値のみ）
各フェーズの時間（時間単位）をJSON形式で返してください：
\`\`\`json
{
  "investigation": 調査・分析時間,
  "implementation": 実装時間,
  "testing": テスト時間,
  "buffer": バッファ時間,
  "total": 合計時間
}
\`\`\`

パート2: 区切り線の後にMarkdown形式の工数内訳
---BREAKDOWN---
## 工数内訳
（ここにMarkdown形式で詳細な内訳説明を記述）

バッファ率の目安:
- bug_report: 20-30%
- fix_request: 10-20%
- feature_addition: 15-25%
- new_project: 15-25%

見積もり時の考慮事項:
- 添付資料の技術スタックやアーキテクチャ情報がある場合、フレームワーク固有の工数を反映してください
- リスクや変更影響ポイントがある場合、バッファ時間に適切に反映してください
- 主要モジュール情報がある場合、実装工数の精度を向上させてください
- 既存コードベースの規模や複雑さを考慮してください

制約:
- パート1のJSONには数値のみを含めてください（文字列フィールドは含めない）
- total は各項目の合計と一致させる
- パート2は必ず ---BREAKDOWN--- の後に出力してください`

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `${specMarkdown}${attachmentBlock}` },
  ]

  let grokResponse: Awaited<ReturnType<typeof requestXaiResponse>>
  let lastError: unknown = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      grokResponse = await requestXaiResponse(messages, {
        model: process.env.XAI_MODEL ?? 'grok-4-1-fast',
        temperature: 0.2,
        maxOutputTokens: 2048,
        usageContext,
      })
      lastError = null
      break
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        logger.warn('Hours estimation xAI call failed, retrying', {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          delayMs: delay,
          error: error instanceof Error ? error.message : String(error),
        })
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  if (lastError) {
    throw new Error(
      `工数見積りのAI呼び出しが${MAX_RETRIES + 1}回失敗しました: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    )
  }

  const response = grokResponse!.text

  // Separate JSON and breakdown using delimiter
  const breakdownDelimiter = '---BREAKDOWN---'
  const delimiterIndex = response.indexOf(breakdownDelimiter)

  let jsonPart: string
  let breakdownPart: string

  if (delimiterIndex !== -1) {
    jsonPart = response.slice(0, delimiterIndex)
    breakdownPart = response.slice(delimiterIndex + breakdownDelimiter.length).trim()
  } else {
    jsonPart = response
    breakdownPart = ''
  }

  let parsed: Partial<HoursEstimate>
  try {
    parsed = parseJsonFromResponse<Partial<HoursEstimate>>(jsonPart)
  } catch (parseError) {
    throw new Error(
      `工数見積りのJSON解析に失敗しました: ${parseError instanceof Error ? parseError.message : String(parseError)}`
    )
  }

  const toSafeNumber = (value: unknown, fallback: number): number => {
    const num = Number(value ?? fallback)
    return Number.isFinite(num) ? Math.max(0, num) : fallback
  }

  const investigation = toSafeNumber(parsed.investigation, 0)
  const implementation = toSafeNumber(parsed.implementation, 0)
  const testing = toSafeNumber(parsed.testing, 0)
  const buffer = toSafeNumber(parsed.buffer, 0)
  const computedTotal = investigation + implementation + testing + buffer
  const parsedTotal = Number(parsed.total ?? computedTotal)
  const total = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : computedTotal

  return {
    investigation,
    implementation,
    testing,
    buffer,
    total,
    breakdown:
      breakdownPart.length > 0
        ? breakdownPart
        : typeof parsed.breakdown === 'string' && parsed.breakdown.length > 0
          ? parsed.breakdown
          : '工数内訳の詳細は生成できませんでした。',
  }
}

/** @deprecated Use estimateHours instead */
export { estimateHours as estimateHoursWithClaude }
