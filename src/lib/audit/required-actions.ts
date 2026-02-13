export interface RequiredAuditAction {
  action: string
  file: string
  category: 'estimate' | 'approval' | 'manual_adjustment' | 'source_analysis'
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
