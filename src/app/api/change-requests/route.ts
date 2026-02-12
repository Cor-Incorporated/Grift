import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { changeRequestSchema } from '@/lib/utils/validation'

function initialBillableAssessment(category: string, description: string): {
  isBillable: boolean
  reason: string
} {
  const normalized = description.toLowerCase()

  if (category === 'bug_report') {
    if (
      normalized.includes('仕様変更') ||
      normalized.includes('追加要件') ||
      normalized.includes('運用変更')
    ) {
      return {
        isBillable: true,
        reason: '不具合ではなく要件変更の可能性が高いため有償判定',
      }
    }

    return {
      isBillable: false,
      reason: '既存不具合として初期判定（保証条件は管理者が最終確認）',
    }
  }

  return {
    isBillable: true,
    reason: '仕様追加・修正要求として有償判定',
  }
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

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

    const billable = initialBillableAssessment(validated.category, validated.description)

    const { data, error } = await supabase
      .from('change_requests')
      .insert({
        project_id: validated.project_id,
        title: validated.title,
        description: validated.description,
        category: validated.category,
        impact_level: validated.impact_level,
        status: 'triaged',
        is_billable: billable.isBillable,
        billable_reason: billable.reason,
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
