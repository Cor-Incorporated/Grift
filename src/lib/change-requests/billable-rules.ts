import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChangeRequestCategory,
  ChangeRequestResponsibility,
  ChangeRequestReproducibility,
} from '@/types/database'

interface ChangeRequestBillableRuleRow {
  id: string
  rule_name: string
  active: boolean
  priority: number
  applies_to_categories: string[]
  max_warranty_days: number | null
  responsibility_required: string[]
  reproducibility_required: string[]
  result_is_billable: boolean
  reason_template: string
}

export interface BillableRuleEvaluationInput {
  category: ChangeRequestCategory
  projectCreatedAt: string
  requestedAt?: string
  responsibilityType: ChangeRequestResponsibility
  reproducibility: ChangeRequestReproducibility
}

export interface BillableDecision {
  isBillable: boolean
  reason: string
  matchedRuleId: string | null
  evaluation: Record<string, unknown>
}

function isArrayOfString(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseRuleRow(row: Record<string, unknown>): ChangeRequestBillableRuleRow | null {
  if (typeof row.id !== 'string' || typeof row.rule_name !== 'string') {
    return null
  }

  if (!isArrayOfString(row.applies_to_categories)) {
    return null
  }

  return {
    id: row.id,
    rule_name: row.rule_name,
    active: Boolean(row.active),
    priority: typeof row.priority === 'number' ? row.priority : 100,
    applies_to_categories: row.applies_to_categories,
    max_warranty_days: typeof row.max_warranty_days === 'number' ? row.max_warranty_days : null,
    responsibility_required: isArrayOfString(row.responsibility_required) ? row.responsibility_required : [],
    reproducibility_required: isArrayOfString(row.reproducibility_required) ? row.reproducibility_required : [],
    result_is_billable: Boolean(row.result_is_billable),
    reason_template:
      typeof row.reason_template === 'string' && row.reason_template.trim().length > 0
        ? row.reason_template
        : 'ルールにより判定されました。',
  }
}

function daysSince(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return Number.POSITIVE_INFINITY
  }

  const diffMs = Math.max(0, to - from)
  return Math.floor(diffMs / (24 * 60 * 60 * 1000))
}

function matchesRule(input: {
  rule: ChangeRequestBillableRuleRow
  category: ChangeRequestCategory
  projectAgeDays: number
  responsibilityType: ChangeRequestResponsibility
  reproducibility: ChangeRequestReproducibility
}): boolean {
  const categoryMatch = input.rule.applies_to_categories.includes(input.category)
  if (!categoryMatch) {
    return false
  }

  const warrantyMatch =
    input.rule.max_warranty_days === null || input.projectAgeDays <= input.rule.max_warranty_days
  if (!warrantyMatch) {
    return false
  }

  const responsibilityMatch =
    input.rule.responsibility_required.length === 0
    || input.rule.responsibility_required.includes(input.responsibilityType)
  if (!responsibilityMatch) {
    return false
  }

  const reproducibilityMatch =
    input.rule.reproducibility_required.length === 0
    || input.rule.reproducibility_required.includes(input.reproducibility)

  return reproducibilityMatch
}

export async function loadActiveBillableRules(
  supabase: SupabaseClient
): Promise<ChangeRequestBillableRuleRow[]> {
  const { data, error } = await supabase
    .from('change_request_billable_rules')
    .select('*')
    .eq('active', true)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })

  if (error || !data) {
    return []
  }

  return data
    .map((row) => parseRuleRow(row as Record<string, unknown>))
    .filter((row): row is ChangeRequestBillableRuleRow => row !== null)
}

function fallbackDecision(input: {
  category: ChangeRequestCategory
  responsibilityType: ChangeRequestResponsibility
}): BillableDecision {
  if (input.category === 'bug_report' && input.responsibilityType === 'our_fault') {
    return {
      isBillable: false,
      reason: '当社責任の不具合として無償対応（暫定判定）',
      matchedRuleId: null,
      evaluation: {
        fallback: true,
        reason: 'rule_not_found',
      },
    }
  }

  return {
    isBillable: true,
    reason: '仕様追加・修正要求として有償対応（暫定判定）',
    matchedRuleId: null,
    evaluation: {
      fallback: true,
      reason: 'rule_not_found',
    },
  }
}

export function evaluateBillableDecision(input: {
  rules: ChangeRequestBillableRuleRow[]
  request: BillableRuleEvaluationInput
}): BillableDecision {
  const requestedAt = input.request.requestedAt ?? new Date().toISOString()
  const projectAgeDays = daysSince(input.request.projectCreatedAt, requestedAt)

  for (const rule of input.rules) {
    if (!rule.active) {
      continue
    }

    if (
      !matchesRule({
        rule,
        category: input.request.category,
        projectAgeDays,
        responsibilityType: input.request.responsibilityType,
        reproducibility: input.request.reproducibility,
      })
    ) {
      continue
    }

    return {
      isBillable: rule.result_is_billable,
      reason: rule.reason_template,
      matchedRuleId: rule.id,
      evaluation: {
        project_age_days: projectAgeDays,
        matched_rule_name: rule.rule_name,
        priority: rule.priority,
        max_warranty_days: rule.max_warranty_days,
        responsibility_type: input.request.responsibilityType,
        reproducibility: input.request.reproducibility,
      },
    }
  }

  return fallbackDecision({
    category: input.request.category,
    responsibilityType: input.request.responsibilityType,
  })
}
