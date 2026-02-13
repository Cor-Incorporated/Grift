import { createServiceRoleClient } from '@/lib/supabase/server'
import { sendMessageStream, type ChatMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import { getSystemPrompt, getSpecGenerationPrompt } from '@/lib/ai/system-prompts'
import { sendMessage } from '@/lib/ai/anthropic'
import { sendMessageSchema } from '@/lib/utils/validation'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { buildProjectAttachmentContext } from '@/lib/source-analysis/project-context'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { isExternalApiQuotaError } from '@/lib/usage/api-usage'
import type { ProjectType, ConversationMetadata, ConcreteProjectType } from '@/types/database'

const METADATA_DELIMITER = '---METADATA---'

interface AIMetadata {
  category: string
  confidence_score: number
  confirmed_categories: string[]
  is_complete: boolean
  question_type: 'open' | 'choice' | 'confirmation'
  choices?: string[]
  classified_type?: ConcreteProjectType | null
  generated_title?: string | null
}

interface ParsedAIResponse {
  message: string
  metadata: AIMetadata
}

function parseStructuredResponse(text: string): ParsedAIResponse {
  const delimiterIndex = text.indexOf(METADATA_DELIMITER)

  if (delimiterIndex === -1) {
    return {
      message: text.trim(),
      metadata: {
        category: '',
        confidence_score: 0,
        confirmed_categories: [],
        is_complete: false,
        question_type: 'open',
      },
    }
  }

  const messagePart = text.slice(0, delimiterIndex).trim()
  const jsonPart = text.slice(delimiterIndex + METADATA_DELIMITER.length).trim()

  try {
    const metadata = JSON.parse(jsonPart) as AIMetadata
    return { message: messagePart, metadata }
  } catch {
    try {
      const parsed = parseJsonFromResponse<AIMetadata>(jsonPart)
      return { message: messagePart, metadata: parsed }
    } catch {
      return {
        message: messagePart,
        metadata: {
          category: '',
          confidence_score: 0,
          confirmed_categories: [],
          is_complete: false,
          question_type: 'open',
        },
      }
    }
  }
}

export async function POST(request: Request) {
  try {
    const authUser = await getAuthenticatedUser()

    if (!authUser) {
      return new Response(
        JSON.stringify({ success: false, error: '認証が必要です' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const rateLimit = checkRateLimit(`conversations:${authUser.clerkUserId}`, {
      maxRequests: 20,
      windowMs: 60000,
    })

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: 'リクエスト制限を超えました。しばらくお待ちください。' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
    }

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
      return new Response(
        JSON.stringify({ success: false, error: 'この案件にアクセスできません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', validated.project_id)
      .single()

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ success: false, error: '案件が見つかりません' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
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

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        try {
          let accumulated = ''
          let metadataReached = false

          const fullText = await sendMessageStream(systemPrompt, messages, {
            usageContext: {
              projectId: validated.project_id,
              actorClerkUserId: authUser.clerkUserId,
            },
            onToken: (token) => {
              if (metadataReached) return

              accumulated += token
              const delimiterIndex = accumulated.indexOf(METADATA_DELIMITER)

              if (delimiterIndex !== -1) {
                metadataReached = true
                const beforeDelimiter = accumulated.slice(
                  accumulated.length - token.length,
                  delimiterIndex - (accumulated.length - token.length)
                )
                if (beforeDelimiter.length > 0) {
                  sendEvent('token', { token: beforeDelimiter })
                }
              } else {
                const lookback = METADATA_DELIMITER.length - 1
                const safeEnd = accumulated.length - lookback
                const prevSafe = accumulated.length - token.length - lookback

                if (safeEnd > 0 && safeEnd > prevSafe) {
                  const safeToken = accumulated.slice(
                    Math.max(0, prevSafe),
                    safeEnd
                  )
                  if (safeToken.length > 0) {
                    sendEvent('token', { token: safeToken })
                  }
                }
              }
            },
            signal: request.signal,
          })

          if (!metadataReached) {
            const lookback = METADATA_DELIMITER.length - 1
            const remaining = accumulated.slice(accumulated.length - lookback)
            if (remaining.length > 0) {
              sendEvent('token', { token: remaining })
            }
          }

          const { message, metadata: aiMetadata } = parseStructuredResponse(fullText)

          const metadata: ConversationMetadata = {
            category: aiMetadata.category,
            confidence_score: aiMetadata.confidence_score,
            confirmed_categories: aiMetadata.confirmed_categories,
            is_complete: aiMetadata.is_complete,
            question_type: aiMetadata.question_type,
            choices: aiMetadata.choices,
            classified_type: aiMetadata.classified_type ?? null,
            generated_title: aiMetadata.generated_title ?? null,
          }

          const { data: savedMessage } = await supabase
            .from('conversations')
            .insert({
              project_id: validated.project_id,
              role: 'assistant',
              content: message,
              metadata,
            })
            .select()
            .single()

          if (
            aiMetadata.classified_type &&
            project.type === 'undetermined'
          ) {
            const updatePayload: Record<string, unknown> = {
              type: aiMetadata.classified_type,
            }
            if (aiMetadata.generated_title) {
              updatePayload.title = aiMetadata.generated_title
            }
            await supabase
              .from('projects')
              .update(updatePayload)
              .eq('id', validated.project_id)
          }

          sendEvent('metadata', {
            category: aiMetadata.category,
            confidence_score: aiMetadata.confidence_score,
            confirmed_categories: aiMetadata.confirmed_categories,
            is_complete: aiMetadata.is_complete,
            question_type: aiMetadata.question_type,
            choices: aiMetadata.choices,
            classified_type: aiMetadata.classified_type ?? null,
            generated_title: aiMetadata.generated_title ?? null,
          })

          sendEvent('done', { message_id: savedMessage?.id ?? null })

          if (aiMetadata.is_complete) {
            const allMessages: ChatMessage[] = (history ?? [])
              .filter((msg) => msg.role !== 'system')
              .map((msg) => ({
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
              }))

            const currentType = aiMetadata.classified_type ?? project.type as ProjectType
            const specPrompt = getSpecGenerationPrompt(currentType)
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
                projectType: currentType,
              },
            })

            // Auto-generate estimate
            try {
              const { autoGenerateEstimate } = await import('@/lib/estimates/auto-generate')
              const estimateResult = await autoGenerateEstimate({
                supabase,
                projectId: validated.project_id,
                projectType: currentType,
                specMarkdown,
                attachmentContext,
                usageContext: {
                  projectId: validated.project_id,
                  actorClerkUserId: authUser.clerkUserId,
                },
              })

              await supabase
                .from('projects')
                .update({ status: 'estimating' })
                .eq('id', validated.project_id)

              sendEvent('estimate_generated', {
                estimate_id: estimateResult.estimateId,
                total_hours: estimateResult.totalHours,
                hourly_rate: estimateResult.hourlyRate,
                estimate_mode: estimateResult.estimateMode,
              })
            } catch (estimateError) {
              const estimateErrorMsg = estimateError instanceof Error ? estimateError.message : '見積り自動生成に失敗'
              sendEvent('estimate_error', { error: estimateErrorMsg })
            }
          }

          controller.close()
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            sendEvent('done', { message_id: null, aborted: true })
            controller.close()
            return
          }

          const errorMessage = error instanceof Error ? error.message : 'ストリーミングエラー'
          sendEvent('error', { error: errorMessage })
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return new Response(
        JSON.stringify({ success: false, error: '入力データが不正です' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (isExternalApiQuotaError(error)) {
      return new Response(
        JSON.stringify({ success: false, error: '外部APIのクォータ上限に達しました。' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const message = error instanceof Error ? error.message : 'サーバーエラー'
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
