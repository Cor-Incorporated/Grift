import { describe, it, expect } from 'vitest'
import { crossValidateEstimate } from '../cross-validate'
import type { HistoricalCalibration } from '@/lib/estimates/evidence-bundle'

function makeCalibration(overrides: Partial<HistoricalCalibration> = {}): HistoricalCalibration {
  return {
    references: [],
    avgActualHours: null,
    minActualHours: null,
    maxActualHours: null,
    avgVelocityHours: null,
    calibrationRatio: null,
    citationText: '',
    hasReliableData: false,
    ...overrides,
  }
}

describe('crossValidateEstimate', () => {
  describe('historical data available', () => {
    it('blends 60% Claude + 40% historical when hasReliableData is true', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 80,
          minActualHours: 60,
          maxActualHours: 100,
        }),
        velocityData: null,
      })

      // 100 * 0.6 + 80 * 0.4 = 60 + 32 = 92
      expect(result.reconciledHours).toBe(92)
      expect(result.confidenceLow).toBe(60)
      expect(result.confidenceHigh).toBe(100)
    })

    it('uses reconciledHours * 0.8 for confidenceLow when minActualHours is null', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 80,
          minActualHours: null,
          maxActualHours: null,
        }),
        velocityData: null,
      })

      // reconciledHours = 92, low = 92 * 0.8 = 73.6, high = 92 * 1.3 = 119.6
      expect(result.reconciledHours).toBe(92)
      expect(result.confidenceLow).toBe(73.6)
      expect(result.confidenceHigh).toBe(119.6)
    })

    it('computes calibrationRatio as claudeHours / avgActualHours', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 50,
          minActualHours: null,
          maxActualHours: null,
        }),
        velocityData: null,
      })

      expect(result.calibrationRatio).toBe(2)
    })

    it('exposes historicalAvgHours and velocityHours in result', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 80,
          minActualHours: 60,
          maxActualHours: 110,
        }),
        velocityData: null,
      })

      expect(result.historicalAvgHours).toBe(80)
      expect(result.velocityHours).toBeNull()
    })
  })

  describe('only velocity data available', () => {
    it('blends 75% Claude + 25% velocity when no historical data', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: { estimatedHours: 80 },
      })

      // 100 * 0.75 + 80 * 0.25 = 75 + 20 = 95
      expect(result.reconciledHours).toBe(95)
      expect(result.confidenceLow).toBe(71.3)   // 95 * 0.75 = 71.25 → 71.3
      expect(result.confidenceHigh).toBe(128.3) // 95 * 1.35 = 128.25 → 128.3
    })

    it('exposes velocityHours from velocityData.estimatedHours', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: { estimatedHours: 60 },
      })

      expect(result.velocityHours).toBe(60)
      expect(result.historicalAvgHours).toBeNull()
    })

    it('ignores velocityData when estimatedHours is zero', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: { estimatedHours: 0 },
      })

      // zero is not > 0, so treated as no velocity data
      expect(result.reconciledHours).toBe(100)
      expect(result.velocityHours).toBeNull()
    })

    it('ignores velocityData when estimatedHours is not a number', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: { estimatedHours: 'unknown' },
      })

      expect(result.reconciledHours).toBe(100)
      expect(result.velocityHours).toBeNull()
    })
  })

  describe('neither data available', () => {
    it('passes through claudeHours unchanged when no reference data', () => {
      const result = crossValidateEstimate({
        claudeHours: 120,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: null,
      })

      expect(result.reconciledHours).toBe(120)
    })

    it('applies 0.7 / 1.3 confidence band on passthrough', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: null,
      })

      expect(result.confidenceLow).toBe(70)
      expect(result.confidenceHigh).toBe(130)
    })

    it('sets calibrationRatio and calibrationWarning to null', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: null,
      })

      expect(result.calibrationRatio).toBeNull()
      expect(result.calibrationWarning).toBeNull()
    })
  })

  describe('calibration warnings', () => {
    it('generates warning when ratio > 2.0 (Claude overestimates)', () => {
      const result = crossValidateEstimate({
        claudeHours: 210,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 100,
          minActualHours: null,
          maxActualHours: null,
        }),
        velocityData: null,
      })

      // ratio = 210 / 100 = 2.1 > 2.0
      expect(result.calibrationRatio).toBe(2.1)
      expect(result.calibrationWarning).not.toBeNull()
      expect(result.calibrationWarning).toContain('上回')
    })

    it('generates warning when ratio < 0.5 (Claude underestimates)', () => {
      const result = crossValidateEstimate({
        claudeHours: 40,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 100,
          minActualHours: null,
          maxActualHours: null,
        }),
        velocityData: null,
      })

      // ratio = 40 / 100 = 0.4 < 0.5
      expect(result.calibrationRatio).toBe(0.4)
      expect(result.calibrationWarning).not.toBeNull()
      expect(result.calibrationWarning).toContain('下回')
    })

    it('does not generate warning for normal ratio (0.5 ≤ ratio ≤ 2.0)', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 90,
          minActualHours: null,
          maxActualHours: null,
        }),
        velocityData: null,
      })

      // ratio = 100 / 90 ≈ 1.1
      expect(result.calibrationWarning).toBeNull()
    })

    it('does not generate warning at ratio exactly 2.0', () => {
      const result = crossValidateEstimate({
        claudeHours: 200,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 100,
          minActualHours: null,
          maxActualHours: null,
        }),
        velocityData: null,
      })

      expect(result.calibrationRatio).toBe(2)
      expect(result.calibrationWarning).toBeNull()
    })

    it('does not generate warning at ratio exactly 0.5', () => {
      const result = crossValidateEstimate({
        claudeHours: 50,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 100,
          minActualHours: null,
          maxActualHours: null,
        }),
        velocityData: null,
      })

      expect(result.calibrationRatio).toBe(0.5)
      expect(result.calibrationWarning).toBeNull()
    })
  })

  describe('validationNarrative', () => {
    it('includes AI estimate and historical info in narrative', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 80,
          minActualHours: 60,
          maxActualHours: 110,
        }),
        velocityData: null,
      })

      expect(result.validationNarrative).toContain('100')
      expect(result.validationNarrative).toContain('80')
    })

    it('includes velocity info in narrative when only velocity available', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: { estimatedHours: 80 },
      })

      expect(result.validationNarrative).toContain('80')
      expect(result.validationNarrative).toContain('ベロシティ')
    })

    it('mentions no reference data in narrative when passthrough', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: null,
      })

      expect(result.validationNarrative).toContain('参照データなし')
    })
  })

  describe('edge cases', () => {
    it('handles zero claudeHours gracefully', () => {
      const result = crossValidateEstimate({
        claudeHours: 0,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: null,
      })

      expect(result.claudeHours).toBe(0)
      expect(result.reconciledHours).toBe(0)
      expect(result.confidenceLow).toBe(0)
      expect(result.confidenceHigh).toBe(0)
    })

    it('handles zero claudeHours with historical data', () => {
      const result = crossValidateEstimate({
        claudeHours: 0,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 100,
          minActualHours: 80,
          maxActualHours: 120,
        }),
        velocityData: null,
      })

      // 0 * 0.6 + 100 * 0.4 = 40
      expect(result.reconciledHours).toBe(40)
      // ratio = 0 / 100 = 0.0 < 0.5 → warning
      expect(result.calibrationRatio).toBe(0)
      expect(result.calibrationWarning).not.toBeNull()
    })

    it('handles negative claudeHours without throwing', () => {
      const result = crossValidateEstimate({
        claudeHours: -10,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: null,
      })

      // Should complete without throwing; values will be negative but consistent
      expect(result.claudeHours).toBe(-10)
      expect(result.reconciledHours).toBe(-10)
    })

    it('handles null velocityData safely', () => {
      const result = crossValidateEstimate({
        claudeHours: 50,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: null,
      })

      expect(result.velocityHours).toBeNull()
      expect(result.reconciledHours).toBe(50)
    })

    it('handles empty velocityData object safely', () => {
      const result = crossValidateEstimate({
        claudeHours: 50,
        historicalCalibration: makeCalibration({ hasReliableData: false }),
        velocityData: {},
      })

      expect(result.velocityHours).toBeNull()
      expect(result.reconciledHours).toBe(50)
    })

    it('rounds all hours values to 1 decimal place', () => {
      const result = crossValidateEstimate({
        claudeHours: 100,
        historicalCalibration: makeCalibration({
          hasReliableData: true,
          avgActualHours: 33,
          minActualHours: null,
          maxActualHours: null,
        }),
        velocityData: null,
      })

      // reconciledHours = 100 * 0.6 + 33 * 0.4 = 60 + 13.2 = 73.2
      expect(result.reconciledHours).toBe(73.2)
      // confidenceLow = 73.2 * 0.8 = 58.56 → 58.6
      expect(result.confidenceLow).toBe(58.6)
      // confidenceHigh = 73.2 * 1.3 = 95.16 → 95.2
      expect(result.confidenceHigh).toBe(95.2)
    })
  })
})
