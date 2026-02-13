import { z } from 'zod'

export const customerSchema = z.object({
  name: z.string().min(1, '名前を入力してください').max(100),
  email: z.string().email('有効なメールアドレスを入力してください'),
  company: z.string().max(200).optional(),
})

export const projectTypeSchema = z.enum([
  'new_project',
  'bug_report',
  'fix_request',
  'feature_addition',
])

export const changeRequestCategorySchema = z.enum([
  'bug_report',
  'fix_request',
  'feature_addition',
  'scope_change',
  'other',
])

export const changeRequestResponsibilitySchema = z.enum([
  'our_fault',
  'customer_fault',
  'third_party',
  'unknown',
])

export const changeRequestReproducibilitySchema = z.enum([
  'confirmed',
  'not_confirmed',
  'unknown',
])
export const intakeIntentTypeSchema = z.enum([
  'bug_report',
  'fix_request',
  'feature_addition',
  'scope_change',
  'account_task',
  'billing_risk',
  'other',
])
export const internalRoleSchema = z.enum(['admin', 'sales', 'dev'])

export const projectPrioritySchema = z.enum(['low', 'medium', 'high', 'critical'])

export const createProjectSchema = z.object({
  customer_id: z.string().uuid(),
  title: z.string().min(1, 'タイトルを入力してください').max(200),
  type: projectTypeSchema,
  priority: projectPrioritySchema.optional(),
  existing_system_url: z.string().url().optional().or(z.literal('')),
})

export const sendMessageSchema = z.object({
  project_id: z.string().uuid(),
  content: z.string().min(1, 'メッセージを入力してください').max(10000),
})

export const estimateParamsSchema = z.object({
  project_id: z.string().uuid(),
  your_hourly_rate: z.number().positive('時給は正の数で入力してください'),
  multiplier: z.number().min(1).max(5).default(1.5),
  coefficient: z.number().min(0.3).max(1.2).optional(),
  region: z.string().min(1).max(100).optional(),
})

export const pricingPolicySchema = z.object({
  project_type: projectTypeSchema,
  name: z.string().min(1).max(120),
  coefficient_min: z.number().positive(),
  coefficient_max: z.number().positive(),
  default_coefficient: z.number().positive(),
  minimum_project_fee: z.number().nonnegative(),
  minimum_margin_percent: z.number().min(0).max(100),
  avg_internal_cost_per_member_month: z.number().positive(),
  default_team_size: z.number().int().min(1).max(20),
  default_duration_months: z.number().positive().max(36),
  active: z.boolean().default(true),
})

export const marketEvidenceRequestSchema = z.object({
  project_id: z.string().uuid().optional(),
  project_type: projectTypeSchema,
  context: z.string().min(10).max(6000),
  region: z.string().min(1).max(100).optional(),
})

export const changeRequestSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().min(10).max(10000),
  category: changeRequestCategorySchema,
  impact_level: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  responsibility_type: changeRequestResponsibilitySchema.default('unknown'),
  reproducibility: changeRequestReproducibilitySchema.default('unknown'),
  requested_by_name: z.string().min(1).max(120).optional(),
  requested_by_email: z.string().email().optional(),
})

export const intakeSourceSchema = z.object({
  channel: z.string().min(1).max(80).default('web_app'),
  message_id: z.string().min(1).max(200).optional(),
  thread_id: z.string().min(1).max(200).optional(),
  actor_name: z.string().min(1).max(120).optional(),
  actor_email: z.string().email().optional(),
  event_at: z.string().datetime().optional(),
})

export const intakeParseRequestSchema = z.object({
  project_id: z.string().uuid(),
  message: z.string().min(3).max(20000),
  source: intakeSourceSchema.optional(),
})

export const intakeIngestRequestSchema = intakeParseRequestSchema.extend({
  requested_by_name: z.string().min(1).max(120).optional(),
  requested_by_email: z.string().email().optional(),
  minimum_completeness: z.number().int().min(0).max(100).optional(),
})

export const intakeFollowUpRequestSchema = z.object({
  intent_type: intakeIntentTypeSchema,
  title: z.string().min(1).max(200).optional(),
  summary: z.string().min(1).max(5000).optional(),
  missing_fields: z.array(z.string().min(1).max(80)).min(1),
})

export const changeRequestEstimateSchema = z.object({
  your_hourly_rate: z.number().positive(),
  include_market_context: z.boolean().default(false),
  region: z.string().min(1).max(100).optional(),
})

export const dataSourceSchema = z.object({
  source_key: z.string().min(1).max(120),
  provider: z.string().min(1).max(120),
  source_type: z.enum(['search', 'public_stats', 'internal', 'manual']),
  display_name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  docs_url: z.string().url().optional(),
  terms_url: z.string().url().optional(),
  trust_level: z.number().min(0).max(1).default(0.7),
  freshness_ttl_hours: z.number().int().min(1).max(24 * 365).default(168),
  update_frequency_minutes: z.number().int().min(1).max(24 * 60 * 365).default(1440),
  estimated_cost_per_call: z.number().min(0).default(0),
  currency: z.string().min(3).max(10).default('JPY'),
  quota_daily: z.number().int().min(0).optional(),
  quota_monthly: z.number().int().min(0).optional(),
  active: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const approvalRequestCreateSchema = z.object({
  project_id: z.string().uuid(),
  estimate_id: z.string().uuid().optional(),
  change_request_id: z.string().uuid().optional(),
  request_type: z.enum([
    'floor_breach',
    'low_margin',
    'manual_override',
    'high_risk_change',
  ]),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  reason: z.string().min(3).max(3000),
  context: z.record(z.string(), z.unknown()).default({}),
  required_role: internalRoleSchema.default('admin'),
  assigned_to_role: internalRoleSchema.optional(),
  assigned_to_clerk_user_id: z.string().min(1).max(120).optional(),
})

export const approvalRequestUpdateSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
  resolution_comment: z.string().max(3000).optional(),
  assigned_to_role: internalRoleSchema.optional(),
  assigned_to_clerk_user_id: z.string().min(1).max(120).optional(),
})

export const changeRequestBillableRuleSchema = z.object({
  id: z.string().uuid().optional(),
  rule_name: z.string().min(3).max(200),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
  applies_to_categories: z.array(changeRequestCategorySchema).min(1),
  max_warranty_days: z.number().int().min(0).max(3650).nullable().optional(),
  responsibility_required: z.array(changeRequestResponsibilitySchema).default([]),
  reproducibility_required: z.array(changeRequestReproducibilitySchema).default([]),
  result_is_billable: z.boolean(),
  reason_template: z.string().min(3).max(1000),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const teamMemberSchema = z.object({
  clerk_user_id: z.string().min(1).max(120),
  email: z.string().email().optional().nullable(),
  roles: z.array(internalRoleSchema).min(1),
  active: z.boolean().default(true),
})

export const adminProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(120),
  default_hourly_rate: z.number().int().min(1000).max(1000000),
})

export const repositoryAnalysisRequestSchema = z.object({
  project_id: z.string().uuid(),
  repository_url: z.string().url(),
})

export const sourceAnalysisRunRequestSchema = z.object({
  project_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(10).default(2),
})

export const executionTaskUpdateSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional(),
  note: z.string().max(1000).optional(),
  owner_role: internalRoleSchema.optional(),
  owner_clerk_user_id: z.string().min(1).max(120).optional(),
}).refine(
  (value) => Boolean(value.status || value.note || value.owner_role || value.owner_clerk_user_id),
  {
    message: '少なくとも1つの更新項目を指定してください',
  }
)

export type CustomerInput = z.infer<typeof customerSchema>
export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type EstimateParamsInput = z.infer<typeof estimateParamsSchema>
export type PricingPolicyInput = z.infer<typeof pricingPolicySchema>
export type MarketEvidenceRequestInput = z.infer<typeof marketEvidenceRequestSchema>
export type ChangeRequestInput = z.infer<typeof changeRequestSchema>
export type ChangeRequestEstimateInput = z.infer<typeof changeRequestEstimateSchema>
export type IntakeParseRequestInput = z.infer<typeof intakeParseRequestSchema>
export type IntakeIngestRequestInput = z.infer<typeof intakeIngestRequestSchema>
export type IntakeFollowUpRequestInput = z.infer<typeof intakeFollowUpRequestSchema>
export type IntakeSourceInput = z.infer<typeof intakeSourceSchema>
export type DataSourceInput = z.infer<typeof dataSourceSchema>
export type ApprovalRequestCreateInput = z.infer<typeof approvalRequestCreateSchema>
export type ApprovalRequestUpdateInput = z.infer<typeof approvalRequestUpdateSchema>
export type ChangeRequestBillableRuleInput = z.infer<typeof changeRequestBillableRuleSchema>
export type TeamMemberInput = z.infer<typeof teamMemberSchema>
export type AdminProfileInput = z.infer<typeof adminProfileSchema>
export type RepositoryAnalysisRequestInput = z.infer<typeof repositoryAnalysisRequestSchema>
export type SourceAnalysisRunRequestInput = z.infer<typeof sourceAnalysisRunRequestSchema>
export type ExecutionTaskUpdateInput = z.infer<typeof executionTaskUpdateSchema>
