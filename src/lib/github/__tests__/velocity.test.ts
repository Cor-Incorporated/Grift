import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { analyzeRepoVelocity } from '@/lib/github/velocity'

// Mock fetch globally
const mockFetch = vi.fn()

// Helper to create mock responses
function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response
}

function emptyResponse(status = 204): Response {
  return {
    ok: true,
    status,
    json: () => Promise.resolve([]),
    headers: new Headers(),
  } as Response
}

// Sample data
const sampleCommitActivity = Array.from({ length: 52 }, (_, i) => ({
  total: i < 40 ? 5 : 0,
  week: Math.floor(Date.now() / 1000) - (52 - i) * 7 * 24 * 3600,
  days: i < 40 ? [1, 1, 1, 1, 1, 0, 0] : [0, 0, 0, 0, 0, 0, 0],
}))

const sampleContributors = [
  {
    author: { login: 'dev1' },
    total: 300,
    weeks: [
      { w: Math.floor(Date.now() / 1000) - 365 * 24 * 3600, a: 100, d: 20, c: 10 },
      { w: Math.floor(Date.now() / 1000) - 7 * 24 * 3600, a: 50, d: 10, c: 5 },
    ],
  },
  {
    author: { login: 'dev2' },
    total: 150,
    weeks: [
      { w: Math.floor(Date.now() / 1000) - 180 * 24 * 3600, a: 80, d: 15, c: 8 },
      { w: Math.floor(Date.now() / 1000) - 14 * 24 * 3600, a: 30, d: 5, c: 3 },
    ],
  },
]

const sampleReleases = [
  { tag_name: 'v1.0.0', published_at: '2025-06-01T00:00:00Z' },
  { tag_name: 'v1.1.0', published_at: '2025-09-01T00:00:00Z' },
]

const sampleCodeFrequency: [number, number, number][] = [
  [1700000000, 500, -100],
  [1700604800, 300, -50],
  [1701209600, 200, -80],
]

describe('analyzeRepoVelocity', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns velocity data for a normal repository', async () => {
    // Mock all 4 API calls
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats/commit_activity')) return Promise.resolve(jsonResponse(sampleCommitActivity))
      if (url.includes('/stats/contributors')) return Promise.resolve(jsonResponse(sampleContributors))
      if (url.includes('/releases')) return Promise.resolve(jsonResponse(sampleReleases))
      if (url.includes('/stats/code_frequency')) return Promise.resolve(jsonResponse(sampleCodeFrequency))
      return Promise.resolve(jsonResponse([], 404))
    })

    const result = await analyzeRepoVelocity('testorg', 'testrepo', 'fake-token')

    expect(result.totalCommits).toBe(450) // 300 + 150
    expect(result.contributorCount).toBe(2)
    expect(result.coreContributors).toBeGreaterThanOrEqual(1)
    expect(result.totalAdditions).toBe(1000)  // 500 + 300 + 200
    expect(result.totalDeletions).toBe(230)   // 100 + 50 + 80
    expect(result.churnRate).toBeGreaterThan(0)
    expect(result.velocityScore).toBeGreaterThan(0)
    expect(result.velocityScore).toBeLessThanOrEqual(100)
    expect(result.estimatedHours).toBeGreaterThan(0)
    expect(result.releases).toHaveLength(2)
    expect(result.releases[0].tag).toBe('v1.0.0')
    expect(result.firstCommitDate).toBeTruthy()
    expect(result.lastCommitDate).toBeTruthy()
  })

  it('handles 202 retry for stats endpoints', async () => {
    let commitActivityCalls = 0
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats/commit_activity')) {
        commitActivityCalls++
        if (commitActivityCalls <= 2) return Promise.resolve(jsonResponse(null, 202))
        return Promise.resolve(jsonResponse(sampleCommitActivity))
      }
      if (url.includes('/stats/contributors')) return Promise.resolve(jsonResponse(sampleContributors))
      if (url.includes('/releases')) return Promise.resolve(jsonResponse(sampleReleases))
      if (url.includes('/stats/code_frequency')) return Promise.resolve(jsonResponse(sampleCodeFrequency))
      return Promise.resolve(jsonResponse([], 404))
    })

    const result = await analyzeRepoVelocity('testorg', 'testrepo')
    expect(result.totalCommits).toBe(450)
    expect(commitActivityCalls).toBe(3) // 2 retries + 1 success
  }, 30000)

  it('handles empty repo (204 responses)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([], 404))
      return Promise.resolve(emptyResponse())
    })

    const result = await analyzeRepoVelocity('testorg', 'empty-repo')
    expect(result.totalCommits).toBe(0)
    expect(result.contributorCount).toBe(0)
    expect(result.releases).toHaveLength(0)
  })

  it('uses GITHUB_TOKEN from env when no token provided', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'env-token-123')
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([]))
      return Promise.resolve(emptyResponse())
    })

    await analyzeRepoVelocity('testorg', 'testrepo')

    const firstCall = mockFetch.mock.calls[0]
    const headers = firstCall[1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer env-token-123')
  })

  it('passes explicit token over env token', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'env-token')
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([]))
      return Promise.resolve(emptyResponse())
    })

    await analyzeRepoVelocity('testorg', 'testrepo', 'explicit-token')

    const firstCall = mockFetch.mock.calls[0]
    const headers = firstCall[1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer explicit-token')
  })

  it('constructs correct API URLs with encoded owner/repo', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([]))
      return Promise.resolve(emptyResponse())
    })

    await analyzeRepoVelocity('my-org', 'my-repo')

    const urls = mockFetch.mock.calls.map((call: unknown[]) => call[0] as string)
    expect(urls.some((u: string) => u.includes('/repos/my-org/my-repo/stats/commit_activity'))).toBe(true)
    expect(urls.some((u: string) => u.includes('/repos/my-org/my-repo/stats/contributors'))).toBe(true)
    expect(urls.some((u: string) => u.includes('/repos/my-org/my-repo/releases'))).toBe(true)
    expect(urls.some((u: string) => u.includes('/repos/my-org/my-repo/stats/code_frequency'))).toBe(true)
  })

  it('computes correct churn rate', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats/commit_activity')) return Promise.resolve(jsonResponse(sampleCommitActivity))
      if (url.includes('/stats/contributors')) return Promise.resolve(jsonResponse(sampleContributors))
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([]))
      if (url.includes('/stats/code_frequency')) return Promise.resolve(jsonResponse(sampleCodeFrequency))
      return Promise.resolve(jsonResponse([], 404))
    })

    const result = await analyzeRepoVelocity('testorg', 'testrepo', 'token')

    // churnRate = totalDeletions / totalAdditions = 230 / 1000 = 0.23
    expect(result.churnRate).toBe(0.23)
  })

  it('computes active development days from commit activity', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats/commit_activity')) return Promise.resolve(jsonResponse(sampleCommitActivity))
      if (url.includes('/stats/contributors')) return Promise.resolve(jsonResponse(sampleContributors))
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([]))
      if (url.includes('/stats/code_frequency')) return Promise.resolve(jsonResponse(sampleCodeFrequency))
      return Promise.resolve(jsonResponse([], 404))
    })

    const result = await analyzeRepoVelocity('testorg', 'testrepo', 'token')

    // 40 weeks with 5 active days each = 200 active days
    expect(result.activeDevelopmentDays).toBe(200)
  })

  it('computes estimated hours with churn multiplier', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats/commit_activity')) return Promise.resolve(jsonResponse(sampleCommitActivity))
      if (url.includes('/stats/contributors')) return Promise.resolve(jsonResponse(sampleContributors))
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([]))
      if (url.includes('/stats/code_frequency')) return Promise.resolve(jsonResponse(sampleCodeFrequency))
      return Promise.resolve(jsonResponse([], 404))
    })

    const result = await analyzeRepoVelocity('testorg', 'testrepo', 'token')

    // Base: 450 * 2 = 900 hours
    // churnRate = 0.23, churnMultiplier = 1 + 0.23 * 0.25 = 1.0575
    // estimatedHours = round(900 * 1.0575) = round(951.75) = 952
    expect(result.estimatedHours).toBe(952)
  })

  it('throws on non-retryable API error', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats/commit_activity')) return Promise.resolve(jsonResponse(null, 403))
      if (url.includes('/stats/contributors')) return Promise.resolve(jsonResponse(sampleContributors))
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([]))
      if (url.includes('/stats/code_frequency')) return Promise.resolve(jsonResponse(sampleCodeFrequency))
      return Promise.resolve(jsonResponse([], 404))
    })

    await expect(analyzeRepoVelocity('testorg', 'testrepo', 'token'))
      .rejects.toThrow('GitHub API error: 403')
  })

  it('computes core contributors as those with >= 10% of total commits', async () => {
    // dev1 has 300 (66.7%) and dev2 has 150 (33.3%), both above 10% threshold of 45
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats/commit_activity')) return Promise.resolve(jsonResponse(sampleCommitActivity))
      if (url.includes('/stats/contributors')) return Promise.resolve(jsonResponse(sampleContributors))
      if (url.includes('/releases')) return Promise.resolve(jsonResponse([]))
      if (url.includes('/stats/code_frequency')) return Promise.resolve(jsonResponse(sampleCodeFrequency))
      return Promise.resolve(jsonResponse([], 404))
    })

    const result = await analyzeRepoVelocity('testorg', 'testrepo', 'token')
    expect(result.coreContributors).toBe(2)
  })

  it('sorts releases by date ascending', async () => {
    const unorderedReleases = [
      { tag_name: 'v2.0.0', published_at: '2025-12-01T00:00:00Z' },
      { tag_name: 'v1.0.0', published_at: '2025-01-01T00:00:00Z' },
      { tag_name: 'v1.5.0', published_at: '2025-06-01T00:00:00Z' },
    ]

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats/commit_activity')) return Promise.resolve(jsonResponse(sampleCommitActivity))
      if (url.includes('/stats/contributors')) return Promise.resolve(jsonResponse(sampleContributors))
      if (url.includes('/releases')) return Promise.resolve(jsonResponse(unorderedReleases))
      if (url.includes('/stats/code_frequency')) return Promise.resolve(jsonResponse(sampleCodeFrequency))
      return Promise.resolve(jsonResponse([], 404))
    })

    const result = await analyzeRepoVelocity('testorg', 'testrepo', 'token')

    expect(result.releases[0].tag).toBe('v1.0.0')
    expect(result.releases[1].tag).toBe('v1.5.0')
    expect(result.releases[2].tag).toBe('v2.0.0')
  })
})
