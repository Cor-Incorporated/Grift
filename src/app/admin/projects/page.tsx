import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import Link from 'next/link'

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '下書き', variant: 'secondary' },
  interviewing: { label: '対話中', variant: 'default' },
  analyzing: { label: '解析中', variant: 'default' },
  estimating: { label: '見積中', variant: 'default' },
  completed: { label: '完了', variant: 'outline' },
  rejected: { label: '却下', variant: 'destructive' },
  on_hold: { label: '保留', variant: 'secondary' },
}

const typeLabels: Record<string, { label: string; icon: string }> = {
  new_project: { label: '新規開発', icon: '🏗️' },
  bug_report: { label: 'バグ報告', icon: '🐛' },
  fix_request: { label: '修正依頼', icon: '🔧' },
  feature_addition: { label: '機能追加', icon: '✨' },
}

export default async function ProjectsListPage() {
  const supabase = await createServiceRoleClient()

  const { data: projects, error } = await supabase
    .from('projects')
    .select('*, customer:customers(*)')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">案件一覧</h1>
          <p className="text-muted-foreground">
            全 {projects?.length ?? 0} 件の案件
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-destructive">データの取得に失敗しました</p>
      ) : !projects || projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">まだ案件がありません</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const status = statusLabels[project.status] ?? {
              label: project.status,
              variant: 'secondary' as const,
            }
            const type = typeLabels[project.type] ?? {
              label: project.type,
              icon: '📋',
            }
            return (
              <Link
                key={project.id}
                href={`/admin/projects/${project.id}`}
              >
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <span className="text-2xl">{type.icon}</span>
                      <div>
                        <p className="font-medium">{project.title}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{project.customer?.name ?? '不明'}</span>
                          <span>({project.customer?.company ?? '-'})</span>
                          <span>-</span>
                          <span>{type.label}</span>
                          <span>-</span>
                          <span>
                            {new Date(project.created_at).toLocaleDateString(
                              'ja-JP'
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
