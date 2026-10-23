import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

// Parts of the event page whose backend does not exist yet. They are drawn at
// full size so the layout is final, but they are plainly marked and do nothing:
// no invented values, and nothing that looks like it succeeded.

export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500',
        className
      )}
    >
      Coming soon
    </span>
  )
}

// An action that cannot run yet: disabled, announced as such, still full size.
export function ComingSoonButton({ children, className, ...props }: ButtonProps) {
  return (
    <Button {...props} disabled aria-disabled="true" title="Coming soon" className={cn('rounded-xl', className)}>
      {children}
      <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Soon</span>
    </Button>
  )
}

// A content block that has no data source yet.
export function ComingSoonBlock({
  icon,
  title,
  description,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4',
        className
      )}
    >
      {icon && <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-600">{title}</p>
          <ComingSoonBadge />
        </div>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
    </div>
  )
}
