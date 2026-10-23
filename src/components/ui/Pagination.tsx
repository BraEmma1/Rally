import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PaginationProps {
  page: number
  pageCount: number
  onChange: (page: number) => void
  label?: string
}

// Page numbers to show: the first, the last, and the current page with one
// neighbour each side. Gaps become a single ellipsis.
function pageWindow(page: number, pageCount: number): (number | 'gap-start' | 'gap-end')[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount))
  const sorted = [...wanted].sort((a, b) => a - b)
  const out: (number | 'gap-start' | 'gap-end')[] = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(i === 1 ? 'gap-start' : 'gap-end')
    out.push(n)
  })
  return out
}

const baseBtn =
  'flex h-11 min-w-[44px] items-center justify-center rounded-xl px-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600'

export function Pagination({ page, pageCount, onChange, label = 'Pagination' }: PaginationProps) {
  if (pageCount <= 1) return null
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className={cn(baseBtn, 'bg-rally-tint text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40')}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      {pageWindow(page, pageCount).map((item) =>
        typeof item === 'number' ? (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            aria-label={`Page ${item}`}
            aria-current={item === page ? 'page' : undefined}
            className={cn(
              baseBtn,
              item === page ? 'bg-primary-600 text-white' : 'text-rally-muted hover:bg-rally-tint hover:text-rally-navy'
            )}
          >
            {item}
          </button>
        ) : (
          <span key={item} className="px-1 text-slate-400" aria-hidden="true">
            …
          </span>
        )
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
        className={cn(baseBtn, 'bg-rally-tint text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40')}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  )
}
