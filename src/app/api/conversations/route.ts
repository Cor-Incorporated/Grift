import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { sendMessage, type ChatMessage } from '@/lib/ai/anthropic'
import { getSystemPrompt, getSpecGenerationPrompt } from '@/lib/ai/system-prompts'
import { sendMessageSchema } from '@/lib/utils/validation'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import type { ProjectType, ConversationMetadata } from '@/types/database'

interface AIResponse {
  message: string
  category: string
  confidence_score: number
  confirmed_categories: string[]
  is_complete: boolean
  question_type: 'open' | 'choice' | 'confirmation'
  choices?: string[]
}

function parseAIResponse(text: string): AIResponse {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1])
  }

  try {
    return JSON.parse(text)
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
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    const rateLimit = checkRateLimit(`conversations:${ip}`, {
      maxRequests: 20,
      windowMs: 60000,
    })

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'リクエスト制限を超えました。しばらくお待ちください。' },
        { status: 429 }
      )
    }

    const body = await request.json()
    const validated = sendMessageSchema.parse(body)

    const supabase = await createServiceRoleClient()

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

    const systemPrompt = getSystemPrompt(project.type as ProjectType)
    const aiResponseText = await sendMessage(systemPrompt, messages)
    const aiResponse = parseAIResponse(aiResponseText)

    const metadata: ConversationMetadata = {
      category: aiResponse.category,
      confidence_score: aiResponse.confidence_score,
      is_complete: aiResponse.is_complete,
      question_type: aiResponse.question_type,
      choices: aiResponse.choices,
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

    if (aiResponse.is_complete) {
      const allMessages: ChatMessage[] = (history ?? [])
        .filter((msg) => msg.role !== 'system')
        .map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }))

      const specPrompt = getSpecGenerationPrompt(project.type as ProjectType)
      const specMarkdown = await sendMessage(specPrompt, [
        {
          role: 'user',
          content: `以下の対話記録を基に文書を生成してください:\n\n${allMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n')}`,
        },
      ])

      await supabase
        .from('projects')
        .update({
          status: 'analyzing',
          spec_markdown: specMarkdown,
        })
        .eq('id', validated.project_id)
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
    const message = error instanceof Error ? error.message : 'サーバーエラー'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('project_id')

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'project_id は必須です' },
        { status: 400 }
      )
    }

    const supabase = await createServiceRoleClient()

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
