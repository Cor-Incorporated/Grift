'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface ChatHeaderProps {
  projectId: string
  isComplete: boolean
}

export function ChatHeader({ projectId, isComplete }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="sm">
            ← 戻る
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-lg">💼</span>
          <span className="font-medium">AI SE</span>
          {isComplete ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-700">
              ヒアリング完了
            </Badge>
          ) : (
            <Badge variant="secondary">対話中</Badge>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        案件ID: {projectId.slice(0, 8)}...
      </div>
    </header>
  )
}
