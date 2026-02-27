import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import type { ChangeRequestCategory, ImpactLevel, IntakeIntentType } from '@/types/database'

interface RawIntentCandidate {
  intent_type?: unknown
  title?: unknown
  summary?: unknown
  priority_hint?: unknown
  due_date?: unknown
  details?: unknown
  confidence?: unknown
}

interface RawParseResponse {
  intents?: unknown
  message_summary?: unknown
}

export interface ParsedIntent {
  intentType: IntakeIntentType
  category: ChangeRequestCategory
  title: string
  summary: string
  priorityHint: ImpactLevel
  dueDate: string | null
  details: Record<string, unknown>
  confidence: number
}

export interface IntakeParseResult {
  intents: ParsedIntent[]
  messageSummary: string
  parser: 'anthropic' | 'heuristic'
}

export type IntakeParserMode = 'auto' | 'heuristic'

const INTENT_TYPE_MAP: Record<string, IntakeIntentType> = {
  bug_report: 'bug_report',
  fix_request: 'fix_request',
  feature_addition: 'feature_addition',
  new_project: 'feature_addition',
  scope_change: 'scope_change',
  account_task: 'account_task',
  billing_risk: 'billing_risk',
  other: 'other',
}

const INTENT_TO_CATEGORY: Record<IntakeIntentType, ChangeRequestCategory> = {
  bug_report: 'bug_report',
  fix_request: 'fix_request',
  feature_addition: 'feature_addition',
  scope_change: 'scope_change',
  account_task: 'other',
  billing_risk: 'other',
  other: 'other',
}

const PRIORITY_HINT_MAP: Record<string, ImpactLevel> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
}

function clampConfidence(value: unknown, fallback = 0.5): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return Math.max(0, Math.min(1, value))
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

function normalizePriority(value: unknown): ImpactLevel {
  if (typeof value !== 'string') return 'medium'
  return PRIORITY_HINT_MAP[value] ?? 'medium'
}

function normalizeDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function normalizeDueDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 50)
}

function normalizeIntentType(value: unknown): IntakeIntentType | null {
  if (typeof value !== 'string') return null
  return INTENT_TYPE_MAP[value] ?? null
}

function extractDateHint(message: string): string | null {
  const explicitDate = message.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (explicitDate) return explicitDate[0]

  const monthEnd = message.match(/\d{1,2}月末/)
  if (monthEnd) return monthEnd[0]

  if (message.includes('今日')) return '今日'
  if (message.includes('明日')) return '明日'
  return null
}

function buildHeuristicIntent(intentType: IntakeIntentType, message: string): ParsedIntent {
  const dueDate = extractDateHint(message)
  const firstLine = message.split('\n').find((line) => line.trim().length > 0)?.trim() ?? message.trim()
  const title = firstLine.slice(0, 100) || '依頼の詳細確認'

  return {
    intentType,
    category: INTENT_TO_CATEGORY[intentType],
    title,
    summary: message.slice(0, 2000),
    priorityHint: intentType === 'bug_report' ? 'high' : 'medium',
    dueDate,
    details: {
      summary: message.slice(0, 2000),
      deadline: dueDate ?? undefined,
    },
    confidence: 0.55,
  }
}

function parseHeuristically(message: string): IntakeParseResult {
  const intents = new Set<IntakeIntentType>()
  const normalized = message.toLowerCase()

  if (
    normalized.includes('バグ')
    || normalized.includes('不具合')
    || normalized.includes('エラー')
    || normalized.includes('怪しい')
    || normalized.includes('クラッシュ')
  ) {
    intents.add('bug_report')
  }

  if (
    normalized.includes('アカウント')
    || normalized.includes('ユーザー作成')
    || normalized.includes('ユーザ作成')
    || normalized.includes('パスワード')
  ) {
    intents.add('account_task')
  }

  if (
    normalized.includes('実装')
    || normalized.includes('機能')
    || normalized.includes('チュートリアル')
    || normalized.includes('フォルダ')
    || normalized.includes('新規開発')
    || normalized.includes('新規プロジェクト')
    || normalized.includes('新しいアプリ')
    || normalized.includes('新しいシステム')
    || normalized.includes('ゼロから')
  ) {
    intents.add('feature_addition')
  }

  if (
    normalized.includes('請求')
    || normalized.includes('引き落とし')
    || normalized.includes('口座')
    || normalized.includes('決済')
  ) {
    intents.add('billing_risk')
  }

  if (
    normalized.includes('当初')
    || normalized.includes('実は')
    || normalized.includes('変更')
    || normalized.includes('納期')
  ) {
    intents.add('scope_change')
  }

  if (intents.size === 0) {
    intents.add('other')
  }

  return {
    intents: [...intents].map((intentType) => buildHeuristicIntent(intentType, message)),
    messageSummary: message.slice(0, 500),
    parser: 'heuristic',
  }
}

function sanitizeIntents(raw: unknown, message: string): ParsedIntent[] {
  if (!Array.isArray(raw)) return []

  const intents: ParsedIntent[] = []
  for (const item of raw) {
    const row = item as RawIntentCandidate
    const intentType = normalizeIntentType(row.intent_type)
    if (!intentType) continue

    const summary = normalizeText(row.summary, message.slice(0, 2000))
    const title = normalizeText(row.title, summary.slice(0, 100))
    const details = normalizeDetails(row.details)
    if (!details.summary) {
      details.summary = summary
    }

    intents.push({
      intentType,
      category: INTENT_TO_CATEGORY[intentType],
      title,
      summary,
      priorityHint: normalizePriority(row.priority_hint),
      dueDate: normalizeDueDate(row.due_date),
      details,
      confidence: clampConfidence(row.confidence),
    })
  }

  return intents
}

async function parseWithAnthropic(message: string): Promise<IntakeParseResult> {
  const systemPrompt = `あなたは受託開発PMOです。自由文の依頼を複数の意図に分解してください。
必ずJSONのみを返してください。説明文や前置きは禁止です。
intent_type は次のみ使用:
- bug_report
- fix_request
- feature_addition
- scope_change
- account_task
- billing_risk
- other
priority_hint は low/medium/high/critical のみ。`

  const userPrompt = `以下の入力を、着手単位の意図に分解してください。

入力:
${message}

出力形式(JSON):
\`\`\`json
{
  "message_summary": "全体要約",
  "intents": [
    {
      "intent_type": "bug_report",
      "title": "短いタイトル",
      "summary": "意図の要約",
      "priority_hint": "high",
      "due_date": "2026-03-31",
      "details": {
        "summary": "詳細"
      },
      "confidence": 0.86
    }
  ]
}
\`\`\`

制約:
- 1入力に複数意図があれば必ず分割する
- 不明点は details に欠損として残す（推測で埋めない）
- intents は最低1件返す`

  const text = await sendMessage(systemPrompt, [{ role: 'user', content: userPrompt }], {
    temperature: 0.1,
    maxTokens: 2000,
  })

  const parsed = parseJsonFromResponse<RawParseResponse>(text)
  const intents = sanitizeIntents(parsed.intents, message)
  const messageSummary = normalizeText(parsed.message_summary, message.slice(0, 500))

  if (intents.length === 0) {
    return parseHeuristically(message)
  }

  return {
    intents,
    messageSummary,
    parser: 'anthropic',
  }
}

function resolveParserMode(mode?: IntakeParserMode): IntakeParserMode {
  if (mode) return mode

  const envMode = process.env.PO_INTAKE_PARSER_MODE?.trim().toLowerCase()
  if (envMode === 'heuristic') return 'heuristic'
  return 'auto'
}

export async function parseIntakeMessage(
  message: string,
  options?: { mode?: IntakeParserMode }
): Promise<IntakeParseResult> {
  const mode = resolveParserMode(options?.mode)
  if (mode === 'heuristic') {
    return parseHeuristically(message)
  }

  try {
    return await parseWithAnthropic(message)
  } catch {
    return parseHeuristically(message)
  }
}
