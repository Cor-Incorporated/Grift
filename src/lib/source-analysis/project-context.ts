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

export async function buildProjectAttachmentContext(
  supabase: SupabaseClient,
  projectId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('project_files')
    .select('file_name, file_type, source_kind, source_url, analysis_result, analysis_status, analyzed_at')
    .eq('project_id', projectId)
    .eq('analysis_status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error || !data || data.length === 0) {
    return ''
  }

  const lines = (data as ProjectFileContextRow[]).map(toMarkdownLine)
  return `添付資料の解析結果:\n${lines.join('\n')}`
}
