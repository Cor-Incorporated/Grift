import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    teams: vi.fn().mockResolvedValue({
      nodes: [
        { id: 'team-1', name: 'Engineering', key: 'ENG' },
        { id: 'team-2', name: 'Design', key: 'DES' },
      ],
    }),
    createProject: vi.fn().mockResolvedValue({
      project: Promise.resolve({
        id: 'proj-1',
        name: 'Test Project',
        url: 'https://linear.app/test/project/proj-1',
      }),
    }),
    createCycle: vi.fn().mockResolvedValue({
      cycle: Promise.resolve({
        id: 'cycle-1',
        name: 'Phase 1',
        number: 1,
      }),
    }),
    createIssue: vi.fn().mockResolvedValue({
      issue: Promise.resolve({
        id: 'issue-1',
        identifier: 'ENG-1',
        url: 'https://linear.app/test/issue/ENG-1',
        title: 'Test Issue',
      }),
    }),
  })),
}))

describe('Linear client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LINEAR_API_KEY = 'lin_api_test_key'
    process.env.LINEAR_DEFAULT_TEAM_ID = 'team-1'
  })

  it('createLinearClient creates client with env API key', async () => {
    const { createLinearClient } = await import('../client')
    const client = createLinearClient()
    expect(client).toBeDefined()
  })

  it('createLinearClient throws when API key missing', async () => {
    delete process.env.LINEAR_API_KEY
    const { createLinearClient } = await import('../client')
    expect(() => createLinearClient()).toThrow()
  })

  it('getDefaultTeamId returns env value', async () => {
    const { getDefaultTeamId } = await import('../client')
    expect(getDefaultTeamId()).toBe('team-1')
  })

  it('getDefaultTeamId throws when not configured', async () => {
    delete process.env.LINEAR_DEFAULT_TEAM_ID
    const { getDefaultTeamId } = await import('../client')
    expect(() => getDefaultTeamId()).toThrow('LINEAR_DEFAULT_TEAM_ID')
  })

  it('getLinearTeams returns team list', async () => {
    const { getLinearTeams } = await import('../client')
    const teams = await getLinearTeams()
    expect(teams).toHaveLength(2)
    expect(teams[0]).toEqual({ id: 'team-1', name: 'Engineering', key: 'ENG' })
  })

  it('createLinearProject creates project', async () => {
    const { createLinearProject } = await import('../client')
    const result = await createLinearProject({
      name: 'Test Project',
      teamIds: ['team-1'],
    })
    expect(result.id).toBe('proj-1')
    expect(result.name).toBe('Test Project')
  })

  it('createLinearIssue creates issue', async () => {
    const { createLinearIssue } = await import('../client')
    const result = await createLinearIssue({
      teamId: 'team-1',
      title: 'Test Issue',
      priority: 2,
    })
    expect(result.id).toBe('issue-1')
    expect(result.identifier).toBe('ENG-1')
  })
})
