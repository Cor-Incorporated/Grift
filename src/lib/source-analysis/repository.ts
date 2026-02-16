import { analyzeZipArchiveWithClaude, type ZipAnalysisResult } from '@/lib/source-analysis/zip'
import type { UsageCallContext } from '@/lib/usage/api-usage'

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const MAX_REPOSITORY_ARCHIVE_BYTES = 25 * 1024 * 1024

interface ParsedGitHubUrl {
  owner: string
  repo: string
  branch?: string
}

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'BenevolentDirector/1.0',
  }

  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  return headers
}

export interface RepositoryAnalysisResult {
  repository: {
    url: string
    owner: string
    repo: string
    branch: string
    archiveUrl: string
  }
  analysis: ZipAnalysisResult
  archiveBytes: number
}

function parseGitHubRepositoryUrl(rawUrl: string): ParsedGitHubUrl {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('URL 形式が不正です')
  }

  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('現在は GitHub リポジトリURLのみ対応しています')
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) {
    throw new Error('GitHub リポジトリURLを指定してください')
  }

  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, '')
  if (!owner || !repo) {
    throw new Error('GitHub リポジトリURLの owner/repo を解釈できませんでした')
  }

  let branch: string | undefined
  const treeIndex = segments.findIndex((segment) => segment === 'tree')
  if (treeIndex >= 0 && segments.length > treeIndex + 1) {
    branch = segments[treeIndex + 1]
  }

  return { owner, repo, branch }
}

export function isGitHubUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)

    if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
      return false
    }

    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length < 2) {
      return false
    }

    return true
  } catch {
    return false
  }
}

async function resolveDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: getGitHubHeaders(),
    cache: 'no-store',
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('GitHub リポジトリが見つかりません（非公開の可能性があります）')
    }
    throw new Error(`GitHub API からデフォルトブランチを取得できませんでした (${response.status})`)
  }

  const data = (await response.json()) as { default_branch?: unknown }
  const branch = typeof data.default_branch === 'string' ? data.default_branch : ''
  if (!branch) {
    throw new Error('GitHub リポジトリの default_branch が取得できませんでした')
  }
  return branch
}

async function downloadRepositoryArchive(owner: string, repo: string, branch: string): Promise<{
  archiveBuffer: Buffer
  archiveUrl: string
}> {
  const archiveUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`
  const response = await fetch(archiveUrl, {
    headers: getGitHubHeaders(),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`リポジトリアーカイブの取得に失敗しました (${response.status})`)
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_REPOSITORY_ARCHIVE_BYTES) {
    throw new Error('リポジトリアーカイブサイズが上限を超えています')
  }

  return {
    archiveBuffer: Buffer.from(arrayBuffer),
    archiveUrl,
  }
}

export async function analyzeRepositoryUrlWithClaude(
  repositoryUrl: string,
  usageContext?: UsageCallContext
): Promise<RepositoryAnalysisResult> {
  const parsed = parseGitHubRepositoryUrl(repositoryUrl)
  const branch = parsed.branch ?? (await resolveDefaultBranch(parsed.owner, parsed.repo))

  const { archiveBuffer, archiveUrl } = await downloadRepositoryArchive(parsed.owner, parsed.repo, branch)
  const analysis = await analyzeZipArchiveWithClaude({
    archiveName: `${parsed.owner}/${parsed.repo}@${branch}.zip`,
    archiveBuffer,
    usageContext,
  })

  return {
    repository: {
      url: repositoryUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      archiveUrl,
    },
    analysis,
    archiveBytes: archiveBuffer.length,
  }
}
