export interface RepoVelocity {
  firstCommitDate: string
  lastCommitDate: string
  totalDevelopmentDays: number
  activeDevelopmentDays: number
  totalCommits: number
  commitsPerWeek: number
  commitsPerActiveDay: number
  contributorCount: number
  coreContributors: number
  totalAdditions: number
  totalDeletions: number
  churnRate: number
  releases: Array<{
    tag: string
    date: string
    weeksFromStart: number
  }>
  estimatedHours: number
  velocityScore: number
}

interface GitHubCommitActivityWeek {
  total: number
  week: number
  days: number[]
}

interface GitHubContributorStats {
  author: {
    login: string
  }
  total: number
  weeks: Array<{
    w: number
    a: number
    d: number
    c: number
  }>
}

interface GitHubRelease {
  tag_name: string
  published_at: string
}

type CodeFrequencyWeek = [number, number, number] // [timestamp, additions, deletions]

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

async function fetchWithStatsRetry(
  url: string,
  headers: Record<string, string>
): Promise<Response> {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { headers })
    if (res.status === 200) return res
    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
      continue
    }
    if (res.status === 204) {
      return res
    }
    throw new Error(`GitHub API error: ${res.status}`)
  }
  throw new Error('GitHub stats computation timed out')
}

function computeActiveDays(weeklyData: GitHubCommitActivityWeek[]): number {
  let activeDays = 0
  for (const week of weeklyData) {
    for (const dayCommits of week.days) {
      if (dayCommits > 0) {
        activeDays++
      }
    }
  }
  return activeDays
}

function computeCoreContributors(
  contributors: GitHubContributorStats[],
  totalCommits: number
): number {
  const threshold = totalCommits * 0.1
  return contributors.filter((c) => c.total >= threshold).length
}

function computeVelocityScore(input: {
  commitsPerWeek: number
  activeDaysRatio: number
  contributorEfficiency: number
}): number {
  // commitsPerWeek: 0-40 range mapped to 0-40 points
  const commitScore = Math.min(40, (input.commitsPerWeek / 40) * 40)

  // activeDaysRatio: 0-1 mapped to 0-30 points
  const activityScore = input.activeDaysRatio * 30

  // contributorEfficiency (commits per contributor per week): 0-10 mapped to 0-30 points
  const efficiencyScore = Math.min(30, (input.contributorEfficiency / 10) * 30)

  return Math.round(Math.min(100, commitScore + activityScore + efficiencyScore))
}

function computeEstimatedHours(input: {
  totalCommits: number
  churnRate: number
}): number {
  // Base: ~2 hours per commit for medium complexity
  const baseHoursPerCommit = 2
  // Scale by churn rate: high churn = more refactoring = more time
  const churnMultiplier = 1 + Math.min(input.churnRate, 2) * 0.25
  return Math.round(input.totalCommits * baseHoursPerCommit * churnMultiplier)
}

export async function analyzeRepoVelocity(
  owner: string,
  repo: string,
  token?: string
): Promise<RepoVelocity> {
  const headers = getGitHubHeaders(token)
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  // Fetch all stats endpoints in parallel
  const [commitActivityRes, contributorsRes, releasesRes, codeFreqRes] =
    await Promise.all([
      fetchWithStatsRetry(`${baseUrl}/stats/commit_activity`, headers),
      fetchWithStatsRetry(`${baseUrl}/stats/contributors`, headers),
      fetch(`${baseUrl}/releases?per_page=100`, { headers }).then((res) => {
        if (!res.ok && res.status !== 404) {
          throw new Error(`GitHub API error: ${res.status}`)
        }
        return res
      }),
      fetchWithStatsRetry(`${baseUrl}/stats/code_frequency`, headers),
    ])

  // Parse commit activity (weekly data for last 52 weeks)
  const commitActivity: GitHubCommitActivityWeek[] =
    commitActivityRes.status === 204
      ? []
      : await commitActivityRes.json()

  // Parse contributor stats
  const contributors: GitHubContributorStats[] =
    contributorsRes.status === 204
      ? []
      : await contributorsRes.json()

  // Parse releases
  const releases: GitHubRelease[] =
    releasesRes.status === 404 || releasesRes.status === 204
      ? []
      : await releasesRes.json()

  // Parse code frequency
  const codeFrequency: CodeFrequencyWeek[] =
    codeFreqRes.status === 204
      ? []
      : await codeFreqRes.json()

  // Compute totals from contributor stats (more accurate than commit_activity)
  const totalCommits = contributors.reduce((sum, c) => sum + c.total, 0)
  const contributorCount = contributors.length

  // Find first and last commit dates from contributor week data
  const allWeekTimestamps = contributors.flatMap((c) =>
    c.weeks.filter((w) => w.c > 0).map((w) => w.w)
  )

  const firstCommitTimestamp =
    allWeekTimestamps.length > 0
      ? Math.min(...allWeekTimestamps) * 1000
      : Date.now()
  const lastCommitTimestamp =
    allWeekTimestamps.length > 0
      ? Math.max(...allWeekTimestamps) * 1000
      : Date.now()

  const firstCommitDate = new Date(firstCommitTimestamp).toISOString()
  const lastCommitDate = new Date(lastCommitTimestamp).toISOString()

  const totalDevelopmentDays = Math.max(
    1,
    Math.ceil(
      (lastCommitTimestamp - firstCommitTimestamp) / (1000 * 60 * 60 * 24)
    )
  )
  const totalWeeks = Math.max(1, totalDevelopmentDays / 7)

  // Active development days from weekly commit activity
  const activeDevelopmentDays =
    commitActivity.length > 0
      ? computeActiveDays(commitActivity)
      : Math.max(1, Math.ceil(totalCommits / 3)) // fallback estimate

  const commitsPerWeek =
    Math.round((totalCommits / totalWeeks) * 100) / 100

  const commitsPerActiveDay =
    Math.round((totalCommits / Math.max(1, activeDevelopmentDays)) * 100) / 100

  const coreContributors = computeCoreContributors(contributors, totalCommits)

  // Code churn from code_frequency
  const totalAdditions = codeFrequency.reduce(
    (sum, week) => sum + Math.max(0, week[1]),
    0
  )
  const totalDeletions = codeFrequency.reduce(
    (sum, week) => sum + Math.abs(week[2]),
    0
  )
  const churnRate =
    Math.round((totalDeletions / Math.max(1, totalAdditions)) * 1000) / 1000

  // Format releases
  const formattedReleases = releases
    .filter((r) => r.published_at)
    .map((r) => {
      const releaseDate = new Date(r.published_at)
      const weeksFromStart = Math.round(
        (releaseDate.getTime() - firstCommitTimestamp) / (1000 * 60 * 60 * 24 * 7)
      )
      return {
        tag: r.tag_name,
        date: r.published_at,
        weeksFromStart: Math.max(0, weeksFromStart),
      }
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const estimatedHours = computeEstimatedHours({ totalCommits, churnRate })

  const activeDaysRatio = activeDevelopmentDays / Math.max(1, totalDevelopmentDays)
  const contributorEfficiency =
    contributorCount > 0
      ? commitsPerWeek / contributorCount
      : 0

  const velocityScore = computeVelocityScore({
    commitsPerWeek,
    activeDaysRatio,
    contributorEfficiency,
  })

  return {
    firstCommitDate,
    lastCommitDate,
    totalDevelopmentDays,
    activeDevelopmentDays,
    totalCommits,
    commitsPerWeek,
    commitsPerActiveDay,
    contributorCount,
    coreContributors,
    totalAdditions,
    totalDeletions,
    churnRate,
    releases: formattedReleases,
    estimatedHours,
    velocityScore,
  }
}
