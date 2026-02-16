import { describe, it, expect } from 'vitest'
import { calculateSpeedAdvantage } from '@/lib/estimates/speed-advantage'
import type { PricingPolicy } from '@/lib/pricing/engine'

const mockPolicy: PricingPolicy = {
  projectType: 'new_project',
  coefficientMin: 0.65,
  coefficientMax: 0.8,
  defaultCoefficient: 0.7,
  minimumProjectFee: 2_000_000,
  minimumMarginPercent: 20,
  avgInternalCostPerMemberMonth: 2_000_000,
  internalTeamSize: 2,
  defaultTeamSize: 6,
  defaultDurationMonths: 6,
}

describe('calculateSpeedAdvantage', () => {
  it('calculates basic speed multiplier without historical data', () => {
    const result = calculateSpeedAdvantage({
      similarProjects: [],
      velocityData: null,
      marketTeamSize: 6,
      marketDurationMonths: 6,
      ourHoursEstimate: 320,
      policy: mockPolicy,
    })

    expect(result.hasHistoricalData).toBe(false)
    expect(result.similarProject).toBeUndefined()
    expect(result.marketEstimate.teamSize).toBe(6)
    expect(result.marketEstimate.durationMonths).toBe(6)
    expect(result.ourEstimate.teamSize).toBe(2)
    expect(result.speedMultiplier).toBeGreaterThan(1)
    expect(result.narrative.length).toBeGreaterThan(0)
    expect(result.evidencePoints.length).toBeGreaterThan(0)
  })

  it('calculates duration savings percentage correctly', () => {
    const result = calculateSpeedAdvantage({
      similarProjects: [],
      velocityData: null,
      marketTeamSize: 6,
      marketDurationMonths: 6,
      ourHoursEstimate: 320,
      policy: mockPolicy,
    })

    // ourDurationMonths = 320 / (2 * 160) = 1 month
    expect(result.ourEstimate.durationMonths).toBe(1)
    // savings = (1 - 1/6) * 100 = 83.33%
    expect(result.durationSavingsPercent).toBeGreaterThan(80)
  })

  it('includes similar project data when velocity data is available', () => {
    const result = calculateSpeedAdvantage({
      similarProjects: [{
        githubReferenceId: 'ref-1',
        repoFullName: 'org/creative-flow',
        matchScore: 0.8,
        matchReasons: ['tech stack match'],
        language: 'TypeScript',
        techStack: ['React', 'Next.js'],
        hoursSpent: 200,
        description: 'E-commerce platform',
      }],
      velocityData: {
        totalDevelopmentDays: 90,
        totalCommits: 450,
        commitsPerWeek: 35,
        contributorCount: 2,
        coreContributors: 2,
        estimatedHours: 900,
        velocityScore: 75,
      },
      marketTeamSize: 5,
      marketDurationMonths: 6,
      ourHoursEstimate: 400,
      policy: mockPolicy,
    })

    expect(result.hasHistoricalData).toBe(true)
    expect(result.similarProject).toBeDefined()
    expect(result.similarProject?.name).toBe('org/creative-flow')
    expect(result.similarProject?.commitsPerWeek).toBe(35)
    expect(result.narrative).toContain('org/creative-flow')
  })

  it('handles zero ourHoursEstimate gracefully', () => {
    const result = calculateSpeedAdvantage({
      similarProjects: [],
      velocityData: null,
      marketTeamSize: 6,
      marketDurationMonths: 6,
      ourHoursEstimate: 0,
      policy: mockPolicy,
    })

    expect(result.speedMultiplier).toBe(1)
    expect(result.ourEstimate.totalHours).toBe(0)
  })

  it('handles zero marketDurationMonths gracefully', () => {
    const result = calculateSpeedAdvantage({
      similarProjects: [],
      velocityData: null,
      marketTeamSize: 6,
      marketDurationMonths: 0,
      ourHoursEstimate: 320,
      policy: mockPolicy,
    })

    expect(result.durationSavingsPercent).toBe(0)
  })

  it('market estimate total hours calculates correctly', () => {
    const result = calculateSpeedAdvantage({
      similarProjects: [],
      velocityData: null,
      marketTeamSize: 5,
      marketDurationMonths: 4,
      ourHoursEstimate: 320,
      policy: mockPolicy,
    })

    // 5 * 4 * 160 = 3200 hours
    expect(result.marketEstimate.totalHours).toBe(3200)
  })
})
