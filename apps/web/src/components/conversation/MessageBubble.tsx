import type { ConversationTurn } from '@/types/conversation'

interface MessageBubbleProps {
  turn: ConversationTurn
}

export function MessageBubble({ turn }: MessageBubbleProps) {
  if (turn.role === 'system') {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-3 py-1">
          {turn.content}
        </span>
      </div>
    )
  }

  const isUser = turn.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-900 rounded-bl-sm'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{turn.content}</p>
        {turn.metadata?.choices && turn.metadata.choices.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {turn.metadata.choices.map((choice) => (
              <span
                key={choice}
                className="text-xs bg-white/20 rounded-full px-2 py-0.5"
              >
                {choice}
              </span>
            ))}
          </div>
        )}
        <time
          className={`block text-xs mt-1 ${isUser ? 'text-blue-200' : 'text-gray-400'}`}
          dateTime={turn.created_at}
        >
          {new Date(turn.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
    </div>
  )
}
