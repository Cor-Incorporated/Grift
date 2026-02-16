export interface RequiredAuditAction {
  action: string
  file: string
  category: 'estimate' | 'approval' | 'manual_adjustment' | 'source_analysis' | 'intake'
}

export const REQUIRED_AUDIT_ACTIONS: RequiredAuditAction[] = [
  {
    action: 'estimate.create',
    file: 'src/app/api/estimates/route.ts',
    category: 'estimate',
  },
  {
    action: 'change_request.estimate',
    file: 'src/app/api/change-requests/[id]/estimate/route.ts',
    category: 'estimate',
  },
  {
    action: 'change_request.estimate_batch_run_log',
    file: 'src/app/api/change-requests/estimate-batch-runs/route.ts',
    category: 'estimate',
  },
  {
    action: 'intake.parse',
    file: 'src/app/api/intake/parse/route.ts',
    category: 'intake',
  },
  {
    action: 'intake.ingest_change_requests',
    file: 'src/app/api/intake/ingest/route.ts',
    category: 'intake',
  },
  {
    action: 'intake.demo_run',
    file: 'src/app/api/intake/demo-run/route.ts',
    category: 'intake',
  },
  {
    action: 'change_request.ready_packet_view',
    file: 'src/app/api/change-requests/[id]/ready-packet/route.ts',
    category: 'intake',
  },
  {
    action: 'change_request.taskize',
    file: 'src/app/api/change-requests/[id]/taskize/route.ts',
    category: 'intake',
  },
  {
    action: 'execution_task.update_status',
    file: 'src/app/api/execution-tasks/[id]/route.ts',
    category: 'intake',
  },
  {
    action: 'execution_task.assign_owner',
    file: 'src/app/api/execution-tasks/[id]/route.ts',
    category: 'intake',
  },
  {
    action: 'approval_request.update',
    file: 'src/app/api/admin/approval-requests/[id]/route.ts',
    category: 'approval',
  },
  {
    action: 'pricing_policy.create',
    file: 'src/app/api/admin/pricing-policies/route.ts',
    category: 'manual_adjustment',
  },
  {
    action: 'admin_profile.upsert',
    file: 'src/app/api/admin/profile/route.ts',
    category: 'manual_adjustment',
  },
  {
    action: 'project_file.analysis_completed',
    file: 'src/lib/source-analysis/jobs.ts',
    category: 'source_analysis',
  },
  {
    action: 'project_file.analysis_failed',
    file: 'src/lib/source-analysis/jobs.ts',
    category: 'source_analysis',
  },
  {
    action: 'source_analysis.cron_run',
    file: 'src/app/api/source-analysis/jobs/cron/route.ts',
    category: 'source_analysis',
  },
]
