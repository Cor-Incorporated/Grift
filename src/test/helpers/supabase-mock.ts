import { vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

type ChainResult = { data: unknown; error: unknown; count?: number }
type ChainMethod = ReturnType<typeof vi.fn>

interface TableConfig {
  select?: ChainResult
  insert?: ChainResult
  update?: ChainResult
  upsert?: ChainResult
  delete?: ChainResult
}

/**
 * Creates a flexible Supabase mock client for testing.
 *
 * Usage:
 * ```ts
 * const supabase = createMockSupabaseClient({
 *   estimates: {
 *     insert: { data: { id: 'est-1' }, error: null },
 *     select: { data: [{ id: 'est-1' }], error: null },
 *   },
 *   projects: {
 *     select: { data: { id: 'proj-1', type: 'new_project' }, error: null },
 *   },
 * })
 * ```
 */
export function createMockSupabaseClient(
  tables: Record<string, TableConfig> = {}
): SupabaseClient {
  const fromMock = vi.fn()

  fromMock.mockImplementation((table: string) => {
    const config = tables[table]
    return buildTableMock(config)
  })

  return { from: fromMock } as unknown as SupabaseClient
}

function buildChainableMock(result: ChainResult): ChainMethod {
  const mock: Record<string, ChainMethod> = {}

  const methods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'gt', 'gte', 'lt', 'lte',
    'like', 'ilike', 'contains', 'containedBy',
    'order', 'limit', 'range', 'textSearch',
    'filter', 'match', 'or', 'and',
  ]

  const terminalMethods = {
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }

  for (const method of methods) {
    mock[method] = vi.fn().mockReturnValue({ ...mock, ...terminalMethods })
  }

  return vi.fn().mockReturnValue({ ...mock, ...terminalMethods })
}

function buildTableMock(config?: TableConfig) {
  const defaultResult: ChainResult = { data: null, error: null }

  return {
    select: buildChainableMock(config?.select ?? defaultResult)(),
    insert: buildChainableMock(config?.insert ?? defaultResult),
    update: buildChainableMock(config?.update ?? defaultResult),
    upsert: buildChainableMock(config?.upsert ?? defaultResult),
    delete: buildChainableMock(config?.delete ?? defaultResult),
  }
}

/**
 * Creates a mock Supabase client specifically for the auto-generate pipeline.
 * Pre-configured with common table operations.
 */
export function createAutoGenerateMockSupabase(overrides?: {
  estimateId?: string
  projectId?: string
  estimateError?: { message: string } | null
}) {
  const estimateId = overrides?.estimateId ?? 'est-test-123'
  const projectId = overrides?.projectId ?? 'proj-test-456'

  return createMockSupabaseClient({
    estimates: {
      insert: {
        data: { id: estimateId, project_id: projectId },
        error: overrides?.estimateError ?? null,
      },
    },
    estimate_versions: {
      insert: { data: null, error: null },
    },
    market_evidence: {
      insert: {
        data: { id: 'me-test-789', retrieved_at: '2025-01-01T00:00:00.000Z' },
        error: null,
      },
    },
    audit_logs: {
      insert: { data: null, error: null },
    },
    projects: {
      select: { data: null, error: null, count: 1 },
    },
  })
}
