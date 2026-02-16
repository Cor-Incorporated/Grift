import { describe, expect, it } from 'vitest'
import { calculateCompleteness, toIntakeStatus } from '@/lib/intake/completeness'
import { INTAKE_DEMO_CASES } from '@/lib/intake/demo-cases'
import { parseIntakeMessage } from '@/lib/intake/parser'

describe('intake demo cases', () => {
  for (const demoCase of INTAKE_DEMO_CASES) {
    it(`parses expected intents for ${demoCase.id}`, async () => {
      const parsed = await parseIntakeMessage(demoCase.message, {
        mode: 'heuristic',
      })

      const intentTypes = parsed.intents.map((intent) => intent.intentType)
      for (const expected of demoCase.expectedIntentTypes) {
        expect(intentTypes).toContain(expected)
      }

      const statuses = parsed.intents.map((intent) => {
        const completeness = calculateCompleteness({
          intentType: intent.intentType,
          details: intent.details,
          summary: intent.summary,
        })
        return toIntakeStatus({ score: completeness.score })
      })

      expect(statuses.includes('needs_info')).toBe(true)
    })
  }
})

