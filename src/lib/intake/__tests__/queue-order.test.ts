import { describe, expect, it } from 'vitest'
import { sortIntakeQueue } from '@/lib/intake/queue-order'

describe('sortIntakeQueue', () => {
  it('prioritizes impact, deadline, missing fields, then created_at', () => {
    const ordered = sortIntakeQueue([
      {
        id: 'a',
        impact_level: 'medium',
        requested_deadline_at: null,
        missing_fields: ['deadline', 'evidence'],
        created_at: '2026-02-13T10:00:00.000Z',
      },
      {
        id: 'b',
        impact_level: 'critical',
        requested_deadline_at: '2026-02-20T00:00:00.000Z',
        missing_fields: ['deadline'],
        created_at: '2026-02-13T12:00:00.000Z',
      },
      {
        id: 'c',
        impact_level: 'critical',
        requested_deadline_at: '2026-02-18T00:00:00.000Z',
        missing_fields: ['deadline', 'evidence', 'impact_scope'],
        created_at: '2026-02-13T09:00:00.000Z',
      },
      {
        id: 'd',
        impact_level: 'critical',
        requested_deadline_at: '2026-02-18T00:00:00.000Z',
        missing_fields: ['deadline'],
        created_at: '2026-02-13T11:00:00.000Z',
      },
    ])

    expect(ordered.map((item) => item.id)).toEqual(['d', 'c', 'b', 'a'])
  })
})

