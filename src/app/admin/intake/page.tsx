import { createServiceRoleClient } from '@/lib/supabase/server'
import { IntakeWorkspace } from '@/components/admin/intake-workspace'

interface ProjectRow {
  id: string
  title: string
  type: string
  status: string
  customer_id: string
}

interface CustomerRow {
  id: string
  name: string
}

interface ChangeRequestRow {
  id: string
  project_id: string
  title: string
  category: string
  impact_level: string
  status: string
  intake_status: 'needs_info' | 'ready_to_start'
  requirement_completeness: number
  missing_fields: string[]
  intake_intent: string | null
  source_channel: string | null
  requested_by_name: string | null
  requested_by_email: string | null
  requested_deadline: string | null
  requested_deadline_at: string | null
  latest_estimate_id: string | null
  latest_execution_task_id: string | null
  created_at: string
}

interface EstimateRow {
  id: string
  estimate_status: string
}

interface ExecutionTaskRow {
  id: string
  status: string
}

interface EstimateBatchRunRow {
  id: string
  requested_count: number
  succeeded_count: number
  failed_count: number
  failed_items: Array<{ change_request_id: string; error: string }>
  created_at: string
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export default async function IntakePage() {
  const supabase = await createServiceRoleClient()

  const [{ data: projects }, { data: customers }, { data: changeRequests }, { data: batchRuns }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, title, type, status, customer_id')
      .order('updated_at', { ascending: false }),
    supabase
      .from('customers')
      .select('id, name'),
    supabase
      .from('change_requests')
      .select(
        'id, project_id, title, category, impact_level, status, intake_status, requirement_completeness, missing_fields, intake_intent, source_channel, requested_by_name, requested_by_email, requested_deadline, requested_deadline_at, latest_estimate_id, latest_execution_task_id, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('estimate_batch_runs')
      .select('id, requested_count, succeeded_count, failed_count, failed_items, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const customerById = new Map(
    (customers as CustomerRow[] | null | undefined)?.map((item) => [item.id, item.name]) ?? []
  )

  const projectList = ((projects ?? []) as ProjectRow[]).map((project) => ({
    id: project.id,
    title: project.title,
    type: project.type,
    status: project.status,
    customer_name: customerById.get(project.customer_id) ?? null,
  }))

  const projectById = new Map(projectList.map((item) => [item.id, item]))
  const estimateIds = ((changeRequests ?? []) as ChangeRequestRow[])
    .map((item) => item.latest_estimate_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  const executionTaskIds = ((changeRequests ?? []) as ChangeRequestRow[])
    .map((item) => item.latest_execution_task_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  let estimateStatusById = new Map<string, string>()
  if (estimateIds.length > 0) {
    const { data: estimates } = await supabase
      .from('estimates')
      .select('id, estimate_status')
      .in('id', estimateIds)
    estimateStatusById = new Map(
      ((estimates ?? []) as EstimateRow[]).map((item) => [item.id, item.estimate_status])
    )
  }

  let executionTaskStatusById = new Map<string, string>()
  if (executionTaskIds.length > 0) {
    const { data: executionTasks } = await supabase
      .from('execution_tasks')
      .select('id, status')
      .in('id', executionTaskIds)
    executionTaskStatusById = new Map(
      ((executionTasks ?? []) as ExecutionTaskRow[]).map((item) => [item.id, item.status])
    )
  }

  const queue = ((changeRequests ?? []) as ChangeRequestRow[]).map((item) => {
    const project = projectById.get(item.project_id)
    return {
      id: item.id,
      project_id: item.project_id,
      project_title: project?.title ?? '不明な案件',
      project_type: project?.type ?? '-',
      project_status: project?.status ?? '-',
      title: item.title,
      category: item.category,
      impact_level: item.impact_level,
      status: item.status,
      intake_status: item.intake_status ?? 'needs_info',
      requirement_completeness: item.requirement_completeness ?? 0,
      missing_fields: normalizeStringArray(item.missing_fields),
      intake_intent: item.intake_intent,
      source_channel: item.source_channel,
      requested_by_name: item.requested_by_name,
      requested_by_email: item.requested_by_email,
      requested_deadline: item.requested_deadline,
      requested_deadline_at: item.requested_deadline_at,
      latest_estimate_id: item.latest_estimate_id,
      latest_estimate_status: item.latest_estimate_id
        ? estimateStatusById.get(item.latest_estimate_id) ?? null
        : null,
      latest_execution_task_id: item.latest_execution_task_id,
      latest_execution_task_status: item.latest_execution_task_id
        ? executionTaskStatusById.get(item.latest_execution_task_id) ?? null
        : null,
      created_at: item.created_at,
    }
  })

  const runList = ((batchRuns ?? []) as EstimateBatchRunRow[]).map((row) => ({
    id: row.id,
    requested_count: row.requested_count,
    succeeded_count: row.succeeded_count,
    failed_count: row.failed_count,
    failed_items: Array.isArray(row.failed_items) ? row.failed_items : [],
    created_at: row.created_at,
  }))

  return <IntakeWorkspace projects={projectList} queue={queue} batchRuns={runList} />
}
