import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, canAccessProject } from '@/lib/auth/authorization'
import { applyRateLimitRaw } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import { z } from 'zod'

const deleteBodySchema = z.object({
  project_id: z.string().uuid(),
})

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser()

    if (!authUser) {
      return new Response(
        JSON.stringify({ success: false, error: '認証が必要です' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const rateLimited = applyRateLimitRaw(request, 'conversations:delete', RATE_LIMITS['conversations:delete'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const { id: messageId } = await params

    const body = await request.json()
    const validated = deleteBodySchema.parse(body)

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

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', messageId)
      .eq('project_id', validated.project_id)

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: 'メッセージの削除に失敗しました' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({ success: false, error: '入力データが不正です' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const message = error instanceof Error ? error.message : 'サーバーエラー'
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
