import { sendMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import type { ProjectType } from '@/types/database'

export interface ModuleEstimate {
  name: string
  description: string
  hours: {
    investigation: number
    implementation: number
    testing: number
  }
  totalHours: number
  dependencies: string[]
  parallelTrack: 'A' | 'B' | 'C'
  riskLevel: 'low' | 'medium' | 'high'
  riskReason?: string
}

export interface ImplementationPlan {
  modules: ModuleEstimate[]
  phases: Array<{
    name: string
    weekStart: number
    weekEnd: number
    modules: string[]
    parallelStreams: number
  }>
  criticalPath: string[]
  mvpModules: string[]
  totalWeeks: number
  teamRecommendation: {
    optimalSize: number
    roles: string[]
    rationale: string
  }
}

function normalizeModuleEstimate(raw: Partial<ModuleEstimate>): ModuleEstimate {
  const investigation = Math.max(0, Number(raw.hours?.investigation ?? 0))
  const implementation = Math.max(0, Number(raw.hours?.implementation ?? 0))
  const testing = Math.max(0, Number(raw.hours?.testing ?? 0))
  const computedTotal = investigation + implementation + testing
  const rawTotal = Math.max(0, Number(raw.totalHours ?? 0))

  const validTracks: Array<ModuleEstimate['parallelTrack']> = ['A', 'B', 'C']
  const track = validTracks.includes(raw.parallelTrack as ModuleEstimate['parallelTrack'])
    ? (raw.parallelTrack as ModuleEstimate['parallelTrack'])
    : 'A'

  const validRiskLevels: Array<ModuleEstimate['riskLevel']> = ['low', 'medium', 'high']
  const riskLevel = validRiskLevels.includes(raw.riskLevel as ModuleEstimate['riskLevel'])
    ? (raw.riskLevel as ModuleEstimate['riskLevel'])
    : 'medium'

  return {
    name: typeof raw.name === 'string' ? raw.name : 'Unknown Module',
    description: typeof raw.description === 'string' ? raw.description : '',
    hours: {
      investigation,
      implementation,
      testing,
    },
    totalHours: rawTotal > 0 ? rawTotal : computedTotal,
    dependencies: Array.isArray(raw.dependencies)
      ? raw.dependencies.filter((d): d is string => typeof d === 'string')
      : [],
    parallelTrack: track,
    riskLevel,
    riskReason: typeof raw.riskReason === 'string' ? raw.riskReason : undefined,
  }
}

function normalizePhase(raw: Record<string, unknown>): ImplementationPlan['phases'][number] {
  return {
    name: typeof raw.name === 'string' ? raw.name : 'Phase',
    weekStart: Math.max(0, Number(raw.weekStart ?? 0)),
    weekEnd: Math.max(0, Number(raw.weekEnd ?? 0)),
    modules: Array.isArray(raw.modules)
      ? raw.modules.filter((m): m is string => typeof m === 'string')
      : [],
    parallelStreams: Math.max(1, Number(raw.parallelStreams ?? 1)),
  }
}

function normalizeTeamRecommendation(
  raw: Record<string, unknown> | undefined
): ImplementationPlan['teamRecommendation'] {
  return {
    optimalSize: Math.max(1, Number(raw?.optimalSize ?? 2)),
    roles: Array.isArray(raw?.roles)
      ? (raw.roles as unknown[]).filter((r): r is string => typeof r === 'string')
      : ['フルスタックエンジニア'],
    rationale: typeof raw?.rationale === 'string' ? raw.rationale : '',
  }
}

function normalizeImplementationPlan(
  raw: Partial<{
    modules: Array<Partial<ModuleEstimate>>
    phases: Array<Record<string, unknown>>
    criticalPath: string[]
    mvpModules: string[]
    totalWeeks: number
    teamRecommendation: Record<string, unknown>
  }>
): ImplementationPlan {
  const modules = Array.isArray(raw.modules)
    ? raw.modules.map(normalizeModuleEstimate)
    : []

  const phases = Array.isArray(raw.phases)
    ? raw.phases.map(normalizePhase)
    : []

  const criticalPath = Array.isArray(raw.criticalPath)
    ? raw.criticalPath.filter((c): c is string => typeof c === 'string')
    : []

  const mvpModules = Array.isArray(raw.mvpModules)
    ? raw.mvpModules.filter((m): m is string => typeof m === 'string')
    : []

  const totalWeeks = Math.max(1, Number(raw.totalWeeks ?? 0))

  return {
    modules,
    phases,
    criticalPath,
    mvpModules,
    totalWeeks,
    teamRecommendation: normalizeTeamRecommendation(raw.teamRecommendation),
  }
}

export async function generateImplementationPlan(input: {
  specMarkdown: string
  projectType: ProjectType
  attachmentContext?: string
  existingCodeAnalysis?: string
  usageContext?: {
    projectId?: string | null
    actorClerkUserId?: string | null
  }
}): Promise<ImplementationPlan> {
  const contextSections: string[] = []

  if (input.attachmentContext) {
    contextSections.push(`\n## 添付資料の解析結果\n${input.attachmentContext}`)
  }
  if (input.existingCodeAnalysis) {
    contextSections.push(`\n## 既存コード分析\n${input.existingCodeAnalysis}`)
  }

  const granularityGuide = input.projectType === 'new_project'
    ? 'プロジェクトは5-10モジュールに分割し、各モジュールは1-2週間で完了できる粒度にしてください。'
    : input.projectType === 'feature_addition'
      ? 'プロジェクトは3-7モジュールに分割し、既存システムとの統合ポイントを明確にしてください。'
      : 'プロジェクトは3-5モジュールに分割し、修正の影響範囲を明確にしてください。'

  const prompt = `あなたはシニアソフトウェアアーキテクトです。以下の仕様書を分析し、実装計画をモジュール単位で分解してください。

## 案件タイプ
${input.projectType}

## 粒度ガイド
${granularityGuide}

## 仕様書
${input.specMarkdown.slice(0, 6000)}
${contextSections.join('\n')}

以下のJSON形式で回答してください:
\`\`\`json
{
  "modules": [
    {
      "name": "モジュール名",
      "description": "モジュールの説明",
      "hours": {
        "investigation": 調査時間,
        "implementation": 実装時間,
        "testing": テスト時間
      },
      "totalHours": 合計時間,
      "dependencies": ["依存するモジュール名"],
      "parallelTrack": "A" | "B" | "C",
      "riskLevel": "low" | "medium" | "high",
      "riskReason": "リスクの理由（任意）"
    }
  ],
  "phases": [
    {
      "name": "フェーズ名",
      "weekStart": 開始週,
      "weekEnd": 終了週,
      "modules": ["モジュール名"],
      "parallelStreams": 並列作業ストリーム数
    }
  ],
  "criticalPath": ["クリティカルパス上のモジュール名"],
  "mvpModules": ["MVP必須のモジュール名"],
  "totalWeeks": 全体の週数,
  "teamRecommendation": {
    "optimalSize": 最適チーム人数,
    "roles": ["必要な役割"],
    "rationale": "チーム構成の理由"
  }
}
\`\`\`

制約:
- 回答は必ずJSONのみで返す
- モジュールは3-10個の範囲で分割
- 各モジュールを依存関係に基づいて並列トラック（A, B, C）に割り当てる
- クリティカルパスは最も時間がかかる依存チェーンを特定
- MVPに必要なモジュールを明示
- チーム推奨は案件タイプと規模に応じて調整`

  const response = await sendMessage(
    prompt,
    [{ role: 'user', content: '実装計画をモジュール単位で分解してください。' }],
    {
      temperature: 0.3,
      maxTokens: 4096,
      usageContext: input.usageContext,
    }
  )

  const parsed = parseJsonFromResponse<Partial<{
    modules: Array<Partial<ModuleEstimate>>
    phases: Array<Record<string, unknown>>
    criticalPath: string[]
    mvpModules: string[]
    totalWeeks: number
    teamRecommendation: Record<string, unknown>
  }>>(response)

  return normalizeImplementationPlan(parsed)
}
