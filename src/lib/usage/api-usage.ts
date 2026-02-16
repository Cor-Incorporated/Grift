import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'

type UsageStatus = 'success' | 'error' | 'blocked'
type QuotaBreachType =
  | 'source_disabled'
  | 'daily_request_limit'
  | 'monthly_request_limit'
  | 'daily_cost_limit'
  | 'monthly_cost_limit'

interface DataSourceConfig {
  sourceKey: string
  provider: string
  active: boolean
  currency: string
  estimatedCostPerCall: number
  quotaDaily: number | null
  quotaMonthly: number | null
  metadata: Record<string, unknown>
}

interface UsageTotals {
  requests: number
  estimatedCost: number
}

export interface UsageCallContext {
  projectId?: string | null
  actorClerkUserId?: string | null
  metadata?: Record<string, unknown>
}

export interface UsageTokenMetrics {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  reportedCostUsdTicks?: number
}

export interface UsageLogInput {
  status: UsageStatus
  sourceKey: string
  provider: string
  endpoint: string
  model?: string
  context?: UsageCallContext
  metrics?: UsageTokenMetrics
  errorMessage?: string
  metadata?: Record<string, unknown>
}

export interface UsageQuotaSnapshot {
  quotaDaily: number | null
  quotaMonthly: number | null
  dayUsedRequests: number
  monthUsedRequests: number
  dayUsedEstimatedCost: number
  monthUsedEstimatedCost: number
  dailyCostLimit: number | null
  monthlyCostLimit: number | null
}

export interface PreparedUsageContext {
  supabase: SupabaseClient
  sourceConfig: DataSourceConfig | null
  quotaSnapshot: UsageQuotaSnapshot | null
  sourceKey: string
  provider: string
  endpoint: string
  model?: string
  context?: UsageCallContext
}

export class ExternalApiQuotaError extends Error {
  sourceKey: string
  provider: string
  quotaType: QuotaBreachType
  limit: number | null
  used: number | null

  constructor(input: {
    sourceKey: string
    provider: string
    quotaType: QuotaBreachType
    limit: number | null
    used: number | null
    message?: string
  }) {
    super(input.message ?? `External API quota exceeded: ${input.sourceKey}`)
    this.name = 'ExternalApiQuotaError'
    this.sourceKey = input.sourceKey
    this.provider = input.provider
    this.quotaType = input.quotaType
    this.limit = input.limit
    this.used = input.used
  }
}

interface QuotaBreach {
  type: QuotaBreachType
  limit: number | null
  used: number | null
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function utcDayStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

function utcMonthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

function parseCostLimits(metadata: Record<string, unknown>): {
  dailyCostLimit: number | null
  monthlyCostLimit: number | null
} {
  const rawDaily = metadata.daily_cost_limit
  const rawMonthly = metadata.monthly_cost_limit

  const dailyCostLimit =
    typeof rawDaily === 'number' && Number.isFinite(rawDaily) && rawDaily >= 0
      ? rawDaily
      : null

  const monthlyCostLimit =
    typeof rawMonthly === 'number' && Number.isFinite(rawMonthly) && rawMonthly >= 0
      ? rawMonthly
      : null

  return {
    dailyCostLimit,
    monthlyCostLimit,
  }
}

function pickBreach(input: {
  source: DataSourceConfig
  dayTotals: UsageTotals
  monthTotals: UsageTotals
}): QuotaBreach | null {
  if (!input.source.active) {
    return {
      type: 'source_disabled',
      limit: null,
      used: null,
    }
  }

  if (
    input.source.quotaDaily !== null
    && input.dayTotals.requests >= input.source.quotaDaily
  ) {
    return {
      type: 'daily_request_limit',
      limit: input.source.quotaDaily,
      used: input.dayTotals.requests,
    }
  }

  if (
    input.source.quotaMonthly !== null
    && input.monthTotals.requests >= input.source.quotaMonthly
  ) {
    return {
      type: 'monthly_request_limit',
      limit: input.source.quotaMonthly,
      used: input.monthTotals.requests,
    }
  }

  const { dailyCostLimit, monthlyCostLimit } = parseCostLimits(input.source.metadata)

  if (dailyCostLimit !== null && input.dayTotals.estimatedCost >= dailyCostLimit) {
    return {
      type: 'daily_cost_limit',
      limit: dailyCostLimit,
      used: input.dayTotals.estimatedCost,
    }
  }

  if (monthlyCostLimit !== null && input.monthTotals.estimatedCost >= monthlyCostLimit) {
    return {
      type: 'monthly_cost_limit',
      limit: monthlyCostLimit,
      used: input.monthTotals.estimatedCost,
    }
  }

  return null
}

function calculateEstimatedCost(
  source: DataSourceConfig | null,
  metrics?: UsageTokenMetrics
): number {
  if (!source) {
    return 0
  }

  const metadata = source.metadata
  const inputCostPer1M =
    typeof metadata.input_cost_per_1m_tokens === 'number'
      ? metadata.input_cost_per_1m_tokens
      : 0
  const outputCostPer1M =
    typeof metadata.output_cost_per_1m_tokens === 'number'
      ? metadata.output_cost_per_1m_tokens
      : 0
  const reasoningCostPer1M =
    typeof metadata.reasoning_cost_per_1m_tokens === 'number'
      ? metadata.reasoning_cost_per_1m_tokens
      : 0

  const inputTokens = Math.max(0, metrics?.inputTokens ?? 0)
  const outputTokens = Math.max(0, metrics?.outputTokens ?? 0)
  const reasoningTokens = Math.max(0, metrics?.reasoningTokens ?? 0)

  const tokenBased =
    (inputTokens / 1_000_000) * inputCostPer1M
    + (outputTokens / 1_000_000) * outputCostPer1M
    + (reasoningTokens / 1_000_000) * reasoningCostPer1M

  return roundCost(source.estimatedCostPerCall + tokenBased)
}

async function fetchDataSourceConfig(
  supabase: SupabaseClient,
  sourceKey: string
): Promise<DataSourceConfig | null> {
  const { data, error } = await supabase
    .from('data_sources')
    .select('source_key, provider, active, currency, estimated_cost_per_call, quota_daily, quota_monthly, metadata')
    .eq('source_key', sourceKey)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const metadata = isRecord(data.metadata) ? data.metadata : {}

  return {
    sourceKey: data.source_key,
    provider: data.provider,
    active: Boolean(data.active),
    currency: typeof data.currency === 'string' && data.currency.trim().length > 0
      ? data.currency
      : 'USD',
    estimatedCostPerCall: toFiniteNumber(data.estimated_cost_per_call, 0),
    quotaDaily: typeof data.quota_daily === 'number' ? data.quota_daily : null,
    quotaMonthly: typeof data.quota_monthly === 'number' ? data.quota_monthly : null,
    metadata,
  }
}

async function fetchUsageTotals(
  supabase: SupabaseClient,
  sourceKey: string,
  fromIso: string
): Promise<UsageTotals> {
  const { data, error } = await supabase
    .from('api_usage_logs')
    .select('request_count, estimated_cost, request_status')
    .eq('source_key', sourceKey)
    .gte('created_at', fromIso)

  if (error || !data) {
    return {
      requests: 0,
      estimatedCost: 0,
    }
  }

  let requests = 0
  let estimatedCost = 0

  for (const row of data) {
    if (row.request_status === 'blocked') {
      continue
    }

    requests += typeof row.request_count === 'number' ? row.request_count : 1
    estimatedCost += toFiniteNumber(row.estimated_cost, 0)
  }

  return {
    requests,
    estimatedCost: roundCost(estimatedCost),
  }
}

function buildQuotaSnapshot(input: {
  source: DataSourceConfig
  dayTotals: UsageTotals
  monthTotals: UsageTotals
}): UsageQuotaSnapshot {
  const limits = parseCostLimits(input.source.metadata)
  return {
    quotaDaily: input.source.quotaDaily,
    quotaMonthly: input.source.quotaMonthly,
    dayUsedRequests: input.dayTotals.requests,
    monthUsedRequests: input.monthTotals.requests,
    dayUsedEstimatedCost: input.dayTotals.estimatedCost,
    monthUsedEstimatedCost: input.monthTotals.estimatedCost,
    dailyCostLimit: limits.dailyCostLimit,
    monthlyCostLimit: limits.monthlyCostLimit,
  }
}

async function safeInsertUsageLog(
  supabase: SupabaseClient,
  input: {
    sourceKey: string
    provider: string
    endpoint: string
    model?: string
    status: UsageStatus
    sourceConfig: DataSourceConfig | null
    context?: UsageCallContext
    metrics?: UsageTokenMetrics
    quotaSnapshot?: UsageQuotaSnapshot | null
    errorMessage?: string
    metadata?: Record<string, unknown>
    overQuota?: boolean
  }
): Promise<void> {
  const metrics = input.metrics
  const totalTokens =
    typeof metrics?.totalTokens === 'number'
      ? Math.max(0, metrics.totalTokens)
      : Math.max(0, (metrics?.inputTokens ?? 0) + (metrics?.outputTokens ?? 0))

  const metadata = {
    ...(input.context?.metadata ?? {}),
    ...(input.metadata ?? {}),
  }

  if (typeof metrics?.reportedCostUsdTicks === 'number') {
    metadata.reported_cost_usd_ticks = metrics.reportedCostUsdTicks
  }

  const estimatedCost = calculateEstimatedCost(input.sourceConfig, metrics)

  const payload = {
    provider: input.provider,
    source_key: input.sourceKey,
    endpoint: input.endpoint,
    model: input.model ?? null,
    request_status: input.status,
    request_count: 1,
    input_tokens: metrics?.inputTokens ?? null,
    output_tokens: metrics?.outputTokens ?? null,
    reasoning_tokens: metrics?.reasoningTokens ?? null,
    total_tokens: totalTokens || null,
    estimated_cost: estimatedCost,
    currency: input.sourceConfig?.currency ?? 'USD',
    quota_daily: input.quotaSnapshot?.quotaDaily ?? input.sourceConfig?.quotaDaily ?? null,
    quota_monthly: input.quotaSnapshot?.quotaMonthly ?? input.sourceConfig?.quotaMonthly ?? null,
    over_quota: input.overQuota ?? false,
    error_message: input.errorMessage ? input.errorMessage.slice(0, 2000) : null,
    project_id: input.context?.projectId ?? null,
    actor_clerk_user_id: input.context?.actorClerkUserId ?? null,
    metadata,
  }

  const { error } = await supabase.from('api_usage_logs').insert(payload)

  if (error) {
    logger.warn('Failed to insert api_usage_logs', {
      sourceKey: input.sourceKey,
      status: input.status,
      code: error.code,
      message: error.message,
    })
  }
}

export async function prepareApiUsage(
  input: {
    sourceKey: string
    provider: string
    endpoint: string
    model?: string
    context?: UsageCallContext
  }
): Promise<PreparedUsageContext> {
  const supabase = await createServiceRoleClient()
  const sourceConfig = await fetchDataSourceConfig(supabase, input.sourceKey)

  if (!sourceConfig) {
    return {
      supabase,
      sourceConfig: null,
      quotaSnapshot: null,
      sourceKey: input.sourceKey,
      provider: input.provider,
      endpoint: input.endpoint,
      model: input.model,
      context: input.context,
    }
  }

  const [dayTotals, monthTotals] = await Promise.all([
    fetchUsageTotals(supabase, input.sourceKey, utcDayStartIso()),
    fetchUsageTotals(supabase, input.sourceKey, utcMonthStartIso()),
  ])

  const quotaSnapshot = buildQuotaSnapshot({
    source: sourceConfig,
    dayTotals,
    monthTotals,
  })

  const breach = pickBreach({
    source: sourceConfig,
    dayTotals,
    monthTotals,
  })

  if (breach) {
    await safeInsertUsageLog(supabase, {
      sourceKey: input.sourceKey,
      provider: input.provider,
      endpoint: input.endpoint,
      model: input.model,
      status: 'blocked',
      sourceConfig,
      context: input.context,
      quotaSnapshot,
      errorMessage: `Quota blocked: ${breach.type}`,
      metadata: {
        quota_type: breach.type,
        quota_limit: breach.limit,
        quota_used: breach.used,
      },
      overQuota: true,
    })

    throw new ExternalApiQuotaError({
      sourceKey: input.sourceKey,
      provider: input.provider,
      quotaType: breach.type,
      limit: breach.limit,
      used: breach.used,
      message: `外部APIのクォータ上限に達したため、呼び出しを停止しました (${input.sourceKey})`,
    })
  }

  return {
    supabase,
    sourceConfig,
    quotaSnapshot,
    sourceKey: input.sourceKey,
    provider: input.provider,
    endpoint: input.endpoint,
    model: input.model,
    context: input.context,
  }
}

export async function logApiUsage(
  usage: PreparedUsageContext,
  input: {
    status: UsageStatus
    metrics?: UsageTokenMetrics
    errorMessage?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  await safeInsertUsageLog(usage.supabase, {
    sourceKey: usage.sourceKey,
    provider: usage.provider,
    endpoint: usage.endpoint,
    model: usage.model,
    status: input.status,
    sourceConfig: usage.sourceConfig,
    context: usage.context,
    metrics: input.metrics,
    quotaSnapshot: usage.quotaSnapshot,
    errorMessage: input.errorMessage,
    metadata: input.metadata,
    overQuota: false,
  })
}

export function isExternalApiQuotaError(error: unknown): error is ExternalApiQuotaError {
  return error instanceof ExternalApiQuotaError
}
