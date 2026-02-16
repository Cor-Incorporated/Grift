import { describe, expect, it } from 'vitest'
import { resolveRequestedDeadline } from '@/lib/intake/deadline'

describe('resolveRequestedDeadline', () => {
  it('normalizes ISO date strings into dueAt', () => {
    const result = resolveRequestedDeadline({
      dueDate: '2026-03-31',
      details: {},
    })

    expect(result.raw).toBe('2026-03-31')
    expect(result.dueAt).toBeTypeOf('string')
    expect(result.dueAt?.startsWith('2026-03-30T')).toBe(true)
  })

  it('reads deadline from details when dueDate is not provided', () => {
    const result = resolveRequestedDeadline({
      dueDate: null,
      details: {
        deadline: '2026/04/15',
      },
    })

    expect(result.raw).toBe('2026/04/15')
    expect(result.dueAt).toBeTypeOf('string')
  })

  it('keeps raw hint and leaves dueAt null when date format is not parseable', () => {
    const result = resolveRequestedDeadline({
      dueDate: '3月末',
      details: {},
    })

    expect(result.raw).toBe('3月末')
    expect(result.dueAt).toBeNull()
  })
})

