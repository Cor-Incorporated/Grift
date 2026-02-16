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
    expect(policy.internalTeamSize).toBe(2)
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

  it('defaultPolicyFor includes internalTeamSize for all project types', () => {
    const types: Array<'new_project' | 'bug_report' | 'fix_request' | 'feature_addition'> = [
      'new_project',
      'bug_report',
      'fix_request',
      'feature_addition',
    ]
    for (const type of types) {
      const policy = defaultPolicyFor(type)
      expect(policy.internalTeamSize).toBe(2)
    }
  })

  it('costFloor uses internalTeamSize, not market teamSize', () => {
    const policy = defaultPolicyFor('new_project')
    const result = calculatePrice({
      policy,
      market: {
        teamSize: 6,
        durationMonths: 6,
        monthlyUnitPrice: 1_100_000,
      },
    })

    // costFloor = avgCost(2M) * internalTeamSize(2) * durationMonths(6 * 0.6 = 3.6)
    // = 2_000_000 * 2 * 3.6 = 14_400_000
    const expectedCostFloor = Math.round(2_000_000 * policy.internalTeamSize * (6 * 0.6) * 100) / 100
    expect(result.costFloor).toBe(expectedCostFloor)
  })

  it('ourPrice should not exceed marketTotal for standard new_project', () => {
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

    // Strategy: ourPrice should be 65-80% of market
    expect(result.ourPrice).toBeLessThanOrEqual(result.marketTotal)
    expect(result.ourPrice).toBeGreaterThanOrEqual(result.marketTotal * 0.5)
  })

  it('coefficient range is respected for all project types', () => {
    const types: Array<'new_project' | 'bug_report' | 'fix_request' | 'feature_addition'> = [
      'new_project',
      'bug_report',
      'fix_request',
      'feature_addition',
    ]
    for (const type of types) {
      const policy = defaultPolicyFor(type)
      // Test below min
      const belowMin = calculatePrice({
        policy,
        market: { teamSize: 4, durationMonths: 4, monthlyUnitPrice: 1_000_000 },
        selectedCoefficient: 0.01,
      })
      expect(belowMin.coefficient).toBe(policy.coefficientMin)

      // Test above max
      const aboveMax = calculatePrice({
        policy,
        market: { teamSize: 4, durationMonths: 4, monthlyUnitPrice: 1_000_000 },
        selectedCoefficient: 0.99,
      })
      expect(aboveMax.coefficient).toBe(policy.coefficientMax)
    }
  })
})
