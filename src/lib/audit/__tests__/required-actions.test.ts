import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REQUIRED_AUDIT_ACTIONS } from '@/lib/audit/required-actions'

describe('required audit actions', () => {
  it('contains no duplicate action identifiers', () => {
    const actions = REQUIRED_AUDIT_ACTIONS.map((item) => item.action)
    const unique = new Set(actions)
    expect(unique.size).toBe(actions.length)
  })

  it('keeps critical action coverage in source files', () => {
    for (const item of REQUIRED_AUDIT_ACTIONS) {
      const absolutePath = resolve(process.cwd(), item.file)
      const source = readFileSync(absolutePath, 'utf8')
      expect(source).toContain(`action: '${item.action}'`)
    }
  })
})
