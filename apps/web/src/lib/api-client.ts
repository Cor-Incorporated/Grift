import createClient from 'openapi-fetch'
import type { components, paths } from '@/types/api'
import type { ConversationTurn, NDJSONChunk } from '@/types/conversation'

export type CaseRecord = components['schemas']['Case']
export type CaseDetailRecord = components['schemas']['CaseWithDetails']
export type CaseStatus = components['schemas']['CaseStatus']
export type CaseType = components['schemas']['CaseType']

// WARNING: dev-only stub — must be replaced before production (ADR-0003)
// In production, tenant ID must come from Firebase Auth token claims.
const DEV_TENANT_ID = '11111111-1111-1111-1111-111111111111'
export const DEFAULT_TENANT_ID =
  import.meta.env.VITE_TENANT_ID ?? DEV_TENANT_ID
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

export const caseTypeOptions: CaseType[] = [
  'new_project',
  'bug_report',
  'fix_request',
  'feature_addition',
  'undetermined',
]

export const caseStatusOptions: CaseStatus[] = [
  'draft',
  'interviewing',
  'analyzing',
  'estimating',
  'proposed',
  'approved',
  'rejected',
  'on_hold',
]

export const caseTypeLabels: Record<CaseType, string> = {
  new_project: 'New project',
  bug_report: 'Bug report',
  fix_request: 'Fix request',
  feature_addition: 'Feature addition',
  undetermined: 'Undetermined',
}

export const caseStatusLabels: Record<CaseStatus, string> = {
  draft: 'Draft',
  interviewing: 'Interviewing',
  analyzing: 'Analyzing',
  estimating: 'Estimating',
  proposed: 'Proposed',
  approved: 'Approved',
  rejected: 'Rejected',
  on_hold: 'On hold',
}

export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-Tenant-ID': DEFAULT_TENANT_ID,
  },
})

type ApiErrorPayload = {
  error?: {
    message?: string
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === 'object' && value !== null && 'error' in value
}

export function getApiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
) {
  if (isApiErrorPayload(error) && typeof error.error?.message === 'string') {
    return error.error.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

// ─── Conversation API helpers ───────────────────────────────
// TODO: Auth headers will be added when Firebase Auth is integrated (ADR-0003).
// Currently listConversationTurns and streamMessage send X-Tenant-ID only.

export async function listConversationTurns(
  caseId: string,
): Promise<ConversationTurn[]> {
  const res = await fetch(
    `${API_BASE_URL}/v1/cases/${encodeURIComponent(caseId)}/conversations`,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': DEFAULT_TENANT_ID,
      },
    },
  )

  if (!res.ok) {
    throw new Error(`API error ${res.status}`)
  }

  const json: unknown = await res.json()
  if (
    typeof json !== 'object' ||
    json === null ||
    !('data' in json) ||
    !Array.isArray((json as Record<string, unknown>).data)
  ) {
    throw new Error('Unexpected API response shape')
  }
  return (json as { data: ConversationTurn[] }).data
}

export async function* streamMessage(
  caseId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<NDJSONChunk> {
  const res = await fetch(
    `${API_BASE_URL}/v1/cases/${encodeURIComponent(caseId)}/conversations/stream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': DEFAULT_TENANT_ID,
      },
      body: JSON.stringify({ content }),
      ...(signal ? { signal } : {}),
    },
  )

  if (!res.ok) {
    throw new Error(`API error ${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        try {
          yield JSON.parse(trimmed) as NDJSONChunk
        } catch {
          yield { type: 'error', error: `Malformed NDJSON: ${trimmed.slice(0, 100)}` } as NDJSONChunk
        }
      }
    }

    // Flush any remaining multi-byte UTF-8 sequences from the decoder
    buffer += decoder.decode()

    if (buffer.trim() !== '') {
      try {
        yield JSON.parse(buffer.trim()) as NDJSONChunk
      } catch {
        yield { type: 'error', error: `Malformed NDJSON: ${buffer.trim().slice(0, 100)}` } as NDJSONChunk
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function formatDateTime(value?: string) {
  if (!value) {
    return 'Not available'
  }

  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
