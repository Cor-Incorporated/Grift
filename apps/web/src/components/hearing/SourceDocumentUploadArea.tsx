import { type DragEvent, type FormEvent, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const ACCEPTED_TYPES = 'application/pdf,.zip,.txt'

interface SourceDocumentUploadAreaProps {
  isUploading: boolean
  error?: string | null | undefined
  notice?: string | null | undefined
  onUploadFile: (file: File) => Promise<void>
  onUploadUrl: (sourceUrl: string) => Promise<void>
}

export function SourceDocumentUploadArea({
  isUploading,
  error,
  notice,
  onUploadFile,
  onUploadUrl,
}: SourceDocumentUploadAreaProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  async function handleFile(file?: File) {
    if (!file) return
    setValidationError(null)

    if (file.size > MAX_FILE_SIZE) {
      setValidationError(`File exceeds 50 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB)`)
      return
    }

    const allowedExtensions = ['.pdf', '.zip', '.txt']
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
    if (!allowedExtensions.includes(ext)) {
      setValidationError(`Unsupported file type. Allowed: ${allowedExtensions.join(', ')}`)
      return
    }

    await onUploadFile(file)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return
    }
    setIsDragging(false)
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    await handleFile(event.dataTransfer.files?.[0])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = sourceUrl.trim()
    if (!trimmed || isUploading) return
    await onUploadUrl(trimmed)
    setSourceUrl('')
  }

  return (
    <div className="space-y-3">
      <div
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          'rounded-2xl border border-dashed px-4 py-5',
          isDragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-300 bg-slate-50',
        )}
      >
        <p className="text-sm font-medium text-slate-900">
          Upload reference material
        </p>
        <p className="mt-1 text-pretty text-sm text-slate-600">
          Drop a PDF or ZIP here, or choose a file manually. You can also queue
          a repository or website URL below.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? 'Uploading…' : 'Choose file'}
          </button>
          <span className="rounded-xl bg-white px-3 py-2 text-xs text-slate-500">
            PDF, ZIP, or other intake references
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <label className="block text-sm font-medium text-slate-700" htmlFor="source-url">
          Source URL
        </label>
        <div className="flex gap-2">
          <input
            id="source-url"
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://github.com/org/repo"
            disabled={isUploading}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isUploading || sourceUrl.trim() === ''}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Queue URL
          </button>
        </div>
      </form>

      {validationError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {validationError}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
