'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import type { Conversation } from '@/types/database'

interface ChatMessagesProps {
  conversations: Conversation[]
  streamingContent?: string
  isStreaming?: boolean
  onRetry?: (userMessageId: string) => void
  lastUserMessageId?: string
}

export function ChatMessages({
  conversations,
  streamingContent,
  isStreaming,
  onRetry,
  lastUserMessageId,
}: ChatMessagesProps) {
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {conversations.map((message) => (
        <div
          key={message.id}
          className={cn(
            'group relative flex gap-3',
            message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
          )}
          onMouseEnter={() => setHoveredMessageId(message.id)}
          onMouseLeave={() => setHoveredMessageId(null)}
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
          {message.role === 'user' &&
            message.id === lastUserMessageId &&
            !isStreaming &&
            hoveredMessageId === message.id &&
            onRetry && (
              <div className="absolute -bottom-2 right-11">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onRetry(message.id)}
                >
                  🔄 やり直す
                </Button>
              </div>
            )}
        </div>
      ))}

      {isStreaming && streamingContent && (
        <div className="flex gap-3">
          <Avatar className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm">
            🎩
          </Avatar>
          <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed">
            <p className="whitespace-pre-wrap">
              {streamingContent}
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
            </p>
          </div>
        </div>
      )}

      {isStreaming && !streamingContent && (
        <div className="flex items-center gap-3">
          <Avatar className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm">
            🎩
          </Avatar>
          <div className="flex gap-1 text-sm text-muted-foreground">
            <span className="animate-bounce">.</span>
            <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
          </div>
        </div>
      )}
    </div>
  )
}
