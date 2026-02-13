import { NextResponse, type NextRequest } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createProjectSchema } from '@/lib/utils/validation'
import { writeAuditLog } from '@/lib/audit/log'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedProject = createProjectSchema
      .omit({ customer_id: true })
      .parse(body.project ?? {})

    const user = await currentUser()
    const email = user?.emailAddresses[0]?.emailAddress ?? null
    const name =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Unknown'

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'ユーザーのメール情報が取得できません' },
        { status: 500 }
      )
    }

    const supabase = await createServiceRoleClient()

    const { data: existingCustomer, error: existingCustomerError } =
      await supabase
        .from('customers')
        .select('id, clerk_user_id, email')
        .eq('clerk_user_id', userId)
        .maybeSingle()

    if (existingCustomerError) {
      console.error('POST /api/projects: failed to fetch customer by clerk_user_id', {
        userId,
        code: existingCustomerError.code,
        message: existingCustomerError.message,
      })
      return NextResponse.json(
        { success: false, error: '顧客情報の取得に失敗しました' },
        { status: 500 }
      )
    }

    let customerId: string | null = existingCustomer?.id ?? null

    if (!customerId) {
      const { data: existingByEmail, error: existingByEmailError } =
        await supabase
          .from('customers')
          .select('id, clerk_user_id, email')
          .eq('email', email)
          .maybeSingle()

      if (existingByEmailError) {
        console.error('POST /api/projects: failed to fetch customer by email', {
          userId,
          email,
          code: existingByEmailError.code,
          message: existingByEmailError.message,
        })
        return NextResponse.json(
          { success: false, error: '顧客情報の取得に失敗しました' },
          { status: 500 }
        )
      }

      if (existingByEmail) {
        if (
          existingByEmail.clerk_user_id &&
          existingByEmail.clerk_user_id !== userId
        ) {
          console.error(
            'POST /api/projects: clerk_user_id conflict on existing email',
            {
              userId,
              email,
              existingClerkUserId: existingByEmail.clerk_user_id,
            }
          )
          return NextResponse.json(
            { success: false, error: '顧客情報の紐付けに不整合があります' },
            { status: 409 }
          )
        }

        if (!existingByEmail.clerk_user_id) {
          const { error: linkError } = await supabase
            .from('customers')
            .update({ clerk_user_id: userId })
            .eq('id', existingByEmail.id)

          if (linkError) {
            console.error('POST /api/projects: failed to link customer by email', {
              userId,
              email,
              customerId: existingByEmail.id,
              code: linkError.code,
              message: linkError.message,
            })
            return NextResponse.json(
              { success: false, error: '顧客情報の更新に失敗しました' },
              { status: 500 }
            )
          }
        }

        customerId = existingByEmail.id
      }
    }

    if (!customerId) {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          clerk_user_id: userId,
          name,
          email,
          company: body.company ?? null,
        })
        .select('id')
        .single()

      if (customerError || !newCustomer) {
        if (customerError?.code === '23505') {
          const { data: existingByEmail, error: existingByEmailError } =
            await supabase
              .from('customers')
              .select('id, clerk_user_id')
              .eq('email', email)
              .maybeSingle()

          if (existingByEmailError || !existingByEmail) {
            console.error('POST /api/projects: insert race fallback failed', {
              userId,
              email,
              customerErrorCode: customerError?.code,
              customerErrorMessage: customerError?.message,
              fallbackCode: existingByEmailError?.code,
              fallbackMessage: existingByEmailError?.message,
            })
            return NextResponse.json(
              { success: false, error: '顧客の登録に失敗しました' },
              { status: 500 }
            )
          }

          if (
            existingByEmail.clerk_user_id &&
            existingByEmail.clerk_user_id !== userId
          ) {
            console.error(
              'POST /api/projects: clerk_user_id conflict in insert fallback',
              {
                userId,
                email,
                existingClerkUserId: existingByEmail.clerk_user_id,
              }
            )
            return NextResponse.json(
              { success: false, error: '顧客情報の紐付けに不整合があります' },
              { status: 409 }
            )
          }

          if (!existingByEmail.clerk_user_id) {
            const { error: linkError } = await supabase
              .from('customers')
              .update({ clerk_user_id: userId })
              .eq('id', existingByEmail.id)

            if (linkError) {
              console.error('POST /api/projects: fallback link failed', {
                userId,
                email,
                customerId: existingByEmail.id,
                code: linkError.code,
                message: linkError.message,
              })
              return NextResponse.json(
                { success: false, error: '顧客情報の更新に失敗しました' },
                { status: 500 }
              )
            }
          }

          customerId = existingByEmail.id
        } else {
          console.error('POST /api/projects: failed to insert customer', {
            userId,
            email,
            code: customerError?.code,
            message: customerError?.message,
            details: customerError?.details,
          })
          return NextResponse.json(
            { success: false, error: '顧客の登録に失敗しました' },
            { status: 500 }
          )
        }
      } else {
        customerId = newCustomer.id
      }
    }

    if (!customerId) {
      console.error('POST /api/projects: customerId resolution failed', {
        userId,
        email,
      })
      return NextResponse.json(
        { success: false, error: '顧客情報の解決に失敗しました' },
        { status: 500 }
      )
    }

    const { data: newProject, error: projectError } = await supabase
      .from('projects')
      .insert({
        ...validatedProject,
        customer_id: customerId,
        status: 'interviewing',
      })
      .select()
      .single()

    if (projectError || !newProject) {
      console.error('POST /api/projects: failed to insert project', {
        userId,
        customerId,
        code: projectError?.code,
        message: projectError?.message,
        details: projectError?.details,
      })
      return NextResponse.json(
        { success: false, error: '案件の作成に失敗しました' },
        { status: 500 }
      )
    }

    await writeAuditLog(supabase, {
      actorClerkUserId: userId,
      action: 'project.create',
      resourceType: 'project',
      resourceId: newProject.id,
      projectId: newProject.id,
      payload: {
        projectType: newProject.type,
        customerId,
      },
    })

    return NextResponse.json({
      success: true,
      data: { project: newProject, customer_id: customerId },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        { success: false, error: '入力データが不正です' },
        { status: 400 }
      )
    }

    console.error('POST /api/projects: unexpected error', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
