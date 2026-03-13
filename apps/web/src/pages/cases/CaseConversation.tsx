import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MessageInput } from '@/components/conversation/MessageInput'
import { MessageList } from '@/components/conversation/MessageList'
import { useNDJSONStream } from '@/hooks/use-ndjson-stream'
import { listConversationTurns } from '@/lib/api-client'
import type { ConversationTurn } from '@/types/conversation'

export function CaseConversation() {
  const { caseId } = useParams<{ caseId: string }>()
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const { streamingContent, isStreaming, error: streamError, sendStreamMessage } = useNDJSONStream()

  useEffect(() => {
    if (!caseId) return

    let cancelled = false

    async function load() {
      try {
        const data = await listConversationTurns(caseId!)
        if (!cancelled) {
          setTurns(data)
          setLoadError(null)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load conversations'
          setLoadError(message)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [caseId])

  const handleSend = useCallback(
    async (content: string) => {
      if (!caseId) return

      const userTurn: ConversationTurn = {
        id: crypto.randomUUID(),
        case_id: caseId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      }
      setTurns((prev) => [...prev, userTurn])

      const assistantTurn = await sendStreamMessage(caseId, content)
      if (assistantTurn) {
        setTurns((prev) => [...prev, assistantTurn])
      }
    },
    [caseId, sendStreamMessage],
  )

  if (!caseId) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        <p>No case ID provided.</p>
      </div>
    )
  }

  const displayError = loadError ?? streamError

  return (
    <div className="flex flex-col h-screen bg-white">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-gray-500 hover:text-gray-700 text-sm transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-base font-semibold text-gray-900">
            Hearing
          </h1>
        </div>
        <span className="text-xs text-gray-400 font-mono truncate max-w-48">
          {caseId}
        </span>
      </header>

      {displayError && (
        <div className="mx-4 mt-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {displayError}
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <p className="text-sm">Loading conversation...</p>
        </div>
      ) : (
        <MessageList
          turns={turns}
          streamingContent={streamingContent}
          isStreaming={isStreaming}
        />
      )}

      <MessageInput onSend={handleSend} disabled={isStreaming} />
    </div>
  )
}
