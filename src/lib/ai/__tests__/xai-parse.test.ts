import { describe, it, expect } from 'vitest'
import { parseJsonFromResponse, sanitizeJsonNewlines, sanitizeJsonStrings } from '../xai'

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

describe('sanitizeJsonStrings', () => {
  it('is the same function as sanitizeJsonNewlines', () => {
    expect(sanitizeJsonStrings).toBe(sanitizeJsonNewlines)
  })

  it('handles tab characters inside strings', () => {
    const input = '{"key": "col1\tcol2\tcol3"}'
    const result = sanitizeJsonStrings(input)
    expect(JSON.parse(result)).toEqual({ key: 'col1\tcol2\tcol3' })
  })

  it('handles form feed and backspace inside strings', () => {
    const input = '{"key": "before\fmiddle\bafter"}'
    const result = sanitizeJsonStrings(input)
    expect(JSON.parse(result)).toEqual({ key: 'before\fmiddle\bafter' })
  })

  it('handles null byte and other control characters', () => {
    const input = '{"key": "test\x00value\x01end"}'
    const result = sanitizeJsonStrings(input)
    const parsed = JSON.parse(result)
    expect(parsed.key).toContain('test')
    expect(parsed.key).toContain('end')
  })

  it('fixes invalid backslash escapes', () => {
    const input = '{"key": "path\\kto\\xfile"}'
    const result = sanitizeJsonStrings(input)
    const parsed = JSON.parse(result)
    expect(parsed.key).toContain('path')
    expect(parsed.key).toContain('file')
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

  it('strips breakdown field as last resort when it breaks JSON', () => {
    const reallyBroken = `{
  "investigation": 80,
  "implementation": 320,
  "testing": 120,
  "buffer": 104,
  "total": 624,
  "breakdown": "## 工数見積もり内訳

### 1. 調査・分析フェーズ (80時間)

| 項目 | 時間 |
|------|------|
| 要件分析 | 24h |

### 2. 実装 (320時間)
- フロントエンド: 160h"
}`
    const result = parseJsonFromResponse<{ total: number; investigation: number }>(reallyBroken)
    expect(result.total).toBe(624)
    expect(result.investigation).toBe(80)
  })

  it('handles production ca37ee3d error: JSON with Markdown breakdown containing tables', () => {
    // Exact reproduction of the production error
    const prodResponse = `\`\`\`json
{
  "investigation": 80,
  "implementation": 320,
  "testing": 120,
  "buffer": 104,
  "total": 624,
  "breakdown": "## 工数見積もり内訳\n\n### 1. 調査・分析フェーズ (80時間)\n\n#### 1.1 要件整理・技術選定 (24時間)\n- 要件定義書の精読と技術要件の洗い出し (8時間)\n- 技術スタック選定と検証 (8時間)\n- 既存参考サイトの分析 (8時間)\n\n#### 1.2 設計 (32時間)\n- データベース設計 (12時間)\n- API設計 (12時間)\n- アーキテクチャ設計 (8時間)\n\n#### 1.3 環境構築 (24時間)\n- 開発環境セットアップ (8時間)\n- CI/CD構築 (8時間)\n- インフラ設計 (8時間)\n\n### 2. 実装フェーズ (320時間)\n\n| モジュール | 工数 | 内訳 |\n|------------|------|------|\n| 認証・ユーザー管理 | 40h | Clerk統合、RBAC |\n| LP表示エンジン | 80h | テンプレートシステム、レスポンシブ |\n| 管理画面 | 60h | LP CRUD、プレビュー |\n| AI統合 | 60h | Claude API、コンテンツ生成 |\n| 決済システム | 40h | Stripe統合 |\n| 分析ダッシュボード | 40h | GA連携、A/Bテスト |\n\n### 3. テストフェーズ (120時間)\n- ユニットテスト: 40h\n- E2Eテスト: 40h\n- パフォーマンステスト: 20h\n- セキュリティテスト: 20h\n\n### 4. バッファ (104時間)\n- リスク対応: 20%\n- スコープ変更対応: ~5%"
}
\`\`\``
    const result = parseJsonFromResponse<{ total: number; investigation: number }>(prodResponse)
    expect(result.total).toBe(624)
    expect(result.investigation).toBe(80)
  })
})
