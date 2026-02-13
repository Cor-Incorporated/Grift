export type ProjectType = 'new_project' | 'bug_report' | 'fix_request' | 'feature_addition'

export type ProjectStatus =
  | 'draft'
  | 'interviewing'
  | 'analyzing'
  | 'estimating'
  | 'completed'
  | 'rejected'
  | 'on_hold'

export type ProjectPriority = 'low' | 'medium' | 'high' | 'critical'
export type InternalRole = 'admin' | 'sales' | 'dev'
export type AppUserRole = InternalRole | 'customer'

export type ConversationRole = 'assistant' | 'user' | 'system'

export type EstimateMode = 'market_comparison' | 'hours_only' | 'hybrid'
export type ProjectFileSourceKind = 'file_upload' | 'repository_url'
export type ProjectFileAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type ChangeRequestCategory =
  | 'bug_report'
  | 'fix_request'
  | 'feature_addition'
  | 'scope_change'
  | 'other'
export type ChangeRequestStatus =
  | 'draft'
  | 'triaged'
  | 'estimated'
  | 'approved'
  | 'rejected'
  | 'implemented'
export type ChangeRequestIntakeStatus = 'needs_info' | 'ready_to_start'
export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical'
export type ExecutionTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked'
export type ChangeRequestResponsibility =
  | 'our_fault'
  | 'customer_fault'
  | 'third_party'
  | 'unknown'
export type ChangeRequestReproducibility = 'confirmed' | 'not_confirmed' | 'unknown'
export type IntakeIntentType =
  | 'bug_report'
  | 'fix_request'
  | 'feature_addition'
  | 'scope_change'
  | 'account_task'
  | 'billing_risk'
  | 'other'

export interface Customer {
  id: string
  clerk_user_id: string | null
  name: string
  email: string
  company: string | null
  phone: string | null
  created_at: string
}

export interface Project {
  id: string
  customer_id: string
  title: string
  type: ProjectType
  status: ProjectStatus
  priority: ProjectPriority | null
  existing_system_url: string | null
  spec_markdown: string | null
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: string
  project_id: string
  role: ConversationRole
  content: string
  metadata: ConversationMetadata
  created_at: string
}

export interface ConversationMetadata {
  category?: string
  confidence_score?: number
  is_complete?: boolean
  question_type?: 'open' | 'choice' | 'confirmation'
  choices?: string[]
}

export interface ProjectFile {
  id: string
  project_id: string
  file_path: string
  file_type: string | null
  file_name: string
  file_size: number | null
  source_kind?: ProjectFileSourceKind
  source_url?: string | null
  analysis_status?: ProjectFileAnalysisStatus
  analysis_error?: string | null
  analyzed_at?: string | null
  analysis_model?: string | null
  analysis_result: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  created_at: string
  updated_at?: string
}

export interface GitHubReference {
  id: string
  org_name: string
  repo_name: string
  pr_title: string | null
  pr_number: number | null
  description: string | null
  language: string | null
  hours_spent: number | null
  embedding: number[] | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface Estimate {
  id: string
  project_id: string
  estimate_mode: EstimateMode
  change_request_id?: string | null
  estimate_status?: 'draft' | 'ready'
  approval_required?: boolean
  approval_status?: 'not_required' | 'pending' | 'approved' | 'rejected'
  approval_block_reason?: string | null
  evidence_requirement_met?: boolean
  evidence_source_count?: number | null
  evidence_appendix?: Record<string, unknown> | null
  evidence_block_reason?: string | null
  your_hourly_rate: number
  your_estimated_hours: number
  total_your_cost: number
  hours_investigation: number | null
  hours_implementation: number | null
  hours_testing: number | null
  hours_buffer: number | null
  hours_breakdown_report: string | null
  market_hourly_rate: number | null
  market_estimated_hours: number | null
  multiplier: number
  total_market_cost: number | null
  comparison_report: string | null
  grok_market_data: Record<string, unknown> | null
  similar_projects: Record<string, unknown> | null
  pricing_snapshot?: Record<string, unknown> | null
  risk_flags?: string[] | null
  market_evidence_id?: string | null
  created_at: string
}

export interface Admin {
  id: string
  user_id: string
  clerk_user_id?: string | null
  github_orgs: string[]
  default_hourly_rate: number
  display_name: string | null
  created_at: string
}

export interface PricingPolicy {
  id: string
  project_type: ProjectType
  name: string
  coefficient_min: number
  coefficient_max: number
  default_coefficient: number
  minimum_project_fee: number
  minimum_margin_percent: number
  avg_internal_cost_per_member_month: number
  default_team_size: number
  default_duration_months: number
  active: boolean
  created_by_clerk_user_id: string | null
  created_at: string
  updated_at: string
}

export interface MarketEvidence {
  id: string
  project_id: string | null
  project_type: ProjectType
  source: string
  query: string
  summary: string
  data: Record<string, unknown>
  citations: Array<Record<string, unknown>>
  confidence_score: number | null
  usage: Record<string, unknown>
  created_by_clerk_user_id: string | null
  retrieved_at: string
  created_at: string
}

export interface ChangeRequest {
  id: string
  project_id: string
  title: string
  description: string
  category: ChangeRequestCategory
  status: ChangeRequestStatus
  intake_status?: ChangeRequestIntakeStatus
  requirement_completeness?: number
  missing_fields?: string[]
  source_channel?: string | null
  source_message_id?: string | null
  source_thread_id?: string | null
  source_actor_name?: string | null
  source_actor_email?: string | null
  source_event_at?: string | null
  requested_deadline?: string | null
  requested_deadline_at?: string | null
  intake_group_id?: string | null
  intake_intent?: IntakeIntentType | string | null
  impact_level: ImpactLevel
  responsibility_type?: ChangeRequestResponsibility
  reproducibility?: ChangeRequestReproducibility
  is_billable: boolean | null
  billable_reason: string | null
  billable_rule_id?: string | null
  billable_evaluation?: Record<string, unknown>
  requested_by_name: string | null
  requested_by_email: string | null
  base_estimate_id: string | null
  latest_estimate_id: string | null
  latest_execution_task_id?: string | null
  created_by_clerk_user_id: string | null
  created_at: string
  updated_at: string
}

export interface EstimateBatchRun {
  id: string
  actor_clerk_user_id: string
  scope: string
  request_params: Record<string, unknown>
  target_change_request_ids: string[]
  succeeded_change_request_ids: string[]
  failed_items: Array<{
    change_request_id: string
    error: string
  }>
  requested_count: number
  succeeded_count: number
  failed_count: number
  created_at: string
}

export interface ExecutionTask {
  id: string
  project_id: string
  change_request_id: string
  title: string
  summary: string
  status: ExecutionTaskStatus
  priority: ImpactLevel
  due_at: string | null
  owner_clerk_user_id?: string | null
  owner_role?: InternalRole | null
  created_by_clerk_user_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ExecutionTaskEventType = 'created' | 'status_changed' | 'owner_assigned' | 'note_added'

export interface ExecutionTaskEvent {
  id: string
  task_id: string
  project_id: string
  change_request_id: string
  event_type: ExecutionTaskEventType
  actor_clerk_user_id: string | null
  from_status: ExecutionTaskStatus | null
  to_status: ExecutionTaskStatus | null
  owner_clerk_user_id: string | null
  owner_role: InternalRole | null
  note: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface ChangeRequestBillableRule {
  id: string
  rule_name: string
  active: boolean
  priority: number
  applies_to_categories: ChangeRequestCategory[]
  max_warranty_days: number | null
  responsibility_required: ChangeRequestResponsibility[]
  reproducibility_required: ChangeRequestReproducibility[]
  result_is_billable: boolean
  reason_template: string
  metadata: Record<string, unknown>
  created_by_clerk_user_id: string | null
  created_at: string
  updated_at: string
}

export interface EstimateVersion {
  id: string
  estimate_id: string
  project_id: string
  change_request_id: string | null
  version: number
  version_type: 'initial' | 'revised' | 'change_order'
  snapshot: Record<string, unknown>
  created_by_clerk_user_id: string | null
  created_at: string
}

export type DataSourceType = 'search' | 'public_stats' | 'internal' | 'manual'

export interface DataSource {
  id: string
  source_key: string
  provider: string
  source_type: DataSourceType
  display_name: string
  description: string | null
  docs_url: string | null
  terms_url: string | null
  trust_level: number
  freshness_ttl_hours: number
  update_frequency_minutes: number
  estimated_cost_per_call: number
  currency: string
  quota_daily: number | null
  quota_monthly: number | null
  active: boolean
  metadata: Record<string, unknown>
  created_by_clerk_user_id: string | null
  created_at: string
  updated_at: string
}

export type ApiUsageRequestStatus = 'success' | 'error' | 'blocked'

export interface ApiUsageLog {
  id: string
  provider: string
  source_key: string
  endpoint: string | null
  model: string | null
  request_status: ApiUsageRequestStatus
  request_count: number
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  total_tokens: number | null
  estimated_cost: number
  currency: string
  quota_daily: number | null
  quota_monthly: number | null
  over_quota: boolean
  error_message: string | null
  project_id: string | null
  actor_clerk_user_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type ApprovalRequestType =
  | 'floor_breach'
  | 'low_margin'
  | 'manual_override'
  | 'high_risk_change'
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type ApprovalSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface ApprovalRequest {
  id: string
  project_id: string
  estimate_id: string | null
  change_request_id: string | null
  request_type: ApprovalRequestType
  required_role: InternalRole
  assigned_to_role: InternalRole | null
  status: ApprovalRequestStatus
  severity: ApprovalSeverity
  reason: string
  context: Record<string, unknown>
  requested_by_clerk_user_id: string
  assigned_to_clerk_user_id: string | null
  resolved_by_clerk_user_id: string | null
  resolved_by_role: InternalRole | null
  resolution_comment: string | null
  requested_at: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  clerk_user_id: string
  email: string | null
  roles: InternalRole[]
  active: boolean
  created_by_clerk_user_id: string | null
  created_at: string
  updated_at: string
}

export interface ProjectWithCustomer extends Project {
  customer: Customer
}

export interface ProjectWithDetails extends Project {
  customer: Customer
  conversations: Conversation[]
  files: ProjectFile[]
  estimates: Estimate[]
}
