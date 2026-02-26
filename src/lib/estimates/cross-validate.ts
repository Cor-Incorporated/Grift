import type { HistoricalCalibration, CrossValidationResult } from '@/lib/estimates/evidence-bundle'

interface CrossValidateInput {
  claudeHours: number
  historicalCalibration: HistoricalCalibration
  velocityData: Record<string, unknown> | null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function extractVelocityEstimatedHours(data: Record<string, unknown> | null): number | null {
  if (!data) return null
  const hours = data.estimatedHours
  return typeof hours === 'number' && hours > 0 ? hours : null
}

function buildCalibrationWarning(ratio: number): string | null {
  if (ratio > 2.0) {
    return `Claude の見積もり（${ratio.toFixed(1)}倍）は過去実績を大幅に上回っています。見積もり根拠を再確認してください。`
  }
  if (ratio < 0.5) {
    return `Claude の見積もり（${ratio.toFixed(1)}倍）は過去実績を大幅に下回っています。スコープの見落としがないか確認してください。`
  }
  return null
}

function buildValidationNarrative(
  claudeHours: number,
  historicalCalibration: HistoricalCalibration,
  velocityHours: number | null,
  reconciledHours: number,
  calibrationRatio: number | null
): string {
  const parts: string[] = []

  parts.push(`AI推定: ${round1(claudeHours)}時間`)

  if (historicalCalibration.hasReliableData && historicalCalibration.avgActualHours !== null) {
    parts.push(`過去実績平均: ${round1(historicalCalibration.avgActualHours)}時間`)
    parts.push(`調整後見積もり: AI推定60% + 実績40% = ${round1(reconciledHours)}時間`)
    if (calibrationRatio !== null) {
      parts.push(`較正率: ${round1(calibrationRatio)}倍`)
    }
  } else if (velocityHours !== null) {
    parts.push(`ベロシティ推定: ${round1(velocityHours)}時間`)
    parts.push(`調整後見積もり: AI推定75% + ベロシティ25% = ${round1(reconciledHours)}時間`)
  } else {
    parts.push(`参照データなし。AI推定をそのまま採用: ${round1(reconciledHours)}時間`)
  }

  return parts.join(' / ')
}

export function crossValidateEstimate(input: CrossValidateInput): CrossValidationResult {
  const { claudeHours, historicalCalibration, velocityData } = input

  const velocityHours = extractVelocityEstimatedHours(velocityData)
  const historicalAvgHours = historicalCalibration.avgActualHours

  let reconciledHours: number
  let confidenceLow: number
  let confidenceHigh: number
  let calibrationRatio: number | null = null

  if (historicalCalibration.hasReliableData && historicalAvgHours !== null) {
    // Weighted blend: 60% Claude + 40% historical actuals
    reconciledHours = round1(claudeHours * 0.6 + historicalAvgHours * 0.4)
    confidenceLow = round1(historicalCalibration.minActualHours ?? reconciledHours * 0.8)
    confidenceHigh = round1(historicalCalibration.maxActualHours ?? reconciledHours * 1.3)
    calibrationRatio = historicalAvgHours !== 0
      ? round1(claudeHours / historicalAvgHours)
      : null
  } else if (velocityHours !== null) {
    // Weighted blend: 75% Claude + 25% velocity
    reconciledHours = round1(claudeHours * 0.75 + velocityHours * 0.25)
    confidenceLow = round1(reconciledHours * 0.75)
    confidenceHigh = round1(reconciledHours * 1.35)
  } else {
    // Passthrough: no reference data
    reconciledHours = round1(claudeHours)
    confidenceLow = round1(claudeHours * 0.7)
    confidenceHigh = round1(claudeHours * 1.3)
  }

  const calibrationWarning = calibrationRatio !== null
    ? buildCalibrationWarning(calibrationRatio)
    : null

  const validationNarrative = buildValidationNarrative(
    claudeHours,
    historicalCalibration,
    velocityHours,
    reconciledHours,
    calibrationRatio
  )

  return {
    claudeHours: round1(claudeHours),
    historicalAvgHours,
    velocityHours,
    reconciledHours,
    confidenceLow,
    confidenceHigh,
    calibrationRatio,
    calibrationWarning,
    validationNarrative,
  }
}
