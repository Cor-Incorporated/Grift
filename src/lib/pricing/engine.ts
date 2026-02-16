export type ProjectPricingType = 'new_project' | 'bug_report' | 'fix_request' | 'feature_addition'

export interface PricingPolicy {
  projectType: ProjectPricingType
  coefficientMin: number
  coefficientMax: number
  defaultCoefficient: number
  minimumProjectFee: number
  minimumMarginPercent: number
  avgInternalCostPerMemberMonth: number
  internalTeamSize: number
  defaultTeamSize: number
  defaultDurationMonths: number
}

export interface MarketAssumption {
  teamSize: number
  durationMonths: number
  monthlyUnitPrice: number
}

export interface PriceCalculationInput {
  policy: PricingPolicy
  market: MarketAssumption
  selectedCoefficient?: number
}

export interface PriceCalculationResult {
  marketTotal: number
  coefficient: number
  ourPrice: number
  costFloor: number
  marginPercent: number
  riskFlags: string[]
}

export interface ChangeOrderInput {
  hours: {
    investigation: number
    implementation: number
    testing: number
    buffer: number
  }
  hourlyRate: number
  policy: PricingPolicy
  durationMonths: number
  teamSize: number
}

export interface ChangeOrderResult {
  deltaHours: number
  hoursBasedFee: number
  floorGuardFee: number
  minimumFee: number
  finalDeltaFee: number
  riskFlags: string[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function toTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100
}

export function calculateMarketTotal(market: MarketAssumption): number {
  return toTwoDecimals(market.teamSize * market.durationMonths * market.monthlyUnitPrice)
}

export function calculateCostFloor(
  avgInternalCostPerMemberMonth: number,
  teamSize: number,
  durationMonths: number
): number {
  return toTwoDecimals(avgInternalCostPerMemberMonth * teamSize * durationMonths)
}

export function calculatePrice(input: PriceCalculationInput): PriceCalculationResult {
  const marketTotal = calculateMarketTotal(input.market)
  const coefficient = clamp(
    input.selectedCoefficient ?? input.policy.defaultCoefficient,
    input.policy.coefficientMin,
    input.policy.coefficientMax
  )

  const basePrice = marketTotal * coefficient
  const costFloor = calculateCostFloor(
    input.policy.avgInternalCostPerMemberMonth,
    input.policy.internalTeamSize,
    input.market.durationMonths * 0.6
  )

  const ourPrice = toTwoDecimals(
    Math.max(basePrice, input.policy.minimumProjectFee, costFloor)
  )

  const marginPercent = ourPrice === 0
    ? 0
    : toTwoDecimals(((ourPrice - costFloor) / ourPrice) * 100)

  const riskFlags: string[] = []
  if (ourPrice <= costFloor) {
    riskFlags.push('FLOOR_BREACH')
  }
  if (marginPercent < input.policy.minimumMarginPercent) {
    riskFlags.push('LOW_MARGIN')
  }
  if (coefficient <= input.policy.coefficientMin) {
    riskFlags.push('LOW_COEFFICIENT')
  }

  return {
    marketTotal,
    coefficient,
    ourPrice,
    costFloor,
    marginPercent,
    riskFlags,
  }
}

export function calculateChangeOrder(input: ChangeOrderInput): ChangeOrderResult {
  const deltaHours = toTwoDecimals(
    input.hours.investigation +
      input.hours.implementation +
      input.hours.testing +
      input.hours.buffer
  )

  const hoursBasedFee = toTwoDecimals(deltaHours * input.hourlyRate)
  const minimumFee = input.policy.minimumProjectFee

  const floorGuardFee = toTwoDecimals(
    input.policy.avgInternalCostPerMemberMonth * input.teamSize * input.durationMonths
  )

  const finalDeltaFee = toTwoDecimals(
    Math.max(hoursBasedFee, minimumFee, floorGuardFee)
  )

  const riskFlags: string[] = []
  if (hoursBasedFee < floorGuardFee) {
    riskFlags.push('DELTA_BELOW_FLOOR')
  }
  if (finalDeltaFee === minimumFee) {
    riskFlags.push('DELTA_CAPPED_BY_MINIMUM')
  }

  return {
    deltaHours,
    hoursBasedFee,
    minimumFee,
    floorGuardFee,
    finalDeltaFee,
    riskFlags,
  }
}

export function defaultPolicyFor(projectType: ProjectPricingType): PricingPolicy {
  if (projectType === 'new_project') {
    return {
      projectType,
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
  }

  if (projectType === 'feature_addition') {
    return {
      projectType,
      coefficientMin: 0.65,
      coefficientMax: 0.8,
      defaultCoefficient: 0.7,
      minimumProjectFee: 1_000_000,
      minimumMarginPercent: 20,
      avgInternalCostPerMemberMonth: 2_000_000,
      internalTeamSize: 2,
      defaultTeamSize: 4,
      defaultDurationMonths: 2,
    }
  }

  return {
    projectType,
    coefficientMin: 0.5,
    coefficientMax: 0.75,
    defaultCoefficient: 0.6,
    minimumProjectFee: 300_000,
    minimumMarginPercent: 20,
    avgInternalCostPerMemberMonth: 2_000_000,
    internalTeamSize: 2,
    defaultTeamSize: 2,
    defaultDurationMonths: 1,
  }
}
