import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  apiClient,
  caseStatusLabels,
  caseTypeLabels,
  DEFAULT_TENANT_ID,
  formatDateTime,
  getApiErrorMessage,
  type CaseDetailRecord,
} from '@/lib/api-client'
import { ChatPanel } from '@/components/chat/ChatPanel'

export function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>()
  const [caseDetail, setCaseDetail] = useState<CaseDetailRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!caseId) {
      setErrorMessage('Case id is missing from the route.')
      setIsLoading(false)
      return
    }

    let isCancelled = false

    async function loadCase() {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const { data, error } = await apiClient.GET('/v1/cases/{caseId}', {
          params: {
            header: { 'X-Tenant-ID': DEFAULT_TENANT_ID },
            path: { caseId: caseId! },
          },
        })

        if (isCancelled) {
          return
        }

        if (error) {
          setCaseDetail(null)
          setErrorMessage(getApiErrorMessage(error, 'Unable to load case.'))
          setIsLoading(false)
          return
        }

        setCaseDetail(data?.data ?? null)
      } catch (error) {
        if (isCancelled) {
          return
        }

        setCaseDetail(null)
        setErrorMessage(getApiErrorMessage(error, 'Unable to load case.'))
      }

      setIsLoading(false)
    }

    void loadCase()

    return () => {
      isCancelled = true
    }
  }, [caseId])

  if (isLoading) {
    return (
      <main className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Loading case...</p>
      </main>
    )
  }

  if (errorMessage) {
    return (
      <main className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Case detail</h1>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </p>
        <Link
          to="/cases"
          className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
        >
          Back to cases
        </Link>
      </main>
    )
  }

  if (!caseDetail) {
    return (
      <main className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">Case detail</h1>
        <p className="text-sm text-slate-600">This case could not be found.</p>
        <Link
          to="/cases"
          className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
        >
          Back to cases
        </Link>
      </main>
    )
  }

  const conversations = caseDetail.conversations ?? []
  const estimates = caseDetail.estimates ?? []
  const sourceDocuments = caseDetail.source_documents ?? []

  return (
    <main className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-500">Case detail</p>
            <h1 className="text-balance text-3xl font-semibold text-slate-950">
              {caseDetail.title}
            </h1>
            <div className="flex flex-wrap gap-2 text-sm text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {caseTypeLabels[caseDetail.type]}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {caseStatusLabels[caseDetail.status]}
              </span>
              {caseDetail.priority ? (
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  Priority: {caseDetail.priority}
                </span>
              ) : null}
            </div>
          </div>

          <Link
            to="/cases"
            className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
          >
            Back to cases
          </Link>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Created</p>
          <p className="mt-2 text-lg font-semibold text-slate-950 tabular-nums">
            {formatDateTime(caseDetail.created_at)}
          </p>
          <p className="mt-2 text-sm text-slate-600 tabular-nums">
            Updated: {formatDateTime(caseDetail.updated_at)}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Conversations</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950 tabular-nums">
            {conversations.length}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Messages captured during intake discovery.
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Artifacts</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950 tabular-nums">
            {sourceDocuments.length + estimates.length}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {sourceDocuments.length} source docs and {estimates.length}{' '}
            estimates linked to this case.
          </p>
        </article>
      </section>

      <ChatPanel caseId={caseId!} initialMessages={conversations} />
    </main>
  )
}
