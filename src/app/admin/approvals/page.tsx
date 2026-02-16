import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getInternalRoles } from '@/lib/auth/authorization'
import { ApprovalQueue } from '@/components/admin/approval-queue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ApprovalRequest } from '@/types/database'

export default async function AdminApprovalsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect('/sign-in')
  }

  const user = await currentUser()
  const email = user?.emailAddresses[0]?.emailAddress ?? null
  const supabase = await createServiceRoleClient()
  const internalRoles = await getInternalRoles(supabase, userId, email)

  if (internalRoles.size === 0) {
    redirect('/dashboard')
  }

  let query = supabase
    .from('approval_requests')
    .select('*')
    .order('requested_at', { ascending: false })

  if (!internalRoles.has('admin')) {
    query = query.in('required_role', Array.from(internalRoles))
  }

  const { data } = await query
  const requests = (data ?? []) as ApprovalRequest[]
  const pendingCount = requests.filter((item) => item.status === 'pending').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">承認キュー</h1>
        <p className="text-muted-foreground">
          required_role に基づく承認待ちリクエストを処理します
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">未処理</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">
            {pendingCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">全件</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">
            {requests.length}
          </CardContent>
        </Card>
      </div>

      <ApprovalQueue
        requests={requests}
        internalRoles={Array.from(internalRoles)}
      />
    </div>
  )
}
