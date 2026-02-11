interface GrokMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface GrokResponse {
  id: string
  choices: {
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }[]
}

export async function queryGrok(
  systemPrompt: string,
  userMessage: string,
  options?: {
    temperature?: number
    maxTokens?: number
  }
): Promise<string> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    throw new Error('XAI_API_KEY is not set')
  }

  const messages: GrokMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-3',
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Grok API error (${response.status}): ${error}`)
  }

  const data: GrokResponse = await response.json()
  const content = data.choices[0]?.message?.content

  if (!content) {
    throw new Error('No response content from Grok')
  }

  return content
}
