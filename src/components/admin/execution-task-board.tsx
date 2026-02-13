'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ExecutionTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked'
type PriorityLevel = 'low' | 'medium' | 'high' | 'critical'

interface ExecutionTaskItem {
  id: string
  project_id: string
  project_title: string
  change_request_id: string
  change_request_title: string
  title: string
  summary: string
  status: ExecutionTaskStatus
  priority: PriorityLevel
  due_at: string | null
  created_at: string
  updated_at: string
}

interface ExecutionTaskBoardProps {
  tasks: ExecutionTaskItem[]
}

const STATUS_LABELS: Record<ExecutionTaskStatus, string> = {
  todo: '未着手',
  in_progress: '進行中',
  done: '完了',
  blocked: 'ブロック',
}

const PRIORITY_SCORE: Record<PriorityLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  critical: '緊急',
  high: '高',
  medium: '中',
  low: '低',
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('ja-JP')
}

export function ExecutionTaskBoard({ tasks }: ExecutionTaskBoardProps) {
  const [rows, setRows] = useState(tasks)
  const [statusFilter, setStatusFilter] = useState<'all' | ExecutionTaskStatus>('all')
  const [query, setQuery] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [draftStatusById, setDraftStatusById] = useState<Record<string, ExecutionTaskStatus>>({})
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const stats = useMemo(() => {
    return {
      all: rows.length,
      todo: rows.filter((row) => row.status === 'todo').length,
      in_progress: rows.filter((row) => row.status === 'in_progress').length,
      blocked: rows.filter((row) => row.status === 'blocked').length,
      done: rows.filter((row) => row.status === 'done').length,
    }
  }, [rows])

  const visibleRows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const filtered = rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (!keyword) return true

      const corpus = [
        row.title,
        row.project_title,
        row.change_request_title,
        row.status,
        row.priority,
      ]
        .join(' ')
        .toLowerCase()

      return corpus.includes(keyword)
    })

    return filtered.sort((a, b) => {
      const priorityDelta = PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority]
      if (priorityDelta !== 0) return priorityDelta

      const dueA = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY
      const dueB = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY
      if (dueA !== dueB) return dueA - dueB

      return Date.parse(a.created_at) - Date.parse(b.created_at)
    })
  }, [rows, statusFilter, query])

  const updateStatus = async (id: string) => {
    const nextStatus = draftStatusById[id]
    if (!nextStatus) return

    setError(null)
    setSuccess(null)
    setUpdatingId(id)

    try {
      const response = await fetch(`/api/execution-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        setError(payload.error ?? 'タスク更新に失敗しました')
        return
      }

      setRows((prev) =>
        prev.map((row) =>
          row.id === id
            ? {
                ...row,
                status: payload.data.status as ExecutionTaskStatus,
                updated_at: payload.data.updated_at as string,
              }
            : row
        )
      )
      setSuccess('タスク状態を更新しました')
    } catch {
      setError('タスク更新中にエラーが発生しました')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>全タスク</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{stats.all}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>未着手</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{stats.todo}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>進行中</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{stats.in_progress}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ブロック</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{stats.blocked}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>完了</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{stats.done}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>フィルタ</CardTitle>
          <CardDescription>優先度は緊急度→期限→作成順で並びます。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[220px,1fr]">
          <div className="space-y-2">
            <Label>ステータス</Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as 'all' | ExecutionTaskStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                <SelectItem value="todo">未着手</SelectItem>
                <SelectItem value="in_progress">進行中</SelectItem>
                <SelectItem value="blocked">ブロック</SelectItem>
                <SelectItem value="done">完了</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>検索</Label>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="タスク名 / 案件名 / 変更要求名"
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      )}

      <section className="space-y-3">
        {visibleRows.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              条件に一致する実行タスクはありません。
            </CardContent>
          </Card>
        ) : (
          visibleRows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{row.title}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{STATUS_LABELS[row.status]}</Badge>
                    <Badge variant={row.priority === 'critical' ? 'destructive' : 'secondary'}>
                      優先度: {PRIORITY_LABELS[row.priority]}
                    </Badge>
                    <Badge variant={row.due_at ? 'secondary' : 'outline'}>
                      期限: {formatDate(row.due_at)}
                    </Badge>
                  </div>
                </div>
                <CardDescription>
                  案件: {row.project_title} / 変更要求: {row.change_request_title}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.summary}</p>
                <div className="grid gap-2 md:grid-cols-[220px,auto]">
                  <Select
                    value={draftStatusById[row.id] ?? row.status}
                    onValueChange={(value) =>
                      setDraftStatusById((prev) => ({
                        ...prev,
                        [row.id]: value as ExecutionTaskStatus,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">未着手</SelectItem>
                      <SelectItem value="in_progress">進行中</SelectItem>
                      <SelectItem value="blocked">ブロック</SelectItem>
                      <SelectItem value="done">完了</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => updateStatus(row.id)}
                    disabled={updatingId === row.id}
                  >
                    {updatingId === row.id ? '更新中...' : '状態を更新'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  created: {formatDate(row.created_at)} / updated: {formatDate(row.updated_at)}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  )
}

