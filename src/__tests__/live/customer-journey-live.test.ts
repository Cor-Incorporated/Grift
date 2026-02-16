// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { sendMessage } from '@/lib/ai/anthropic'
import { getSystemPrompt, getSpecGenerationPrompt } from '@/lib/ai/system-prompts'
import { classifyBusinessLine } from '@/lib/business-line/classifier'
import { calculatePrice, defaultPolicyFor } from '@/lib/pricing/engine'
import { evaluateGoNoGo } from '@/lib/approval/go-no-go'
import { generateValueProposition } from '@/lib/estimates/value-proposition'
import type { BusinessLine } from '@/types/database'
import type { ChatMessage } from '@/lib/ai/anthropic'

// ---------------------------------------------------------------------------
// Mock Supabase for evaluateGoNoGo capacity check
// ---------------------------------------------------------------------------
function createMockSupabase(activeProjectCount: number) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue({
            count: activeProjectCount,
            error: null,
          }),
        }),
      }),
    }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// ---------------------------------------------------------------------------
// Helper: parse METADATA JSON from AI response
// ---------------------------------------------------------------------------
function parseMetadataFromResponse(response: string): Record<string, unknown> | null {
  const delimiter = '---METADATA---'
  const delimiterIndex = response.indexOf(delimiter)
  if (delimiterIndex === -1) return null

  const jsonPart = response.slice(delimiterIndex + delimiter.length).trim()
  try {
    return JSON.parse(jsonPart)
  } catch {
    // Try extracting JSON from a code block
    const jsonMatch = jsonPart.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        return null
      }
    }
    return null
  }
}

// ===========================================================================
// Full Customer Journey - Live API Tests
// ===========================================================================
describe.runIf(!!process.env.ANTHROPIC_API_KEY)('Full Customer Journey - Live API', () => {

  // -------------------------------------------------------------------------
  // Scenario 1: EC Site Renewal -- New Project
  // -------------------------------------------------------------------------
  it('Scenario 1: EC site renewal (new_project) full journey', async () => {
    const validLines: BusinessLine[] = ['boltsite', 'iotrealm', 'tapforge']

    // ------------------------------------------------------------------
    // Step 1: Initial conversation with undetermined classifier prompt
    // ------------------------------------------------------------------
    const systemPrompt = getSystemPrompt('undetermined')
    const userMessage = '弊社のコーポレートサイトをリニューアルしたいです。WordPressを使っていますが、デザインが古くて、レスポンシブ対応もできていません。新しいNext.jsベースのサイトに作り替えたいのですが、見積もりをお願いできますか？'

    const firstResponse = await sendMessage(systemPrompt, [
      { role: 'user', content: userMessage },
    ])

    expect(firstResponse).toBeTruthy()
    expect(firstResponse.length).toBeGreaterThan(0)
    expect(firstResponse).toContain('---METADATA---')

    const firstMeta = parseMetadataFromResponse(firstResponse)
    expect(firstMeta).not.toBeNull()

    // classified_type may or may not be set on first turn
    const classifiedType = firstMeta?.classified_type as string | null
    expect(
      classifiedType === null || classifiedType === 'new_project'
    ).toBe(true)

    // ------------------------------------------------------------------
    // Step 2: If not classified yet, send a second turn
    // ------------------------------------------------------------------
    let conversationHistory: ChatMessage[] = [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: firstResponse },
    ]

    let finalClassifiedType = classifiedType

    if (!finalClassifiedType) {
      const secondUserMessage = '新規開発です。今のWordPressサイトは捨てて、ゼロからNext.jsで作り直したいです。予算は500万円くらいを考えています。3ヶ月以内にリリースしたいです。'
      const secondResponse = await sendMessage(systemPrompt, [
        ...conversationHistory,
        { role: 'user', content: secondUserMessage },
      ])

      expect(secondResponse).toContain('---METADATA---')
      const secondMeta = parseMetadataFromResponse(secondResponse)
      finalClassifiedType = secondMeta?.classified_type as string | null

      conversationHistory = [
        ...conversationHistory,
        { role: 'user', content: secondUserMessage },
        { role: 'assistant', content: secondResponse },
      ]
    }

    // ------------------------------------------------------------------
    // Step 3: Generate spec from conversation
    // ------------------------------------------------------------------
    const specPrompt = getSpecGenerationPrompt('new_project')
    const conversationContext = conversationHistory
      .map((m) => `${m.role === 'user' ? '顧客' : 'AI執事'}: ${m.content.split('---METADATA---')[0].trim()}`)
      .join('\n\n')

    const specMarkdown = await sendMessage(specPrompt, [
      { role: 'user', content: `以下の対話記録を基に文書を生成してください:\n\n${conversationContext}` },
    ], { temperature: 0.3, maxTokens: 4096 })

    expect(specMarkdown.length).toBeGreaterThan(50)
    expect(
      specMarkdown.includes('概要') || specMarkdown.includes('プロジェクト概要')
      || specMarkdown.includes('サイト') || specMarkdown.includes('リニューアル')
    ).toBe(true)
    expect(
      specMarkdown.includes('機能要件') || specMarkdown.includes('主要機能')
      || specMarkdown.includes('要件') || specMarkdown.includes('機能')
    ).toBe(true)

    // ------------------------------------------------------------------
    // Step 4: Classify business line
    // ------------------------------------------------------------------
    const classification = await classifyBusinessLine({
      specMarkdown,
      projectType: 'new_project',
    })

    expect(validLines).toContain(classification.businessLine)
    // WordPress/Next.js site could be boltsite or iotrealm
    expect(
      classification.businessLine === 'boltsite'
      || classification.businessLine === 'iotrealm'
    ).toBe(true)
    expect(classification.confidence).toBeGreaterThan(0.3)

    // ------------------------------------------------------------------
    // Step 5: Calculate pricing
    // ------------------------------------------------------------------
    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 4, durationMonths: 3, monthlyUnitPrice: 2_000_000 },
    })

    expect(pricing.ourPrice).toBeGreaterThan(0)
    expect(pricing.marketTotal).toBeGreaterThan(0)
    expect(pricing.marginPercent).toBeGreaterThan(0)

    // ------------------------------------------------------------------
    // Step 6: Evaluate go/no-go
    // ------------------------------------------------------------------
    const mockSupabase = createMockSupabase(2)
    const goNoGo = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-ec-renewal',
      projectType: 'new_project',
      businessLine: classification.businessLine,
      pricingResult: pricing,
      specMarkdown,
      riskFlags: pricing.riskFlags,
    })

    expect(
      goNoGo.decision === 'go' || goNoGo.decision === 'go_with_conditions'
    ).toBe(true)
    expect(goNoGo.overallScore).toBeGreaterThanOrEqual(40)
  }, 90_000)

  // -------------------------------------------------------------------------
  // Scenario 2: IoT Sensor Monitoring -- Complex New Project
  // -------------------------------------------------------------------------
  it('Scenario 2: IoT sensor monitoring (complex new_project) full journey', async () => {
    const validLines: BusinessLine[] = ['boltsite', 'iotrealm', 'tapforge']

    // ------------------------------------------------------------------
    // Step 1: Initial conversation with new_project prompt
    // ------------------------------------------------------------------
    const systemPrompt = getSystemPrompt('new_project')
    const userMessage = '工場の温度・湿度センサーのデータをリアルタイムで監視するシステムを作りたいです。Raspberry PiにMQTTセンサーを接続して、クラウドにデータを送信し、Webダッシュボードで可視化したいです。AIで異常検知もしたいです。過去に他社に外注して800万円かかった経験があります。来年4月までにリリースしたいです。'

    const firstResponse = await sendMessage(systemPrompt, [
      { role: 'user', content: userMessage },
    ])

    expect(firstResponse).toBeTruthy()
    expect(firstResponse.length).toBeGreaterThan(0)

    const conversationHistory: ChatMessage[] = [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: firstResponse },
    ]

    // ------------------------------------------------------------------
    // Step 2: Generate spec
    // ------------------------------------------------------------------
    const specPrompt = getSpecGenerationPrompt('new_project')
    const conversationContext = conversationHistory
      .map((m) => `${m.role === 'user' ? '顧客' : 'AI執事'}: ${m.content.split('---METADATA---')[0].trim()}`)
      .join('\n\n')

    const specMarkdown = await sendMessage(specPrompt, [
      { role: 'user', content: `以下の対話記録を基に文書を生成してください:\n\n${conversationContext}` },
    ], { temperature: 0.3, maxTokens: 4096 })

    expect(
      specMarkdown.includes('IoT')
      || specMarkdown.includes('センサー')
      || specMarkdown.includes('MQTT')
    ).toBe(true)
    // Should have technical requirements
    expect(
      specMarkdown.includes('技術')
      || specMarkdown.includes('要件')
      || specMarkdown.includes('アーキテクチャ')
    ).toBe(true)

    // ------------------------------------------------------------------
    // Step 3: Classify business line
    // ------------------------------------------------------------------
    const classification = await classifyBusinessLine({
      specMarkdown,
      projectType: 'new_project',
    })

    expect(validLines).toContain(classification.businessLine)
    expect(classification.businessLine).toBe('iotrealm')
    expect(classification.confidence).toBeGreaterThanOrEqual(0.3)

    // ------------------------------------------------------------------
    // Step 4: Calculate pricing
    // ------------------------------------------------------------------
    const policy = defaultPolicyFor('new_project')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 4, durationMonths: 6, monthlyUnitPrice: 2_500_000 },
    })

    expect(pricing.ourPrice).toBeGreaterThan(0)
    expect(pricing.marginPercent).toBeGreaterThan(0)

    // ------------------------------------------------------------------
    // Step 5: Go/No-Go evaluation
    // ------------------------------------------------------------------
    const mockSupabase = createMockSupabase(2)
    const goNoGo = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-iot-sensor',
      projectType: 'new_project',
      businessLine: classification.businessLine,
      pricingResult: pricing,
      specMarkdown,
      riskFlags: pricing.riskFlags,
    })

    expect(
      goNoGo.decision === 'go' || goNoGo.decision === 'go_with_conditions'
    ).toBe(true)

    // ------------------------------------------------------------------
    // Step 6: Generate value proposition
    // ------------------------------------------------------------------
    const valueProp = await generateValueProposition({
      specMarkdown,
      similarProjects: [],
      goNoGoResult: goNoGo,
      pricingResult: pricing,
      businessLine: classification.businessLine,
    })

    expect(valueProp.generatedMarkdown.length).toBeGreaterThan(100)
    // uniqueStrengths should contain IoT/iotrealm-related strengths
    expect(
      valueProp.uniqueStrengths.some(
        (s) =>
          s.includes('IoT')
          || s.includes('iotrealm')
          || s.includes('センサー')
          || s.includes('リアルタイム')
          || s.includes('組込み')
      )
    ).toBe(true)
    expect(valueProp.riskMitigations.length).toBeGreaterThan(0)
  }, 180_000)

  // -------------------------------------------------------------------------
  // Scenario 3: Bug Fix Request -- Genuine Bug
  // -------------------------------------------------------------------------
  it('Scenario 3: Bug fix request (bug_report) full journey', async () => {
    const validLines: BusinessLine[] = ['boltsite', 'iotrealm', 'tapforge']

    // ------------------------------------------------------------------
    // Step 1: Initial conversation with bug_report prompt
    // ------------------------------------------------------------------
    const systemPrompt = getSystemPrompt('bug_report')
    const userMessage = 'ログイン画面でメールアドレスを入力してパスワードを入れてもエラーになります。Chrome最新版で発生、Firefoxでは動きます。先週のデプロイ後から発生しています。50人くらいの社員が使っているので早急に対応お願いします。'

    const firstResponse = await sendMessage(systemPrompt, [
      { role: 'user', content: userMessage },
    ])

    expect(firstResponse).toBeTruthy()
    expect(firstResponse.length).toBeGreaterThan(0)

    const conversationHistory: ChatMessage[] = [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: firstResponse },
    ]

    // ------------------------------------------------------------------
    // Step 2: Generate spec (bug report)
    // ------------------------------------------------------------------
    const specPrompt = getSpecGenerationPrompt('bug_report')
    const conversationContext = conversationHistory
      .map((m) => `${m.role === 'user' ? '顧客' : 'AI執事'}: ${m.content.split('---METADATA---')[0].trim()}`)
      .join('\n\n')

    const specMarkdown = await sendMessage(specPrompt, [
      { role: 'user', content: `以下の対話記録を基に文書を生成してください:\n\n${conversationContext}` },
    ], { temperature: 0.3, maxTokens: 4096 })

    expect(
      specMarkdown.includes('再現手順')
      || specMarkdown.includes('再現')
      || specMarkdown.includes('環境')
      || specMarkdown.includes('ログイン')
      || specMarkdown.includes('エラー')
      || specMarkdown.includes('Chrome')
      || specMarkdown.includes('バグ')
    ).toBe(true)
    expect(
      specMarkdown.includes('影響範囲')
      || specMarkdown.includes('影響')
      || specMarkdown.includes('50人')
      || specMarkdown.includes('社員')
      || specMarkdown.includes('緊急')
    ).toBe(true)

    // ------------------------------------------------------------------
    // Step 3: Classify business line
    // ------------------------------------------------------------------
    const classification = await classifyBusinessLine({
      specMarkdown,
      projectType: 'bug_report',
    })

    // Bug reports are harder to classify; any valid line is acceptable
    expect(validLines).toContain(classification.businessLine)

    // ------------------------------------------------------------------
    // Step 4: Pricing (bug fix should be affordable)
    // ------------------------------------------------------------------
    const policy = defaultPolicyFor('bug_report')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 2, durationMonths: 1, monthlyUnitPrice: 2_000_000 },
    })

    // Bug fix pricing should be significantly lower than new project
    expect(pricing.ourPrice).toBeLessThanOrEqual(5_000_000)
    expect(pricing.ourPrice).toBeGreaterThan(0)

    // Bug report policy has lower minimums than new project
    const newProjectPolicy = defaultPolicyFor('new_project')
    expect(policy.minimumProjectFee).toBeLessThan(newProjectPolicy.minimumProjectFee)
  }, 120_000)

  // -------------------------------------------------------------------------
  // Scenario 4: Feature Addition to Existing System
  // -------------------------------------------------------------------------
  it('Scenario 4: Feature addition (AI report generation) full journey', async () => {
    const validLines: BusinessLine[] = ['boltsite', 'iotrealm', 'tapforge']

    // ------------------------------------------------------------------
    // Step 1: Initial conversation with feature_addition prompt
    // ------------------------------------------------------------------
    const systemPrompt = getSystemPrompt('feature_addition')
    const userMessage = '既存の社内ERPシステムにAI搭載のレポート自動生成機能を追加したいです。現在はReact+Node.jsで構築されています。月次の売上レポートをAIが自動生成して、Slackに通知する機能が欲しいです。予算は200万円程度、2ヶ月で実装してほしいです。'

    const firstResponse = await sendMessage(systemPrompt, [
      { role: 'user', content: userMessage },
    ])

    expect(firstResponse).toBeTruthy()
    expect(firstResponse.length).toBeGreaterThan(0)

    const conversationHistory: ChatMessage[] = [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: firstResponse },
    ]

    // ------------------------------------------------------------------
    // Step 2: Generate spec (feature addition)
    // ------------------------------------------------------------------
    const specPrompt = getSpecGenerationPrompt('feature_addition')
    const conversationContext = conversationHistory
      .map((m) => `${m.role === 'user' ? '顧客' : 'AI執事'}: ${m.content.split('---METADATA---')[0].trim()}`)
      .join('\n\n')

    const specMarkdown = await sendMessage(specPrompt, [
      { role: 'user', content: `以下の対話記録を基に文書を生成してください:\n\n${conversationContext}` },
    ], { temperature: 0.3, maxTokens: 4096 })

    expect(
      specMarkdown.includes('既存システム')
      || specMarkdown.includes('既存')
      || specMarkdown.includes('追加機能')
      || specMarkdown.includes('機能追加')
      || specMarkdown.includes('ERP')
      || specMarkdown.includes('レポート')
      || specMarkdown.includes('追加')
    ).toBe(true)
    expect(
      specMarkdown.includes('API')
      || specMarkdown.includes('データモデル')
      || specMarkdown.includes('データ')
      || specMarkdown.includes('インターフェース')
      || specMarkdown.includes('Slack')
      || specMarkdown.includes('AI')
    ).toBe(true)

    // ------------------------------------------------------------------
    // Step 3: Classify business line
    // ------------------------------------------------------------------
    const classification = await classifyBusinessLine({
      specMarkdown,
      projectType: 'feature_addition',
    })

    expect(validLines).toContain(classification.businessLine)
    // AI/custom development should be iotrealm
    expect(classification.businessLine).toBe('iotrealm')

    // ------------------------------------------------------------------
    // Step 4: Pricing (feature addition should be mid-range)
    // ------------------------------------------------------------------
    const policy = defaultPolicyFor('feature_addition')
    const pricing = calculatePrice({
      policy,
      market: { teamSize: 3, durationMonths: 2, monthlyUnitPrice: 2_000_000 },
    })

    expect(pricing.ourPrice).toBeGreaterThan(0)
    expect(pricing.marketTotal).toBeGreaterThan(0)

    // Feature addition pricing should be between bug fix and new project
    const bugPolicy = defaultPolicyFor('bug_report')
    expect(policy.minimumProjectFee).toBeGreaterThan(bugPolicy.minimumProjectFee)

    const newProjectPolicy = defaultPolicyFor('new_project')
    expect(policy.minimumProjectFee).toBeLessThanOrEqual(newProjectPolicy.minimumProjectFee)

    // ------------------------------------------------------------------
    // Step 5: Go/No-Go evaluation
    // ------------------------------------------------------------------
    const mockSupabase = createMockSupabase(2)
    const goNoGo = await evaluateGoNoGo({
      supabase: mockSupabase,
      projectId: 'test-feature-addition',
      projectType: 'feature_addition',
      businessLine: classification.businessLine,
      pricingResult: pricing,
      specMarkdown,
      riskFlags: pricing.riskFlags,
    })

    expect(['go', 'go_with_conditions', 'no_go']).toContain(goNoGo.decision)
    expect(goNoGo.overallScore).toBeGreaterThanOrEqual(0)
    expect(goNoGo.overallScore).toBeLessThanOrEqual(100)
  }, 90_000)
})
