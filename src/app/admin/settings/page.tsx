'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'

interface AdminProfileResponse {
  success: boolean
  error?: string
  data?: {
    id: string | null
    display_name: string
    default_hourly_rate: number
    github_orgs: string[]
  }
}

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState('')
  const [hourlyRate, setHourlyRate] = useState('15000')
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/admin/profile', {
          method: 'GET',
          cache: 'no-store',
        })
        const payload = (await response.json()) as AdminProfileResponse

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? '設定の取得に失敗しました')
        }

        setDisplayName(payload.data.display_name)
        setHourlyRate(String(payload.data.default_hourly_rate))
      } catch {
        toast.error('設定の読み込みに失敗しました')
      } finally {
        setInitializing(false)
      }
    }

    loadSettings()
  }, [])

  const handleSave = async () => {
    setLoading(true)

    try {
      const parsedHourlyRate = Number(hourlyRate)
      if (!Number.isFinite(parsedHourlyRate)) {
        toast.error('デフォルト時給は数値で入力してください')
        return
      }

      const response = await fetch('/api/admin/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          display_name: displayName,
          default_hourly_rate: parsedHourlyRate,
        }),
      })
      const payload = (await response.json()) as AdminProfileResponse

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? '設定の保存に失敗しました')
      }

      toast.success('設定を保存しました')
    } catch {
      toast.error('エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">設定</h1>
        <p className="text-muted-foreground">管理者の設定を変更します</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>プロフィール</CardTitle>
          <CardDescription>管理者の基本情報</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="display_name">表示名</Label>
            <Input
              id="display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hourly_rate">デフォルト時給 (円)</Label>
            <Input
              id="hourly_rate"
              type="number"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              min={1000}
            />
          </div>
          <Button onClick={handleSave} disabled={loading || initializing}>
            {loading ? '保存中...' : initializing ? '読込中...' : '設定を保存'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GitHub 連携</CardTitle>
          <CardDescription>GitHub App の設定</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            GitHub App のインストールと Org の連携は今後のアップデートで対応予定です。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
