import { describe, expect, it } from 'vitest'
import {
  buildFailureActionHints,
  classifyBatchRunFailure,
  summarizeBatchRunFailures,
  toFailureSummaryText,
} from '@/lib/intake/batch-run-failures'

describe('classifyBatchRunFailure', () => {
  it('classifies quota errors', () => {
    expect(classifyBatchRunFailure('429 rate limit exceeded')).toBe('quota')
  })

  it('classifies auth errors', () => {
    expect(classifyBatchRunFailure('403 forbidden')).toBe('auth')
  })

  it('classifies validation errors', () => {
    expect(classifyBatchRunFailure('入力データが不正です')).toBe('validation')
  })

  it('classifies network errors', () => {
    expect(classifyBatchRunFailure('Could not resolve host')).toBe('network')
  })

  it('falls back to unknown', () => {
    expect(classifyBatchRunFailure('unexpected panic')).toBe('unknown')
  })
})

describe('summarizeBatchRunFailures', () => {
  it('aggregates by category and renders compact text', () => {
    const summary = summarizeBatchRunFailures([
      { change_request_id: 'a', error: '429 rate limit exceeded' },
      { change_request_id: 'b', error: '403 forbidden' },
      { change_request_id: 'c', error: '403 forbidden' },
      { change_request_id: 'd', error: 'invalid payload' },
    ])

    expect(summary).toEqual({
      quota: 1,
      auth: 2,
      validation: 1,
      network: 0,
      unknown: 0,
    })
    expect(
      toFailureSummaryText([
        { change_request_id: 'a', error: '429 rate limit exceeded' },
        { change_request_id: 'b', error: '403 forbidden' },
      ])
    ).toBe('クォータ:1 / 認証:1')
  })

  it('returns action hints for detected categories', () => {
    const hints = buildFailureActionHints([
      { change_request_id: 'a', error: '429 rate limit exceeded' },
      { change_request_id: 'b', error: 'invalid payload' },
    ])

    expect(hints).toHaveLength(2)
    expect(hints[0]).toContain('クォータ超過')
    expect(hints[1]).toContain('入力不正')
  })
})
