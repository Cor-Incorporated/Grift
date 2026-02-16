import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findSimilarProjects } from '../similar-projects'

function createMockSupabase(refs: Record<string, unknown>[] = []) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: refs,
              error: null,
            }),
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof findSimilarProjects>[0]['supabase']
}

const sampleRefs = [
  {
    id: 'ref-1',
    org_name: 'cor-inc',
    repo_name: 'ecommerce-platform',
    full_name: 'cor-inc/ecommerce-platform',
    description: 'EC platform built with Next.js',
    language: 'TypeScript',
    tech_stack: ['Next.js', 'TypeScript', 'PostgreSQL', 'Stripe'],
    project_type: 'new_project',
    topics: ['ecommerce', 'nextjs', 'typescript'],
    hours_spent: 200,
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
  },
]

describe('findSimilarProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return matching projects sorted by score', async () => {
    const result = await findSimilarProjects({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'Next.jsとTypeScriptでECサイトを構築。Stripe決済統合。PostgreSQLを使用。',
      projectType: 'new_project',
    })

    expect(result.length).toBeGreaterThan(0)
    expect(result[0].repoFullName).toBe('cor-inc/ecommerce-platform')
    expect(result[0].matchScore).toBeGreaterThan(0)
    expect(result[0].matchReasons.length).toBeGreaterThan(0)
  })

  it('should return empty array when no keywords match', async () => {
    const result = await findSimilarProjects({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'この文章にはプログラミング用語が含まれていません',
      projectType: 'new_project',
    })

    expect(result).toEqual([])
  })

  it('should return empty array when no showcase repos exist', async () => {
    const result = await findSimilarProjects({
      supabase: createMockSupabase([]),
      specMarkdown: 'Next.js TypeScript project',
      projectType: 'new_project',
    })

    expect(result).toEqual([])
  })

  it('should respect limit parameter', async () => {
    const result = await findSimilarProjects({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'Next.js TypeScript React dashboard CMS WordPress IoT MQTT Python FastAPI',
      projectType: 'new_project',
      limit: 2,
    })

    expect(result.length).toBeLessThanOrEqual(2)
  })

  it('should handle database error gracefully', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'DB Error' },
              }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof findSimilarProjects>[0]['supabase']

    const result = await findSimilarProjects({
      supabase: mockSupabase,
      specMarkdown: 'Next.js TypeScript project',
      projectType: 'new_project',
    })

    expect(result).toEqual([])
  })

  it('should include attachment context in keyword extraction', async () => {
    const result = await findSimilarProjects({
      supabase: createMockSupabase(sampleRefs),
      specMarkdown: 'ダッシュボード開発',
      projectType: 'new_project',
      attachmentContext: 'IoT MQTT sensor monitoring platform',
    })

    expect(result.length).toBeGreaterThan(0)
    // IoT/MQTT keywords should match iot-dashboard
    const iotMatch = result.find((r) => r.repoFullName === 'cor-inc/iot-dashboard')
    expect(iotMatch).toBeDefined()
  })
})
