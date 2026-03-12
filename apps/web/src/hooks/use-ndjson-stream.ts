import { useCallback, useRef, useState } from 'react'
import { streamMessage } from '@/lib/api-client'
import type { ConversationTurn } from '@/types/conversation'

interface UseNDJSONStreamReturn {
  streamingContent: string
  isStreaming: boolean
  error: string | null
  sendStreamMessage: (caseId: string, content: string) => Promise<ConversationTurn | null>
  cancelStream: () => void
}

export function useNDJSONStream(): UseNDJSONStreamReturn {
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const cancelStream = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  const sendStreamMessage = useCallback(
    async (caseId: string, content: string): Promise<ConversationTurn | null> => {
      cancelStream()

      const controller = new AbortController()
      abortControllerRef.current = controller

      setIsStreaming(true)
      setStreamingContent('')
      setError(null)

      let accumulated = ''
      let turnId: string | null = null

      try {
        for await (const chunk of streamMessage(caseId, content, controller.signal)) {
          if (chunk.type === 'content') {
            accumulated += chunk.content
            setStreamingContent(accumulated)
          } else if (chunk.type === 'error') {
            setError(chunk.error)
            return null
          } else if (chunk.type === 'done') {
            turnId = null // done chunk doesn't carry turn_id in OpenAPI spec
          }
        }

        if (turnId !== null || accumulated !== '') {
          const turn: ConversationTurn = {
            id: turnId ?? crypto.randomUUID(),
            case_id: caseId,
            role: 'assistant',
            content: accumulated,
            created_at: new Date().toISOString(),
          }
          return turn
        }

        return null
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null
        }
        const message = err instanceof Error ? err.message : 'Stream failed'
        setError(message)
        return null
      } finally {
        setIsStreaming(false)
        abortControllerRef.current = null
      }
    },
    [cancelStream],
  )

  return { streamingContent, isStreaming, error, sendStreamMessage, cancelStream }
}
