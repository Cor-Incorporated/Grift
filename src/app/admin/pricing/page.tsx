'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ConcreteProjectType } from '@/types/database'

type Policy = {
  id: string
  project_type: ConcreteProjectType
  name: string
  coefficient_min: number
  coefficient_max: number
  default_coefficient: number
  minimum_project_fee: number
  minimum_margin_percent: number
  avg_internal_cost_per_member_month: number
  default_team_size: number
  default_duration_months: number
  active: boolean
  created_at: string
}

const projectTypeLabels: Record<ConcreteProjectType, string> = {
  new_project: '新規開発',
  bug_report: 'バグ報告',
  fix_request: '修正依頼',
  feature_addition: '機能追加',
}

export default function PricingPage() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [selectedType, setSelectedType] = useState<ConcreteProjectType>('new_project')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '標準ポリシー',
    coefficient_min: '0.65',
    coefficient_max: '0.80',
    default_coefficient: '0.70',
    minimum_project_fee: '2000000',
    minimum_margin_percent: '20',
    avg_internal_cost_per_member_month: '2000000',
    default_team_size: '6',
    default_duration_months: '6',
  })

  const activePolicy = useMemo(
    () => policies.find((policy) => policy.project_type === selectedType && policy.active),
    [policies, selectedType]
  )

  const loadPolicies = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/pricing-policies')
      const result = await response.json()

      if (!result.success) {
        setError(result.error ?? '価格ポリシーの取得に失敗しました')
        return
      }

      setPolicies(result.data)
    } catch {
      setError('リクエストに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPolicies()
  }, [])

  useEffect(() => {
    if (!activePolicy) {
      return
    }

    setForm({
      name: activePolicy.name,
      coefficient_min: String(activePolicy.coefficient_min),
      coefficient_max: String(activePolicy.coefficient_max),
      default_coefficient: String(activePolicy.default_coefficient),
      minimum_project_fee: String(activePolicy.minimum_project_fee),
      minimum_margin_percent: String(activePolicy.minimum_margin_percent),
      avg_internal_cost_per_member_month: String(activePolicy.avg_internal_cost_per_member_month),
      default_team_size: String(activePolicy.default_team_size),
      default_duration_months: String(activePolicy.default_duration_months),
    })
  }, [activePolicy])

  const onSave = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/pricing-policies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_type: selectedType,
          name: form.name,
          coefficient_min: Number(form.coefficient_min),
          coefficient_max: Number(form.coefficient_max),
          default_coefficient: Number(form.default_coefficient),
          minimum_project_fee: Number(form.minimum_project_fee),
          minimum_margin_percent: Number(form.minimum_margin_percent),
          avg_internal_cost_per_member_month: Number(form.avg_internal_cost_per_member_month),
          default_team_size: Number(form.default_team_size),
          default_duration_months: Number(form.default_duration_months),
          active: true,
        }),
      })

      const result = await response.json()
      if (!result.success) {
        setError(result.error ?? '保存に失敗しました')
        return
      }

      await loadPolicies()
    } catch {
      setError('リクエストに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">価格ポリシー</h1>
        <p className="text-muted-foreground">市場想定 × 係数の見積りルールを管理します</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>対象案件タイプ</CardTitle>
          <CardDescription>タイプごとに係数レンジと下限を設定できます</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>案件タイプ</Label>
            <Select value={selectedType} onValueChange={(value) => setSelectedType(value as ConcreteProjectType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new_project">新規開発</SelectItem>
                <SelectItem value="bug_report">バグ報告</SelectItem>
                <SelectItem value="fix_request">修正依頼</SelectItem>
                <SelectItem value="feature_addition">機能追加</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ポリシー編集</CardTitle>
          <CardDescription>
            {projectTypeLabels[selectedType]}向けの有効ポリシーを作成します
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>ポリシー名</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>最小係数</Label>
            <Input value={form.coefficient_min} onChange={(e) => setForm({ ...form, coefficient_min: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>最大係数</Label>
            <Input value={form.coefficient_max} onChange={(e) => setForm({ ...form, coefficient_max: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>標準係数</Label>
            <Input value={form.default_coefficient} onChange={(e) => setForm({ ...form, default_coefficient: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>最低受注額 (円)</Label>
            <Input value={form.minimum_project_fee} onChange={(e) => setForm({ ...form, minimum_project_fee: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>最低粗利率 (%)</Label>
            <Input value={form.minimum_margin_percent} onChange={(e) => setForm({ ...form, minimum_margin_percent: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>1人月内部原価 (円)</Label>
            <Input value={form.avg_internal_cost_per_member_month} onChange={(e) => setForm({ ...form, avg_internal_cost_per_member_month: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>市場想定チーム人数</Label>
            <Input value={form.default_team_size} onChange={(e) => setForm({ ...form, default_team_size: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>市場想定期間 (月)</Label>
            <Input value={form.default_duration_months} onChange={(e) => setForm({ ...form, default_duration_months: e.target.value })} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="md:col-span-2">
            <Button onClick={onSave} disabled={loading}>
              {loading ? '保存中...' : '有効ポリシーとして保存'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>履歴</CardTitle>
          <CardDescription>最新20件</CardDescription>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだポリシーがありません</p>
          ) : (
            <div className="space-y-2">
              {policies.slice(0, 20).map((policy) => (
                <div key={policy.id} className="rounded border p-3 text-sm">
                  <p className="font-medium">{projectTypeLabels[policy.project_type]} / {policy.name}</p>
                  <p className="text-muted-foreground">
                    係数 {policy.coefficient_min} - {policy.coefficient_max} / 標準 {policy.default_coefficient} / 下限 ¥{policy.minimum_project_fee.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
