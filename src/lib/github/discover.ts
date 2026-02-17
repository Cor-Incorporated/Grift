import type { SupabaseClient } from '@supabase/supabase-js'
import { analyzeRepoVelocity, type RepoVelocity } from './velocity'
import { logger } from '@/lib/utils/logger'

export interface GitHubRepoInfo {
  orgName: string
  repoName: string
  description: string | null
  language: string | null
  stars: number
  topics: string[]
  defaultBranch: string
  updatedAt: string
}

interface GitHubApiRepo {
  name: string
  full_name: string
  description: string | null
  language: string | null
  stargazers_count: number
  topics: string[]
  default_branch: string
  updated_at: string
  owner: {
    login: string
  }
}

function getGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const resolvedToken = token ?? process.env.GITHUB_TOKEN
  if (resolvedToken) {
    headers.Authorization = `Bearer ${resolvedToken}`
  }

  return headers
}

function extractOrgName(input: string): string {
  const trimmed = input.trim()
  // Handle full URLs like "https://github.com/Cor-Incorporated"
  const urlMatch = trimmed.match(/(?:https?:\/\/)?github\.com\/([^/\s]+)\/?$/)
  if (urlMatch) {
    return urlMatch[1]
  }
  // Already just an org name
  return trimmed
}

function mapApiRepo(repo: GitHubApiRepo): GitHubRepoInfo {
  return {
    orgName: repo.owner.login,
    repoName: repo.name,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    topics: repo.topics ?? [],
    defaultBranch: repo.default_branch,
    updatedAt: repo.updated_at,
  }
}

async function fetchAllPages(
  url: string,
  headers: Record<string, string>
): Promise<GitHubApiRepo[]> {
  const allRepos: GitHubApiRepo[] = []
  let nextUrl: string | null = url

  while (nextUrl) {
    const response: Response = await fetch(nextUrl, { headers })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    const repos = (await response.json()) as GitHubApiRepo[]
    allRepos.push(...repos)

    // Parse Link header for pagination
    const linkHeader: string | null = response.headers.get('Link')
    nextUrl = null
    if (linkHeader) {
      const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      if (nextMatch) {
        nextUrl = nextMatch[1]
      }
    }
  }

  return allRepos
}

export async function discoverUserRepos(
  token?: string
): Promise<GitHubRepoInfo[]> {
  const headers = getGitHubHeaders(token)
  const url = 'https://api.github.com/user/repos?type=owner&sort=updated&per_page=100'
  const repos = await fetchAllPages(url, headers)
  return repos.map(mapApiRepo)
}

export async function discoverOrgRepos(
  org: string,
  token?: string
): Promise<GitHubRepoInfo[]> {
  const orgName = extractOrgName(org)
  const headers = getGitHubHeaders(token)
  const url = `https://api.github.com/orgs/${encodeURIComponent(orgName)}/repos?type=all&sort=updated&per_page=100`

  try {
    const repos = await fetchAllPages(url, headers)
    return repos.map(mapApiRepo)
  } catch (error) {
    // If org endpoint fails (e.g. user account, not an org), try user repos endpoint
    if (error instanceof Error && error.message.includes('404')) {
      const userUrl = `https://api.github.com/users/${encodeURIComponent(orgName)}/repos?type=owner&sort=updated&per_page=100`
      const repos = await fetchAllPages(userUrl, headers)
      return repos.map(mapApiRepo)
    }
    throw error
  }
}

export interface SyncResult {
  synced: number
  created: number
  updated: number
}

export async function syncReposToDatabase(input: {
  supabase: SupabaseClient
  repos: GitHubRepoInfo[]
  createdByClerkUserId: string
}): Promise<SyncResult> {
  const { supabase, repos, createdByClerkUserId } = input

  if (repos.length === 0) {
    return { synced: 0, created: 0, updated: 0 }
  }

  let created = 0
  let updated = 0

  // Batch upsert in chunks of 50
  const chunkSize = 50
  for (let i = 0; i < repos.length; i += chunkSize) {
    const chunk = repos.slice(i, i + chunkSize)

    const rows = chunk.map((repo) => ({
      org_name: repo.orgName,
      repo_name: repo.repoName,
      description: repo.description,
      language: repo.language,
      stars: repo.stars,
      topics: repo.topics,
      synced_at: new Date().toISOString(),
      created_by_clerk_user_id: createdByClerkUserId,
      updated_at: new Date().toISOString(),
    }))

    // Check existing repos to determine create vs update counts
    const orgRepoKeys = chunk.map((r) => `${r.orgName}/${r.repoName}`)
    const { data: existing } = await supabase
      .from('github_references')
      .select('org_name, repo_name')
      .in('full_name', orgRepoKeys)

    const existingSet = new Set(
      (existing ?? []).map((e: { org_name: string; repo_name: string }) =>
        `${e.org_name}/${e.repo_name}`
      )
    )

    for (const repo of chunk) {
      if (existingSet.has(`${repo.orgName}/${repo.repoName}`)) {
        updated++
      } else {
        created++
      }
    }

    const { error } = await supabase
      .from('github_references')
      .upsert(rows, {
        onConflict: 'org_name,repo_name',
        ignoreDuplicates: false,
      })

    if (error) {
      throw new Error(`リポジトリの同期に失敗しました: ${error.message}`)
    }
  }

  return {
    synced: repos.length,
    created,
    updated,
  }
}

export async function analyzeAndSaveVelocity(input: {
  supabase: SupabaseClient
  repoId: string
  orgName: string
  repoName: string
  token?: string
}): Promise<RepoVelocity | null> {
  try {
    const velocity = await analyzeRepoVelocity(
      input.orgName,
      input.repoName,
      input.token
    )

    const { error } = await input.supabase
      .from('github_references')
      .update({
        first_commit_date: velocity.firstCommitDate,
        last_commit_date: velocity.lastCommitDate,
        total_commits: velocity.totalCommits,
        commits_per_week: velocity.commitsPerWeek,
        contributor_count: velocity.contributorCount,
        core_contributors: velocity.coreContributors,
        total_additions: velocity.totalAdditions,
        total_deletions: velocity.totalDeletions,
        velocity_data: velocity as unknown as Record<string, unknown>,
        velocity_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.repoId)

    if (error) {
      throw new Error(`Velocity保存に失敗しました: ${error.message}`)
    }

    return velocity
  } catch (error) {
    logger.error('Velocity analysis failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
