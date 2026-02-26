/**
 * Seed showcase repos with velocity data from GitHub.
 * This enables the evidence-based estimation pipeline to find real reference data.
 *
 * Run: npx tsx scripts/seed-showcase-repos.ts
 *
 * What it does:
 * 1. Marks key repos as is_showcase=true
 * 2. Runs velocity analysis (GitHub Stats API — FREE, no AI cost)
 * 3. Infers tech_stack from language + topics
 * 4. Sets estimated hours_spent from velocity data
 * 5. Sets project_type based on repo description
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { analyzeAndSaveVelocity } from '../src/lib/github/discover'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const ok = (msg: string) => `${GREEN}${msg}${RESET}`
const fail = (msg: string) => `${RED}${msg}${RESET}`
const warn = (msg: string) => `${YELLOW}${msg}${RESET}`
const header = (msg: string) => `\n${BOLD}${CYAN}${msg}${RESET}`

// ---------------------------------------------------------------------------
// Tech stack inference rules (no AI cost)
// ---------------------------------------------------------------------------
const TECH_STACK_RULES: Record<string, { tech: string[]; projectType: string }> = {
  // Infer from repo name patterns + known repos
  'nfc': { tech: ['NFC', 'IoT', 'Web NFC API'], projectType: 'new_project' },
  'react': { tech: ['React'], projectType: 'new_project' },
  'next': { tech: ['Next.js', 'React'], projectType: 'new_project' },
  'typescript': { tech: ['TypeScript'], projectType: 'new_project' },
  'flutter': { tech: ['Flutter', 'Dart'], projectType: 'new_project' },
  'swift': { tech: ['Swift', 'iOS'], projectType: 'new_project' },
  'python': { tech: ['Python'], projectType: 'new_project' },
  'go': { tech: ['Go'], projectType: 'new_project' },
  'rust': { tech: ['Rust'], projectType: 'new_project' },
  'vue': { tech: ['Vue.js'], projectType: 'new_project' },
  'angular': { tech: ['Angular'], projectType: 'new_project' },
  'django': { tech: ['Django', 'Python'], projectType: 'new_project' },
  'fastapi': { tech: ['FastAPI', 'Python'], projectType: 'new_project' },
  'express': { tech: ['Express', 'Node.js'], projectType: 'new_project' },
  'stripe': { tech: ['Stripe', 'Payment'], projectType: 'new_project' },
  'supabase': { tech: ['Supabase', 'PostgreSQL'], projectType: 'new_project' },
  'firebase': { tech: ['Firebase'], projectType: 'new_project' },
  'docker': { tech: ['Docker'], projectType: 'new_project' },
  'terraform': { tech: ['Terraform', 'IaC'], projectType: 'new_project' },
  'ar': { tech: ['AR', 'WebXR'], projectType: 'new_project' },
  'chat': { tech: ['Chat', 'Real-time'], projectType: 'new_project' },
  'editor': { tech: ['Editor', 'Rich Text'], projectType: 'new_project' },
  'api': { tech: ['REST API'], projectType: 'new_project' },
  'web': { tech: ['Web'], projectType: 'new_project' },
  'app': { tech: ['Mobile App'], projectType: 'new_project' },
  'analyzer': { tech: ['Data Analysis'], projectType: 'new_project' },
  'dashboard': { tech: ['Dashboard', 'Data Visualization'], projectType: 'new_project' },
}

const LANGUAGE_TO_TECH: Record<string, string[]> = {
  'TypeScript': ['TypeScript'],
  'JavaScript': ['JavaScript'],
  'Python': ['Python'],
  'Go': ['Go'],
  'Rust': ['Rust'],
  'Swift': ['Swift', 'iOS'],
  'Kotlin': ['Kotlin', 'Android'],
  'Java': ['Java'],
  'Ruby': ['Ruby'],
  'Dart': ['Dart', 'Flutter'],
  'C#': ['C#', '.NET'],
  'PHP': ['PHP'],
  'HTML': ['HTML', 'Web'],
  'CSS': ['CSS'],
}

function inferTechStack(
  repoName: string,
  language: string | null,
  topics: string[],
  description: string | null
): string[] {
  const tech = new Set<string>()

  // From language
  if (language && LANGUAGE_TO_TECH[language]) {
    for (const t of LANGUAGE_TO_TECH[language]) tech.add(t)
  }

  // From repo name + description
  const searchText = `${repoName} ${description ?? ''} ${topics.join(' ')}`.toLowerCase()
  for (const [keyword, rule] of Object.entries(TECH_STACK_RULES)) {
    if (searchText.includes(keyword)) {
      for (const t of rule.tech) tech.add(t)
    }
  }

  // From topics
  for (const topic of topics) {
    const topicLower = topic.toLowerCase()
    if (LANGUAGE_TO_TECH[topic]) {
      for (const t of LANGUAGE_TO_TECH[topic]) tech.add(t)
    }
    for (const [keyword, rule] of Object.entries(TECH_STACK_RULES)) {
      if (topicLower.includes(keyword)) {
        for (const t of rule.tech) tech.add(t)
      }
    }
  }

  return [...tech]
}

function inferProjectType(
  repoName: string,
  description: string | null,
  topics: string[]
): string {
  const searchText = `${repoName} ${description ?? ''} ${topics.join(' ')}`.toLowerCase()
  for (const [keyword, rule] of Object.entries(TECH_STACK_RULES)) {
    if (searchText.includes(keyword)) {
      return rule.projectType
    }
  }
  return 'new_project'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.error(fail('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'))
    process.exit(1)
  }

  if (!process.env.GITHUB_TOKEN) {
    console.error(fail('Missing GITHUB_TOKEN — needed for GitHub Stats API calls'))
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Fetch all repos that are NOT yet showcase
  const { data: repos, error } = await supabase
    .from('github_references')
    .select('id, org_name, repo_name, full_name, language, description, topics, stars, is_showcase, velocity_data, tech_stack, hours_spent')
    .order('stars', { ascending: false })

  if (error || !repos) {
    console.error(fail(`Failed to fetch repos: ${error?.message ?? 'unknown error'}`))
    process.exit(1)
  }

  console.log(header(`Found ${repos.length} repos in github_references`))

  // 2. Process each repo
  let showcaseCount = 0
  let velocityCount = 0
  let techStackCount = 0
  let failCount = 0

  for (const repo of repos) {
    const orgName = repo.org_name as string
    const repoName = repo.repo_name as string
    const fullName = repo.full_name as string
    const repoId = repo.id as string
    const language = repo.language as string | null
    const description = repo.description as string | null
    const topics = (repo.topics as string[]) ?? []
    const existingTechStack = (repo.tech_stack as string[]) ?? []
    const hasVelocity = repo.velocity_data !== null
    const isShowcase = repo.is_showcase as boolean

    console.log(header(`--- ${fullName} ---`))

    // 2a. Mark as showcase
    if (!isShowcase) {
      const { error: updateError } = await supabase
        .from('github_references')
        .update({ is_showcase: true, updated_at: new Date().toISOString() })
        .eq('id', repoId)

      if (updateError) {
        console.error(fail(`  Failed to set showcase: ${updateError.message}`))
      } else {
        console.log(ok('  Set is_showcase = true'))
        showcaseCount++
      }
    } else {
      console.log('  Already showcase')
    }

    // 2b. Run velocity analysis (GitHub API — free)
    if (!hasVelocity) {
      try {
        console.log(`  Running velocity analysis for ${orgName}/${repoName}...`)
        const velocity = await analyzeAndSaveVelocity({
          supabase,
          repoId,
          orgName,
          repoName,
        })

        if (velocity) {
          console.log(ok(`  Velocity: ${velocity.totalCommits} commits, ${velocity.contributorCount} contributors, ${velocity.commitsPerWeek.toFixed(1)} commits/week, estimatedHours=${velocity.estimatedHours}`))
          velocityCount++

          // 2c. Set hours_spent from velocity estimatedHours if not set
          if (repo.hours_spent === null && velocity.estimatedHours > 0) {
            await supabase
              .from('github_references')
              .update({ hours_spent: Math.round(velocity.estimatedHours) })
              .eq('id', repoId)
            console.log(ok(`  Set hours_spent = ${Math.round(velocity.estimatedHours)} (from velocity)`))
          }
        } else {
          console.log(warn('  Velocity analysis returned null'))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(fail(`  Velocity analysis failed: ${msg}`))
        failCount++
      }
    } else {
      console.log('  Already has velocity data')
    }

    // 2d. Infer tech_stack if empty
    if (existingTechStack.length === 0) {
      const inferredTech = inferTechStack(repoName, language, topics, description)
      const projectType = inferProjectType(repoName, description, topics)

      if (inferredTech.length > 0) {
        await supabase
          .from('github_references')
          .update({
            tech_stack: inferredTech,
            project_type: projectType,
            updated_at: new Date().toISOString(),
          })
          .eq('id', repoId)
        console.log(ok(`  Set tech_stack = [${inferredTech.join(', ')}]`))
        console.log(ok(`  Set project_type = ${projectType}`))
        techStackCount++
      } else {
        console.log(warn(`  Could not infer tech_stack for ${fullName}`))
      }
    } else {
      console.log(`  Already has tech_stack: [${existingTechStack.join(', ')}]`)
    }
  }

  // Summary
  console.log(header('\n=== Seeding Summary ==='))
  console.log(`  Repos processed:      ${repos.length}`)
  console.log(`  Newly set showcase:   ${showcaseCount}`)
  console.log(`  Velocity analyzed:    ${velocityCount}`)
  console.log(`  Tech stack inferred:  ${techStackCount}`)
  if (failCount > 0) {
    console.log(fail(`  Failed:               ${failCount}`))
  }
  console.log(ok('\nDone. Re-run scripts/test-evidence-pipeline.ts to verify the pipeline works with real data.'))
}

main().catch((error) => {
  console.error(fail(`Fatal error: ${error instanceof Error ? error.message : String(error)}`))
  process.exit(1)
})
