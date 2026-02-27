import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PriceCalculationResult } from '@/lib/pricing/engine'
import type { GoNoGoResult } from '@/lib/approval/go-no-go'

// ---------------------------------------------------------------------------
// Mock only the lowest-level dependencies
// ---------------------------------------------------------------------------

// 1. AI APIs
vi.mock('@/lib/ai/anthropic', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/lib/ai/xai', () => ({
  parseJsonFromResponse: vi.fn((text: string) => JSON.parse(text)),
  requestXaiResponse: vi.fn(),
}))

// 1b. Evidence pipeline modules (hours-estimator now uses Grok directly)
vi.mock('@/lib/estimates/hours-estimator', () => ({
  estimateHours: vi.fn(),
  estimateHoursWithClaude: vi.fn(),
}))

vi.mock('@/lib/estimates/historical-calibration', () => ({
  enrichSimilarProjectsWithHistory: vi.fn(),
  buildHistoricalCalibration: vi.fn(),
}))

vi.mock('@/lib/estimates/evidence-context-builder', () => ({
  buildEvidenceContextBlock: vi.fn(),
}))

// 2. Supabase
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(),
}))

// 3. Market evidence (external API calls)
vi.mock('@/lib/market/evidence', () => ({
  fetchMarketEvidenceFromXai: vi.fn(),
}))

// 4. Market evidence fallback (DB-dependent)
vi.mock('@/lib/market/evidence-fallback', () => ({
  resolveMarketEvidenceWithFallback: vi.fn(),
}))

// 5. Pricing policies (DB-dependent)
vi.mock('@/lib/pricing/policies', () => ({
  fetchActivePricingPolicy: vi.fn(),
}))

// 6. Audit log (DB write, not relevant to pipeline logic)
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { sendMessage } from '@/lib/ai/anthropic'
import { classifyBusinessLine } from '@/lib/business-line/classifier'
import { autoGenerateEstimate } from '@/lib/estimates/auto-generate'
import { findSimilarProjects } from '@/lib/estimates/similar-projects'
import { evaluateGoNoGo } from '@/lib/approval/go-no-go'
import { generateValueProposition } from '@/lib/estimates/value-proposition'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { resolveMarketEvidenceWithFallback } from '@/lib/market/evidence-fallback'
import { fetchActivePricingPolicy } from '@/lib/pricing/policies'
import { estimateHours } from '@/lib/estimates/hours-estimator'
import { enrichSimilarProjectsWithHistory, buildHistoricalCalibration } from '@/lib/estimates/historical-calibration'
import { buildEvidenceContextBlock } from '@/lib/estimates/evidence-context-builder'
import { buildEmptyHistoricalCalibration } from '@/lib/estimates/evidence-bundle'
import type { SupabaseClient } from '@supabase/supabase-js'

const mockSendMessage = vi.mocked(sendMessage)
const mockFetchMarketEvidence = vi.mocked(fetchMarketEvidenceFromXai)
const mockResolveEvidence = vi.mocked(resolveMarketEvidenceWithFallback)
const mockFetchPricingPolicy = vi.mocked(fetchActivePricingPolicy)
const mockEstimateHours = vi.mocked(estimateHours)
const mockEnrichHistory = vi.mocked(enrichSimilarProjectsWithHistory)
const mockBuildCalibration = vi.mocked(buildHistoricalCalibration)
const mockBuildEvidenceContext = vi.mocked(buildEvidenceContextBlock)

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function createMockPricingResult(overrides?: Partial<PriceCalculationResult>): PriceCalculationResult {
  return {
    marketTotal: 50_400_000,
    coefficient: 0.7,
    ourPrice: 35_280_000,
    costFloor: 14_400_000,
    marginPercent: 59.18,
    riskFlags: [],
    ...overrides,
  }
}

function createMockGoNoGoResult(overrides?: Partial<GoNoGoResult>): GoNoGoResult {
  return {
    decision: 'go',
    scores: {
      profitability: { score: 100, details: '粗利率59.2%で健全な収益性' },
      strategicAlignment: { score: 95, businessLine: 'iotrealm', details: '高い適合性' },
      capacity: { score: 100, activeProjectCount: 1, details: '十分なキャパシティ' },
      technicalRisk: { score: 85, details: '技術リスク低' },
    },
    overallScore: 95,
    conditions: [],
    reasoning: '総合スコア: 95/100',
    ...overrides,
  }
}

function createMockSupabase(overrides?: {
  showcaseRefs?: Array<Record<string, unknown>>
  activeProjectCount?: number
  estimateInsertResult?: Record<string, unknown>
}): SupabaseClient {
  const showcaseRefs = overrides?.showcaseRefs ?? []
  const activeProjectCount = overrides?.activeProjectCount ?? 1
  const estimateInsertResult = overrides?.estimateInsertResult ?? {
    id: 'est-001',
    project_id: 'proj-001',
    estimate_mode: 'market_comparison',
  }

  // Build a fully chainable mock where every method returns the chain itself
  // and terminal methods (.single/.maybeSingle/then) resolve with { data, error }.
  const chainBuilder = (data: unknown, error: unknown = null) => {
    const resultPromise = Promise.resolve({ data, error, count: null })
    // Make the chain itself thenable so `await supabase.from(...)...` works
    const chain: Record<string, unknown> = {}
    const methods = [
      'select', 'insert', 'update', 'delete',
      'eq', 'neq', 'in', 'not', 'is', 'gt', 'lt', 'gte', 'lte',
      'like', 'ilike', 'contains', 'containedBy',
      'order', 'limit', 'range', 'filter',
    ]
    for (const method of methods) {
      chain[method] = vi.fn().mockReturnValue(chain)
    }
    chain.maybeSingle = vi.fn().mockReturnValue(resultPromise)
    chain.single = vi.fn().mockReturnValue(resultPromise)
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      resultPromise.then(resolve, reject)
    return chain
  }

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'github_references') {
      // findSimilarProjects: .select().eq().order().limit() → awaits { data, error }
      const chain = chainBuilder(showcaseRefs)
      return chain
    }
    if (table === 'projects') {
      // scoreCapacity: .select('id', { count: 'exact', head: true }).in().neq()
      // Returns { count, error } (not data)
      const countResult = Promise.resolve({ count: activeProjectCount, data: null, error: null })
      const chain = chainBuilder(null)
      // Override the terminal resolution to return count
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        countResult.then(resolve, reject)
      chain.maybeSingle = vi.fn().mockReturnValue(countResult)
      chain.single = vi.fn().mockReturnValue(countResult)
      return chain
    }
    if (table === 'estimates') {
      return chainBuilder(estimateInsertResult)
    }
    if (table === 'market_evidence') {
      return chainBuilder({ id: 'mkt-001', retrieved_at: new Date().toISOString() })
    }
    if (table === 'pricing_policies') {
      return chainBuilder(null)
    }
    // Default for estimate_versions, audit_logs, etc.
    return chainBuilder(null)
  })

  return { from: fromMock } as unknown as SupabaseClient
}

function setupHoursEstimateMock(): void {
  // estimateHours now uses Grok directly — mock the module
  mockEstimateHours.mockResolvedValueOnce({
    investigation: 10,
    implementation: 40,
    testing: 15,
    buffer: 10,
    total: 75,
    breakdown: '## 工数内訳\n- 調査: 10h\n- 実装: 40h\n- テスト: 15h\n- バッファ: 10h',
  })
}

function setupMarketEvidenceMocks(): void {
  mockFetchMarketEvidence.mockResolvedValue({
    evidence: {
      marketHourlyRate: 12_000,
      marketRateRange: { min: 8_000, max: 18_000 },
      marketEstimatedHoursMultiplier: 1.8,
      typicalTeamSize: 5,
      typicalDurationMonths: 4,
      monthlyUnitPrice: 1_200_000,
      trends: ['AI活用の増加'],
      risks: ['人材不足'],
      summary: '市場データの要約',
    },
    citations: [
      { url: 'https://example.com/a', type: 'web' },
      { url: 'https://example.com/b', type: 'web' },
    ],
    raw: {},
    confidenceScore: 0.75,
    usage: {},
    isFallback: false,
    fallbackReason: null,
  })

  mockResolveEvidence.mockResolvedValue({
    result: {
      evidence: {
        marketHourlyRate: 12_000,
        marketRateRange: { min: 8_000, max: 18_000 },
        marketEstimatedHoursMultiplier: 1.8,
        typicalTeamSize: 5,
        typicalDurationMonths: 4,
        monthlyUnitPrice: 1_200_000,
        trends: ['AI活用の増加'],
        risks: ['人材不足'],
        summary: '市場データの要約',
      },
      citations: [
        { url: 'https://example.com/a', type: 'web' },
        { url: 'https://example.com/b', type: 'web' },
      ],
      raw: {},
      confidenceScore: 0.75,
      usage: {},
      isFallback: false,
      fallbackReason: null,
    },
    reusedPrevious: false,
    stale: false,
    warning: null,
    sourceRetrievedAt: new Date().toISOString(),
  })
}

function setupValuePropositionMock(): void {
  mockSendMessage.mockResolvedValueOnce(JSON.stringify({
    narrative: '市場平均価格に対し、当社は30%低い価格でご提供します。',
    additionalStrengths: ['迅速なデリバリー'],
    riskMitigations: ['PoCフェーズで技術リスクを早期検証'],
    generatedMarkdown: '# バリュープロポジション\n\n当社の提案',
  }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sales Engineer Pipeline Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default evidence pipeline setup
    mockEnrichHistory.mockResolvedValue([])
    mockBuildCalibration.mockReturnValue(buildEmptyHistoricalCalibration())
    mockBuildEvidenceContext.mockReturnValue('')
  })

  // 1. Full new_project pipeline
  it('should run full new_project pipeline: classifier → auto-generate → value proposition', async () => {
    // Classifier: keyword-based for iotrealm (AI + ML + IoT = high score)
    const classification = await classifyBusinessLine({
      specMarkdown: 'AIとMLを活用した機械学習ベースのIoT対応SaaSプラットフォーム開発',
      projectType: 'new_project',
    })

    expect(classification.businessLine).toBe('iotrealm')
    expect(classification.confidence).toBeGreaterThan(0.3)

    // Auto-generate estimate
    const policy = defaultPolicyFor('new_project')
    mockFetchPricingPolicy.mockResolvedValue(policy)
    setupHoursEstimateMock()
    setupMarketEvidenceMocks()

    const supabase = createMockSupabase()

    const estimateResult = await autoGenerateEstimate({
      supabase,
      projectId: 'proj-001',
      projectType: 'new_project',
      specMarkdown: 'AI IoT SaaS プラットフォーム仕様書',
      businessLine: classification.businessLine,
    })

    expect(estimateResult.estimateId).toBe('est-001')
    expect(estimateResult.totalHours).toBe(75)
    expect(estimateResult.hourlyRate).toBe(12500)
    expect(estimateResult.estimateMode).toBe('market_comparison')

    // Value proposition
    const pricing = createMockPricingResult()
    const goNoGo = createMockGoNoGoResult()
    setupValuePropositionMock()

    const valueProp = await generateValueProposition({
      specMarkdown: 'AI IoT SaaS プラットフォーム仕様書',
      similarProjects: [],
      goNoGoResult: goNoGo,
      pricingResult: pricing,
      businessLine: classification.businessLine,
    })

    expect(valueProp.marketComparison.savingsPercent).toBe(30)
    expect(valueProp.uniqueStrengths.some((s) => s.includes('iotrealm'))).toBe(true)
    expect(valueProp.generatedMarkdown).toBeTruthy()
  })

  // 2. Full bug_report pipeline
  it('should run full bug_report pipeline: classifier → hours-only estimate → go-no-go', async () => {
    // Classifier: keyword-based for boltsite
    const classification = await classifyBusinessLine({
      specMarkdown: 'WordPressコーポレートサイトのCMSホスティング環境でのランディングページ表示バグ修正',
      projectType: 'bug_report',
    })

    expect(classification.businessLine).toBe('boltsite')

    // Auto-generate with hours_only mode (bug_report)
    const policy = defaultPolicyFor('bug_report')
    mockFetchPricingPolicy.mockResolvedValue(policy)
    setupHoursEstimateMock()

    const supabase = createMockSupabase()

    const estimateResult = await autoGenerateEstimate({
      supabase,
      projectId: 'proj-002',
      projectType: 'bug_report',
      specMarkdown: 'バグ修正仕様書',
      businessLine: classification.businessLine,
    })

    expect(estimateResult.estimateMode).toBe('hours_only')
    // Bug reports now run Go/No-Go when businessLine is provided (profitability weight=0 via getWeights)
    expect(estimateResult.goNoGoDecision).toBe('go')

    // Market evidence should NOT be fetched for hours_only
    expect(mockFetchMarketEvidence).not.toHaveBeenCalled()
  })

  // 3. Pipeline with similar projects
  it('should find and include similar projects when showcase repos exist', async () => {
    const showcaseRefs = [
      {
        id: 'ref-1',
        org_name: 'cor-inc',
        repo_name: 'iot-dashboard',
        full_name: 'cor-inc/iot-dashboard',
        description: 'IoT dashboard with React',
        language: 'TypeScript',
        tech_stack: ['React', 'TypeScript', 'MQTT'],
        project_type: 'new_project',
        topics: ['iot', 'dashboard'],
        hours_spent: 200,
      },
      {
        id: 'ref-2',
        org_name: 'cor-inc',
        repo_name: 'ai-pipeline',
        full_name: 'cor-inc/ai-pipeline',
        description: 'ML pipeline',
        language: 'Python',
        tech_stack: ['Python', 'TensorFlow'],
        project_type: 'new_project',
        topics: ['ai', 'ml'],
        hours_spent: 300,
      },
    ]

    const supabase = createMockSupabase({ showcaseRefs })

    const similarProjects = await findSimilarProjects({
      supabase,
      specMarkdown: 'ReactベースのIoTダッシュボードとAI分析機能',
      projectType: 'new_project',
      businessLine: 'iotrealm',
    })

    expect(similarProjects.length).toBeGreaterThan(0)
    expect(similarProjects[0].matchScore).toBeGreaterThan(0)
    expect(similarProjects[0].matchReasons.length).toBeGreaterThan(0)
  })

  // 4. Pipeline without similar projects
  it('should return null similar_projects when no showcase repos exist', async () => {
    const supabase = createMockSupabase({ showcaseRefs: [] })

    const similarProjects = await findSimilarProjects({
      supabase,
      specMarkdown: 'ReactベースのIoTダッシュボード',
      projectType: 'new_project',
      businessLine: 'iotrealm',
    })

    expect(similarProjects).toEqual([])
  })

  // 5. Go/No-Go: go decision
  it('should return go decision with high margin and low active projects', async () => {
    const pricing = createMockPricingResult({
      marginPercent: 59.18,
      ourPrice: 35_280_000,
      costFloor: 14_400_000,
    })

    const supabase = createMockSupabase({ activeProjectCount: 1 })

    const result = await evaluateGoNoGo({
      supabase,
      projectId: 'proj-001',
      projectType: 'new_project',
      businessLine: 'iotrealm',
      pricingResult: pricing,
      specMarkdown: 'AIプラットフォーム開発仕様書',
      riskFlags: [],
    })

    expect(result.decision).toBe('go')
    expect(result.overallScore).toBeGreaterThanOrEqual(70)
    expect(result.scores.profitability.score).toBe(100)
    expect(result.scores.capacity.score).toBe(100)
    expect(result.conditions).toEqual([])
  })

  // 6. Go/No-Go: no_go decision
  it('should return no_go decision with low margin, many active projects, and many risks', async () => {
    const pricing = createMockPricingResult({
      marginPercent: 3,
      ourPrice: 15_000_000,
      costFloor: 14_400_000,
      riskFlags: ['LOW_MARGIN', 'FLOOR_BREACH'],
    })

    const supabase = createMockSupabase({ activeProjectCount: 8 })

    const result = await evaluateGoNoGo({
      supabase,
      projectId: 'proj-003',
      projectType: 'new_project',
      businessLine: 'tapforge',
      pricingResult: pricing,
      specMarkdown: '未定の要件が多い案件。TBD多数。要調査事項が多い。検討中の事項あり。',
      riskFlags: ['LOW_MARGIN', 'FLOOR_BREACH', 'insufficient_evidence_sources'],
    })

    expect(result.decision).toBe('no_go')
    expect(result.overallScore).toBeLessThan(40)
    expect(result.conditions.length).toBeGreaterThan(0)
    expect(result.scores.profitability.score).toBeLessThan(50)
  })

  // 7. Value proposition with cost savings
  it('should calculate savings percent correctly when ourPrice < marketTotal', async () => {
    const pricing = createMockPricingResult({
      marketTotal: 50_400_000,
      ourPrice: 35_280_000,
    })

    const goNoGo = createMockGoNoGoResult()
    setupValuePropositionMock()

    const result = await generateValueProposition({
      specMarkdown: 'テストプロジェクト',
      similarProjects: [],
      goNoGoResult: goNoGo,
      pricingResult: pricing,
      businessLine: 'iotrealm',
    })

    expect(result.marketComparison.savingsPercent).toBe(30)
    expect(result.marketComparison.ourPrice).toBe(35_280_000)
    expect(result.marketComparison.marketPrice).toBe(50_400_000)
    expect(result.marketComparison.narrative).toBeTruthy()
  })

  // 8. Value proposition without similar projects
  it('should generate value proposition with empty portfolio highlights when no similar projects', async () => {
    const pricing = createMockPricingResult()
    const goNoGo = createMockGoNoGoResult()
    setupValuePropositionMock()

    const result = await generateValueProposition({
      specMarkdown: 'テストプロジェクト',
      similarProjects: [],
      goNoGoResult: goNoGo,
      pricingResult: pricing,
      businessLine: 'boltsite',
    })

    expect(result.portfolioHighlights).toEqual([])
    expect(result.uniqueStrengths.length).toBeGreaterThan(0)
    expect(result.uniqueStrengths.some((s) => s.includes('boltsite'))).toBe(true)
  })

  // 9. Business line affects go-no-go strategic alignment score
  it('should assign different strategic alignment scores based on business line and project type', async () => {
    const pricing = createMockPricingResult()

    // boltsite + new_project = 90
    const supabase1 = createMockSupabase({ activeProjectCount: 1 })
    const boltsiteResult = await evaluateGoNoGo({
      supabase: supabase1,
      projectId: 'proj-a',
      projectType: 'new_project',
      businessLine: 'boltsite',
      pricingResult: pricing,
      specMarkdown: 'Webサイト制作',
      riskFlags: [],
    })

    expect(boltsiteResult.scores.strategicAlignment.score).toBe(90)
    expect(boltsiteResult.scores.strategicAlignment.businessLine).toBe('boltsite')

    // tapforge + bug_report = 55
    const supabase2 = createMockSupabase({ activeProjectCount: 1 })
    const tapforgeResult = await evaluateGoNoGo({
      supabase: supabase2,
      projectId: 'proj-b',
      projectType: 'bug_report',
      businessLine: 'tapforge',
      pricingResult: pricing,
      specMarkdown: 'NFC名刺バグ修正',
      riskFlags: [],
    })

    expect(tapforgeResult.scores.strategicAlignment.score).toBe(55)
    expect(tapforgeResult.scores.strategicAlignment.businessLine).toBe('tapforge')
  })

  // 10. End-to-end data flow verification
  it('should pass data correctly through business line → go-no-go → value-proposition', async () => {
    // Step 1: Classify business line
    const classification = await classifyBusinessLine({
      specMarkdown: 'AIとMLを活用した機械学習ベースのIoTプラットフォーム',
      projectType: 'new_project',
    })

    expect(classification.businessLine).toBe('iotrealm')

    // Step 2: Calculate pricing
    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: {
        teamSize: policy.defaultTeamSize,
        durationMonths: policy.defaultDurationMonths,
        monthlyUnitPrice: policy.avgInternalCostPerMemberMonth,
      },
    })

    expect(pricing.marketTotal).toBeGreaterThan(0)
    expect(pricing.ourPrice).toBeGreaterThan(0)

    // Step 3: Evaluate Go/No-Go using the classified business line
    const supabase = createMockSupabase({ activeProjectCount: 1 })
    const goNoGoResult = await evaluateGoNoGo({
      supabase,
      projectId: 'proj-e2e',
      projectType: 'new_project',
      businessLine: classification.businessLine,
      pricingResult: pricing,
      specMarkdown: 'AIとMLを活用した機械学習ベースのIoTプラットフォーム',
      riskFlags: pricing.riskFlags,
    })

    // iotrealm + new_project = 95 alignment
    expect(goNoGoResult.scores.strategicAlignment.score).toBe(95)
    expect(goNoGoResult.scores.strategicAlignment.businessLine).toBe('iotrealm')

    // Step 4: Generate value proposition using go-no-go result and classified business line
    setupValuePropositionMock()

    const valueProp = await generateValueProposition({
      specMarkdown: 'AIとMLを活用した機械学習ベースのIoTプラットフォーム',
      similarProjects: [],
      goNoGoResult,
      pricingResult: pricing,
      businessLine: classification.businessLine,
    })

    // Verify data flows: business line strengths reflect iotrealm
    expect(valueProp.uniqueStrengths.some((s) => s.includes('iotrealm'))).toBe(true)
    expect(valueProp.uniqueStrengths.some((s) => s.includes('IoT'))).toBe(true)

    // Verify pricing data flows through
    expect(valueProp.marketComparison.marketPrice).toBe(pricing.marketTotal)
    expect(valueProp.marketComparison.ourPrice).toBe(pricing.ourPrice)

    // Verify go-no-go decision was used (no conditions = go)
    expect(goNoGoResult.decision).toBe('go')
    expect(valueProp.riskMitigations.length).toBeGreaterThan(0)
  })
})
