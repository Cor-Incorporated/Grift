import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

export default async function EstimatesPage() {
  const supabase = await createServiceRoleClient()

  const { data: estimates } = await supabase
    .from('estimates')
    .select('*, project:projects(*, customer:customers(*))')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">見積り一覧</h1>
        <p className="text-muted-foreground">
          全 {estimates?.length ?? 0} 件の見積り
        </p>
      </div>

      {!estimates || estimates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            まだ見積りがありません
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {estimates.map((estimate) => (
            <Link
              key={estimate.id}
              href={`/admin/projects/${estimate.project_id}`}
            >
                <Card className="transition-colors hover:bg-muted/50">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">
                      {estimate.project?.title ?? '不明な案件'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {estimate.project?.customer?.name} -{' '}
                      {new Date(estimate.created_at).toLocaleDateString('ja-JP')}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant="outline">
                      {estimate.estimate_mode}
                    </Badge>
                    <Badge variant={estimate.estimate_status === 'ready' ? 'default' : 'secondary'}>
                      {estimate.estimate_status === 'ready' ? 'ready' : 'draft'}
                    </Badge>
                    <span className="text-lg font-bold">
                      ¥{estimate.total_your_cost?.toLocaleString() ?? 0}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
