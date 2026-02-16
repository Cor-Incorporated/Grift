export type BatchRunFailureCategory =
  | 'quota'
  | 'auth'
  | 'validation'
  | 'network'
  | 'unknown'

export interface BatchRunFailureItem {
  change_request_id: string
  error: string
}

const CATEGORY_LABELS: Record<BatchRunFailureCategory, string> = {
  quota: 'クォータ',
  auth: '認証',
  validation: '入力',
  network: 'ネットワーク',
  unknown: 'その他',
}

function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern))
}

export function classifyBatchRunFailure(error: string): BatchRunFailureCategory {
  const normalized = error.toLowerCase()

  if (
    containsAny(normalized, [
      'quota',
      'rate limit',
      '429',
      'クォータ',
      '上限',
      'rate_limit',
    ])
  ) {
    return 'quota'
  }

  if (
    containsAny(normalized, [
      '401',
      '403',
      'unauthorized',
      'forbidden',
      '認証',
      '権限',
      'access denied',
    ])
  ) {
    return 'auth'
  }

  if (
    containsAny(normalized, [
      'validation',
      'invalid',
      'bad request',
      '入力データが不正',
      '必須',
      'zod',
      'schema',
    ])
  ) {
    return 'validation'
  }

  if (
    containsAny(normalized, [
      'timeout',
      'network',
      'dns',
      'fetch failed',
      'econnreset',
      'could not resolve',
      '接続',
      'タイムアウト',
    ])
  ) {
    return 'network'
  }

  return 'unknown'
}

export function summarizeBatchRunFailures(
  items: BatchRunFailureItem[]
): Record<BatchRunFailureCategory, number> {
  const summary: Record<BatchRunFailureCategory, number> = {
    quota: 0,
    auth: 0,
    validation: 0,
    network: 0,
    unknown: 0,
  }

  for (const item of items) {
    summary[classifyBatchRunFailure(item.error)] += 1
  }

  return summary
}

export function toFailureSummaryText(items: BatchRunFailureItem[]): string {
  const summary = summarizeBatchRunFailures(items)
  const parts = (Object.keys(summary) as BatchRunFailureCategory[])
    .filter((key) => summary[key] > 0)
    .map((key) => `${CATEGORY_LABELS[key]}:${summary[key]}`)

  return parts.length > 0 ? parts.join(' / ') : '失敗なし'
}

export function buildFailureActionHints(items: BatchRunFailureItem[]): string[] {
  const summary = summarizeBatchRunFailures(items)
  const hints: string[] = []

  if (summary.quota > 0) {
    hints.push('クォータ超過: API上限設定と再試行間隔を見直してください。')
  }
  if (summary.auth > 0) {
    hints.push('認証エラー: 権限ロールまたはAPIキー設定を確認してください。')
  }
  if (summary.validation > 0) {
    hints.push('入力不正: 依頼情報の必須項目と時給入力値を確認してください。')
  }
  if (summary.network > 0) {
    hints.push('ネットワーク: 一時障害の可能性があるため再実行を推奨します。')
  }
  if (summary.unknown > 0) {
    hints.push('その他: 失敗詳細を監査ログで確認し、分類ルールへ追加してください。')
  }

  return hints
}
