import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DeleteProjectButton } from '@/components/dashboard/delete-project-button'
import type { Project, ProjectStatus } from '@/types/database'

const interviewableStatuses = new Set<ProjectStatus>(['draft', 'interviewing'])

const typeLabels: Record<string, { title: string; icon: string }> = {
  new_project: { title: '新規開発', icon: '🏗️' },
  bug_report: { title: 'バグ報告', icon: '🐛' },
  fix_request: { title: '修正依頼', icon: '🔧' },
  feature_addition: { title: '機能追加', icon: '✨' },
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
  const date = new Date(dateString)
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

async function fetchUserProjects(clerkUserId: string): Promise<Project[]> {
  const supabase = await createServiceRoleClient()

  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .single()

  if (!customer) {
    return []
  }

  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error('プロジェクトの取得に失敗しました')
  }

  return projects ?? []
}

export default async function DashboardPage() {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  const user = await currentUser()
  const projects = await fetchUserProjects(userId)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-2xl" role="img" aria-label="briefcase">💼</span>
            <h1 className="text-xl font-bold tracking-tight">The Benevolent Dictator</h1>
          </Link>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">
            お帰りなさいませ、{user?.firstName} 様
          </h2>
          <Button asChild>
            <Link href="/projects/new">新しいご相談</Link>
          </Button>
        </div>

        {projects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const typeLabel = typeLabels[project.type] ?? {
                title: project.type,
                icon: '📁',
              }
              const canOpenChat = interviewableStatuses.has(project.status)

              const card = (
                <Card className="h-full transition-colors hover:bg-accent/50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {typeLabel.icon} {typeLabel.title}
                      </span>
                      <div className="flex items-center gap-1">
                        <Badge variant={getStatusVariant(project.status)}>
                          {statusLabels[project.status] ?? project.status}
                        </Badge>
                        <DeleteProjectButton projectId={project.id} />
                      </div>
                    </div>
                    <CardTitle className="line-clamp-2 text-base">
                      {project.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>
                      {formatDate(project.created_at)}
                    </CardDescription>
                    {!canOpenChat && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {project.status === 'analyzing' && '仕様書を分析中です...'}
                        {project.status === 'estimating' && '見積りを作成中です...'}
                        {project.status === 'completed' && '完了済み'}
                        {project.status === 'rejected' && '却下済み'}
                        {project.status === 'on_hold' && '保留中'}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )

              if (canOpenChat) {
                return (
                  <Link key={project.id} href={`/projects/${project.id}/chat`}>
                    {card}
                  </Link>
                )
              }

              return (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  {card}
                </Link>
              )
            })}
          </div>
        ) : (
          <Card className="py-16 text-center">
            <CardContent className="flex flex-col items-center gap-4">
              <p className="text-lg text-muted-foreground">
                まだご相談がございません
              </p>
              <Button asChild>
                <Link href="/projects/new">最初のご相談を始める</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
