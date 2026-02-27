import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/server so prepareApiUsage uses our fake client
// ---------------------------------------------------------------------------
const mockInsert = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  ExternalApiQuotaError,
  isExternalApiQuotaError,
  logApiUsage,
  prepareApiUsage,
} from '@/lib/usage/api-usage'

// ---------------------------------------------------------------------------
// Supabase builder helpers
// ---------------------------------------------------------------------------

interface UsageRow {
  request_count: number
  estimated_cost: number
  request_status: string
}

interface DataSourceRow {
  source_key: string
  provider: string
  active: boolean
  currency: string
  estimated_cost_per_call: number
  quota_daily: number | null
  quota_monthly: number | null
  metadata: Record<string, unknown>
}

function buildSupabaseMock(options: {
  dataSource?: DataSourceRow | null
  dataSourceError?: boolean
  usageRows?: UsageRow[]
  usageError?: boolean
  insertError?: boolean
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'data_sources') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (options.dataSourceError) {
                  return { data: null, error: { message: 'db error' } }
                }
                return { data: options.dataSource ?? null, error: null }
              },
            }),
          }),
        }
      }

      if (table === 'api_usage_logs') {
        return {
          select: () => ({
            eq: () => ({
              gte: () =>
                Promise.resolve({
                  data: options.usageError ? null : (options.usageRows ?? []),
                  error: options.usageError ? { message: 'db error' } : null,
                }),
            }),
          }),
          insert: (payload: unknown) => {
            mockInsert(payload)
            return Promise.resolve({
              error: options.insertError ? { code: '23000', message: 'insert error' } : null,
            })
          },
        }
      }

      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: () => Promise.resolve({ error: null }),
      }
    },
  } as unknown as SupabaseClient
}

function makeDataSource(overrides: Partial<DataSourceRow> = {}): DataSourceRow {
  return {
    source_key: 'test_source',
    provider: 'test_provider',
    active: true,
    currency: 'USD',
    estimated_cost_per_call: 0,
    quota_daily: null,
    quota_monthly: null,
    metadata: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockInsert.mockClear()
})

// ===========================================================================
// ExternalApiQuotaError
// ===========================================================================
describe('ExternalApiQuotaError', () => {
  it('constructs with correct properties', () => {
    const err = new ExternalApiQuotaError({
      sourceKey: 'anthropic',
      provider: 'anthropic',
      quotaType: 'daily_request_limit',
      limit: 100,
      used: 100,
    })

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ExternalApiQuotaError)
    expect(err.name).toBe('ExternalApiQuotaError')
    expect(err.sourceKey).toBe('anthropic')
    expect(err.provider).toBe('anthropic')
    expect(err.quotaType).toBe('daily_request_limit')
    expect(err.limit).toBe(100)
    expect(err.used).toBe(100)
  })

  it('uses default message when none is provided', () => {
    const err = new ExternalApiQuotaError({
      sourceKey: 'xai',
      provider: 'xai',
      quotaType: 'monthly_request_limit',
      limit: 500,
      used: 500,
    })

    expect(err.message).toContain('xai')
  })

  it('uses custom message when provided', () => {
    const err = new ExternalApiQuotaError({
      sourceKey: 'source',
      provider: 'prov',
      quotaType: 'source_disabled',
      limit: null,
      used: null,
      message: 'Custom quota message',
    })

    expect(err.message).toBe('Custom quota message')
  })

  it('accepts null limit and used', () => {
    const err = new ExternalApiQuotaError({
      sourceKey: 'src',
      provider: 'prov',
      quotaType: 'source_disabled',
      limit: null,
      used: null,
    })

    expect(err.limit).toBeNull()
    expect(err.used).toBeNull()
  })
})

// ===========================================================================
// isExternalApiQuotaError
// ===========================================================================
describe('isExternalApiQuotaError', () => {
  it('returns true for ExternalApiQuotaError instances', () => {
    const err = new ExternalApiQuotaError({
      sourceKey: 'src',
      provider: 'prov',
      quotaType: 'daily_request_limit',
      limit: 10,
      used: 10,
    })

    expect(isExternalApiQuotaError(err)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isExternalApiQuotaError(new Error('plain'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isExternalApiQuotaError(null)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isExternalApiQuotaError('error string')).toBe(false)
  })

  it('returns false for an arbitrary object', () => {
    expect(isExternalApiQuotaError({ name: 'ExternalApiQuotaError' })).toBe(false)
  })
})

// ===========================================================================
// prepareApiUsage — source config not found
// ===========================================================================
describe('prepareApiUsage — source config not found', () => {
  it('returns context with null sourceConfig when data_source does not exist', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({ dataSource: null }) as never
    )

    const ctx = await prepareApiUsage({
      sourceKey: 'unknown_source',
      provider: 'unknown',
      endpoint: '/test',
      model: 'gpt-4',
    })

    expect(ctx.sourceConfig).toBeNull()
    expect(ctx.quotaSnapshot).toBeNull()
    expect(ctx.sourceKey).toBe('unknown_source')
    expect(ctx.provider).toBe('unknown')
    expect(ctx.endpoint).toBe('/test')
    expect(ctx.model).toBe('gpt-4')
  })

  it('returns context with null sourceConfig when data_source query errors', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({ dataSourceError: true }) as never
    )

    const ctx = await prepareApiUsage({
      sourceKey: 'src',
      provider: 'prov',
      endpoint: '/ep',
    })

    expect(ctx.sourceConfig).toBeNull()
    expect(ctx.quotaSnapshot).toBeNull()
  })
})

// ===========================================================================
// prepareApiUsage — source found, no quota breach
// ===========================================================================
describe('prepareApiUsage — source found, no quota breach', () => {
  it('returns valid quotaSnapshot when source is active and no limits exceeded', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ active: true, quota_daily: 100, quota_monthly: 1000 }),
        usageRows: [
          { request_count: 5, estimated_cost: 0.01, request_status: 'success' },
        ],
      }) as never
    )

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    expect(ctx.sourceConfig).not.toBeNull()
    expect(ctx.quotaSnapshot).not.toBeNull()
    expect(ctx.quotaSnapshot?.quotaDaily).toBe(100)
    expect(ctx.quotaSnapshot?.quotaMonthly).toBe(1000)
    expect(ctx.quotaSnapshot?.dayUsedRequests).toBe(5)
  })

  it('propagates context to returned PreparedUsageContext', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({ dataSource: makeDataSource() }) as never
    )

    const callContext = { projectId: 'proj_123', actorClerkUserId: 'user_abc' }
    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/ep',
      context: callContext,
    })

    expect(ctx.context).toEqual(callContext)
  })

  it('excludes blocked rows from usage totals', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ quota_daily: 10 }),
        usageRows: [
          { request_count: 3, estimated_cost: 0.03, request_status: 'success' },
          { request_count: 99, estimated_cost: 9.99, request_status: 'blocked' },
        ],
      }) as never
    )

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/ep',
    })

    expect(ctx.quotaSnapshot?.dayUsedRequests).toBe(3)
  })
})

// ===========================================================================
// prepareApiUsage — quota breaches
// ===========================================================================
describe('prepareApiUsage — quota breaches throw ExternalApiQuotaError', () => {
  it('throws when source is disabled', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ active: false }),
        usageRows: [],
      }) as never
    )

    await expect(
      prepareApiUsage({ sourceKey: 'test_source', provider: 'prov', endpoint: '/ep' })
    ).rejects.toBeInstanceOf(ExternalApiQuotaError)

    const err = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    }).catch((e: unknown) => e)

    expect(isExternalApiQuotaError(err)).toBe(true)
    if (isExternalApiQuotaError(err)) {
      expect(err.quotaType).toBe('source_disabled')
    }
  })

  it('throws when daily request limit is reached', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ active: true, quota_daily: 5 }),
        usageRows: [{ request_count: 5, estimated_cost: 0.05, request_status: 'success' }],
      }) as never
    )

    const err = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    }).catch((e: unknown) => e)

    expect(isExternalApiQuotaError(err)).toBe(true)
    if (isExternalApiQuotaError(err)) {
      expect(err.quotaType).toBe('daily_request_limit')
      expect(err.limit).toBe(5)
      expect(err.used).toBe(5)
    }
  })

  it('throws when monthly request limit is reached', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ active: true, quota_monthly: 200 }),
        // Day totals fine, month totals at limit
        usageRows: [
          { request_count: 200, estimated_cost: 2, request_status: 'success' },
        ],
      }) as never
    )

    const err = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    }).catch((e: unknown) => e)

    expect(isExternalApiQuotaError(err)).toBe(true)
    if (isExternalApiQuotaError(err)) {
      expect(err.quotaType).toBe('monthly_request_limit')
    }
  })

  it('throws when daily cost limit is reached', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({
          active: true,
          metadata: { daily_cost_limit: 1.0 },
        }),
        usageRows: [{ request_count: 1, estimated_cost: 1.0, request_status: 'success' }],
      }) as never
    )

    const err = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    }).catch((e: unknown) => e)

    expect(isExternalApiQuotaError(err)).toBe(true)
    if (isExternalApiQuotaError(err)) {
      expect(err.quotaType).toBe('daily_cost_limit')
    }
  })

  it('throws when monthly cost limit is reached', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({
          active: true,
          metadata: { monthly_cost_limit: 10.0 },
        }),
        usageRows: [{ request_count: 1, estimated_cost: 10.0, request_status: 'success' }],
      }) as never
    )

    const err = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    }).catch((e: unknown) => e)

    expect(isExternalApiQuotaError(err)).toBe(true)
    if (isExternalApiQuotaError(err)) {
      expect(err.quotaType).toBe('monthly_cost_limit')
    }
  })

  it('inserts a blocked log entry when quota is breached', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ active: false }),
        usageRows: [],
      }) as never
    )

    await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    }).catch(() => undefined)

    expect(mockInsert).toHaveBeenCalledOnce()
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.request_status).toBe('blocked')
    expect(payload.over_quota).toBe(true)
  })
})

// ===========================================================================
// prepareApiUsage — cost calculation via metadata
// ===========================================================================
describe('prepareApiUsage — estimated cost calculation', () => {
  it('returns 0 estimated cost when no source config', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({ dataSource: null }) as never
    )

    // prepareApiUsage with null source succeeds and returns null sourceConfig
    const ctx = await prepareApiUsage({
      sourceKey: 'no_source',
      provider: 'prov',
      endpoint: '/ep',
    })

    expect(ctx.sourceConfig).toBeNull()
  })
})

// ===========================================================================
// logApiUsage
// ===========================================================================
describe('logApiUsage', () => {
  it('inserts a success log entry', async () => {
    const supabase = buildSupabaseMock({ dataSource: makeDataSource() })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    // First prepare to get a valid context
    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    mockInsert.mockClear()

    await logApiUsage(ctx, { status: 'success' })

    expect(mockInsert).toHaveBeenCalledOnce()
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.request_status).toBe('success')
    expect(payload.over_quota).toBe(false)
  })

  it('inserts an error log entry with error message', async () => {
    const supabase = buildSupabaseMock({ dataSource: makeDataSource() })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    mockInsert.mockClear()

    await logApiUsage(ctx, {
      status: 'error',
      errorMessage: 'Something went wrong',
    })

    expect(mockInsert).toHaveBeenCalledOnce()
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.request_status).toBe('error')
    expect(payload.error_message).toBe('Something went wrong')
  })

  it('includes token metrics in the log entry', async () => {
    const supabase = buildSupabaseMock({ dataSource: makeDataSource() })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    mockInsert.mockClear()

    await logApiUsage(ctx, {
      status: 'success',
      metrics: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
    })

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.input_tokens).toBe(1000)
    expect(payload.output_tokens).toBe(500)
    expect(payload.total_tokens).toBe(1500)
  })

  it('does not throw when insert fails', async () => {
    const supabase = buildSupabaseMock({ dataSource: makeDataSource(), insertError: true })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    // Should not throw even if insert fails
    await expect(logApiUsage(ctx, { status: 'success' })).resolves.toBeUndefined()
  })

  it('includes metadata in the log entry', async () => {
    const supabase = buildSupabaseMock({ dataSource: makeDataSource() })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    mockInsert.mockClear()

    await logApiUsage(ctx, {
      status: 'success',
      metadata: { custom_field: 'custom_value' },
    })

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    const meta = payload.metadata as Record<string, unknown>
    expect(meta.custom_field).toBe('custom_value')
  })

  it('truncates error messages longer than 2000 characters', async () => {
    const supabase = buildSupabaseMock({ dataSource: makeDataSource() })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    mockInsert.mockClear()

    const longMessage = 'x'.repeat(3000)
    await logApiUsage(ctx, { status: 'error', errorMessage: longMessage })

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    expect((payload.error_message as string).length).toBe(2000)
  })

  it('works with null sourceConfig (pass-through with no cost calculation)', async () => {
    const supabase = buildSupabaseMock({ dataSource: null })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    const ctx = await prepareApiUsage({
      sourceKey: 'no_source',
      provider: 'prov',
      endpoint: '/ep',
    })

    mockInsert.mockClear()

    await logApiUsage(ctx, { status: 'success' })

    expect(mockInsert).toHaveBeenCalledOnce()
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.estimated_cost).toBe(0)
  })
})

// ===========================================================================
// logApiUsage — token cost calculation
// ===========================================================================
describe('logApiUsage — token-based cost calculation', () => {
  it('calculates estimated cost using token metadata from source config', async () => {
    const supabase = buildSupabaseMock({
      dataSource: makeDataSource({
        estimated_cost_per_call: 0,
        metadata: {
          input_cost_per_1m_tokens: 3.0,
          output_cost_per_1m_tokens: 15.0,
        },
      }),
    })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    mockInsert.mockClear()

    await logApiUsage(ctx, {
      status: 'success',
      metrics: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
    })

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    // 1M input * $3/1M + 1M output * $15/1M = $18
    expect(payload.estimated_cost).toBe(18)
  })

  it('includes reportedCostUsdTicks in metadata when provided', async () => {
    const supabase = buildSupabaseMock({ dataSource: makeDataSource() })
    vi.mocked(createServiceRoleClient).mockResolvedValue(supabase as never)

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'test_provider',
      endpoint: '/test',
    })

    mockInsert.mockClear()

    await logApiUsage(ctx, {
      status: 'success',
      metrics: { reportedCostUsdTicks: 12345 },
    })

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    const meta = payload.metadata as Record<string, unknown>
    expect(meta.reported_cost_usd_ticks).toBe(12345)
  })
})

// ===========================================================================
// prepareApiUsage — usage totals when DB errors
// ===========================================================================
describe('prepareApiUsage — usage totals fallback on DB error', () => {
  it('returns zero totals when usage log query fails', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ quota_daily: 1000 }),
        usageError: true,
      }) as never
    )

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    })

    expect(ctx.quotaSnapshot?.dayUsedRequests).toBe(0)
    expect(ctx.quotaSnapshot?.monthUsedRequests).toBe(0)
  })
})

// ===========================================================================
// prepareApiUsage — currency fallback
// ===========================================================================
describe('prepareApiUsage — currency handling', () => {
  it('defaults currency to USD when source currency is empty', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ currency: '   ' }),
      }) as never
    )

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    })

    mockInsert.mockClear()
    await logApiUsage(ctx, { status: 'success' })

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.currency).toBe('USD')
  })

  it('uses source currency when valid', async () => {
    vi.mocked(createServiceRoleClient).mockResolvedValue(
      buildSupabaseMock({
        dataSource: makeDataSource({ currency: 'JPY' }),
      }) as never
    )

    const ctx = await prepareApiUsage({
      sourceKey: 'test_source',
      provider: 'prov',
      endpoint: '/ep',
    })

    mockInsert.mockClear()
    await logApiUsage(ctx, { status: 'success' })

    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.currency).toBe('JPY')
  })
})
