import { describe, expect, it } from 'vitest'
import {
  buildApprovalTriggersFromRiskFlags,
  deriveApprovalStatus,
  resolveEstimateStatus,
} from '@/lib/approval/gate'

describe('approval gate', () => {
  it('builds floor breach and low margin triggers', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['FLOOR_BREACH', 'LOW_MARGIN'],
      projectType: 'new_project',
      pricingContext: { margin_percent: 10 },
    })

    expect(triggers.map((item) => item.requestType)).toEqual(['floor_breach', 'low_margin'])
  })

  it('derives pending/approved/rejected statuses', () => {
    expect(deriveApprovalStatus([])).toBe('not_required')
    expect(deriveApprovalStatus(['pending'])).toBe('pending')
    expect(deriveApprovalStatus(['approved', 'approved'])).toBe('approved')
    expect(deriveApprovalStatus(['approved', 'rejected'])).toBe('rejected')
  })

  it('keeps draft while approval is pending even when evidence met', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: true,
      approvalStatus: 'pending',
    })

    expect(result.estimateStatus).toBe('draft')
    expect(result.approvalBlockReason).toContain('承認リクエスト')
  })
})
