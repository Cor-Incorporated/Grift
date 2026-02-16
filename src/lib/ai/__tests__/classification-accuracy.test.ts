import { describe, it, expect } from 'vitest'
import { getSystemPrompt } from '@/lib/ai/system-prompts'

describe('classification accuracy: system prompt contains strict criteria', () => {
  it('undetermined system prompt includes bug vs feature distinction', () => {
    const prompt = getSystemPrompt('undetermined')
    expect(prompt).toContain('バグ報告と機能追加の厳密判定基準')
    expect(prompt).toContain('bug_report と判定')
    expect(prompt).toContain('feature_addition と判定')
    expect(prompt).toContain('判断に迷う場合の掘り下げ質問')
    expect(prompt).toContain('分類の重要性')
  })

  it('bug_report prompt includes repo URL guidance', () => {
    const prompt = getSystemPrompt('bug_report')
    expect(prompt).toContain('リポジトリURL')
    expect(prompt).toContain('再現手順')
  })

  it('feature_addition prompt includes existing system context', () => {
    const prompt = getSystemPrompt('feature_addition')
    expect(prompt).toContain('既存システム')
    expect(prompt).toContain('依存関係')
  })

  it('classification criteria mentions cost implications', () => {
    const prompt = getSystemPrompt('undetermined')
    expect(prompt).toContain('工数のみ')
    expect(prompt).toContain('金額見積り')
  })
})
