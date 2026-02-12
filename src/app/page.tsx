import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const projectTypes = [
  {
    type: 'new_project' as const,
    title: '新規開発',
    description: 'ゼロからのシステム・アプリケーション開発',
    icon: '🏗️',
    color: 'bg-blue-500/10 text-blue-700 border-blue-200',
  },
  {
    type: 'bug_report' as const,
    title: 'バグ報告',
    description: '既存システムの不具合・エラーの報告',
    icon: '🐛',
    color: 'bg-red-500/10 text-red-700 border-red-200',
  },
  {
    type: 'fix_request' as const,
    title: '修正依頼',
    description: '既存機能の動作変更・修正のリクエスト',
    icon: '🔧',
    color: 'bg-amber-500/10 text-amber-700 border-amber-200',
  },
  {
    type: 'feature_addition' as const,
    title: '機能追加',
    description: '既存システムへの新機能の追加',
    icon: '✨',
    color: 'bg-green-500/10 text-green-700 border-green-200',
  },
]

export default async function HomePage() {
  const { userId } = await auth()

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <header className="border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎩</span>
            <h1 className="text-xl font-bold">The Benevolent Dictator</h1>
          </div>
          <div className="flex items-center gap-3">
            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="outline" size="sm">
                  ログイン
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button size="sm">
                  新規登録
                </Button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <Link href="/dashboard">
                <Button variant="outline" size="sm">
                  マイページ
                </Button>
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="secondary" className="mb-4">
            AI 執事があなたの案件を完璧に整理します
          </Badge>
          <h2 className="mb-4 text-4xl font-bold tracking-tight">
            どのようなご用件でしょうか？
          </h2>
          <p className="mb-12 text-lg text-muted-foreground">
            案件のタイプをお選びください。AI 執事が一問一答形式で
            <br />
            必要な情報を丁寧にお伺いいたします。
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
          {projectTypes.map((pt) => (
            <Link
              key={pt.type}
              href={userId ? `/projects/new?type=${pt.type}` : `/sign-up?redirect_url=/projects/new?type=${pt.type}`}
            >
              <Card className="group h-full cursor-pointer transition-all hover:shadow-lg hover:-translate-y-1">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{pt.icon}</span>
                    <div>
                      <CardTitle className="text-lg">{pt.title}</CardTitle>
                      <Badge variant="outline" className={pt.color}>
                        {pt.type.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">
                    {pt.description}
                  </CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
