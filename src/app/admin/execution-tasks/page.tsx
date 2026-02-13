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
  owner_clerk_user_id: string | null
  owner_role: 'admin' | 'sales' | 'dev' | null
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

interface ExecutionTaskEventRow {
  id: string
  task_id: string
  event_type: 'created' | 'status_changed' | 'owner_assigned' | 'note_added'
  actor_clerk_user_id: string | null
  from_status: string | null
  to_status: string | null
  owner_role: string | null
  owner_clerk_user_id: string | null
  note: string | null
  created_at: string
}

interface TeamMemberRow {
  clerk_user_id: string
  email: string | null
  roles: Array<'admin' | 'sales' | 'dev'>
  active: boolean
}

export default async function ExecutionTasksPage() {
  const supabase = await createServiceRoleClient()

  const [{ data: tasks }, { data: teamMembers }] = await Promise.all([
    supabase
      .from('execution_tasks')
      .select('id, project_id, change_request_id, title, summary, status, priority, due_at, owner_clerk_user_id, owner_role, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('team_members')
      .select('clerk_user_id, email, roles, active')
      .eq('active', true)
      .order('created_at', { ascending: false }),
  ])

  const rows = (tasks ?? []) as ExecutionTaskRow[]
  const projectIds = [...new Set(rows.map((row) => row.project_id))]
  const changeRequestIds = [...new Set(rows.map((row) => row.change_request_id))]
  const taskIds = [...new Set(rows.map((row) => row.id))]

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

  let eventMap = new Map<string, ExecutionTaskEventRow[]>()
  if (taskIds.length > 0) {
    const { data: events } = await supabase
      .from('execution_task_events')
      .select('id, task_id, event_type, actor_clerk_user_id, from_status, to_status, owner_role, owner_clerk_user_id, note, created_at')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
      .limit(1000)

    const grouped = new Map<string, ExecutionTaskEventRow[]>()
    for (const event of (events ?? []) as ExecutionTaskEventRow[]) {
      const list = grouped.get(event.task_id) ?? []
      list.push(event)
      grouped.set(event.task_id, list)
    }
    eventMap = grouped
  }

  const taskById = new Map(rows.map((row) => [row.id, row]))

  const normalized = rows.map((row) => ({
    ...row,
    project_title: projectMap.get(row.project_id) ?? '不明な案件',
    change_request_title: changeRequestMap.get(row.change_request_id) ?? '不明な変更要求',
    events: eventMap.get(row.id) ?? [],
  }))

  const allEvents = [...eventMap.values()]
    .flat()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 40)
    .map((event) => {
      const task = taskById.get(event.task_id)
      return {
        ...event,
        task_title: task?.title ?? event.task_id,
        project_title: task ? projectMap.get(task.project_id) ?? '不明な案件' : '不明な案件',
      }
    })

  const members = ((teamMembers ?? []) as TeamMemberRow[]).map((member) => ({
    clerk_user_id: member.clerk_user_id,
    email: member.email,
    roles: Array.isArray(member.roles) ? member.roles : [],
  }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-balance">Execution Tasks</h1>
        <p className="text-muted-foreground text-pretty">
          Ready Packet から起票された実行タスクの進捗を管理します。
        </p>
      </div>
      <ExecutionTaskBoard tasks={normalized} members={members} allEvents={allEvents} />
    </div>
  )
}
