import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function GitHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">GitHub 連携</h1>
        <p className="text-muted-foreground">
          GitHub App を通じた過去実績の管理
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>GitHub App 連携</CardTitle>
          <CardDescription>
            GitHub Organization を連携して過去実績を取得します
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            GitHub App の OAuth フローとリポジトリ同期機能は Sprint 3 で実装予定です。
            環境変数 (GITHUB_APP_ID 等) は設定済みです。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
