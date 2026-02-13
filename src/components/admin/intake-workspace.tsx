'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { buildFailureActionHints, toFailureSummaryText } from '@/lib/intake/batch-run-failures'
import { sortIntakeQueue } from '@/lib/intake/queue-order'
import { cn } from '@/lib/utils'

interface IntakeProject {
  id: string
  title: string
  type: string
  status: string
  customer_name: string | null
}

interface IntakeQueueItem {
  id: string
  project_id: string
  project_title: string
  project_type: string
  project_status: string
  title: string
  category: string
  impact_level: string
  status: string
  intake_status: 'needs_info' | 'ready_to_start'
  requirement_completeness: number
  missing_fields: string[]
  intake_intent: string | null
  source_channel: string | null
  requested_by_name: string | null
  requested_by_email: string | null
  requested_deadline: string | null
  requested_deadline_at: string | null
  latest_estimate_id: string | null
  latest_estimate_status: string | null
  latest_execution_task_id: string | null
  latest_execution_task_status: string | null
  created_at: string
}

interface ParsedIntentView {
  title: string
  summary: string
  category: string
  priorityHint: string
  intake_status: 'needs_info' | 'ready_to_start'
  requirement_completeness: number
  missing_fields: string[]
  follow_up_question: string
  dueDate: string | null
}

interface ParseResultView {
  parser: string
  message_summary: string
  intents: ParsedIntentView[]
}

interface ReadyPacketView {
  project: {
    id: string
    title: string
    type: string | null
    status: string | null
  }
  change_request: {
    id: string
    title: string
    description: string
    category: string
    impact_level: string
    status: string
    intake_status: string | null
    requirement_completeness: number | null
    missing_fields: string[]
    source_channel: string | null
    source_actor_name: string | null
    source_actor_email: string | null
    source_event_at: string | null
    requested_by_name: string | null
    requested_by_email: string | null
    requested_deadline: string | null
    requested_deadline_at: string | null
    intake_intent: string
    follow_up_question: string | null
  }
  estimate: {
    id: string | null
    estimate_status: string
    approval_required: boolean
    approval_status: string
    evidence_requirement_met: boolean
    total_cost: number | null
    estimated_hours: number | null
    hourly_rate: number | null
    created_at: string | null
  } | null
  execution_task: {
    id: string | null
    status: string
    priority: string
    due_at: string | null
    owner_role: string | null
    owner_clerk_user_id: string | null
    created_at: string | null
  } | null
  next_actions: string[]
}

interface IntakeWorkspaceProps {
  projects: IntakeProject[]
  queue: IntakeQueueItem[]
  batchRuns: Array<{
    id: string
    requested_count: number
    succeeded_count: number
    failed_count: number
    failed_items: Array<{ change_request_id: string; error: string }>
    created_at: string
  }>
}

type QueueTab = 'all' | 'needs_info' | 'ready_to_start'

const IMPACT_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '緊急',
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ready_to_start') return 'default'
  if (status === 'needs_info') return 'secondary'
  if (status === 'estimated' || status === 'approved') return 'outline'
  if (status === 'rejected') return 'destructive'
  return 'outline'
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('ja-JP')
}

function estimateStatusLabel(status: string | null): string {
  if (status === 'ready') return '見積: ready'
  if (status === 'draft') return '見積: draft'
  if (!status) return '見積未生成'
  return `見積: ${status}`
}

function taskStatusLabel(status: string | null): string {
  if (!status) return 'タスク未起票'
  if (status === 'todo') return 'タスク: todo'
  if (status === 'in_progress') return 'タスク: in_progress'
  if (status === 'done') return 'タスク: done'
  if (status === 'blocked') return 'タスク: blocked'
  return `タスク: ${status}`
}

export function IntakeWorkspace({ projects, queue, batchRuns }: IntakeWorkspaceProps) {
  const router = useRouter()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [message, setMessage] = useState('')
  const [actorName, setActorName] = useState('')
  const [actorEmail, setActorEmail] = useState('')
  const [sourceChannel, setSourceChannel] = useState('admin_dashboard')
  const [parseLoading, setParseLoading] = useState(false)
  const [ingestLoading, setIngestLoading] = useState(false)
  const [estimateLoadingId, setEstimateLoadingId] = useState<string | null>(null)
  const [bulkEstimateLoading, setBulkEstimateLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [hourlyRate, setHourlyRate] = useState('15000')
  const [parseResult, setParseResult] = useState<ParseResultView | null>(null)

  const [queueTab, setQueueTab] = useState<QueueTab>('needs_info')
  const [query, setQuery] = useState('')
  const [followUpById, setFollowUpById] = useState<Record<string, string>>({})
  const [followUpLoadingId, setFollowUpLoadingId] = useState<string | null>(null)
  const [packetLoadingId, setPacketLoadingId] = useState<string | null>(null)
  const [packetError, setPacketError] = useState<string | null>(null)
  const [packet, setPacket] = useState<ReadyPacketView | null>(null)
  const [packetOpen, setPacketOpen] = useState(false)
  const [taskizeLoading, setTaskizeLoading] = useState(false)
  const [taskizeMessage, setTaskizeMessage] = useState<string | null>(null)

  const queueStats = useMemo(() => {
    const needsInfo = queue.filter((item) => item.intake_status === 'needs_info').length
    const ready = queue.filter((item) => item.intake_status === 'ready_to_start').length
    const readyWithoutEstimate = queue.filter(
      (item) => item.intake_status === 'ready_to_start' && !item.latest_estimate_id
    ).length
    const readyWithoutTask = queue.filter(
      (item) => item.intake_status === 'ready_to_start' && !item.latest_execution_task_id
    ).length
    return {
      all: queue.length,
      needsInfo,
      ready,
      readyWithoutEstimate,
      readyWithoutTask,
    }
  }, [queue])

  const filteredQueue = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const matched = queue.filter((item) => {
      if (queueTab !== 'all' && item.intake_status !== queueTab) {
        return false
      }

      if (!keyword) return true
      const corpus = [
        item.title,
        item.project_title,
        item.category,
        item.requested_by_name ?? '',
        item.requested_by_email ?? '',
        item.missing_fields.join(' '),
      ]
        .join(' ')
        .toLowerCase()
      return corpus.includes(keyword)
    })
    return sortIntakeQueue(matched)
  }, [queue, queueTab, query])

  const selectedProject = projects.find((item) => item.id === projectId) ?? null

  const runParse = async () => {
    if (!projectId || message.trim().length < 3) return
    setParseLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/intake/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          message,
          source: {
            channel: sourceChannel,
            actor_name: actorName || undefined,
            actor_email: actorEmail || undefined,
          },
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        setError(payload.error ?? '解析に失敗しました')
        return
      }

      setParseResult(payload.data as ParseResultView)
      setSuccess('解析プレビューを更新しました')
    } catch {
      setError('解析中にエラーが発生しました')
    } finally {
      setParseLoading(false)
    }
  }

  const runIngest = async () => {
    if (!projectId || message.trim().length < 3) return
    setIngestLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/intake/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          message,
          source: {
            channel: sourceChannel,
            actor_name: actorName || undefined,
            actor_email: actorEmail || undefined,
          },
          requested_by_name: actorName || undefined,
          requested_by_email: actorEmail || undefined,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        setError(payload.error ?? '起票に失敗しました')
        return
      }

      const created = Array.isArray(payload.data?.created) ? payload.data.created.length : 0
      setSuccess(`${created}件の変更要求を自動起票しました`)
      setMessage('')
      setParseResult(null)
      router.refresh()
    } catch {
      setError('起票中にエラーが発生しました')
    } finally {
      setIngestLoading(false)
    }
  }

  const requestEstimate = async (changeRequestId: string): Promise<{ ok: boolean; error?: string }> => {
    const parsedHourlyRate = Number(hourlyRate)
    if (!Number.isFinite(parsedHourlyRate) || parsedHourlyRate <= 0) {
      return {
        ok: false,
        error: '時給を正しい数値で入力してください',
      }
    }

    const response = await fetch(`/api/change-requests/${changeRequestId}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        your_hourly_rate: parsedHourlyRate,
        include_market_context: true,
      }),
    })

    const payload = await response.json()
    if (!response.ok || !payload.success) {
      return {
        ok: false,
        error: payload.error ?? '概算見積りの生成に失敗しました',
      }
    }

    return { ok: true }
  }

  const runEstimateForItem = async (item: IntakeQueueItem) => {
    if (item.intake_status !== 'ready_to_start' || item.latest_estimate_id) return
    setEstimateLoadingId(item.id)
    setError(null)
    setSuccess(null)

    try {
      const result = await requestEstimate(item.id)
      if (!result.ok) {
        setError(result.error ?? '概算見積りの生成に失敗しました')
        return
      }

      setSuccess('概算見積りを生成しました')
      router.refresh()
    } catch {
      setError('概算見積りの生成中にエラーが発生しました')
    } finally {
      setEstimateLoadingId(null)
    }
  }

  const runBulkEstimate = async () => {
    setError(null)
    setSuccess(null)

    const targets = queue
      .filter((item) => item.intake_status === 'ready_to_start' && !item.latest_estimate_id)
      .slice(0, 10)

    if (targets.length === 0) {
      setError('概算未生成の着手可能チケットがありません')
      return
    }

    setBulkEstimateLoading(true)
    let succeeded = 0
    let failed = 0
    let lastError: string | null = null
    const succeededIds: string[] = []
    const failedItems: Array<{ change_request_id: string; error: string }> = []
    let runId: string | null = null
    let logError: string | null = null

    try {
      for (const item of targets) {
        const result = await requestEstimate(item.id)
        if (result.ok) {
          succeeded += 1
          succeededIds.push(item.id)
        } else {
          failed += 1
          const errorMessage = result.error ?? '概算見積りの生成に失敗しました'
          lastError = errorMessage
          failedItems.push({
            change_request_id: item.id,
            error: errorMessage.slice(0, 500),
          })
        }
      }

      try {
        const logResponse = await fetch('/api/change-requests/estimate-batch-runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: 'intake_queue',
            request_params: {
              hourly_rate: Number(hourlyRate),
              include_market_context: true,
              limit: targets.length,
            },
            target_change_request_ids: targets.map((item) => item.id),
            succeeded_change_request_ids: succeededIds,
            failed_items: failedItems,
          }),
        })
        const logPayload = await logResponse.json()
        if (!logResponse.ok || !logPayload.success) {
          logError = logPayload.error ?? '一括概算ログの保存に失敗しました'
        } else if (typeof logPayload.data?.id === 'string') {
          runId = logPayload.data.id
        }
      } catch {
        logError = '一括概算ログの保存中にエラーが発生しました'
      }

      if (succeeded > 0) {
        setSuccess(
          `${succeeded}件の概算見積りを生成しました${runId ? ` (run: ${runId})` : ''}`
        )
      } else {
        setSuccess(`一括概算を実行しました${runId ? ` (run: ${runId})` : ''}`)
      }

      if (failed > 0) {
        setError(
          `${failed}件の概算見積りに失敗しました${lastError ? ` (${lastError})` : ''}`
        )
      } else if (logError) {
        setError(`概算は完了しましたがログ保存に失敗しました: ${logError}`)
      }

      router.refresh()
    } catch {
      setError('一括概算生成中にエラーが発生しました')
    } finally {
      setBulkEstimateLoading(false)
    }
  }

  const requestFollowUp = async (item: IntakeQueueItem) => {
    if (item.missing_fields.length === 0) return
    setFollowUpLoadingId(item.id)

    try {
      const response = await fetch('/api/intake/follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent_type: item.intake_intent ?? 'other',
          missing_fields: item.missing_fields,
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        setFollowUpById((prev) => ({
          ...prev,
          [item.id]: payload.error ?? '不足質問の生成に失敗しました',
        }))
        return
      }

      setFollowUpById((prev) => ({
        ...prev,
        [item.id]: payload.data.question as string,
      }))
    } catch {
      setFollowUpById((prev) => ({
        ...prev,
        [item.id]: '不足質問の生成中にエラーが発生しました',
      }))
    } finally {
      setFollowUpLoadingId(null)
    }
  }

  const openPacket = async (id: string) => {
    setPacketError(null)
    setTaskizeMessage(null)
    setPacketLoadingId(id)

    try {
      const response = await fetch(`/api/change-requests/${id}/ready-packet`, {
        method: 'GET',
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        setPacketError(payload.error ?? '着手パケットの取得に失敗しました')
        return
      }

      setPacket(payload.data as ReadyPacketView)
      setPacketOpen(true)
    } catch {
      setPacketError('着手パケットの取得中にエラーが発生しました')
    } finally {
      setPacketLoadingId(null)
    }
  }

  const taskizeFromPacket = async () => {
    if (!packet) return
    setTaskizeLoading(true)
    setPacketError(null)
    setTaskizeMessage(null)

    try {
      const response = await fetch(`/api/change-requests/${packet.change_request.id}/taskize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        setPacketError(payload.error ?? 'タスク化に失敗しました')
        return
      }

      const created = payload.data?.created === true
      const taskId = payload.data?.task?.id
      setTaskizeMessage(
        created
          ? `実行タスクを作成しました${taskId ? ` (task: ${taskId})` : ''}`
          : `既存の実行タスクを使用します${taskId ? ` (task: ${taskId})` : ''}`
      )
      setSuccess('着手パケットをタスク化しました')
      router.refresh()
    } catch {
      setPacketError('タスク化中にエラーが発生しました')
    } finally {
      setTaskizeLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold text-balance">Intake Workspace</h1>
          <p className="text-muted-foreground text-pretty">
            ダッシュボード上で曖昧な依頼を分解し、変更要求を自動起票します。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>全件</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{queueStats.all}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>要追加ヒアリング</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{queueStats.needsInfo}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>着手可能</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{queueStats.ready}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>概算未生成</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{queueStats.readyWithoutEstimate}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>タスク未起票</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{queueStats.readyWithoutTask}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>自由文から要件化</CardTitle>
            <CardDescription className="text-pretty">
              依頼文を解析して意図ごとに分割します。確認後に一括起票してください。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>対象案件</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="案件を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProject && (
                  <p className="text-xs text-muted-foreground text-pretty">
                    {selectedProject.type} / {selectedProject.status}
                    {selectedProject.customer_name ? ` / ${selectedProject.customer_name}` : ''}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>入力チャネル</Label>
                <Input
                  value={sourceChannel}
                  onChange={(event) => setSourceChannel(event.target.value)}
                  placeholder="admin_dashboard"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>依頼者名（任意）</Label>
                <Input
                  value={actorName}
                  onChange={(event) => setActorName(event.target.value)}
                  placeholder="山田 太郎"
                />
              </div>
              <div className="space-y-2">
                <Label>依頼者メール（任意）</Label>
                <Input
                  value={actorEmail}
                  onChange={(event) => setActorEmail(event.target.value)}
                  placeholder="requester@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>依頼本文</Label>
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={9}
                placeholder="例: バグ大量発生。ログイン挙動も怪しい。加えて履歴フォルダ実装を来週優先で。"
              />
            </div>

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive text-pretty">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 text-pretty">
                {success}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={runParse}
                disabled={parseLoading || ingestLoading || !projectId || message.trim().length < 3}
              >
                {parseLoading ? '解析中...' : '解析プレビュー'}
              </Button>
              <Button
                onClick={runIngest}
                disabled={ingestLoading || parseLoading || !projectId || message.trim().length < 3}
              >
                {ingestLoading ? '起票中...' : '一括起票する'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>解析プレビュー</CardTitle>
            <CardDescription>起票前に意図分割と不足情報を確認します。</CardDescription>
          </CardHeader>
          <CardContent>
            {!parseResult ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground text-pretty">
                解析プレビューを実行すると、ここに intent 分割結果が表示されます。
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  parser: {parseResult.parser} / intents: {parseResult.intents.length}
                </div>
                <p className="text-sm text-pretty">{parseResult.message_summary}</p>
                <div className="space-y-3">
                  {parseResult.intents.map((intent, index) => (
                    <div key={`${intent.title}-${index}`} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{intent.category}</Badge>
                        <Badge variant={statusBadgeVariant(intent.intake_status)}>
                          {intent.intake_status === 'ready_to_start' ? '着手可能' : '情報不足'}
                        </Badge>
                        <Badge variant="secondary">
                          優先度: {IMPACT_LABELS[intent.priorityHint] ?? intent.priorityHint}
                        </Badge>
                      </div>
                      <p className="mt-2 font-medium text-pretty">{intent.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground text-pretty">{intent.summary}</p>
                      {intent.dueDate && (
                        <p className="mt-1 text-xs text-muted-foreground">期限ヒント: {intent.dueDate}</p>
                      )}
                      <div className="mt-3 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span>要件充足率</span>
                          <span className="tabular-nums">{intent.requirement_completeness}%</span>
                        </div>
                        <Progress value={intent.requirement_completeness} />
                      </div>
                      {intent.missing_fields.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {intent.missing_fields.map((field) => (
                              <Badge key={field} variant="outline">
                                {field}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground text-pretty">
                            次の質問: {intent.follow_up_question}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-balance">Intake Queue</h2>
            <p className="text-sm text-muted-foreground text-pretty">
              情報不足を先に潰し、着手可能な依頼だけをエンジニアに渡します。
            </p>
          </div>
          <div className="grid w-full gap-3 md:max-w-2xl md:grid-cols-[160px,1fr,auto]">
            <div className="space-y-2">
              <Label>概算時給 (円)</Label>
              <Input
                type="number"
                min={1000}
                value={hourlyRate}
                onChange={(event) => setHourlyRate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>検索</Label>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="タイトル / 案件 / 不足項目"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={runBulkEstimate}
                disabled={bulkEstimateLoading}
                className="w-full md:w-auto"
              >
                {bulkEstimateLoading ? '概算生成中...' : '着手可能を一括概算'}
              </Button>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground text-pretty">
          一括概算は、見積未生成の `ready_to_start` を最大10件まで順次処理します。キューは緊急度・期限・不足量の順で並び替えています。
        </p>

        {packetError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive text-pretty">
            {packetError}
          </p>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">一括概算 実行履歴</CardTitle>
            <CardDescription>直近20件の run を表示します。</CardDescription>
          </CardHeader>
          <CardContent>
            {batchRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">履歴はまだありません。</p>
            ) : (
              <div className="space-y-2">
                {batchRuns.slice(0, 8).map((run) => (
                  <div
                    key={run.id}
                    className="rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono text-xs">{run.id}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">target: {run.requested_count}</Badge>
                        <Badge variant="secondary">ok: {run.succeeded_count}</Badge>
                        <Badge variant={run.failed_count > 0 ? 'destructive' : 'outline'}>
                          ng: {run.failed_count}
                        </Badge>
                        <Badge variant={run.failed_count > 0 ? 'secondary' : 'outline'}>
                          {toFailureSummaryText(run.failed_items)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(run.created_at)}</span>
                      </div>
                    </div>
                    {run.failed_count > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        推奨: {buildFailureActionHints(run.failed_items).join(' / ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs value={queueTab} onValueChange={(value) => setQueueTab(value as QueueTab)}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="needs_info">要追加ヒアリング ({queueStats.needsInfo})</TabsTrigger>
            <TabsTrigger value="ready_to_start">着手可能 ({queueStats.ready})</TabsTrigger>
            <TabsTrigger value="all">全件 ({queueStats.all})</TabsTrigger>
          </TabsList>
          <TabsContent value={queueTab} className="space-y-3">
            {filteredQueue.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-sm text-muted-foreground text-pretty">
                  条件に一致する項目はありません。検索条件かタブを変更してください。
                </CardContent>
              </Card>
            ) : (
              filteredQueue.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base text-balance">{item.title}</CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.category}</Badge>
                        <Badge variant={statusBadgeVariant(item.intake_status)}>
                          {item.intake_status === 'ready_to_start' ? '着手可能' : '情報不足'}
                        </Badge>
                        <Badge variant={item.latest_estimate_id ? 'default' : 'outline'}>
                          {estimateStatusLabel(item.latest_estimate_status)}
                        </Badge>
                        <Badge variant={item.latest_execution_task_id ? 'default' : 'outline'}>
                          {taskStatusLabel(item.latest_execution_task_status)}
                        </Badge>
                        <Badge variant={item.requested_deadline_at ? 'secondary' : 'outline'}>
                          期限: {item.requested_deadline ?? '-'}
                        </Badge>
                        <Badge variant="secondary">
                          影響: {IMPACT_LABELS[item.impact_level] ?? item.impact_level}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription className="text-pretty">
                      案件: {item.project_title} / source: {item.source_channel ?? '-'} / created: {formatDate(item.created_at)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>要件充足率</span>
                        <span className="tabular-nums">{item.requirement_completeness}%</span>
                      </div>
                      <Progress value={item.requirement_completeness} />
                    </div>

                    {item.missing_fields.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {item.missing_fields.map((field) => (
                            <Badge key={field} variant="outline">
                              {field}
                            </Badge>
                          ))}
                        </div>
                        {followUpById[item.id] && (
                          <p className="text-xs text-muted-foreground text-pretty">
                            {followUpById[item.id]}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {item.missing_fields.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => requestFollowUp(item)}
                          disabled={followUpLoadingId === item.id}
                        >
                          {followUpLoadingId === item.id ? '質問生成中...' : '不足質問を生成'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => runEstimateForItem(item)}
                        disabled={
                          estimateLoadingId === item.id
                          || item.intake_status !== 'ready_to_start'
                          || Boolean(item.latest_estimate_id)
                        }
                      >
                        {estimateLoadingId === item.id ? '概算生成中...' : '概算見積りを生成'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openPacket(item.id)}
                        disabled={packetLoadingId === item.id}
                        className={cn(
                          item.intake_status !== 'ready_to_start' && 'bg-muted-foreground/80'
                        )}
                      >
                        {packetLoadingId === item.id ? '取得中...' : '着手パケットを確認'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </section>

      <Dialog open={packetOpen} onOpenChange={setPacketOpen}>
        <DialogContent className="max-h-[80dvh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>着手パケット</DialogTitle>
            <DialogDescription className="text-pretty">
              エンジニアへの受け渡しに必要な情報をまとめています。
            </DialogDescription>
          </DialogHeader>
          {packet && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                size="sm"
                onClick={taskizeFromPacket}
                disabled={taskizeLoading}
              >
                {taskizeLoading ? 'タスク化中...' : 'このパケットをタスク化'}
              </Button>
              {taskizeMessage && (
                <p className="text-xs text-emerald-700">{taskizeMessage}</p>
              )}
            </div>
          )}

          {!packet ? (
            <p className="text-sm text-muted-foreground">データがありません。</p>
          ) : (
            <div className="space-y-4 text-sm">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{packet.change_request.title}</CardTitle>
                  <CardDescription>
                    {packet.project.title} / {packet.change_request.category}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-pretty whitespace-pre-wrap">{packet.change_request.description}</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>intake_status: {packet.change_request.intake_status ?? '-'}</div>
                    <div>充足率: {packet.change_request.requirement_completeness ?? 0}%</div>
                    <div>依頼者: {packet.change_request.requested_by_name ?? '-'}</div>
                    <div>チャネル: {packet.change_request.source_channel ?? '-'}</div>
                    <div>希望期限: {packet.change_request.requested_deadline ?? '-'}</div>
                    <div>期限日時: {formatDate(packet.change_request.requested_deadline_at)}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">不足情報</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {packet.change_request.missing_fields.length === 0 ? (
                    <p className="text-muted-foreground">不足項目はありません。</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {packet.change_request.missing_fields.map((field) => (
                        <Badge key={field} variant="outline">
                          {field}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {packet.change_request.follow_up_question && (
                    <p className="text-xs text-muted-foreground text-pretty">
                      次の質問: {packet.change_request.follow_up_question}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">概算情報</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {!packet.estimate ? (
                    <p className="text-muted-foreground">見積りは未生成です。</p>
                  ) : (
                    <>
                      <p>見積状態: {packet.estimate.estimate_status}</p>
                      <p>承認状態: {packet.estimate.approval_status}</p>
                      <p>概算工数: {packet.estimate.estimated_hours ?? '-'}h</p>
                      <p>概算金額: {packet.estimate.total_cost ? `¥${packet.estimate.total_cost.toLocaleString()}` : '-'}</p>
                      <p className="text-xs text-muted-foreground">
                        generated at: {formatDate(packet.estimate.created_at)}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">実行タスク</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {!packet.execution_task ? (
                    <p className="text-muted-foreground">タスクは未起票です。</p>
                  ) : (
                    <>
                      <p>task_id: {packet.execution_task.id ?? '-'}</p>
                      <p>status: {packet.execution_task.status}</p>
                      <p>priority: {packet.execution_task.priority}</p>
                      <p>owner_role: {packet.execution_task.owner_role ?? '-'}</p>
                      <p>owner_id: {packet.execution_task.owner_clerk_user_id ?? '-'}</p>
                      <p>due: {formatDate(packet.execution_task.due_at)}</p>
                      <p className="text-xs text-muted-foreground">
                        created at: {formatDate(packet.execution_task.created_at)}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">次アクション</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1 pl-5">
                    {packet.next_actions.map((action, index) => (
                      <li key={`${action}-${index}`} className="text-pretty">
                        {action}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
