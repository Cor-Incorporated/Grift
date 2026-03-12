import { Link } from 'react-router-dom'

export function Dashboard() {
  return (
    <main className="space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-medium text-slate-500">Dashboard</p>
        <h1 className="text-balance text-3xl font-semibold text-slate-950">
          BenevolentDirector v2 Dashboard
        </h1>
        <p className="max-w-3xl text-pretty text-sm text-slate-600">
          Intake cases now live in the web client. Review active work, start a
          new case, and move into detail views from a single workspace.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Cases</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            Manage intake work
          </h2>
          <p className="mt-3 text-pretty text-sm text-slate-600">
            Filter cases by status or type, then drill into conversation
            history for each opportunity.
          </p>
          <Link
            to="/cases"
            className="mt-5 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            Open case list
          </Link>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">New intake</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            Start a case
          </h2>
          <p className="mt-3 text-pretty text-sm text-slate-600">
            Create a case with the minimum required context, then continue the
            discovery process in the detail screen.
          </p>
          <Link
            to="/cases/new"
            className="mt-5 inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
          >
            Create case
          </Link>
        </article>
      </section>
    </main>
  )
}
