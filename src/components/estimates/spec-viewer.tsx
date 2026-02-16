'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface SpecViewerProps {
  specMarkdown: string | null
}

export function SpecViewer({ specMarkdown }: SpecViewerProps) {
  if (!specMarkdown) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            AI セールスエンジニアとの対話が完了すると、仕様書が自動生成されます。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>生成された仕様書</CardTitle>
        <CardDescription>
          AI セールスエンジニアが対話内容を基に自動生成した仕様書です
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{specMarkdown}</ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  )
}
