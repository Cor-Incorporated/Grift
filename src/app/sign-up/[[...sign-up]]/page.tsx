import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20">
      <div className="mb-8 text-center">
        <span className="text-4xl">💼</span>
        <h1 className="mt-2 text-2xl font-bold">The Benevolent Dictator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          新しいアカウントを作成してください
        </p>
      </div>
      <SignUp
        appearance={{
          elements: {
            rootBox: 'mx-auto',
            card: 'shadow-md',
          },
        }}
        forceRedirectUrl="/onboarding"
      />
      <p className="mt-6 text-sm text-muted-foreground">
        既にアカウントをお持ちの方は{' '}
        <Link
          href="/sign-in"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          サインイン
        </Link>
      </p>
    </div>
  )
}
