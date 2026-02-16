// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { classifyBusinessLine } from '@/lib/business-line/classifier'
import type { BusinessLine } from '@/types/database'

describe.runIf(!!process.env.ANTHROPIC_API_KEY)('Business Line Classifier - Live API', () => {
  it('should classify EC site renewal as boltsite', async () => {
    const result = await classifyBusinessLine({
      specMarkdown: 'WordPressベースのECサイトをリニューアルしたい。レスポンシブデザインで。',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('boltsite')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.reasoning.length).toBeGreaterThan(0)
  }, 30000)

  it('should classify IoT smart home system as iotrealm', async () => {
    const result = await classifyBusinessLine({
      specMarkdown: 'Raspberry PiとMQTTを使ったスマートホームシステムを開発したい',
      projectType: 'new_project',
    })

    expect(result.businessLine).toBe('iotrealm')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.reasoning.length).toBeGreaterThan(0)
  }, 30000)

  it('should classify NFC digital business card as tapforge via keyword pre-screening', async () => {
    const result = await classifyBusinessLine({
      specMarkdown: 'iPhoneのNFCを使ったデジタル名刺アプリケーション',
      projectType: 'new_project',
    })

    // NFC + 名刺 + デジタル名刺 = keyword match >= 0.5 threshold
    // Should be resolved by keyword pre-screening without calling the API
    expect(result.businessLine).toBe('tapforge')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.reasoning).toContain('キーワード')
  }, 30000)

  it('should classify ambiguous attendance management project as a valid business line', async () => {
    const result = await classifyBusinessLine({
      specMarkdown: '社内の勤怠管理をデジタル化したい',
      projectType: 'new_project',
    })

    const validLines: BusinessLine[] = ['boltsite', 'iotrealm', 'tapforge']
    expect(validLines).toContain(result.businessLine)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.reasoning.length).toBeGreaterThan(0)
  }, 30000)

  it('should return confidence between 0 and 1 for all classifications', async () => {
    const inputs = [
      { specMarkdown: 'モバイルアプリでリアルタイムチャット機能を実装', projectType: 'new_project' as const },
      { specMarkdown: 'Webサイトのバグ修正をお願いしたい', projectType: 'bug_report' as const },
      { specMarkdown: '既存の管理画面に新しいダッシュボード機能を追加', projectType: 'feature_addition' as const },
    ]

    const results = await Promise.all(
      inputs.map((input) => classifyBusinessLine(input))
    )

    for (const result of results) {
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
      expect(result.businessLine).toMatch(/^(boltsite|iotrealm|tapforge)$/)
      expect(result.reasoning.length).toBeGreaterThan(0)
    }
  }, 30000)
})
