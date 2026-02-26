/**
 * Seed priority showcase repos with REAL hours_spent data from growth report.
 *
 * Run: npx tsx scripts/seed-priority-showcase.ts
 *
 * Unlike seed-showcase-repos.ts which processes ALL repos generically,
 * this script targets a curated list of the most representative projects
 * with actual development hours derived from commit history analysis.
 *
 * hours_spent values are estimated from:
 * - Growth report commit history + development period
 * - 1-day projects: 8-14h (intensive development)
 * - Short-term (1-7 days): 16-56h
 * - Medium-term (8-30 days): 40-160h
 * - Long-term (30+ days): 80-400h+
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
// Priority showcase list — curated from growth report
// ---------------------------------------------------------------------------
interface PriorityRepo {
  orgName: string
  repoName: string
  hoursSpent: number
  projectType: string
  techStack: string[]
  description: string
}

const PRIORITY_REPOS: PriorityRepo[] = [
  // === Cor-Incorporated ===
  {
    orgName: 'Cor-Incorporated',
    repoName: 'BenevolentDirector',
    hoursSpent: 500,
    projectType: 'new_project',
    techStack: ['Next.js', 'TypeScript', 'React', 'Supabase', 'PostgreSQL', 'Anthropic Claude', 'xAI Grok', 'Clerk', 'Tailwind CSS'],
    description: 'AI-powered project intake, estimation, and task management platform',
  },
  {
    orgName: 'Cor-Incorporated',
    repoName: 'corsweb2024',
    hoursSpent: 120,
    projectType: 'new_project',
    techStack: ['Astro', 'TypeScript', 'AI Chat', 'reCAPTCHA', 'CTF'],
    description: 'CTF platform with AI Chat integration and reCAPTCHA',
  },
  {
    orgName: 'Cor-Incorporated',
    repoName: 'ProEdit',
    hoursSpent: 60,
    projectType: 'new_project',
    techStack: ['TypeScript', 'React', 'Editor'],
    description: 'Professional editing tool',
  },
  {
    orgName: 'Cor-Incorporated',
    repoName: 'TapForge',
    hoursSpent: 80,
    projectType: 'new_project',
    techStack: ['TypeScript', 'React', 'NFC', 'IoT', 'Web NFC API'],
    description: 'NFC business card and profile management platform',
  },
  {
    orgName: 'Cor-Incorporated',
    repoName: 'TapForge-NFC',
    hoursSpent: 40,
    projectType: 'new_project',
    techStack: ['TypeScript', 'NFC', 'IoT', 'Web NFC API', 'React'],
    description: 'NFC companion app for TapForge',
  },
  {
    orgName: 'Cor-Incorporated',
    repoName: 'BoltSite',
    hoursSpent: 200,
    projectType: 'new_project',
    techStack: ['Next.js', 'TypeScript', 'CMS', 'WordPress', 'Hosting'],
    description: 'Corporate website builder and CMS hosting platform',
  },
  {
    orgName: 'Cor-Incorporated',
    repoName: 'nfc-profile-card',
    hoursSpent: 24,
    projectType: 'new_project',
    techStack: ['TypeScript', 'NFC', 'IoT', 'Web NFC API', 'React'],
    description: 'NFC profile card reader/writer web app',
  },
  {
    orgName: 'Cor-Incorporated',
    repoName: 'backup-analyzer',
    hoursSpent: 22,
    projectType: 'new_project',
    techStack: ['Python', 'Data Analysis', 'CLI'],
    description: 'Backup data analysis tool',
  },

  // === EngineerCafeJP ===
  {
    orgName: 'EngineerCafeJP',
    repoName: 'engineercafe-navigator',
    hoursSpent: 200,
    projectType: 'new_project',
    techStack: ['Python', 'TypeScript', 'LangGraph', 'AI Agent', 'NLP'],
    description: 'AI navigator for Engineer Cafe with LangGraph memory agent',
  },
  {
    orgName: 'EngineerCafeJP',
    repoName: 'engineercafe-reception-2025',
    hoursSpent: 120,
    projectType: 'new_project',
    techStack: ['TypeScript', 'Next.js', 'React', 'AI', 'Real-time'],
    description: 'AI-powered reception system for Engineer Cafe 2025',
  },
  {
    orgName: 'EngineerCafeJP',
    repoName: 'engineercafe_nfc',
    hoursSpent: 16,
    projectType: 'new_project',
    techStack: ['TypeScript', 'NFC', 'IoT', 'Web NFC API'],
    description: 'NFC check-in system for Engineer Cafe',
  },
  {
    orgName: 'EngineerCafeJP',
    repoName: 'hacktivation-2025-summer',
    hoursSpent: 17,
    projectType: 'new_project',
    techStack: ['TypeScript', 'Next.js', 'Hackathon'],
    description: 'Summer 2025 hackathon project',
  },

  // === seifu-dev ===
  {
    orgName: 'seifu-dev',
    repoName: 'backup-analyzer',
    hoursSpent: 22,
    projectType: 'new_project',
    techStack: ['Python', 'Data Analysis'],
    description: 'Backup data analyzer (fork)',
  },
]

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

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(header('=== Priority Showcase Seeder ==='))
  console.log(`  Target repos: ${PRIORITY_REPOS.length}`)

  let updated = 0
  let velocityRun = 0
  let notFound = 0
  let errors = 0

  for (const repo of PRIORITY_REPOS) {
    const fullName = `${repo.orgName}/${repo.repoName}`
    console.log(header(`--- ${fullName} ---`))

    // 1. Find in DB
    const { data: existing, error: findError } = await supabase
      .from('github_references')
      .select('id, velocity_data, hours_spent')
      .eq('org_name', repo.orgName)
      .eq('repo_name', repo.repoName)
      .maybeSingle()

    if (findError) {
      console.error(fail(`  DB error: ${findError.message}`))
      errors++
      continue
    }

    if (!existing) {
      console.log(warn(`  Not found in github_references — skipping (run GitHub sync first)`))
      notFound++
      continue
    }

    // 2. Update with priority data (always overwrite — growth report data is authoritative)
    const { error: updateError } = await supabase
      .from('github_references')
      .update({
        is_showcase: true,
        hours_spent: repo.hoursSpent,
        project_type: repo.projectType,
        tech_stack: repo.techStack,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (updateError) {
      console.error(fail(`  Update failed: ${updateError.message}`))
      errors++
      continue
    }

    console.log(ok(`  Set hours_spent=${repo.hoursSpent}, tech_stack=[${repo.techStack.join(', ')}]`))
    updated++

    // 3. Run velocity analysis if not already done
    if (existing.velocity_data === null && process.env.GITHUB_TOKEN) {
      try {
        console.log(`  Running velocity analysis...`)
        const velocity = await analyzeAndSaveVelocity({
          supabase,
          repoId: existing.id,
          orgName: repo.orgName,
          repoName: repo.repoName,
        })

        if (velocity) {
          console.log(ok(`  Velocity: ${velocity.totalCommits} commits, ${velocity.commitsPerWeek.toFixed(1)}/week, score=${velocity.velocityScore}`))
          velocityRun++
        } else {
          console.log(warn('  Velocity analysis returned null (may need retry later)'))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(fail(`  Velocity failed: ${msg}`))
      }
    } else if (existing.velocity_data !== null) {
      console.log('  Already has velocity data')
    }
  }

  // Summary
  console.log(header('\n=== Summary ==='))
  console.log(`  Priority repos:    ${PRIORITY_REPOS.length}`)
  console.log(`  Updated:           ${updated}`)
  console.log(`  Velocity analyzed: ${velocityRun}`)
  console.log(`  Not found in DB:   ${notFound}`)
  if (errors > 0) {
    console.log(fail(`  Errors:            ${errors}`))
  }
  console.log(ok('\nDone. Run the velocity cron job to process remaining repos incrementally.'))
}

main().catch((error) => {
  console.error(fail(`Fatal error: ${error instanceof Error ? error.message : String(error)}`))
  process.exit(1)
})
