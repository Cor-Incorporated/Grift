import {
  logApiUsage,
  prepareApiUsage,
  type UsageCallContext,
  isExternalApiQuotaError,
} from '@/lib/usage/api-usage'

export type XaiRole = 'system' | 'user' | 'assistant'

export interface XaiMessage {
  role: XaiRole
  content: string
}

export type XaiSearchTool = 'web_search' | 'x_search'

export interface XaiCitation {
  id?: string
  url: string
  type: 'web' | 'x' | 'unknown'
  startIndex?: number
  endIndex?: number
}

export interface XaiUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  costUsdTicks?: number
}

export interface XaiResponse {
  text: string
  citations: XaiCitation[]
  usage: XaiUsage
  raw: unknown
}

interface XaiRequestOptions {
  model?: string
  reasoningEffort?: 'low' | 'medium' | 'high'
  tools?: XaiSearchTool[]
  timeoutMs?: number
  temperature?: number
  maxOutputTokens?: number
  usageContext?: UsageCallContext
}

interface UnknownRecord {
  [key: string]: unknown
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getNestedString(record: UnknownRecord, key: string): string {
  return typeof record[key] === 'string' ? (record[key] as string) : ''
}

function extractOutputText(raw: unknown): string {
  if (!isRecord(raw)) {
    return ''
  }

  const output = raw.output
  if (Array.isArray(output)) {
    const chunks: string[] = []
    for (const item of output) {
      if (!isRecord(item)) {
        continue
      }
      if (item.type !== 'message') {
        continue
      }
      const content = item.content
      if (!Array.isArray(content)) {
        continue
      }
      for (const block of content) {
        if (!isRecord(block)) {
          continue
        }
        if (block.type === 'output_text') {
          const text = toStringOrEmpty(block.text)
          if (text) {
            chunks.push(text)
          }
        }
      }
    }

    if (chunks.length > 0) {
      return chunks.join('\n')
    }
  }

  if (Array.isArray(raw.choices) && raw.choices.length > 0) {
    const firstChoice = raw.choices[0]
    if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
      return toStringOrEmpty(firstChoice.message.content)
    }
  }

  if (typeof raw.text === 'string') {
    return raw.text
  }

  return ''
}

function normalizeCitation(citation: unknown): XaiCitation | null {
  if (typeof citation === 'string' && citation.trim().length > 0) {
    return {
      url: citation,
      type: 'unknown',
    }
  }

  if (!isRecord(citation)) {
    return null
  }

  const webCitation = isRecord(citation.web_citation) ? citation.web_citation : null
  if (webCitation) {
    const url = getNestedString(webCitation, 'url')
    if (url) {
      return {
        id: typeof citation.id === 'number' || typeof citation.id === 'string'
          ? String(citation.id)
          : undefined,
        url,
        type: 'web',
        startIndex: typeof citation.start_index === 'number' ? citation.start_index : undefined,
        endIndex: typeof citation.end_index === 'number' ? citation.end_index : undefined,
      }
    }
  }

  const xCitation = isRecord(citation.x_citation) ? citation.x_citation : null
  if (xCitation) {
    const url = getNestedString(xCitation, 'url')
    if (url) {
      return {
        id: typeof citation.id === 'number' || typeof citation.id === 'string'
          ? String(citation.id)
          : undefined,
        url,
        type: 'x',
        startIndex: typeof citation.start_index === 'number' ? citation.start_index : undefined,
        endIndex: typeof citation.end_index === 'number' ? citation.end_index : undefined,
      }
    }
  }

  if (typeof citation.url === 'string') {
    return {
      id: typeof citation.id === 'number' || typeof citation.id === 'string'
        ? String(citation.id)
        : undefined,
      url: citation.url,
      type: 'unknown',
    }
  }

  return null
}

function extractCitations(raw: unknown): XaiCitation[] {
  if (!isRecord(raw)) {
    return []
  }

  const citations: XaiCitation[] = []

  if (Array.isArray(raw.inline_citations)) {
    for (const item of raw.inline_citations) {
      const normalized = normalizeCitation(item)
      if (normalized) {
        citations.push(normalized)
      }
    }
  }

  if (Array.isArray(raw.sources)) {
    for (const source of raw.sources) {
      const normalized = normalizeCitation(source)
      if (normalized) {
        citations.push(normalized)
      }
    }
  }

  const output = raw.output
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!isRecord(item) || !Array.isArray(item.content)) {
        continue
      }
      for (const block of item.content) {
        if (!isRecord(block) || !Array.isArray(block.annotations)) {
          continue
        }
        for (const annotation of block.annotations) {
          const normalized = normalizeCitation(annotation)
          if (normalized) {
            citations.push(normalized)
          }
        }
      }
    }
  }

  if (Array.isArray(raw.citations)) {
    for (const item of raw.citations) {
      const normalized = normalizeCitation(item)
      if (normalized) {
        citations.push(normalized)
      }
    }
  }

  const deduped = new Map<string, XaiCitation>()
  for (const citation of citations) {
    deduped.set(citation.url, citation)
  }

  return [...deduped.values()]
}

function extractUsage(raw: unknown): XaiUsage {
  if (!isRecord(raw) || !isRecord(raw.usage)) {
    return {}
  }

  const usage = raw.usage
  const outputTokensDetails = isRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : null
  const completionTokensDetails = isRecord(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : null

  return {
    inputTokens:
      typeof usage.input_tokens === 'number'
        ? usage.input_tokens
        : typeof usage.prompt_tokens === 'number'
          ? usage.prompt_tokens
          : undefined,
    outputTokens:
      typeof usage.output_tokens === 'number'
        ? usage.output_tokens
        : typeof usage.completion_tokens === 'number'
          ? usage.completion_tokens
          : undefined,
    reasoningTokens:
      outputTokensDetails && typeof outputTokensDetails.reasoning_tokens === 'number'
        ? outputTokensDetails.reasoning_tokens
        : completionTokensDetails && typeof completionTokensDetails.reasoning_tokens === 'number'
          ? completionTokensDetails.reasoning_tokens
        : typeof usage.reasoning_tokens === 'number'
          ? usage.reasoning_tokens
          : undefined,
    totalTokens:
      typeof usage.total_tokens === 'number'
        ? usage.total_tokens
        : undefined,
    costUsdTicks:
      typeof usage.cost_in_usd_ticks === 'number'
        ? usage.cost_in_usd_ticks
        : undefined,
  }
}

export function extractTextAndCitations(raw: unknown): Pick<XaiResponse, 'text' | 'citations' | 'usage'> {
  return {
    text: extractOutputText(raw),
    citations: extractCitations(raw),
    usage: extractUsage(raw),
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.slice(0, 1200)
  }
  return 'Unknown xAI API error'
}

export async function requestXaiResponse(
  messages: XaiMessage[],
  options?: XaiRequestOptions
): Promise<XaiResponse> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    throw new Error('XAI_API_KEY is not set')
  }

  const model = options?.model ?? process.env.XAI_MODEL ?? 'grok-4-1-fast'
  const timeoutMs = options?.timeoutMs ?? 60000
  const usage = await prepareApiUsage({
    sourceKey: 'xai_responses',
    provider: 'xai',
    endpoint: '/v1/responses',
    model,
    context: options?.usageContext,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: messages,
        tools: options?.tools?.map((tool) =>
          tool === 'x_search'
            ? { type: tool, enable_video_understanding: false }
            : { type: tool }
        ),
        reasoning: options?.reasoningEffort
          ? { effort: options.reasoningEffort }
          : undefined,
        temperature: options?.temperature,
        max_output_tokens: options?.maxOutputTokens,
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`xAI API error (${response.status}): ${text}`)
    }

    const raw = await response.json()
    const extracted = extractTextAndCitations(raw)

    if (!extracted.text) {
      throw new Error('No text response from xAI')
    }

    await logApiUsage(usage, {
      status: 'success',
      metrics: {
        inputTokens: extracted.usage.inputTokens,
        outputTokens: extracted.usage.outputTokens,
        reasoningTokens: extracted.usage.reasoningTokens,
        totalTokens: extracted.usage.totalTokens,
        reportedCostUsdTicks: extracted.usage.costUsdTicks,
      },
      metadata: {
        tool_count: options?.tools?.length ?? 0,
        citation_count: extracted.citations.length,
        reasoning_effort: options?.reasoningEffort ?? null,
      },
    })

    return {
      text: extracted.text,
      citations: extracted.citations,
      usage: extracted.usage,
      raw,
    }
  } catch (error) {
    if (!isExternalApiQuotaError(error)) {
      await logApiUsage(usage, {
        status: 'error',
        errorMessage: toErrorMessage(error),
        metadata: {
          tool_count: options?.tools?.length ?? 0,
          reasoning_effort: options?.reasoningEffort ?? null,
        },
      })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function sanitizeJsonStrings(text: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      // After a backslash, only valid JSON escape chars are: " \ / b f n r t u
      // If the char is not one of these, escape the backslash itself
      if (!'"\\/bfnrtu'.includes(ch)) {
        result += '\\'
      }
      result += ch
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      result += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (inString) {
      const code = ch.charCodeAt(0)
      // All control characters (0x00-0x1F) must be escaped in JSON strings
      if (code <= 0x1f) {
        switch (ch) {
          case '\n': result += '\\n'; break
          case '\r': result += '\\r'; break
          case '\t': result += '\\t'; break
          case '\b': result += '\\b'; break
          case '\f': result += '\\f'; break
          default: result += `\\u${code.toString(16).padStart(4, '0')}`; break
        }
        continue
      }
    }
    result += ch
  }
  return result
}

/** @deprecated Use sanitizeJsonStrings instead */
export const sanitizeJsonNewlines = sanitizeJsonStrings

function stripJsonStringField(text: string, fieldName: string): string {
  // Remove a string field and its value from JSON text using state machine
  // Handles the case where the field value contains complex content that breaks parsing
  const pattern = `"${fieldName}"`
  const fieldIndex = text.indexOf(pattern)
  if (fieldIndex === -1) return text

  // Find the colon after the field name
  let colonIndex = fieldIndex + pattern.length
  while (colonIndex < text.length && text[colonIndex] !== ':') colonIndex++
  if (colonIndex >= text.length) return text

  // Find the opening quote of the value
  let valueStart = colonIndex + 1
  while (valueStart < text.length && text[valueStart] !== '"') valueStart++
  if (valueStart >= text.length) return text

  // Find the closing quote of the value (respecting escapes)
  let valueEnd = valueStart + 1
  let esc = false
  while (valueEnd < text.length) {
    if (esc) { esc = false; valueEnd++; continue }
    if (text[valueEnd] === '\\') { esc = true; valueEnd++; continue }
    if (text[valueEnd] === '"') break
    valueEnd++
  }
  if (valueEnd >= text.length) return text

  // Remove the field: from before the key to after the value (including trailing comma if present)
  let removeStart = fieldIndex
  let removeEnd = valueEnd + 1

  // Check for trailing comma
  let afterValue = removeEnd
  while (afterValue < text.length && ' \t\n\r'.includes(text[afterValue])) afterValue++
  if (afterValue < text.length && text[afterValue] === ',') {
    removeEnd = afterValue + 1
  } else {
    // Check for leading comma (when this is the last field)
    let beforeField = removeStart - 1
    while (beforeField >= 0 && ' \t\n\r'.includes(text[beforeField])) beforeField--
    if (beforeField >= 0 && text[beforeField] === ',') {
      removeStart = beforeField
    }
  }

  return text.slice(0, removeStart) + text.slice(removeEnd)
}

export function parseJsonFromResponse<T>(text: string): T {
  // 1. Try ```json ... ``` block extraction (non-greedy)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    try {
      return JSON.parse(sanitizeJsonStrings(jsonMatch[1])) as T
    } catch {
      // Non-greedy match may have caught inner ```, try next strategy
    }
  }

  // 2. Strip code fences from start/end and try parsing
  const stripped = text
    .replace(/^\s*```(?:json)?\s*\n?/, '')
    .replace(/\n?\s*```\s*$/, '')
    .trim()
  try {
    return JSON.parse(sanitizeJsonStrings(stripped)) as T
  } catch {
    // continue
  }

  // 3. Try parsing entire text as JSON
  try {
    return JSON.parse(sanitizeJsonStrings(text)) as T
  } catch {
    // continue
  }

  // 4. Extract JSON object using balanced brace matching
  const startIdx = text.indexOf('{')
  if (startIdx !== -1) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i]
      if (escaped) { escaped = false; continue }
      if (ch === '\\' && inString) { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (!inString) {
        if (ch === '{') depth++
        if (ch === '}') {
          depth--
          if (depth === 0) {
            try {
              return JSON.parse(sanitizeJsonStrings(text.slice(startIdx, i + 1))) as T
            } catch {
              break
            }
          }
        }
      }
    }
  }

  // 5. Last resort: strip problematic string fields and retry
  const fieldsToStrip = ['breakdown', 'description', 'summary']
  for (const field of fieldsToStrip) {
    if (text.includes(`"${field}"`)) {
      const cleaned = stripJsonStringField(text, field)
      if (cleaned !== text) {
        try {
          return JSON.parse(sanitizeJsonStrings(cleaned)) as T
        } catch {
          // continue to next field
        }
      }
    }
  }

  throw new SyntaxError(`No valid JSON found in response: ${text.slice(0, 200)}`)
}
