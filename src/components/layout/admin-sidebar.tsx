'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { User } from '@supabase/supabase-js'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/admin', label: 'ダッシュボード', icon: '📊' },
  { href: '/admin/projects', label: '案件一覧', icon: '📋' },
  { href: '/admin/estimates', label: '見積り', icon: '💰' },
  { href: '/admin/github', label: 'GitHub連携', icon: '🔗' },
  { href: '/admin/settings', label: '設定', icon: '⚙️' },
]

export function AdminSidebar({ user }: { user: User }) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="flex w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <span className="text-xl">🎩</span>
        <span className="font-bold">BD Admin</span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                pathname === item.href
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          </Link>
        ))}
      </nav>

      <Separator />

      <div className="p-4">
        <p className="mb-2 truncate text-xs text-muted-foreground">
          {user.email}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleLogout}
        >
          ログアウト
        </Button>
      </div>
    </aside>
  )
}
