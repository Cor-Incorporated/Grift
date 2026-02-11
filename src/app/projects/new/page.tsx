'use client'

import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProjectType } from '@/types/database'

const typeLabels: Record<ProjectType, { title: string; icon: string }> = {
  new_project: { title: '新規開発', icon: '🏗️' },
  bug_report: { title: 'バグ報告', icon: '🐛' },
  fix_request: { title: '修正依頼', icon: '🔧' },
  feature_addition: { title: '機能追加', icon: '✨' },
}

function NewProjectForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const defaultType = (searchParams.get('type') ?? 'new_project') as ProjectType

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    title: '',
    type: defaultType,
    priority: '',
    existing_system_url: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            name: formData.name,
            email: formData.email,
            company: formData.company || undefined,
          },
          project: {
            title: formData.title,
            type: formData.type,
            priority: formData.priority || undefined,
            existing_system_url: formData.existing_system_url || undefined,
          },
        }),
      })

      const result = await response.json()

      if (!result.success) {
        setError(result.error)
        return
      }

      router.push(`/projects/${result.data.project.id}/chat`)
    } catch {
      setError('リクエストに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const typeInfo = typeLabels[formData.type]
  const showPriority = formData.type === 'bug_report' || formData.type === 'fix_request'
  const showExistingUrl = formData.type !== 'new_project'

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 py-12">
      <div className="container mx-auto max-w-2xl px-4">
        <div className="mb-8 text-center">
          <span className="text-4xl">{typeInfo.icon}</span>
          <h1 className="mt-2 text-2xl font-bold">{typeInfo.title}のご相談</h1>
          <p className="text-muted-foreground">
            基本情報をご入力ください。AI 執事が詳細をお伺いします。
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
            <CardDescription>お客様と案件の基本情報を入力してください</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">お客様情報</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">お名前</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">メールアドレス</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">会社名（任意）</Label>
                  <Input
                    id="company"
                    value={formData.company}
                    onChange={(e) =>
                      setFormData({ ...formData, company: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">案件情報</h3>
                <div className="space-y-2">
                  <Label htmlFor="title">案件タイトル</Label>
                  <Input
                    id="title"
                    placeholder="例: ECサイトのリニューアル"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>案件タイプ</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) =>
                      setFormData({ ...formData, type: value as ProjectType })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new_project">🏗️ 新規開発</SelectItem>
                      <SelectItem value="bug_report">🐛 バグ報告</SelectItem>
                      <SelectItem value="fix_request">🔧 修正依頼</SelectItem>
                      <SelectItem value="feature_addition">✨ 機能追加</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {showPriority && (
                  <div className="space-y-2">
                    <Label>優先度</Label>
                    <Select
                      value={formData.priority}
                      onValueChange={(value) =>
                        setFormData({ ...formData, priority: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="選択してください" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">低</SelectItem>
                        <SelectItem value="medium">中</SelectItem>
                        <SelectItem value="high">高</SelectItem>
                        <SelectItem value="critical">緊急</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {showExistingUrl && (
                  <div className="space-y-2">
                    <Label htmlFor="existing_url">
                      既存システム URL / リポジトリ（任意）
                    </Label>
                    <Input
                      id="existing_url"
                      type="url"
                      placeholder="https://..."
                      value={formData.existing_system_url}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          existing_system_url: e.target.value,
                        })
                      }
                    />
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'AI 執事を呼び出しています...' : 'AI 執事との対話を開始'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">読み込み中...</div>}>
      <NewProjectForm />
    </Suspense>
  )
}
