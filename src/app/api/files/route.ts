import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { enqueueSourceAnalysisJob } from '@/lib/source-analysis/jobs'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
])

function getDetectedMimeType(file: File): string {
  if (file.type) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'zip') return 'application/zip'
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  return 'application/octet-stream'
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json({ success: false, error: '認証が必要です' }, { status: 401 })
    }

    const rateLimitedGet = applyRateLimit(request, 'files:get', RATE_LIMITS['files:get'], authUser.clerkUserId)
    if (rateLimitedGet) return rateLimitedGet

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('project_id')
    if (!projectId) {
      return NextResponse.json({ success: false, error: 'project_id は必須です' }, { status: 400 })
    }

    const supabase = await createServiceRoleClient()
    const accessible = await canAccessProject(
      supabase,
      projectId,
      authUser.clerkUserId,
      authUser.email
    )
    if (!accessible) {
      return NextResponse.json({ success: false, error: 'この案件にアクセスできません' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('project_files')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { success: false, error: '添付ファイル一覧の取得に失敗しました' },
        { status: 500 }
      )
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

    const rateLimited = applyRateLimit(request, 'files:post', RATE_LIMITS['files:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('project_id') as string | null

    if (!file || !projectId) {
      return NextResponse.json({ success: false, error: 'file と project_id は必須です' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'ファイルサイズは25MB以下にしてください' }, { status: 400 })
    }

    const detectedMimeType = getDetectedMimeType(file)
    if (!ALLOWED_MIME_TYPES.has(detectedMimeType)) {
      return NextResponse.json(
        {
          success: false,
          error: '画像 (PNG/JPEG/GIF/WebP)、PDF、ZIP のみアップロード可能です',
        },
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
      return NextResponse.json({ success: false, error: 'この案件にアクセスできません' }, { status: 403 })
    }

    const ext = file.name.split('.').pop() ?? 'bin'
    const filePath = `${projectId}/${Date.now()}-${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('project-files')
      .upload(filePath, file, {
        contentType: detectedMimeType,
      })

    if (uploadError) {
      return NextResponse.json({ success: false, error: 'ファイルのアップロードに失敗しました' }, { status: 500 })
    }

    const now = new Date().toISOString()
    const { data: savedFile, error: dbError } = await supabase
      .from('project_files')
      .insert({
        project_id: projectId,
        file_path: filePath,
        file_type: detectedMimeType,
        file_name: file.name,
        file_size: file.size,
        source_kind: 'file_upload',
        source_url: null,
        analysis_status: 'pending',
        analysis_result: null,
        analysis_error: null,
        analysis_model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929',
        metadata: {
          uploaded_by: authUser.clerkUserId,
        },
        updated_at: now,
      })
      .select('*')
      .single()

    if (dbError || !savedFile) {
      return NextResponse.json({ success: false, error: 'ファイル情報の保存に失敗しました' }, { status: 500 })
    }

    const job = await enqueueSourceAnalysisJob(supabase, {
      projectId,
      projectFileId: savedFile.id as string,
      jobKind: 'file_upload',
      createdByClerkUserId: authUser.clerkUserId,
    })

    await writeAuditLog(supabase, {
      actorClerkUserId: authUser.clerkUserId,
      action: 'project_file.upload_queued',
      resourceType: 'project_file',
      resourceId: savedFile.id as string,
      projectId,
      payload: {
        fileName: file.name,
        fileType: detectedMimeType,
        fileSize: file.size,
        jobId: job.id,
      },
    })

    return NextResponse.json({
      success: true,
      data: savedFile,
      queued_job_id: job.id,
      message: '解析ジョブをキューに登録しました',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'サーバーエラーが発生しました'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
