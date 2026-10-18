import { Lock } from 'lucide-react'
import { Spinner } from '@/components/ui/States'
import { cn } from '@/lib/utils'

// A metric tile. `unavailable` is for data an admin is not authorized to read
// yet: it renders the reason instead of a number, because showing 0 would claim
// a fact the database never reported.
export function StatCard({
  label,
  definition,
  value,
  loading,
  unavailable,
  highlight,
}: {
  label: string
  definition: string
  value?: number | null
  loading?: boolean
  unavailable?: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-4',
        highlight && !unavailable ? 'border-warning-200' : 'border-gray-200'
      )}
    >
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <div className="mt-2 min-h-[2.25rem]">
        {unavailable ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Unavailable
          </p>
        ) : loading ? (
          <Spinner size="sm" />
        ) : (
          <p className="text-3xl font-bold tabular-nums text-gray-900">{value ?? '—'}</p>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">{unavailable ?? definition}</p>
    </div>
  )
}
