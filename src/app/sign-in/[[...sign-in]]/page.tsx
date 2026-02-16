import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-muted/20">
      <div className="mb-8 text-center">
        <span className="text-4xl">💼</span>
        <h1 className="mt-2 text-2xl font-bold">The Benevolent Dictator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          アカウントにサインインしてください
        </p>
      </div>
      <SignIn
        appearance={{
          elements: {
            rootBox: 'mx-auto',
            card: 'shadow-md',
          },
        }}
        forceRedirectUrl="/dashboard"
      />
      <p className="mt-6 text-sm text-muted-foreground">
        アカウントをお持ちでない方は{' '}
        <Link
          href="/sign-up"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          サインアップ
        </Link>
      </p>
    </div>
  )
}
