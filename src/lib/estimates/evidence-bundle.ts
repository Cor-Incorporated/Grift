import type { CodeImpactAnalysis } from '@/lib/estimates/code-impact-analysis'

export interface HistoricalReference {
  githubReferenceId: string
  repoFullName: string
  matchScore: number
  matchStrategy: 'keyword' | 'semantic'
  matchReasons: string[]
  techStack: string[]
  hoursSpent: number | null
  velocityEstimatedHours: number | null
  velocityData: Record<string, unknown> | null
  analysisResult: Record<string, unknown> | null
  description: string | null
}

export interface HistoricalCalibration {
  references: HistoricalReference[]
  avgActualHours: number | null
  minActualHours: number | null
  maxActualHours: number | null
  avgVelocityHours: number | null
  calibrationRatio: number | null
  citationText: string
  hasReliableData: boolean
}

export interface CrossValidationResult {
  claudeHours: number
  historicalAvgHours: number | null
  velocityHours: number | null
  reconciledHours: number
  confidenceLow: number
  confidenceHigh: number
  calibrationRatio: number | null
  calibrationWarning: string | null
  validationNarrative: string
}

export interface EvidenceBundle {
  attachmentContext: string | null
  codeImpact: CodeImpactAnalysis | null
  historicalCalibration: HistoricalCalibration
  velocityData: Record<string, unknown> | null
  evidenceContextBlock: string
}

export function buildEmptyHistoricalCalibration(): HistoricalCalibration {
  return {
    references: [],
    avgActualHours: null,
    minActualHours: null,
    maxActualHours: null,
    avgVelocityHours: null,
    calibrationRatio: null,
    citationText: '',
    hasReliableData: false,
  }
}

export function buildEmptyEvidenceBundle(): EvidenceBundle {
  return {
    attachmentContext: null,
    codeImpact: null,
    historicalCalibration: buildEmptyHistoricalCalibration(),
    velocityData: null,
    evidenceContextBlock: '',
  }
}
