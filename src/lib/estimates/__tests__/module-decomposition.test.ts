import { describe, it, expect, vi } from 'vitest'
import { generateImplementationPlan } from '@/lib/estimates/module-decomposition'

// Mock the AI module
vi.mock('@/lib/ai/anthropic', () => ({
  sendMessage: vi.fn(),
}))

// Mock parseJsonFromResponse to use the real implementation
vi.mock('@/lib/ai/xai', async () => {
  return {
    parseJsonFromResponse: <T>(text: string): T => {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]) as T
      }
      return JSON.parse(text) as T
    },
  }
})

import { sendMessage } from '@/lib/ai/anthropic'
const mockSendMessage = vi.mocked(sendMessage)

describe('generateImplementationPlan', () => {
  it('parses a valid implementation plan from Claude response', async () => {
    const mockResponse = JSON.stringify({
      modules: [
        {
          name: '認証システム',
          description: 'ログイン・認可機能',
          hours: { investigation: 4, implementation: 16, testing: 8 },
          totalHours: 28,
          dependencies: [],
          parallelTrack: 'A',
          riskLevel: 'low',
        },
        {
          name: 'DB設計',
          description: 'スキーマ設計とマイグレーション',
          hours: { investigation: 8, implementation: 12, testing: 4 },
          totalHours: 24,
          dependencies: [],
          parallelTrack: 'B',
          riskLevel: 'medium',
          riskReason: 'パフォーマンス要件が不明確',
        },
        {
          name: 'API層',
          description: 'RESTful API実装',
          hours: { investigation: 4, implementation: 20, testing: 10 },
          totalHours: 34,
          dependencies: ['DB設計', '認証システム'],
          parallelTrack: 'A',
          riskLevel: 'medium',
        },
      ],
      phases: [
        { name: 'Phase 1: Foundation', weekStart: 1, weekEnd: 2, modules: ['認証システム', 'DB設計'], parallelStreams: 2 },
        { name: 'Phase 2: Core', weekStart: 3, weekEnd: 5, modules: ['API層'], parallelStreams: 1 },
      ],
      criticalPath: ['DB設計', 'API層'],
      mvpModules: ['認証システム', 'DB設計', 'API層'],
      totalWeeks: 5,
      teamRecommendation: {
        optimalSize: 2,
        roles: ['フルスタックエンジニア', 'バックエンドエンジニア'],
        rationale: '少人数精鋭チーム推奨',
      },
    })

    mockSendMessage.mockResolvedValueOnce(`\`\`\`json\n${mockResponse}\n\`\`\``)

    const result = await generateImplementationPlan({
      specMarkdown: '# テスト仕様書\n勤怠管理SaaS',
      projectType: 'new_project',
    })

    expect(result.modules).toHaveLength(3)
    expect(result.modules[0].name).toBe('認証システム')
    expect(result.modules[0].parallelTrack).toBe('A')
    expect(result.modules[0].riskLevel).toBe('low')
    expect(result.modules[0].totalHours).toBe(28)
    expect(result.modules[2].dependencies).toContain('DB設計')
    expect(result.phases).toHaveLength(2)
    expect(result.criticalPath).toContain('API層')
    expect(result.mvpModules).toHaveLength(3)
    expect(result.totalWeeks).toBe(5)
    expect(result.teamRecommendation.optimalSize).toBe(2)
  })

  it('normalizes invalid parallel track to A', async () => {
    const mockResponse = JSON.stringify({
      modules: [{
        name: 'Test',
        description: '',
        hours: { investigation: 1, implementation: 2, testing: 1 },
        totalHours: 4,
        dependencies: [],
        parallelTrack: 'Z', // invalid
        riskLevel: 'low',
      }],
      phases: [],
      criticalPath: [],
      mvpModules: [],
      totalWeeks: 1,
      teamRecommendation: { optimalSize: 1, roles: [], rationale: '' },
    })

    mockSendMessage.mockResolvedValueOnce(`\`\`\`json\n${mockResponse}\n\`\`\``)

    const result = await generateImplementationPlan({
      specMarkdown: 'test',
      projectType: 'bug_report',
    })

    expect(result.modules[0].parallelTrack).toBe('A')
  })

  it('normalizes negative hours to zero', async () => {
    const mockResponse = JSON.stringify({
      modules: [{
        name: 'Test',
        description: '',
        hours: { investigation: -5, implementation: 10, testing: -2 },
        totalHours: 10,
        dependencies: [],
        parallelTrack: 'A',
        riskLevel: 'low',
      }],
      phases: [],
      criticalPath: [],
      mvpModules: [],
      totalWeeks: 1,
      teamRecommendation: { optimalSize: 1, roles: [], rationale: '' },
    })

    mockSendMessage.mockResolvedValueOnce(`\`\`\`json\n${mockResponse}\n\`\`\``)

    const result = await generateImplementationPlan({
      specMarkdown: 'test',
      projectType: 'feature_addition',
    })

    expect(result.modules[0].hours.investigation).toBe(0)
    expect(result.modules[0].hours.testing).toBe(0)
    expect(result.modules[0].hours.implementation).toBe(10)
    // totalHours should use the raw value since it's > 0
    expect(result.modules[0].totalHours).toBe(10)
  })

  it('handles empty/minimal response gracefully', async () => {
    mockSendMessage.mockResolvedValueOnce('{}')

    const result = await generateImplementationPlan({
      specMarkdown: 'test',
      projectType: 'new_project',
    })

    expect(result.modules).toHaveLength(0)
    expect(result.phases).toHaveLength(0)
    expect(result.totalWeeks).toBe(1) // minimum
    expect(result.teamRecommendation.optimalSize).toBe(2) // default
  })

  it('normalizes invalid risk level to medium', async () => {
    const mockResponse = JSON.stringify({
      modules: [{
        name: 'Test',
        description: '',
        hours: { investigation: 2, implementation: 4, testing: 2 },
        totalHours: 8,
        dependencies: [],
        parallelTrack: 'B',
        riskLevel: 'critical', // invalid
      }],
      phases: [],
      criticalPath: [],
      mvpModules: [],
      totalWeeks: 1,
      teamRecommendation: { optimalSize: 1, roles: [], rationale: '' },
    })

    mockSendMessage.mockResolvedValueOnce(`\`\`\`json\n${mockResponse}\n\`\`\``)

    const result = await generateImplementationPlan({
      specMarkdown: 'test',
      projectType: 'new_project',
    })

    expect(result.modules[0].riskLevel).toBe('medium')
  })

  it('uses computed total when rawTotal is zero', async () => {
    const mockResponse = JSON.stringify({
      modules: [{
        name: 'Test',
        description: '',
        hours: { investigation: 3, implementation: 5, testing: 2 },
        totalHours: 0,
        dependencies: [],
        parallelTrack: 'A',
        riskLevel: 'low',
      }],
      phases: [],
      criticalPath: [],
      mvpModules: [],
      totalWeeks: 1,
      teamRecommendation: { optimalSize: 1, roles: [], rationale: '' },
    })

    mockSendMessage.mockResolvedValueOnce(`\`\`\`json\n${mockResponse}\n\`\`\``)

    const result = await generateImplementationPlan({
      specMarkdown: 'test',
      projectType: 'new_project',
    })

    // totalHours = 0 (raw) -> uses computed: 3 + 5 + 2 = 10
    expect(result.modules[0].totalHours).toBe(10)
  })

  it('defaults module name to Unknown Module when missing', async () => {
    const mockResponse = JSON.stringify({
      modules: [{
        description: 'no name module',
        hours: { investigation: 1, implementation: 2, testing: 1 },
        totalHours: 4,
        dependencies: [],
        parallelTrack: 'A',
        riskLevel: 'low',
      }],
      phases: [],
      criticalPath: [],
      mvpModules: [],
      totalWeeks: 1,
      teamRecommendation: { optimalSize: 1, roles: [], rationale: '' },
    })

    mockSendMessage.mockResolvedValueOnce(`\`\`\`json\n${mockResponse}\n\`\`\``)

    const result = await generateImplementationPlan({
      specMarkdown: 'test',
      projectType: 'new_project',
    })

    expect(result.modules[0].name).toBe('Unknown Module')
  })

  it('defaults team recommendation when missing', async () => {
    const mockResponse = JSON.stringify({
      modules: [],
      phases: [],
      criticalPath: [],
      mvpModules: [],
      totalWeeks: 3,
    })

    mockSendMessage.mockResolvedValueOnce(`\`\`\`json\n${mockResponse}\n\`\`\``)

    const result = await generateImplementationPlan({
      specMarkdown: 'test',
      projectType: 'new_project',
    })

    expect(result.teamRecommendation.optimalSize).toBe(2)
    expect(result.teamRecommendation.roles).toEqual(['フルスタックエンジニア'])
    expect(result.teamRecommendation.rationale).toBe('')
  })

  it('passes correct options to sendMessage', async () => {
    mockSendMessage.mockResolvedValueOnce('{}')

    await generateImplementationPlan({
      specMarkdown: 'test spec',
      projectType: 'new_project',
      usageContext: { projectId: 'proj-1', actorClerkUserId: 'user-1' },
    })

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.stringContaining('シニアソフトウェアアーキテクト'),
      expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
      ]),
      expect.objectContaining({
        temperature: 0.3,
        maxTokens: 4096,
        usageContext: { projectId: 'proj-1', actorClerkUserId: 'user-1' },
      })
    )
  })
})
