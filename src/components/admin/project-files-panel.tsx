'use client'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { ProjectFile } from '@/types/database'

interface ProjectFilesPanelProps {
  files: ProjectFile[]
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(status?: string): string {
  if (status === 'processing') return '解析中'
  if (status === 'completed') return '完了'
  if (status === 'failed') return '失敗'
  return '待機中'
}

function statusVariant(status?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default'
  if (status === 'processing') return 'secondary'
  if (status === 'failed') return 'destructive'
  return 'outline'
}

function pickSummary(result: Record<string, unknown> | null): string {
  if (!result) return ''
  const keys = ['summary', 'system_overview', 'executive_summary']
  for (const key of keys) {
    const value = result[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return ''
}

export function ProjectFilesPanel({ files }: ProjectFilesPanelProps) {
  if (files.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>添付資料</CardTitle>
          <CardDescription>ZIP/PDF/画像・リポジトリURLの解析結果を表示します。</CardDescription>
        </CardHeader>
        <CardContent className="py-8 text-sm text-muted-foreground">
          まだ添付資料がありません。顧客チャット画面から ZIP もしくはリポジトリURLを受領してください。
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {files.map((file) => {
        const summary = pickSummary(file.analysis_result)
        return (
          <Card key={file.id}>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{file.file_name}</CardTitle>
                <Badge variant={statusVariant(file.analysis_status)}>{statusLabel(file.analysis_status)}</Badge>
                <Badge variant="outline">
                  {file.source_kind === 'repository_url' ? 'Repository URL' : 'File Upload'}
                </Badge>
              </div>
              <CardDescription className="text-pretty">
                type={file.file_type ?? '-'} / size={formatBytes(file.file_size)} / created_at=
                {new Date(file.created_at).toLocaleString('ja-JP')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {file.source_url && (
                <p className="break-all text-muted-foreground">
                  source_url:{' '}
                  <a
                    href={file.source_url}
                    className="underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {file.source_url}
                  </a>
                </p>
              )}
              {summary ? (
                <p className="text-pretty">{summary}</p>
              ) : (
                <p className="text-muted-foreground">要約は未生成です。</p>
              )}
              {file.analysis_error && (
                <p className="text-destructive text-pretty">解析エラー: {file.analysis_error}</p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
