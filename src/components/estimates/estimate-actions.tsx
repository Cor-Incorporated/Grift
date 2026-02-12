'use client'

import { useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { Estimate } from '@/types/database'

interface EstimateActionsProps {
  projectId: string
  hasSpec: boolean
  estimates: Estimate[]
}

const modeLabels: Record<string, string> = {
  market_comparison: '市場比較',
  hours_only: '工数のみ',
  hybrid: 'ハイブリッド',
}

function getDisplayedTotalCost(estimate: Estimate): number {
  const snapshot = estimate.pricing_snapshot as
    | { recommended_total_cost?: unknown; pricing?: { finalDeltaFee?: unknown } }
    | null
    | undefined

  const recommendedTotal =
    snapshot && typeof snapshot.recommended_total_cost === 'number'
      ? snapshot.recommended_total_cost
      : null

  if (recommendedTotal && recommendedTotal > 0) {
    return recommendedTotal
  }

  const changeOrderTotal =
    snapshot?.pricing && typeof snapshot.pricing.finalDeltaFee === 'number'
      ? snapshot.pricing.finalDeltaFee
      : null

  if (changeOrderTotal && changeOrderTotal > 0) {
    return changeOrderTotal
  }

  if (typeof estimate.total_your_cost === 'number' && estimate.total_your_cost > 0) {
    return estimate.total_your_cost
  }

  return estimate.your_hourly_rate * estimate.your_estimated_hours
}

export function EstimateActions({
  projectId,
  hasSpec,
  estimates,
}: EstimateActionsProps) {
  const [hourlyRate, setHourlyRate] = useState('15000')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          your_hourly_rate: Number(hourlyRate),
        }),
      })

      const result = await response.json()
      if (!result.success) {
        setError(result.error)
        return
      }

      window.location.reload()
    } catch {
      setError('見積りの生成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {hasSpec && (
        <Card>
          <CardHeader>
            <CardTitle>見積り生成</CardTitle>
            <CardDescription>
              仕様書を基に AI が自動見積りを生成します
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hourly_rate">時給 (円)</Label>
              <Input
                id="hourly_rate"
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                min={1000}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleGenerate} disabled={loading}>
              {loading ? '生成中...' : '見積りを生成'}
            </Button>
          </CardContent>
        </Card>
      )}

      {estimates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {hasSpec
              ? 'まだ見積りがありません。上のボタンから生成してください。'
              : '仕様書の生成が完了してから見積りを作成できます。'}
          </CardContent>
        </Card>
      ) : (
        estimates.map((estimate) => {
          const displayedTotal = getDisplayedTotalCost(estimate)
          return (
            <Card key={estimate.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>見積り結果</CardTitle>
                <Badge>{modeLabels[estimate.estimate_mode] ?? estimate.estimate_mode}</Badge>
              </div>
              <CardDescription>
                {new Date(estimate.created_at).toLocaleString('ja-JP')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-medium">工数内訳</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">調査・分析</span>
                      <span>{estimate.hours_investigation ?? 0}h</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">実装</span>
                      <span>{estimate.hours_implementation ?? 0}h</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">テスト</span>
                      <span>{estimate.hours_testing ?? 0}h</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">バッファ</span>
                      <span>{estimate.hours_buffer ?? 0}h</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-medium">
                      <span>合計工数</span>
                      <span>{estimate.your_estimated_hours}h</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-medium">コスト</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">時給</span>
                      <span>
                        ¥{estimate.your_hourly_rate.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between font-bold text-lg">
                      <span>見積総額</span>
                      <span>
                        ¥{displayedTotal.toLocaleString()}
                      </span>
                    </div>
                    {estimate.total_market_cost && (
                      <>
                        <Separator className="my-2" />
                        <div className="flex justify-between text-muted-foreground">
                          <span>市場価格</span>
                          <span className="line-through">
                            ¥{estimate.total_market_cost.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between text-green-600">
                          <span>削減額</span>
                          <span>
                            ¥{(estimate.total_market_cost - displayedTotal).toLocaleString()}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {estimate.comparison_report && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 text-sm font-medium">市場比較レポート</h4>
                    <div className="rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap">
                      {estimate.comparison_report}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
