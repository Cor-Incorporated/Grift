'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SignOutButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { InternalRole } from '@/types/database'

const navItems = [
  {
    href: '/admin',
    label: 'ダッシュボード',
    icon: '📊',
    roles: ['admin', 'sales', 'dev'] as InternalRole[],
  },
  {
    href: '/admin/projects',
    label: '案件一覧',
    icon: '📋',
    roles: ['admin', 'sales', 'dev'] as InternalRole[],
  },
  {
    href: '/admin/intake',
    label: 'Intake',
    icon: '🧭',
    roles: ['admin', 'sales', 'dev'] as InternalRole[],
  },
  {
    href: '/admin/execution-tasks',
    label: '実行タスク',
    icon: '🛠️',
    roles: ['admin', 'sales', 'dev'] as InternalRole[],
  },
  {
    href: '/admin/estimates',
    label: '見積り',
    icon: '💰',
    roles: ['admin', 'sales'] as InternalRole[],
  },
  {
    href: '/admin/approvals',
    label: '承認キュー',
    icon: '✅',
    roles: ['admin', 'sales', 'dev'] as InternalRole[],
  },
  {
    href: '/admin/pricing',
    label: '価格ポリシー',
    icon: '📈',
    roles: ['admin', 'sales'] as InternalRole[],
  },
  {
    href: '/admin/github',
    label: 'GitHub連携',
    icon: '🔗',
    roles: ['admin', 'dev'] as InternalRole[],
  },
  {
    href: '/admin/settings',
    label: '設定',
    icon: '⚙️',
    roles: ['admin'] as InternalRole[],
  },
]

interface AdminSidebarProps {
  userEmail: string
  userName: string
  internalRoles: InternalRole[]
}

export function AdminSidebar({ userEmail, userName, internalRoles }: AdminSidebarProps) {
  const pathname = usePathname()
  const roleSet = new Set(internalRoles)
  const canView = (roles: InternalRole[]) => roles.some((role) => roleSet.has(role))

  return (
    <aside className="flex w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <span className="text-xl">🎩</span>
        <span className="font-bold">BD Admin</span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navItems
          .filter((item) => canView(item.roles))
          .map((item) => (
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
        <p className="mb-1 truncate text-sm font-medium">{userName}</p>
        <p className="mb-3 truncate text-xs text-muted-foreground">
          {userEmail}
        </p>
        <SignOutButton redirectUrl="/">
          <Button variant="outline" size="sm" className="w-full">
            ログアウト
          </Button>
        </SignOutButton>
      </div>
    </aside>
  )
}
