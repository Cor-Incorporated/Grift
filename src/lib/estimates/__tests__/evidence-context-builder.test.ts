import { describe, it, expect } from 'vitest'
import { buildEvidenceContextBlock } from '../evidence-context-builder'
import type { HistoricalCalibration } from '@/lib/estimates/evidence-bundle'
import type { CodeImpactAnalysis } from '@/lib/estimates/code-impact-analysis'

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

function makeCodeImpact(overrides: Partial<CodeImpactAnalysis> = {}): CodeImpactAnalysis {
  return {
    affectedFiles: [],
    impactScope: {
      totalFilesAffected: 0,
      totalTestsAffected: 0,
      couplingRisk: 'low',
      backwardCompatible: true,
    },
    narrative: '既存のAPIエンドポイントに変更を加えます。',
    ...overrides,
  }
}

describe('buildEvidenceContextBlock', () => {
  it('returns full output with references, statistics, and code impact', () => {
    const calibration = makeCalibration({
      references: [
        {
          githubReferenceId: 'ref-1',
          repoFullName: 'cor-inc/ecommerce-platform',
          matchScore: 0.82,
          matchStrategy: 'keyword',
          matchReasons: ['技術スタック一致'],
          techStack: ['Next.js', 'TypeScript', 'PostgreSQL'],
          hoursSpent: 200,
          velocityEstimatedHours: null,
          velocityData: null,
          analysisResult: null,
          description: 'EC platform description here',
        },
        {
          githubReferenceId: 'ref-2',
          repoFullName: 'cor-inc/saas-dashboard',
          matchScore: 0.71,
          matchStrategy: 'keyword',
          matchReasons: ['言語一致'],
          techStack: ['React', 'Node.js'],
          hoursSpent: 320,
          velocityEstimatedHours: null,
          velocityData: null,
          analysisResult: null,
          description: null,
        },
      ],
      avgActualHours: 260,
      minActualHours: 200,
      maxActualHours: 320,
      avgVelocityHours: 280,
      hasReliableData: true,
    })

    const codeImpact = makeCodeImpact({
      narrative: 'コードの影響範囲は限定的です。',
    })

    const result = buildEvidenceContextBlock({ historicalCalibration: calibration, codeImpact })

    expect(result).toContain('## 類似プロジェクト実績データ（社内ポートフォリオ）')
    expect(result).toContain('cor-inc/ecommerce-platform')
    expect(result).toContain('0.82')
    expect(result).toContain('200時間')
    expect(result).toContain('Next.js, TypeScript, PostgreSQL')
    expect(result).toContain('EC platform description here')
    expect(result).toContain('cor-inc/saas-dashboard')
    expect(result).toContain('0.71')
    expect(result).toContain('320時間')
    expect(result).toContain('React, Node.js')
    expect(result).toContain('### 統計サマリー')
    expect(result).toContain('260時間')
    expect(result).toContain('200〜320時間')
    expect(result).toContain('280時間')
    expect(result).toContain('## 既存コードベース分析')
    expect(result).toContain('コードの影響範囲は限定的です。')
  })

  it('returns references only when code impact is null', () => {
    const calibration = makeCalibration({
      references: [
        {
          githubReferenceId: 'ref-1',
          repoFullName: 'cor-inc/ecommerce-platform',
          matchScore: 0.82,
          matchStrategy: 'keyword',
          matchReasons: ['技術スタック一致'],
          techStack: ['Next.js', 'TypeScript'],
          hoursSpent: 200,
          velocityEstimatedHours: null,
          velocityData: null,
          analysisResult: null,
          description: null,
        },
      ],
      avgActualHours: 200,
      minActualHours: 200,
      maxActualHours: 200,
      hasReliableData: true,
    })

    const result = buildEvidenceContextBlock({ historicalCalibration: calibration, codeImpact: null })

    expect(result).toContain('cor-inc/ecommerce-platform')
    expect(result).not.toContain('## 既存コードベース分析')
  })

  it('omits statistics section when hasReliableData is false', () => {
    const calibration = makeCalibration({
      references: [
        {
          githubReferenceId: 'ref-1',
          repoFullName: 'cor-inc/some-project',
          matchScore: 0.5,
          matchStrategy: 'keyword',
          matchReasons: ['技術スタック一致'],
          techStack: ['Vue.js'],
          hoursSpent: null,
          velocityEstimatedHours: null,
          velocityData: null,
          analysisResult: null,
          description: 'Some project',
        },
      ],
      hasReliableData: false,
      avgActualHours: null,
    })

    const result = buildEvidenceContextBlock({ historicalCalibration: calibration, codeImpact: null })

    expect(result).toContain('cor-inc/some-project')
    expect(result).not.toContain('### 統計サマリー')
  })

  it('returns empty string when calibration has no references and codeImpact is null', () => {
    const calibration = makeCalibration()

    const result = buildEvidenceContextBlock({ historicalCalibration: calibration, codeImpact: null })

    expect(result).toBe('')
  })

  it('truncates output to MAX_EVIDENCE_CONTEXT_CHARS with truncation suffix', () => {
    const longDescription = 'A'.repeat(500)
    const references = Array.from({ length: 10 }, (_, i) => ({
      githubReferenceId: `ref-${i}`,
      repoFullName: `cor-inc/very-long-repo-name-project-${i}`,
      matchScore: 0.9 - i * 0.05,
      matchStrategy: 'keyword' as const,
      matchReasons: ['技術スタック一致'],
      techStack: ['Next.js', 'TypeScript', 'PostgreSQL', 'Redis', 'Docker'],
      hoursSpent: 300 + i * 10,
      velocityEstimatedHours: null,
      velocityData: null,
      analysisResult: null,
      description: longDescription,
    }))

    const calibration = makeCalibration({
      references,
      avgActualHours: 350,
      minActualHours: 300,
      maxActualHours: 400,
      avgVelocityHours: 360,
      hasReliableData: true,
    })

    const codeImpact = makeCodeImpact({
      narrative: 'B'.repeat(500),
    })

    const result = buildEvidenceContextBlock({ historicalCalibration: calibration, codeImpact })

    expect(result.length).toBeLessThanOrEqual(2000)
    expect(result).toContain('[...証拠データ省略]')
  })

  it('formats code impact section correctly', () => {
    const calibration = makeCalibration({
      references: [
        {
          githubReferenceId: 'ref-1',
          repoFullName: 'cor-inc/app',
          matchScore: 0.6,
          matchStrategy: 'semantic',
          matchReasons: [],
          techStack: [],
          hoursSpent: null,
          velocityEstimatedHours: null,
          velocityData: null,
          analysisResult: null,
          description: null,
        },
      ],
    })

    const narrative = 'このPRはAPIエンドポイントの認証ロジックに影響します。既存のユーザーセッションには互換性があります。'
    const codeImpact = makeCodeImpact({ narrative })

    const result = buildEvidenceContextBlock({ historicalCalibration: calibration, codeImpact })

    expect(result).toContain('## 既存コードベース分析')
    expect(result).toContain(narrative)
  })

  it('truncates description to 100 chars', () => {
    const longDesc = 'X'.repeat(200)
    const calibration = makeCalibration({
      references: [
        {
          githubReferenceId: 'ref-1',
          repoFullName: 'cor-inc/project',
          matchScore: 0.7,
          matchStrategy: 'keyword',
          matchReasons: [],
          techStack: [],
          hoursSpent: null,
          velocityEstimatedHours: null,
          velocityData: null,
          analysisResult: null,
          description: longDesc,
        },
      ],
    })

    const result = buildEvidenceContextBlock({ historicalCalibration: calibration, codeImpact: null })

    // Description should be truncated to 100 chars + '...'
    expect(result).toContain(`${'X'.repeat(100)}...`)
    expect(result).not.toContain('X'.repeat(101))
  })

  it('returns only code impact section when calibration has no references', () => {
    const calibration = makeCalibration({
      references: [],
      hasReliableData: false,
    })

    const codeImpact = makeCodeImpact({
      narrative: 'コードへの影響は最小限です。',
    })

    const result = buildEvidenceContextBlock({ historicalCalibration: calibration, codeImpact })

    expect(result).toContain('## 既存コードベース分析')
    expect(result).toContain('コードへの影響は最小限です。')
    expect(result).not.toContain('## 類似プロジェクト実績データ')
  })
})
