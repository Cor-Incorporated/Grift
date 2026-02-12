'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
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

export function ChangeRequestPanel({ projectId, changeRequests }: ChangeRequestPanelProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<'bug_report' | 'fix_request' | 'feature_addition' | 'scope_change' | 'other'>('feature_addition')
  const [impactLevel, setImpactLevel] = useState<ImpactLevel>('medium')
  const [responsibilityType, setResponsibilityType] = useState<'our_fault' | 'customer_fault' | 'third_party' | 'unknown'>('unknown')
  const [reproducibility, setReproducibility] = useState<'confirmed' | 'not_confirmed' | 'unknown'>('unknown')
  const [hourlyRateById, setHourlyRateById] = useState<Record<string, string>>({})
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

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader>
          <CardTitle>変更要求一覧</CardTitle>
          <CardDescription>{changeRequests.length} 件</CardDescription>
        </CardHeader>
        <CardContent>
          {changeRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">変更要求はまだありません</p>
          ) : (
            <div className="space-y-3">
              {changeRequests.map((item) => (
                <div key={item.id} className="rounded border p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{item.title}</p>
                    <Badge variant="outline">{statusLabels[item.status] ?? item.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.description}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary">{item.category}</Badge>
                    <Badge variant={item.is_billable ? 'default' : 'outline'}>{item.is_billable ? '有償' : '無償'}</Badge>
                    {item.responsibility_type && (
                      <Badge variant="outline">責任: {item.responsibility_type}</Badge>
                    )}
                    {item.reproducibility && (
                      <Badge variant="outline">再現: {item.reproducibility}</Badge>
                    )}
                    {item.billable_reason && <span className="text-muted-foreground">{item.billable_reason}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1000}
                      value={hourlyRateById[item.id] ?? '15000'}
                      onChange={(e) =>
                        setHourlyRateById((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="w-40"
                    />
                    <Button size="sm" onClick={() => estimateChangeRequest(item.id)} disabled={loading}>
                      追加見積り生成
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
