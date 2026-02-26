import { requestXaiResponse, parseJsonFromResponse } from '@/lib/ai/xai'
import { logger } from '@/lib/utils/logger'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SimilarProject } from '@/lib/estimates/similar-projects'
import type { ProjectType, BusinessLine } from '@/types/database'
import type { UsageCallContext } from '@/lib/usage/api-usage'

interface SemanticProfile {
  techStack: string[]
  domain: string[]
  complexityTier: 'simple' | 'medium' | 'complex'
  integrations: string[]
  projectNature: string
}

export interface SemanticSimilarityInput {
  supabase: SupabaseClient
  specMarkdown: string
  projectType: ProjectType
  businessLine?: BusinessLine
  attachmentContext?: string
  limit?: number
  usageContext?: UsageCallContext
}

interface ShowcaseRef {
  id: string
  org_name: string | null
  repo_name: string | null
  full_name: string
  description: string | null
  language: string | null
  tech_stack: string[]
  project_type: string | null
  topics: string[]
  hours_spent: number | null
  analysis_result: Record<string, unknown> | null
}

interface ScoreResult {
  score: number
  reasons: string[]
}

const SYSTEM_PROMPT = `あなたはソフトウェアプロジェクト分析の専門家です。
以下の仕様書から技術プロファイルをJSON形式で抽出してください。

出力形式:
{
  "techStack": ["使用する技術・フレームワーク名"],
  "domain": ["ビジネスドメイン（例: eコマース, SaaS, IoT）"],
  "complexityTier": "simple | medium | complex",
  "integrations": ["外部サービス連携（例: Stripe, LINE, Slack）"],
  "projectNature": "プロジェクトの1-2文の概要"
}

注意:
- 明示されていない技術は推測しないでください
- domainは日本語・英語どちらでも可
- complexityTierは機能数と技術的難易度から判断してください`

async function extractSemanticProfile(
  specMarkdown: string,
  attachmentContext: string | undefined,
  usageContext: UsageCallContext | undefined
): Promise<SemanticProfile | null> {
  const userParts = [specMarkdown]
  if (attachmentContext) {
    userParts.push('\n\n添付コンテキスト:\n' + attachmentContext.slice(0, 3000))
  }
  const userMessage = userParts.join('')

  try {
    const response = await requestXaiResponse(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      {
        model: process.env.XAI_MODEL ?? 'grok-4-1-fast',
        temperature: 0.1,
        maxOutputTokens: 500,
        usageContext,
      }
    )

    const profile = parseJsonFromResponse<SemanticProfile>(response.text)

    return {
      techStack: Array.isArray(profile.techStack) ? profile.techStack : [],
      domain: Array.isArray(profile.domain) ? profile.domain : [],
      complexityTier: ['simple', 'medium', 'complex'].includes(profile.complexityTier)
        ? profile.complexityTier
        : 'medium',
      integrations: Array.isArray(profile.integrations) ? profile.integrations : [],
      projectNature: typeof profile.projectNature === 'string' ? profile.projectNature : '',
    }
  } catch (error) {
    logger.warn('セマンティックプロファイル抽出に失敗しました', { error: String(error) })
    return null
  }
}

function scoreSemanticMatch(
  profile: SemanticProfile,
  ref: ShowcaseRef,
  projectType: ProjectType
): ScoreResult {
  const reasons: string[] = []
  let score = 0

  // Tech stack overlap (weight: 0.35)
  const refTechLower = (ref.tech_stack ?? []).map((t) => t.toLowerCase())
  const techMatches = profile.techStack.filter((tech) => {
    const techLower = tech.toLowerCase()
    return refTechLower.some((rt) => rt.includes(techLower) || techLower.includes(rt))
  })
  if (techMatches.length > 0) {
    const maxLen = Math.max(profile.techStack.length, ref.tech_stack.length)
    const techScore = (techMatches.length / Math.max(1, maxLen)) * 0.35
    score += techScore
    reasons.push(`技術スタック一致: ${techMatches.join(', ')}`)
  }

  // Domain overlap (weight: 0.25)
  const refSearchText = [
    ...(ref.topics ?? []),
    ref.description ?? '',
  ].join(' ').toLowerCase()
  const domainMatches = profile.domain.filter((d) =>
    refSearchText.includes(d.toLowerCase())
  )
  if (domainMatches.length > 0) {
    const domainScore = Math.min(1, domainMatches.length / Math.max(1, profile.domain.length)) * 0.25
    score += domainScore
    reasons.push(`ドメイン一致: ${domainMatches.join(', ')}`)
  }

  // Integrations overlap (weight: 0.2)
  const analysisResult = ref.analysis_result ?? {}
  const analysisText = JSON.stringify(analysisResult).toLowerCase()
  const refTechAndAnalysis = refTechLower.join(' ') + ' ' + analysisText
  const integrationMatches = profile.integrations.filter((integ) =>
    refTechAndAnalysis.includes(integ.toLowerCase())
  )
  if (integrationMatches.length > 0) {
    const integScore =
      Math.min(1, integrationMatches.length / Math.max(1, profile.integrations.length)) * 0.2
    score += integScore
    reasons.push(`連携サービス一致: ${integrationMatches.join(', ')}`)
  }

  // Project type match (weight: 0.1)
  if (ref.project_type) {
    const ptLower = ref.project_type.toLowerCase()
    const typeMatch =
      ptLower === projectType || ptLower.includes(projectType.replace('_', ' '))
    if (typeMatch) {
      score += 0.1
      reasons.push(`プロジェクトタイプ一致: ${ref.project_type}`)
    }
  }

  // Complexity tier match (weight: 0.1)
  const estimatedComplexity =
    typeof analysisResult['estimatedComplexity'] === 'string'
      ? (analysisResult['estimatedComplexity'] as string).toLowerCase()
      : null
  if (estimatedComplexity) {
    const complexityMap: Record<string, string[]> = {
      simple: ['simple', 'low', 'basic'],
      medium: ['medium', 'moderate', 'intermediate'],
      complex: ['complex', 'high', 'advanced'],
    }
    const targetTier = profile.complexityTier
    const matchTerms = complexityMap[targetTier] ?? []
    if (matchTerms.some((term) => estimatedComplexity.includes(term))) {
      score += 0.1
      reasons.push(`複雑さ一致: ${profile.complexityTier}`)
    }
  }

  return { score: Math.round(score * 100) / 100, reasons }
}

export async function findSimilarProjectsSemantic(
  input: SemanticSimilarityInput
): Promise<SimilarProject[]> {
  const {
    supabase,
    specMarkdown,
    projectType,
    attachmentContext,
    limit = 5,
    usageContext,
  } = input

  // 1. Extract semantic profile via Grok
  const profile = await extractSemanticProfile(specMarkdown, attachmentContext, usageContext)
  if (!profile) {
    return []
  }

  // 2. Query showcase repos including analysis_result
  const { data: refs, error } = await supabase
    .from('github_references')
    .select(
      'id, org_name, repo_name, full_name, description, language, tech_stack, project_type, topics, hours_spent, analysis_result'
    )
    .eq('is_showcase', true)
    .order('stars', { ascending: false })
    .limit(100)

  if (error || !refs || refs.length === 0) {
    return []
  }

  // 3. Score each repo against the semantic profile
  const scored = (refs as ShowcaseRef[]).map((ref) => {
    const { score, reasons } = scoreSemanticMatch(profile, ref, projectType)
    return {
      githubReferenceId: ref.id,
      repoFullName: ref.full_name,
      matchScore: score,
      matchReasons: reasons,
      language: ref.language,
      techStack: ref.tech_stack ?? [],
      hoursSpent: ref.hours_spent,
      description: ref.description,
    }
  })

  // 4. Filter, sort, and limit
  return scored
    .filter((s) => s.matchScore > 0.1)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit)
}
