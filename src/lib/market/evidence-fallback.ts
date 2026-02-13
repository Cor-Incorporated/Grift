import type { SupabaseClient } from '@supabase/supabase-js'
import type { XaiCitation } from '@/lib/ai/xai'
import type { MarketEvidence, MarketEvidenceResult } from '@/lib/market/evidence'
import type { ProjectType } from '@/types/database'

const DEFAULT_TTL_HOURS = 24

interface StoredMarketEvidenceRow {
  id: string
  data: unknown
  citations: unknown
  confidence_score: number | null
  summary: string
  retrieved_at: string
}

export interface MarketEvidenceFallbackResolution {
  result: MarketEvidenceResult
  reusedPrevious: boolean
  stale: boolean
  warning: string | null
  sourceRetrievedAt: string
}

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return value
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeEvidence(data: unknown): MarketEvidence | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const record = data as Record<string, unknown>
  const rateRangeRaw =
    typeof record.marketRateRange === 'object' && record.marketRateRange !== null
      ? (record.marketRateRange as Record<string, unknown>)
      : typeof record.market_rate_range === 'object' && record.market_rate_range !== null
        ? (record.market_rate_range as Record<string, unknown>)
        : null

  const trendsRaw = Array.isArray(record.trends) ? record.trends : []
  const risksRaw = Array.isArray(record.risks) ? record.risks : []

  const marketHourlyRate = safeNumber(
    record.marketHourlyRate ?? record.market_hourly_rate,
    10_000
  )
  const typicalTeamSize = Math.max(
    1,
    Math.round(safeNumber(record.typicalTeamSize ?? record.typical_team_size, 6))
  )
  const typicalDurationMonths = Math.max(
    0.5,
    safeNumber(record.typicalDurationMonths ?? record.typical_duration_months, 6)
  )

  return {
    marketHourlyRate,
    marketRateRange: {
      min: safeNumber(rateRangeRaw?.min, 7_000),
      max: safeNumber(rateRangeRaw?.max, 15_000),
    },
    marketEstimatedHoursMultiplier: safeNumber(
      record.marketEstimatedHoursMultiplier ?? record.market_estimated_hours_multiplier,
      1.8
    ),
    typicalTeamSize,
    typicalDurationMonths,
    monthlyUnitPrice: safeNumber(record.monthlyUnitPrice ?? record.monthly_unit_price, 1_100_000),
    trends: trendsRaw.filter((item): item is string => typeof item === 'string'),
    risks: risksRaw.filter((item): item is string => typeof item === 'string'),
    summary: safeString(record.summary, '過去の市場根拠を再利用しました。'),
  }
}

function normalizeCitations(citations: unknown): XaiCitation[] {
  if (!Array.isArray(citations)) {
    return []
  }

  const normalized: XaiCitation[] = []

  for (const item of citations) {
    if (typeof item === 'string' && item.trim().length > 0) {
      normalized.push({ url: item, type: 'unknown' })
      continue
    }

    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const url = safeString(record.url).trim()
    if (!url) {
      continue
    }

    const typeRaw = safeString(record.type)
    const type: XaiCitation['type'] =
      typeRaw === 'web' || typeRaw === 'x' || typeRaw === 'unknown'
        ? typeRaw
        : 'unknown'

    normalized.push({
      id: typeof record.id === 'string' ? record.id : undefined,
      url,
      type,
      startIndex:
        typeof record.startIndex === 'number'
          ? record.startIndex
          : typeof record.start_index === 'number'
            ? record.start_index
            : undefined,
      endIndex:
        typeof record.endIndex === 'number'
          ? record.endIndex
          : typeof record.end_index === 'number'
            ? record.end_index
            : undefined,
    })
  }

  return normalized
}

function getAgeHours(isoDatetime: string, now: Date): number {
  const retrieved = new Date(isoDatetime)
  if (Number.isNaN(retrieved.getTime())) {
    return Number.POSITIVE_INFINITY
  }

  const diffMs = now.getTime() - retrieved.getTime()
  return diffMs / (1000 * 60 * 60)
}

async function fetchTtlHours(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from('data_sources')
    .select('freshness_ttl_hours')
    .eq('source_key', 'xai_responses')
    .eq('active', true)
    .maybeSingle()

  if (!data || typeof data.freshness_ttl_hours !== 'number') {
    return DEFAULT_TTL_HOURS
  }

  return data.freshness_ttl_hours
}

async function fetchLatestStoredEvidence(input: {
  supabase: SupabaseClient
  projectId: string
  projectType: ProjectType
}): Promise<StoredMarketEvidenceRow | null> {
  const { data } = await input.supabase
    .from('market_evidence')
    .select('id, data, citations, confidence_score, summary, retrieved_at')
    .eq('project_id', input.projectId)
    .eq('project_type', input.projectType)
    .order('retrieved_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) {
    return null
  }

  return data as StoredMarketEvidenceRow
}

function createFallbackWarning(input: {
  fallbackReason: MarketEvidenceResult['fallbackReason']
  stale: boolean
  ageHours: number
  ttlHours: number
}): string {
  const base = input.fallbackReason === 'quota_exceeded'
    ? 'xAI APIクォータ上限のため、前回確定値へフォールバックしました。'
    : '市場根拠取得に失敗したため、前回確定値へフォールバックしました。'

  if (!input.stale) {
    return `${base}（鮮度: ${Math.floor(input.ageHours)}h / TTL ${input.ttlHours}h）`
  }

  return `${base}（鮮度警告: ${Math.floor(input.ageHours)}h 経過 / TTL ${input.ttlHours}h）`
}

export async function resolveMarketEvidenceWithFallback(input: {
  supabase: SupabaseClient
  projectId: string
  projectType: ProjectType
  fetched: MarketEvidenceResult
  now?: Date
}): Promise<MarketEvidenceFallbackResolution> {
  const now = input.now ?? new Date()
  const fetchedHasMinimumSources = input.fetched.citations.length >= 2

  if (!input.fetched.isFallback && fetchedHasMinimumSources) {
    return {
      result: input.fetched,
      reusedPrevious: false,
      stale: false,
      warning: null,
      sourceRetrievedAt: now.toISOString(),
    }
  }

  const latest = await fetchLatestStoredEvidence({
    supabase: input.supabase,
    projectId: input.projectId,
    projectType: input.projectType,
  })

  if (!latest) {
    return {
      result: input.fetched,
      reusedPrevious: false,
      stale: false,
      warning: null,
      sourceRetrievedAt: now.toISOString(),
    }
  }

  const normalizedEvidence = normalizeEvidence(latest.data)
  if (!normalizedEvidence) {
    return {
      result: input.fetched,
      reusedPrevious: false,
      stale: false,
      warning: null,
      sourceRetrievedAt: now.toISOString(),
    }
  }

  const ttlHours = await fetchTtlHours(input.supabase)
  const ageHours = getAgeHours(latest.retrieved_at, now)
  const stale = ageHours > ttlHours

  const warning = createFallbackWarning({
    fallbackReason: input.fetched.fallbackReason,
    stale,
    ageHours,
    ttlHours,
  })

  const summaryBase = latest.summary?.trim().length > 0
    ? latest.summary
    : normalizedEvidence.summary

  return {
    result: {
      evidence: {
        ...normalizedEvidence,
        summary: `${summaryBase}\n\n${warning}`,
      },
      citations: normalizeCitations(latest.citations),
      raw: latest.data,
      confidenceScore:
        typeof latest.confidence_score === 'number'
          ? latest.confidence_score
          : input.fetched.confidenceScore,
      usage: input.fetched.usage,
      isFallback: true,
      fallbackReason: input.fetched.fallbackReason,
    },
    reusedPrevious: true,
    stale,
    warning,
    sourceRetrievedAt: latest.retrieved_at,
  }
}
