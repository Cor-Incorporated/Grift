import { describe, it, expect } from 'vitest'
import { extractTextAndCitations } from '@/lib/ai/xai'

describe('xai response parser', () => {
  it('extracts output text and citations from responses output format', () => {
    const result = extractTextAndCitations({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '市場単価は上昇傾向です。',
              annotations: [
                {
                  id: 1,
                  web_citation: {
                    url: 'https://example.com/market',
                  },
                },
              ],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        output_tokens_details: {
          reasoning_tokens: 50,
        },
      },
    })

    expect(result.text).toContain('市場単価')
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].url).toBe('https://example.com/market')
    expect(result.usage.inputTokens).toBe(100)
    expect(result.usage.outputTokens).toBe(200)
    expect(result.usage.reasoningTokens).toBe(50)
  })

  it('supports legacy choices format fallback', () => {
    const result = extractTextAndCitations({
      choices: [{ message: { content: 'fallback text' } }],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 12,
      },
    })

    expect(result.text).toBe('fallback text')
    expect(result.usage.inputTokens).toBe(11)
    expect(result.usage.outputTokens).toBe(12)
  })

  it('supports top-level citations and additional usage fields', () => {
    const result = extractTextAndCitations({
      text: 'latest summary',
      citations: ['https://example.com/source-a'],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        cost_in_usd_ticks: 4567,
      },
    })

    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].url).toBe('https://example.com/source-a')
    expect(result.usage.totalTokens).toBe(30)
    expect(result.usage.costUsdTicks).toBe(4567)
  })
})
