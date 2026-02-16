import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the AI modules before importing
vi.mock('@/lib/ai/anthropic', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/lib/ai/xai', () => ({
  parseJsonFromResponse: vi.fn(),
}))

import { classifyBusinessLine } from '../classifier'
import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'

const mockSendMessage = vi.mocked(sendMessage)
const mockParseJson = vi.mocked(parseJsonFromResponse)

describe('classifyBusinessLine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('keyword pre-screening', () => {
    it('should classify NFC-related specs as tapforge', async () => {
      const result = await classifyBusinessLine({
        specMarkdown: 'NFC対応のデジタル名刺アプリを開発したい',
        projectType: 'new_project',
      })

      expect(result.businessLine).toBe('tapforge')
      expect(result.confidence).toBeGreaterThan(0.3)
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should classify CMS/LP specs as boltsite when enough keywords match', async () => {
      // 5 keywords: ホスティング, cms, lp, ランディングページ, wordpress, コーポレートサイト
      const result = await classifyBusinessLine({
        specMarkdown: 'CMSベースのコーポレートサイトをWordPressでホスティングしたLP制作とランディングページ構築',
        projectType: 'new_project',
      })

      expect(result.businessLine).toBe('boltsite')
      expect(result.confidence).toBeGreaterThan(0.3)
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should classify AI/ML specs as iotrealm when enough keywords match', async () => {
      // 5 keywords: ai, ml, 機械学習, iot, saas, カスタム開発
      const result = await classifyBusinessLine({
        specMarkdown: 'AIとMLを活用した機械学習ベースのIoT対応SaaSプラットフォーム',
        projectType: 'new_project',
      })

      expect(result.businessLine).toBe('iotrealm')
      expect(result.confidence).toBeGreaterThan(0.3)
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should fallback to AI when keyword score is below threshold', async () => {
      mockSendMessage.mockResolvedValue('{"businessLine":"boltsite","confidence":0.8,"reasoning":"test"}')
      mockParseJson.mockReturnValue({
        businessLine: 'boltsite',
        confidence: 0.8,
        reasoning: 'Web制作案件のため',
      })

      const result = await classifyBusinessLine({
        specMarkdown: 'コーポレートサイトのランディングページを制作',
        projectType: 'new_project',
      })

      expect(result.businessLine).toBe('boltsite')
      expect(mockSendMessage).toHaveBeenCalledOnce()
    })
  })

  describe('AI classification', () => {
    it('should use Claude API when keywords are insufficient', async () => {
      mockSendMessage.mockResolvedValue('{"businessLine":"iotrealm","confidence":0.8,"reasoning":"test"}')
      mockParseJson.mockReturnValue({
        businessLine: 'iotrealm',
        confidence: 0.8,
        reasoning: 'カスタム開発案件のため',
      })

      const result = await classifyBusinessLine({
        specMarkdown: '在庫管理システムのカスタム開発',
        projectType: 'new_project',
      })

      expect(result.businessLine).toBe('iotrealm')
      expect(mockSendMessage).toHaveBeenCalledOnce()
    })

    it('should fallback to iotrealm on AI error', async () => {
      mockSendMessage.mockRejectedValue(new Error('API Error'))

      const result = await classifyBusinessLine({
        specMarkdown: 'あいまいな案件の説明',
        projectType: 'new_project',
      })

      expect(result.businessLine).toBe('iotrealm')
      expect(result.confidence).toBeLessThanOrEqual(0.4)
    })

    it('should validate business line value', async () => {
      mockSendMessage.mockResolvedValue('{"businessLine":"invalid","confidence":0.5,"reasoning":"test"}')
      mockParseJson.mockReturnValue({
        businessLine: 'invalid',
        confidence: 0.5,
        reasoning: 'test',
      })

      const result = await classifyBusinessLine({
        specMarkdown: 'テスト案件',
        projectType: 'new_project',
      })

      expect(result.businessLine).toBe('iotrealm')
    })
  })

  describe('with techStack and attachmentContext', () => {
    it('should include techStack in classification context', async () => {
      // NFC + デジタル名刺 + タップフォージ = 3/6 = 0.5 >= threshold
      const result = await classifyBusinessLine({
        specMarkdown: 'NFC対応のデジタル名刺',
        projectType: 'new_project',
        techStack: ['React Native', 'タップフォージ'],
      })

      expect(result.businessLine).toBe('tapforge')
      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should pass techStack to AI when keyword threshold not met', async () => {
      mockSendMessage.mockResolvedValue('{"businessLine":"tapforge","confidence":0.7,"reasoning":"NFC tech"}')
      mockParseJson.mockReturnValue({
        businessLine: 'tapforge',
        confidence: 0.7,
        reasoning: 'NFC tech',
      })

      const result = await classifyBusinessLine({
        specMarkdown: 'モバイルアプリ開発',
        projectType: 'new_project',
        techStack: ['React Native', 'NFC'],
      })

      expect(result.businessLine).toBe('tapforge')
      expect(mockSendMessage).toHaveBeenCalledOnce()
    })
  })
})
