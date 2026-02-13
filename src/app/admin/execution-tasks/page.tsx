import { createServiceRoleClient } from '@/lib/supabase/server'
import { ExecutionTaskBoard } from '@/components/admin/execution-task-board'

interface ExecutionTaskRow {
  id: string
  project_id: string
  change_request_id: string
  title: string
  summary: string
  status: 'todo' | 'in_progress' | 'done' | 'blocked'
  priority: 'low' | 'medium' | 'high' | 'critical'
  due_at: string | null
  created_at: string
  updated_at: string
}

interface ProjectRow {
  id: string
  title: string
}

interface ChangeRequestRow {
  id: string
  title: string
}

export default async function ExecutionTasksPage() {
  const supabase = await createServiceRoleClient()

  const { data: tasks } = await supabase
    .from('execution_tasks')
    .select('id, project_id, change_request_id, title, summary, status, priority, due_at, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = (tasks ?? []) as ExecutionTaskRow[]
  const projectIds = [...new Set(rows.map((row) => row.project_id))]
  const changeRequestIds = [...new Set(rows.map((row) => row.change_request_id))]

  let projectMap = new Map<string, string>()
  if (projectIds.length > 0) {
    const { data: projects } = await supabase
      .from('projects')
      .select('id, title')
      .in('id', projectIds)
    projectMap = new Map(
      ((projects ?? []) as ProjectRow[]).map((project) => [project.id, project.title])
    )
  }

  let changeRequestMap = new Map<string, string>()
  if (changeRequestIds.length > 0) {
    const { data: changeRequests } = await supabase
      .from('change_requests')
      .select('id, title')
      .in('id', changeRequestIds)
    changeRequestMap = new Map(
      ((changeRequests ?? []) as ChangeRequestRow[]).map((row) => [row.id, row.title])
    )
  }

  const normalized = rows.map((row) => ({
    ...row,
    project_title: projectMap.get(row.project_id) ?? '不明な案件',
    change_request_title: changeRequestMap.get(row.change_request_id) ?? '不明な変更要求',
  }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-balance">Execution Tasks</h1>
        <p className="text-muted-foreground text-pretty">
          Ready Packet から起票された実行タスクの進捗を管理します。
        </p>
      </div>
      <ExecutionTaskBoard tasks={normalized} />
    </div>
  )
}

