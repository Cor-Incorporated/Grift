import { createServiceRoleClient } from '@/lib/supabase/server'
import { sendMessageStream, type ChatMessage } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import { getSystemPrompt, getSpecGenerationPrompt } from '@/lib/ai/system-prompts'
import { sendMessage } from '@/lib/ai/anthropic'
import { sendMessageSchema } from '@/lib/utils/validation'
import { applyRateLimitRaw } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import { buildProjectAttachmentContext } from '@/lib/source-analysis/project-context'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { writeAuditLog } from '@/lib/audit/log'
import { isExternalApiQuotaError } from '@/lib/usage/api-usage'
import { classifyBusinessLine } from '@/lib/business-line/classifier'
import type { ProjectType, ConversationMetadata, ConcreteProjectType, BusinessLine } from '@/types/database'

const METADATA_DELIMITER = '---METADATA---'

function isAnthropicTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('overloaded') || msg.includes('529')) return true
    if ('status' in error && (error as { status: number }).status === 529) return true
  }
  return false
}

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

    const rateLimited = applyRateLimitRaw(
      request,
      'conversations:stream:post',
      RATE_LIMITS['conversations:stream:post'],
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
          let sentUpTo = 0
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
                if (delimiterIndex > sentUpTo) {
                  sendEvent('token', { token: accumulated.slice(sentUpTo, delimiterIndex) })
                }
              } else {
                const safeEnd = accumulated.length - (METADATA_DELIMITER.length - 1)
                if (safeEnd > sentUpTo) {
                  sendEvent('token', { token: accumulated.slice(sentUpTo, safeEnd) })
                  sentUpTo = safeEnd
                }
              }
            },
            signal: request.signal,
          })

          if (!metadataReached && sentUpTo < accumulated.length) {
            sendEvent('token', { token: accumulated.slice(sentUpTo) })
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

            // Classify business line
            let classifiedBusinessLine: BusinessLine | null = null
            try {
              const classification = await classifyBusinessLine({
                specMarkdown,
                projectType: currentType,
                attachmentContext: attachmentContext || undefined,
                usageContext: {
                  projectId: validated.project_id,
                  actorClerkUserId: authUser.clerkUserId,
                },
              })

              classifiedBusinessLine = classification.businessLine as BusinessLine

              await supabase
                .from('projects')
                .update({ business_line: classification.businessLine })
                .eq('id', validated.project_id)

              sendEvent('business_line_classified', {
                business_line: classification.businessLine,
                confidence: classification.confidence,
              })
            } catch (classifyError) {
              const msg = classifyError instanceof Error ? classifyError.message : '事業ライン分類に失敗'
              sendEvent('business_line_error', { error: msg })
            }

            // Auto-generate estimate
            try {
              const { autoGenerateEstimate } = await import('@/lib/estimates/auto-generate')
              const estimateResult = await autoGenerateEstimate({
                supabase,
                projectId: validated.project_id,
                projectType: currentType,
                specMarkdown,
                attachmentContext,
                businessLine: classifiedBusinessLine,
                usageContext: {
                  projectId: validated.project_id,
                  actorClerkUserId: authUser.clerkUserId,
                },
              })

              await supabase
                .from('projects')
                .update({ status: 'estimating' })
                .eq('id', validated.project_id)

              // Fetch saved estimate to get market price data
              let marketPrice: number | null = null
              let ourPrice: number | null = null
              let savingsPercent: number | null = null

              const { data: savedEstimate } = await supabase
                .from('estimates')
                .select('total_market_cost, pricing_snapshot')
                .eq('id', estimateResult.estimateId)
                .maybeSingle()

              if (savedEstimate) {
                const snapshot = savedEstimate.pricing_snapshot as Record<string, unknown> | null
                if (savedEstimate.total_market_cost && snapshot && 'recommended_total_cost' in snapshot) {
                  marketPrice = savedEstimate.total_market_cost as number
                  ourPrice = snapshot.recommended_total_cost as number
                  if (marketPrice > 0 && ourPrice > 0) {
                    savingsPercent = Math.round((1 - ourPrice / marketPrice) * 100)
                  }
                }
              }

              sendEvent('estimate_generated', {
                estimate_id: estimateResult.estimateId,
                total_hours: estimateResult.totalHours,
                hourly_rate: estimateResult.hourlyRate,
                estimate_mode: estimateResult.estimateMode,
                go_no_go_decision: estimateResult.goNoGoDecision ?? null,
                market_price: marketPrice,
                our_price: ourPrice,
                savings_percent: savingsPercent,
              })

              // Value proposition is now generated inside autoGenerateEstimate
              if (classifiedBusinessLine && estimateResult.estimateId) {
                sendEvent('value_proposition_generated', {
                  estimate_id: estimateResult.estimateId,
                  business_line: classifiedBusinessLine,
                  go_no_go_decision: estimateResult.goNoGoDecision ?? null,
                })
              }
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

          const retryable = isAnthropicTransientError(error)
          const errorMessage = retryable
            ? 'AIサービスが一時的に混雑しています。しばらく待ってから再度お試しください。'
            : error instanceof Error ? error.message : 'ストリーミングエラー'
          sendEvent('error', { error: errorMessage, retryable })
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
