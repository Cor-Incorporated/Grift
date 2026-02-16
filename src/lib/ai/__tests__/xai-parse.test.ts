import { describe, it, expect } from 'vitest'
import { parseJsonFromResponse, sanitizeJsonNewlines } from '../xai'

describe('sanitizeJsonNewlines', () => {
  it('replaces literal newlines inside JSON string values', () => {
    const input = '{"key": "line1\nline2\nline3"}'
    const result = sanitizeJsonNewlines(input)
    expect(JSON.parse(result)).toEqual({ key: 'line1\nline2\nline3' })
  })

  it('preserves structural newlines between JSON properties', () => {
    const input = '{\n  "a": 1,\n  "b": 2\n}'
    const result = sanitizeJsonNewlines(input)
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 })
  })

  it('handles escaped quotes inside strings', () => {
    const input = '{"key": "value with \\"quotes\\" and\nnewline"}'
    const result = sanitizeJsonNewlines(input)
    expect(JSON.parse(result)).toEqual({ key: 'value with "quotes" and\nnewline' })
  })

  it('handles carriage returns inside strings', () => {
    const input = '{"key": "line1\r\nline2"}'
    const result = sanitizeJsonNewlines(input)
    expect(JSON.parse(result)).toEqual({ key: 'line1\r\nline2' })
  })

  it('handles empty strings', () => {
    expect(sanitizeJsonNewlines('')).toBe('')
  })

  it('handles strings with no newlines', () => {
    const input = '{"key": "value"}'
    expect(sanitizeJsonNewlines(input)).toBe(input)
  })
})

describe('parseJsonFromResponse', () => {
  it('parses clean JSON', () => {
    const result = parseJsonFromResponse<{ total: number }>('{"total": 624}')
    expect(result.total).toBe(624)
  })

  it('parses JSON in code fence', () => {
    const input = '```json\n{"total": 624}\n```'
    const result = parseJsonFromResponse<{ total: number }>(input)
    expect(result.total).toBe(624)
  })

  it('parses JSON with surrounding text', () => {
    const input = 'Here is the result:\n{"total": 624}\nDone.'
    const result = parseJsonFromResponse<{ total: number }>(input)
    expect(result.total).toBe(624)
  })

  it('handles JSON with literal newlines in string values', () => {
    const input = '{"total": 624, "breakdown": "## 内訳\n### 1. 調査\n- 8時間"}'
    const result = parseJsonFromResponse<{ total: number; breakdown: string }>(input)
    expect(result.total).toBe(624)
    expect(result.breakdown).toContain('内訳')
  })

  it('handles JSON in code fence with literal newlines in strings', () => {
    const input = '```json\n{"total": 624, "breakdown": "## 内訳\n### 1. 調査\n- 8時間"}\n```'
    const result = parseJsonFromResponse<{ total: number; breakdown: string }>(input)
    expect(result.total).toBe(624)
  })

  it('reproduces production error: breakdown with Markdown tables', () => {
    const input = `\`\`\`json
{
  "investigation": 80,
  "implementation": 320,
  "testing": 120,
  "buffer": 104,
  "total": 624,
  "breakdown": "## 工数内訳

### 1. 調査・分析（80時間）
| 項目 | 時間 |
|------|------|
| 要件分析 | 24h |
| 技術調査 | 32h |
| アーキテクチャ設計 | 24h |

### 2. 実装（320時間）
- フロントエンド: 160h
- バックエンド: 120h
- インフラ: 40h"
}
\`\`\``;
    const result = parseJsonFromResponse<{ total: number; breakdown: string }>(input)
    expect(result.total).toBe(624)
    expect(result.breakdown).toContain('工数内訳')
  })

  it('throws SyntaxError for completely invalid input', () => {
    expect(() => parseJsonFromResponse('not json at all')).toThrow(SyntaxError)
  })
})
