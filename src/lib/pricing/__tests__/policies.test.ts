import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectType } from '@/types/database'
import { defaultPolicyFor } from '@/lib/pricing/engine'
import { fetchActivePricingPolicy } from '@/lib/pricing/policies'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PolicyRow {
  project_type: string
  active: boolean
  coefficient_min?: number | null
  coefficient_max?: number | null
  default_coefficient?: number | null
  minimum_project_fee?: number | null
  minimum_margin_percent?: number | null
  avg_internal_cost_per_member_month?: number | null
  internal_team_size?: number | null
  default_team_size?: number | null
  default_duration_months?: number | null
  created_at?: string
}

function buildPoliciesSupabaseMock(options: {
  row?: PolicyRow | null
  error?: boolean
}): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => {
                  if (options.error) {
                    return { data: null, error: { message: 'db error', code: '42P01' } }
                  }
                  return { data: options.row ?? null, error: null }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

function makeFullPolicyRow(overrides: Partial<PolicyRow> = {}): PolicyRow {
  return {
    project_type: 'new_project',
    active: true,
    coefficient_min: 0.55,
    coefficient_max: 0.85,
    default_coefficient: 0.72,
    minimum_project_fee: 3_000_000,
    minimum_margin_percent: 25,
    avg_internal_cost_per_member_month: 2_500_000,
    internal_team_size: 3,
    default_team_size: 5,
    default_duration_months: 4,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchActivePricingPolicy', () => {
  // -------------------------------------------------------------------------
  // DB error → fallback
  // -------------------------------------------------------------------------
  describe('DB error cases', () => {
    it('returns default policy when DB query errors', async () => {
      const supabase = buildPoliciesSupabaseMock({ error: true })
      const fallback = defaultPolicyFor('new_project')

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result).toEqual(fallback)
    })

    it('returns default policy when no row is found', async () => {
      const supabase = buildPoliciesSupabaseMock({ row: null })
      const fallback = defaultPolicyFor('new_project')

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result).toEqual(fallback)
    })
  })

  // -------------------------------------------------------------------------
  // DB row found → merged policy
  // -------------------------------------------------------------------------
  describe('DB row found', () => {
    it('returns DB-sourced policy when row exists for new_project', async () => {
      const row = makeFullPolicyRow()
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.projectType).toBe('new_project')
      expect(result.coefficientMin).toBe(0.55)
      expect(result.coefficientMax).toBe(0.85)
      expect(result.defaultCoefficient).toBe(0.72)
      expect(result.minimumProjectFee).toBe(3_000_000)
      expect(result.minimumMarginPercent).toBe(25)
      expect(result.avgInternalCostPerMemberMonth).toBe(2_500_000)
      expect(result.internalTeamSize).toBe(3)
      expect(result.defaultTeamSize).toBe(5)
      expect(result.defaultDurationMonths).toBe(4)
    })

    it('returns DB-sourced policy for feature_addition', async () => {
      const row = makeFullPolicyRow({ project_type: 'feature_addition' })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'feature_addition')

      expect(result.projectType).toBe('feature_addition')
      expect(result.coefficientMin).toBe(0.55)
    })

    it('returns DB-sourced policy for bug_report', async () => {
      const row = makeFullPolicyRow({
        project_type: 'bug_report',
        minimum_project_fee: 200_000,
      })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'bug_report')

      expect(result.projectType).toBe('bug_report')
      expect(result.minimumProjectFee).toBe(200_000)
    })

    it('returns DB-sourced policy for fix_request', async () => {
      const row = makeFullPolicyRow({ project_type: 'fix_request' })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'fix_request')

      expect(result.projectType).toBe('fix_request')
    })
  })

  // -------------------------------------------------------------------------
  // Fallback values when DB row has nulls
  // -------------------------------------------------------------------------
  describe('partial DB row — null fields fall back to defaults', () => {
    it('uses fallback coefficientMin when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ coefficient_min: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.coefficientMin).toBe(fallback.coefficientMin)
    })

    it('uses fallback coefficientMax when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ coefficient_max: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.coefficientMax).toBe(fallback.coefficientMax)
    })

    it('uses fallback defaultCoefficient when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ default_coefficient: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.defaultCoefficient).toBe(fallback.defaultCoefficient)
    })

    it('uses fallback minimumProjectFee when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ minimum_project_fee: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.minimumProjectFee).toBe(fallback.minimumProjectFee)
    })

    it('uses fallback minimumMarginPercent when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ minimum_margin_percent: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.minimumMarginPercent).toBe(fallback.minimumMarginPercent)
    })

    it('uses fallback avgInternalCostPerMemberMonth when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ avg_internal_cost_per_member_month: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.avgInternalCostPerMemberMonth).toBe(fallback.avgInternalCostPerMemberMonth)
    })

    it('uses fallback internalTeamSize when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ internal_team_size: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.internalTeamSize).toBe(fallback.internalTeamSize)
    })

    it('uses fallback defaultTeamSize when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ default_team_size: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.defaultTeamSize).toBe(fallback.defaultTeamSize)
    })

    it('uses fallback defaultDurationMonths when DB value is null', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row = makeFullPolicyRow({ default_duration_months: null })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result.defaultDurationMonths).toBe(fallback.defaultDurationMonths)
    })

    it('handles row where all fields are null — full fallback to defaults', async () => {
      const fallback = defaultPolicyFor('new_project')
      const row: PolicyRow = {
        project_type: 'new_project',
        active: true,
        coefficient_min: null,
        coefficient_max: null,
        default_coefficient: null,
        minimum_project_fee: null,
        minimum_margin_percent: null,
        avg_internal_cost_per_member_month: null,
        internal_team_size: null,
        default_team_size: null,
        default_duration_months: null,
      }
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      expect(result).toEqual(fallback)
    })
  })

  // -------------------------------------------------------------------------
  // undetermined → maps to new_project
  // -------------------------------------------------------------------------
  describe('undetermined project type mapping', () => {
    it('maps undetermined to new_project for DB query and policy type', async () => {
      const fallback = defaultPolicyFor('new_project')
      const supabase = buildPoliciesSupabaseMock({ row: null })

      const result = await fetchActivePricingPolicy(
        supabase,
        'undetermined' as ProjectType
      )

      expect(result.projectType).toBe('new_project')
      expect(result).toEqual(fallback)
    })

    it('returns DB row with new_project type when undetermined is passed', async () => {
      const row = makeFullPolicyRow({ project_type: 'new_project' })
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(
        supabase,
        'undetermined' as ProjectType
      )

      expect(result.projectType).toBe('new_project')
      expect(result.coefficientMin).toBe(0.55)
    })
  })

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------
  describe('returned policy shape', () => {
    it('returned policy always has all required fields', async () => {
      const supabase = buildPoliciesSupabaseMock({ row: null })

      const result = await fetchActivePricingPolicy(supabase, 'bug_report')

      expect(result).toHaveProperty('projectType')
      expect(result).toHaveProperty('coefficientMin')
      expect(result).toHaveProperty('coefficientMax')
      expect(result).toHaveProperty('defaultCoefficient')
      expect(result).toHaveProperty('minimumProjectFee')
      expect(result).toHaveProperty('minimumMarginPercent')
      expect(result).toHaveProperty('avgInternalCostPerMemberMonth')
      expect(result).toHaveProperty('internalTeamSize')
      expect(result).toHaveProperty('defaultTeamSize')
      expect(result).toHaveProperty('defaultDurationMonths')
    })

    it('all numeric fields are finite numbers', async () => {
      const row = makeFullPolicyRow()
      const supabase = buildPoliciesSupabaseMock({ row })

      const result = await fetchActivePricingPolicy(supabase, 'new_project')

      const numericFields = [
        result.coefficientMin,
        result.coefficientMax,
        result.defaultCoefficient,
        result.minimumProjectFee,
        result.minimumMarginPercent,
        result.avgInternalCostPerMemberMonth,
        result.internalTeamSize,
        result.defaultTeamSize,
        result.defaultDurationMonths,
      ]

      for (const val of numericFields) {
        expect(typeof val).toBe('number')
        expect(Number.isFinite(val)).toBe(true)
      }
    })
  })
})
