import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ExternalApiQuotaError } from '@/lib/usage/api-usage'

// ---------------------------------------------------------------------------
// Module mocks – must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/anthropic', () => ({
  sendMessage: vi.fn(),
  sendVisionMessage: vi.fn(),
  buildImageBlock: vi.fn(),
  validateImageSize: vi.fn(),
}))

vi.mock('@/lib/ai/xai', () => ({
  parseJsonFromResponse: vi.fn(),
}))

vi.mock('@/lib/source-analysis/zip', () => ({
  analyzeZipArchiveWithClaude: vi.fn(),
}))

vi.mock('@/lib/source-analysis/repository', () => ({
  analyzeRepositoryUrlWithClaude: vi.fn(),
  isGitHubUrl: vi.fn(),
}))

vi.mock('@/lib/source-analysis/website', () => ({
  analyzeWebsiteUrlWithGrok: vi.fn(),
}))

vi.mock('@/lib/source-analysis/pdf', () => ({
  analyzePdfWithClaude: vi.fn(),
  extractTextFromPdfBuffer: vi.fn(),
}))

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: vi.fn(),
}))

import {
  enqueueSourceAnalysisJob,
  runQueuedSourceAnalysisJobs,
  type RunSourceAnalysisJobsResult,
} from '@/lib/source-analysis/jobs'
import { analyzeRepositoryUrlWithClaude, isGitHubUrl } from '@/lib/source-analysis/repository'
import { analyzeWebsiteUrlWithGrok } from '@/lib/source-analysis/website'
import { analyzeZipArchiveWithClaude } from '@/lib/source-analysis/zip'
import { analyzePdfWithClaude, extractTextFromPdfBuffer } from '@/lib/source-analysis/pdf'
import { sendMessage, sendVisionMessage, buildImageBlock, validateImageSize } from '@/lib/ai/anthropic'
import { parseJsonFromResponse } from '@/lib/ai/xai'
import { writeAuditLog } from '@/lib/audit/log'

// ---------------------------------------------------------------------------
// Helper: Supabase mock factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal chainable Supabase client mock for the given table responses.
 *
 * `tableMap` keys are table names. Each entry has:
 *  - `select`  – what `.select()…chain…` resolves to  (used in SELECT queries)
 *  - `insert`  – what `.insert()…single()` resolves to
 *  - `update`  – what `.update()…chain` resolves to  (always resolves fine by default)
 */
function buildSupabaseMock(tableMap: Record<string, {
  select?: unknown
  insert?: unknown
  update?: unknown
  maybeSingle?: unknown
  storage?: unknown
}>): SupabaseClient {
  const selectChain = (result: unknown) => {
    const terminal = vi.fn().mockResolvedValue(result)
    const chain: Record<string, unknown> = {}
    const addChain = (obj: Record<string, unknown>) => {
      const methods = ['eq', 'in', 'lte', 'order', 'limit', 'not', 'select']
      for (const m of methods) {
        obj[m] = vi.fn().mockReturnValue(chain)
      }
      obj['single'] = terminal
      obj['maybeSingle'] = terminal
    }
    addChain(chain)
    return chain
  }

  const updateChain = (result: unknown = { data: null, error: null }) => {
    const terminal = vi.fn().mockResolvedValue(result)
    const chain: Record<string, unknown> = {}
    const addChain = (obj: Record<string, unknown>) => {
      const methods = ['eq', 'in', 'select', 'not']
      for (const m of methods) {
        obj[m] = vi.fn().mockReturnValue(chain)
      }
      obj['single'] = terminal
    }
    addChain(chain)
    return chain
  }

  const insertChain = (result: unknown) => {
    const selectFn = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(result),
    })
    return { select: selectFn }
  }

  const fromFn = vi.fn().mockImplementation((table: string) => {
    const entry = tableMap[table] ?? {}
    return {
      select: vi.fn().mockReturnValue(selectChain(entry.select)),
      insert: vi.fn().mockReturnValue(insertChain(entry.insert ?? { data: null, error: null })),
      update: vi.fn().mockReturnValue(updateChain(entry.update)),
    }
  })

  // Simple storage stub used by downloadProjectFileBuffer
  const storageMock = {
    from: vi.fn().mockReturnValue({
      download: vi.fn().mockResolvedValue({
        data: { arrayBuffer: async () => new ArrayBuffer(0) },
        error: null,
      }),
    }),
  }

  return {
    from: fromFn,
    storage: storageMock,
  } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const ACTOR_USER_ID = 'clerk_actor_001'
const PROJECT_ID = 'proj-abc'
const PROJECT_FILE_ID = 'file-xyz'

const QUEUED_JOB = {
  id: 'job-001',
  project_id: PROJECT_ID,
  project_file_id: PROJECT_FILE_ID,
  job_kind: 'repository_url' as const,
  status: 'queued' as const,
  payload: {},
  attempt_count: 0,
  max_attempts: 3,
  run_after: new Date(Date.now() - 1000).toISOString(),
}

const LOCKED_JOB = { ...QUEUED_JOB, status: 'processing' as const, attempt_count: 1 }

const MOCK_PROJECT_FILE = {
  id: PROJECT_FILE_ID,
  project_id: PROJECT_ID,
  file_path: 'path/to/file.zip',
  file_type: 'application/zip',
  file_name: 'file.zip',
  file_size: 1024,
  source_kind: 'file_upload' as const,
  source_url: null,
}

// ---------------------------------------------------------------------------
// enqueueSourceAnalysisJob
// ---------------------------------------------------------------------------

describe('enqueueSourceAnalysisJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns existing job when a queued/processing job already exists', async () => {
    // maybeSingle returns an existing job row
    const existingJob = { id: 'existing-job-id', status: 'queued' }
    const supabase = buildSupabaseMock({
      source_analysis_jobs: {
        select: { data: existingJob, error: null },
      },
    })

    // Override maybeSingle to return the existing job
    const selectChainReturner = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: existingJob, error: null }),
        }),
      }),
    })
    ;(supabase.from as unknown as MockInstance).mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return { select: selectChainReturner }
      }
      return {}
    })

    const result = await enqueueSourceAnalysisJob(supabase, {
      projectId: PROJECT_ID,
      projectFileId: PROJECT_FILE_ID,
      jobKind: 'file_upload',
      createdByClerkUserId: ACTOR_USER_ID,
    })

    expect(result.id).toBe('existing-job-id')
    expect(result.status).toBe('queued')
  })

  it('creates and returns new job when no existing job found', async () => {
    const newJob = { id: 'new-job-id', status: 'queued' }
    const selectChainReturner = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })

    const insertChainReturner = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: newJob, error: null }),
      }),
    })

    const supabase2 = {} as SupabaseClient
    ;(supabase2 as unknown as { from: MockInstance }).from = vi.fn().mockImplementation(
      (table: string) => {
        if (table === 'source_analysis_jobs') {
          return {
            select: selectChainReturner,
            insert: insertChainReturner,
          }
        }
        return {}
      }
    )

    const result = await enqueueSourceAnalysisJob(supabase2, {
      projectId: PROJECT_ID,
      projectFileId: PROJECT_FILE_ID,
      jobKind: 'repository_url',
      payload: { url: 'https://github.com/org/repo' },
      createdByClerkUserId: ACTOR_USER_ID,
    })

    expect(result.id).toBe('new-job-id')
    expect(result.status).toBe('queued')
  })

  it('throws when insert fails', async () => {
    const selectChainReturner = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })

    const insertChainReturner = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB insert failed' } }),
      }),
    })

    const supabase = {} as SupabaseClient
    ;(supabase as unknown as { from: MockInstance }).from = vi.fn().mockImplementation(
      (table: string) => {
        if (table === 'source_analysis_jobs') {
          return {
            select: selectChainReturner,
            insert: insertChainReturner,
          }
        }
        return {}
      }
    )

    await expect(
      enqueueSourceAnalysisJob(supabase, {
        projectId: PROJECT_ID,
        projectFileId: PROJECT_FILE_ID,
        jobKind: 'repository_url',
        createdByClerkUserId: ACTOR_USER_ID,
      })
    ).rejects.toThrow('解析ジョブの登録に失敗しました')
  })
})

// ---------------------------------------------------------------------------
// runQueuedSourceAnalysisJobs – returns zeros on DB error
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – query failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns zero counts when source_analysis_jobs query fails', async () => {
    const supabase = {} as SupabaseClient
    const chain: Record<string, unknown> = {}
    const methods = ['eq', 'lte', 'order', 'limit']
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    ;(chain as { limit: MockInstance }).limit = vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } })

    ;(supabase as unknown as { from: MockInstance }).from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(chain),
    })

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result).toEqual<RunSourceAnalysisJobsResult>({
      scanned: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      requeued: 0,
    })
  })

  it('returns zero counts when data is null without error', async () => {
    const supabase = {} as SupabaseClient
    const chain: Record<string, unknown> = {}
    const methods = ['eq', 'lte', 'order', 'limit']
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    ;(chain as { limit: MockInstance }).limit = vi.fn().mockResolvedValue({ data: null, error: null })

    ;(supabase as unknown as { from: MockInstance }).from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(chain),
    })

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.scanned).toBe(0)
    expect(result.processed).toBe(0)
  })

  it('returns zero counts when job list is empty', async () => {
    const supabase = {} as SupabaseClient
    const chain: Record<string, unknown> = {}
    const methods = ['eq', 'lte', 'order', 'limit']
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    ;(chain as { limit: MockInstance }).limit = vi.fn().mockResolvedValue({ data: [], error: null })

    ;(supabase as unknown as { from: MockInstance }).from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(chain),
    })

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 10,
    })

    expect(result.scanned).toBe(0)
    expect(result.processed).toBe(0)
    expect(result.succeeded).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Helper: build a full mock supabase for job processing flows
// ---------------------------------------------------------------------------

function buildProcessingSupabase(options: {
  lockResult?: unknown
  bumpResult?: unknown
  fileResult?: unknown
  filesUpdateResult?: unknown
  conversationsInsertResult?: unknown
  auditInsertResult?: unknown
  storageDownloadResult?: unknown
}): SupabaseClient {
  const {
    lockResult = { data: LOCKED_JOB, error: null },
    bumpResult = { data: LOCKED_JOB, error: null },
    fileResult = { data: MOCK_PROJECT_FILE, error: null },
    filesUpdateResult = { data: null, error: null },
    conversationsInsertResult = { data: null, error: null },
    auditInsertResult = { data: null, error: null },
    storageDownloadResult = {
      data: { arrayBuffer: async () => Buffer.from('fake').buffer },
      error: null,
    },
  } = options

  let lockCallCount = 0

  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'source_analysis_jobs') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: QUEUED_JOB, error: null }),
          }),
        }),
        update: vi.fn().mockImplementation(() => {
          lockCallCount++
          // First update call = lock (status→processing), second = bump attempt_count
          const result = lockCallCount === 1 ? lockResult : bumpResult
          const chain: Record<string, unknown> = {}
          chain['eq'] = vi.fn().mockReturnValue(chain)
          chain['select'] = vi.fn().mockReturnValue(chain)
          chain['single'] = vi.fn().mockResolvedValue(result)
          return chain
        }),
      }
    }

    if (table === 'project_files') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(fileResult),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue(filesUpdateResult),
        }),
      }
    }

    if (table === 'conversations') {
      return {
        insert: vi.fn().mockResolvedValue(conversationsInsertResult),
      }
    }

    if (table === 'audit_logs') {
      return {
        insert: vi.fn().mockResolvedValue(auditInsertResult),
      }
    }

    return {}
  })

  const storageMock = {
    from: vi.fn().mockReturnValue({
      download: vi.fn().mockResolvedValue(storageDownloadResult),
    }),
  }

  return { from: fromFn, storage: storageMock } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// processSingleJob – via runQueuedSourceAnalysisJobs with one job in queue
// ---------------------------------------------------------------------------

/**
 * Builds a supabase mock where the initial queue scan returns the given jobs,
 * then delegates to `processingSupabase` for the job processing DB calls.
 */
function buildFullRunSupabase(
  jobs: unknown[],
  processingSupabase: SupabaseClient
): SupabaseClient {
  let scanCalled = false

  const fromFn = vi.fn().mockImplementation((table: string) => {
    // First call to source_analysis_jobs is the queue scan
    if (table === 'source_analysis_jobs' && !scanCalled) {
      scanCalled = true
      const chain: Record<string, unknown> = {}
      const methods = ['eq', 'lte', 'order', 'limit']
      for (const m of methods) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }
      ;(chain as { limit: MockInstance }).limit = vi.fn().mockResolvedValue({ data: jobs, error: null })
      return { select: vi.fn().mockReturnValue(chain) }
    }

    // Remaining calls go to processingSupabase
    return (processingSupabase.from as unknown as (...args: unknown[]) => unknown)(table)
  })

  const storageMock = {
    from: vi.fn().mockImplementation((...args: unknown[]) =>
      (processingSupabase.storage as unknown as { from: (...a: unknown[]) => unknown }).from(...args)
    ),
  }

  return { from: fromFn, storage: storageMock } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Lock fails – job is counted as requeued
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – lock failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts job as requeued when lockJobForProcessing returns null (lock step fails)', async () => {
    const processingSupabase = buildProcessingSupabase({
      lockResult: { data: null, error: { message: 'row locked' } },
    })

    const supabase = buildFullRunSupabase([QUEUED_JOB], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.scanned).toBe(1)
    expect(result.processed).toBe(1)
    expect(result.requeued).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Successful repository_url job (GitHub)
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – repository_url (GitHub) success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts job as succeeded after successful GitHub repository analysis', async () => {
    const githubFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'repository_url' as const,
      source_url: 'https://github.com/org/repo',
      file_type: null,
    }

    vi.mocked(isGitHubUrl).mockReturnValue(true)
    vi.mocked(analyzeRepositoryUrlWithClaude).mockResolvedValue({
      repository: {
        owner: 'org',
        repo: 'repo',
        branch: 'main',
        url: 'https://github.com/org/repo',
      },
      analysis: {
        summary: 'Test repo summary',
        systemType: 'Web Application',
        techStack: ['Next.js'],
        architecture: 'Monolith',
        keyModules: ['auth'],
        risks: ['scaling'],
        changeImpactPoints: ['DB schema'],
        recommendedQuestions: ['What is the DB size?'],
        snapshot: {},
      },
      archiveBytes: 2048,
    } as unknown as Awaited<ReturnType<typeof analyzeRepositoryUrlWithClaude>>)
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobWithRepoKind = { ...QUEUED_JOB, job_kind: 'repository_url' as const }
    const lockedJobWithRepoKind = { ...LOCKED_JOB, job_kind: 'repository_url' as const }

    // Override processing supabase to return a repo_url locked job
    let lockCallCount = 0
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            lockCallCount++
            const result = lockCallCount === 1
              ? { data: lockedJobWithRepoKind, error: null }
              : { data: lockedJobWithRepoKind, error: null }
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue(result)
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: githubFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'conversations') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const repoProcessingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobWithRepoKind], repoProcessingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.requeued).toBe(0)
    expect(vi.mocked(analyzeRepositoryUrlWithClaude)).toHaveBeenCalledWith(
      'https://github.com/org/repo',
      expect.objectContaining({ projectId: PROJECT_ID })
    )
  })
})

// ---------------------------------------------------------------------------
// Successful repository_url job (non-GitHub website)
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – repository_url (website) success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses analyzeWebsiteUrlWithGrok for non-GitHub URLs and counts as succeeded', async () => {
    const websiteFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'repository_url' as const,
      source_url: 'https://example.com',
      file_type: null,
    }

    vi.mocked(isGitHubUrl).mockReturnValue(false)
    vi.mocked(analyzeWebsiteUrlWithGrok).mockResolvedValue({
      summary: 'Corporate website',
      companyOverview: 'A tech company',
    } as Awaited<ReturnType<typeof analyzeWebsiteUrlWithGrok>>)
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobWithRepoKind = { ...QUEUED_JOB, job_kind: 'repository_url' as const }
    const lockedJobWithRepoKind = { ...LOCKED_JOB, job_kind: 'repository_url' as const }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobWithRepoKind, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: websiteFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'conversations') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const websiteProcessingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobWithRepoKind], websiteProcessingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.succeeded).toBe(1)
    expect(vi.mocked(analyzeWebsiteUrlWithGrok)).toHaveBeenCalledWith(
      'https://example.com',
      expect.anything()
    )
  })
})

// ---------------------------------------------------------------------------
// repository_url missing source_url → throws → requeued (attempt < max)
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – repository_url missing source_url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requeues job when source_url is null on a repository_url job', async () => {
    const noUrlFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'repository_url' as const,
      source_url: null,
      file_type: null,
    }

    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobWithRepoKind = { ...QUEUED_JOB, job_kind: 'repository_url' as const }
    const lockedJobWithRepoKind = {
      ...LOCKED_JOB,
      job_kind: 'repository_url' as const,
      attempt_count: 1,
      max_attempts: 3,
    }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobWithRepoKind, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: noUrlFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const processingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobWithRepoKind], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    // attempt_count (1) < max_attempts (3) → requeued
    expect(result.requeued).toBe(1)
    expect(result.failed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// file_upload – ZIP analysis success
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – file_upload ZIP success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes a zip file_upload job successfully', async () => {
    const zipFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'file_upload' as const,
      file_type: 'application/zip',
    }

    vi.mocked(analyzeZipArchiveWithClaude).mockResolvedValue({
      summary: 'Zip archive analysis summary',
      systemType: 'Web Application',
      techStack: ['React'],
      architecture: ['SPA'],
      keyModules: [{ path: 'src/ui', purpose: 'UI components' }],
      risks: ['dependency age'],
      changeImpactPoints: ['routing'],
      recommendedQuestions: ['Build process?'],
      snapshot: {
        totalEntries: 1,
        totalFiles: 1,
        totalUncompressedBytes: 100,
        topDirectories: ['src'],
        sampledFiles: [],
        sampledChars: 0,
      },
    })
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobFileUpload = { ...QUEUED_JOB, job_kind: 'file_upload' as const }
    const lockedJobFileUpload = { ...LOCKED_JOB, job_kind: 'file_upload' as const }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobFileUpload, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: zipFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'conversations') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const storageMock = {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: { arrayBuffer: async () => Buffer.from('PK fake zip').buffer },
          error: null,
        }),
      }),
    }

    const processingSupabase = { from: fromFn, storage: storageMock } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobFileUpload], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.succeeded).toBe(1)
    expect(vi.mocked(analyzeZipArchiveWithClaude)).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// file_upload – PDF analysis success
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – file_upload PDF success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes a PDF file_upload job successfully', async () => {
    const pdfFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'file_upload' as const,
      file_type: 'application/pdf',
      file_name: 'spec.pdf',
      file_path: 'path/to/spec.pdf',
    }

    vi.mocked(extractTextFromPdfBuffer).mockReturnValue('extracted text')
    vi.mocked(analyzePdfWithClaude).mockResolvedValue({
      summary: 'PDF analysis summary',
      extractedTextLength: 100,
      keyPoints: ['point 1'],
      risks: ['risk A'],
      changeImpactPoints: ['impact X'],
      recommendedQuestions: ['Q1?'],
    })
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobFileUpload = { ...QUEUED_JOB, job_kind: 'file_upload' as const }
    const lockedJobFileUpload = { ...LOCKED_JOB, job_kind: 'file_upload' as const }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobFileUpload, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: pdfFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'conversations') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const storageMock = {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: { arrayBuffer: async () => Buffer.from('%PDF-1.4').buffer },
          error: null,
        }),
      }),
    }

    const processingSupabase = { from: fromFn, storage: storageMock } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobFileUpload], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.succeeded).toBe(1)
    expect(vi.mocked(analyzePdfWithClaude)).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// file_upload – image analysis success (supported mime type)
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – file_upload image success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes a PNG image file_upload job via vision analysis', async () => {
    const imageFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'file_upload' as const,
      file_type: 'image/png',
      file_name: 'mockup.png',
      file_path: 'path/to/mockup.png',
    }

    vi.mocked(validateImageSize).mockReturnValue(undefined)
    vi.mocked(buildImageBlock).mockReturnValue({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: '' },
    } as ReturnType<typeof buildImageBlock>)
    vi.mocked(sendVisionMessage).mockResolvedValue(JSON.stringify({
      image_type: 'UIモックアップ',
      ui_elements: ['ボタン', 'フォーム'],
      layout_structure: '1カラム',
      functional_estimate: 'ログイン画面',
      dev_complexity_notes: ['バリデーション'],
      summary: '画像分析結果',
    }))
    vi.mocked(parseJsonFromResponse).mockReturnValue({
      image_type: 'UIモックアップ',
      ui_elements: ['ボタン', 'フォーム'],
      layout_structure: '1カラム',
      functional_estimate: 'ログイン画面',
      dev_complexity_notes: ['バリデーション'],
      summary: '画像分析結果',
    })
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobFileUpload = { ...QUEUED_JOB, job_kind: 'file_upload' as const }
    const lockedJobFileUpload = { ...LOCKED_JOB, job_kind: 'file_upload' as const }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobFileUpload, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: imageFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'conversations') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const storageMock = {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: { arrayBuffer: async () => Buffer.from('fake png data').buffer },
          error: null,
        }),
      }),
    }

    const processingSupabase = { from: fromFn, storage: storageMock } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobFileUpload], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.succeeded).toBe(1)
    expect(vi.mocked(sendVisionMessage)).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// file_upload – unsupported MIME type → returns unsupported result
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – file_upload unsupported type', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks job as succeeded with unsupported type result for unknown mime type', async () => {
    const unknownFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'file_upload' as const,
      file_type: 'text/plain',
      file_name: 'notes.txt',
    }

    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobFileUpload = { ...QUEUED_JOB, job_kind: 'file_upload' as const }
    const lockedJobFileUpload = { ...LOCKED_JOB, job_kind: 'file_upload' as const }

    const conversationsInsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobFileUpload, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: unknownFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'conversations') {
        return { insert: conversationsInsertMock }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const processingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobFileUpload], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.succeeded).toBe(1)
    // Unsupported type still inserts a conversation message
    expect(conversationsInsertMock).toHaveBeenCalledOnce()
    const insertArg = conversationsInsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.content).toContain('添付資料を解析しました')
  })
})

// ---------------------------------------------------------------------------
// Error handling – quota error causes permanent failure
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – quota error causes final failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks job as failed immediately on ExternalApiQuotaError', async () => {
    const githubFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'repository_url' as const,
      source_url: 'https://github.com/org/repo',
      file_type: null,
    }

    vi.mocked(isGitHubUrl).mockReturnValue(true)
    vi.mocked(analyzeRepositoryUrlWithClaude).mockRejectedValue(
      new ExternalApiQuotaError({
        sourceKey: 'anthropic',
        provider: 'anthropic',
        quotaType: 'daily_request_limit',
        limit: 100,
        used: 100,
        message: 'Quota exceeded',
      })
    )
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobWithRepoKind = { ...QUEUED_JOB, job_kind: 'repository_url' as const }
    const lockedJobWithRepoKind = {
      ...LOCKED_JOB,
      job_kind: 'repository_url' as const,
      attempt_count: 1,
      max_attempts: 3,
    }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobWithRepoKind, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: githubFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const processingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobWithRepoKind], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    // Quota error → isFinal=true → failed
    expect(result.failed).toBe(1)
    expect(result.succeeded).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Error handling – max_attempts exceeded causes permanent failure
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – max_attempts exceeded causes final failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks job as failed when attempt_count >= max_attempts on error', async () => {
    const githubFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'repository_url' as const,
      source_url: 'https://github.com/org/repo',
      file_type: null,
    }

    vi.mocked(isGitHubUrl).mockReturnValue(true)
    vi.mocked(analyzeRepositoryUrlWithClaude).mockRejectedValue(
      new Error('Transient network error')
    )
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobWithRepoKind = { ...QUEUED_JOB, job_kind: 'repository_url' as const }
    // attempt_count === max_attempts → final failure
    const lockedJobAtMaxAttempts = {
      ...LOCKED_JOB,
      job_kind: 'repository_url' as const,
      attempt_count: 3,
      max_attempts: 3,
    }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobAtMaxAttempts, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: githubFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const processingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobWithRepoKind], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.failed).toBe(1)
    expect(result.succeeded).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Error handling – transient error below max_attempts → requeued
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – transient error below max_attempts → requeued', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requeues job on transient error when attempt_count < max_attempts', async () => {
    const githubFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'repository_url' as const,
      source_url: 'https://github.com/org/repo',
      file_type: null,
    }

    vi.mocked(isGitHubUrl).mockReturnValue(true)
    vi.mocked(analyzeRepositoryUrlWithClaude).mockRejectedValue(
      new Error('Temporary service unavailable')
    )
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobWithRepoKind = { ...QUEUED_JOB, job_kind: 'repository_url' as const }
    const lockedJobLowAttempts = {
      ...LOCKED_JOB,
      job_kind: 'repository_url' as const,
      attempt_count: 1,
      max_attempts: 3,
    }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobLowAttempts, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: githubFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const processingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobWithRepoKind], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.requeued).toBe(1)
    expect(result.failed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// project_file not found throws → requeued or failed
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – project file not found', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requeues job when project file cannot be found in DB (attempt < max)', async () => {
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobFileUpload = { ...QUEUED_JOB, job_kind: 'file_upload' as const }
    const lockedJobFileUpload = {
      ...LOCKED_JOB,
      job_kind: 'file_upload' as const,
      attempt_count: 1,
      max_attempts: 3,
    }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobFileUpload, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const processingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobFileUpload], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    // attempt < max_attempts → requeued
    expect(result.requeued).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// runQueuedSourceAnalysisJobs with projectId filter
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – projectId filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies projectId filter when provided and returns correct scanned count', async () => {
    const supabase = {} as SupabaseClient

    // The Supabase query builder is a chainable thenable (PromiseLike).
    // After .limit(), the code may call .eq() if projectId is provided, then `await query`.
    // We need every chain method to return a chainable-thenable object.
    const eqMock = vi.fn()
    const lteMock = vi.fn()
    const orderMock = vi.fn()
    const limitMock = vi.fn()

    const finalResult = { data: [], error: null }

    // A chainable thenable: supports further chaining AND can be awaited directly.
    function makeChainable(): Record<string, unknown> {
      const obj: Record<string, unknown> = {
        eq: eqMock,
        lte: lteMock,
        order: orderMock,
        limit: limitMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(finalResult).then(resolve),
      }
      return obj
    }

    const chainable = makeChainable()
    eqMock.mockReturnValue(chainable)
    lteMock.mockReturnValue(chainable)
    orderMock.mockReturnValue(chainable)
    limitMock.mockReturnValue(chainable)

    ;(supabase as unknown as { from: MockInstance }).from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(chainable),
    })

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      projectId: 'specific-project',
      limit: 3,
    })

    expect(result.scanned).toBe(0)
    // .eq() should be called at least for status='queued' and project_id='specific-project'
    expect(eqMock).toHaveBeenCalled()
    const eqCallArgs = eqMock.mock.calls.map((c: unknown[]) => c[0])
    expect(eqCallArgs).toContain('project_id')
  })
})

// ---------------------------------------------------------------------------
// image with unsupported MIME type falls back to text-only analysis
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – image fallback for unsupported MIME', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses fallbackImageAnalysis for unsupported image MIME types', async () => {
    const unsupportedImageFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'file_upload' as const,
      file_type: 'image/tiff', // not in supported list
      file_name: 'design.tiff',
    }

    vi.mocked(sendMessage).mockResolvedValue('テキストベースのフォールバック分析結果')
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobFileUpload = { ...QUEUED_JOB, job_kind: 'file_upload' as const }
    const lockedJobFileUpload = { ...LOCKED_JOB, job_kind: 'file_upload' as const }

    const conversationsInsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobFileUpload, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: unsupportedImageFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'conversations') {
        return { insert: conversationsInsertMock }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const processingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobFileUpload], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.succeeded).toBe(1)
    // sendMessage is used in fallbackImageAnalysis
    expect(vi.mocked(sendMessage)).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// storage download failure causes requeue
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – storage download failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requeues job when storage download fails for ZIP file', async () => {
    const zipFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'file_upload' as const,
      file_type: 'application/zip',
    }

    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobFileUpload = { ...QUEUED_JOB, job_kind: 'file_upload' as const }
    const lockedJobFileUpload = {
      ...LOCKED_JOB,
      job_kind: 'file_upload' as const,
      attempt_count: 1,
      max_attempts: 3,
    }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobFileUpload, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: zipFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const storageMock = {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'bucket not found' },
        }),
      }),
    }

    const processingSupabase = { from: fromFn, storage: storageMock } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobFileUpload], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    expect(result.requeued).toBe(1)
    expect(result.succeeded).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// safeErrorMessage – non-Error objects
// ---------------------------------------------------------------------------

describe('safeErrorMessage edge cases (via job processing)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles non-Error thrown values gracefully (string thrown)', async () => {
    const githubFile = {
      ...MOCK_PROJECT_FILE,
      source_kind: 'repository_url' as const,
      source_url: 'https://github.com/org/repo',
      file_type: null,
    }

    vi.mocked(isGitHubUrl).mockReturnValue(true)
    // Throw a plain string instead of an Error instance
    vi.mocked(analyzeRepositoryUrlWithClaude).mockRejectedValue('plain string error')
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const jobWithRepoKind = { ...QUEUED_JOB, job_kind: 'repository_url' as const }
    const lockedJobWithRepoKind = {
      ...LOCKED_JOB,
      job_kind: 'repository_url' as const,
      attempt_count: 3,
      max_attempts: 3,
    }

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJobWithRepoKind, error: null })
            return chain
          }),
        }
      }
      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: githubFile, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return {}
    })

    const processingSupabase = { from: fromFn, storage: {} } as unknown as SupabaseClient
    const supabase = buildFullRunSupabase([jobWithRepoKind], processingSupabase)

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 5,
    })

    // Should still complete, max_attempts reached → failed
    expect(result.failed).toBe(1)
    // audit log payload should have the fallback error message
    const auditLogCalls = vi.mocked(writeAuditLog).mock.calls
    const failureLogCall = auditLogCalls.find(
      (call) => (call[1] as { action: string }).action === 'project_file.analysis_failed'
    )
    expect(failureLogCall).toBeDefined()
    const payload = (failureLogCall![1] as { payload: Record<string, unknown> }).payload
    expect(payload.error).toBe('解析中に不明なエラーが発生しました')
  })
})

// ---------------------------------------------------------------------------
// Multiple jobs in one run
// ---------------------------------------------------------------------------

describe('runQueuedSourceAnalysisJobs – multiple jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates counts across multiple jobs processed in sequence', async () => {
    vi.mocked(writeAuditLog).mockResolvedValue(undefined)

    const job1 = { ...QUEUED_JOB, id: 'job-a', job_kind: 'file_upload' as const }
    const job2 = { ...QUEUED_JOB, id: 'job-b', job_kind: 'file_upload' as const }

    let scanCalled = false
    let lockCallCount = 0

    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_analysis_jobs' && !scanCalled) {
        scanCalled = true
        const chain: Record<string, unknown> = {}
        const methods = ['eq', 'lte', 'order', 'limit']
        for (const m of methods) {
          chain[m] = vi.fn().mockReturnValue(chain)
        }
        ;(chain as { limit: MockInstance }).limit = vi.fn().mockResolvedValue({ data: [job1, job2], error: null })
        return { select: vi.fn().mockReturnValue(chain) }
      }

      if (table === 'source_analysis_jobs') {
        return {
          update: vi.fn().mockImplementation(() => {
            lockCallCount++
            const lockedJob = {
              ...LOCKED_JOB,
              job_kind: 'file_upload' as const,
              id: lockCallCount <= 2 ? 'job-a' : 'job-b',
            }
            const chain: Record<string, unknown> = {}
            chain['eq'] = vi.fn().mockReturnValue(chain)
            chain['select'] = vi.fn().mockReturnValue(chain)
            chain['single'] = vi.fn().mockResolvedValue({ data: lockedJob, error: null })
            return chain
          }),
        }
      }

      if (table === 'project_files') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { ...MOCK_PROJECT_FILE, file_type: 'text/plain' },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }
      }

      if (table === 'conversations') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }

      return {}
    })

    const supabase = { from: fromFn, storage: {} } as unknown as SupabaseClient

    const result = await runQueuedSourceAnalysisJobs(supabase, {
      actorClerkUserId: ACTOR_USER_ID,
      limit: 10,
    })

    expect(result.scanned).toBe(2)
    expect(result.processed).toBe(2)
    expect(result.succeeded).toBe(2)
  })
})
