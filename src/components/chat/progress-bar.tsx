'use client'

import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'

interface ProgressBarProps {
  confirmedCategories: string[]
  isComplete: boolean
  totalCategories?: number
}

export function ProgressBar({
  confirmedCategories,
  isComplete,
  totalCategories = 10,
}: ProgressBarProps) {
  const percentage = isComplete
    ? 100
    : Math.round((confirmedCategories.length / totalCategories) * 100)

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
