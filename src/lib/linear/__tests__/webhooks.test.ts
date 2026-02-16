import { describe, it, expect } from 'vitest'
import {
  verifyWebhookSignature,
  parseWebhookPayload,
  isIssueStatusChange,
} from '../webhooks'
import { createHmac } from 'crypto'

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret-key'

  it('returns true for valid signature', () => {
    const body = '{"type":"Issue","action":"update"}'
    const hmac = createHmac('sha256', secret)
    hmac.update(body)
    const signature = hmac.digest('hex')

    expect(verifyWebhookSignature(body, signature, secret)).toBe(true)
  })

  it('returns false for invalid signature', () => {
    const body = '{"type":"Issue","action":"update"}'
    expect(verifyWebhookSignature(body, 'invalid', secret)).toBe(false)
  })

  it('returns false for tampered body', () => {
    const originalBody = '{"type":"Issue"}'
    const hmac = createHmac('sha256', secret)
    hmac.update(originalBody)
    const signature = hmac.digest('hex')

    expect(verifyWebhookSignature('{"type":"Tampered"}', signature, secret)).toBe(false)
  })
})

describe('parseWebhookPayload', () => {
  it('parses valid payload', () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      data: { id: 'issue-1', state: { name: 'Done' } },
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    const result = parseWebhookPayload(payload)
    expect(result.action).toBe('update')
    expect(result.type).toBe('Issue')
  })

  it('throws for invalid payload', () => {
    expect(() => parseWebhookPayload({ invalid: true })).toThrow()
  })
})

describe('isIssueStatusChange', () => {
  it('returns true for issue status update', () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      data: { id: 'issue-1', state: { name: 'Done' } },
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    expect(isIssueStatusChange(payload)).toBe(true)
  })

  it('returns false for non-issue type', () => {
    const payload = {
      action: 'update',
      type: 'Comment',
      data: { state: { name: 'Done' } },
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    expect(isIssueStatusChange(payload)).toBe(false)
  })

  it('returns false for non-update action', () => {
    const payload = {
      action: 'create',
      type: 'Issue',
      data: { state: { name: 'Todo' } },
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    expect(isIssueStatusChange(payload)).toBe(false)
  })

  it('returns false when no state in data', () => {
    const payload = {
      action: 'update',
      type: 'Issue',
      data: { title: 'Updated title' },
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    expect(isIssueStatusChange(payload)).toBe(false)
  })
})
