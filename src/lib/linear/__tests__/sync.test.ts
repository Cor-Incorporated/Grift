import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client', () => ({
  getDefaultTeamId: vi.fn().mockReturnValue('team-1'),
  createLinearProject: vi.fn().mockResolvedValue({
    id: 'lp-1',
    name: 'Test',
    url: 'https://linear.app/test/project/lp-1',
  }),
  createLinearCycle: vi.fn().mockResolvedValue({
    id: 'cycle-1',
    name: 'Phase 1',
    number: 1,
  }),
  createLinearIssue: vi.fn().mockResolvedValue({
    id: 'issue-1',
    identifier: 'ENG-1',
    url: 'https://linear.app/test/issue/ENG-1',
    title: 'Module A',
  }),
}))

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: vi.fn(),
}))

import { syncEstimateToLinear } from '../sync'
import { createLinearProject, createLinearIssue, createLinearCycle } from '../client'
import { writeAuditLog } from '@/lib/audit/log'
import type { Mock } from 'vitest'

function createMockSupabase(overrides?: { existingLinearProjectId?: string }) {
  const updateMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  })

  const insertMock = vi.fn().mockResolvedValue({ error: null })
  const upsertMock = vi.fn().mockResolvedValue({ error: null })

  const selectMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: overrides?.existingLinearProjectId
          ? { linear_project_id: overrides.existingLinearProjectId, linear_project_url: 'https://linear.app/test/project/existing' }
          : { linear_project_id: null, linear_project_url: null },
        error: null,
      }),
    }),
  })

  return {
    from: vi.fn().mockReturnValue({
      update: updateMock,
      insert: insertMock,
      upsert: upsertMock,
      select: selectMock,
    }),
  } as unknown as SupabaseClient
}

describe('syncEstimateToLinear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('syncs estimate with modules to Linear', async () => {
    const supabase = createMockSupabase()

    const result = await syncEstimateToLinear({
      supabase,
      estimateId: 'est-1',
      projectId: 'proj-1',
      projectName: 'Test Project',
      modules: [
        { name: 'Module A', hours: 10, phase: 'Phase 1', riskLevel: 'high' },
        { name: 'Module B', hours: 20, phase: 'Phase 1', riskLevel: 'low' },
      ],
      phases: [
        { name: 'Phase 1', modules: ['Module A', 'Module B'], durationWeeks: 2 },
      ],
      actorClerkUserId: 'user-1',
    })

    expect(result.linearProjectId).toBe('lp-1')
    expect(result.issueCount).toBe(2)
    expect(result.cycleCount).toBe(1)

    expect(createLinearProject).toHaveBeenCalledOnce()
    expect(createLinearCycle).toHaveBeenCalledOnce()
    expect(createLinearIssue).toHaveBeenCalledTimes(2)
    expect(writeAuditLog).toHaveBeenCalledOnce()
  })

  it('syncs without phases (no cycles created)', async () => {
    const supabase = createMockSupabase()

    const result = await syncEstimateToLinear({
      supabase,
      estimateId: 'est-2',
      projectId: 'proj-2',
      projectName: 'Simple Project',
      modules: [
        { name: 'Task 1', hours: 5 },
      ],
    })

    expect(result.cycleCount).toBe(0)
    expect(createLinearCycle).not.toHaveBeenCalled()
    expect(createLinearIssue).toHaveBeenCalledOnce()
  })

  it('sets sync status to error on failure', async () => {
    ;(createLinearProject as Mock).mockRejectedValueOnce(new Error('API Error'))

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { linear_project_id: null, linear_project_url: null },
          error: null,
        }),
      }),
    })
    const supabase = {
      from: vi.fn().mockReturnValue({
        update: updateMock,
        select: selectMock,
      }),
    } as unknown as SupabaseClient

    await expect(
      syncEstimateToLinear({
        supabase,
        estimateId: 'est-3',
        projectId: 'proj-3',
        projectName: 'Failed Project',
        modules: [{ name: 'Task', hours: 1 }],
      })
    ).rejects.toThrow('API Error')

    // Verify 'error' status was set
    const updateCalls = (supabase.from as Mock).mock.calls
    const statusUpdates = updateCalls.filter(
      (call: string[]) => call[0] === 'estimates'
    )
    expect(statusUpdates.length).toBeGreaterThanOrEqual(2) // syncing + error
  })

  it('does not write audit log when no actorClerkUserId', async () => {
    const supabase = createMockSupabase()

    await syncEstimateToLinear({
      supabase,
      estimateId: 'est-4',
      projectId: 'proj-4',
      projectName: 'No Actor',
      modules: [{ name: 'Task', hours: 3 }],
    })

    expect(writeAuditLog).not.toHaveBeenCalled()
  })
})
