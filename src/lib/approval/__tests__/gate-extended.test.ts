import { describe, it, expect } from 'vitest'
import {
  buildApprovalTriggersFromRiskFlags,
  deriveApprovalStatus,
  resolveEstimateStatus,
} from '@/lib/approval/gate'

// ---------------------------------------------------------------------------
// buildApprovalTriggersFromRiskFlags
// ---------------------------------------------------------------------------

describe('buildApprovalTriggersFromRiskFlags', () => {
  it('returns empty array when riskFlags is empty', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: [],
      projectType: 'new_project',
    })

    expect(triggers).toHaveLength(0)
  })

  it('emits floor_breach trigger with critical severity when FLOOR_BREACH flag is present', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['FLOOR_BREACH'],
      projectType: 'new_project',
    })

    expect(triggers).toHaveLength(1)
    const trigger = triggers[0]
    expect(trigger.requestType).toBe('floor_breach')
    expect(trigger.severity).toBe('critical')
    expect(trigger.reason).toContain('原価下限')
    expect(trigger.context.risk_flag).toBe('FLOOR_BREACH')
    expect(trigger.context.project_type).toBe('new_project')
  })

  it('emits low_margin trigger with high severity when LOW_MARGIN flag is present', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['LOW_MARGIN'],
      projectType: 'feature_addition',
    })

    expect(triggers).toHaveLength(1)
    const trigger = triggers[0]
    expect(trigger.requestType).toBe('low_margin')
    expect(trigger.severity).toBe('high')
    expect(trigger.reason).toContain('最低粗利率')
    expect(trigger.context.risk_flag).toBe('LOW_MARGIN')
    expect(trigger.context.project_type).toBe('feature_addition')
  })

  it('emits high_risk_change trigger with high severity when DELTA_BELOW_FLOOR flag is present', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['DELTA_BELOW_FLOOR'],
      projectType: 'fix_request',
    })

    expect(triggers).toHaveLength(1)
    const trigger = triggers[0]
    expect(trigger.requestType).toBe('high_risk_change')
    expect(trigger.severity).toBe('high')
    expect(trigger.reason).toContain('下限原価')
    expect(trigger.context.risk_flag).toBe('DELTA_BELOW_FLOOR')
    expect(trigger.context.project_type).toBe('fix_request')
  })

  it('emits all three triggers when all three flags are present', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['FLOOR_BREACH', 'LOW_MARGIN', 'DELTA_BELOW_FLOOR'],
      projectType: 'new_project',
    })

    expect(triggers).toHaveLength(3)
    expect(triggers.map((t) => t.requestType)).toEqual([
      'floor_breach',
      'low_margin',
      'high_risk_change',
    ])
  })

  it('ignores unknown/unhandled risk flags', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['UNKNOWN_FLAG', 'ANOTHER_UNKNOWN'],
      projectType: 'new_project',
    })

    expect(triggers).toHaveLength(0)
  })

  it('merges pricingContext into trigger context', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['FLOOR_BREACH'],
      projectType: 'new_project',
      pricingContext: { margin_percent: -10, our_price: 3_000_000 },
    })

    expect(triggers[0].context.margin_percent).toBe(-10)
    expect(triggers[0].context.our_price).toBe(3_000_000)
  })

  it('works when pricingContext is undefined (no spread error)', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['LOW_MARGIN'],
      projectType: 'new_project',
      pricingContext: undefined,
    })

    expect(triggers[0].context.project_type).toBe('new_project')
    // Should not include extra keys from pricingContext
    expect(Object.keys(triggers[0].context)).toEqual(['risk_flag', 'project_type'])
  })

  it('preserves order: FLOOR_BREACH before LOW_MARGIN before DELTA_BELOW_FLOOR', () => {
    const triggers = buildApprovalTriggersFromRiskFlags({
      riskFlags: ['DELTA_BELOW_FLOOR', 'LOW_MARGIN', 'FLOOR_BREACH'],
      projectType: 'new_project',
    })

    // Order is determined by the if-checks in the function, not riskFlags order
    expect(triggers[0].requestType).toBe('floor_breach')
    expect(triggers[1].requestType).toBe('low_margin')
    expect(triggers[2].requestType).toBe('high_risk_change')
  })
})

// ---------------------------------------------------------------------------
// deriveApprovalStatus
// ---------------------------------------------------------------------------

describe('deriveApprovalStatus', () => {
  it('returns not_required when statuses array is empty', () => {
    expect(deriveApprovalStatus([])).toBe('not_required')
  })

  it('returns rejected when any status is rejected, even if others are approved', () => {
    expect(deriveApprovalStatus(['approved', 'rejected', 'approved'])).toBe('rejected')
  })

  it('returns rejected when all statuses are rejected', () => {
    expect(deriveApprovalStatus(['rejected', 'rejected'])).toBe('rejected')
  })

  it('returns pending when any status is pending', () => {
    expect(deriveApprovalStatus(['approved', 'pending'])).toBe('pending')
  })

  it('returns pending when any status is cancelled', () => {
    expect(deriveApprovalStatus(['approved', 'cancelled'])).toBe('pending')
  })

  it('returns pending when statuses include both pending and cancelled', () => {
    expect(deriveApprovalStatus(['pending', 'cancelled'])).toBe('pending')
  })

  it('returns approved when all statuses are approved', () => {
    expect(deriveApprovalStatus(['approved', 'approved', 'approved'])).toBe('approved')
  })

  it('returns approved for single approved status', () => {
    expect(deriveApprovalStatus(['approved'])).toBe('approved')
  })

  it('rejected takes precedence over pending', () => {
    // rejected check is first, so it wins
    expect(deriveApprovalStatus(['pending', 'rejected'])).toBe('rejected')
  })

  it('returns pending as fallback when statuses have unrecognised values', () => {
    // Not empty, not rejected, not pending/cancelled, not all approved
    // Falls through to return 'pending'
    expect(deriveApprovalStatus(['unknown_status'])).toBe('pending')
  })

  it('returns pending for mixed approved and unknown statuses', () => {
    expect(deriveApprovalStatus(['approved', 'some_other'])).toBe('pending')
  })
})

// ---------------------------------------------------------------------------
// resolveEstimateStatus
// ---------------------------------------------------------------------------

describe('resolveEstimateStatus', () => {
  it('returns draft with no approvalBlockReason when evidenceRequirementMet=false', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: false,
      approvalStatus: 'approved',
    })

    expect(result.estimateStatus).toBe('draft')
    expect(result.approvalBlockReason).toBeNull()
  })

  it('returns draft regardless of approval status when evidence not met', () => {
    for (const status of ['not_required', 'pending', 'approved', 'rejected'] as const) {
      const result = resolveEstimateStatus({
        evidenceRequirementMet: false,
        approvalStatus: status,
      })

      expect(result.estimateStatus).toBe('draft')
      expect(result.approvalBlockReason).toBeNull()
    }
  })

  it('returns draft with block reason when evidence met and approval is pending', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: true,
      approvalStatus: 'pending',
    })

    expect(result.estimateStatus).toBe('draft')
    expect(result.approvalBlockReason).toContain('未処理')
  })

  it('returns draft with block reason when evidence met and approval is rejected', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: true,
      approvalStatus: 'rejected',
    })

    expect(result.estimateStatus).toBe('draft')
    expect(result.approvalBlockReason).toContain('却下')
  })

  it('returns ready with no block reason when evidence met and approval is approved', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: true,
      approvalStatus: 'approved',
    })

    expect(result.estimateStatus).toBe('ready')
    expect(result.approvalBlockReason).toBeNull()
  })

  it('returns ready with no block reason when evidence met and approval is not_required', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: true,
      approvalStatus: 'not_required',
    })

    expect(result.estimateStatus).toBe('ready')
    expect(result.approvalBlockReason).toBeNull()
  })

  it('accepts optional evidenceReason parameter without error', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: true,
      evidenceReason: '市場データ不足',
      approvalStatus: 'approved',
    })

    expect(result.estimateStatus).toBe('ready')
  })

  it('pending block reason message mentions 承認リクエスト', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: true,
      approvalStatus: 'pending',
    })

    expect(result.approvalBlockReason).toContain('承認リクエスト')
  })

  it('rejected block reason message mentions 承認リクエスト', () => {
    const result = resolveEstimateStatus({
      evidenceRequirementMet: true,
      approvalStatus: 'rejected',
    })

    expect(result.approvalBlockReason).toContain('承認リクエスト')
  })
})
