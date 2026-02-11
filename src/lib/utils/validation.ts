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
})

export type CustomerInput = z.infer<typeof customerSchema>
export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type EstimateParamsInput = z.infer<typeof estimateParamsSchema>
