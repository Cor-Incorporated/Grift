import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, getInternalRoles } from '@/lib/auth/authorization'
import { syncEstimateToLinear } from '@/lib/linear/sync'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'
import { z } from 'zod'

const syncRequestSchema = z.object({
  estimate_id: z.string().uuid(),
  project_id: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthenticatedUser()
    if (!authUser) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(request, 'admin:linear:sync:post', RATE_LIMITS['admin:linear:sync:post'], authUser.clerkUserId)
    if (rateLimited) return rateLimited

    const supabase = await createServiceRoleClient()

    const internalRoles = await getInternalRoles(
      supabase,
      authUser.clerkUserId,
      authUser.email
    )
    if (!internalRoles.has('admin')) {
      return NextResponse.json(
        { success: false, error: '管理者権限が必要です' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validated = syncRequestSchema.parse(body)

    // Fetch estimate with pricing_snapshot
    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .select('id, project_id, pricing_snapshot, your_estimated_hours')
      .eq('id', validated.estimate_id)
      .single()

    if (estimateError || !estimate) {
      return NextResponse.json(
        { success: false, error: '見積りが見つかりません' },
        { status: 404 }
      )
    }

    // Fetch project name
    const { data: project } = await supabase
      .from('projects')
      .select('title')
      .eq('id', validated.project_id)
      .single()

    // Extract modules from pricing_snapshot
    const snapshot = estimate.pricing_snapshot as {
      implementation_plan?: {
        modules?: Array<{
          name: string
          estimatedHours: number
          phase?: string
          riskLevel?: string
          description?: string
        }>
        phases?: Array<{
          name: string
          modules: string[]
          durationWeeks: number
        }>
      }
    } | null

    const modules = (snapshot?.implementation_plan?.modules ?? []).map((m) => ({
      name: m.name,
      hours: m.estimatedHours,
      phase: m.phase,
      riskLevel: m.riskLevel as 'low' | 'medium' | 'high' | undefined,
      description: m.description,
    }))

    // If no modules from implementation plan, create a single issue
    const finalModules = modules.length > 0
      ? modules
      : [{
          name: project?.title ?? '実装タスク',
          hours: estimate.your_estimated_hours,
        }]

    const result = await syncEstimateToLinear({
      supabase,
      estimateId: validated.estimate_id,
      projectId: validated.project_id,
      projectName: project?.title ?? `プロジェクト ${validated.project_id.slice(0, 8)}`,
      modules: finalModules,
      phases: snapshot?.implementation_plan?.phases,
      actorClerkUserId: authUser.clerkUserId,
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: '入力データが不正です' },
        { status: 400 }
      )
    }

    const message = error instanceof Error ? error.message : 'Linear同期に失敗しました'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
