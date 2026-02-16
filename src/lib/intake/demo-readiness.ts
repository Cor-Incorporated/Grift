import type { IntakeDemoCase } from '@/lib/intake/demo-cases'

export type DemoRunStatus = 'succeeded' | 'failed' | 'unknown'

export interface DemoRunForReadiness {
  demo_case_id: string
  created_count: number
  payload?: Record<string, unknown> | null
}

export interface DemoReadinessCheck {
  caseId: string
  title: string
  status: 'ready' | 'warning' | 'failed' | 'missing'
  hint: string
}

export interface DemoReadinessResult {
  checks: DemoReadinessCheck[]
  readyCount: number
  total: number
  allReady: boolean
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function resolveDemoRunStatus(run: Pick<DemoRunForReadiness, 'created_count' | 'payload'>): DemoRunStatus {
  const payloadStatus = run.payload?.status
  if (payloadStatus === 'succeeded') return 'succeeded'
  if (payloadStatus === 'failed') return 'failed'
  if (run.created_count > 0) return 'succeeded'
  return 'unknown'
}

export function buildLatestDemoRunByCase<T extends { demo_case_id: string }>(demoRuns: T[]): Map<string, T> {
  const byCase = new Map<string, T>()
  for (const run of demoRuns) {
    if (!byCase.has(run.demo_case_id)) {
      byCase.set(run.demo_case_id, run)
    }
  }
  return byCase
}

export function evaluateDemoReadiness(input: {
  demoCases: IntakeDemoCase[]
  latestDemoRunByCase: Map<string, DemoRunForReadiness>
}): DemoReadinessResult {
  const checks: DemoReadinessCheck[] = input.demoCases.map((demoCase) => {
    const latest = input.latestDemoRunByCase.get(demoCase.id) ?? null
    if (!latest) {
      return {
        caseId: demoCase.id,
        title: demoCase.title,
        status: 'missing',
        hint: '未実行',
      }
    }

    const status = resolveDemoRunStatus(latest)
    if (status === 'failed') {
      const error =
        typeof latest.payload?.error === 'string' && latest.payload.error.trim().length > 0
          ? latest.payload.error
          : '直近実行が失敗'
      return {
        caseId: demoCase.id,
        title: demoCase.title,
        status: 'failed',
        hint: error,
      }
    }

    const detected = toStringArray(latest.payload?.detected_intent_types)
    const intentMatched = demoCase.expectedIntentTypes.every((intentType) =>
      detected.includes(intentType)
    )

    return {
      caseId: demoCase.id,
      title: demoCase.title,
      status: status === 'succeeded' && intentMatched ? 'ready' : 'warning',
      hint:
        status === 'succeeded' && intentMatched
          ? 'OK'
          : `期待意図不足: ${demoCase.expectedIntentTypes.join(', ')}`,
    }
  })

  const readyCount = checks.filter((item) => item.status === 'ready').length
  return {
    checks,
    readyCount,
    total: checks.length,
    allReady: readyCount === checks.length && checks.length > 0,
  }
}
