const IMPACT_SCORE: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

function toImpactScore(value: string | null | undefined): number {
  if (!value) return 0
  return IMPACT_SCORE[value] ?? 0
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY
  return parsed
}

function toCreatedAtTimestamp(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY
  return parsed
}

export interface IntakeQueueOrderItem {
  impact_level: string
  requested_deadline_at: string | null
  missing_fields: string[]
  created_at: string
}

export function sortIntakeQueue<T extends IntakeQueueOrderItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const impactDelta = toImpactScore(b.impact_level) - toImpactScore(a.impact_level)
    if (impactDelta !== 0) return impactDelta

    const deadlineDelta = toTimestamp(a.requested_deadline_at) - toTimestamp(b.requested_deadline_at)
    if (deadlineDelta !== 0) return deadlineDelta

    const missingDelta = a.missing_fields.length - b.missing_fields.length
    if (missingDelta !== 0) return missingDelta

    return toCreatedAtTimestamp(a.created_at) - toCreatedAtTimestamp(b.created_at)
  })
}

