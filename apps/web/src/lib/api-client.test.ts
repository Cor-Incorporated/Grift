import { describe, expect, it } from 'vitest'
import {
  caseStatusLabels,
  caseStatusOptions,
  caseTypeLabels,
  caseTypeOptions,
  formatDateTime,
  getApiErrorMessage,
} from './api-client'

describe('formatDateTime', () => {
  it('formats a valid ISO date string', () => {
    const result = formatDateTime('2026-03-12T09:00:00Z')
    expect(typeof result).toBe('string')
    expect(result).not.toBe('Not available')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns "Not available" for undefined', () => {
    expect(formatDateTime(undefined)).toBe('Not available')
  })

  it('returns "Not available" for empty string', () => {
    expect(formatDateTime('')).toBe('Not available')
  })
})

describe('getApiErrorMessage', () => {
  it('extracts message from API error payload', () => {
    const error = { error: { message: 'Case not found' } }
    expect(getApiErrorMessage(error)).toBe('Case not found')
  })

  it('extracts message from Error instance', () => {
    const error = new Error('Network failure')
    expect(getApiErrorMessage(error)).toBe('Network failure')
  })

  it('returns fallback for non-object errors', () => {
    expect(getApiErrorMessage(null)).toBe(
      'Something went wrong. Please try again.',
    )
  })

  it('returns custom fallback when provided', () => {
    expect(getApiErrorMessage(42, 'Custom fallback')).toBe('Custom fallback')
  })

  it('returns fallback for API payload without message', () => {
    expect(getApiErrorMessage({ error: {} })).toBe(
      'Something went wrong. Please try again.',
    )
  })
})

describe('caseStatusLabels', () => {
  it('has labels for all expected statuses', () => {
    expect(caseStatusLabels.draft).toBe('Draft')
    expect(caseStatusLabels.interviewing).toBe('Interviewing')
    expect(caseStatusLabels.approved).toBe('Approved')
    expect(caseStatusLabels.rejected).toBe('Rejected')
    expect(caseStatusLabels.on_hold).toBe('On hold')
  })
})

describe('caseTypeLabels', () => {
  it('has labels for all expected types', () => {
    expect(caseTypeLabels.new_project).toBe('New project')
    expect(caseTypeLabels.bug_report).toBe('Bug report')
    expect(caseTypeLabels.undetermined).toBe('Undetermined')
  })
})

describe('caseStatusOptions', () => {
  it('contains all status values', () => {
    expect(caseStatusOptions).toContain('draft')
    expect(caseStatusOptions).toContain('approved')
    expect(caseStatusOptions).toContain('on_hold')
    expect(caseStatusOptions).toHaveLength(8)
  })
})

describe('caseTypeOptions', () => {
  it('contains all type values', () => {
    expect(caseTypeOptions).toContain('new_project')
    expect(caseTypeOptions).toContain('bug_report')
    expect(caseTypeOptions).toContain('undetermined')
    expect(caseTypeOptions).toHaveLength(5)
  })
})
