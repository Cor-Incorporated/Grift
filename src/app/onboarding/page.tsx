'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
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

export default function OnboardingPage() {
  const { user, isLoaded } = useUser()
  const router = useRouter()

  const [formData, setFormData] = useState({
    companyName: '',
    displayName: '',
    phone: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isLoaded && user) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ')
      setFormData((prev) => ({
        ...prev,
        displayName: fullName,
      }))
    }
  }, [isLoaded, user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/customers/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: formData.companyName,
          display_name: formData.displayName,
          phone: formData.phone || undefined,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        setError(result.error ?? 'プロフィールの保存に失敗しました')
        return
      }

      router.push('/dashboard')
    } catch {
      setError('リクエストに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-muted/20">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-muted/20">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-2 text-4xl">💼</div>
          <CardTitle className="text-2xl">初期設定</CardTitle>
          <CardDescription>
            AI セールスエンジニアがお客様の情報を記憶いたします。次回以降、入力の手間が省けます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">
                会社名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="companyName"
                placeholder="例: 株式会社サンプル"
                value={formData.companyName}
                onChange={(e) =>
                  setFormData({ ...formData, companyName: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">
                表示名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="displayName"
                placeholder="例: 山田 太郎"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData({ ...formData, displayName: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">電話番号（任意）</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="例: 03-1234-5678"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '保存中...' : '設定を保存してはじめる'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
