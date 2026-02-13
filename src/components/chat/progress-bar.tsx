'use client'

import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { REQUIRED_CATEGORIES } from '@/lib/ai/system-prompts'
import type { ProjectType } from '@/types/database'

interface ProgressBarProps {
  confirmedCategories: string[]
  isComplete: boolean
  projectType?: ProjectType
  totalCategories?: number
}

export function ProgressBar({
  confirmedCategories,
  isComplete,
  projectType = 'undetermined',
  totalCategories,
}: ProgressBarProps) {
  const isUndetermined = projectType === 'undetermined'

  const resolvedTotal = totalCategories
    ?? (isUndetermined ? 1 : REQUIRED_CATEGORIES[projectType]?.length ?? 10)

  const percentage = isComplete
    ? 100
    : isUndetermined
      ? 0
      : Math.round((confirmedCategories.length / resolvedTotal) * 100)

  if (isUndetermined) {
    return (
      <div className="border-b bg-muted/30 px-4 py-2">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span>ご相談内容を把握中...</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/40" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-b bg-muted/30 px-4 py-2">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>ヒアリング進捗</span>
          <span>{percentage}%</span>
        </div>
        <Progress value={percentage} className="mt-1 h-1.5" />
        {confirmedCategories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {confirmedCategories.map((cat) => (
              <Badge key={cat} variant="outline" className="text-[10px]">
                {cat}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
