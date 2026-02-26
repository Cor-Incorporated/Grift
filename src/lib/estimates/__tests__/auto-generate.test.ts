import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultPolicyFor } from '@/lib/pricing/engine'

// --- Mocks ---

vi.mock('@/lib/estimates/hours-estimator', () => ({
  estimateHours: vi.fn(),
}))

vi.mock('@/lib/market/evidence', () => ({
  fetchMarketEvidenceFromXai: vi.fn(),
}))

vi.mock('@/lib/market/evidence-fallback', () => ({
  resolveMarketEvidenceWithFallback: vi.fn(),
}))

vi.mock('@/lib/pricing/policies', () => ({
  fetchActivePricingPolicy: vi.fn(),
}))

vi.mock('@/lib/market/evidence-appendix', () => ({
  buildEstimateEvidenceAppendix: vi.fn(),
}))

vi.mock('@/lib/approval/gate', () => ({
  buildApprovalTriggersFromRiskFlags: vi.fn(),
  deriveApprovalStatus: vi.fn(),
  resolveEstimateStatus: vi.fn(),
}))

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: vi.fn(),
}))

vi.mock('@/lib/estimates/similar-projects', () => ({
  findSimilarProjects: vi.fn(),
}))

vi.mock('@/lib/approval/go-no-go', () => ({
  evaluateGoNoGo: vi.fn(),
}))

vi.mock('@/lib/estimates/module-decomposition', () => ({
  generateImplementationPlan: vi.fn().mockResolvedValue({
    modules: [],
    phases: [],
    criticalPath: [],
    mvpModules: [],
    totalWeeks: 4,
    teamRecommendation: { optimalSize: 2, roles: ['フルスタック'], rationale: '' },
  }),
}))

vi.mock('@/lib/estimates/code-impact-analysis', () => ({
  analyzeCodeImpact: vi.fn().mockResolvedValue({
    affectedFiles: [],
    impactScope: { totalFilesAffected: 0, totalTestsAffected: 0, couplingRisk: 'low', backwardCompatible: true },
    narrative: 'テスト用',
  }),
}))

vi.mock('@/lib/estimates/speed-advantage', () => ({
  calculateSpeedAdvantage: vi.fn().mockReturnValue({
    hasHistoricalData: false,
    marketEstimate: { durationMonths: 4, teamSize: 5, totalHours: 3200 },
    ourEstimate: { durationMonths: 2, teamSize: 2, totalHours: 75 },
    speedMultiplier: 42.67,
    durationSavingsPercent: 50,
    narrative: 'テスト用ナラティブ',
    evidencePoints: [],
  }),
}))

vi.mock('@/lib/estimates/historical-calibration', () => ({
  enrichSimilarProjectsWithHistory: vi.fn(),
  buildHistoricalCalibration: vi.fn(),
}))

vi.mock('@/lib/estimates/evidence-context-builder', () => ({
  buildEvidenceContextBlock: vi.fn(),
}))

vi.mock('@/lib/pricing/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing/engine')>()
  return {
    ...actual,
    calculatePrice: vi.fn(actual.calculatePrice),
  }
})

import { autoGenerateEstimate } from '@/lib/estimates/auto-generate'
import { estimateHours } from '@/lib/estimates/hours-estimator'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { resolveMarketEvidenceWithFallback } from '@/lib/market/evidence-fallback'
import { fetchActivePricingPolicy } from '@/lib/pricing/policies'
import { buildEstimateEvidenceAppendix } from '@/lib/market/evidence-appendix'
import {
  buildApprovalTriggersFromRiskFlags,
  deriveApprovalStatus,
  resolveEstimateStatus,
} from '@/lib/approval/gate'
import { writeAuditLog } from '@/lib/audit/log'
import { findSimilarProjects } from '@/lib/estimates/similar-projects'
import { evaluateGoNoGo } from '@/lib/approval/go-no-go'
import { calculatePrice } from '@/lib/pricing/engine'
import { enrichSimilarProjectsWithHistory, buildHistoricalCalibration } from '@/lib/estimates/historical-calibration'
import { buildEvidenceContextBlock } from '@/lib/estimates/evidence-context-builder'
import { buildEmptyHistoricalCalibration } from '@/lib/estimates/evidence-bundle'

const MOCK_ESTIMATE_ID = 'est-123'
const MOCK_PROJECT_ID = 'proj-456'

function createMockHoursResponse() {
  return {
    investigation: 10,
    implementation: 40,
    testing: 15,
    buffer: 10,
    total: 75,
    breakdown: '## 工数内訳\n- 調査: 10h\n- 実装: 40h',
  }
}

function createMockMarketEvidence() {
  return {
    evidence: {
      marketHourlyRate: 12000,
      marketRateRange: { min: 8000, max: 16000 },
      marketEstimatedHoursMultiplier: 1.8,
      typicalTeamSize: 5,
      typicalDurationMonths: 4,
      monthlyUnitPrice: 1200000,
      trends: ['クラウド移行が加速'],
      risks: ['人材不足'],
      summary: '市場相場の要約',
    },
    citations: [
      { url: 'https://example.com/1', type: 'web' as const },
      { url: 'https://example.com/2', type: 'web' as const },
    ],
    raw: {},
    confidenceScore: 0.75,
    usage: {},
    isFallback: false,
    fallbackReason: null,
  }
}

function createMockFallbackResolution() {
  const marketEvidence = createMockMarketEvidence()
  return {
    result: marketEvidence,
    reusedPrevious: false,
    stale: false,
    warning: null,
    sourceRetrievedAt: '2025-01-01T00:00:00.000Z',
  }
}

function createMockSupabase() {
  const estimateData = {
    id: MOCK_ESTIMATE_ID,
    project_id: MOCK_PROJECT_ID,
    estimate_mode: 'market_comparison',
    estimate_status: 'draft',
    your_hourly_rate: 15000,
    your_estimated_hours: 75,
  }
  const insertResult = { data: estimateData, error: null }
  const versionInsert = { error: null }
  const marketEvidenceInsert = {
    data: { id: 'me-789', retrieved_at: '2025-01-01T00:00:00.000Z' },
    error: null,
  }

  const fromMock = vi.fn()

  fromMock.mockImplementation((table: string) => {
    if (table === 'estimates') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(insertResult),
          }),
        }),
      }
    }
    if (table === 'estimate_versions') {
      return { insert: vi.fn().mockResolvedValue(versionInsert) }
    }
    if (table === 'market_evidence') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue(marketEvidenceInsert),
          }),
        }),
      }
    }
    if (table === 'audit_logs') {
      return { insert: vi.fn().mockResolvedValue({ error: null }) }
    }
    if (table === 'github_references') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
    }
    return {
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue({ count: 1, error: null }),
        }),
      }),
    }
  })

  return { from: fromMock } as unknown as SupabaseClient
}

function setupDefaultMocks() {
  const policy = defaultPolicyFor('new_project')
  ;(fetchActivePricingPolicy as Mock).mockResolvedValue(policy)
  ;(estimateHours as Mock).mockResolvedValue(createMockHoursResponse())
  ;(fetchMarketEvidenceFromXai as Mock).mockResolvedValue(createMockMarketEvidence())
  ;(resolveMarketEvidenceWithFallback as Mock).mockResolvedValue(createMockFallbackResolution())
  ;(buildEstimateEvidenceAppendix as Mock).mockReturnValue({
    generated_at: '2025-01-01T00:00:00.000Z',
    summary: '市場根拠要約',
    confidence_score: 0.75,
    sources: [],
    requirement: { minimum_sources: 2, unique_source_count: 2, primary_public_source_count: 0, met: true, reason: null },
    warnings: [],
  })
  ;(buildApprovalTriggersFromRiskFlags as Mock).mockReturnValue([])
  ;(deriveApprovalStatus as Mock).mockReturnValue('not_required')
  ;(resolveEstimateStatus as Mock).mockReturnValue({ estimateStatus: 'ready', approvalBlockReason: null })
  ;(findSimilarProjects as Mock).mockResolvedValue([])
  ;(evaluateGoNoGo as Mock).mockResolvedValue({
    decision: 'go',
    scores: {
      profitability: { score: 80, details: '' },
      strategicAlignment: { score: 90, businessLine: 'boltsite', details: '' },
      capacity: { score: 100, activeProjectCount: 1, details: '' },
      technicalRisk: { score: 85, details: '' },
    },
    overallScore: 87,
    conditions: [],
    reasoning: '',
  })
  ;(writeAuditLog as Mock).mockResolvedValue(undefined)
  ;(enrichSimilarProjectsWithHistory as Mock).mockResolvedValue([])
  ;(buildHistoricalCalibration as Mock).mockReturnValue(buildEmptyHistoricalCalibration())
  ;(buildEvidenceContextBlock as Mock).mockReturnValue('')
}

describe('autoGenerateEstimate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('new_project pipeline: estimateMode=market_comparison, hours estimation, pricing, similar_projects, go_no_go flow through', async () => {
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 新規プロジェクト仕様書',
      businessLine: 'boltsite',
    })

    expect(result.estimateMode).toBe('market_comparison')
    expect(result.totalHours).toBe(75)
    expect(result.hourlyRate).toBe(15000)
    expect(result.estimateId).toBe(MOCK_ESTIMATE_ID)

    expect(fetchMarketEvidenceFromXai).toHaveBeenCalledOnce()
    expect(resolveMarketEvidenceWithFallback).toHaveBeenCalledOnce()
    // semantic first, then keyword fallback (both return [])
    expect(findSimilarProjects).toHaveBeenCalledTimes(2)
    expect(evaluateGoNoGo).toHaveBeenCalledOnce()
  })

  it('bug_report pipeline: estimateMode=hours_only, no market evidence fetch', async () => {
    const policy = defaultPolicyFor('bug_report')
    ;(fetchActivePricingPolicy as Mock).mockResolvedValue(policy)
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'bug_report',
      specMarkdown: '# バグ報告',
    })

    expect(result.estimateMode).toBe('hours_only')
    expect(fetchMarketEvidenceFromXai).not.toHaveBeenCalled()
    expect(resolveMarketEvidenceWithFallback).not.toHaveBeenCalled()
  })

  it('feature_addition pipeline: estimateMode=hybrid', async () => {
    const policy = defaultPolicyFor('feature_addition')
    ;(fetchActivePricingPolicy as Mock).mockResolvedValue(policy)
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'feature_addition',
      specMarkdown: '# 機能追加仕様書',
    })

    expect(result.estimateMode).toBe('hybrid')
    expect(fetchMarketEvidenceFromXai).toHaveBeenCalledOnce()
  })

  it('market evidence failure falls back gracefully (proceeds with hours-only)', async () => {
    ;(fetchMarketEvidenceFromXai as Mock).mockRejectedValue(new Error('xAI API error'))
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様書',
    })

    expect(result.estimateMode).toBe('market_comparison')
    expect(result.estimateId).toBe(MOCK_ESTIMATE_ID)
    expect(result.totalHours).toBe(75)
  })

  it('business line passed: evaluateGoNoGo is called with correct params', async () => {
    const supabase = createMockSupabase()

    await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様',
      businessLine: 'iotrealm',
    })

    expect(evaluateGoNoGo).toHaveBeenCalledOnce()
    const callArgs = (evaluateGoNoGo as Mock).mock.calls[0][0]
    expect(callArgs.businessLine).toBe('iotrealm')
    expect(callArgs.projectId).toBe(MOCK_PROJECT_ID)
    expect(callArgs.projectType).toBe('new_project')
    expect(callArgs.supabase).toBe(supabase)
    expect(callArgs.specMarkdown).toBe('# 仕様')
    expect(callArgs.pricingResult).toBeDefined()
    expect(callArgs.riskFlags).toBeDefined()
  })

  it('no business line: evaluateGoNoGo is NOT called', async () => {
    const supabase = createMockSupabase()

    await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様',
    })

    expect(evaluateGoNoGo).not.toHaveBeenCalled()
  })

  it('similar projects found: inserted into DB via estimate insert', async () => {
    const mockSimilar = [
      {
        githubReferenceId: 'gh-1',
        repoFullName: 'org/repo',
        matchScore: 0.8,
        matchReasons: ['技術スタック一致'],
        language: 'TypeScript',
        techStack: ['Next.js'],
        hoursSpent: 200,
        description: 'サンプルプロジェクト',
      },
    ]
    ;(findSimilarProjects as Mock).mockResolvedValue(mockSimilar)

    const estimateInsertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: MOCK_ESTIMATE_ID, project_id: MOCK_PROJECT_ID },
          error: null,
        }),
      }),
    })

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'estimates') {
        return { insert: estimateInsertSpy }
      }
      if (table === 'estimate_versions') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      if (table === 'market_evidence') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'me-1', retrieved_at: '2025-01-01T00:00:00.000Z' }, error: null }),
            }),
          }),
        }
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) }
    })
    const supabase = { from: fromMock } as unknown as SupabaseClient

    await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# React Next.js仕様',
    })

    expect(estimateInsertSpy).toHaveBeenCalledOnce()
    const insertData = estimateInsertSpy.mock.calls[0][0]
    expect(insertData.similar_projects).toEqual(mockSimilar)
  })

  it('return type includes goNoGoDecision when present', async () => {
    ;(evaluateGoNoGo as Mock).mockResolvedValue({
      decision: 'go_with_conditions',
      scores: {
        profitability: { score: 60, details: '' },
        strategicAlignment: { score: 70, businessLine: 'tapforge', details: '' },
        capacity: { score: 50, activeProjectCount: 3, details: '' },
        technicalRisk: { score: 55, details: '' },
      },
      overallScore: 59,
      conditions: ['収益性の改善が必要'],
      reasoning: '',
    })
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様',
      businessLine: 'tapforge',
    })

    expect(result.goNoGoDecision).toBe('go_with_conditions')
  })

  it('goNoGoDecision is undefined when no business line', async () => {
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様',
    })

    expect(result.goNoGoDecision).toBeUndefined()
  })

  it('estimate version is created after estimate insert', async () => {
    const supabase = createMockSupabase()

    await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様',
      usageContext: { actorClerkUserId: 'user-1' },
    })

    const versionCalls = (supabase.from as Mock).mock.calls
      .filter((call: string[]) => call[0] === 'estimate_versions')
    expect(versionCalls.length).toBe(1)
  })

  it('audit log written when usageContext provided', async () => {
    const supabase = createMockSupabase()

    await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様',
      usageContext: { actorClerkUserId: 'user-abc', projectId: MOCK_PROJECT_ID },
    })

    expect(writeAuditLog).toHaveBeenCalledOnce()
    const auditArgs = (writeAuditLog as Mock).mock.calls[0]
    expect(auditArgs[0]).toBe(supabase)
    expect(auditArgs[1].actorClerkUserId).toBe('user-abc')
    expect(auditArgs[1].action).toBe('estimate.auto_generate')
    expect(auditArgs[1].resourceType).toBe('estimate')
    expect(auditArgs[1].resourceId).toBe(MOCK_ESTIMATE_ID)
    expect(auditArgs[1].projectId).toBe(MOCK_PROJECT_ID)
  })

  it('audit log NOT written when no actorClerkUserId', async () => {
    const supabase = createMockSupabase()

    await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様',
    })

    expect(writeAuditLog).not.toHaveBeenCalled()
  })

  it('hours estimation respects buffer rates from estimateHours response', async () => {
    const highBufferHours = {
      investigation: 5,
      implementation: 20,
      testing: 10,
      buffer: 15,
      total: 50,
      breakdown: '## 高バッファ',
    }
    ;(estimateHours as Mock).mockResolvedValue(highBufferHours)
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'bug_report',
      specMarkdown: '# バグ修正',
    })

    expect(result.totalHours).toBe(50)
  })

  it('throws error when estimate insert fails', async () => {
    const supabase = createMockSupabase()
    ;(supabase.from as Mock).mockImplementation((table: string) => {
      if (table === 'estimates') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            }),
          }),
        }
      }
      if (table === 'market_evidence') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    await expect(
      autoGenerateEstimate({
        supabase,
        projectId: MOCK_PROJECT_ID,
        projectType: 'new_project',
        specMarkdown: '# 仕様',
      })
    ).rejects.toThrow('見積りの自動保存に失敗しました')
  })

  it('fix_request pipeline: estimateMode=hours_only', async () => {
    const policy = defaultPolicyFor('fix_request')
    ;(fetchActivePricingPolicy as Mock).mockResolvedValue(policy)
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'fix_request',
      specMarkdown: '# 修正依頼',
    })

    expect(result.estimateMode).toBe('hours_only')
    expect(fetchMarketEvidenceFromXai).not.toHaveBeenCalled()
  })

  it('attachmentContext is forwarded to estimateHours and market evidence fetch', async () => {
    const supabase = createMockSupabase()
    const attachmentCtx = '技術スタック: React, Next.js, TypeScript'

    await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'new_project',
      specMarkdown: '# 仕様',
      attachmentContext: attachmentCtx,
    })

    // estimateHours(specMarkdown, projectType, attachmentContext, usageContext, evidenceContext)
    const estimateHoursCall = (estimateHours as Mock).mock.calls[0]
    expect(estimateHoursCall[2]).toBe(attachmentCtx)

    const marketCall = (fetchMarketEvidenceFromXai as Mock).mock.calls[0][0]
    expect(marketCall.context).toContain(attachmentCtx)
  })

  it('bug_report pipeline: calculatePrice is NOT called', async () => {
    const policy = defaultPolicyFor('bug_report')
    ;(fetchActivePricingPolicy as Mock).mockResolvedValue(policy)
    const supabase = createMockSupabase()

    const result = await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'bug_report',
      specMarkdown: '# バグ報告',
    })

    expect(result.estimateMode).toBe('hours_only')
    expect(calculatePrice).not.toHaveBeenCalled()
  })

  it('fix_request pipeline: calculatePrice is NOT called, pricing_snapshot is hours_only', async () => {
    const policy = defaultPolicyFor('fix_request')
    ;(fetchActivePricingPolicy as Mock).mockResolvedValue(policy)

    const estimateInsertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: MOCK_ESTIMATE_ID, project_id: MOCK_PROJECT_ID },
          error: null,
        }),
      }),
    })

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'estimates') {
        return { insert: estimateInsertSpy }
      }
      if (table === 'estimate_versions') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) }
    })
    const supabase = { from: fromMock } as unknown as SupabaseClient

    await autoGenerateEstimate({
      supabase,
      projectId: MOCK_PROJECT_ID,
      projectType: 'fix_request',
      specMarkdown: '# 修正依頼',
    })

    expect(calculatePrice).not.toHaveBeenCalled()
    expect(estimateInsertSpy).toHaveBeenCalledOnce()
    const insertData = estimateInsertSpy.mock.calls[0][0]
    expect(insertData.pricing_snapshot).toEqual({
      hours_only: true,
      hourly_rate: 15000,
      total_hours: 75,
    })
  })
})
