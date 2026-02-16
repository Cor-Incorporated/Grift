import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlockParam,
  ImageBlockParam,
  DocumentBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages'
import {
  logApiUsage,
  prepareApiUsage,
  type UsageCallContext,
  isExternalApiQuotaError,
} from '@/lib/usage/api-usage'

let client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set')
    }
    client = new Anthropic({ apiKey })
  }
  return client
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function sendMessage(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: {
    maxTokens?: number
    temperature?: number
    model?: string
    usageContext?: UsageCallContext
  }
): Promise<string> {
  const anthropic = getAnthropicClient()
  const model = options?.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929'
  const usage = await prepareApiUsage({
    sourceKey: 'anthropic_messages',
    provider: 'anthropic',
    endpoint: '/v1/messages',
    model,
    context: options?.usageContext,
  })

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages,
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude')
    }

    await logApiUsage(usage, {
      status: 'success',
      metrics: {
        inputTokens:
          typeof response.usage.input_tokens === 'number'
            ? response.usage.input_tokens
            : undefined,
        outputTokens:
          typeof response.usage.output_tokens === 'number'
            ? response.usage.output_tokens
            : undefined,
      },
      metadata: {
        max_tokens: options?.maxTokens ?? 4096,
      },
    })

    return textBlock.text
  } catch (error) {
    if (!isExternalApiQuotaError(error)) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message.slice(0, 1200)
          : 'Unknown Anthropic API error'

      await logApiUsage(usage, {
        status: 'error',
        errorMessage: message,
        metadata: {
          max_tokens: options?.maxTokens ?? 4096,
        },
      })
    }
    throw error
  }
}

export async function sendMessageStream(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: {
    maxTokens?: number
    temperature?: number
    model?: string
    usageContext?: UsageCallContext
    onToken?: (token: string) => void
    signal?: AbortSignal
  }
): Promise<string> {
  const anthropic = getAnthropicClient()
  const model = options?.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929'
  const usage = await prepareApiUsage({
    sourceKey: 'anthropic_messages',
    provider: 'anthropic',
    endpoint: '/v1/messages',
    model,
    context: options?.usageContext,
  })

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages,
    })

    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        stream.abort()
      }, { once: true })
    }

    let fullText = ''

    stream.on('text', (text) => {
      fullText += text
      options?.onToken?.(text)
    })

    const finalMessage = await stream.finalMessage()

    await logApiUsage(usage, {
      status: 'success',
      metrics: {
        inputTokens:
          typeof finalMessage.usage.input_tokens === 'number'
            ? finalMessage.usage.input_tokens
            : undefined,
        outputTokens:
          typeof finalMessage.usage.output_tokens === 'number'
            ? finalMessage.usage.output_tokens
            : undefined,
      },
      metadata: {
        max_tokens: options?.maxTokens ?? 4096,
        streaming: true,
      },
    })

    return fullText
  } catch (error) {
    if (!isExternalApiQuotaError(error)) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message.slice(0, 1200)
          : 'Unknown Anthropic API error'

      await logApiUsage(usage, {
        status: 'error',
        errorMessage: message,
        metadata: {
          max_tokens: options?.maxTokens ?? 4096,
          streaming: true,
        },
      })
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Vision / Multimodal helpers
// ---------------------------------------------------------------------------

export type VisionContentBlock = ContentBlockParam

export interface VisionMessage {
  role: 'user' | 'assistant'
  content: string | VisionContentBlock[]
}

const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024
const PDF_SIZE_LIMIT = 32 * 1024 * 1024

export function validateImageSize(buffer: Buffer): void {
  if (buffer.byteLength > IMAGE_SIZE_LIMIT) {
    throw new Error(
      `Image exceeds 5 MB limit (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`
    )
  }
}

export function validatePdfSize(buffer: Buffer): void {
  if (buffer.byteLength > PDF_SIZE_LIMIT) {
    throw new Error(
      `PDF exceeds 32 MB limit (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`
    )
  }
}

export function buildImageBlock(
  base64Data: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
): ImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', data: base64Data, media_type: mediaType },
  }
}

export function buildDocumentBlock(base64Data: string): DocumentBlockParam {
  return {
    type: 'document',
    source: { type: 'base64', data: base64Data, media_type: 'application/pdf' },
  }
}

export async function sendVisionMessage(
  systemPrompt: string,
  messages: VisionMessage[],
  options?: {
    maxTokens?: number
    temperature?: number
    model?: string
    usageContext?: UsageCallContext
  }
): Promise<string> {
  const anthropic = getAnthropicClient()
  const model = options?.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929'
  const usage = await prepareApiUsage({
    sourceKey: 'anthropic_messages',
    provider: 'anthropic',
    endpoint: '/v1/messages',
    model,
    context: options?.usageContext,
  })

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages,
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude')
    }

    await logApiUsage(usage, {
      status: 'success',
      metrics: {
        inputTokens:
          typeof response.usage.input_tokens === 'number'
            ? response.usage.input_tokens
            : undefined,
        outputTokens:
          typeof response.usage.output_tokens === 'number'
            ? response.usage.output_tokens
            : undefined,
      },
      metadata: {
        max_tokens: options?.maxTokens ?? 4096,
        vision: true,
      },
    })

    return textBlock.text
  } catch (error) {
    if (!isExternalApiQuotaError(error)) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message.slice(0, 1200)
          : 'Unknown Anthropic API error'

      await logApiUsage(usage, {
        status: 'error',
        errorMessage: message,
        metadata: {
          max_tokens: options?.maxTokens ?? 4096,
          vision: true,
        },
      })
    }
    throw error
  }
}
