'use client'

import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import type { Conversation } from '@/types/database'

interface ChatMessagesProps {
  conversations: Conversation[]
}

export function ChatMessages({ conversations }: ChatMessagesProps) {
  return (
    <div className="space-y-4">
      {conversations.map((message) => (
        <div
          key={message.id}
          className={cn(
            'flex gap-3',
            message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          <Avatar className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm">
            {message.role === 'assistant' ? '🎩' : '👤'}
          </Avatar>
          <div
            className={cn(
              'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
              message.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted'
            )}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
