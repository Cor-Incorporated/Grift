import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMessage } from '@/lib/ai/anthropic'
import { analyzeZipArchiveWithClaude } from '@/lib/source-analysis/zip'
import { analyzeRepositoryUrlWithClaude, isGitHubUrl } from '@/lib/source-analysis/repository'
import { analyzeWebsiteUrlWithGrok } from '@/lib/source-analysis/website'
import { analyzePdfWithClaude, extractTextFromPdfBuffer } from '@/lib/source-analysis/pdf'
import { writeAuditLog } from '@/lib/audit/log'
import { isExternalApiQuotaError, type UsageCallContext } from '@/lib/usage/api-usage'

const RETRY_DELAY_SECONDS = 20

type JobKind = 'file_upload' | 'repository_url'
type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

interface SourceAnalysisJobRow {
  id: string
  project_id: string
  project_file_id: string
  job_kind: JobKind
  status: JobStatus
  payload: Record<string, unknown>
  attempt_count: number
  max_attempts: number
  run_after: string
}

interface ProjectFileRow {
  id: string
  project_id: string
  file_path: string
  file_type: string | null
  file_name: string
  file_size: number | null
  source_kind: 'file_upload' | 'repository_url' | null
  source_url: string | null
}

export interface RunSourceAnalysisJobsResult {
  scanned: number
  processed: number
  succeeded: number
  failed: number
  requeued: number
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.slice(0, 400)
  }
  return '解析中に不明なエラーが発生しました'
}

function nowIso(): string {
  return new Date().toISOString()
}

async function enqueueIfMissing(
  supabase: SupabaseClient,
  input: {
    projectId: string
    projectFileId: string
    jobKind: JobKind
    payload?: Record<string, unknown>
    createdByClerkUserId: string
  }
): Promise<{ id: string; status: JobStatus }> {
  const existing = await supabase
    .from('source_analysis_jobs')
    .select('id, status')
    .eq('project_file_id', input.projectFileId)
    .in('status', ['queued', 'processing'])
    .maybeSingle()

  if (existing.data) {
    return {
      id: existing.data.id as string,
      status: existing.data.status as JobStatus,
    }
  }

  const { data, error } = await supabase
    .from('source_analysis_jobs')
    .insert({
      project_id: input.projectId,
      project_file_id: input.projectFileId,
      job_kind: input.jobKind,
      status: 'queued',
      payload: input.payload ?? {},
      attempt_count: 0,
      max_attempts: 3,
      run_after: nowIso(),
      created_by_clerk_user_id: input.createdByClerkUserId,
      updated_at: nowIso(),
    })
    .select('id, status')
    .single()

  if (error || !data) {
    throw new Error('解析ジョブの登録に失敗しました')
  }

  return {
    id: data.id as string,
    status: data.status as JobStatus,
  }
}

async function getProjectFile(
  supabase: SupabaseClient,
  projectFileId: string
): Promise<ProjectFileRow> {
  const { data, error } = await supabase
    .from('project_files')
    .select('id, project_id, file_path, file_type, file_name, file_size, source_kind, source_url')
    .eq('id', projectFileId)
    .single()

  if (error || !data) {
    throw new Error('解析対象ファイルが見つかりません')
  }

  return data as ProjectFileRow
}

async function downloadProjectFileBuffer(
  supabase: SupabaseClient,
  filePath: string
): Promise<Buffer> {
  const { data, error } = await supabase.storage.from('project-files').download(filePath)
  if (error || !data) {
    throw new Error('ストレージからファイルを取得できませんでした')
  }

  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function analyzeImagePlaceholder(
  file: ProjectFileRow,
  usageContext: UsageCallContext
): Promise<Record<string, unknown>> {
  const summary = await sendMessage(
    'あなたは受託開発の要件定義支援者です。添付画像の用途を推定し、追加要件に関係する観点を簡潔に整理してください。',
    [
      {
        role: 'user',
        content: `添付画像のメタ情報: file_name=${file.file_name}, mime_type=${file.file_type ?? 'unknown'}, size=${file.file_size ?? 0} bytes。画像内容自体は参照できない前提で、顧客への確認質問を提示してください。`,
      },
    ],
    {
      maxTokens: 600,
      temperature: 0.2,
      usageContext,
    }
  )

  return {
    type: 'image',
    summary,
    note: 'この環境では画像ピクセル自体の自動解析は未対応です。メタ情報ベースで要件確認ポイントを生成しました。',
  }
}

async function analyzeFileUpload(
  supabase: SupabaseClient,
  file: ProjectFileRow,
  usageContext: UsageCallContext
): Promise<Record<string, unknown>> {
  const mimeType = file.file_type ?? ''

  if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
    const buffer = await downloadProjectFileBuffer(supabase, file.file_path)
    const zipAnalysis = await analyzeZipArchiveWithClaude({
      archiveName: file.file_name,
      archiveBuffer: buffer,
      usageContext,
    })

    return {
      type: 'zip',
      summary: zipAnalysis.summary,
      system_type: zipAnalysis.systemType,
      tech_stack: zipAnalysis.techStack,
      architecture: zipAnalysis.architecture,
      key_modules: zipAnalysis.keyModules,
      risks: zipAnalysis.risks,
      change_impact_points: zipAnalysis.changeImpactPoints,
      recommended_questions: zipAnalysis.recommendedQuestions,
      snapshot: zipAnalysis.snapshot,
    }
  }

  if (mimeType === 'application/pdf') {
    const buffer = await downloadProjectFileBuffer(supabase, file.file_path)
    const pdfText = extractTextFromPdfBuffer(buffer)
    const pdf = await analyzePdfWithClaude({
      fileName: file.file_name,
      pdfText,
      usageContext,
    })
    return {
      type: 'pdf',
      summary: pdf.summary,
      extracted_text_length: pdf.extractedTextLength,
      key_points: pdf.keyPoints,
      risks: pdf.risks,
      change_impact_points: pdf.changeImpactPoints,
      recommended_questions: pdf.recommendedQuestions,
    }
  }

  if (mimeType.startsWith('image/')) {
    return analyzeImagePlaceholder(file, usageContext)
  }

  return {
    type: 'unsupported',
    summary: '解析可能な形式ではなかったため、保管のみ行いました。',
  }
}

async function analyzeRepositoryUrl(
  file: ProjectFileRow,
  usageContext: UsageCallContext
): Promise<{
  analysisResult: Record<string, unknown>
  fileName: string
  fileSize: number | null
  sourceUrl: string
}> {
  const sourceUrl = file.source_url
  if (!sourceUrl) {
    throw new Error('repository_url が未設定です')
  }

  if (!isGitHubUrl(sourceUrl)) {
    const websiteResult = await analyzeWebsiteUrlWithGrok(sourceUrl, usageContext)
    const hostname = (() => {
      try { return new URL(sourceUrl).hostname } catch { return sourceUrl.slice(0, 60) }
    })()

    return {
      analysisResult: websiteResult as unknown as Record<string, unknown>,
      fileName: hostname,
      fileSize: null,
      sourceUrl,
    }
  }

  const analyzed = await analyzeRepositoryUrlWithClaude(sourceUrl, usageContext)
  const fileName = `${analyzed.repository.owner}/${analyzed.repository.repo}@${analyzed.repository.branch}`

  return {
    analysisResult: {
      type: 'repository_url',
      summary: analyzed.analysis.summary,
      repository: analyzed.repository,
      system_type: analyzed.analysis.systemType,
      tech_stack: analyzed.analysis.techStack,
      architecture: analyzed.analysis.architecture,
      key_modules: analyzed.analysis.keyModules,
      risks: analyzed.analysis.risks,
      change_impact_points: analyzed.analysis.changeImpactPoints,
      recommended_questions: analyzed.analysis.recommendedQuestions,
      snapshot: analyzed.analysis.snapshot,
    },
    fileName,
    fileSize: analyzed.archiveBytes,
    sourceUrl: analyzed.repository.url,
  }
}

function pickSummary(analysisResult: Record<string, unknown>): string {
  const value = analysisResult.summary
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return '添付資料の解析を完了しました。'
}

async function finalizeSuccess(
  supabase: SupabaseClient,
  input: {
    job: SourceAnalysisJobRow
    analysisResult: Record<string, unknown>
    fileName?: string
    fileSize?: number | null
    sourceUrl?: string | null
  }
) {
  const updatedAt = nowIso()
  const fileUpdate: Record<string, unknown> = {
    analysis_status: 'completed',
    analysis_result: input.analysisResult,
    analysis_error: null,
    analyzed_at: updatedAt,
    updated_at: updatedAt,
  }
  if (typeof input.fileName === 'string') {
    fileUpdate.file_name = input.fileName
  }
  if (typeof input.fileSize === 'number') {
    fileUpdate.file_size = input.fileSize
  }
  if (typeof input.sourceUrl === 'string') {
    fileUpdate.source_url = input.sourceUrl
  }

  await supabase
    .from('project_files')
    .update(fileUpdate)
    .eq('id', input.job.project_file_id)

  await supabase.from('source_analysis_jobs').update({
    status: 'completed',
    finished_at: updatedAt,
    updated_at: updatedAt,
    last_error: null,
  }).eq('id', input.job.id)

  await supabase.from('conversations').insert({
    project_id: input.job.project_id,
    role: 'assistant',
    content: `添付資料を解析しました。\n\n${pickSummary(input.analysisResult)}`,
    metadata: {
      category: 'attachment_analysis',
      confidence_score: 0.75,
      is_complete: false,
      question_type: 'open',
    },
  })
}

async function finalizeFailure(
  supabase: SupabaseClient,
  input: {
    job: SourceAnalysisJobRow
    message: string
    isFinal: boolean
  }
) {
  const updatedAt = nowIso()

  if (input.isFinal) {
    await supabase
      .from('project_files')
      .update({
        analysis_status: 'failed',
        analysis_error: input.message,
        updated_at: updatedAt,
      })
      .eq('id', input.job.project_file_id)
  }

  if (input.isFinal) {
    await supabase.from('source_analysis_jobs').update({
      status: 'failed',
      last_error: input.message,
      finished_at: updatedAt,
      updated_at: updatedAt,
    }).eq('id', input.job.id)
  } else {
    const nextRun = new Date(Date.now() + RETRY_DELAY_SECONDS * 1000).toISOString()
    await supabase.from('source_analysis_jobs').update({
      status: 'queued',
      last_error: input.message,
      run_after: nextRun,
      started_at: null,
      updated_at: updatedAt,
    }).eq('id', input.job.id)
  }
}

async function lockJobForProcessing(
  supabase: SupabaseClient,
  jobId: string
): Promise<SourceAnalysisJobRow | null> {
  const startedAt = nowIso()
  const { data, error } = await supabase
    .from('source_analysis_jobs')
    .update({
      status: 'processing',
      started_at: startedAt,
      updated_at: startedAt,
    })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('*')
    .single()

  if (error || !data) {
    return null
  }

  const currentAttempt = Number((data as { attempt_count?: unknown }).attempt_count ?? 0) + 1
  const { data: bumped, error: bumpError } = await supabase
    .from('source_analysis_jobs')
    .update({
      attempt_count: currentAttempt,
      updated_at: nowIso(),
    })
    .eq('id', jobId)
    .select('*')
    .single()

  if (bumpError || !bumped) {
    return null
  }

  return bumped as SourceAnalysisJobRow
}

async function processSingleJob(
  supabase: SupabaseClient,
  job: SourceAnalysisJobRow,
  actorClerkUserId: string
): Promise<'succeeded' | 'failed' | 'requeued'> {
  const locked = await lockJobForProcessing(supabase, job.id)
  if (!locked) {
    return 'requeued'
  }

  try {
    const file = await getProjectFile(supabase, locked.project_file_id)
    const usageContext: UsageCallContext = {
      projectId: locked.project_id,
      actorClerkUserId,
    }

    if (locked.job_kind === 'repository_url') {
      const repository = await analyzeRepositoryUrl(file, usageContext)
      await finalizeSuccess(supabase, {
        job: locked,
        analysisResult: repository.analysisResult,
        fileName: repository.fileName,
        fileSize: repository.fileSize,
        sourceUrl: repository.sourceUrl,
      })
    } else {
      const analysisResult = await analyzeFileUpload(supabase, file, usageContext)
      await finalizeSuccess(supabase, {
        job: locked,
        analysisResult,
      })
    }

    await writeAuditLog(supabase, {
      actorClerkUserId,
      action: 'project_file.analysis_completed',
      resourceType: 'project_file',
      resourceId: locked.project_file_id,
      projectId: locked.project_id,
      payload: {
        jobId: locked.id,
        jobKind: locked.job_kind,
        attempts: locked.attempt_count,
      },
    })

    return 'succeeded'
  } catch (error) {
    const message = safeErrorMessage(error)
    const isFinal = isExternalApiQuotaError(error) || locked.attempt_count >= locked.max_attempts
    await finalizeFailure(supabase, {
      job: locked,
      message,
      isFinal,
    })

    await writeAuditLog(supabase, {
      actorClerkUserId,
      action: 'project_file.analysis_failed',
      resourceType: 'project_file',
      resourceId: locked.project_file_id,
      projectId: locked.project_id,
      payload: {
        jobId: locked.id,
        jobKind: locked.job_kind,
        attempts: locked.attempt_count,
        error: message,
        final: isFinal,
        quotaExceeded: isExternalApiQuotaError(error),
      },
    })

    return isFinal ? 'failed' : 'requeued'
  }
}

export async function enqueueSourceAnalysisJob(
  supabase: SupabaseClient,
  input: {
    projectId: string
    projectFileId: string
    jobKind: JobKind
    payload?: Record<string, unknown>
    createdByClerkUserId: string
  }
): Promise<{ id: string; status: JobStatus }> {
  return enqueueIfMissing(supabase, input)
}

export async function runQueuedSourceAnalysisJobs(
  supabase: SupabaseClient,
  input: {
    actorClerkUserId: string
    projectId?: string
    limit: number
  }
): Promise<RunSourceAnalysisJobsResult> {
  let query = supabase
    .from('source_analysis_jobs')
    .select('*')
    .eq('status', 'queued')
    .lte('run_after', nowIso())
    .order('created_at', { ascending: true })
    .limit(input.limit)

  if (input.projectId) {
    query = query.eq('project_id', input.projectId)
  }

  const { data, error } = await query
  if (error || !data) {
    return {
      scanned: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      requeued: 0,
    }
  }

  const jobs = data as SourceAnalysisJobRow[]
  const result: RunSourceAnalysisJobsResult = {
    scanned: jobs.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    requeued: 0,
  }

  for (const job of jobs) {
    const status = await processSingleJob(supabase, job, input.actorClerkUserId)
    result.processed += 1
    if (status === 'succeeded') result.succeeded += 1
    if (status === 'failed') result.failed += 1
    if (status === 'requeued') result.requeued += 1
  }

  return result
}
