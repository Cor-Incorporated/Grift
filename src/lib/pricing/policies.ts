import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectType } from '@/types/database'
import {
  defaultPolicyFor,
  type PricingPolicy,
  type ProjectPricingType,
} from '@/lib/pricing/engine'

function mapProjectType(type: ProjectType): ProjectPricingType {
  if (type === 'undetermined') return 'new_project'
  return type
}

export async function fetchActivePricingPolicy(
  supabase: SupabaseClient,
  projectType: ProjectType
): Promise<PricingPolicy> {
  const mappedType = mapProjectType(projectType)
  const fallback = defaultPolicyFor(mappedType)

  const { data, error } = await supabase
    .from('pricing_policies')
    .select('*')
    .eq('project_type', mappedType)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    return fallback
  }

  return {
    projectType: mappedType,
    coefficientMin: Number(data.coefficient_min ?? fallback.coefficientMin),
    coefficientMax: Number(data.coefficient_max ?? fallback.coefficientMax),
    defaultCoefficient: Number(data.default_coefficient ?? fallback.defaultCoefficient),
    minimumProjectFee: Number(data.minimum_project_fee ?? fallback.minimumProjectFee),
    minimumMarginPercent: Number(data.minimum_margin_percent ?? fallback.minimumMarginPercent),
    avgInternalCostPerMemberMonth: Number(
      data.avg_internal_cost_per_member_month ?? fallback.avgInternalCostPerMemberMonth
    ),
    internalTeamSize: Number(data.internal_team_size ?? fallback.internalTeamSize),
    defaultTeamSize: Number(data.default_team_size ?? fallback.defaultTeamSize),
    defaultDurationMonths: Number(
      data.default_duration_months ?? fallback.defaultDurationMonths
    ),
  }
}
