import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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

const typeLabels: Record<string, string> = {
  new_project: '新規開発',
  bug_report: 'バグ報告',
  fix_request: '修正依頼',
  feature_addition: '機能追加',
}

export default async function AdminDashboardPage() {
  const supabase = await createServiceRoleClient()

  const { data: projects, error } = await supabase
    .from('projects')
    .select('*, customer:customers(*)')
    .order('created_at', { ascending: false })
    .limit(20)

  const { count: totalProjects } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })

  const { count: activeProjects } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .in('status', ['interviewing', 'analyzing', 'estimating'])

  const { count: completedProjects } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'completed')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">ダッシュボード</h1>
        <p className="text-muted-foreground">案件の概要と最新の状況</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>全案件</CardDescription>
            <CardTitle className="text-4xl">{totalProjects ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>進行中</CardDescription>
            <CardTitle className="text-4xl">{activeProjects ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>完了</CardDescription>
            <CardTitle className="text-4xl">{completedProjects ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近の案件</CardTitle>
          <CardDescription>直近20件の案件</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-destructive">データの取得に失敗しました</p>
          ) : !projects || projects.length === 0 ? (
            <p className="text-muted-foreground">まだ案件がありません</p>
          ) : (
            <div className="space-y-3">
              {projects.map((project) => {
                const status = statusLabels[project.status] ?? {
                  label: project.status,
                  variant: 'secondary' as const,
                }
                return (
                  <Link
                    key={project.id}
                    href={`/admin/projects/${project.id}`}
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{project.title}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{project.customer?.name ?? '不明'}</span>
                        <span>-</span>
                        <span>{typeLabels[project.type] ?? project.type}</span>
                      </div>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
