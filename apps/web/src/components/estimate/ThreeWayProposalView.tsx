import { ConfidenceBadge } from '@/components/estimate/ConfidenceBadge'
import { CitationList } from '@/components/estimate/CitationList'
import type { ThreeWayProposal } from '@/types/estimate'
import {
  formatEstimateCurrency,
  formatEstimateHours,
  formatEstimateNumber,
  formatEstimatePercent,
  formatEstimateRange,
} from '@/types/estimate'

interface ThreeWayProposalViewProps {
  proposal: ThreeWayProposal
}

function ContradictionBanner({
  contradictions,
}: {
  contradictions: Array<{ description?: string }>
}) {
  if (contradictions.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-800">
        Contradictions detected in market data
      </p>
      <ul className="mt-2 space-y-1">
        {contradictions.map((c, i) => (
          <li key={String(i)} className="text-sm text-amber-700">
            {c.description ?? 'Unspecified contradiction'}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProposalHelpText() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-sm text-slate-600">
        We recommend reviewing proposals with your team before approval.
      </p>
    </div>
  )
}

function SimilarProjectsTable({
  projects,
}: {
  projects: Array<{ name?: string; actual_hours?: number; similarity_score?: number }>
}) {
  if (projects.length === 0) {
    return <p className="text-sm text-slate-500">No similar projects found.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-semibold uppercase text-slate-500">
            <th className="px-3 py-2">Project</th>
            <th className="px-3 py-2">Hours</th>
            <th className="px-3 py-2">Similarity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {projects.map((project, index) => (
            <tr key={`${project.name ?? 'project'}-${String(index)}`}>
              <td className="px-3 py-2 text-slate-900">
                {project.name ?? 'Unnamed'}
              </td>
              <td className="px-3 py-2 tabular-nums text-slate-600">
                {formatEstimateHours(project.actual_hours)}
              </td>
              <td className="px-3 py-2 tabular-nums text-slate-600">
                {formatEstimatePercent(
                  typeof project.similarity_score === 'number'
                    ? project.similarity_score * 100
                    : undefined,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ThreeWayProposalView({ proposal }: ThreeWayProposalViewProps) {
  const trackRecord = proposal.our_track_record
  const benchmark = proposal.market_benchmark
  const ourProposal = proposal.our_proposal
  const contradictions = benchmark?.contradictions ?? []

  return (
    <div className="space-y-4">
      {contradictions.length > 0 ? (
        <ContradictionBanner contradictions={contradictions} />
      ) : null}

      <ProposalHelpText />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Column 1: Track Record */}
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">
            自社実績
          </h3>

          <SimilarProjectsTable
            projects={trackRecord?.similar_projects ?? []}
          />

          <dl className="space-y-2">
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Median hours</dt>
              <dd className="text-sm font-medium tabular-nums text-slate-900">
                {formatEstimateHours(trackRecord?.median_hours)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Velocity score</dt>
              <dd className="text-sm font-medium tabular-nums text-slate-900">
                {formatEstimateNumber(trackRecord?.velocity_score)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Column 2: Market Benchmark */}
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-950">
              市場ベンチマーク
            </h3>
            {benchmark?.confidence ? (
              <ConfidenceBadge level={benchmark.confidence} />
            ) : null}
          </div>

          <dl className="space-y-2">
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Consensus hours</dt>
              <dd className="text-sm font-medium tabular-nums text-slate-900">
                {formatEstimateRange(benchmark?.consensus_hours, formatEstimateHours)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Consensus rate</dt>
              <dd className="text-sm font-medium tabular-nums text-slate-900">
                {formatEstimateRange(benchmark?.consensus_rate, formatEstimateCurrency)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Provider count</dt>
              <dd className="text-sm font-medium tabular-nums text-slate-900">
                {formatEstimateNumber(benchmark?.provider_count)}
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Citations</p>
            <CitationList citations={benchmark?.citations ?? []} />
          </div>
        </section>

        {/* Column 3: Our Proposal */}
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">
            当社提案
          </h3>

          <dl className="space-y-2">
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Proposed hours</dt>
              <dd className="text-sm font-medium tabular-nums text-slate-900">
                {formatEstimateHours(ourProposal?.proposed_hours)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Proposed rate</dt>
              <dd className="text-sm font-medium tabular-nums text-slate-900">
                {formatEstimateCurrency(ourProposal?.proposed_rate)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Proposed total</dt>
              <dd className="text-sm font-semibold tabular-nums text-slate-900">
                {formatEstimateCurrency(ourProposal?.proposed_total)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-slate-500">Savings vs market</dt>
              <dd className="text-sm font-medium tabular-nums text-emerald-700">
                {formatEstimatePercent(ourProposal?.savings_vs_market_percent)}
              </dd>
            </div>
          </dl>

          {ourProposal?.competitive_advantages &&
          ourProposal.competitive_advantages.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">
                Competitive advantages
              </p>
              <ul className="space-y-1">
                {ourProposal.competitive_advantages.map((advantage) => (
                  <li
                    key={advantage}
                    className="text-sm text-slate-600"
                  >
                    <span className="mr-1.5 text-emerald-500">&#x2022;</span>
                    {advantage}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {ourProposal?.calibration_note ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium text-slate-500">
                Calibration note
              </p>
              <p className="mt-1 text-sm text-slate-700">
                {ourProposal.calibration_note}
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
