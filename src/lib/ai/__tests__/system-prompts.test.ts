import { describe, it, expect } from 'vitest'
import { getSystemPrompt, getSpecGenerationPrompt, REQUIRED_CATEGORIES } from '@/lib/ai/system-prompts'
import type { ProjectType, ConcreteProjectType } from '@/types/database'

describe('REQUIRED_CATEGORIES', () => {
  it('has correct keys for all project types', () => {
    const keys = Object.keys(REQUIRED_CATEGORIES)
    expect(keys).toContain('new_project')
    expect(keys).toContain('bug_report')
    expect(keys).toContain('fix_request')
    expect(keys).toContain('feature_addition')
    expect(keys).toContain('undetermined')
  })

  it('new_project has 15 categories', () => {
    expect(REQUIRED_CATEGORIES.new_project).toHaveLength(15)
  })

  it('bug_report has 9 categories', () => {
    expect(REQUIRED_CATEGORIES.bug_report).toHaveLength(9)
  })

  it('fix_request has 8 categories', () => {
    expect(REQUIRED_CATEGORIES.fix_request).toHaveLength(8)
  })

  it('feature_addition has 11 categories', () => {
    expect(REQUIRED_CATEGORIES.feature_addition).toHaveLength(11)
  })

  it('undetermined has 0 categories', () => {
    expect(REQUIRED_CATEGORIES.undetermined).toHaveLength(0)
  })
})

describe('getSystemPrompt', () => {
  it('undetermined type returns classifier prompt with 4 project types listed', () => {
    const prompt = getSystemPrompt('undetermined')

    expect(prompt).toContain('new_project')
    expect(prompt).toContain('bug_report')
    expect(prompt).toContain('fix_request')
    expect(prompt).toContain('feature_addition')
    expect(prompt).toContain('4つのタイプ')
  })

  it('new_project type returns all 15 categories', () => {
    const prompt = getSystemPrompt('new_project')

    for (const category of REQUIRED_CATEGORIES.new_project) {
      expect(prompt).toContain(category)
    }
  })

  it('bug_report type returns 9 categories and pricing instructions', () => {
    const prompt = getSystemPrompt('bug_report')

    for (const category of REQUIRED_CATEGORIES.bug_report) {
      expect(prompt).toContain(category)
    }
    expect(prompt).toContain('希望修正完了日程')
  })

  it('fix_request type returns 8 categories and pricing instructions', () => {
    const prompt = getSystemPrompt('fix_request')

    for (const category of REQUIRED_CATEGORIES.fix_request) {
      expect(prompt).toContain(category)
    }
    expect(prompt).toContain('希望修正完了日程')
  })

  it('feature_addition type returns 11 categories', () => {
    const prompt = getSystemPrompt('feature_addition')

    for (const category of REQUIRED_CATEGORIES.feature_addition) {
      expect(prompt).toContain(category)
    }
  })

  it('all concrete types include BUTLER_PERSONA text', () => {
    const concreteTypes: ConcreteProjectType[] = [
      'new_project',
      'bug_report',
      'fix_request',
      'feature_addition',
    ]

    for (const type of concreteTypes) {
      const prompt = getSystemPrompt(type)
      expect(prompt).toContain('Benevolent Dictator')
      expect(prompt).toContain('AI 執事')
    }
  })

  it('undetermined type also includes BUTLER_PERSONA text', () => {
    const prompt = getSystemPrompt('undetermined')
    expect(prompt).toContain('Benevolent Dictator')
    expect(prompt).toContain('AI 執事')
  })

  it('all types include METADATA section instructions', () => {
    const allTypes: ProjectType[] = [
      'undetermined',
      'new_project',
      'bug_report',
      'fix_request',
      'feature_addition',
    ]

    for (const type of allTypes) {
      const prompt = getSystemPrompt(type)
      expect(prompt).toContain('---METADATA---')
    }
  })

  it('new_project prompt includes new pricing categories', () => {
    const prompt = getSystemPrompt('new_project')

    expect(prompt).toContain('予算・コスト感')
    expect(prompt).toContain('納期・リリース目標')
    expect(prompt).toContain('先端技術要否')
    expect(prompt).toContain('運用保守・継続開発')
    expect(prompt).toContain('市場規模・ターゲット')
  })

  it('bug_report prompt includes 希望修正完了日程', () => {
    const prompt = getSystemPrompt('bug_report')
    expect(prompt).toContain('希望修正完了日程')
  })

  it('feature_addition includes pricing-related categories', () => {
    const prompt = getSystemPrompt('feature_addition')
    expect(prompt).toContain('予算・コスト感')
    expect(prompt).toContain('納期・リリース目標')
    expect(prompt).toContain('先端技術要否')
  })
})

describe('getSpecGenerationPrompt', () => {
  it('returns correct template for new_project', () => {
    const prompt = getSpecGenerationPrompt('new_project')

    expect(prompt).toContain('要件定義書')
    expect(prompt).toContain('プロジェクト概要')
    expect(prompt).toContain('機能要件')
    expect(prompt).toContain('非機能要件')
    expect(prompt).toContain('データモデル')
  })

  it('returns correct template for bug_report', () => {
    const prompt = getSpecGenerationPrompt('bug_report')

    expect(prompt).toContain('バグレポート')
    expect(prompt).toContain('再現手順')
    expect(prompt).toContain('影響範囲')
    expect(prompt).toContain('推定原因')
  })

  it('returns correct template for fix_request', () => {
    const prompt = getSpecGenerationPrompt('fix_request')

    expect(prompt).toContain('修正仕様書')
    expect(prompt).toContain('現在の動作')
    expect(prompt).toContain('修正後の動作')
    expect(prompt).toContain('テスト条件')
  })

  it('returns correct template for feature_addition', () => {
    const prompt = getSpecGenerationPrompt('feature_addition')

    expect(prompt).toContain('機能追加仕様書')
    expect(prompt).toContain('ユーザーストーリー')
    expect(prompt).toContain('既存システム')
    expect(prompt).toContain('API変更')
  })

  it('undetermined falls back to new_project template', () => {
    const undeterminedPrompt = getSpecGenerationPrompt('undetermined')
    const newProjectPrompt = getSpecGenerationPrompt('new_project')

    expect(undeterminedPrompt).toContain('要件定義書')
    expect(undeterminedPrompt).toBe(newProjectPrompt)
  })

  it('all types include BUTLER_PERSONA in spec generation prompt', () => {
    const allTypes: ProjectType[] = [
      'undetermined',
      'new_project',
      'bug_report',
      'fix_request',
      'feature_addition',
    ]

    for (const type of allTypes) {
      const prompt = getSpecGenerationPrompt(type)
      expect(prompt).toContain('Benevolent Dictator')
    }
  })

  it('all types include quality instruction', () => {
    const allTypes: ProjectType[] = [
      'new_project',
      'bug_report',
      'fix_request',
      'feature_addition',
    ]

    for (const type of allTypes) {
      const prompt = getSpecGenerationPrompt(type)
      expect(prompt).toContain('[要確認]')
    }
  })
})
