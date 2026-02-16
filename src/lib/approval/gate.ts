import type { ApprovalRequestType, ApprovalSeverity } from '@/types/database'

export type EstimateApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected'

export interface ApprovalTrigger {
  requestType: ApprovalRequestType
  severity: ApprovalSeverity
  reason: string
  context: Record<string, unknown>
}

function hasFlag(riskFlags: string[], flag: string): boolean {
  return riskFlags.includes(flag)
}

export function buildApprovalTriggersFromRiskFlags(input: {
  riskFlags: string[]
  projectType: string
  pricingContext?: Record<string, unknown>
}): ApprovalTrigger[] {
  const triggers: ApprovalTrigger[] = []

  if (hasFlag(input.riskFlags, 'FLOOR_BREACH')) {
    triggers.push({
      requestType: 'floor_breach',
      severity: 'critical',
      reason: '見積り金額が原価下限を下回るため、承認が必要です。',
      context: {
        risk_flag: 'FLOOR_BREACH',
        project_type: input.projectType,
        ...(input.pricingContext ?? {}),
      },
    })
  }

  if (hasFlag(input.riskFlags, 'LOW_MARGIN')) {
    triggers.push({
      requestType: 'low_margin',
      severity: 'high',
      reason: '最低粗利率を下回るため、承認が必要です。',
      context: {
        risk_flag: 'LOW_MARGIN',
        project_type: input.projectType,
        ...(input.pricingContext ?? {}),
      },
    })
  }

  if (hasFlag(input.riskFlags, 'DELTA_BELOW_FLOOR')) {
    triggers.push({
      requestType: 'high_risk_change',
      severity: 'high',
      reason: '変更見積りが下限原価を下回るため、承認が必要です。',
      context: {
        risk_flag: 'DELTA_BELOW_FLOOR',
        project_type: input.projectType,
        ...(input.pricingContext ?? {}),
      },
    })
  }

  return triggers
}

export function deriveApprovalStatus(requestStatuses: string[]): EstimateApprovalStatus {
  if (requestStatuses.length === 0) {
    return 'not_required'
  }

  if (requestStatuses.some((status) => status === 'rejected')) {
    return 'rejected'
  }

  if (requestStatuses.some((status) => status === 'pending' || status === 'cancelled')) {
    return 'pending'
  }

  if (requestStatuses.every((status) => status === 'approved')) {
    return 'approved'
  }

  return 'pending'
}

export function resolveEstimateStatus(input: {
  evidenceRequirementMet: boolean
  evidenceReason?: string | null
  approvalStatus: EstimateApprovalStatus
}): {
  estimateStatus: 'draft' | 'ready'
  approvalBlockReason: string | null
} {
  if (!input.evidenceRequirementMet) {
    return {
      estimateStatus: 'draft',
      approvalBlockReason: null,
    }
  }

  if (input.approvalStatus === 'pending') {
    return {
      estimateStatus: 'draft',
      approvalBlockReason: '承認リクエストが未処理のため、確定できません。',
    }
  }

  if (input.approvalStatus === 'rejected') {
    return {
      estimateStatus: 'draft',
      approvalBlockReason: '承認リクエストが却下されたため、確定できません。',
    }
  }

  return {
    estimateStatus: 'ready',
    approvalBlockReason: null,
  }
}
