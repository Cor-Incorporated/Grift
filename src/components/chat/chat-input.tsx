'use client'

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface ChatInputProps {
  projectId: string
  onSend: (message: string) => void
  onAttachmentUpdated: () => void | Promise<void>
  disabled: boolean
  choices: string[]
  isComplete: boolean
}

type AttachmentKind = 'file' | 'repository'

interface AttachmentApiResponse {
  success: boolean
  error?: string
  warning?: string
  message?: string
}

export function ChatInput({
  projectId,
  onSend,
  onAttachmentUpdated,
  disabled,
  choices,
  isComplete,
}: ChatInputProps) {
  const [input, setInput] = useState('')
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [attachmentBusy, setAttachmentBusy] = useState<AttachmentKind | null>(null)
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleSelectFile = () => {
    if (disabled || attachmentBusy) return
    fileInputRef.current?.click()
  }

  const runQueuedAnalysis = async () => {
    try {
      await fetch('/api/source-analysis/jobs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          limit: 1,
        }),
      })
      await onAttachmentUpdated()
    } catch {
      // keep this silent; user can continue chatting and retry later
    }
  }

  const uploadFile = async (file: File) => {
    setAttachmentError(null)
    setAttachmentMessage(null)
    setAttachmentBusy('file')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('project_id', projectId)

      const response = await fetch('/api/files', {
        method: 'POST',
        body: formData,
      })
      const result = (await response.json()) as AttachmentApiResponse

      if (!response.ok || !result.success) {
        setAttachmentError(result.error ?? 'ファイル添付に失敗しました')
        return
      }

      const warning = result.warning ? `（注意: ${result.warning}）` : ''
      setAttachmentMessage(
        `${result.message ?? '添付を受け付けました'}: ${file.name} ${warning}`.trim()
      )
      await onAttachmentUpdated()
      await runQueuedAnalysis()
    } catch {
      setAttachmentError('ファイル添付中にエラーが発生しました')
    } finally {
      setAttachmentBusy(null)
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    await uploadFile(selected)
  }

  const handleAnalyzeRepository = async () => {
    const trimmed = repositoryUrl.trim()
    if (!trimmed || disabled || attachmentBusy) return

    setAttachmentError(null)
    setAttachmentMessage(null)
    setAttachmentBusy('repository')
    try {
      const response = await fetch('/api/source-analysis/repository', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          repository_url: trimmed,
        }),
      })
      const result = (await response.json()) as AttachmentApiResponse

      if (!response.ok || !result.success) {
        setAttachmentError(result.error ?? 'リポジトリ解析に失敗しました')
        return
      }

      setAttachmentMessage(result.message ?? 'リポジトリ解析ジョブを登録しました')
      setRepositoryUrl('')
      await onAttachmentUpdated()
      await runQueuedAnalysis()
    } catch {
      setAttachmentError('リポジトリ解析中にエラーが発生しました')
    } finally {
      setAttachmentBusy(null)
    }
  }

  if (isComplete) {
    return (
      <div className="border-t bg-muted/50 px-4 py-4 text-center">
        <p className="text-sm text-muted-foreground text-pretty">
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
                disabled={disabled || !!attachmentBusy}
                className="text-xs"
              >
                {choice}
              </Button>
            ))}
          </div>
        )}

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleSelectFile}
              disabled={disabled || !!attachmentBusy}
            >
              {attachmentBusy === 'file' ? '添付中...' : 'ZIP/PDF/画像を添付'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed,application/pdf,image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-xs text-muted-foreground text-pretty">
              追加実装の解析用にZIP一式または資料ファイルを添付できます（25MBまで）
            </p>
          </div>

          <div className="mt-3 flex gap-2">
            <Input
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
              disabled={disabled || !!attachmentBusy}
              className="text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleAnalyzeRepository}
              disabled={disabled || !repositoryUrl.trim() || !!attachmentBusy}
            >
              {attachmentBusy === 'repository' ? '解析中...' : 'URL解析'}
            </Button>
          </div>

          {attachmentMessage && (
            <p className="mt-2 text-xs text-emerald-700 text-pretty">{attachmentMessage}</p>
          )}
          {attachmentError && (
            <p className="mt-2 text-xs text-destructive text-pretty">{attachmentError}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            disabled={disabled || !!attachmentBusy}
            rows={1}
            className="min-h-[44px] resize-none"
          />
          <Button
            onClick={handleSend}
            disabled={disabled || !!attachmentBusy || !input.trim()}
            className="shrink-0"
          >
            送信
          </Button>
        </div>
      </div>
    </div>
  )
}
