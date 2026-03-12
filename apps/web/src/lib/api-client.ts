import createClient from 'openapi-fetch'
import type { components, paths } from '@/types/api'

export type CaseRecord = components['schemas']['Case']
export type CaseDetailRecord = components['schemas']['CaseWithDetails']
export type CaseStatus = components['schemas']['CaseStatus']
export type CaseType = components['schemas']['CaseType']

export const DEFAULT_TENANT_ID = '11111111-1111-1111-1111-111111111111'
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

export function formatDateTime(value?: string) {
  if (!value) {
    return 'Not available'
  }

  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
