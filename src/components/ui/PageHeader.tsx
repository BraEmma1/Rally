import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

// Page title block from the Rally Event UI: display-weight heading in the
// navy ink, one line of context, and optional actions that wrap under the
// text on narrow screens.
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-rally-navy md:text-[2rem] md:leading-10">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-rally-muted md:text-base">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
