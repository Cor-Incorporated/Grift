import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import type { ProjectType } from '@/types/database'

export interface CodeImpactAnalysis {
  affectedFiles: Array<{
    path: string
    changeType: 'new' | 'modify' | 'delete'
    riskLevel: 'low' | 'medium' | 'high'
    reason: string
    estimatedHours: number
  }>
  impactScope: {
    totalFilesAffected: number
    totalTestsAffected: number
    couplingRisk: 'low' | 'medium' | 'high'
    backwardCompatible: boolean
  }
  bugLocations?: Array<{
    path: string
    confidence: 'high' | 'medium' | 'low'
    reason: string
    suggestedFix: string
  }>
  architectureImpact?: {
    newComponents: string[]
    modifiedComponents: string[]
    newApiEndpoints: string[]
    modifiedApiEndpoints: string[]
    databaseChanges: string[]
  }
  narrative: string
}

type RiskLevel = 'low' | 'medium' | 'high'
type ChangeType = 'new' | 'modify' | 'delete'
type Confidence = 'high' | 'medium' | 'low'

const VALID_CHANGE_TYPES: ChangeType[] = ['new', 'modify', 'delete']
const VALID_RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high']
const VALID_CONFIDENCES: Confidence[] = ['high', 'medium', 'low']

function normalizeAffectedFile(raw: Record<string, unknown>): CodeImpactAnalysis['affectedFiles'][number] {
  return {
    path: typeof raw.path === 'string' ? raw.path : 'unknown',
    changeType: VALID_CHANGE_TYPES.includes(raw.changeType as ChangeType)
      ? (raw.changeType as ChangeType)
      : 'modify',
    riskLevel: VALID_RISK_LEVELS.includes(raw.riskLevel as RiskLevel)
      ? (raw.riskLevel as RiskLevel)
      : 'medium',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    estimatedHours: Math.max(0, Number(raw.estimatedHours ?? 0)),
  }
}

function normalizeImpactScope(
  raw: Record<string, unknown> | undefined
): CodeImpactAnalysis['impactScope'] {
  return {
    totalFilesAffected: Math.max(0, Number(raw?.totalFilesAffected ?? 0)),
    totalTestsAffected: Math.max(0, Number(raw?.totalTestsAffected ?? 0)),
    couplingRisk: VALID_RISK_LEVELS.includes(raw?.couplingRisk as RiskLevel)
      ? (raw?.couplingRisk as RiskLevel)
      : 'medium',
    backwardCompatible: typeof raw?.backwardCompatible === 'boolean'
      ? raw.backwardCompatible
      : true,
  }
}

function normalizeBugLocation(
  raw: Record<string, unknown>
): NonNullable<CodeImpactAnalysis['bugLocations']>[number] {
  return {
    path: typeof raw.path === 'string' ? raw.path : 'unknown',
    confidence: VALID_CONFIDENCES.includes(raw.confidence as Confidence)
      ? (raw.confidence as Confidence)
      : 'low',
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    suggestedFix: typeof raw.suggestedFix === 'string' ? raw.suggestedFix : '',
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : []
}

function normalizeArchitectureImpact(
  raw: Record<string, unknown> | undefined
): CodeImpactAnalysis['architectureImpact'] | undefined {
  if (!raw) return undefined
  return {
    newComponents: normalizeStringArray(raw.newComponents),
    modifiedComponents: normalizeStringArray(raw.modifiedComponents),
    newApiEndpoints: normalizeStringArray(raw.newApiEndpoints),
    modifiedApiEndpoints: normalizeStringArray(raw.modifiedApiEndpoints),
    databaseChanges: normalizeStringArray(raw.databaseChanges),
  }
}

function normalizeCodeImpactAnalysis(
  raw: Record<string, unknown>
): CodeImpactAnalysis {
  const affectedFiles = Array.isArray(raw.affectedFiles)
    ? (raw.affectedFiles as Record<string, unknown>[]).map(normalizeAffectedFile)
    : []

  const impactScope = normalizeImpactScope(
    raw.impactScope as Record<string, unknown> | undefined
  )

  const bugLocations = Array.isArray(raw.bugLocations)
    ? (raw.bugLocations as Record<string, unknown>[]).map(normalizeBugLocation)
    : undefined

  const architectureImpact = normalizeArchitectureImpact(
    raw.architectureImpact as Record<string, unknown> | undefined
  )

  return {
    affectedFiles,
    impactScope: {
      ...impactScope,
      totalFilesAffected: impactScope.totalFilesAffected || affectedFiles.length,
    },
    bugLocations,
    architectureImpact,
    narrative: typeof raw.narrative === 'string' && raw.narrative.length > 0
      ? raw.narrative
      : '影響分析の詳細は生成できませんでした。',
  }
}

function buildProjectTypeInstructions(projectType: ProjectType): string {
  switch (projectType) {
    case 'bug_report':
    case 'fix_request':
      return `このプロジェクトはバグ修正/修正依頼です。以下を特に分析してください:
- bugLocations: バグの可能性がある箇所（パス、確信度、理由、修正案）
- 影響範囲が最小限になるよう、修正の波及効果を分析`
    case 'feature_addition':
    case 'new_project':
      return `このプロジェクトは機能追加/新規プロジェクトです。以下を特に分析してください:
- architectureImpact: アーキテクチャへの影響（新規/変更コンポーネント、API、DB変更）
- 既存システムとの統合ポイントと後方互換性`
    default:
      return '影響範囲を総合的に分析してください。'
  }
}

export async function analyzeCodeImpact(input: {
  repoAnalysis: string
  specMarkdown: string
  projectType: ProjectType
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  }
}): Promise<CodeImpactAnalysis> {
  const typeInstructions = buildProjectTypeInstructions(input.projectType)

  const prompt = `あなたはシニアソフトウェアエンジニアです。既存コードベースの分析結果と仕様書を読み、コード変更の影響範囲を分析してください。

## 案件タイプ
${input.projectType}

## 分析指示
${typeInstructions}

## 既存コードベース分析
${input.repoAnalysis.slice(0, 6000)}

## 仕様書
${input.specMarkdown.slice(0, 4000)}

以下のJSON形式で回答してください:
\`\`\`json
{
  "affectedFiles": [
    {
      "path": "ファイルパス",
      "changeType": "new" | "modify" | "delete",
      "riskLevel": "low" | "medium" | "high",
      "reason": "変更理由",
      "estimatedHours": 作業時間
    }
  ],
  "impactScope": {
    "totalFilesAffected": 影響ファイル数,
    "totalTestsAffected": 影響テスト数,
    "couplingRisk": "low" | "medium" | "high",
    "backwardCompatible": true | false
  },
  "bugLocations": [
    {
      "path": "ファイルパス",
      "confidence": "high" | "medium" | "low",
      "reason": "バグの理由",
      "suggestedFix": "修正案"
    }
  ],
  "architectureImpact": {
    "newComponents": ["新規コンポーネント"],
    "modifiedComponents": ["変更コンポーネント"],
    "newApiEndpoints": ["新規APIエンドポイント"],
    "modifiedApiEndpoints": ["変更APIエンドポイント"],
    "databaseChanges": ["DB変更"]
  },
  "narrative": "顧客向けの影響範囲説明（2-3文）"
}
\`\`\`

制約:
- 回答は必ずJSONのみで返す
- bug_report/fix_request の場合、bugLocationsを必ず含める
- feature_addition/new_project の場合、architectureImpactを必ず含める
- narrativeは技術者でない顧客にも理解できる日本語で記述
- affectedFilesのestimatedHoursは各ファイルの作業時間（時間単位）`

  const response = await sendMessage(
    prompt,
    [{ role: 'user', content: '影響分析を実施してください。' }],
    {
      temperature: 0.3,
      maxTokens: 4096,
      usageContext: input.usageContext,
    }
  )

  const parsed = parseJsonFromResponse<Record<string, unknown>>(response)
  return normalizeCodeImpactAnalysis(parsed)
}
