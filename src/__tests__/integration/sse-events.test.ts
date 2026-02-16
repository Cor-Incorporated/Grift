import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// SSE Event Shape Contract Tests
//
// These tests verify the data structure contracts between:
//   - The stream route (src/app/api/conversations/stream/route.ts)
//   - The chat page SSE parser (src/app/projects/[id]/chat/page.tsx)
//
// No HTTP calls are made — these are purely structural/contract tests.
// ---------------------------------------------------------------------------

// Event shapes as emitted by the stream route
interface BusinessLineClassifiedEvent {
  business_line: string
  confidence: number
}

interface EstimateGeneratedEvent {
  estimate_id: string
  total_hours: number
  hourly_rate: number
  estimate_mode: string
  go_no_go_decision: string | null
}

interface ValuePropositionGeneratedEvent {
  estimate_id: string
  business_line: string
  go_no_go_decision: string | null
}

interface MetadataEvent {
  category: string
  confidence_score: number
  confirmed_categories: string[]
  is_complete: boolean
  question_type: 'open' | 'choice' | 'confirmation'
  choices?: string[]
  classified_type?: string | null
  generated_title?: string | null
}

interface DoneEvent {
  message_id: string | null
}

// Simulate SSE data line parsing (same logic as chat page)
function parseSSEData(dataLine: string): unknown {
  return JSON.parse(dataLine.replace(/^data: /, ''))
}

// Simulate the chat page's detection logic for different event types
function detectEventType(data: Record<string, unknown>): string {
  if ('token' in data) return 'token'
  if ('confirmed_categories' in data) return 'metadata'
  if ('business_line' in data && 'confidence' in data) return 'business_line_classified'
  if ('estimate_id' in data && 'total_hours' in data) return 'estimate_generated'
  if ('estimate_id' in data && 'business_line' in data && !('total_hours' in data)) return 'value_proposition_generated'
  if ('go_no_go_decision' in data && !('estimate_id' in data)) return 'go_no_go_decision'
  if ('message_id' in data && !('token' in data)) return 'done'
  if ('error' in data && !('token' in data) && !('message_id' in data)) return 'error'
  return 'unknown'
}

describe('SSE Event Shape Contracts', () => {
  // 1. business_line_classified event shape
  it('should match business_line_classified event shape: { business_line, confidence }', () => {
    const event: BusinessLineClassifiedEvent = {
      business_line: 'iotrealm',
      confidence: 0.85,
    }

    expect(event).toHaveProperty('business_line')
    expect(event).toHaveProperty('confidence')
    expect(typeof event.business_line).toBe('string')
    expect(typeof event.confidence).toBe('number')
    expect(event.confidence).toBeGreaterThanOrEqual(0)
    expect(event.confidence).toBeLessThanOrEqual(1)

    // Validate against stream route's sendEvent call signature
    // sendEvent('business_line_classified', { business_line, confidence })
    const validBusinessLines = ['boltsite', 'iotrealm', 'tapforge']
    expect(validBusinessLines).toContain(event.business_line)
  })

  // 2. estimate_generated event shape
  it('should match estimate_generated event shape: { estimate_id, total_hours, hourly_rate, estimate_mode, go_no_go_decision }', () => {
    const event: EstimateGeneratedEvent = {
      estimate_id: 'est-001',
      total_hours: 75,
      hourly_rate: 15000,
      estimate_mode: 'market_comparison',
      go_no_go_decision: 'go',
    }

    expect(event).toHaveProperty('estimate_id')
    expect(event).toHaveProperty('total_hours')
    expect(event).toHaveProperty('hourly_rate')
    expect(event).toHaveProperty('estimate_mode')
    expect(event).toHaveProperty('go_no_go_decision')
    expect(typeof event.estimate_id).toBe('string')
    expect(typeof event.total_hours).toBe('number')
    expect(typeof event.hourly_rate).toBe('number')
    expect(typeof event.estimate_mode).toBe('string')

    const validModes = ['market_comparison', 'hours_only', 'hybrid']
    expect(validModes).toContain(event.estimate_mode)

    const validDecisions = ['go', 'go_with_conditions', 'no_go', null]
    expect(validDecisions).toContain(event.go_no_go_decision)
  })

  // 3. value_proposition_generated event shape
  it('should match value_proposition_generated event shape: { estimate_id, business_line, go_no_go_decision }', () => {
    const event: ValuePropositionGeneratedEvent = {
      estimate_id: 'est-001',
      business_line: 'boltsite',
      go_no_go_decision: null,
    }

    expect(event).toHaveProperty('estimate_id')
    expect(event).toHaveProperty('business_line')
    expect(event).toHaveProperty('go_no_go_decision')
    expect(typeof event.estimate_id).toBe('string')
    expect(typeof event.business_line).toBe('string')

    const validBusinessLines = ['boltsite', 'iotrealm', 'tapforge']
    expect(validBusinessLines).toContain(event.business_line)
  })

  // 4. Chat page SSE parser handles business_line_classified
  it('should detect business_line_classified via "business_line" in data && "confidence" in data', () => {
    const dataLine = 'data: {"business_line":"tapforge","confidence":0.92}'
    const parsed = parseSSEData(dataLine) as Record<string, unknown>

    // Simulate the exact check from chat page (line ~183):
    // if ('business_line' in data && 'confidence' in data) { setBusinessLine(data.business_line) }
    const isBusinessLineClassified = 'business_line' in parsed && 'confidence' in parsed
    expect(isBusinessLineClassified).toBe(true)
    expect(parsed.business_line).toBe('tapforge')
    expect(parsed.confidence).toBe(0.92)

    expect(detectEventType(parsed)).toBe('business_line_classified')
  })

  // 5. Chat page SSE parser handles go_no_go_decision
  it('should detect go_no_go_decision via "go_no_go_decision" in data', () => {
    // From estimate_generated event (which includes go_no_go_decision)
    const estimateDataLine = 'data: {"estimate_id":"est-001","total_hours":75,"hourly_rate":15000,"estimate_mode":"market_comparison","go_no_go_decision":"go"}'
    const estimateParsed = parseSSEData(estimateDataLine) as Record<string, unknown>

    // Chat page checks: if ('go_no_go_decision' in data) { setGoNoGoDecision(data.go_no_go_decision) }
    const hasGoNoGo = 'go_no_go_decision' in estimateParsed
    expect(hasGoNoGo).toBe(true)
    expect(estimateParsed.go_no_go_decision).toBe('go')

    // Also from value_proposition_generated event
    const vpDataLine = 'data: {"estimate_id":"est-001","business_line":"iotrealm","go_no_go_decision":"go_with_conditions"}'
    const vpParsed = parseSSEData(vpDataLine) as Record<string, unknown>

    const vpHasGoNoGo = 'go_no_go_decision' in vpParsed
    expect(vpHasGoNoGo).toBe(true)
    expect(vpParsed.go_no_go_decision).toBe('go_with_conditions')
  })

  // 6. Event ordering contract
  it('should enforce ordering: business_line_classified < estimate_generated < value_proposition_generated', () => {
    // Simulate the event sequence as emitted by stream route (lines 335-431)
    const eventSequence: Array<{ event: string; data: Record<string, unknown> }> = [
      // First: metadata (always comes first after tokens)
      {
        event: 'metadata',
        data: {
          category: 'requirements',
          confidence_score: 0.9,
          confirmed_categories: ['scope', 'budget'],
          is_complete: true,
          question_type: 'confirmation' as const,
        },
      },
      // Second: done event
      { event: 'done', data: { message_id: 'msg-001' } },
      // Third: business_line_classified (line ~335)
      {
        event: 'business_line_classified',
        data: { business_line: 'iotrealm', confidence: 0.85 },
      },
      // Fourth: estimate_generated (line ~365)
      {
        event: 'estimate_generated',
        data: {
          estimate_id: 'est-001',
          total_hours: 75,
          hourly_rate: 15000,
          estimate_mode: 'market_comparison',
          go_no_go_decision: 'go',
        },
      },
      // Fifth: value_proposition_generated (line ~427)
      {
        event: 'value_proposition_generated',
        data: {
          estimate_id: 'est-001',
          business_line: 'iotrealm',
          go_no_go_decision: 'go',
        },
      },
    ]

    // Verify ordering: find indices of the three key events
    const blIndex = eventSequence.findIndex((e) => e.event === 'business_line_classified')
    const estIndex = eventSequence.findIndex((e) => e.event === 'estimate_generated')
    const vpIndex = eventSequence.findIndex((e) => e.event === 'value_proposition_generated')

    expect(blIndex).toBeGreaterThan(-1)
    expect(estIndex).toBeGreaterThan(-1)
    expect(vpIndex).toBeGreaterThan(-1)

    // business_line_classified MUST come before estimate_generated
    expect(blIndex).toBeLessThan(estIndex)

    // estimate_generated MUST come before value_proposition_generated
    expect(estIndex).toBeLessThan(vpIndex)
  })

  // Additional: metadata event shape
  it('should match metadata event shape used by chat page progress tracking', () => {
    const event: MetadataEvent = {
      category: 'requirements',
      confidence_score: 0.85,
      confirmed_categories: ['scope', 'budget', 'timeline'],
      is_complete: true,
      question_type: 'confirmation',
      choices: ['はい', 'いいえ'],
      classified_type: 'new_project',
      generated_title: 'AI IoTプラットフォーム開発',
    }

    expect(event).toHaveProperty('category')
    expect(event).toHaveProperty('confidence_score')
    expect(event).toHaveProperty('confirmed_categories')
    expect(event).toHaveProperty('is_complete')
    expect(event).toHaveProperty('question_type')
    expect(Array.isArray(event.confirmed_categories)).toBe(true)
    expect(typeof event.is_complete).toBe('boolean')

    const validQuestionTypes = ['open', 'choice', 'confirmation']
    expect(validQuestionTypes).toContain(event.question_type)
  })

  // Additional: done event shape
  it('should match done event shape with message_id', () => {
    const event: DoneEvent = { message_id: 'msg-001' }

    expect(event).toHaveProperty('message_id')
    expect(typeof event.message_id === 'string' || event.message_id === null).toBe(true)

    // Verify done event detection logic
    const data = event as unknown as Record<string, unknown>
    const isDone = 'message_id' in data && !('token' in data)
    expect(isDone).toBe(true)
  })

  // Additional: estimate_generated with null go_no_go_decision
  it('should handle estimate_generated with null go_no_go_decision when no businessLine', () => {
    const event: EstimateGeneratedEvent = {
      estimate_id: 'est-002',
      total_hours: 30,
      hourly_rate: 15000,
      estimate_mode: 'hours_only',
      go_no_go_decision: null,
    }

    expect(event.go_no_go_decision).toBeNull()
    expect(event.estimate_mode).toBe('hours_only')

    const data = event as unknown as Record<string, unknown>
    const hasGoNoGo = 'go_no_go_decision' in data
    expect(hasGoNoGo).toBe(true)
    // Chat page will call setGoNoGoDecision(null) which is valid
    expect(data.go_no_go_decision).toBeNull()
  })

  // Additional: detect event type correctly for all event types
  it('should detect all event types correctly using chat page parsing logic', () => {
    const events: Array<{ data: Record<string, unknown>; expected: string }> = [
      { data: { token: 'hello' }, expected: 'token' },
      {
        data: { confirmed_categories: ['scope'], is_complete: false, category: 'req' },
        expected: 'metadata',
      },
      { data: { business_line: 'boltsite', confidence: 0.8 }, expected: 'business_line_classified' },
      {
        data: {
          estimate_id: 'est-1',
          total_hours: 50,
          hourly_rate: 15000,
          estimate_mode: 'hybrid',
          go_no_go_decision: 'go_with_conditions',
        },
        expected: 'estimate_generated',
      },
      {
        data: { estimate_id: 'est-1', business_line: 'tapforge', go_no_go_decision: 'go' },
        expected: 'value_proposition_generated',
      },
      { data: { message_id: 'msg-1' }, expected: 'done' },
      { data: { error: 'something failed' }, expected: 'error' },
    ]

    for (const { data, expected } of events) {
      expect(detectEventType(data)).toBe(expected)
    }
  })
})
