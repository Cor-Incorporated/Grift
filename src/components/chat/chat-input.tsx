'use client'

import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled: boolean
  choices: string[]
  isComplete: boolean
}

export function ChatInput({
  onSend,
  disabled,
  choices,
  isComplete,
}: ChatInputProps) {
  const [input, setInput] = useState('')

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setInput('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChoiceClick = (choice: string) => {
    if (disabled) return
    onSend(choice)
  }

  if (isComplete) {
    return (
      <div className="border-t bg-muted/50 px-4 py-4 text-center">
        <p className="text-sm text-muted-foreground">
          ヒアリングが完了しました。管理者が内容を確認中です。
        </p>
      </div>
    )
  }

  return (
    <div className="border-t bg-background px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {choices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <Button
                key={choice}
                variant="outline"
                size="sm"
                onClick={() => handleChoiceClick(choice)}
                disabled={disabled}
                className="text-xs"
              >
                {choice}
              </Button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            disabled={disabled}
            rows={1}
            className="min-h-[44px] resize-none"
          />
          <Button
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            className="shrink-0"
          >
            送信
          </Button>
        </div>
      </div>
    </div>
  )
}
