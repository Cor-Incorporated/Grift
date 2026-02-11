'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
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

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState('')
  const [hourlyRate, setHourlyRate] = useState('15000')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: admin } = await supabase
          .from('admins')
          .select('*')
          .eq('user_id', user.id)
          .single()

        if (admin) {
          setDisplayName(admin.display_name ?? '')
          setHourlyRate(String(admin.default_hourly_rate ?? 15000))
        }
      }
    }

    loadSettings()
  }, [])

  const handleSave = async () => {
    setLoading(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) return

      const { error } = await supabase
        .from('admins')
        .upsert({
          user_id: user.id,
          display_name: displayName,
          default_hourly_rate: Number(hourlyRate),
        }, { onConflict: 'user_id' })

      if (error) {
        toast.error('設定の保存に失敗しました')
        return
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
          <Button onClick={handleSave} disabled={loading}>
            {loading ? '保存中...' : '設定を保存'}
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
