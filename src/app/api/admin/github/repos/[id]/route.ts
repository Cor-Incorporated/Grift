import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { githubReferenceUpdateSchema } from '@/lib/utils/validation'
import { analyzeRepositoryUrlWithClaude } from '@/lib/source-analysis/repository'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'admin:github:repos:patch', RATE_LIMITS['admin:github:repos:patch'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json()
    const validated = githubReferenceUpdateSchema.parse(body)

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (validated.is_showcase !== undefined) {
      updatePayload.is_showcase = validated.is_showcase
    }
    if (validated.hours_spent !== undefined) {
      updatePayload.hours_spent = validated.hours_spent
    }
    if (validated.project_type !== undefined) {
      updatePayload.project_type = validated.project_type
    }

    const { data, error } = await supabase
      .from('github_references')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'リポジトリ情報の更新に失敗しました' },
        { status: error?.code === 'PGRST116' ? 404 : 500 }
      )
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'github_reference.update',
      resourceType: 'github_reference',
      resourceId: data.id,
      payload: validated,
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

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'admin:github:repos:analyze:post', RATE_LIMITS['admin:github:repos:analyze:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const { id } = await context.params

    const { data: repo, error: fetchError } = await supabase
      .from('github_references')
      .select('org_name, repo_name')
      .eq('id', id)
      .single()

    if (fetchError || !repo) {
      return NextResponse.json(
        { success: false, error: 'リポジトリが見つかりません' },
        { status: 404 }
      )
    }

    const repositoryUrl = `https://github.com/${repo.org_name}/${repo.repo_name}`

    const analysisResult = await analyzeRepositoryUrlWithClaude(repositoryUrl, {
      actorClerkUserId: authUser.clerkUserId,
    })

    const { error: updateError } = await supabase
      .from('github_references')
      .update({
        analysis_result: analysisResult.analysis as unknown as Record<string, unknown>,
        analysis_summary: analysisResult.analysis.summary ?? null,
        tech_stack: analysisResult.analysis.techStack ?? [],
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      return NextResponse.json(
        { success: false, error: '解析結果の保存に失敗しました' },
        { status: 500 }
      )
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'github_reference.analyze',
      resourceType: 'github_reference',
      resourceId: id,
      payload: {
        repositoryUrl,
        archiveBytes: analysisResult.archiveBytes,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        repositoryUrl,
        analysis: analysisResult.analysis,
        archiveBytes: analysisResult.archiveBytes,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
