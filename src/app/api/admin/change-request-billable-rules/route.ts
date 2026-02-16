import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { changeRequestBillableRuleSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimitedGet = applyRateLimit(request, 'admin:change-request-billable-rules:get', RATE_LIMITS['admin:change-request-billable-rules:get'], authUser.clerkUserId)
    if (rateLimitedGet) return rateLimitedGet

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('change_request_billable_rules')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ success: false, error: 'ルール一覧の取得に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch {
    return NextResponse.json({ success: false, error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'admin:change-request-billable-rules:post', RATE_LIMITS['admin:change-request-billable-rules:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const body = await request.json()
    const validated = changeRequestBillableRuleSchema.parse(body)

    const payload = {
      rule_name: validated.rule_name,
      active: validated.active,
      priority: validated.priority,
      applies_to_categories: validated.applies_to_categories,
      max_warranty_days: validated.max_warranty_days ?? null,
      responsibility_required: validated.responsibility_required,
      reproducibility_required: validated.reproducibility_required,
      result_is_billable: validated.result_is_billable,
      reason_template: validated.reason_template,
      metadata: validated.metadata,
      created_by_clerk_user_id: authUser.clerkUserId,
      updated_at: new Date().toISOString(),
    }

    const upsertPayload = validated.id
      ? { ...payload, id: validated.id }
      : payload

    const { data, error } = await supabase
      .from('change_request_billable_rules')
      .upsert(upsertPayload, { onConflict: 'rule_name' })
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'ルール保存に失敗しました' }, { status: 500 })
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'change_request_billable_rule.upsert',
      resourceType: 'change_request_billable_rule',
      resourceId: data.id,
      payload: {
        ruleName: data.rule_name,
        active: data.active,
        priority: data.priority,
      },
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
