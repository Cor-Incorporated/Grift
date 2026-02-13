import { describe, it, expect } from 'vitest'
import {
  adminProfileSchema,
  customerSchema,
  createProjectSchema,
  sendMessageSchema,
  estimateParamsSchema,
} from '../validation'

describe('customerSchema', () => {
  it('should validate a valid customer', () => {
    const result = customerSchema.safeParse({
      name: 'テスト太郎',
      email: 'test@example.com',
      company: '株式会社テスト',
    })
    expect(result.success).toBe(true)
  })

  it('should reject an empty name', () => {
    const result = customerSchema.safeParse({
      name: '',
      email: 'test@example.com',
    })
    expect(result.success).toBe(false)
  })

  it('should reject an invalid email', () => {
    const result = customerSchema.safeParse({
      name: 'テスト太郎',
      email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('should allow optional company', () => {
    const result = customerSchema.safeParse({
      name: 'テスト太郎',
      email: 'test@example.com',
    })
    expect(result.success).toBe(true)
  })
})

describe('createProjectSchema', () => {
  it('should validate a valid new_project', () => {
    const result = createProjectSchema.safeParse({
      customer_id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'テストプロジェクト',
      type: 'new_project',
    })
    expect(result.success).toBe(true)
  })

  it('should validate all project types', () => {
    const types = ['new_project', 'bug_report', 'fix_request', 'feature_addition']
    types.forEach((type) => {
      const result = createProjectSchema.safeParse({
        customer_id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'テスト',
        type,
      })
      expect(result.success).toBe(true)
    })
  })

  it('should reject invalid project type', () => {
    const result = createProjectSchema.safeParse({
      customer_id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'テスト',
      type: 'invalid_type',
    })
    expect(result.success).toBe(false)
  })

  it('should reject an empty title', () => {
    const result = createProjectSchema.safeParse({
      customer_id: '550e8400-e29b-41d4-a716-446655440000',
      title: '',
      type: 'new_project',
    })
    expect(result.success).toBe(false)
  })
})

describe('sendMessageSchema', () => {
  it('should validate a valid message', () => {
    const result = sendMessageSchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      content: 'テストメッセージ',
    })
    expect(result.success).toBe(true)
  })

  it('should reject an empty content', () => {
    const result = sendMessageSchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      content: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('estimateParamsSchema', () => {
  it('should validate valid estimate params', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      your_hourly_rate: 15000,
    })
    expect(result.success).toBe(true)
  })

  it('should reject a negative hourly rate', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      your_hourly_rate: -1000,
    })
    expect(result.success).toBe(false)
  })

  it('should apply default multiplier', () => {
    const result = estimateParamsSchema.parse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      your_hourly_rate: 15000,
    })
    expect(result.multiplier).toBe(1.5)
  })
})

describe('adminProfileSchema', () => {
  it('should validate a valid admin profile', () => {
    const result = adminProfileSchema.safeParse({
      display_name: '管理者 太郎',
      default_hourly_rate: 18000,
    })
    expect(result.success).toBe(true)
  })

  it('should reject empty display name', () => {
    const result = adminProfileSchema.safeParse({
      display_name: '',
      default_hourly_rate: 18000,
    })
    expect(result.success).toBe(false)
  })

  it('should reject too low hourly rate', () => {
    const result = adminProfileSchema.safeParse({
      display_name: '管理者 太郎',
      default_hourly_rate: 500,
    })
    expect(result.success).toBe(false)
  })
})
