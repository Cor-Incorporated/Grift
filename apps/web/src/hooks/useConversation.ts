import { useCallback, useEffect, useRef, useState } from 'react'
import type { components } from '@/types/api'
import { API_BASE_URL, DEFAULT_TENANT_ID, getApiErrorMessage } from '@/lib/api-client'

type ConversationTurn = components['schemas']['ConversationTurn']

type StreamChunk = {
  type: string
  content: string
  error: string
  done: boolean
}

type UseConversationReturn = {
  messages: ConversationTurn[]
  streamingContent: string
  isStreaming: boolean
  isSending: boolean
  errorMessage: string | null
  sendMessage: (content: string) => Promise<void>
}

function createOptimisticTurn(caseId: string, content: string): ConversationTurn {
  return {
    id: `optimistic-${Date.now()}`,
    case_id: caseId,
    role: 'user',
    content,
    created_at: new Date().toISOString(),
  }
}

async function parseNdjsonStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onContent: (text: string) => void,
  onDone: (fullContent: string) => void,
  onError: (message: string) => void,
) {
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const chunk: StreamChunk = JSON.parse(trimmed)

      if (chunk.error) {
        onError(chunk.error)
        return
      }

      if (chunk.type === 'content') {
        accumulated += chunk.content
        onContent(accumulated)
      }

      if (chunk.done) {
        onDone(accumulated)
        return
      }
    }
  }
}

export function useConversation(
  caseId: string,
  initialMessages: ConversationTurn[],
): UseConversationReturn {
  const [messages, setMessages] = useState<ConversationTurn[]>(initialMessages)
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const sendMessage = useCallback(async (content: string) => {
    const optimisticTurn = createOptimisticTurn(caseId, content)
    setMessages((prev) => [...prev, optimisticTurn])
    setErrorMessage(null)
    setIsSending(true)
    setIsStreaming(true)
    setStreamingContent('')

    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const url = `${API_BASE_URL}/v1/cases/${encodeURIComponent(caseId)}/conversations/stream`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': DEFAULT_TENANT_ID,
        },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const message = getApiErrorMessage(body, 'Failed to send message.')
        setMessages((prev) => prev.filter((m) => m.id !== optimisticTurn.id))
        setErrorMessage(message)
        setIsSending(false)
        setIsStreaming(false)
        return
      }

      if (!response.body) {
        setErrorMessage('No response stream available.')
        setIsSending(false)
        setIsStreaming(false)
        return
      }

      setIsSending(false)
      const reader = response.body.getReader()

      await parseNdjsonStream(
        reader,
        (accumulated) => setStreamingContent(accumulated),
        (fullContent) => {
          const assistantTurn: ConversationTurn = {
            id: `assistant-${Date.now()}`,
            case_id: caseId,
            role: 'assistant',
            content: fullContent,
            created_at: new Date().toISOString(),
          }
          setMessages((prev) => [...prev, assistantTurn])
          setStreamingContent('')
          setIsStreaming(false)
        },
        (errorMsg) => {
          setErrorMessage(errorMsg)
          setStreamingContent('')
          setIsStreaming(false)
        },
      )
    } catch (error) {
      if ((error as Error).name === 'AbortError') return

      setMessages((prev) => prev.filter((m) => m.id !== optimisticTurn.id))
      setErrorMessage(getApiErrorMessage(error, 'Failed to send message.'))
      setIsSending(false)
      setIsStreaming(false)
    }
  }, [caseId])

  return { messages, streamingContent, isStreaming, isSending, errorMessage, sendMessage }
}
