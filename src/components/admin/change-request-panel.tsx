'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ChangeRequest, ImpactLevel } from '@/types/database'

interface ChangeRequestPanelProps {
  projectId: string
  changeRequests: ChangeRequest[]
}

const statusLabels: Record<string, string> = {
  draft: '下書き',
  triaged: '受付済み',
  estimated: '見積済み',
  approved: '承認済み',
  rejected: '却下',
  implemented: '実装済み',
}

type IntakeTab = 'all' | 'needs_info' | 'ready_to_start'

interface ReadyPacketData {
  project: {
    title: string
  }
  change_request: {
    title: string
    description: string
    category: string
    impact_level: string
    intake_status: string | null
    requirement_completeness: number | null
    missing_fields: string[]
    follow_up_question: string | null
  }
  estimate: {
    estimate_status: string
    approval_status: string
    total_cost: number | null
    estimated_hours: number | null
  } | null
  next_actions: string[]
}

export function ChangeRequestPanel({ projectId, changeRequests }: ChangeRequestPanelProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<'bug_report' | 'fix_request' | 'feature_addition' | 'scope_change' | 'other'>('feature_addition')
  const [impactLevel, setImpactLevel] = useState<ImpactLevel>('medium')
  const [responsibilityType, setResponsibilityType] = useState<'our_fault' | 'customer_fault' | 'third_party' | 'unknown'>('unknown')
  const [reproducibility, setReproducibility] = useState<'confirmed' | 'not_confirmed' | 'unknown'>('unknown')
  const [hourlyRateById, setHourlyRateById] = useState<Record<string, string>>({})
  const [intakeTab, setIntakeTab] = useState<IntakeTab>('needs_info')
  const [query, setQuery] = useState('')
  const [packetLoadingId, setPacketLoadingId] = useState<string | null>(null)
  const [packet, setPacket] = useState<ReadyPacketData | null>(null)
  const [packetOpen, setPacketOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const createChangeRequest = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/change-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          title,
          description,
          category,
          impact_level: impactLevel,
          responsibility_type: responsibilityType,
          reproducibility,
        }),
      })

      const result = await response.json()
      if (!result.success) {
        setError(result.error ?? '変更要求の作成に失敗しました')
        return
      }

      window.location.reload()
    } catch {
      setError('リクエストに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const estimateChangeRequest = async (id: string) => {
    setLoading(true)
    setError(null)

    try {
      const hourlyRate = Number(hourlyRateById[id] ?? '15000')
      const response = await fetch(`/api/change-requests/${id}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          your_hourly_rate: hourlyRate,
          include_market_context: true,
        }),
      })

      const result = await response.json()
      if (!result.success) {
        setError(result.error ?? '追加見積りの生成に失敗しました')
        return
      }

      window.location.reload()
    } catch {
      setError('リクエストに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const openReadyPacket = async (id: string) => {
    setPacketLoadingId(id)
    setError(null)

    try {
      const response = await fetch(`/api/change-requests/${id}/ready-packet`, {
        method: 'GET',
        cache: 'no-store',
      })
      const result = await response.json()
      if (!result.success) {
        setError(result.error ?? '着手パケットの取得に失敗しました')
        return
      }

      setPacket(result.data as ReadyPacketData)
      setPacketOpen(true)
    } catch {
      setError('リクエストに失敗しました')
    } finally {
      setPacketLoadingId(null)
    }
  }

  const filteredRequests = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return changeRequests.filter((item) => {
      if (intakeTab !== 'all' && item.intake_status !== intakeTab) {
        return false
      }

      if (!keyword) return true
      const corpus = [
        item.title,
        item.description,
        item.category,
        item.intake_status ?? '',
        (item.missing_fields ?? []).join(' '),
      ]
        .join(' ')
        .toLowerCase()
      return corpus.includes(keyword)
    })
  }, [changeRequests, intakeTab, query])

  const needsInfoCount = changeRequests.filter((item) => item.intake_status === 'needs_info').length
  const readyCount = changeRequests.filter((item) => item.intake_status === 'ready_to_start').length

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>変更要求を追加</CardTitle>
          <CardDescription>既存案件の追加工数・追加料金を算出するための要求を登録します</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>タイトル</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 決済機能に3Dセキュアを追加" />
          </div>

          <div className="space-y-2">
            <Label>内容</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="変更内容、背景、希望納期を入力" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>カテゴリ</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as typeof category)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug_report">バグ修正</SelectItem>
                  <SelectItem value="fix_request">修正依頼</SelectItem>
                  <SelectItem value="feature_addition">機能追加</SelectItem>
                  <SelectItem value="scope_change">スコープ変更</SelectItem>
                  <SelectItem value="other">その他</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>影響レベル</Label>
              <Select value={impactLevel} onValueChange={(value) => setImpactLevel(value as ImpactLevel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">低</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="critical">緊急</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>責任区分</Label>
              <Select
                value={responsibilityType}
                onValueChange={(value) => setResponsibilityType(value as typeof responsibilityType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="our_fault">当社責任</SelectItem>
                  <SelectItem value="customer_fault">顧客責任</SelectItem>
                  <SelectItem value="third_party">第三者責任</SelectItem>
                  <SelectItem value="unknown">不明</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>再現性</Label>
              <Select
                value={reproducibility}
                onValueChange={(value) => setReproducibility(value as typeof reproducibility)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">再現確認済み</SelectItem>
                  <SelectItem value="not_confirmed">未再現</SelectItem>
                  <SelectItem value="unknown">不明</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={createChangeRequest} disabled={loading || !title || !description}>
            {loading ? '処理中...' : '変更要求を登録'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>全件</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{changeRequests.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>要追加ヒアリング</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{needsInfoCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>着手可能</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{readyCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>変更要求一覧</CardTitle>
          <CardDescription>要件充足状況ごとに優先して処理してください</CardDescription>
        </CardHeader>
        <CardContent>
          {changeRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">変更要求はまだありません</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <Tabs value={intakeTab} onValueChange={(value) => setIntakeTab(value as IntakeTab)}>
                  <TabsList>
                    <TabsTrigger value="needs_info">要追加ヒアリング ({needsInfoCount})</TabsTrigger>
                    <TabsTrigger value="ready_to_start">着手可能 ({readyCount})</TabsTrigger>
                    <TabsTrigger value="all">全件 ({changeRequests.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value={intakeTab} />
                </Tabs>
                <div className="w-full max-w-sm space-y-2">
                  <Label>検索</Label>
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="タイトル / 説明 / 不足項目"
                  />
                </div>
              </div>

              {filteredRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground">条件に一致する変更要求はありません</p>
              ) : (
                <div className="space-y-3">
                  {filteredRequests.map((item) => {
                    const completeness = item.requirement_completeness ?? 0
                    const missingFields = item.missing_fields ?? []
                    const canEstimate = item.intake_status !== 'needs_info'
                    return (
                      <div key={item.id} className="space-y-3 rounded border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-balance">{item.title}</p>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{statusLabels[item.status] ?? item.status}</Badge>
                            <Badge variant={item.intake_status === 'ready_to_start' ? 'default' : 'secondary'}>
                              {item.intake_status === 'ready_to_start' ? '着手可能' : '要追加ヒアリング'}
                            </Badge>
                          </div>
                        </div>

                        <p className="text-sm text-muted-foreground text-pretty whitespace-pre-wrap">{item.description}</p>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span>要件充足率</span>
                            <span className="tabular-nums">{completeness}%</span>
                          </div>
                          <Progress value={completeness} />
                        </div>

                        {missingFields.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 text-xs">
                            {missingFields.map((field) => (
                              <Badge key={field} variant="outline">
                                {field}
                              </Badge>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="secondary">{item.category}</Badge>
                          <Badge variant={item.is_billable ? 'default' : 'outline'}>{item.is_billable ? '有償' : '無償'}</Badge>
                          {item.responsibility_type && (
                            <Badge variant="outline">責任: {item.responsibility_type}</Badge>
                          )}
                          {item.reproducibility && (
                            <Badge variant="outline">再現: {item.reproducibility}</Badge>
                          )}
                          {item.billable_reason && <span className="text-muted-foreground text-pretty">{item.billable_reason}</span>}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            type="number"
                            min={1000}
                            value={hourlyRateById[item.id] ?? '15000'}
                            onChange={(e) =>
                              setHourlyRateById((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            className="w-40"
                          />
                          <Button
                            size="sm"
                            onClick={() => estimateChangeRequest(item.id)}
                            disabled={loading || !canEstimate}
                          >
                            追加見積り生成
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReadyPacket(item.id)}
                            disabled={packetLoadingId === item.id}
                          >
                            {packetLoadingId === item.id ? '取得中...' : '着手パケット'}
                          </Button>
                          {!canEstimate && (
                            <p className="text-xs text-muted-foreground text-pretty">
                              情報不足のため見積り生成は無効です
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={packetOpen} onOpenChange={setPacketOpen}>
        <DialogContent className="max-h-[80dvh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>着手パケット</DialogTitle>
            <DialogDescription className="text-pretty">
              依頼をエンジニアに渡す前に、要件の不足と概算状態を確認してください。
            </DialogDescription>
          </DialogHeader>

          {!packet ? (
            <p className="text-sm text-muted-foreground">データがありません。</p>
          ) : (
            <div className="space-y-4 text-sm">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{packet.change_request.title}</CardTitle>
                  <CardDescription>{packet.project.title} / {packet.change_request.category}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="whitespace-pre-wrap text-pretty">{packet.change_request.description}</p>
                  <p>要件充足率: {packet.change_request.requirement_completeness ?? 0}%</p>
                  {packet.change_request.missing_fields.length > 0 && (
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
