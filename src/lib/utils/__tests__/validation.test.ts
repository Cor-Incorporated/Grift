import { describe, it, expect } from 'vitest'
import {
  adminProfileSchema,
  customerSchema,
  createProjectSchema,
  sendMessageSchema,
  estimateParamsSchema,
  projectTypeSchema,
  concreteProjectTypeSchema,
  changeRequestCategorySchema,
  changeRequestResponsibilitySchema,
  changeRequestReproducibilitySchema,
  intakeIntentTypeSchema,
  internalRoleSchema,
  projectPrioritySchema,
  pricingPolicySchema,
  marketEvidenceRequestSchema,
  changeRequestSchema,
  intakeSourceSchema,
  intakeParseRequestSchema,
  intakeIngestRequestSchema,
  intakeFollowUpRequestSchema,
  changeRequestEstimateSchema,
  dataSourceSchema,
  approvalRequestCreateSchema,
  approvalRequestUpdateSchema,
  changeRequestBillableRuleSchema,
  teamMemberSchema,
  businessLineSchema,
  githubReferenceUpdateSchema,
  githubSyncRequestSchema,
  repositoryAnalysisRequestSchema,
  sourceAnalysisRunRequestSchema,
  executionTaskUpdateSchema,
} from '../validation'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const VALID_UUID_2 = '223e4567-e89b-12d3-a456-426614174001'

// ---------------------------------------------------------------------------
// customerSchema
// ---------------------------------------------------------------------------
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

  it('rejects name exceeding 100 chars', () => {
    const result = customerSchema.safeParse({ name: 'a'.repeat(101), email: 'x@x.com' })
    expect(result.success).toBe(false)
  })

  it('rejects company exceeding 200 chars', () => {
    const result = customerSchema.safeParse({
      name: 'Test',
      email: 'x@x.com',
      company: 'a'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('rejects SQL injection attempt in email field', () => {
    const result = customerSchema.safeParse({ name: 'Test', email: "' OR 1=1; --" })
    expect(result.success).toBe(false)
  })

  it('accepts special characters in name', () => {
    const result = customerSchema.safeParse({ name: '山田 太郎', email: 'test@example.com' })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// projectTypeSchema
// ---------------------------------------------------------------------------
describe('projectTypeSchema', () => {
  const validTypes = ['new_project', 'bug_report', 'fix_request', 'feature_addition', 'undetermined'] as const

  validTypes.forEach((type) => {
    it(`accepts "${type}"`, () => {
      expect(projectTypeSchema.parse(type)).toBe(type)
    })
  })

  it('rejects unknown type', () => {
    expect(projectTypeSchema.safeParse('unknown_type').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(projectTypeSchema.safeParse('').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// concreteProjectTypeSchema
// ---------------------------------------------------------------------------
describe('concreteProjectTypeSchema', () => {
  it('accepts all concrete project types', () => {
    const types = ['new_project', 'bug_report', 'fix_request', 'feature_addition'] as const
    types.forEach((type) => {
      expect(concreteProjectTypeSchema.parse(type)).toBe(type)
    })
  })

  it('rejects "undetermined" (not a concrete type)', () => {
    expect(concreteProjectTypeSchema.safeParse('undetermined').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// changeRequestCategorySchema
// ---------------------------------------------------------------------------
describe('changeRequestCategorySchema', () => {
  const validCategories = ['bug_report', 'fix_request', 'feature_addition', 'scope_change', 'other'] as const

  validCategories.forEach((cat) => {
    it(`accepts "${cat}"`, () => {
      expect(changeRequestCategorySchema.parse(cat)).toBe(cat)
    })
  })

  it('rejects invalid category', () => {
    expect(changeRequestCategorySchema.safeParse('invalid').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// changeRequestResponsibilitySchema
// ---------------------------------------------------------------------------
describe('changeRequestResponsibilitySchema', () => {
  const valid = ['our_fault', 'customer_fault', 'third_party', 'unknown'] as const

  valid.forEach((v) => {
    it(`accepts "${v}"`, () => {
      expect(changeRequestResponsibilitySchema.parse(v)).toBe(v)
    })
  })

  it('rejects invalid responsibility', () => {
    expect(changeRequestResponsibilitySchema.safeParse('nobody').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// changeRequestReproducibilitySchema
// ---------------------------------------------------------------------------
describe('changeRequestReproducibilitySchema', () => {
  const valid = ['confirmed', 'not_confirmed', 'unknown'] as const

  valid.forEach((v) => {
    it(`accepts "${v}"`, () => {
      expect(changeRequestReproducibilitySchema.parse(v)).toBe(v)
    })
  })

  it('rejects invalid value', () => {
    expect(changeRequestReproducibilitySchema.safeParse('maybe').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// intakeIntentTypeSchema
// ---------------------------------------------------------------------------
describe('intakeIntentTypeSchema', () => {
  const valid = [
    'bug_report',
    'fix_request',
    'feature_addition',
    'scope_change',
    'account_task',
    'billing_risk',
    'other',
  ] as const

  valid.forEach((v) => {
    it(`accepts "${v}"`, () => {
      expect(intakeIntentTypeSchema.parse(v)).toBe(v)
    })
  })

  it('rejects unknown intent', () => {
    expect(intakeIntentTypeSchema.safeParse('refund').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// internalRoleSchema
// ---------------------------------------------------------------------------
describe('internalRoleSchema', () => {
  it('accepts admin', () => expect(internalRoleSchema.parse('admin')).toBe('admin'))
  it('accepts sales', () => expect(internalRoleSchema.parse('sales')).toBe('sales'))
  it('accepts dev', () => expect(internalRoleSchema.parse('dev')).toBe('dev'))
  it('rejects customer role', () => expect(internalRoleSchema.safeParse('customer').success).toBe(false))
  it('rejects empty string', () => expect(internalRoleSchema.safeParse('').success).toBe(false))
})

// ---------------------------------------------------------------------------
// projectPrioritySchema
// ---------------------------------------------------------------------------
describe('projectPrioritySchema', () => {
  const valid = ['low', 'medium', 'high', 'critical'] as const

  valid.forEach((v) => {
    it(`accepts "${v}"`, () => expect(projectPrioritySchema.parse(v)).toBe(v))
  })

  it('rejects unknown priority', () => {
    expect(projectPrioritySchema.safeParse('urgent').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createProjectSchema
// ---------------------------------------------------------------------------
describe('createProjectSchema', () => {
  it('should validate a valid new_project', () => {
    const result = createProjectSchema.safeParse({
      customer_id: VALID_UUID,
      title: 'テストプロジェクト',
      type: 'new_project',
    })
    expect(result.success).toBe(true)
  })

  it('should validate all project types', () => {
    const types = ['new_project', 'bug_report', 'fix_request', 'feature_addition']
    types.forEach((type) => {
      const result = createProjectSchema.safeParse({
        customer_id: VALID_UUID,
        title: 'テスト',
        type,
      })
      expect(result.success).toBe(true)
    })
  })

  it('should reject invalid project type', () => {
    const result = createProjectSchema.safeParse({
      customer_id: VALID_UUID,
      title: 'テスト',
      type: 'invalid_type',
    })
    expect(result.success).toBe(false)
  })

  it('should reject an empty title', () => {
    const result = createProjectSchema.safeParse({
      customer_id: VALID_UUID,
      title: '',
      type: 'new_project',
    })
    expect(result.success).toBe(false)
  })

  it('applies default title and type when omitted', () => {
    const result = createProjectSchema.parse({ customer_id: VALID_UUID })
    expect(result.title).toBe('新規ご相談')
    expect(result.type).toBe('undetermined')
  })

  it('accepts empty string for existing_system_url (or clause)', () => {
    const result = createProjectSchema.parse({ customer_id: VALID_UUID, existing_system_url: '' })
    expect(result.existing_system_url).toBe('')
  })

  it('rejects non-URL for existing_system_url (non-empty string)', () => {
    const result = createProjectSchema.safeParse({
      customer_id: VALID_UUID,
      existing_system_url: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID customer_id', () => {
    const result = createProjectSchema.safeParse({ customer_id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects title exceeding 200 chars', () => {
    const result = createProjectSchema.safeParse({
      customer_id: VALID_UUID,
      title: 'a'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid priority', () => {
    const result = createProjectSchema.parse({ customer_id: VALID_UUID, priority: 'high' })
    expect(result.priority).toBe('high')
  })
})

// ---------------------------------------------------------------------------
// sendMessageSchema
// ---------------------------------------------------------------------------
describe('sendMessageSchema', () => {
  it('should validate a valid message', () => {
    const result = sendMessageSchema.safeParse({
      project_id: VALID_UUID,
      content: 'テストメッセージ',
    })
    expect(result.success).toBe(true)
  })

  it('should reject an empty content', () => {
    const result = sendMessageSchema.safeParse({
      project_id: VALID_UUID,
      content: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects content exceeding 10000 chars', () => {
    const result = sendMessageSchema.safeParse({ project_id: VALID_UUID, content: 'a'.repeat(10001) })
    expect(result.success).toBe(false)
  })

  it('accepts content at exactly 10000 chars', () => {
    const result = sendMessageSchema.safeParse({ project_id: VALID_UUID, content: 'a'.repeat(10000) })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID project_id', () => {
    const result = sendMessageSchema.safeParse({ project_id: 'bad-id', content: 'Hello' })
    expect(result.success).toBe(false)
  })

  it('accepts XSS-looking content (validation, not sanitization)', () => {
    const result = sendMessageSchema.safeParse({
      project_id: VALID_UUID,
      content: '<script>alert("xss")</script>',
    })
    expect(result.success).toBe(true)
  })

  it('accepts SQL injection content (validation, not sanitization)', () => {
    const result = sendMessageSchema.safeParse({
      project_id: VALID_UUID,
      content: "SELECT * FROM users WHERE '1'='1'",
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// estimateParamsSchema
// ---------------------------------------------------------------------------
describe('estimateParamsSchema', () => {
  it('should validate valid estimate params', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: VALID_UUID,
      your_hourly_rate: 15000,
    })
    expect(result.success).toBe(true)
  })

  it('should reject a negative hourly rate', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: VALID_UUID,
      your_hourly_rate: -1000,
    })
    expect(result.success).toBe(false)
  })

  it('should apply default multiplier', () => {
    const result = estimateParamsSchema.parse({
      project_id: VALID_UUID,
      your_hourly_rate: 15000,
    })
    expect(result.multiplier).toBe(1.5)
  })

  it('rejects zero hourly rate', () => {
    const result = estimateParamsSchema.safeParse({ project_id: VALID_UUID, your_hourly_rate: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects multiplier below 1', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: VALID_UUID,
      your_hourly_rate: 5000,
      multiplier: 0.9,
    })
    expect(result.success).toBe(false)
  })

  it('rejects multiplier above 5', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: VALID_UUID,
      your_hourly_rate: 5000,
      multiplier: 5.1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects coefficient below 0.3', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: VALID_UUID,
      your_hourly_rate: 5000,
      coefficient: 0.29,
    })
    expect(result.success).toBe(false)
  })

  it('rejects coefficient above 1.2', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: VALID_UUID,
      your_hourly_rate: 5000,
      coefficient: 1.21,
    })
    expect(result.success).toBe(false)
  })

  it('rejects region exceeding 100 chars', () => {
    const result = estimateParamsSchema.safeParse({
      project_id: VALID_UUID,
      your_hourly_rate: 5000,
      region: 'a'.repeat(101),
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pricingPolicySchema
// ---------------------------------------------------------------------------
describe('pricingPolicySchema', () => {
  const validPolicy = {
    project_type: 'new_project' as const,
    name: 'Standard Policy',
    coefficient_min: 1.2,
    coefficient_max: 2.0,
    default_coefficient: 1.5,
    minimum_project_fee: 500000,
    minimum_margin_percent: 30,
    avg_internal_cost_per_member_month: 600000,
    default_team_size: 3,
    default_duration_months: 6,
  }

  it('accepts valid pricing policy with defaults', () => {
    const result = pricingPolicySchema.parse(validPolicy)
    expect(result.active).toBe(true)
  })

  it('rejects negative coefficient_min', () => {
    expect(pricingPolicySchema.safeParse({ ...validPolicy, coefficient_min: -0.1 }).success).toBe(false)
  })

  it('rejects minimum_margin_percent above 100', () => {
    expect(pricingPolicySchema.safeParse({ ...validPolicy, minimum_margin_percent: 101 }).success).toBe(false)
  })

  it('rejects default_team_size of 0', () => {
    expect(pricingPolicySchema.safeParse({ ...validPolicy, default_team_size: 0 }).success).toBe(false)
  })

  it('rejects default_team_size above 20', () => {
    expect(pricingPolicySchema.safeParse({ ...validPolicy, default_team_size: 21 }).success).toBe(false)
  })

  it('rejects default_duration_months above 36', () => {
    expect(pricingPolicySchema.safeParse({ ...validPolicy, default_duration_months: 37 }).success).toBe(false)
  })

  it('rejects non-integer default_team_size', () => {
    expect(pricingPolicySchema.safeParse({ ...validPolicy, default_team_size: 2.5 }).success).toBe(false)
  })

  it('accepts minimum_project_fee of 0 (nonnegative)', () => {
    const result = pricingPolicySchema.parse({ ...validPolicy, minimum_project_fee: 0 })
    expect(result.minimum_project_fee).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// marketEvidenceRequestSchema
// ---------------------------------------------------------------------------
describe('marketEvidenceRequestSchema', () => {
  it('accepts valid request', () => {
    const result = marketEvidenceRequestSchema.parse({
      project_type: 'new_project',
      context: 'This is a valid context with enough characters.',
    })
    expect(result.project_type).toBe('new_project')
  })

  it('rejects context shorter than 10 chars', () => {
    expect(
      marketEvidenceRequestSchema.safeParse({ project_type: 'new_project', context: 'short' }).success
    ).toBe(false)
  })

  it('rejects context exceeding 6000 chars', () => {
    expect(
      marketEvidenceRequestSchema.safeParse({
        project_type: 'new_project',
        context: 'a'.repeat(6001),
      }).success
    ).toBe(false)
  })

  it('accepts optional project_id as UUID', () => {
    const result = marketEvidenceRequestSchema.parse({
      project_id: VALID_UUID,
      project_type: 'feature_addition',
      context: 'Sufficient context here for the test.',
    })
    expect(result.project_id).toBe(VALID_UUID)
  })

  it('rejects invalid project_id (non-UUID)', () => {
    expect(
      marketEvidenceRequestSchema.safeParse({
        project_id: 'bad',
        project_type: 'new_project',
        context: 'Valid context text here.',
      }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// changeRequestSchema
// ---------------------------------------------------------------------------
describe('changeRequestSchema', () => {
  const validCR = {
    project_id: VALID_UUID,
    title: 'Fix login bug',
    description: 'Users cannot log in when using special characters in password.',
    category: 'bug_report' as const,
  }

  it('accepts valid change request with defaults', () => {
    const result = changeRequestSchema.parse(validCR)
    expect(result.impact_level).toBe('medium')
    expect(result.responsibility_type).toBe('unknown')
    expect(result.reproducibility).toBe('unknown')
  })

  it('accepts optional email field', () => {
    const result = changeRequestSchema.parse({
      ...validCR,
      requested_by_email: 'user@example.com',
    })
    expect(result.requested_by_email).toBe('user@example.com')
  })

  it('rejects invalid requester email', () => {
    expect(changeRequestSchema.safeParse({ ...validCR, requested_by_email: 'not-an-email' }).success).toBe(false)
  })

  it('rejects description shorter than 10 chars', () => {
    expect(changeRequestSchema.safeParse({ ...validCR, description: 'short' }).success).toBe(false)
  })

  it('rejects empty title', () => {
    expect(changeRequestSchema.safeParse({ ...validCR, title: '' }).success).toBe(false)
  })

  it('rejects title exceeding 200 chars', () => {
    expect(changeRequestSchema.safeParse({ ...validCR, title: 'a'.repeat(201) }).success).toBe(false)
  })

  it('rejects invalid category', () => {
    expect(changeRequestSchema.safeParse({ ...validCR, category: 'invalid' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// intakeSourceSchema
// ---------------------------------------------------------------------------
describe('intakeSourceSchema', () => {
  it('accepts minimal input with default channel', () => {
    const result = intakeSourceSchema.parse({})
    expect(result.channel).toBe('web_app')
  })

  it('accepts full source data', () => {
    const result = intakeSourceSchema.parse({
      channel: 'slack',
      message_id: 'msg123',
      thread_id: 'thread456',
      actor_name: 'Alice',
      actor_email: 'alice@example.com',
      event_at: '2024-01-15T10:00:00.000Z',
    })
    expect(result.channel).toBe('slack')
  })

  it('rejects invalid actor_email', () => {
    expect(intakeSourceSchema.safeParse({ actor_email: 'not-valid' }).success).toBe(false)
  })

  it('rejects invalid ISO datetime for event_at', () => {
    expect(intakeSourceSchema.safeParse({ event_at: '2024-01-15' }).success).toBe(false)
  })

  it('rejects channel exceeding 80 chars', () => {
    expect(intakeSourceSchema.safeParse({ channel: 'a'.repeat(81) }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// intakeParseRequestSchema
// ---------------------------------------------------------------------------
describe('intakeParseRequestSchema', () => {
  it('accepts valid parse request', () => {
    const result = intakeParseRequestSchema.parse({
      project_id: VALID_UUID,
      message: 'Please fix the login issue',
    })
    expect(result.project_id).toBe(VALID_UUID)
  })

  it('accepts parser_mode auto', () => {
    const result = intakeParseRequestSchema.parse({
      project_id: VALID_UUID,
      message: 'Valid message text',
      parser_mode: 'auto',
    })
    expect(result.parser_mode).toBe('auto')
  })

  it('accepts parser_mode heuristic', () => {
    const result = intakeParseRequestSchema.parse({
      project_id: VALID_UUID,
      message: 'Valid message text',
      parser_mode: 'heuristic',
    })
    expect(result.parser_mode).toBe('heuristic')
  })

  it('rejects message shorter than 3 chars', () => {
    expect(intakeParseRequestSchema.safeParse({ project_id: VALID_UUID, message: 'ab' }).success).toBe(false)
  })

  it('rejects message exceeding 20000 chars', () => {
    expect(
      intakeParseRequestSchema.safeParse({ project_id: VALID_UUID, message: 'a'.repeat(20001) }).success
    ).toBe(false)
  })

  it('rejects invalid parser_mode', () => {
    expect(
      intakeParseRequestSchema.safeParse({ project_id: VALID_UUID, message: 'Valid msg', parser_mode: 'ai' }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// intakeIngestRequestSchema
// ---------------------------------------------------------------------------
describe('intakeIngestRequestSchema', () => {
  it('extends intakeParseRequestSchema with extra fields', () => {
    const result = intakeIngestRequestSchema.parse({
      project_id: VALID_UUID,
      message: 'Ingest this message please',
      requested_by_name: 'Bob',
      requested_by_email: 'bob@example.com',
      minimum_completeness: 80,
    })
    expect(result.minimum_completeness).toBe(80)
    expect(result.requested_by_name).toBe('Bob')
  })

  it('rejects minimum_completeness below 0', () => {
    expect(
      intakeIngestRequestSchema.safeParse({
        project_id: VALID_UUID,
        message: 'Test message',
        minimum_completeness: -1,
      }).success
    ).toBe(false)
  })

  it('rejects minimum_completeness above 100', () => {
    expect(
      intakeIngestRequestSchema.safeParse({
        project_id: VALID_UUID,
        message: 'Test message',
        minimum_completeness: 101,
      }).success
    ).toBe(false)
  })

  it('rejects non-integer minimum_completeness', () => {
    expect(
      intakeIngestRequestSchema.safeParse({
        project_id: VALID_UUID,
        message: 'Test message',
        minimum_completeness: 80.5,
      }).success
    ).toBe(false)
  })

  it('rejects invalid requester email', () => {
    expect(
      intakeIngestRequestSchema.safeParse({
        project_id: VALID_UUID,
        message: 'Test message',
        requested_by_email: 'invalid-email',
      }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// intakeFollowUpRequestSchema
// ---------------------------------------------------------------------------
describe('intakeFollowUpRequestSchema', () => {
  it('accepts valid follow-up request', () => {
    const result = intakeFollowUpRequestSchema.parse({
      intent_type: 'bug_report',
      missing_fields: ['reproduction_steps'],
    })
    expect(result.missing_fields).toHaveLength(1)
  })

  it('accepts optional title and summary', () => {
    const result = intakeFollowUpRequestSchema.parse({
      intent_type: 'feature_addition',
      title: 'Add export button',
      summary: 'User wants to export data to CSV format.',
      missing_fields: ['target_format', 'scope'],
    })
    expect(result.title).toBe('Add export button')
  })

  it('rejects empty missing_fields array', () => {
    expect(
      intakeFollowUpRequestSchema.safeParse({ intent_type: 'bug_report', missing_fields: [] }).success
    ).toBe(false)
  })

  it('rejects invalid intent_type', () => {
    expect(
      intakeFollowUpRequestSchema.safeParse({ intent_type: 'unknown', missing_fields: ['field'] }).success
    ).toBe(false)
  })

  it('rejects missing_fields entry exceeding 80 chars', () => {
    expect(
      intakeFollowUpRequestSchema.safeParse({
        intent_type: 'bug_report',
        missing_fields: ['a'.repeat(81)],
      }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// changeRequestEstimateSchema
// ---------------------------------------------------------------------------
describe('changeRequestEstimateSchema', () => {
  it('accepts valid input with default include_market_context', () => {
    const result = changeRequestEstimateSchema.parse({ your_hourly_rate: 6000 })
    expect(result.include_market_context).toBe(false)
  })

  it('accepts include_market_context = true', () => {
    const result = changeRequestEstimateSchema.parse({
      your_hourly_rate: 6000,
      include_market_context: true,
    })
    expect(result.include_market_context).toBe(true)
  })

  it('rejects zero hourly rate', () => {
    expect(changeRequestEstimateSchema.safeParse({ your_hourly_rate: 0 }).success).toBe(false)
  })

  it('rejects negative hourly rate', () => {
    expect(changeRequestEstimateSchema.safeParse({ your_hourly_rate: -1 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// dataSourceSchema
// ---------------------------------------------------------------------------
describe('dataSourceSchema', () => {
  const validDS = {
    source_key: 'market_data_v1',
    provider: 'Grok AI',
    source_type: 'search' as const,
    display_name: 'Market Data Provider v1',
  }

  it('accepts minimal valid data source with defaults', () => {
    const result = dataSourceSchema.parse(validDS)
    expect(result.trust_level).toBe(0.7)
    expect(result.freshness_ttl_hours).toBe(168)
    expect(result.active).toBe(true)
    expect(result.metadata).toEqual({})
    expect(result.currency).toBe('JPY')
  })

  it('accepts all source_type variants', () => {
    const types = ['search', 'public_stats', 'internal', 'manual'] as const
    types.forEach((type) => {
      const result = dataSourceSchema.parse({ ...validDS, source_type: type })
      expect(result.source_type).toBe(type)
    })
  })

  it('rejects trust_level below 0', () => {
    expect(dataSourceSchema.safeParse({ ...validDS, trust_level: -0.1 }).success).toBe(false)
  })

  it('rejects trust_level above 1', () => {
    expect(dataSourceSchema.safeParse({ ...validDS, trust_level: 1.1 }).success).toBe(false)
  })

  it('rejects invalid docs_url', () => {
    expect(dataSourceSchema.safeParse({ ...validDS, docs_url: 'not-a-url' }).success).toBe(false)
  })

  it('accepts valid docs_url', () => {
    const result = dataSourceSchema.parse({ ...validDS, docs_url: 'https://docs.example.com' })
    expect(result.docs_url).toBe('https://docs.example.com')
  })

  it('rejects freshness_ttl_hours below 1', () => {
    expect(dataSourceSchema.safeParse({ ...validDS, freshness_ttl_hours: 0 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// approvalRequestCreateSchema
// ---------------------------------------------------------------------------
describe('approvalRequestCreateSchema', () => {
  const validRequest = {
    project_id: VALID_UUID,
    request_type: 'floor_breach' as const,
    reason: 'Below floor pricing applied to this project.',
  }

  it('accepts minimal valid request with defaults', () => {
    const result = approvalRequestCreateSchema.parse(validRequest)
    expect(result.severity).toBe('medium')
    expect(result.required_role).toBe('admin')
    expect(result.context).toEqual({})
  })

  it('accepts all request_type variants', () => {
    const types = ['floor_breach', 'low_margin', 'manual_override', 'high_risk_change'] as const
    types.forEach((type) => {
      const result = approvalRequestCreateSchema.parse({ ...validRequest, request_type: type })
      expect(result.request_type).toBe(type)
    })
  })

  it('rejects reason shorter than 3 chars', () => {
    expect(approvalRequestCreateSchema.safeParse({ ...validRequest, reason: 'ab' }).success).toBe(false)
  })

  it('rejects reason exceeding 3000 chars', () => {
    expect(
      approvalRequestCreateSchema.safeParse({ ...validRequest, reason: 'a'.repeat(3001) }).success
    ).toBe(false)
  })

  it('accepts optional estimate_id and change_request_id', () => {
    const result = approvalRequestCreateSchema.parse({
      ...validRequest,
      estimate_id: VALID_UUID,
      change_request_id: VALID_UUID_2,
    })
    expect(result.estimate_id).toBe(VALID_UUID)
  })

  it('rejects invalid severity', () => {
    expect(approvalRequestCreateSchema.safeParse({ ...validRequest, severity: 'extreme' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// approvalRequestUpdateSchema
// ---------------------------------------------------------------------------
describe('approvalRequestUpdateSchema', () => {
  it('accepts all valid status values', () => {
    const statuses = ['pending', 'approved', 'rejected', 'cancelled'] as const
    statuses.forEach((status) => {
      const result = approvalRequestUpdateSchema.parse({ status })
      expect(result.status).toBe(status)
    })
  })

  it('rejects invalid status', () => {
    expect(approvalRequestUpdateSchema.safeParse({ status: 'unknown' }).success).toBe(false)
  })

  it('accepts resolution_comment', () => {
    const result = approvalRequestUpdateSchema.parse({
      status: 'rejected',
      resolution_comment: 'Rejected due to budget constraints.',
    })
    expect(result.resolution_comment).toBeDefined()
  })

  it('rejects resolution_comment exceeding 3000 chars', () => {
    expect(
      approvalRequestUpdateSchema.safeParse({
        status: 'approved',
        resolution_comment: 'a'.repeat(3001),
      }).success
    ).toBe(false)
  })

  it('accepts optional assigned_to_role', () => {
    const result = approvalRequestUpdateSchema.parse({ status: 'pending', assigned_to_role: 'sales' })
    expect(result.assigned_to_role).toBe('sales')
  })
})

// ---------------------------------------------------------------------------
// changeRequestBillableRuleSchema
// ---------------------------------------------------------------------------
describe('changeRequestBillableRuleSchema', () => {
  const validRule = {
    rule_name: 'Customer fault always billable',
    applies_to_categories: ['bug_report' as const],
    result_is_billable: true,
    reason_template: 'This is billable because customer caused it.',
  }

  it('accepts valid rule with defaults', () => {
    const result = changeRequestBillableRuleSchema.parse(validRule)
    expect(result.active).toBe(true)
    expect(result.priority).toBe(100)
    expect(result.metadata).toEqual({})
  })

  it('rejects rule_name shorter than 3 chars', () => {
    expect(
      changeRequestBillableRuleSchema.safeParse({ ...validRule, rule_name: 'ab' }).success
    ).toBe(false)
  })

  it('rejects empty applies_to_categories array', () => {
    expect(
      changeRequestBillableRuleSchema.safeParse({ ...validRule, applies_to_categories: [] }).success
    ).toBe(false)
  })

  it('rejects priority above 10000', () => {
    expect(
      changeRequestBillableRuleSchema.safeParse({ ...validRule, priority: 10001 }).success
    ).toBe(false)
  })

  it('rejects priority below 0', () => {
    expect(
      changeRequestBillableRuleSchema.safeParse({ ...validRule, priority: -1 }).success
    ).toBe(false)
  })

  it('accepts max_warranty_days as null', () => {
    const result = changeRequestBillableRuleSchema.parse({ ...validRule, max_warranty_days: null })
    expect(result.max_warranty_days).toBeNull()
  })

  it('accepts multiple categories', () => {
    const result = changeRequestBillableRuleSchema.parse({
      ...validRule,
      applies_to_categories: ['bug_report', 'fix_request'],
    })
    expect(result.applies_to_categories).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// teamMemberSchema
// ---------------------------------------------------------------------------
describe('teamMemberSchema', () => {
  it('accepts valid team member', () => {
    const result = teamMemberSchema.parse({
      clerk_user_id: 'user_abc123',
      email: 'member@example.com',
      roles: ['admin'],
    })
    expect(result.active).toBe(true)
  })

  it('accepts multiple roles', () => {
    const result = teamMemberSchema.parse({
      clerk_user_id: 'user_abc123',
      roles: ['admin', 'dev'],
    })
    expect(result.roles).toHaveLength(2)
  })

  it('rejects empty roles array', () => {
    expect(
      teamMemberSchema.safeParse({ clerk_user_id: 'user_abc123', roles: [] }).success
    ).toBe(false)
  })

  it('rejects invalid role in roles array', () => {
    expect(
      teamMemberSchema.safeParse({ clerk_user_id: 'user_abc123', roles: ['superadmin'] }).success
    ).toBe(false)
  })

  it('accepts null email', () => {
    const result = teamMemberSchema.parse({
      clerk_user_id: 'user_abc123',
      email: null,
      roles: ['sales'],
    })
    expect(result.email).toBeNull()
  })

  it('rejects invalid email', () => {
    expect(
      teamMemberSchema.safeParse({
        clerk_user_id: 'user_abc123',
        email: 'not-email',
        roles: ['dev'],
      }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// businessLineSchema
// ---------------------------------------------------------------------------
describe('businessLineSchema', () => {
  it('accepts boltsite', () => expect(businessLineSchema.parse('boltsite')).toBe('boltsite'))
  it('accepts iotrealm', () => expect(businessLineSchema.parse('iotrealm')).toBe('iotrealm'))
  it('accepts tapforge', () => expect(businessLineSchema.parse('tapforge')).toBe('tapforge'))
  it('rejects unknown business line', () => {
    expect(businessLineSchema.safeParse('unknown_line').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// githubReferenceUpdateSchema
// ---------------------------------------------------------------------------
describe('githubReferenceUpdateSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = githubReferenceUpdateSchema.parse({})
    expect(result).toEqual({})
  })

  it('accepts is_showcase flag', () => {
    const result = githubReferenceUpdateSchema.parse({ is_showcase: true })
    expect(result.is_showcase).toBe(true)
  })

  it('accepts non-negative hours_spent', () => {
    const result = githubReferenceUpdateSchema.parse({ hours_spent: 0 })
    expect(result.hours_spent).toBe(0)
  })

  it('rejects negative hours_spent', () => {
    expect(githubReferenceUpdateSchema.safeParse({ hours_spent: -1 }).success).toBe(false)
  })

  it('rejects project_type exceeding 100 chars', () => {
    expect(githubReferenceUpdateSchema.safeParse({ project_type: 'a'.repeat(101) }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// githubSyncRequestSchema
// ---------------------------------------------------------------------------
describe('githubSyncRequestSchema', () => {
  it('accepts valid orgs array', () => {
    const result = githubSyncRequestSchema.parse({ orgs: ['my-org', 'another-org'] })
    expect(result.orgs).toHaveLength(2)
  })

  it('rejects empty orgs array', () => {
    expect(githubSyncRequestSchema.safeParse({ orgs: [] }).success).toBe(false)
  })

  it('rejects orgs array exceeding 20 items', () => {
    expect(
      githubSyncRequestSchema.safeParse({ orgs: Array.from({ length: 21 }, (_, i) => `org-${i}`) }).success
    ).toBe(false)
  })

  it('rejects empty string in orgs', () => {
    expect(githubSyncRequestSchema.safeParse({ orgs: [''] }).success).toBe(false)
  })

  it('rejects org name exceeding 100 chars', () => {
    expect(githubSyncRequestSchema.safeParse({ orgs: ['a'.repeat(101)] }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// adminProfileSchema
// ---------------------------------------------------------------------------
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

  it('trims display_name whitespace', () => {
    const result = adminProfileSchema.parse({ display_name: '  Admin  ', default_hourly_rate: 5000 })
    expect(result.display_name).toBe('Admin')
  })

  it('rejects whitespace-only display_name after trim', () => {
    const result = adminProfileSchema.safeParse({ display_name: '   ', default_hourly_rate: 5000 })
    expect(result.success).toBe(false)
  })

  it('rejects default_hourly_rate above 1000000', () => {
    expect(adminProfileSchema.safeParse({ display_name: 'Admin', default_hourly_rate: 1000001 }).success).toBe(false)
  })

  it('rejects non-integer default_hourly_rate', () => {
    expect(adminProfileSchema.safeParse({ display_name: 'Admin', default_hourly_rate: 5000.5 }).success).toBe(false)
  })

  it('accepts github_orgs array', () => {
    const result = adminProfileSchema.parse({
      display_name: 'Admin',
      default_hourly_rate: 5000,
      github_orgs: ['org1', 'org2'],
    })
    expect(result.github_orgs).toHaveLength(2)
  })

  it('rejects github_orgs array exceeding 20 items', () => {
    expect(
      adminProfileSchema.safeParse({
        display_name: 'Admin',
        default_hourly_rate: 5000,
        github_orgs: Array.from({ length: 21 }, (_, i) => `org-${i}`),
      }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// repositoryAnalysisRequestSchema
// ---------------------------------------------------------------------------
describe('repositoryAnalysisRequestSchema', () => {
  it('accepts valid repository analysis request', () => {
    const result = repositoryAnalysisRequestSchema.parse({
      project_id: VALID_UUID,
      repository_url: 'https://github.com/org/repo',
    })
    expect(result.repository_url).toBe('https://github.com/org/repo')
  })

  it('rejects non-UUID project_id', () => {
    expect(
      repositoryAnalysisRequestSchema.safeParse({
        project_id: 'bad',
        repository_url: 'https://github.com/org/repo',
      }).success
    ).toBe(false)
  })

  it('rejects invalid repository_url', () => {
    expect(
      repositoryAnalysisRequestSchema.safeParse({
        project_id: VALID_UUID,
        repository_url: 'not-a-url',
      }).success
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sourceAnalysisRunRequestSchema
// ---------------------------------------------------------------------------
describe('sourceAnalysisRunRequestSchema', () => {
  it('accepts minimal input with default limit', () => {
    const result = sourceAnalysisRunRequestSchema.parse({})
    expect(result.limit).toBe(2)
  })

  it('accepts optional project_id', () => {
    const result = sourceAnalysisRunRequestSchema.parse({ project_id: VALID_UUID })
    expect(result.project_id).toBe(VALID_UUID)
  })

  it('rejects limit below 1', () => {
    expect(sourceAnalysisRunRequestSchema.safeParse({ limit: 0 }).success).toBe(false)
  })

  it('rejects limit above 10', () => {
    expect(sourceAnalysisRunRequestSchema.safeParse({ limit: 11 }).success).toBe(false)
  })

  it('rejects non-integer limit', () => {
    expect(sourceAnalysisRunRequestSchema.safeParse({ limit: 1.5 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// executionTaskUpdateSchema
// ---------------------------------------------------------------------------
describe('executionTaskUpdateSchema', () => {
  it('accepts update with status only', () => {
    const result = executionTaskUpdateSchema.parse({ status: 'in_progress' })
    expect(result.status).toBe('in_progress')
  })

  it('accepts update with note only', () => {
    const result = executionTaskUpdateSchema.parse({ note: 'Working on it' })
    expect(result.note).toBe('Working on it')
  })

  it('accepts update with owner_role only', () => {
    const result = executionTaskUpdateSchema.parse({ owner_role: 'dev' })
    expect(result.owner_role).toBe('dev')
  })

  it('accepts update with owner_clerk_user_id only', () => {
    const result = executionTaskUpdateSchema.parse({ owner_clerk_user_id: 'user_abc123' })
    expect(result.owner_clerk_user_id).toBe('user_abc123')
  })

  it('rejects completely empty object (refine check)', () => {
    expect(executionTaskUpdateSchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid status value', () => {
    expect(executionTaskUpdateSchema.safeParse({ status: 'unknown_status' }).success).toBe(false)
  })

  it('rejects note exceeding 1000 chars', () => {
    expect(executionTaskUpdateSchema.safeParse({ note: 'a'.repeat(1001) }).success).toBe(false)
  })

  it('accepts all valid status values', () => {
    const statuses = ['todo', 'in_progress', 'done', 'blocked'] as const
    statuses.forEach((status) => {
      const result = executionTaskUpdateSchema.parse({ status })
      expect(result.status).toBe(status)
    })
  })

  it('accepts full update object', () => {
    const result = executionTaskUpdateSchema.parse({
      status: 'done',
      note: 'Completed successfully',
      owner_role: 'dev',
      owner_clerk_user_id: 'user_xyz',
    })
    expect(result.status).toBe('done')
    expect(result.note).toBe('Completed successfully')
  })
})
