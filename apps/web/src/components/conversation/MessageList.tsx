import { useEffect, useRef } from 'react'
import type { ConversationTurn } from '@/types/conversation'
import { MessageBubble } from './MessageBubble'
import { StreamingIndicator } from './StreamingIndicator'

interface MessageListProps {
  turns: ConversationTurn[]
  streamingContent: string
  isStreaming: boolean
}

export function MessageList({ turns, streamingContent, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [turns.length, streamingContent])

  if (turns.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <p className="text-sm">Send a message to start the conversation.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      {turns.map((turn) => (
        <MessageBubble key={turn.id} turn={turn} />
      ))}
      {isStreaming && <StreamingIndicator content={streamingContent} />}
      <div ref={bottomRef} />
    </div>
  )
}
