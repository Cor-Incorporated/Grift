import { Link, useParams } from 'react-router-dom'
import { ApprovalActions } from '@/components/estimate/ApprovalActions'
import { StatusBadge } from '@/components/estimate/StatusBadge'
import { ThreeWayProposalView } from '@/components/estimate/ThreeWayProposalView'
import { useEstimate, useThreeWayProposal } from '@/hooks/use-estimates'
import { formatDateTime } from '@/lib/api-client'
import {
  estimateModeLabels,
  formatEstimateCurrency,
  formatEstimateHours,
  formatEstimateNumber,
  formatEstimateRatio,
} from '@/types/estimate'

function RiskFlags({ flags }: { flags: string[] }) {
  if (flags.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">Risk flags</p>
      <ul className="space-y-1">
        {flags.map((flag) => (
          <li
            key={flag}
            className="text-sm text-amber-700"
          >
            <span className="mr-1.5 text-amber-500">&#x26A0;</span>
            {flag}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function EstimateDetail() {
  const { caseId, estimateId } = useParams<{
    caseId: string
    estimateId: string
  }>()
  const { estimate, isLoading: loading, error, refresh } = useEstimate(caseId, estimateId)
  const {
    proposal,
    isLoading: proposalLoading,
    error: proposalError,
  } = useThreeWayProposal(caseId, estimateId)

  if (!caseId || !estimateId) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 text-slate-500 shadow-sm">
        <p>Missing case or estimate ID.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <main className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Loading estimate...</p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">
          Estimate detail
        </h1>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
        <Link
          to={`/cases/${caseId}/estimates`}
          className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
        >
          Back to estimates
        </Link>
      </main>
    )
  }

  if (!estimate) {
    return (
      <main className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-950">
          Estimate detail
        </h1>
        <p className="text-sm text-slate-600">
          This estimate could not be found.
        </p>
        <Link
          to={`/cases/${caseId}/estimates`}
          className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
        >
          Back to estimates
        </Link>
      </main>
    )
  }

  const riskFlags = estimate.risk_flags ?? []
  const resolvedProposal = proposal ?? estimate.three_way_proposal ?? null

  return (
    <main className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Link
              to={`/cases/${caseId}/estimates`}
              className="inline-flex text-sm text-slate-500 hover:text-slate-700"
            >
              &larr; Back to estimates
            </Link>
            <p className="text-sm font-medium text-slate-500">
              Estimate detail
            </p>
            <h1 className="text-balance text-3xl font-semibold text-slate-950">
              {estimateModeLabels[estimate.estimate_mode]}
            </h1>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={estimate.status} />
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                {estimate.id}
              </span>
            </div>
          </div>

          <Link
            to={`/cases/${caseId}/estimates`}
            className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-950"
          >
            Back to list
          </Link>
        </div>
      </header>

      {/* Summary cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Your hours</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">
            {formatEstimateHours(estimate.your_estimated_hours)}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Your cost</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">
            {formatEstimateCurrency(estimate.total_your_cost)}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Market cost</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">
            {formatEstimateCurrency(estimate.total_market_cost)}
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            Calibration ratio
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">
            {formatEstimateRatio(estimate.calibration_ratio)}
          </p>
        </article>
      </section>

      {/* Hours breakdown */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Hours breakdown
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm text-slate-500">Investigation</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-slate-900">
              {formatEstimateHours(estimate.hours_investigation)}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Implementation</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-slate-900">
              {formatEstimateHours(estimate.hours_implementation)}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Testing</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-slate-900">
              {formatEstimateHours(estimate.hours_testing)}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Buffer</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-slate-900">
              {formatEstimateHours(estimate.hours_buffer)}
            </p>
          </div>
        </div>
      </section>

      {/* Market comparison */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Market comparison
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-slate-500">Market hourly rate</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-slate-900">
              {formatEstimateCurrency(estimate.market_hourly_rate)}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Market estimated hours</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-slate-900">
              {formatEstimateHours(estimate.market_estimated_hours)}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Total market cost</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-slate-900">
              {formatEstimateCurrency(estimate.total_market_cost)}
            </p>
          </div>
        </div>
      </section>

      {/* Risk flags */}
      {riskFlags.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <RiskFlags flags={riskFlags} />
        </section>
      ) : null}

      {/* Metadata */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Details</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-slate-500">Hourly rate</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums text-slate-900">
              {formatEstimateCurrency(estimate.your_hourly_rate)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Created</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums text-slate-900">
              {formatDateTime(estimate.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Total your hours</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums text-slate-900">
              {formatEstimateNumber(estimate.your_estimated_hours)}
            </dd>
          </div>
          {estimate.aggregated_evidence_id ? (
            <div>
              <dt className="text-sm text-slate-500">Evidence ID</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums text-slate-900">
                {estimate.aggregated_evidence_id}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Three-way proposal */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Three-way proposal comparison
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Internal track record, market evidence, and the recommended proposal.
          </p>
        </div>

        {proposalError && !resolvedProposal ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {proposalError}
          </p>
        ) : null}

        {proposalLoading && !resolvedProposal ? (
          <p className="text-sm text-slate-500">Loading three-way proposal...</p>
        ) : resolvedProposal ? (
          <ThreeWayProposalView proposal={resolvedProposal} />
        ) : (
          <p className="text-sm text-slate-500">
            Three-way proposal data is not available for this estimate yet.
          </p>
        )}
      </section>

      {/* Approval actions */}
      {estimate.status === 'ready' ? (
        <ApprovalActions caseId={caseId} estimateId={estimateId} onDecision={() => void refresh()} />
      ) : null}
    </main>
  )
}
