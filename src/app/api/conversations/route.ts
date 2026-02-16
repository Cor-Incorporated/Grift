import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { sendMessage, type ChatMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import { getSystemPrompt, getSpecGenerationPrompt } from '@/lib/ai/system-prompts'
import { sendMessageSchema } from '@/lib/utils/validation'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import { buildProjectAttachmentContext } from '@/lib/source-analysis/project-context'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { isExternalApiQuotaError } from '@/lib/usage/api-usage'
import type { ProjectType, ConversationMetadata, ConcreteProjectType } from '@/types/database'

const METADATA_DELIMITER = '---METADATA---'

interface AIResponse {
  message: string
  category: string
  confidence_score: number
  confirmed_categories: string[]
  is_complete: boolean
  question_type: 'open' | 'choice' | 'confirmation'
  choices?: string[]
  classified_type?: ConcreteProjectType | null
  generated_title?: string | null
}

function parseAIResponse(text: string): AIResponse {
  const delimiterIndex = text.indexOf(METADATA_DELIMITER)

  if (delimiterIndex !== -1) {
    const messagePart = text.slice(0, delimiterIndex).trim()
    const jsonPart = text.slice(delimiterIndex + METADATA_DELIMITER.length).trim()

    try {
      const metadata = JSON.parse(jsonPart) as Omit<AIResponse, 'message'>
      return { message: messagePart, ...metadata }
    } catch {
      try {
        const parsed = parseJsonFromResponse<Omit<AIResponse, 'message'>>(jsonPart)
        return { message: messagePart, ...parsed }
      } catch {
        // fall through to legacy parser
      }
    }
  }

  try {
    return parseJsonFromResponse<AIResponse>(text)
  } catch {
    return {
      message: text,
      category: '',
      confidence_score: 0,
      confirmed_categories: [],
      is_complete: false,
      question_type: 'open',
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()

    if (!authUser) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(
      request,
      'conversations:post',
      RATE_LIMITS['conversations:post'],
      authUser.clerkUserId
    )
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validated = sendMessageSchema.parse(body)

    const supabase = await createServiceRoleClient()

    const accessible = await canAccessProject(
      supabase,
      validated.project_id,
      authUser.clerkUserId,
      authUser.email
    )

    if (!accessible) {
      return NextResponse.json(
        { success: false, error: 'この案件にアクセスできません' },
        { status: 403 }
      )
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', validated.project_id)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: '案件が見つかりません' },
        { status: 404 }
      )
    }

    await supabase.from('conversations').insert({
      project_id: validated.project_id,
      role: 'user',
      content: validated.content,
      metadata: {},
    })

    const { data: history } = await supabase
      .from('conversations')
      .select('role, content')
      .eq('project_id', validated.project_id)
      .order('created_at', { ascending: true })

    const messages: ChatMessage[] = (history ?? [])
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }))

    const attachmentContext = await buildProjectAttachmentContext(supabase, validated.project_id)
    const baseSystemPrompt = getSystemPrompt(project.type as ProjectType)
    const systemPrompt = attachmentContext
      ? `${baseSystemPrompt}\n\n${attachmentContext}`
      : baseSystemPrompt
    const aiResponseText = await sendMessage(systemPrompt, messages, {
      usageContext: {
        projectId: validated.project_id,
        actorClerkUserId: authUser.clerkUserId,
      },
    })
    const aiResponse = parseAIResponse(aiResponseText)

    const metadata: ConversationMetadata = {
      category: aiResponse.category,
      confidence_score: aiResponse.confidence_score,
      is_complete: aiResponse.is_complete,
      question_type: aiResponse.question_type,
      choices: aiResponse.choices,
      classified_type: aiResponse.classified_type ?? null,
      generated_title: aiResponse.generated_title ?? null,
    }

    const { data: savedMessage } = await supabase
      .from('conversations')
      .insert({
        project_id: validated.project_id,
        role: 'assistant',
        content: aiResponse.message,
        metadata,
      })
      .select()
      .single()

    if (
      aiResponse.classified_type &&
      project.type === 'undetermined'
    ) {
      const updatePayload: Record<string, unknown> = {
        type: aiResponse.classified_type,
      }
      if (aiResponse.generated_title) {
        updatePayload.title = aiResponse.generated_title
      }
      await supabase
        .from('projects')
        .update(updatePayload)
        .eq('id', validated.project_id)
    }

    if (aiResponse.is_complete) {
      const allMessages: ChatMessage[] = (history ?? [])
        .filter((msg) => msg.role !== 'system')
        .map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }))

      const specPrompt = getSpecGenerationPrompt(project.type as ProjectType)
      const attachmentContextBlock = attachmentContext
        ? `\n\n添付資料の解析要約:\n${attachmentContext}`
        : ''
      const specMarkdown = await sendMessage(specPrompt, [
        {
          role: 'user',
          content: `以下の対話記録を基に文書を生成してください:\n\n${allMessages
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n\n')}${attachmentContextBlock}`,
        },
      ], {
        usageContext: {
          projectId: validated.project_id,
          actorClerkUserId: authUser.clerkUserId,
        },
      })

      await supabase
        .from('projects')
        .update({
          status: 'analyzing',
          spec_markdown: specMarkdown,
        })
        .eq('id', validated.project_id)

      await writeAuditLog(supabase, {
        actorClerkUserId: authUser.clerkUserId,
        action: 'conversation.spec_generated',
        resourceType: 'project',
        resourceId: validated.project_id,
        projectId: validated.project_id,
        payload: {
          conversationCount: allMessages.length,
          projectType: project.type,
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        message: savedMessage,
        ai_response: {
          text: aiResponse.message,
          metadata,
          confirmed_categories: aiResponse.confirmed_categories,
        },
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        { success: false, error: '入力データが不正です' },
        { status: 400 }
      )
    }

    if (isExternalApiQuotaError(error)) {
      return NextResponse.json(
        { success: false, error: '外部APIのクォータ上限に達しました。しばらくしてから再試行してください。' },
        { status: 429 }
      )
    }

    const message = error instanceof Error ? error.message : 'サーバーエラー'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()

    if (!authUser) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimitedGet = applyRateLimit(
      request,
      'conversations:get',
      RATE_LIMITS['conversations:get'],
      authUser.clerkUserId
    )
    if (rateLimitedGet) return rateLimitedGet

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('project_id')

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'project_id は必須です' },
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
      return NextResponse.json(
        { success: false, error: 'この案件にアクセスできません' },
        { status: 403 }
      )
    }

    const { data: conversations, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json(
        { success: false, error: '会話履歴の取得に失敗しました' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: conversations,
    })
  } catch {
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
