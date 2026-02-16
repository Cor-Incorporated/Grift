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

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string')
  }
  if (typeof value === 'string') {
    return [value]
  }
  return []
}

function buildStructuredAnalysisContext(analysisResult: Record<string, unknown>): string {
  const lines: string[] = []

  const summary = pickSummary(analysisResult)
  if (summary) {
    lines.push(`概要: ${summary.slice(0, 600)}`)
  }

  const techStack = analysisResult.tech_stack ?? analysisResult.detectedTechStack
  const techItems = toStringArray(techStack)
  if (techItems.length > 0) {
    lines.push(`技術スタック: ${techItems.join(', ')}`)
  }

  const systemType = analysisResult.system_type
  if (typeof systemType === 'string' && systemType.trim()) {
    lines.push(`システムタイプ: ${systemType.trim()}`)
  }

  const architecture = analysisResult.architecture
  if (typeof architecture === 'string' && architecture.trim()) {
    lines.push(`アーキテクチャ: ${architecture.trim().slice(0, 300)}`)
  }

  const risks = toStringArray(analysisResult.risks)
  if (risks.length > 0) {
    lines.push(`リスク:\n  - ${risks.join('\n  - ')}`)
  }

  const changeImpactPoints = toStringArray(analysisResult.change_impact_points)
  if (changeImpactPoints.length > 0) {
    lines.push(`変更影響ポイント:\n  - ${changeImpactPoints.join('\n  - ')}`)
  }

  const recommendedQuestions = toStringArray(analysisResult.recommended_questions)
  if (recommendedQuestions.length > 0) {
    lines.push(`推奨確認質問:\n  - ${recommendedQuestions.join('\n  - ')}`)
  }

  const keyModules = toStringArray(analysisResult.key_modules)
  if (keyModules.length > 0) {
    lines.push(`主要モジュール:\n  - ${keyModules.join('\n  - ')}`)
  }

  const companyOverview = analysisResult.companyOverview
  if (typeof companyOverview === 'string' && companyOverview.trim()) {
    lines.push(`企業概要: ${companyOverview.trim().slice(0, 200)}`)
  }

  const estimationContext = analysisResult.estimationContext
  if (typeof estimationContext === 'string' && estimationContext.trim()) {
    lines.push(`見積コンテキスト: ${estimationContext.trim().slice(0, 300)}`)
  }

  // UI/構造系（website_url解析から）
  const pageStructure = toStringArray(analysisResult.pageStructure)
  if (pageStructure.length > 0) {
    lines.push(`ページ構成:\n  - ${pageStructure.join('\n  - ')}`)
  }

  const navigationPattern = analysisResult.navigationPattern
  if (typeof navigationPattern === 'string' && navigationPattern.trim()) {
    lines.push(`ナビゲーション: ${navigationPattern.trim()}`)
  }

  const uiComponents = toStringArray(analysisResult.uiComponents)
  if (uiComponents.length > 0) {
    lines.push(`UIコンポーネント:\n  - ${uiComponents.join('\n  - ')}`)
  }

  const designPatterns = toStringArray(analysisResult.designPatterns)
  if (designPatterns.length > 0) {
    lines.push(`デザインパターン:\n  - ${designPatterns.join('\n  - ')}`)
  }

  const responsiveApproach = analysisResult.responsiveApproach
  if (typeof responsiveApproach === 'string' && responsiveApproach.trim()) {
    lines.push(`レスポンシブ: ${responsiveApproach.trim()}`)
  }

  const interactiveFeatures = toStringArray(analysisResult.interactiveFeatures)
  if (interactiveFeatures.length > 0) {
    lines.push(`インタラクティブ機能:\n  - ${interactiveFeatures.join('\n  - ')}`)
  }

  const estimatedComplexity = analysisResult.estimatedComplexity
  if (typeof estimatedComplexity === 'string' && estimatedComplexity.trim()) {
    lines.push(`推定複雑度: ${estimatedComplexity.trim()}`)
  }

  // 画像解析結果（image解析から）
  const imageType = analysisResult.image_type
  if (typeof imageType === 'string' && imageType.trim()) {
    lines.push(`画像種別: ${imageType.trim()}`)
  }

  const uiElements = toStringArray(analysisResult.ui_elements)
  if (uiElements.length > 0) {
    lines.push(`UI要素:\n  - ${uiElements.join('\n  - ')}`)
  }

  const layoutStructure = analysisResult.layout_structure
  if (typeof layoutStructure === 'string' && layoutStructure.trim()) {
    lines.push(`レイアウト: ${layoutStructure.trim()}`)
  }

  const functionalEstimate = analysisResult.functional_estimate
  if (typeof functionalEstimate === 'string' && functionalEstimate.trim()) {
    lines.push(`機能推定: ${functionalEstimate.trim()}`)
  }

  const devComplexityNotes = toStringArray(analysisResult.dev_complexity_notes)
  if (devComplexityNotes.length > 0) {
    lines.push(`開発複雑度ポイント:\n  - ${devComplexityNotes.join('\n  - ')}`)
  }

  return lines.join('\n')
}

function toMarkdownLine(item: ProjectFileContextRow): string {
  const sourceLabel = item.source_kind === 'repository_url' ? 'Repository URL' : 'File Upload'
  const sourceUrlPart = item.source_url ? ` (${item.source_url})` : ''
  const structuredContext = item.analysis_result
    ? buildStructuredAnalysisContext(item.analysis_result)
    : ''
  const contextPart = structuredContext
    ? `\n  ${structuredContext.split('\n').join('\n  ')}`
    : ''
  const analyzedAt = item.analyzed_at
    ? new Date(item.analyzed_at).toISOString()
    : 'unknown'

  return `- ${item.file_name} [${sourceLabel}]${sourceUrlPart} / analyzed_at=${analyzedAt}${contextPart}`
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
