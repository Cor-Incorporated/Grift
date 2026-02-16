import type { IntakeIntentType } from '@/types/database'

const DEFAULT_MIN_COMPLETENESS = 80

const REQUIRED_FIELDS: Record<IntakeIntentType, string[]> = {
  bug_report: [
    'summary',
    'environment',
    'repro_steps',
    'expected_behavior',
    'actual_behavior',
    'impact_scope',
    'urgency',
    'evidence',
  ],
  fix_request: [
    'summary',
    'current_behavior',
    'expected_behavior',
    'impact_scope',
    'deadline',
  ],
  feature_addition: [
    'summary',
    'business_goal',
    'acceptance_criteria',
    'impact_scope',
    'deadline',
  ],
  scope_change: [
    'summary',
    'change_reason',
    'affected_area',
    'deadline',
  ],
  account_task: [
    'summary',
    'target_accounts',
    'requested_deadline',
  ],
  billing_risk: [
    'summary',
    'billing_issue',
    'deadline',
    'evidence',
  ],
  other: [
    'summary',
    'details',
  ],
}

const FOLLOW_UP_QUESTION_BY_FIELD: Record<string, string> = {
  summary: '依頼内容を1文で要約すると何ですか？',
  environment: '発生環境（本番/検証、OS、ブラウザ、端末）を教えてください。',
  repro_steps: '再現手順をステップ形式で教えてください。',
  expected_behavior: '本来どう動くべきか（期待動作）を教えてください。',
  actual_behavior: '実際にはどう動いているか（実動作）を教えてください。',
  impact_scope: '影響範囲（誰に、どの機能に影響するか）を教えてください。',
  urgency: '緊急度（いつまでに必要か）を教えてください。',
  evidence: 'ログ・スクリーンショット・動画・URLなど証跡を共有できますか？',
  current_behavior: '現在の動作を具体的に教えてください。',
  deadline: '希望納期（年月日）を教えてください。',
  business_goal: 'この依頼で達成したいビジネス目的を教えてください。',
  acceptance_criteria: '完了判定の条件（受け入れ基準）を教えてください。',
  change_reason: '今回の変更が必要になった背景を教えてください。',
  affected_area: '影響が出る画面/API/機能を教えてください。',
  target_accounts: '対象アカウント（件数、識別子）を教えてください。',
  requested_deadline: 'この作業の希望期限を教えてください。',
  billing_issue: '請求・口座に関する問題内容を具体的に教えてください。',
  details: '詳細情報をもう少し具体的に教えてください。',
}

function isFilledString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeDetailValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (Array.isArray(value)) {
    const joined = value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join('\n')
    return joined.trim()
  }
  return ''
}

export function getRequiredFields(intentType: IntakeIntentType): string[] {
  return REQUIRED_FIELDS[intentType]
}

export function resolveMinimumCompleteness(defaultValue = DEFAULT_MIN_COMPLETENESS): number {
  const raw = process.env.PO_REQUIREMENT_MIN_COMPLETENESS
  if (!raw) return defaultValue
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return defaultValue
  return Math.min(100, Math.max(0, Math.round(parsed)))
}

export function calculateCompleteness(input: {
  intentType: IntakeIntentType
  details: Record<string, unknown>
  summary?: string
}): {
  score: number
  missingFields: string[]
} {
  const requiredFields = getRequiredFields(input.intentType)
  const enrichedDetails: Record<string, string> = {}

  for (const [key, value] of Object.entries(input.details)) {
    enrichedDetails[key] = normalizeDetailValue(value)
  }
  if (!enrichedDetails.summary && isFilledString(input.summary)) {
    enrichedDetails.summary = input.summary!.trim()
  }

  let presentCount = 0
  const missingFields: string[] = []
  for (const field of requiredFields) {
    if (isFilledString(enrichedDetails[field])) {
      presentCount += 1
    } else {
      missingFields.push(field)
    }
  }

  const score = requiredFields.length === 0
    ? 100
    : Math.round((presentCount / requiredFields.length) * 100)

  return {
    score,
    missingFields,
  }
}

export function toIntakeStatus(input: {
  score: number
  minimumCompleteness?: number
}): 'needs_info' | 'ready_to_start' {
  const threshold = input.minimumCompleteness ?? resolveMinimumCompleteness()
  return input.score >= threshold ? 'ready_to_start' : 'needs_info'
}

export function buildFollowUpQuestion(input: {
  intentType: IntakeIntentType
  missingFields: string[]
}): string {
  const first = input.missingFields[0]
  if (!first) {
    return '現時点の情報で着手可能です。追加で共有したい情報があれば教えてください。'
  }

  return FOLLOW_UP_QUESTION_BY_FIELD[first]
    ?? `不足している情報（${first}）を教えてください。`
}
