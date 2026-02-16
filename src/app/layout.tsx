import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { jaJP } from '@clerk/localizations'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'The Benevolent Dictator',
  description: 'AI セールスエンジニアが完璧な仕様書と反論不能の見積りを自動生成する高効率案件管理システム',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider
      localization={jaJP}
      appearance={{
        layout: {
          socialButtonsPlacement: 'bottom',
          socialButtonsVariant: 'iconButton',
        },
      }}
    >
      <html lang="ja" suppressHydrationWarning>
        <body
          style={{
            '--font-geist-sans':
              'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            '--font-geist-mono':
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          } as React.CSSProperties}
          className="font-sans antialiased"
        >
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  )
}
