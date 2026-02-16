import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createLinearProject,
  createLinearCycle,
  createLinearIssue,
  getDefaultTeamId,
} from './client'
import { writeAuditLog } from '@/lib/audit/log'

interface ModuleEstimate {
  name: string
  hours: number
  phase?: string
  riskLevel?: 'low' | 'medium' | 'high'
  description?: string
}

interface ImplementationPhase {
  name: string
  modules: string[]
  durationWeeks: number
}

interface SyncEstimateInput {
  supabase: SupabaseClient
  estimateId: string
  projectId: string
  projectName: string
  modules: ModuleEstimate[]
  phases?: ImplementationPhase[]
  actorClerkUserId?: string | null
}

interface SyncEstimateResult {
  linearProjectId: string
  linearProjectUrl: string
  issueCount: number
  cycleCount: number
}

function mapRiskLevelToPriority(riskLevel?: string): number {
  switch (riskLevel) {
    case 'high':
      return 1 // Urgent
    case 'medium':
      return 2 // High
    case 'low':
      return 3 // Normal
    default:
      return 3
  }
}

function buildIssueDescription(module: ModuleEstimate): string {
  const lines: string[] = []

  if (module.description) {
    lines.push(module.description)
    lines.push('')
  }

  lines.push('## 見積り情報')
  lines.push(`- **工数**: ${module.hours}h`)

  if (module.phase) {
    lines.push(`- **フェーズ**: ${module.phase}`)
  }

  if (module.riskLevel) {
    lines.push(`- **リスクレベル**: ${module.riskLevel}`)
  }

  return lines.join('\n')
}

export async function syncEstimateToLinear(
  input: SyncEstimateInput
): Promise<SyncEstimateResult> {
  const { supabase, estimateId, projectId, projectName, modules, phases, actorClerkUserId } = input

  const teamId = getDefaultTeamId()

  // 1. Set sync status to 'syncing'
  await supabase
    .from('estimates')
    .update({ linear_sync_status: 'syncing' })
    .eq('id', estimateId)

  try {
    // 2. Create Linear Project
    const linearProject = await createLinearProject({
      name: projectName,
      description: `BenevolentDirector 見積り: ${estimateId}`,
      teamIds: [teamId],
    })

    // 3. Create Cycles from phases (if available)
    const cycleMap = new Map<string, string>()
    if (phases && phases.length > 0) {
      let startDate = new Date()
      for (const phase of phases) {
        const endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + phase.durationWeeks * 7)

        const cycle = await createLinearCycle({
          teamId,
          name: phase.name,
          startsAt: startDate,
          endsAt: endDate,
        })

        cycleMap.set(phase.name, cycle.id)
        startDate = new Date(endDate)
      }
    }

    // 4. Create Issues from modules
    const issueMappings: Array<{
      module_name: string
      phase_name: string | null
      linear_issue_id: string
      linear_issue_identifier: string | null
      linear_issue_url: string
      linear_team_id: string
      linear_cycle_id: string | null
      hours_estimate: number
    }> = []

    for (const moduleItem of modules) {
      const cycleId = moduleItem.phase ? cycleMap.get(moduleItem.phase) : undefined

      const issue = await createLinearIssue({
        teamId,
        title: moduleItem.name,
        description: buildIssueDescription(moduleItem),
        priority: mapRiskLevelToPriority(moduleItem.riskLevel),
        projectId: linearProject.id,
        cycleId,
        estimate: Math.ceil(moduleItem.hours),
      })

      issueMappings.push({
        module_name: moduleItem.name,
        phase_name: moduleItem.phase ?? null,
        linear_issue_id: issue.id,
        linear_issue_identifier: issue.identifier,
        linear_issue_url: issue.url,
        linear_team_id: teamId,
        linear_cycle_id: cycleId ?? null,
        hours_estimate: moduleItem.hours,
      })
    }

    // 5. Save mappings to DB
    if (issueMappings.length > 0) {
      const rows = issueMappings.map((mapping) => ({
        estimate_id: estimateId,
        project_id: projectId,
        ...mapping,
        sync_status: 'created',
        metadata: {},
      }))

      const { error: insertError } = await supabase
        .from('linear_issue_mappings')
        .insert(rows)

      if (insertError) {
        throw new Error(`Issue mapping保存に失敗: ${insertError.message}`)
      }
    }

    // 6. Update estimate sync status
    await supabase
      .from('estimates')
      .update({
        linear_project_id: linearProject.id,
        linear_sync_status: 'synced',
      })
      .eq('id', estimateId)

    // 7. Audit log
    if (actorClerkUserId) {
      await writeAuditLog(supabase, {
        actorClerkUserId,
        action: 'linear.sync_estimate',
        resourceType: 'estimate',
        resourceId: estimateId,
        projectId,
        payload: {
          linearProjectId: linearProject.id,
          linearProjectUrl: linearProject.url,
          issueCount: issueMappings.length,
          cycleCount: cycleMap.size,
        },
      })
    }

    return {
      linearProjectId: linearProject.id,
      linearProjectUrl: linearProject.url,
      issueCount: issueMappings.length,
      cycleCount: cycleMap.size,
    }
  } catch (error) {
    // Set sync status to 'error'
    await supabase
      .from('estimates')
      .update({ linear_sync_status: 'error' })
      .eq('id', estimateId)

    throw error
  }
}
