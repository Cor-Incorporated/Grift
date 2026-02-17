import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { githubSyncRequestSchema } from '@/lib/utils/validation'
import { discoverOrgRepos, syncReposToDatabase } from '@/lib/github/discover'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'admin:github:repos:get', RATE_LIMITS['admin:github:repos:get'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const showcaseOnly = searchParams.get('showcase') === 'true'

    let query = supabase
      .from('github_references')
      .select('*')
      .order('stars', { ascending: false })

    if (showcaseOnly) {
      query = query.eq('is_showcase', true)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { success: false, error: 'リポジトリ一覧の取得に失敗しました' },
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

    const rateLimited = applyRateLimit(request, 'admin:github:repos:post', RATE_LIMITS['admin:github:repos:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()
    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const body = await request.json()
    const validated = githubSyncRequestSchema.parse(body)

    const results = await Promise.allSettled(
      validated.orgs.map((org) => discoverOrgRepos(org))
    )
    const flatRepos = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof discoverOrgRepos>>> => r.status === 'fulfilled')
      .flatMap((r) => r.value)
    const failedOrgs = validated.orgs.filter((_, i) => results[i].status === 'rejected')

    if (flatRepos.length === 0 && failedOrgs.length > 0) {
      const reasons = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason instanceof Error ? r.reason.message : String(r.reason))
      return NextResponse.json(
        { success: false, error: `全Organizationの取得に失敗しました: ${reasons.join(', ')}` },
        { status: 502 }
      )
    }

    const result = await syncReposToDatabase({
      supabase,
      repos: flatRepos,
      createdByClerkUserId: authUser.clerkUserId,
    })

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'github_references.sync',
      resourceType: 'github_references',
      resourceId: 'batch-sync',
      payload: {
        orgs: validated.orgs,
        synced: result.synced,
        created: result.created,
        updated: result.updated,
        failedOrgs,
      },
    })

    return NextResponse.json({
      success: true,
      data: { ...result, failedOrgs },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
