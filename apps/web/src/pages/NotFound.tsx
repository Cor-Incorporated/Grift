import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <main className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-medium text-slate-500">404</p>
      <h1 className="mt-2 text-balance text-3xl font-semibold text-slate-950">
        Page not found
      </h1>
      <p className="mt-3 text-pretty text-sm text-slate-600">
        The page you requested does not exist or has moved. Return to the
        dashboard to continue working.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
      >
        Back to Dashboard
      </Link>
    </main>
  )
}
