'use client'

import { useRef, useState, useEffect, type ChangeEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'

interface ChatInputProps {
  projectId: string
  onSend: (message: string) => void
  onStop?: () => void
  onAttachmentUpdated: () => void | Promise<void>
  disabled: boolean
  isStreaming?: boolean
  choices: string[]
  isComplete: boolean
}

interface AttachmentApiResponse {
  success: boolean
  error?: string
  warning?: string
  message?: string
}

interface StagedFile {
  file: File
  id: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function ChatInput({
  projectId,
  onSend,
  onStop,
  onAttachmentUpdated,
  disabled,
  isStreaming = false,
  choices,
  isComplete,
}: ChatInputProps) {
  const [input, setInput] = useState('')
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const [stagedUrl, setStagedUrl] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [sending, setSending] = useState(false)
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    isListening,
    isSupported: isSpeechSupported,
    transcript,
    startListening,
    stopListening,
    error: speechError,
  } = useSpeechRecognition()

  useEffect(() => {
    if (transcript) {
      setInput((prev) => prev + transcript)
    }
  }, [transcript])

  const isBusy = disabled || sending
  const hasContent = input.trim() || stagedFiles.length > 0 || stagedUrl.trim()

  const runQueuedAnalysis = async (fileCount = 1) => {
    try {
      const response = await fetch('/api/source-analysis/jobs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          limit: Math.max(fileCount, 1),
        }),
      })
      await onAttachmentUpdated()

      if (!response.ok) {
        try {
          const result = await response.json()
          return (result as AttachmentApiResponse).error ?? '添付資料の解析に失敗しました'
        } catch {
          return '添付資料の解析に失敗しました'
        }
      }
      return null
    } catch {
      return '添付資料の解析中にエラーが発生しました'
    }
  }

  const uploadFile = async (file: File): Promise<AttachmentApiResponse> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('project_id', projectId)

    const response = await fetch('/api/files', {
      method: 'POST',
      body: formData,
    })
    return (await response.json()) as AttachmentApiResponse
  }

  const registerRepository = async (url: string): Promise<AttachmentApiResponse> => {
    const response = await fetch('/api/source-analysis/repository', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        repository_url: url,
      }),
    })
    return (await response.json()) as AttachmentApiResponse
  }

  const handleSend = async () => {
    if (!hasContent || isBusy) return

    if (isListening) {
      stopListening()
    }

    setAttachmentError(null)
    setAttachmentMessage(null)
    setSending(true)

    try {
      const messages: string[] = []
      let needsAnalysis = false

      if (stagedFiles.length > 0) {
        const results = await Promise.all(
          stagedFiles.map((sf) => uploadFile(sf.file))
        )
        const failed = results.filter((r) => !r.success)
        if (failed.length > 0) {
          setAttachmentError(
            failed.map((f) => f.error ?? 'ファイル添付に失敗しました').join(', ')
          )
          return
        }
        const warnings = results
          .filter((r) => r.warning)
          .map((r) => r.warning)
        if (warnings.length > 0) {
          messages.push(`注意: ${warnings.join(', ')}`)
        }
        needsAnalysis = true
      }

      if (stagedUrl.trim()) {
        const result = await registerRepository(stagedUrl.trim())
        if (!result.success) {
          setAttachmentError(result.error ?? 'リポジトリ解析に失敗しました')
          return
        }
        messages.push(result.message ?? 'リポジトリ解析ジョブを登録しました')
        needsAnalysis = true
      }

      if (needsAnalysis) {
        setIsAnalyzing(true)
        await onAttachmentUpdated()
        const totalCount = stagedFiles.length + (stagedUrl.trim() ? 1 : 0)
        const analysisError = await runQueuedAnalysis(totalCount)
        setIsAnalyzing(false)
        if (analysisError) {
          setAttachmentError(analysisError)
          // エラーでもメッセージ送信は続行
        }
      }

      const trimmed = input.trim()
      if (trimmed) {
        onSend(trimmed)
      }

      if (messages.length > 0) {
        setAttachmentMessage(messages.join(' / '))
      }
      setInput('')
      setStagedFiles([])
      setStagedUrl('')
      setShowUrlInput(false)
    } catch {
      setAttachmentError('送信中にエラーが発生しました')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChoiceClick = (choice: string) => {
    if (isBusy) return
    onSend(choice)
  }

  const handleSelectFile = () => {
    if (isBusy) return
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files
    event.target.value = ''
    if (!selected || selected.length === 0) return

    const newFiles: StagedFile[] = Array.from(selected).map((file) => ({
      file,
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
    }))
    setStagedFiles((prev) => [...prev, ...newFiles])
    setAttachmentError(null)
    setAttachmentMessage(null)
  }

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((sf) => sf.id !== id))
  }

  const removeStagedUrl = () => {
    setStagedUrl('')
    setShowUrlInput(false)
  }

  const handleToggleUrlInput = () => {
    if (isBusy) return
    if (showUrlInput) {
      setStagedUrl('')
      setShowUrlInput(false)
    } else {
      setShowUrlInput(true)
    }
  }

  const handleMicToggle = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
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
                disabled={isBusy}
                className="text-xs"
              >
                {choice}
              </Button>
            ))}
          </div>
        )}

        <div className="rounded-lg border bg-background shadow-sm">
          {(stagedFiles.length > 0 || stagedUrl.trim()) && (
            <div className="flex flex-wrap gap-2 border-b px-3 py-2">
              {stagedFiles.map((sf) => (
                <span
                  key={sf.id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs"
                >
                  <span className="text-muted-foreground">📎</span>
                  <span className="max-w-[200px] truncate">{sf.file.name}</span>
                  <span className="text-muted-foreground">
                    ({formatFileSize(sf.file.size)})
                  </span>
                  <button
                    type="button"
                    onClick={() => removeStagedFile(sf.id)}
                    disabled={sending}
                    className="ml-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    aria-label={`${sf.file.name}を除去`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {stagedUrl.trim() && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs">
                  <span className="text-muted-foreground">🔗</span>
                  <span className="max-w-[250px] truncate">{stagedUrl}</span>
                  <button
                    type="button"
                    onClick={removeStagedUrl}
                    disabled={sending}
                    className="ml-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    aria-label="URLを除去"
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
          )}

          {showUrlInput && (
            <div className="border-b px-3 py-2">
              <Input
                value={stagedUrl}
                onChange={(event) => setStagedUrl(event.target.value)}
                placeholder="https://github.com/owner/repo"
                disabled={isBusy}
                className="h-8 text-sm"
              />
            </div>
          )}

          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力... (⌘+Enter で送信)"
            disabled={isBusy}
            rows={3}
            className="min-h-[72px] resize-none border-0 px-3 py-2.5 shadow-none focus-visible:ring-0"
          />

          <div className="flex items-center justify-between border-t px-3 py-2">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleSelectFile}
                disabled={isBusy}
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                title="ファイルを添付 (ZIP/PDF/画像, 25MBまで)"
              >
                📎 添付
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".zip,application/zip,application/x-zip-compressed,application/pdf,image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleToggleUrlInput}
                disabled={isBusy}
                className={`h-8 px-2 ${showUrlInput ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="リポジトリURLを追加"
              >
                🔗 URL
              </Button>
              {isSpeechSupported && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleMicToggle}
                  disabled={isBusy && !isListening}
                  className={`h-8 px-2 ${
                    isListening
                      ? 'animate-pulse text-red-500 hover:text-red-600'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title={isListening ? '音声入力を停止' : '音声入力'}
                >
                  🎤 {isListening ? '録音中' : '音声'}
                </Button>
              )}
            </div>

            {isStreaming ? (
              <Button
                onClick={onStop}
                size="sm"
                variant="destructive"
                className="h-8"
              >
                ⏹ 停止
              </Button>
            ) : (
              <Button
                onClick={handleSend}
                disabled={isBusy || !hasContent}
                size="sm"
                className="h-8"
              >
                {sending ? '送信中...' : '送信 ⌘↩'}
              </Button>
            )}
          </div>
        </div>

        {speechError && (
          <p className="text-xs text-destructive text-pretty">{speechError}</p>
        )}
        {attachmentMessage && (
          <p className="text-xs text-emerald-700 text-pretty">{attachmentMessage}</p>
        )}
        {isAnalyzing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            添付資料を解析中です...
          </div>
        )}
        {attachmentError && (
          <p className="text-xs text-destructive text-pretty">{attachmentError}</p>
        )}
      </div>
    </div>
  )
}
