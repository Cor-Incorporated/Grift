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

export type ConversationRole = 'assistant' | 'user' | 'system'

export type EstimateMode = 'market_comparison' | 'hours_only' | 'hybrid'

export interface Customer {
  id: string
  name: string
  email: string
  company: string | null
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
  analysis_result: Record<string, unknown> | null
  created_at: string
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
  created_at: string
}

export interface Admin {
  id: string
  user_id: string
  github_orgs: string[]
  default_hourly_rate: number
  display_name: string | null
  created_at: string
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
