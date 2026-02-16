import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { analyzeAndSaveVelocity } from '@/lib/github/discover'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(request, 'admin:github:repos:velocity:post', RATE_LIMITS['admin:github:repos:velocity:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json(
        { success: false, error: '管理者権限が必要です' },
        { status: 403 }
      )
    }

    const { id } = await context.params

    const { data: repo, error: fetchError } = await supabase
      .from('github_references')
      .select('id, org_name, repo_name')
      .eq('id', id)
      .single()

    if (fetchError || !repo) {
      return NextResponse.json(
        { success: false, error: 'リポジトリが見つかりません' },
        { status: 404 }
      )
    }

    const velocity = await analyzeAndSaveVelocity({
      supabase,
      repoId: repo.id,
      orgName: repo.org_name,
      repoName: repo.repo_name,
    })

    if (!velocity) {
      return NextResponse.json(
        { success: false, error: 'Velocity分析に失敗しました' },
        { status: 500 }
      )
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'github_reference.velocity_analyze',
      resourceType: 'github_reference',
      resourceId: id,
      payload: {
        totalCommits: velocity.totalCommits,
        commitsPerWeek: velocity.commitsPerWeek,
        contributorCount: velocity.contributorCount,
        velocityScore: velocity.velocityScore,
        estimatedHours: velocity.estimatedHours,
      },
    })

    return NextResponse.json({ success: true, data: velocity })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
