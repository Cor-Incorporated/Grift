import { useEffect, useRef } from 'react'
import type { components } from '@/types/api'
import { useConversation } from '@/hooks/useConversation'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'

type ConversationTurn = components['schemas']['ConversationTurn']

type ChatPanelProps = {
  caseId: string
  initialMessages: ConversationTurn[]
}

export function ChatPanel({ caseId, initialMessages }: ChatPanelProps) {
  const {
    messages,
    streamingContent,
    isStreaming,
    isSending,
    errorMessage,
    sendMessage,
  } = useConversation(caseId, initialMessages)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamingContent])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-950">
          Conversations
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Chat with the intake assistant to shape this case.
        </p>
      </div>

      <div className="overflow-y-auto max-h-[32rem] px-6 py-4 space-y-4">
        {messages.length === 0 && !isStreaming ? (
          <div className="py-8">
            <h3 className="text-lg font-semibold text-slate-950">
              No conversations yet
            </h3>
            <p className="mt-2 max-w-xl text-pretty text-sm text-slate-600">
              Send a message to start the intake interview.
            </p>
          </div>
        ) : null}

        {messages.map((turn) => (
          <ChatMessage
            key={turn.id}
            role={turn.role}
            content={turn.content}
            createdAt={turn.created_at}
          />
        ))}

        {isStreaming && streamingContent ? (
          <ChatMessage
            role="assistant"
            content={streamingContent}
            isStreaming
          />
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {errorMessage ? (
        <div className="px-6 pb-2">
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </p>
        </div>
      ) : null}

      <div className="border-t border-slate-200 px-6 py-4">
        <ChatInput
          onSend={sendMessage}
          isSending={isSending}
          isStreaming={isStreaming}
        />
      </div>
    </section>
  )
}
