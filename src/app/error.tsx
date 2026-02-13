'use client'

import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <span className="text-6xl">😵</span>
      <h1 className="text-2xl font-bold">エラーが発生しました</h1>
      <p className="max-w-md text-center text-muted-foreground">
        申し訳ございません。予期しないエラーが発生しました。
        もう一度お試しください。
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">Error ID: {error.digest}</p>
      )}
      <Button onClick={reset}>再試行</Button>
    </div>
  )
}
