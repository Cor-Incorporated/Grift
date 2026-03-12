import { type ChangeEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  apiClient,
  caseStatusLabels,
  caseStatusOptions,
  caseTypeLabels,
  caseTypeOptions,
  DEFAULT_TENANT_ID,
  formatDateTime,
  getApiErrorMessage,
  type CaseRecord,
  type CaseStatus,
  type CaseType,
} from '@/lib/api-client'

const PAGE_SIZE = 20

function parsePositiveInt(value: string | null) {
  if (!value) {
    return 1
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function parseCaseStatus(value: string | null): CaseStatus | undefined {
  return caseStatusOptions.find((option) => option === value)
}

function parseCaseType(value: string | null): CaseType | undefined {
  return caseTypeOptions.find((option) => option === value)
}

export function CaseList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const page = parsePositiveInt(searchParams.get('page'))
  const selectedStatus = parseCaseStatus(searchParams.get('status'))
  const selectedType = parseCaseType(searchParams.get('type'))
  const offset = (page - 1) * PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages

  useEffect(() => {
    let isCancelled = false

    async function loadCases() {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const { data, error } = await apiClient.GET('/v1/cases', {
          params: {
            header: { 'X-Tenant-ID': DEFAULT_TENANT_ID },
            query: {
              limit: PAGE_SIZE,
              offset,
              ...(selectedStatus ? { status: selectedStatus } : {}),
              ...(selectedType ? { type: selectedType } : {}),
            },
          },
        })

        if (isCancelled) {
          return
        }

        if (error) {
          setCases([])
          setTotal(0)
          setErrorMessage(getApiErrorMessage(error, 'Unable to load cases.'))
          setIsLoading(false)
          return
        }

        setCases(data?.data ?? [])
        setTotal(data?.total ?? 0)
      } catch (error) {
        if (isCancelled) {
          return
        }

        setCases([])
        setTotal(0)
        setErrorMessage(getApiErrorMessage(error, 'Unable to load cases.'))
      }

      setIsLoading(false)
    }

    void loadCases()

    return () => {
      isCancelled = true
    }
  }, [offset, selectedStatus, selectedType])

  function updateSearchParams(updates: Record<string, string | undefined>) {
    const nextParams = new URLSearchParams(searchParams)

    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        nextParams.set(key, value)
      } else {
        nextParams.delete(key)
      }
    })

    setSearchParams(nextParams)
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    updateSearchParams({
      status: event.target.value || undefined,
      page: '1',
    })
  }

  function handleTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    updateSearchParams({
      type: event.target.value || undefined,
      page: '1',
    })
  }

  function goToPage(nextPage: number) {
    updateSearchParams({ page: String(nextPage) })
  }

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-500">Cases</p>
          <h1 className="text-balance text-3xl font-semibold text-slate-950">
            Case management
          </h1>
          <p className="max-w-2xl text-pretty text-sm text-slate-600">
            Track intake opportunities, filter the pipeline, and open case
            details to review conversation history.
          </p>
        </div>

        <Link
          to="/cases/new"
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          New case
        </Link>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Status</span>
            <select
              aria-label="Status filter"
              value={selectedStatus ?? ''}
              onChange={handleStatusChange}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">All statuses</option>
              {caseStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {caseStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Type</span>
            <select
              aria-label="Type filter"
              value={selectedType ?? ''}
              onChange={handleTypeChange}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">All types</option>
              {caseTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {caseTypeLabels[type]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Case list</h2>
            <p className="mt-1 text-sm text-slate-500">
              <span className="tabular-nums">{total}</span> total cases
            </p>
          </div>
          <p className="text-sm text-slate-500">
            Page <span className="tabular-nums">{page}</span> of{' '}
            <span className="tabular-nums">{totalPages}</span>
          </p>
        </div>

        {errorMessage ? (
          <div className="border-b border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="px-6 py-12 text-sm text-slate-500">Loading cases...</div>
        ) : cases.length === 0 ? (
          <div className="px-6 py-12">
            <h3 className="text-lg font-semibold text-slate-950">
              No cases found
            </h3>
            <p className="mt-2 max-w-xl text-pretty text-sm text-slate-600">
              Adjust the filters or create a new case to start intake work.
            </p>
            <Link
              to="/cases/new"
              className="mt-5 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              Create a case
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase text-slate-500">
                  <th className="px-6 py-3">Title</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {cases.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <Link
                        to={`/cases/${item.id}`}
                        className="font-medium text-slate-900 transition-colors hover:text-slate-700"
                      >
                        {item.title}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500 tabular-nums">
                        {item.id}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {caseTypeLabels[item.type]}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {caseStatusLabels[item.status]}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 tabular-nums">
                      {formatDateTime(item.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={!canGoPrevious}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={!canGoNext}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </section>
    </main>
  )
}
