'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Conversation } from '@/types/database'

interface ConversationLogProps {
  conversations: Conversation[]
}

export function ConversationLog({ conversations }: ConversationLogProps) {
  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          対話履歴がありません
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>対話ログ ({conversations.length}件)</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px]">
          <div className="space-y-4 pr-4">
            {conversations.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'rounded-lg p-3 text-sm',
                  msg.role === 'user'
                    ? 'ml-8 bg-primary/10'
                    : msg.role === 'assistant'
                      ? 'mr-8 bg-muted'
                      : 'bg-muted/50 text-xs italic'
                )}
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">
                    {msg.role === 'assistant'
                      ? '💼 AI SE'
                      : msg.role === 'user'
                        ? '👤 顧客'
                        : '🔧 システム'}
                  </span>
                  <span>
                    {new Date(msg.created_at).toLocaleString('ja-JP')}
                  </span>
                </div>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
