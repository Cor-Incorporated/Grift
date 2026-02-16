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
type InternalRole = 'admin' | 'sales' | 'dev'

interface ExecutionTaskEventItem {
  id: string
  event_type: 'created' | 'status_changed' | 'owner_assigned' | 'note_added'
  actor_clerk_user_id: string | null
  from_status: string | null
  to_status: string | null
  owner_role: string | null
  owner_clerk_user_id: string | null
  note: string | null
  created_at: string
}

interface CrossTaskEventItem extends ExecutionTaskEventItem {
  task_title: string
  project_title: string
}

interface TeamMemberOption {
  clerk_user_id: string
  email: string | null
  roles: InternalRole[]
}

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
  owner_clerk_user_id: string | null
  owner_role: InternalRole | null
  created_at: string
  updated_at: string
  events: ExecutionTaskEventItem[]
}

interface ExecutionTaskBoardProps {
  tasks: ExecutionTaskItem[]
  members: TeamMemberOption[]
  allEvents: CrossTaskEventItem[]
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

const ROLE_LABELS: Record<InternalRole, string> = {
  admin: 'admin',
  sales: 'sales',
  dev: 'dev',
}

function eventTypeLabel(value: ExecutionTaskEventItem['event_type']): string {
  if (value === 'created') return '作成'
  if (value === 'status_changed') return '状態変更'
  if (value === 'owner_assigned') return '担当更新'
  if (value === 'note_added') return 'メモ'
  return value
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('ja-JP')
}

function resolveOwnerRoleFromMember(member: TeamMemberOption | undefined): InternalRole | undefined {
  if (!member) return undefined
  if (member.roles.includes('dev')) return 'dev'
  if (member.roles.includes('sales')) return 'sales'
  if (member.roles.includes('admin')) return 'admin'
  return undefined
}

export function ExecutionTaskBoard({ tasks, members, allEvents }: ExecutionTaskBoardProps) {
  const [rows, setRows] = useState(tasks)
  const [statusFilter, setStatusFilter] = useState<'all' | ExecutionTaskStatus>('all')
  const [query, setQuery] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [draftStatusById, setDraftStatusById] = useState<Record<string, ExecutionTaskStatus>>({})
  const [draftOwnerRoleById, setDraftOwnerRoleById] = useState<Record<string, InternalRole | 'unassigned'>>({})
  const [draftOwnerUserById, setDraftOwnerUserById] = useState<Record<string, string>>({})
  const [noteById, setNoteById] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.clerk_user_id, member])),
    [members]
  )

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

  const patchTask = async (
    id: string,
    body: Record<string, unknown>,
    successMessage: string
  ) => {
    setError(null)
    setSuccess(null)
    setUpdatingId(id)

    try {
      const response = await fetch(`/api/execution-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
                owner_role: (payload.data.owner_role ?? null) as InternalRole | null,
                owner_clerk_user_id: (payload.data.owner_clerk_user_id ?? null) as string | null,
                updated_at: payload.data.updated_at as string,
                events: Array.isArray(payload.data.events)
                  ? (payload.data.events as ExecutionTaskEventItem[])
                  : row.events,
              }
            : row
        )
      )
      setSuccess(successMessage)
    } catch {
      setError('タスク更新中にエラーが発生しました')
    } finally {
      setUpdatingId(null)
    }
  }

  const updateStatus = async (id: string) => {
    const nextStatus = draftStatusById[id]
    if (!nextStatus) return
    await patchTask(
      id,
      {
        status: nextStatus,
        note: noteById[id] ?? undefined,
      },
      'タスク状態を更新しました'
    )
  }

  const assignOwner = async (id: string) => {
    const ownerClerkUserId = draftOwnerUserById[id]?.trim() || undefined
    const selectedMember = ownerClerkUserId ? memberById.get(ownerClerkUserId) : undefined
    const rawOwnerRole = draftOwnerRoleById[id]
    const ownerRole = rawOwnerRole && rawOwnerRole !== 'unassigned'
      ? rawOwnerRole
      : resolveOwnerRoleFromMember(selectedMember)

    if (!ownerRole && !ownerClerkUserId) {
      setError('担当を設定するには owner role または clerk user id を入力してください')
      return
    }

    await patchTask(
      id,
      {
        owner_role: ownerRole,
        owner_clerk_user_id: ownerClerkUserId,
        note: noteById[id] ?? undefined,
      },
      '担当を更新しました'
    )
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

      <Card>
        <CardHeader>
          <CardTitle>横断タイムライン</CardTitle>
          <CardDescription>直近のタスク変更イベントを案件横断で表示します。</CardDescription>
        </CardHeader>
        <CardContent>
          {allEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">イベントはまだありません。</p>
          ) : (
            <div className="space-y-2">
              {allEvents.slice(0, 15).map((event) => (
                <div
                  key={event.id}
                  className="rounded-md border px-3 py-2 text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground">{eventTypeLabel(event.event_type)}</span>
                  {' / '}
                  {event.project_title}
                  {' / '}
                  {event.task_title}
                  {' / '}
                  {formatDate(event.created_at)}
                  {event.note ? ` / note: ${event.note}` : ''}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                    <Badge variant={row.owner_role ? 'secondary' : 'outline'}>
                      owner role: {row.owner_role ? ROLE_LABELS[row.owner_role] : '-'}
                    </Badge>
                    <Badge variant={row.owner_clerk_user_id ? 'secondary' : 'outline'}>
                      owner id: {row.owner_clerk_user_id ?? '-'}
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
                <div className="grid gap-2 md:grid-cols-[220px,1fr,auto]">
                  <Select
                    value={draftOwnerRoleById[row.id] ?? row.owner_role ?? 'unassigned'}
                    onValueChange={(value) =>
                      setDraftOwnerRoleById((prev) => ({
                        ...prev,
                        [row.id]: value as InternalRole | 'unassigned',
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">未割当</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="sales">sales</SelectItem>
                      <SelectItem value="dev">dev</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={draftOwnerUserById[row.id] ?? row.owner_clerk_user_id ?? 'unassigned'}
                    onValueChange={(value) =>
                      setDraftOwnerUserById((prev) => ({
                        ...prev,
                        [row.id]: value === 'unassigned' ? '' : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="担当者を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">未割当</SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.clerk_user_id} value={member.clerk_user_id}>
                          {member.email ?? member.clerk_user_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="secondary"
                    onClick={() => assignOwner(row.id)}
                    disabled={updatingId === row.id}
                  >
                    {updatingId === row.id ? '更新中...' : '担当を更新'}
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">更新メモ（任意）</Label>
                  <Input
                    value={noteById[row.id] ?? ''}
                    onChange={(event) =>
                      setNoteById((prev) => ({
                        ...prev,
                        [row.id]: event.target.value,
                      }))
                    }
                    placeholder="例: 本番障害対応のため優先着手"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  created: {formatDate(row.created_at)} / updated: {formatDate(row.updated_at)}
                </p>
                <div className="space-y-1">
                  <p className="text-xs font-medium">変更履歴</p>
                  {row.events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">履歴はまだありません。</p>
                  ) : (
                    <div className="space-y-1">
                      {row.events.slice(0, 5).map((event) => (
                        <div
                          key={event.id}
                          className="rounded border px-2 py-1 text-xs text-muted-foreground"
                        >
                          <span className="font-medium text-foreground">{eventTypeLabel(event.event_type)}</span>
                          {' '}
                          {event.from_status || event.to_status
                            ? `(${event.from_status ?? '-'} -> ${event.to_status ?? '-'})`
                            : ''}
                          {' '}
                          owner:{event.owner_role ?? '-'}
                          {' '}
                          at:{formatDate(event.created_at)}
                          {event.note ? ` / note: ${event.note}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  )
}
