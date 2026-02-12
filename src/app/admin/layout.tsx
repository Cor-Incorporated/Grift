import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/layout/admin-sidebar'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/lib/auth/authorization'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  const user = await currentUser()
  const supabase = await createServiceRoleClient()
  const isAdmin = await isAdminUser(
    supabase,
    userId,
    user?.emailAddresses[0]?.emailAddress ?? null
  )

  if (!isAdmin) {
    redirect('/dashboard')
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar
        userEmail={user?.emailAddresses[0]?.emailAddress ?? ''}
        userName={user?.firstName ?? '管理者'}
      />
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto p-6">{children}</div>
      </main>
    </div>
  )
}
