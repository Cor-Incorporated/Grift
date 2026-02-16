'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'
import type { GitHubReference } from '@/types/database'

interface ApiResponse<T> {
  success: boolean
  error?: string
  data?: T
}

interface ProfileData {
  id: string | null
  display_name: string
  default_hourly_rate: number
  github_orgs: string[]
}

type ShowcaseFilter = 'all' | 'showcase' | 'non-showcase'

export default function GitHubPage() {
  const [repos, setRepos] = useState<GitHubReference[]>([])
  const [githubOrgs, setGithubOrgs] = useState<string[]>([])
  const [newOrg, setNewOrg] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ShowcaseFilter>('all')
  const [editingHours, setEditingHours] = useState<Record<string, string>>({})

  const fetchRepos = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/github/repos')
      const payload = (await response.json()) as ApiResponse<GitHubReference[]>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'リポジトリ一覧の取得に失敗しました')
      }

      setRepos(payload.data ?? [])
    } catch {
      toast.error('リポジトリ一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchProfile = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/profile')
      const payload = (await response.json()) as ApiResponse<ProfileData>

      if (response.ok && payload.success && payload.data) {
        setGithubOrgs(payload.data.github_orgs)
      }
    } catch {
      // Profile fetch failure is non-critical
    }
  }, [])

  useEffect(() => {
    fetchRepos()
    fetchProfile()
  }, [fetchRepos, fetchProfile])

  const handleSync = async () => {
    if (githubOrgs.length === 0) {
      toast.error('GitHub Organization を追加してください')
      return
    }

    setSyncing(true)

    try {
      const response = await fetch('/api/admin/github/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgs: githubOrgs }),
      })
      const payload = (await response.json()) as ApiResponse<{
        synced: number
        created: number
        updated: number
      }>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? '同期に失敗しました')
      }

      toast.success(
        `同期完了: ${payload.data?.synced ?? 0}件 (新規${payload.data?.created ?? 0} / 更新${payload.data?.updated ?? 0})`
      )
      await fetchRepos()
    } catch (error) {
      const message = error instanceof Error ? error.message : '同期に失敗しました'
      toast.error(message)
    } finally {
      setSyncing(false)
    }
  }

  const handleToggleShowcase = async (repo: GitHubReference) => {
    try {
      const response = await fetch(`/api/admin/github/repos/${repo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_showcase: !repo.is_showcase }),
      })
      const payload = (await response.json()) as ApiResponse<GitHubReference>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? '更新に失敗しました')
      }

      setRepos((prev) =>
        prev.map((r) =>
          r.id === repo.id ? { ...r, is_showcase: !r.is_showcase } : r
        )
      )
    } catch {
      toast.error('Showcase 切り替えに失敗しました')
    }
  }

  const handleHoursBlur = async (repo: GitHubReference) => {
    const raw = editingHours[repo.id]
    if (raw === undefined) return

    const hours = Number(raw)
    if (!Number.isFinite(hours) || hours < 0) {
      toast.error('有効な時間数を入力してください')
      setEditingHours((prev) => {
        const next = { ...prev }
        delete next[repo.id]
        return next
      })
      return
    }

    try {
      const response = await fetch(`/api/admin/github/repos/${repo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours_spent: hours }),
      })
      const payload = (await response.json()) as ApiResponse<GitHubReference>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? '更新に失敗しました')
      }

      setRepos((prev) =>
        prev.map((r) =>
          r.id === repo.id ? { ...r, hours_spent: hours } : r
        )
      )
      setEditingHours((prev) => {
        const next = { ...prev }
        delete next[repo.id]
        return next
      })
    } catch {
      toast.error('工数の更新に失敗しました')
    }
  }

  const handleAnalyze = async (repo: GitHubReference) => {
    setAnalyzingId(repo.id)

    try {
      const response = await fetch(`/api/admin/github/repos/${repo.id}`, {
        method: 'POST',
      })
      const payload = (await response.json()) as ApiResponse<unknown>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? '解析に失敗しました')
      }

      toast.success(`${repo.org_name}/${repo.repo_name} の解析が完了しました`)
      await fetchRepos()
    } catch (error) {
      const message = error instanceof Error ? error.message : '解析に失敗しました'
      toast.error(message)
    } finally {
      setAnalyzingId(null)
    }
  }

  const handleAddOrg = async () => {
    const trimmed = newOrg.trim()
    if (!trimmed) return
    if (githubOrgs.includes(trimmed)) {
      toast.error('この Organization は既に追加されています')
      return
    }

    const updatedOrgs = [...githubOrgs, trimmed]

    try {
      const response = await fetch('/api/admin/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: 'Admin',
          default_hourly_rate: 15000,
          github_orgs: updatedOrgs,
        }),
      })
      const payload = (await response.json()) as ApiResponse<ProfileData>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Organization の追加に失敗しました')
      }

      setGithubOrgs(updatedOrgs)
      setNewOrg('')
      toast.success(`${trimmed} を追加しました`)
    } catch {
      toast.error('Organization の追加に失敗しました')
    }
  }

  const handleRemoveOrg = async (org: string) => {
    const updatedOrgs = githubOrgs.filter((o) => o !== org)

    try {
      const profileRes = await fetch('/api/admin/profile')
      const profilePayload = (await profileRes.json()) as ApiResponse<ProfileData>
      const currentProfile = profilePayload.data

      const response = await fetch('/api/admin/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: currentProfile?.display_name ?? 'Admin',
          default_hourly_rate: currentProfile?.default_hourly_rate ?? 15000,
          github_orgs: updatedOrgs,
        }),
      })
      const payload = (await response.json()) as ApiResponse<ProfileData>

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Organization の削除に失敗しました')
      }

      setGithubOrgs(updatedOrgs)
      toast.success(`${org} を削除しました`)
    } catch {
      toast.error('Organization の削除に失敗しました')
    }
  }

  const filteredRepos = repos.filter((repo) => {
    if (filter === 'showcase') return repo.is_showcase
    if (filter === 'non-showcase') return !repo.is_showcase
    return true
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">GitHub 連携</h1>
        <p className="text-muted-foreground">
          GitHub Organization のリポジトリを同期して過去実績を管理します
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>GitHub Organizations</CardTitle>
          <CardDescription>
            同期対象の Organization を管理します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {githubOrgs.map((org) => (
              <Badge key={org} variant="secondary" className="gap-1 px-3 py-1">
                {org}
                <button
                  type="button"
                  onClick={() => handleRemoveOrg(org)}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  aria-label={`${org} を削除`}
                >
                  x
                </button>
              </Badge>
            ))}
            {githubOrgs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Organization が未登録です
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Organization 名を入力..."
              value={newOrg}
              onChange={(e) => setNewOrg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddOrg()
                }
              }}
              className="max-w-xs"
            />
            <Button variant="outline" onClick={handleAddOrg} disabled={!newOrg.trim()}>
              追加
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>リポジトリ一覧</CardTitle>
              <CardDescription>
                {filteredRepos.length}件のリポジトリ
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {(['all', 'showcase', 'non-showcase'] as const).map((f) => (
                  <Button
                    key={f}
                    variant={filter === f ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? '全て' : f === 'showcase' ? 'Showcase' : '非Showcase'}
                  </Button>
                ))}
              </div>
              <Button onClick={handleSync} disabled={syncing || githubOrgs.length === 0}>
                {syncing ? '同期中...' : 'リポジトリ同期'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          ) : filteredRepos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              リポジトリがありません。Organization を追加して同期を実行してください。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium">リポジトリ</th>
                    <th className="pb-2 pr-4 font-medium">言語</th>
                    <th className="pb-2 pr-4 font-medium text-right">Stars</th>
                    <th className="pb-2 pr-4 font-medium">トピック</th>
                    <th className="pb-2 pr-4 font-medium text-right">工数(h)</th>
                    <th className="pb-2 pr-4 font-medium">Showcase</th>
                    <th className="pb-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRepos.map((repo) => (
                    <tr key={repo.id} className="border-b">
                      <td className="py-2 pr-4">
                        <div className="font-medium">
                          {repo.org_name}/{repo.repo_name}
                        </div>
                        {repo.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                            {repo.description}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {repo.language && (
                          <Badge variant="outline">{repo.language}</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right">{repo.stars}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {repo.topics.slice(0, 3).map((topic) => (
                            <Badge key={topic} variant="secondary" className="text-xs">
                              {topic}
                            </Badge>
                          ))}
                          {repo.topics.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{repo.topics.length - 3}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <Input
                          type="number"
                          min={0}
                          className="w-20 text-right"
                          value={editingHours[repo.id] ?? String(repo.hours_spent ?? '')}
                          onChange={(e) =>
                            setEditingHours((prev) => ({
                              ...prev,
                              [repo.id]: e.target.value,
                            }))
                          }
                          onBlur={() => handleHoursBlur(repo)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleHoursBlur(repo)
                            }
                          }}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <Button
                          variant={repo.is_showcase ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handleToggleShowcase(repo)}
                        >
                          {repo.is_showcase ? 'ON' : 'OFF'}
                        </Button>
                      </td>
                      <td className="py-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={analyzingId === repo.id}
                          onClick={() => handleAnalyze(repo)}
                        >
                          {analyzingId === repo.id ? '解析中...' : '解析'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
