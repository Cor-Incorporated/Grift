import type { SupabaseClient } from '@supabase/supabase-js'

interface ProjectFileContextRow {
  file_name: string
  file_type: string | null
  source_kind: string | null
  source_url: string | null
  analysis_result: Record<string, unknown> | null
  analysis_status: string | null
  analyzed_at: string | null
}

function pickSummary(analysisResult: Record<string, unknown> | null): string {
  if (!analysisResult) return ''

  const summaryKeys = ['summary', 'system_overview', 'executive_summary']
  for (const key of summaryKeys) {
    const value = analysisResult[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return ''
}

function toMarkdownLine(item: ProjectFileContextRow): string {
  const sourceLabel = item.source_kind === 'repository_url' ? 'Repository URL' : 'File Upload'
  const sourceUrlPart = item.source_url ? ` (${item.source_url})` : ''
  const summary = pickSummary(item.analysis_result)
  const summaryPart = summary ? `\n  - 概要: ${summary.slice(0, 300)}` : ''
  const analyzedAt = item.analyzed_at
    ? new Date(item.analyzed_at).toISOString()
    : 'unknown'

  return `- ${item.file_name} [${sourceLabel}]${sourceUrlPart} / analyzed_at=${analyzedAt}${summaryPart}`
}

interface SourceAnalysisJobRow {
  status: string
  last_error: string | null
  project_files: {
    file_name: string
    source_url: string | null
  } | null
}

export async function buildProjectAttachmentContext(
  supabase: SupabaseClient,
  projectId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('project_files')
    .select('file_name, file_type, source_kind, source_url, analysis_result, analysis_status, analyzed_at')
    .eq('project_id', projectId)
    .in('analysis_status', ['completed', 'pending', 'failed'])
    .order('created_at', { ascending: false })
    .limit(10)

  if (error || !data || data.length === 0) {
    return ''
  }

  const allFiles = data as ProjectFileContextRow[]
  const completed = allFiles.filter((f) => f.analysis_status === 'completed')
  const pending = allFiles.filter((f) => f.analysis_status === 'pending')
  const failed = allFiles.filter((f) => f.analysis_status === 'failed')

  const sections: string[] = []

  if (completed.length > 0) {
    const lines = completed.map(toMarkdownLine)
    sections.push(`添付資料の解析結果:\n${lines.join('\n')}`)
  }

  if (pending.length > 0) {
    const lines = pending.map((f) => `- ${f.file_name}${f.source_url ? ` (${f.source_url})` : ''} — 解析中`)
    sections.push(`解析待ちの資料:\n${lines.join('\n')}`)
  }

  if (failed.length > 0) {
    const { data: jobData } = await supabase
      .from('source_analysis_jobs')
      .select('status, last_error, project_files(file_name, source_url)')
      .eq('project_id', projectId)
      .in('status', ['failed', 'queued'])
      .not('last_error', 'is', null)
      .limit(5)

    if (jobData && jobData.length > 0) {
      const jobRows = jobData as unknown as SourceAnalysisJobRow[]
      const lines = jobRows.map((j) => {
        const name = j.project_files?.file_name ?? '不明'
        const url = j.project_files?.source_url ? ` (${j.project_files.source_url})` : ''
        return `- ${name}${url} — エラー: ${j.last_error}`
      })
      sections.push(`解析に失敗した資料（お客様にエラーを伝えてください）:\n${lines.join('\n')}`)
    } else {
      const lines = failed.map((f) => `- ${f.file_name}${f.source_url ? ` (${f.source_url})` : ''} — 解析失敗`)
      sections.push(`解析に失敗した資料（お客様にエラーを伝えてください）:\n${lines.join('\n')}`)
    }
  }

  return sections.join('\n\n')
}
