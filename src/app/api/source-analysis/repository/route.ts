import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { enqueueSourceAnalysisJob } from '@/lib/source-analysis/jobs'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { repositoryAnalysisRequestSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimited = applyRateLimit(request, 'source-analysis:repository:post', RATE_LIMITS['source-analysis:repository:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validated = repositoryAnalysisRequestSchema.parse(body)

    const supabase = await createServiceRoleClient()
    const accessible = await canAccessProject(
      supabase,
      validated.project_id,
      authUser.clerkUserId,
      authUser.email
    )

    if (!accessible) {
      return NextResponse.json({ success: false, error: 'この案件にアクセスできません' }, { status: 403 })
    }

    const now = new Date().toISOString()
    const provisionalName = validated.repository_url.replace(/^https?:\/\//, '').slice(0, 120)
    const filePath = `repository/${validated.project_id}/${Date.now()}-${crypto.randomUUID()}`

    const { data: savedRecord, error: saveError } = await supabase
      .from('project_files')
      .insert({
        project_id: validated.project_id,
        file_path: filePath,
        file_type: 'application/vnd.github.repository+zip',
        file_name: provisionalName,
        file_size: null,
        source_kind: 'repository_url',
        source_url: validated.repository_url,
        analysis_status: 'pending',
        analysis_result: null,
        analysis_error: null,
        analysis_model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929',
        metadata: {
          requested_by: authUser.clerkUserId,
        },
        updated_at: now,
      })
      .select('*')
      .single()

    if (saveError || !savedRecord) {
      return NextResponse.json({ success: false, error: '解析リクエストの保存に失敗しました' }, { status: 500 })
    }

    const job = await enqueueSourceAnalysisJob(supabase, {
      projectId: validated.project_id,
      projectFileId: savedRecord.id as string,
      jobKind: 'repository_url',
      payload: {
        repository_url: validated.repository_url,
      },
      createdByClerkUserId: authUser.clerkUserId,
    })

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'project_file.repository_analysis_queued',
      resourceType: 'project_file',
      resourceId: savedRecord.id as string,
      projectId: validated.project_id,
      payload: {
        repositoryUrl: validated.repository_url,
        jobId: job.id,
      },
    })

    return NextResponse.json({
      success: true,
      data: savedRecord,
      queued_job_id: job.id,
      message: 'リポジトリ解析ジョブをキューに登録しました',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: '入力データが不正です' }, { status: 400 })
    }
    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
