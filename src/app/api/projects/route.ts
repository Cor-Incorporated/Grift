import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createProjectSchema, customerSchema } from '@/lib/utils/validation'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { customer, project } = body

    const validatedCustomer = customerSchema.parse(customer)
    const validatedProject = createProjectSchema.omit({ customer_id: true }).parse(project)

    const supabase = await createServiceRoleClient()

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', validatedCustomer.email)
      .single()

    let customerId: string

    if (existingCustomer) {
      customerId = existingCustomer.id
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert(validatedCustomer)
        .select('id')
        .single()

      if (customerError || !newCustomer) {
        return NextResponse.json(
          { success: false, error: '顧客の登録に失敗しました' },
          { status: 500 }
        )
      }
      customerId = newCustomer.id
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
      return NextResponse.json(
        { success: false, error: '案件の作成に失敗しました' },
        { status: 500 }
      )
    }

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
    return NextResponse.json(
      { success: false, error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
