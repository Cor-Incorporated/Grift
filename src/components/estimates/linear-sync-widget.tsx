'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { Estimate, LinearIssueMapping } from '@/types/database'

interface LinearSyncWidgetProps {
  estimate: Estimate
  projectId: string
  issueMappings: LinearIssueMapping[]
}

const syncStatusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  not_synced: { label: '未同期', variant: 'outline' },
  syncing: { label: '同期中...', variant: 'secondary' },
  synced: { label: '同期済み', variant: 'default' },
  error: { label: '同期エラー', variant: 'destructive' },
}

export function LinearSyncWidget({
  estimate,
  projectId,
  issueMappings,
}: LinearSyncWidgetProps) {
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{
    linearProjectUrl: string
    issueCount: number
    cycleCount: number
  } | null>(null)

  const syncStatus = estimate.linear_sync_status ?? 'not_synced'
  const statusInfo = syncStatusLabels[syncStatus] ?? syncStatusLabels.not_synced

  const handleSync = async () => {
    setSyncing(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/linear/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estimate_id: estimate.id,
          project_id: projectId,
        }),
      })

      const result = await response.json()
      if (!result.success) {
        setError(result.error)
        return
      }

      setSyncResult(result.data)
      window.location.reload()
    } catch {
      setError('Linear同期に失敗しました')
    } finally {
      setSyncing(false)
    }
  }

  const completedCount = issueMappings.filter(
    (m) => m.sync_status === 'done' || m.sync_status === 'completed'
  ).length
  const totalCount = issueMappings.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Linear 連携</h4>
        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
      </div>

      {syncStatus === 'not_synced' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            見積りをLinearに同期して、タスク管理を開始できます。
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? '同期中...' : 'Linear に同期'}
          </Button>
        </div>
      )}

      {syncStatus === 'synced' && totalCount > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>進捗: {completedCount}/{totalCount} Issue</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-green-500 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="space-y-1">
            {issueMappings.map((mapping) => (
              <div
                key={mapping.id}
                className="flex items-center justify-between rounded border px-2 py-1 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className={
                    mapping.sync_status === 'done' || mapping.sync_status === 'completed'
                      ? 'text-green-600'
                      : mapping.sync_status === 'in progress' || mapping.sync_status === 'started'
                        ? 'text-blue-600'
                        : 'text-muted-foreground'
                  }>
                    {mapping.sync_status === 'done' || mapping.sync_status === 'completed' ? '●' :
                     mapping.sync_status === 'in progress' || mapping.sync_status === 'started' ? '◐' : '○'}
                  </span>
                  <span className="truncate max-w-[200px]">{mapping.module_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {mapping.hours_estimate && (
                    <span className="text-muted-foreground">{mapping.hours_estimate}h</span>
                  )}
                  {mapping.linear_issue_identifier && (
                    <a
                      href={mapping.linear_issue_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {mapping.linear_issue_identifier}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
          {estimate.linear_project_id && (
            <a
              href={`https://linear.app/project/${estimate.linear_project_id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              Linear プロジェクトを開く →
            </a>
          )}
        </div>
      )}

      {syncStatus === 'synced' && totalCount === 0 && (
        <p className="text-xs text-muted-foreground">
          Linearに同期済みですが、Issue マッピングがありません。
        </p>
      )}

      {syncStatus === 'error' && (
        <div className="space-y-2">
          <p className="text-xs text-destructive">
            同期中にエラーが発生しました。再試行してください。
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? '再同期中...' : '再同期'}
          </Button>
        </div>
      )}

      {syncResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-2 text-xs text-green-900">
          同期完了: {syncResult.issueCount} Issue, {syncResult.cycleCount} Cycle を作成しました
        </div>
      )}
    </div>
  )
}
