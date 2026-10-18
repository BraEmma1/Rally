import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export function AdminPagination({
  page,
  pageSize,
  total,
  loading,
  label,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  loading: boolean
  label: string
  onPageChange: (page: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3" aria-label={label}>
      <p className="text-sm text-gray-500" aria-live="polite">
        {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={loading || page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-gray-600">
          Page {page + 1} of {pageCount}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          disabled={loading || page >= pageCount - 1}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  )
}
