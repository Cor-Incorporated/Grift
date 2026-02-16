import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { pricingPolicySchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

function validateCoefficientRange(input: z.infer<typeof pricingPolicySchema>) {
  if (input.coefficient_min > input.coefficient_max) {
    throw new Error('coefficient_min は coefficient_max 以下である必要があります')
  }
  if (
    input.default_coefficient < input.coefficient_min ||
    input.default_coefficient > input.coefficient_max
  ) {
    throw new Error('default_coefficient は係数レンジ内である必要があります')
  }
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimitedGet = applyRateLimit(
      request,
      'admin:pricing-policies:get',
      RATE_LIMITS['admin:pricing-policies:get'],
      authUser.clerkUserId
    )
    if (rateLimitedGet) return rateLimitedGet

    const supabase = await createServiceRoleClient()

    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('pricing_policies')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ success: false, error: '価格ポリシーの取得に失敗しました' }, { status: 500 })
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

    const rateLimited = applyRateLimit(
      request,
      'admin:pricing-policies:post',
      RATE_LIMITS['admin:pricing-policies:post'],
      authUser.clerkUserId
    )
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()

    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const body = await request.json()
    const validated = pricingPolicySchema.parse(body)
    validateCoefficientRange(validated)

    if (validated.active) {
      await supabase
        .from('pricing_policies')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('project_type', validated.project_type)
        .eq('active', true)
    }

    const { data, error } = await supabase
      .from('pricing_policies')
      .insert({
        ...validated,
        created_by_clerk_user_id: authUser.clerkUserId,
      })
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ success: false, error: '価格ポリシーの保存に失敗しました' }, { status: 500 })
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'pricing_policy.create',
      resourceType: 'pricing_policy',
      resourceId: data.id,
      payload: {
        projectType: data.project_type,
        active: data.active,
      },
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }

    if (error instanceof Error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: false, error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
