import { type ChangeEvent, type KeyboardEvent, useCallback, useState } from 'react'

type ChatInputProps = {
  onSend: (content: string) => Promise<void>
  isSending: boolean
  isStreaming: boolean
  disabled?: boolean
}

export function ChatInput({ onSend, isSending, isStreaming, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')
  const isDisabled = disabled || isSending || isStreaming
  const canSend = value.trim().length > 0 && !isDisabled

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setValue(event.target.value)
  }

  const handleSend = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || isDisabled) return

    setValue('')
    await onSend(trimmed)
  }, [value, isDisabled, onSend])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="flex gap-3 items-end">
      <textarea
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isDisabled}
        rows={2}
        placeholder={isDisabled ? 'Waiting for response...' : 'Type your message...'}
        className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none resize-none disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={!canSend}
        className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
      >
        {isSending ? 'Sending...' : 'Send'}
      </button>
    </div>
  )
}
