import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock state — must use vi.hoisted so values are available when the
// vi.mock() factories run (which are hoisted above all imports).
// ---------------------------------------------------------------------------

const {
  mockCreate,
  mockStreamOn,
  mockStreamFinalMessage,
  mockStreamAbort,
  mockPrepareApiUsage,
  mockLogApiUsage,
  mockIsExternalApiQuotaError,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockStreamOn: vi.fn(),
  mockStreamFinalMessage: vi.fn(),
  mockStreamAbort: vi.fn(),
  mockPrepareApiUsage: vi.fn(),
  mockLogApiUsage: vi.fn(),
  mockIsExternalApiQuotaError: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => {
  const mockStream = {
    on: mockStreamOn,
    finalMessage: mockStreamFinalMessage,
    abort: mockStreamAbort,
  }

  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
      stream: vi.fn().mockReturnValue(mockStream),
    },
  }))

  return { default: Anthropic }
})

vi.mock('@/lib/usage/api-usage', () => ({
  prepareApiUsage: mockPrepareApiUsage,
  logApiUsage: mockLogApiUsage,
  isExternalApiQuotaError: mockIsExternalApiQuotaError,
}))

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  getAnthropicClient,
  sendMessage,
  sendMessageStream,
  sendVisionMessage,
  validateImageSize,
  validatePdfSize,
  buildImageBlock,
  buildDocumentBlock,
} from '@/lib/ai/anthropic'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeUsageHandle() {
  return { id: 'usage-handle' }
}

function makeSuccessResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

// ---------------------------------------------------------------------------
// getAnthropicClient
// ---------------------------------------------------------------------------

describe('getAnthropicClient', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-api-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns an Anthropic client when ANTHROPIC_API_KEY is set', () => {
    const client = getAnthropicClient()
    expect(client).toBeDefined()
    expect(client.messages).toBeDefined()
  })

  it('returns the same instance on subsequent calls (singleton)', () => {
    const first = getAnthropicClient()
    const second = getAnthropicClient()
    expect(first).toBe(second)
  })
})

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

describe('sendMessage', () => {
  const usageHandle = makeUsageHandle()

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-api-key')
    mockPrepareApiUsage.mockReset()
    mockLogApiUsage.mockReset()
    mockIsExternalApiQuotaError.mockReset()
    mockPrepareApiUsage.mockResolvedValue(usageHandle)
    mockLogApiUsage.mockResolvedValue(undefined)
    mockIsExternalApiQuotaError.mockReturnValue(false)
    mockCreate.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns text from a successful response', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('Hello, world!'))

    const result = await sendMessage('System prompt', [{ role: 'user', content: 'Hi' }])

    expect(result).toBe('Hello, world!')
  })

  it('calls prepareApiUsage with correct parameters', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendMessage('sys', [{ role: 'user', content: 'msg' }], {
      model: 'custom-model',
      usageContext: { projectId: 'proj-1' },
    })

    expect(mockPrepareApiUsage).toHaveBeenCalledWith({
      sourceKey: 'anthropic_messages',
      provider: 'anthropic',
      endpoint: '/v1/messages',
      model: 'custom-model',
      context: { projectId: 'proj-1' },
    })
  })

  it('uses ANTHROPIC_MODEL env var when no model option is provided', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'env-model')
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendMessage('sys', [{ role: 'user', content: 'msg' }])

    expect(mockPrepareApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'env-model' })
    )
  })

  it('falls back to default model when no env var is set', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-api-key')
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendMessage('sys', [{ role: 'user', content: 'msg' }])

    expect(mockPrepareApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-5-20250929' })
    )
  })

  it('forwards maxTokens and temperature to the SDK', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendMessage('sys', [{ role: 'user', content: 'msg' }], {
      maxTokens: 512,
      temperature: 0.2,
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 512,
        temperature: 0.2,
      })
    )
  })

  it('defaults max_tokens to 4096 and temperature to 0.7 when not specified', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendMessage('sys', [{ role: 'user', content: 'msg' }])

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 4096,
        temperature: 0.7,
      })
    )
  })

  it('logs success usage after a successful call', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok', 15, 25))

    await sendMessage('sys', [{ role: 'user', content: 'msg' }])

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'success',
        metrics: { inputTokens: 15, outputTokens: 25 },
      })
    )
  })

  it('includes metadata with max_tokens in usage log', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendMessage('sys', [{ role: 'user', content: 'msg' }], { maxTokens: 2048 })

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        metadata: { max_tokens: 2048 },
      })
    )
  })

  it('defaults max_tokens to 4096 in usage log when not specified', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendMessage('sys', [{ role: 'user', content: 'msg' }])

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        metadata: { max_tokens: 4096 },
      })
    )
  })

  it('throws and logs error when no text block is in the response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu-1' }],
      usage: { input_tokens: 5, output_tokens: 0 },
    })

    await expect(
      sendMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toThrow('No text response from Claude')

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({ status: 'error' })
    )
  })

  it('throws and logs error when the SDK throws a regular Error', async () => {
    mockCreate.mockRejectedValue(new Error('Network failure'))

    await expect(
      sendMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toThrow('Network failure')

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Network failure',
      })
    )
  })

  it('uses "Unknown Anthropic API error" when error has empty message', async () => {
    const emptyError = new Error('   ')
    mockCreate.mockRejectedValue(emptyError)

    await expect(
      sendMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toThrow()

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Unknown Anthropic API error',
      })
    )
  })

  it('uses "Unknown Anthropic API error" for non-Error throws', async () => {
    mockCreate.mockRejectedValue('string error')

    await expect(
      sendMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toBe('string error')

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Unknown Anthropic API error',
      })
    )
  })

  it('does NOT log usage when the error is an ExternalApiQuotaError', async () => {
    mockIsExternalApiQuotaError.mockReturnValue(true)
    mockCreate.mockRejectedValue(new Error('Quota exceeded'))

    await expect(
      sendMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toThrow('Quota exceeded')

    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })

  it('uses undefined for token counts when usage fields are not numbers', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 'bad', output_tokens: null },
    })

    await sendMessage('sys', [{ role: 'user', content: 'msg' }])

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        metrics: { inputTokens: undefined, outputTokens: undefined },
      })
    )
  })

  it('truncates error messages longer than 1200 characters', async () => {
    const longMessage = 'x'.repeat(1500)
    mockCreate.mockRejectedValue(new Error(longMessage))

    await expect(
      sendMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toThrow()

    const call = mockLogApiUsage.mock.calls[0]
    expect(call[1].errorMessage).toHaveLength(1200)
  })

  it('passes the system prompt to the SDK', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendMessage('My system prompt', [{ role: 'user', content: 'msg' }])

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'My system prompt' })
    )
  })

  it('passes messages array to the SDK', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there' },
      { role: 'user' as const, content: 'More?' },
    ]

    await sendMessage('sys', messages)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ messages })
    )
  })
})

// ---------------------------------------------------------------------------
// sendMessageStream
// ---------------------------------------------------------------------------

describe('sendMessageStream', () => {
  const usageHandle = makeUsageHandle()

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-api-key')
    mockPrepareApiUsage.mockReset()
    mockLogApiUsage.mockReset()
    mockIsExternalApiQuotaError.mockReset()
    mockPrepareApiUsage.mockResolvedValue(usageHandle)
    mockLogApiUsage.mockResolvedValue(undefined)
    mockIsExternalApiQuotaError.mockReturnValue(false)
    mockCreate.mockReset()

    // Default stream behaviour: fire two text events then resolve finalMessage
    mockStreamOn.mockImplementation((event: string, handler: (t: string) => void) => {
      if (event === 'text') {
        handler('Hello')
        handler(', stream!')
      }
      return {
        on: mockStreamOn,
        finalMessage: mockStreamFinalMessage,
        abort: mockStreamAbort,
      }
    })
    mockStreamFinalMessage.mockResolvedValue({
      usage: { input_tokens: 30, output_tokens: 40 },
    })
    mockStreamAbort.mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns concatenated text from stream events', async () => {
    const result = await sendMessageStream('sys', [{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello, stream!')
  })

  it('calls onToken callback for each token', async () => {
    const onToken = vi.fn()

    await sendMessageStream('sys', [{ role: 'user', content: 'hi' }], { onToken })

    expect(onToken).toHaveBeenCalledWith('Hello')
    expect(onToken).toHaveBeenCalledWith(', stream!')
  })

  it('logs success usage with streaming: true after completion', async () => {
    await sendMessageStream('sys', [{ role: 'user', content: 'hi' }])

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'success',
        metrics: { inputTokens: 30, outputTokens: 40 },
        metadata: expect.objectContaining({ streaming: true }),
      })
    )
  })

  it('calls abort() on the stream when the AbortSignal fires', async () => {
    const controller = new AbortController()

    mockStreamFinalMessage.mockImplementation(async () => {
      controller.abort()
      return { usage: { input_tokens: 5, output_tokens: 5 } }
    })

    await sendMessageStream('sys', [{ role: 'user', content: 'hi' }], {
      signal: controller.signal,
    })

    expect(mockStreamAbort).toHaveBeenCalled()
  })

  it('throws and logs error when stream.finalMessage rejects', async () => {
    mockStreamFinalMessage.mockRejectedValue(new Error('Stream failed'))

    await expect(
      sendMessageStream('sys', [{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('Stream failed')

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Stream failed',
        metadata: expect.objectContaining({ streaming: true }),
      })
    )
  })

  it('does NOT log usage when the error is an ExternalApiQuotaError', async () => {
    mockIsExternalApiQuotaError.mockReturnValue(true)
    mockStreamFinalMessage.mockRejectedValue(new Error('Quota'))

    await expect(
      sendMessageStream('sys', [{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('Quota')

    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })

  it('uses undefined token counts when usage fields are not numbers', async () => {
    mockStreamFinalMessage.mockResolvedValue({
      usage: { input_tokens: 'x', output_tokens: undefined },
    })

    await sendMessageStream('sys', [{ role: 'user', content: 'hi' }])

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        metrics: { inputTokens: undefined, outputTokens: undefined },
      })
    )
  })

  it('returns empty string when no text events fire', async () => {
    mockStreamOn.mockImplementation(() => ({
      on: mockStreamOn,
      finalMessage: mockStreamFinalMessage,
      abort: mockStreamAbort,
    }))

    const result = await sendMessageStream('sys', [{ role: 'user', content: 'hi' }])
    expect(result).toBe('')
  })

  it('calls prepareApiUsage with model from options', async () => {
    await sendMessageStream('sys', [{ role: 'user', content: 'hi' }], {
      model: 'custom-stream-model',
    })

    expect(mockPrepareApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'custom-stream-model' })
    )
  })

  it('uses "Unknown Anthropic API error" for non-Error stream failures', async () => {
    mockStreamFinalMessage.mockRejectedValue('plain string error')

    await expect(
      sendMessageStream('sys', [{ role: 'user', content: 'hi' }])
    ).rejects.toBe('plain string error')

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Unknown Anthropic API error',
      })
    )
  })

  it('includes max_tokens in streaming metadata', async () => {
    await sendMessageStream('sys', [{ role: 'user', content: 'hi' }], { maxTokens: 1024 })

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        metadata: expect.objectContaining({ max_tokens: 1024, streaming: true }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// sendVisionMessage
// ---------------------------------------------------------------------------

describe('sendVisionMessage', () => {
  const usageHandle = makeUsageHandle()

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-api-key')
    mockPrepareApiUsage.mockReset()
    mockLogApiUsage.mockReset()
    mockIsExternalApiQuotaError.mockReset()
    mockPrepareApiUsage.mockResolvedValue(usageHandle)
    mockLogApiUsage.mockResolvedValue(undefined)
    mockIsExternalApiQuotaError.mockReturnValue(false)
    mockCreate.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns text from a successful vision response', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('Vision result', 50, 60))

    const result = await sendVisionMessage('sys', [
      { role: 'user', content: [{ type: 'text', text: 'Describe this image' }] },
    ])

    expect(result).toBe('Vision result')
  })

  it('logs success with vision: true in metadata', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok', 50, 60))

    await sendVisionMessage('sys', [{ role: 'user', content: 'describe' }])

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'success',
        metadata: expect.objectContaining({ vision: true }),
      })
    )
  })

  it('throws and logs error with vision: true when no text block returned', async () => {
    mockCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
    })

    await expect(
      sendVisionMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toThrow('No text response from Claude')

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'error',
        metadata: expect.objectContaining({ vision: true }),
      })
    )
  })

  it('does NOT log usage for ExternalApiQuotaError', async () => {
    mockIsExternalApiQuotaError.mockReturnValue(true)
    mockCreate.mockRejectedValue(new Error('Quota'))

    await expect(
      sendVisionMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toThrow('Quota')

    expect(mockLogApiUsage).not.toHaveBeenCalled()
  })

  it('passes messages with VisionContentBlock arrays through to the SDK', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    const imageBlock = {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        data: 'abc123',
        media_type: 'image/png' as const,
      },
    }

    await sendVisionMessage('sys', [{ role: 'user', content: [imageBlock] }])

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: [imageBlock] }],
      })
    )
  })

  it('uses custom model option for vision requests', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('ok'))

    await sendVisionMessage('sys', [{ role: 'user', content: 'img' }], {
      model: 'vision-model',
    })

    expect(mockPrepareApiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'vision-model' })
    )
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'vision-model' })
    )
  })

  it('logs error with vision: true in metadata when SDK throws', async () => {
    mockCreate.mockRejectedValue(new Error('API error'))

    await expect(
      sendVisionMessage('sys', [{ role: 'user', content: 'msg' }])
    ).rejects.toThrow('API error')

    expect(mockLogApiUsage).toHaveBeenCalledWith(
      usageHandle,
      expect.objectContaining({
        status: 'error',
        errorMessage: 'API error',
        metadata: expect.objectContaining({ vision: true }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// validateImageSize / validatePdfSize
// ---------------------------------------------------------------------------

describe('validateImageSize', () => {
  it('does not throw for a buffer under 5 MB', () => {
    const buf = Buffer.alloc(4 * 1024 * 1024)
    expect(() => validateImageSize(buf)).not.toThrow()
  })

  it('throws when the buffer exceeds 5 MB', () => {
    const buf = Buffer.alloc(5 * 1024 * 1024 + 1)
    expect(() => validateImageSize(buf)).toThrow('Image exceeds 5 MB limit')
  })

  it('does not throw for a buffer exactly at the 5 MB limit', () => {
    const buf = Buffer.alloc(5 * 1024 * 1024)
    expect(() => validateImageSize(buf)).not.toThrow()
  })
})

describe('validatePdfSize', () => {
  it('does not throw for a buffer under 32 MB', () => {
    const buf = Buffer.alloc(16 * 1024 * 1024)
    expect(() => validatePdfSize(buf)).not.toThrow()
  })

  it('throws when the buffer exceeds 32 MB', () => {
    const buf = Buffer.alloc(32 * 1024 * 1024 + 1)
    expect(() => validatePdfSize(buf)).toThrow('PDF exceeds 32 MB limit')
  })

  it('does not throw for a buffer exactly at the 32 MB limit', () => {
    const buf = Buffer.alloc(32 * 1024 * 1024)
    expect(() => validatePdfSize(buf)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// buildImageBlock / buildDocumentBlock
// ---------------------------------------------------------------------------

describe('buildImageBlock', () => {
  it('returns a well-formed ImageBlockParam', () => {
    const block = buildImageBlock('base64data==', 'image/jpeg')
    expect(block).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        data: 'base64data==',
        media_type: 'image/jpeg',
      },
    })
  })

  it('supports all valid media types', () => {
    const types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
    for (const mediaType of types) {
      const block = buildImageBlock('data', mediaType)
      expect((block.source as { media_type: string }).media_type).toBe(mediaType)
    }
  })
})

describe('buildDocumentBlock', () => {
  it('returns a well-formed DocumentBlockParam for a PDF', () => {
    const block = buildDocumentBlock('pdfbase64==')
    expect(block).toEqual({
      type: 'document',
      source: {
        type: 'base64',
        data: 'pdfbase64==',
        media_type: 'application/pdf',
      },
    })
  })
})
