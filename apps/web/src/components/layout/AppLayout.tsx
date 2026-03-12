import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/cn'

const navigationItems: { to: string; label: string; end: boolean }[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/cases', label: 'Cases', end: false },
]

export function AppLayout() {
  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-dvh max-w-7xl flex-col md:flex-row">
        <aside className="border-b border-slate-200 bg-white p-6 md:w-72 md:border-b-0 md:border-r">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-500">
              BenevolentDirector
            </p>
            <h1 className="text-balance text-2xl font-semibold text-slate-950">
              Intake workspace
            </h1>
            <p className="text-pretty text-sm text-slate-600">
              Manage cases, review intake progress, and keep delivery context in
              one place.
            </p>
          </div>

          <nav className="mt-8 space-y-2" aria-label="Primary">
            {navigationItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center rounded-xl px-4 py-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex-1">
          <main className="p-6 md:p-10">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
