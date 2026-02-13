function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toIsoDateOnly(value: string): string | null {
  const normalized = value.replace(/\//g, '-')
  const matched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return null

  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null
  }

  const date = new Date(`${normalized}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return null

  return date.toISOString()
}

function readDeadlineFromDetails(details: Record<string, unknown>): string | null {
  const candidates = [
    details.deadline,
    details.due_date,
    details.requested_deadline,
    details.requested_deadline_at,
  ]

  for (const candidate of candidates) {
    const parsed = toTrimmedString(candidate)
    if (parsed) return parsed
  }

  return null
}

export function resolveRequestedDeadline(input: {
  dueDate: string | null | undefined
  details: Record<string, unknown>
}): {
  raw: string | null
  dueAt: string | null
} {
  const raw = toTrimmedString(input.dueDate) ?? readDeadlineFromDetails(input.details)
  if (!raw) {
    return {
      raw: null,
      dueAt: null,
    }
  }

  return {
    raw,
    dueAt: toIsoDateOnly(raw),
  }
}

