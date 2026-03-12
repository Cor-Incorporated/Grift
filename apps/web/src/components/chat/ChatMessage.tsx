import { formatDateTime } from '@/lib/api-client'

type ChatMessageProps = {
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: string | undefined
  isStreaming?: boolean | undefined
}

function UserMessage({ content, createdAt }: { content: string; createdAt?: string | undefined }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] space-y-1">
        <div className="bg-slate-900 text-white rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
        {createdAt ? (
          <p className="text-xs text-slate-400 text-right tabular-nums">
            {formatDateTime(createdAt)}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function AssistantMessage({
  content,
  createdAt,
  isStreaming,
}: { content: string; createdAt?: string | undefined; isStreaming?: boolean | undefined }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] space-y-1">
        <div className="bg-slate-100 text-slate-900 rounded-2xl rounded-tl-sm px-4 py-3">
          <p className="whitespace-pre-wrap text-sm">
            {content}
            {isStreaming ? (
              <span className="animate-pulse">&#9645;</span>
            ) : null}
          </p>
        </div>
        {createdAt ? (
          <p className="text-xs text-slate-400 tabular-nums">
            {formatDateTime(createdAt)}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function SystemMessage({ content }: Pick<ChatMessageProps, 'content'>) {
  return (
    <div className="text-xs text-slate-500 text-center py-2">
      <p className="whitespace-pre-wrap">{content}</p>
    </div>
  )
}

export function ChatMessage({ role, content, createdAt, isStreaming }: ChatMessageProps) {
  if (role === 'system') {
    return <SystemMessage content={content} />
  }

  if (role === 'user') {
    return <UserMessage content={content} createdAt={createdAt ?? undefined} />
  }

  return (
    <AssistantMessage
      content={content}
      createdAt={createdAt ?? undefined}
      isStreaming={isStreaming ?? undefined}
    />
  )
}
