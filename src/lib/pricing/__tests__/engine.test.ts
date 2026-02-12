import { describe, it, expect } from 'vitest'
import {
  calculateMarketTotal,
  calculatePrice,
  calculateChangeOrder,
  defaultPolicyFor,
} from '@/lib/pricing/engine'

describe('pricing engine', () => {
  it('calculates market total correctly', () => {
    expect(
      calculateMarketTotal({
        teamSize: 6,
        durationMonths: 6,
        monthlyUnitPrice: 1_100_000,
      })
    ).toBe(39_600_000)
  })

  it('calculates price and risk flags from policy', () => {
    const policy = defaultPolicyFor('new_project')
    const result = calculatePrice({
      policy,
      market: {
        teamSize: 6,
        durationMonths: 6,
        monthlyUnitPrice: 1_100_000,
      },
      selectedCoefficient: 0.7,
    })

    expect(result.marketTotal).toBe(39_600_000)
    expect(result.ourPrice).toBeGreaterThan(0)
    expect(result.coefficient).toBe(0.7)
    expect(result.marginPercent).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(result.riskFlags)).toBe(true)
  })

  it('calculates change order with floor guard', () => {
    const policy = defaultPolicyFor('fix_request')
    const result = calculateChangeOrder({
      hours: {
        investigation: 6,
        implementation: 12,
        testing: 6,
        buffer: 4,
      },
      hourlyRate: 15_000,
      policy,
      durationMonths: 1,
      teamSize: 2,
    })

    expect(result.deltaHours).toBe(28)
    expect(result.finalDeltaFee).toBeGreaterThan(0)
    expect(result.finalDeltaFee).toBeGreaterThanOrEqual(result.floorGuardFee)
  })
})
