import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, isAdminUser } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { marketEvidenceRequestSchema } from '@/lib/utils/validation'
import { fetchMarketEvidenceFromXai } from '@/lib/market/evidence'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'admin:market:evidence:post', RATE_LIMITS['admin:market:evidence:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()

    const admin = await isAdminUser(supabase, authUser.clerkUserId, authUser.email)
    if (!admin) {
      return NextResponse.json({ success: false, error: '管理者権限が必要です' }, { status: 403 })
    }

    const body = await request.json()
    const validated = marketEvidenceRequestSchema.parse(body)

    const result = await fetchMarketEvidenceFromXai({
      projectType: validated.project_type,
      context: validated.context,
      region: validated.region,
      usageContext: {
        projectId: validated.project_id ?? null,
        actorClerkUserId: authUser.clerkUserId,
      },
    })

    const { data: saved, error } = await supabase
      .from('market_evidence')
      .insert({
        project_id: validated.project_id ?? null,
        project_type: validated.project_type,
        source: 'xai',
        query: validated.context.slice(0, 4000),
        summary: result.evidence.summary,
        data: result.evidence,
        citations: result.citations,
        confidence_score: result.confidenceScore,
        usage: result.usage,
        created_by_clerk_user_id: authUser.clerkUserId,
      })
      .select('*')
      .single()

    if (error || !saved) {
      return NextResponse.json({ success: false, error: '市場根拠の保存に失敗しました' }, { status: 500 })
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'market_evidence.create',
      resourceType: 'market_evidence',
      resourceId: saved.id,
      projectId: validated.project_id ?? null,
      payload: {
        projectType: validated.project_type,
        confidence: result.confidenceScore,
        citationCount: result.citations.length,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        evidence: saved,
        citations: result.citations,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }
    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
