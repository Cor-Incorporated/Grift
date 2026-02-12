import { requestXaiResponse } from '@/lib/ai/xai'

export async function queryGrok(
  systemPrompt: string,
  userMessage: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
    useSearchTools?: boolean
  }
): Promise<string> {
  const response = await requestXaiResponse(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    {
      model: options?.model ?? process.env.XAI_MODEL ?? 'grok-4-1-fast',
      temperature: options?.temperature,
      maxOutputTokens: options?.maxTokens,
      tools: options?.useSearchTools ? ['web_search', 'x_search'] : undefined,
    }
  )

  return response.text
}
