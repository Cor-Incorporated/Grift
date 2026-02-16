import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  verifyWebhookSignature,
  parseWebhookPayload,
  isIssueStatusChange,
} from '@/lib/linear/webhooks'
import { applyRateLimit, getClientIdentifier } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function POST(request: NextRequest) {
  try {
    const clientId = getClientIdentifier(request)
    const rateLimited = applyRateLimit(request, 'linear:webhooks:post', RATE_LIMITS['linear:webhooks:post'], clientId)
    if (rateLimited) return rateLimited

    const secret = process.env.LINEAR_WEBHOOK_SECRET
    if (!secret) {
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      )
    }

    const body = await request.text()
    const signature = request.headers.get('linear-signature') ?? ''

    if (!verifyWebhookSignature(body, signature, secret)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      )
    }

    const parsed = JSON.parse(body)
    const payload = parseWebhookPayload(parsed)

    if (isIssueStatusChange(payload)) {
      const issueId = payload.data.id as string
      const stateData = payload.data.state as { name?: string } | undefined

      if (issueId && stateData?.name) {
        const supabase = await createServiceRoleClient()

        await supabase
          .from('linear_issue_mappings')
          .update({
            sync_status: stateData.name.toLowerCase(),
            metadata: { last_webhook_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          })
          .eq('linear_issue_id', issueId)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
