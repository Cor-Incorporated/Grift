import type { HistoricalCalibration, HistoricalReference } from '@/lib/estimates/evidence-bundle'
import type { CodeImpactAnalysis } from '@/lib/estimates/code-impact-analysis'

const MAX_EVIDENCE_CONTEXT_CHARS = 2000
const TRUNCATION_SUFFIX = '[...証拠データ省略]'
const DESCRIPTION_MAX_CHARS = 100

interface EvidenceContextInput {
  historicalCalibration: HistoricalCalibration
  codeImpact: CodeImpactAnalysis | null
}

function formatReference(ref: HistoricalReference): string {
  const lines: string[] = []
  lines.push(`- **${ref.repoFullName}** (類似度: ${ref.matchScore.toFixed(2)})`)

  if (ref.hoursSpent !== null) {
    lines.push(`  - 実績工数: ${ref.hoursSpent}時間`)
  }

  if (ref.techStack.length > 0) {
    lines.push(`  - 技術スタック: ${ref.techStack.join(', ')}`)
  }

  if (ref.description !== null) {
    const truncatedDesc = ref.description.length > DESCRIPTION_MAX_CHARS
      ? `${ref.description.slice(0, DESCRIPTION_MAX_CHARS)}...`
      : ref.description
    lines.push(`  - 概要: ${truncatedDesc}`)
  }

  return lines.join('\n')
}

function buildReferencesSection(references: HistoricalReference[]): string {
  if (references.length === 0) return ''

  const header = '### 参照プロジェクト'
  const refLines = references.map(formatReference).join('\n\n')
  return `${header}\n${refLines}`
}

function buildStatisticsSection(calibration: HistoricalCalibration): string {
  if (!calibration.hasReliableData) return ''

  const lines: string[] = ['### 統計サマリー']

  if (calibration.avgActualHours !== null) {
    lines.push(`- 類似案件の平均実績工数: ${calibration.avgActualHours}時間`)
  }

  if (calibration.minActualHours !== null && calibration.maxActualHours !== null) {
    lines.push(`- 工数レンジ: ${calibration.minActualHours}〜${calibration.maxActualHours}時間`)
  }

  if (calibration.avgVelocityHours !== null) {
    lines.push(`- Velocity由来の推定工数: ${calibration.avgVelocityHours}時間`)
  }

  return lines.join('\n')
}

function buildCodeImpactSection(codeImpact: CodeImpactAnalysis | null): string {
  if (codeImpact === null || !codeImpact.narrative) return ''

  return `## 既存コードベース分析\n${codeImpact.narrative}`
}

function truncateToMaxChars(text: string): string {
  if (text.length <= MAX_EVIDENCE_CONTEXT_CHARS) return text

  const suffixLength = TRUNCATION_SUFFIX.length
  const availableChars = MAX_EVIDENCE_CONTEXT_CHARS - suffixLength
  return `${text.slice(0, availableChars)}${TRUNCATION_SUFFIX}`
}

export function buildEvidenceContextBlock(input: EvidenceContextInput): string {
  const { historicalCalibration, codeImpact } = input

  const hasReferences = historicalCalibration.references.length > 0
  const hasCodeImpact = codeImpact !== null && Boolean(codeImpact.narrative)

  if (!hasReferences && !hasCodeImpact) return ''

  const sections: string[] = []

  if (hasReferences) {
    sections.push('## 類似プロジェクト実績データ（社内ポートフォリオ）')

    const referencesSection = buildReferencesSection(historicalCalibration.references)
    if (referencesSection) sections.push(referencesSection)

    const statisticsSection = buildStatisticsSection(historicalCalibration)
    if (statisticsSection) sections.push(statisticsSection)
  }

  const codeImpactSection = buildCodeImpactSection(codeImpact)
  if (codeImpactSection) sections.push(codeImpactSection)

  const result = sections.join('\n\n')
  return truncateToMaxChars(result)
}
