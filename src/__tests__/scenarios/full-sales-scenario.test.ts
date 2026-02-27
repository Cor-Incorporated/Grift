import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/ai/anthropic', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/lib/ai/xai', () => ({
  parseJsonFromResponse: vi.fn(),
}))

import { classifyBusinessLine } from '@/lib/business-line/classifier'
import { findSimilarProjects } from '@/lib/estimates/similar-projects'
import { evaluateGoNoGo } from '@/lib/approval/go-no-go'
import { generateValueProposition } from '@/lib/estimates/value-proposition'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'
import type { PriceCalculationResult } from '@/lib/pricing/engine'
import type { GoNoGoResult } from '@/lib/approval/go-no-go'
import type { SimilarProject } from '@/lib/estimates/similar-projects'
import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'

const mockSendMessage = vi.mocked(sendMessage)
const mockParseJson = vi.mocked(parseJsonFromResponse)

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function setupClassifierAiResponse(businessLine: string, confidence: number, reasoning: string) {
  mockSendMessage.mockResolvedValueOnce(
    JSON.stringify({ businessLine, confidence, reasoning })
  )
  mockParseJson.mockReturnValueOnce({ businessLine, confidence, reasoning })
}

function setupValuePropositionAiResponse() {
  const vpResponse = {
    narrative: '市場平均に対し当社は効率的な開発でコスト削減を実現します。',
    additionalStrengths: ['アジャイル開発の豊富な実績', 'CI/CD完備'],
    riskMitigations: ['技術リスクに対するPoCの事前実施', 'スケジュールバッファの確保'],
    generatedMarkdown: '# バリュープロポジション\n\n## 概要\n当社の提案です。',
  }
  mockSendMessage.mockResolvedValueOnce(JSON.stringify(vpResponse))
  mockParseJson.mockReturnValueOnce(vpResponse)
}

function createMockSupabase(
  activeCount: number = 1,
  showcaseRepos: Array<{
    id: string
    org_name: string
    repo_name: string
    full_name: string
    description: string | null
    language: string | null
    tech_stack: string[]
    project_type: string | null
    topics: string[]
    hours_spent: number | null
  }> = []
) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              neq: vi.fn().mockResolvedValue({
                count: activeCount,
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'github_references') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: showcaseRepos,
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          }),
        }),
      }
    }),
  } as unknown as Parameters<typeof evaluateGoNoGo>[0]['supabase']
}

const EC_REPOS = [
  {
    id: 'repo-1',
    org_name: 'cor-inc',
    repo_name: 'ec-nextjs',
    full_name: 'cor-inc/ec-nextjs',
    description: 'ECサイト on Next.js',
    language: 'TypeScript',
    tech_stack: ['Next.js', 'Stripe', 'PostgreSQL', 'TypeScript'],
    project_type: 'new_project',
    topics: ['ecommerce', 'nextjs', 'stripe'],
    hours_spent: 480,
  },
  {
    id: 'repo-2',
    org_name: 'cor-inc',
    repo_name: 'payment-gateway',
    full_name: 'cor-inc/payment-gateway',
    description: '決済ゲートウェイ',
    language: 'TypeScript',
    tech_stack: ['Stripe', 'Node.js'],
    project_type: 'new_project',
    topics: ['payment', 'stripe'],
    hours_spent: 200,
  },
]

const IOT_REPOS = [
  {
    id: 'repo-3',
    org_name: 'cor-inc',
    repo_name: 'iot-dashboard',
    full_name: 'cor-inc/iot-dashboard',
    description: 'IoTダッシュボード',
    language: 'Python',
    tech_stack: ['MQTT', 'React', 'Python', 'InfluxDB'],
    project_type: 'new_project',
    topics: ['iot', 'mqtt', 'dashboard'],
    hours_spent: 600,
  },
]

const NFC_REPOS = [
  {
    id: 'repo-4',
    org_name: 'cor-inc',
    repo_name: 'nfc-card-app',
    full_name: 'cor-inc/nfc-card-app',
    description: 'NFC名刺アプリ',
    language: 'Kotlin',
    tech_stack: ['React Native', 'NFC', 'Kotlin'],
    project_type: 'new_project',
    topics: ['nfc', 'mobile'],
    hours_spent: 320,
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Full Sales Engineer Scenario Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // Scenario 1: 新規ECサイト開発 (BoltSite)
  // =========================================================================
  describe('Scenario 1: 新規ECサイト開発 (BoltSite)', () => {
    const spec = 'Next.jsでECサイトを新規開発。Stripe決済、TypeScript、PostgreSQL。コーポレートサイトも含む。'

    it('Step 1: ビジネスライン分類 → boltsite', async () => {
      // 'コーポレートサイト' → boltsite keyword match
      // But only 1 keyword = 1/9 < 0.5 → AI fallback
      // Actually let's check: the spec contains 'コーポレートサイト'
      // boltsite keywords: ['ホスティング', 'cms', 'lp', 'ランディングページ', 'boltsite', 'ボルトサイト', 'wordpress', 'コーポレートサイト', '静的サイト']
      // matches: 'コーポレートサイト' → 1/9 = 0.11 < 0.5 → AI fallback
      setupClassifierAiResponse('boltsite', 0.85, 'ECサイト + コーポレートサイトはBoltSite案件')

      const classification = await classifyBusinessLine({
        specMarkdown: spec,
        projectType: 'new_project',
      })

      expect(classification.businessLine).toBe('boltsite')
    })

    it('Step 2: 類似プロジェクト検索 → EC repos match', async () => {
      const supabase = createMockSupabase(1, EC_REPOS)

      const similar = await findSimilarProjects({
        supabase,
        specMarkdown: spec,
        projectType: 'new_project',
        businessLine: 'boltsite',
      })

      expect(similar.length).toBeGreaterThan(0)
      // Should match on Stripe, TypeScript, etc.
      const topMatch = similar[0]
      expect(topMatch.matchScore).toBeGreaterThan(0)
      expect(topMatch.matchReasons.length).toBeGreaterThan(0)
    })

    it('Step 3: 価格計算 → 市場価格との比較', () => {
      const policy = defaultPolicyFor('new_project')
      // Use higher monthlyUnitPrice so basePrice > costFloor and margin is positive
      // marketTotal = 4 * 4 * 2_500_000 = 40_000_000
      // basePrice = 40_000_000 * 0.7 = 28_000_000
      // costFloor = 2_000_000 * 4 * (4 * 0.6) = 19_200_000
      // ourPrice = max(28_000_000, 2_000_000, 19_200_000) = 28_000_000
      // marginPercent = (28_000_000 - 19_200_000) / 28_000_000 * 100 = 31.43%
      const pricing = calculatePrice({
        policy,
        market: {
          teamSize: 4,
          durationMonths: 4,
          monthlyUnitPrice: 2_500_000,
        },
      })

      expect(pricing.ourPrice).toBeGreaterThan(0)
      expect(pricing.marketTotal).toBe(40_000_000) // 4*4*2.5M
      expect(pricing.ourPrice).toBeLessThanOrEqual(pricing.marketTotal)
      expect(pricing.marginPercent).toBeGreaterThan(0)
    })

    it('Step 4: Go/No-Go 判定 → go', async () => {
      const supabase = createMockSupabase(1)
      const policy = defaultPolicyFor('new_project')
      const pricing = calculatePrice({
        policy,
        market: {
          teamSize: 4,
          durationMonths: 4,
          monthlyUnitPrice: 2_500_000,
        },
      })

      const goNoGo = await evaluateGoNoGo({
        supabase,
        projectId: 'ec-project-id',
        projectType: 'new_project',
        businessLine: 'boltsite',
        pricingResult: pricing,
        specMarkdown: spec,
        riskFlags: pricing.riskFlags,
      })

      expect(goNoGo.decision).toBe('go')
      expect(goNoGo.overallScore).toBeGreaterThanOrEqual(70)
    })

    it('Step 5: バリュープロポジション生成 → コスト削減含む', async () => {
      const policy = defaultPolicyFor('new_project')
      const pricing = calculatePrice({
        policy,
        market: {
          teamSize: 4,
          durationMonths: 4,
          monthlyUnitPrice: 1_500_000,
        },
      })

      const goNoGo: GoNoGoResult = {
        decision: 'go',
        scores: {
          profitability: { score: 80, details: '健全' },
          strategicAlignment: { score: 90, businessLine: 'boltsite', details: '適合' },
          capacity: { score: 100, activeProjectCount: 1, details: '余裕' },
          technicalRisk: { score: 90, details: '低リスク' },
        },
        overallScore: 85,
        conditions: [],
        reasoning: 'テスト',
      }

      const similarProjects: SimilarProject[] = [{
        githubReferenceId: 'repo-1',
        repoFullName: 'cor-inc/ec-nextjs',
        matchScore: 0.6,
        matchReasons: ['技術スタック一致: Next.js, Stripe'],
        language: 'TypeScript',
        techStack: ['Next.js', 'Stripe', 'PostgreSQL', 'TypeScript'],
        hoursSpent: 480,
        description: 'ECサイト on Next.js',
      }]

      setupValuePropositionAiResponse()

      const vp = await generateValueProposition({
        specMarkdown: spec,
        similarProjects,
        goNoGoResult: goNoGo,
        pricingResult: pricing,
        businessLine: 'boltsite',
      })

      expect(vp.portfolioHighlights.length).toBeGreaterThan(0)
      expect(vp.marketComparison.ourPrice).toBeLessThan(vp.marketComparison.marketPrice)
      expect(vp.marketComparison.savingsPercent).toBeGreaterThan(0)
      expect(vp.uniqueStrengths.length).toBeGreaterThan(0)
      expect(vp.uniqueStrengths).toContain('Webアプリ・サイト構築の豊富な実績')
    })
  })

  // =========================================================================
  // Scenario 2: IoT 監視システム (IoTRealm)
  // =========================================================================
  describe('Scenario 2: IoT監視システム (IoTRealm)', () => {
    // iotrealm keywords: ai, ml, 機械学習, iot, iotrealm, ディープラーニング, カスタム開発, saas, スクラッチ開発
    // Need >= 5 for keyword threshold: iot, ai, ml, カスタム開発, スクラッチ開発 = 5/9
    const spec = '工場の温湿度センサーからMQTTでデータ収集し、リアルタイムダッシュボードで表示。IoTカスタム開発。AIとMLによるスクラッチ開発で異常検知。'

    it('Step 1: ビジネスライン分類 → iotrealm (keyword)', async () => {
      const classification = await classifyBusinessLine({
        specMarkdown: spec,
        projectType: 'new_project',
      })

      expect(classification.businessLine).toBe('iotrealm')
      expect(mockSendMessage).not.toHaveBeenCalled() // keyword hit sufficient
    })

    it('Step 2: 類似プロジェクト → IoT repos', async () => {
      const supabase = createMockSupabase(2, IOT_REPOS)

      const similar = await findSimilarProjects({
        supabase,
        specMarkdown: spec,
        projectType: 'new_project',
        businessLine: 'iotrealm',
      })

      expect(similar.length).toBeGreaterThan(0)
      const matchReasons = similar.flatMap((s) => s.matchReasons).join(' ')
      expect(matchReasons).toContain('iot')
    })

    it('Step 3: Go/No-Go → go_with_conditions (IoT complexity)', async () => {
      const supabase = createMockSupabase(3)
      const policy = defaultPolicyFor('new_project')
      const pricing = calculatePrice({
        policy,
        market: {
          teamSize: 5,
          durationMonths: 6,
          monthlyUnitPrice: 1_800_000,
        },
      })

      const goNoGo = await evaluateGoNoGo({
        supabase,
        projectId: 'iot-project-id',
        projectType: 'new_project',
        businessLine: 'iotrealm',
        pricingResult: pricing,
        specMarkdown: spec,
        riskFlags: ['HARDWARE_DEPENDENCY'],
      })

      // IoT typically has some hardware risk, capacity at 3 is moderate
      expect(['go', 'go_with_conditions']).toContain(goNoGo.decision)
      expect(goNoGo.scores.strategicAlignment.score).toBe(100) // iotrealm + new_project + keyword bonus (センサー,mqtt,iot,ai,ml=5 matches → +10)
    })

    it('Step 4: バリュープロポジション → IoT strengths', async () => {
      const pricing: PriceCalculationResult = {
        marketTotal: 54_000_000,
        coefficient: 0.7,
        ourPrice: 37_800_000,
        costFloor: 21_600_000,
        marginPercent: 42.86,
        riskFlags: [],
      }

      const goNoGo: GoNoGoResult = {
        decision: 'go_with_conditions',
        scores: {
          profitability: { score: 80, details: '健全' },
          strategicAlignment: { score: 95, businessLine: 'iotrealm', details: '高適合' },
          capacity: { score: 75, activeProjectCount: 3, details: 'キャパシティ注意' },
          technicalRisk: { score: 60, details: '中リスク' },
        },
        overallScore: 55,
        conditions: ['技術リスクの低減が必要（未確定事項の解消またはPoCの実施）'],
        reasoning: 'テスト',
      }

      setupValuePropositionAiResponse()

      const vp = await generateValueProposition({
        specMarkdown: spec,
        similarProjects: [{
          githubReferenceId: 'repo-3',
          repoFullName: 'cor-inc/iot-dashboard',
          matchScore: 0.5,
          matchReasons: ['トピック一致: iot, mqtt'],
          language: 'Python',
          techStack: ['MQTT', 'React', 'Python'],
          hoursSpent: 600,
          description: 'IoTダッシュボード',
        }],
        goNoGoResult: goNoGo,
        pricingResult: pricing,
        businessLine: 'iotrealm',
      })

      expect(vp.uniqueStrengths).toContain('IoT/組込みシステムの専門知識')
      expect(vp.uniqueStrengths).toContain('センサー連携・リアルタイムデータ処理の実績')
      expect(vp.riskMitigations.length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // Scenario 3: デジタル名刺アプリ (TapForge)
  // =========================================================================
  describe('Scenario 3: デジタル名刺アプリ (TapForge)', () => {
    // tapforge keywords: nfc, 名刺, tapforge, タップフォージ, ビジネスカード, デジタル名刺
    // Need >= 3 for keyword threshold: nfc, 名刺, デジタル名刺 = 3/6
    const spec = 'NFCチップ搭載のデジタル名刺をタップして連絡先を交換するモバイルアプリ'

    it('Step 1: ビジネスライン分類 → tapforge (keyword)', async () => {
      const classification = await classifyBusinessLine({
        specMarkdown: spec,
        projectType: 'new_project',
      })

      expect(classification.businessLine).toBe('tapforge')
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('Step 2: 類似プロジェクト → NFC repos', async () => {
      const supabase = createMockSupabase(0, NFC_REPOS)

      const similar = await findSimilarProjects({
        supabase,
        specMarkdown: spec,
        projectType: 'new_project',
        businessLine: 'tapforge',
      })

      expect(similar.length).toBeGreaterThan(0)
      const techStacks = similar.flatMap((s) => s.techStack)
      expect(techStacks.some((t) => t.toLowerCase().includes('nfc'))).toBe(true)
    })

    it('Step 3: Go/No-Go → go_with_conditions or go', async () => {
      const supabase = createMockSupabase(1)
      const policy = defaultPolicyFor('new_project')
      const pricing = calculatePrice({
        policy,
        market: {
          teamSize: 3,
          durationMonths: 3,
          monthlyUnitPrice: 1_200_000,
        },
      })

      const goNoGo = await evaluateGoNoGo({
        supabase,
        projectId: 'nfc-project-id',
        projectType: 'new_project',
        businessLine: 'tapforge',
        pricingResult: pricing,
        specMarkdown: spec,
        riskFlags: [],
      })

      // tapforge + new_project = 85 base + 5 keyword bonus (モバイル,アプリ=2 matches) = 90
      expect(['go', 'go_with_conditions']).toContain(goNoGo.decision)
      expect(goNoGo.scores.strategicAlignment.score).toBe(90)
    })

    it('Step 4: バリュープロポジション → TapForge strengths', async () => {
      const pricing: PriceCalculationResult = {
        marketTotal: 10_800_000,
        coefficient: 0.7,
        ourPrice: 7_560_000,
        costFloor: 3_600_000,
        marginPercent: 52.38,
        riskFlags: [],
      }

      const goNoGo: GoNoGoResult = {
        decision: 'go',
        scores: {
          profitability: { score: 90, details: '高収益' },
          strategicAlignment: { score: 85, businessLine: 'tapforge', details: '適合' },
          capacity: { score: 100, activeProjectCount: 1, details: '余裕' },
          technicalRisk: { score: 100, details: '低リスク' },
        },
        overallScore: 93,
        conditions: [],
        reasoning: 'テスト',
      }

      setupValuePropositionAiResponse()

      const vp = await generateValueProposition({
        specMarkdown: spec,
        similarProjects: [{
          githubReferenceId: 'repo-4',
          repoFullName: 'cor-inc/nfc-card-app',
          matchScore: 0.5,
          matchReasons: ['トピック一致: nfc, mobile'],
          language: 'Kotlin',
          techStack: ['React Native', 'NFC', 'Kotlin'],
          hoursSpent: 320,
          description: 'NFC名刺アプリ',
        }],
        goNoGoResult: goNoGo,
        pricingResult: pricing,
        businessLine: 'tapforge',
      })

      expect(vp.uniqueStrengths).toContain('NFC/モバイル決済の専門開発チーム')
      expect(vp.uniqueStrengths).toContain('デジタル名刺・タッチポイントソリューション')
      expect(vp.uniqueStrengths).toContain('BLE/NFC技術の先進的な活用実績')
      expect(vp.marketComparison.savingsPercent).toBe(30)
    })
  })

  // =========================================================================
  // Scenario 4: 赤字案件 (No-Go)
  // =========================================================================
  describe('Scenario 4: 赤字案件 (No-Go)', () => {
    const spec = '低予算の小規模修正。未定が多い。未定。未定。要調査。要確認。TBD。検討中。未決定。'

    it('Step 1: 分類 → iotrealm (AI fallback)', async () => {
      setupClassifierAiResponse('iotrealm', 0.5, '不明確な案件のためデフォルト')

      const classification = await classifyBusinessLine({
        specMarkdown: spec,
        projectType: 'new_project',
      })

      expect(classification.businessLine).toBe('iotrealm')
    })

    it('Step 2: Go/No-Go → no_go', async () => {
      const supabase = createMockSupabase(6)

      const goNoGo = await evaluateGoNoGo({
        supabase,
        projectId: 'red-project-id',
        projectType: 'new_project',
        businessLine: 'iotrealm',
        pricingResult: {
          marketTotal: 2_000_000,
          coefficient: 0.5,
          ourPrice: 2_000_000,
          costFloor: 2_400_000,
          marginPercent: -20,
          riskFlags: ['FLOOR_BREACH', 'LOW_MARGIN', 'LOW_COEFFICIENT'],
        },
        specMarkdown: spec,
        riskFlags: ['FLOOR_BREACH', 'LOW_MARGIN', 'LOW_COEFFICIENT', 'BUDGET_CONSTRAINT'],
      })

      expect(goNoGo.decision).toBe('no_go')
      expect(goNoGo.conditions.length).toBeGreaterThanOrEqual(2)
      // Should include profitability and risk conditions
      const conditionText = goNoGo.conditions.join(' ')
      expect(conditionText).toContain('収益性')
      expect(conditionText).toContain('技術リスク')
    })

    it('Step 3: バリュープロポジション → still generated (with caveats)', async () => {
      const pricing: PriceCalculationResult = {
        marketTotal: 2_000_000,
        coefficient: 0.5,
        ourPrice: 2_000_000,
        costFloor: 2_400_000,
        marginPercent: -20,
        riskFlags: ['FLOOR_BREACH'],
      }

      const goNoGo: GoNoGoResult = {
        decision: 'no_go',
        scores: {
          profitability: { score: 0, details: '赤字' },
          strategicAlignment: { score: 95, businessLine: 'iotrealm', details: '適合' },
          capacity: { score: 25, activeProjectCount: 6, details: '逼迫' },
          technicalRisk: { score: 20, details: '高リスク' },
        },
        overallScore: 25,
        conditions: [
          '収益性の改善が必要（価格調整または工数削減）',
          'チームキャパシティの確保が必要（既存案件の完了待ちまたはリソース追加）',
          '技術リスクの低減が必要（未確定事項の解消またはPoCの実施）',
        ],
        reasoning: 'テスト',
      }

      setupValuePropositionAiResponse()

      const vp = await generateValueProposition({
        specMarkdown: spec,
        similarProjects: [],
        goNoGoResult: goNoGo,
        pricingResult: pricing,
        businessLine: 'iotrealm',
      })

      // Value proposition is still generated even for no-go decisions
      expect(vp.generatedMarkdown).toBeTruthy()
      expect(vp.uniqueStrengths.length).toBeGreaterThan(0)
      expect(vp.riskMitigations.length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // Scenario 5: バグ報告の短い案件
  // =========================================================================
  describe('Scenario 5: バグ報告の短い案件', () => {
    const spec = 'ログイン画面で500エラーが発生する'

    it('Step 1: 分類 → AI で判定 (keyword hit なし)', async () => {
      setupClassifierAiResponse('iotrealm', 0.6, 'バグ報告はシステムの技術的判断が必要')

      const classification = await classifyBusinessLine({
        specMarkdown: spec,
        projectType: 'bug_report',
      })

      expect(classification.businessLine).toBe('iotrealm')
      expect(mockSendMessage).toHaveBeenCalledOnce()
    })

    it('Step 2: 類似プロジェクト → 空 (短すぎるスペック)', async () => {
      const supabase = createMockSupabase(0, EC_REPOS)

      const similar = await findSimilarProjects({
        supabase,
        specMarkdown: spec,
        projectType: 'bug_report',
        businessLine: 'iotrealm',
      })

      // 'ログイン画面で500エラーが発生する' — no tech keywords match
      // The only potential match is 'auth' from extractKeywords
      // Let's verify: '認証' is in domainTerms but spec doesn't contain it
      expect(similar.length).toBe(0)
    })

    it('Step 3: 価格計算 → bug_report policy (hours_only mode 相当)', () => {
      const policy = defaultPolicyFor('bug_report')

      expect(policy.minimumProjectFee).toBe(300_000)
      expect(policy.defaultTeamSize).toBe(2)
      expect(policy.defaultDurationMonths).toBe(1)

      const pricing = calculatePrice({
        policy,
        market: {
          teamSize: 1,
          durationMonths: 0.5,
          monthlyUnitPrice: 1_000_000,
        },
      })

      // marketTotal = 1 * 0.5 * 1_000_000 = 500_000
      // basePrice = 500_000 * 0.6 = 300_000
      // costFloor = 2_000_000 * internalTeamSize(2) * (0.5 * 0.6) = 1_200_000
      // ourPrice = max(300_000, 300_000, 1_200_000) = 1_200_000 (costFloor wins)
      expect(pricing.ourPrice).toBe(1_200_000)
      expect(pricing.marketTotal).toBe(500_000)
    })

    it('Step 4: Go/No-Go → bug_report scores', async () => {
      const supabase = createMockSupabase(1)

      const goNoGo = await evaluateGoNoGo({
        supabase,
        projectId: 'bug-project-id',
        projectType: 'bug_report',
        businessLine: 'iotrealm',
        pricingResult: {
          marketTotal: 500_000,
          coefficient: 0.6,
          ourPrice: 300_000,
          costFloor: 600_000,
          marginPercent: -100,
          riskFlags: ['FLOOR_BREACH'],
        },
        specMarkdown: spec,
        riskFlags: [],
      })

      // iotrealm + bug_report = 65
      expect(goNoGo.scores.strategicAlignment.score).toBe(65)
    })

    it('Step 5: バリュープロポジション → portfolio なし、strengths 生成', async () => {
      const pricing: PriceCalculationResult = {
        marketTotal: 500_000,
        coefficient: 0.6,
        ourPrice: 300_000,
        costFloor: 200_000,
        marginPercent: 33.33,
        riskFlags: [],
      }

      const goNoGo: GoNoGoResult = {
        decision: 'go',
        scores: {
          profitability: { score: 80, details: '健全' },
          strategicAlignment: { score: 65, businessLine: 'iotrealm', details: '中適合' },
          capacity: { score: 100, activeProjectCount: 0, details: '余裕' },
          technicalRisk: { score: 100, details: '低リスク' },
        },
        overallScore: 85,
        conditions: [],
        reasoning: 'テスト',
      }

      setupValuePropositionAiResponse()

      const vp = await generateValueProposition({
        specMarkdown: spec,
        similarProjects: [],
        goNoGoResult: goNoGo,
        pricingResult: pricing,
        businessLine: 'iotrealm',
      })

      // No similar projects → empty portfolio highlights
      expect(vp.portfolioHighlights).toHaveLength(0)
      // But strengths should still include base + business line strengths
      expect(vp.uniqueStrengths.length).toBeGreaterThanOrEqual(3)
      expect(vp.uniqueStrengths).toContain('IoT/組込みシステムの専門知識')
    })
  })

  // =========================================================================
  // Cross-cutting: Value Proposition fallback on AI error
  // =========================================================================
  describe('Cross-cutting: AI エラー時のフォールバック', () => {
    it('sendMessage 失敗 → fallback コンテンツが生成される', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('AI API Error'))

      const pricing: PriceCalculationResult = {
        marketTotal: 10_000_000,
        coefficient: 0.7,
        ourPrice: 7_000_000,
        costFloor: 4_000_000,
        marginPercent: 42.86,
        riskFlags: [],
      }

      const goNoGo: GoNoGoResult = {
        decision: 'go',
        scores: {
          profitability: { score: 80, details: '健全' },
          strategicAlignment: { score: 90, businessLine: 'boltsite', details: '適合' },
          capacity: { score: 100, activeProjectCount: 0, details: '余裕' },
          technicalRisk: { score: 90, details: '低リスク' },
        },
        overallScore: 87,
        conditions: [],
        reasoning: 'テスト',
      }

      const vp = await generateValueProposition({
        specMarkdown: 'テスト仕様',
        similarProjects: [],
        goNoGoResult: goNoGo,
        pricingResult: pricing,
        businessLine: 'boltsite',
      })

      // Fallback narrative should mention market price
      expect(vp.marketComparison.narrative).toContain('¥10,000,000')
      expect(vp.marketComparison.narrative).toContain('¥7,000,000')
      expect(vp.marketComparison.narrative).toContain('30%')
      // Fallback markdown should be generated
      expect(vp.generatedMarkdown).toContain('バリュープロポジション')
      // No additional strengths from AI
      expect(vp.uniqueStrengths.every((s) =>
        s.includes('共創') ||
        s.includes('少人数') ||
        s.includes('boltsite') ||
        s.includes('Web') ||
        s.includes('Next.js') ||
        s.includes('レスポンシブ')
      )).toBe(true)
    })
  })
})
