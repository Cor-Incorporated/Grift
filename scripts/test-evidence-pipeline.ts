/**
 * Integration test script for the evidence-based estimation pipeline.
 *
 * Run from the project root:
 *   npx tsx scripts/test-evidence-pipeline.ts
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   XAI_API_KEY
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { createClient } from '@supabase/supabase-js'
import { findSimilarProjectsSemantic } from '../src/lib/estimates/semantic-similarity'
import {
  enrichSimilarProjectsWithHistory,
  buildHistoricalCalibration,
} from '../src/lib/estimates/historical-calibration'
import { buildEvidenceContextBlock } from '../src/lib/estimates/evidence-context-builder'
import { estimateHours } from '../src/lib/estimates/hours-estimator'
import { crossValidateEstimate } from '../src/lib/estimates/cross-validate'
import { buildEmptyHistoricalCalibration } from '../src/lib/estimates/evidence-bundle'
import type { SimilarProject } from '../src/lib/estimates/similar-projects'
import type { HistoricalCalibration, HistoricalReference } from '../src/lib/estimates/evidence-bundle'
import type { HoursEstimate } from '../src/lib/estimates/hours-estimator'

// ---------------------------------------------------------------------------
// ANSI colour helpers
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
// Env validation
// ---------------------------------------------------------------------------
const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'XAI_API_KEY',
] as const

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.error(fail(`Missing required environment variables: ${missing.join(', ')}`))
    console.error(fail('Copy .env.example to .env.local and fill in the values.'))
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
interface TestResult {
  name: string
  passed: boolean
  durationMs: number
  error?: string
}

const results: TestResult[] = []

async function runTest<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ value: T | null; passed: boolean }> {
  console.log(header(`=== ${name} ===`))
  const start = Date.now()

  try {
    const value = await fn()
    const durationMs = Date.now() - start
    results.push({ name, passed: true, durationMs })
    console.log(ok(`  PASSED in ${durationMs}ms`))
    return { value, passed: true }
  } catch (error) {
    const durationMs = Date.now() - start
    const errorMessage = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, durationMs, error: errorMessage })
    console.error(fail(`  FAILED in ${durationMs}ms`))
    console.error(fail(`  Error: ${errorMessage}`))
    return { value: null, passed: false }
  }
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
const SAMPLE_SPEC_MARKDOWN = `
# React + TypeScript eコマース SPA

## プロジェクト概要
商品カタログ、カート、決済機能を持つフルスタックeコマースアプリケーション。

## 技術スタック
- フロントエンド: React 18, TypeScript, Tailwind CSS, Zustand
- バックエンド: Node.js, Express, PostgreSQL
- 決済: Stripe API連携
- 認証: JWT + OAuth2 (Google, LINE)
- インフラ: Vercel (フロントエンド), Railway (バックエンド)

## 主要機能
1. 商品一覧・詳細ページ（検索・フィルタリング付き）
2. ショッピングカート（ゲスト・ログイン両対応）
3. Stripe決済フロー（クレジットカード、コンビニ払い）
4. 注文管理・履歴
5. ユーザー認証・プロフィール管理
6. 管理者ダッシュボード（商品・注文管理）

## 非機能要件
- モバイルファースト対応
- SEO対応（SSR/SSG）
- レスポンスタイム 200ms以下
`.trim()

// ---------------------------------------------------------------------------
// Mock fallback data for when Supabase returns no similar projects
// ---------------------------------------------------------------------------
function buildMockSimilarProjects(): SimilarProject[] {
  return [
    {
      githubReferenceId: 'mock-id-001',
      repoFullName: 'example/react-ecommerce',
      matchScore: 0.75,
      matchReasons: ['技術スタック一致: React, TypeScript', 'ドメイン一致: eコマース'],
      language: 'TypeScript',
      techStack: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Stripe'],
      hoursSpent: 320,
      description: 'React + TypeScript製のeコマースプラットフォーム',
    },
    {
      githubReferenceId: 'mock-id-002',
      repoFullName: 'example/shop-spa',
      matchScore: 0.55,
      matchReasons: ['技術スタック一致: React, Stripe'],
      language: 'JavaScript',
      techStack: ['React', 'Stripe', 'Express'],
      hoursSpent: 240,
      description: 'シンプルなショッピングSPA',
    },
  ]
}

function buildMockHistoricalRefs(): HistoricalReference[] {
  return buildMockSimilarProjects().map((p) => ({
    githubReferenceId: p.githubReferenceId,
    repoFullName: p.repoFullName,
    matchScore: p.matchScore,
    matchStrategy: 'semantic' as const,
    matchReasons: p.matchReasons,
    techStack: p.techStack,
    hoursSpent: p.hoursSpent,
    velocityEstimatedHours: p.hoursSpent ? Math.round(p.hoursSpent * 0.9) : null,
    velocityData: p.hoursSpent ? { estimatedHours: Math.round(p.hoursSpent * 0.9) } : null,
    analysisResult: null,
    description: p.description,
  }))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  validateEnv()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(ok('\nEnvironment validated. Starting evidence pipeline integration tests...\n'))

  // -------------------------------------------------------------------------
  // Test 1: Semantic Similarity
  // -------------------------------------------------------------------------
  let similarProjects: SimilarProject[] = []
  let test1UsedMock = false

  const test1 = await runTest('Test 1: Semantic Similarity (findSimilarProjectsSemantic)', async () => {
    const projects = await findSimilarProjectsSemantic({
      supabase,
      specMarkdown: SAMPLE_SPEC_MARKDOWN,
      projectType: 'new_project',
      limit: 5,
    })

    console.log(`  Found projects count: ${projects.length}`)

    if (projects.length === 0) {
      console.log(warn('  No similar projects found in DB (github_references may be empty or have no showcase entries).'))
      console.log(warn('  Proceeding with mock data for downstream tests.'))
      return projects
    }

    const top = projects[0]
    console.log(`  Top match name:  ${top.repoFullName}`)
    console.log(`  Top match score: ${top.matchScore}`)
    console.log(`  Match reasons:   ${top.matchReasons.join(' | ')}`)

    return projects
  })

  if (test1.passed && test1.value !== null) {
    if (test1.value.length > 0) {
      similarProjects = test1.value
    } else {
      similarProjects = buildMockSimilarProjects()
      test1UsedMock = true
    }
  } else {
    similarProjects = buildMockSimilarProjects()
    test1UsedMock = true
  }

  if (test1UsedMock) {
    console.log(warn('  [Mock] Using synthetic similar projects for downstream tests.'))
  }

  // -------------------------------------------------------------------------
  // Test 2: Historical Calibration
  // -------------------------------------------------------------------------
  let calibration: HistoricalCalibration = buildEmptyHistoricalCalibration()
  const test2 = await runTest(
    'Test 2: Historical Calibration (enrichSimilarProjectsWithHistory + buildHistoricalCalibration)',
    async () => {
      let refs: HistoricalReference[]

      if (test1UsedMock) {
        // If test 1 used mocks, use mock refs directly to avoid DB lookups for fake IDs
        refs = buildMockHistoricalRefs()
        console.log(warn('  [Mock] Using synthetic historical references (Test 1 used mock data).'))
      } else {
        refs = await enrichSimilarProjectsWithHistory(supabase, similarProjects)
      }

      const cal = buildHistoricalCalibration(refs)

      console.log(`  hasReliableData:  ${cal.hasReliableData}`)
      console.log(`  avgActualHours:   ${cal.avgActualHours ?? 'null'}`)
      console.log(`  citationText:     ${cal.citationText || '(none)'}`)

      return cal
    }
  )

  if (test2.passed && test2.value !== null) {
    calibration = test2.value
  }

  // -------------------------------------------------------------------------
  // Test 3: Evidence Context Builder
  // -------------------------------------------------------------------------
  let evidenceContextBlock = ''

  const test3 = await runTest('Test 3: Evidence Context Builder (buildEvidenceContextBlock)', async () => {
    const block = buildEvidenceContextBlock({
      historicalCalibration: calibration,
      codeImpact: null,
    })

    if (block.length === 0) {
      console.log(warn('  Context block is empty (no references or code impact data).'))
    } else {
      const preview = block.length > 500 ? `${block.slice(0, 500)}...` : block
      console.log(`  Context block (first 500 chars):\n${preview}`)
    }

    return block
  })

  if (test3.passed && test3.value !== null) {
    evidenceContextBlock = test3.value
  }

  // -------------------------------------------------------------------------
  // Test 4: Hours Estimation
  // -------------------------------------------------------------------------
  let hoursEstimate: HoursEstimate | null = null

  const test4 = await runTest('Test 4: Hours Estimation (estimateHours)', async () => {
    const hours = await estimateHours(
      SAMPLE_SPEC_MARKDOWN,
      'new_project',
      undefined,
      undefined,
      evidenceContextBlock || undefined
    )

    console.log(`  investigation:  ${hours.investigation}h`)
    console.log(`  implementation: ${hours.implementation}h`)
    console.log(`  testing:        ${hours.testing}h`)
    console.log(`  buffer:         ${hours.buffer}h`)
    console.log(`  total:          ${hours.total}h`)

    const breakdownPreview =
      hours.breakdown.length > 200
        ? `${hours.breakdown.slice(0, 200)}...`
        : hours.breakdown
    console.log(`  breakdown (first 200 chars):\n${breakdownPreview}`)

    return hours
  })

  if (test4.passed && test4.value !== null) {
    hoursEstimate = test4.value
  }

  // -------------------------------------------------------------------------
  // Test 5: Cross Validation
  // -------------------------------------------------------------------------
  await runTest('Test 5: Cross Validation (crossValidateEstimate)', async () => {
    const claudeHours = hoursEstimate?.total ?? 280

    if (!hoursEstimate) {
      console.log(warn(`  Test 4 did not produce hours. Using fallback claudeHours = ${claudeHours}.`))
    }

    const velocityData =
      calibration.references.length > 0 && calibration.references[0].velocityData
        ? calibration.references[0].velocityData
        : null

    const result = crossValidateEstimate({
      claudeHours,
      historicalCalibration: calibration,
      velocityData,
    })

    console.log(`  claudeHours:        ${result.claudeHours}h`)
    console.log(`  historicalAvgHours: ${result.historicalAvgHours ?? 'null'}h`)
    console.log(`  reconciledHours:    ${result.reconciledHours}h`)
    console.log(`  calibrationRatio:   ${result.calibrationRatio ?? 'null'}`)
    if (result.calibrationWarning) {
      console.log(warn(`  calibrationWarning: ${result.calibrationWarning}`))
    } else {
      console.log(`  calibrationWarning: (none)`)
    }
    console.log(`  validationNarrative: ${result.validationNarrative}`)

    return result
  })

  // -------------------------------------------------------------------------
  // Summary table
  // -------------------------------------------------------------------------
  console.log(header('=== Summary ===\n'))

  const colWidths = { name: 68, status: 8, duration: 10 }
  const divider = '-'.repeat(colWidths.name + colWidths.status + colWidths.duration + 7)

  console.log(divider)
  console.log(
    `${'Test'.padEnd(colWidths.name)} | ${'Status'.padEnd(colWidths.status)} | ${'Duration'.padEnd(colWidths.duration)}`
  )
  console.log(divider)

  for (const r of results) {
    const statusLabel = r.passed ? ok('PASS') : fail('FAIL')
    const durationLabel = `${r.durationMs}ms`
    const nameTruncated = r.name.length > colWidths.name ? `${r.name.slice(0, colWidths.name - 3)}...` : r.name
    console.log(
      `${nameTruncated.padEnd(colWidths.name)} | ${statusLabel.padEnd(colWidths.status + (r.passed ? GREEN.length + RESET.length : RED.length + RESET.length))} | ${durationLabel.padEnd(colWidths.duration)}`
    )
    if (!r.passed && r.error) {
      console.log(fail(`  -> ${r.error.slice(0, 120)}`))
    }
  }

  console.log(divider)

  const allPassed = results.every((r) => r.passed)
  const passCount = results.filter((r) => r.passed).length
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0)

  console.log(`\nResults: ${passCount}/${results.length} passed | Total time: ${totalMs}ms`)

  if (allPassed) {
    console.log(ok('\nAll tests passed.'))
    process.exit(0)
  } else {
    console.error(fail('\nOne or more tests failed.'))
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(fail(`Fatal error: ${error instanceof Error ? error.message : String(error)}`))
  process.exit(1)
})
