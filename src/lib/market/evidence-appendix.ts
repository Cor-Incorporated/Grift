import type { XaiCitation } from '@/lib/ai/xai'

export interface EvidenceAppendixSource {
  source_url: string
  domain: string
  source_type: 'public_primary' | 'web' | 'x' | 'unknown'
  provider: string
  retrieved_at: string
  confidence_score: number
}

export interface EvidenceRequirementStatus {
  minimum_sources: number
  unique_source_count: number
  primary_public_source_count: number
  met: boolean
  reason: string | null
}

export interface EstimateEvidenceAppendix {
  generated_at: string
  summary: string
  confidence_score: number
  sources: EvidenceAppendixSource[]
  requirement: EvidenceRequirementStatus
  warnings: string[]
}

interface BuildEstimateEvidenceAppendixInput {
  citations: XaiCitation[]
  confidenceScore: number
  summary: string
  retrievedAt?: string
  minimumSources?: number
  provider?: string
  warnings?: string[]
}

const PRIMARY_PUBLIC_DOMAINS = [
  'bls.gov',
  'oecd.org',
  'e-stat.go.jp',
  'stat.go.jp',
  'data.gov',
  'statistics.gov.uk',
  'europa.eu',
]

function normalizeUrl(url: string): string {
  return url.trim()
}

function getDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isPrimaryPublicDomain(domain: string): boolean {
  if (!domain) return false
  if (
    domain.endsWith('.gov')
    || domain.endsWith('.gov.jp')
    || domain.endsWith('.go.jp')
    || domain.endsWith('.gouv.fr')
  ) {
    return true
  }

  return PRIMARY_PUBLIC_DOMAINS.some((candidate) =>
    domain === candidate || domain.endsWith(`.${candidate}`)
  )
}

function toSourceType(citationType: XaiCitation['type'], domain: string): EvidenceAppendixSource['source_type'] {
  if (isPrimaryPublicDomain(domain)) {
    return 'public_primary'
  }

  if (citationType === 'web') return 'web'
  if (citationType === 'x') return 'x'
  return 'unknown'
}

export function buildEstimateEvidenceAppendix(
  input: BuildEstimateEvidenceAppendixInput
): EstimateEvidenceAppendix {
  const generatedAt = new Date().toISOString()
  const retrievedAt = input.retrievedAt ?? generatedAt
  const provider = input.provider ?? 'xai'
  const minimumSources = input.minimumSources ?? 2

  const deduped = new Map<string, EvidenceAppendixSource>()

  for (const citation of input.citations) {
    const sourceUrl = normalizeUrl(citation.url)
    if (!sourceUrl) continue

    if (deduped.has(sourceUrl)) {
      continue
    }

    const domain = getDomain(sourceUrl)
    const sourceType = toSourceType(citation.type, domain)

    deduped.set(sourceUrl, {
      source_url: sourceUrl,
      domain,
      source_type: sourceType,
      provider,
      retrieved_at: retrievedAt,
      confidence_score: input.confidenceScore,
    })
  }

  const sources = [...deduped.values()]
  const uniqueSourceCount = sources.length
  const primaryPublicSourceCount = sources.filter(
    (source) => source.source_type === 'public_primary'
  ).length

  const met = uniqueSourceCount >= minimumSources
  const reason = met
    ? null
    : `客観数値の確定条件を満たしていません（必要ソース数: ${minimumSources}, 現在: ${uniqueSourceCount}）。`

  return {
    generated_at: generatedAt,
    summary: input.summary,
    confidence_score: input.confidenceScore,
    sources,
    requirement: {
      minimum_sources: minimumSources,
      unique_source_count: uniqueSourceCount,
      primary_public_source_count: primaryPublicSourceCount,
      met,
      reason,
    },
    warnings: Array.isArray(input.warnings)
      ? input.warnings.filter((warning): warning is string => typeof warning === 'string' && warning.length > 0)
      : [],
  }
}
