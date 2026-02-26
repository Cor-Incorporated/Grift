import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectType, BusinessLine } from '@/types/database'
import type { UsageCallContext } from '@/lib/usage/api-usage'
import { logger } from '@/lib/utils/logger'

export interface SimilarProject {
  githubReferenceId: string
  repoFullName: string
  matchScore: number
  matchReasons: string[]
  language: string | null
  techStack: string[]
  hoursSpent: number | null
  description: string | null
}

interface FindSimilarProjectsInput {
  supabase: SupabaseClient
  specMarkdown: string
  projectType: ProjectType
  businessLine?: BusinessLine
  attachmentContext?: string
  limit?: number
  strategy?: 'keyword' | 'semantic'
  usageContext?: UsageCallContext
}

// Extract keywords from text for matching
function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase()

  // Programming languages and frameworks
  const techTerms = [
    'react', 'next.js', 'nextjs', 'vue', 'angular', 'svelte',
    'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'swift',
    'node', 'express', 'fastapi', 'django', 'flask', 'rails', 'ruby',
    'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
    'aws', 'gcp', 'azure', 'docker', 'kubernetes',
    'graphql', 'rest', 'grpc', 'websocket',
    'tailwind', 'sass', 'css',
    'react native', 'flutter', 'ios', 'android',
    'ai', 'ml', 'machine learning', 'deep learning', 'llm', 'openai', 'claude',
    'iot', 'nfc', 'bluetooth', 'mqtt',
    'stripe', 'payment', 'auth', 'oauth',
    'cms', 'wordpress', 'shopify', 'ec', 'ecommerce',
    'saas', 'b2b', 'b2c',
  ]

  // Domain terms
  const domainTerms = [
    'eコマース', 'ec', '決済', '認証', 'チャット', 'リアルタイム',
    '管理画面', 'ダッシュボード', 'api', 'マイクロサービス',
    'モバイルアプリ', 'webアプリ', 'ランディングページ', 'lp',
    '名刺', 'nfc', 'iot', 'センサー',
    'ai', '機械学習', '自然言語処理', '画像認識',
    '在庫管理', '予約', 'crm', 'erp',
  ]

  const allTerms = [...techTerms, ...domainTerms]
  return allTerms.filter((term) => lower.includes(term))
}

// Calculate match score between keywords and a github reference
function calculateMatchScore(
  keywords: string[],
  ref: {
    language: string | null
    tech_stack: string[]
    project_type: string | null
    topics: string[]
  },
  projectType: ProjectType,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future business-line-specific scoring
  _businessLine?: BusinessLine
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // tech_stack overlap (weight: 0.4)
  const techOverlap = keywords.filter((kw) =>
    ref.tech_stack.some((t) => t.toLowerCase().includes(kw) || kw.includes(t.toLowerCase()))
  )
  if (techOverlap.length > 0) {
    const techScore = Math.min(1, techOverlap.length / Math.max(1, keywords.length)) * 0.4
    score += techScore
    reasons.push(`技術スタック一致: ${techOverlap.join(', ')}`)
  }

  // language match (weight: 0.2)
  if (ref.language) {
    const langLower = ref.language.toLowerCase()
    const langMatch = keywords.some((kw) => langLower.includes(kw) || kw.includes(langLower))
    if (langMatch) {
      score += 0.2
      reasons.push(`言語一致: ${ref.language}`)
    }
  }

  // project_type match (weight: 0.2)
  if (ref.project_type) {
    const ptLower = ref.project_type.toLowerCase()
    const ptMatch = ptLower === projectType || ptLower.includes(projectType.replace('_', ' '))
    if (ptMatch) {
      score += 0.2
      reasons.push(`プロジェクトタイプ一致: ${ref.project_type}`)
    }
  }

  // topics overlap (weight: 0.2)
  const topicOverlap = keywords.filter((kw) =>
    ref.topics.some((t) => t.toLowerCase().includes(kw) || kw.includes(t.toLowerCase()))
  )
  if (topicOverlap.length > 0) {
    const topicScore = Math.min(1, topicOverlap.length / Math.max(1, ref.topics.length)) * 0.2
    score += topicScore
    reasons.push(`トピック一致: ${topicOverlap.join(', ')}`)
  }

  return { score: Math.round(score * 100) / 100, reasons }
}

export async function findSimilarProjects(
  input: FindSimilarProjectsInput
): Promise<SimilarProject[]> {
  const { supabase, specMarkdown, projectType, businessLine, attachmentContext, limit = 5, strategy = 'keyword', usageContext } = input

  // Semantic strategy: delegate to AI-based matching
  if (strategy === 'semantic') {
    try {
      const { findSimilarProjectsSemantic } = await import('@/lib/estimates/semantic-similarity')
      return await findSimilarProjectsSemantic({
        supabase,
        specMarkdown,
        projectType,
        businessLine,
        attachmentContext,
        limit,
        usageContext,
      })
    } catch (error) {
      logger.warn('Semantic similarity failed, falling back to keyword', {
        error: error instanceof Error ? error.message : String(error),
      })
      // Fall through to keyword strategy
    }
  }

  // 1. Extract keywords from spec + attachment context
  const fullText = [specMarkdown, attachmentContext ?? ''].join('\n')
  const keywords = extractKeywords(fullText)

  if (keywords.length === 0) {
    return []
  }

  // 2. Query showcase repos
  const { data: refs, error } = await supabase
    .from('github_references')
    .select('id, org_name, repo_name, full_name, description, language, tech_stack, project_type, topics, hours_spent')
    .eq('is_showcase', true)
    .order('stars', { ascending: false })
    .limit(100)

  if (error || !refs || refs.length === 0) {
    return []
  }

  // 3. Score and rank
  const scored = refs.map((ref) => {
    const { score, reasons } = calculateMatchScore(
      keywords,
      ref,
      projectType,
      businessLine
    )

    return {
      githubReferenceId: ref.id as string,
      repoFullName: ref.full_name as string,
      matchScore: score,
      matchReasons: reasons,
      language: ref.language as string | null,
      techStack: (ref.tech_stack ?? []) as string[],
      hoursSpent: ref.hours_spent as number | null,
      description: ref.description as string | null,
    }
  })

  // 4. Filter and sort
  return scored
    .filter((s) => s.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit)
}
