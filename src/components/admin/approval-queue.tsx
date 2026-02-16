'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ApprovalRequest, InternalRole } from '@/types/database'

interface ApprovalQueueProps {
  requests: ApprovalRequest[]
  internalRoles: InternalRole[]
}

const statusLabel: Record<string, string> = {
  pending: '未処理',
  approved: '承認済み',
  rejected: '却下',
  cancelled: 'キャンセル',
}

const roleLabel: Record<InternalRole, string> = {
  admin: '管理者',
  sales: '営業',
  dev: '開発',
}

function canResolve(internalRoles: Set<InternalRole>, requiredRole: InternalRole): boolean {
  if (internalRoles.has('admin')) {
    return true
  }
  return internalRoles.has(requiredRole)
}

export function ApprovalQueue({ requests, internalRoles }: ApprovalQueueProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const roleSet = new Set(internalRoles)

  const handleResolve = async (id: string, status: 'approved' | 'rejected') => {
    setLoadingId(id)
    setError(null)

    try {
      const response = await fetch(`/api/admin/approval-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const result = await response.json()
      if (!result.success) {
        setError(result.error ?? '承認ステータスの更新に失敗しました')
        return
      }
      window.location.reload()
    } catch {
      setError('承認ステータスの更新に失敗しました')
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            承認リクエストはありません
          </CardContent>
        </Card>
      ) : (
        requests.map((request) => {
          const actionable = request.status === 'pending'
            && canResolve(roleSet, request.required_role)
          return (
            <Card key={request.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{request.request_type}</CardTitle>
                  <Badge variant={request.status === 'pending' ? 'default' : 'outline'}>
                    {statusLabel[request.status] ?? request.status}
                  </Badge>
                </div>
                <CardDescription>
                  required role: {roleLabel[request.required_role]}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm whitespace-pre-wrap">{request.reason}</p>
                <div className="text-xs text-muted-foreground">
                  <p>project_id: {request.project_id}</p>
                  <p>requested_at: {new Date(request.requested_at).toLocaleString('ja-JP')}</p>
                </div>
                {actionable && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={loadingId === request.id}
                      onClick={() => handleResolve(request.id, 'approved')}
                    >
                      承認
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={loadingId === request.id}
                      onClick={() => handleResolve(request.id, 'rejected')}
                    >
                      却下
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
