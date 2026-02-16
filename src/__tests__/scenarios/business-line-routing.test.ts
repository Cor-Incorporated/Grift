import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/anthropic', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/lib/ai/xai', () => ({
  parseJsonFromResponse: vi.fn(),
}))

import { classifyBusinessLine } from '@/lib/business-line/classifier'
import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import { REQUIRED_CATEGORIES } from '@/lib/ai/system-prompts'

const mockSendMessage = vi.mocked(sendMessage)
const mockParseJson = vi.mocked(parseJsonFromResponse)

function setupAiResponse(businessLine: string, confidence: number, reasoning: string) {
  const response = JSON.stringify({ businessLine, confidence, reasoning })
  mockSendMessage.mockResolvedValue(response)
  mockParseJson.mockReturnValue({ businessLine, confidence, reasoning })
}

describe('Business Line Routing Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Scenario 1: NFC 名刺アプリ → tapforge
  // -------------------------------------------------------------------------
  it('Scenario 1: NFC名刺アプリ → tapforge (keyword hit)', async () => {
    const result = await classifyBusinessLine({
      specMarkdown: 'NFCを使ったデジタル名刺交換アプリを開発したい',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('tapforge')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(result.reasoning).toContain('tapforge')
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 2: コーポレートサイト → boltsite
  // -------------------------------------------------------------------------
  it('Scenario 2: コーポレートサイト → boltsite (keyword hit)', async () => {
    // boltsite keywords (9): ホスティング, cms, lp, ランディングページ, boltsite, ボルトサイト, wordpress, コーポレートサイト, 静的サイト
    // Need >= 5 hits for score >= 0.5
    const result = await classifyBusinessLine({
      specMarkdown: 'WordPress製のコーポレートサイトをリニューアルしたい。CMSでホスティング含めたLP制作も。ランディングページも対応。',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('boltsite')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 3: ランディングページ → boltsite
  // -------------------------------------------------------------------------
  it('Scenario 3: ランディングページ → boltsite (keyword hit)', async () => {
    // boltsite: 'lp', 'ランディングページ', 'cms', 'コーポレートサイト', 'wordpress' = 5/9 >= 0.5
    const result = await classifyBusinessLine({
      specMarkdown: '新商品のLPを作成してほしい。ランディングページのデザインからCMS構築まで。WordPressベースのコーポレートサイトも検討。',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('boltsite')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 4: IoTセンサー → iotrealm
  // -------------------------------------------------------------------------
  it('Scenario 4: IoTセンサー → iotrealm (keyword hit)', async () => {
    // iotrealm keywords (9): ai, ml, 機械学習, iot, iotrealm, ディープラーニング, カスタム開発, saas, スクラッチ開発
    // Need >= 5 for score >= 0.5
    const result = await classifyBusinessLine({
      specMarkdown: '工場のIoTセンサーデータ収集システムをカスタム開発したい。AIとMLを活用した機械学習による異常検知もスクラッチ開発で。',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 5: AIチャットボット → iotrealm
  // -------------------------------------------------------------------------
  it('Scenario 5: AIチャットボット → iotrealm (keyword hit)', async () => {
    // iotrealm: 'ai', 'ml', '機械学習', 'カスタム開発', 'saas' = 5/9 >= 0.5
    const result = await classifyBusinessLine({
      specMarkdown: 'AIとMLを使った機械学習チャットボットのカスタム開発。SaaS形式で提供したい。',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 6: SaaS開発 → iotrealm
  // -------------------------------------------------------------------------
  it('Scenario 6: SaaS開発 → iotrealm (keyword hit)', async () => {
    // iotrealm: 'saas', 'スクラッチ開発', '機械学習', 'ai', 'カスタム開発' = 5/9 >= 0.5
    const result = await classifyBusinessLine({
      specMarkdown: 'BtoB向けのSaaSプラットフォーム開発。スクラッチ開発でAI機械学習機能搭載のカスタム開発。',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 7: モバイルアプリ → iotrealm (via AI)
  // -------------------------------------------------------------------------
  it('Scenario 7: モバイルアプリ → iotrealm (AI fallback)', async () => {
    setupAiResponse('iotrealm', 0.85, 'React Nativeクロスプラットフォーム開発はカスタム開発案件')

    const result = await classifyBusinessLine({
      specMarkdown: 'React Nativeでクロスプラットフォームアプリを開発したい',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(mockSendMessage).toHaveBeenCalledOnce()
  })

  // -------------------------------------------------------------------------
  // Scenario 8: CMS構築 → boltsite
  // -------------------------------------------------------------------------
  it('Scenario 8: CMS構築 → boltsite (keyword hit)', async () => {
    // boltsite: 'cms', 'wordpress', 'ホスティング', 'コーポレートサイト', 'lp' = 5/9 >= 0.5
    const result = await classifyBusinessLine({
      specMarkdown: 'CMSベースのECサイトを構築。WordPressでホスティングも含めて。コーポレートサイトのLP部分も。',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('boltsite')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 9: 曖昧な案件 → iotrealm (fallback)
  // -------------------------------------------------------------------------
  it('Scenario 9: 曖昧な案件 → iotrealm (AI fallback to default)', async () => {
    setupAiResponse('iotrealm', 0.6, '明確な分類ができないためデフォルト')

    const result = await classifyBusinessLine({
      specMarkdown: '業務改善システムの開発',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(mockSendMessage).toHaveBeenCalledOnce()
  })

  // -------------------------------------------------------------------------
  // Scenario 10: 複数キーワード混在 — keyword score comparison
  // -------------------------------------------------------------------------
  it('Scenario 10: 複数キーワード混在 → best score wins', async () => {
    // "NFCタグ読み取り機能付きのWebアプリ"
    // tapforge keywords: 'nfc' → 1/6 = 0.167
    // boltsite keywords: none directly hit
    // iotrealm keywords: none directly hit
    // Score < 0.5, so falls to AI
    setupAiResponse('tapforge', 0.75, 'NFC機能が主要であるためtapforgeと判定')

    const result = await classifyBusinessLine({
      specMarkdown: 'NFCタグ読み取り機能付きのWebアプリ',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('tapforge')
    expect(mockSendMessage).toHaveBeenCalledOnce()
  })

  it('Scenario 10b: 複数事業ライン高スコア → 最もスコアの高いラインが選択される', async () => {
    // tapforge: 'nfc', '名刺', 'デジタル名刺' = 3/6 = 0.5 → threshold met
    // boltsite: 'ランディングページ' = 1/9 = 0.111
    // tapforge score > boltsite score, so tapforge wins via keyword screening
    const result = await classifyBusinessLine({
      specMarkdown: 'NFC名刺のデジタル名刺交換ランディングページ',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('tapforge')
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Scenario 11: techStack supplement → AI classification
  // -------------------------------------------------------------------------
  it('Scenario 11: techStack supplement で AI 判定に影響', async () => {
    // specMarkdown alone: no strong keywords
    // techStack includes 'Next.js', 'Supabase' — not IoT-specific
    // Falls to AI classification
    setupAiResponse('boltsite', 0.8, 'Next.js/Supabase構成のWeb開発はBoltSite')

    const result = await classifyBusinessLine({
      specMarkdown: 'Webアプリケーションを開発したい',
      projectType: 'new_project',
      techStack: ['Next.js', 'Supabase'],
    })

    expect(result.businessLine).toBe('boltsite')
    expect(mockSendMessage).toHaveBeenCalledOnce()
    // Verify techStack is included in the combined text sent to AI
    const callArgs = mockSendMessage.mock.calls[0]
    const messages = callArgs[1]
    expect(messages[0].content).toContain('Next.js')
    expect(messages[0].content).toContain('Supabase')
  })

  // -------------------------------------------------------------------------
  // Scenario 12: attachmentContext influence
  // -------------------------------------------------------------------------
  it('Scenario 12: attachmentContext に IoT 情報 → iotrealm', async () => {
    // spec alone: 'コーポレートサイト' → boltsite keyword 1/9
    // attachmentContext: IoT, センサー → iotrealm keywords 'iot' + 'カスタム開発' = 2/7
    // Both below 0.5 → goes to AI. AI returns iotrealm because attachment shows IoT
    setupAiResponse('iotrealm', 0.85, '添付資料にIoTシステム構成図があり、IoTRealm案件')

    const result = await classifyBusinessLine({
      specMarkdown: '既存のコーポレートサイトに機能追加',
      projectType: 'feature_addition',
      attachmentContext: 'IoTセンサーネットワーク構成図: 温湿度センサー→MQTT→ゲートウェイ→クラウド。カスタム開発が必要。',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(mockSendMessage).toHaveBeenCalledOnce()
  })

  it('Scenario 12b: attachmentContext で keyword 閾値を超える場合', async () => {
    // spec: 'サイト' — no match
    // attachmentContext: 'IoT' + 'ML' + 'AI' + 'SaaS' + 'カスタム開発' → iotrealm 5/7 = 0.71 >= 0.5
    const result = await classifyBusinessLine({
      specMarkdown: 'システム開発',
      projectType: 'new_project',
      attachmentContext: 'IoTデバイスのMLモデルをAIで最適化するSaaSのカスタム開発',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Additional edge case scenarios
  // -------------------------------------------------------------------------
  it('Scenario 13: AI が不正な businessLine を返した場合 → iotrealm fallback', async () => {
    setupAiResponse('unknown_line', 0.9, '不正な事業ライン')

    const result = await classifyBusinessLine({
      specMarkdown: '何かのシステム開発',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('iotrealm')
  })

  it('Scenario 14: AI エラー + キーワード低スコアの場合 → キーワード結果で fallback', async () => {
    mockSendMessage.mockRejectedValue(new Error('API Timeout'))

    // 'cms' = 1/9 = 0.11 < 0.5 → goes to AI → AI fails → fallback with keyword result
    const result = await classifyBusinessLine({
      specMarkdown: 'CMSシステムの相談',
      projectType: 'new_project',
    })

    // When AI fails and there's a keyword match (even low), it uses the keyword line
    expect(result.businessLine).toBe('boltsite')
    expect(result.confidence).toBe(0.4)
  })

  it('Scenario 15: AI エラー + キーワードなしの場合 → iotrealm with low confidence', async () => {
    mockSendMessage.mockRejectedValue(new Error('API Error'))

    const result = await classifyBusinessLine({
      specMarkdown: '特に具体的な内容なし',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(result.confidence).toBe(0.3)
  })

  // -------------------------------------------------------------------------
  // REQUIRED_CATEGORIES verification
  // -------------------------------------------------------------------------
  describe('REQUIRED_CATEGORIES 整合性', () => {
    it('new_project には予算・スケジュール・先端技術等のカテゴリが含まれる', () => {
      const categories = REQUIRED_CATEGORIES.new_project
      expect(categories).toContain('プロジェクト概要')
      expect(categories).toContain('ターゲットユーザー')
      expect(categories).toContain('主要機能')
      expect(categories).toContain('技術要件')
      expect(categories).toContain('予算・コスト感')
      expect(categories).toContain('納期・リリース目標')
      expect(categories).toContain('先端技術要否')
      expect(categories).toContain('運用保守・継続開発')
      expect(categories).toContain('市場規模・ターゲット')
      expect(categories.length).toBeGreaterThanOrEqual(10)
    })

    it('bug_report には再現手順・緊急度等のカテゴリが含まれる', () => {
      const categories = REQUIRED_CATEGORIES.bug_report
      expect(categories).toContain('バグの概要')
      expect(categories).toContain('再現手順')
      expect(categories).toContain('期待動作')
      expect(categories).toContain('実際の動作')
      expect(categories).toContain('緊急度')
      expect(categories.length).toBeGreaterThanOrEqual(5)
    })

    it('fix_request には対象機能・テスト条件等のカテゴリが含まれる', () => {
      const categories = REQUIRED_CATEGORIES.fix_request
      expect(categories).toContain('対象機能')
      expect(categories).toContain('現在の動作')
      expect(categories).toContain('期待する修正後の動作')
      expect(categories).toContain('テスト条件')
      expect(categories.length).toBeGreaterThanOrEqual(5)
    })

    it('feature_addition にはユーザーストーリー・依存関係等のカテゴリが含まれる', () => {
      const categories = REQUIRED_CATEGORIES.feature_addition
      expect(categories).toContain('追加機能の概要')
      expect(categories).toContain('ユーザーストーリー')
      expect(categories).toContain('既存機能との依存関係')
      expect(categories).toContain('予算・コスト感')
      expect(categories).toContain('先端技術要否')
      expect(categories.length).toBeGreaterThanOrEqual(5)
    })

    it('undetermined は空配列', () => {
      expect(REQUIRED_CATEGORIES.undetermined).toEqual([])
    })

    it('すべての ProjectType に対応するカテゴリが定義されている', () => {
      const allTypes = ['new_project', 'bug_report', 'fix_request', 'feature_addition', 'undetermined'] as const
      for (const type of allTypes) {
        expect(REQUIRED_CATEGORIES).toHaveProperty(type)
        expect(Array.isArray(REQUIRED_CATEGORIES[type])).toBe(true)
      }
    })
  })
})
