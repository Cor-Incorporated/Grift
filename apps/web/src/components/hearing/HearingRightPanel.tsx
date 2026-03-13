import type { ChecklistMap, MissingInfoPrompt, RequirementArtifact } from '@/types/conversation'
import { CompletenessProgressBar } from './CompletenessProgressBar'
import { MissingInfoPromptList } from './MissingInfoPromptList'
import { SpecPreviewPanel } from './SpecPreviewPanel'

interface HearingRightPanelProps {
  completeness: number
  checklist: ChecklistMap
  prompts: MissingInfoPrompt[]
  artifact: RequirementArtifact | null
  isRefreshingObservations: boolean
  isRefreshingArtifact: boolean
}

export function HearingRightPanel({
  completeness,
  checklist,
  prompts,
  artifact,
  isRefreshingObservations,
  isRefreshingArtifact,
}: HearingRightPanelProps) {
  const checklistItems = Object.values(checklist)

  return (
    <aside className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <CompletenessProgressBar value={completeness} />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {checklistItems.slice(0, 4).map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
            >
              <p className="truncate text-sm font-medium text-slate-900">
                {item.label}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {item.isComplete ? 'Complete' : 'Needs follow-up'}
              </p>
            </div>
          ))}
          {checklistItems.length > 4 ? (
            <p className="text-center text-xs text-slate-500">
              + {checklistItems.length - 4} more items
            </p>
          ) : null}
          {checklistItems.length === 0 ? (
            <p className="text-pretty text-sm text-slate-600">
              Completeness scoring will appear after the assistant finishes a turn.
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <MissingInfoPromptList
          prompts={prompts}
          isRefreshing={isRefreshingObservations}
        />
      </section>

      <SpecPreviewPanel
        artifact={artifact}
        isRefreshing={isRefreshingArtifact}
      />
    </aside>
  )
}
