'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
import { LinearSyncWidget } from '@/components/estimates/linear-sync-widget'
import type { Estimate, LinearIssueMapping } from '@/types/database'

interface EstimateActionsProps {
  projectId: string
  hasSpec: boolean
  estimates: Estimate[]
  linearIssueMappings?: LinearIssueMapping[]
}

const modeLabels: Record<string, string> = {
  market_comparison: '市場比較',
  hours_only: '工数のみ',
  hybrid: 'ハイブリッド',
}

function isHoursOnlyProject(estimate: Estimate): boolean {
  const snapshot = estimate.pricing_snapshot as { hours_only?: boolean } | null | undefined
  return estimate.estimate_mode === 'hours_only' || snapshot?.hours_only === true
}

interface EvidenceAppendixSourceView {
  source_url: string
  retrieved_at?: string
  confidence_score?: number
  source_type?: string
}

interface EvidenceAppendixView {
  requirement?: {
    met?: boolean
    reason?: string | null
    unique_source_count?: number
  }
  sources?: EvidenceAppendixSourceView[]
}

function parseEvidenceAppendix(value: unknown): EvidenceAppendixView | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as EvidenceAppendixView
}

interface SpeedAdvantageView {
  marketEstimate?: {
    durationMonths?: number
    teamSize?: number
    totalHours?: number
  }
  ourEstimate?: {
    durationMonths?: number
    teamSize?: number
    totalHours?: number
  }
  speedMultiplier?: number
  durationSavingsPercent?: number
  narrative?: string
  evidencePoints?: string[]
}

function parseSpeedAdvantage(estimate: Estimate): SpeedAdvantageView | null {
  const snapshot = estimate.pricing_snapshot as
    | { speed_advantage?: unknown }
    | null
    | undefined
  if (!snapshot?.speed_advantage || typeof snapshot.speed_advantage !== 'object') {
    return null
  }
  return snapshot.speed_advantage as SpeedAdvantageView
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

function stripGrokCitationTags(text: string): string {
  return text.replace(/<grok:render[^>]*>.*?<\/grok:render>/g, '').trim()
}

export function EstimateActions({
  projectId,
  hasSpec,
  estimates,
  linearIssueMappings = [],
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
          const appendix = parseEvidenceAppendix(estimate.evidence_appendix)
          const speedAdvantage = parseSpeedAdvantage(estimate)
          const evidenceBlocked = estimate.evidence_requirement_met === false
          return (
            <Card key={estimate.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>見積り結果</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge>{modeLabels[estimate.estimate_mode] ?? estimate.estimate_mode}</Badge>
                  <Badge variant={estimate.estimate_status === 'ready' ? 'default' : 'secondary'}>
                    {estimate.estimate_status === 'ready' ? '顧客提示可能' : 'ドラフト'}
                  </Badge>
                </div>
              </div>
              <CardDescription>
                {new Date(estimate.created_at).toLocaleString('ja-JP')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {evidenceBlocked && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  根拠ソースが不足しているため、この見積りはドラフト状態です。
                  {estimate.evidence_block_reason ? ` ${estimate.evidence_block_reason}` : ''}
                </div>
              )}

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

                {isHoursOnlyProject(estimate) ? (
                  <div className="space-y-2">
                    <h4 className="mb-2 text-sm font-medium">対応方針</h4>
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                      バグ修正・保守対応は保証/契約範囲のため、金額見積りは表示されません。
                      工数（{estimate.your_estimated_hours}h）のみで管理されます。
                    </div>
                  </div>
                ) : (
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
                      {estimate.total_market_cost && estimate.total_market_cost > 0 && (
                        <>
                          <Separator className="my-2" />
                          <div className="flex justify-between text-muted-foreground">
                            <span>市場価格</span>
                            <span className="line-through">
                              ¥{estimate.total_market_cost.toLocaleString()}
                            </span>
                          </div>
                          {(() => {
                            const savings = estimate.total_market_cost - displayedTotal
                            const isPositive = savings > 0
                            return (
                              <div className={`flex justify-between ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                <span>{isPositive ? '削減額' : '超過額'}</span>
                                <span>
                                  ¥{savings.toLocaleString()}
                                </span>
                              </div>
                            )
                          })()}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {!isHoursOnlyProject(estimate) && speedAdvantage && (speedAdvantage.speedMultiplier ?? 0) > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium">期間・スピード比較</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border p-3 text-sm">
                        <div className="mb-1 text-xs font-medium text-muted-foreground">市場標準</div>
                        <div className="text-lg font-bold">
                          {speedAdvantage.marketEstimate?.teamSize ?? '-'}名 × {speedAdvantage.marketEstimate?.durationMonths ?? '-'}ヶ月
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {speedAdvantage.marketEstimate?.totalHours?.toLocaleString() ?? '-'}時間
                        </div>
                      </div>
                      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                        <div className="mb-1 text-xs font-medium text-green-700">当社（推定）</div>
                        <div className="text-lg font-bold text-green-800">
                          {speedAdvantage.ourEstimate?.teamSize ?? '-'}名 × {typeof speedAdvantage.ourEstimate?.durationMonths === 'number' ? Math.round(speedAdvantage.ourEstimate.durationMonths * 10) / 10 : '-'}ヶ月
                        </div>
                        <div className="text-xs text-green-700">
                          {speedAdvantage.ourEstimate?.totalHours?.toLocaleString() ?? '-'}時間
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {(speedAdvantage.speedMultiplier ?? 0) > 1 && (
                        <Badge variant="outline" className="border-green-300 bg-green-50 text-green-800">
                          効率 {speedAdvantage.speedMultiplier}倍
                        </Badge>
                      )}
                      {(speedAdvantage.durationSavingsPercent ?? 0) > 0 && (
                        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">
                          期間 {Math.round(speedAdvantage.durationSavingsPercent ?? 0)}% 短縮
                        </Badge>
                      )}
                    </div>
                    {speedAdvantage.narrative && (
                      <p className="text-sm text-muted-foreground">{speedAdvantage.narrative}</p>
                    )}
                    {Array.isArray(speedAdvantage.evidencePoints) && speedAdvantage.evidencePoints.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          根拠データを表示
                        </summary>
                        <ul className="mt-2 space-y-1 text-muted-foreground">
                          {speedAdvantage.evidencePoints.map((point, i) => (
                            <li key={i}>• {point}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </>
              )}

              {!isHoursOnlyProject(estimate) && estimate.comparison_report && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 text-sm font-medium">市場比較レポート</h4>
                    <div className="rounded-lg bg-muted/50 p-4 text-sm prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {stripGrokCitationTags(estimate.comparison_report)}
                      </ReactMarkdown>
                    </div>
                  </div>
                </>
              )}

              {!isHoursOnlyProject(estimate) && appendix && Array.isArray(appendix.sources) && appendix.sources.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium">根拠付録（Evidence Appendix）</h4>
                    <div className="text-xs text-muted-foreground">
                      ソース数: {appendix.requirement?.unique_source_count ?? appendix.sources.length}
                    </div>
                    <div className="space-y-2">
                      {appendix.sources.map((source, index) => (
                        <div key={`${source.source_url}-${index}`} className="rounded border p-2 text-sm">
                          <a
                            href={source.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-blue-600 underline"
                          >
                            {source.source_url}
                          </a>
                          <div className="mt-1 text-xs text-muted-foreground">
                            取得日時: {source.retrieved_at ? new Date(source.retrieved_at).toLocaleString('ja-JP') : '-'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            信頼度: {typeof source.confidence_score === 'number' ? source.confidence_score : '-'}
                            {source.source_type ? ` / 種別: ${source.source_type}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <LinearSyncWidget
                estimate={estimate}
                projectId={projectId}
                issueMappings={linearIssueMappings.filter(
                  (m) => m.estimate_id === estimate.id
                )}
              />
            </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
