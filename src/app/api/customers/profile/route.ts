import { NextResponse, type NextRequest } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/utils/rate-limit'
import { RATE_LIMITS } from '@/lib/utils/rate-limit-config'

const profileSchema = z.object({
  company: z.string(),
  display_name: z.string(),
  phone: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimited = applyRateLimit(
      request,
      'customers:profile:post',
      RATE_LIMITS['customers:profile:post'],
      userId
    )
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validated = profileSchema.parse(body)

    const user = await currentUser()
    const email = user?.emailAddresses[0]?.emailAddress ?? null

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
        .select('*')
        .eq('clerk_user_id', userId)
        .maybeSingle()

    if (existingCustomerError) {
      console.error(
        'POST /api/customers/profile: failed to fetch customer by clerk_user_id',
        {
          userId,
          code: existingCustomerError.code,
          message: existingCustomerError.message,
        }
      )
      return NextResponse.json(
        { success: false, error: 'プロフィールの取得に失敗しました' },
        { status: 500 }
      )
    }

    let targetCustomer = existingCustomer

    if (!targetCustomer) {
      const { data: existingByEmail, error: existingByEmailError } =
        await supabase
          .from('customers')
          .select('*')
          .eq('email', email)
          .maybeSingle()

      if (existingByEmailError) {
        console.error(
          'POST /api/customers/profile: failed to fetch customer by email',
          {
            userId,
            email,
            code: existingByEmailError.code,
            message: existingByEmailError.message,
          }
        )
        return NextResponse.json(
          { success: false, error: 'プロフィールの取得に失敗しました' },
          { status: 500 }
        )
      }

      if (existingByEmail) {
        if (
          existingByEmail.clerk_user_id &&
          existingByEmail.clerk_user_id !== userId
        ) {
          console.error(
            'POST /api/customers/profile: clerk_user_id conflict on existing email',
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
          const { data: linkedCustomer, error: linkError } = await supabase
            .from('customers')
            .update({ clerk_user_id: userId })
            .eq('id', existingByEmail.id)
            .select('*')
            .single()

          if (linkError || !linkedCustomer) {
            console.error(
              'POST /api/customers/profile: failed to link customer by email',
              {
                userId,
                email,
                customerId: existingByEmail.id,
                code: linkError?.code,
                message: linkError?.message,
              }
            )
            return NextResponse.json(
              { success: false, error: 'プロフィールの更新に失敗しました' },
              { status: 500 }
            )
          }

          targetCustomer = linkedCustomer
        } else {
          targetCustomer = existingByEmail
        }
      }
    }

    if (targetCustomer) {
      const updateData: {
        name: string
        company: string
        phone?: string
      } = {
        name: validated.display_name,
        company: validated.company,
      }

      if (validated.phone) {
        updateData.phone = validated.phone
      }

      const { data: updatedCustomer, error: updateError } = await supabase
        .from('customers')
        .update(updateData)
        .eq('id', targetCustomer.id)
        .select('*')
        .single()

      if (updateError || !updatedCustomer) {
        console.error('POST /api/customers/profile: failed to update customer', {
          userId,
          customerId: targetCustomer.id,
          code: updateError?.code,
          message: updateError?.message,
        })
        return NextResponse.json(
          { success: false, error: 'プロフィールの更新に失敗しました' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        data: updatedCustomer,
      })
    }

    const { data: newCustomer, error: insertError } = await supabase
      .from('customers')
      .insert({
        clerk_user_id: userId,
        name: validated.display_name,
        email,
        company: validated.company,
      })
      .select('*')
      .single()

    if (insertError || !newCustomer) {
      if (insertError?.code === '23505') {
        const { data: existingByEmail, error: existingByEmailError } =
          await supabase
            .from('customers')
            .select('*')
            .eq('email', email)
            .maybeSingle()

        if (existingByEmailError || !existingByEmail) {
          console.error('POST /api/customers/profile: insert race fallback failed', {
            userId,
            email,
            insertCode: insertError?.code,
            insertMessage: insertError?.message,
            fallbackCode: existingByEmailError?.code,
            fallbackMessage: existingByEmailError?.message,
          })
          return NextResponse.json(
            { success: false, error: 'プロフィールの作成に失敗しました' },
            { status: 500 }
          )
        }

        if (
          existingByEmail.clerk_user_id &&
          existingByEmail.clerk_user_id !== userId
        ) {
          console.error(
            'POST /api/customers/profile: clerk_user_id conflict in insert fallback',
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

        const updateData: {
          clerk_user_id: string
          name: string
          company: string
          phone?: string
        } = {
          clerk_user_id: userId,
          name: validated.display_name,
          company: validated.company,
        }

        if (validated.phone) {
          updateData.phone = validated.phone
        }

        const { data: repairedCustomer, error: repairError } = await supabase
          .from('customers')
          .update(updateData)
          .eq('id', existingByEmail.id)
          .select('*')
          .single()

        if (repairError || !repairedCustomer) {
          console.error('POST /api/customers/profile: failed to repair customer', {
            userId,
            email,
            customerId: existingByEmail.id,
            code: repairError?.code,
            message: repairError?.message,
          })
          return NextResponse.json(
            { success: false, error: 'プロフィールの更新に失敗しました' },
            { status: 500 }
          )
        }

        return NextResponse.json({
          success: true,
          data: repairedCustomer,
        })
      }

      console.error('POST /api/customers/profile: failed to insert customer', {
        userId,
        email,
        code: insertError?.code,
        message: insertError?.message,
        details: insertError?.details,
      })
      return NextResponse.json(
        { success: false, error: 'プロフィールの作成に失敗しました' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: newCustomer,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: '入力データが不正です' },
        { status: 400 }
      )
    }

    console.error('POST /api/customers/profile: unexpected error', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      )
    }

    const rateLimitedGet = applyRateLimit(
      request,
      'customers:profile:get',
      RATE_LIMITS['customers:profile:get'],
      userId
    )
    if (rateLimitedGet) return rateLimitedGet

    const supabase = await createServiceRoleClient()

    const { data: customerByUserId, error: customerByUserIdError } =
      await supabase
        .from('customers')
        .select('*')
        .eq('clerk_user_id', userId)
        .maybeSingle()

    if (customerByUserIdError) {
      console.error(
        'GET /api/customers/profile: failed to fetch customer by clerk_user_id',
        {
          userId,
          code: customerByUserIdError.code,
          message: customerByUserIdError.message,
        }
      )
      return NextResponse.json(
        { success: false, error: 'プロフィールの取得に失敗しました' },
        { status: 500 }
      )
    }

    if (customerByUserId) {
      return NextResponse.json({
        success: true,
        data: customerByUserId,
      })
    }

    const user = await currentUser()
    const email = user?.emailAddresses[0]?.emailAddress ?? null

    if (!email) {
      return NextResponse.json({
        success: true,
        data: null,
      })
    }

    const { data: customerByEmail, error: customerByEmailError } = await supabase
      .from('customers')
      .select('*')
      .eq('email', email)
      .maybeSingle()

    if (customerByEmailError) {
      console.error('GET /api/customers/profile: failed to fetch customer by email', {
        userId,
        email,
        code: customerByEmailError.code,
        message: customerByEmailError.message,
      })
      return NextResponse.json(
        { success: false, error: 'プロフィールの取得に失敗しました' },
        { status: 500 }
      )
    }

    if (!customerByEmail) {
      return NextResponse.json({
        success: true,
        data: null,
      })
    }

    if (customerByEmail.clerk_user_id && customerByEmail.clerk_user_id !== userId) {
      console.error('GET /api/customers/profile: clerk_user_id conflict on existing email', {
        userId,
        email,
        existingClerkUserId: customerByEmail.clerk_user_id,
      })
      return NextResponse.json(
        { success: false, error: '顧客情報の紐付けに不整合があります' },
        { status: 409 }
      )
    }

    if (!customerByEmail.clerk_user_id) {
      const { data: linkedCustomer, error: linkError } = await supabase
        .from('customers')
        .update({ clerk_user_id: userId })
        .eq('id', customerByEmail.id)
        .select('*')
        .single()

      if (linkError || !linkedCustomer) {
        console.error('GET /api/customers/profile: failed to link customer by email', {
          userId,
          email,
          customerId: customerByEmail.id,
          code: linkError?.code,
          message: linkError?.message,
        })
        return NextResponse.json(
          { success: false, error: 'プロフィールの取得に失敗しました' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        data: linkedCustomer,
      })
    }

    return NextResponse.json({
      success: true,
      data: customerByEmail,
    })
  } catch (error) {
    console.error('GET /api/customers/profile: unexpected error', error)
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
