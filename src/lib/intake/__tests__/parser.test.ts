import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseIntakeMessage } from '@/lib/intake/parser'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/anthropic', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('@/lib/ai/xai', () => ({
  parseJsonFromResponse: vi.fn(),
}))

import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'

// ---------------------------------------------------------------------------
// Heuristic parser – keyword detection
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – heuristic mode', () => {
  it('detects bug_report from Japanese "バグ"', async () => {
    const result = await parseIntakeMessage('バグが発生しました', { mode: 'heuristic' })
    const types = result.intents.map((i) => i.intentType)
    expect(types).toContain('bug_report')
    expect(result.parser).toBe('heuristic')
  })

  it('detects bug_report from "不具合"', async () => {
    const result = await parseIntakeMessage('不具合があります', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('bug_report')
  })

  it('detects bug_report from "エラー"', async () => {
    const result = await parseIntakeMessage('エラーが出ます', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('bug_report')
  })

  it('detects bug_report from "怪しい"', async () => {
    const result = await parseIntakeMessage('動作が怪しいです', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('bug_report')
  })

  it('detects bug_report from "クラッシュ"', async () => {
    const result = await parseIntakeMessage('アプリがクラッシュします', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('bug_report')
  })

  it('detects account_task from "アカウント"', async () => {
    const result = await parseIntakeMessage('アカウントを作成してください', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('account_task')
  })

  it('detects account_task from "ユーザー作成"', async () => {
    const result = await parseIntakeMessage('ユーザー作成をお願いします', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('account_task')
  })

  it('detects account_task from "ユーザ作成" (without vowel elongation)', async () => {
    const result = await parseIntakeMessage('ユーザ作成が必要です', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('account_task')
  })

  it('detects account_task from "パスワード"', async () => {
    const result = await parseIntakeMessage('パスワードをリセットしてください', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('account_task')
  })

  it('detects feature_addition from "実装"', async () => {
    const result = await parseIntakeMessage('新機能を実装してください', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('feature_addition')
  })

  it('detects feature_addition from "機能"', async () => {
    const result = await parseIntakeMessage('機能を追加したい', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('feature_addition')
  })

  it('detects feature_addition from "チュートリアル"', async () => {
    const result = await parseIntakeMessage('チュートリアルが必要です', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('feature_addition')
  })

  it('detects feature_addition from "フォルダ"', async () => {
    const result = await parseIntakeMessage('フォルダ整理機能を作りたい', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('feature_addition')
  })

  it('detects billing_risk from "請求"', async () => {
    const result = await parseIntakeMessage('請求がおかしいです', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('billing_risk')
  })

  it('detects billing_risk from "引き落とし"', async () => {
    const result = await parseIntakeMessage('引き落としが失敗しています', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('billing_risk')
  })

  it('detects billing_risk from "口座"', async () => {
    const result = await parseIntakeMessage('口座情報を更新したい', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('billing_risk')
  })

  it('detects billing_risk from "決済"', async () => {
    const result = await parseIntakeMessage('決済処理が止まっている', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('billing_risk')
  })

  it('detects scope_change from "当初"', async () => {
    const result = await parseIntakeMessage('当初の要件から変わりました', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('scope_change')
  })

  it('detects scope_change from "実は"', async () => {
    const result = await parseIntakeMessage('実はもう少し変えたい', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('scope_change')
  })

  it('detects scope_change from "変更"', async () => {
    const result = await parseIntakeMessage('仕様の変更があります', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('scope_change')
  })

  it('detects scope_change from "納期"', async () => {
    const result = await parseIntakeMessage('納期を延ばしたい', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('scope_change')
  })

  it('falls back to "other" when no keywords match', async () => {
    const result = await parseIntakeMessage('よろしくお願いします', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('other')
    expect(result.intents).toHaveLength(1)
  })

  it('produces multiple intents for compound messages', async () => {
    const result = await parseIntakeMessage(
      'バグがあります。また請求もおかしいです。',
      { mode: 'heuristic' }
    )
    const types = result.intents.map((i) => i.intentType)
    expect(types).toContain('bug_report')
    expect(types).toContain('billing_risk')
    expect(result.intents.length).toBeGreaterThanOrEqual(2)
  })

  it('sets priority to "high" for bug_report intents', async () => {
    const result = await parseIntakeMessage('バグです', { mode: 'heuristic' })
    const bugIntent = result.intents.find((i) => i.intentType === 'bug_report')
    expect(bugIntent?.priorityHint).toBe('high')
  })

  it('sets priority to "medium" for non-bug intents', async () => {
    const result = await parseIntakeMessage('機能を追加したい', { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'feature_addition')
    expect(intent?.priorityHint).toBe('medium')
  })

  it('sets confidence to 0.55 for all heuristic intents', async () => {
    const result = await parseIntakeMessage('バグがあります', { mode: 'heuristic' })
    for (const intent of result.intents) {
      expect(intent.confidence).toBe(0.55)
    }
  })
})

// ---------------------------------------------------------------------------
// Heuristic parser – category mapping
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – heuristic category mapping', () => {
  it('maps bug_report intent to bug_report category', async () => {
    const result = await parseIntakeMessage('バグです', { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'bug_report')
    expect(intent?.category).toBe('bug_report')
  })

  it('maps feature_addition intent to feature_addition category', async () => {
    const result = await parseIntakeMessage('機能追加したい', { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'feature_addition')
    expect(intent?.category).toBe('feature_addition')
  })

  it('maps account_task intent to other category', async () => {
    const result = await parseIntakeMessage('アカウント作成', { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'account_task')
    expect(intent?.category).toBe('other')
  })

  it('maps billing_risk intent to other category', async () => {
    const result = await parseIntakeMessage('請求エラー', { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'billing_risk')
    expect(intent?.category).toBe('other')
  })

  it('maps scope_change intent to scope_change category', async () => {
    const result = await parseIntakeMessage('変更が必要です', { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'scope_change')
    expect(intent?.category).toBe('scope_change')
  })

  it('maps other intent to other category', async () => {
    const result = await parseIntakeMessage('よろしく', { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'other')
    expect(intent?.category).toBe('other')
  })
})

// ---------------------------------------------------------------------------
// Heuristic parser – date extraction
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – date extraction in heuristic mode', () => {
  it('extracts ISO date format (YYYY-MM-DD)', async () => {
    const result = await parseIntakeMessage('2026-03-31までに実装をお願いします', { mode: 'heuristic' })
    expect(result.intents[0].dueDate).toBe('2026-03-31')
  })

  it('extracts month-end Japanese date format', async () => {
    const result = await parseIntakeMessage('3月末までに対応してください', { mode: 'heuristic' })
    expect(result.intents[0].dueDate).toBe('3月末')
  })

  it('extracts "今日" as dueDate', async () => {
    const result = await parseIntakeMessage('今日中に対応してほしい', { mode: 'heuristic' })
    expect(result.intents[0].dueDate).toBe('今日')
  })

  it('extracts "明日" as dueDate', async () => {
    const result = await parseIntakeMessage('明日までにお願いします', { mode: 'heuristic' })
    expect(result.intents[0].dueDate).toBe('明日')
  })

  it('sets dueDate to null when no date hint found', async () => {
    const result = await parseIntakeMessage('特に期限はありません', { mode: 'heuristic' })
    expect(result.intents[0].dueDate).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Heuristic parser – title extraction
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – title extraction in heuristic mode', () => {
  it('uses first non-empty line as title (up to 100 chars)', async () => {
    const message = '機能追加のご依頼\n詳細はあとで送ります'
    const result = await parseIntakeMessage(message, { mode: 'heuristic' })
    expect(result.intents[0].title).toBe('機能追加のご依頼')
  })

  it('truncates title at 100 characters', async () => {
    const longLine = 'a'.repeat(150)
    const result = await parseIntakeMessage(longLine, { mode: 'heuristic' })
    // No keyword match → 'other' intent
    expect(result.intents[0].title.length).toBe(100)
  })

  it('uses fallback title when message is empty lines followed by content', async () => {
    const message = '\n\n機能を追加してください'
    const result = await parseIntakeMessage(message, { mode: 'heuristic' })
    expect(result.intents[0].title).toBe('機能を追加してください')
  })

  it('sets messageSummary to first 500 chars of the message', async () => {
    const msg = 'x'.repeat(600)
    const result = await parseIntakeMessage(msg, { mode: 'heuristic' })
    expect(result.messageSummary).toHaveLength(500)
  })
})

// ---------------------------------------------------------------------------
// Heuristic parser – details field
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – details field in heuristic mode', () => {
  it('includes summary and deadline in details', async () => {
    const result = await parseIntakeMessage('バグです。2026-04-01まで', { mode: 'heuristic' })
    const intent = result.intents[0]
    expect(intent.details.summary).toBeDefined()
    expect(intent.details.deadline).toBe('2026-04-01')
  })

  it('leaves deadline undefined in details when no date found', async () => {
    const result = await parseIntakeMessage('バグです', { mode: 'heuristic' })
    const intent = result.intents[0]
    expect(intent.details.deadline).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Edge cases for heuristic mode
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – heuristic edge cases', () => {
  it('handles empty string input by returning "other" intent', async () => {
    const result = await parseIntakeMessage('', { mode: 'heuristic' })
    expect(result.intents).toHaveLength(1)
    expect(result.intents[0].intentType).toBe('other')
  })

  it('handles very long input without throwing', async () => {
    const longMessage = 'バグです。'.repeat(1000)
    const result = await parseIntakeMessage(longMessage, { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('bug_report')
  })

  it('handles mixed Japanese and English keywords', async () => {
    const result = await parseIntakeMessage('バグ report for login error', { mode: 'heuristic' })
    expect(result.intents.map((i) => i.intentType)).toContain('bug_report')
  })

  it('summary in intent is capped at 2000 characters', async () => {
    const longMessage = 'バグです。' + 'a'.repeat(3000)
    const result = await parseIntakeMessage(longMessage, { mode: 'heuristic' })
    expect(result.intents[0].summary.length).toBeLessThanOrEqual(2000)
  })

  it('does not produce duplicate intent types for repeated keywords', async () => {
    const result = await parseIntakeMessage('バグ バグ バグ', { mode: 'heuristic' })
    const types = result.intents.map((i) => i.intentType)
    const uniqueTypes = new Set(types)
    expect(types.length).toBe(uniqueTypes.size)
  })
})

// ---------------------------------------------------------------------------
// Auto mode – falls back to heuristic on Anthropic error
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – auto mode fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to heuristic parser when Anthropic API throws', async () => {
    vi.mocked(sendMessage).mockRejectedValue(new Error('API timeout'))

    const result = await parseIntakeMessage('バグです', { mode: 'auto' })

    expect(result.parser).toBe('heuristic')
    expect(result.intents.map((i) => i.intentType)).toContain('bug_report')
  })

  it('falls back to heuristic when AI returns no valid intents', async () => {
    vi.mocked(sendMessage).mockResolvedValue('{}')
    vi.mocked(parseJsonFromResponse).mockReturnValue({ intents: [], message_summary: '' })

    const result = await parseIntakeMessage('バグです', { mode: 'auto' })

    expect(result.parser).toBe('heuristic')
    expect(result.intents.map((i) => i.intentType)).toContain('bug_report')
  })
})

// ---------------------------------------------------------------------------
// Auto mode – successful AI parse
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – auto mode (Anthropic success)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns anthropic parser result when AI parse succeeds with valid intents', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'bug_report',
          title: 'ログインバグ',
          summary: 'ログインが失敗する',
          priority_hint: 'high',
          due_date: '2026-04-01',
          details: { summary: 'ログインが失敗する', affected_users: '全員' },
          confidence: 0.9,
        },
      ],
      message_summary: 'ログインに関するバグ報告',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('ログインができません', { mode: 'auto' })

    expect(result.parser).toBe('anthropic')
    expect(result.intents).toHaveLength(1)
    expect(result.intents[0].intentType).toBe('bug_report')
    expect(result.intents[0].title).toBe('ログインバグ')
    expect(result.intents[0].summary).toBe('ログインが失敗する')
    expect(result.intents[0].priorityHint).toBe('high')
    expect(result.intents[0].dueDate).toBe('2026-04-01')
    expect(result.intents[0].confidence).toBe(0.9)
    expect(result.messageSummary).toBe('ログインに関するバグ報告')
    expect(result.intents[0].category).toBe('bug_report')
  })

  it('handles multiple AI intents including all known intent types', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'fix_request',
          title: '修正依頼',
          summary: '動作修正',
          priority_hint: 'medium',
          due_date: null,
          details: {},
          confidence: 0.8,
        },
        {
          intent_type: 'scope_change',
          title: '範囲変更',
          summary: 'スコープ変更',
          priority_hint: 'low',
          due_date: null,
          details: {},
          confidence: 0.7,
        },
      ],
      message_summary: '複数の依頼',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('修正とスコープ変更', { mode: 'auto' })

    expect(result.parser).toBe('anthropic')
    expect(result.intents).toHaveLength(2)
    const types = result.intents.map((i) => i.intentType)
    expect(types).toContain('fix_request')
    expect(types).toContain('scope_change')
  })

  it('sanitizes intents with missing optional fields', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'feature_addition',
          // no title, no summary, no priority_hint, no due_date, no details, no confidence
        },
      ],
      message_summary: '機能追加',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('機能追加の依頼', { mode: 'auto' })

    expect(result.parser).toBe('anthropic')
    expect(result.intents).toHaveLength(1)
    expect(result.intents[0].intentType).toBe('feature_addition')
    // title falls back to summary slice
    expect(typeof result.intents[0].title).toBe('string')
    // priority defaults to medium
    expect(result.intents[0].priorityHint).toBe('medium')
    // dueDate defaults to null
    expect(result.intents[0].dueDate).toBeNull()
    // confidence defaults to 0.5
    expect(result.intents[0].confidence).toBe(0.5)
    // details defaults to empty object with summary added
    expect(result.intents[0].details).toHaveProperty('summary')
  })

  it('skips intent items with unknown intent_type', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'unknown_type_xyz',
          title: '不明な意図',
          summary: 'unknown',
          confidence: 0.5,
        },
        {
          intent_type: 'bug_report',
          title: 'バグ',
          summary: 'ログインバグ',
          confidence: 0.8,
        },
      ],
      message_summary: 'テスト',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('テスト', { mode: 'auto' })

    expect(result.parser).toBe('anthropic')
    expect(result.intents).toHaveLength(1)
    expect(result.intents[0].intentType).toBe('bug_report')
  })

  it('handles AI response with non-array intents field gracefully', async () => {
    const aiResponse = {
      intents: 'not an array',
      message_summary: 'broken response',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse as unknown as typeof aiResponse)

    // sanitizeIntents returns [] for non-array → falls back to heuristic
    const result = await parseIntakeMessage('バグです', { mode: 'auto' })

    expect(result.parser).toBe('heuristic')
  })

  it('clamps confidence values outside [0, 1] range', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'bug_report',
          title: 'バグ',
          summary: 'テスト',
          confidence: 1.5, // out of range
        },
        {
          intent_type: 'fix_request',
          title: '修正',
          summary: 'テスト',
          confidence: -0.3, // negative
        },
      ],
      message_summary: 'テスト',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('バグと修正', { mode: 'auto' })

    for (const intent of result.intents) {
      expect(intent.confidence).toBeGreaterThanOrEqual(0)
      expect(intent.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('truncates due_date to 50 characters', async () => {
    const longDate = '2026-03-31 very long additional text that exceeds fifty characters limit'
    const aiResponse = {
      intents: [
        {
          intent_type: 'bug_report',
          title: 'バグ',
          summary: 'テスト',
          due_date: longDate,
          confidence: 0.8,
        },
      ],
      message_summary: 'テスト',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('バグです', { mode: 'auto' })

    expect(result.intents[0].dueDate).toHaveLength(50)
  })

  it('normalizes details when AI returns an array (falls back to empty object)', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'bug_report',
          title: 'バグ',
          summary: 'テスト',
          details: ['not', 'an', 'object'],
          confidence: 0.7,
        },
      ],
      message_summary: 'テスト',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('バグです', { mode: 'auto' })

    // details should be normalized to empty object (array is excluded)
    expect(result.intents[0].details).toEqual({ summary: 'テスト' })
  })

  it('adds summary to details when details.summary is missing', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'bug_report',
          title: 'バグ',
          summary: 'ログインできない',
          details: { affected_users: '全員' },
          confidence: 0.8,
        },
      ],
      message_summary: 'テスト',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('バグです', { mode: 'auto' })

    expect(result.intents[0].details.summary).toBe('ログインできない')
    expect(result.intents[0].details.affected_users).toBe('全員')
  })

  it('does not overwrite existing details.summary', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'bug_report',
          title: 'バグ',
          summary: 'ログインできない',
          details: { summary: 'すでにある要約' },
          confidence: 0.8,
        },
      ],
      message_summary: 'テスト',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('バグです', { mode: 'auto' })

    expect(result.intents[0].details.summary).toBe('すでにある要約')
  })
})

// ---------------------------------------------------------------------------
// INTENT_TYPE_MAP – all known intent types are valid
// ---------------------------------------------------------------------------

describe('INTENT_TYPE_MAP – all known intent types accepted by AI parser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const allIntentTypes = [
    'bug_report',
    'fix_request',
    'feature_addition',
    'scope_change',
    'account_task',
    'billing_risk',
    'other',
  ]

  for (const intentType of allIntentTypes) {
    it(`accepts intent_type "${intentType}" from AI response`, async () => {
      const aiResponse = {
        intents: [
          {
            intent_type: intentType,
            title: `テスト (${intentType})`,
            summary: `${intentType}のテスト`,
            confidence: 0.75,
          },
        ],
        message_summary: 'テスト',
      }

      vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
      vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

      const result = await parseIntakeMessage('テスト', { mode: 'auto' })

      expect(result.parser).toBe('anthropic')
      expect(result.intents[0].intentType).toBe(intentType)
    })
  }
})

// ---------------------------------------------------------------------------
// Priority normalization
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – priority normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const validPriorities = ['low', 'medium', 'high', 'critical']

  for (const priority of validPriorities) {
    it(`accepts valid priority "${priority}" from AI response`, async () => {
      const aiResponse = {
        intents: [
          {
            intent_type: 'bug_report',
            title: 'バグ',
            summary: 'テスト',
            priority_hint: priority,
            confidence: 0.8,
          },
        ],
        message_summary: 'テスト',
      }

      vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
      vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

      const result = await parseIntakeMessage('バグ', { mode: 'auto' })

      expect(result.intents[0].priorityHint).toBe(priority)
    })
  }

  it('defaults priority to "medium" for unknown priority values', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'bug_report',
          title: 'バグ',
          summary: 'テスト',
          priority_hint: 'unknown_priority',
          confidence: 0.8,
        },
      ],
      message_summary: 'テスト',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('バグ', { mode: 'auto' })

    expect(result.intents[0].priorityHint).toBe('medium')
  })

  it('defaults priority to "medium" for non-string priority_hint', async () => {
    const aiResponse = {
      intents: [
        {
          intent_type: 'bug_report',
          title: 'バグ',
          summary: 'テスト',
          priority_hint: 42, // number instead of string
          confidence: 0.8,
        },
      ],
      message_summary: 'テスト',
    }

    vi.mocked(sendMessage).mockResolvedValue(JSON.stringify(aiResponse))
    vi.mocked(parseJsonFromResponse).mockReturnValue(aiResponse)

    const result = await parseIntakeMessage('バグ', { mode: 'auto' })

    expect(result.intents[0].priorityHint).toBe('medium')
  })
})

// ---------------------------------------------------------------------------
// resolveParserMode – environment variable
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – resolveParserMode env var', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.PO_INTAKE_PARSER_MODE
  })

  it('uses heuristic mode when PO_INTAKE_PARSER_MODE=heuristic is set', async () => {
    process.env.PO_INTAKE_PARSER_MODE = 'heuristic'

    // No mode option passed → should resolve from env
    const result = await parseIntakeMessage('バグです')

    expect(result.parser).toBe('heuristic')
    // sendMessage should NOT be called since we're in heuristic mode
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled()
  })

  it('falls back to auto mode when env var is not "heuristic"', async () => {
    process.env.PO_INTAKE_PARSER_MODE = 'auto'
    vi.mocked(sendMessage).mockRejectedValue(new Error('API error'))

    const result = await parseIntakeMessage('バグです')

    // auto mode → tries Anthropic → fails → heuristic fallback
    expect(result.parser).toBe('heuristic')
  })

  it('explicit mode option overrides env var', async () => {
    process.env.PO_INTAKE_PARSER_MODE = 'auto'

    const result = await parseIntakeMessage('バグです', { mode: 'heuristic' })

    expect(result.parser).toBe('heuristic')
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Completeness integration – heuristic intents are always incomplete
// ---------------------------------------------------------------------------

describe('parseIntakeMessage – heuristic intents are structurally incomplete', () => {
  it('bug_report heuristic intent is missing required fields', async () => {
    const result = await parseIntakeMessage('バグです', { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'bug_report')!
    // Required fields for bug_report: environment, repro_steps, expected_behavior,
    // actual_behavior, impact_scope, urgency, evidence
    const requiredFields = [
      'environment', 'repro_steps', 'expected_behavior',
      'actual_behavior', 'impact_scope', 'urgency', 'evidence',
    ]
    for (const field of requiredFields) {
      expect(intent.details[field]).toBeUndefined()
    }
  })

  it('feature_addition heuristic intent summary is set from message', async () => {
    const message = '機能を追加してください'
    const result = await parseIntakeMessage(message, { mode: 'heuristic' })
    const intent = result.intents.find((i) => i.intentType === 'feature_addition')!
    expect(intent.summary).toBe(message)
    expect(intent.details.summary).toBe(message)
  })
})
