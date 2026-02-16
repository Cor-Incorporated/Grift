import { inflateSync } from 'node:zlib'
import {
  sendMessage,
  sendVisionMessage,
  buildDocumentBlock,
  validatePdfSize,
} from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import type { UsageCallContext } from '@/lib/usage/api-usage'

const MAX_EXTRACTED_TEXT_CHARS = 18_000
const MAX_ANALYSIS_TEXT_CHARS = 12_000

interface RawPdfAnalysis {
  summary?: unknown
  key_points?: unknown
  risks?: unknown
  change_impact_points?: unknown
  recommended_questions?: unknown
}

export interface PdfAnalysisResult {
  summary: string
  extractedTextLength: number
  keyPoints: string[]
  risks: string[]
  changeImpactPoints: string[]
  recommendedQuestions: string[]
}

function decodePdfStringToken(token: string): string {
  let out = ''
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i]
    if (char !== '\\') {
      out += char
      continue
    }

    const next = token[i + 1]
    if (!next) break

    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === 't') out += '\t'
    else if (next === 'b') out += '\b'
    else if (next === 'f') out += '\f'
    else if (next === '(') out += '('
    else if (next === ')') out += ')'
    else if (next === '\\') out += '\\'
    else if (/[0-7]/.test(next)) {
      const octal = token.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? next
      out += String.fromCharCode(parseInt(octal, 8))
      i += octal.length - 1
    } else {
      out += next
    }
    i += 1
  }
  return out
}

function toTextArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, limit)
}

function extractTextTokensFromPdfContent(content: string): string[] {
  const tokens: string[] = []

  const singleRegex = /\((?:\\.|[^\\)])*\)\s*Tj/g
  for (const match of content.matchAll(singleRegex)) {
    const literal = match[0]
    const body = literal.slice(1, literal.lastIndexOf(')'))
    const decoded = decodePdfStringToken(body).trim()
    if (decoded) tokens.push(decoded)
  }

  const arrayRegex = /\[([\s\S]*?)\]\s*TJ/g
  for (const match of content.matchAll(arrayRegex)) {
    const body = match[1]
    const strMatches = body.match(/\((?:\\.|[^\\)])*\)/g) ?? []
    for (const strToken of strMatches) {
      const decoded = decodePdfStringToken(strToken.slice(1, -1)).trim()
      if (decoded) tokens.push(decoded)
    }
  }

  return tokens
}

function collectPdfStreams(raw: string): string[] {
  const streams: string[] = []
  const streamRegex = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g

  for (const match of raw.matchAll(streamRegex)) {
    const dict = match[1] ?? ''
    const body = match[2] ?? ''

    if (dict.includes('/FlateDecode')) {
      try {
        const inflated = inflateSync(Buffer.from(body, 'latin1')).toString('latin1')
        streams.push(inflated)
      } catch {
        streams.push(body)
      }
    } else {
      streams.push(body)
    }
  }

  return streams
}

export function extractTextFromPdfBuffer(pdfBuffer: Buffer): string {
  const raw = pdfBuffer.toString('latin1')
  const streams = collectPdfStreams(raw)

  const lines: string[] = []
  for (const stream of streams) {
    const tokens = extractTextTokensFromPdfContent(stream)
    lines.push(...tokens)
    if (lines.join('\n').length >= MAX_EXTRACTED_TEXT_CHARS) break
  }

  const normalized = lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1)
    .join('\n')
    .slice(0, MAX_EXTRACTED_TEXT_CHARS)

  return normalized
}

function buildParsedResult(
  parsed: RawPdfAnalysis,
  extractedTextLength: number,
  fallbackSummary: string
): PdfAnalysisResult {
  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : fallbackSummary

  return {
    summary,
    extractedTextLength,
    keyPoints: toTextArray(parsed.key_points),
    risks: toTextArray(parsed.risks),
    changeImpactPoints: toTextArray(parsed.change_impact_points),
    recommendedQuestions: toTextArray(parsed.recommended_questions),
  }
}

async function analyzePdfNative(input: {
  fileName: string
  pdfBuffer: Buffer
  pdfText: string
  usageContext?: UsageCallContext
}): Promise<PdfAnalysisResult> {
  validatePdfSize(input.pdfBuffer)

  const base64Data = input.pdfBuffer.toString('base64')
  const documentBlock = buildDocumentBlock(base64Data)

  const prompt = `このPDFドキュメントを分析してください。ファイル名: ${input.fileName}

受託開発の追加実装見積りに必要な情報を抽出し、JSONのみで返してください。

出力形式:
\`\`\`json
{
  "summary": "2-4文の要約",
  "key_points": ["..."],
  "risks": ["..."],
  "change_impact_points": ["..."],
  "recommended_questions": ["..."]
}
\`\`\`

制約:
- 日本語で返答
- 不明点は推定と明記
- 各配列は最大10件
- 図表やレイアウトも含めて分析してください`

  const response = await sendVisionMessage(
    'あなたは要件定義と変更見積りの分析官です。曖昧な内容は明示し、誤推定を避けてください。',
    [{
      role: 'user',
      content: [
        documentBlock,
        { type: 'text', text: prompt },
      ],
    }],
    { maxTokens: 1500, temperature: 0.1, usageContext: input.usageContext }
  )

  const parsed = parseJsonFromResponse<RawPdfAnalysis>(response)
  return buildParsedResult(parsed, input.pdfText.length, 'PDFドキュメントをネイティブ解析しました。')
}

async function analyzePdfFromText(input: {
  fileName: string
  pdfText: string
  usageContext?: UsageCallContext
}): Promise<PdfAnalysisResult> {
  const extractedTextLength = input.pdfText.length

  if (!input.pdfText.trim()) {
    return {
      summary: 'PDFの本文抽出に失敗したため、内容要約を生成できませんでした。',
      extractedTextLength,
      keyPoints: [],
      risks: [],
      changeImpactPoints: [],
      recommendedQuestions: [],
    }
  }

  const prompt = `次のPDF本文抽出テキストから、受託開発の追加実装見積りに必要な情報を抽出し、JSONのみで返してください。

ファイル名: ${input.fileName}

出力形式:
\`\`\`json
{
  "summary": "2-4文の要約",
  "key_points": ["..."],
  "risks": ["..."],
  "change_impact_points": ["..."],
  "recommended_questions": ["..."]
}
\`\`\`

制約:
- 日本語で返答
- 不明点は推定と明記
- 各配列は最大10件

本文:
${input.pdfText.slice(0, MAX_ANALYSIS_TEXT_CHARS)}`

  try {
    const response = await sendMessage(
      'あなたは要件定義と変更見積りの分析官です。曖昧な内容は明示し、誤推定を避けてください。',
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.1,
        maxTokens: 1500,
        usageContext: input.usageContext,
      }
    )

    const parsed = parseJsonFromResponse<RawPdfAnalysis>(response)
    return buildParsedResult(parsed, extractedTextLength, 'PDF本文から要約を抽出しました。')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    return {
      summary: `PDF本文は抽出できましたが、Claude解析に失敗しました (${message})`,
      extractedTextLength,
      keyPoints: [],
      risks: [],
      changeImpactPoints: [],
      recommendedQuestions: [],
    }
  }
}

export async function analyzePdfWithClaude(input: {
  fileName: string
  pdfBuffer?: Buffer
  pdfText: string
  usageContext?: UsageCallContext
}): Promise<PdfAnalysisResult> {
  if (input.pdfBuffer && input.pdfBuffer.length <= 32 * 1024 * 1024) {
    try {
      return await analyzePdfNative({
        fileName: input.fileName,
        pdfBuffer: input.pdfBuffer,
        pdfText: input.pdfText,
        usageContext: input.usageContext,
      })
    } catch {
      // フォールバック: テキスト抽出ベースの既存ロジック
    }
  }

  return analyzePdfFromText({
    fileName: input.fileName,
    pdfText: input.pdfText,
    usageContext: input.usageContext,
  })
}
