'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewProjectPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const createProject = async () => {
      try {
        const response = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: {} }),
        })

        const result = await response.json()

        if (result.success) {
          router.push(`/projects/${result.data.project.id}/chat`)
        } else {
          setError(result.error ?? '案件の作成に失敗しました')
        }
      } catch {
        setError('リクエストに失敗しました')
      }
    }

    createProject()
  }, [router])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-4 text-sm text-muted-foreground underline"
          >
            ホームに戻る
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 text-4xl">💼</div>
        <p className="text-lg font-medium">AI セールスエンジニアを準備しています...</p>
        <p className="mt-2 text-sm text-muted-foreground">
          まもなくチャットが始まります
        </p>
        <div className="mt-6 flex justify-center gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0.15s' }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0.3s' }} />
        </div>
      </div>
    </div>
  )
}
