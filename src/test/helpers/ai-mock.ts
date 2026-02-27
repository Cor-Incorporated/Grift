import { vi } from 'vitest'

/**
 * Creates a deterministic mock for AI/xAI API responses.
 */
export function createMockXaiResponse(text: string, options?: {
  citations?: Array<{ url: string; type: string }>
  usage?: Record<string, unknown>
}) {
  return {
    text,
    citations: options?.citations ?? [],
    raw: {},
    usage: options?.usage ?? {},
  }
}

/**
 * Creates a mock for Anthropic sendMessage responses.
 */
export function createMockAnthropicResponse(content: string) {
  return content
}

/**
 * Creates a mock hours estimation response.
 */
export function createMockHoursEstimate(overrides?: Partial<{
  investigation: number
  implementation: number
  testing: number
  buffer: number
  total: number
  breakdown: string
}>) {
  const defaults = {
    investigation: 10,
    implementation: 40,
    testing: 15,
    buffer: 10,
    total: 75,
    breakdown: '## 工数内訳\n- 調査: 10h\n- 実装: 40h\n- テスト: 15h\n- バッファ: 10h',
  }
  return { ...defaults, ...overrides }
}

/**
 * Creates a mock market evidence result.
 */
export function createMockMarketEvidence(overrides?: Partial<{
  marketHourlyRate: number
  typicalTeamSize: number
  typicalDurationMonths: number
  monthlyUnitPrice: number
  confidenceScore: number
  citationCount: number
}>) {
  const evidence = {
    marketHourlyRate: overrides?.marketHourlyRate ?? 12000,
    marketRateRange: { min: 8000, max: 16000 },
    marketEstimatedHoursMultiplier: 1.8,
    typicalTeamSize: overrides?.typicalTeamSize ?? 5,
    typicalDurationMonths: overrides?.typicalDurationMonths ?? 4,
    monthlyUnitPrice: overrides?.monthlyUnitPrice ?? 1200000,
    trends: ['クラウド移行が加速'],
    risks: ['人材不足'],
    summary: '市場相場の要約',
  }

  const citations = Array.from(
    { length: overrides?.citationCount ?? 2 },
    (_, i) => ({ url: `https://example.com/${i + 1}`, type: 'web' as const })
  )

  return {
    evidence,
    citations,
    raw: {},
    confidenceScore: overrides?.confidenceScore ?? 0.75,
    usage: {},
    isFallback: false,
    fallbackReason: null,
  }
}

/**
 * Creates a mock Go/No-Go result.
 */
export function createMockGoNoGoResult(overrides?: Partial<{
  decision: 'go' | 'go_with_conditions' | 'no_go'
  overallScore: number
  conditions: string[]
}>) {
  return {
    decision: overrides?.decision ?? 'go',
    scores: {
      profitability: { score: 80, details: '粗利率25%で健全な収益性' },
      strategicAlignment: { score: 90, businessLine: 'boltsite' as const, details: '高い適合性' },
      capacity: { score: 100, activeProjectCount: 1, details: '十分なキャパシティあり' },
      technicalRisk: { score: 85, details: '技術リスク低' },
    },
    overallScore: overrides?.overallScore ?? 87,
    conditions: overrides?.conditions ?? [],
    reasoning: 'テスト用推論',
  }
}

/**
 * Creates a mock pricing result.
 */
export function createMockPricingResult(overrides?: Partial<{
  marketTotal: number
  ourPrice: number
  costFloor: number
  marginPercent: number
}>) {
  return {
    marketTotal: overrides?.marketTotal ?? 14400000,
    coefficient: 0.7,
    ourPrice: overrides?.ourPrice ?? 10080000,
    costFloor: overrides?.costFloor ?? 4800000,
    marginPercent: overrides?.marginPercent ?? 52.38,
    riskFlags: [],
  }
}

/**
 * Sets up common AI-related module mocks for vitest.
 * Call in your test file's top-level scope.
 */
export function setupAiModuleMocks() {
  vi.mock('@/lib/ai/anthropic', () => ({
    sendMessage: vi.fn().mockResolvedValue('mock response'),
    sendMessageStream: vi.fn().mockResolvedValue('mock stream response'),
  }))

  vi.mock('@/lib/ai/xai', () => ({
    requestXaiResponse: vi.fn().mockResolvedValue({
      text: '{}',
      citations: [],
      raw: {},
      usage: {},
    }),
    parseJsonFromResponse: vi.fn((text: string) => JSON.parse(text)),
  }))
}
