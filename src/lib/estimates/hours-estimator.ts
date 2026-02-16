import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import type { ProjectType } from '@/types/database'

export interface HoursEstimate {
  investigation: number
  implementation: number
  testing: number
  buffer: number
  total: number
  breakdown: string
}

export async function estimateHoursWithClaude(
  specMarkdown: string,
  projectType: ProjectType,
  attachmentContext?: string,
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  }
): Promise<HoursEstimate> {
  const attachmentBlock = attachmentContext
    ? `\n\n添付資料解析の要約:\n${attachmentContext}`
    : ''
  const prompt = `あなたはシニアソフトウェアエンジニアです。以下の仕様書を読み、工数を見積もってください。

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

  const response = await sendMessage(prompt, [{ role: 'user', content: `${specMarkdown}${attachmentBlock}` }], {
    temperature: 0.2,
    maxTokens: 2048,
    usageContext,
  })

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

  const parsed = parseJsonFromResponse<Partial<HoursEstimate>>(jsonPart)

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
    breakdown:
      breakdownPart.length > 0
        ? breakdownPart
        : typeof parsed.breakdown === 'string' && parsed.breakdown.length > 0
          ? parsed.breakdown
          : '工数内訳の詳細は生成できませんでした。',
  }
}
