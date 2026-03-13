import { MessageInput } from '@/components/conversation/MessageInput'
import type { MissingInfoPrompt } from '@/types/conversation'

interface HearingMessageInputProps {
  disabled: boolean
  prompts: MissingInfoPrompt[]
  onSend: (content: string) => Promise<void>
}

export function HearingMessageInput({
  disabled,
  prompts,
  onSend,
}: HearingMessageInputProps) {
  return (
    <div className="border-t border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-medium text-slate-900">Continue the hearing</p>
        <p className="mt-1 text-pretty text-sm text-slate-600">
          Keep the interview moving with concrete answers, edge cases, and source
          material.
        </p>
        {prompts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {prompts.slice(0, 3).map((prompt) => (
              <button
                key={prompt.id}
                type="button"
                disabled={disabled}
                onClick={() => void onSend(prompt.label)}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {prompt.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <MessageInput onSend={(content) => void onSend(content)} disabled={disabled} />
    </div>
  )
}
