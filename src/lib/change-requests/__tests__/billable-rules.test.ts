import { describe, expect, it } from 'vitest'
import { evaluateBillableDecision } from '@/lib/change-requests/billable-rules'

describe('billable rules', () => {
  it('returns non-billable for in-warranty bug with our fault', () => {
    const decision = evaluateBillableDecision({
      rules: [
        {
          id: 'rule-1',
          rule_name: 'r1',
          active: true,
          priority: 10,
          applies_to_categories: ['bug_report'],
          max_warranty_days: 30,
          responsibility_required: ['our_fault'],
          reproducibility_required: ['confirmed'],
          result_is_billable: false,
          reason_template: '無償',
        },
      ],
      request: {
        category: 'bug_report',
        projectCreatedAt: '2026-02-01T00:00:00.000Z',
        requestedAt: '2026-02-10T00:00:00.000Z',
        responsibilityType: 'our_fault',
        reproducibility: 'confirmed',
      },
    })

    expect(decision.isBillable).toBe(false)
    expect(decision.matchedRuleId).toBe('rule-1')
  })

  it('falls back to billable when rule does not match', () => {
    const decision = evaluateBillableDecision({
      rules: [],
      request: {
        category: 'feature_addition',
        projectCreatedAt: '2026-01-01T00:00:00.000Z',
        requestedAt: '2026-02-10T00:00:00.000Z',
        responsibilityType: 'unknown',
        reproducibility: 'unknown',
      },
    })

    expect(decision.isBillable).toBe(true)
    expect(decision.matchedRuleId).toBeNull()
  })
})
