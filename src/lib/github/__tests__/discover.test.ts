import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { discoverUserRepos, discoverOrgRepos, syncReposToDatabase } from '../discover'

const mockFetch = vi.fn()

describe('GitHub Discovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.stubEnv('GITHUB_TOKEN', 'test-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  function createMockRepo(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      name: 'test-repo',
      full_name: 'test-org/test-repo',
      description: 'A test repository',
      language: 'TypeScript',
      stargazers_count: 10,
      topics: ['nextjs', 'typescript'],
      default_branch: 'main',
      updated_at: '2024-01-01T00:00:00Z',
      owner: { login: 'test-org' },
      ...overrides,
    }
  }

  describe('discoverUserRepos', () => {
    it('should fetch user repos with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([createMockRepo()]),
        headers: new Headers(),
      })

      const repos = await discoverUserRepos('custom-token')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/user/repos?type=owner&sort=updated&per_page=100',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer custom-token',
          }),
        })
      )

      expect(repos).toHaveLength(1)
      expect(repos[0].repoName).toBe('test-repo')
      expect(repos[0].orgName).toBe('test-org')
      expect(repos[0].stars).toBe(10)
    })

    it('should handle pagination', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([createMockRepo({ name: 'repo-1' })]),
          headers: new Headers({
            Link: '<https://api.github.com/user/repos?page=2>; rel="next"',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([createMockRepo({ name: 'repo-2' })]),
          headers: new Headers(),
        })

      const repos = await discoverUserRepos()

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(repos).toHaveLength(2)
    })

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await expect(discoverUserRepos()).rejects.toThrow('GitHub API error: 401')
    })
  })

  describe('discoverOrgRepos', () => {
    it('should fetch org repos with correct URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([createMockRepo()]),
        headers: new Headers(),
      })

      await discoverOrgRepos('my-org')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/orgs/my-org/repos?type=all&sort=updated&per_page=100',
        expect.any(Object)
      )
    })
  })

  describe('syncReposToDatabase', () => {
    it('should return zero counts for empty repos', async () => {
      const mockSupabase = {} as Parameters<typeof syncReposToDatabase>[0]['supabase']

      const result = await syncReposToDatabase({
        supabase: mockSupabase,
        repos: [],
        createdByClerkUserId: 'user-123',
      })

      expect(result).toEqual({ synced: 0, created: 0, updated: 0 })
    })

    it('should upsert repos to database', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null })
      const mockIn = vi.fn().mockResolvedValue({ data: [] })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: mockUpsert,
          select: vi.fn().mockReturnValue({
            in: mockIn,
          }),
        }),
      } as unknown as Parameters<typeof syncReposToDatabase>[0]['supabase']

      const repos = [
        {
          orgName: 'test-org',
          repoName: 'repo-1',
          description: 'Test repo',
          language: 'TypeScript',
          stars: 5,
          topics: ['nextjs'],
          defaultBranch: 'main',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      const result = await syncReposToDatabase({
        supabase: mockSupabase,
        repos,
        createdByClerkUserId: 'user-123',
      })

      expect(result.synced).toBe(1)
      expect(result.created).toBe(1)
      expect(result.updated).toBe(0)
    })

    it('should throw on database error', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({
            error: { message: 'DB Error' },
          }),
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      } as unknown as Parameters<typeof syncReposToDatabase>[0]['supabase']

      await expect(
        syncReposToDatabase({
          supabase: mockSupabase,
          repos: [{
            orgName: 'org',
            repoName: 'repo',
            description: null,
            language: null,
            stars: 0,
            topics: [],
            defaultBranch: 'main',
            updatedAt: '2024-01-01T00:00:00Z',
          }],
          createdByClerkUserId: 'user-123',
        })
      ).rejects.toThrow('リポジトリの同期に失敗しました')
    })
  })
})
