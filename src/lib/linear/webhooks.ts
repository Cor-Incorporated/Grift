import { z } from 'zod'
import { createHmac, timingSafeEqual } from 'crypto'

const webhookPayloadSchema = z.object({
  action: z.string(),
  type: z.string(),
  data: z.record(z.unknown()),
  createdAt: z.string(),
  organizationId: z.string().optional(),
  url: z.string().optional(),
})

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>

export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const hmac = createHmac('sha256', secret)
  hmac.update(body)
  const expectedSignature = hmac.digest('hex')

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch {
    return false
  }
}

export function parseWebhookPayload(body: unknown): WebhookPayload {
  return webhookPayloadSchema.parse(body)
}

export function isIssueStatusChange(payload: WebhookPayload): boolean {
  return payload.type === 'Issue' && payload.action === 'update' && 'state' in payload.data
}
