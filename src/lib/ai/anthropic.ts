import Anthropic from '@anthropic-ai/sdk'

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
  }
): Promise<string> {
  const anthropic = getAnthropicClient()

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.7,
    system: systemPrompt,
    messages,
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  return textBlock.text
}
