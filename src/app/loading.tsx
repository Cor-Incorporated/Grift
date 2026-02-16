import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="space-y-4 text-center">
        <div className="animate-pulse text-4xl">💼</div>
        <Skeleton className="h-4 w-48" />
      </div>
    </div>
  )
}
