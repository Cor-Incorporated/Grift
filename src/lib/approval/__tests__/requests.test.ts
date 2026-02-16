import { describe, expect, it } from 'vitest'
import { resolveRequiredRoleForTrigger } from '@/lib/approval/requests'

describe('resolveRequiredRoleForTrigger', () => {
  it('maps floor breach and low margin to sales', () => {
    expect(resolveRequiredRoleForTrigger('floor_breach')).toBe('sales')
    expect(resolveRequiredRoleForTrigger('low_margin')).toBe('sales')
  })

  it('maps high risk change to dev', () => {
    expect(resolveRequiredRoleForTrigger('high_risk_change')).toBe('dev')
  })

  it('maps manual override to admin', () => {
    expect(resolveRequiredRoleForTrigger('manual_override')).toBe('admin')
  })
})
