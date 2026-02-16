import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { canAccessProject, getInternalRoles } from '@/lib/auth/authorization'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConversationLog } from '@/components/chat/conversation-log'
import { SpecViewer } from '@/components/estimates/spec-viewer'
import type { ProjectStatus } from '@/types/database'

const typeLabels: Record<string, string> = {
  new_project: '🏗️ 新規開発',
  bug_report: '🐛 バグ報告',
  fix_request: '🔧 修正依頼',
  feature_addition: '✨ 機能追加',
}

const statusLabels: Record<string, string> = {
  draft: '下書き',
  interviewing: 'ヒアリング中',
  analyzing: '分析中',
  estimating: '見積中',
  completed: '完了',
  rejected: '却下',
  on_hold: '保留',
}

function getStatusVariant(status: ProjectStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default'
    case 'rejected':
      return 'destructive'
    case 'on_hold':
    case 'draft':
      return 'outline'
    default:
      return 'secondary'
  }
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString()}`
}

export default async function CustomerProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId } = await auth()
  if (!userId) {
    redirect('/sign-in')
  }

  const { id } = await params

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(id)) {
    notFound()
  }

  const supabase = await createServiceRoleClient()
  const user = await currentUser()
  const email = user?.emailAddresses[0]?.emailAddress ?? null

  // Check access
  const hasAccess = await canAccessProject(supabase, id, userId, email)
  if (!hasAccess) {
    notFound()
  }

  // If internal user, redirect to admin page
  const internalRoles = await getInternalRoles(supabase, userId, email)
  if (internalRoles.size > 0) {
    redirect(`/admin/projects/${id}`)
  }

  // Parallel data fetch
  const [projectResult, conversationsResult, estimatesResult] = await Promise.all([
    supabase
      .from('projects')
      .select('*, customer:customers(id, name, email)')
      .eq('id', id)
      .single(),
    supabase
      .from('conversations')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('estimates')
      .select('id, created_at, estimate_status, estimate_mode, your_hourly_rate, your_estimated_hours, hours_investigation, hours_implementation, hours_testing, hours_buffer, hours_breakdown_report, comparison_report, market_hourly_rate, market_estimated_hours, total_market_cost')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
  ])

  const project = projectResult.data
  if (!project) {
    notFound()
  }

  const conversations = conversationsResult.data ?? []
  const estimates = estimatesResult.data ?? []

  const hasSpec = Boolean(project.spec_markdown)
  const hasEstimates = estimates.length > 0

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card" role="banner">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard" aria-label="ダッシュボードに戻る">← ダッシュボード</Link>
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-2xl" role="img" aria-label="briefcase">💼</span>
              <h1 className="text-lg font-bold tracking-tight">The Benevolent Dictator</h1>
            </div>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{project.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {typeLabels[project.type] ?? project.type} · {formatDate(project.created_at)}
            </p>
          </div>
          <Badge variant={getStatusVariant(project.status)}>
            {statusLabels[project.status] ?? project.status}
          </Badge>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>種別</CardDescription>
              <CardTitle className="text-lg">{typeLabels[project.type] ?? project.type}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>優先度</CardDescription>
              <CardTitle className="text-lg">{project.priority ?? '未設定'}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>ステータス</CardDescription>
              <CardTitle className="text-lg">{statusLabels[project.status] ?? project.status}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="conversations" className="space-y-4">
          <TabsList>
            <TabsTrigger value="conversations">対話履歴</TabsTrigger>
            {hasSpec && <TabsTrigger value="spec">仕様書</TabsTrigger>}
            {hasEstimates && <TabsTrigger value="estimates">見積り</TabsTrigger>}
          </TabsList>

          <TabsContent value="conversations">
            <ConversationLog conversations={conversations} />
          </TabsContent>

          {hasSpec && (
            <TabsContent value="spec">
              <SpecViewer specMarkdown={project.spec_markdown} />
            </TabsContent>
          )}

          {hasEstimates && (
            <TabsContent value="estimates">
              <div className="space-y-4">
                {estimates.map((estimate) => (
                  <Card key={estimate.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">
                          工数見積り
                        </CardTitle>
                        <Badge variant="outline">
                          {estimate.estimate_status === 'draft' ? '作成中' : estimate.estimate_status}
                        </Badge>
                      </div>
                      <CardDescription>
                        {formatDate(estimate.created_at)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-muted-foreground">工数内訳</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span>調査・分析</span>
                              <span>{estimate.hours_investigation ?? 0}時間</span>
                            </div>
                            <div className="flex justify-between">
                              <span>実装</span>
                              <span>{estimate.hours_implementation ?? 0}時間</span>
                            </div>
                            <div className="flex justify-between">
                              <span>テスト</span>
                              <span>{estimate.hours_testing ?? 0}時間</span>
                            </div>
                            <div className="flex justify-between">
                              <span>バッファ</span>
                              <span>{estimate.hours_buffer ?? 0}時間</span>
                            </div>
                            <div className="flex justify-between border-t pt-1 font-medium">
                              <span>合計</span>
                              <span>{estimate.your_estimated_hours ?? 0}時間</span>
                            </div>
                          </div>
                        </div>
                        {project.type !== 'bug_report' && project.type !== 'fix_request' ? (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-muted-foreground">金額</h4>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <span>時間単価</span>
                                <span>{formatCurrency(estimate.your_hourly_rate ?? 0)}</span>
                              </div>
                              <div className="flex justify-between border-t pt-1 font-medium">
                                <span>概算合計</span>
                                <span>
                                  {formatCurrency(
                                    (estimate.your_hourly_rate ?? 0) * (estimate.your_estimated_hours ?? 0)
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-muted-foreground">対応方針</h4>
                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                              バグ修正・保守対応は保証/契約範囲のため、金額見積りは表示されません。
                            </div>
                          </div>
                        )}
                      </div>
                      {estimate.hours_breakdown_report && (
                        <div className="mt-4 rounded-md bg-muted p-3">
                          <h4 className="mb-2 text-sm font-medium">詳細説明</h4>
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                            {estimate.hours_breakdown_report}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  )
}
