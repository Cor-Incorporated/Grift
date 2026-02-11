import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EstimateActions } from '@/components/estimates/estimate-actions'
import { ConversationLog } from '@/components/chat/conversation-log'
import { SpecViewer } from '@/components/estimates/spec-viewer'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: project, error } = await supabase
    .from('projects')
    .select('*, customer:customers(*)')
    .eq('id', id)
    .single()

  if (error || !project) {
    notFound()
  }

  const { data: conversations } = await supabase
    .from('conversations')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: true })

  const { data: estimates } = await supabase
    .from('estimates')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  const statusColor: Record<string, string> = {
    draft: 'bg-gray-500/10 text-gray-700',
    interviewing: 'bg-blue-500/10 text-blue-700',
    analyzing: 'bg-purple-500/10 text-purple-700',
    estimating: 'bg-amber-500/10 text-amber-700',
    completed: 'bg-green-500/10 text-green-700',
    rejected: 'bg-red-500/10 text-red-700',
    on_hold: 'bg-gray-500/10 text-gray-700',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{project.customer?.name}</span>
            <span>({project.customer?.email})</span>
          </div>
        </div>
        <Badge className={statusColor[project.status] ?? ''}>
          {project.status}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>タイプ</CardDescription>
            <CardTitle className="text-lg">{project.type}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>優先度</CardDescription>
            <CardTitle className="text-lg">{project.priority ?? '-'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>対話数</CardDescription>
            <CardTitle className="text-lg">
              {conversations?.length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>見積り数</CardDescription>
            <CardTitle className="text-lg">
              {estimates?.length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="spec" className="space-y-4">
        <TabsList>
          <TabsTrigger value="spec">仕様書</TabsTrigger>
          <TabsTrigger value="conversations">対話ログ</TabsTrigger>
          <TabsTrigger value="estimates">見積り</TabsTrigger>
        </TabsList>

        <TabsContent value="spec">
          <SpecViewer
            specMarkdown={project.spec_markdown}
            projectId={project.id}
          />
        </TabsContent>

        <TabsContent value="conversations">
          <ConversationLog conversations={conversations ?? []} />
        </TabsContent>

        <TabsContent value="estimates">
          <EstimateActions
            projectId={project.id}
            projectType={project.type}
            hasSpec={!!project.spec_markdown}
            estimates={estimates ?? []}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
