import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  // 1. Total count
  const { count: totalCount } = await supabase
    .from('github_references')
    .select('*', { count: 'exact', head: true })
  console.log('=== github_references overview ===')
  console.log('Total rows:', totalCount)

  // 2. Showcase count
  const { count: showcaseCount } = await supabase
    .from('github_references')
    .select('*', { count: 'exact', head: true })
    .eq('is_showcase', true)
  console.log('Showcase (is_showcase=true):', showcaseCount)

  // 3. With velocity_data
  const { count: velocityCount } = await supabase
    .from('github_references')
    .select('*', { count: 'exact', head: true })
    .not('velocity_data', 'is', null)
  console.log('With velocity_data:', velocityCount)

  // 4. With hours_spent
  const { count: hoursCount } = await supabase
    .from('github_references')
    .select('*', { count: 'exact', head: true })
    .not('hours_spent', 'is', null)
  console.log('With hours_spent:', hoursCount)

  // 5. With analysis_result
  const { count: analysisCount } = await supabase
    .from('github_references')
    .select('*', { count: 'exact', head: true })
    .not('analysis_result', 'is', null)
  console.log('With analysis_result:', analysisCount)

  // 6. With total_commits
  const { count: commitsCount } = await supabase
    .from('github_references')
    .select('*', { count: 'exact', head: true })
    .not('total_commits', 'is', null)
  console.log('With total_commits:', commitsCount)

  // 7. Sample repos (top 15 by stars)
  const { data: samples } = await supabase
    .from('github_references')
    .select('full_name, language, stars, is_showcase, tech_stack, hours_spent, velocity_data, total_commits, contributor_count, velocity_analyzed_at, analysis_result')
    .order('stars', { ascending: false })
    .limit(15)

  console.log('\n=== Top 15 repos by stars ===')
  if (samples) {
    for (const r of samples) {
      const hasVelocity = r.velocity_data ? 'YES' : 'no'
      const hasAnalysis = r.analysis_result ? 'YES' : 'no'
      const showcase = r.is_showcase ? 'SHOWCASE' : '-'
      const hours = r.hours_spent ?? '-'
      const tech = ((r.tech_stack as string[]) ?? []).slice(0, 3).join(', ')
      console.log(
        `  ${String(r.full_name ?? '').padEnd(40)} | ${String(r.stars ?? 0).padStart(5)} stars | ${showcase.padEnd(8)} | velocity=${hasVelocity.padEnd(3)} | analysis=${hasAnalysis.padEnd(3)} | hours=${String(hours).padStart(4)} | commits=${String(r.total_commits ?? '-').padStart(5)} | tech=[${tech}]`
      )
    }
  }

  // 8. Check orgs
  const { data: orgs } = await supabase
    .from('github_references')
    .select('org_name')
  const uniqueOrgs = [...new Set((orgs ?? []).map((r) => r.org_name).filter(Boolean))]
  console.log('\n=== Unique org names ===')
  console.log(uniqueOrgs.join(', ') || '(none)')
}

main().catch(console.error)
