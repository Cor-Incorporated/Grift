import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { changeRequestSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import {
  evaluateBillableDecision,
  loadActiveBillableRules,
} from '@/lib/change-requests/billable-rules'

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimitedGet = applyRateLimit(request, 'change-requests:get', RATE_LIMITS['change-requests:get'], authUser.clerkUserId)
    if (rateLimitedGet) return rateLimitedGet

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('project_id')

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'project_id は必須です' },
        { status: 400 }
      )
    }

    const supabase = await createServiceRoleClient()
    const accessible = await canAccessProject(
      supabase,
      projectId,
      authUser.clerkUserId,
      authUser.email
    )

    if (!accessible) {
      return NextResponse.json(
        { success: false, error: 'この案件にアクセスできません' },
        { status: 403 }
      )
    }

    const { data, error } = await supabase
      .from('change_requests')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { success: false, error: '変更要求の取得に失敗しました' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch {
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'change-requests:post', RATE_LIMITS['change-requests:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validated = changeRequestSchema.parse(body)

    const supabase = await createServiceRoleClient()
    const accessible = await canAccessProject(
      supabase,
      validated.project_id,
      authUser.clerkUserId,
      authUser.email
    )

    if (!accessible) {
      return NextResponse.json(
        { success: false, error: 'この案件にアクセスできません' },
        { status: 403 }
      )
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, created_at')
      .eq('id', validated.project_id)
      .maybeSingle()

    const rules = await loadActiveBillableRules(supabase)
    const billable = evaluateBillableDecision({
      rules,
      request: {
        category: validated.category,
        projectCreatedAt: project?.created_at ?? new Date().toISOString(),
        responsibilityType: validated.responsibility_type,
        reproducibility: validated.reproducibility,
      },
    })

    const { data, error } = await supabase
      .from('change_requests')
      .insert({
        project_id: validated.project_id,
        title: validated.title,
        description: validated.description,
        category: validated.category,
        impact_level: validated.impact_level,
        responsibility_type: validated.responsibility_type,
        reproducibility: validated.reproducibility,
        status: 'triaged',
        is_billable: billable.isBillable,
        billable_reason: billable.reason,
        billable_rule_id: billable.matchedRuleId,
        billable_evaluation: billable.evaluation,
        requested_by_name: validated.requested_by_name ?? authUser.fullName,
        requested_by_email: validated.requested_by_email ?? authUser.email,
        created_by_clerk_user_id: authUser.clerkUserId,
      })
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: '変更要求の作成に失敗しました' },
        { status: 500 }
      )
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'change_request.create',
      resourceType: 'change_request',
      resourceId: data.id,
      projectId: data.project_id,
      payload: {
        category: data.category,
        isBillable: data.is_billable,
        responsibilityType: data.responsibility_type,
        reproducibility: data.reproducibility,
        matchedRuleId: data.billable_rule_id,
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
