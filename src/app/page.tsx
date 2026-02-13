import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

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

      <main className="container mx-auto px-4 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-6xl">🎩</span>
          <h2 className="mt-6 text-4xl font-bold tracking-tight">
            The Benevolent Dictator
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            AI 執事が何でもお伺いします
          </p>

          <div className="mt-10">
            <Link href={userId ? '/projects/new' : '/sign-up?redirect_url=/projects/new'}>
              <Button size="lg" className="h-14 px-10 text-lg">
                AI 執事に相談する
              </Button>
            </Link>
          </div>

          <div className="mt-16">
            <p className="mb-4 text-sm font-medium text-muted-foreground">
              こんなご相談に対応
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Badge variant="secondary" className="px-4 py-2 text-sm">
                🏗️ 新規開発
              </Badge>
              <Badge variant="secondary" className="px-4 py-2 text-sm">
                🐛 バグ報告
              </Badge>
              <Badge variant="secondary" className="px-4 py-2 text-sm">
                🔧 修正依頼
              </Badge>
              <Badge variant="secondary" className="px-4 py-2 text-sm">
                ✨ 機能追加
              </Badge>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
