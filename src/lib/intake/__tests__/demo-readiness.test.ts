import { describe, expect, it } from 'vitest'
import { INTAKE_DEMO_CASES } from '@/lib/intake/demo-cases'
import {
  buildLatestDemoRunByCase,
  evaluateDemoReadiness,
  resolveDemoRunStatus,
  toStringArray,
} from '@/lib/intake/demo-readiness'

describe('demo readiness helpers', () => {
  it('normalizes unknown arrays safely', () => {
    expect(toStringArray(null)).toEqual([])
    expect(toStringArray(['a', '', 'b', 3])).toEqual(['a', 'b'])
  })

  it('resolves run status from payload or created count', () => {
    expect(resolveDemoRunStatus({ created_count: 0, payload: { status: 'failed' } })).toBe('failed')
    expect(resolveDemoRunStatus({ created_count: 1, payload: {} })).toBe('succeeded')
    expect(resolveDemoRunStatus({ created_count: 0, payload: {} })).toBe('unknown')
  })

  it('evaluates readiness as all ready when all expected intents are covered', () => {
    const latest = buildLatestDemoRunByCase(
      INTAKE_DEMO_CASES.map((demoCase) => ({
        demo_case_id: demoCase.id,
        created_count: 1,
        payload: {
          status: 'succeeded',
          detected_intent_types: demoCase.expectedIntentTypes,
        },
      }))
    )

    const result = evaluateDemoReadiness({
      demoCases: INTAKE_DEMO_CASES,
      latestDemoRunByCase: latest,
    })

    expect(result.allReady).toBe(true)
    expect(result.readyCount).toBe(INTAKE_DEMO_CASES.length)
    expect(result.checks.every((item) => item.status === 'ready')).toBe(true)
  })

  it('marks missing and failed cases appropriately', () => {
    const latest = buildLatestDemoRunByCase([
      {
        demo_case_id: INTAKE_DEMO_CASES[0].id,
        created_count: 0,
        payload: {
          status: 'failed',
          error: 'insert failed',
        },
      },
    ])

    const result = evaluateDemoReadiness({
      demoCases: INTAKE_DEMO_CASES,
      latestDemoRunByCase: latest,
    })

    expect(result.allReady).toBe(false)
    expect(result.checks.find((item) => item.caseId === INTAKE_DEMO_CASES[0].id)?.status).toBe('failed')
    expect(result.checks.find((item) => item.caseId === INTAKE_DEMO_CASES[1].id)?.status).toBe('missing')
  })
})
