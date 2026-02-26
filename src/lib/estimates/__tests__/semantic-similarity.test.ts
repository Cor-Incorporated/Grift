import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findSimilarProjectsSemantic } from '../semantic-similarity'
import { requestXaiResponse, parseJsonFromResponse } from '@/lib/ai/xai'

vi.mock('@/lib/ai/xai', () => ({
  requestXaiResponse: vi.fn(),
  parseJsonFromResponse: vi.fn(),
}))

const mockRequestXaiResponse = vi.mocked(requestXaiResponse)
const mockParseJsonFromResponse = vi.mocked(parseJsonFromResponse)

const defaultProfile = {
  techStack: ['Next.js', 'TypeScript', 'PostgreSQL'],
  domain: ['eコマース', 'SaaS'],
  complexityTier: 'medium' as const,
  integrations: ['Stripe'],
  projectNature: 'ECプラットフォームの構築',
}

function createMockSupabase(refs: Record<string, unknown>[] = [], error: unknown = null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: error ? null : refs,
              error: error ?? null,
            }),
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof findSimilarProjectsSemantic>[0]['supabase']
}

const sampleRefs = [
  {
    id: 'ref-1',
    org_name: 'cor-inc',
    repo_name: 'ecommerce-platform',
    full_name: 'cor-inc/ecommerce-platform',
    description: 'EC platform built with Next.js and Stripe',
    language: 'TypeScript',
    tech_stack: ['Next.js', 'TypeScript', 'PostgreSQL', 'Stripe'],
    project_type: 'new_project',
    topics: ['ecommerce', 'nextjs', 'typescript'],
    hours_spent: 200,
    analysis_result: { estimatedComplexity: 'medium', keyModules: ['cart', 'checkout'] },
  },
  {
    id: 'ref-2',
    org_name: 'cor-inc',
    repo_name: 'iot-dashboard',
    full_name: 'cor-inc/iot-dashboard',
    description: 'IoT sensor monitoring dashboard',
    language: 'Python',
    tech_stack: ['Python', 'FastAPI', 'React', 'MQTT'],
    project_type: 'new_project',
    topics: ['iot', 'dashboard', 'mqtt'],
    hours_spent: 150,
    analysis_result: { estimatedComplexity: 'complex' },
  },
  {
    id: 'ref-3',
    org_name: 'cor-inc',
    repo_name: 'corporate-site',
    full_name: 'cor-inc/corporate-site',
    description: 'Corporate website with CMS',
    language: 'TypeScript',
    tech_stack: ['Next.js', 'Tailwind', 'WordPress'],
    project_type: 'new_project',
    topics: ['cms', 'corporate', 'wordpress'],
    hours_spent: 80,
    analysis_result: { estimatedComplexity: 'simple' },
  },
]

describe('findSimilarProjectsSemantic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestXaiResponse.mockResolvedValue({
      text: JSON.stringify(defaultProfile),
      citations: [],
      usage: { inputTokens: 100, outputTokens: 50 },
      raw: {},
    })
    mockParseJsonFromResponse.mockReturnValue(defaultProfile)
  })

  it('full flow: Grok returns profile, DB returns repos, sorted results returned', async () => {
    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'Next.jsとTypeScriptでECサイトを構築。Stripe決済統合。',
      projectType: 'new_project',
    })

    expect(mockRequestXaiResponse).toHaveBeenCalledOnce()
    expect(result.length).toBeGreaterThan(0)
    // ecommerce-platform should score highest due to tech stack + integrations overlap
    expect(result[0].repoFullName).toBe('cor-inc/ecommerce-platform')
    expect(result[0].matchScore).toBeGreaterThan(0.1)
    expect(result[0].matchReasons.length).toBeGreaterThan(0)
    // Results must be sorted descending by score
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].matchScore).toBeGreaterThanOrEqual(result[i].matchScore)
    }
  })

  it('Grok failure returns empty array', async () => {
    mockRequestXaiResponse.mockRejectedValueOnce(new Error('xAI API error'))

    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'Next.jsプロジェクト',
      projectType: 'new_project',
    })

    expect(result).toEqual([])
  })

  it('no showcase repos returns empty array', async () => {
    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase([]),
      specMarkdown: 'Next.jsプロジェクト',
      projectType: 'new_project',
    })

    expect(result).toEqual([])
  })

  it('scoring: techStack overlap gives highest contribution', async () => {
    const techHeavyProfile = {
      techStack: ['Next.js', 'TypeScript', 'PostgreSQL', 'Stripe'],
      domain: ['その他'],
      complexityTier: 'medium' as const,
      integrations: [],
      projectNature: 'テスト',
    }
    mockParseJsonFromResponse.mockReturnValue(techHeavyProfile)

    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'テスト仕様',
      projectType: 'new_project',
    })

    expect(result.length).toBeGreaterThan(0)
    // ecommerce-platform has all 4 tech stack items matched
    const ecMatch = result.find((r) => r.repoFullName === 'cor-inc/ecommerce-platform')
    expect(ecMatch).toBeDefined()
    expect(ecMatch!.matchReasons.some((r) => r.includes('技術スタック'))).toBe(true)
  })

  it('scoring: analysis_result data improves matching', async () => {
    const complexProfile = {
      techStack: ['Python', 'FastAPI', 'React'],
      domain: ['IoT'],
      complexityTier: 'complex' as const,
      integrations: ['MQTT'],
      projectNature: 'IoTセンサー監視',
    }
    mockParseJsonFromResponse.mockReturnValue(complexProfile)

    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'IoTダッシュボード',
      projectType: 'new_project',
    })

    const iotMatch = result.find((r) => r.repoFullName === 'cor-inc/iot-dashboard')
    expect(iotMatch).toBeDefined()
    // complexity match from analysis_result should add to score
    expect(iotMatch!.matchReasons.some((r) => r.includes('複雑さ'))).toBe(true)
  })

  it('limit parameter restricts result count', async () => {
    const broadProfile = {
      techStack: ['Next.js', 'TypeScript', 'Python', 'FastAPI'],
      domain: ['eコマース', 'IoT'],
      complexityTier: 'medium' as const,
      integrations: ['Stripe', 'MQTT'],
      projectNature: '複数領域プロジェクト',
    }
    mockParseJsonFromResponse.mockReturnValue(broadProfile)

    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: '複数技術を使うプロジェクト',
      projectType: 'new_project',
      limit: 2,
    })

    expect(result.length).toBeLessThanOrEqual(2)
  })

  it('attachmentContext is included in the profile extraction prompt', async () => {
    await findSimilarProjectsSemantic({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: '仕様書',
      projectType: 'new_project',
      attachmentContext: 'IoT MQTT sensor monitoring platform with Stripe billing',
    })

    expect(mockRequestXaiResponse).toHaveBeenCalledOnce()
    const callArgs = mockRequestXaiResponse.mock.calls[0]
    const messages = callArgs[0]
    const userMessage = messages.find((m) => m.role === 'user')
    expect(userMessage).toBeDefined()
    expect(userMessage!.content).toContain('IoT MQTT sensor monitoring platform with Stripe billing')
  })

  it('JSON parse failure from Grok returns empty array', async () => {
    mockParseJsonFromResponse.mockImplementationOnce(() => {
      throw new SyntaxError('No valid JSON found')
    })

    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'プロジェクト仕様',
      projectType: 'new_project',
    })

    expect(result).toEqual([])
  })

  it('database error returns empty array', async () => {
    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase([], { message: 'DB connection failed' }),
      specMarkdown: 'Next.jsプロジェクト',
      projectType: 'new_project',
    })

    expect(result).toEqual([])
  })

  it('repos with score <= 0.1 are filtered out', async () => {
    const unmatchedProfile = {
      techStack: ['Ruby', 'Rails'],
      domain: ['FinTech'],
      complexityTier: 'simple' as const,
      integrations: ['PayPal'],
      projectNature: 'Rubyで作るFinTechアプリ',
    }
    mockParseJsonFromResponse.mockReturnValue(unmatchedProfile)

    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'Railsプロジェクト',
      projectType: 'new_project',
    })

    // All results must have score > 0.1
    result.forEach((r) => {
      expect(r.matchScore).toBeGreaterThan(0.1)
    })
  })

  it('returns correct SimilarProject shape with all required fields', async () => {
    const result = await findSimilarProjectsSemantic({
      supabase: createMockSupabase([sampleRefs[0]]),
      specMarkdown: 'Next.js TypeScript EC',
      projectType: 'new_project',
    })

    if (result.length > 0) {
      const item = result[0]
      expect(typeof item.githubReferenceId).toBe('string')
      expect(typeof item.repoFullName).toBe('string')
      expect(typeof item.matchScore).toBe('number')
      expect(Array.isArray(item.matchReasons)).toBe(true)
      expect(Array.isArray(item.techStack)).toBe(true)
    }
  })
})
