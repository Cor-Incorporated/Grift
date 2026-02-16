import { afterEach, describe, expect, it } from 'vitest'
import {
  buildFollowUpQuestion,
  calculateCompleteness,
  toIntakeStatus,
  resolveMinimumCompleteness,
} from '@/lib/intake/completeness'

afterEach(() => {
  delete process.env.PO_REQUIREMENT_MIN_COMPLETENESS
})

describe('calculateCompleteness', () => {
  it('returns low score when bug report is missing required fields', () => {
    const result = calculateCompleteness({
      intentType: 'bug_report',
      details: {
        summary: 'ログインが不安定',
      },
    })

    expect(result.score).toBe(13)
    expect(result.missingFields.length).toBeGreaterThan(0)
    expect(result.missingFields).toContain('repro_steps')
  })

  it('returns 100 for complete bug report details', () => {
    const result = calculateCompleteness({
      intentType: 'bug_report',
      details: {
        summary: 'ログインが失敗する',
        environment: 'production / chrome',
        repro_steps: '1. login page open\n2. submit',
        expected_behavior: 'ログイン成功',
        actual_behavior: '500エラー',
        impact_scope: '全ユーザー',
        urgency: 'high',
        evidence: 'https://example.com/log.png',
      },
    })

    expect(result.score).toBe(100)
    expect(result.missingFields).toEqual([])
  })
})

describe('toIntakeStatus', () => {
  it('uses env threshold by default', () => {
    process.env.PO_REQUIREMENT_MIN_COMPLETENESS = '85'
    expect(resolveMinimumCompleteness()).toBe(85)
    expect(toIntakeStatus({ score: 84 })).toBe('needs_info')
    expect(toIntakeStatus({ score: 85 })).toBe('ready_to_start')
  })

  it('supports explicit minimum completeness override', () => {
    expect(toIntakeStatus({ score: 70, minimumCompleteness: 60 })).toBe('ready_to_start')
  })
})

describe('buildFollowUpQuestion', () => {
  it('returns field-specific question', () => {
    const question = buildFollowUpQuestion({
      intentType: 'feature_addition',
      missingFields: ['acceptance_criteria'],
    })

    expect(question).toContain('受け入れ')
  })
})
