import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { estimateHours, estimateHoursWithClaude } from '@/lib/estimates/hours-estimator'

vi.mock('@/lib/ai/xai', () => ({
  requestXaiResponse: vi.fn(),
  parseJsonFromResponse: vi.fn(),
}))

import { requestXaiResponse, parseJsonFromResponse } from '@/lib/ai/xai'

const mockRequestXaiResponse = requestXaiResponse as Mock
const mockParseJsonFromResponse = parseJsonFromResponse as Mock

function makeGrokResponse(text: string) {
  return {
    text,
    citations: [],
    usage: { inputTokens: 100, outputTokens: 200 },
    raw: {},
  }
}

describe('estimateHours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses a well-formed Grok response with delimiter', async () => {
    const responseText = [
      '```json',
      '{"investigation":8,"implementation":40,"testing":12,"buffer":8,"total":68}',
      '```',
      '---BREAKDOWN---',
      '## 工数内訳\n- 調査: 8h\n- 実装: 40h',
    ].join('\n')

    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse(responseText))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: 8,
      implementation: 40,
      testing: 12,
      buffer: 8,
      total: 68,
    })

    const result = await estimateHours('spec markdown', 'new_project')

    expect(result.investigation).toBe(8)
    expect(result.implementation).toBe(40)
    expect(result.testing).toBe(12)
    expect(result.buffer).toBe(8)
    expect(result.total).toBe(68)
    expect(result.breakdown).toContain('工数内訳')
  })

  it('uses breakdown fallback text when no delimiter is present', async () => {
    const responseText = '```json\n{"investigation":4,"implementation":20,"testing":6,"buffer":4,"total":34}\n```'

    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse(responseText))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: 4,
      implementation: 20,
      testing: 6,
      buffer: 4,
      total: 34,
    })

    const result = await estimateHours('spec markdown', 'bug_report')

    expect(result.breakdown).toBe('工数内訳の詳細は生成できませんでした。')
  })

  it('clamps negative values to 0', async () => {
    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse('{}'))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: -5,
      implementation: -10,
      testing: -2,
      buffer: -1,
      total: -18,
    })

    const result = await estimateHours('spec markdown', 'fix_request')

    expect(result.investigation).toBe(0)
    expect(result.implementation).toBe(0)
    expect(result.testing).toBe(0)
    expect(result.buffer).toBe(0)
  })

  it('includes evidence context in system prompt when provided', async () => {
    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse('{}'))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: 10,
      implementation: 50,
      testing: 15,
      buffer: 10,
      total: 85,
    })

    const evidenceContext = '類似プロジェクト A: 実績 200 時間'
    await estimateHours('spec markdown', 'feature_addition', undefined, undefined, evidenceContext)

    expect(mockRequestXaiResponse).toHaveBeenCalledOnce()
    const callArgs = mockRequestXaiResponse.mock.calls[0]
    const messages: Array<{ role: string; content: string }> = callArgs[0]
    const systemMessage = messages.find((m) => m.role === 'system')
    expect(systemMessage?.content).toContain('証拠データ（類似プロジェクト実績）')
    expect(systemMessage?.content).toContain(evidenceContext)
    expect(systemMessage?.content).toContain('実績データとの乖離理由を工数内訳に明記')
  })

  it('omits evidence block from system prompt when evidenceContext is not provided', async () => {
    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse('{}'))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: 10,
      implementation: 50,
      testing: 15,
      buffer: 10,
      total: 85,
    })

    await estimateHours('spec markdown', 'feature_addition')

    const callArgs = mockRequestXaiResponse.mock.calls[0]
    const messages: Array<{ role: string; content: string }> = callArgs[0]
    const systemMessage = messages.find((m) => m.role === 'system')
    expect(systemMessage?.content).not.toContain('証拠データ')
  })

  it('includes attachmentContext in user message when provided', async () => {
    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse('{}'))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: 5,
      implementation: 20,
      testing: 5,
      buffer: 5,
      total: 35,
    })

    await estimateHours('spec markdown', 'bug_report', 'attachment summary here')

    const callArgs = mockRequestXaiResponse.mock.calls[0]
    const messages: Array<{ role: string; content: string }> = callArgs[0]
    const userMessage = messages.find((m) => m.role === 'user')
    expect(userMessage?.content).toContain('添付資料解析の要約')
    expect(userMessage?.content).toContain('attachment summary here')
  })

  it('calculates total from parts when parsed total is missing', async () => {
    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse('{}'))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: 5,
      implementation: 20,
      testing: 5,
      buffer: 5,
    })

    const result = await estimateHours('spec markdown', 'new_project')

    expect(result.total).toBe(35)
  })

  it('uses the XAI_MODEL env var when set', async () => {
    const originalModel = process.env.XAI_MODEL
    process.env.XAI_MODEL = 'grok-custom-model'

    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse('{}'))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: 1,
      implementation: 2,
      testing: 1,
      buffer: 1,
      total: 5,
    })

    await estimateHours('spec', 'new_project')

    const callArgs = mockRequestXaiResponse.mock.calls[0]
    const options = callArgs[1]
    expect(options.model).toBe('grok-custom-model')

    process.env.XAI_MODEL = originalModel
  })

  it('defaults to grok-4-1-fast when XAI_MODEL is not set', async () => {
    const originalModel = process.env.XAI_MODEL
    delete process.env.XAI_MODEL

    mockRequestXaiResponse.mockResolvedValueOnce(makeGrokResponse('{}'))
    mockParseJsonFromResponse.mockReturnValueOnce({
      investigation: 1,
      implementation: 2,
      testing: 1,
      buffer: 1,
      total: 5,
    })

    await estimateHours('spec', 'new_project')

    const callArgs = mockRequestXaiResponse.mock.calls[0]
    const options = callArgs[1]
    expect(options.model).toBe('grok-4-1-fast')

    process.env.XAI_MODEL = originalModel
  })
})

describe('estimateHoursWithClaude (backward compatibility)', () => {
  it('is the same function reference as estimateHours', () => {
    expect(estimateHoursWithClaude).toBe(estimateHours)
  })
})
