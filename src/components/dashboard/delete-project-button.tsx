'use client'

import { useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteProjectAction } from './delete-project-action'

interface DeleteProjectButtonProps {
  projectId: string
}

export function DeleteProjectButton({ projectId }: DeleteProjectButtonProps) {
  const [isPending, startTransition] = useTransition()

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!window.confirm('この案件を削除しますか？この操作は取り消せません。')) {
      return
    }

    startTransition(async () => {
      const result = await deleteProjectAction(projectId)
      if (!result.success) {
        alert(result.error ?? '削除に失敗しました')
      }
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-destructive"
      onClick={handleDelete}
      disabled={isPending}
    >
      <Trash2 className={`h-4 w-4 ${isPending ? 'animate-pulse' : ''}`} />
    </Button>
  )
}
